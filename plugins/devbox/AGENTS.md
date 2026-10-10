# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ZTools 个人工具箱插件，包含多个随机生成工具（身份、密码、数字、UUID、颜色、签名等）。技术栈：Vue 3 + Vite + TypeScript + Element Plus。ZTools 是一个启动器应用，插件扩展其功能。

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server at http://localhost:5173 (auto-loaded by ZTools)
npm run build        # Type-check with vue-tsc, then build to dist/
```

No test or lint scripts. TypeScript is relaxed (`strict: false`, `noImplicitAny: false`).

## Architecture

### 项目结构

```
src/
├── App.vue                    # 根组件 + 手动路由 + ZTools 生命周期
├── main.ts                    # Vue 入口，注册 Element Plus 及图标
├── main.css                   # 全局样式、CSS 变量、明暗主题
├── env.d.ts                   # 类型声明（Services 接口、ZTools API）
├── toolbox/
│   ├── ToolboxLayout.vue      # 侧边栏 + 多标签内容区布局（主 UI 框架，el-tabs 标签条）
│   ├── HomePage.vue           # 首页（常用统计 + 全部工具分组网格）
│   └── tools.ts               # 工具注册表（categories 数组 + toolMap）
├── tools/                     # 工具组件（侧边栏路由）
│   ├── Identity/index.vue     # 随机身份信息生成（16 个字段，支持批量/导出）
│   ├── RandomPassword/index.vue  # 随机密码生成（可配置长度/字符集/强度）
│   ├── RandomNumber/index.vue    # 范围随机数（可配置数量/小数位）
│   ├── UUID/index.vue            # UUID v4 生成
│   ├── RandomColor/index.vue     # HSL 随机颜色（滑块/多格式复制/历史记录）
│   ├── Signature/index.vue       # 加密签名生成（MD5/SHA/HMAC）
│   ├── Pinyin/index.vue          # 中文转拼音（驼峰/下划线/常量等命名格式）
│   └── Qrcode/index.vue          # 二维码生成与解码（支持文件上传/截图/粘贴）
public/
├── plugin.json                # 插件清单（必须编辑此文件，根目录的是旧副本）
├── logo.png                   # 插件图标
└── preload/
    ├── package.json           # CommonJS 模块声明
    └── services.js            # Node.js 桥接：readFile / writeTextFile / writeImageFile
```

### 路由系统（手动，无 Vue Router）

`App.vue` 将 `route` 设为 `'toolbox'`，由 `ToolboxLayout` 渲染侧边栏 + 顶部标签条。工具通过 `src/toolbox/tools.ts` 中的 `categories` 数组注册，`toolMap`（Map）做 code → Tool 的 O(1) 查找。

**多标签模型**：`App.vue` 持有 `openTabCodes`（已开标签，有序）与 `activeCode`（当前激活，空串 = 无激活）。点击左侧菜单 / `el-tabs` 切换 → `openTab(code)`（已开则激活，未开则新开）；关闭标签 → `closeTab(code)`（激活右侧邻位，末尾则左侧，全部关完显示首页）。当前工具由 `activeCode` 派生，经 `<KeepAlive>` + `<component :is>` 动态渲染，切换标签不销毁实例，各工具状态保留；无激活 tab 时渲染 `HomePage.vue`。

**首页与常用统计**：`HomePage.vue` 展示「常用」（`frequentTools`：按 `usageCounts` 降序 Top 8，次数相同按注册顺序）与全部工具分组网格，点击走 `openTab`。`usageCounts` 在 `openTab` 时自增，持久化到 ZTools dbStorage（key：`devbox.toolUsage`），无宿主环境时仅内存。

**`setRoute(action)` 逻辑**：`action.code` 命中工具注册表（`toolMap`）即 `openTab(code)`（保留已开标签），否则保持现状（无已开标签则显示首页）。plugin.json 首位是一个专用的 `home` 入口 feature（cmds: `["devbox"]`）——宿主把图标点击伪装成第一个 feature 的 code 回传，`home` 承接了该伪装使判定极简：真实工具的进入（含拼音/模糊搜索词，如「suiji」）code 必然命中注册表，无需 payload 与 cmds 比对。详见 skill pitfalls「onPluginEnter 图标进入」条目。

**onPluginEnter 重注册（3.0.1 修复，勿删）**：宿主在插件隐藏时会重载开发插件视图（重跑 preload 并替换 `window.ztools`），已注册的 enter 回调失效，后续进入事件被宿主缓冲不再派发（表现为重进不切换标签）。App.vue 通过 800ms 定时重注册 + visibilitychange 补注册保证回调挂在最新接口对象上，宿主会回放缓冲的 enter 事件。

**新增工具时注意 KeepAlive**：若工具组件有全局副作用（document 级监听、定时器、matchMedia 监听等），必须同时适配 `onUnmounted`（tab 关闭）与 `onActivated`/`onDeactivated`（tab 切换，挂载/恢复、停用/清理），且挂载函数要幂等（首次挂载 mounted + activated 会连续触发）。参考 Qrcode / TimeConvert / JsonTool / HTMLPreview 的写法。

### 添加新工具的步骤

1. 在 `src/tools/<ToolName>/index.vue` 创建组件
2. 在 `src/toolbox/tools.ts` 的 `categories` 数组中注册（导入组件，定义 code/explain/icon）
3. 在 `public/plugin.json` 的 features 数组中添加匹配条目（code + cmds）
4. 如需 Node.js 能力，在 `public/preload/services.js` 添加方法，通过 `window.services` 调用
5. 如有全局监听/定时器，按「路由系统」一节适配 KeepAlive 生命周期
6. **同步更新以下文件**（详见"发布检查清单"）：
   - `public/plugin.json` → 更新 `version` 和 `description`
   - `package.json` → 同步更新 `version`（与 plugin.json 保持一致）
   - `README.md` → 更新工具列表（简要列出工具名和触发指令即可，无需详细功能描述）

### 发布检查清单

每次新增工具或修改功能后，**必须**完成以下同步更新：

1. **版本号**：`public/plugin.json` 的 `version` 和 `package.json` 的 `version` 同步递增（遵循 semver：新功能 minor +1，修复 patch +1）
2. **插件描述**：`public/plugin.json` 的 `description` 只表达产品理念（只做实际开发中会用到的工具、真正提效），**不罗列工具清单**；新增/删除工具时无需改动描述
3. **README.md**：在"工具列表"章节简要补充新工具（工具名 + 触发指令，2-3 行即可，不需要详细功能说明）
4. **插件名称**：一般不需要改动，仅当工具集定位发生重大变化时才更新 `name` / `title`

### Plugin Manifest (`public/plugin.json`)

每个 feature 的 `code` 对应路由 key。Cmd 类型：
- 普通字符串 → ZTools 搜索栏文本触发
- `{ type: "files" }` → 文件拖拽触发
- `{ type: "over" }` → 选中文本浮层触发
- `{ type: "img" }` → 图片触发

### Preload / Node.js Bridge

`public/preload/services.js`（CommonJS，由 `public/preload/package.json` 声明）暴露在 `window.services` 上。当前方法：`readFile()`、`writeTextFile()`、`writeImageFile()`。

### ZTools API

`window.ztools`（类型由 `@ztools-center/ztools-api-types` 提供）提供宿主集成：剪贴板、对话框、通知、窗口管理、Shell 操作等。详见 `src/env.d.ts`。

## Styling 约定

- 全局 CSS 变量：`--blue`、`--light`（定义在 `src/main.css`）
- 明暗主题：`@media (prefers-color-scheme: dark)`，各组件独立声明
- 组件统一使用 `<style scoped>`
- 强调色 `#667eea`（明）/ `#8ba4f7`（暗），贯穿所有工具组件
- 数据展示使用等宽字体（Consolas / Courier New）
- UI 框架：Element Plus（全局注册）+ `@element-plus/icons-vue`（全量注册图标）

## 代码审查清单

每次新增或修改代码时，应检查以下项：

### 1. API 兼容性与安全性
- **Web API**：检查 MDN 兼容性表，确认目标浏览器支持（Chrome/Edge 最新版 + Electron）
- **废弃 API**：避免使用已标记 deprecated 的 API（如 `document.execCommand`）
- **安全限制**：Canvas `getImageData` 对跨域图片有安全限制；`clipboard.write` 需要 HTTPS 或 Electron

### 2. 性能优化
- **大文件处理**：图片/文件应先缩放/裁剪再处理，避免内存溢出
- **避免中间转换**：优先使用 `canvas.toBlob()` 而非 `toDataURL()` → `fetch()` → `blob`
- **事件监听**：组件级监听优于全局 `document` 监听，确保 `onUnmounted` 时清理
- **异步操作**：大计算量操作考虑 Web Worker 或分片处理

### 3. 最佳实践
- **图片处理**：优先 `createImageBitmap()`（现代浏览器性能更好）而非 `new Image()`
- **文件读取**：`FileReader` 标准可用，但大文件考虑 `URL.createObjectURL()` 避免内存膨胀
- **Base64 使用**：仅用于小数据（<100KB），大文件用 Blob/File 对象
- **Clipboard API**：`navigator.clipboard.write()` 需检查 `blob.type` 支持（部分浏览器只支持 PNG）

### 4. 错误处理
- 用户输入验证（空值、超长内容、无效格式）
- API 调用失败降级方案（ZTools → 浏览器原生 → 提示不支持）
- 异步操作 catch 错误并友好提示

### 5. 第三方库检查
- npm 库是否维护活跃（近期 release、issues 处理）
- 是否有更轻量的替代方案
- TypeScript 类型是否完善

## 开发注意事项

- **始终编辑 `public/plugin.json`**，根目录的 `plugin.json` 是过时副本
- `copyText` 模式在各工具组件中重复实现（先尝试 `window.ztools?.copyText`，fallback 到 `navigator.clipboard.writeText()`），未提取为公共工具函数
- `ztools-doc-helper/` 目录是 ZTools 插件开发参考文档，不参与构建
- 开发模式（无 ZTools 宿主）会显示 dev hint 并默认加载 Identity 工具
- `App.vue` 通过 `onMounted` 检测环境：有 `window.ztools` 时注册 `onPluginEnter`/`onPluginOut` 并调用 `setExpendHeight(600)`；无时进入 dev 模式
