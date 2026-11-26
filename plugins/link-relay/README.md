# 目录迁移助手 (link-relay)

> ZTools 插件：把任意目录（IDE 扩展/配置、缓存、用户数据等）从系统盘迁移到其他磁盘，通过 Junction/符号链接保持程序无感知运行。内置常见 IDE 目录**预设**（外置 config.json，仅模板，可整组停用），自定义目录与预设使用同一套「源 → 目标 + 链接」模型，统一在单页表格中管理。**不做**多 IDE 插件共享。

## 功能特性

- **通用目录迁移** — 不绑定具体软件，任何「源目录 → 目标目录 + 链接」的需求都可配置
- **预设外置配置** — 出厂预设集中在 `preload/config/presets.json`，增删改预设只改 JSON，不写逻辑；界面不展示任何品牌图标
- **Junction 无感知链接** — Windows Junction / 符号链接，程序完全感知不到数据已迁移
- **自定义目录** — 与预设同一套数据模型，统一在一张表格管理（.npm、.m2、.gradle、浏览器缓存等）
- **系统重装恢复** — `target-only` 状态一键重建链接，重装后无需重新下载
- **冲突处理** — 源与目标都存在实体目录时支持 prefer-source / prefer-target 两种策略
- **安全回滚** — 任何步骤失败自动回滚，源目录先备份为 `.backup-{timestamp}` 再操作

## 架构分层（单一职责 + 单向数据流）

```
services/api（API 调用层） → business（业务方法层） → store（数据存储层） → views/components（视图层）
        ↑ 唯一访问 window.services        ↑ 统计/筛选/组装纯函数    ↑ 只做 state/get/action 编排
utils（方法工具层：枚举常量、格式化纯函数，被任意层复用）
types（纯类型，无逻辑）
```

| 层 | 位置 | 职责 |
|----|------|------|
| 视图层 | `App.vue` / `views/Home.vue` / `components` | App 只挂载 Home；Home 内联页头/KPI/工具栏，表格与弹窗为组件；组件纯渲染、只 emit 事件 |
| 数据存储层 | `stores/migrationStore.ts` | 唯一 store：state + get(computed 转发) + actions(取数/写数/迁移编排)，不写复杂规则 |
| 业务方法层 | `business/dashboard.ts`、`business/selectors.ts` | 配置→VO 组装、KPI 统计、筛选匹配、分组聚合等纯函数 |
| 方法工具层 | `utils/enums.ts`、`utils/format.ts` | 状态枚举与元数据（仿后端 enum，集中复用）、字节/列表解析等通用纯函数 |
| API 调用层 | `services/api.ts` | 唯一访问 `window.services` 的出口；无宿主时用**纯内存 mock**（专用虚拟测试目录，不触盘） |

领域模型仍分三层：L1 预设（`presets.json` 只读模板）→ L2 配置（`MappingConfig`/`GroupConfig`，dbStorage 持久化、表格唯一数据源）→ L3 视图 VO（`MappingRowVO`/`GroupVO`/`DashboardVO`，实时检测生成、不持久化）。

### 链接状态（枚举集中管理）

| 状态 | 含义 | 主操作 |
|------|------|--------|
| `linked` | 已链接且指向正确 | 已迁移（禁用） |
| `not-linked` | 未迁移，源为实体目录 | 迁移 |
| `broken` | 链接断裂或指向错误 | 修复 |
| `conflict` | 源与目标都有实体目录 | 修复 |
| `target-only` | 仅目标有数据 | 重建链接 |
| `not-installed` | 预设目录不存在 | 预设行不显示（自定义行始终显示） |
| `unknown` | 无法判定 | — |

状态的文案/色调/严重度/行操作统一在 `src/utils/enums.ts`（前端）与 `src-ztools/preload/core/status-enum.js`（后端）两处同构维护。

## 技术栈

- **前端**: Vue 3.5（`<script setup>`）+ TypeScript strict + Vite 6
- **后端**: Node.js CommonJS preload
- **宿主**: ZTools（`window.ztools` / `window.services`）
- **包管理**: pnpm

## 快速开始

```bash
pnpm install
pnpm run dev      # 开发模式（API 层内置纯内存 mock，使用虚拟测试目录，不触碰真实 IDE）
pnpm run build    # 类型检查 + 生产构建到 src-ztools/dist/
```

## 项目结构

```
├── src/
│   ├── App.vue                      # 根组件：只挂载 Home
│   ├── views/Home.vue               # 唯一页面：内联页头/KPI/工具栏，组装表格与弹窗 + 窗口高度自适应
│   ├── types/                       # 纯类型：migration / preset / mapping / ztools
│   ├── utils/
│   │   ├── enums.ts                 # 状态/视图/筛选枚举与状态元数据（集中复用）
│   │   └── format.ts                # formatBytes / parseLineList 等纯函数
│   ├── business/
│   │   ├── dashboard.ts             # 配置 → DashboardVO（组装/KPI 纯函数，mock 同构复用）
│   │   └── selectors.ts             # 筛选匹配、计数、分组/平铺派生
│   ├── services/
│   │   └── api.ts                   # window.services 唯一出口 + 纯内存 mock（虚拟测试目录）
│   ├── stores/
│   │   └── migrationStore.ts        # 唯一 store：state/get/actions
│   └── components/                  # 只封装表格与弹窗
│       ├── MappingTable.vue         # 唯一表格（组头/行内聚，纯渲染，只 emit）
│       ├── PresetDialog.vue         # 预设开关
│       ├── SettingsDialog.vue       # 全局设置
│       ├── MappingDialog.vue        # 添加/编辑映射
│       ├── MigrateDialog.vue        # 迁移预览与选项
│       └── ProgressDialog.vue       # 迁移进度/日志
├── src-ztools/
│   ├── plugin.json
│   ├── preload/
│   │   ├── config/presets.json      # ★ 出厂预设唯一数据源（外置 JSON，无图标字段）
│   │   ├── services.js              # 服务入口，注入 window.services
│   │   └── core/
│   │       ├── status-enum.js       # 状态枚举与语义（后端唯一事实源）
│   │       ├── preset-library.js    # 读取 presets.json + 环境变量展开 + 实例化
│   │       ├── config-store.js      # 配置持久化（V2 + V1 迁移）
│   │       ├── entry-resolver.js    # 配置 → VO 唯一出口
│   │       ├── link-manager.js      # Junction/链接管理
│   │       ├── process-checker.js   # 进程检测
│   │       └── migration-engine.js  # 迁移引擎（复制/备份/建链/回滚）
│   └── dist/
└── package.json
```

## 内置预设（presets.json）

| 预设 | id | 典型目录 |
|------|----|---------|
| Visual Studio Code | `vscode` | `~/.vscode`、`%APPDATA%\Code` |
| Cursor | `cursor` | `~/.cursor`、`%APPDATA%\Cursor` |
| Qoder IDE | `qoder` | `~/.qoder`、`%APPDATA%\Qoder` |
| Qoder CN | `qoder-cn` | `~/.qoder-cn`、`%APPDATA%\QoderCN` |
| Windsurf | `windsurf` | `~/.codeium/windsurf`、`%APPDATA%\Windsurf` |
| VSCodium | `vscodium` | `~/.vscode-oss`、`%APPDATA%\VSCodium` |
| Trae | `trae` | `~/.trae`、`%APPDATA%\Trae` |

预设只是模板：不勾选不会产生配置行；任意目录都可通过「添加映射」手动配置。

## 开发与测试隔离

- `pnpm dev` 下不存在 `window.services`，`services/api.ts` 走**纯内存 mock**：所有路径都落在虚拟目录 `C:\RelocatorTest\source` 与 `D:\RelocatorTest\target`，**不进行任何磁盘 IO，绝不读取/修改真实 IDE 数据**。
- 真实迁移只在 ZTools 宿主内、由 preload 引擎执行，并强制进程检测、备份与回滚。

## 安全规范

- 使用 `fs.symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')` 原生 API，Windows 无需管理员权限
- 迁移前强制检测关联进程，运行中拒绝执行
- 源目录先重命名为 `.backup-{timestamp}`，验证链接成功后才清理
- 路径全部来自配置/预设，支持 `%ENV%` 与 `~` 展开，不在代码中硬编码

## 开源协议

MIT License
