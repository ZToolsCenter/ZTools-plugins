# 鹅的监控

面向 uTools 的进程管理插件。它按应用归并 Electron、Chrome 等派生的 Helper，并提供高密度列表、搜索、展开和安全结束进程能力。浏览器页面只用于本地 mock 调试，不是独立产品模式。

## 功能

- 一级分类为全部、界面、CPU、内存、网络和后台；宿主不支持的界面/网络分类会自动隐藏。
- 界面分类只显示当前有屏幕可见顶层窗口的应用；macOS 网络分类显示进程实时下载/上传速率，约每 5 秒更新。
- 点击 CPU、内存、下载或上传列头排序。
- 按 `↑`、`↓` 选择，按 `→`、`←` 展开或收起 Helper。
- 选中一行后按回车，或点击右上角“关闭应用”，立即强制结束该进程组（无确认弹窗）。

## 搜索

正式插件完全使用 uTools 的 subInput。`utools/preload.js` 在每次进入插件时调用 `setSubInput`，并通过 `__prockillEnter` 和 `__prockillSubInput` 把查询交给列表过滤。共享界面不重复显示 Logo、标题或搜索框。

插件会记住筛选词、当前分类和安全快照绑定的选中进程。再次进入时恢复 uTools subInput；目标快照已变化或 PID 被复用时不会恢复旧选择。

浏览器 mock 在工具栏右上角保留紧凑搜索框，便于本地开发验证。按 `⌘F`、`Ctrl+F` 或 `/` 可聚焦当前宿主的搜索入口；搜索框内按 `↑`、`↓` 仍可移动列表选择。

## 目录

```text
packages/core/          共享界面、状态、类型和浏览器 mock
utools/                 uTools 清单、preload、进程角色逻辑和插件 Logo
scripts/build-utools.mjs
                        uTools 产物组装与 Chromium 108 兼容检查
scripts/check-versions.mjs
                        package.json 与 plugin.json 版本一致性检查
scripts/mcp/            本地 MCP 进程服务
```

`utools/logo.png` 必须保留。它由 uTools 宿主用于插件列表和入口展示，不在插件内容区重复渲染。

## 开发与验证

需要 Bun 和 Node.js。

```bash
bun install
bun run dev
bun run check
```

浏览器开发地址通常为 `http://127.0.0.1:5173/`，数据来自动态 mock。

`bun run check` 依次执行版本检查、TypeScript 检查、测试和 uTools 构建。产物位于 `utools-dist/`，可在 uTools 开发者工具中按目录加载。

## MCP

项目内置本地 stdio MCP 服务器，基于 `@modelcontextprotocol/sdk@1.30.0`。它读取运行 MCP 客户端的电脑，适合先诊断资源占用、查看按应用归并后的进程，再由用户确认后结束目标进程。

```bash
bun run mcp
```

根目录的 `mcp.json` 是可导入的配置样例。客户端不能识别相对 `cwd` 时，请改为项目的绝对路径。

提供三个工具：

- `goose_monitor_system_stats`：读取 CPU 负载估算与内存使用量。
- `goose_monitor_list_processes`：归并列出进程，返回 `snapshotToken` 和 `allPids`。
- `goose_monitor_kill_process`：仅在传入 `confirm: true` 和最新快照字段时结束进程；服务端会再次枚举并拒绝已变更的 PID、MCP 自身及其祖先进程。

MCP 服务器不会把日志写到 stdout。结束进程不可逆，调用方仍应展示目标并取得明确确认。Windows 的 `system_stats` 暂不提供 CPU 使用率，进程枚举和结束功能仍可用。

## 发布

1. 同步更新 `package.json` 与 `utools/plugin.json` 的版本。
2. 运行 `bun run check`。
3. 将 `utools-dist/` 打包或交给 uTools 开发者工具发布。

插件使用 Node `child_process` 读取和结束进程，不上传进程数据。可见窗口采集不使用辅助功能、屏幕录制或 System Events 权限；结束受保护进程仍可能因系统权限被拒绝。
