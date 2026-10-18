# 目录迁移助手 (link-relay)

在 ZTools 中将任意目录（IDE 扩展/配置、缓存、用户数据等）从系统盘迁移到其他磁盘，通过 Junction/符号链接保持程序无感知运行。出厂 IDE 目录**预设**外置在 `preload/config/presets.json`（仅模板，可整组停用，无图标字段），自定义目录与预设使用同一套「源→目标+链接」模型，统一在单页表格中管理。**不做**多 IDE 插件共享。

## 技术栈

- **语言**: TypeScript 5.3+（strict，禁 `any`，仅 `<script setup>`）
- **前端框架**: Vue 3.5 + Vite 6
- **构建工具**: vue-tsc 2.2
- **包管理**: pnpm
- **后端能力**: Node.js (preload, CommonJS，保持可读、禁压缩混淆)
- **宿主 API**: window.ztools / window.services
- **核心依赖**: @ztools-center/ztools-api-types ^1.0.1

## 常用命令

```bash
pnpm install
pnpm run dev                       # 开发服务器（API 层纯内存 mock，虚拟测试目录，不触盘）
pnpm run build                     # = vue-tsc && vite build，产物到 src-ztools/dist/
pnpm exec vue-tsc --noEmit         # 仅做 TS 类型检查（无独立 typecheck 脚本）
```

## 五层分层与单向数据流（硬约束）

```
services/api（API 层）→ business（业务层）→ store（存储层）→ views/components（视图层）
utils（工具层：枚举常量/纯函数，任意层可复用）；types（纯类型）
```

- **视图层**：`App.vue` 只挂载 `views/Home.vue`；Home 内联页头/KPI/工具栏（这些不单独抽组件），只把**表格**与**弹窗**做成组件；组件纯渲染——只接收 props、emit 事件，不调 api、不推导状态。
- **数据存储层**：唯一 store `stores/migrationStore.ts`，只做 state + get(computed 转发) + actions(取数/写数/迁移编排)；复杂统计/筛选/组装**不写在 store**，下沉 business。
- **业务方法层** `business/`：`dashboard.ts`(配置→VO/KPI 组装)、`selectors.ts`(筛选/计数/分组聚合)，全部纯函数。
- **方法工具层** `utils/`：`enums.ts`(状态/视图/筛选枚举与状态元数据，仿后端 enum 集中复用)、`format.ts`(formatBytes/parseLineList 等)。
- **API 调用层** `services/api.ts`：唯一访问 `window.services` 的出口；dev 无宿主时走纯内存 mock。

## 禁止事项

- **不要直接调用 shell 创建链接** → 使用 `fs.symlinkSync(target, path, process.platform==='win32'?'junction':'dir')`
- **不要在 IDE 进程运行时迁移** → 迁移前强制进程检测，运行中拒绝执行
- **不要直接删除源目录** → 先改名 `.backup-{timestamp}`，验证链接成功后才清理；失败自动回滚
- **不要硬编码路径** → 路径全部来自 `presets.json`/配置，支持 `%ENV%`、`~` 展开
- **不要在代码里另写一份预设** → 预设唯一数据源是 `src-ztools/preload/config/presets.json`（后端 require、前端 mock import 同一份）；预设与 VO **不含** shortName/color 等图标字段，界面不显示品牌图标
- **不要让 dev mock 触碰真实 IDE** → mock 只用虚拟目录 `C:\RelocatorTest\source`、`D:\RelocatorTest\target`，纯内存、零磁盘 IO，禁止出现/读写真实 `.vscode`、`AppData` 等路径
- **表格组件不写业务** → `MappingTable.vue` 只渲染 props、emit 事件；CRUD/状态推导收敛到 store + business
- **不要过度封装组件** → KPI/工具栏/页头直接写在 Home；只有表格与对话框弹窗独立成组件
- **不要跨项目修改文件**，不要改动无故障的 `link-manager/migration-engine/process-checker`

## 目录结构与职责

| 路径 | 职责 |
|------|------|
| `src/App.vue` | 根组件，只 import 并渲染 `views/Home.vue` |
| `src/views/Home.vue` | 唯一页面：内联页头/KPI/工具栏，组装表格+弹窗，负责宿主窗口高度自适应（ResizeObserver→setExpendHeight，clamp 480~900） |
| `src/types/` | 纯类型：`migration.ts`(状态/迁移)、`preset.ts`(L1 预设)、`mapping.ts`(L2 配置+L3 VO)、`ztools.d.ts`、`index.ts`(barrel) |
| `src/utils/enums.ts` | 链接状态/视图/筛选枚举 + STATUS_META(文案/色调/严重度/行操作)，前端唯一事实源（与后端 status-enum.js 同构） |
| `src/utils/format.ts` | formatBytes / parseLineList 通用纯函数 |
| `src/business/dashboard.ts` | 配置+StatusReader → DashboardVO（组装/KPI 纯函数，mock 同构复用） |
| `src/business/selectors.ts` | 筛选匹配 matchFilter、计数 countByFilter、分组/平铺派生 |
| `src/services/api.ts` | window.services 唯一出口 + 纯内存 mock（虚拟测试目录） |
| `src/stores/migrationStore.ts` | 唯一 store：state/get/actions，含迁移状态机编排 |
| `src/components/MappingTable.vue` | 唯一表格（组头+行内聚，纯渲染） |
| `src/components/*Dialog.vue` | Preset/Settings/Mapping/Migrate/Progress 五个对话框弹窗 |
| `src-ztools/preload/config/presets.json` | ★ 出厂预设唯一数据源（外置 JSON） |
| `src-ztools/preload/services.js` | Node 能力入口，注入 window.services |
| `src-ztools/preload/core/` | `status-enum.js`(状态枚举)、`preset-library.js`(读 json+展开+实例化)、`config-store.js`(V2+V1 迁移)、`entry-resolver.js`(配置→VO 唯一出口)、`link-manager.js`、`process-checker.js`、`migration-engine.js` |

## 核心业务规则

### 1. 链接状态分类（枚举集中管理）

| 状态 | 含义 | 行主操作 |
|------|------|---------|
| `linked` | 已链接且指向正确 | 已迁移（禁用，不可勾选） |
| `not-linked` | 未迁移，源为实体目录 | 迁移 |
| `broken` | 链接断裂或指向错误 | 修复 |
| `conflict` | 源与目标都有实体目录 | 修复（用户选 prefer-source/prefer-target） |
| `target-only` | 源不存在、目标有数据 | 重建链接（重装场景） |
| `not-installed` | 预设源目录本机不存在 | 预设行不显示（自定义行始终显示） |
| `unknown` | 无法判定 | — |

停用的预设/行灰显保留（不隐藏、不可勾选、动作置为「已停用」）。

### 2. 迁移前置检查

1. 关联进程未运行（Windows `tasklist`，*nix `ps -A`），运行中拒绝
2. 目标盘可用空间 > 源大小 × 1.1
3. 状态不为 `linked`
4. `conflict` 必须由用户明确选择策略

### 3. 迁移流程

```
前置检查 → 数据复制 → 备份原目录(.backup) → 创建 Junction → 验证链接 → 清理备份
```
进度通过 onProgress(type,data) 两参回调推送；任何步骤失败 → 删链接、恢复备份名、记日志返回错误。

## 编码规范

- TS strict、禁 `any`、显式接口；仅 `<script setup>` Composition API
- IO 异步化避免阻塞 UI；关键操作 try-catch，错误信息含上下文与修复建议
- window.ztools/window.services 必须有类型声明（types/ztools.d.ts）
- 布局自适应：KPI 用 `repeat(auto-fit,minmax(...))`、工具栏 flex-wrap、表格横向滚动、断点 479/767
- 界面文案统一英文首字母大写（如 "Visual Studio Code"）

## 提交前检查清单

- [ ] `pnpm exec vue-tsc --noEmit` 通过
- [ ] `pnpm run build` 通过并刷新 src-ztools/dist
- [ ] 新增宿主调用只出现在 `src/services/api.ts`
- [ ] 类型只放 `src/types/`；枚举/常量只放 `src/utils/enums.ts`；复杂统计只放 `src/business/`
- [ ] 预设改动只改 `presets.json`，且无图标字段回归
- [ ] dev mock 路径全部位于 RelocatorTest 虚拟目录，无真实 IDE 路径、无磁盘写
- [ ] 组件保持纯渲染，KPI/工具栏未被重新拆成多余组件

## 入口文件引用

- CLAUDE.md / GEMINI.md / Cursor 规则：引用本文件，仅追加各自工具链约束
