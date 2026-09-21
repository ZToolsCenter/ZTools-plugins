# Changelog

## 1.2.0 - 2026-09-20

### 新增

- 「在资源管理器中打开」：与「在终端中打开」并列的系统文件管理器通道（Windows 资源管理器 / macOS Finder / Linux xdg-open），目标为文件时定位并选中该文件（`explorer /select`、`open -R`）
- 粘贴 / 拖入文件夹到 ZTools 秒开资源管理器（新增 `open-explorer` 触发指令）；拖入文件则新增「在资源管理器中显示」指令（`open-explorer-file`，选中该文件）
- 面板条目 hover 新增「打开文件夹」按钮，点击用系统文件管理器直达该目录
- 主输入框路径形态输入同时推送「在终端中打开」+「在资源管理器中打开」双候选；收藏条目匹配结果同样出双候选
- 主输入框新增静态入口「在资源管理器中打开」（over 指令，任意文本可见、不依赖插件加载）：选中后按与终端入口一致的规则解析文本——路径直接打开、收藏名称自动匹配、无法唯一解析进入面板选择

## 1.1.0 - 2026-09-15

### Added

- macOS 支持：终端探测与打开适配 macOS，Terminal.app（系统自带）+ iTerm2 自动探测；iTerm2 经 AppleScript 新建窗口并 cd 到目标目录，Terminal.app 经 `open -a` 打开
- 拖拽文件夹 / 文件到插件面板即可添加收藏（拖入时显示虚线提示浮层；文件自动取父目录，重复项与无效路径分别提示），路径经 `window.ztools.getPathForFile()` 获取（参考 ZTools 官方 tinypng 插件方案）
- 「添加文件夹」支持一次选择多个目录，逐条入库并汇总提示
- 新增「清空全部」按钮：二次确认后清空收藏列表（仅列表非空时显示）

### Changed

- `which` 探测按平台区分（win32 用 `where.exe`，macOS/Linux 用 `which`），修复 macOS 上终端探测必然失败的问题
- `detectTerminals` / `openInTerminal` 按 `process.platform` 分发，终端下拉与自动降级链自动跟随平台（macOS：iTerm2 → Terminal.app；Windows：wt → pwsh → powershell → cmd，Git Bash 独立兜底）
- 修复拖拽添加只在列表区域生效的问题：`html/body/#app` 高度链改为 `height: 100%`，面板撑满插件窗口，下方空白区域同样可拖入

## 1.0.0 - 2026-09-14

### Added

- 首次发布：QuickTerm 快速启动面板，收藏常用文件夹、hover 删除、点击在终端中打开
- 粘贴 / 拖入文件夹到 ZTools 秒开终端（文件自动取父目录），成功后自动退出插件
- 终端支持与自动探测降级：Windows Terminal → PowerShell 7 → Windows PowerShell → CMD，Git Bash 独立探测（常见安装路径 + 手动指定）
- 全局默认终端设置与条目级终端固定，持久化于 ZTools dbStorage
- 支持在 ZTools 主输入框直接粘贴文件/文件夹路径，选中「在终端中打开」一键打开（文件自动取父目录）
- 主输入框输入收藏名称/关键字（如 babe）即可匹配收藏列表并直接打开；路径形态文本直接校验，文件自动取父目录
- 主输入框 mainPush 动态推送匹配的收藏列表，选中即打开，无需进入插件面板

- 条目级终端选择：每条收藏可单独固定使用的终端（默认「跟随默认」），打开优先级 = 条目固定 > 全局默认 > 自动探测

### Changed

- 持久化使用官方 dbStorage 接口（修复响应式对象导致的 IPC 克隆失败，写入前序列化为纯对象）；自动迁移本地文件方案期间的数据

### Fixed

- 修复 PowerShell / CMD / Git Bash 打开时无报错但终端窗口不显示的问题（改经 `cmd /c start ""` 创建新控制台窗口，空标题占位避免 start 参数被误解析；启动失败时抛出真实错误信息）
- 修复暗色模式下列表文字与背景同色导致看不清的问题（引入 Element Plus 暗色主题变量，跟随 ZTools 明暗主题）
