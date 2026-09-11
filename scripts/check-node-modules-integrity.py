"""精确排查 node_modules 残缺：每个 x.js.map 必须对应 x.js。

.js.map 是 JS 的 source map，它存在就说明对应的 .js 本应存在。
这比用 .d.ts 判断精确得多（.d.ts 会误报纯类型目录）。

npm install 被中断时，会留下"source map 在、实现文件不在"的残缺包。
构建期不报错，运行时才炸，症状常常是「服务在监听但接口全 404」。

用法：
  python scripts/check-node-modules-integrity.py [node_modules 路径]
"""
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "node_modules")

if not os.path.isdir(ROOT):
    print(f"目录不存在: {ROOT}")
    sys.exit(2)

broken = []
scanned = 0

for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d != ".bin"]
    names = set(files)
    for f in files:
        if not f.endswith(".js.map"):
            continue
        scanned += 1
        base = f[:-7]           # x.js.map -> x
        if base + ".js" in names or base + ".mjs" in names or base + ".cjs" in names:
            continue
        broken.append(os.path.relpath(os.path.join(root, f), ROOT))

print(f"扫描: {ROOT}")
print(f"检查 .js.map 数量: {scanned}")
print(f"缺少对应实现文件: {len(broken)}")
print()

if not broken:
    print("✓ 未发现残缺（每个 .js.map 都有对应实现）")
    sys.exit(0)

by_pkg = {}
for b in broken:
    parts = b.split(os.sep)
    pkg = "/".join(parts[:2]) if parts[0].startswith("@") else parts[0]
    by_pkg.setdefault(pkg, []).append(b)

print("按包汇总:")
for pkg, items in sorted(by_pkg.items(), key=lambda x: -len(x[1])):
    print(f"  {len(items):>4} 个  {pkg}")
    for it in items[:5]:
        print(f"           {it}")
    if len(items) > 5:
        print(f"           ... 还有 {len(items)-5} 个")

print()
print("修复建议：删掉上述包目录后重新 npm install（或 npm ci）")
sys.exit(1)
