#!/usr/bin/env bash
#
# 下载 Pyodide 运行时到 frontend/public/pyodide/，供同源加载。
#
# 为什么不用 CDN：建构阶段的模块测试完全依赖 Pyodide 在浏览器里跑 Python。
# 原实现从 cdn.jsdelivr.net 加载，在国内课堂环境下经常极慢甚至连不上，
# 一个班 40–50 人同时首次加载更会放大这个问题。改为同源自托管后，
# 资源随前端镜像分发，学生只走内网/本站带宽。
#
# 为什么用 pyodide-core 而不是完整包：
#   pyodide-0.27.0.tar.bz2       333 MB（含 numpy/scipy 等全部科学计算包）
#   pyodide-core-0.27.0.tar.bz2  5.6 MB（仅 CPython 运行时 + 标准库）
# 学生代码是纯 Python（列表、条件、循环），不需要任何第三方包，core 足够。
#
# 幂等：文件齐全时直接跳过，重复构建不会重新下载。
#
# 环境变量：
#   PYODIDE_VERSION   默认 0.27.0，必须与前端代码中的路径版本一致
#   PYODIDE_BASE_URL  下载源。GitHub 慢时可指向内网镜像，例如
#                     PYODIDE_BASE_URL=https://mirror.example.com/pyodide

set -euo pipefail

VERSION="${PYODIDE_VERSION:-0.27.0}"
BASE_URL="${PYODIDE_BASE_URL:-https://github.com/pyodide/pyodide/releases/download/${VERSION}}"
ARCHIVE="pyodide-core-${VERSION}.tar.bz2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${SCRIPT_DIR}/../public/pyodide"

# loadPyodide 启动时按需拉取这几个文件，缺一不可。
REQUIRED_FILES=(
  pyodide.js
  pyodide.asm.js
  pyodide.asm.wasm
  python_stdlib.zip
  pyodide-lock.json
)

all_present() {
  for f in "${REQUIRED_FILES[@]}"; do
    [ -s "${TARGET_DIR}/${f}" ] || return 1
  done
  return 0
}

if all_present; then
  # 即便跳过下载也要修权限：文件可能是随代码库打包上传的，
  # 带着打包机的严格权限位，nginx 读不到会 403。
  chmod -R a+rX "${TARGET_DIR}" 2>/dev/null || true
  echo "✅ Pyodide ${VERSION} 已就绪，跳过下载（${TARGET_DIR}）"
  exit 0
fi

echo "⬇️  下载 Pyodide ${VERSION} 运行时（约 5.6 MB）…"
echo "    源：${BASE_URL}/${ARCHIVE}"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

# node:20-alpine 默认没有 curl，busybox 提供 wget；macOS 自带 curl 没有 wget。
# 两者都试一遍，避免为此在镜像里多装一个包。
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --retry 3 --retry-delay 2 "${BASE_URL}/${ARCHIVE}" -o "${TMP_DIR}/${ARCHIVE}"
elif command -v wget >/dev/null 2>&1; then
  wget -q -t 3 "${BASE_URL}/${ARCHIVE}" -O "${TMP_DIR}/${ARCHIVE}"
else
  echo "❌ 需要 curl 或 wget 才能下载 Pyodide" >&2
  exit 1
fi

# 归档内是一个 pyodide/ 目录。
tar -xjf "${TMP_DIR}/${ARCHIVE}" -C "${TMP_DIR}"

if [ ! -d "${TMP_DIR}/pyodide" ]; then
  echo "❌ 归档结构与预期不符，未找到 pyodide/ 目录" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"
cp -R "${TMP_DIR}/pyodide/." "${TARGET_DIR}/"

# 放开读权限。
#
# 这些文件最终由生产镜像里的 nginx（以 nginx 用户运行）直接对外提供。
# 若打包机的 umask 较严（例如 077），解压/复制后会是 rw-------，属主 root，
# nginx worker 读不到，请求 .wasm 会得到 403 Permission denied——
# 表现为学生在建构阶段永远卡在「正在加载 Python 环境」。
chmod -R a+rX "${TARGET_DIR}"

# 校验：下载成功但文件不全会让学生在建构阶段卡住且看不到原因，
# 宁可在构建期就失败。
missing=()
for f in "${REQUIRED_FILES[@]}"; do
  [ -s "${TARGET_DIR}/${f}" ] || missing+=("${f}")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "❌ 以下必需文件缺失或为空：${missing[*]}" >&2
  exit 1
fi

echo "✅ Pyodide ${VERSION} 已安装到 ${TARGET_DIR}（$(du -sh "${TARGET_DIR}" | cut -f1)）"
