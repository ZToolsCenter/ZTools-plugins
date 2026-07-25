# MCP 接入与验收

## 通道 A：ZTools HTTP MCP（推荐）

1. 安装并启动 ZTools 3.0.1 或更高版本。
2. 安装本插件，确认 `plugin.json` 和 `preload/services.cjs` 位于同一发布目录。
3. 打开 ZTools 设置 → MCP 服务并启用服务。
4. 复制 endpoint 和 API Key；客户端优先使用 `Authorization: Bearer KEY`。
5. 调用 `initialize`、`notifications/initialized`、`tools/list`。
6. 在工具列表中查找 `office_suite_workbench_office_document` 一类名称。
7. 依次调用：

```json
{ "command": ["help", "docx", "paragraph"] }
```

```json
{ "command": ["view", "/absolute/path/report.docx", "text"] }
```

```json
{ "command": ["validate", "/absolute/path/report.docx", "--json"] }
```

错误 Key 必须返回未授权；禁用插件后，工具应从 `tools/list` 消失。

## 通道 B：OfficeCLI stdio

```json
{
  "command": "/absolute/path/to/officecli",
  "args": ["mcp"]
}
```

协议为一行一个 JSON-RPC 2.0 消息。握手顺序：

1. `initialize`（OfficeCLI 当前返回协议 `2024-11-05`）。
2. `notifications/initialized`。
3. `tools/list`，应只包含 `officecli`。
4. `tools/call`，参数为 `{ "command": string | string[] }`。

## 金样验收矩阵

| 格式 | 创建 | 读取 | 修改 | 交付门禁 |
|---|---|---|---|---|
| DOCX | `create` | `view text` / `get` | paragraph / run / table | `validate` + `view issues` + Word/WPS 复核 |
| XLSX | `create` | `get` / `query` | cell / formula / table | `validate` + cachedValue 抽检 + Excel/WPS 复核 |
| PPTX | `create` | `get / --depth 2` | slide / shape / chart | `validate` + `view issues` + screenshot + PowerPoint 复核 |

还应覆盖：带空格和中文的绝对路径、错误扩展名、被占用文件、超时、超大输出、并发写、进程被杀和插件后台首次加载。
