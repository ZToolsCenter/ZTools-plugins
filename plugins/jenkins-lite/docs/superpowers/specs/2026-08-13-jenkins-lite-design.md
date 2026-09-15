# Jenkins Lite 插件设计文档

> 版本：1.1.0
> 日期：2026-08-13
> 作者：KangKang
> 状态：已通过设计审查

## 1. 项目概述

### 1.1 项目背景

Jenkins Lite 是一款轻量级的 Jenkins 辅助工具，基于 ZTools 插件平台开发。告别繁琐的网页操作，提供实时查询与一键构建功能，帮助开发者快速检索任务状态、监控构建进度并秒级触发构建。

### 1.2 技术栈

- **前端框架**：Vue 3 + Composition API + TypeScript
- **构建工具**：Vite
- **样式方案**：原生 CSS + CSS 变量（适配 ZTools 主题）
- **数据存储**：ZTools db API（持久化配置）
- **HTTP 通信**：Jenkins REST API（JSON 格式）

### 1.3 功能范围

| 功能 | 优先级 | 描述 |
|------|--------|------|
| Jenkins 实例管理 | P0 | 添加/编辑/删除 Jenkins 实例，支持分组 |
| Jobs 列表展示 | P0 | 显示实例下所有 Jobs，支持搜索/筛选 |
| 全局收藏 | P0 | 跨实例收藏 Jobs，点击快速跳转 |
| 构建触发 | P0 | 一键触发构建 |
| 构建状态查询 | P0 | 显示最近构建历史（成功/失败/运行中） |
| 构建通知 | P0 | 构建完成后 ZTools 系统通知 |
| 搜索面板集成 | P1 | 支持 `构建 <job>` / `状态 <job>` 等命令 |

## 2. 功能详细设计

### 2.1 Jenkins 实例管理

#### 2.1.1 数据结构

```typescript
interface JenkinsInstance {
  _id: string              // 文档ID，格式：instance_${uuid}
  type: 'jenkins-instance'
  name: string             // 显示名称，如 "测试环境-Jenkins"
  url: string              // Jenkins URL，如 "https://jenkins.example.com"
  username: string         // 用户名（与 API Token 配对使用）
  apiToken: string         // Jenkins API Token（通过 {jenkins_url}/user/{username}/configure 获取，不是登录密码）
  group: string            // 实例分组，如 "测试环境"
  crumb?: string           // CSRF Crumb（首次请求后缓存）
  createdAt: number        // 创建时间戳
  updatedAt: number        // 更新时间戳
}
```

> **注意**：`apiToken` 必须是 Jenkins 为用户分配的 API Token，而非登录密码。获取方式：登录 Jenkins → 点击用户名 → Configure → API Token → 点击 Add new Token

#### 2.1.2 功能点

- **添加实例**：输入 URL，自动检测并获取 Jenkins 信息
- **编辑实例**：修改名称、Token 等配置
- **删除实例**：确认后删除，同时移除相关收藏
- **实例分组**：支持按环境/团队/项目等维度分组
- **连接测试**：添加/编辑时验证实例连通性

#### 2.1.3 验证逻辑

1. 访问 `{url}/api/json` 验证 Jenkins 可达
2. 验证用户权限：访问 `{url}/user/{username}/api/json`
3. 成功则保存实例配置

### 2.2 Jobs 列表

#### 2.2.1 数据结构

```typescript
interface JobInfo {
  name: string             // Job 名称
  url: string              // Job URL
  color: string            // 状态颜色标识
  lastBuild?: {           // 最后一次构建
    number: number
    url: string
    result?: 'SUCCESS' | 'FAILURE' | 'ABORTED' | 'UNSTABLE' | null
    timestamp: number
  }
}
```

#### 2.2.2 Jenkins API

```
GET {url}/api/json?tree=jobs[name,url,color,lastBuild[number,url,result,timestamp]]
```

#### 2.2.3 功能点

- **列表展示**：显示所有 Jobs，支持滚动加载
- **状态标识**：
  - `blue` / `animeblue` → 成功 / 运行中
  - `red` / `animered` → 失败 / 运行中
  - `yellow` / `animeyellow` → 不稳定 / 运行中
  - `grey` / `disabled` → 禁用 / 未执行
- **搜索过滤**：支持名称模糊搜索
- **分组展示**：Folder/Organization Folder 类型 Jobs 展开显示
  - Folder 类型 Job 展开后调用 `GET /job/{folderName}/api/json?tree=jobs[...]` 获取子 Jobs
  - 递归深度限制为 3 层，避免过度嵌套
- **刷新**：手动刷新 Jobs 列表

### 2.3 全局收藏

#### 2.3.1 数据结构

```typescript
interface Favorite {
  _id: string              // 文档ID，格式：fav_${uuid}
  type: 'favorite'
  instanceId: string       // Jenkins 实例ID
  instanceName: string     // Jenkins 实例名称（冗余存储便于显示）
  jobName: string          // Job 名称
  addedAt: number          // 收藏时间戳
}
```

#### 2.3.2 功能点

- **添加收藏**：点击收藏图标添加到全局收藏
- **移除收藏**：点击已收藏图标移除
- **收藏列表**：侧边栏显示所有收藏的 Jobs
- **快速跳转**：点击收藏项直接跳转到对应 Jobs 列表
- **去重**：同一 Job 只能收藏一次

### 2.4 构建触发

#### 2.4.1 Jenkins API

```
POST {url}/job/{jobName}/build
```

带认证头（启用 CSRF Protection 时需包含 Crumb）：
```
Authorization: Basic {base64(username:apiToken)}
Jenkins-Crumb: {crumb}
```

#### 2.4.2 功能点

- **立即构建**：点击按钮触发构建
- **构建确认**：显示 Job 名称，确认后执行
- **构建结果**：
  - HTTP 201 → 显示"构建已触发，正在排队中"
  - 构建开始 → 切换到运行中状态
  - 成功 → 显示成功提示
  - 失败 → 显示失败原因
  - 网络错误 → 显示错误信息
- **防止重复**：构建触发中显示加载状态
- **队列状态**：可通过 `GET /queue/api/json` 轮询确认构建真正开始

#### 2.4.3 CSRF Crumb 处理

Jenkins 启用 CSRF Protection 时，需要：
1. 首次请求获取 Crumb：`GET {url}/crumbIssuer/api/json`
2. 后续请求携带 Crumb 头
3. Crumb 缓存至实例配置，失败时自动刷新

### 2.5 构建状态查询

#### 2.5.1 数据结构

```typescript
interface BuildInfo {
  id: string               // 构建ID
  number: number           // 构建号
  url: string              // 构建 URL
  result: 'SUCCESS' | 'FAILURE' | 'ABORTED' | 'UNSTABLE' | null
  building: boolean        // 是否正在构建
  duration: number         // 构建耗时（毫秒）
  timestamp: number        // 开始时间戳
  displayName: string      // 显示名称，如 "#12"
  fullDisplayName: string  // 完整名称，如 "job-name #12"
}
```

#### 2.5.2 Jenkins API

```
GET {url}/job/{jobName}/api/json?tree=builds[number,url,result,building,duration,timestamp,displayName,fullDisplayName]{0,20}
```

#### 2.5.3 功能点

- **历史列表**：显示最近 20 条构建记录
- **状态显示**：成功(✅) / 失败(❌) / 运行中(⏳) / 排队中 / 不稳定(⚠️)
- **详情入口**：点击构建记录用浏览器打开构建详情页
- **运行中刷新**：自动轮询更新运行中的构建状态

### 2.6 构建通知

#### 2.6.1 实现方式

使用 ZTools `showNotification` API：

```typescript
window.ztools.showNotification(
  `${jobName} #${buildNumber} ${result === 'SUCCESS' ? '构建成功' : '构建失败'}`,
  'Jenkins Lite'
)
```

#### 2.6.2 功能点

- **构建完成通知**：仅在构建状态变为最终状态时通知
- **成功/失败标识**：通知内容区分成功和失败
- **点击跳转**：通知点击后打开 Jenkins 构建页面

### 2.7 搜索面板集成

#### 2.7.1 命令模式

通过 `onMainPush` 实现搜索面板集成：

```typescript
window.ztools.onMainPush(
  (action) => {
    // 处理构建、状态等命令
    return results
  },
  (action, selected) => {
    // 处理选中结果
  }
)
```

#### 2.7.2 搜索结果格式

```typescript
interface SearchResult {
  type: 'job' | 'instance' | 'build' | 'command'
  title: string           // 主标题，如 "job-frontend"
  subtitle?: string       // 副标题，如 "测试环境-Jenkins"
  icon?: string           // 图标
  action: {               // 点击执行的操作
    type: 'build' | 'view' | 'favorite' | 'navigate'
    payload: any
  }
}
```

#### 2.7.3 支持的命令

| 命令 | 示例 | 功能 |
|------|------|------|
| `构建 <job>` | `构建 frontend` | 触发指定 Job 构建 |
| `状态 <job>` | `状态 frontend` | 显示最近构建状态 |
| `收藏 <job>` | `收藏 frontend` | 收藏指定 Job |
| `列表` | `列表` | 显示收藏列表 |

## 3. 界面设计

### 3.1 整体布局

```
┌──────────────────────────────────────┐
│  Jenkins Lite                        │
├────────┬─────────────────────────────┤
│        │  [实例选择 ▼]    [🔄] [⚙]   │
│ 📋 实例├─────────────────────────────│
│   列表  │                             │
│        │  🔍 搜索 Jobs...            │
│ ⭐ 收藏 │  ───────────────────────── │
│   Jobs  │                             │
│        │  ⭐ job-frontend  ●        │
│ 🔨 构建│  ⭐ job-backend   ◐        │
│   触发  │    job-deploy     ✗        │
│        │    job-test       ○         │
│ 📊 构建│                             │
│   状态  │  ───────────────────────── │
│        │  构建历史                    │
│        │  ───────────────────────── │
│        │  #12 成功  10分钟前  →      │
│        │  #11 失败  1小时前   →      │
│        │  #10 成功  2小时前   →      │
└────────┴─────────────────────────────┘
```

### 3.2 页面模块

#### 3.2.1 侧边栏

- **实例列表**：显示所有配置的 Jenkins 实例
- **收藏 Jobs**：显示全局收藏的 Jobs 列表
- **快捷操作**：构建触发、构建状态入口

#### 3.2.2 主内容区

- **头部**：
  - 当前实例选择器（下拉）
  - 刷新按钮
  - 设置按钮

- **Jobs 列表**：
  - 搜索输入框
  - Jobs 列表（支持状态筛选）
  - 收藏/构建操作

- **构建历史**：
  - 当前选中 Job 的构建历史
  - 点击跳转到 Jenkins 详情页

### 3.3 样式规范

使用 ZTools 提供的 CSS 变量：

```css
:root {
  --bg-color: #ffffff;
  --text-color: #333333;
  --border-color: #e0e0e0;
  --primary-color: #0078d4;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #1e1e1e;
    --text-color: #cccccc;
    --border-color: #404040;
  }
}
```

### 3.4 状态标识

| Jenkins Color | 状态 | 图标 | 颜色 |
|---------------|------|------|------|
| blue / animeblue | 成功 / 运行中 | ● / ◐ | #52c41a / #1890ff |
| red / animered | 失败 / 运行中 | ● / ◐ | #ff4d4f |
| yellow / animeyellow | 不稳定 / 运行中 | ⚠ / ◐ | #faad14 |
| grey | 禁用 | ○ | #d9d9d9 |
| disabled | 未执行 | ○ | #bfbfbf |
| null | 无构建 | ○ | #d9d9d9 |

## 4. 数据存储

### 4.1 存储策略

| 数据类型 | 存储方式 | 说明 |
|----------|----------|------|
| 实例配置 | db.put() | 完整数据，包含加密 Token |
| 收藏列表 | db.put() | 全局共享 |
| 缓存数据 | dbStorage | Jobs 列表缓存，加快显示 |
| 敏感数据 | dbCryptoStorage | API Token 加密存储 |

### 4.2 数据文档

| 文档类型 | ID 前缀 | 说明 |
|----------|---------|------|
| 实例配置 | `instance_` | Jenkins 实例信息 |
| 收藏 | `fav_` | 全局收藏列表 |

## 5. API 调用规范

### 5.1 请求封装

```typescript
interface JenkinsResponse<T> {
  data: T | null
  error: string | null
}

class JenkinsClient {
  constructor(private baseUrl: string, private auth: string) {}

  private async request<T>(path: string): Promise<JenkinsResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Accept': 'application/json'
        }
      })
      if (!response.ok) {
        return { data: null, error: `HTTP ${response.status}` }
      }
      const data = await response.json()
      return { data, error: null }
    } catch (e) {
      return { data: null, error: e.message }
    }
  }

  async getJobs(): Promise<JenkinsResponse<JobInfo[]>> {
    return this.request('/api/json?tree=jobs[name,url,color,lastBuild[number,url,result,timestamp]]')
  }

  async getBuilds(jobName: string): Promise<JenkinsResponse<BuildInfo[]>> {
    return this.request(`/job/${encodeURIComponent(jobName)}/api/json?tree=builds[number,url,result,building,duration,timestamp,displayName,fullDisplayName]{0,20}`)
  }

  async triggerBuild(jobName: string): Promise<JenkinsResponse<void>> {
    try {
      const response = await fetch(`${this.baseUrl}/job/${encodeURIComponent(jobName)}/build`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.auth}`
        }
      })
      return { data: undefined, error: response.ok ? null : `HTTP ${response.status}` }
    } catch (e) {
      return { data: null, error: e.message }
    }
  }
}
```

### 5.2 认证方式

使用 Basic Auth：
```
Authorization: Basic {base64(username + ':' + apiToken)}
```

## 6. 错误处理

### 6.1 错误类型

| 错误场景 | 用户提示 |
|----------|----------|
| 实例连接失败 | 无法连接到 Jenkins，请检查 URL 和网络 |
| 认证失败 | 用户名或 API Token 错误 |
| CSRF 403 错误 | 自动获取新 Crumb 后重试 |
| Job 不存在 | 未找到指定的 Job |
| 构建触发失败 | 构建触发失败，请稍后重试 |
| 权限不足 | 当前用户权限不足 |

### 6.2 重试策略

- 网络错误：自动重试 3 次，间隔 1s/2s/4s
- CSRF 403 错误：自动获取 Crumb 后重试 1 次
- 构建触发失败：失败后显示重试按钮

## 7. 性能优化

### 7.1 缓存策略

- Jobs 列表：首次加载后缓存 5 分钟
- 构建状态：运行中的构建每 10 秒轮询更新
- 实例配置：启动时加载，常驻内存

### 7.2 懒加载

- 构建历史：仅在查看时加载
- Folder 类型 Jobs：展开时加载子 Jobs

## 8. 安全考虑

### 8.1 Token 安全

- API Token 使用 `dbCryptoStorage` 加密存储
- 不在日志中输出敏感信息
- 内存中即时清理

### 8.2 输入校验

- Jenkins URL：校验格式，必须以 http:// 或 https:// 开头
- Job 名称：URL 编码处理特殊字符

## 9. 文件结构

```
ztools-jenkins/
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置
│   └── preload/
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── env.d.ts              # 类型声明
│   ├── components/
│   │   ├── Sidebar.vue       # 侧边栏
│   │   ├── InstanceSelector.vue  # 实例选择器
│   │   ├── JobsList.vue      # Jobs 列表
│   │   ├── JobItem.vue       # 单个 Job 项
│   │   ├── BuildHistory.vue  # 构建历史
│   │   └── SettingsModal.vue # 设置弹窗
│   ├── composables/
│   │   ├── useJenkins.ts     # Jenkins API 调用
│   │   ├── useInstances.ts   # 实例管理
│   │   └── useFavorites.ts   # 收藏管理
│   ├── types/
│   │   └── index.ts          # 类型定义
│   └── utils/
│       └── auth.ts           # 认证工具
├── docs/
│   └── superpowers/
│       └── specs/            # 设计文档
├── package.json
├── tsconfig.json
└── vite.config.js
```

## 10. 后续规划

### 10.1 v1.1 规划

- [ ] 参数化构建支持
- [ ] 构建日志查看
- [ ] 构建历史筛选（按结果、按时间）

### 10.2 v1.2 规划

- [ ] 多语言支持
- [ ] 快捷键配置
- [ ] 数据导出/导入
