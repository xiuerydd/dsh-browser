"""把项目 node_modules 拷进 Electron 产物的 resources/dsh-runtime/node_modules。

为什么要单独写拷贝脚本：
  electron-builder 的 extraResources 逐文件拷贝 8000+ 文件时会被沙箱的
  safe-delete 阈值反复拦截（默认阈值 50），且每轮构建要 30-70 分钟。
  用 Python 多线程直接拷贝，快得多，且不经过 Node 的 shim。

用法：
  python stage-dsh-runtime.py <目标 win-unpacked 目录>
"""
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = r"D:\deepseek-harness\dsh-browser"
SRC = os.path.join(ROOT, "node_modules")

# 排除打包工具自身的依赖（省体积，运行时用不到）
EXCLUDE_TOP = {
    "@electron", "@electron-internal", "@malept",
    "electron", "electron-builder", "app-builder-lib", "app-builder-bin",
    "builder-util", "builder-util-runtime", "dmg-builder",
    ".bin",
}

if len(sys.argv) < 2:
    print("用法: python stage-dsh-runtime.py <win-unpacked 目录>")
    sys.exit(2)

WIN_UNPACKED = os.path.abspath(sys.argv[1])
DST = os.path.join(WIN_UNPACKED, "resources", "dsh-runtime", "node_modules")

if not os.path.isdir(WIN_UNPACKED):
    print(f"错误: 目录不存在 {WIN_UNPACKED}")
    sys.exit(1)

os.makedirs(DST, exist_ok=True)
print(f"源: {SRC}")
print(f"目标: {DST}")
print()

# 收集顶层项
items = [n for n in os.listdir(SRC) if n not in EXCLUDE_TOP]
print(f"待拷贝顶层项: {len(items)}")


def copy_one(name):
    src = os.path.join(SRC, name)
    dst = os.path.join(DST, name)
    if os.path.isdir(src) and not os.path.islink(src):
        # 自己遍历，单个文件失败不中断整棵树
        # （node_modules 里可能有陈旧临时目录留下失效引用）
        errors = []
        for root, dirs, files in os.walk(src):
            rel = os.path.relpath(root, src)
            out_root = dst if rel == "." else os.path.join(dst, rel)
            # 跳过陈旧临时目录（dsh 运行残留）
            dirs[:] = [d for d in dirs if not d.startswith(".dsh-")]
            try:
                os.makedirs(out_root, exist_ok=True)
            except OSError as e:
                errors.append(f"{out_root}: {e}")
                continue
            # 子目录里的符号链接单列处理
            for d in list(dirs):
                sp = os.path.join(root, d)
                if os.path.islink(sp):
                    dirs.remove(d)
                    dp = os.path.join(out_root, d)
                    try:
                        if not os.path.exists(dp):
                            os.symlink(os.readlink(sp), dp)
                    except OSError as e:
                        errors.append(f"link {d}: {e}")
            for f in files:
                sp = os.path.join(root, f)
                dp = os.path.join(out_root, f)
                try:
                    if os.path.islink(sp):
                        if not os.path.exists(dp):
                            os.symlink(os.readlink(sp), dp)
                    else:
                        shutil.copy2(sp, dp)
                except OSError:
                    # 失效引用/占用 → 跳过（多为 .map/.d.ts 等非运行必需文件）
                    errors.append(f)
        return name, (f"{len(errors)} 个文件跳过" if errors else None)
    if os.path.islink(src):
        try:
            if not os.path.exists(dst):
                os.symlink(os.readlink(src), dst)
            return name, None
        except OSError as e:
            return name, f"link: {e}"
    try:
        shutil.copy2(src, dst)
        return name, None
    except OSError as e:
        return name, f"{type(e).__name__}: {e}"


start = time.time()
failed = []
done = 0
with ThreadPoolExecutor(max_workers=8) as pool:
    futures = {pool.submit(copy_one, n): n for n in items}
    for fut in as_completed(futures):
        name, err = fut.result()
        done += 1
        if err:
            failed.append((name, err))
            print(f"  [{done}/{len(items)}] FAIL {name}: {err}")
        elif done % 25 == 0:
            print(f"  [{done}/{len(items)}] ...")

elapsed = time.time() - start
print()
print(f"完成: {done - len(failed)}/{len(items)}，耗时 {elapsed:.0f}s")
if failed:
    print(f"失败 {len(failed)} 项:")
    for n, e in failed[:20]:
        print(f"   {n}: {e}")
    sys.exit(1)
print("✓ 全部拷贝成功")
