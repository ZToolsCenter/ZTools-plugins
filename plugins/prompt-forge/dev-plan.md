## 20260526
## 新设计 vs 现有代码 对比分析

### 1. 导航结构

| | 现有 | 新设计 |
|---|---|---|
| 顶栏 | 调用 / 组合 / 编辑 | **空间 / 组合 / 管理** |
| 左侧栏 | 分类 + 标签 | **最近 / 收藏 / 项目 / 资产 / 回收站** |

**可行性**：顶栏重命名简单，左侧栏从分类筛选改为固定导航 + 内容区切换，需要重构路由和 PromptStore 的筛选逻辑。

### 2. 数据模型

| | 现有 | 新设计 |
|---|---|---|
| type | `'prompt' \| 'fragment'` | `'prompt' \| 'snippet' \| 'template' \| 'constraint'` |
| 分类 | `category: string` | **`projectId` 关联到 Project** |
| 删除 | 硬删除 | **软删除 `deleted?: boolean`** |
| 新增 | 无 | **`description`、`Project` 实体** |
| 版本 | `snapshots[]` | **去掉版本快照** |
| status | `active/draft/archived` | **去掉** |

**可行性**：这是破坏性变更，数据模型需要全部重写。但现有代码的 `Variable`、`createdAt/updatedAt`、`usageCount` 可以保留。

### 3. 存储层

| | 现有 | 新设计 |
|---|---|---|
| 方案 | preload kvStorage + dbStorage fallback | **ZTools Storage API 直接调用** |

**可行性**：现有 storage.ts 已经封装了 `ztools.dbStorage`，新设计要求去掉 preload 层。实际上现有代码已经支持纯 `ztools.dbStorage` 模式（preload 为 fallback），所以**这一项基本已满足**。

### 4. 搜索

| | 现有 | 新设计 |
|---|---|---|
| 方案 | 手写权重搜索 | **Fuse.js** |

**可行性**：需要安装 `fuse.js` 依赖，替换 prompt.ts 中的 `search()` 函数。改动量小，约 30 行。

### 5. 项目管理

| 现有 | 新设计 |
|---|---|
| 无 | **5 个固定分组：开发/学习/写作/研究/其他** |

**可行性**：需要新增 `Project` 实体和 `projectStore`，PromptItem 添加 `projectId` 字段。项目管理逻辑不复杂（仅一级分组），但需要新增页面和路由。

### 6. 回收站

| 现有 | 新设计 |
|---|---|
| 硬删除 `confirm + filter` | **软删除 + 恢复 + 永久删除** |

**可行性**：只需在 PromptItem 加 `deleted?: boolean`，筛选时默认排除 deleted 项，回收站页面列出 deleted 项。改动量小。

### 7. 组合页

| 现有 | 新设计 |
|---|---|
| 三栏 grid（基础/画布/片段） | **更简洁：基础 + 添加片段 + 预览** |

**可行性**：现有 ComposeView 逻辑可复用，只需简化布局。新设计明确说"不要流程图、不要 Agent 编排"，现有实现已符合。

### 8. UI 风格

| 现有 | 新设计 |
|---|---|
| 自定义浅/深色主题 | **类 Raycast/Linear 风格** |

**可行性**：CSS 变量系统可以保留，调整配色和间距即可。

---

## 结论：不需要全部重写

### 可直接复用的（约 40%）

- `utils/index.ts` — 变量提取、渲染、哈希、相似度检测
- `utils/platform.ts` — ZTools API 封装
- `utils/storage.ts` — KV 存储（已兼容 ztools.dbStorage）
- `components/FillPanel.vue` — 变量填写 + 预览
- main.css — CSS 变量和设计系统
- 主题逻辑（`theme.ts`）

### 需要重写的（约 60%）

- `types/index.ts` — 数据模型（新增 Project、去掉 Snapshots/Status）
- `stores/prompt.ts` — 新增最近记录、收藏、回收站逻辑
- **新增** `stores/project.ts` — 项目管理
- **新增** `stores/recent.ts` — 最近使用记录
- 顶栏 CommandBar.vue — 空间/组合/管理
- 左侧导航 — 最近/收藏/项目/资产/回收站
- CallView.vue → 重命名为 `SpaceView.vue`（空间页）
- LibraryView.vue → 重命名为 `ManageView.vue`（管理页）
- 搜索替换为 Fuse.js

### 建议的开发顺序（MVP）

1. 数据模型迁移（Project + PromptItem 重定义 + 软删除）
2. 顶栏 + 左侧导航骨架
3. 空间页（最近/收藏/资产筛选）
4. Fuse.js 搜索替换
5. 回收站
6. 项目管理
7. 管理页（编辑器）
8. 组合页简化
9. 主题适配新风格

**这是一个"选择性重写"，不是从零开始。** 核心工具层和设计系统可以保留，主要工作在数据模型、路由、和页面布局上。