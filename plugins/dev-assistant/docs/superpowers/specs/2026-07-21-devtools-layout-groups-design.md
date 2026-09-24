# DevTools Layout Groups Design

## Goal

Optimize the DevTools layout by grouping related tools into higher-level tabs so the top navigation is easier to scan and the requested tools are colocated by workflow.

## Approved Grouping

Use a two-level navigation model:

- Top-level tab: `常用转换`
  - Tools: `JSON`, `Base64`, `URL`, `返回值解压`, `二维码`, `UUID`
  - Default tool: `JSON`
- Top-level tab: `效率工具`
  - Tools: `Crontab`, `变量命名`
  - Default tool: `Crontab`
- Top-level tab: `其他工具`
  - Tools: `时间戳`, `计算器`, `日历`
  - Default tool: `时间戳`

`其他工具` keeps existing capabilities reachable while staying outside the two user-specified groups.

## UI Behavior

- The top bar shows the product brand and the top-level tabs.
- The main content area shows a secondary tool switcher for the active group.
- Selecting a top-level tab switches to that group's default tool unless the current tool already belongs to that group.
- Selecting a secondary tool reuses the existing `handleSelectTool` behavior: reset results, reset transient UI state, load the selected tool sample, and focus/select the input.
- The existing JSON footer remains visible only for the JSON tool.
- The QR code generate/decode sub-tabs remain inside the `二维码` tool.
- The variable naming Baidu Translate config, save behavior, async loading state, and generate button remain unchanged.

## Architecture

Keep tool execution logic unchanged in `src/DevTools/tools.js`. The implementation should add lightweight grouping metadata near the DevTools component, for example an array of groups that references existing tool ids.

Main expected changes:

- `src/DevTools/index.jsx`
  - Add group metadata and derive the active group from `activeToolId`.
  - Replace the current top-level `TOOLS.map(...)` nav with group buttons.
  - Add a secondary tool switcher inside `main` for the active group's tools.
  - Reuse `getToolById`, `activeToolId`, and existing special rendering branches.
- `src/DevTools/index.css`
  - Add styles for the secondary tool switcher and active group state.
  - Keep the existing visual language: dark top bar, compact buttons, restrained borders, no card nesting.
  - Ensure mobile widths can scroll horizontally without layout overlap.

## Non-Goals

- Do not rewrite tool processing functions.
- Do not change Baidu Translate API behavior or stored config keys.
- Do not remove `时间戳`, `计算器`, or `日历`.
- Do not add new tool features.
- Do not change `public/plugin.json` commands unless implementation reveals a direct need.

## Error Handling

Tool-level errors stay handled by existing `setError` and result rendering. Group switching should clear transient errors through the existing `handleSelectTool` path.

## Verification

- Run `npm run build` after implementation.
- Manually verify each top-level tab shows the expected secondary tools.
- Verify defaults:
  - `常用转换` opens `JSON`.
  - `效率工具` opens `Crontab`.
  - `其他工具` opens `时间戳`.
- Verify existing special tools still work visually:
  - JSON editor and footer.
  - QR generate/decode tabs.
  - Crontab examples/results.
  - Variable naming config and generate flow.
