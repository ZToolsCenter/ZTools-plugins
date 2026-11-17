# ZTools 原生宿主验收

日期：2026-10-21（America/Los_Angeles）。设备：本机 macOS ARM64。ZTools 3.2.0，插件版本 0.1.0。

适用范围：本文宿主检查对应 Harness 更新前的包。后续分块与任务运行器更新完成了工程和真实本地模型检查，但本轮 ZTools 窗口连接超时，最新包未重新导入原生宿主；详见 [Harness 验收](./harness-ai-acceptance.md)。

本记录保留首次安装的历史证据，并补充托盘发起的真实宿主重启、最新 ZIP 覆盖安装、配置恢复和原生富文本检查。首次 ZIP 的哈希只代表历史包，不代表最终文档重包后的产物。

## 历史首次安装记录

首次从 ZTools 设置“导入本地插件”安装 `release/live-markdown-0.1.0.zip`，宿主显示“插件安装成功”。从安装完成页打开后，实际页面为 `file:///Users/harris/.ztools/plugins/live-markdown/index.html`。该历史包安装目录与当时 `dist/` 的 43 个文件全部匹配，无缺失或差异。

- 历史 ZIP SHA-256：`076a814671b85a8019fd639832d1bd1bb852468503ae07cd86c9cc40301e487f`；压缩 530,972 字节，解压 1,740,631 字节。
- 首装过程完成普通网络 0.6B 下载、校验、安装、启动和实际推理自检，总下载 412,828,122 字节；未使用 DNS 绕行。
- 开发者工具项目配置、重载和“刷新成功”提示均已检查。

该哈希和 43 文件比对仅作为首装历史，不应与下述最新包混用。

## 原生功能与重启复验

第一次安装后的原生功能实测包括：首次润色进入模型选择；显示 macOS ARM64、可用内存和三档模型建议；准备期间可继续编辑且不会自动改写变化中的稿件；未选区时处理完整未保存缓冲；确认后写入并支持一次 Cmd+Z；精确选区只改选中内容；文档变化后禁用过期预览；不完整 Markdown 围栏被拒绝；原生保存对话框可用。

同一安装阶段还验证了内置 Skills 的只读保护，自定义 Skill 新增和编辑，HTTP MCP 初始化、工具发现及真实调用，自定义 MCP 改名和禁用，内置服务不可删除，以及工具插入预览取消后不写入。MCP 服务仅监听 `127.0.0.1`，没有真实凭据。

之后使用系统托盘菜单执行 ZTools 的真实退出和重启。主进程从 PID `18085`（Oct 15）变为 PID `63065`（Oct 21），确认跨进程重启。

重启后，在发行页 `file:///Users/harris/.ztools/plugins/live-markdown/index.html` 检查到：

- 已选模型仍为 Qwen3 0.6B Q4_K_M。
- 自定义 Skill“宿主验收临时技能”的名称、描述、系统提示词和模板均恢复。使用它处理独立短稿时，真实 0.6B 给出轻微润色预览，`const answer = 42` 保持不变；取消预览后未写入。
- 自定义 HTTP MCP“宿主验收 HTTP MCP 已编辑”的 endpoint `http://127.0.0.1:52908/mcp` 和 disabled 状态恢复。

随后只通过产品 UI 删除该临时 Skill 和该自定义 MCP，内置项保留。重载插件后，被删除的测试项没有复现；删除后没有再做第二次完整 ZTools 进程重启，因此删除状态跨第二次进程重启尚未验证。

## 最新包覆盖安装与文件完整性

停止旧插件后，从本地导入最新 ZIP；ZTools 显示安装成功。安装目录仍为 `file:///Users/harris/.ztools/plugins/live-markdown/index.html`。安装后的 45 个文件与发行 `dist/` 逐字匹配：零缺失、零差异、零额外文件。

- 最新发行 JavaScript：`dist/assets/index-my9TyJrh.js`，SHA-256 `6044c5e9c65638f0b36358713752c1054476101118f22fa21febd6447423b1c9`。
- ZIP 自身哈希及逐文件完整性记录见 [`latest-install-integrity.json`](../.cache/acceptance/native-host/latest-install-integrity.json)。本说明不抄录最新 ZIP 哈希，避免文档变更重包后形成自引用。
- 新插件实例仍保留 0.6B 选择；删除测试 Skill/MCP 后插件重载没有使其复现。该项是插件重载观察，不是第二次宿主进程重启。

## 最新原生富文本和撤销验证

独立原生测试稿 [`native-rich-input.md`](../.cache/acceptance/native-host/native-rich-input.md) 覆盖 emoji、任务清单、含转义竖线和行内代码的三列表格、行内及单行 `$$` 公式、Mermaid flowchart 和正文。

- 实时视图中表格结构和图表显示正常；公式可识别，但 `\bar{x}`、求和上下标等数学排版仍为 partial，不能按完整 LaTeX 视觉正确处理。
- 对全文提出定向改句后，0.6B 保留表格、公式、代码及图表等受保护结构，但删掉了第一段并把结尾句号改成 ASCII `.`；内容任务判失败。该输出保存在 [`native-rich-ai-applied.md`](../.cache/acceptance/native-host/native-rich-ai-applied.md)。
- 仅在这份独立测试稿上确认写回。随后按 live → source → reading → live 切换，一次 Cmd+Z 并保存，恢复结果 [`native-rich-after-undo.md`](../.cache/acceptance/native-host/native-rich-after-undo.md) 与原始 479 字节输入逐字节一致，SHA-256 同为 `92c431be34bbaa63d104e493b7361542c5e91c8ca6919ff2963d305bd31b8b21`。

另做一次确定性的原生图表插入检查：光标位于文首时，通过内置 MCP `get_diagram_template(architecture)` 实际取得 `graph LR`（UI → Engine → State → IO），产品先显示文首插入预览；确认后流程图显示在正文中，磁盘源码精确等于该图表、两个换行和原 479 字节稿件，原文 suffix 逐字相同。再按 live → source → reading → live 切换，一次 Cmd+Z 并保存，恢复稿 [`native-mcp-diagram-after-undo.md`](../.cache/acceptance/native-host/native-mcp-diagram-after-undo.md) 与原文一致；插入后源码见 [`native-mcp-diagram-applied.md`](../.cache/acceptance/native-host/native-mcp-diagram-applied.md)。这是内置 MCP 确定性工具调用，不计为模型推理或 AI 语义质量通过。

## 未覆盖范围

- 本轮没有在 ZTools 原生宿主内运行 1.7B 或 4B，也没有新测 Windows、Linux、Intel Mac 或 ATools。
- 真实宿主重启恢复已完成；但测试自定义 Skill/MCP 删除后的跨第二次完整进程重启持久性尚未验证。
- 0.6B 的全篇定向改句内容未通过；局部结构保护正确不代表编辑内容合格。复杂图表逻辑和数学排版仍需人工检查。
- 原生 ZTools 证据与浏览器自动化相互独立；浏览器 fixture 不能代替宿主窗口和原生进程检查。
