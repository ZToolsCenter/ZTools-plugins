# Native OCR

ZTools 本地多引擎 OCR 插件。支持 macOS Vision / Windows OCR（系统 WinRT）/ ONNX OCR（PP-OCR v4）/ 微信 OCR（macOS）/ 公式识别（LaTeX OCR）五类引擎，内置表格识别、PDF 多页识别、OCR 后翻译、识别历史。

**识别（含公式、图文混排、表格）全部在本地完成，图片不上传任何服务器**；唯二需要联网的是「首次下载模型」与「OCR 后翻译」，详见「[隐私与联网](#隐私与联网)」。

作者：Samson（fork 自官方 `wechat-ocr` 插件，原作者 zing，MIT 协议）

## 引擎

| 引擎 | macOS | Windows | 说明 |
| --- | --- | --- | --- |
| ONNX OCR | ✅ | ✅（默认首选） | PP-OCR v4 模型，约 60MB 一次性下载，离线可用，支持表格识别，无需任何环境 |
| 公式识别 | ✅ | ✅ | RapidLaTeXOCR 模型，约 171MB 一次性下载，把公式图片识别为 LaTeX 代码（依托 ONNX 引擎） |
| 图文混排 | ✅ | ✅ | MFD 模型（pix2text-mfd-1.5.onnx，约 80MB）先定位公式区域，裁切后复用公式引擎识别，再与文本行按阅读顺序合并为 Markdown |
| 系统 OCR | macOS Vision | Windows OCR | 系统内置能力，零依赖；小图自动放大提升识别率 |
| 微信 OCR | ✅ | — | 复用微信自带离线 OCR 运行时（按需从 npmmirror 下载） |

Windows 平台默认展示 ONNX OCR，切换引擎后自动用新引擎重新识别当前图片。

## 功能

- **图片 OCR**：拖入/粘贴/截图，多引擎结果对比（切换引擎自动重识别）
- **公式识别**：公式图片 → LaTeX 代码，**KaTeX 实时预览可视化确认**，源码可直接编辑并即时重渲染，支持 `$…$` / `$$…$$` / `\(…\)` 三种格式一键复制
- **图文混排**：自动检测图片中的公式区域（行内/独立），裁切后识别为 LaTeX，与 OCR 文本行按阅读顺序合并，输出带 `$…$` / `$$…$$` 的 Markdown 与结构化 segments（依托 ONNX 公式引擎 + MFD 模型）
- **表格识别**：行列聚类还原表格，分隔线可拖动/增删，单元格可编辑；可复制/导出 TSV、CSV、Markdown 与 Excel（XLSX）
- **翻译**：识别结果一键翻译（文本/表格双视图），**需联网**（见「[隐私与联网](#隐私与联网)」）
- **识别历史**：本地持久化，可回放、搜索、收藏、删除、清空
- **批量识别**：多图队列，合并复制 / 导出 TXT
- **PDF 多页识别**：批量入口支持拖入 PDF，逐页渲染为图片后按页加入识别队列（条目标注「第 x/y 页」），与图片混合拖入也可用；由 pdfjs 实现，构建产物约 1.6MB 分包、按需加载

## 前置依赖

| 能力 | 依赖 |
| --- | --- |
| 系统 OCR（macOS Vision） | 首次运行会用 `swiftc -O` 把 `bin/ocr-vision.swift` 编译成二进制（按脚本内容指纹缓存，脚本变更后自动重编；编译失败会回退用 `swift` 解释执行）。因此**需要安装 Xcode Command Line Tools**（`xcode-select --install`） |
| 系统 OCR（Windows OCR） | Win10/11 **桌面版**，依赖系统内置的 **Windows PowerShell**（当前实现调用 `powershell.exe`，未适配 PowerShell 7 / `pwsh`）；基于 WinRT OCR，**识别中文需系统安装中文语言包**，在英文版 Windows 上可能不可用或识别质量很差 |
| ONNX OCR / 公式识别 / 图文混排 | 无需额外环境（Electron 自带 Node 子进程）；首次使用需联网下载模型 |
| 微信 OCR | 仅 macOS，复用微信自带离线 OCR 运行时（按需下载） |
| OCR 后翻译 | 需联网 |

## 运行时下载

ONNX OCR、公式识别、图文混排与微信 OCR 运行时不内置在插件包中，首次使用时**需联网**从公开镜像按需下载、校验后缓存到本地（体积合计 300MB+，请预留磁盘空间）：

- ONNX OCR（PP-OCR v4，约 60MB）→ `<ztools.getPath("pluginData")>/native-ocr/onnx-runtime`（插件卸载时自动清理），来源 `registry.npmmirror.com`
- 公式识别（RapidLaTeXOCR，约 171MB）→ `<ztools.getPath("pluginData")>/native-ocr/onnx-runtime/assets/formula`（复用 ONNX 运行环境，需先装 ONNX 引擎），来源 `ghfast.top`（GitHub 加速）
- 图文混排（MFD，约 80MB）→ `<ztools.getPath("pluginData")>/native-ocr/onnx-runtime/assets/mfd`（复用 ONNX 运行环境与公式模型，需先装二者），来源 `hf-mirror.com`
- 微信 OCR（macOS）→ `<ztools.getPath("pluginData")>/native-ocr/ocr-runtime`（插件卸载时自动清理），来源 `registry.npmmirror.com`

插件页头提供两个资源管理入口：**「释放内存」**回收常驻的 ONNX 推理进程（下次识别自动重启）；**「清理 ONNX 模型缓存」**删除已下载的 ONNX 运行环境与全部 ONNX 系模型（约 300MB+，微信 OCR 运行时不受影响），下次使用需重新下载。

## 隐私与联网

**可以放心的部分**

- **识别完全本地**：OCR、公式识别、图文混排、表格识别全部在本地推理，图片不上传任何服务器。
- **原始截图不入持久化存储**：识别历史只把**文本 + 小缩略图**写入 localStorage（有长度上限）；完整原图仅存在内存中供同会话回填，刷新即失。
- 各引擎的临时文件均用 `mkdtempSync` 创建（权限 0700），并在 `finally` 中删除。
- 代码中不存在把图片路径或识别内容写入日志的行为。

**需要联网的两处**

- **模型首次下载**：所有模型运行时不内置，首次使用需从上述公开镜像下载（域名见「运行时下载」）。
- **OCR 后翻译**：翻译调用腾讯交互翻译 `https://transmart.qq.com/api/imt`，会把**识别出的文本**上传到该服务，因此**必须联网、不是离线能力**。若要求完全离线，请勿点击翻译。

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
