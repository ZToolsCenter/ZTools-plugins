# 速记盒 (Shorthand Box)

<div align="center">

一个简洁高效的数据速记管理 ZTools 插件

**Vue 3** · **Vite** · **Naive UI**

</div>

---

## 📖 简介

速记盒是一个基于 ZTools 平台的数据管理插件，提供项目分类、数据类型标签和数据条目的三级管理架构。支持拖拽排序、快速复制、智能关联检查等功能，帮助用户高效管理和检索常用数据。

## ✨ 核心功能

### 🗂️ 三级管理架构

| 模块         | 功能说明                                       |
| ------------ | ---------------------------------------------- |
| **数据管理** | 管理数据条目，支持项目筛选、类型过滤、模糊搜索 |
| **项目管理** | 管理项目分类，支持启动日期记录和自定义排序     |
| **数据类型** | 管理数据分类标签，用于对数据条目进行归类       |

### 🎯 功能特性

- **完整 CRUD** - 支持数据的增删改查操作
- **拖拽排序** - 基于 vue-draggable-plus 实现流畅拖拽
- **同类排序** - 按数据类型顺序自动排列数据条目
- **智能复制** - 点击单元格即可复制内容到剪贴板
- **关联检查** - 删除前自动检查关联数据，防止误删
- **主题适配** - 自动跟随系统深色/浅色主题切换
- **设置持久化** - 用户偏好设置自动保存到数据库

### ⚙️ 系统设置

| 设置项     | 说明                           |
| ---------- | ------------------------------ |
| 点击后复制 | 控制是否启用点击单元格复制功能 |
| 复制后提示 | 控制复制成功后是否显示提示消息 |

## 🛠️ 技术栈

| 技术               | 版本     | 用途      |
| ------------------ | -------- | --------- |
| Vue 3              | ^3.5.13  | 前端框架  |
| Vite               | ^6.0.11  | 构建工具  |
| Naive UI           | ^2.38.1  | UI 组件库 |
| Vue Router         | ^4.4.5   | 路由管理  |
| vue-draggable-plus | ^0.6.1   | 拖拽排序  |
| dayjs              | ^1.11.20 | 日期处理  |

## 📁 项目结构

```
shorthand-box/
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.js               # 应用入口
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件（主题配置）
│   ├── components/
│   │   └── Layout.vue        # 主布局（导航、设置抽屉）
│   ├── composables/
│   │   ├── usePageActions.js # 页面操作按钮状态管理
│   │   └── useSettings.js    # 设置状态管理
│   ├── router/
│   │   └── index.js          # 路由配置（Hash 模式）
│   ├── utils/
│   │   ├── index.js          # UUID 生成工具
│   │   └── copy-content.js   # 剪贴板复制工具
│   └── views/
│       ├── data-management/      # 数据管理页面
│       │   ├── index.vue
│       │   └── components/
│       │       └── DataEntryForm.vue
│       ├── project-management/   # 项目管理页面
│       │   ├── index.vue
│       │   └── components/
│       │       └── ProjectsForm.vue
│       └── data-type/            # 数据类型页面
│           ├── index.vue
│           └── components/
│               └── DataTypesForm.vue
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置（含 @ 别名、NaiveUI 自动导入）
└── package.json              # 项目依赖
```

## 🚀 快速开始

### 环境要求

- Node.js >= 16.0.0
- npm 或 bun

### 安装依赖

```bash
npm install
# 或
bun install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录，可直接部署到 ZTools 平台。

## 🗄️ 数据存储

### 存储方案

使用 ZTools 提供的数据库 API（基于 PouchDB），数据以文档形式存储，每个插件拥有独立的存储空间。

### 数据前缀

| 前缀         | 说明     |
| ------------ | -------- |
| `project-`   | 项目数据 |
| `data-type-` | 数据类型 |
| `entry-`     | 数据条目 |
| `settings-`  | 系统设置 |

### 数据结构

**项目数据**

```javascript
{
  _id: 'project-1704067200000-a1b2c3d4',
  name: '项目名称',
  description: '项目描述',
  startDate: 1704067200000,  // 时间戳
  order: 1
}
```

**数据类型**

```javascript
{
  _id: 'data-type-1704067200000-e5f6g7h8',
  name: '类型名称',
  description: '类型描述',
  order: 1
}
```

**数据条目**

```javascript
{
  _id: 'entry-1704067200000-i9j0k1l2',
  projectId: 'project-xxx',      // 关联项目 ID
  dataTypeId: 'data-type-xxx',   // 关联数据类型 ID
  name: '名称',
  value: '值',
  description: '描述',
  order: 1
}
```

**系统设置**

```javascript
{
  _id: 'settings-main',
  clickToCopy: true,    // 点击后复制
  showCopyTip: true     // 复制后提示
}
```

### 核心 API

```javascript
// 保存数据
await window.ztools.db.put({
  _id: 'project-xxx',
  name: '项目名称',
});

// 获取数据
const doc = await window.ztools.db.get('project-xxx');

// 删除数据
await window.ztools.db.remove('project-xxx');

// 批量操作
await window.ztools.db.bulkDocs([doc1, doc2]);

// 按前缀查询
const projects = await window.ztools.db.allDocs('project-');
```

## 🎨 主题适配

插件自动跟随系统主题，通过 `prefers-color-scheme` 媒体查询实现深色/浅色模式切换。

### 实现方式

```javascript
// 检测系统主题
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = mediaQuery.matches;

// 监听主题变化
mediaQuery.addEventListener('change', (e) => {
  console.log('主题切换:', e.matches ? '深色' : '浅色');
});
```

### CSS 适配

```css
/* 浅色模式 */
.table-scroll th {
  background-color: #fafafa;
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
  .table-scroll th {
    background-color: #262626;
  }
}
```

## 🔒 数据安全

### 关联检查

删除项目或数据类型时，系统会自动检查是否存在关联数据：

- **删除项目** - 检查是否有数据条目关联该项目
- **删除数据类型** - 检查是否有数据条目使用该类型

如果存在关联数据，系统将阻止删除并提示用户。

### 数据验证

- 项目名称不可重复
- 同一项目下的数据条目名称不可重复
- 所有表单字段支持实时验证

## 📚 相关资源

- [ZTools 官方文档](https://github.com/ztool-center/ztools)
- [Naive UI 文档](https://www.naiveui.com/)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
- [vue-draggable-plus 文档](https://github.com/Alfred-Skyblue/vue-draggable-plus)

## 📄 开源协议

[MIT License](LICENSE)

## 👤 作者

**Jeffrey**

---

<div align="center">

如果这个项目对你有帮助，欢迎 ⭐️ Star 支持一下！

</div>
