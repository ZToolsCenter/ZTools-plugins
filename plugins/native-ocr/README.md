# Native OCR

ZTools 本地多引擎 OCR 插件。支持 macOS Vision / Windows OCR（系统 WinRT）/ ONNX OCR（PP-OCR v4）/ 微信 OCR（macOS）四类引擎，内置表格识别、OCR 后翻译、识别历史。

作者：Samson（fork 自官方 `wechat-ocr` 插件，原作者 zing，MIT 协议）

## 引擎

| 引擎 | macOS | Windows | 说明 |
| --- | --- | --- | --- |
| ONNX OCR | ✅ | ✅（默认首选） | PP-OCR v4 模型，约 60MB 一次性下载，离线可用，支持表格识别，无需任何环境 |
| 系统 OCR | macOS Vision | Windows OCR | 系统内置能力，零依赖；小图自动放大提升识别率 |
| 微信 OCR | ✅ | — | 复用微信自带离线 OCR 运行时（按需从 npmmirror 下载） |

Windows 平台默认展示 ONNX OCR，切换引擎后自动用新引擎重新识别当前图片。

## 功能

- **图片 OCR**：拖入/粘贴/截图，多引擎结果对比（切换引擎自动重识别）
- **表格识别**：行列聚类还原表格，分隔线可拖动/增删，单元格可编辑，导出 TSV/CSV
- **翻译**：识别结果一键翻译（文本/表格双视图）
- **识别历史**：本地持久化，可回放、删除、清空
- **批量识别**：多图队列，合并复制 / 导出 TXT

## 运行时下载

ONNX OCR 与微信 OCR 运行时不内置在插件包中，首次使用时从 npmmirror 下载并校验后缓存到本地：

- ONNX OCR：`<ztools.getPath("pluginData")>/native-ocr/onnx-runtime`（插件卸载时自动清理）
- 微信 OCR（macOS）：`<ztools.getPath("pluginData")>/native-ocr/ocr-runtime`（插件卸载时自动清理）

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物在 `dist/`，README/LICENSE/bin 会自动复制进产物目录。

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 致谢

本项目基于 [ZToolsCenter 官方 wechat-ocr 插件](https://github.com/ZToolsCenter/ZTools-plugins/tree/main/plugins/wechat-ocr) fork 修改（原作者 zing，MIT 协议）。
