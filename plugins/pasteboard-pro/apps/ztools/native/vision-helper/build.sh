#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$ROOT/dist"

xcrun swiftc \
  -O \
  -framework Foundation \
  -framework ImageIO \
  -framework UniformTypeIdentifiers \
  -framework Vision \
  "$ROOT/main.swift" \
  -o "$ROOT/dist/pasteboard-vision"
