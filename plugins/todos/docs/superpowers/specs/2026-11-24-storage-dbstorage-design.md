# ZTools dbStorage 单快照存储设计

日期：2026-11-24

## 背景

当前数据分成两套存储：

- 任务与大部分偏好：浏览器 `localStorage` 的 `todos-data`
- 工作空间配置：`window.ztools.dbStorage` 的 `workspace-configs`

这带来几个问题：

- 配置有两个来源，可能不一致
- 任务只存在 `localStorage`，清缓存后容易丢
- 每次 state 变化都会整包重写
- 没有备份与损坏恢复

## 目标

- 主数据统一存到 ZTools `dbStorage`，使用单个版本化快照
- 自动迁移旧 `localStorage` 数据和旧 `workspace-configs`
- 上一版快照自动保留为备份
- 写失败时回退 `localStorage`，避免应用完全不可用
- 只持久化稳定字段，UI 状态变化不触发写入
- 开发模式使用独立 key，避免模拟数据覆盖真实待办

## 非目标

- 本次不切换到 `ztools.db` 文档数据库
- 不实现云端同步
- 不实现文件导出 / 导入（后续可基于快照扩展）

## 存储结构

| Key | 内容 | 位置 |
|-----|------|------|
| `todos-data` | 主快照：版本、workspaces、currentWorkspace、workspaceConfigs、viewMode、layoutMode、taskViewMode、currentDate | `ztools.dbStorage` |
| `todos-data-backup` | 上一版有效快照 | `ztools.dbStorage` |
| `todos-data-dev` | 开发模式主快照 | `ztools.dbStorage` |
| `todos-data-dev-backup` | 开发模式备份 | `ztools.dbStorage` |
| `workspace-configs` | 旧版配置，仅迁移时读取，迁移成功后清理 | `ztools.dbStorage` / `localStorage` |

快照值使用 JSON 字符串，兼容旧版 `workspace-configs` 的存储方式。

## 读取顺序

生产模式 `loadData()`：

1. `dbStorage` 主快照
2. `dbStorage` 备份快照；恢复为主快照
3. 旧 `localStorage` 的 `todos-data`；迁移到 `dbStorage`，成功后清理旧 key
4. 旧 `workspace-configs`；生成默认快照并迁移
5. 都没有则返回 `null`，使用应用初始状态

开发模式使用 `todos-data-dev`，只读自己的主快照 / 备份，不迁移生产数据。

## 写入与备份

- 保存前读取当前主快照
- 如果当前主快照有效且与新内容不同，写入备份 key
- 再写入新主快照
- 如果 `dbStorage` 不可用或写入失败，回退 `localStorage`
- 备份写入失败不影响主数据写入

## AppContext 优化

之前每次 `state` 变化都会重新排一次 500ms 防抖保存。现在用 `useMemo` 只提取持久化字段：

- `workspaces`
- `currentWorkspace`
- `workspaceConfigs`
- `viewMode`
- `layoutMode`（布局模式：`split` / `pool-only`，用户偏好，重启后保留）
- `taskViewMode`（日历任务密度：`tag` / `block`）
- `currentDate`

只有这些字段变化才触发保存；`selectedTaskId`、`searchQuery`、拖拽状态等瞬时 UI 状态不会触发写入。`layoutMode`、`taskViewMode` 虽是界面状态，但代表用户偏好，必须随快照保存，否则重启后会被重置为初始值。

同时移除单独保存 `workspaceConfigs` 的 effect，配置随主快照一起保存。

## 测试

`storageUtils.test.ts` 新增：

- dbStorage 保存 / 读取
- 上一版快照备份
- 主快照损坏时从备份恢复
- 旧 localStorage 迁移
- 旧 workspace-configs 迁移
- 开发 namespace 与生产数据隔离
- 旧配置 key 清理

`AppContext.test.tsx` 更新快速切换测试，验证不同持久化字段变化时防抖仍然生效。

## 验收标准

- 新版本启动后主数据从 `dbStorage` 读取
- 旧 `localStorage` 任务自动迁移，迁移成功后旧 key 被清理
- 旧 `workspace-configs` 自动并入快照，不再单独写入
- 主快照损坏时能读取备份
- 只有持久化字段变化才触发保存
- 开发模式不会覆盖生产数据
- `npm run build` 通过；新增测试通过，既有通过用例不回归
