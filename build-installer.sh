#!/usr/bin/env bash
# 构建 DeepSeek Harness Browser 安装包（内置 dsh，装完即用）
#
# 为什么分两段：
#   dsh 的依赖闭包有 400+ 个包，其中大量依赖声明在 peerDependencies 里。
#   electron-builder 的依赖收集器只沿 dependencies 链递归，会静默漏掉这些包，
#   构建成功但运行时报 ERROR_MODULE_NOT_FOUND。所以先用 --dir 出骨架，
#   再用 Python 多线程把完整 node_modules 投放到 resources/dsh-runtime/，
#   最后用 --prepackaged 直接出安装包（跳过文件收集，快得多）。
#
# 用法：
#   bash build-installer.sh          # 完整流程，出 NSIS 安装包
#   bash build-installer.sh --dir    # 只出应用骨架（调试用）
#
# 可选环境变量：
#   PYTHON      指定 python 解释器（默认自动探测 python3 / python / py）
#   MIRROR=0    不使用国内镜像
#
# 本机（WorkBuddy 沙箱）额外注意：
#   若构建中途报 EPERM / EBUSY，先设：
#     export CODEBUDDY_SAFE_DELETE_ENABLED=0
#     export CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000
#   默认阈值 50，单次文件操作超 50 个就拦；且被拦过的目录会锁死，需换新输出目录。
set -euo pipefail

cd "$(dirname "$0")"

# --- 国内镜像（GitHub 直连不通时必需）---
if [ "${MIRROR:-1}" != "0" ]; then
  export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
  export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
fi

# --- 若托管 node 不在 PATH，尝试补上 ---
if ! command -v node >/dev/null 2>&1; then
  for d in "$HOME"/.workbuddy/binaries/node/versions/*/; do
    if [ -x "$d/node.exe" ] || [ -x "$d/node" ]; then
      export PATH="$d:$PATH"
      break
    fi
  done
fi

# --- Python 解释器 ---
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
[ -n "$PY" ] || { echo "错误: 找不到 python，请设置 PYTHON 环境变量"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="out-$STAMP"

if [ "${1:-}" = "--dir" ]; then
  echo ">>> [1/1] 生成应用骨架 -> $OUT"
  npx electron-builder --win --dir -c.directories.output="$OUT"
  echo "=== 完成: $OUT/win-unpacked ==="
  exit 0
fi

echo ">>> [1/4] 生成应用骨架 -> $OUT"
npx electron-builder --win --dir -c.directories.output="$OUT"

UNPACKED="$OUT/win-unpacked"
echo
echo ">>> [2/4] 投放完整依赖闭包到 $UNPACKED/resources/dsh-runtime"
"$PY" scripts/stage-dsh-runtime.py "$UNPACKED"

echo
echo ">>> [3/4] 校验运行时闭包完整性"
node scripts/verify-bundle.mjs "$UNPACKED/resources/dsh-runtime/node_modules"

echo
echo ">>> [4/4] 生成安装包 -> dist-$STAMP"
npx electron-builder --win nsis --prepackaged "$UNPACKED" -c.directories.output="dist-$STAMP"

echo
echo "=== 完成 ==="
ls -lh "dist-$STAMP"/*.exe 2>/dev/null || echo "（未生成安装包）"
