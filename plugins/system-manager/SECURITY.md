# 系统管家安全说明

## 信任边界

系统管家由普通 Web UI 与 ZTools preload 两层组成。UI 不获得 `fs`、`child_process`、Shell 或任意路径访问能力；本地操作只能通过各模块已审计的窄接口，或根 MCP runtime 对同一受控 core 的固定参数适配执行。

根 `window.systemManagerSuite` 仅提供 `openFeature(featureCode)`。路由由无原型、冻结的固定表驱动，只接受五个 manifest Feature code，并校验原始 URL、协议和规范文件路径。它不接受 URL、文件路径或命令。可信 dashboard 另有冻结的 `window.systemManagerAgentAccess`，仅含 `getState`、`grant` 与 `revoke`；模块页和未知页面不会获得该桥。

## 模块边界

- 系统诊断：操作系统摘要使用 Node `os`，系统盘使用只针对根卷的 `statfs`，不调用 `osInfo`、`system` 或无参数 `fsSize`，因此不会先读取主机名、序列号、UUID 或枚举全部挂载后再丢弃。`cpu`、`mem`、`graphics`、`battery`、`currentLoad` 是唯一第三方探测 allowlist，各自在固定的独立 helper 子进程中执行；进程以 `shell: false`、最小环境和全局并发上限 2 启动，共享输出上限为 256 KiB。超时会在 POSIX 上终止并确认整个进程组退出，在 Windows 上通过校验后的系统 `taskkill.exe /T /F` 终止进程树，常规路径只在目标进程树确认退出后结算。若 2 秒清理看门狗仍无法确认退出，调度器会 fail-closed 熔断：当前任务返回无本地细节的通用失败，排队与未来任务全部拒绝，且不再启动 helper，避免永久 loading、槽位耗尽和未知子进程继续累积。helper 内与 preload 信任边界都会执行固定字段投影；`graphics` 与 `battery` 的依赖实现即使在 helper 内短暂读取额外硬件字段，这些字段也不会跨进程、进入页面或报告。设备制造商与型号默认保持不可用。报告只写入用户通过宿主保存对话框明确选择的位置，正文严格限制为 20 MiB。
- 应用卸载：候选路径必须由受控平台适配器产生；macOS Bundle ID、desktop/Flatpak/AppImage 元数据和 Windows 卸载注册表均视为可变声明。只有枚举到的 macOS 用户应用本体可默认选择，所有声明型残留均默认不选，Windows 注册表命令与 Linux desktop/Flatpak 命令永不代执行。
- 开机启动：只修改 Linux/Windows 上明确支持且可回滚的用户级项目；macOS、系统级与未知来源项目保持只读。扫描、修改和撤销全局串行，避免跨项目并发放大本地校验或子进程调用。
- 垃圾清理：只扫描白名单缓存、日志和临时目录；近期项目仍可预览但默认不选择，符号链接、其他用户内容、系统目录或无法完整复验的项目会安全跳过。
- 局域网发现：只读取邻居表并发送有界 ICMP Echo；禁止端口扫描、服务识别、漏洞探测和公网扫描。
- 升级/退出生命周期：ZTools 3.0.2 的单一 `onPluginOut` 回调由套件根 preload 统一协调；进入关闭状态后拒绝新的 Agent 写入，最多等待 200ms。应用卸载与启动项修改使用带 TTL 的原子恢复记录并在新会话中只核对不重试；垃圾清理的废纸篓移动、LAN 的可取消限时扫描和诊断 helper 的进程树清理分别按模块边界收敛，升级中断后需以页面结果或恢复记录为准。

## Agent / MCP 边界

Agent 工具要求 ZTools 2.4+。根 preload 在冷启动时同步注册 manifest 中固定的 22 个短名称，宿主对外自动加 `system_manager_` 前缀；五个业务服务保持 lazy-load，避免仅枚举工具就触发本机扫描。旧宿主缺少 `registerTool` 时直接跳过；单个注册失败不会阻断其余工具、页面路由或 UI。

宿主不会按照 `inputSchema` 自动校验参数，也不会为每次 `registerTool` 调用提供原生审批提示。因此每个 handler 在 preload 信任边界内再次要求普通对象、拒绝额外键，并对 ID、幂等键、不透明 cursor、字符串、数组和 `pageSize`（1–100，默认 50）执行硬上限验证。错误响应只允许固定错误码和 240 字符脱敏消息，不回显堆栈、本地路径、邮箱或底层命令输出。

默认授权状态为关闭，所有读取工具保持只读。有副作用能力被拆成五个独立 scope：`report_export`、`application_removal`、`startup_changes`、`system_cleanup`、`lan_scan`。只能由用户在系统管家 dashboard 授予，最长 10 分钟且可立即撤销；授权只保存在当前 dashboard renderer 的内存中，不写入 `dbStorage` 或业务结果。离开或刷新 dashboard、renderer 重建和插件重启都会立即清除授权，任何调用都不会延长过期时间。

应用处理、新的启动项启停、垃圾清理和 LAN 扫描使用 prepare/execute 两阶段协议。prepare 返回绑定规范化参数的 `actionId`、`actionDigest`、摘要与过期时间，90 秒后失效且单次消费；execute 重新检查 scope、action、快照及底层文件/接口状态。启动项撤销只接受最近一次成功变更返回且仍有效的 `operationId`。副作用调用使用 8–128 字符 `idempotencyKey`；当前 renderer 会话内最多 100 条结果保留 10 分钟，重复键不会重放操作，`get_operation_result` 仅查询既有状态。`runtimeSessionId` 用于识别刷新、导航或重启造成的会话重建；根 MCP journal 仍为会话内存数据。启动项 preload 会在写入前将单条 rollback journal 原子保存到隔离 `dbStorage`（无该能力时使用用户目录受限文件），新会话扫描时按权威状态 reconcile，凭据 10 分钟后清理；应用卸载则逐项保存 operation/result，最多保留一条且 10 分钟后清理，重启后只报告需核对状态，不会自动重试。授权不足或 LAN 限速发生在 action 消费前时不保留临时 journal 记录，条件恢复后可用同键重试；action 一旦消费，可能已产生副作用的成功或失败结果都会固定保留。诊断报告最多缓存 3 份、5 分钟。

具体副作用仍受模块边界约束：导出只接受缓存 `reportId` 并打开系统保存对话框，不接收任意路径或正文；应用/残留与垃圾项目仅移入可人工恢复的系统废纸篓；启动项只操作受支持的用户项并可能立即启停用户服务；LAN 只对已复验接口执行最多本机 /24 的 ICMP、最多每 15 秒启动一次，DNS 默认关闭。剪贴板复制、路径 reveal 和扫描 cancel 是 UI-only 辅助接口，不注册为 Agent 业务工具。

## 发布物约束

统一构建会拒绝：

- 根目录之外的写入或发布入口；
- 嵌套 `plugin.json`；
- `src`、`tests`、source map、符号链接，以及系统诊断锁定依赖之外的任何 `node_modules`；
- preload bundle、`eval`、Webpack 引导代码和无法解析的依赖；
- 超过或等于 15 MiB 的 dist 或 ZIP；
- ZIP entry 数量、CRC、解压长度或发布文件列表不一致。
- ZIP entry 使用绝对路径、`..`、反斜杠、NUL、重复名称，或 local/central 元数据不一致；每个解压内容还必须与当前 dist 的 SHA-256 完全相同，临时文件在原子 rename 前执行 fsync；
- 页面 CSP 包含 `unsafe-inline`、localhost、WebSocket 或其他开发来源。

模块 preload 保持未压缩、未混淆的 CommonJS 源码。前端依赖由各模块构建到静态资源，最终插件不携带开发依赖目录。系统诊断的 `systeminformation@5.33.1` 是唯一第三方 Node 生产依赖例外：版本必须与根锁文件的 integrity 一致，且源码与 27 个官方包文件的固定 SHA-256 清单逐项相同；复制前后都会拒绝内容漂移、额外文件、生命周期脚本、额外包、`.bin` 和符号链接。
五个 workspace 只生成供根构建组装的内部 dist；构建会删除其中的 `plugin.json` 和旧的模块级 release，不支持单独部署，避免绕过根 preload 页面隔离与统一 CSP。
应用与启动项的用户可写元数据采用文件大小、字段长度和条目数量多层门禁；启动项通过文件句柄最多读取声明大小加 1 字节以检测读取期增长，扫描快照只保存哈希/stat 证据而不持有文件正文。
最终 runtime 仅信任精确的六个 `file:` 页面：dashboard 获得套件路由、Agent 授权桥并执行 MCP 注册，但不预加载五个业务服务或暴露业务桥；五个模块页会在 renderer 导航后重新注册同一组 22 个 handler，并只额外获得各自唯一业务桥，不获得 Agent 授权桥；未知文件、HTTP(S)、查询参数或未列入白名单的片段页面不获得任何特权桥或 MCP handler。为保证键盘跳转在刷新后仍可用，仅额外接受 dashboard 的 `#modules`、垃圾清理页的 `#main` 与诊断页的 `#report-content`。

## 数据处理

系统管家不会统一持久化模块结果。模块可能读取完成当前任务所需的本地元数据，但不会通过 dashboard 上传。可选 DNS 名称解析等可能产生网络请求的行为由对应模块单独说明并默认关闭。

## 报告问题

请在提交安全问题时附带：操作系统及版本、ZTools 版本、触发 Feature、最小复现步骤，以及经过脱敏的错误信息。请勿附带用户名、完整本地路径、网络标识、Token 或其他敏感数据。
