"""DeepSeek Harness Browser 黑盒测试。

只从**外部可观察行为**验证：端口监听、HTTP 响应、进程树、耗时、退出清理。
不读源码、不调内部接口。

关键设计：
- 用 DSH_HOME 指向临时目录来模拟"全新首次运行"，**不触碰用户真实的 ~/.dsh**
- 用干净进程环境（PATH 不含 node 目录、无 NODE_OPTIONS）模拟"用户双击"
- 用 WMI 采集进程命令行，区分「app 主进程」「app spawn 的 dsh」「系统 node」

用法：
  python scripts/blackbox-test.py
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

APP = r"C:\Users\灵\AppData\Local\Programs\dsh-browser\DeepSeek Harness Browser.exe"
APP_NAME = "DeepSeek Harness Browser.exe"
SETTINGS = os.path.join(os.environ["APPDATA"], "DeepSeek Harness Browser", "settings.json")
PORT = 3080

results = []


# ---------------------------------------------------------------- 基础设施

def clean_env(dsh_home=None, extra=None):
    """构造干净进程环境：不含 node 目录、不含 NODE_OPTIONS / CODEBUDDY_*。"""
    env = {
        "SystemRoot": r"C:\Windows",
        "SystemDrive": "C:",
        "windir": r"C:\Windows",
        "PATH": r"C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem",
        "USERPROFILE": os.path.expanduser("~"),
        "HOMEDRIVE": "C:",
        "HOMEPATH": os.path.expanduser("~")[2:],
        "APPDATA": os.environ.get("APPDATA", ""),
        "LOCALAPPDATA": os.environ.get("LOCALAPPDATA", ""),
        "TEMP": os.environ.get("TEMP", ""),
        "TMP": os.environ.get("TEMP", ""),
        "USERNAME": os.environ.get("USERNAME", ""),
        "COMPUTERNAME": os.environ.get("COMPUTERNAME", ""),
        "NUMBER_OF_PROCESSORS": os.environ.get("NUMBER_OF_PROCESSORS", "1"),
        "PROCESSOR_ARCHITECTURE": "AMD64",
    }
    if dsh_home:
        env["DSH_HOME"] = dsh_home
    if extra:
        env.update(extra)
    return {k: v for k, v in env.items() if v}


def netstat_lines():
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, errors="replace").stdout
    return out.splitlines()


def port_owner(port):
    """返回正在 LISTEN 该端口的 PID，没有则 None。"""
    for line in netstat_lines():
        parts = line.split()
        if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[3].upper() == "LISTENING":
            local = parts[1]
            if local.endswith(f":{port}"):
                return int(parts[4])
    return None


def established_count(port):
    n = 0
    for line in netstat_lines():
        parts = line.split()
        if len(parts) >= 4 and parts[0].upper() == "TCP" and parts[3].upper() == "ESTABLISHED":
            if parts[1].endswith(f":{port}") or parts[2].endswith(f":{port}"):
                n += 1
    return n


def wait_port(port, timeout, proc=None):
    """等端口监听，返回耗时秒数；超时返回 None。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        if port_owner(port) is not None:
            return time.time() - t0
        if proc is not None and proc.poll() is not None:
            return None
        time.sleep(1)
    return None


def http_probe(url, timeout=8):
    """返回 (status, content_type, body_len)。"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read()
            return r.status, r.headers.get("Content-Type", ""), len(body)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "") if e.headers else "", 0
    except Exception as e:  # noqa: BLE001
        return None, type(e).__name__, 0


def procs():
    """WMI 采集 (pid, name, cmdline)。"""
    import win32com.client
    wmi = win32com.client.GetObject("winmgmts:")
    return [
        (p.ProcessId, p.Name or "", p.CommandLine or "")
        for p in wmi.ExecQuery("SELECT ProcessId, Name, CommandLine FROM Win32_Process")
    ]


def app_procs():
    """属于本应用的进程：主进程 + 它 spawn 的 dsh（都以 app exe 为镜像名）。"""
    out = []
    for pid, name, cmd in procs():
        if name.lower() == APP_NAME.lower():
            kind = "dsh-server" if "bin.js" in cmd else "app"
            out.append((pid, kind, cmd))
    return out


def system_dsh_procs():
    """系统里的 node.exe / 全局 dsh，用来证明"没用到系统依赖"。"""
    out = []
    for pid, name, cmd in procs():
        low = name.lower()
        if low == "node.exe" and ("dsh" in cmd.lower()):
            out.append((pid, name, cmd))
        elif low in ("dsh.cmd", "dsh.exe", "dsh"):
            out.append((pid, name, cmd))
    return out


def kill_all():
    """结束应用进程树 + 释放测试端口。"""
    subprocess.run(["taskkill", "/F", "/T", "/IM", APP_NAME], capture_output=True)
    time.sleep(1)
    for _ in range(3):
        pid = port_owner(PORT)
        if pid is None:
            break
        subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
        time.sleep(1)


def launch(env, wait=0):
    p = subprocess.Popen(
        [APP], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        cwd=os.path.dirname(APP),
    )
    if wait:
        time.sleep(wait)
    return p


def restore_settings_port(port=PORT):
    """把 settings.json 的端口改回去。"""
    import json
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            s = json.load(f)
    except (OSError, ValueError):
        return
    s.setdefault("server", {})["port"] = port
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)


def record(name, ok, detail):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"         {detail}")
    print()


# ---------------------------------------------------------------- 用例

def t1_cold_start(tmp_home):
    print("T1 冷启动（全新 DSH_HOME + 无系统 node/dsh）")
    kill_all()
    shutil.rmtree(tmp_home, ignore_errors=True)
    env = clean_env(dsh_home=tmp_home)
    p = launch(env)
    dt = wait_port(PORT, 180, p)
    if dt is None:
        record("T1 冷启动", False, f"{180}s 内端口未监听，进程存活={p.poll() is None}")
        return None, None
    owner = port_owner(PORT)
    apps = app_procs()
    sysd = system_dsh_procs()
    detail = (f"{dt:.0f}s 内 {PORT} LISTENING (PID {owner})；"
              f"应用进程 {len(apps)} 个；系统 node/dsh 进程 {len(sysd)} 个")
    record("T1 冷启动", dt <= 180 and len(sysd) == 0, detail)
    return dt, p


def t2_service_healthy(proc, launch_t0):
    """关键用例：等到插件树加载窗口之后再判定。

    dsh 会「先绑端口、再加载插件树」。若插件树加载失败（缺文件、缺启动参数），
    进程会在约 40 秒后崩溃退出，期间端口是 LISTENING 的 —— 只查端口会误判为正常。
    这里等到 75 秒后确认进程仍在、且 / 返回 401（无 token 的正确鉴权响应）。
    """
    print("T2 服务健康（跨过插件树加载窗口后仍在服务）")
    target = launch_t0 + 75
    while time.time() < target:
        if proc.poll() is not None:
            break
        time.sleep(3)

    alive = proc.poll() is None
    st, ctype, blen = http_probe(f"http://127.0.0.1:{PORT}/") if alive else ("(已崩溃)", "", 0)
    est = established_count(PORT)
    # 无 token 时应是 401；404 说明插件树没加载起来（路由未注册）
    ok = alive and st == 401
    detail = (f"启动后 75s：进程存活={alive}；GET / -> {st}"
              f"{'（正确：无 token 拒绝）' if st == 401 else ''}；ESTABLISHED {est} 条")
    if st == 404:
        detail += "  <<< 404 说明插件树未加载（路由未注册），dsh 运行时不完整"
    record("T2 服务健康", ok, detail)


def t3_single_instance():
    print("T3 单实例锁（重复启动不应产生第二个服务）")
    before = app_procs()
    p2 = launch(clean_env())
    time.sleep(6)
    after = app_procs()
    listeners = [l for l in netstat_lines()
                 if len(l.split()) >= 5 and l.split()[0].upper() == "TCP"
                 and l.split()[3].upper() == "LISTENING" and l.split()[1].endswith(f":{PORT}")]
    dsh_after = [a for a in after if a[1] == "dsh-server"]
    ok = len(listeners) == 1 and len(dsh_after) == 1
    record("T3 单实例锁", ok,
           f"监听者 {len(listeners)} 个；dsh 服务进程 {len(dsh_after)} 个（启动前 {len(before)} 个进程）")
    if p2.poll() is None:
        p2.terminate()


def t4_reuse_existing():
    print("T4 复用已有服务（不应重复 spawn）")
    kill_all()
    # 手工用内置 dsh 起一个服务
    dsh_bin = os.path.join(os.path.dirname(APP), "resources", "dsh-runtime",
                           "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
    env = clean_env()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    # --expose-internals 必需：web profile 默认 patchReload="live" 会加载
    # cordis-plugin-hmr，该插件要求 Node 带此参数，否则插件树加载失败、约 40s 后退出
    manual = subprocess.Popen([APP, "--expose-internals", dsh_bin, "web",
                               "--port", str(PORT), "--no-open"],
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    dt = wait_port(PORT, 120, manual)
    if dt is None:
        record("T4 复用已有服务", False, "手工起服务失败，用例跳过")
        manual.terminate()
        return
    manual_pid = port_owner(PORT)
    # 再启动 app
    p = launch(clean_env())
    time.sleep(25)
    after_pid = port_owner(PORT)
    dsh_after = [a for a in app_procs() if a[1] == "dsh-server"]
    ok = after_pid == manual_pid and len(dsh_after) == 1
    record("T4 复用已有服务", ok,
           f"手工服务 PID {manual_pid} -> app 启动后端口归属 PID {after_pid}；"
           f"dsh 服务进程 {len(dsh_after)} 个（期望 1，即未重复 spawn）")
    if p.poll() is None:
        p.terminate()


def t5_quit_cleanup():
    print("T5 退出后清理")
    kill_all()
    p = launch(clean_env())
    if wait_port(PORT, 120, p) is None:
        record("T5 退出后清理", False, "服务未起来，用例跳过")
        return
    time.sleep(3)
    p.terminate()
    try:
        p.wait(timeout=20)
    except subprocess.TimeoutExpired:
        p.kill()
    time.sleep(5)
    left = app_procs()
    owner = port_owner(PORT)
    record("T5 退出后清理", len(left) == 0,
           f"关闭后残留应用进程 {len(left)} 个；端口 {PORT} 归属 {owner}")
    kill_all()


def t6_port_conflict():
    print("T6 端口被占用（应识别冲突，不应崩溃）")
    kill_all()
    # 用 Python 占住端口
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", PORT))
    srv.listen(5)
    squatter = os.getpid()

    p = launch(clean_env())
    time.sleep(30)
    alive = p.poll() is None
    apps = app_procs()
    owner = port_owner(PORT)

    # 观察 app 是否被"假装在线"骗到（占位服务不返回真实页面）
    st, ctype, blen = http_probe(f"http://127.0.0.1:{PORT}/", timeout=5)

    srv.close()
    ok = alive and len(apps) > 0
    record("T6 端口冲突", ok,
           f"app 存活={alive}，进程 {len(apps)} 个；端口被测试进程(PID {squatter})占用时"
           f"app 未崩溃；对占位服务的 GET -> {st}（说明 app 可能误判为'已在线'）")
    kill_all()


def t7_second_start(tmp_home):
    print("T7 二次启动（profile 已就绪，应更快）")
    kill_all()
    env = clean_env(dsh_home=tmp_home)
    p = launch(env)
    dt = wait_port(PORT, 120, p)
    if dt is None:
        record("T7 二次启动", False, "端口未监听")
        return
    record("T7 二次启动", True, f"{dt:.0f}s 就绪（profile 复用 {tmp_home}）")


def t8_custom_port():
    print("T8 自定义端口生效（改 settings.json 后应监听新端口）")
    kill_all()
    newport = 3131
    import json
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            saved = f.read()
    except OSError:
        saved = None
    if saved is None:
        record("T8 自定义端口", False, "读不到 settings.json，跳过")
        return
    s = json.loads(saved)
    s.setdefault("server", {})["port"] = newport
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)

    p = launch(clean_env())
    dt = wait_port(newport, 150, p)
    ok = dt is not None
    record("T8 自定义端口", ok,
           f"端口改为 {newport} -> {'%.0f 秒内监听' % dt if ok else '未监听'}")

    # 还原
    kill_all()
    with open(SETTINGS, "w", encoding="utf-8") as f:
        f.write(saved)
    restore_settings_port()


# ---------------------------------------------------------------- 主流程

def main():
    print("=" * 70)
    print("DeepSeek Harness Browser 黑盒测试")
    print("=" * 70)
    print(f"目标: {APP}")
    print(f"存在: {os.path.isfile(APP)}")
    print()

    if not os.path.isfile(APP):
        print("应用未安装，退出")
        return 2

    tmp_home = os.path.join(tempfile.gettempdir(), "dsh-blackbox-home")
    print(f"冷启动用 DSH_HOME: {tmp_home}（不影响真实 ~/.dsh）")
    print()

    kill_all()

    try:
        t0 = time.time()
        _, proc = t1_cold_start(tmp_home)
        if proc is None:
            raise SystemExit("冷启动失败，后续用例无意义")
        t2_service_healthy(proc, t0)
        t3_single_instance()
        t4_reuse_existing()
        t5_quit_cleanup()
        t6_port_conflict()
        t7_second_start(tmp_home)
        t8_custom_port()
    finally:
        kill_all()
        restore_settings_port()

    print("=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"结果: {passed}/{len(results)} 通过")
    for name, ok, _ in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print("=" * 70)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
