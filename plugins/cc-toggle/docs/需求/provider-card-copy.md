# 供应商卡片复制（Duplicate Provider）

> 创建日期：2026-08-06
> 状态：待评审

## 概述

供应商卡片增加「复制」按钮，一键生成副本：继承全部配置（含 API Key），新 id、默认名加后缀、不激活。

---

## 背景

用户常基于现有供应商微调出新供应商（同 baseUrl/Key，只换模型或名称）。现状只能「+ 添加供应商」手动重填或对照编辑，繁琐且易漏字段（如 extraHeaders、settingsConfig 等高级项）。

---

## 交互设计

- 按钮位置：卡片操作区，按钮顺序 切换 / 编辑 / 复制 / 删除；Full 布局与 Compact 布局一致
- 样式：`n-button quaternary size="tiny"`，与「编辑」同级
- 点击直接执行，无确认弹窗（非破坏性操作）
- 成功后 toast「已复制 {名称}」，列表立即刷新展示新卡片

---

## 复制规则

| 字段      | 处理                                   |
| --------- | -------------------------------------- |
| id        | 重新生成（saveProvider 走 generateId） |
| name      | `{原名} (copy)`                        |
| isCurrent | 强制 false                             |
| createdAt | 当前时间（置空由 saveProvider 生成）   |
| sortOrder | 0                                      |
| apiKey    | 一并复制（getProvider 返回明文 Key）   |
| 其余字段  | 全量原样复制                           |

不继承代理路由组成员关系（路由组按 providerId 引用），副本需用户手动加入。

---

## 技术方案（前端组合，不新增 preload API）

复用 `getProvider` + `saveProvider` 闭环，避免 4 文件同步成本：

1. **`src/components/provider/ProviderCard.vue`**
   - `defineEmits` 增加 `copy`
   - 两处布局在「编辑」与「删除」之间插入复制按钮，`@click="emit('copy', provider.id)"`

2. **`src/composables/useProviders.ts`**
   - 新增 `copyProvider(id)`：
     ```ts
     const full = getFullProvider(id) // 含 apiKey
     if (!full) return warning
     delete full.id
     delete full.appType
     full.isCurrent = false
     full.name = full.name + ' (copy)'
     full.createdAt = ''
     full.sortOrder = 0
     saveProvider(activeTab(), full) // 内部已 loadProviders
     success('已复制 ' + full.name)
     ```
   - 在 `useProviders()` 返回值中导出

3. **`src/views/ProviderListPage.vue`**
   - hero 卡片与 compact 列表两处 `ProviderCard` 增加 `@copy="copyProvider"`

### 为何不加 duplicateProvider preload 方法

- `getProvider` 已返回 apiKey，`saveProvider` 可建新条目，现有 API 足够
- 新增 preload 方法需同步 preload.ts / ztools-cctoggle.d.ts / browser-adapter.ts / dev-api-server.cjs，本需求下收益为零
- 若后续要求 apiKey 不经前端流转，再下沉为后端方法，届时按 API 同步规则补齐 4 文件

---

## 边界情况

| 场景               | 行为                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 复制当前激活供应商 | 允许；副本不激活，不重写 CLI 配置（saveProvider 的 reapply 仅对 isCurrent 副本生效，副本 isCurrent=false 不触发） |
| 名称重复           | `(copy)` 后缀可叠加；saveProvider 本就无名称唯一性校验，与现状一致                                                |
| 代理运行中         | 复制只写 profile，不触碰代理状态                                                                                  |
| 源供应商不存在     | getFullProvider 返回 null，toast 提示后中止                                                                       |

---

## 验收标准

1. Full 与 Compact 两种布局均有复制按钮，点击后列表新增卡片
2. 副本字段与源完全一致（除 id / name / isCurrent / createdAt / sortOrder）
3. API Key 随副本继承：切换到副本后无需重填 Key 即可直接使用
4. 浏览器开发模式（browser-adapter → dev-api-server）行为一致
5. 复制激活中的供应商不改变当前激活状态、不重写任何 CLI 配置文件
