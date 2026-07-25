# Office 全家桶

一个基于 [iOfficeAI/OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) 的 ZTools 本地文档工作台，覆盖 Word、Excel、PowerPoint 的读取、检查、编辑、批处理与 MCP 调用。

> 当前范围是 OOXML 三件套：`.docx`、`.xlsx`、`.pptx`。它不等同于 Microsoft 365 全部产品，不包含 Outlook、Access、OneNote、Visio，也不承诺旧格式 `.doc/.xls/.ppt`。

## 已实现

- Word / Excel / PowerPoint 分区工作站与文件触发入口。
- 结构速览、正文提取、统计、问题扫描、OpenXML 校验、视觉预览。
- 受控 OfficeCLI 命令台和三种格式的常用命令配方。
- `shell:false` 的 preload 执行桥；UI 不接触 `child_process`、`fs` 或任意 shell。
- OfficeCLI 环境变量/常见路径自动发现、超时和输出上限。
- MCP 原生握手探测、客户端配置生成和显式注册/移除。
- ZTools HTTP MCP 工具 `office_document`，以及 OfficeCLI 原生 stdio 兼容通道。
- React / TypeScript / Vite UI、Node preload 测试和真实 OfficeCLI 冒烟测试。

## 运行依赖

插件首版不捆绑 OfficeCLI 二进制，避免把所有平台资产塞进插件包，也不会静默执行远程安装脚本。请先安装 OfficeCLI：

```bash
# macOS / Linux
curl -fsSL https://d.officecli.ai/install.sh | bash

# Windows PowerShell
irm https://d.officecli.ai/install.ps1 | iex
```

然后验证：

```bash
officecli --version
```

插件会依次检查只读环境变量 `OFFICECLI_PATH`、当前 `PATH`、`~/.local/bin`、Homebrew/Scoop 与 Windows 官方 `%LOCALAPPDATA%\OfficeCLI` 等常见目录。renderer 不能指定任意可执行文件。当前开发机实测版本为 `1.0.139`；上游能力与许可审计基线为 `1.0.141`。

## MCP：推荐使用 ZTools 网关

`plugin.json` 声明 `office_document`，preload 启动后立即调用 `window.ztools.registerTool()`。ZTools 会把它聚合到本地 HTTP MCP：

```text
http://127.0.0.1:36579/mcp
```

在 ZTools 设置 → MCP 服务中启用服务并复制 API Key。Codex 示例：

```toml
[mcp_servers.ztools]
url = "http://127.0.0.1:36579/mcp"
http_headers = { Authorization = "Bearer <ZTOOLS_API_KEY>" }
```

工具的外部名称由宿主生成，通常类似：

```text
office_suite_workbench_office_document
```

以客户端实际返回的 `tools/list` 为准。调用时优先传 argv 数组：

```json
{
  "command": [
    "view",
    "/absolute/path/report.docx",
    "issues",
    "--json"
  ]
}
```

ZTools 2.4.0 起支持当前工具命名和多模态透传；推荐使用 ZTools 3.0.1 或更高版本。

### OfficeCLI 原生 stdio（高级兼容模式）

不经过 ZTools 时，可让 MCP 客户端直接启动：

```json
{
  "command": "/absolute/path/to/officecli",
  "args": ["mcp"]
}
```

原生 server 暴露单个 `officecli(command)` 工具。此模式拥有 OfficeCLI 的完整进程权限，会绕过插件侧命令策略，仅建议用于可信的本机 MCP 客户端。

## 安全边界

- 所有文档命令通过 argv 调用固定 OfficeCLI 二进制，始终 `shell:false`。
- 命令、参数、超时和输出大小均有限制；`install`、`plugins`、`skills`、`mcp` 等管理命令不能从通用执行器调用。
- ZTools MCP 工具只接收 `command`，不接受二进制路径、工作目录或环境变量覆盖。
- 外部 MCP 调用禁用隐式 resident，并阻止 `import`、`merge`、`raw-set`、`add-part`、`open`、`--out`、`--save` 和拉起浏览器等高风险路径。
- 持有有效 MCP Key 的客户端仍可读取或修改当前 OS 用户有权访问的 Office 文件；首版不提供目录级授权沙箱。
- MCP Key 不能提交到 Git、截图或聊天记录。ZTools 设置页虽然显示回环地址，仍建议同时使用系统防火墙并只在可信设备启用。
- 高风险任务请先复制原文件；`validate` 通过不代表 Word / Excel / PowerPoint 的最终视觉效果正确。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，MCP 验收步骤见 [docs/MCP.md](docs/MCP.md)。

## 开发与验证

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run test:integration
npm run build
```

构建产物在 `dist/`，其中 preload 和 MCP 辅助源码保持可读，不压缩、不混淆。根仓库的发布脚本会在检测到该插件变更后打包 `dist/`。

## 已知边界

- PowerPoint 使用绝对定位，复杂版式必须截图并在 PowerPoint / Keynote / WPS 中复核。
- Word 页码、目录和交叉引用可能依赖真实 Word 分页引擎刷新。
- Excel 复杂公式、动态数组和图表缓存不能只依赖 OpenXML 校验。
- 动画、Morph、3D、SmartArt、OLE 与 speaker notes 视为实验能力。
- PDF 导出和其他格式需要 OfficeCLI 的额外插件，不属于首版内置能力。

## 许可与归属

OfficeCLI 采用 Apache-2.0 许可。本插件使用 “Powered by OfficeCLI” 表述，不代表 iOfficeAI 官方发行版；首版不重新分发其二进制。若未来加入内置运行时下载，发布物必须同时携带 OfficeCLI 的 `LICENSE`、`NOTICE` 和第三方许可声明并校验官方 SHA-256 清单。
