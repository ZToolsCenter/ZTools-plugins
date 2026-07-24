# 快速开始

hey，开发者，终于和你见面了。

从这里开始，将会慢慢的给你介绍如何开发一个 ZTools 插件应用，帮助你一步步的完成开发、构建和发布。

## 插件应用是什么

**Node.js 本地原生能力 + Web 前端网页**。(本地软件能做到的，理论上它也能做到)

ZTools 插件应用结合了 Web 前端技术的灵活性和 Node.js 的强大本地能力，让你可以：

- 🎨 使用 HTML、CSS、JavaScript 构建美观的用户界面
- ⚡ 通过 Node.js 访问系统原生能力（文件系统、网络、进程等）
- 🔌 使用丰富的 ZTools API（通知、剪贴板、窗口管理等）
- 📦 支持 Vue、React 等现代前端框架
- 🌍 跨平台运行（Windows、macOS、Linux）

## 环境要求

在开始开发你的第一个插件应用之前，请保证你已经做好以下准备：

### 必需工具

- **ZTools** - [下载地址](https://github.com/ZToolsCenter/ZTools/releases)
  - macOS: 下载 `ZTools-x.x.x-arm64.dmg` 或 `ZTools-x.x.x-arm64.zip`
  - Windows: 下载 `ZTools-x.x.x-setup.exe` 或 `ZTools-x.x.x-win.zip`
- **Node.js** >= 16.0.0 - [下载地址](https://nodejs.org/)
- **一个好用的代码编辑器** - 推荐 [VSCode](https://code.visualstudio.com/) 或者 [WebStorm](https://www.jetbrains.com/webstorm/)
- **Git** - 用于版本控制和插件发布（[下载地址](https://git-scm.com/)）

### 基础知识

- **熟悉 JavaScript** - 基础开发语言
- **熟悉 HTML 和 CSS** - 掌握基础的界面构建能力
- **了解 Node.js** - 接入强大的本地原生能力

### 进阶

可借助 **Vue** 或者 **React** 等主流的 Web 前端开发框架，增强你的应用界面。

ZTools 插件 CLI 工具提供了以下模板：

- **Vue + TypeScript + Vite** - 使用 Vue 3 开发插件 UI
- **React + TypeScript + Vite** - 使用 React 开发插件 UI
- **Preload Only (TypeScript)** - 仅使用 Preload API，无 UI 界面

# 插件应用目录结构

此部分会帮助你了解，通常情况下，一个插件应用的文件目录结构。

插件应用至少要有一个 `plugin.json` 作为入口，并配置 `logo` 字段以及 `main` 或者 `preload` 字段。

一个相对完整可打包成插件应用的目录可能是这样的：



```
/{plugin}
|-- plugin.json
|-- preload.js
|-- index.html
|-- index.js
|-- index.css
|-- logo.png
```

## 源码编译

ZTools 仅识别 `html + css + javascript`, 通常我们在开发过程中可能会使用各种的工具来辅助开发，比如 `vite`、`webpack` 等等，也可能会引入各种前端框架，比如 `vue`、`react`、`svelte` 等等，而这些代码并不是直接可以被 ZTools 识别的，当我们打包插件应用前应该先将框架代码编译成普通的 html 、css、js 文件。通常是将源码编译输出到 dist 文件夹，然后将 dist 文件夹打包成插件应用，切勿将整个项目的根目录打包成插件应用。

## 第三方依赖

当你使用第三方依赖时，根据项目情况进行区分：

当你使用前端依赖时，只需要在项目的根目录下安装即可，对前端项目进行正常的编译，输出到 `dist` 文件夹。

当你使用 nodejs 的第三方依赖时，应当保证你的模块存在于 `preload.js` 同级目录，并且不要对它们进行编译操作，保证提交插件应用时的目录结构不变，并且源码清晰可读。

# 第一个插件

本指南将帮助你使用 `@ztools-center/plugin-cli` 快速创建你的第一个 ZTools 插件，并发布到插件中心。

## 前置要求

在开始之前，请确保你已经安装了以下工具：

- **Node.js** >= 16.0.0
- **npm** 或 **pnpm** 包管理器
- **Git**（用于版本控制和发布）

## 安装 CLI 工具

首先，全局安装 ZTools 插件 CLI 工具：



```
npm install -g @ztools-center/plugin-cli
# 或
pnpm add -g @ztools-center/plugin-cli
```

安装完成后，你可以使用 `ztools` 命令来创建和管理插件。

## 创建第一个插件

### 步骤 1: 创建插件项目

使用 CLI 工具创建一个新的插件项目：



```
ztools create my-first-plugin
```

这个命令会引导你完成以下步骤：

1. **选择模板** - 你可以选择以下三种模板之一：
   - **Vue + TypeScript + Vite** - 使用 Vue 3 开发插件 UI
   - **React + TypeScript + Vite** - 使用 React 开发插件 UI
   - **Preload Only (TypeScript)** - 仅使用 Preload API，无 UI 界面
2. **输入插件信息**：
   - **Plugin name** - 插件唯一标识（ID），用于系统内部识别
   - **Plugin title** - 插件显示名称（在 ZTools 中展示给用户的标题）
   - **Plugin description** - 插件描述
   - **Author** - 作者名称

### 步骤 2: 进入项目目录

创建完成后，进入项目目录：



```
cd my-first-plugin
```

### 步骤 3: 安装依赖

根据你选择的包管理器安装依赖：



```
npm install
# 或
pnpm install
```

### 步骤 4: 开发插件

现在你可以开始开发你的插件了。根据你选择的模板，项目结构会有所不同：

- **Vue/React 模板**：在 `src/` 目录下开发 UI 组件
- **Preload Only 模板**：在 `src/` 目录下编写 Preload 脚本

开发时，你可以运行开发服务器：



```
npm run dev
# 或
pnpm run dev
```

### 步骤 5: 构建插件

开发完成后，构建插件：



```
npm run build
# 或
pnpm run build
```

构建产物会输出到 `dist/` 目录。这个目录就是你的插件应用，可以打包提交。

## 发布插件

当你完成插件开发并准备好发布时，可以使用 CLI 工具将插件发布到 ZTools 插件中心。

### 前置条件

在发布之前，请确保：

1. ✅ 项目包含 `plugin.json` 文件（CLI 会自动生成）
2. ✅ 已初始化 Git 仓库（`git init`）
3. ✅ 至少有一次提交记录
4. ✅ 工作区干净（没有未提交的改动）

### 初始化 Git 仓库

如果还没有初始化 Git 仓库，请执行：



```
git init
git add .
git commit -m "Initial commit"
```

### 发布流程

执行发布命令：



```
ztools publish
```

#### 首次发布

首次执行 `ztools publish` 时，CLI 会自动完成：

1. **GitHub OAuth 认证** - 通过 Device Flow 引导你在浏览器授权一次（含 `workflow` scope），token 保存在 `~/.config/ztools/cli-config.json`
2. **Fork 中心仓库** - 自动在你账号下 fork `ZToolsCenter/ZTools-plugins`（已存在则复用）
3. **同步 fork main** - 调用 GitHub merge-upstream API 把 fork 的 main 拉齐到上游，避免后续分支基于落后的 main 导致冲突
4. **判定 Add / Update** - 检查上游 `plugins/<你的插件 ID>/` 目录是否存在，决定 PR 标题用 `Add` 还是 `Update`
5. **复制工作目录文件** - 把当前目录内容复制到 fork 的 `plugins/<插件 ID>/`（自动忽略 `node_modules`、`dist`、`.env*` 等）
6. **生成 commit + 推送分支** - 在 fork 的 `plugin/<插件 ID>` 分支上做**一个** commit 并普通 push（不 force）
7. **创建 Draft Pull Request** - 自动开 PR 到中心仓库，默认 draft 状态

#### 后续发布（增量更新）

每次 `ztools publish` 都是**增量追加**：

- 远端分支保留旧 commit，只 fast-forward 追加一个新 commit
- 同一个 PR 自动复用，链接不变
- 不会 force-push，旧的 review 评论上下文不会丢失

> 例：你本地累计 5 个 commit 发布出去后，远端 PR 上是 1 个 "Add plugin Foo v0.1.0" commit；又改了 3 个 commit 再发布，远端就 fast-forward 多 1 个 "Update plugin Foo v0.1.1" commit，旧的不动。

更详细的发布与协作机制（CHANGELOG 自动注入、智能 commit 标题、`pull-contributions` 拉回审核者改动等）请参考 [发布与协作流程](https://ztoolscenter.github.io/ZTools-doc/publish-and-update.html)。

### 发布成功后

CLI 会输出类似：



```
✨ 插件发布成功!
🔗 Pull Request: https://github.com/ZToolsCenter/ZTools-plugins/pull/123

💡 下一步：去 PR 网页完善以下内容（CLI 无法自动生成）
  📸 上传截图 / 演示 GIF
  ✅ 勾选自检清单
  🚦 把 PR 从 Draft 切到 "Ready for review"
```

务必完成这 3 件事，否则维护者不会进入审核：

1. **截图 / 演示 GIF** - 直接拖图到 PR description 编辑框，GitHub 会自动上传
2. **自检清单** - PR description 里有 5 项 checkbox，逐条勾上
3. **Mark as ready for review** - 右下角按钮，把 PR 从 Draft 切到正式审核状态

## 项目结构

创建的项目通常包含以下结构：



```
my-first-plugin/
├── plugin.json          # 插件配置文件
├── package.json         # 项目依赖配置
├── tsconfig.json        # TypeScript 配置
├── vite.config.js       # Vite 构建配置（如果使用 Vite 模板）
├── src/                 # 源代码目录
│   ├── preload.ts       # Preload 脚本
│   └── ...              # 其他源文件
├── public/              # 静态资源
│   └── logo.png         # 插件 Logo
└── dist/                # 构建输出目录（构建后生成）
```

## 常见问题

### Q: 如何修改插件配置？

A: 编辑项目根目录下的 `plugin.json` 文件。你可以修改插件标识（name）、显示名称（title）、描述、功能列表等。更多信息请参考 [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html)。

### Q: 如何添加插件功能？

A: 在 `plugin.json` 的 `features` 数组中添加功能配置。每个功能需要定义：

- `code` - 功能唯一标识
- `explain` - 功能说明
- `cmds` - 触发指令列表

### Q: 发布失败怎么办？

A: 检查以下几点：

- 确保在插件项目根目录下执行命令
- 确保已初始化 Git 并至少有一次提交
- 确保 `plugin.json` 文件存在且格式正确
- 检查网络连接和 GitHub 认证状态

### Q: 如何更新已发布的插件？

A: 修改代码、`git commit`，然后再次执行 `ztools publish`。CLI 会自动在**同一个 PR** 上 fast-forward 追加一个新 commit，链接不变。如果上一次的 PR 已经合并，新的 publish 会以 `Update` 标题开一个新 PR。

### Q: 审核者直接在 PR 分支上改了代码，我下次 publish 会被拒，怎么办？

A: 跑 `ztools pull-contributions`，它会把审核者的 commit 三方合并回你本地，再 `ztools publish` 即可。详见 [发布与协作流程](https://ztoolscenter.github.io/ZTools-doc/publish-and-update.html#pull-contributions)。

### Q: PR 标题是怎么决定的？

A: PR 标题始终是 `Add plugin <名称> v<版本>` 或 `Update plugin <名称> v<版本>`，由"中心仓库 main 是否已有该插件目录"决定。每次发布在 commit message 里会附带你本地自上次发布以来的 commit subjects 作为变更明细。

### Q: 我删了上一个 PR 重新 publish 没反应？

A: 你之前 publish 过时 fork 上分支已经存在；CLI 检测到本地内容与 fork 一致就不会再 commit。这种情况会**自动复用已有 branch 重开一个 PR**——直接重新跑 `ztools publish` 即可，新 PR 链接会显示在终端。

# plugin.json 配置

plugin.json 文件是插件应用的配置文件，它是最重要的一个文件，用来定义这个插件应用将如何与 ZTools 集成。 每当你创建一个插件应用时，都需要从创建一个 plugin.json 文件开始。

## 配置文件格式

plugin.json 文件是一个标准的 JSON 文件，它的结构如下：



```
{
  "name": "example",
  "title": "示例插件",
  "description": "这是一个示例插件",
  "version": "1.0.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "features": [
    {
      "code": "hello",
      "explain": "hello world",
      "cmds": ["hello", "你好"]
    }
  ]
}
```

## 基础字段说明

### `name`

- 类型：`string`
- 必填：是

插件应用唯一标识（ID），用于在系统中唯一标识该插件。

### `title`

- 类型：`string`
- 必填：是

插件应用显示名称，在 ZTools 中展示给用户看的标题。

### `description`

- 类型：`string`
- 必填：否

插件应用描述

### `version`

- 类型：`string`
- 必填：否

插件应用版本

### `main`

- 类型：`string`
- 必填：是

插件入口，可以是一个相对于 `plugin.json` 的相对路径的 `.html` 文件，或者是一个在线地址

### `logo`

- 类型：`string`
- 必填：是

插件应用 Logo，必须为 png 或 jpg 文件

### `preload`

- 类型：`string`
- 必填：是

预加载 js 文件，这是一个关键文件，你可以在此文件内调用 nodejs、 electron 提供的 api。 查看更多关于 [preload.js](https://ztoolscenter.github.io/ZTools-doc/preload.js)

## 开发模式字段说明

### `development`

- 类型：`object`
- 必填：否

开发模式下的配置，对象的同名字段会覆盖基础配置字段。

### `development.main`

- 类型：`string`
- 必填：否

开发模式下，插件应用的入口文件，与基础配置字段 main 字段相同

## 插件应用功能字段说明

### `features`

- 类型：`Array<Feature>`
- 必填：否

插件功能列表，定义插件支持的功能及其触发方式。

### `feature.code`

- 类型：`string`
- 说明：功能唯一标识，用于区分不同功能。

### `feature.explain`

- 类型：`string`
- 说明：功能说明，显示在搜索结果中。

### `feature.cmds`

- 类型：`Array<string | RegexCmd | OverCmd | ImgCmd | FilesCmd>`
- 说明：触发指令列表。可以是简单的字符串，也可以是匹配对象（正则、全局、图片、文件等）。

### `feature.platform`

- 类型：`Array<'win32' | 'darwin' | 'linux'>`
- 必填：否
- 说明：支持的平台。如果不填，默认支持所有平台。

## 指令类型详解

### 文本指令 (String)

最简单的触发方式，当用户输入完全匹配该文本时触发。



```
{
  "features": [
    {
      "code": "hello",
      "explain": "打招呼",
      "cmds": ["hello", "你好"]
    }
  ]
}
```

### 正则表达式指令 (RegexCmd)

使用正则表达式匹配用户输入。



```
{
  "features": [
    {
      "code": "color",
      "explain": "颜色预览",
      "cmds": [
        {
          "type": "regex",
          "label": "颜色预览",
          "match": "/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/i",
          "minLength": 4
        }
      ]
    }
  ]
}
```

- `type`: 固定为 `"regex"`
- `label`: 匹配成功后显示的名称
- `match`: 正则表达式字符串 (例如 `"/^abc/i"`)
- `minLength`: 触发匹配的最小字符长度

### 全局匹配指令 (OverCmd)

匹配任意文本，通常用于需要处理所有输入的场景（如翻译、搜索插件）。



```
{
  "features": [
    {
      "code": "translate",
      "explain": "翻译",
      "cmds": [
        {
          "type": "over",
          "label": "翻译",
          "exclude": "/^exclude/i",
          "minLength": 1,
          "maxLength": 1000
        }
      ]
    }
  ]
}
```

- `type`: 固定为 `"over"`
- `label`: 显示的名称
- `exclude`: (可选) 排除匹配的正则表达式字符串
- `minLength`: (可选) 最小字符数
- `maxLength`: (可选) 最大字符数 (默认 10000)

### 图片匹配指令 (ImgCmd)

当用户粘贴图片到 ZTools 时触发，用于处理图片的插件（如图片压缩、格式转换、OCR 识别等）。



```
{
  "features": [
    {
      "code": "image-process",
      "explain": "图片处理",
      "cmds": [
        {
          "type": "img",
          "label": "图片处理"
        }
      ]
    }
  ]
}
```

- `type`: 固定为 `"img"`
- `label`: 显示的名称

**使用场景**：

- 图片压缩
- 图片格式转换
- OCR 文字识别
- 图片编辑
- 图片上传

### 文件匹配指令 (FilesCmd)

当用户粘贴文件或文件夹到 ZTools 时触发，支持多种过滤条件来精确匹配文件。



```
{
  "features": [
    {
      "code": "file-process",
      "explain": "文件处理",
      "cmds": [
        {
          "type": "files",
          "label": "批量重命名",
          "fileType": "file",
          "extensions": ["txt", "md", "json"],
          "match": "/^test/i",
          "minLength": 1,
          "maxLength": 100
        }
      ]
    }
  ]
}
```

- `type`: 固定为 `"files"`
- `label`: 显示的名称
- `fileType`: (可选) 文件类型，`"file"` 表示只匹配文件，`"directory"` 表示只匹配文件夹。不指定则文件和文件夹都匹配
- `extensions`: (可选) 文件扩展名数组，只对文件有效（不检查文件夹）。例如 `["jpg", "png", "gif"]`
- `match`: (可选) 匹配文件(夹)名称的正则表达式字符串。例如 `"/^test/i"` 表示匹配以 "test" 开头的文件名（不区分大小写）
- `minLength`: (可选) 最少文件数，默认 1
- `maxLength`: (可选) 最多文件数，默认 10000

**匹配规则**：

1. 首先检查文件数量是否在 `minLength` 和 `maxLength` 范围内
2. 然后检查每个文件是否满足以下条件（如果指定）：
   - 文件类型（`fileType`）
   - 文件扩展名（`extensions`）
   - 文件名正则匹配（`match`）

**使用场景**：

- 批量文件重命名
- 文件格式转换
- 文件压缩打包
- 文件批量上传
- 代码文件批量处理





# 认识 preload

当你在 `plugin.json` 文件配置了 `preload` 字段，指定的 js 文件将被预加载，该 js 文件可以调用 Node.js API 的本地原生能力和 Electron 渲染进程 API。

## 为什么需要 `preload`

在传统的 web 开发中，为了保持用户运行环境的安全，JavaScript 被做了很强的沙箱限制，比如不能访问本地文件，不能访问跨域网络资源，不能访问本地存储等。

ZTools 基于 Electron 构建，通过 preload 机制，在渲染线程中，释放了沙箱限制，使得用户可以通过调用 Node.js 的 API 来访问本地文件、跨域网络资源、本地存储等。

## `preload` 的定义

`preload` 是完全独立于前端项目的一个特殊文件，它应当与 `plugin.json` 位于同一目录或其子目录下，保证可以在打包插件应用时可以被一起打包。

`preload` js 文件遵循 CommonJS 规范，因此你可以使用 `require` 来引入 Node.js 模块，此部分可以参考 Node.js 文档。

## 前端使用 `preload`

只需给 `window` 对象自定义一个属性，前端就可直接访问该属性。

**preload.js**



```
const fs = require("fs");

window.customApis = {
  readFile: (path) => {
    return fs.readFileSync(path, "utf8");
  },
};
```

## preload js 规范

由于 `preload` js 文件可使用本地原生能力，为了防止开发者滥用各种读写文件、网络等能力，ZTools 规定：

- `preload` js 文件代码不能进行打包/压缩/混淆等操作，要保证每一行代码清晰可读。
- 引入的第三方模块也必须清晰可读，在提交时将源码一同提交，同样不允许压缩/混淆。





```
    } else {
      console.log("Email sent: " + info.response);
    }
  });
};
window.services = {
  sendMail: () => {
    return sendMail();
  },
};
```

## 引入 Electron 渲染进程 API

preload.js



```
const { clipboard, nativeImage } = require("electron");

window.services = {
  copyImage: (imageFilePath) => {
    clipboard.writeImage(nativeImage.createFromPath(imageFilePath))
  },
};
```



# 插件 API 文档

ZTools 为插件提供了一套丰富的 API，通过全局对象 `window.ztools` 暴露。

## 基础 API

### `ztools.getAppName()`

获取应用名称。

- **返回**: `string` - 应用名称，固定返回 `'ZTools'`。

### `ztools.getPathForFile(file)`

获取拖放文件的真实路径。用于处理用户拖放文件到插件界面的场景（基于 Electron `webUtils.getPathForFile`）。

- **file**: `File` - 拖放事件中的 File 对象。
- **返回**: `string` - 文件的本地路径。

### `ztools.isMacOs()` / `ztools.isMacOS()`

检测当前是否为 macOS 系统。

- **返回**: `boolean` - 是否为 macOS。

### `ztools.isWindows()`

检测当前是否为 Windows 系统。

- **返回**: `boolean` - 是否为 Windows。

### `ztools.isLinux()`

检测当前是否为 Linux 系统。

- **返回**: `boolean` - 是否为 Linux。

### `ztools.getNativeId()`

获取设备唯一标识符（32位字符串）。

- **返回**: `string` - 设备唯一标识符。

### `ztools.getAppVersion()`

获取应用版本号。

- **返回**: `string` - 应用版本号。

### `ztools.getWindowType()`

获取当前窗口类型。

- **返回**: `string` - 窗口类型。

### `ztools.isDarkColors()`

检测当前是否为深色主题。

- **返回**: `boolean` - 是否为深色主题。

### `ztools.isDev()`

检查当前插件是否处于开发模式。

- **返回**: `boolean` - 是否处于开发模式。

### `ztools.getWebContentsId()`

获取当前 WebContents ID。

- **返回**: `number` - WebContents ID。

### `ztools.setExpendHeight(height)`

设置插件视图的高度。

- **height**: `number` - 期望的高度（像素）。

### `ztools.showNotification(body)`

显示系统通知。

- **body**: `string` - 通知内容。

### `ztools.sendInputEvent(event)`

发送模拟输入事件。

- **event**: `MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent` - 输入事件对象。

#### 事件对象结构

**KeyboardInputEvent (键盘事件)**

- `type`: `'keyDown'` | `'keyUp'` | `'char'`
- `keyCode`: `string` - 键盘代码
- `modifiers`: `string[]` - 修饰键数组 (例如 `['shift', 'control']`)

**MouseInputEvent (鼠标事件)**

- `type`: `'mouseDown'` | `'mouseUp'` | `'mouseEnter'` | `'mouseLeave'` | `'contextMenu'` | `'mouseMove'`
- `x`: `number` - X 坐标
- `y`: `number` - Y 坐标
- `button`: `'left'` | `'middle'` | `'right'` - 按钮类型
- `clickCount`: `number` - 点击次数

**MouseWheelInputEvent (滚轮事件)**

- `type`: `'mouseWheel'`
- `deltaX`: `number`
- `deltaY`: `number`
- `wheelTicksX`: `number`
- `wheelTicksY`: `number`
- `accelerationRatioX`: `number`
- `accelerationRatioY`: `number`
- `hasPreciseScrollingDeltas`: `boolean`
- `canScroll`: `boolean`

### `ztools.simulateKeyboardTap(key, ...modifiers)`

模拟键盘按键。

- **key**: `string` - 要按下的键。
- **modifiers**: `string[]` - 修饰键数组（可选）。
- **返回**: `boolean` - 是否成功。

### `ztools.showMainWindow()`

显示主窗口。

- **返回**: `Promise<boolean>` - 是否成功。

### `ztools.hideMainWindow(isRestorePreWindow)`

隐藏主窗口，包括此时正在主窗口运行的插件应用。

- **isRestorePreWindow**: `boolean` - (可选) 是否焦点回归到前面的活动窗口，默认 `true`。
- **返回**: `Promise<boolean>` - 是否成功。

### `ztools.outPlugin(isKill)`

退出插件应用，默认将插件应用隐藏后台。

- **isKill**: `boolean` - (可选) 为 `true` 时，将结束运行插件应用 (杀死进程)。
- **返回**: `Promise<boolean>` - 是否成功。

## 事件 API

### `ztools.onPluginEnter(callback)`

监听插件进入事件。当用户打开插件时触发。

- **callback**: `(param: LaunchParam) => void` - 回调函数，接收启动参数。

#### LaunchParam 结构

- `payload`: `any` - 传递的数据（例如搜索框内容）
- `type`: `'text' | 'regex' | 'over'` - 命令类型
  - `'text'`: 文本匹配
  - `'regex'`: 正则表达式匹配
  - `'over'`: 任意文本匹配
- `code`: `string` - 插件 Feature Code (如果是由 Feature 触发)

### `ztools.onPluginOut(callback)`

监听插件退出事件。

- **callback**: `(isKill: boolean) => void` - 回调函数，接收退出参数。
  - `isKill`: 是否为强制退出（杀死进程）。

### `ztools.onPluginDetach(callback)`

监听插件被分离为独立窗口的事件。当用户将插件从主窗口分离时触发。

- **callback**: `() => void` - 回调函数。

### `ztools.onMainPush(callback, selectCallback)`

注册主搜索推送功能。插件可以在主搜索框中提供搜索结果，用户无需进入插件即可看到结果。

- **callback**: `(queryData: any) => object[]` - 查询回调函数，接收搜索数据，返回搜索结果数组。
- **selectCallback**: `(selectData: any) => boolean` - (可选) 用户选择搜索结果时的回调函数。返回 `true` 表示需要进入插件。

### `ztools.onPluginReady(callback)`

兼容旧 API，功能与 `onPluginEnter` 相同。

- **callback**: `(param: LaunchParam) => void` - 回调函数，接收启动参数。

## 搜索框 API

### `ztools.setSubInput(onChange, placeholder, isFocus)`

设置主窗口搜索框的行为（当插件处于活动状态时）。

- **onChange**: `(text: string) => void` - 当用户在搜索框输入时触发的回调函数。
- **placeholder**: `string` - 搜索框的占位符文本。
- **isFocus**: `boolean` - (可选) 是否自动聚焦搜索框，默认 `true`。

### `ztools.setSubInputValue(text)`

设置子输入框的值。

- **text**: `string` - 要设置的值。

### `ztools.subInputFocus()`

聚焦子输入框。

- **返回**: `boolean` - 是否成功。

### `ztools.subInputBlur()`

子输入框失去焦点，插件应用获得焦点。

- **返回**: `boolean` - 是否成功。

### `ztools.subInputSelect()`

子输入框获得焦点并选中全部内容。

- **返回**: `boolean` - 是否成功。

### `ztools.removeSubInput()`

移除（隐藏）子输入框。

- **返回**: `Promise<boolean>` - 是否成功。

## 数据库 API

插件拥有独立的数据库存储空间（Bucket），以插件名称隔离。

### `ztools.db.put(doc)`

保存数据。

- **doc**: `object` - 文档对象（必须包含 `_id` 字段）。
- **返回**: `object` - 保存后的文档对象（包含 `_id` 和 `_rev`）。

### `ztools.db.get(id)`

获取数据。

- **id**: `string` - 文档 ID。
- **返回**: `object | null` - 文档对象，不存在则返回 `null`。

### `ztools.db.remove(docOrId)`

删除数据。

- **docOrId**: `object | string` - 要删除的文档对象（通常包含 `_id` 和 `_rev`）或文档 ID。
- **返回**: `object` - 删除结果。

### `ztools.db.bulkDocs(docs)`

批量操作文档。

- **docs**: `object[]` - 文档数组。
- **返回**: `object[]` - 操作结果数组。

### `ztools.db.allDocs(key)`

获取所有文档或按 key 前缀查询。

- **key**: `string` - (可选) 文档 ID 前缀，用于过滤。
- **返回**: `object[]` - 文档数组。

### `ztools.db.postAttachment(id, attachment, type)`

为文档添加附件。

- **id**: `string` - 文档 ID。
- **attachment**: `string | Buffer` - 附件内容（base64 字符串或 Buffer）。
- **type**: `string` - 附件 MIME 类型。
- **返回**: `object` - 操作结果。

### `ztools.db.getAttachment(id)`

获取文档附件。

- **id**: `string` - 文档 ID。
- **返回**: `Buffer` - 附件内容。

### `ztools.db.getAttachmentType(id)`

获取文档附件的 MIME 类型。

- **id**: `string` - 文档 ID。
- **返回**: `string` - MIME 类型。

### Promise API

数据库 API 还提供了 Promise 版本，位于 `window.ztools.db.promises` 下，所有方法签名与同步版本相同，但返回 `Promise`。

- `window.ztools.db.promises.put(doc)`
- `window.ztools.db.promises.get(id)`
- `window.ztools.db.promises.remove(docOrId)`
- `window.ztools.db.promises.bulkDocs(docs)`
- `window.ztools.db.promises.allDocs(key)`
- `window.ztools.db.promises.postAttachment(id, attachment, type)`
- `window.ztools.db.promises.getAttachment(id)`
- `window.ztools.db.promises.getAttachmentType(id)`

## dbStorage API

类似 `localStorage` 的简化接口，用于简单的键值对存储。

### `ztools.dbStorage.setItem(key, value)`

保存数据。

- **key**: `string` - 键名。
- **value**: `any` - 要保存的数据（会自动序列化为 JSON）。

### `ztools.dbStorage.getItem(key)`

获取数据。

- **key**: `string` - 键名。
- **返回**: `any` - 数据内容，不存在则返回 `null`。

### `ztools.dbStorage.removeItem(key)`

删除数据。

- **key**: `string` - 键名。

## 动态 Feature API

### `ztools.getFeatures(codes)`

获取动态添加的 features。

- **codes**: `string[]` - (可选) 指定要获取的 feature codes，不传则返回所有。
- **返回**: `object[]` - Feature 数组。

### `ztools.setFeature(feature)`

设置动态 feature（如果已存在则更新）。

- **feature**: `object` - Feature 对象。
- **返回**: `boolean` - 是否成功。

### `ztools.removeFeature(code)`

删除指定的动态 feature。

- **code**: `string` - Feature code。
- **返回**: `boolean` - 是否成功。

## 剪贴板 API

### `ztools.clipboard.getHistory(page, pageSize, filter)`

获取剪贴板历史记录。

- **page**: `number` - 页码，从 1 开始。
- **pageSize**: `number` - 每页数量。
- **filter**: `string` - (可选) 过滤条件。
- **返回**: `Promise<object>` - 历史记录数据。

### `ztools.clipboard.search(keyword)`

搜索剪贴板历史。

- **keyword**: `string` - 搜索关键词。
- **返回**: `Promise<object[]>` - 匹配的记录数组。

### `ztools.clipboard.delete(id)`

删除剪贴板记录。

- **id**: `string` - 记录 ID。
- **返回**: `Promise<boolean>` - 是否成功。

### `ztools.clipboard.clear(type)`

清空剪贴板历史。

- **type**: `string` - (可选) 类型过滤。
- **返回**: `Promise<boolean>` - 是否成功。

### `ztools.clipboard.getStatus()`

获取剪贴板状态。

- **返回**: `Promise<object>` - 状态信息。

### `ztools.clipboard.write(id, shouldPaste)`

将指定记录写入剪贴板。

- **id**: `string` - 记录 ID。
- **shouldPaste**: `boolean` - (可选) 是否同时模拟粘贴操作，默认 `true`。
- **返回**: `Promise<boolean>` - 是否成功。

### `ztools.clipboard.writeContent(data, shouldPaste)`

写入内容到剪贴板。

- **data**: `object` - 数据对象。
  - `type`: `'text' | 'image'` - 内容类型。
  - `content`: `string` - 内容（文本或 base64 图片）。
- **shouldPaste**: `boolean` - (可选) 是否同时模拟粘贴操作，默认 `true`。
- **返回**: `Promise<boolean>` - 是否成功。

### `ztools.clipboard.updateConfig(config)`

更新剪贴板配置。

- **config**: `object` - 配置对象。
- **返回**: `Promise<boolean>` - 是否成功。

### `ztools.clipboard.onChange(callback)`

监听剪贴板变化事件。

- **callback**: `(item: object) => void` - 回调函数，接收剪贴板变化项。

### `ztools.copyText(text)`

复制文本到剪贴板。

- **text**: `string` - 要复制的文本。
- **返回**: `boolean` - 是否成功。

### `ztools.copyImage(image)`

复制图片到剪贴板。

- **image**: `string` - 图片 base64 Data URL 或文件路径。
- **返回**: `boolean` - 是否成功。

### `ztools.copyFile(filePath)`

复制文件到剪贴板。

- **filePath**: `string` - 文件路径。
- **返回**: `boolean` - 是否成功。

## 文件操作 API

### `ztools.getPath(name)`

获取系统路径。

- **name**: `string` - 路径名称（如 `'home'`, `'desktop'`, `'documents'` 等）。
- **返回**: `string` - 路径。

### `ztools.showSaveDialog(options)`

弹出文件保存对话框。

- **options**: `SaveDialogOptions` - 对话框配置，与 Electron `showSaveDialogSync` 保持一致。
- **返回**: `string | undefined` - 选择的路径。用户取消则返回 `undefined`。

### `ztools.showOpenDialog(options)`

弹出文件打开对话框。

- **options**: `OpenDialogOptions` - 对话框配置，与 Electron `showOpenDialogSync` 保持一致。
- **返回**: `string[] | undefined` - 选择的文件路径数组。用户取消则返回 `undefined`。

### `ztools.screenCapture(callback)`

屏幕截图，会进入截图模式，用户截图完执行回调函数。

- **callback**: `(image: string) => void` - 截图完的回调函数。
  - `image`: 截图的图像 base64 Data Url。

## 窗口 API

### `ztools.createBrowserWindow(url, options, callback)`

创建独立窗口。

- **url**: `string` - 窗口加载的 URL。
- **options**: `object` - 窗口选项，与 Electron `BrowserWindow` 构造函数选项保持一致。
- **callback**: `() => void` - (可选) 窗口加载完成后的回调函数。
- **返回**: `Proxy<BrowserWindow> | null` - 返回一个模拟 BrowserWindow 的 Proxy 对象，可用于调用窗口方法和访问属性。创建失败返回 `null`。

### `ztools.sendToParent(channel, ...args)`

发送消息到父窗口。

- **channel**: `string` - 通道名称。
- **args**: `any[]` - 要传递的参数。

## 显示器 API

### `ztools.getPrimaryDisplay()`

获取主显示器信息。

- **返回**: `object` - 显示器信息对象。

### `ztools.getAllDisplays()`

获取所有显示器。

- **返回**: `object[]` - 显示器信息数组。

### `ztools.getCursorScreenPoint()`

获取鼠标光标的屏幕坐标。

- **返回**: `object` - 坐标对象 `{ x: number, y: number }`。

### `ztools.getDisplayNearestPoint(point)`

获取最接近指定点的显示器。

- **point**: `object` - 坐标对象 `{ x: number, y: number }`。
- **返回**: `object` - 显示器信息对象。

### `ztools.desktopCaptureSources(options)`

获取桌面捕获源。

- **options**: `object` - 捕获选项。
- **返回**: `Promise<object[]>` - 捕获源数组。

### `ztools.dipToScreenPoint(point)`

DIP 坐标转屏幕物理坐标。

- **point**: `object` - DIP 坐标对象 `{ x: number, y: number }`。
- **返回**: `object` - 屏幕物理坐标对象 `{ x: number, y: number }`。

### `ztools.screenToDipPoint(point)`

屏幕物理坐标转 DIP 坐标。

- **point**: `object` - 屏幕物理坐标对象 `{ x: number, y: number }`。
- **返回**: `object` - DIP 坐标对象 `{ x: number, y: number }`。

### `ztools.dipToScreenRect(rect)`

DIP 区域转屏幕物理区域。

- **rect**: `object` - DIP 区域对象 `{ x: number, y: number, width: number, height: number }`。
- **返回**: `object` - 屏幕物理区域对象 `{ x: number, y: number, width: number, height: number }`。

## Shell API

### `ztools.shellOpenExternal(url)`

使用系统默认程序打开 URL。

- **url**: `string` - 要打开的 URL。
- **返回**: `boolean` - 是否成功。

### `ztools.shellOpenPath(fullPath)`

使用系统默认方式打开文件或文件夹。

- **fullPath**: `string` - 文件或文件夹路径。
- **返回**: `boolean` - 是否成功。

### `ztools.shellShowItemInFolder(fullPath)`

在文件管理器中显示文件。

- **fullPath**: `string` - 文件路径。
- **返回**: `boolean` - 是否成功。

## 其他 API

### `ztools.redirect(label, payload)`

插件跳转。

- **label**: `string` - 目标插件的 label。
- **payload**: `any` - 传递的数据。
- **返回**: `boolean` - 是否成功。

### `ztools.http.setHeaders(headers)`

设置 HTTP 请求头。

- **headers**: `object` - 请求头对象。
- **返回**: `boolean` - 是否成功。

### `ztools.http.getHeaders()`

获取当前请求头配置。

- **返回**: `object` - 请求头对象。

### `ztools.http.clearHeaders()`

清除请求头配置。

- **返回**: `boolean` - 是否成功。

## AI API

### `ztools.ai(option, streamCallback)`

调用 AI 模型。支持流式和非流式两种模式。返回一个 PromiseLike 对象，同时具有 `abort()` 方法可中断请求。

- **option**: `object` - AI 调用配置。
- **streamCallback**: `(chunk: any) => void` - (可选) 流式回调函数。传入此参数时启用流式模式，每收到一段数据会调用此回调。
- **返回**: `PromiseLike & { abort: () => void }` - 可 await 的 Promise 对象。
  - 非流式模式：resolve 时返回 AI 响应数据。
  - 流式模式：数据通过 `streamCallback` 逐步推送，Promise resolve 时表示完成。
  - 调用 `.abort()` 可中断请求。

#### 使用示例



```
// 非流式调用
const result = await ztools.ai({ prompt: '你好' })

// 流式调用
const request = ztools.ai({ prompt: '你好' }, (chunk) => {
  console.log('收到数据:', chunk)
})
await request

// 中断请求
request.abort()
```

### `ztools.allAiModels()`

获取所有可用的 AI 模型列表。

- **返回**: `Promise<object[]>` - AI 模型数组。
- **异常**: 获取失败时抛出 Error。



# 发布与协作流程

本页详细介绍 `ztools publish` 和 `ztools pull-contributions` 的内部机制与高级使用场景。如果你只想快速发布一次插件，先看 [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html) 的发布章节就够了。

## 整体模型

ZTools 插件中心采用 **fork + PR** 模式：

- 中心仓库：`ZToolsCenter/ZTools-plugins`
- 每位作者在自己 GitHub 账号下 fork 一份
- 每次发布走「复制工作目录 → 在 fork 的 `plugin/<插件 ID>` 分支上 commit → push → 开 PR」

`ztools-plugin-cli` 把这套流程自动化了，并提供以下保障：

- **增量发布**：每次发布只 fast-forward 追加一个 commit，不 force-push
- **持久化缓存**：fork 在本地 clone 一次（`~/.config/ztools/ZTools-plugins/`），后续发布复用
- **正确的 Add/Update 判定**：基于上游 main 的实际状态而非分支存在性
- **协作友好**：审核者直推后通过 `pull-contributions` 三方合并回本地

## 发布命令详解

### `ztools publish` 完整流程



```
1. 校验 plugin.json + git 仓库 + 工作区干净
2. CHANGELOG 检查（缺失当前版本节时交互式录入）
3. GitHub OAuth 认证（首次会引导浏览器授权）
4. Fork 中心仓库（不存在则自动创建）
5. ensureForkClone：clone 或 fetch 本地 fork 缓存
6. syncForkMain：调用 merge-upstream API 同步 fork main
7. pluginExistsUpstream：探测上游 plugins/<id>/ 目录决定 Add/Update
8. prepareBranch：在 fork 分支上 checkout（已存在则复用，否则基于 upstream/main 新建）
9. copyPluginFiles：把工作目录复制进 plugins/<id>/，自动忽略 node_modules、dist 等
10. commitPluginChanges：组装智能 commit message 并提交（无变更则跳过）
11. pushPluginBranch：普通 push，不 force（first push 用 -u）
12. createPullRequest：复用已有 open PR 或开 draft PR
13. tagLastPublishLocally：在你本地仓库 HEAD 打 ztools-last-publish 标签
```

### 智能 commit / PR 标题

CLI 会读取你本地 `ztools-last-publish..HEAD` 之间的 commit subjects（即"自上次发布以来你写了哪些 commit"），按以下规则组装：

| subjects 数量 | PR 标题                            | fork 端 commit message                       |
| :------------ | :--------------------------------- | :------------------------------------------- |
| 0             | `Add/Update plugin <名称> v<版本>` | 同 PR 标题                                   |
| 1             | `Add/Update plugin <名称> v<版本>` | **直接用你的 commit subject 原文**           |
| ≥2            | `Add/Update plugin <名称> v<版本>` | fallback 标题 + bullet list 列出所有 subject |

**关键设计**：PR 标题永远是规整的 `Add/Update ...` 格式，方便维护者扫 PR 列表。详细语义放在 commit body 里，审核者点进 Commits tab 仍能看到你的原话。

### Add vs Update 自动判定

CLI 调 `GET /repos/ZToolsCenter/ZTools-plugins/contents/plugins/<插件 ID>`：

- **404** → 上游没这个目录 → **Add**
- **200** → 上游已合并过此插件 → **Update**

> 这比"看 fork 分支是否存在"更准确：合并后分支被自动删除时仍能正确报告 Update。

API 网络异常时退化为 Add（保守策略，避免误导）。

## CHANGELOG.md 处理

### 自动抽取

如果你的项目根目录有 `CHANGELOG.md`，CLI 会按以下规则抓出"本次变更"内容注入到 PR description：

1. 找到匹配当前版本的标题（支持 `## 0.1.0`、`## v0.1.0`、`## [0.1.0]`、`# 0.1.0` 等多种写法）
2. 抽取该节内容到下一个同级或更高级标题之前
3. 注入到 PR body 的「本次变更」段

边界保护：`0.1.0` 不会误匹配 `0.10.0`，反之亦然。

### 找不到当前版本节怎么办？

CLI 在交互式终端会主动提示：



```
📝 未在 CHANGELOG.md 中找到 v0.3.0 的变更说明
? 选择处理方式 ›
❯ 现在编辑（打开 $EDITOR 录入本次变更）
  跳过（PR 中显示 placeholder，稍后在网页填）
  中止发布
```

**选 "现在编辑"** → CLI 启动 `$EDITOR`（默认 `vi`）打开预填模板的临时文件：



```
# 请简述 Demo Plugin v0.3.0 的本次变更。
# 以 # 开头的行会被忽略；保存并关闭编辑器即可继续发布。
# 直接关闭（不保存）或留空 → 跳过本次录入。
#
# 例如：
#   ### Added
#   - 新增批量导入
#
#   ### Fixed
#   - 修复空输入崩溃
```

保存退出后，CLI 会再确认是否把这一节写回 `CHANGELOG.md`：



```
? 把这一节写入 CHANGELOG.md（同时自动 git commit）？ › (Y/n)
```

确认 → 在 H1 之后、首个 H2 之前插入新版本节 → `git add CHANGELOG.md && git commit -m "chore(changelog): add vX.Y.Z entry"` → 继续发布主流程。

### 非交互式 / CI 环境

`stdin` 或 `stdout` 不是 TTY 时（CI、`< /dev/null` 重定向等），CLI 不会弹任何 prompt，自动按以下优先级填充 PR 的「本次变更」段：

1. CHANGELOG.md 当前版本节（如有）
2. 本地 commit subjects bullet list（如有）
3. `<!-- 简要描述本次新增 / 更新内容 -->` placeholder

这样 `ztools publish < /dev/null` 在脚本里跑也不会卡。

### 长 CHANGELOG 截断

如果当前版本节找不到、且整个 CHANGELOG 文件超过 80 行，CLI 只截前 50 行注入并附 `_…(CHANGELOG 已截断，完整内容请见仓库)_` 标记，避免 PR description 过长。

## PR description 模板

每个 PR 自动生成的 description 包含 4 节：



```
## 插件信息

- **名称**: ...
- **插件ID**: ...
- **版本**: ...
- **描述**: ...
- **作者**: ...
- **类型**: 新增 / 更新

## 本次变更

{CHANGELOG 节 / commit subjects / placeholder}

## 截图 / 演示

<!-- 如果是新插件或包含界面变化，请附 1-2 张截图或 GIF -->

## 自检清单

- [ ] plugin.json 的 name / title / version / description / author 字段均已检查
- [ ] 已移除调试日志、未使用文件、敏感信息（.env、token、密钥等）
- [ ] 本次 PR 的 diff 仅涉及 `plugins/<id>/` 目录
- [ ] 已在本地 ZTools 客户端实际加载并测试过此插件，主要功能正常
- [ ] 同意以仓库声明的开源协议发布此插件
```

CLI 把所有可自动生成的部分都填好；**截图、自检清单勾选、Ready for review 切换**这三件事必须你手动到 PR 网页上完成。

## 增量发布：远端只追加，不改写

### 每次 publish 远端发生什么

| 场景                   | 远端分支变化                                                 |
| :--------------------- | :----------------------------------------------------------- |
| 首次 publish           | 创建 `plugin/<id>` 分支，1 个 commit                         |
| 后续 publish（有改动） | 在分支末尾 fast-forward 追加 1 个 commit，旧 commit SHA 不变 |
| 后续 publish（无改动） | 不动分支；如果当前没有 open PR，会基于现有分支重开一个       |
| 审核者直推后 publish   | 被拒 → 提示跑 `pull-contributions`                           |

### 为什么不 force-push

force-push 会让审核者本地 checkout 的分支无法 fast-forward、PR 评论上下文错位、其他贡献者直推的 commit 被覆盖。Raycast 也是这么设计的。

## `ztools pull-contributions`

当审核者或其他贡献者直接在你的 PR 分支上推送过 commit，下次 `ztools publish` 会被拒：



```
❌ 发布失败
错误: 远端 plugin/<id> 分支有你本地缓存中没有的新 commit。
请先把这些改动同步回本地，再次发布：
  $ ztools pull-contributions
  $ ztools publish
```

### 工作机制（三方合并）

1. 校验工作区干净 + 找到本地的 `ztools-last-publish` 标签作为 merge base
2. 拉取 fork 端 plugin 分支最新内容
3. 在你本地仓库新建临时分支 `ztools/pull-<时间戳>`，从 `ztools-last-publish` 出发
4. 把 fork 当前文件镜像到临时分支并 commit "Pull contributions from PR"
5. 切回原分支，`git merge --no-ff` 临时分支 → 触发 git 三方合并
6. 不冲突的文件 → 自动并入；冲突文件 → 暴露给你手工解决

### 合并示例

设上次发布后：

- **你本地**：在 `index.js` 末尾加了一行 `// my change`，对 `util.ts` 加了一个新函数
- **fork PR 分支**：审核者在 `index.js` 末尾加了 `// reviewer fix`，新建了 `REVIEWER.md`

`ztools pull-contributions` 之后：

- `util.ts` ：保留你的新函数（双方无冲突，自动合并）
- `REVIEWER.md`：被并入你本地（双方无冲突，自动合并）
- `index.js`：触发冲突，文件里出现 `<<<<<<< HEAD` / `=======` / `>>>>>>>` 标记，需要你手工编辑后 `git add` + `git commit`

### 冲突时怎么办

CLI 会停在合并未完成状态并提示：



```
❌ 合并出现冲突，需要你手工解决。
  当前处于合并未完成状态：
  - 临时分支: ztools/pull-1700000000000

  解决步骤：
    1) 编辑冲突文件 → git add <文件>
    2) git commit  完成合并
    3) 然后再 ztools publish

  或者放弃此次拉取：git merge --abort && git branch -D ztools/pull-1700000000000
```

按提示走即可。解决冲突后再 `ztools publish` 就能继续追加发布。

## 故障排查

### 推送被拒：`refusing to allow an OAuth App to ... workflow`

中心仓库 main 含 `.github/workflows/*.yml`，OAuth token 必须有 `workflow` scope。CLI 默认请求该 scope；如果你是从老版本升级上来的、本地 token 没这个 scope：



```
# 清掉旧 token，重新授权一次（这次会要求 workflow scope）
rm ~/.config/ztools/cli-config.json
ztools publish
```

### `merge-upstream` 422 错误

通常是 fork main 已经偏离上游（你手动改过 fork 的 main）。处理：



```
# 进入 fork 缓存
cd ~/.config/ztools/ZTools-plugins
git checkout main
git fetch upstream
git reset --hard upstream/main
git push -f origin main
```

或更简单：删除本地 fork 缓存 + 重新发布



```
rm -rf ~/.config/ztools/ZTools-plugins
ztools publish
```

### 工作区有未提交改动

CLI 拒绝带脏工作区发布：



```
❌ 发布失败
错误: 工作区存在未提交的改动，请先 commit 或 discard 后再发布
```

按字面意思 `git commit` 或 `git restore` 处理即可。

### 想看 CLI 的本地缓存仓库

所有 fork 操作发生在 `~/.config/ztools/ZTools-plugins/`，里面是个普通 git 仓库，可以正常 `git log` / `git branch -a` 检查。

### 想完全重置



```
rm -rf ~/.config/ztools/                # 清掉 token + fork 缓存
git tag -d ztools-last-publish 2>/dev/null  # 清掉本地 publish 标签
```

下次 `ztools publish` 会重走 OAuth + 重新 clone fork。

## 相关链接

- [ztools-plugin-cli (npm)](https://www.npmjs.com/package/@ztools-center/plugin-cli)
- [ZTools-plugins 中心仓库](https://github.com/ZToolsCenter/ZTools-plugins)
- [GitHub merge-upstream API](https://docs.github.com/en/rest/branches/branches#sync-a-fork-branch-with-the-upstream-repository)