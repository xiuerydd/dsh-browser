"""模拟用户双击：用干净环境启动已安装的应用，验证它能自动拉起内置 dsh。

关键：PATH 里**不含**托管 node 目录，所以 server.js 的 PATH 遍历找不到系统 dsh，
必然走 bundled 分支 —— 这正是"装完直接用、无需另装 dsh"要证明的路径。

用法：
  python verify-installed-app.py [端口]
"""
import os
import subprocess
import sys
import time

PORT = sys.argv[1] if len(sys.argv) > 1 else "3080"
APP = r"C:\Users\灵\AppData\Local\Programs\dsh-browser\DeepSeek Harness Browser.exe"

if not os.path.isfile(APP):
    print(f"错误: 找不到 {APP}")
    sys.exit(1)

# 清孤儿锁
subprocess.run(
    ["cmd", "/c", "del", "/f", "/q",
     os.path.expanduser(r"~\.dsh\profiles\node_modules.lock")],
    capture_output=True,
)

# 干净环境：PATH 故意不含托管 node 目录，排除 NODE_OPTIONS
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
env = {k: v for k, v in KEEP.items() if v}

print(f"应用: {APP}")
print(f"端口: {PORT}")
print("环境: 干净（PATH 无托管 node 目录，无 NODE_OPTIONS）")
print()

proc = subprocess.Popen(
    [APP],
    env=env,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    cwd=os.path.dirname(APP),
)

print("已启动，等待服务监听 ...")
deadline = time.time() + 150
listening = False
while time.time() < deadline:
    if proc.poll() is not None:
        print(f"[exit] 应用提前退出，码={proc.returncode}")
        break
    out = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, errors="replace"
    ).stdout
    if f":{PORT}" in out:
        listening = True
        break
    time.sleep(4)

print()
if listening:
    print(f"[OK] 端口 {PORT} 已监听 —— 已安装应用自动拉起了内置 dsh")
    for line in subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, errors="replace"
    ).stdout.splitlines():
        if f":{PORT}" in line:
            print("   ", line.strip())
    print()
    print("窗口标题:", end=" ")
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-Process -Name 'DeepSeek Harness Browser' -ErrorAction SilentlyContinue | "
         "Where-Object {$_.MainWindowTitle} | Select-Object -First 1).MainWindowTitle"],
        text=True, errors="replace",
    )
else:
    print(f"[FAIL] 端口 {PORT} 未监听")

# 收尾：关掉应用
subprocess.run(
    ["taskkill", "/F", "/T", "/IM", "DeepSeek Harness Browser.exe"],
    capture_output=True,
)
print()
print("已关闭应用")
sys.exit(0 if listening else 1)
