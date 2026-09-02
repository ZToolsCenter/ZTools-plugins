# Webhook 实验室

一个有界的本地 Webhook 接收器。它只监听带随机路由令牌的回环地址，最多保留 200 条小型事件，并可在不向外发送内容的前提下预览和校验负载。首个版本暂不提供重放功能。

在 Windows 上，复制出的示例可直接在 PowerShell 中执行：命令使用带单引号参数的 `curl.exe`；若本地监听 URL 含单引号，则会被拒绝。

Node 测试覆盖跨平台命令与生命周期契约，回环服务器已在开发用 macOS 设备完成冒烟测试。Windows、macOS、Linux 的真实 ZTools 宿主加载仍未验证；Windows PowerShell 执行和 Linux 运行行为目前仅完成契约测试。

根目录 `plugin.json` 直接指向 `src/main/index.html`、`src/preload/index.cjs` 和 `logo.svg`，因此 ZTools 开发模式不依赖 `development` 覆盖即可加载界面与 preload。`npm run build` 会将 `dist/plugin.json` 重写为可独立发布的入口。`verify-dist` 递归统计 `dist` 内所有未压缩文件，打印精确字节数，并执行 14.5 MB（14,500,000 字节）安全门禁。

## Agent / MCP 使用

ZTools 2.4 及以上版本可将 `hmac` 和 `preview_payload` 分别作为 `webhook_lab_hmac`、`webhook_lab_preview_payload` 提供给 Agent。它们都是纯本地计算：不能启动、列出、停止或重放监听流量。`hmac` 仅接受 SHA-256 或 SHA-512，将 UTF-8 正文限制为 256 KiB、密钥限制为 8192 字节，并且只返回摘要和非敏感元数据。`preview_payload` 复用人工界面的负载解析器与 preload 脱敏器，将 UTF-8 正文限制为 256 KiB、内容类型限制为 256 字节、序列化响应限制为 64 KiB。

ZTools MCP 传输允许的请求体最大为 1 MiB，且不会替各工具执行 JSON Schema 校验或限制响应，因此 preload 会独立拒绝未知字段、恶意或自定义原型、访问器、错误类型及越界输入。动态 JSON 键和值使用同一套最终凭据清洗器：带凭据含义的键、Bearer/JWT 值、GitHub 令牌、OpenAI `sk-` 令牌、AWS 访问密钥 ID 和带标签的密钥，以及 PEM 私钥块，都会在预览离开能力桥前被脱敏。脱敏键冲突会添加确定性后缀；`__proto__`、`constructor` 和 `prototype` 则会复制到无原型对象中的安全保留键别名。本功能只提供尽力而为的安全预览，不能证明负载绝对不含秘密；新型、无标签或业务自定义凭据仍需人工检查。旧版宿主没有 `registerTool` 时仍保留人工界面。Windows、macOS、Linux 真机 ZTools 宿主加载仍待验证。
