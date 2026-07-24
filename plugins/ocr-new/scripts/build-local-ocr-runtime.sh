#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
RUNTIME_DIR="$PROJECT_DIR/public/local-ocr-runtime/$PLATFORM/rapidocr-server"
SERVER_SRC="$PROJECT_DIR/local-ocr-server"
BUILD_DIR="$PROJECT_DIR/.runtime-build"

echo "=== 构建 RapidOCR 运行时：$PLATFORM ==="

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "[1/4] 创建 Python 虚拟环境 ..."
python3 -m venv "$BUILD_DIR/.venv"
source "$BUILD_DIR/.venv/bin/activate"

echo "[2/4] 安装依赖 ..."
pip install --upgrade pip
pip install rapidocr>=3.8.1 onnxruntime>=1.18.0 pyinstaller

echo "[3/4] PyInstaller 打包 ..."
pyinstaller \
  --onedir \
  --name rapidocr-server \
  --add-data "$(python -c "import rapidocr; print(rapidocr.__path__[0])")"/models:rapidocr/models \
  --hidden-import rapidocr_onnxruntime \
  --hidden-import rapidocr \
  --hidden-import onnxruntime \
  --hidden-import onnxruntime.capi \
  --hidden-import cv2 \
  --hidden-import numpy \
  --hidden-import PIL \
  --hidden-import PIL.Image \
  --hidden-import pyclipper \
  --hidden-import shapely \
  --noconsole \
  "$SERVER_SRC/server.py"

deactivate

echo "[4/4] 复制产物到 $RUNTIME_DIR ..."
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"
cp -r "$BUILD_DIR/dist/rapidocr-server/"* "$RUNTIME_DIR/"

echo ""
echo "=== 构建完成 ==="
echo "产物路径: $RUNTIME_DIR"
echo "平台: $PLATFORM"
echo ""
echo "提示：将此目录随插件一起分发，ZTools 会自动加载当前平台的运行时。"
