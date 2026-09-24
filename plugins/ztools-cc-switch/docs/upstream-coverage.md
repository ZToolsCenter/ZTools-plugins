# cc-switch 上游功能覆盖矩阵

审计基准：`cc-switch 3.18.0`，commit `a377d79303bc1e592d2783d559ca5bd6b8ba1417`。

状态定义：

- `已迁移`：存在对应 Preload 能力、Web UI 和自动化验证。
- `宿主替代`：独立桌面壳职责由 ZTools 提供，不在插件内重复实现。
- `进行中`：已有主体能力，仍有明确的上游语义缺口。
- `待迁移`：上游存在，但当前插件尚无等价实现。

| 上游域 | 状态 | ZTools 插件证据 / 剩余差异 |
| --- | --- | --- |
| Claude / Codex / Gemini / OpenCode / OpenClaw / Hermes / GrokBuild Provider CRUD 与切换 | 已迁移 | `preload/configManager.js`、Rust sidecar、临时 Home 集成测试；OpenCode/OpenClaw/Hermes 按真实 ID 累加写 Live，支持 ID 查询、脱敏片段与仅移出 Live |
| Claude Desktop Direct 3P / Local Gateway | 已迁移 | `preload/claudeDesktopManager.js`、Router 模型目录与安全 Token |
| Universal Provider | 已迁移 | `preload/universalProviderManager.js`、统一 Provider 页面 |
| Provider 排序、通用配置、模型发现、自定义端点 | 已迁移 | Config / Model Fetch / Connectivity managers |
| Provider 成本倍率、请求/响应模型计价、日/月消费限额 | 已迁移 | `activityStore.checkProviderLimits()`、Provider 编辑与用量概览 |
| Provider 自定义 JS 用量脚本 | 已迁移 | 受限 `vm`、General/New API/Custom 模板、安全凭据、测试/定时查询与 Deep Link 导入 |
| 官方订阅、原生余额、Coding Plan | 已迁移 | Subscription / Balance / Coding Plan managers |
| Skills 仓库、搜索、ZIP 批量安装、同步、迁移、备份恢复 | 已迁移 | `preload/skillManager.js`、ZTools 文件选择器、Skills 页面；覆盖上游 `install_skills_from_zip` 的递归发现、同名跳过及内部链接复制语义 |
| MCP、Prompts、Profiles、Deep Link | 已迁移 | Extension / Profile / Deep Link managers；MCP 覆盖六应用固定路径导入、Claude `~/.claude.json` 状态/脱敏预览、PATH 校验；Prompt 覆盖当前固定文件读取与导入，Preload 拒绝任意路径和符号链接 |
| 本地 Router、接管、故障转移、熔断器 | 已迁移 | `preload/routerManager.js`、`preload/failoverManager.js`、Router 页面；显式队列、可添加 Provider、按应用开关、空队列自动 P1 与失败回滚均有测试 |
| 四协议请求/响应与逐 Token SSE 转换 | 已迁移 | Anthropic / Chat / Responses / Gemini、Codex namespace 扁平/恢复、opaque reasoning bridge、稳定 prompt-cache 路由与逐 Token SSE 均有回归测试 |
| Thinking / Bedrock / Copilot Optimizer | 已迁移 | `requestOptimizer.js` 与 Router UI |
| 请求日志、模型定价、统计、历史用量导入 | 已迁移 | `activityStore.js`、`usageImportManager.js`、Usage 页面；Codex 重建串行执行并先备份，只替换 `codex_session` 与对应游标，保留 proxy/其他客户端来源 |
| 日志级别、文件滚动、保留策略 | 已迁移 | 上游五级日志开关、脱敏宿主日志、请求日志压缩、定时维护与可恢复清理 |
| 七客户端 Sessions 与回收站 | 已迁移 | 文件/目录恢复及 OpenCode、Hermes SQLite 行级精确恢复 |
| Codex History Unify | 已迁移 | JSONL + SQLite Online Backup、精确撤销账本 |
| OpenClaw Workspace / Memory / Agents / Tools / Env | 已迁移 | Workspace 与 Agent Config 页面 |
| OpenClaw 默认模型与模型目录专用编辑器 | 已迁移 | 节点级 Preload 读写、未知字段往返、模型目录 UI 与临时 Home 测试 |
| Hermes Memory | 已迁移 | `agentConfigManager.js` |
| Hermes Web UI / Dashboard 启动入口 | 已迁移 | 本机 `200/401` 探测、ZTools Shell 打开、固定白名单终端启动与模型只读状态 |
| 全局 HTTP(S) / SOCKS5 出站代理 | 已迁移 | `outboundProxyManager.js` 与设置页 |
| 每应用 Router 默认倍率与计价来源 | 已迁移 | Claude/Codex/Gemini/GrokBuild 默认策略、Claude Desktop 继承、Provider 覆盖与出站模型计价均已验证 |
| 本地快照、WebDAV、S3 | 已迁移 | Backup / WebDAV / S3 managers |
| npmmirror 规则热更新 | 已迁移 | `preload/updater.js`，启动静默检查与手动状态 |
| 开机启动、托盘、窗口状态、主题、语言、自更新 | 宿主替代 | ZTools 负责进程、窗口与插件更新；插件只保存 Router 恢复策略；Webview 默认浅色，主题偏好进入 ZTools 隔离存储，并支持跟随系统/深色 |
| Lightweight mode | 宿主替代 | ZTools Webview + 按需 Preload 本身即为无独立壳运行模式 |

每完成一批迁移，必须同步更新本表，并以目标单测、全量测试、两层 audit、生产构建、宽窄窗口视觉回归和安装态比对作为完成证据。
