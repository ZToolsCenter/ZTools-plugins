# ZTools 插件开发技能

> **适用场景**：为 ZTools 桌面效率工具开发插件应用，涵盖创建、开发、构建、发布的完整流程。
> **技术栈**：HTML/CSS/JS + Node.js + Electron，支持 Vue/React 框架。
> **跨平台**：Windows / macOS / Linux

---

## 1. 概述

ZTools 插件 = **Web 前端 UI + Node.js 本地原生能力**。通过 `plugin.json` 配置入口，`preload.js` 桥接 Node.js/Electron API，前端通过 `window.ztools` 全局对象调用系统能力。

### 核心组成

| 文件 | 作用 |
|---|---|
| `plugin.json` | 插件元数据 + 功能配置（必填） |
| `preload.js` | 预加载脚本，调用 Node.js/Electron API（必填） |
| `index.html` | 插件 UI 入口（或在线 URL） |
| `logo.png` | 插件图标（必填，png/jpg） |

---

## 2. 环境准备

- **ZTools** 客户端：https://github.com/ZToolsCenter/ZTools/releases
- **Node.js** >= 16.0.0
- **Git**
- **CLI 工具**：`npm install -g @ztools-center/plugin-cli`

### 可选模板

| 模板 | 说明 |
|---|---|
| Vue + TypeScript + Vite | Vue 3 前端 UI |
| React + TypeScript + Vite | React 前端 UI |
| Preload Only (TypeScript) | 无 UI，仅 Preload 脚本 |

---

## 3. 创建插件

```bash
# 创建项目（交互式选择模板、输入信息）
ztools create my-plugin

# 进入目录、安装依赖
cd my-plugin
npm install

# 开发模式
npm run dev

# 构建（输出到 dist/）
npm run build
```

---

## 4. 目录结构

### 最终打包结构（dist/ 目录）

```
my-plugin/
├── plugin.json        # 必填：插件配置
├── preload.js         # 必填：预加载脚本（CommonJS）
├── index.html         # 必填：UI 入口
├── index.js           # 前端逻辑
├── index.css          # 样式
├── logo.png           # 必填：图标
└── node_modules/      # Node.js 第三方依赖（如有）
```

### 开发目录结构

```
my-plugin/
├── plugin.json
├── package.json       # 项目依赖（type: commonjs）
├── src/
│   ├── preload.ts     # Preload 源码
│   └── ...            # 前端源码
├── public/
│   └── logo.png
├── dist/              # 构建输出（打包此目录）
└── vite.config.js     # 构建配置
```

**关键规则**：
- 框架代码（Vue/React）必须编译为普通 HTML/CSS/JS 后打包
- Node.js 第三方依赖放在 `preload.js` 同级，**不要编译**
- 只打包 `dist/` 目录，不打包项目根目录

---

## 5. plugin.json 配置详解

```json
{
  "name": "my-plugin",
  "title": "我的插件",
  "description": "插件描述",
  "version": "1.0.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "features": [
    {
      "code": "hello",
      "explain": "打招呼",
      "cmds": ["hello", "你好"]
    }
  ]
}
```

### 基础字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 插件唯一标识 ID |
| `title` | string | ✅ | 显示名称 |
| `description` | string | ❌ | 描述 |
| `version` | string | ❌ | 版本号 |
| `main` | string | ✅ | UI 入口（.html 相对路径或在线 URL） |
| `logo` | string | ✅ | 图标文件（png/jpg） |
| `preload` | string | ✅ | 预加载 JS 文件路径 |

### 开发模式覆盖

```json
{
  "development": {
    "main": "http://localhost:5173"
  }
}
```

### features 字段

| 字段 | 说明 |
|---|---|
| `code` | 功能唯一标识 |
| `explain` | 功能说明（搜索结果中显示） |
| `cmds` | 触发指令数组 |
| `platform` | 可选，限制平台 `['win32','darwin','linux']` |

---

## 6. 指令类型（cmds）

### 6.1 文本指令（精确匹配）

```json
"cmds": ["hello", "你好"]
```

### 6.2 正则指令（RegexCmd）

```json
{
  "type": "regex",
  "label": "颜色预览",
  "match": "/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/i",
  "minLength": 4
}
```

### 6.3 全局匹配（OverCmd）

匹配任意文本，适用于翻译、搜索类插件。

```json
{
  "type": "over",
  "label": "翻译",
  "exclude": "/^exclude/i",
  "minLength": 1,
  "maxLength": 1000
}
```

### 6.4 图片匹配（ImgCmd）

粘贴图片时触发（OCR、压缩、格式转换等）。

```json
{ "type": "img", "label": "图片处理" }
```

### 6.5 文件匹配（FilesCmd）

粘贴文件/文件夹时触发。

```json
{
  "type": "files",
  "label": "批量重命名",
  "fileType": "file",
  "extensions": ["txt", "md", "json"],
  "match": "/^test/i",
  "minLength": 1,
  "maxLength": 100
}
```

| 参数 | 说明 |
|---|---|
| `fileType` | `"file"` 或 `"directory"`，不填则都匹配 |
| `extensions` | 文件扩展名过滤数组 |
| `match` | 文件名正则匹配 |
| `minLength` / `maxLength` | 文件数量范围 |

---

## 7. Preload.js 规范

**Preload 是连接前端与 Node.js/Electron 的桥梁**，遵循 CommonJS 规范。

### 基本模式

```javascript
// preload.js
const fs = require("node:fs");
const path = require("node:path");

window.customApis = {
  readFile: (filePath) => fs.readFileSync(filePath, "utf8"),
  writeFile: (filePath, content) => fs.writeFileSync(filePath, content),
};
```

### 引入第三方模块

```bash
# 在 preload.js 同级目录安装
npm install colord
```

```javascript
const { colord } = require("colord");
window.services = { colord };
```

### 引入 Electron API

```javascript
const { clipboard, nativeImage } = require("electron");

window.services = {
  copyImage: (imageFilePath) => {
    clipboard.writeImage(nativeImage.createFromPath(imageFilePath));
  },
};
```

### ⚠️ 代码规范

- **禁止压缩/混淆**，每一行代码必须清晰可读
- 第三方模块源码也必须一同提交，不允许压缩
- 模块放在 `preload.js` 同级目录，不要编译

---

## 8. 插件 API 参考（window.ztools）

### 8.1 基础 API

| API | 说明 |
|---|---|
| `ztools.getAppName()` | 返回 `'ZTools'` |
| `ztools.getAppVersion()` | 获取应用版本 |
| `ztools.isMacOs()` / `isWindows()` / `isLinux()` | 平台检测 |
| `ztools.isDarkColors()` | 深色主题检测 |
| `ztools.isDev()` | 开发模式检测 |
| `ztools.getNativeId()` | 设备唯一 ID（32位） |
| `ztools.getWindowType()` | 窗口类型 |
| `ztools.getPathForFile(file)` | 拖放文件的真实路径 |

### 8.2 窗口控制

| API | 说明 |
|---|---|
| `ztools.setExpendHeight(height)` | 设置插件视图高度（px） |
| `ztools.showMainWindow()` | 显示主窗口 → `Promise<boolean>` |
| `ztools.hideMainWindow(isRestore?)` | 隐藏主窗口 → `Promise<boolean>` |
| `ztools.outPlugin(isKill?)` | 退出插件（默认隐藏后台，`isKill=true` 杀进程） |
| `ztools.createBrowserWindow(url, options, cb?)` | 创建独立窗口 → `Proxy<BrowserWindow>` |

### 8.3 事件 API

```javascript
// 插件进入（用户打开时触发）
ztools.onPluginEnter((param) => {
  // param: { payload, type: 'text'|'regex'|'over', code }
});

// 插件退出
ztools.onPluginOut((isKill) => { });

// 插件被分离为独立窗口
ztools.onPluginDetach(() => { });

// 主搜索框推送（在主界面提供搜索结果）
ztools.onMainPush(
  (queryData) => { return results; },  // 查询回调
  (selectData) => { return true; }     // 选中回调（返回 true 进入插件）
);
```

### 8.4 搜索框 API

```javascript
// 设置子输入框（插件活动时替换主搜索框）
ztools.setSubInput((text) => { }, "占位符", true);

// 操作子输入框
ztools.setSubInputValue("文本");
ztools.subInputFocus();    // 聚焦
ztools.subInputBlur();     // 失焦
ztools.subInputSelect();   // 聚焦并全选
ztools.removeSubInput();   // 移除
```

### 8.5 数据库 API（持久化存储）

每个插件拥有独立的数据库空间（以 name 隔离）。

```javascript
// 同步版
const doc = ztools.db.put({ _id: "key1", data: "value" });
const result = ztools.db.get("key1");
ztools.db.remove(doc);
const all = ztools.db.allDocs();         // 获取所有
const filtered = ztools.db.allDocs("prefix_"); // 前缀过滤
ztools.db.bulkDocs([doc1, doc2]);        // 批量操作

// Promise 版
const doc = await ztools.db.promises.put({ _id: "key1", data: "value" });

// 简化版（类似 localStorage）
ztools.dbStorage.setItem("key", value);
const val = ztools.dbStorage.getItem("key");
ztools.dbStorage.removeItem("key");
```

### 8.6 剪贴板 API

```javascript
// 获取历史
const history = await ztools.clipboard.getHistory(1, 20, "text");

// 搜索
const results = await ztools.clipboard.search("关键词");

// 写入
await ztools.clipboard.write(id, true);  // true = 同时粘贴
await ztools.clipboard.writeContent({ type: "text", content: "内容" });

// 快捷方法
ztools.copyText("文本");
ztools.copyImage("base64或文件路径");
ztools.copyFile("/path/to/file");

// 监听变化
ztools.clipboard.onChange((item) => { });
```

### 8.7 模拟输入

```javascript
// 模拟键盘按键
ztools.simulateKeyboardTap("c", "control");  // Ctrl+C
ztools.simulateKeyboardTap("v", "command");   // Cmd+V (macOS)

// 发送原始输入事件
ztools.sendInputEvent({
  type: "keyDown",
  keyCode: "A",
  modifiers: ["shift"]
});

// 鼠标事件
ztools.sendInputEvent({
  type: "mouseDown",
  x: 100, y: 200,
  button: "left",
  clickCount: 1
});
```

### 8.8 文件/Shell API

```javascript
// 系统路径
const home = ztools.getPath("home");
const desktop = ztools.getPath("desktop");

// 对话框
const savePath = ztools.showSaveDialog({ defaultPath: "file.txt" });
const files = ztools.showOpenDialog({ properties: ["openFile", "multiSelections"] });

// 截图
ztools.screenCapture((base64Image) => { });

// Shell
ztools.shellOpenExternal("https://example.com");  // 浏览器打开
ztools.shellOpenPath("/path/to/file");             // 系统默认程序打开
ztools.shellShowItemInFolder("/path/to/file");     // 文件管理器显示
```

### 8.9 显示器 API

```javascript
const primary = ztools.getPrimaryDisplay();
const all = ztools.getAllDisplays();
const cursor = ztools.getCursorScreenPoint();  // { x, y }
const nearest = ztools.getDisplayNearestPoint({ x: 100, y: 100 });

// 坐标转换
const screen = ztools.dipToScreenPoint({ x, y });
const dip = ztools.screenToDipPoint({ x, y });
```

### 8.10 AI API

```javascript
// 非流式
const result = await ztools.ai({ prompt: "你好" });

// 流式
const request = ztools.ai({ prompt: "你好" }, (chunk) => {
  console.log("收到:", chunk);
});
await request;

// 中断
request.abort();

// 获取可用模型
const models = await ztools.allAiModels();
```

### 8.11 其他 API

```javascript
// 插件跳转
ztools.redirect("target-label", { data: "payload" });

// HTTP 请求头
ztools.http.setHeaders({ "Authorization": "Bearer xxx" });
ztools.http.getHeaders();
ztools.http.clearHeaders();

// 通知
ztools.showNotification("通知内容");

// 动态 Feature
ztools.setFeature({ code: "new", explain: "新功能", cmds: ["触发词"] });
ztools.removeFeature("code");
ztools.getFeatures(["code1", "code2"]);
```

---

## 9. 开发最佳实践

### 前端 + Preload 通信模式

```javascript
// === preload.js ===
const { execSync } = require("child_process");
window.nodeAPI = {
  runCommand: (cmd) => execSync(cmd, { encoding: "utf8" }),
};

// === 前端 (index.js / Vue / React) ===
const result = window.nodeAPI.runCommand("ls -la");
```

### 使用 Vue/React 框架

1. 用 CLI 选择模板创建项目
2. 在 `src/` 开发组件
3. `npm run build` 编译到 `dist/`
4. `dist/` 即为可打包的插件目录

### 数据持久化

- 简单键值对 → `ztools.dbStorage`
- 复杂文档 → `ztools.db`
- 附件 → `ztools.db.postAttachment()`

---

## 10. 发布插件

### 前置条件

- `plugin.json` 存在且字段完整
- Git 仓库已初始化，至少一次提交
- 工作区干净（无未提交改动）

### 发布命令

```bash
ztools publish
```

### 首次发布自动完成

1. GitHub OAuth 认证（浏览器授权，含 `workflow` scope）
2. Fork 中心仓库 `ZToolsCenter/ZTools-plugins`
3. 同步 fork main 到上游
4. 判定 Add/Update
5. 复制工作目录到 fork 的 `plugins/<插件ID>/`
6. 生成 commit + 推送分支
7. 创建 Draft Pull Request

### 后续发布（增量）

- 每次只 fast-forward 追加一个 commit（不 force-push）
- 同一 PR 自动复用，链接不变
- PR 标题自动取自你的 commit subject

### 发布后必须手动完成

1. 📸 上传截图/演示 GIF 到 PR description
2. ✅ 勾选自检清单（5项 checkbox）
3. 🚦 把 PR 从 Draft 切到 "Ready for review"

### 拉取审核者改动

```bash
ztools pull-contributions   # 三方合并审核者的改动
ztools publish               # 重新发布
```

### CHANGELOG.md 支持

- 自动抽取当前版本的变更说明注入 PR description
- 未找到时交互式录入（非交互环境自动跳过）
- 支持格式：`## 0.1.0`、`## v0.1.0`、`## [0.1.0]` 等

---

## 11. 故障排查

| 问题 | 解决 |
|---|---|
| OAuth token 缺少 workflow scope | `rm ~/.config/ztools/cli-config.json` 重新授权 |
| merge-upstream 422 | `rm -rf ~/.config/ztools/ZTools-plugins` 重新 clone |
| 工作区未提交 | `git commit` 或 `git restore` 处理 |
| 发布被拒（远端有新 commit） | 先 `ztools pull-contributions` |
| 看本地 fork 缓存 | `cd ~/.config/ztools/ZTools-plugins && git log` |
| 完全重置 | `rm -rf ~/.config/ztools/ && git tag -d ztools-last-publish` |

---

## 12. 相关资源

- **ZTools 客户端**：https://github.com/ZToolsCenter/ZTools
- **插件中心仓库**：https://github.com/ZToolsCenter/ZTools-plugins
- **CLI 工具**：https://www.npmjs.com/package/@ztools-center/plugin-cli
- **API 类型定义**：https://www.npmjs.com/package/@ztools-center/ztools-api-types
- **官方文档源码**：https://github.com/ZToolsCenter/ZTools-doc

---

*基于 ZTools-doc 仓库文档提炼，版本日期：2026-08-27*
