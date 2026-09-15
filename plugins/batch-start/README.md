# 批量启动

> 扫描本机应用、手动分类，并将启动组注册为 ZTools 指令，实现一键批量启动。

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 [ZTools](https://ztoolscenter.github.io/ZTools-doc/) 插件。

![logo](src-ztools/logo.png)

## ✨ 功能特性

- **应用扫描** — 扫描系统已安装应用 + 自定义目录（Windows / macOS / Linux）
- **手动分类** — 自建分类，将应用拖入/分配到分类
- **启动组** — 勾选多个应用组成启动组；保存后自动 `setFeature` 注册为 ZTools 指令
- **一键启动** — 主搜索输入组指令即可几乎同时启动组内全部应用
- **卸载过滤** — 自动忽略名称/路径含 `uninstall` / `卸载` 的项
- **按需运行** — 仅在唤起时启动；退出或组启动完成后 `outPlugin(true)` 结束进程，不常驻后台

### 触发指令

| Feature | 说明 | 指令 |
|---------|------|------|
| `manage` | 打开管理界面 | `批量启动`、`应用启动组` |
| `group:<id>` | 动态注册，启动对应组 | 启动组名称（保存时写入） |

## 📁 项目结构

```
.
├── src-ztools/                 # ★ 完整可安装插件目录（本地安装选这个）
│   ├── logo.png                # 插件 Logo
│   ├── plugin.json             # 插件配置
│   ├── preload/
│   │   ├── package.json        # {"type":"commonjs"}
│   │   └── services.js         # 构建生成的 Preload
│   └── dist/                   # UI 构建产物（index.html + assets）
├── src/                        # Vue 源码 + preload TypeScript
│   ├── components/             # 管理页组件
│   ├── services/               # 扫描 / 分类 / 启动组 / FeatureSync
│   ├── preload.ts              # Preload 入口（构建到 services.js）
│   ├── App.vue
│   └── main.ts
├── public/logo.png             # 源 Logo（构建时同步到 src-ztools）
├── docs/superpowers/           # 设计与实现计划
├── tests/                      # Vitest 单元测试
├── plugin.json                 # 与 src-ztools/plugin.json 保持一致（发布用）
├── vite.config.ts              # base: './'，outDir: src-ztools/dist
├── CHANGELOG.md
└── README.md
```

> 依据 [插件应用目录结构](https://ztoolscenter.github.io/ZTools-doc/file-structure.html)：请将 **编译后的插件目录**（本项目为 `src-ztools/`）安装到 ZTools，**不要**把整个源码根目录当作插件安装。

## 🚀 快速开始

### 环境要求

- Node.js >= 16
- npm 或 pnpm
- 已安装 [ZTools](https://github.com/ZToolsCenter/ZTools)

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器默认 `http://localhost:5173`。`plugin.json` 中已配置：

```json
"development": {
  "main": "http://localhost:5173"
}
```

本地安装 `src-ztools/` 后，开发模式下 ZTools 会走 `development.main`。

### 构建

```bash
npm run build
```

- UI → `src-ztools/dist/`（`base: './'`，相对资源路径，避免 file 协议空白页）
- Preload → `src-ztools/preload/services.js`

### 测试

```bash
npm test
```

## 📦 本地安装（ZTools）

按 [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html) / [Vibe Coding](https://ztoolscenter.github.io/ZTools-doc/vibe-coding.html)：

1. `npm run build`
2. ZTools → **插件管理** → **本地安装**
3. 选择 **`src-ztools` 文件夹**，或安装仓库根目录的 `batch-start-plugin.zip`
4. 主搜索输入 **「批量启动」**

打包 ZIP（可选）：

```powershell
Compress-Archive -Path "src-ztools\*" -DestinationPath "batch-start-plugin.zip" -Force
```

## 📖 使用说明

1. 打开插件管理页 → **扫描**（可 **添加目录**）
2. 左侧建立分类并分配应用
3. 右侧 **创建启动组**，勾选应用、设置指令名后保存（同步为 ZTools Feature）
4. 回到主搜索，输入启动组指令 → 组内应用几乎同时启动
5. 管理页可对当前组 **试跑**

### 平台支持

| 平台 | 扫描来源 | 可加入启动组 |
|------|----------|--------------|
| Windows | 开始菜单 `.lnk` + 自定义目录 | `.exe` / `.bat` / `.cmd` / `.lnk` |
| macOS | `/Applications`、`~/Applications` + 自定义目录 | `.app` 等 |
| Linux | `.desktop` + 自定义目录 | 可执行文件 / `.desktop` |

## 🔧 开发要点

### plugin.json

核心字段见 [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html)：

| 字段 | 本插件取值 |
|------|------------|
| `name` | `batch-start` |
| `title` | `批量启动` |
| `main` | `dist/index.html` |
| `preload` | `preload/services.js` |
| `logo` | `logo.png` |
| `platform` | `win32` / `darwin` / `linux` |

### Preload / Node 能力

业务逻辑在 `src/preload.ts` 与 `src/services/*`，构建后输出到 `src-ztools/preload/services.js`，通过 `window.batchStart` 暴露给 UI。

宿主 API（`window.ztools`）用于：`db`、`setFeature` / `removeFeature`、`shellOpenPath`、`showOpenDialog`、`showToast`、`onPluginEnter` 等。详见 [插件 API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)。

### 调试

1. `npm run dev` + 本地安装 `src-ztools`
2. 打开插件后，点击插件头像菜单 → **打开开发者工具**

## 📤 发布到插件中心

按 [第一个插件 · 发布](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html)：

```bash
npm install -g @ztools-center/plugin-cli
# 工作区干净、已 commit
ztools publish
```

发布后请在 PR 中：上传截图/GIF、勾选自检清单、Mark as ready for review。

## ❓ 常见问题

### Q: 打开插件是空白页？

A: 确认安装的是 **`src-ztools/`**，且已 `npm run build`。Vite 必须 `base: './'`，否则 `/assets/...` 在 file 协议下会加载失败。

### Q: 中文应用名乱码？

A: 已改为用 Node 文件名作为显示名，快捷方式目标经 UTF-8 临时文件解析。请重新构建后 **再扫描一次**。

### Q: Logo 不显示？

A: 确认 `src-ztools/logo.png` 存在，且 `plugin.json` 中 `"logo": "logo.png"`。

### Q: 如何忽略卸载项？

A: 扫描会自动过滤名称/路径含 `uninstall` / `卸载` 以及常见 `unins*.exe` 的条目。

## 📚 相关资源

- [ZTools 开发者文档](https://ztoolscenter.github.io/ZTools-doc/)
- [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html)
- [插件应用目录结构](https://ztoolscenter.github.io/ZTools-doc/file-structure.html)
- [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html)
- [插件 API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)
- [ztools-plugin-cli](https://github.com/ZToolsCenter/ztools-plugin-cli)

## 📄 License

MIT
