# PromptForge — 词匠

> 专为 AI 创作者与开发者打造的提示词资产管理插件。

集模板化编排、变量注入、组合拼接与一键调用为一体，助你像工匠打磨作品一样，系统化地沉淀、优化并复用高质量提示词。

## 功能特性

### 调用

通过关键词搜索提示词，选中后一键复制到剪贴板。含变量的提示词自动进入填写模式，填完参数后复制即用。

- 左侧分类/标签侧边栏，按类型和标签快速筛选
- 键盘快捷键：`↑↓` 选择、`Enter` 复制、`E` 编辑
- 复制后自动隐藏窗口（可配置）

### 快速保存

在任意应用中选中或复制一段提示词，通过 ZTools 唤起栏触发保存。自动检测变量、推断标题和分类，并检测与已有提示词的重复度。

### 新建向导

三步引导式创建提示词：

1. **编写正文** — 支持 `{{变量名}}` 语法，实时识别变量
2. **基本信息** — 设置标题、分类、标签（可自动生成）
3. **变量配置** — 为每个变量设定默认值和必填性

### 库管理

左右分栏的编辑器界面，支持：

- 按分类（评审/编码/翻译/写作/问答/其它）和标签筛选
- 正文编辑、变量精细配置、使用统计
- 版本管理：正文变更自动递增版本号
- 一键复制、批量删除

### 组合

将一个基础提示词与多个片段拼接，实时预览合成结果。片段适合放风格约束、格式要求、安全声明等可复用段落。

### 设置

- **行为** — 复制后是否关闭窗口
- **主题** — 浅色/深色切换，跟随系统偏好
- **导入/导出** — JSON 格式备份与恢复
- **清空** — 一键清除全部数据

## 技术栈

- **Vue 3** + Composition API
- **TypeScript**
- **Vite** 构建
- **ZTools API** — 数据库、剪贴板、通知、窗口控制

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（http://localhost:5173）
npm run dev

# 构建
npx vite build
```

在 ZTools 的插件配置中将开发地址设为 `http://localhost:5173` 即可实时预览。

## 项目结构

```
prompt-forge/
├── public/
│   ├── plugin.json          # 插件配置（功能入口、命令）
│   ├── logo.png
│   └── preload/
│       └── services.js      # Node.js 能力注入（文件读写、KV 存储）
├── src/
│   ├── App.vue              # 根组件（路由、CommandBar）
│   ├── main.ts
│   ├── main.css             # Light/Dark 双主题设计系统
│   ├── types/index.ts       # PromptUnit、Variable 等类型定义
│   ├── stores/
│   │   ├── router.ts        # 路由状态管理
│   │   ├── prompt.ts        # 提示词数据、搜索、筛选
│   │   ├── app.ts           # 应用设置
│   │   └── theme.ts         # 主题切换
│   ├── utils/
│   │   ├── index.ts         # 变量提取、相似度检测、标题推断
│   │   ├── storage.ts       # KV 存储抽象层
│   │   └── platform.ts      # ZTools API 封装
│   ├── components/
│   │   ├── CommandBar.vue   # 顶部导航 + 搜索
│   │   ├── PromptList.vue   # 提示词卡片列表
│   │   └── FillPanel.vue    # 变量填写 + 正文预览
│   └── views/
│       ├── SpaceView.vue    # 调用（主界面）
│       ├── WizardView.vue   # 新建向导
│       ├── ManageView.vue   # 库管理
│       ├── ComposeView.vue  # 组合拼接
│       ├── QuickSaveView.vue # 快速保存
│       └── SettingsView.vue # 设置
└── vite.config.js
```

## 数据存储

所有数据仅保留在本地，不发起任何网络请求。底层基于 ZTools 内置的 LMDB 文档数据库，通过 `ztools.db` API 读写。

### 存储架构

```
preload/services.js  →  window.kvStorage  →  storage.ts  →  Pinia Store (内存)
     (封装层)              (KV 接口)           (读写函数)      (响应式状态)
```

### 数据库文档（KV 模式）

插件采用 KV 模式，将每类数据打包为一个文档整体存取：

| 文档 `_id` | 数据结构 | 说明 |
|---|---|---|
| `promptforge:prompts` | `PromptItem[]` | 所有提示词，包含已删除项 |
| `promptforge:projects` | `Project[]` | 所有项目 |
| `promptforge:settings` | `Record<string, any>` | 用户设置（主题、行为等） |

### 核心数据模型

**PromptItem — 提示词**

```typescript
{
  id: string                   // 唯一标识
  title: string                // 标题
  description?: string         // 描述
  content: string              // 正文，支持 {{变量名}} / ${变量名} 语法
  type: 'prompt' | 'snippet' | 'template' | 'constraint'
  tags: string[]               // 标签列表
  variables: Variable[]        // 从正文自动提取的变量定义
  favorite: boolean            // 是否收藏
  usageCount: number           // 使用次数
  projectId?: string           // 所属项目 ID（无则为"资产"）
  deleted?: boolean            // 软删除标记（回收站）
  version: number              // 当前版本号
  snapshots: Snapshot[]        // 版本快照历史
  createdAt: number            // 创建时间戳
  updatedAt: number            // 更新时间戳
  lastUsedAt?: number          // 最后使用时间（运行时字段）
}
```

**Variable — 变量定义**

```typescript
{
  name: string                 // 变量名
  required: boolean            // 是否必填（无默认值时为 true）
  defaultValue?: string        // 默认值
}
```

**Snapshot — 版本快照**

```typescript
{
  version: number              // 版本号
  body: string                 // 快照时的正文内容
  note: string                 // 版本说明
  createdAt: number            // 快照时间戳
}
```

**Project — 项目**

```typescript
{
  id: string
  name: string
  group: '开发' | '学习' | '写作' | '研究' | '其他'
  description?: string
  createdAt: number
  updatedAt: number
}
```

### 实体关系

- **PromptItem → Project**：多对一，通过 `projectId` 关联（可选）
- **PromptItem → Variable**：一对多，变量从正文 `{{name}}` 语法自动提取
- **PromptItem → Snapshot**：一对多，正文变更时自动保存快照

## 许可

© 2026 PromptForge
