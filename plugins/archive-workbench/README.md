# 压缩包管家

压缩包管家是一款保守的 ZIP 管理插件。它会预览中央目录中的全部条目，在写入前生成解压预案，创建简单的不压缩存储 ZIP，并且仅在压缩包与目标目录分别获得授权后执行解压。

安全边界会拒绝路径穿越、绝对路径、Windows/UNC 路径、反斜杠、控制字符、Windows 禁止字符与备用数据流冒号、NUL、不支持或加密的条目、使用数据描述符的条目、符号链接、硬链接、设备、FIFO、超大文件、压缩炸弹、Unicode/大小写冲突、Windows 保留名称（包括 Win32 的 `COM¹`–`COM³` 与 `LPT¹`–`LPT³` 别名）以及不安全的上级目录。默认同名策略为 `rename`，绝不会静默覆盖已有文件。

本版本只展示 TAR/TGZ 的规划说明，不会用不完整的安全模型接受它们。界面会先预览 ZIP，再单独选择目标目录，并在解压前要求确认；所有 Node.js 文件系统操作都位于最小能力桥之后。插件会拒绝已存在于检查路径中的符号链接，并在关键写入前复查路径；但纯跨平台 Node.js 无法承诺抵御同一账户进程并发替换目录树，因此不能把它视为恶意多进程沙箱。

运行 `npm test`、`npm run build`，然后运行 `npm run verify-dist`。Windows、macOS、Linux 上的真实 ZTools 压缩包处理仍待真机验证。

## 开发与打包

根目录 `plugin.json` 直接指向 `src/ui/index.html`、`preload/index.cjs` 和 `logo.svg`，因此 ZTools 开发项目无需解释 `development` 覆盖即可加载源码包。仓库持续集成仍执行插件的 `build` 脚本并打包 `dist`：源码入口目录没有嵌套清单，而构建会生成自包含的 `dist/plugin.json`，其入口为 `index.html`、`preload/index.cjs` 和 `logo.svg`。

`npm run verify-dist` 会递归统计未压缩 `dist` 的大小、打印精确字节数，并在超过 14.5 MB（14,500,000 字节）时失败。

## 智能体 / MCP

ZTools 2.4 及以上版本可向智能体暴露 `inspect_approved_zip` 与 `plan_approved_zip`，完整名称分别为 `archive_workbench_inspect_approved_zip` 与 `archive_workbench_plan_approved_zip`。两个工具均为只读：不能选择路径、接受路径/令牌/授权 ID、解压文件、创建压缩包或执行其他写入。用户必须先在插件界面选择 ZIP；智能体只能访问最近一次成功授权的 ZIP，授权五分钟后过期，离开插件时会立即清除。

条目检查与写入预案通过 `offset` 和 `limit` 分页，`limit` 最大为 200。用户界面保留 256 MiB 源文件边界，MCP 检查另设 64 MiB 源文件限制。同一授权的并发检查和规划调用共享一次读取与安全检查；缓存只保存有界条目元数据，不保存 ZIP 字节。后续使用缓存前会重新验证已授权路径、设备、inode、大小、修改时间和状态变更时间（`ctimeMs`），防止原地改写复用过期元数据。响应包含总量、安全限制、分页状态与所选冲突策略，但不会包含绝对路径或授权令牌。`plan_approved_zip` 只描述预期的相对写入，不会选择目标目录或执行预案。

ZTools MCP 传输层接受最大 1 MiB 请求体，但不会强制执行每个工具的 JSON Schema，也不会限制响应。preload 因此会独立拒绝未知字段、路径/令牌形态字段、恶意或自定义原型、访问器、错误类型、无效冲突模式及越界分页，并将序列化响应限制为 128 KiB。没有 `registerTool` 的旧宿主仍可使用完整的人类界面。Windows、macOS、Linux 上的真实压缩包处理仍待真机验证。
