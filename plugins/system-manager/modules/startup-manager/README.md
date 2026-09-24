# 开机启动管理

跨平台查看开机启动项、登录项与后台服务，并安全启停可回滚的**当前用户级**项目。插件不会请求管理员权限，不调用 `sudo`，不会停用系统服务或删除启动文件。

## 能力矩阵

| 平台 | 枚举来源 | 可管理项目 | 只读项目 |
| --- | --- | --- | --- |
| macOS | LaunchAgents、LaunchDaemons | 无 | 全部只读；`launchctl` 无法可靠证明当前服务来源就是扫描到的 plist |
| Windows | Run/RunOnce、Startup 文件夹、计划任务、自动服务 | 当前用户登录/开机计划任务 | Run/RunOnce、启动文件夹、系统任务、服务 |
| Linux | XDG Autostart、systemd、`@reboot` cron | 用户 `.desktop`、可启停的 user systemd service | 系统 Autostart/systemd、static/masked unit、cron |

“运行中”和“已启用”是两个独立状态：已启用表示未来会按触发条件运行，运行中表示扫描时进程或服务已加载。影响等级是基于来源和触发方式的启发式判断，不代表实时 CPU 或内存占用。

## 安全与回滚

- UI 只提交扫描生成的 `snapshotId` 和 opaque `itemId`，不提交路径、命令或 unit 名。
- preload 保存真实目标，操作前再次检查文件哈希、inode、realpath、父目录或服务定义指纹，发现外部变化会拒绝操作；符号链接和非普通文件不会进入可管理集合。
- `~/.config/autostart` 本身必须是普通目录且 canonical path 严格位于 realHome 内；根目录 inode/canonical 证据会在执行和撤销前再次核对，符号链接或越界目录直接拒绝。macOS 用户 LaunchAgents 根目录也必须通过相同边界才会进入只读清单。
- 扫描、修改与撤销共用一个全局执行门闩；任何并发请求都会返回 `ITEM_BUSY`，避免跨项目放大文件校验和子进程调用。
- Linux `.desktop` 同步维护 `Hidden` 与 `X-GNOME-Autostart-enabled`，使用同目录临时文件和原子替换；rename 前再次复核目标及父目录，撤销前再次校验内容。
- Windows Run 注册表值保持只读，避免插件崩溃后丢失恢复数据；计划任务由系统原生保存启用状态。
- 每次成功修改生成一次性 `operationId`；撤销记录 10 分钟后过期，且不会覆盖外部改动。
- 新操作会使上一条 `operationId` 立即失效；最新一条撤销记录会在写入前保存到隔离 journal，并在新会话扫描时按权威状态恢复或标记需核对，10 分钟后自动清理。操作和撤销完成后均权威重扫启用与运行状态。
- 子进程只使用绝对系统工具路径、受控 `PATH` 和参数数组；PowerShell 使用静态 Base64 脚本和环境变量传值，严禁 shell 拼接。
- macOS 扫描以 `opendir` 流式读取、10 秒总时限和 8 路并发解析有界 plist；它只读取 launchd 状态用于展示，不执行 `enable`、`disable`、`bootstrap` 或 `bootout`。这是因为相同 Label 可能对应标准目录外动态加载的服务，现有公开信息不足以建立可信来源绑定。
- Windows 计划任务操作前后核对 XML（忽略 Enabled 位）、Principal、Actions 与 URI 指纹，定义变化即拒绝操作。
- Windows PowerShell 固定无 BOM UTF-8 输出、系统 `PSModulePath` 并从绝对系统路径导入模块，不继承用户模块搜索目录。
- Linux user systemd 仅允许精确 `enabled` 与 `disabled` 两种持久状态；runtime、linked、masked、indirect、alias 等无法精确回滚的状态全部只读，执行前后按原始状态字符串复核。
- Linux 原子替换在 rename 前最后复核父目录、inode 与内容。用户态无法消除最终复核与内核 rename 调用之间的极短调度窗口；同目录原子 rename 将影响限制为替换已验证目录项，不会跟随符号链接。
- 主目录和用户名在展示前替换为 `~`，原始命令默认折叠。
- 用户启动文件通过文件句柄有界读取，单文件严格限制为 256 KiB，并复核 inode、大小和修改时间；扫描快照只保留哈希与 stat 证据，不缓存文件正文。

## 已知限制

- macOS 传统 Login Items 没有稳定且无需额外授权的公开枚举接口；首版覆盖 launchd 项目，不使用不稳定的私有数据库格式。
- macOS LaunchAgent 与 LaunchDaemon 全部只读；需要切换时请使用系统设置、应用自身设置或可验证来源的专用管理工具。
- Windows 注册表 Run 值、HKLM、服务及系统任务保持只读；启动文件夹首版也只展示，避免删除注册表值或搬移第三方文件造成不可恢复状态。
- Linux 发行版可能不使用 systemd，或图形会话没有 user bus；此时保留 XDG Autostart 和 cron 结果并显示警告。
- cron 的安全编辑需要重写完整 crontab，因此首版只读。

## 开发与验证

```bash
cd ../..
npm install
npm test
```

该目录是系统管家的内部 workspace，不再生成可独立安装的 manifest 或 ZIP。唯一受支持的发布物由根目录构建并统一应用页面级 preload 隔离、生产 CSP 与体积门禁。
