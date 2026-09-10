# 插件安全体检

界面、状态提示、文件对话框和导出的 Markdown 标题均使用简体中文；MCP 工具名、schema 字段和错误码保持稳定，便于 Agent 调用。

插件安全体检会读取用户选择的插件目录，报告清单错误、高风险能力模式、文件上限、路径风险与已脱敏的证据。它不会修改受扫描目录，也不会跟随符号链接。受审计的文本会在全局扫描字节上限内完整读取，不会静默截断。

扫描器限制遍历深度、文件数量和总字节数；未知桥接字段会按失败关闭处理。它会统计每一个发现项，但人工界面最多保留 5,000 条证据，显示“已展示数 / 总数”，并在证据被截断时标记 JSON 和 Markdown 导出。报告可导出为 JSON 或 Markdown。首个版本故意不开启 ZIP 检查，因为安全的归档解析器应在与专用归档工具相同的限制边界内运行。

扫描器结合使用 lstat、realpath 和经校验的打开句柄，以缩小文件系统竞态窗口。同一账户下的进程仍可在检查间隙替换目录树；纯跨平台 Node 无法在不使用平台特定文件系统能力的情况下彻底消除这类竞态，因此应在发布前立即重新执行扫描。

## 开发与打包

根目录 `plugin.json` 直接指向 `src/ui/index.html`、`preload/index.cjs` 和 `logo.svg`，因此 ZTools 开发项目无需解析 `development` 覆盖项即可加载源码包。仓库 CI 仍会执行包内的 `build` 脚本并打包 `dist`：源入口目录不包含嵌套清单，构建则会生成自包含的 `dist/plugin.json`，其入口为 `index.html`、`preload/index.cjs` 和 `logo.svg`。

`npm run verify-dist` 会递归统计未压缩的 `dist` 目录，打印精确字节数，并在超过 14.5 MB（14,500,000 字节）安全上限时失败。

## Agent / MCP 使用

在 ZTools 2.4+ 中，清单工具 `scan_approved` 会以 `plugin_guard_scan_approved` 的完整名称暴露给 Agent。Agent 无法提供或发现路径：必须先由用户在界面中选择插件目录，该只读授权会在五分钟后或插件退出时失效。没有有效界面授权时，工具以 `WORKSPACE_APPROVAL_REQUIRED` 失败。旧宿主没有 `registerTool` 时仍会保留原有人工界面，仅省略 Agent 工具。

工具接受 `report=json|markdown|both`、范围为 0–400 的 `offset` 和范围为 1–200 的 `limit`。Markdown 由与界面相同的已审计核心格式化器生成。MCP 扫描使用更紧的上限：在统计每一个发现项的同时，最多保留 400 条证据，因此分页可使用完整总数，而不会构建无上限的响应。`hasMore` 和 `nextOffset` 仅描述已保留证据；`offset=400` 是有效的空终止页，即使 `totals.findings` 仍可能大得多。发现项消息和文件证据分别按 512 个 UTF-8 字节裁剪；过大的页会继续缩减并设置 `responseTruncated=true`，直到序列化响应不超过 512 KiB。页面不会缩减到零进度，汇总总数也保持不变。Agent 输出会移除绝对根目录和原始入口清单；在序列化前，单一最终脱敏器会覆盖每个返回字符串，包括具有可靠前缀的 GitHub/OpenAI/AWS 凭据、带标签的 AWS 密钥、Bearer/JWT 值以及完整或截断的 PEM 私钥。

界面授权保存所选目录的规范真实路径和跨平台文件系统身份，而不只是路径字符串。人工扫描和 MCP 扫描都会在读取前后立即复验该身份；如果目录被删除、移动、在同一路径下替换或变得无法验证，授权会被撤销，MCP 工具返回 `APPROVED_DIRECTORY_UNAVAILABLE`，且不会暴露路径。在无法使用有效设备号/inode 组合的系统上，会通过出生/创建/变更/修改时间元数据按失败关闭处理。宿主将 MCP 请求体限制为 1 MiB；大型目录内容不会放入请求，必须通过人工文件对话框授权。

运行 `npm test`、`npm run build`，再运行 `npm run verify-dist`。在真实 Windows、macOS 和 Linux ZTools 宿主中的测试仍待完成。
