# 供应商卡片拖拽排序（Drag to Reorder Provider Cards）

> 创建日期：2026-08-14
> 状态：待评审

## 概述

在「供应商」页的卡片网格中，通过**拖拽**调整卡片显示顺序并持久化，常用供应商排在前面，减少查找/切换成本。

---

## 背景

现状供应商列表无手动排序能力：`ProviderStore.listProviders` 按对象键的插入顺序返回，无任何排序规则（`sortOrder` 字段已存在于数据模型，但 `listProviders` 未按它排序）。用户想调整卡片顺序只能「复制后删除重加」，操作繁琐且不可控。

已有基建：

- 供应商对象自带 `sortOrder: number` 字段（`provider-db.ts` 读写均透传，默认 0）
- 页面布局已固定「hero（当前激活）卡片 + 其他供应商网格」，天然适合对「其他供应商」部分做拖拽排序

---

## 交互设计

- **范围**：仅「其他供应商」网格内的卡片可拖拽；当前激活卡片（hero）固定在顶部，**不可拖拽**，也**不在排序范围内**
- **拖拽方式**：按住卡片拖到目标位置松手完成排序（`vue-draggable-plus` / Sortable 内置交互动画与占位，2 列网格下表现为卡片交换）：
  - 被拖卡片悬浮/阴影，目标位实时占位
  - 松手后写入顺序并持久化；拖出网格/按 ESC 取消不落库
- **视觉提示**：卡片在**非激活**状态下 hover 时给出可拖拽暗示（`cursor: grab`，右上角小把手图标可选）；激活中卡片无此提示
- **反馈**：落位后无需额外 toast（视觉已反馈），网络/存储失败时 toast 提示「排序保存失败」并回滚
- 长列表拖拽较麻烦时，**本次不做**「上移/下移」按钮，先以拖拽为主（若后续反馈需要再补）

---

## 数据结构

无需新增字段，复用现有 `sortOrder`：

- `sortOrder: number` 语义为**该供应商在同 App 供应商列表中的位置槽位**，为**固定全局顺序**：当前激活项占据某个槽位（保持原值），网格按 sortOrder 升序展示其余非激活项
- 展示规则：当前激活项始终固定在 hero 置顶展示（**无论其 sortOrder 是多少**）；网格按 sortOrder 升序展示其余非激活项（跳过当前项槽位，视觉上网格仍连续）
- **切换不改变任何 sortOrder**（见技术方案 5），因此用户的排序是「一次性设定、永久生效」的；当前项暂时离开网格，回到网格时仍落回原槽位
- 每次拖拽重排时重编号为**连续整数**（0,1,2,…）；切换/删除/新增不重编号，槽位可能出现间隔（不影响展示，仅排序用）
- 新建/复制供应商默认 `sortOrder = 0`（现状不变），保存后触发一次全量重排归属（见技术方案 6）

---

## 技术方案

### 1. 前端：使用 `vue-draggable-plus`（已安装，v0.6.1）

`vue-draggable-plus` 已存在于 `package.json` dependencies（基于 Sortable.js，支持网格/v-for/触摸），无需新增依赖，直接复用：

- `ProviderListPage.vue` 中对「其他供应商」网格用 `VueDraggable` / `useDraggable` 包裹：
  - `<VueDraggable v-model="gridList" ...>`，`gridList` 为 `otherProviders` 的响应式副本，拖拽自动重排数组（Sortable 内置交换/插入动画与占位）
  - `:group` / `:animation`（如 150ms）使 2 列网格交换过渡自然；`handle` 可选拖拽把手（若仅把手可拖则设为把手选择器）
  - `@end` 事件触发一次 `sortProviders` 持久化（避免每次 move 都写库）
  - hero 卡片不在 `VueDraggable` 内，天然不可拖
- `VueDraggable` 组件通过项目现有的 `unplugin-vue-components` 自动导入（若未配置则手动 `import { VueDraggable } from 'vue-draggable-plus'`）
- `orderedIds` 提交**全量 id 顺序**：以「按 sortOrder 排序的旧完整顺序」为骨架，把网格段替换为 `gridList` 新顺序，**当前激活项保持在其原有索引位不动**（位置 0 前、位置 1 后各段内部保持相对顺序），后端按数组顺序重编号

### 2. 后端：新增 `sortProviders` API

按「API 同步规则」同步 4 个文件：

| 文件                                | 改动                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/preload/providers/provider-db.ts` | 新增 `static sortProviders(appType, orderedIds: string[])`：按 id 顺序为各供应商写连续 `sortOrder`，一次 saveProfile |
| `src/preload/preload.ts`            | `exposeApi()` 中注册 `sortProviders`                                                             |
| `src/types/utools-cctoggle.d.ts`    | `UtoolsCctoggle` 接口新增 `sortProviders(appType, orderedIds)` 类型声明                          |
| `src/utils/browser-adapter.ts`      | `createBrowserApi()` 增加真实实现（`POST /api/provider-sort`）                                   |
| `scripts/dev-api-server.cjs`        | 新增 `POST /api/provider-sort` 路由，调用 `ProviderStore.sortProviders`                          |

**后端实现要点**（provider-db.ts）：

```ts
// orderedIds 为拖拽后的完整新顺序（含当前激活项，前端保证传入全部供应商 id）
static sortProviders(appType: string, orderedIds: string[]): boolean {
  const profile = ProviderStore.ProfileStore.getActiveProfile()
  const appProviders = Object.assign({}, (profile.providers || {})[appType] || {})
  const seen = new Set(orderedIds)
  // 兜底：orderedIds 未覆盖的供应商追加到尾部（防御性，正常不会发生）
  const fullOrder = [...orderedIds, ...Object.keys(appProviders).filter(id => !seen.has(id))]
  fullOrder.forEach((id, idx) => {
    if (appProviders[id]) {
      appProviders[id] = Object.assign({}, appProviders[id], { sortOrder: idx })
    }
  })
  ProfileStore.saveProfile({ id, name, createdAt, providers: { ...profile.providers, [appType]: appProviders } })
  return true
}
```

- 排序**只改 sortOrder**，不动 isCurrent / 配置 / 代理状态，无 CLI 配置重写风险
- `switchProvider` 与 `sortProviders` 互不耦合：切换不写 sortOrder，拖拽不写 isCurrent
- 前端把当前激活项固定在自身索引位后提交全量顺序，后端按数组顺序重编号为连续 0..n-1（当前项也就固定在其槽位）

### 3. 前端组合：`useProviders` 新增 `sortProviders`

- 新增 `sortProviders(orderedIds)`：调用 `getSkillNest().sortProviders(activeTab(), orderedIds)` 后 `loadProviders()`
- 在 `useProviders()` 返回值中导出
- 失败时回滚本地数组（先保存旧数组，失败还原）

### 4. `listProviders` 排序规则

- `ProviderStore.listProviders` 在返回前按 `sortOrder` 升序排列
- **兼容旧数据**：现有数据 `sortOrder` 多为 0 或无，需保证「未拖拽过的供应商」相对顺序稳定——按 `(sortOrder 排序, 同值时 createdAt/插入顺序) 稳定排序`，避免拖一次后列表乱序

### 5. 切换供应商后的排序行为（不写 sortOrder）

**切换（switchProvider）不改动任何 sortOrder**，排序是供应商的全局固定顺序，与激活状态解耦：

- 切换后新激活项移出网格上移 hero；原激活项**按自己的 sortOrder 回到网格中原本的位置**，其余项顺序不变
- 例：排序 `[A(0), B(1), C(2)]`（A 当前激活），网格显示 `[B, C]`。激活 C → hero=C，网格 `[A(0), B(1)]`（A 回到槽位 0）；再激活 B → hero=B，网格 `[A(0), C(2)]`（C 回到原第 2 位）
- 由于不写库、不改序号，切换操作零成本且不会破坏用户已排好的顺序；当前激活项在其非激活期间依然保留原槽位
- 这样也保证了 `sortProviders` 与 `switchProvider` 两个 API 互不耦合：切多少次都不影响已排顺序

### 6. 新增/复制供应商的排序归属

- 默认 `sortOrder = 0`（现状不变）
- 归属规则（防止与已有 0 冲突）：保存后统一**重排**——按 `(sortOrder, createdAt)` 稳定排序后重编号为连续 `0..n-1`
- 效果：新供应商落在「原 sortOrder 为 0 的一批」之后（通常靠前），用户后续可拖拽微调

### 7. 旧数据兼容与迁移（无需数据迁移任务）

**现状**：`sortOrder` 字段自引入以来从未被使用，现存所有供应商该字段**缺失或恒为 0**；`listProviders` 目前按对象键插入顺序返回。

**策略：惰性迁移，不做一次性数据清洗**：

1. **展示兜底**：`listProviders` 排序键为 `(sortOrder ?? 0, createdAt ?? '', 插入序号)`，三条同值时按对象键顺序（= 现有插入顺序）。因此升级后**首次进入页面，列表顺序与升级前完全一致**——用户看到的是熟悉的顺序，无任何跳变
2. **首次拖拽后固化**：用户第一次拖拽某 App 的卡片时，`sortProviders` 对该 App 全部供应商重编号为连续 `0..n-1`。此前所有缺失/为 0 的 sortOrder 一并被修复，此后再进入页面即按新顺序稳定排序
3. **不跑迁移脚本**：不新增 cleanup/migration 逻辑，不批量改写存量 profile；利用「拖拽一次即全量重编号」天然完成迁移。未拖拽过的 App 保持原插入顺序，符合预期（用户没动过就不该变）
4. **新增/复制归属**：新供应商 sortOrder=0，落在 0 号位一批之后，不破坏既有展示（见技术方案 6）

> 结论：旧数据无需处理，展示顺序零变化；只有用户主动拖拽才会触发重编号，且重编号结果等价于「保持用户最终可见顺序」。

---

## 边界情况

| 场景                               | 行为                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| 无「其他供应商」                    | 网格不渲染，无拖拽入口                                                                        |
| 仅 1 个其他供应商                   | 无可拖位置，拖拽无实际效果（不报错）                                                          |
| 拖拽当前激活卡片                   | hero 卡片不在 `VueDraggable` 容器内，直接不可拖                                              |
| 代理运行中拖拽                     | 只改 sortOrder 写 profile，不触碰代理 / CLI 配置，允许                                        |
| 复制/新增供应商                    | 默认 sortOrder=0，保存后按 `(sortOrder, createdAt)` 全量重排归属（技术方案 6）                 |
| 切换供应商后                       | 新激活项上移 hero，原激活项回到网格原槽位（sortOrder 不变），其余顺序不变                       |
| 激活当前已是 hero 的项（重复切换） | 无变化（switchProvider 幂等）                                                                 |
| 拖出网格 / ESC 取消                | Sortable 取消拖拽，不触发 `@end` 持久化                                                        |
| 存储失败                           | 本地回滚 + toast「排序保存失败」                                                              |
| 浏览器开发模式                     | browser-adapter → dev-api-server 路由一致，行为同步                                           |
| 一个 App 内的供应商很多（长列表）  | 网格随页面滚动，Sortable 原生支持跨视口拖拽；暂不加「上移/下移」按钮                          |

---

## 验收标准

1. 「其他供应商」网格中的卡片可拖拽换位，落位顺序与松开位置一致并持久化（刷新/重进插件后保持）
2. 当前激活卡片（hero）不可拖拽
3. `listProviders` 返回顺序按 `sortOrder` 升序；未拖拽过的供应商相对顺序不因首次拖拽而乱序
4. 拖拽过程有明确的视觉反馈（hover 可拖、拖拽高亮、目标位指示）
5. ESC / 拖出网格取消不产生任何持久化
6. 排序失败时本地回滚并 toast 提示
7. 代理运行中排序不影响代理状态与 CLI 配置
8. 浏览器开发模式（`dev:browser`）下拖拽排序行为一致（dev-api-server 已支持 `POST /api/provider-sort`）
9. `sortProviders` 仅更新 sortOrder，不改变 isCurrent / apiKey / 其他配置字段
10. **切换供应商后**：新激活项上移 hero，原激活项回到网格原槽位，其余卡片顺序保持不变；多次来回切换不破坏已排顺序
11. **旧数据兼容**：升级前存在的供应商（sortOrder 缺失/全 0），首次进入页面顺序与升级前完全一致；拖拽一次后全 App 重编号为连续 0..n-1
