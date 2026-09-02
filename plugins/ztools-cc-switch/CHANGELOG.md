# Changelog

## [1.54.0] - 2026-09-01

- 适配 ZTools 3.2：默认 Provider、备份、日志、凭据和 sidecar runtime 首次启动时校验迁移到插件专属数据目录并删除旧目录；用户主动配置的外部数据目录保持不动。备份导出支持能力检测后的文件拖拽。
- 增加 2.4 版本门禁；3.2 ESC 隐藏后重入不会重复恢复路由、同步或创建临时 UI。

## [1.53.0] - 2026-07-28

### Added

- 新增 Windows 与 Linux 平台声明、Provider/Session/Hermes 终端适配及原生平台回归测试。
- 新增 macOS、Windows、Linux sidecar CI 构建矩阵，并在发布前聚合、校验通用插件包。

### Fixed

- 修复 ASAR 包内 Rust sidecar 无法直接启动导致的 `spawn ENOTDIR`，运行时会安全提取并校验 sidecar。
- 支持双击 Provider 卡片切换，并修复卡片拖拽到相邻位置时排序不更新。
- 修复 Provider 配置弹窗底部操作区留白和尺寸适配问题。
- Provider API Key 不再返回 Webview；编辑留空会保留原密钥，并提供显式清除操作。
- 修复并发保存 Provider、排序、路由和故障转移配置时发生更新丢失。
- 为各客户端本地路由增加独立网关令牌，修复 OAuth Provider 无 API Key 时无法接管路由。
- 修复路由开启后切换 Provider 仍沿用旧模型或旧客户端配置。
- 修复路由状态保存失败时客户端文件与路由快照回滚不完整。
- 修复路由引擎并发启动产生孤儿监听服务。
- 修复不可信 Session ID 可注入终端恢复命令的问题。
- 修复 Session 扫描遇到符号链接后提前停止、遗漏后续会话。
