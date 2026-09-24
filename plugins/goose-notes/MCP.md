# MCP 工具

鹅的笔记通过 uTools 插件清单中的 `tools` + `utools.registerTool` 暴露原生 MCP 工具。安装构建产物后，支持 uTools MCP 的客户端会自动发现这些工具；不需要另行启动 HTTP / stdio MCP 服务，也不会把笔记数据上传到第三方。

正文对外只走 **Markdown 字符串**，不会把 BlockNote JSON 交给模型。

## 架构

- **只读工具**在 preload 直读 `utools.db` 与本地 Markdown，不依赖插件页是否打开。
- **写入工具**走渲染层桥：preload `registerTool` 只转发，由已打开的插件页 live store 落库。
- 事件前缀：`goose-note:mcp-tool-{request,response,ready}`。
- 插件页未打开时，写入会等待 ready 最多 **15 秒**，单次执行最多 **30 秒**。
- 没有插件内第二套确认框。`writeSafety` 只作声明；删除进入回收站，不是永久删除。

## 可用工具

| 工具 | 用途 |
| --- | --- |
| `list_notebooks` | 列出可访问的应用内记事本和已挂载的本地文件夹记事本。默认不返回本地绝对路径。 |
| `list_notes` | 按记事本、来源、回收站状态和排序规则分页列出笔记。 |
| `search_notes` | 在标题和正文中检索笔记；标题命中优先。 |
| `get_note` | 按 ID 读取单篇笔记，返回 Markdown / 纯文本正文。 |
| `get_mcp_capabilities` | 返回协议、版本、传输方式、工具清单和 `writeSafety`。 |
| `create_note` | 在指定记事本新建笔记。`title` 与 `markdown` 至少提供一个。 |
| `append_note` | 在笔记末尾追加 Markdown。 |
| `update_note` | 改正文。可选 `heading` 只改该标题下一段；否则整篇替换并尽量保留标题 / H1。 |
| `rename_note` | 重命名笔记（内部改 H1，本地改文件名）。 |
| `delete_note` | 删除笔记：应用内进垃圾箱，本地文件进系统回收站。 |
| `restore_note` | 从应用内回收站恢复笔记。 |
| `create_notebook` | 新建应用内记事本。 |
| `update_notebook` | 重命名记事本。 |
| `delete_notebook` | 删除记事本。至少保留 1 本；本地本只卸挂载，不删磁盘。 |

`list_notes` 和 `search_notes` 均返回 `total`、`items` 和 `nextOffset`。将 `nextOffset` 作为下一次调用的 `offset`；为 `null` 时表示没有更多结果。

## 写入限制

- **写工具必须先打开插件页**，否则会在 15 秒后报「桥接尚未就绪」。
- 拒绝对锁定页、回收站页、文件夹节点、本地读取失败页写入。
- `delete_note` 不是永久删除：应用内笔记进垃圾箱，本地 Markdown 进系统回收站。
- `delete_notebook` 至少保留一本；本地文件夹记事本只卸挂载。
- 不做 WebDAV、导出文件、附件、移动 / 副本、旗标、永久删除。

## 开发验证

```bash
bun run test:mcp
node --test preload/mcp-tools.test.cjs
bun run build
```

构建完成后，在 uTools 开发者工具中加载 `dist/plugin.json`，然后重新打开插件页，再让 MCP 客户端刷新工具列表。
