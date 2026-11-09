# 更新日志

本文件结构参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## 1.1.0 - 2026-09-11

首次发布。

### Added

- `dsh`：启动 DSH Web。先探测监听地址（默认 `127.0.0.1:3080`，可由 `webArgs` 里的 `--port` / `--host` 覆盖），已有实例就直接用默认浏览器打开，否则在独立 cmd 窗口里执行 `dsh web`
- `dsh update`：在 cmd 窗口里执行更新命令，默认 `npm install -g @deepseek-ai/dsh@latest`
- `dsh config`：配置文件不存在时先生成，然后用默认程序打开，并在资源管理器里定位到它
- `dsh <目录>`：在指定工作目录启动，优先级高于配置里的 `defaultCwd`
- 配置文件位于 `%USERPROFILE%\.dsh-web-launcher.json`，不随插件打包，覆盖安装不会丢失；路径可用环境变量 `DSH_WEB_LAUNCHER_CONFIG` 覆盖
- 无界面插件形态：`plugin.json` 不声明 `main`，三条指令都是独立 feature，回车即执行，不弹插件窗口

### Notes

- 独立 cmd 窗口必须经 `start` 创建新控制台。`detached` 的 `spawn` 会让子进程没有控制台，而 `stdio` 为 `ignore` 时 `cmd /k` 会从 NUL 读到 EOF 后立刻退出，表现为窗口一闪而过、命令没跑起来。这条约束由 `test/preload.test.js` 的端到端断言守住
- 整条命令行由插件自行拼接，并以 `windowsVerbatimArguments` 逐字交给 `CreateProcess`。`spawn` 默认按 MSVCRT 规则用反斜杠转义参数里的引号，而 `cmd.exe` 不认这种转义，含空格的程序路径（如 `C:\Program Files\nodejs\dsh.cmd`）会被按空格切开、报「不是内部或外部命令」。`dshCommand` 含空格时会自动加引号；`updateCommand` 是一整条命令行，用户自行加的引号会被逐字传递
- 插件仅支持 Windows，`plugin.json` 已声明 `"platform": ["win32"]`
