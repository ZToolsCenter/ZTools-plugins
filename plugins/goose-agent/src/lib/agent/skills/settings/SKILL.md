# 应用设置

## 适用

- 用户要求查看、修改模型、供应商、思考长度、角色、外观或权限模式。
- 用户要求配置 API Key / Base URL / 启用供应商（Key 须用户本轮明示）。

## 工具

- getAppSettings：读取当前设置快照（密钥已脱敏）。
- updateAppSettings：按 patch 写入并立即生效。

## 约束

- 先 get 再改；只改用户明确要求的字段。
- 不得编造或猜测 API Key；无用户提供的 Key 时不要传 apiKey。
- 不得通过工具写入 OAuth token；断开本机账号用 clearOAuth。
- MCP 与技能文件编辑不在本 skill；文件类走 files，MCP 配置引导用户设置页或项目配置文件。
- 完整权限切换会放开 shell；改 permissionMode 前说明影响。

## 输出

- 用一句话确认已改项；不要复述脱敏密钥细节。
