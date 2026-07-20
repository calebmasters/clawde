#!/usr/bin/env bash
# Build the clod_mac_ax native addon and stage it into resources/native/.
#
# The addon is pure Node-API (ABI-stable across Node and Electron), so a single
# build against the system Node headers loads fine inside Electron — no
# electron-rebuild step needed. resources/** ships with the packaged app
# (asarUnpack'd so the .node file is loadable), and the same path works in dev.
set -euo pipefail

[[ "$(uname)" == "Darwin" ]] || exit 0

cd "$(dirname "$0")/../native/mac-ax"
npx --no-install node-gyp rebuild
mkdir -p ../../resources/native
cp build/Release/clod_mac_ax.node ../../resources/native/clod_mac_ax.node
echo "Built resources/native/clod_mac_ax.node"
