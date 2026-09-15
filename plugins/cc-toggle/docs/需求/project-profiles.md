# 项目配置方案（Project Profiles）

## 概述

为 CCToggle 添加「项目」维度的配置管理，支持为不同项目保存不同的 AI 工具供应商配置方案，一键切换项目即可整体切换所有 AI 工具的供应商配置。

---

## 背景

当前 CCToggle 的供应商切换是全局的，切换 Claude 的供应商会影响所有使用场景。用户在同时开发多个项目时，可能需要：

- 项目 A：Claude 用 DeepSeek，Codex 用 MiMo
- 项目 B：Claude 用火山，Codex 用千问
- 项目 C：Claude 用 Claude Official，Gemini 用 Google Official

需要一个「项目」维度来隔离不同项目的配置。

---

## 核心概念

### 项目（Project Profile）

- 保存各 agent 的供应商选择
- 新建时保存当前各 agent 的供应商选择
- 同一时间只有一个项目处于激活状态
- 激活项目 = 恢复该项目保存的供应商配置

### 配置范围

| 配置   | 是否跟项目 |
| ------ | ---------- |
| 供应商 | ✓ 跟项目   |
| 路由   | ✗ 全局共享 |
| 设置   | ✗ 全局共享 |

### 配置映射

```
项目 → {
  providers: { claude: {...}, codex: {...} }
}
```

---

## 数据结构

### ProjectProfile

```ts
interface ProjectProfile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  providers: Record<string, Record<string, Provider>> // appType → providerId → Provider
}
```

### 示例

```json
{
  "id": "proj_abc123",
  "name": "前端重构",
  "createdAt": "2026-08-05T10:00:00Z",
  "updatedAt": "2026-08-05T10:00:00Z",
  "providers": {
    "claude": {
      "deepseek_001": { "name": "DeepSeek", "baseUrl": "...", "model": "deepseek-coder" }
    },
    "codex": {
      "mimo_003": { "name": "MiMo", "baseUrl": "...", "model": "mimo-coder" }
    }
  }
}
```

---

## 功能需求

### 1. 项目管理

#### 1.1 项目列表

- 显示所有已创建的项目
- 高亮当前激活的项目
- 支持新建、编辑、删除操作

#### 1.2 新建项目

- 输入项目名称（必填）
- 自动保存当前各 agent 的供应商选择为项目配置

#### 1.3 改名

- 修改项目名称

#### 1.4 删除项目

- 删除前确认
- 若删除的是当前激活项目，则取消激活状态

---

### 2. 项目切换

#### 2.1 激活项目

- 点击项目卡片激活
- 激活时遍历项目的 `configs`：
  - 对每个配置了的 `appType`，调用 `switchProvider(appType, providerId)`
  - 未配置的 `appType` 保持当前状态不变
- 记录当前激活的项目 ID

#### 2.2 取消激活

- 再次点击已激活的项目可取消激活
- 取消激活后，各 AI 工具的供应商保持当前状态

#### 2.3 持久化

- 激活的项目 ID 需持久化存储
- 应用重启后自动恢复上次激活的项目配置

---

### 3. UI 交互

#### 3.1 入口位置

**主入口：TabBar 左侧项目选择器**

```
┌──────────────────────────────────────────────────────────────┐
│ [📁 前端重构 ▼]  [Claude] [Codex] [Gemini]  代理  📊 🔧 ⚙️ │
└──────────────────────────────────────────────────────────────┘
```

- 在 TabBar 最左侧添加项目选择下拉菜单
- 显示当前激活的项目名称
- 下拉菜单包含：
  - 项目列表（点击切换）
  - 「全局默认」选项
  - 分割线
  - 「新建项目」
  - 「管理项目」→ 跳转项目管理页

**次入口：设置页新增「项目管理」子页面**

```
设置
├── Claude 配置
├── 路由管理
├── 项目管理    ← 新增
├── 存储管理
└── 关于
```

#### 3.2 项目管理页

项目列表卡片：

```
┌─────────────────────────────────────────┐
│  📁 前端重构                    [激活]   │
│  ─────────────────────────────────────  │
│  Claude: DeepSeek                       │
│  Codex: MiMo                            │
│  ─────────────────────────────────────  │
│  [改名]  [删除]                         │
└─────────────────────────────────────────┘
```

#### 3.3 改名弹窗

- 项目名称输入框

#### 3.4 项目切换流程

```
点击项目选择器下拉
  → 显示项目列表
  → 点击目标项目
  → 调用 activateProfile(id)
  → 遍历 configs 调用 switchProvider
  → 刷新页面显示
  → 持久化激活状态
```

---

## 交互流程

### 新建项目

```
点击「新建项目」
  → 输入名称
  → 自动保存当前各 agent 的供应商选择
  → 创建项目
```

### 切换项目

```
点击项目卡片
  → 确认切换
  → 遍历 configs 调用 switchProvider
  → 高亮当前项目
  → 持久化激活状态
```

---

## 存储方案

### 设计思路

**每个项目 = 一套供应商配置**，只包含各 agent 的供应商选择。

路由、设置等保持全局共享。

现有供应商配置迁移为「全局默认」项目。

### DB 结构

#### 核心 Key

| Key                             | 说明                          |
| ------------------------------- | ----------------------------- |
| `cctoggle_profile_{profileId}`  | 项目/配置方案（完整配置根）   |
| `cctoggle_active_profile`       | 当前激活的项目 ID             |
| `apikey_{appType}_{providerId}` | API Key（加密存储，保持独立） |

#### 项目文档结构

```ts
cctoggle_profile_{profileId} = {
  _id: "cctoggle_profile_proj_abc",
  id: "proj_abc",
  name: "前端重构",
  createdAt: "2026-08-05T10:00:00Z",
  updatedAt: "2026-08-05T10:00:00Z",

  // 供应商（按 appType 分组）
  providers: {
    "claude": {
      "deepseek_001": {
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-coder",
        // ...其他供应商字段
      },
      "volcengine_002": { ... }
    },
    "codex": {
      "mimo_003": { ... }
    }
  }
}
```

#### 全局默认项目

现有供应商配置迁移为 `cctoggle_profile_default`：

```ts
cctoggle_profile_default = {
  _id: 'cctoggle_profile_default',
  id: 'default',
  name: '全局默认'
  // ...现有供应商配置迁入
}
```

### 示例

```json
// 项目A：前端开发
{
  "_id": "cctoggle_profile_proj_frontend",
  "id": "proj_frontend",
  "name": "前端重构",
  "providers": {
    "claude": {
      "deepseek_001": { "name": "DeepSeek", "baseUrl": "...", "model": "deepseek-coder" }
    },
    "codex": {
      "mimo_003": { "name": "MiMo", "baseUrl": "...", "model": "mimo-coder" }
    }
  }
}

// 项目B：后端开发
{
  "_id": "cctoggle_profile_proj_backend",
  "id": "proj_backend",
  "name": "后端开发",
  "providers": {
    "claude": {
      "volcengine_002": { "name": "火山引擎", "baseUrl": "...", "model": "doubao-coder" }
    },
    "codex": {
      "qianwen_004": { "name": "通义千问", "baseUrl": "...", "model": "qwen-coder" }
    }
  }
}

// 当前激活
"cctoggle_active_profile" = "proj_frontend"
```

### 优点

| 优点   | 说明                      |
| ------ | ------------------------- |
| 隔离性 | 项目间配置完全独立        |
| 便携性 | 单个文档可导出/导入       |
| 清晰性 | 一个项目 = 一个文档       |
| 兼容性 | 全局配置就是 default 项目 |

---

## API 设计

### Preload API

```ts
// 项目 CRUD
listProjects(): ProjectProfile[]
getProject(id: string): ProjectProfile | null
saveProject(data: Partial<ProjectProfile>): string  // 返回 id
deleteProject(id: string): void

// 项目激活
activateProject(id: string): SuccessResult
deactivateProject(): void
getActiveProjectId(): string | null

// 快捷操作
applyProject(id: string): Record<string, SuccessResult>  // 应用项目配置
```

---

## 边界情况

1. **供应商被删除**：项目中引用的供应商被删除时，激活项目应跳过该配置或提示
2. **项目配置冲突**：激活项目时，若某 AI 工具正在使用代理，应先停止代理再切换
3. **空项目**：激活一个没有任何配置的项目，不改变任何当前状态
4. **重复激活**：激活已激活的项目，无操作

---

## 兼容性设计

### 现有配置的定位

项目功能上线前已配置的供应商，视为**全局默认配置**。

- 不属于任何项目
- 当无项目激活时，使用全局配置
- 当激活项目时，项目内配置的 AI 工具切换到项目供应商，未配置的保持全局配置

### 状态优先级

```
激活项目配置 > 全局默认配置
```

| 状态                            | Claude 配置来源 | Codex 配置来源 |
| ------------------------------- | --------------- | -------------- |
| 无项目激活                      | 全局            | 全局           |
| 项目A激活（配置了Claude）       | 项目A           | 全局           |
| 项目A激活（配置了Claude+Codex） | 项目A           | 项目A          |

### 迁移策略

- 无需迁移，现有配置自动成为全局默认
- 用户可选择将全局配置「保存为项目」快速创建项目

---

## 迁移方案

### 迁移时机

preload 初始化时检测并执行迁移，用户无感。

### 迁移步骤

```ts
function migrateToProfileStructure() {
  // 1. 检查是否已迁移
  if (ztools.db.get('cctoggle_profile_default')) return

  // 2. 收集现有供应商数据
  const providers = collectProviders() // cctoggle_provider_*

  // 3. 创建 default 项目
  ztools.db.put({
    _id: 'cctoggle_profile_default',
    id: 'default',
    name: '全局默认',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    providers
  })

  // 4. 删除旧供应商 key
  deleteOldProviderKeys()
}
```

### 迁移校验

- 迁移后对比供应商数量
- 验证当前激活供应商正确
- 验证路由组数据完整

---

## 功能兼容性清单

迁移后需确保以下功能正常工作：

### 供应商管理

| 功能       | 兼容方案                              |
| ---------- | ------------------------------------- |
| 列表查询   | 从当前激活项目（或 default）读取      |
| 新增供应商 | 写入当前项目                          |
| 编辑供应商 | 更新当前项目内的数据                  |
| 删除供应商 | 从当前项目删除                        |
| 切换供应商 | 更新当前项目的 settings.lastActiveApp |
| 标记当前   | 更新当前项目内供应商的 isCurrent      |

### 路由管理（全局共享，不涉及项目）

### 其他功能

| 功能         | 兼容方案                 |
| ------------ | ------------------------ |
| 技能管理     | 全局共享，不属于项目维度 |
| Prompt 管理  | 全局共享，不属于项目维度 |
| MCP 管理     | 全局共享，不属于项目维度 |
| Session 管理 | 全局共享，不属于项目维度 |
| 用量统计     | 全局共享，不属于项目维度 |

---

## API 兼容性

### 现有 API 适配

所有现有 API 需增加项目上下文：

```ts
// 改造前
listProviders(appType: string): Provider[]

// 改造后（内部实现变化，接口不变）
listProviders(appType: string): Provider[] {
  const profile = getActiveProfile()
  return Object.values(profile.providers[appType] || {})
}
```

### 新增 API

```ts
// 项目管理
listProfiles(): Profile[]
getProfile(id: string): Profile | null
saveProfile(data: Partial<Profile>): string
deleteProfile(id: string): void
activateProfile(id: string): SuccessResult
deactivateProfile(): void
getActiveProfileId(): string | null
```

---

## 未来扩展

- 项目导入/导出（按需）
