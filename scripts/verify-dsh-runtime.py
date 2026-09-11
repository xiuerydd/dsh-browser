"""验证 dsh 运行时是否真正可用（不只是"端口在监听"）。

为什么需要这个：
  端口 LISTENING 并不代表 dsh 可用。dsh 会**先绑定端口、再加载插件树**；
  若插件树加载失败（例如 node_modules 缺文件），进程会在约 40 秒后崩溃退出，
  期间接口全部返回 404。只检查端口会得出"正常"的错误结论。

判定标准（三条都过才算可用）：
  1. 进程在插件树加载窗口（约 60s）之后仍存活
  2. GET / 不是 404
  3. 日志里没有 "plugin tree failed to load"

用法：
  python scripts/verify-dsh-runtime.py <node_modules 路径> [端口]
    例：python scripts/verify-dsh-runtime.py node_modules
        python scripts/verify-dsh-runtime.py probe-icon/win-unpacked/resources/dsh-runtime/node_modules
"""
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(2)

MODS = os.path.abspath(sys.argv[1])
PORT = sys.argv[2] if len(sys.argv) > 2 else "3077"
# 额外的 Node 启动参数，如 --expose-internals
NODE_FLAGS = sys.argv[3:] if len(sys.argv) > 3 else []

DSH_BIN = os.path.join(MODS, "@deepseek-ai", "dsh", "lib", "bin.js")
if not os.path.isfile(DSH_BIN):
    print(f"找不到 dsh 入口: {DSH_BIN}")
    sys.exit(1)

# 找一个可用的 electron.exe（开发环境）作为 Node 运行时
ELECTRON = None
for cand in [
    os.path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    os.path.join(os.path.dirname(os.path.dirname(ROOT)), "dsh-browser",
                 "node_modules", "electron", "dist", "electron.exe"),
]:
    if os.path.isfile(cand):
        ELECTRON = cand
        break
if ELECTRON is None:
    print("找不到 electron.exe（需要它作为内置 Node 运行时）")
    sys.exit(1)


def clean_env(dsh_home):
    return {
        "SystemRoot": r"C:\Windows", "SystemDrive": "C:", "windir": r"C:\Windows",
        "PATH": r"C:\Windows\System32;C:\Windows",
        "USERPROFILE": os.path.expanduser("~"),
        "APPDATA": os.environ.get("APPDATA", ""),
        "LOCALAPPDATA": os.environ.get("LOCALAPPDATA", ""),
        "TEMP": os.environ.get("TEMP", ""), "TMP": os.environ.get("TEMP", ""),
        "USERNAME": os.environ.get("USERNAME", ""),
        "COMPUTERNAME": os.environ.get("COMPUTERNAME", ""),
        "NUMBER_OF_PROCESSORS": os.environ.get("NUMBER_OF_PROCESSORS", "1"),
        "PROCESSOR_ARCHITECTURE": "AMD64",
        "DSH_HOME": dsh_home,
        "ELECTRON_RUN_AS_NODE": "1",
    }


def port_open(port):
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                         errors="replace").stdout
    for line in out.splitlines():
        p = line.split()
        if len(p) >= 5 and p[0].upper() == "TCP" and p[3].upper() == "LISTENING" and p[1].endswith(f":{port}"):
            return True
    return False


def http(url, timeout=6):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read()
            return r.status, len(body)
    except urllib.error.HTTPError as e:
        return e.code, 0
    except Exception as e:  # noqa: BLE001
        return type(e).__name__, 0


home = os.path.join(tempfile.gettempdir(), "dsh-runtime-check-home")
logf = os.path.join(tempfile.gettempdir(), "dsh-runtime-check.log")
try:
    os.remove(logf)
except OSError:
    pass

# 清孤儿锁
subprocess.run(["cmd", "/c", "del", "/f", "/q",
                os.path.join(home, "profiles", "node_modules.lock")], capture_output=True)

print(f"node_modules : {MODS}")
print(f"electron     : {ELECTRON}")
print(f"DSH_HOME     : {home}")
print(f"port         : {PORT}")
print()

with open(logf, "w", encoding="utf-8", errors="replace") as f:
    proc = subprocess.Popen(
        [ELECTRON, *NODE_FLAGS, DSH_BIN, "web", "--port", PORT, "--no-open"],
        env=clean_env(home), stdout=f, stderr=subprocess.STDOUT, cwd=ROOT,
    )

t0 = time.time()
while time.time() - t0 < 150:
    if port_open(PORT):
        break
    if proc.poll() is not None:
        break
    time.sleep(2)

if not port_open(PORT):
    print(f"[FAIL] 端口未监听，进程退出码={proc.poll()}")
    proc.kill()
    print(open(logf, encoding="utf-8", errors="replace").read()[:2000])
    sys.exit(1)

t_listen = time.time() - t0
print(f"端口就绪: {t_listen:.0f}s")

# 关键：等过插件树加载窗口
print("等待插件树加载（60s，这段时间最容易被误判为正常）...")
for i in range(6):
    time.sleep(10)
    if proc.poll() is not None:
        print(f"  [!] 进程在 t={t_listen + (i+1)*10:.0f}s 崩溃，退出码={proc.poll()}")
        break
else:
    print(f"  进程存活 ✓")

alive = proc.poll() is None
st, blen = http(f"http://127.0.0.1:{PORT}/") if alive else ("(已崩溃)", 0)
st2, blen2 = http(f"http://127.0.0.1:{PORT}/?token=bogus") if alive else ("(已崩溃)", 0)

log = open(logf, encoding="utf-8", errors="replace").read()
boot_fail = "plugin tree failed to load" in log
mod_missing = "ERR_MODULE_NOT_FOUND" in log

print()
print(f"进程存活     : {alive}")
print(f"GET /        : {st} ({blen} 字节)")
print(f"GET /?token= : {st2} ({blen2} 字节)")
print(f"插件树加载失败: {boot_fail}")
print(f"模块缺失     : {mod_missing}")

ok = alive and not boot_fail and not mod_missing and st != 404
print()
print(f"[{'OK' if ok else 'FAIL'}] 运行时{'可用' if ok else '不可用'}")

if not ok:
    print()
    print("=== 日志（去掉堆栈行）===")
    for line in log.splitlines():
        if not line.strip().startswith("at "):
            print("  ", line[:220])

proc.terminate()
try:
    proc.wait(timeout=15)
except subprocess.TimeoutExpired:
    proc.kill()
sys.exit(0 if ok else 1)
