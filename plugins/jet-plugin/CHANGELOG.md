# 更新日志

## [1.1.0] - 2026-09-17

### 新增

- macOS 应用扫描改为直接读取 bundle 的 `Contents/Info.plist`（`plutil`），不再依赖 Spotlight 索引，未被索引的目录也能正确枚举
- 应用信息新增 `appSource`、`appLastUsedDate`、`appLastUsedTimestamp`、`appUseCount` 字段
- 项目列表副标题展示所属 IDE 与 IDE 最近使用时间：`路径 · IDE名 · 最近使用 MM-DD HH:mm`
- IDE 扫描结果使用 `ztools.dbStorage` 缓存（TTL 5 分钟，命中且较旧时后台刷新），重复进入插件秒开
- `plugin.json` 声明支持平台 `darwin` / `win32`

### 修复

- 修复 Spotlight 索引缺失时应用被静默丢弃的问题（`/Applications` 少 5 个、用户目录 `~/Applications` 全部丢失）
- 修复 `appInstallDate` 取到索引重建时间的问题，改用文件系统创建时间
- 修复项目路径包含空格时无法启动的问题（应用路径与项目路径统一加引号）
- 单个 IDE 的 `product-info.json` / `recentProjects.xml` 解析异常不再中断整个初始化；启动失败时用系统通知提示

### 优化

- 目录枚举改用 `fs.readdir`（不再走 shell `ls`），mdls 与 Info.plist 读取并行，全量扫描由约 548ms 降至约 390ms
- 清理初始化流程中的调试日志，统一各平台字段，避免上层处理 `undefined`
