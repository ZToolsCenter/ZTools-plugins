# Npm Lite

> 一款面向前端与 Node.js 开发者的轻量级效率工具。它集成了 NPM 包检索、安装指令复制以及使用指南查看功能，让依赖管理不再依赖浏览器。帮助开发者快速获取安装命令，让前端开发事半功倍。

![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883) ![Vite](https://img.shields.io/badge/Vite-6-646cff) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![License](https://img.shields.io/badge/License-MIT-green)

## ✨ 功能特性

### 双源聚合搜索

一次搜索并行查询两个数据源，单源故障不影响整体结果：

| 数据源 | 说明 |
|---|---|
| **npm 官方** | `registry.npmjs.org`，全球权威数据源 |
| **npmmirror** | `registry.npmmirror.com`，国内高速镜像（可在设置中覆盖基地址） |

- 结果按 `全部 / npm / npmmirror` 三个 Tab 聚合，跨源按包名去重，并显示来源标签（`npm` / `npmmirror`）
- 搜索防抖 700ms，单源请求超时/失败不影响另一源，错误可展开查看详情
- 支持 `name@version`、`@scope/name` 精确包定位

### 一键复制安装指令

| 快捷键 | 作用 |
|---|---|
| `n` | 复制 `npm install <pkg>` |
| `p` | 复制 `pnpm add <pkg>` |
| `y` | 复制 `yarn add <pkg>` |
| `Enter` / `c` | 打开复制菜单（npm / pnpm / yarn） |

- 内置命令构建器支持 `-D`（devDependencies）、`-g`（全局安装）参数变体
- 复制后自动写入剪贴板并粘贴到当前应用，同时隐藏窗口
- 一级结果列表与二级版本面板均可直接复制

### 历史版本浏览

- 版本号 + 发布时间（YYYY-MM）+ `stable` / `rc` / `beta` / `alpha` / `dev` 状态标签
- `LATEST` 徽章（取 dist-tag `latest`）+ `dist-tag` 标识
- 按发布时间倒序，200 条 / 页，可加载更多

### 使用指南

- 二级版本面板按 `r` 查看该包的 README 使用指南
- Markdown 本地渲染（标题 / 列表 / 表格 / 代码块 / 链接），安全转义，可一键复制 README

### 快捷搜索

- 在 ZTools 主搜索框选中/输入任意关键字 → 触发 `npm-search` 快速复制流程，一键复制安装指令

### 镜像源设置

- 设置弹窗可配置 HTTP 代理（默认直连；国内访问官方源时填 `http://127.0.0.1:7890` 等本地代理），保存后持久化；npmmirror 国内镜像为固定默认，不可配置

## 🚀 安装

### 打包

```bash
npm install
npm run build        # 产出 dist.zip
```

### 安装到 ZTools

```bash
unzip dist.zip -d <ZTools 插件目录>/ztools-npm/
```

> 生产构建已配置 `base: './'`，直接复制 `dist/` 内容或解压 `dist.zip` 即可。

### 触发方式

- 输入 `npm`（或 `node`）打开检索主面板
- 在主面板打开 npm 包后，按 `r` 切换到右侧「使用指南」查看该包的 README
- 在 ZTools 主搜索框选中一段文本 → 触发 `npm-search` 快速复制流程

## ⌨️ 快捷键

| 按键 | 一级结果列表 | 左侧版本列表 | 右侧使用指南 |
|---|---|---|---|
| `↑` / `↓` | 上下移动 | 上下移动 | — |
| `←` / `→` | 切换数据源 Tab | `←` 返回结果列表 | — |
| `Enter` | 进入版本面板 | 打开复制菜单 | — |
| `n` / `p` / `y` | 复制 npm / pnpm / yarn | 复制 npm / pnpm / yarn | — |
| `c` | 进入版本面板 | 打开复制菜单 | — |
| `r` | — | 切到右侧「使用指南」 | — |
| `Esc` | 隐藏窗口 | 返回 / 退出 | — |
| `Cmd/Ctrl+K` | 帮助 | 帮助 | — |
| `Esc` | 隐藏窗口 | 返回 / 退出 | 返回版本 |
| `/` | 聚焦搜索框 | — | — |
| `Cmd/Ctrl + K` | 显示 / 隐藏快捷键帮助 | 显示 / 隐藏快捷键帮助 | 显示 / 隐藏快捷键帮助 |

## 🛠️ 开发

```bash
npm install
npm run dev          # 开发模式（ZTools 自动加载 http://localhost:5173）
npm test             # 单元 + 组件测试（60 个用例）
npm run build        # 生产构建 + dist.zip
```

### 技术栈

Vue 3 · Vite 6 · TypeScript · Vitest · @vue/test-utils · jsdom

## 📁 项目结构

```
ztools-npm/
├── plugin.json            # 插件配置（feature 注册）
├── preload.js             # Preload 服务（双源搜索、包元数据、代理、文件读写）
├── index.html             # HTML 入口
├── src/
│   ├── NpmUi/             # 主检索面板（搜索/结果/版本/使用指南/设置弹窗）
│   ├── NpmQuick/          # 快捷复制面板（over 指令触发）
│   ├── NpmSettings/       # HTTP 代理设置弹窗
│   ├── lib/               # 纯函数（搜索解析/版本标签/指令构建/markdown/主题/缓存）
│   ├── App.vue            # 路由
│   ├── main.css           # 深浅主题 CSS 变量
│   └── env.d.ts
├── public/
│   ├── logo.png           # npm 风格图标
│   └── plugin.json        # Vite 输入（与根 plugin.json 一致）
├── tests/                 # 单元 / 组件测试
└── docs/superpowers/      # 设计 spec 与实现计划
```

## 🙏 致谢

- [ZTools](https://github.com/ztool-center/ztools) —— 提供插件运行环境与强大的 API
- [npm](https://www.npmjs.com/) —— 全球最大的 JavaScript 包管理生态与官方 registry
- [npmmirror](https://npmmirror.com/) —— 国内高速 npm 镜像
- [Vue.js](https://vuejs.org/) / [Vite](https://vitejs.dev/) —— 前端框架与构建工具
- [Vitest](https://vitest.dev/) / [@vue/test-utils](https://test-utils.vuejs.org/) —— 测试工具

## 📄 开源协议

[MIT License](./LICENSE)

---

**祝你开发愉快！** 🎉
