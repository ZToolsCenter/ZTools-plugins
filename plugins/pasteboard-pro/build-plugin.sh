#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')

if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "PasteboardPro build requires Node.js 20 or newer" >&2
  exit 1
fi

HELPER="$ROOT/apps/ztools/native/vision-helper/dist/pasteboard-vision"
if [ "$(uname -s)" = "Darwin" ]; then
  "$ROOT/apps/ztools/native/vision-helper/build.sh"
  codesign --force --sign - "$HELPER"
  codesign --verify --strict "$HELPER"
  chmod +x "$HELPER"
else
  echo "非 macOS 构建跳过 Vision helper，运行时使用 Tesseract OCR"
fi

corepack pnpm@9.15.9 install --frozen-lockfile
corepack pnpm@9.15.9 test
corepack pnpm@9.15.9 test:contract
corepack pnpm@9.15.9 typecheck
corepack pnpm@9.15.9 --filter @pasteboard-pro/ztools typecheck
corepack pnpm@9.15.9 --filter @pasteboard-pro/ztools build
