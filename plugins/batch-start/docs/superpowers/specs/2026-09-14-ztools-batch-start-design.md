# ZTools 应用扫描 / 分类 / 批量启动插件 — 设计文档

**日期：** 2026-09-14  
**仓库：** https://github.com/ArthurYang999/zTools--.git  
**参考文档：** [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html)、[插件 API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)

## 1. 目标

做一个 ZTools 插件，支持：

1. **扫描应用**：系统已安装应用 + 用户自定义目录  
2. **手动分类**：用户自建分类并分配应用  
3. **启动组**：勾选应用组成启动组；保存后注册为 ZTools Feature/指令，主搜索点选即可批量启动  

成功标准：用户配置好启动组后，在 ZTools 输入组名 → 点击指令 → 组内应用几乎同时启动。

## 2. 非目标（本期不做）

- 自动按规则分类  
- 组内启动间隔配置（本期固定「几乎同时」）  
- `.ps1` / `.vbs` 等脚本类型（可后续扩展）  
- 云同步 / 多设备共享配置  

## 3. 技术选型

| 项 | 选择 |
|----|------|
| 模板 | Vue 3 + TypeScript + Vite（`@ztools-center/plugin-cli`） |
| 持久化 | `ztools.db` |
| 启动 | `ztools.shellOpenPath` |
| 图标 | `ztools.getFileIcon` |
| 指令 | `ztools.setFeature` / `removeFeature` + `onPluginEnter` |
| 架构 | 模块化：平台扫描器 → 应用库/分类 → 启动组 → Feature 同步 |

## 4. 整体架构

```
Vue UI（管理页）
    │
Preload 服务层
  AppLibrary · Category · LaunchGroup · FeatureSync · Launcher
    │
 ScannerWin / ScannerMac / ScannerLinux
    │
 ztools.db + setFeature + shellOpenPath
```

- **管理入口**：主 Feature（如「批量启动」）打开完整管理 UI。  
- **启动入口**：每个启动组一个独立 Feature；`onPluginEnter` 按 `code` 批量启动后 `outPlugin`，不打开管理页。

## 5. 数据模型

### 5.1 `app:<id>`

| 字段 | 说明 |
|------|------|
| `_id` | `app:<uuid>` |
| `name` | 显示名 |
| `path` | 可启动路径 |
| `icon` | 可选，缓存的 icon data URL |
| `source` | `scan` \| `manual` |
| `categoryId` | 分类 id，未分类为 `null` |
| `platform` | `win32` \| `darwin` \| `linux` |

### 5.2 `category:<id>`

| 字段 | 说明 |
|------|------|
| `_id` | `category:<uuid>` |
| `name` | 分类名 |
| `order` | 排序 |

### 5.3 `group:<id>`

| 字段 | 说明 |
|------|------|
| `_id` | `group:<uuid>` |
| `name` | 显示名 / 默认指令文本 |
| `cmds` | 触发指令列表（至少含 `name`） |
| `appIds` | 应用 id 数组 |
| `order` | 排序 |
| `featureSynced` | 是否已成功同步 Feature |

### 5.4 `settings`

| 字段 | 说明 |
|------|------|
| `_id` | `settings` |
| `customScanDirs` | 自定义扫描目录字符串数组 |
| `lastScanAt` | 上次扫描时间戳 |

## 6. 核心流程

### 6.1 扫描

1. 按 `process.platform` 选择适配器。  
2. 扫描系统源 + `settings.customScanDirs`。  
3. 按 `path` 去重合并；已有记录保留 `categoryId` 与手动改名。  
4. 新发现的应用写入 `app:*`，默认 `categoryId = null`。

**Windows 系统源：** 开始菜单 `.lnk`（解析后记录目标路径与显示名）。  
**Windows 自定义目录 / 可加入启动组的类型：** `.exe`、`.bat`、`.cmd`、`.lnk`（不限 exe）。  
**macOS：** `/Applications`、`~/Applications` 的 `.app` + 自定义目录。  
**Linux：** `.desktop`（`/usr/share/applications`、`~/.local/share/applications`）+ 自定义目录可执行文件。

手动添加：文件选择器可选上述平台对应类型，写入 `source: manual`。

### 6.2 分类

- UI 新建 / 重命名 / 删除分类。  
- 将应用分配到分类；「未分类」为虚拟视图。  
- 删除分类时，其下应用回到未分类（不删应用）。

### 6.3 启动组与 Feature 同步

保存启动组时：

1. 校验：名称非空、至少 1 个应用、指令不与其他组冲突。  
2. 写入 `group:<id>`。  
3. `FeatureSync`：  
   - `ztools.setFeature({ code: 'group:<id>', explain: '...', cmds: group.cmds })`  
   - 删除组：`ztools.removeFeature('group:<id>')`  
4. 同步失败：本地仍保存，`featureSynced = false`，UI 标红并提供重试。

插件加载 / 进入管理页时：用本地 `group:*` 对账，补齐缺失 Feature、移除孤儿 Feature。

### 6.4 批量启动

1. 解析组内 `appIds` → 路径列表。  
2. **几乎同时**对每个路径调用 `ztools.shellOpenPath`（不设间隔）。  
3. 汇总成功 / 失败；`showToast` 提示。  
4. 若由 Feature 指令触发：启动后 `outPlugin()`。

路径失效或打开失败：跳过该项，不中断整组。

## 7. UI 结构

单页管理界面：

1. **顶栏**：扫描、添加自定义目录、试跑当前组  
2. **左栏**：分类列表（含未分类）  
3. **中栏**：应用列表（搜索、勾选、改分类）  
4. **右栏**：启动组列表与编辑（成员、指令名）

空状态：引导首次扫描；无启动组时引导创建第一组。

## 8. 插件 Feature 规划

| code | 用途 |
|------|------|
| `manage` | 打开管理 UI；`cmds`：`批量启动`、`应用启动组` |
| `group:<id>` | 动态；启动对应组 |

`plugin.json` 静态声明主管理 Feature；组 Feature 全部运行时 `setFeature`。

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| 路径失效 / 启动失败 | 跳过，Toast「成功 n / 失败 m」 |
| 组名空 / 指令冲突 | 禁止保存并提示 |
| 扫描目录不存在 / 无权限 | 跳过该源，继续其余 |
| Feature 同步失败 | 本地保存 + 标红重试 |
| 组内 0 应用 | 禁止注册 Feature |

## 10. 测试要点

- 启动组 CRUD 与 Feature 增删一致（含重启后对账）。  
- Windows：`.exe` / `.bat` / `.cmd` / `.lnk` 均可进组并启动。  
- 三端扫描适配器至少各有一条冒烟路径（真机或 mock）。  
- 批量启动部分失败时仍启动有效项并正确汇总。

## 11. 仓库与工程

- 工作区：`zTools-BatchStart`  
- Git remote：`origin` → `https://github.com/ArthurYang999/zTools--.git`  
- 用 `ztools create` 脚手架后，在本仓库实现上述模块，而非另起无关目录结构。

## 12. 实现顺序（供后续 plan 使用）

1. CLI 脚手架 + remote + 主 Feature 空壳 UI  
2. db 模型与 AppLibrary / Category CRUD  
3. 三端 Scanner + 自定义目录 + Windows 多扩展名  
4. LaunchGroup + Launcher（并行 shellOpenPath）  
5. FeatureSync + `onPluginEnter` 分流（管理 vs 组启动）  
6. 管理页联调与空状态 / 错误态  
```
