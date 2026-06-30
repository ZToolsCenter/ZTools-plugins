# Changelog

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
