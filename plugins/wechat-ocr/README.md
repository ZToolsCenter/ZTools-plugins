# 微信 OCR

ZTools 插件，用于通过本地微信 OCR 运行时识别图片文字。

## 运行时

插件包不再内置较大的 `ocr-runtime` 文件。进入界面时会检查本地是否已安装 OCR 运行时，如果缺失或版本落后，会从 npmmirror 获取 `@ztools-center/wechat-ocr-native` 的最新版本并下载对应 tgz 包。

下载完成后，插件会解包 tgz 中的 `package/dist` 目录，并把其中内容作为本地 OCR 运行时缓存使用。

默认缓存目录：

```text
~/Library/Application Support/ZTools/wechat-ocr/ocr-runtime
```

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建后，`README.md` 会复制到 `dist/README.md`。
