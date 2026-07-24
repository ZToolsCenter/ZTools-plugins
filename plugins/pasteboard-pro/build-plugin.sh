#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')

if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "PasteboardPro build requires Node.js 20 or newer" >&2
  exit 1
fi

HELPER="$ROOT/apps/ztools/native/vision-helper/dist/pasteboard-vision"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "PasteboardPro contains a macOS native helper and must be built on macOS" >&2
  exit 1
fi

"$ROOT/apps/ztools/native/vision-helper/build.sh"
codesign --force --sign - "$HELPER"
codesign --verify --strict "$HELPER"
chmod +x "$HELPER"

corepack pnpm@9.15.9 install --frozen-lockfile
corepack pnpm@9.15.9 test
corepack pnpm@9.15.9 test:contract
corepack pnpm@9.15.9 typecheck
corepack pnpm@9.15.9 --filter @pasteboard-pro/ztools typecheck
corepack pnpm@9.15.9 --filter @pasteboard-pro/ztools build
