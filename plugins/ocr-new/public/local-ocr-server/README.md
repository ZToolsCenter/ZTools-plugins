# 本地 OCR 服务

这个服务给插件的 `本地 RapidOCR/PaddleOCR` 引擎使用，默认监听 `http://127.0.0.1:8765/ocr`。

安装到 ZTools 后，可在插件设置页点击 `一键安装`、`启动服务` 和 `停止服务`，也可以选择退出插件时自动停止。

如果插件包含 `local-ocr-runtime` 内置运行时，则不需要 Python。没有内置运行时时，先安装 Python，或改用 OCR.Space、百度、腾讯等云端 OCR。

手动启动：

```powershell
python server.py
```