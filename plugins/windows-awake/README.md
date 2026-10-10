# Windows 唤醒控制

通过 Windows 的 `SetThreadExecutionState` 阻止系统自动睡眠（可选同时保持屏幕点亮），
可以设置唤醒时长，也可以一直保持。

- 唤醒时长：15 分钟 / 30 分钟 / 1 小时 / 2 小时 / 一直保持 / 自定义（1 - 1440 分钟）
- 息屏策略：不允许息屏（`ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED`）或允许息屏（仅 `ES_SYSTEM_REQUIRED`）
- 只提交执行状态请求，不修改系统电源计划，到时自动释放
- 运行中可以随时调整时长与息屏策略：时长按新值重新计时，策略立即生效并保留剩余时间
- 关闭 ZTools 窗口后唤醒继续在后台保持；退出 ZTools 时守护进程自动清理

## 工作原理

`src-ztools/preload/services.js` 在插件数据目录写入 `awake-guard.ps1`，并用隐藏窗口的
PowerShell 启动它。守护进程调用 `SetThreadExecutionState(ES_CONTINUOUS | ...)` 后保持存活，
按秒刷新心跳文件，直到以下任一情况发生：

- 页面请求停止（写入 `guard-stop.flag`）
- 到达设定时长
- 宿主 ZTools 进程退出（守护进程检查父进程号，缺失时退回按进程名判断）

进程结束时 Windows 自动释放执行状态，界面通过心跳与进程存在性判断真实状态。
页面只调用 `window.awakeBridge` 的 `start` / `stop` / `getStatus` / `getConfig` / `saveConfig`。

运行期间会在 ZTools 数据目录的 `windows-awake/` 子目录写入守护脚本、状态文件与心跳文件。

## 开发

```bash
npm install
npm run dev
```

开发页面默认运行在 `http://localhost:5173`，ZTools 从
`src-ztools/plugin.json` 的 `development.main` 加载该页面。

## 构建

```bash
npm run build
```

构建脚本会完成类型检查和 Vite 页面构建。可安装的插件目录是 `src-ztools/`：

- `plugin.json`
- `logo.png`（由 `logo.svg` 经 `npm run build:logo` 生成）
- `preload/` 及其 CommonJS 声明
- `dist/` 中的 `index.html` 和前端资源

`src-ztools/plugin.json` 保持 `main: dist/index.html`，因此 `dist/` 只负责承载
页面构建结果，不重复存放清单、Logo 或 preload。

## 测试

```bash
npm run test:guard   # 直接驱动 PowerShell 守护进程，验证标志位、定时与自动清理
npm run test:e2e     # 在隔离的真实 ZTools 中安装插件并验证完整业务闭环
```

`test:e2e` 覆盖：插件安装与页面绘制、开始/停止保持唤醒、真实守护进程与标志位、
运行中切换息屏策略、一直保持与自定义时长、设置跨宿主重启保留、退出宿主后无残余进程、
亮色与暗色主题截图。

## 打包与本地安装

```bash
npm run package:zpx
```

生成 `release/windows-awake-<版本>.zpx`（gzip 压缩的 asar，即 ZTools 的本地插件包格式），
打包副本会自动移除 `development` 入口，安装后的插件只加载本地构建页面。

安装方式：

1. 执行 `ZTools.exe <插件包绝对路径>`，已运行的实例会打开「安装插件」页面并预览插件信息；
   也可以直接双击 `.zpx` 文件，或在 ZTools 设置中导入该文件。
2. 确认插件信息后点击安装，并在「安全提示」中确认继续安装。
3. 安装完成后搜索 `保持唤醒` / `唤醒控制` / `不锁屏` / `awake` 即可打开插件。

开发调试时也可以在 ZTools 的插件开发入口把 `src-ztools/` 作为开发项目导入，
直接加载 `npm run dev` 的开发页面。

## 结构

```text
logo.svg                   图标源文件
scripts/build-logo.mjs     SVG → src-ztools/logo.png
scripts/build-zpx.mjs      src-ztools → release/*.zpx
src/                       Vue 页面源码
src-ztools/plugin.json     插件清单
src-ztools/preload/        守护脚本与最小 preload 桥接
src-ztools/dist/           Vite 页面构建结果
release/                   本地安装包（npm run package:zpx 生成）
tests/guard/               守护进程行为测试
tests/e2e/                 真实 Electron 端到端测试
```
