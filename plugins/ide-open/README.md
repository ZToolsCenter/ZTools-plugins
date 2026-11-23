# ide-open

> 统一管理 VSCode 系及 JetBrains 系编辑器的最近项目 — ZTools 插件

## 功能

- 从编辑器的本地数据库/配置文件中读取最近项目列表
- 搜索并快速打开项目，支持键盘导航（↑↓ 选择、Enter 打开）
- 通过项目行的删除按钮或右键菜单移除 SQLite 历史记录
- 支持动态注册快捷指令，输入别名即可进入对应编辑器的项目列表

### 支持的编辑器

| 编辑器 | 数据源格式 | 启动命令 |
|---|---|---|
| VS Code | SQLite (.vscdb) / JSON | `code` |
| Cursor | SQLite (.vscdb) / JSON | `cursor` |
| VSCodium | SQLite (.vscdb) / JSON | `codium` |
| Qoder | SQLite (.vscdb) / JSON | `qoder` |
| IntelliJ IDEA | XML (recentProjects.xml) | `idea` |
| PyCharm | XML | `pycharm` |
| WebStorm | XML | `webstorm` |
| GoLand | XML | `goland` |

## 项目结构

```
├── public/
│   ├── preload/
│   │   ├── package.json      # preload 依赖（saxes）
│   │   └── services.js       # Node.js 能力：SQLite/JSON/XML 读取、项目打开、删除
│   ├── plugin.json           # 插件配置
│   └── logo.png
├── src/
│   ├── App.tsx               # 入口：onPluginEnter 路由分发
│   ├── store.ts              # 渲染层数据封装
│   ├── env.d.ts              # 类型声明
│   ├── Settings/             # IDE 配置页面（增删改、快速填入预设）
│   └── ProjectList/          # 项目列表页面（setSubInput 搜索 + 键盘导航）
├── vite.config.js            # base: './'
└── tsconfig.json
```

## 开发

```bash
# 安装依赖（前端 + preload）
npm install
npm ci --prefix public/preload

# 启动开发服务器
npm run dev

# 回归测试（Node.js 22.13 或更新版本）
npm test

# 构建（自动安装并打包 preload 依赖）
npm run build
```

在 ZTools 中配置插件开发地址指向 `http://localhost:5173` 即可热加载调试。

## 使用

1. 在 ZTools 主搜索框输入 `ideopen` 进入设置页
2. 点击「+ 新增配置」，可点击「快速填入」按钮自动填充预设路径
3. 保存后，ZTools 主搜索框输入配置的别名（如 `vsc`、`cursor`）即可进入项目列表
4. 在项目列表中搜索并打开项目

macOS 上的快速填入使用 `/usr/bin/open -a "应用名"` 打开本地项目。VS Code 系预设打开远程项目时，会优先使用对应应用内置的 CLI。

## 技术栈

React 19 + Vite + TypeScript。SQLite 历史通过 ZTools 内置的 Node.js SQLite 模块读写。

## License

MIT
