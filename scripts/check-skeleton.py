"""检查应用骨架是否健康：exe 里有没有写入自定义图标。

为什么需要：图标、版本信息是在 electron-builder 流程**后段**由
`signAndEditResources` → `editWindowsResources` 写入 exe 的。
如果用被中断 / 失败的构建产物去 `--prepackaged` 出安装包，
exe 会保留 Electron 默认图标 —— 功能全部正常，只有图标是错的，很容易漏掉。

注意：不能靠文件大小判断（图标是替换已有资源，大小可能完全不变），
必须做二进制指纹比对。

用法：
  python scripts/check-skeleton.py <win-unpacked 目录> [--ico <ico 路径>]
  退出码 0 = 健康；1 = 缺失图标
"""
import os
import struct
import sys

if len(sys.argv) < 2:
    print("用法: python scripts/check-skeleton.py <win-unpacked 目录> [--ico <ico 路径>]")
    sys.exit(2)

APP_DIR = os.path.abspath(sys.argv[1])

# 允许自定义 ICO 路径
ico_arg = None
if "--ico" in sys.argv:
    ico_arg = sys.argv[sys.argv.index("--ico") + 1]

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICO = ico_arg or os.path.join(project_root, "assets", "icons", "dsh-browser.ico")

# 找主 exe（win-unpacked 下最大的那个 .exe）
exes = [
    os.path.join(APP_DIR, f)
    for f in os.listdir(APP_DIR)
    if f.lower().endswith(".exe")
]
if not exes:
    print(f"[FAIL] {APP_DIR} 下没有 exe")
    sys.exit(1)
exe = max(exes, key=os.path.getsize)

if not os.path.isfile(ICO):
    print(f"[FAIL] 图标文件不存在: {ICO}")
    sys.exit(1)

# 解析 ICO 取各尺寸图像数据（ICO 内通常原样存 PNG）
data = open(ICO, "rb").read()
count = struct.unpack_from("<H", data, 4)[0]
fingerprints = []
for i in range(count):
    off = 6 + i * 16
    _w, _h, _c, _r, _p, _b, size, imgoff = struct.unpack_from("<BBBBHHII", data, off)
    fingerprints.append(data[imgoff:imgoff + size])

blob = open(exe, "rb").read()
hits = sum(1 for fp in fingerprints if blob.find(fp) >= 0)

print(f"exe : {os.path.basename(exe)}  ({len(blob):,} 字节)")
print(f"ico : {os.path.basename(ICO)}  ({len(fingerprints)} 张图像)")
print(f"匹配: {hits}/{len(fingerprints)}")

if hits == 0:
    print()
    print("[FAIL] exe 里没有自定义图标 —— 骨架不完整（可能构建被中断/失败）")
    print("       用完整成功的构建产物重做骨架，再走 --prepackaged")
    sys.exit(1)

print()
print("[OK] 骨架健康：图标已写入")
sys.exit(0)
