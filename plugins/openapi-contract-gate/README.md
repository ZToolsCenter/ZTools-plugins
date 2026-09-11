# OpenAPI 契约门禁

一个适用于 OpenAPI 3、Swagger 2 JSON 及保守 YAML 的离线契约台账。它会比较接口端点、请求方法、参数、请求体、响应、安全要求、Schema 必填字段、类型和枚举，并为每项结果提供 JSON Pointer 证据。

YAML 只在 preload 边界解析。普通映射、序列、带引号值和块标量可以使用；锚点、别名、显式标签、重复键及远程 `$ref` 会被拒绝而不会继续解析。单个文件最大 10 MiB，嵌套深度不超过 60，审计节点不超过 40,000 个。

已验证 Node 契约测试、打包依赖检查、源码与产物一致性，以及 Chromium 渲染。Windows、macOS、Linux 的真实 ZTools 宿主加载和文件对话框行为仍未验证。

根目录 `plugin.json` 直接指向 `src/main/index.html`、`src/preload/index.cjs` 和 `logo.svg`，因此 ZTools 开发模式不依赖 `development` 覆盖即可加载界面与 preload。`npm run build` 会将 `dist/plugin.json` 重写为可独立发布的入口。`verify-dist` 递归统计 `dist` 内所有未压缩文件，打印精确字节数，并执行 14.5 MB（14,500,000 字节）安全门禁。

## Agent / MCP

ZTools 2.4+ 可把同一套保守解析器、比较器与 Markdown 报告器提供给 Agent。清单短名 `compare_inline`、`compare_approved_files` 会由宿主暴露为 `openapi_contract_gate_compare_inline`、`openapi_contract_gate_compare_approved_files`。旧宿主没有 `registerTool` 时会安全降级为原有界面。

- `compare_inline` 接受两份内联 JSON/YAML；由于 ZTools MCP 请求体上限为 1 MiB，每份 UTF-8 最多 320 KiB、合计最多 640 KiB。
- `compare_approved_files` 只消费人类在插件界面一次性选择的两份文件授权，不接受路径或授权令牌；文件仍可各到 10 MiB，但只返回最多 200 条分页发现项。界面预览读取不会消费这次授权，随后第一次 MCP 比较会消费它。

文件授权最长保留 5 分钟，仅对选择时打开的文件句柄生效。每次读取都会在同一句柄上复验设备号、inode、大小、mtime、ctime 与 SHA-256 摘要。取消选择、替换选择、授权过期、插件退出、读取或比较失败都会关闭句柄并清除授权；界面只能看到文件名与已授权的契约内容，不会获得路径、句柄或令牌。

两个工具都返回全量 `counts` 与由 `breaking` 数量确定的 `gatePassed`，Agent 不能改写或“解释通过”这个确定性门禁。MCP 比较使用流式收集器，只保留请求页而不构造全量发现项数组；发现项字段、Markdown 与最终 JSON 都有独立预算，响应最大 512 KiB，发生字段或响应裁剪时会设置 `responseTruncated`。处理器会自行拒绝未知字段、Symbol 字段、访问器、污染原型、格式、字节和分页越界；YAML 锚点、别名、显式标签、重复键以及远程 `$ref` 仍被拒绝。已授权文件失效或比较失败时会清理授权并返回稳定错误，不会透传路径或原始内容。

人工界面、文件对话框标题、错误提示与导出的 Markdown 报告均使用简体中文；MCP 工具名、错误码、字段名、`level`、`kind` 和协议值保持稳定。
