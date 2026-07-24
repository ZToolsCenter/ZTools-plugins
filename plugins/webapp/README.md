# ZTools WebApp 插件

> 你可以添加 Web 应用到插件中，一键直接加载应用。支持 Basic Auth 认证。

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件，使用 Electron webview 加载网页。

## ✨ 功能特性

- **Web 应用管理** — 添加、编辑、删除 Web 应用，支持自定义图标
- **Basic Auth 认证** — 支持 URL 内联认证，自动处理认证流程
- **拖动排序** — 拖动侧边栏图标调整应用顺序
- **默认加载** — 设置某个应用为默认，打开插件时自动加载
- **导入导出** — 支持 JSON 格式的配置导入导出，方便备份和迁移
- **开发者工具** — Ctrl + 右键快速打开 webview 开发者工具
- **Loading 动画** — 页面加载时显示旋转 spinner
- **亮色/暗色主题** — 自动跟随系统主题

## 📁 项目结构

```
ztool-plugin-webapp/
├── src/
│   ├── App.vue                 # 根组件（路由分发）
│   ├── main.ts                 # 入口文件
│   ├── main.css                # 全局样式
│   └── WebApp/
│       ├── index.vue           # 主界面（侧边栏 + webview）
│       ├── AppDialog.vue       # 应用添加/编辑对话框
│       └── SettingsDialog.vue  # 设置对话框（导入/导出）
├── preload/
│   └── services.js             # Node.js 服务（配置读写）
├── dist/                       # 构建产物（部署到 ZTools 插件目录）
├── index.html                  # HTML 模板
├── vite.config.js              # Vite 配置
├── tsconfig.json               # TypeScript 配置
├── package.json                # 项目依赖
├── plugin.json                 # ZTools 插件配置
└── README.md                   # 项目文档
```

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### 部署

将 `dist/` 目录中的文件复制到 ZTools 插件目录：

```
%APPDATA%\ZTools\plugins\WEBAPP\
├── index.html
├── assets/
│   ├── index-xxx.css
│   └── index-xxx.js
├── logo.png
├── plugin.json
└── preload/
    └── services.js
```

## 🎯 使用说明

### 基本操作

| 操作 | 说明 |
|------|------|
| **点击** | 加载/切换应用 |
| **点击当前应用** | 刷新页面 |
| **右键** | 编辑应用配置 |
| **Ctrl + 右键** | 打开 webview 开发者工具 |
| **拖动** | 排序应用顺序 |

### Basic Auth 认证

支持两种方式配置 Basic Auth：

1. **URL 内联认证**（推荐）：
   ```
   https://username:password@your-domain.com
   ```

2. **单独配置**：
   - 在添加应用时填写用户名和密码
   - 插件会自动构建内联认证 URL

### 首次加载流程

对于需要 Basic Auth 的应用，首次加载会执行两阶段认证：

1. **第一阶段**：使用内联认证 URL 建立会话
2. **第二阶段**：使用原始 URL 重新加载（避免兼容性问题）

加载完成后，后续访问将直接使用原始 URL。

## 🔧 开发指南

### 添加新功能

1. 在 `src/WebApp/` 下创建 Vue 组件
2. 在 `index.vue` 中引入和使用

### ZTools API

通过 `window.ztools` 调用 ZTools 宿主能力：

```javascript
// 获取用户数据目录
window.ztools.getPath('userData')

// 插件生命周期
window.ztools.onPluginEnter((action) => { /* 进入插件 */ })
window.ztools.onPluginOut(() => { /* 离开插件 */ })
```

## ❓ 常见问题

### Q: 页面加载空白？

1. 检查 URL 是否正确
2. 如果需要 Basic Auth，确认使用了正确的认证格式
3. 打开 webview 开发者工具（Ctrl + 右键）查看错误信息

### Q: Basic Auth 页面加载异常？

插件会自动处理 Basic Auth 认证。如果遇到问题：
1. 尝试删除该应用并重新添加
2. 确认 URL 格式正确（包含协议头 http:// 或 https://）

### Q: 如何调试 webview？

在插件界面中，按住 Ctrl 键右键点击应用图标，可以打开 webview 的开发者工具。

### Q: 如何调试插件？

使用 `npm run dev` 启动开发服务器，在插件界面中打开开发者工具查看日志。

## 📄 开源协议

MIT License
