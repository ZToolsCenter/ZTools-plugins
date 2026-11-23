# Changelog

## 1.0.5

### Changed
- macOS 的八种快速填入预设使用系统 open 命令打开本地项目。

## 1.0.4

### Fixed
- macOS 缺少 idea 命令时，使用已安装的 IntelliJ IDEA 打开本地项目。

## 1.0.3

### Changed
- 移除项目列表顶部的操作提示，使用 SVG 绘制复制路径和删除图标。

## 1.0.2

### Fixed
- macOS 缺少 code 命令时，使用已安装的 VS Code 打开项目。

## 1.0.1

### Fixed
- 使用 ZTools 内置的 SQLite 读取 WAL 历史并在事务中删除，修复安装包缺少 sql.js 的报错。
- 支持新版 JetBrains 历史文件和预设路径回退。
- 修复 IDE 切换后的键盘打开、空列表导航、别名冲突和旧配置迁移。
- 对齐 utools-ide-open 功能（shell转义、SQL参数化、复制路径、删除确认、UI调整）

## 1.0.0

### Added
- 从 uTools VscodeOpen 插件迁移至 ZTools 平台
- 支持 VSCode 系编辑器（VS Code、Cursor、VSCodium、Qoder）最近项目读取（SQLite/JSON）
- 支持 JetBrains 系编辑器（IntelliJ IDEA、PyCharm、WebStorm、GoLand）最近项目读取（XML）
- 动态 Feature 注册，输入别名即可进入对应编辑器项目列表
- setSubInput 搜索 + 键盘导航（↑↓ 选择、Enter 打开、Ctrl+D 删除）
- IDE 配置页面，支持快速填入预设路径
- 暗色模式支持

### Fixed
- 修复命令注入漏洞，添加 escapeShellArg 对参数进行 shell 转义
- JetBrains 版本目录排序，优先匹配最新版本
- 添加 safeDecodeURIComponent 防止畸形 URI 导致崩溃
- 使用 fileURLToPath 替代手动路径转换，修复 Windows 平台路径问题
- 移除 Settings 页面冗余的 doRegister 逻辑
