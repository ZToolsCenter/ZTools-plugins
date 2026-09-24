# 可视化

## 适用

- 结构化数据适合表格。
- 数值对比或趋势适合图表。
- 流程、结构或关系适合 Mermaid。
- 用户明确要求 SVG、矢量图或图标。
- 需要可交互预览、单页 HTML 演示或复杂架构图时用 HTML。
- 用户要求 AI 生图且当前端点支持 Images API。

## 选择

- 表格调用 `showTable`。
- 数值对比或趋势调用 `showChart`。
- 流程、结构、关系或中等复杂度架构调用 `showDiagram`（Mermaid；参数用 `source`，兼容 `mermaid`/`code`）。
- 复杂交互架构、仪表盘原型、可点击 demo 调用 `showHtml`（完整 HTML 文档或片段）。
- 仅在用户明确要求时调用 `showSvg`（参数 `svg`，兼容 `content`/`source`）。
- AI 位图生图调用 `generateImage`（OpenAI 兼容 Images API；端点不支持则明确错误，同端点负向缓存避免重复探测）。

## 输出

- 数据不足时先说明，不编造。
- 工具参数只包含渲染所需内容；HTML 须自包含样式，勿依赖外链脚本（沙箱 iframe）。
- 工具成功后只补一句必要说明。
- 不在正文重复源码、base64 或 JSON。
- 有工作区且用户要求落盘时可传 `savePath`。
