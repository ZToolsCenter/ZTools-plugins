# Changelog

## 0.2.0 - 2026-07-27

- 新增 OfficeCLI 一键安装：自动识别平台，优先使用国内镜像，失败时回退 GitHub，并强制校验官方 SHA-256。
- 新增每日后台版本检测与用户确认后的一键更新，不阻塞文档操作且不会静默替换 CLI。
- AI 助手直接复用 ZTools 中配置的模型和提供商凭据，无需重复配置 API Key。
- 新增只读、本次允许修改和当前插件会话始终允许修改三档文件权限。
- 优化 AI 助手布局、输入框滚动和命令结果展示，并直接渲染 OfficeCLI 视觉预览。
- 保持 ZTools HTTP MCP 与 OfficeCLI stdio MCP 双通道，继续执行命令白名单和高风险参数限制。

## 0.1.0 - 2026-07-22

- 首次发布 Office 全家桶插件，支持 Word、Excel、PowerPoint 的检查、编辑、批处理与视觉预览。
- 提供受控 OfficeCLI 执行桥、ZTools HTTP MCP 工具和 OfficeCLI 原生 stdio MCP 配置。
