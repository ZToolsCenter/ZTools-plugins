# vscode-history

> 快速搜索 VSCode / Cursor 历史项目并打开

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件，用于搜索和打开本地 VSCode / Cursor 的最近打开项目历史记录。

参考项目
- [vscode next](https://github.com/mohuishou/utools)

## ✨ 功能特性

### 🔍 搜索历史项目

- 输入关键词搜索本地 VSCode / Cursor 历史项目
- 支持多关键词模糊匹配
- 无搜索词时默认展示最近 20 条项目记录
- 一键打开项目（支持普通文件夹和工作区文件）
- 每条记录提供「打开」和「删除」操作按钮
- 删除单条历史记录或批量删除

### ⚙️ 管理 IDE 配置

- 添加、编辑、删除自定义 IDE 配置
- 支持的 IDE：VSCode、VSCode Insider、Cursor
- 快速创建常用 IDE 配置（一键初始化）
- 配置项包括：启动命令、终端命令、数据库路径、超时时间
- 自动检测并填充数据库路径（基于 IDE 类型）
- 对话框式编辑，操作清晰安全

### 🛠 技术特性

- SQLite 数据库读写（通过 SQL.js WASM）
- 自动验证项目路径有效性（存在且为目录）
- Shell 命令执行（支持指定终端）
- 防抖搜索，提升输入体验
- Vue 3 响应式错误处理

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # ZTools 插件清单（功能入口、preload 配置）
│   └── preload/
│       ├── services.js       # Node.js 能力扩展（SQL.js、Shell 执行、DB 操作）
├── src/
│   ├── main.ts               # Vue 应用入口
│   ├── App.vue               # 根组件（Tab 切换、路由分发）
│   ├── main.css              # 全局 CSS 变量与基础样式
│   ├── env.d.ts              # TypeScript 类型声明（window.services、ZTools）
│   ├── types.ts              # 类型定义（IDEConfig、SearchItem 等）
│   ├── config.ts             # IDE 配置管理（get/save/delete）
│   ├── VSCodeMain/           # 主框架（Tab 栏）
│   │   └── index.vue
│   ├── VSCodeSearch/         # 搜索历史项目组件
│   │   └── index.vue
│   └── VSCodeIDE/            # IDE 配置管理组件
│       └── index.vue
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
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

开发服务器将在 `http://localhost:5173` 启动，ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录，将 `dist/` 中的文件复制到 ZTools 插件目录即可使用。

## 🚀 使用方式

### 搜索历史项目

1. 在 ZTools 中输入指令 `搜索历史项目` / `vscode` 触发插件
2. 选择 IDE 配置（支持多 IDE 切换）
3. 输入关键词搜索项目，或直接查看最近 20 条记录
4. 点击「打开」在 VSCode / Cursor 中打开项目，或点击「删除」移除历史记录

### 管理 IDE 配置

1. 在 ZTools 中输入指令 `管理 IDE` 进入 IDE 管理页面
2. 使用快速创建按钮一键添加 VSCode / VSCode Insider / Cursor
3. 点击「自定义添加」支持任意自定义 IDE
4. 点击「编辑」修改终端命令、数据库路径等配置

## 📚 相关资源

- [ZTools 官方文档](https://github.com/ztool-center/ztools)
- [ZTools API 文档](https://github.com/ztool-center/ztools-api-types)

## ❓ 常见问题

### Q: 搜索不到项目记录？

A: 确认 VSCode / Cursor 已配置对应的数据库路径（state.vscdb）。在"IDE 管理"中添加或编辑 IDE 配置，数据库路径会自动填充。

### Q: 如何添加新的 IDE（如 Cursor、WebStorm）？

A: 进入"IDE 管理"页面，点击"自定义添加"，填写 IDE 标识和启动命令即可。数据库路径会自动检测。

### Q: 删除历史记录后如何恢复？

A: 当前版本不支持恢复已删除的记录，重新在 VSCode / Cursor 中打开一次项目会自动重新录入。

### Q: 如何调试插件？

A: 使用 `npm run dev` 启动开发服务器，在 ZTools 插件界面中打开开发者工具进行调试。

## 📄 开源协议

MIT License

---

**祝你开发愉快！** 🎉
