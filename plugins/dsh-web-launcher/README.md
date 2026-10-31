# dsh（ZTools 插件）

在 ZTools 里用三条指令管理本地 DSH：

| 指令 | 行为 |
| --- | --- |
| `dsh` | 启动 DSH Web。已经在跑就直接用默认浏览器打开，否则弹一个独立 cmd 窗口在工作目录执行 `dsh web` |
| `dsh update` | 弹 cmd 窗口执行更新命令（默认 `npm install -g @deepseek-ai/dsh@latest`），npm 输出留在窗口里 |
| `dsh config` | 生成（首次）并用默认程序打开配置文件，同时在资源管理器里定位到它 |

插件名 `dsh-web-launcher`，版本 1.1.0。

## 为什么插件标题叫 dsh

ZTools 的 `buildPluginCommandItems` 有一条规则：**只要 `features[].cmds` 里没有任何一项与 `plugin.title` 完全相同，它就会额外补一条以插件标题命名的搜索结果**。把 `title` 设成 `dsh`（与第一条 cmd 相同）就能去掉那条多余项，搜索结果正好三条。

代价是插件在「设置 → 插件」列表里显示为 `dsh`，而不是更长的中文名。

三条指令是三个独立 feature（`dsh-web` / `dsh-update` / `dsh-config`），不是同一个 feature 的别名，因此各自行为固定，不会出现「选中了 dsh update 却启动了 web」的情况。ZTools 按 `calculateMatchScore` 排序，完全匹配得 10000 分、前缀匹配 5000 分，所以输入 `dsh` 回车命中的一定是 `dsh`，输入 `dsh update` 命中的一定是 `dsh update`。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `plugin.json` | ZTools 插件声明，`preload` 指向 `preload.js`，**故意不写 `main`**（无界面插件，不弹插件窗口） |
| `preload.js` | 插件 preload：注册三个无界面入口、探活已有实例、spawn cmd、读写配置 |
| `logo.png` | 插件图标 |
| `build.ps1` | 打包成 ZTools 可导入的 zip |
| `test/preload.test.js` | 单元测试 + 端口探活测试 + 真实 spawn 端到端测试 |
| `test/window-title.ps1` | 用 EnumWindows 列出可见窗口标题，供测试判定窗口是否真的出现 |
| `test/spawn-probe.js` | 诊断脚本：验证 spawn 是否真的留下可见 cmd 窗口 |

`config.json` 不再随插件打包，改为首次运行时生成在用户目录，覆盖安装不会丢。

## 安装

```powershell
powershell -NoProfile -File build.ps1
```

生成 `dist\dsh-web-launcher-1.1.0.zip`，然后在 ZTools 里：

1. 打开 ZTools 主界面 → **设置** → **插件** → **导入插件**
2. 选择 `dist\dsh-web-launcher-1.1.0.zip`
3. 安装后插件位于 `%USERPROFILE%\.ztools\plugins\dsh-web-launcher`

ZTools 的导入只认 `.zpx` / `.zip`，且要求 `plugin.json` 位于压缩包根目录，`build.ps1` 已按此约束打包。
注意：直接往 `.ztools\plugins` 目录丢文件夹不会生效，插件注册表在 ZTools 的 LMDB 数据库里，必须走导入流程。

## 使用

- `Alt+Z` 唤起 ZTools → 输入 `dsh` → 回车
- `dsh D:\CODE\my-project` → 在指定目录启动（仅 `dsh` 支持；已有实例在跑时该参数不生效，因为不会新起进程）
- 想给某条指令单独绑快捷键：ZTools **设置 → 快捷键**，选中对应命令绑一个全局快捷键

## 配置

`dsh config` 会生成并打开 `%USERPROFILE%\.dsh-web-launcher.json`。每次触发都会重新读取，改完保存即生效，不需要重启 ZTools。

```json
{
  "dshCommand": "dsh",
  "defaultCwd": "C:\\Users\\<用户名>",
  "webArgs": [],
  "updateCommand": "npm install -g @deepseek-ai/dsh@latest",
  "keepWindowOpen": true,
  "reuseRunningInstance": true
}
```

| 字段 | 说明 |
| --- | --- |
| `dshCommand` | **dsh 命令的位置**。可以写 PATH 上的 `dsh`，也可以写绝对路径，例如 `C:\Program Files\nodejs\dsh.cmd`（含空格的路径会自动加引号，无需自己处理） |
| `defaultCwd` | 默认工作目录。`dsh web` 会把该目录当作会话工作区，所以别让它落在 ZTools 安装目录上 |
| `webArgs` | 附加给 `dsh web` 的参数，例如 `["--no-open"]`、`["--port", "8081"]` |
| `updateCommand` | `dsh update` 执行的命令。这是一整条命令行，程序路径含空格时需要自己加引号，例如 `"C:\\Program Files\\nodejs\\npm.cmd" install -g @deepseek-ai/dsh@latest` |
| `keepWindowOpen` | `true` 用 `cmd /k`（命令结束不关窗），`false` 用 `cmd /c` |
| `reuseRunningInstance` | `true` 时先探测监听地址，已有实例就直接开浏览器；改成 `false` 则每次都新起进程 |

工作目录优先级：搜索框里的 `dsh <目录>` > `defaultCwd` > 当前用户主目录。非法或不存在的目录会被自动跳过，不会导致启动失败。

探活地址由 `webArgs` 推导：优先 `--port` / `--host`（支持 `--port 8081` 与 `--port=8081`），缺省 `127.0.0.1:3080`；`--host 0.0.0.0` 会按 `127.0.0.1` 探测；`--port 0`（系统随机端口）无法复用，会直接启动新实例。

配置文件路径可以用环境变量 `DSH_WEB_LAUNCHER_CONFIG` 覆盖（主要供测试与多份配置共存）。

## 排查

| 现象 | 原因与处理 |
| --- | --- |
| 输入 `dsh` 搜不到插件 | ZTools 设置里确认插件已安装且未被禁用 |
| 搜索结果多出一条 `dsh` | 说明 `plugin.json` 的 `title` 与某个 cmd 不同，ZTools 会补一条插件名兜底项；改回与某条 cmd 相同即可 |
| 回车后弹出写着「这是隐藏的窗口」的页面 | `preload.js` 未生效或 `window.exports` 未注册，检查插件的 `preload` 字段与文件是否存在 |
| cmd 窗口一闪而过 | 1.0.0 的已知缺陷：`detached` 的 spawn 让子进程没有控制台，`cmd /k` 从 NUL 读到 EOF 后立刻退出。1.0.1 起改为经 `start` 新建控制台，如仍复现请跑 `test/spawn-probe.js` 并反馈 |
| cmd 里提示 `'dsh' 不是内部或外部命令` | `dsh` 不在 PATH 上。把配置里的 `dshCommand` 改成 `dsh.cmd` 的绝对路径即可，含空格的路径（如 `C:\Program Files\nodejs\dsh.cmd`）会被自动加引号 |
| 新窗口没出现，只在任务栏闪了一下 | Windows 11 的默认控制台宿主是 Windows Terminal；若 Terminal 设置了「在新标签页中打开」，新控制台会以标签形式落到已有窗口里 |
| `dsh update` 升错版本 | 改 `updateCommand`，例如把 `@latest` 换成 `@next`（当前 `latest = 0.1.5-rc.1`、`next = 0.1.5-rc.2`） |
| 想强制每次都新起进程 | 把 `reuseRunningInstance` 改成 `false` |

## 开发与测试

```powershell
node test/preload.test.js
```

30 项断言，覆盖：三条指令的 `window.exports` 无界面契约、目录参数解析与优先级、三条命令行组装（含 1.0.x 旧 `command` 字段兼容、含空格路径的自动加引号）、监听地址推导、真实 TCP 端口探活、复用分支是否调用了 `shellOpenExternal`、`dsh update` 的两条真实 spawn 端到端断言（cwd 继承、`/k` 窗口可见且进程存活）、`dsh config` 的生成与打开行为，以及两条**含空格程序路径**的端到端断言（`dshCommand` 自动加引号、`updateCommand` 里用户加的引号被逐字传递）。

第 9、10 节会真的弹出 cmd 窗口（标题为 `DSH_TEST_WINDOW` / `DSH_SPACE_WEB` / `DSH_SPACE_UPDATE`），跑完自动关掉。测试全程使用临时配置文件，不碰用户目录里的真实配置。

判定「窗口是否真的出现」有两个坑，测试里已经绕开：

- `tasklist` / `taskkill` 的 `WINDOWTITLE` 过滤器**看不到 Windows Terminal 托管的控制台窗口**（窗口属于 `WindowsTerminal.exe`，不属于 `cmd.exe`），所以窗口存在性改用 `test/window-title.ps1` 的 `EnumWindows` 探测
- 上面两个命令在**没有匹配项时退出码同样是 0**，因此不能拿退出码当断言；测试额外做了一次反向校验（探测一个不存在的标题必须返回空），避免出现恒真的假通过

含空格的用例不只断言「窗口存在」，还让批处理把窗口标题设成唯一值，再从 `EnumWindows` 里找回来——这样能区分「窗口开了但命令没跑起来」和「命令真的执行了」。这正是 1.1.0 修掉的那类缺陷：`spawn` 默认按 MSVCRT 规则转义引号，`cmd.exe` 不认，带空格的路径会被按空格切开。修法是整条命令行自行拼接并用 `windowsVerbatimArguments` 逐字传递。

`test/spawn-probe.js` 是诊断脚本：用与 `spawnConsole()` 完全相同的参数形状开一个标题为 `DSH_FIX_PROBE` 的窗口，用来单独验证「到底有没有可见窗口、cwd 有没有继承」。

测试会调用 `powershell.exe` 做窗口与进程查询。`build.ps1` 刻意只用 ASCII 编写：本机是 Windows PowerShell 5.1，对**没有 BOM 的 UTF-8 脚本**会按系统 ANSI 代码页解码，中文注释会被打乱并导致脚本解析异常，后续修改时请沿用 ASCII。

## 验证状态

已实测：

- `node test/preload.test.js` 30 项断言全部通过，退出码 0，跑完无残留 cmd 进程
- 窗口矩阵实测：直接 `cmd /k` + `detached` + `stdio:'ignore'` 会**立即退出且无窗口**；`cmd /c start "" cmd.exe /k ...` + `detached` 会**留下可见窗口**（宿主为 `WindowsTerminal.exe`）
- 经 `start` 的写法下 `spawn` 的 `cwd` 被正确继承（探针文件内容与 `cwd` 完全一致）
- 真实环境探活：对正在运行的 `127.0.0.1:3080` 判定为「已在运行」，会走开浏览器分支
- `build.ps1` 产出的 zip 内为 `plugin.json` / `preload.js` / `logo.png` 三个根级条目，`plugin.json` 无 `main` 字段（无界面插件）
- `dsh` 由 npm 全局安装时，其 shim 位于 npm 全局前缀目录，该目录在系统 PATH 上，因此 `cmd /k dsh web` 能被任何进程解析
- 含空格的程序路径（`C:\...\prog dir\dsh.cmd`）能正确加引号并真正执行，窗口标题由批处理设置后可从 `EnumWindows` 找回

已知限制：

- 插件的全部行为通过 `window.exports[featureCode].args.enter` 触发，这条链路已由单元测试与真实 spawn 端到端测试覆盖；但「在 ZTools 搜索结果里回车」这一段依赖 GUI 交互，无法在命令行里自动化验证
- 仅支持 Windows：依赖 `cmd.exe` / `%ComSpec%`，`plugin.json` 已声明 `"platform": ["win32"]`

## 实现依据

- ZTools 3.2.0 主进程 `pluginManager.resolvePluginUrl`：`isConfigHeadless = !pluginConfig.main`，无界面插件加载内置 `hideWindow.html`
- ZTools `pluginManager.processPluginMode`：feature 的 `mode === "none"` 时折叠窗口并调用 `callHeadlessPluginMethod`，最终执行插件 preload 里的 `window.exports[featureCode].args.enter(action)`
- ZTools `pluginManager.createPluginWebContentsView`：插件视图使用 `contextIsolation:false, nodeIntegration:false, sandbox:false`，因此插件 preload 可以直接 `require('node:child_process')`（现有插件 `killprocess` 即如此）
- ZTools 渲染进程 `buildPluginCommandItems`：`hasPluginNameCmd` 为假时补一条以 `plugin.title` 命名的指令；对 `!plugin.main` 的插件还会把首个含字符串指令的 feature 接上去
- ZTools 渲染进程 `calculateMatchScore`：完全匹配 10000 分 > 前缀匹配 5000 分，保证精确指令优先
- ZTools `PluginInstallerAPI.importPlugin` / `installFromPackageFile` / `validatePluginConfig`：导入只接受 `.zpx`/`.zip`、`plugin.json` 必须在包根、必填字段为 `name`/`version` 且 `features` 不能为空
- 插件侧 API 清单来自 `resources\app.asar.unpacked\resources\preload.js`（`hideMainWindow`、`shellOpenExternal`、`shellOpenPath`、`shellShowItemInFolder`、`showToast` 等）
- `dsh web` 默认端口 3080 来自 `@deepseek-ai/dsh-cmdline` 的配置说明 `port: !!js ctx.webStartup.port ?? 3080`；`@deepseek-ai/dsh-host-webserver` 明确「监听失败会 reject 初始化，由启动流程报告失败 fiber」，即第二个实例会直接启动失败而不是复用
- `dsh` 没有 update 子命令（`lib/bin.js` 只注册了 `web` 与 `plugin`），因此更新走 npm 全局安装

`action` 入参形状为 `{ code, type, payload, __assemblyId, __ts }`，其中 `payload` 是搜索框原始文本，本插件据此解析目录参数。`enter()` 允许返回 Promise（宿主侧 `call-plugin-method` 会 `await`），端口探活因此可以直接异步执行。
