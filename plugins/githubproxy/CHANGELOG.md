# Changelog

All notable changes to this project will be documented in this file.

## [1.0.4](https://github.com/ZToolsCenter/ZTools-plugins) - 2026-05-11

### Fixed

- **深色主题样式优化**：进一步完善深色主题下的组件样式，修复输入框、表格、卡片等组件的边框和背景色问题
- **代码质量改进**：修复多处代码检测问题，包括变量定义、空值检查、JSON 解析错误处理等

### Optimized

- **HTTP 重定向处理**：增强对 GitHub 文件下载链接的重定向支持，支持自动跟随 301/302/307/308 状态码重定向到 objects.githubusercontent.com 等域名
- **代码健壮性**：为 JSON 解析添加 try-catch 包裹，防止数据格式错误导致崩溃

### Technical

- 代码审查问题修复：处理代码检测工具发现的各类问题
- 优化代码结构，提升可维护性

## [1.0.3](https://github.com/ZToolsCenter/ZTools-plugins) - 2026-05-11

### Fixed

- **数据库更新原子性**：修复 `saveProxyServers` 函数先 remove 再 put 的非原子操作，避免数据丢失风险，改用直接 put 覆盖更新
- **页面切换重复触发**：修复从 settings 切换回 home 时重复触发下载操作的问题，添加 `lastProcessedParam` 标记避免重复处理相同参数
- **编辑服务器功能**：修复编辑服务器地址后无法找到原始条目的问题，添加 `editingOriginalName` 记录原始名称
- **深色主题样式**：修复输入框、表格等组件在深色主题下的白色边框和背景问题
- **下载进度显示**：优化无 `content-length` 时的进度显示，显示已下载字节数而非估算进度

### Optimized

- **测速性能**：将服务器测速从串行改为并行执行，大幅提升批量测速效率
- **进度显示优化**：添加 `formatBytes` 函数，无文件大小时显示可读的已下载字节数（如 "2.34 MB"）

### Technical

- 移除冗余的数据库操作，提升性能
- 添加参数去重机制，避免重复处理相同的插件入口参数

## [1.0.2](https://github.com/ZToolsCenter/ZTools-plugins) - 2026-05-11

### Fixed

- 修正拼写错误：`dowload` → `download`

## [1.0.1](https://github.com/ZToolsCenter/ZTools-plugins) - 2026-05-09

### Changed

- HTTP 重定向处理：GitHub 文件下载链接（如 Release 附件或 Raw 文件）通常会重定向到 objects.githubusercontent.com，现已支持自动跟随 301/302/307/308 重定向
- 深色主题下输入框、表格、卡片等组件样式适配
- 页面滚动问题修复
- 修改拼写错误

## [1.0.0](https://github.com/ZToolsCenter/ZTools-plugins) - 2026-05-09

### Added

- **GitHub Proxy 功能**
  - 支持代理服务器选择，自动保存上次选择
  - 支持 Git Clone / Wget / Curl / Direct Download 多种下载方式
  - 自动生成代理加速链接
  - 一键复制命令到剪贴板
- **设置页面**
  - 代理服务器列表管理（添加、编辑、删除）
  - 单服务器测速和批量测速功能
  - 一键清理失效代理服务器
  - 数据持久化存储
- **关于页面**
  - 项目介绍和功能说明
  - 技术栈展示
  - 相关链接
- **深色主题支持**
  - 自动检测 ztools 主题设置
  - 手动切换主题按钮
  - Element Plus 组件深色主题适配
- **插件入口参数**
  - `download`：直接下载指定 URL 文件
  - `copygitclone`：复制 Git Clone 命令

