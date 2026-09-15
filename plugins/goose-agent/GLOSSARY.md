# 鹅的 Agent Glossary

鹅的 Agent（goose-agent）产品与实现共用的规范用语。解释器、ADR、设计与代码注释应对齐本表。

## Terms

**鹅的 Agent / goose-agent**：
独立的 uTools 插件产品与仓库名；品牌「鹅的 Agent」，工程标识 goose-agent。与 goose-note 同属鹅系列，但是**完全独立**插件与独立存储（db / 设置 / 会话），不跨插件读 note。
_Avoid_: 鹅记 AI、Notebook AI 插件、note 内嵌 Agent（指 note 内功能时请写「goose-note 内 AI」）

**Session（会话）**：
一次可恢复的 Agent 对话上下文容器：含消息历史、选用模型、工具过程状态；用户可在历史中切换多个 Session。
_Avoid_: 聊天室、thread（未统一前勿用）、conversation 裸用

**Turn**：
用户一次提交到模型完整回应（含其间全部 **ToolCall** 与中间输出）的一个往返单位；**Agent runtime** / **Pi harness** 按 Turn 推进。
_Avoid_: round、步、请求

**Skill / loadSkill**：
按需加载的领域能力说明与工具绑定包；模型通过 **loadSkill**（或等价渐进披露入口）在需要时再装入完整说明，而不是一次塞进系统提示。
_Avoid_: 插件、扩展包、prompt 片段（泛称）

**ToolCall**：
模型在某一 **Turn** 内发起的一次工具调用请求及其结果回传；UI 上可对应工具进度卡。一期**无**审批卡执行路径。
_Avoid_: function call 裸称（文档统一 ToolCall）、API 请求

**Pi harness**：
Agent 循环与协议层：Turn 调度、工具调用协议、session/state、skills/extensions、模型 SDK 接入。产品约定：Pi **只做 harness**，权限模式、本地 FS、UI、uTools store 留在鹅领域层。
_Avoid_: Pi 全家桶 CLI/TUI、自研 ToolLoop、完整 pi-coding-agent 内嵌

**Workspace（工作区）**：
用户选定的本地文件夹根，作为 Agent 默认文件上下文与一等导航对象。左栏第一版以工作区 / 本地文件夹为主。**可空**：无当前工作区时不可用文件工具，仍可聊天与 web/visual（及 loadSkill）；无绑定会话归 **快速对话**。建议持久化上次工作区列表与选中项。参考 Codex app「绑定文件夹」心智。
_Avoid_: 笔记本、Notebook 绑定（本产品不走笔记隐喻）、挂载根（源 note 用语，本产品用工作区）

**快速对话（Quick chat）**：
无工作区绑定的 **Session**（`workspaceId: null` / 缺省）。与工作区会话**同一数据模型与 store**，不是新会话类型。侧栏**底部独占固定分组**，始终可见（可空），组内 `+` 新建。工具面同「工作区可空」：聊天 + web + visual + loadSkill；文件工具门控。概念参考 VS Code Agents Quick chats（本仓位置取底部）。见 ADR 0020。
_Avoid_: 未挂载（历史/数据层别称，用户可见与 IA 用「快速对话」）、临时会话（未统一前勿用）、第二套对话产品

**Permission Mode（权限模式）**：
控制 Agent 文件与本机操作范围的模式开关；入口在 **Composer** 内、**模型选择器右侧**。**三档（已锁）**：① 只读工作区 ② 工作区读写 ③ 完整权限。
_Avoid_: 沙箱开关（泛称）、审批模式（一期无审批 UI）

**只读工作区**：
Permission Mode 档 1：仅当前工作区根内只读；禁止写 / 删 / 改名。
_Avoid_: 全局只读（无工作区 / 快速对话时文件工具直接不可用，不是「整机只读」）

**工作区读写**：
Permission Mode 档 2：当前工作区根内可读可写（直写）。
_Avoid_: 笔记本写权限（note 用语）

**Full Access（完整权限）**：
Permission Mode 档 3：允许 Agent 借助 uTools gooseFs 等能力操作**整台电脑**文件（不限于当前工作区根），并暴露 **`runCommand` 本机 shell**（ADR 0023：超时与输出上限；非交互 TTY）。用户可见文案「完整权限」。**切换即生效，完全无二次确认**。
_Avoid_: root、管理员模式、无超时任意 bash、非完整权限下的 shell

**直写**：
工具在授权的权限模式下直接落盘或执行，**不**经过 Approval Plan / 审批卡二次确认 UI。一期默认策略。
_Avoid_: 静默写（贬义混用）、batch-plan 执行（note 路径）

**Workspace shell（侧栏+主区）**：
垂直工作台壳层：左侧栏第一版承载 **Workspace（工作区）** / 本地文件夹，右侧主区承载对话与工具过程 + **Composer**。对标鹅的笔记工作台与鹅的运行 handoff，不是纯气泡全屏聊。
_Avoid_: 三栏 IDE、纯 Chat App 布局

**Composer**：
主区底部（或固定位）的输入与发送区：文本、**模型选择器**、其右侧的 **Permission Mode** 切换、发送/中止等；消息流在其上滚动。
_Avoid_: 输入框、prompt box、chat input（文档统一 Composer）

**用户图片附件**：
用户在 **Composer** 中附带、随 Turn 发给模型的图片（截图/UI 对照等）；发送后以压缩 base64 内联进会话消息。无 vision 模型时硬拦发送。与 **visual** 工具（Agent→用户出图）方向相反。见 ADR 0012。
_Avoid_: 附件（泛称）、多模态闲聊（非一期主叙事）、visual 工具混称

**用户文档附件 / Office 附件**：
用户在 **Composer** 统一附件入口选择的 Word/Excel/PPT/PDF 等；发送前本地解析为纯文本注入 **Turn**（气泡用短 displayText，避免刷屏）。与 **office** skill 工具（`parseOffice` / `writeDocx` 等）配合。见 ADR 0008 / 0022。
_Avoid_: 笔记附件、网盘同步

**Artifact（产物卡片）**：
Agent 工具产出的可预览/可下载交付物，**内嵌消息流**（非独立侧栏）：HTML、Mermaid、SVG、表格/图、生图、Office 二进制等。有 **Workspace** 时可「保存到工作区」。见 ADR 0022。
_Avoid_: 侧栏预览面板、Canvas（未采用）

**Agent runtime**：
驱动 **Session** 内多 **Turn** 执行的运行时：接模型、调度 **ToolCall**、挂 **Skill**、与 UI 事件桥接。实现上倾向 **Pi harness** + 领域工具注入，而非自研并行 ToolLoop 内核。
_Avoid_: backend、AI service、chat service

**Subagent / 子代理**：
由父 Turn 通过 **runSubagent**（兼容 `task`）派发的独立子 run：独立上下文与 tool 环，父模型只收 **summary**。用户在对话内以 **SubAgentCard** 查看名称、模型、思考长度、状态、elapsed、当前工具与内部步骤。嵌套最多 2 层；子并发上限约 3，**不占**会话并发 cap。仅 openai / openai-responses 暴露。见 ADR 0021。
_Avoid_: 后台线程（泛称）、多会话并发（那是 Session 级 cap）、嵌套 Session

**runSubagent**：
派发 **Subagent** 的 ToolCall 名称；入参含 `task`（必填）及可选 `name` / `modelId` / `reasoningLevel`。结果对父模型为摘要结构；完整轨迹在 `AgentToolPart.subRun`。
_Avoid_: spawn、fork agent（未统一前勿用）

**SubAgentCard**：
消息流中展示子代理进度的折叠卡 UI；头栏元信息 + 展开任务/工具步骤/摘要；可选完整轨迹 Modal。
_Avoid_: 普通 ToolProgressCard（可嵌套用于子步骤，但子代理一等卡是 SubAgentCard）

**鉴权方式优先（auth-mode-first）**：
设置 → AI → 供应商卡内 **顶层 Tabs**：**本机账号** | **API 密钥**；切换 / 导入 / 保存 Key 写入 `preferredAuthMode`。见 ADR 0018。
_Avoid_: 卡内每供应商双栏（已取代）、先选供应商再判 OAuth/Key

**Composer 多供应商模型 id**：canonical 形如 `xai/grok-4`、`deepseek/deepseek-chat`；列表聚合 `modelsByProvider` 中 **已启用且凭证有效** 的供应商。选中可切换 `customProviderId` 与 `preferredAuthMode`（非设置 Tab 独占）。

**enabledProviders**：
各供应商是否在 Composer 模型列表中显示；与凭证独立。首次成功保存 Key / OAuth 导入自动 `true`；手动关闭粘住。见 ADR 0018 §6。
_Avoid_: 用全局 `ai.enabled` 代替（该字段恒 true）

**preferredAuthMode**：
用户偏好的生效凭证方式：`api_key` \| `oauth`；请求层按此与凭证有效性解析，**不**静默跨模式回落。见 ADR 0018。
_Avoid_: 镜像「正在使用」状态行冒充生效方式

**本机 CLI 探测与导入**：
内部可扫家目录已知 CLI；**本机账号 UI 仅列可导入行**（已登录 Grok、OpenCodex xAI → `oauthSession`）。Codex / Claude / Pi / OpenCode 等 presence-only 不展示。禁止 OIDC 写入 API Key 槽。
_Avoid_: 订阅白嫖桥、ChatGPT access_token 当 sk-

## 历史 / 源产品用语（本产品一期不用作主路径）

| 说法 | 说明 |
|------|------|
| Approval Plan（审批计划） | goose-note batch-plan 写前审批；**本产品一期不做**审批 UI，见 ADR 0007 |
| 笔记本 / 页面树 / BlockNote | note 笔记面；**不搬** |
| listPages / searchNotes / executeBatchPlan（笔记版） | note 笔记工具；**不搬** |

## 待定（未稳，勿当规范词硬推）

| 说法 | 说明 |
|------|------|
| 会话历史 IA | 左栏工作区子树 + 底栏快速对话 + 顶栏 History 同源过滤已收口（ADR 0014 / 0020）；细交互可再调 |
