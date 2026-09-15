---
name: develop-ztools-plugins
description: 创建、修改、调试、验证和交付 ZTools 插件，涵盖 plugin.json 清单、CommonJS preload 桥接、Vue/React/Vite 界面、ZTools API、开发服务器、真实 Electron E2E、截图和可安装插件目录。当需要新建 ZTools 插件、更新已有插件、排查插件生命周期或界面问题、接入宿主能力，或发布前验证插件时使用。
---

# 开发 ZTools 插件

## 确认上下文

1. 修改前完整阅读距离目标文件最近的 `AGENTS.md`。
2. 将会话绑定的工作区作为唯一写入根目录；开始和交付前都确认所有文件位于该目录。
3. 新建插件或进行较大改动时，阅读 [references/new-plugin-workflow.md](references/new-plugin-workflow.md)。
4. 修改清单、preload、生命周期、存储、安全或打包时，阅读 [references/plugin-contract.md](references/plugin-contract.md)。
5. 发现项目、ZTools 宿主或运行 Electron E2E 时，阅读 [references/environment-discovery.md](references/environment-discovery.md)，禁止依赖维护者电脑上的固定路径。
6. 只有所需 API 或指令语义未被上述资料覆盖时，再阅读完整的 [references/ai-plugin-guide.md](references/ai-plugin-guide.md)。
7. 选择结构和样式前检查一到两个相邻插件。相邻插件可能使用旧契约；发生冲突时以本 Skill、`plugin-contract.md` 和校验器为准。

## 选择形态

- 表单、设置、列表、编辑器、预览或复杂结果界面使用 Vue/React 与 Vite。
- 不需要页面的后台命令使用纯 preload 模式。
- 文件系统、命令执行、原生模块、特权网络请求和密钥存储放到最小化 preload 桥接后面。
- 仅在触发语义符合需求时使用 `over`、`regex`、`img` 或 `files`。宽泛的 `over` 必须设置 `minLength` 和 `maxLength`。
- 宿主管理的 AI 模型使用 `ztools.ai` 或 `ztools.aiChat`：简单生成使用 `ai`，插件自行管理工具循环时使用 `aiChat`；不要在插件中重复保存供应商 API Key。

## 新建项目

使用内置生成器创建项目结构；不要手动复制模板目录。生成器完成后，必须立即执行下面的 Logo 门禁，模板中的 Logo 只能作为临时占位资源，不能直接交付：

```bash
python3 <skill-dir>/scripts/create_plugin.py <project-dir> \
  --template vue \
  --name <plugin-id> \
  --title "<plugin-title>" \
  [--description "<description>"] [--author "<author>"]
```

`<skill-dir>` 是本文件所在目录。生成器允许目标目录不存在，或已经存在但仅包含 `.DS_Store`、`.gitkeep`。非空目录一律拒绝覆盖。只有确实需要 Hello、读文件和写文件示例时才传 `--examples`；`--platform` 可重复传入 `win32`、`darwin` 或 `linux`。

生成的 Vue 项目使用以下稳定结构：

```text
plugin-project/
├── src/
├── src-ztools/
│   ├── plugin.json
│   ├── logo.png
│   ├── preload/
│   └── dist/
├── tests/e2e/plugin.spec.js
├── playwright.e2e.config.js
└── package.json
```

### Logo 门禁（创建后必须完成）

1. 根据插件定位设计独立的 SVG 源图标，例如 `assets/icon.svg`；禁止使用模板图标、通用占位图标或未经修改的现成模板资源。
2. 使用 `magick`、`sips` 或其他可靠图像工具，将 SVG 转换为 `src-ztools/` 中由 `plugin.json.logo` 引用的 PNG（或项目契约明确允许的图片格式）。
3. 转换后检查图片文件存在、尺寸适合实际显示、透明背景正确、图标清晰可辨，并确认文件内容不等于内置模板 Logo。
4. 只有完成上述设计、转换和检查后，才能继续 build、E2E 测试或交付插件。
5. 如果当前环境无法生成或转换图标，必须暂停并向用户说明，禁止用模板 Logo 代替。

## 实现约束

1. 先确认 `plugin.json` 和真实功能 code，再实现界面。
2. 必须通过 Logo 门禁替换模板图标；禁止交付模板自带或通用占位图标。根据插件定位设计独立 SVG 源图标，转换为 `plugin.json` 引用的图片，并验证透明背景、清晰度、实际显示尺寸和模板 Logo 哈希差异。
3. 删除未使用的模板示例、入口、依赖和 preload 方法，禁止把演示能力带进成品。
4. preload 只暴露狭窄业务操作，不暴露完整 Node 或 Electron 模块。
5. 校验用户输入、文件路径、响应结构、大小和扩展名边界；禁止把 API Key 写入源码。
6. 页面插件使用 `ztools.onPluginEnter` 接收入口数据，不与 `window.exports`、`mode: "none"` 组合。
7. 处理重复进入、退出、取消、过期异步响应、资源清理和跨平台差异。
8. 使用 `ztools.dbStorage` 保存简单设置和偏好，在 preload 中集中默认值、类型归一化和数值边界。浏览器降级适配必须复用同一业务契约，不复制一套状态规则。
9. 保持 `html`、`body`、应用根节点背景透明，使用宿主主题变量并支持深色模式；除非用户明确要求，不强制插件高度。
10. 提供加载、空白、错误、禁用和成功状态。界面无需依赖营销式说明文字才能使用。
11. 使用相邻旧插件时只参考产品和样式，不复制未经当前校验器确认的清单或 preload 结构。

### 代码结构与可维护性

- 开始实现前先理解现有结构和变化边界，按职责设计代码，保持模块与文件职责单一。
- 新功能不应持续堆入已有大文件。逻辑可以独立理解、复用、测试或变化时，将其提取为命名清晰的组件、组合式函数、服务或工具模块，并让调用方只保留编排职责。
- 拆分依据是职责和依赖方向，而不是机械的行数限制。简单且只使用一次的逻辑保留在就近位置，避免无意义的包装层、万能工具文件和过早抽象。
- 扩展现有模块前检查它是否已经承担多个无关职责；如果是，先在不改变行为的前提下整理边界，再接入新功能。
- 保持模块接口小而明确，业务规则集中在单一来源；禁止通过复制实现、跨层读写状态或循环依赖换取短期开发速度。

### Windows Shell 约定

- Windows 中的命令执行能力以 `powershell` 工具提供；macOS/Linux 才提供 `bash` 工具。直接传入 PowerShell 命令，不要再次包裹 `powershell -Command` 或 `pwsh -Command`。
- 命令中需要保留 PowerShell `$` 变量时优先使用单引号，避免被外层 PowerShell 提前展开。
- 需要调用外部程序时保持参数边界清晰，避免依赖多层嵌套引号；工具运行时会统一将 PowerShell 输出编码为 UTF-8。

## 构建和校验

生成项目后执行：

```bash
npm install
npm run build
python3 <skill-dir>/scripts/validate_plugin.py <project-dir>/src-ztools
```

`src-ztools/` 是最终插件目录，也是打包或压缩时选择的根目录。`npm run build` 只将页面产出到 `src-ztools/dist/`；`plugin.json`、Logo、preload 和 preload 运行依赖保留在 `src-ztools/`，不重复复制到 `dist/`。清单的生产入口保持为 `main: dist/...`。

`validate_plugin.py` 会检查 Logo 文件、PNG 基础属性以及是否仍为内置模板 Logo。不要绕过或替换这个校验器，也不要把 `src-ztools/dist/` 单独当作完整插件目录进行校验或交付。

## 真实 Electron 验证

新项目先运行模板自带的生产包冒烟用例：

```bash
npm run test:e2e
```

该用例使用安装版 ZTools、独立临时数据目录和 `src-ztools/plugin.json`，加载其中构建后的 `dist` 页面，不会连接用户当前实例。根据本次功能继续补充真实 feature、payload、preload、持久化和交互断言；不要用纯浏览器测试替代依赖 ZTools API 的 Electron E2E。

测试必须：

- 使用 `electron.launch({ executablePath })`；从 ZVC Bash 子进程继承 `ZTOOLS_E2E_EXECUTABLE_PATH`，该值由当前运行中的 ZTools Electron 进程提供。禁止扫描标准安装目录或 `PATH` 选择其他宿主版本。
- 通过包内设置插件导入、安装和启动开发插件，不启动或猜测设置插件开发端口。
- 等待 WebContents 加载和框架渲染稳定后再读取状态，不用固定短延时假定渲染完成。
- 截图验证前检查当前模型是否支持图片理解。模型支持读图时，只截取插件 WebContentsView，并实际读取截图检查裁切、重叠、主题和白屏；模型不支持读图或未提供图片读取能力时，跳过依赖截图理解的 E2E 截图测试并在交付中说明，但仍执行可用的 Electron 交互、DOM 和状态断言。
- 在 `finally` 中关闭测试实例并删除临时目录，保持 `ZTOOLS_DATA_ROOT` 和 `ZTOOLS_LEGACY_USER_DATA_PATH` 与真实用户数据隔离。
- 将新的业务断言保留在项目测试文件中，禁止只用一次性 heredoc 脚本完成验证。

对有界面的插件至少检查正常尺寸和窄窗口；声称支持深色主题或减少动画时补充对应验证。声称持久化时至少重新加载插件，关键数据应在重启隔离 Electron 后复验。

## 开发服务和资源

需要实时预览时运行：

```bash
npm run dev -- --host 127.0.0.1
```

交付前确认 `development.main` 与实际监听地址一致，并用端口检查或 HTTP 请求确认服务可用。为测试停止已有服务时，测试后恢复；如果只验证生产包且用户不需要实时预览，不必额外保持开发服务。

生成 Logo 前先检查现有资源，再检查 `magick`、`sips` 或可用图像工具；不要假设 Python 已安装 Pillow。用户未要求独立压缩包时交付 `src-ztools/`，不要额外执行临时 ZIP 命令。

## 交付

- 说明修改内容、插件触发方式、源码目录和可安装目录。
- 分开列出“已实现”“已自动验证”“尚未验证”，不得把代码推断写成测试结论。
- 准确报告构建、校验器、preload 语法、Electron E2E 和截图结果。
- 开发服务仍在运行时提供准确 URL。
- 只验证界面时，不声称已验证提供商 API、认证、音频、文件系统或粘贴行为。
