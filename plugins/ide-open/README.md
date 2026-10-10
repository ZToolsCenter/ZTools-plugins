# ide-open

> 统一管理 VSCode 系及 JetBrains 系编辑器的最近项目 — ZTools 插件

## 功能

- 从编辑器的本地数据库/配置文件中读取最近项目列表
- 搜索并快速打开项目，支持键盘导航（↑↓ 选择、Enter 打开、Ctrl+D 删除）
- 支持动态注册快捷指令，输入别名即可进入对应编辑器的项目列表

### 支持的编辑器

| 编辑器 | 数据源格式 | 启动命令 |
|---|---|---|
| VS Code | SQLite (.vscdb) / JSON | `code` |
| Cursor | SQLite (.vscdb) | `cursor` |
| VSCodium | SQLite (.vscdb) | `codium` |
| Qoder | SQLite (.vscdb) | `qoder` |
| IntelliJ IDEA | XML (recentProjects.xml) | `idea` |
| PyCharm | XML | `pycharm` |
| WebStorm | XML | `webstorm` |
| GoLand | XML | `goland` |

## 项目结构

```
├── public/
│   ├── preload/
│   │   ├── package.json      # preload 依赖（sql.js）
│   │   ├── services.js        # Node.js 能力：SQLite/JSON/XML 读取、项目打开、删除
│   │   └── sql-wasm.wasm     # sql.js 的 wasm 文件
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
cd public/preload && npm install && cd ..

# 启动开发服务器
npm run dev

# 构建
npm run build
```

在 ZTools 中配置插件开发地址指向 `http://localhost:5173` 即可热加载调试。

## 使用

1. 在 ZTools 主搜索框输入 `ideopen` 进入设置页
2. 点击「+ 新增配置」，可点击「快速填入」按钮自动填充预设路径
3. 保存后，ZTools 主搜索框输入配置的别名（如 `vsc`、`cursor`）即可进入项目列表
4. 在项目列表中搜索并打开项目

## 技术栈

React 19 + Vite + TypeScript + sql.js

## License

MIT
