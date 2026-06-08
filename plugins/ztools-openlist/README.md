# OpenListUI for ZTools

一个用于 ZTools 的 OpenList 文件管理插件。它可以在 ZTools 中连接 OpenList 服务，浏览目录、上传文件、下载文件、复制直链，并支持新建文件夹、删除、重命名、移动、复制和批量操作。

项目基于 Vue 3、TypeScript、Vite 和 Element Plus 构建。OpenList API 请求、本地配置读写、上传下载等需要 Node 能力的逻辑由 ZTools preload 脚本提供。

## 功能特性

- 连接 OpenList 服务并保存登录配置
- 浏览 OpenList 目录和文件
- 支持列表视图和图标视图
- 本地搜索、目录优先排序和分页展示
- 查看文件详情和文件直链
- 复制文件直链到剪贴板
- 上传文件并显示上传进度
- 下载单个文件、文件夹或多选项目并显示下载进度
- 新建文件夹
- 删除文件或文件夹
- 重命名文件或文件夹
- 移动、复制文件或文件夹
- 当前页多选、批量移动、批量复制、批量删除
- 深色主题适配

## 项目结构

```text
my-first-plugin/
├─ public/
│  ├─ plugin.json              # ZTools 插件清单
│  ├─ logo.png                 # 插件图标和侧栏 Logo
│  └─ preload/
│     ├─ package.json
│     └─ services.js           # preload 服务，负责 OpenList API 和本地能力
├─ src/
│  ├─ App.vue                  # ZTools 环境检测和入口路由
│  ├─ main.ts                  # Vue 挂载入口
│  ├─ main.css                 # 全局样式
│  ├─ env.d.ts                 # window.services 类型声明
│  ├─ OpenList/
│  │  └─ index.vue             # 主界面和业务逻辑
│  └─ components/
│     └─ OperationFeedback.vue # 统一提示、确认弹窗、上传/下载进度
├─ doc/
│  └─ 实现文档.md              # 详细实现说明和排查记录
├─ vite.config.js              # Vite 和 Element Plus 按需导入配置
├─ tsconfig.json
├─ package.json
└─ README_CN.md
```

## 环境要求

- Node.js
- npm
- ZTools
- 可访问的 OpenList 服务

## 安装依赖

```powershell
npm install
```

## 开发运行

```powershell
npm run dev
```

Vite 开发服务默认运行在：

```text
http://127.0.0.1:5173
```

`public/plugin.json` 中的开发入口配置为：

```json
{
  "development": {
    "main": "http://127.0.0.1:5173"
  }
}
```

注意：直接在浏览器中打开 Vite 页面时不会有 `window.ztools` 和 preload 注入，因此页面会提示需要在 ZTools 插件环境中运行。请从 ZTools 插件开发环境打开本插件。

## 构建

```powershell
npm run build
```

构建脚本会执行：

1. `vue-tsc && vite build`：构建 Vue 前端，并把 `public/` 中的资源复制到 `dist/`。
2. `npm run build:preload`：使用 esbuild 打包 `public/preload/services.js` 到 `dist/preload/services.js`。

preload 脚本运行在 ZTools/Electron 的 CommonJS 环境中，不会被 Vite 自动打包。项目中的 OpenList 请求依赖 `axios`，因此生产包必须通过 `build:preload` 把相关依赖一起打入 `dist/preload/services.js`。

## 打包和安装

构建完成后，插件产物位于 `dist/` 目录。

如果 ZTools 需要 zip 包，请打包 `dist/` 目录内的文件，而不是打包项目源码目录。zip 根目录应包含：

```text
plugin.json
index.html
logo.png
assets/
preload/
```

也就是说，`dist/plugin.json`、`dist/index.html`、`dist/logo.png`、`dist/assets/` 和 `dist/preload/services.js` 需要位于插件包的根级结构中。

## 插件清单

插件清单位于 `public/plugin.json`。当前主要配置如下：

```json
{
  "name": "ztools-openlist",
  "title": "OpenListUI",
  "description": "在 ZTools 中浏览、下载和上传 OpenList 文件。",
  "author": "gcnanmu",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": {
    "main": "http://127.0.0.1:5173"
  },
  "features": [
    {
      "code": "OpenListUI",
      "explain": "打开 OpenListUI 文件管理器",
      "icon": "logo.png",
      "cmds": ["openlist", "OpenList", "OpenListUI"]
    }
  ]
}
```

可在 ZTools 中通过以下命令触发插件：

- `openlist`
- `OpenList`
- `OpenListUI`

## 使用说明

1. 在 ZTools 中打开插件。
2. 输入 OpenList 地址、用户名和密码。
3. 登录成功后进入文件管理界面。
4. 在左侧查看当前连接信息，主区域浏览文件和目录。
5. 使用顶部操作区新建文件夹、上传文件、刷新目录、切换视图。
6. 点击或右键文件/文件夹进行查看详情、下载、复制、移动、重命名或删除。
7. 多选文件后可执行批量移动、批量复制、批量删除或批量下载。

## 参考文档

- [ZTools](https://github.com/ZToolsCenter/ZTools)
- [ZTools API Types](https://github.com/ztool-center/ztools-api-types)
- [OpenList](https://github.com/OpenListTeam/OpenList)
- [Vue 3](https://vuejs.org/)
- [Vite](https://vite.dev/)
- [Element Plus](https://element-plus.org/)

## 许可证

本项目使用 MIT License。详见 `LICENSE`。
