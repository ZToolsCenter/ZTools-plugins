# Office 文档

## 适用

- 用户上传了 Word / Excel / PowerPoint / PDF，需要阅读或基于内容改写。
- 用户要求生成或修订 `.docx` / `.xlsx` / `.pptx` 并下载。
- 非所见即所得编辑：先解析为文本，再生成新文件。

## 工具

- `parseOffice`：解析上传内容（`contentBase64`）或工作区路径（`path`）为纯文本。
- `writeDocx`：按段落/标题块生成 Word（`blocks` 或 `content`）。
- `writeXlsx`：按多表/行列生成 Excel（`sheets` 或 `rows`）。
- `writePptx`：按幻灯片列表生成 PowerPoint（`slides`）。

## 选择

- Composer 已注入附件正文时，可直接改写，不必重复 `parseOffice`。
- 仅工作区路径、无上传内容时用 `parseOffice` + `path`。
- 复杂交互演示或架构可视化优先 `showHtml` / `showDiagram`，不要用 PPT 硬画。

## 输出

- 生成成功后工具结果含可下载二进制；对话里只需一句说明，勿贴 base64。
- 有工作区且用户要求落盘时传 `savePath`（相对工作区路径）。
- 数据不足时先说明，不编造表格行或幻灯片要点。
