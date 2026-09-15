# Changelog

## 0.1.0 - 2026-07-29

- 首次提供通用格式转换中心和批量作业队列。
- 支持 Office、PDF、常见图片、纯文本、Markdown、HTML、CSV、TSV 与 JSON 能力规划。
- 提供本地 UI、ZTools 文件/图片入口与结构化 MCP 工具。
- 所有本地进程使用固定参数和 `shell:false`，输出经过验证后原子发布。
- 重型转换依赖改为用户确认后按引擎动态安装，市场插件包保持在 EdgeOne 15 MB 限制内。
- 国内镜像优先下载固定版本 npm tarball，通过 SRI 校验和安全解压后写入 ZTools 数据目录。
