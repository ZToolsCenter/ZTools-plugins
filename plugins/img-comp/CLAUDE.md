# img-comp 开发指南

ZTools 本地图片压缩插件，支持 JPG、PNG、GIF、SVG，基于 JavaScript 与 WebAssembly 全离线实现。本文件是给开发协作者（含 AI 编程代理）的项目契约，代码结构调整时必须同步更新对应章节。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行全部测试（Node 内置 test runner，`test/*.test.cjs`） |
| `npm run build` | 构建可直接导入的完整插件目录 `dist/` |

环境要求 Node.js >= 20.0。官方插件仓库的构建 Action 使用 Node.js 20。

## 代码分层

调整目录结构或模块职责时，必须同步更新本节：

1. `src/` 负责 Vue 前端界面和用户交互，其中 `ImageCompressor` 负责压缩主界面，`Settings` 负责设置页面；前端不得直接访问 Node.js 文件系统。
2. `public/preload/compression-engine.js` 仅负责格式识别和 JPEG、PNG、GIF、SVG 编解码。
3. `public/preload/compression-worker.js` 负责在线程或独立 Node 子进程中读取、压缩并写入单张图片。
4. `public/preload/runtime-service.js` 负责并行执行器池、批次生命周期、文件扫描、临时结果、历史记录和剪贴板。
5. `public/preload/services.js` 只建立一个只读的 `imgCompRuntime` 浏览器桥接对象。

红线：`src/` 不得引入 Node API；`public/preload/services.js` 不得添加业务逻辑；新增前端文件放入 `src/`，新增发布资源放入 `public/`，Vite 会将其复制到发布包。

## 数据模型

批次使用 `batch/entries/progress` 模型：

```text
batch
  id, kind, createdAt, phase, rootPath
  scan
    scanned, found
  entries[]
    inputPath, inputBytes, filename, relativeName
    outputName, resultPath, resultBytes, savedPercent, error
  progress
    total, completed, succeeded, failed, percent
```

每个输入项在执行前获得唯一的 `outputName`，避免来自不同目录的同名文件争用同一临时结果路径。

## 关键行为契约

- 压缩结果没有比原文件小时，保留原文件作为结果，绝不用更大的文件替换。
- 批次进入方式由 `public/plugin.json` 的 cmds 声明（关键词、files、img、window 四类），`src/ImageCompressor/index.vue` 的插件进入回调统一分发；window 进入依赖宿主 `ztools.readCurrentFolderPath()`。
- 文件夹扫描在批次创建后后台执行，扫描阶段持续报告条目和图片数量并支持取消；取消后关闭当前标签页。
- 列表中的单项替换和复制不隐藏窗口，只有底部批量操作按原有窗口策略处理。
- 设置通过 `dbStorage` 持久化，默认 JPEG 质量为 75、并发线程数为 3、递归压缩子文件夹禁用；用户可配置递归时忽略的目录名称。

## 发布边界

- `vite.config.js` 使用 Vite 构建完整插件目录；`public/preload/package.json` 声明运行时依赖，根目录安装后会同步安装到 preload 目录并随 `dist/preload` 发布。
- `dist/` 是可直接导入和供官方 Action 打包的完整插件目录，根目录包含 `plugin.json`、`index.html`、Logo 和 preload。
- 构建会将运行时依赖目录及其中的许可证文件、许可证元数据复制到发布包；项目自身代码采用 MIT 许可证，依赖保持各自上游许可证。

## 文档维护

- 人工维护的文档只有本文件和 `README.md`；`README.md` 面向市场用户，ZTools 插件市场详情页直接展示其内容。
- 分层、数据模型、行为契约或发布边界变化时更新本文件对应章节；纯实现细节与 Bug 修复不更新。
- 新增文案（注释、日志、异常、提示语）使用简体中文。

## 测试约定

测试位于 `test/*.test.cjs`，使用 Node 内置 test runner；压缩引擎、worker 和运行时服务通过 `public/preload` 下的 CommonJS 模块测试，前端通过 `npm run build` 校验 Vue 模板和 TypeScript。
