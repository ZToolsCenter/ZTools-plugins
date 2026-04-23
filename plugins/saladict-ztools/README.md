# ztools-saladict

> 沙拉查词 - 聚合词典专业查词翻译（ZTools 版）

**作者：EvanW** ([evanwen97-ops](https://github.com/evanwen97-ops))

这是沙拉查词（Saladict）的 ZTools 适配版。项目的核心思路是：

1. 将 Saladict 的前端扩展页面直接作为插件主体运行；
2. 用 `webextensions-emulator-master` 模拟 `browser.*` / `chrome.*` API；
3. 通过 `preload.cjs` 补足 ZTools 环境下的 Node.js 能力与网络能力；
4. 让用户可以在 ZTools 中直接使用沙拉查词的查词、历史、生词本等能力。

## 项目架构

```text
.
├── index.html                    # ZTools 运行入口，负责加载模拟器和插件主逻辑
├── plugin.json                   # ZTools 插件元数据、入口、作者与触发配置
├── preload.cjs                   # Electron preload 注入脚本，提供 axios、cookie、外部链接能力
├── preload/
│   ├── services.js               # 注入到页面的工具服务（读写文件等）
│   └── package.json              # 标记 preload 目录的模块类型
├── build-plugin.sh              # 一键构建脚本（安装依赖、构建模拟器、路径替换、打包输出到 dist/）
├── ext-saladic/                  # Saladict 原始扩展内容
│   ├── manifest.json             # 扩展清单
│   ├── *.html                    # quick-search / notebook / history / options / word-editor 等页面
│   ├── assets/                   # 扩展打包后的 JS/CSS/图片资源
│   └── _locales/                 # 国际化文案
└── webextensions-emulator-master/ # WebExtensions 模拟器子工程
    ├── lib/                      # 模拟器源码
    └── dist/                     # 由该子工程构建出来的运行产物
```

### 各目录职责

- **`index.html`**
  - ZTools 插件真正加载的页面入口。
  - 它只负责载入 `webextensions-emulator-master/dist/core.js`，再由模拟器启动 Saladict。

- **`plugin.json`**
  - ZTools 插件描述文件。
  - 定义插件名称、标题、作者、版本、主入口和触发方式。

- **`preload.cjs`**
  - 在 Electron 渲染进程中注入 `window.axios`、`window.tough`、`window.openExternal` 等能力。
  - 负责处理 Saladict 在 ZTools 环境里依赖的网络请求、Cookie 与外部链接打开。

- **`preload/`**
  - 放置更小的辅助服务脚本。
  - 当前主要用于把文件读写等能力挂到 `window.services` 上，方便页面侧调用。

- **`ext-saladic/`**
  - Saladict 本体资源目录。
  - 这里包含扩展页面、脚本、样式、图片、词库面板、生词本、历史记录、设置页等全部静态资源。

- **`webextensions-emulator-master/`**
  - WebExtensions API 模拟器。
  - 它负责把 `browser.runtime`、`browser.tabs`、`browser.windows`、`browser.storage` 等浏览器扩展接口映射到 ZTools 能运行的环境中。

## 构建产物说明

项目有两级 `dist` 目录：

- **`webextensions-emulator-master/dist/`** — 模拟器子工程的 webpack 构建输出（`core.js`、`background.js`），源码在 `lib/` 目录
- **`dist/`**（项目根目录） — `build-plugin.sh` 的一键构建输出，包含插件运行所需的全部文件，用于发布

`index.html` 直接引用模拟器产物的路径：

```text
webextensions-emulator-master/dist/core.js
webextensions-emulator-master/dist/background.js
```

## 构建与安装

### 一键构建

在项目根目录执行：

```bash
bash build-plugin.sh
```

脚本会自动完成：安装依赖 → 构建模拟器 → 路径替换 → esbuild 打包 preload → 输出到 `dist/`

### 手动构建

```bash
# 1. 安装根目录依赖
pnpm install

# 2. 安装并构建模拟器
cd webextensions-emulator-master
pnpm install
pnpm run build
cd ..

# 3. 执行路径替换
node webextensions-emulator-master/replace_url.js
```

### 启动 ZTools 插件

把构建产物 `dist/` 目录放到 ZTools 的插件目录后：

1. 重启 ZTools，或刷新插件列表
2. 输入「沙拉查词」或「saladict」触发插件
3. 也可以通过划词触发 `over` 模式

## 配置说明

### `plugin.json`

- `main: "index.html"`：ZTools 的入口页面
- `preload: "preload.cjs"`：渲染进程预加载脚本
- `features`：定义关键词触发与划词触发方式

### 资源加载关系

启动链路为：

```text
ZTools -> index.html -> webextensions-emulator-master/dist/core.js -> 加载 Saladict 页面
```

Saladict 页面再通过模拟器调用 `browser.runtime`、`browser.tabs`、`browser.windows` 等接口，从而实现原始浏览器扩展的运行效果。

## 致谢

本项目基于以下优秀的开源项目：

- **[Saladict 沙拉查词](https://github.com/crimx/ext-saladict)** — 由 [CRIMX](https://github.com/crimx) 开发的聚合词典浏览器扩展（v7.19.0）
- **[utools-saladict](https://github.com/anrgct/utools-saladict)** — uTools 版沙拉查词插件，为本项目的 ZTools 适配提供了参考
- **[ZTools](https://github.com/ZToolsCenter/ZTools)** — 桌面效率工具平台

感谢以上项目的作者和贡献者！

## 开源协议

MIT License
