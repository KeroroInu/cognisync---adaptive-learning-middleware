#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
trap 'echo "如有错误，请把窗口给老师看；不要反复安装。"; read -r -p "按回车关闭"' EXIT
arch=$(uname -m)
case "$arch" in
  arm64) digest=61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6 ;;
  x86_64) arch=x64; digest=58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026 ;;
  *) echo "暂不支持这台电脑的处理器"; exit 1 ;;
esac
dir=".runtime/node-v22.23.2-darwin-$arch"
if [ ! -x "$dir/bin/node" ]; then
  mkdir -p .runtime
  curl --fail --location --retry 2 --max-time 300 "https://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-$arch.tar.gz" -o .runtime/node.tar.gz
  actual=$(shasum -a 256 .runtime/node.tar.gz | cut -d ' ' -f 1)
  [ "$actual" = "$digest" ] || { echo "下载校验失败，请联系老师"; exit 1; }
  tar -xzf .runtime/node.tar.gz -C .runtime
fi
export PATH="$PWD/$dir/bin:$PATH"
node bootstrap.mjs
