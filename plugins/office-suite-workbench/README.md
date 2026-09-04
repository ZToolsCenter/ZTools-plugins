# Office 全家桶

> 需要 ZTools 2.4.0 或更高版本。ZTools 3.2.0 会显示官方模型的能力信息，并支持宿主提供的思考深度；在 2.4–3.1 中会自动省略不可用能力。

一个基于 [iOfficeAI/OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) 的 ZTools 本地文档工作台，覆盖 Word、Excel、PowerPoint 的读取、检查、编辑、批处理与 MCP 调用。

> 当前范围是 OOXML 三件套：`.docx`、`.xlsx`、`.pptx`。它不等同于 Microsoft 365 全部产品，不包含 Outlook、Access、OneNote、Visio，也不承诺旧格式 `.doc/.xls/.ppt`。

## 已实现

- Word / Excel / PowerPoint 分区工作站与文件触发入口。
- 结构速览、正文提取、统计、问题扫描、OpenXML 校验、视觉预览。
- 受控 OfficeCLI 命令台和三种格式的常用命令配方。
- 直接复用 ZTools 设置中的 AI 模型和提供商凭据，插件不接触 API Key。
- AI 文件权限提供“只读”“本次允许修改”“始终允许修改”三档；长期授权仅在当前插件会话有效。
- 停止生成或隐藏插件时，会同时中止模型请求与进行中的 AI OfficeCLI 子进程；下一轮会等待旧进程退出，最多等待 2.5 秒并明确报告超时。
- `shell:false` 的 preload 执行桥；UI 不接触 `child_process`、`fs` 或任意 shell。
- OfficeCLI 一键安装、每日后台版本检测与用户确认后的一键更新；国内镜像优先、GitHub 兜底。
- OfficeCLI 环境变量/常见路径自动发现、超时和输出上限。
- MCP 原生握手探测、客户端配置生成和显式注册/移除。
- ZTools HTTP MCP 工具 `office_document`，以及 OfficeCLI 原生 stdio 兼容通道。
- React / TypeScript / Vite UI、Node preload 测试和真实 OfficeCLI 冒烟测试。

## 运行依赖

插件不捆绑 OfficeCLI 二进制，避免把所有平台资产塞进插件包。首次打开时可直接点击“一键安装”：插件识别当前平台，优先从 OfficeCLI 国内加速镜像 `d.officecli.ai` 下载固定版本资产，镜像不可用时才回退 GitHub；下载后强制校验官方 SHA-256，并安装到当前用户目录。整个过程不会打开终端，也不会执行远程 shell 或 PowerShell 脚本。

如需手动安装，可使用官方命令：

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

插件会依次检查只读环境变量 `OFFICECLI_PATH`、当前 `PATH`、`~/.local/bin`、Homebrew/Scoop 与 Windows 官方 `%LOCALAPPDATA%\OfficeCLI` 等常见目录。renderer 不能指定任意可执行文件。一键安装链路已使用官方 `1.0.142` macOS ARM64 资产完成真实下载、校验、安装与版本自检。

运行时连接成功后，插件会在后台异步检查最新版，并每 24 小时刷新一次。检测不阻塞文档操作，也不会静默更新；发现新版本时只显示更新提示，用户点击“一键更新”后才下载并替换。更新继续使用国内镜像优先、GitHub 兜底、版本化资产、SHA-256 强制校验和新二进制自检。

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
- 一键安装只接受插件内固定的官方地址和平台资产；版本化下载必须通过 `SHA256SUMS` 校验后才会原子写入用户目录。
- 后台版本检测只读取公开版本信息；CLI 更新必须由用户点击确认，renderer 不能提供更新 URL 或目标路径。
- 命令、参数、超时和输出大小均有限制；`install`、`plugins`、`skills`、`mcp` 等管理命令不能从通用执行器调用。
- ZTools MCP 工具只接收 `command`，不接受二进制路径、工作目录或环境变量覆盖。
- 外部 MCP 调用禁用隐式 resident，并阻止 `import`、`merge`、`raw-set`、`add-part`、`open`、`--out`、`--save` 和拉起浏览器等高风险路径。
- 持有有效 MCP Key 的客户端仍可读取或修改当前 OS 用户有权访问的 Office 文件；当前版本不提供目录级授权沙箱。
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
- PDF 导出和其他格式需要 OfficeCLI 的额外插件，不属于当前版本内置能力。

## 许可与归属

OfficeCLI 采用 Apache-2.0 许可。本插件使用 “Powered by OfficeCLI” 表述，不代表 iOfficeAI 官方发行版。插件包不捆绑或重新分发 OfficeCLI 二进制；一键安装和更新仅在用户设备上按需下载 OfficeCLI 官方版本化资产，并强制校验官方 SHA-256 清单。OfficeCLI 的源码、许可和发行资产归 iOfficeAI 及其贡献者所有，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
