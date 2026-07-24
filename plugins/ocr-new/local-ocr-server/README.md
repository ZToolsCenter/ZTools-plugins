# 本地 OCR 服务

这个服务给插件的 `本地 RapidOCR/PaddleOCR` 引擎使用，默认监听 `http://127.0.0.1:8765/ocr`。

## 安装

```powershell
cd local-ocr-server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 启动

```powershell
python server.py
```

启动后在插件设置里选择 `本地 RapidOCR/PaddleOCR`，Endpoint 保持 `http://127.0.0.1:8765/ocr`。插件内一键启动的服务默认常驻后台，也可在设置页改为退出插件时自动停止。

如果插件包含 `local-ocr-runtime` 内置运行时，则不需要 Python，设置页会显示运行时已内置。没有内置运行时时，插件设置页会提示先安装 Python；不想安装 Python 时，可改用 OCR.Space、百度、腾讯等云端 OCR。

## 接口

```http
POST /ocr
Content-Type: application/json

{
  "image": "data:image/png;base64,...",
  "language": "chi_sim+eng"
}
```

返回：

```json
{
  "ok": true,
  "text": "识别结果"
}
```