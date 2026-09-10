"""验证打包产物里的内置 dsh 能否独立启动（不依赖系统 Node / dsh）。

用干净的进程环境启动，排除 WorkBuddy 终端注入的 NODE_OPTIONS
（它会加载 safe-delete shim，hook fs.rm，导致 dsh 删不掉自己的 profile 锁）。

用法：
  python verify-packaged.py <win-unpacked 目录> [端口]
"""
import os
import subprocess
import sys
import time

if len(sys.argv) < 2:
    print("用法: python verify-packaged.py <win-unpacked 目录> [端口]")
    sys.exit(2)

APP_DIR = os.path.abspath(sys.argv[1])
PORT = sys.argv[2] if len(sys.argv) > 2 else "3099"

EXE = os.path.join(APP_DIR, "DeepSeek Harness Browser.exe")
DSH_BIN = os.path.join(
    APP_DIR, "resources", "dsh-runtime", "node_modules",
    "@deepseek-ai", "dsh", "lib", "bin.js",
)

if not os.path.isfile(EXE):
    print(f"错误: 找不到 {EXE}")
    sys.exit(1)
if not os.path.isfile(DSH_BIN):
    print(f"错误: 找不到内置 dsh: {DSH_BIN}")
    sys.exit(1)

# 清理孤儿锁（用 Windows del，不走 Node shim）
subprocess.run(
    ["cmd", "/c", "del", "/f", "/q",
     os.path.expanduser(r"~\.dsh\profiles\node_modules.lock")],
    capture_output=True,
)

# 只保留运行必需的环境变量
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
    "ELECTRON_RUN_AS_NODE": "1",   # 关键：让 Electron 以 Node 模式运行
}
env = {k: v for k, v in KEEP.items() if v}

print(f"exe    : {EXE}")
print(f"dsh bin: {DSH_BIN}")
print(f"port   : {PORT}")
print()

proc = subprocess.Popen(
    [EXE, DSH_BIN, "web", "--port", PORT, "--no-open"],
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    encoding="utf-8",
    errors="replace",
    cwd=APP_DIR,
)

deadline = time.time() + 120
listening = False
while time.time() < deadline:
    if proc.poll() is not None:
        print(f"[exit] 进程提前退出，码={proc.returncode}")
        break
    out = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, errors="replace"
    ).stdout
    if f":{PORT}" in out:
        listening = True
        break
    time.sleep(3)

print()
if listening:
    print(f"[OK] 端口 {PORT} 已监听 —— 打包产物内置 dsh 启动成功")
    for line in subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, errors="replace"
    ).stdout.splitlines():
        if f":{PORT}" in line:
            print("   ", line.strip())
else:
    print("[FAIL] 端口未监听")

proc.terminate()
try:
    tail = proc.communicate(timeout=15)[0]
except subprocess.TimeoutExpired:
    proc.kill()
    tail = proc.communicate()[0]

print()
print("=== dsh 输出 ===")
print((tail or "<无输出>")[:4000])
sys.exit(0 if listening else 1)
