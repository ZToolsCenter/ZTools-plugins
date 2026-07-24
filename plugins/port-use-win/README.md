# Windows 端口占用

> 在 ZTools 中快速查看 Windows 当前端口占用，结合进程信息定位监听来源；preload 侧同时提供运行中服务详情查询能力，便于后续关联排查服务、进程与端口。

![插件 Logo](public/logo.png)

## 功能说明

- 使用 PowerShell 读取 `netstat` 与进程列表，展示当前 TCP / UDP 端口占用。
- 页面内可按字段切换筛选维度，顶部搜索框只输入值即可。
- 主表展示进程名、监听地址、协议，展开行查看远程地址、状态、Host / Port 等详情。
- 每条记录支持直接结束对应进程。

## 使用方式

1. 在 ZTools 中运行插件 `Windows 端口占用`。
2. 顶部下拉框选择筛选字段，例如 `PID`、`端口`、`本地地址`。
3. 在 ZTools 搜索框输入筛选值，例如 `82`、`node`、`LISTENING`、`127.0.0.1`。
4. 需要查看更多信息时，展开表格行；需要结束进程时，点击操作列删除按钮。

## 数据来源

- 端口占用：通过 `netstat -ano -p tcp` / `netstat -ano -p udp` 获取连接行，再用 `Get-Process` 补充进程名。
- 运行服务：通过 `Get-CimInstance Win32_Service -Filter "State = 'Running'"` 获取运行中服务详情。
- PowerShell 执行环境优先使用 `pwsh`，未安装 PowerShell Core 时自动兼容系统自带的 `powershell.exe`。

端口查询没有直接依赖管理员权限；结束进程是否成功取决于当前 ZTools 进程权限和目标进程权限。

## 兼容性

- 仅支持 Windows。
- preload 会优先尝试 `pwsh`，未安装 PowerShell Core 时兼容系统自带的 `powershell.exe`。
