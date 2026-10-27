#!/bin/sh
# Builds the D3D12 compile proxy's tools (scripts/d3d12-compile-proxy.ts): Tint and DXC from the Dawn branch of the
# installed Chrome (chromium/<build>: Chrome 156.0.8078 → chromium/8078), in ~/.cache/bh-d3d12. ~30–60 min the first
# time (DXC is a whole LLVM); a few GB. macOS or Linux; cmake, ninja, python3, git.
#
#   sh scripts/setup-d3d12-proxy.sh            the installed Chrome's branch (or 8078)
#   BRANCH=8100 sh scripts/setup-d3d12-proxy.sh
set -e
DIR="${HOME}/.cache/bh-d3d12"
if [ -z "$BRANCH" ]; then
  V=$(defaults read "/Applications/Google Chrome.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || google-chrome --version 2>/dev/null | grep -o '[0-9.]*' || echo "0.0.8078.0")
  BRANCH=$(echo "$V" | cut -d. -f3)
fi
mkdir -p "$DIR"
cd "$DIR"
if [ ! -d dawn ]; then
  git clone --depth 1 --branch "chromium/$BRANCH" https://dawn.googlesource.com/dawn
fi
cd dawn
python3 tools/fetch_dawn_dependencies.py
cmake -S . -B out -G Ninja -DCMAKE_BUILD_TYPE=Release -DDAWN_USE_BUILT_DXC=ON -DTINT_BUILD_CMD_TOOLS=ON \
  -DTINT_BUILD_HLSL_WRITER=ON -DTINT_BUILD_TESTS=OFF -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF \
  -DDAWN_BUILD_PROTOBUF=OFF -DTINT_BUILD_IR_BINARY=OFF -DDAWN_FETCH_DEPENDENCIES=OFF
ninja -C out tint dxc dxcompiler
echo "tools: $DIR/dawn/out/tint $DIR/dawn/out/dxc (Dawn chromium/$BRANCH)"
