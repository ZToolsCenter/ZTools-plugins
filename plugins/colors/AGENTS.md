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

<!--VITE START-->

# Using Vite, the Frontend Build Tool

This project is using Vite, a modern frontend build tool that provides an extremely fast development experience.

## Vite Workflow

### Develop

```bash
pnpm dev    # Start development server with hot reload
```

### Build

```bash
pnpm build  # Build for production
pnpm preview # Preview production build locally
```

### Type Check

```bash
pnpm type-check  # Run TypeScript type checking
```

### Manage Dependencies

```bash
pnpm install          # Install dependencies
pnpm add <package>    # Add a dependency
pnpm remove <package> # Remove a dependency
pnpm update           # Update dependencies
```

<!--VITE END-->

---

## 项目特定指南

### 技术栈

| 技术                            | 版本          | 说明                  |
| ------------------------------- | ------------- | --------------------- |
| Vue                             | 3.6.0-beta.10 | 前端框架              |
| Tailwind CSS                    | 4.2.2         | 样式框架              |
| Vite                            | ^8.0.10       | 构建工具              |
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
pnpm dev
```

开发模式下，插件会连接到`http://localhost:5173`

#### 构建生产版本

```bash
pnpm build
```

构建结果输出到`dist/`目录

#### 类型检查

```bash
pnpm type-check   # TypeScript 类型检查
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

| 命令                       | 说明             |
| -------------------------- | ---------------- |
| `pnpm install` 或 `pnpm i` | 安装依赖         |
| `pnpm dev`                 | 启动开发服务器   |
| `pnpm build`               | 生产构建         |
| `pnpm preview`             | 预览生产构建     |
| `pnpm type-check`          | TypeScript类型检查 |
| `pnpm add <package>`       | 添加依赖包       |
| `pnpm remove <package>`    | 移除依赖包       |

### 开发注意事项

1. **始终使用`pnpm`命令**：不要直接使用npm/yarn
2. **导入路径**：使用`@/`别名引用src目录
3. **类型安全**：所有Vue组件使用`<script setup lang="ts">`
4. **ZTools API**：从`@ztools-center/ztools-api-types`导入插件API
5. **Tailwind 4**：遵循Tailwind 4的CSS导入方式
6. **组件命名**：使用PascalCase命名Vue组件
7. **样式作用域**：使用`<style scoped>`避免样式污染

### 开发经验与最佳实践

#### Canvas 绘图优化

- 色轮绘制时使用扇形重叠（2度）保证平滑过渡
- 根据亮度动态调整渐变色，实现色轮亮度联动
- 使用 `requestAnimationFrame` 优化动画性能（如需要）

#### 颜色处理技巧

- 使用 `colord` 库进行颜色格式转换和计算
- HSV 模型适合交互式取色（H=色相, S=饱和度, V=明度）
- 互补色计算：`(hue + 180) % 360`
- 和谐色生成：旋转色相角（30°、90°、150°、180°）

#### UI 交互优化

- **高对比度设计**：当背景色较暗时使用白色边框，较亮时使用黑色边框
- **避免透明度陷阱**：不要让关键UI元素的 opacity 随亮度归零
- **精确位置计算**：使用 `transform: translate(-50%, -50%)` 居中时，JS坐标无需额外偏移
- **事件监听优化**：使用 `useEventListener` (VueUse) 自动管理生命周期

#### ZTools 集成要点

- 通知功能封装：提供降级处理（开发环境使用 console/Notification API）
- 剪贴板操作：封装统一的复制工具，集成通知反馈
- 全局 API 访问：`(window as any).ztools` 或导入类型后使用
- Preload 脚本：使用 CommonJS 规范，代码不能打包/压缩

#### 常见问题与解决

**问题1：取色器在全黑时不可见**
- 原因：opacity 设置为 0
- 解决：固定 opacity 为 '1'，通过边框颜色区分

**问题2：取色器位置偏移**
- 原因：CSS transform 居中时 JS 又减去了半径
- 解决：直接使用计算坐标，让 transform 处理居中

**问题3：色轮亮度不随滑块变化**
- 原因：未监听颜色变化重绘
- 解决：在 watch 中调用 `drawColorWheel()`

**问题4：ztools 类型导入错误**
- 原因：模块使用 `export =` 方式导出
- 解决：使用 side-effect import `import "@ztools-center/ztools-api-types"`

### 未来开发计划

根据设计图，需要实现以下功能模块：

#### ✅ 已完成

1. **色轮取色器** - 核心取色功能
   - Canvas 2D 绘制 HSV 色轮
   - 鼠标拖动取色
   - 色轮亮度随 V 值动态调整
   - 智能边框颜色（黑/白）确保最大对比度
   - 取色器圆圈中心精确跟随鼠标位置

2. **饱和度/明度滑块** - ColorSlider 组件
   - 独立的饱和度和明度调节滑块
   - 实时更新颜色

3. **颜色格式显示** - ColorFormats 组件
   - HEX、RGB、HSV、HSL 四种格式实时显示
   - 一键复制功能
   - ZTools 系统通知反馈

4. **和谐色生成** - HarmonyColors 组件
   - 互补色（180°）、对比色（150°）、类似色（30°）、中差色（90°）
   - 悬停显示颜色值
   - 点击复制

5. **工具函数封装**
   - `notification.ts` - ZTools 通知 API 封装
   - `copy.ts` - 剪贴板复制工具
   - 开发环境降级处理

#### 🚧 待实现

6. **AI配色** - 智能配色建议
7. **UI色卡库** - 主流设计系统色卡（Flat UI, Material Design, Ant Design等）
8. **图片取色** - 从图片提取颜色
9. **传统色系** - 中国传统色、日本传统色等
10. **渐变色** - 渐变生成和管理
11. **收藏功能** - 颜色收藏和管理
12. **更多颜色格式** - CMYK, HSI, CIE-LAB

### 参考资源

- [ZTools 主项目](https://github.com/ZToolsCenter/ZTools)
- [ZTools 开发者文档](https://ztoolscenter.github.io/ZTools-doc/)
- [插件 API 文档](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html) - window.ztools 对象
- [Node.js 能力](https://ztoolscenter.github.io/ZTools-doc/node-js.html) - preload.js 中使用
- [Preload 说明](https://ztoolscenter.github.io/ZTools-doc/preload-js.html) - preload机制
- [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html) - 插件配置详解
- [Vue 3 文档](https://vuejs.org/)
- [Tailwind CSS 4 文档](https://tailwindcss.com/docs)
- [Vite 文档](https://vite.dev/)
- [pnpm 文档](https://pnpm.io/)
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
