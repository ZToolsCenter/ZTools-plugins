# ZTools Colors Plugin - AGENTS Guide

> **重要提示**：在开始任何任务前，请首先阅读本文件，这将帮助你快速了解项目并高效完成工作。

## 项目概述

这是一个为 [ZTools](https://github.com/ZToolsCenter/ZTools) 开发的插件程序，名为 **Colors（颜色助手）**。

### 项目目标

构建一个功能完整的颜色选择和管理工具，包含以下核心功能（参考设计图）：

- 色轮取色器
- 多种颜色格式支持（HEX, RGB, HSV, HSL, CMYK, HSI, CIE-LAB）
- 互补色、对比色、类似色、中差色生成
- AI配色功能
- UI色卡库（Flat UI, Fluent Design, Open Color, Ant Design, Material Design等）
- 图片色卡提取
- 传统色系
- 渐变色生成
- 颜色收藏

### 架构说明

- **插件类型**：ZTools插件（基于plugin.json配置）
- **主入口**：`index.html`
- **预加载脚本**：`preload/services.js`（提供Node.js能力）
- **功能路由**：通过`onPluginEnter`和`onPluginOut`管理功能切换

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
- [ ] 确保所有代码符合Tailwind CSS 4规范
- [ ] 确保所有import使用`vite-plus`而非`vite`或`vitest`
<!--VITE PLUS END-->

---

## 项目特定指南

### 技术栈

| 技术                            | 版本          | 说明                  |
| ------------------------------- | ------------- | --------------------- |
| Vue                             | 3.6.0-beta.10 | 前端框架              |
| Tailwind CSS                    | 4.2.2         | 样式框架              |
| Vite+                           | catalog:      | 统一工具链            |
| TypeScript                      | ~6.0.0        | 类型系统              |
| @ztools-center/ztools-api-types | ^1.0.1        | ZTools插件API类型定义 |
| pnpm                            | 10.33.0       | 包管理器              |

### ⚠️ Tailwind CSS 4 关键差异

**重要：Tailwind 4与3有重大差异，务必注意：**

#### 1. CSS导入方式

```css
/* Tailwind 4 - 新方式 */
@import "tailwindcss";

/* Tailwind 3 - 旧方式（已废弃）*/
@tailwind base;
@tailwind components;
@tailwind utilities;
```

#### 2. 自定义配置方式

- Tailwind 4不再需要`tailwind.config.js`
- 使用CSS变量和`@theme`指令进行配置
- 直接在CSS中定义主题

#### 3. 插件引入

```typescript
// vite.config.ts
import tailwindcss from "@tailwindcss/vite";
// 在plugins数组中添加 tailwindcss()
```

#### 4. 类名差异

- 某些旧版类名可能被移除或更改
- 新增了一些实用类
- 颜色系统有所改进

#### 5. 性能改进

- 更快的编译速度
- 更小的输出体积

### 项目结构

```
colors/
├── public/
│   ├── preload/
│   │   ├── package.json          # 预加载脚本的包依赖
│   │   └── services.js           # 预加载服务（Node.js能力）
│   ├── favicon.ico               # 网站图标
│   ├── logo.png                  # 插件Logo
│   └── plugin.json               # ZTools插件配置文件 ⭐核心
├── src/
│   ├── App.vue                   # 根组件（包含插件生命周期管理）
│   ├── main.ts                   # 应用入口
│   └── input.css                 # Tailwind CSS入口
── .vscode/                      # VS Code配置
├── dist/                         # 构建输出目录
├── index.html                    # HTML入口
├── vite.config.ts                # Vite配置
├── tsconfig.json                 # TypeScript配置
└── package.json                  # 项目依赖
```

### 插件配置 (plugin.json)

```json
{
  "name": "colors",
  "title": "Colors 插件",
  "features": [
    {
      "code": "hello", // 功能代码，用于路由匹配
      "explain": "说明文本",
      "icon": "logo.png", // 功能图标
      "cmds": ["你好", "hello"] // 触发命令
    }
  ]
}
```

**功能代码说明**：

- `hello` - 示例功能（你好）
- `read` - 读取文件功能
- `write` - 写入文件功能

在App.vue中，通过`action.code`获取当前激活的功能代码。

### 开发工作流

#### 启动开发服务器

```bash
vp dev
```

开发模式下，插件会连接到`http://localhost:5173`

#### 构建生产版本

```bash
vp build
```

构建结果输出到`dist/`目录

#### 代码检查

```bash
vp check        # 格式化 + 代码检查 + 类型检查
vp lint         # 仅代码检查
vp fmt          # 仅代码格式化
```

### 重要文件说明

#### App.vue

包含插件生命周期管理：

- `onPluginEnter` - 插件进入时触发
- `onPluginOut` - 插件退出时触发
- 通过`route.value`跟踪当前激活的功能

#### preload/services.js

预加载脚本提供Node.js能力，在插件中可以通过特定API调用。

#### plugin.json

插件配置的核心文件，定义了：

- 插件元信息（名称、版本、描述）
- 功能列表及触发命令
- 开发模式配置

### 常用命令速查

| 命令                   | 说明             |
| ---------------------- | ---------------- |
| `vp install` 或 `vp i` | 安装依赖         |
| `vp dev`               | 启动开发服务器   |
| `vp build`             | 生产构建         |
| `vp check`             | 完整代码检查     |
| `vp lint --fix`        | 自动修复代码问题 |
| `vp fmt`               | 格式化代码       |
| `vp add <package>`     | 添加依赖包       |
| `vp dlx <command>`     | 执行一次性命令   |

### 开发注意事项

1. **始终使用`vp`命令**：不要直接使用pnpm/npm/yarn
2. **导入路径**：使用`@/`别名引用src目录
3. **类型安全**：所有Vue组件使用`<script setup lang="ts">`
4. **ZTools API**：从`@ztools-center/ztools-api-types`导入插件API
5. **Tailwind 4**：遵循Tailwind 4的CSS导入方式
6. **组件命名**：使用PascalCase命名Vue组件
7. **样式作用域**：使用`<style scoped>`避免样式污染

### 未来开发计划

根据设计图，需要实现以下功能模块：

1. **色轮取色器** - 核心取色功能
2. **颜色格式转换** - HEX/RGB/HSV/HSL/CMYK/HSI/CIE-LAB
3. **和谐色生成** - 互补色、对比色、类似色等
4. **AI配色** - 智能配色建议
5. **UI色卡库** - 主流设计系统色卡
6. **图片取色** - 从图片提取颜色
7. **传统色系** - 中国传统色、日本传统色等
8. **渐变色** - 渐变生成和管理
9. **收藏功能** - 颜色收藏和管理

### 参考资源

- [ZTools 主项目](https://github.com/ZToolsCenter/ZTools)
- [ZTools 开发者文档](https://ztoolscenter.github.io/ZTools-doc/)
- [插件 API 文档](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html) - window.ztools 对象
- [Node.js 能力](https://ztoolscenter.github.io/ZTools-doc/node-js.html) - preload.js 中使用
- [Preload 说明](https://ztoolscenter.github.io/ZTools-doc/preload-js.html) - preload机制
- [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html) - 插件配置详解
- [Vue 3 文档](https://vuejs.org/)
- [Tailwind CSS 4 文档](https://tailwindcss.com/docs)
- [Vite+ 文档](https://vite-plus.dev/)
- [颜色科学](https://en.wikipedia.org/wiki/Color_space)

---

## ZTools API 快速参考

### 插件 API (window.ztools)

#### 基础 API

```typescript
// 系统信息
ztools.getAppName()                    // 返回 'ZTools'
ztools.getAppVersion()                 // 应用版本号
ztools.isMacOs() / isWindows() / isLinux()  // 平台检测
ztools.getNativeId()                   // 设备唯一标识
ztools.isDarkColors()                  // 深色主题检测
ztools.isDev()                         // 是否开发模式

// 窗口控制
ztools.setExpendHeight(height: number) // 设置插件视图高度
ztools.showMainWindow()                // 显示主窗口
ztools.hideMainWindow(isRestorePreWindow?: boolean)  // 隐藏主窗口
ztools.outPlugin(isKill?: boolean)     // 退出插件

// 通知与输入
ztools.showNotification(body: string)  // 系统通知
ztools.simulateKeyboardTap(key, ...modifiers)  // 模拟键盘
ztools.sendInputEvent(event)           // 发送输入事件

// 文件处理
ztools.getPathForFile(file: File)      // 拖放文件转真实路径
```

#### 事件 API

```typescript
// 插件生命周期
ztools.onPluginEnter((action: LaunchParam) => void)
// LaunchParam: { code, type, payload, option, from? }

ztools.onPluginOut((isKill: boolean) => void)
ztools.onPluginDetach(() => void)      // 分离为独立窗口

// 主搜索推送
ztools.onMainPush(
  (queryData) => object[],              // 返回搜索结果
  (selectData) => boolean               // 用户选择回调
)
```

#### 搜索框 API

```typescript
ztools.setSubInput(onChange, placeholder, isFocus?)  // 设置子输入框
ztools.setSubInputValue(text)          // 设置输入值
ztools.subInputFocus()                 // 聚焦
ztools.subInputBlur()                  // 失焦
ztools.subInputSelect()                // 选中内容
ztools.removeSubInput()                // 移除输入框
```

#### 数据库 API

```typescript
// 同步 API
ztools.db.put(doc)                     // 保存文档 (需包含 _id)
ztools.db.get(id)                      // 获取文档
ztools.db.remove(docOrId)              // 删除文档
ztools.db.allDocs(key?)                // 获取所有/前缀查询
ztools.db.bulkDocs(docs)               // 批量操作
ztools.db.postAttachment(id, attachment, type)  // 添加附件
ztools.db.getAttachment(id)            // 获取附件 (Buffer)
ztools.db.getAttachmentType(id)        // 获取附件类型

// Promise API (window.ztools.db.promises)
// 方法与同步版相同，返回 Promise

// 简化存储 (类似 localStorage)
ztools.dbStorage.setItem(key, value)   // 保存键值对
ztools.dbStorage.getItem(key)          // 获取值
ztools.dbStorage.removeItem(key)       // 删除键
```

#### 剪贴板 API

```typescript
ztools.clipboard.getHistory(page, pageSize, filter?)  // 历史记录
ztools.clipboard.search(keyword)       // 搜索剪贴板
ztools.clipboard.delete(id)            // 删除记录
ztools.clipboard.clear(type?)          // 清空历史
ztools.clipboard.getStatus()           // 获取状态
ztools.clipboard.write(item)           // 写入剪贴板
ztools.clipboard.read()                // 读取剪贴板
```

#### 动态 Feature API

```typescript
ztools.getFeatures(codes?)             // 获取动态 features
ztools.setFeature(feature)             // 设置/更新 feature
ztools.removeFeature(code)             // 删除 feature
```

### Preload API (window.services)

#### 定义方式

```javascript
// preload/services.js
const fs = require("node:fs");
const path = require("node:path");

window.services = {
  readFile: (filename) => {
    return fs.readFileSync(filename, { encoding: "utf-8" });
  },
  getFolder: (filepath) => {
    return path.dirname(filepath);
  },
  // 自定义方法...
};
```

#### 可用的 Node.js 模块

- **原生模块**: `fs`, `path`, `os`, `child_process`, `http`, `https`, `crypto` 等
- **Electron API**: `clipboard`, `nativeImage`, `shell`, `ipcRenderer` 等
- **第三方模块**: 通过 npm 安装，需在同级 `package.json` 中声明

#### 注意事项

- Preload 使用 **CommonJS** 规范 (require/module.exports)
- 代码**不能打包/压缩/混淆**，必须清晰可读
- 与 plugin.json 同目录或子目录
- 前端通过 `window.services.xxx()` 调用

### plugin.json 配置详解

#### 基础字段

```json
{
  "name": "colors", // 插件唯一标识 (必填)
  "title": "Colors 插件", // 显示名称 (必填)
  "description": "描述", // 插件描述 (可选)
  "version": "1.0.0", // 版本号 (可选)
  "main": "index.html", // 入口文件 (必填)
  "logo": "logo.png", // 插件Logo (必填)
  "preload": "preload/services.js", // 预加载脚本 (必填)

  "development": {
    "main": "http://localhost:5173" // 开发模式入口
  },

  "features": [
    /* 功能列表 */
  ]
}
```

#### Feature 配置

```json
{
  "features": [
    {
      "code": "color-picker", // 功能代码 (必填)
      "explain": "颜色选择器", // 功能说明
      "icon": "logo.png", // 功能图标
      "mainHide": false, // 是否在主界面隐藏
      "platform": ["win32", "darwin"], // 支持平台 (可选)
      "cmds": [
        "取色", // 文本指令
        {
          // 正则指令
          "type": "regex",
          "label": "颜色预览",
          "match": "/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/i",
          "minLength": 4
        },
        {
          // 全局匹配
          "type": "over",
          "label": "全局处理",
          "exclude": "/^exclude/i",
          "minLength": 1,
          "maxLength": 1000
        },
        {
          // 图片匹配
          "type": "img",
          "label": "图片取色"
        },
        {
          // 文件匹配
          "type": "files",
          "label": "批量处理",
          "fileType": "file",
          "extensions": ["jpg", "png"],
          "minLength": 1,
          "maxLength": 100
        }
      ]
    }
  ]
}
```

#### 指令类型说明

| 类型     | 用途         | 示例                   |
| -------- | ------------ | ---------------------- |
| `string` | 精确文本匹配 | `"你好"`               |
| `regex`  | 正则表达式   | 颜色值匹配 `/^#...$/i` |
| `over`   | 任意文本匹配 | 翻译、搜索插件         |
| `img`    | 图片粘贴触发 | 图片压缩、OCR          |
| `files`  | 文件粘贴触发 | 批量重命名、格式转换   |
