# AI Provider Switch for ZTools

一个基于 Vue 3、Vite、TailwindCSS 与 Rust sidecar 的 ZTools AI 客户端管理插件。对照 [cc-switch](https://github.com/farion1231/cc-switch) 的公开配置语义，统一管理 Provider、Skills、本地 API 路由、Thinking 整流、用量与请求日志。

界面采用 Provider Workbench 工作台设计，默认浅色主题，并支持跟随系统或手动切换深色；主题偏好保存到 ZTools 隔离存储。

```text
ZTools Web UI → CommonJS Preload → JSON Lines → Rust sidecar
```

Rust sidecar 负责 Claude、Codex、Gemini 的高风险配置写入、备份和跨文件回滚，以及 Codex 通用 TOML 的保格式变换；Preload 负责 OpenCode、OpenClaw、Hermes、Skills、本地路由、统计日志及网络测试。sidecar 不创建窗口或托盘。

生产构建会保留可审核的 CommonJS Preload 源码，并把 `preload/node_modules` 原始模块结构复制到发布产物；ZTools 运行态无需临时联网安装依赖。

1.52.0 首发版限定 macOS，发布包同时包含 Apple Silicon 与 Intel 两种 Rust sidecar；Windows 与 Linux 代码保留为后续发布适配，不在本版市场支持范围内。

## 功能

- Claude Code、Claude Desktop、Codex、Gemini CLI、OpenCode、OpenClaw、Hermes、GrokBuild 八客户端切换与现有配置导入
- OpenCode、OpenClaw、Hermes 采用上游累加式 Live Provider 语义：按真实 Provider ID 写入、展示 Live 状态，可只移出客户端配置而保留管理库记录；片段预览自动脱敏凭据
- Claude Desktop 复刻上游 3P 配置库语义：Direct/Local Gateway 双模式、四文件事务回滚、官方 1P 恢复、Claude-safe 模型目录、`[1M]`/Opus 别名/角色回退及 Gateway Token 校验
- Claude Desktop Local Gateway 支持 Anthropic、OpenAI Chat、OpenAI Responses、Gemini Native 与托管 OAuth；可从 Claude Code Provider 批量推导并同步 Desktop 模型路由
- 原生 Provider 余额查询完整覆盖 DeepSeek、StepFun、SiliconFlow 中国/国际、OpenRouter 与 Novita AI；鉴权、确定性 API 失败和瞬时网络失败保持上游语义
- Provider 自定义端点按客户端独立持久化，支持添加、删除、最近使用时间、一次热身加一次计时的双请求测速，以及把候选端点应用到当前配置
- Codex History Unify 让官方 `openai` 与第三方 `ztools_cc_switch` 会话共享 Resume 历史桶；支持现有 JSONL/`state_5.sqlite` 存量迁移、目录绑定账本、迁移前备份和关闭时精确恢复
- SQLite 历史迁移由 Rust sidecar 内嵌 SQLite 执行，不依赖系统安装 `sqlite3`，并使用 SQLite Online Backup 保证 WAL 场景下备份一致性
- ZTools 宿主启动策略通过隔离存储保存；可在 Preload 建立或重新进入插件时恢复已启用路由，不重复创建操作系统 Login Item
- 浅色为首次启动默认主题，支持浅色、跟随系统和深色三种模式；客户端导航使用路由脊线表达配置拓扑，设置页、数据表与弹窗共用响应式视觉体系
- 设置页支持逐项显示或隐藏八个 AI 客户端菜单，并提供“仅显示”快捷操作；偏好保存到 ZTools 隔离存储，隐藏菜单不会删除 Provider、账号或客户端配置
- 设置页按界面、客户端、高级、数据、同步五个 Tab 分类；按钮、开关与下拉列表使用统一交互状态，避免长页面连续堆叠
- 针对 Retina 下约 800px CSS 宽度的 ZTools 主窗口提供独立中密度断点：保留完整客户端/操作名称、压缩状态头和 Provider 卡片，并维持两列路由布局；仅更窄窗口才进入纯图标导航
- 设置页可按固定客户端白名单借用 ZTools Shell 打开主配置目录或插件数据目录；Claude 始终打开 `~/.claude/`，不会因兼容文件 `~/.claude.json` 向上扩大到整个 Home
- Provider 新增、编辑、删除与客户端范围管理
- Provider 支持按客户端独立持久排序；后端要求排序列表完整、无重复且不能混入其他客户端条目
- Provider 卡片支持直接拖拽排序，放下后按当前客户端独立持久化，不再使用上下移动按钮
- Claude、Codex、Gemini 通用配置片段支持从当前配置安全提取、编辑、清空与切换时按 Provider 选择性应用；提取器过滤密钥、端点、模型、MCP 和注入产物
- Codex 通用 TOML 由 Rust sidecar 使用 `toml_edit` 结构化合并及按值剥离，保留用户注释和键序；Gemini 通用环境变量使用独立标记块，更新片段不会遗留旧值
- Universal Provider 母配置管理：一份 NewAPI/自建网关配置按稳定 ID 生成 Claude、Codex、Gemini 三端子 Provider，支持仅保存、同步、复制与级联删除
- Universal Provider 的 API Key 单独进入 ZTools 安全存储，Web UI 与 `universal-providers.json` 仅能看到“已配置”状态；三端模型及 Claude Haiku/Sonnet/Opus、Codex Reasoning Effort 可独立设置
- Provider 编辑器可从服务端读取模型列表，支持搜索后一键回填；普通 API Key Provider 自动推导 `/models`，并可覆盖 Models URL、Custom User-Agent 与 Full URL 模式
- 模型端点兼容 `/vN`、OpenAI 兼容子路径及常见 Claude Coding Plan 后缀；404/405 时尝试下一候选，其他 HTTP 错误保留服务端摘要供排障
- Codex OAuth、xAI OAuth 与 GitHub Copilot 托管账号使用各自官方模型端点，访问令牌仅在 Preload 内参与请求，不返回 Web UI
- Gemini 官方订阅额度查询沿用 [Gemini CLI 官方源码](https://github.com/google-gemini/gemini-cli/blob/69b51f8fa2af0abf717daaba4dca1c627023d82d/packages/core/src/code_assist/oauth2.ts)公开发布的 installed-app OAuth Client ID/Secret，仅在 Preload 内为本机已有 Gemini CLI 会话刷新 Access Token；这些常量不作为桥接 API 导出，用户 Token 也不会返回 Web UI、写入 Provider、备份或日志
- API 连通性、鉴权响应与延迟测试
- 写入前自动生成 `.bak`，临时文件完成后原子替换
- 保留客户端配置文件中的未知字段与 Codex 既有登录材料
- Provider 预设随插件版本静态发布，不在运行时下载或覆盖规则
- 复刻上游 `ccswitch://v1/import` Deep Link，支持 Provider、Prompt、MCP 与 Skill 仓库；借用 ZTools Feature/`onPluginEnter` 接收入口并展示确认弹窗
- Deep Link 密钥与配置原文仅在 Preload 保存，Web UI 只接收脱敏预览和 10 分钟一次性确认 ID；Provider 只接受内联 Base64 配置，远程端点强制 HTTPS（回环地址除外）；MCP 导入后保持禁用，同 ID 自动创建安全副本并需审核后手动启用
- OAuth 设备码复制优先借用 ZTools 剪贴板能力；Webview 不直接申请浏览器剪贴板权限
- 设置页支持跳过/恢复 Claude Code 初次安装确认，仅增量维护 `~/.claude.json` 的 `hasCompletedOnboarding` 字段，并在变更前生成 `.bak`
- Claude Code VS Code 插件联动开关，对照上游增量维护 `~/.claude/config.json` 的 `primaryApiKey: "any"`，关闭时只删除该字段
- 启动时从客户端实际配置反向识别当前 Provider，避免外部修改后状态过期
- Skills 统一源存储，支持插件目录与 `~/.agents/skills` 迁移、八客户端软链接/复制同步、按应用启停及未纳管 Skill 扫描导入
- Skills 仓库管理、GitHub 发现、skills.sh 搜索、远程更新检查与单项更新；支持通过 ZTools 文件选择器从 ZIP 批量发现并安装 Skill，安全展开内部相对符号链接，同名跳过；覆盖、更新、移除前生成结构化备份，支持列表、恢复、删除并保留最近 20 个
- Claude Code / Claude Desktop / Codex 项目 Profiles：从当前 Provider、MCP、Skills 与 Prompt 创建分组快照，切换前自动保存旧项目状态，并以 best-effort 方式应用目标快照
- 全局出站代理支持 HTTP(S)、SOCKS5、系统代理继承、认证与连通性测试；复刻上游常见端口扫描，并统一作用于 Provider、OAuth、规则、Skills、路由转发及云同步请求
- 本地 HTTP 路由按当前客户端展示并独立接管 Claude、Codex、Gemini、OpenCode、OpenClaw、Hermes、GrokBuild 七条路由；后三者使用隔离路径前缀，关闭时精确恢复各自配置快照
- Thinking budget 整流、默认 Thinking 注入与 reasoning effort 配置
- Bedrock 请求优化器按上游三路径处理 Thinking：Haiku 跳过、新模型 Adaptive、旧模型使用 `max_tokens - 1`，并在 Tools/System/消息中最多注入四个 Prompt Cache 断点
- GitHub Copilot 优化器在协议转换前执行请求分类、孤立 Tool Result 清理、Tool Result/Text 合并、Thinking 剥离、Compact/Subagent 检测和 Warmup 小模型降级，并注入稳定的 Request/Interaction ID
- 路由请求日志、Token/缓存 Token、首 Token 延迟、成功率及汇总统计
- 按时间与应用筛选的 Token/成本趋势、Provider/模型统计和完整请求追踪详情
- Provider 可配置非负成本倍率、按请求或响应模型计价，以及每日/每月 USD 消费限额；用量概览显示实时进度与超限状态
- 用量页提供 Claude、Codex、Gemini、GrokBuild 应用级默认倍率与计价来源；Claude Desktop 继承 Claude，Provider 留空继承或单独覆盖，按请求计价锚定映射后的实际出站模型
- Provider 自定义用量脚本支持 General、New API 与 Custom 模板、临时测试和页面内定时查询；请求/提取代码运行在受限 Preload `vm` 上下文，HTTPS 同源模板、超时、响应大小及结果类型均受校验
- 用量脚本独立 API Key、Access Token 与 User ID 通过 ZTools `safeStorage` 保存，Web UI 仅显示配置状态；Provider Deep Link 拒绝用量脚本与用量凭据，需导入后在插件内手动配置
- 宿主日志支持 error/warn/info/debug/trace 级别与总开关，只持久化插件标识消息并脱敏 Bearer、API Key、Token、密码及 URL 凭据
- 日志维护支持单文件大小、保留天数和请求日志条目上限；启动及每六小时自动压缩，手动清理以重命名备份代替直接删除
- 内置主流 Claude、GPT 与 Gemini 模型定价，支持自定义四类 Token 单价并回填未定价历史记录；自定义定价随便携备份迁移
- Claude、Codex、Gemini 与 OpenCode 会话历史用量增量导入，支持 JSONL、JSON 和 OpenCode SQLite
- 历史用量使用稳定请求 ID、文件变更游标和十分钟跨源指纹去重，避免与本地路由日志重复计数
- 支持按上游语义重建 Codex Session 用量：串行锁定同步、先备份请求日志与导入游标、仅替换 `codex_session`，完整保留本地路由和其他客户端数据；确认框优先借用 ZTools 宿主能力
- Claude、Codex、Gemini CLI 官方 OAuth 订阅额度查询，以及认证中心 Codex 多账号额度窗口
- Provider Coding Plan 额度查询：Kimi、智谱个人/团队、MiniMax 中国/国际、ZenMux、火山方舟 Agent Plan / Coding Plan；兼容 5 小时、周、月窗口与绝对美元额度
- 火山额度使用控制面 AK/SK 特有签名 V4，先探测 Agent Plan 再探测 Coding Plan；火山 AK/SK 与智谱团队组织/项目 ID 经 ZTools `safeStorage` 加密，前端仅获取“已配置”状态
- Provider 批量双请求测速：首请求预热连接，第二次请求记录 HTTP 状态与延迟
- 对照上游 Stream Check 的 Base URL 可达性检测：无鉴权 GET、任意 HTTP 状态均算可达、仅超时重试，以 TTFB 区分正常/较慢，且绝不改变路由熔断状态
- 连通检测支持七客户端批量检查、仅当前/故障转移目标筛选、超时/重试/较慢阈值配置；检测日志保留七天并进入便携备份
- Claude、Codex、Gemini、OpenCode、OpenClaw、Hermes、GrokBuild Sessions 扫描、项目分组、消息预览与终端恢复
- Codex 会话标题兼容 VS Code 注入的 IDE Context，优先读取 `session_index.jsonl` 与 `state_5.sqlite` 中的显式重命名；支持 `CODEX_HOME`、`CODEX_SQLITE_HOME` 和 `config.toml` 的 `sqlite_home`
- OpenCode 同时读取 legacy JSON 与 SQLite 会话；文件删除进入插件回收站，SQLite 删除前保留数据库备份
- Hermes 同时读取 JSONL 与 `state.db`，SQLite 会话优先；GrokBuild 支持 active/archived summary 与 chat history
- Session 回收站支持文件原路径恢复、GrokBuild 目录整体恢复，以及 OpenCode/Hermes SQLite 行级快照精确恢复；删除和恢复前均保留一致性整库备份
- OpenClaw Workspace 九类核心 Markdown 文件管理，以及 Daily Memory 列表、全文搜索、编辑、回收站和恢复
- OpenClaw Agents Defaults、Tools Profile/Allow/Deny、完整 Env JSON 与配置健康检查；写入时迁移旧版 timeout、保留未知配置并生成 `.bak`
- OpenClaw 默认模型链与模型目录独立编辑器，支持 Alias、扩展 JSON 字段和未知配置原样往返，只增量更新 `agents.defaults.model/models`
- Hermes `MEMORY.md` / `USER.md` 长期记忆编辑、字符预算展示和独立启用开关，保留 `config.yaml` 中其他 Memory/Provider 字段
- Hermes Dashboard 借用 ZTools Shell 与受控终端能力：先探测本机 Web 服务，再打开配置页；网页层只能触发固定的 `hermes dashboard` 命令
- OpenCode OMO / OMO Slim Profile 管理，兼容 `oh-my-openagent.jsonc`、旧版 `oh-my-opencode.json(c)` 与 Slim 配置；支持本地导入、Agent/Category/未知字段编辑、启用/停用和插件互斥同步
- OMO 写入保留未知顶层字段并生成 `.bak`，配置与 `opencode.json` 插件同步采用失败回滚；Profile 数据进入便携备份、WebDAV 与 S3 快照
- Workspace 写入使用严格文件白名单、2 MB 限制、`.bak` 与同目录原子替换，目录打开复用 ZTools Shell 能力
- 七客户端环境变量冲突扫描，前端只显示脱敏值；Shell 配置安全修复前保存完整快照，并支持一键恢复
- 七客户端版本与安装诊断，区分未安装、不可运行与多安装冲突，识别 Homebrew、nvm、Volta、fnm、mise、bun、pnpm、pip 等来源；安装和更新命令由 Preload 白名单生成
- API Key Provider 可借用 ZTools 目录选择器和系统 Shell 打开注入当前 Provider 的专属终端；命令及环境变量映射由 Preload 固定生成，敏感值不返回 Web UI
- MCP Servers 与 Prompts 中央存储，并按客户端同步或移除；MCP 可从 Claude、Codex、Gemini、GrokBuild、OpenCode、Hermes 固定配置路径 best-effort 导入，支持 Claude 状态、脱敏预览与 PATH 命令校验；Prompt 可从七客户端固定的全局路径读取预览并导入，网页不能提交任意文件路径
- Provider 显式故障转移队列与路由自动重试：按应用维护 P1 → Pn 成员，关闭开关保留队列，空队列开启时自动加入当前 Provider；开启前校验路由服务与应用接管，失败会回滚自动加入项
- 路由自动故障转移独立开关，以及 Closed/Open/Half-Open 熔断器；支持连续失败、错误率、恢复等待、半开成功阈值、实时健康统计和手动复位
- Provider、Skills、MCP、Prompts、路由及日志的可恢复导入导出
- 基于 ZTools 隔离存储与 Electron safeStorage 的 WebDAV 双向同步、ETag 冲突处理和自动同步
- 插件数据目录支持通过 ZTools 目录选择器覆盖，路径保存在隔离存储并在重新打开插件后统一应用到所有 Preload 管理器
- 对照上游数据库备份管理提供本地数据快照：自动周期、保留数量、手动创建、重命名、恢复和永久删除；恢复前自动创建安全快照
- AWS SigV4 S3 快照同步，兼容 AWS S3、Cloudflare R2、MinIO 与自定义 Endpoint，支持 manifest 提交、SHA-256 校验、远端预览和冲突处理
- Codex OAuth、xAI OAuth 与 GitHub Copilot/GHES 设备码登录，多账号、默认账号、Provider 账号绑定与并发 Token 刷新
- OAuth 账号元数据使用 ZTools `dbStorage`，Token 整体经 Electron `safeStorage` 加密且不会进入前端或普通备份
- 全局代理认证密码同样使用 Electron `safeStorage`，UI 与普通备份均无法读取明文；代理 URL 会拒绝指向默认本地路由端口以避免递归
- 订阅账号 Provider 一键切换时自动启动并接管本地路由；Codex 官方路由支持账号头、官方客户端标识及 FAST mode
- Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Gemini GenerateContent 请求/响应转换与模型映射
- 四协议 SSE 逐 Token 增量转换、Unicode 分片安全解码及流式工具调用参数拼接
- Codex 0.142+ namespace 工具按上游 64-byte/sha256 规则扁平化，并在原生 JSON 与分片 SSE 响应中恢复 namespace 身份；冲突会在转发前明确失败
- OpenAI Responses opaque reasoning item 通过版本化 Anthropic thinking signature/redacted payload 无损往返，流式链在结束前补发 signature delta
- Codex Responses → Chat 的 `prompt_cache_key` 仅对 OpenAI/Kimi Coding 或显式启用的 Provider 生效，优先客户端 Key、其次真实 Session ID，绝不使用随机 `previous_response_id`
- 一键导入六客户端当前配置；重复导入使用稳定 ID 更新，不产生副本
- 兼容 cc-switch 当前字段语义：Codex `responses` / `chat_completions`，Claude 单一鉴权字段

## 配置文件

| 客户端 | 写入位置 | 说明 |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | 更新 `env` 中的 Anthropic Key、Base URL、Model；同时检测但不修改 `~/.claude.json` 状态文件 |
| Claude Desktop | macOS `~/Library/Application Support/Claude*`；Windows `%LOCALAPPDATA%/Claude*` | 维护普通/3P 配置、`configLibrary` Profile 与 `_meta.json`；四个文件整体快照并失败回滚 |
| Codex | `~/.codex/config.toml`、`~/.codex/auth.json` | 配置写入带标记的 `ztools_cc_switch` Provider 段；保留 ChatGPT/OAuth 登录材料 |
| Gemini CLI | `~/.gemini/.env`、`~/.gemini/settings.json` | 更新 Gemini Key、Base URL、Model，并选择 `gemini-api-key` 认证 |
| OpenCode | `~/.config/opencode/opencode.json` | 维护 `ztools_cc_switch` Provider 与当前模型，支持 JSON5 输入 |
| OpenClaw | `~/.openclaw/openclaw.json` | 累加写入 `models.providers`，更新默认模型并保留其他配置 |
| Hermes | `~/.hermes/config.yaml` | 维护 `custom_providers` 与默认模型；尊重 `HERMES_HOME` |
| GrokBuild | `~/.grok/config.toml` | 维护 `[models]` 与自定义模型表，保留 MCP 等无关 TOML 配置 |

每个目标文件在改写前都会复制为同目录的 `文件名.bak`。

## 获取 Provider 模型

在新增或编辑 Provider 时填写 Base URL 与 API Key，点击“获取模型”即可读取、搜索并选择服务端模型。默认会从 Base URL 推导 OpenAI 兼容的 `/models` 候选；对于带 `/api/claudecode`、`/api/anthropic`、`/api/coding`、`/apps/anthropic`、`/step_plan` 等 Coding Plan 后缀的地址，会先剥离兼容后缀再尝试模型端点。若 Provider 明确要求独立端点，可填写 Models URL；若服务商依赖客户端标识，可填写 Custom User-Agent。Full URL 用于 Base URL 已指向完整推理端点的场景。

托管账号不需要把 OAuth Token 复制到 Provider 表单：Codex 使用 ChatGPT Codex 模型端点，xAI 使用 `https://api.x.ai/v1/models`，GitHub Copilot 使用账号对应的 `/models` 端点。所有授权头均由 Preload 临时注入，前端只收到去重、排序后的模型 ID 与所有者信息。

## 本地开发

环境要求：Node.js 20+、npm、Rust 1.80+、ZTools 开发者模式。

```bash
cd plugins/ztools-cc-switch
npm install
npm run install:preload
npm run build:sidecar
npm run dev
```

开发入口已在 `plugin.json` 中配置为 `http://127.0.0.1:5179/`。在 ZTools 开发者工具中载入本目录即可联调。浏览器直接打开 Vite 页面时没有 Preload，本地文件相关操作会提示“Preload 未加载”。

## 构建与测试

```bash
npm test
npm run test:sidecar
npm run build
```

构建输出位于 `dist/`：

```text
dist/
├── index.html
├── assets/
├── plugin.json
├── logo.svg
├── default-rules.json
├── rust-sidecar/             # 与二进制对应的可审核 Rust 源码及锁文件
└── preload/
    ├── index.js
    ├── configManager.js
    ├── skillManager.js
    ├── routerManager.js
    ├── claudeDesktopManager.js
    ├── balanceManager.js
    ├── codexHistoryManager.js
    ├── hostStartupManager.js
    ├── requestOptimizer.js
    ├── authManager.js
    ├── s3SyncManager.js
    ├── subscriptionManager.js
    ├── sessionManager.js
    ├── toolRuntimeManager.js
    ├── providerTerminalManager.js
    ├── universalProviderManager.js
    ├── workspaceManager.js
    ├── envManager.js
    ├── usageImportManager.js
    ├── activityStore.js
    ├── sidecarClient.js
    ├── bin/
    │   ├── cc-switch-sidecar-darwin-arm64
    │   └── cc-switch-sidecar-darwin-x64
    └── package.json
```

Preload 与 Rust 源码按 ZTools 审核要求保持可读，没有混淆。`npm run build` 会先按 `preload/package-lock.json` 安装 Preload 依赖；在 macOS 上继续构建 Apple Silicon 与 Intel 两种 release sidecar，再复制进 `dist/preload/bin/`。`tar`、`json5`、`yaml` 声明在 `preload/package.json`，发布工具会按 Preload 依赖结构处理。若手工运行 `dist`，请在 `dist/preload` 安装生产依赖：

```bash
npm install --omit=dev --prefix dist/preload
```

## 内置 Provider 预设

预设位于 `public/default-rules.json`，随插件版本构建和发布。运行时只读取这份可审核的静态文件，不会从 NPM 镜像下载或覆盖规则。修改预设后应提升插件版本并重新执行 `npm run build`。

## 发布 ZTools 插件

```bash
npm run build
ztools publish
```

首次发布会在 fork 的 `plugin/ztools-cc-switch` 分支创建 Draft PR；后续发布在同一分支追加提交。审核者在 PR 分支直接修改后，先运行 `ztools pull-contributions` 三方合并回本地，再继续发布。不要 force-push 发布分支。

首发 PR 标题使用 `Add plugin AI Provider Switch v1.52.0`，并保持 Draft 状态，直到 macOS 双架构产物、安全说明和界面截图审核完成。

## 安全边界

- 前端只调用 `window.ccSwitch` 的业务方法，不直接获得 `fs`、`path` 等 Node 原语。
- Web UI 仅借用 ZTools 生命周期、目录选择、Shell 打开与隔离存储能力；路径实化、工具命令白名单、Provider 环境变量和凭据注入均在 Preload 内完成。
- Provider 数据默认保存在 ZTools `userData/ztools-cc-switch/providers.json`，也可覆盖插件数据目录；文件权限按当前用户写入。
- OAuth Token 不写入 Provider JSON 或 WebDAV 备份；前端只能读取脱敏账号元数据，无法调用内部 Token 获取方法。
- WebDAV 密码与 S3 Secret Access Key 使用系统 `safeStorage` 加密，设置页只显示“已保存”状态。
- WebDAV 与自定义 S3 Endpoint 的远程地址必须使用 HTTPS；仅 `localhost`、`127.0.0.1` 与 `::1` 允许 HTTP。
- 本地路由固定监听 `127.0.0.1`，不会暴露到局域网。
- 应用接管前保存完整文件快照；关闭路由时恢复快照。路由模式下切换 Provider 只更新路由状态，不反复改写客户端文件。
- Skill 覆盖、更新和删除前写入插件数据目录中的结构化备份；恢复路径与备份 ID 均经过边界校验。
- Workspace 文件仅允许上游定义的九个名称，Daily Memory 必须是有效的 `YYYY-MM-DD.md`；删除先进入插件回收站。
- 环境诊断只自动修改用户 Home 下已识别的 Shell 配置，进程环境和 Windows 系统级变量只提示手动处理；所有值在进入前端前脱敏。
- 会话用量导入只读取 CLI 已有日志；文件签名与导入状态保存在插件数据目录，不修改原会话文件。
- Codex 用量重建在 Preload 内完成，Web UI 只接收移除/导入数量和备份份数，不接收日志内容或本机备份路径。
- 删除 Provider 不会回滚已经写入客户端的当前配置；请选择另一个 Provider 切换即可覆盖。

## 架构说明与范围

上游 cc-switch 是 Tauri/Rust 桌面应用，不能把其窗口运行时直接嵌入 ZTools Webview。本项目对照上游公开源码独立实现配置兼容层，并通过 CommonJS Preload 暴露最小业务接口。当前版本覆盖八客户端 Provider、Claude/Codex/Gemini Universal Provider、Skills 仓库发现/搜索/ZIP 批量安装/更新/备份恢复、Claude/Codex 项目 Profiles、OpenCode OMO/OMO Slim Profiles、全局 HTTP(S)/SOCKS5 出站代理、MCP/Prompts、本地路由/接管、故障转移、Thinking 整流、四类 API 协议及逐 Token SSE 转换、Codex/xAI/Copilot OAuth 账户池、Claude/Codex/Gemini 官方额度、七类 Provider Coding Plan、Provider 测速、七客户端 Sessions 与文件/SQLite 精确回收站、四客户端历史用量导入、OpenClaw Workspace/Daily Memory/Agents/Tools/Env/Health/模型目录、Hermes Memory/模型状态/Web Dashboard、环境冲突诊断、用量日志、本地备份、WebDAV 与 S3 云同步；其余上游边缘模块仍在后续迁移清单中。

ZTools 市场依 `plugin.json` 的 `platform` 把插件分配到单一操作系统 runner。本版声明 `darwin`，macOS runner 会交叉构建 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`，使同一审核包同时适用 Apple Silicon 和 Intel Mac。扩展 Windows/Linux 时需先解决 ZTools 单 runner 分发与多平台原生产物聚合，不应只修改 `platform` 声明。

## License

本项目以 [MIT License](LICENSE) 发布，版权归 TheLastSheep。实现参考 cc-switch 的公开配置语义与交互思路，但代码为独立实现；cc-switch、Gemini CLI 的来源、用途和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
