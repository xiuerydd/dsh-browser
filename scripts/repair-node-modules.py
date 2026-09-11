"""定点修复 node_modules 残缺：从 registry 下载原包 tarball，补齐缺失文件。

适用于 npm install 被中断导致的"部分文件丢失"。
比整体重装快得多（秒级 vs 20 分钟），且不动其它已正确的包。

做法：
  1. 用 check-node-modules-integrity.py 找出残缺文件
  2. 定位所属包与其版本
  3. 下载该包 tarball（走 registry.npmmirror.com）
  4. 逐文件比对，补齐所有缺失（不只是 .js.map 暴露出来的那些）

用法：
  python scripts/repair-node-modules.py            # 自动排查并修复
  python scripts/repair-node-modules.py --dry-run  # 只看要补什么
"""
import json
import os
import sys
import tarfile
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODS = os.path.join(ROOT, "node_modules")
REGISTRY = "https://registry.npmmirror.com"
DRY = "--dry-run" in sys.argv


def tarball_url(name, version):
    short = name.split("/")[-1]
    return f"{REGISTRY}/{name}/-/{short}-{version}.tgz"


def pkg_of(rel_path, mods=MODS):
    """从 node_modules 相对路径定位所属包目录（处理嵌套 node_modules）。"""
    parts = rel_path.split(os.sep)
    # 找最后一个 node_modules 之后的两段（含 scope）
    idx = -1
    for i, p in enumerate(parts):
        if p == "node_modules":
            idx = i
    rest = parts[idx + 1:]
    if rest[0].startswith("@"):
        pkg = "/".join(rest[:2])
        pkg_rel = os.path.join(*parts[:idx + 3])
    else:
        pkg = rest[0]
        pkg_rel = os.path.join(*parts[:idx + 2])
    return pkg, os.path.join(mods, pkg_rel)


def main():
    # 找残缺
    broken = []
    for root, dirs, files in os.walk(MODS):
        dirs[:] = [d for d in dirs if d != ".bin"]
        names = set(files)
        for f in files:
            if f.endswith(".js.map"):
                base = f[:-7]
                if not any(base + e in names for e in (".js", ".mjs", ".cjs")):
                    broken.append(os.path.relpath(os.path.join(root, f), MODS))

    if not broken:
        print("✓ 没有发现残缺，无需修复")
        return 0

    # 归类到包
    targets = {}
    for b in broken:
        pkg, pkg_dir = pkg_of(b)
        targets.setdefault((pkg, pkg_dir), []).append(b)

    print(f"发现 {len(broken)} 个残缺文件，涉及 {len(targets)} 个包：")
    for (pkg, _), items in targets.items():
        print(f"  {pkg}  ({len(items)} 个)")
    print()

    total_fixed = 0
    for (pkg, pkg_dir), _items in targets.items():
        pj = os.path.join(pkg_dir, "package.json")
        if not os.path.isfile(pj):
            print(f"[跳过] 找不到 {pj}")
            continue
        with open(pj, encoding="utf-8") as f:
            version = json.load(f).get("version")
        url = tarball_url(pkg, version)
        print(f"[{pkg}@{version}] {url}")

        if DRY:
            continue

        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
        except Exception as e:  # noqa: BLE001
            print(f"   下载失败: {type(e).__name__}: {e}")
            continue
        print(f"   下载 {len(data):,} 字节")

        tmp = tempfile.NamedTemporaryFile(suffix=".tgz", delete=False)
        tmp.write(data)
        tmp.close()

        fixed = []
        try:
            with tarfile.open(tmp.name, "r:gz") as tf:
                members = [m for m in tf.getmembers() if m.isfile()]
                for m in members:
                    rel = m.name
                    if not rel.startswith("package/"):
                        continue
                    inner = rel[len("package/"):]
                    dst = os.path.join(pkg_dir, *inner.split("/"))
                    if os.path.exists(dst):
                        continue
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    src = tf.extractfile(m)
                    if src is None:
                        continue
                    with open(dst, "wb") as out:
                        out.write(src.read())
                    fixed.append(inner)
        finally:
            try:
                os.remove(tmp.name)
            except OSError:
                pass

        print(f"   补齐 {len(fixed)} 个文件")
        for x in fixed[:10]:
            print(f"      + {x}")
        if len(fixed) > 10:
            print(f"      ... 还有 {len(fixed)-10} 个")
        total_fixed += len(fixed)

    print()
    if DRY:
        print("（dry-run，未做修改）")
    else:
        print(f"共补齐 {total_fixed} 个文件")
        print("建议再跑一次 check-node-modules-integrity.py 确认")
    return 0


if __name__ == "__main__":
    sys.exit(main())
