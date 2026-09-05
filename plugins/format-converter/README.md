# 格式转换

面向 ZTools 的本地批量格式转换中心。支持 Word、Excel、PowerPoint、PDF、图片、文本和常见数据格式，并明确区分视觉保真、可编辑重建和内容提取三类路线。

## ZTools 兼容性

- ZTools 3.2.0：支持截图导入、转换输出外拖，并将可重建 runtime 优先放入 `pluginData`。
- ZTools 2.4–3.1：继续使用原 `userData` runtime、文件选择和打开目录流程。3.2 首次启动会校验迁移 runtime 并删除旧副本。
- runtime 迁移为复制后保留旧目录，不会在升级时删除旧数据，支持临时降级宿主。
- 低于 2.4.0，或真实 ZTools 宿主无法提供可比较版本号：显示升级提示。仅未注入 `window.ztools` 的浏览器开发预览放行。

## 首发范围

- 图片：PNG、JPEG、WebP、AVIF、TIFF、GIF、BMP 的读取与常见格式输出。
- 文本与数据：TXT、Markdown、HTML、CSV、TSV、JSON 互转。
- PDF：文本提取、逐页图片、图片合成 PDF、拆分/合并基础能力。
- Office：DOCX/XLSX/PPTX 文本与 HTML 提取、PDF/图片导出，以及文本、图片、PDF向 Office 的重建。
- 批量作业：逐项状态、取消、失败重试、冲突策略和转换报告。
- MCP：转换规划、执行和作业查询工具。

某些路线依赖按需转换引擎、OfficeCLI、Chrome/Edge/Chromium 或 LibreOffice。插件会先做能力预检，不会把缺失依赖伪装成转换成功。

## 零终端按需安装

插件市场包只包含 UI、可审核 Preload 和基础文本编码库，发布体积低于 EdgeOne 的 15 MB 限制。图片、PDF、OCR 与 Excel 引擎首次使用时会显示安装确认：

- 图片引擎：Sharp 与当前系统对应的原生载荷。
- PDF 引擎：PDF.js 与 pdf-lib。
- OCR：Tesseract.js，以及中英文模型；模型随 OCR 引擎从国内镜像一次安装，识别时不再访问外网。
- Excel 引擎：ExcelJS 与工作簿依赖。

安装器不调用终端或依赖本机 npm。它读取仓库内由 `package-lock.json` 生成的固定清单，优先从 npmmirror 下载 tarball，失败后回退 npm 官方源；每个包通过 SRI/SHA-512 校验后才安全解压到 ZTools 3.2 的插件专属 `pluginData/runtime/v1`，旧宿主使用 `userData/format-converter/runtime/v1`。压缩包中的绝对路径、路径穿越、符号链接和设备文件都会被拒绝，写入采用临时目录与原子替换。

## 开发

```bash
npm install
npm test
npm run test:integration
npm run build
```

发布物位于 `dist/`。`npm run build` 会检查运行时锁定清单是否最新，并在打包失败时阻止超过 15 MB 的产物。preload 保持可审核结构，不压缩或混淆。

## 跨平台交付

同一个轻量插件包支持 macOS、Windows 和 Linux。按需安装器只选择当前平台、CPU 与 Linux libc 匹配的 Sharp 载荷；PDF.js 在 ZTools 中复用 Chromium Canvas。平台二进制和纯 JavaScript 引擎均由固定版本与完整性摘要约束，不接受 renderer 或 MCP 传入下载地址、包名和安装目录。
