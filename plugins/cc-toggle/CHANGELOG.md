# Changelog


## 1.6.1 - 2026-08-21

- 修复 Codex 代理模式调用技能/多工具调用时报 "An assistant message with 'tool_calls' must be followed by tool messages"：连续 function_call 合并为单条 assistant 消息，并为缺失结果的 tool_call 兜底补齐 tool 消息（Chat / Anthropic 转换均已修复）
- 修复 Codex 代理模式下 model_catalog_json 写成相对路径导致报 "AbsolutePathBuf deserialized without a base path"

## 1.6.0 - 2026-08-14

- 桌面小组件：当前供应商余额置顶小窗，默认显示余额/模型名/备注，默认深色主题

## 1.5.0 - 2026-08-12

- 插件 ID 统一为 `cc-toggle`，数据目录统一为 `~/.ztools-cctoggle/`
- 余额不足告警按项目级持久化去重：告警标记存于项目文档 `balanceNotify`，跨会话不重复推送，余额回升再跌破时才重新提醒

## 1.4.0 - 2026-08-12

- 一键切换供应商：为 Codex、Claude、Gemini、OpenCode、OpenClaw 等主流 AI CLI 工具管理多套 API 配置
- 切换 baseUrl、模型、密钥等参数，无需手动改配置文件
- ZTools 化：仓库链接 / 端口区分 / env 开发目标
- 同步 OpenClaw 会话模型记忆
