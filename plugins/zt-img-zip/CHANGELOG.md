# Changelog

## v0.1.4 - 2026-06-08

- 恢复 `sharp` 图片处理管线，重新支持 JPEG、PNG、WebP、AVIF、TIFF 输出。
- 构建时将 `sharp` 生产依赖安装到 `dist/preload/node_modules`，确保 ZTools 安装插件包后可直接加载 native module。
- preload 优先从插件包内置依赖加载 `sharp`，本地开发时回退到项目根依赖。

## v0.1.3 - 2026-06-08

- 移除运行时 `sharp` 依赖，改用 Chromium 内置图片解码和 Canvas 编码，避免 ZTools 安装市场插件后找不到 native module。
- 输出格式调整为 JPEG、PNG、WebP，确保插件包解压后无需额外安装依赖即可运行。

## v0.1.2 - 2026-06-07

- 首次发布图片压缩插件。
- 支持拖入、选择、粘贴图片后批量压缩。
- 支持 JPEG、PNG、WebP、AVIF、TIFF 格式输出。
- 支持质量调节、另存为和确认后覆盖原图。
- 保存对话框默认定位到系统下载文件夹。
- 修复 PNG 默认启用调色板量化的问题，避免非预期有损输出。
- 覆盖原图时采用临时文件和原子替换，失败时清理临时文件。
- 使用图片 metadata 识别真实输入格式，减少后缀不匹配导致的错误。
- 压缩运行期间禁用移除按钮，避免结果状态残留。
