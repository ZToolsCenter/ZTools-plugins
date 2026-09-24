# 跨平台开发环境发现

本文件只定义环境发现顺序和失败边界，不记录维护者电脑上的用户名、仓库路径、端口或应用版本。任何路径在使用前都必须由当前会话上下文、环境变量或文件系统检查确认。

## 输入优先级

按以下顺序确定开发环境，前一项存在时不要被后一项覆盖：

1. 用户在当前需求中明确提供的路径或命令。
2. 当前会话绑定的 ZVC 工作区。
3. 项目已有配置和环境变量。
4. 从当前工作区向上或在同级目录中发现的资源。

禁止根据用户名、主目录名称、维护者目录结构或另一台机器的历史路径推断环境。

## 确定插件项目

- 将会话绑定工作区作为唯一写入边界。用户明确指定工作区内某个子目录时，使用该子目录。
- 从候选目录向上查找 `plugin.json`、`src-ztools/plugin.json`、`package.json` 和 `AGENTS.md`，根据实际文件确定项目根目录。
- 修改任何文件前，完整阅读距离目标文件最近的 `AGENTS.md`；不要引用其他仓库中已知但当前不可见的规则。
- 不要假设插件位于某个固定的 `plugins/` 仓库。当前工作区可以是单插件项目、monorepo 子目录或空目录。
- 新建项目时只在用户选择的目录内创建文件。没有有效工作区时先要求用户选择，不要回退到维护者路径或系统临时目录。

## 使用参考资料

- API、清单和安全契约优先使用本 Skill 的 `references/`，模板优先使用本 Skill 的 `assets/`。
- 相邻插件仅在当前工作区或可访问的同级目录中确实存在时作为样式和工程参考；不存在时继续使用内置资料。
- ZTools 源码、文档源码和插件集合仓库都是可选资源。只有用户提供路径或从当前工作区可靠发现后才能读取。
- 不要因为缺少源码仓库而阻止插件创建、构建、静态校验或安装版宿主 E2E。

## 发现 ZTools 宿主

真实 Electron E2E 必须复用当前运行中的 ZTools 版本。ZVC preload 从当前 Electron 进程读取宿主位置；macOS Renderer 位于 Helper 应用中，因此会反向解析同一 `.app` 的主程序，Windows/Linux 则使用当前进程对应的应用可执行文件。解析结果会在启动 Bash 子进程时注入：

```text
ZTOOLS_E2E_EXECUTABLE_PATH=<当前 ZTools 进程可执行文件>
```

生成项目的 E2E 模板只读取并校验这个值，不扫描标准安装目录、`PATH` 或其他 ZTools 进程，避免误用另一安装版本。开发版 ZTools 已提供 `ZTOOLS_E2E_APP_ROOT` 时，模板会同时将源码根目录作为 Electron 启动参数。测试仍会启动一个使用临时数据目录的独立实例，不连接当前用户实例。

如果测试命令不是从 ZVC 工具环境启动，环境变量不会自动存在。此时应从 ZVC 中执行测试，或由用户明确指定当前宿主路径：

```bash
ZTOOLS_E2E_EXECUTABLE_PATH="<ZTools 可执行文件绝对路径>" npm run test:e2e
```

变量必须是存在且可执行的绝对路径。配置无效时立即停止，不得回退到另一版本、下载新宿主或扫描系统进程猜测路径。

## 可选的源码宿主

只有需求明确涉及尚未发布的宿主 API，且用户提供或工作区发现了 ZTools 源码目录时，才使用源码宿主：

1. 读取源码仓库自己的 `AGENTS.md` 和脚本定义。
2. 确认可执行入口、构建产物和依赖实际存在。
3. 使用源码仓库规定的开发或测试命令，不把某一台机器上的命令复制成通用规则。
4. 继续设置隔离数据目录，不读取真实用户数据。

无法确认源码入口时，回退到安装版宿主；安装版也不可用时，完成其余验证并明确报告 Electron E2E 未执行。

## 隔离启动 Electron

每个测试创建独立临时目录，并通过环境变量隔离当前和旧版数据：

```js
const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-e2e-'))
const legacyRoot = path.join(dataRoot, 'legacy')
const executablePath = await resolveZToolsExecutable()

electron.launch({
  executablePath,
  args: [],
  env: {
    ...process.env,
    ZTOOLS_DATA_ROOT: dataRoot,
    ZTOOLS_E2E: '1',
    ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
  },
})
```

在 `finally` 中关闭测试实例并只删除本次测试创建的目录。禁止使用真实的 `~/.ztools` 数据目录。

## 识别设置页和插件页

不要依赖完整 `file://` URL、应用版本或本地开发端口。枚举真实 WebContents，并使用稳定页面特征定位：

```js
const settingsContents = webContents
  .getAllWebContents()
  .find((contents) => contents.getURL().includes('internal-plugins/setting/index.html'))
```

通过设置页的受控内部 API 导入、安装和启动开发插件。插件页面地址从实际 `plugin.json` 的生产入口或开发入口解析，不硬编码另一项目的端口。

如果定位失败，输出每个 WebContents 的 URL、加载状态、标题和正文摘要，再依据真实状态修正定位条件。不要连续更换端口猜测入口。

## 开发服务端口

- 先读取 `plugin.json.development.main`、Vite 配置和项目脚本确定开发地址。
- 启动前检查对应端口的监听者，只停止能够确认属于当前插件的进程。
- 固定端口冲突时，优先保持清单和开发服务器配置一致；不要只修改一侧。
- 测试临时停止已有开发服务后，从原项目目录恢复，并用 HTTP 状态确认可访问。

## 验证降级

环境能力不足时按以下边界继续推进：

- 缺少相邻插件：使用内置模板和契约。
- 缺少 ZTools 源码：使用安装版宿主。
- 当前 ZTools 进程没有提供有效可执行路径：执行单元测试、构建、preload 语法检查和 `validate_plugin.py`，将 Electron E2E 标记为未执行。
- 模型不支持图片理解：跳过依赖视觉判断的截图检查，但保留可执行的 Electron DOM、交互和状态断言。
- 缺少必要路径且不同选择会改变交付结果：停止相关步骤并向用户询问，不擅自创建机器绑定的回退路径。
