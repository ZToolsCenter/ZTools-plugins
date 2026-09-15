# ZTools AI 插件开发指南

本文档面向 AI 编程助手，用于在接到“开发一个 ZTools 插件”的需求后，快速做出正确技术判断并产出可运行、可构建、可发布的插件项目。

ZTools 插件的核心模型是：**Web 前端页面 + Node.js 本地能力 + ZTools 平台 API**。

- 前端页面负责 UI 和交互，可使用原生 HTML/CSS/JS、Vue、React 等技术。
- `preload.js` 负责暴露本地能力，可使用 Node.js 16.x 原生模块、Electron 渲染进程 API 和可读的第三方 CommonJS 模块。
- `plugin.json` 负责声明插件元信息、入口、Logo、功能和触发指令。
- `window.ztools` 是插件调用 ZTools 能力的全局 API。

## AI 开发原则

当 AI 生成或修改 ZTools 插件时，必须遵守以下规则：

1. 先明确插件形态：有 UI 插件、纯 preload 插件、文件处理插件、图片处理插件、主搜索增强插件、AI 能力插件。
2. 先写 `plugin.json`，再实现 `preload.js` 和前端入口。
3. 使用内置框架模板时以 `src-ztools/` 作为插件根目录，其中 `dist/` 只放页面构建结果；不要把包含 `src/`、开发依赖和构建缓存的源码项目根目录当成插件目录。
4. 前端依赖可以被 Vite/Webpack 等工具打包；Node.js 依赖必须与 `preload.js` 同级并保持源码可读。
5. `preload.js` 不允许压缩、混淆或打包成不可读代码。
6. 涉及文件系统、命令执行、网络请求、剪贴板和系统窗口时，优先在 `preload.js` 封装最小 API，再暴露给前端。
7. 使用 `window.ztools` 时要考虑异步返回值、平台差异和插件生命周期。
8. 生成代码时默认兼容 Windows、macOS、Linux；确有平台限制时在 `plugin.json` 顶层 `platform` 中声明。
9. 所有用户输入、文件路径、网络结果都要做基本校验和错误处理。
10. 发布前必须能通过构建，并确认 `src-ztools/` 中包含 `plugin.json`、Logo、preload，以及 `dist/` 中 `main` 指向的页面。
11. 有 `main` 页面入口的 UI 插件不要使用 `window.exports` + `mode: "none"`；该模式只用于无界面或纯 preload 命令插件。UI 插件应通过 `ztools.onPluginEnter` 接收入口参数。

## 插件开发决策树

收到用户需求后，AI 应按下面顺序判断：

| 需求特征                                 | 推荐方案                                                |
| ---------------------------------------- | ------------------------------------------------------- |
| 需要表单、列表、设置页、结果展示         | Vue/React/Vite 或原生 Web UI                            |
| 只需要后台处理、复制、通知、快速响应     | Preload Only                                            |
| 需要读写文件、调用系统命令、访问本地程序 | 在 `preload.js` 使用 Node.js API                        |
| 需要处理用户粘贴的图片                   | 使用 `img` 指令                                         |
| 需要处理用户粘贴的文件或文件夹           | 使用 `files` 指令                                       |
| 需要匹配特定输入格式                     | 使用 `regex` 指令                                       |
| 需要处理任意搜索框输入                   | 使用 `over` 指令                                        |
| 需要在主搜索结果中直接显示候选项         | 使用 `ztools.onMainPush`                                |
| 需要保存插件数据                         | 简单键值用 `ztools.dbStorage`，结构化数据用 `ztools.db` |
| 需要简单调用 AI 模型                     | 使用 `ztools.ai` 和 `ztools.allAiModels`                |
| 需要自行管理工具循环、推理过程或 usage   | 使用 `ztools.aiChat` 和 `ztools.allAiModels`            |

## 标准开发流程

### 1. 创建项目

使用 `develop-ztools-plugins` skill 自带的 Python 生成器创建 Vue 项目：

```bash
python3 <skill-dir>/scripts/create_plugin.py ./my-plugin \
  --template vue \
  --name my-plugin \
  --title "My Plugin"
cd my-plugin
npm install
```

生成器当前内置 `Vue + TypeScript + Vite` 模板。目标目录必须不存在，插件 ID 只允许小写字母、数字和中划线；用可重复的 `--platform` 参数声明 `win32`、`darwin` 或 `linux`。如果用户明确要求尚未内置的模板，再说明限制并按用户确认使用官方 CLI；官方 CLI 通常还包括：

- `React + TypeScript + Vite`：适合复杂 UI。
- `Preload Only (TypeScript)`：适合无 UI 或轻量自动化能力。

创建完成后必须先替换模板 Logo：根据插件定位生成独立 SVG 源图标，使用 `magick`、`sips` 或其他可靠工具转换为 `plugin.json.logo` 引用的图片，并检查尺寸、透明背景、清晰度及模板 Logo 哈希差异。Logo 未完成时不得继续构建、测试或交付；无法生成或转换时应暂停并说明，不能使用模板图标代替。

### 2. 开发运行

```bash
npm run dev
```

开发模式下，通常在 `plugin.json` 中配置：

```json
{
  "main": "index.html",
  "development": {
    "main": "http://localhost:5173"
  }
}
```

ZTools 开发模式会使用 `development.main` 覆盖基础 `main`。

### 3. 构建插件

```bash
npm run build
```

构建后页面输出到 `src-ztools/dist/`。最终提交给 ZTools 的插件应用目录是 `src-ztools/`，而不是带有页面源码、构建缓存和开发依赖的项目根目录。

### 4. 发布插件

发布前要求：

- 项目根目录存在 `plugin.json`。
- 已初始化 Git 仓库。
- 至少有一次 commit。

```bash
git init
git add .
git commit -m "Initial commit"
ztools publish
```

`ztools publish` 会进行 GitHub OAuth 认证、Fork 插件中心仓库、创建 `plugin/{插件名称}` 分支、重放 commit、推送并创建 Pull Request。

## 插件目录结构

最小插件必须包含：

- `plugin.json`
- `logo` 指向的 png 或 jpg 文件
- `main` 或 `preload` 字段中的至少一个实际入口

内置模板的典型插件目录：

```text
src-ztools/
├── plugin.json
├── logo.png
├── preload/
│   ├── package.json
│   └── services.js
└── dist/
    ├── index.html
    └── assets/
```

使用 Vite 和框架时，源码项目可能类似：

```text
my-plugin/
├── plugin.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── preload.ts
│   ├── main.ts
│   └── App.vue
├── public/
│   ├── logo.png
│   ├── plugin.json
│   ├── preload.js
│   └── package.json
└── dist/
```

AI 生成项目时要确认 Vite 只把页面写到 `src-ztools/dist/`。`plugin.json`、preload 和 Logo 保留在 `src-ztools/`，由清单通过相对路径引用，不要重复复制到 `dist/`。

使用 Vite 且项目根目录为 `"type": "module"` 时，`public/preload.js` 仍必须保持 CommonJS。推荐在 `public/package.json` 中声明：

```json
{
  "type": "commonjs"
}
```

这样 `src-ztools/preload/` 中的脚本可以继续使用 `require()`。

## plugin.json 规范

`plugin.json` 是插件入口配置。基础示例：

```json
{
  "name": "example",
  "title": "示例插件",
  "description": "这是一个示例插件",
  "version": "1.0.0",
  "platform": ["darwin"],
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "hello",
      "explain": "hello world",
      "cmds": ["hello", "你好"]
    }
  ]
}
```

### 基础字段

| 字段          | 类型                                    | 必填 | 说明                                         |
| ------------- | --------------------------------------- | ---- | -------------------------------------------- |
| `name`        | `string`                                | 是   | 插件唯一标识，用于系统内部识别               |
| `title`       | `string`                                | 是   | 插件显示名称                                 |
| `description` | `string`                                | 否   | 插件描述                                     |
| `version`     | `string`                                | 否   | 插件版本                                     |
| `main`        | `string`                                | 是   | 插件页面入口，可以是相对 HTML 路径或在线地址 |
| `logo`        | `string`                                | 是   | png 或 jpg Logo                              |
| `preload`     | `string`                                | 是   | 预加载脚本路径                               |
| `development` | `object`                                | 否   | 开发模式配置，同名字段覆盖基础字段           |
| `platform`    | `Array<"win32" \| "darwin" \| "linux">` | 否   | 限制整个插件支持的平台；平台限制应放在顶层   |
| `features`    | `Feature[]`                             | 否   | 功能和触发方式                               |

### Feature 字段

| 字段      | 类型                      | 说明                       |
| --------- | ------------------------- | -------------------------- |
| `code`    | `string`                  | 功能唯一标识               |
| `explain` | `string`                  | 功能说明，显示在搜索结果中 |
| `cmds`    | `Array<string \| object>` | 触发指令列表               |

## 指令类型

### 文本指令

用户输入完全匹配文本时触发。

```json
{
  "code": "hello",
  "explain": "打招呼",
  "cmds": ["hello", "你好"]
}
```

适合固定命令、设置入口、工具首页。

### 正则指令

用户输入满足正则时触发。

```json
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
```

字段说明：

- `type`: 固定为 `regex`
- `label`: 匹配后的展示名称
- `match`: 正则字符串，例如 `"/^abc/i"`
- `minLength`: 触发匹配的最小输入长度

适合颜色值、URL、时间、编码格式、固定语法等场景。

### 全局匹配指令

匹配任意文本。

```json
{
  "code": "translate",
  "explain": "翻译文本",
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
```

字段说明：

- `type`: 固定为 `over`
- `label`: 展示名称
- `exclude`: 可选，排除匹配的正则字符串
- `minLength`: 可选，最小字符数
- `maxLength`: 可选，最大字符数，默认 `10000`

适合翻译、搜索、AI 问答、文本处理等场景。

### 图片指令

用户向 ZTools 粘贴图片时触发。

```json
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
```

适合图片压缩、格式转换、OCR、图片上传、图片编辑。

### 文件指令

用户向 ZTools 粘贴文件或文件夹时触发。

```json
{
  "code": "file-process",
  "explain": "批量处理文件",
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
```

字段说明：

- `type`: 固定为 `files`
- `label`: 展示名称
- `fileType`: 可选，`file` 只匹配文件，`directory` 只匹配文件夹
- `extensions`: 可选，文件扩展名数组，只对文件有效
- `match`: 可选，匹配文件或文件夹名称的正则字符串
- `minLength`: 可选，最少文件数，默认 `1`
- `maxLength`: 可选，最多文件数，默认 `10000`

匹配顺序是文件数量、文件类型、扩展名、文件名正则。

## preload.js 开发规范

`preload.js` 用于访问本地能力，遵循 CommonJS 规范：

```javascript
const fs = require("node:fs");
const path = require("node:path");
const { clipboard, nativeImage } = require("electron");

window.services = {
  readFile(filename) {
    return fs.readFileSync(filename, { encoding: "utf-8" });
  },
  getFolder(filepath) {
    return path.dirname(filepath);
  },
  copyImage(imageFilePath) {
    clipboard.writeImage(nativeImage.createFromPath(imageFilePath));
    return true;
  },
};
```

前端可直接调用：

```javascript
const text = window.services.readFile("/path/to/file.txt");
```

AI 编写 `preload.js` 时应遵守：

- 使用 `require`，不要使用 ESM `import`。
- 只暴露业务需要的最小接口，不把 `fs`、`child_process` 等完整模块直接挂到 `window`。
- 对路径、参数、文件大小和扩展名做校验。
- 对可能失败的本地操作返回明确错误信息。
- 不要在 preload 中写 UI 逻辑。
- 不要压缩、混淆或打包 preload 代码。

### Node.js 依赖

如果 `preload.js` 需要第三方 npm 模块，应在 `preload.js` 同级目录准备独立的 CommonJS `package.json`：

```json
{
  "type": "commonjs",
  "dependencies": {
    "colord": "^2.9.3"
  }
}
```

然后在同级目录执行：

```bash
npm install
```

再在 `preload.js` 中使用：

```javascript
const { colord, getFormat } = require("colord");
```

提交插件时，第三方模块源码也必须保持清晰可读。

## 生命周期和入口参数

前端应使用 `ztools.onPluginEnter` 接收插件启动参数：

```javascript
ztools.onPluginEnter(({ payload, type, code }) => {
  if (code === "translate" && payload) {
    runTranslate(payload);
  }
});
```

有 `main` 页面入口的 UI 插件应使用上面的方式接收参数，不要在 `preload.js` 中声明 `window.exports`：

```javascript
// UI 插件不要这样写
window.exports = {
  "some-code": {
    mode: "none",
    args: {
      enter() {},
    },
  },
};
```

`window.exports` + `mode: "none"` 适合无界面插件或纯 preload 命令插件；如果插件有 Vue/React/HTML 页面，使用它会绕开正常页面入口，可能导致窗口高度、生命周期和 payload 传递异常。

`LaunchParam` 字段：

| 字段      | 说明                                         |
| --------- | -------------------------------------------- |
| `payload` | 传递数据，例如搜索框文本、粘贴图片或文件信息 |
| `type`    | 命令类型，常见值为 `text`、`regex`、`over`   |
| `code`    | 触发的 Feature Code                          |

其他生命周期：

```javascript
ztools.onPluginOut((isKill) => {
  // 插件退出，isKill 表示是否强制结束
});

ztools.onPluginDetach(() => {
  // 插件被分离为独立窗口
});
```

## 常用 ZTools API

### 基础能力

| API                                         | 用途                          |
| ------------------------------------------- | ----------------------------- |
| `ztools.getAppName()`                       | 获取应用名，固定返回 `ZTools` |
| `ztools.getAppVersion()`                    | 获取应用版本                  |
| `ztools.getNativeId()`                      | 获取设备唯一标识              |
| `ztools.isMacOS()` / `ztools.isMacOs()`     | 判断 macOS                    |
| `ztools.isWindows()`                        | 判断 Windows                  |
| `ztools.isLinux()`                          | 判断 Linux                    |
| `ztools.isDarkColors()`                     | 判断深色主题                  |
| `ztools.isDev()`                            | 判断开发模式                  |
| `ztools.setExpendHeight(height)`            | 设置插件视图高度              |
| `ztools.showNotification(body)`             | 显示系统通知                  |
| `ztools.showMainWindow()`                   | 显示主窗口                    |
| `ztools.hideMainWindow(isRestorePreWindow)` | 隐藏主窗口                    |
| `ztools.outPlugin(isKill)`                  | 退出插件                      |

### 搜索框

```javascript
ztools.setSubInput(
  (text) => {
    search(text);
  },
  "输入关键词",
  true,
);

ztools.setSubInputValue("默认文本");
ztools.subInputSelect();
ztools.removeSubInput();
```

适合需要在插件打开后继续让用户输入的场景。

## 界面样式和主题

ZTools 主窗口可能使用透明或半透明材质。UI 插件不要写死大面积纯白、浅灰或深色背景，应优先使用透明背景和 CSS 变量适配主题。推荐全局样式：

```css
:root {
  --bg-app: transparent;
  --bg-surface: transparent;
  --bg-hover: rgba(245, 245, 245, 0.7);
  --text-primary: #333333;
  --text-secondary: #666666;
  --border-color: rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-app: transparent;
    --bg-surface: transparent;
    --bg-hover: rgba(50, 50, 70, 0.7);
    --text-primary: #e0e0e0;
    --text-secondary: #a0a0a0;
    --border-color: rgba(255, 255, 255, 0.1);
  }
}

html,
body {
  margin: 0;
  background: transparent;
  color: var(--text-primary);
}
```

组件内部用 `var(--bg-app)`、`var(--bg-surface)`、`var(--text-primary)`、`var(--border-color)` 等变量，不要把主要容器写成固定的 `#fff`、`#f4f6fb` 或 `#111827`。如需半透明遮罩，可使用 `rgba(...)` 配合 `backdrop-filter`，并为暗色模式单独定义变量。

### 主搜索推送

```javascript
ztools.onMainPush(
  (queryData) => {
    return [
      {
        title: "结果标题",
        description: "结果说明",
        payload: queryData,
      },
    ];
  },
  (selectData) => {
    return true;
  },
);
```

`selectCallback` 返回 `true` 表示用户选择结果后进入插件。

### 数据存储

简单键值：

```javascript
ztools.dbStorage.setItem("config", { theme: "auto" });
const config = ztools.dbStorage.getItem("config");
ztools.dbStorage.removeItem("config");
```

结构化文档：

```javascript
await ztools.db.promises.put({
  _id: "note:001",
  title: "示例",
  content: "内容",
});

const doc = await ztools.db.promises.get("note:001");
const docs = await ztools.db.promises.allDocs("note:");
```

选择建议：

- 设置项、开关、最近使用记录：用 `dbStorage`。
- 列表、历史记录、需要 `_id` 的结构化数据：用 `db`。
- 涉及大量异步 UI 更新时，优先使用 `ztools.db.promises`。

### 剪贴板

```javascript
ztools.copyText("hello");
ztools.copyImage("data:image/png;base64,...");
ztools.copyFile("/path/to/file.txt");

await ztools.clipboard.writeContent(
  {
    type: "text",
    content: "hello",
  },
  true,
);
```

`shouldPaste` 默认 `true`，会在写入剪贴板后模拟粘贴。

### 文件和路径

```javascript
const desktop = ztools.getPath("desktop");

const files = ztools.showOpenDialog({
  properties: ["openFile", "multiSelections"],
});

const savePath = ztools.showSaveDialog({
  title: "保存文件",
  defaultPath: "result.txt",
});
```

处理拖拽 `File` 对象时：

```javascript
const realPath = ztools.getPathForFile(file);
```

### 截图

```javascript
ztools.screenCapture((image) => {
  // image 是 base64 Data URL
  ztools.copyImage(image);
});
```

### 窗口和系统打开

```javascript
ztools.shellOpenExternal("https://example.com");
ztools.shellOpenPath("/path/to/file.txt");
ztools.shellShowItemInFolder("/path/to/file.txt");

const win = ztools.createBrowserWindow("https://example.com", {
  width: 900,
  height: 600,
});
```

### 模拟输入

```javascript
ztools.simulateKeyboardTap("v", "control");

ztools.sendInputEvent({
  type: "keyDown",
  keyCode: "A",
  modifiers: ["control"],
});
```

跨平台快捷键要判断系统，例如 macOS 使用 `command`，Windows/Linux 使用 `control`。

### AI 能力

非流式：

```javascript
const result = await ztools.ai({
  prompt: "把下面内容总结成三句话：...",
});
```

流式：

```javascript
const request = ztools.ai({ prompt: "写一段说明文字" }, (chunk) => {
  appendChunk(chunk);
});

await request;
```

中断请求：

```javascript
request.abort();
```

获取模型：

```javascript
const models = await ztools.allAiModels();
```

插件需要自行确认和执行工具、展示推理过程或读取 token 用量时，使用宿主的单轮流式接口：

```javascript
const models = await ztools.allAiModels();
const request = ztools.aiChat(
  {
    model: models[0].value,
    messages: [{ role: "user", content: "列出当前目录中的文件" }],
    streamBatchIntervalMs: 50,
    tools: [
      {
        type: "function",
        function: {
          name: "list_files",
          description: "列出目录内容",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      },
    ],
  },
  (event) => {
    if (event.type === "reasoning") appendReasoning(event.delta);
    if (event.type === "content") appendContent(event.delta);
  },
);

const assistant = await request;
// 宿主不会执行 assistant.tool_calls；插件确认并执行后，把 tool 消息加入下一轮请求。
```

`streamBatchIntervalMs` 可以把连续正文、思考和同一工具参数事件合并后再回调，降低高频 SSE 分片造成的 IPC 压力；`0` 或省略时保持逐事件回调，最大值为 `1000` 毫秒。状态边界和请求结束前会强制刷新，不会丢失尾部内容。

`allAiModels()` 的 `value` 是适合保存到会话并传回 `model` 的稳定标识；`contextWindow`、`inputModalities` 和 `reasoning` 由 ZTools 统一管理。模型列表不会暴露供应商 API Key 或 API URL。

## 任务模板

### 文本处理插件

使用场景：翻译、格式化、正则提取、编码解码、AI 总结。

`plugin.json` 建议：

```json
{
  "features": [
    {
      "code": "text-process",
      "explain": "处理文本",
      "cmds": [
        {
          "type": "over",
          "label": "处理文本",
          "minLength": 1,
          "maxLength": 5000
        }
      ]
    }
  ]
}
```

实现要点：

- 在 `onPluginEnter` 中读取 `payload`。
- 使用 `setSubInput` 支持二次输入。
- 结果支持复制到剪贴板。
- 长文本处理要显示加载状态和错误状态。

### 文件处理插件

使用场景：批量重命名、转换格式、压缩、提取元数据。

`plugin.json` 建议：

```json
{
  "features": [
    {
      "code": "file-process",
      "explain": "处理文件",
      "cmds": [
        {
          "type": "files",
          "label": "处理文件",
          "fileType": "file",
          "extensions": ["txt", "md"],
          "minLength": 1,
          "maxLength": 100
        }
      ]
    }
  ]
}
```

实现要点：

- 文件读写放在 `preload.js`。
- 前端只传路径和用户选项。
- 修改文件前建议让用户选择输出目录或生成新文件。
- 对批量任务显示进度和失败列表。

### 图片处理插件

使用场景：压缩、格式转换、OCR、上传。

`plugin.json` 建议：

```json
{
  "features": [
    {
      "code": "image-process",
      "explain": "处理图片",
      "cmds": [
        {
          "type": "img",
          "label": "处理图片"
        }
      ]
    }
  ]
}
```

实现要点：

- 图片数据通常从 `payload` 或剪贴板能力进入。
- 图片本地处理可在 `preload.js` 中调用 Node.js 模块。
- 输出支持保存文件、复制图片、打开所在文件夹。

### 主搜索增强插件

使用场景：字典、书签、命令面板、快速搜索。

实现要点：

- 使用 `ztools.onMainPush` 返回候选结果。
- 候选结果要轻量快速，避免阻塞主搜索。
- 选择结果后如需打开完整 UI，`selectCallback` 返回 `true`。
- 搜索索引或缓存可用 `dbStorage` 或 `db` 保存。

### AI 插件

使用场景：问答、总结、翻译、改写、代码解释。

实现要点：

- 简单生成使用 `ztools.ai`；自行管理工具循环、推理事件和 usage 时使用 `ztools.aiChat`。
- 流式输出时提供停止按钮并调用返回请求的 `abort()`。
- 供应商、API Key、上下文窗口和推理协议由 ZTools 管理，插件只保存 `allAiModels()` 返回的模型 `value`。
- 使用 `allAiModels()` 展示可选模型时要处理获取失败。
- 长内容输入要限制长度或分段处理。
- 提供复制结果、重新生成、清空历史等基础操作。

## 完整最小示例

### plugin.json

```json
{
  "name": "quick-text-tools",
  "title": "快速文本工具",
  "description": "对输入文本进行大小写转换并复制结果",
  "version": "1.0.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "text-tools",
      "explain": "快速文本处理",
      "cmds": [
        "文本工具",
        {
          "type": "over",
          "label": "转换文本",
          "minLength": 1,
          "maxLength": 2000
        }
      ]
    }
  ]
}
```

### preload.js

```javascript
window.textTools = {
  upper(text) {
    if (typeof text !== "string") {
      return { ok: false, error: "text must be a string" };
    }
    return { ok: true, value: text.toUpperCase() };
  },
  lower(text) {
    if (typeof text !== "string") {
      return { ok: false, error: "text must be a string" };
    }
    return { ok: true, value: text.toLowerCase() };
  },
};
```

### 前端逻辑

```javascript
let currentText = "";

function render(text) {
  document.querySelector("#input").value = text;
  document.querySelector("#output").textContent = text;
}

function convert(mode) {
  const service = window.textTools[mode];
  const result = service(currentText);
  if (!result.ok) {
    ztools.showNotification(result.error);
    return;
  }
  render(result.value);
  ztools.copyText(result.value);
}

ztools.onPluginEnter(({ payload }) => {
  currentText = typeof payload === "string" ? payload : "";
  render(currentText);
});

ztools.setSubInput((text) => {
  currentText = text;
  render(text);
}, "输入要处理的文本");
```

## 发布前检查清单

AI 完成插件开发后，应逐项检查：

- `plugin.json` 是合法 JSON，没有注释或尾逗号。
- `name` 唯一且使用稳定英文标识。
- `title`、`description` 能准确说明插件用途。
- 平台限制写在顶层 `platform`，没有误写到 `features[]` 内。
- `main` 指向存在的 HTML 文件或可访问的在线地址。
- `logo` 指向 png 或 jpg 文件。
- `preload` 指向存在的 JS 文件。
- `features[].code` 不重复。
- `cmds` 与需求匹配，没有过宽的 `over` 或正则误触发。
- 框架项目已配置将页面构建到 `src-ztools/dist/`，没有重复复制 `plugin.json`、Logo 或 preload。
- Vite/ESM 项目的 `src-ztools/preload/` 可使用 CommonJS；必要时已在 preload 同级提供 `package.json` 并声明 `{ "type": "commonjs" }`。
- `preload.js` 可读，没有压缩、混淆、隐藏危险操作。
- Node.js 第三方依赖与 `preload.js` 同级，并且可被 `require` 解析。
- UI 插件没有使用 `window.exports` + `mode: "none"` 绕开页面入口。
- UI 主背景适配透明材质和暗色模式，没有写死大面积浅色或深色背景。
- 文件处理、命令执行、网络请求有错误处理。
- Windows、macOS、Linux 路径和快捷键差异已处理。
- 插件进入、退出、重复打开时状态不会错乱。
- 构建命令能成功执行。
- 最终插件目录中不包含无关源码缓存、`.git`、构建临时文件。

## 常见错误

| 错误                                               | 修正                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| 把整个源码项目作为插件包                           | 使用 `src-ztools/` 作为插件目录，其中 `dist/` 只放页面结果                 |
| `plugin.json` 中写了注释                           | JSON 不支持注释，必须删除                                                  |
| 平台限制写在 `features[].platform`                 | 移到 `plugin.json` 顶层 `platform`                                         |
| `preload.js` 使用 `import`                         | 改为 CommonJS `require`                                                    |
| Vite 项目根目录是 ESM，`preload.js` 不能 `require` | 在 `src-ztools/preload/package.json` 写 `{ "type": "commonjs" }`           |
| UI 插件使用 `window.exports` + `mode: "none"`      | 删除 `window.exports`，改用 `ztools.onPluginEnter` 接收入口参数            |
| UI 背景写死为纯白、浅灰或深色                      | 使用透明背景、CSS 变量和 `prefers-color-scheme` 适配 ZTools 材质与暗色模式 |
| Node.js 依赖被打包压缩                             | 保持依赖源码可读并放在 `preload.js` 同级                                   |
| `main` 指向开发服务器但生产包中不可用              | 生产 `main` 指向本地 HTML，开发地址放 `development.main`                   |
| 使用 `over` 但没有长度限制                         | 设置合理的 `minLength` 和 `maxLength`                                      |
| 文件处理直接覆盖原文件                             | 默认生成新文件或询问保存位置                                               |
| 异步 API 当同步 API 使用                           | 查看返回值，Promise API 必须 `await`                                       |
| 跨平台快捷键固定为 `control`                       | macOS 使用 `command`，其他系统使用 `control`                               |

## 给 AI 的输出格式建议

当 AI 交付 ZTools 插件代码时，建议按以下格式说明：

```text
已实现：
- 插件配置：plugin.json
- 本地能力：preload.js
- 前端页面：index.html / src/*
- 触发方式：说明 feature 和 cmds

运行：
- npm install
- npm run dev
- npm run build

验证：
- 检查 `src-ztools/` 是否包含 plugin.json、preload、Logo，以及 `dist/index.html`
- 在 ZTools 中用指定关键词触发插件
```

如果无法完成构建或验证，必须明确说明阻塞原因和下一步需要用户提供的信息。
