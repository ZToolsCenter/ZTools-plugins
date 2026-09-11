# img-comp 开发指南

ZTools 本地图片压缩插件，支持 JPG、PNG、GIF、SVG，基于 JavaScript 与 WebAssembly 全离线实现。本文件是给开发协作者（含 AI 编程代理）的项目契约，代码结构调整时必须同步更新对应章节。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行全部测试（Node 内置 test runner，`test/*.test.cjs`） |
| `npm run build` | 构建完整插件目录 `dist/` 和本地安装包 `dist/img-comp.zpx` |

环境要求 Node.js >= 20.0。官方插件仓库的构建 Action 使用 Node.js 20。

## 代码分层

调整目录结构或模块职责时，必须同步更新本节：

1. `compression-engine.js` 仅负责格式识别和 JPEG、PNG、GIF、SVG 编解码。
2. `compression-worker.js` 负责在线程或独立 Node 子进程中读取、压缩并写入单张图片。
3. `runtime-service.js` 负责并行执行器池、批次生命周期、文件扫描、临时结果、历史记录和剪贴板。
4. `preload.js` 只建立一个只读的 `imgCompRuntime` 浏览器桥接对象。
5. `index.js` 只负责渲染和用户交互，不直接访问 Node.js 文件系统。

红线：`index.js` 不得引入 Node API；`preload.js` 不得添加业务逻辑；新增源文件必须同步加入 `build-zpx.js` 的 `SOURCE_FILES` 白名单，否则不会进入发布包。

## 数据模型

批次使用 `batch/entries/progress` 模型：

```text
batch
  id, kind, createdAt, phase, rootPath
  entries[]
    inputPath, inputBytes, filename, relativeName
    outputName, resultPath, resultBytes, savedPercent, error
  progress
    total, completed, succeeded, failed, percent
```

每个输入项在执行前获得唯一的 `outputName`，避免来自不同目录的同名文件争用同一临时结果路径。

## 关键行为契约

- 压缩结果没有比原文件小时，保留原文件作为结果，绝不用更大的文件替换。
- 批次进入方式由 `plugin.json` 的 cmds 声明（关键词、files、img、window 四类），`index.js` 的 `onPluginEnter` 统一分发；window 进入依赖宿主 `ztools.readCurrentFolderPath()`。
- 历史记录只保存路径与统计（上限 8 条），不保存图片内容；临时结果超过 24 小时在插件启动时清理。

## 发布边界

- `build-zpx.js` 采用源码白名单，并经 `release-deps.js` 从 `package.json` 解析运行时依赖闭包；`dist/` 是官方 Action 的 ZIP 打包源，`dist/img-comp.zpx` 是同一内容生成的 Brotli ZPX。
- 官方 Action 会从 `dist/` 内容创建 ZIP，因此 `dist/` 根目录必须同时包含 `plugin.json`、`index.html`、Logo 和 preload。
- 构建会将运行时依赖目录及其中的许可证文件、许可证元数据复制到发布包；项目自身代码采用 MIT 许可证，依赖保持各自上游许可证。

## 文档维护

- 人工维护的文档只有本文件和 `README.md`；`README.md` 面向市场用户，ZTools 插件市场详情页直接展示其内容。
- 分层、数据模型、行为契约或发布边界变化时更新本文件对应章节；纯实现细节与 Bug 修复不更新。
- 新增文案（注释、日志、异常、提示语）使用简体中文。

## 测试约定

测试位于 `test/*.test.cjs`，使用 Node 内置 test runner；UI 测试通过构造 `window.ztools` / `imgCompRuntime` 桩对象加载 `index.js` 驱动，不依赖真实宿主环境。
