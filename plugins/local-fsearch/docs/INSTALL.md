# 安装与首次使用

## Windows

1. 从 https://www.voidtools.com/downloads/ 安装 Everything 完整版并启动客户端，等待索引就绪。仅运行系统服务不足以查询。
2. 导入本插件的运行文件 ZIP，或用 ZTools 开发者工具选择 plugin.json。
3. 输入 fs / find；默认按名称包含搜索。在“使用与连接”确认 Everything 版本。
4. 插件已附带官方 ES 命令行工具，无需另外下载 ES 或安装 Node.js。Everything 客户端需自行安装并启动，再到“使用与连接”点击“检测连接”。命名实例可在启动 ZTools 前设置 ZTOOLS_EVERYTHING_INSTANCE；替换 ES 使用 ZTOOLS_EVERYTHING_ES 绝对路径。
5. 正文/定义/Git/Quick Look 为 macOS 专属，不会在 Windows 注册。

连接失败先确认 Everything 客户端已启动。覆盖不足请在 Everything 设置中检查卷、文件夹及排除规则，不需要打开 HTTP 服务。

## macOS


本文记录 macOS 版的 **noahdunnagan/fsearch** 安装流程。Windows 使用 Everything，见 [README](../README.md#安装与发布准备)。插件与索引引擎分别安装，索引由引擎维护。

## 已验证组合

- Apple Silicon（arm64），macOS 27.0.1。
- ZTools 3.3.0-beta.2。
- FSearch v0.2.1 官方 Apple Silicon 发布文件。

这不是最低系统版本声明。其他 macOS / ZTools 版本、Intel Mac 尚未完成实机验证；不要将此列表理解为“任意 Mac 均兼容”。

## 1. 安装引擎

官方发布页：https://github.com/noahdunnagan/fsearch/releases/tag/v0.2.1

Apple Silicon 用户可在一个新建的临时目录中执行以下步骤。下载只在用户自行执行命令时发生，插件不会自动下载。

```sh
mkdir fsearch-0.2.1-install
cd fsearch-0.2.1-install
curl -fL -O https://github.com/noahdunnagan/fsearch/releases/download/v0.2.1/fsearch-aarch64-apple-darwin.tar.gz
printf '%s\n' '08f68fe10362732f701be3ddf59cb370920c5a08af63e76b15addf8aca118d2f  fsearch-aarch64-apple-darwin.tar.gz' | shasum -a 256 -c -
# 上一步必须输出 OK；校验失败时停止，不解压执行。
tar -xzf fsearch-aarch64-apple-darwin.tar.gz
./fsearch install
```

标准安装位置为 `~/.local/bin/fsearch`。当前插件只从该位置尝试自动启动；若已有服务处于运行状态，可直接连接标准 Socket，但仍会提示缺少标准安装文件，无法保证重启。

需要开机自动运行时，可自行执行 `~/.local/bin/fsearch install --login`，这会创建 FSearch 登录项；不是使用插件的必需步骤。不要以 root/sudo 启动插件或引擎。

如果 macOS 阻止运行下载的程序，按系统“隐私与安全性”中的提示确认来源；插件不移除隔离属性、不绕过系统保护。

## 2. 授权与初始索引

在“系统设置 → 隐私与安全性 → 完全磁盘访问权限”按 [FSearch 官方说明](https://github.com/noahdunnagan/fsearch#full-disk-access) 授权。登录项方式需要授权 `~/.local/bin/fsearch`；通过终端启动时，应注意终端的权限来源。引擎重装或重新编译后，可能需要重新授权。

```sh
~/.local/bin/fsearch status
```

首次建立索引需要时间。权限不足时引擎会跳过受保护目录；权限允许也不意味着系统不可访问的文件或远端未下载内容一定可搜。插件不会额外重扫磁盘，也不会代替用户修改权限。

## 3. 加载插件

仓库不附带安装包。开发者可以在 ZTools 的开发者工具中选择本项目 `plugin.json` 加载源码，或通过 ZTools 导入构建后的安装包。不要把 GitHub 源码 ZIP 当成 zpx。

输入 `fs` / `find` 唤起；首次进入默认“模糊查找”。“使用与连接”可查看状态、安装说明、受限权限与手动重检入口。

需要自行开发和测试才安装 Node.js 18+。普通使用者不需要 Node.js 或 Rust（使用引擎预编译文件时）。

## 故障排查

| 现象 | 操作 |
| --- | --- |
| 请先安装 FSearch | 确认标准程序位置，再运行 status |
| 启动失败 | 在终端运行 status 查看原始错误，检查运行权限与系统拦截 |
| 初始索引建立中 | 等待后点击“重新检测”，插件不轮询 |
| 部分目录搜不到 | 查看完全磁盘访问状态、目录筛选与引擎覆盖规则 |
| 接口不兼容 | 参考已验证版本，升级或回到对应引擎后重检；不会悄悄换搜索模式 |
| 安装指纹未识别 | 仅代表不是已记录的发布文件；能力探针会单独验证，不能据此推断守护进程版本 |
| 更新程序后行为异常 | 按引擎文档重启 FSearch，再手动重检；插件隐藏不会停止共享引擎 |

## 卸载与数据

在 ZTools 中卸载插件不会自动卸载 FSearch 或删除其索引。插件设置由 ZTools 的存储机制管理，卸载后是否保留以宿主行为为准。引擎登录项可按其文档执行 `fsearch uninstall`；该命令保留索引，不要误以为已清除所有数据。
