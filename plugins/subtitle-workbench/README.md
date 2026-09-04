# 字幕工坊

一个本地优先的字幕剪辑台：导入 SRT/VTT，编辑、查找替换、平移时间、按速度换算并导出。质检会标出重叠、倒序、时长异常、阅读速度和空文本。

媒体轨道提取只会在宿主提供 runFFmpeg 能力时调用；首版不携带 FFmpeg。Python whisper 与 whisper.cpp 的命令方言不同，v0.1 不探测 PATH、也不运行转写二进制；不会上传媒体或伪造转写结果。

## 验证

`npm test && npm run build`

已验证 SRT/VTT 转换、三端路径形态、渲染安全、生命周期清理、源码与产物一致性，以及 Chromium 渲染。构建会递归统计未压缩的 `dist` 目录，打印精确字节数，并在超过 14.5 MB（14,500,000 字节）时失败。Windows、macOS、Linux 的真实 ZTools 宿主加载、宿主对话框及宿主提供的 FFmpeg 执行仍未验证。

保存通过系统保存对话框确认目标；若用户选择已有普通文件，原子重命名（`rename`）会以该确认作为覆盖授权，符号链接目标会被拒绝。

音轨提取先写同目录随机临时 WAV，成功后才提升为最终文件；已有最终文件会先保留备份，并在提升失败时回滚。Windows 上该覆盖不是单一步骤原子替换，但旧文件会保留到新文件提升成功。由于 FFmpeg 无法使用已打开的输入文件描述符执行，首版会在启动前后复核路径身份；同账户恶意并发替换仍是平台级边界，不能宣称完全无竞态。

导出为 SRT 会规范化字幕并丢弃 VTT 专属的 STYLE、REGION 与 NOTE 文档块；保留 VTT 时这些元数据会随时间变换保留。

## Agent / MCP

ZTools 2.4+ 可把本插件同时提供给人和 Agent。清单短名 `analyze`、`transform`、`analyze_approved_file` 会由宿主分别暴露为 `subtitle_workbench_analyze`、`subtitle_workbench_transform`、`subtitle_workbench_analyze_approved_file`。旧宿主没有 `registerTool` 时只保留原有界面，不影响人工使用。

- `analyze` 对内联 SRT/VTT 做确定性质检，返回字幕条目数、时长、全量问题计数与最多 200 条分页问题；`hasMore` 和 `nextOffset` 可用于无重漏地继续读取。
- `transform` 仅做纯计算的 shift / speed / fps / convert，既不保存文件，也不调用 FFmpeg 或转写能力；无法放入响应预算的转换结果会被稳定拒绝。
- `analyze_approved_file` 只读取人类最近在界面中选择的字幕授权，不接受路径或 grant ID；它适合分析最多 15 MiB 的字幕，但仍只返回分页统计。选择时会通过只读文件描述符执行身份前后复验并建立 SHA-256 摘要；分析时再次在同一描述符上复验 `dev`、`ino`、`size`、`mtime`、`ctime` 和内容摘要。任一替换或重写都会撤销授权。

ZTools MCP 请求体上限为 1 MiB，因此两个内联工具把 UTF-8 输入收紧到 512 KiB，且所有工具的完整 JSON 序列化响应都有 512 KiB 硬上限。该上限按转义后的实际字节计算，避免控制字符把约 512 KiB 的转换文本膨胀成约 3.1 MB 响应。所有处理器会再次拒绝未知字段、`Symbol`、访问器、污染原型、非法格式、越界阈值和数值；`inputSchema` 不是安全校验的替代品。已授权字幕失效时会立即撤销授权并返回不含路径或原始内容的稳定错误，授权和读取使用的文件描述符都会关闭。Agent 只能提出或执行确定性转换，不能覆盖质检结果，也不能借此访问保存、媒体、FFmpeg 或转写接口。

人工界面、文件对话框标题、运行状态、错误提示和质检问题说明均使用简体中文；MCP 工具名、错误码、字段名和协议值保持稳定。
