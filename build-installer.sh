#!/usr/bin/env bash
# 构建 DeepSeek Harness Browser 安装包（内置 dsh，装完即用）
#
# 依赖投放方式：
#   dsh 的依赖闭包有 400+ 个包，其中大量依赖声明在 peerDependencies 里。
#   electron-builder 的依赖收集器只沿 dependencies 链递归，会静默漏掉这些包，
#   所以 dsh **不放进 dependencies**（那样会被塞进 app.asar，白占约 146MB），
#   而是用 extraResources 把整个 node_modules 作为资源目录投放到
#   resources/dsh-runtime/node_modules，由 server.js 用 process.execPath 运行。
#
#   若 extraResources 因环境原因没投全（闭包校验会报出来），
#   脚本会自动回退到 scripts/stage-dsh-runtime.py 多线程补投。
#
# 用法：
#   bash build-installer.sh          # 完整流程，出 NSIS 安装包
#   bash build-installer.sh --dir    # 只出应用骨架（调试用）
#
# 可选环境变量：
#   PYTHON      指定 python 解释器（默认自动探测 python3 / python / py）
#   MIRROR=0    不使用国内镜像
#
# WorkBuddy/CodeBuddy 沙箱环境额外注意：
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

echo ">>> [0/5] 预检：node_modules 完整性（防残缺包）"
"$PY" scripts/check-node-modules-integrity.py || {
  echo
  echo "!!! node_modules 有残缺，先修复："
  echo "    $PY scripts/repair-node-modules.py"
  exit 1
}

echo
echo ">>> [1/5] 生成应用骨架 -> $OUT"
npx electron-builder --win --dir -c.directories.output="$OUT"

UNPACKED="$OUT/win-unpacked"
DEPS="$UNPACKED/resources/dsh-runtime/node_modules"

# 骨架健康检查：确认图标/版本信息已写入 exe。
# 完整构建的产物才带图标；构建被中断或失败时 exe 会保留 Electron 默认图标，
# 拿它去 --prepackaged 出包会导致装完图标不对（功能却正常，很难发现）。
echo
echo ">>> [2/5] 检查骨架健康度（图标是否写入）"
"$PY" scripts/check-skeleton.py "$UNPACKED"

echo
echo ">>> [3/5] 校验依赖闭包"
if ! node scripts/verify-bundle.mjs "$DEPS"; then
  echo
  echo "!!! extraResources 未投全，回退到多线程补投 ..."
  "$PY" scripts/stage-dsh-runtime.py "$UNPACKED"
  echo
  node scripts/verify-bundle.mjs "$DEPS"
fi

echo
echo ">>> [4/5] 验证内置 dsh 运行时可用（不只是端口在监听）"
"$PY" scripts/verify-dsh-runtime.py "$DEPS" 3077 --expose-internals

echo
echo ">>> [5/5] 生成安装包 -> dist-$STAMP"
npx electron-builder --win nsis --prepackaged "$UNPACKED" -c.directories.output="dist-$STAMP"

echo
echo "=== 完成 ==="
ls -lh "dist-$STAMP"/*.exe 2>/dev/null || echo "（未生成安装包）"
