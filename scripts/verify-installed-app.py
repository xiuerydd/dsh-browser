"""端到端验证：应用能否自动拉起可用的内置 dsh。

支持两种模式：
  已安装版（默认）  → 启动 %LOCALAPPDATA%\\Programs\\dsh-browser 下的 exe
  开发模式（--dev） → 启动项目目录（electron.exe .），用于构建前快速自检

关键判定（不只是"端口在监听"）：
  dsh 会「先绑端口、再加载插件树」。插件树加载失败时进程约 40 秒后崩溃退出，
  期间端口是 LISTENING 的。所以必须跨过插件树加载窗口（75s）后再确认：
    1. 应用进程仍存活
    2. GET / 返回 401（无 token 的正确鉴权响应；404 说明路由未注册=插件树没起来）

用法：
  python scripts/verify-installed-app.py [端口]
  python scripts/verify-installed-app.py [端口] --dev
"""
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
FLAGS = [a for a in sys.argv[1:] if a.startswith("--")]
DEV = "--dev" in FLAGS

PORT = ARGS[0] if ARGS else "3080"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if DEV:
    APP = os.path.join(ROOT, "node_modules", "electron", "dist", "electron.exe")
    APP_ARGS = [APP, "."]
    WORKDIR = ROOT
    LABEL = "开发模式（electron .）"
    PROC_NAME = "electron.exe"
else:
    APP = r"C:\Users\灵\AppData\Local\Programs\dsh-browser\DeepSeek Harness Browser.exe"
    APP_ARGS = [APP]
    WORKDIR = os.path.dirname(APP)
    LABEL = "已安装版"
    PROC_NAME = "DeepSeek Harness Browser.exe"

if not os.path.isfile(APP):
    print(f"错误: 找不到 {APP}")
    sys.exit(1)

# 清孤儿锁（dsh 的锁设计上只能人工清理）
for base in (os.path.expanduser("~/.dsh"), os.environ.get("DSH_HOME", "")):
    if base:
        subprocess.run(["cmd", "/c", "del", "/f", "/q",
                        os.path.join(base, "profiles", "node_modules.lock")],
                       capture_output=True)

# 干净环境：PATH 不含托管 node 目录，排除 NODE_OPTIONS / ELECTRON_RUN_AS_NODE
KEEP = {
    "SystemRoot": r"C:\Windows",
    "SystemDrive": "C:",
    "windir": r"C:\Windows",
    "PATH": r"C:\Windows\System32;C:\Windows",
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
if DEV:
    # 开发模式下 Electron 需要能加载 .bin 等，但仍不注入 node 目录
    KEEP["PATH"] = r"C:\Windows\System32;C:\Windows"
env = {k: v for k, v in KEEP.items() if v}


def port_owner(port):
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                         errors="replace").stdout
    for line in out.splitlines():
        p = line.split()
        if len(p) >= 5 and p[0].upper() == "TCP" and p[3].upper() == "LISTENING" and p[1].endswith(f":{port}"):
            return int(p[4])
    return None


def http(url, timeout=8):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read()
            return r.status, len(body)
    except urllib.error.HTTPError as e:
        return e.code, 0
    except Exception as e:  # noqa: BLE001
        return type(e).__name__, 0


print(f"模式: {LABEL}")
print(f"命令: {' '.join(APP_ARGS)}")
print(f"端口: {PORT}")
print("环境: 干净（PATH 无托管 node 目录，无 NODE_OPTIONS）")
print()

proc = subprocess.Popen(APP_ARGS, env=env, stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL, cwd=WORKDIR)
t0 = time.time()

while time.time() - t0 < 180:
    if port_owner(PORT) is not None:
        break
    if proc.poll() is not None:
        break
    time.sleep(2)

dt = time.time() - t0
if port_owner(PORT) is None:
    print(f"[FAIL] {dt:.0f}s 内端口未监听；进程退出码={proc.poll()}")
    subprocess.run(["taskkill", "/F", "/T", "/IM", PROC_NAME], capture_output=True)
    sys.exit(1)

print(f"端口就绪: {dt:.0f}s (PID {port_owner(PORT)})")
print("等待插件树加载窗口（75s）—— 这是最容易误判为正常的一段 ...")

while time.time() - t0 < 75:
    if proc.poll() is not None:
        break
    time.sleep(3)

alive = proc.poll() is None
st, blen = http(f"http://127.0.0.1:{PORT}/") if alive else ("(已崩溃)", 0)

print()
print(f"进程存活   : {alive}（退出码 {proc.poll()}）")
print(f"GET /      : {st} ({blen} 字节)")
print()

ok = alive and st == 401
print(f"[{'OK' if ok else 'FAIL'}] 内置 dsh {'可用' if ok else '不可用'}")
if st == 404:
    print("      404 表示插件树未加载（路由未注册）——检查 dsh 运行时是否完整、")
    print("      以及启动参数是否带了 --expose-internals")

subprocess.run(["taskkill", "/F", "/T", "/IM", PROC_NAME], capture_output=True)
sys.exit(0 if ok else 1)
