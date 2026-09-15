# 应用卸载助手

一个面向 ZTools 的跨平台本地卸载插件。它以流式、限量方式枚举标准应用入口，按应用标识查找缓存、配置、日志和状态文件，在任何写操作前提供逐项预览。

## 支持范围

| 平台 | 应用来源 | 自动能力 | 安全降级 |
|---|---|---|---|
| macOS | `~/Applications`、`/Applications`、`/System/Applications` | 用户目录 `.app` 可移入废纸篓；关联残留逐项选择 | 系统级应用只预览 |
| Windows | HKCU/HKLM 32/64 位 Uninstall 注册表 | AppData 残留逐项选择 | 注册表卸载命令、系统级/提权卸载器只预览 |
| Linux | 用户/系统 `.desktop`、Flatpak、AppImage | XDG 残留逐项选择 | desktop 的 `Exec`、Flatpak、Snap、deb/rpm/pacman 和系统入口只预览 |

Windows 不使用 `Win32_Product`，避免它触发 MSI 自修复；注册表扫描只调用由严格 `SystemRoot` 构造的绝对 `System32\\WindowsPowerShell\\v1.0\\powershell.exe`，覆盖受控 `PATH`/系统 `PSModulePath`，并从绝对系统路径导入模块。32/64 位注册表来源与原始子键共同组成身份，PowerShell 端最多输出 5,001 项。HKCU 的名称、键名和卸载命令均可由用户进程改写，因此插件不会代替用户执行注册表卸载命令。Linux 不执行 `.desktop` 文件的 `Exec` 字段，也不依据可变的 `Exec`/`X-Flatpak` 元数据删除 AppImage 或调用包管理器；相关条目仅展示并引导用户使用系统管理工具。所有外部程序均通过固定可执行文件和参数数组调用，不启用 shell。

## 安全模型

1. 扫描只生成 opaque `appId`，前端不能传入应用路径。
2. 预览生成有效期两分钟、仅可使用一次的 opaque plan；新预览立即使旧 plan 失效，扫描、预览与执行全局串行。
3. 执行只接受 plan 中的候选 ID，并要求输入完整应用名称。
4. 只有应用本体会按安全策略默认选择。Bundle ID、注册表键和 desktop/package ID 都属于应用或用户态元数据，相关残留即使格式合法也不会默认选择，并明确标注为“应用声明标识关联”。
5. macOS Bundle ID 必须通过严格分段语法与长度校验，显示名称也必须是安全的单一路径段；允许根目录收窄到 `~/Applications` 及 `~/Library` 下六类明确子目录。
6. 预览与执行都会把真实 Home、允许根目录和目标转换为 canonical realpath 后再校验 containment；允许根目录本身若为 symlink/junction，或 canonical 后落在真实 Home 外，会拒绝自动处理。Windows 残留根固定为可信 Home 下的 `AppData\\Local`/`Roaming`，不接受环境变量重定向。
7. 目录使用 `opendir` 流式生成递归内容摘要，并限制 50,000 项、64 层、5 秒和同一设备；任一限制触发即不可自动删除。预览后任意深度的新建、删除或元数据变化都会阻止整体处理。
8. 符号链接、根目录、Home 本身、系统目录、共享容器和越界路径均拒绝自动处理。
9. 文件优先进入系统废纸篓/回收站，不使用 `rm -rf` 或等价命令。
10. preload 只暴露 `scanApps`、`inspectApp`、`executePlan`、`revealPath` 四个业务接口及生命周期用的 `shutdown`；扫描异常通过结构化 warning 显示，不伪装成“0 个应用”。
11. macOS 与 Linux 应用枚举共享约 15 秒总预算；每次目录读取、元数据读取和外部解析都只使用剩余预算，超时返回已完成的部分结果及 warning。
12. 用户可写的 `Info.plist` 与 `.desktop` 必须是非符号链接普通文件且不超过 1 MiB；两者都通过文件句柄有界读取并检测读取期变化。macOS `plutil` 只解析已捕获的 stdin 字节，不再按路径二次打开；保留到应用目录中的字段会截断并强制复制，避免短字符串继续引用超大元数据缓冲区。

## 本地开发

```bash
cd ../..
npm install --cache .npm-cache
npm test
```

该目录是系统管家的内部 workspace，不再生成可独立安装的 manifest 或 ZIP。唯一受支持的发布物由根目录构建、统一注入页面权限隔离与 CSP 后生成。

## 已知限制

- 首版不会尝试绕过系统权限或静默提权；需要管理员权限的应用会明确标记为手动卸载。
- 残留发现只采用 Bundle ID、注册表键、desktop/package ID 或完整产品名，不进行可能误删的模糊全盘搜索。
- 为保证预览后目录内容没有悄然变化，会流式读取目录元数据；超出条目数、深度、时限或跨设备边界的目录会安全降级为不可自动处理。
- Windows 注册表卸载命令与 Linux 包管理器声明均不自动执行；请在系统应用管理或对应包管理器中完成主体卸载。
