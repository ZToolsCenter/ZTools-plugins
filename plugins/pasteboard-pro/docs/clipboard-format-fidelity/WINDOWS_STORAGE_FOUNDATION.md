# Windows G1 存储基础层与受控探针

版本：v0.29 source foundation；日期：2026-10-28。本文记录 Windows 私有存储基础源和受控探针，不代表完整文件系统适配器、G1 durable store 或 Windows 支持已验收。当前开发者没有 Windows 环境；本机没有执行 Windows SDK 编译、原生运行或真实应用回贴。探针 15 项均为 **NOT-RUN**，独立于 G0 Windows 的 105 项 NOT-RUN。

## 当前基础源

`native/clipboard-storage/windows/` 包含 14 个受控源文件：7 个 `.cpp`、6 个头文件和 `CMakeLists.txt`。它们实现或驱动以下有限检查：

- 仅使用当前未模拟（non-impersonated）进程用户 SID 建立对象；新对象使用受保护 DACL，ACL 严格限制为当前用户和 SYSTEM。
- 通过已打开的句柄检查对象类型、reparse 状态、硬链接计数以及 volume/file ID；文件 flush 前后复核对象身份。
- 用受控的空/null DACL、额外主体、错误对象类型、junction/reparse point 和 hard link 负例验证拒绝行为。
- 探测会记录对目录句柄调用 `FlushFileBuffers` 的结果。API 调用成功只表示本机调用被接受；它不证明目录命名空间已经可靠落盘。
- fixture 使用随机命名的临时目录和固定公开标记字节，不访问系统剪贴板。创建出的 fixture 通过持有的句柄清理；若对象身份或清理无法确认，应记录不完整并保持失败关闭。

`CreateDirectoryW` 与随后按路径重新打开目录不是原子绑定。重开失败或对象身份、类型、ACL验证失败时，代码不应按路径删除可能已被替换的对象；残留对象清理状态须显式报告。该探针也不证明并发路径替换已全面防御。

## 15 项原生探针

| 用例 | 检查内容 |
| --- | --- |
| `private-root-created` | 创建私有临时根目录 |
| `root-owner-dacl-verified` | 校验根目录 owner 与受保护 DACL |
| `private-file-created` | 创建私有 marker 文件 |
| `file-owner-dacl-verified` | 校验文件 owner 与受保护 DACL |
| `file-identity-stable` | 核对 volume/file ID |
| `file-flush-write-handle` | 写入固定 marker，经文件句柄 flush，再读回校验 |
| `mismatched-identity-rejected` | 拒绝不匹配的预期 identity |
| `null-dacl-rejected` | 拒绝 null DACL |
| `empty-dacl-rejected` | 拒绝空 DACL |
| `additional-principal-rejected` | 拒绝未授权的额外主体 |
| `file-kind-mismatch-rejected` | 拒绝文件/目录类型不匹配 |
| `reparse-object-rejected` | 拒绝受控 junction/reparse 对象 |
| `hardlink-object-rejected` | 拒绝链接计数不符的文件 |
| `directory-flush-call-observed` | 记录目录句柄 flush API 的接受或拒绝 |
| `owned-fixture-cleanup` | 核对临时 fixture 清理结果 |

`directory-flush-call-observed` 的 PASS 不提升 `namespaceDurability`：收据固定为 `NOT-VERIFIED`、`productionStorageEnabled=false`、`gateComplete=false`。所有本机用例都还没有 Windows 执行结果。

## 构建与受控运行

从插件根目录，在实际 Windows 机器安装 CMake 3.24+、Visual Studio C++ 工具链与 Windows SDK 后，分别为架构建立干净构建目录。以下命令是待 Windows 实机运行的流程，不是本轮测试结果：

~~~powershell
cmake -S native/clipboard-storage/windows -B artifacts/pasteboardpro/windows-storage-foundation/build-x64 -A x64
cmake --build artifacts/pasteboardpro/windows-storage-foundation/build-x64 --config Release
~~~

ARM64 必须独立构建，例如使用 `-B artifacts/pasteboardpro/windows-storage-foundation/build-arm64 -A ARM64`，不能用 x64 仿真代替 ARM64 原生验收。原生 SDK 编译成功也只证明该工具链能够构建这个基础探针。

对可信本地生成的二进制独立取得 SHA-256 后运行：

~~~powershell
$binary = "artifacts/pasteboardpro/windows-storage-foundation/build-x64/Release/windows-storage-foundation.exe"
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $binary).Hash.ToLowerInvariant()
node scripts/clipboard-storage-g1.mjs --self-test --binary $binary --expected-binary-sha256 $sha
~~~

在 Windows x64/ARM64 的 Windows 10/11 上各自运行。命令只接受 `artifacts/pasteboardpro/windows-storage-foundation/` 下受控相对路径；C++ helper 以 `--self-test` 执行，不接收任意用户路径。Node runner 将单个 helper 进程限制为 20 秒、stdout/stderr 合计 16 KiB，并要求确认进程终止、无 stderr、固定格式报告及退出码一致。它没有 RSS 采样或硬限制；不要让 helper 派生子进程。runner 校验 PE machine 与当前 Node execution architecture 一致，拒绝将 x64 binary 计作 ARM64 原生执行；这不认证物理硬件。helper 在输出前检查并切换 stdout 二进制模式，避免 Windows CRT 把 LF 协议转换为 CRLF。

也可在非 Windows 开发机检查 source inventory 和当前运行环境的描述收据：

~~~sh
node scripts/clipboard-storage-g1.mjs --describe
~~~

`--describe` 返回 `execution: NOT-RUN`，仅证明本机脚本能读取受控源并输出描述信息；它不是 Windows 编译或运行证据。runner 收集到的源 SHA 与二进制 SHA 是观察值，不是可验证的构建来源证明，`sourceToBinaryBinding` 固定为 `UNVERIFIED`。Node 工具契约测试也不能替代 Windows SDK 构建、探针运行或 OS/应用验收。

## 目录同步与启用门禁

现有 snapshot store 在 Windows 仍于创建目录前以 `private-directory-unavailable` 失败关闭。本基础层没有接入 `fs-directory.ts`、blob/journal filesystem 操作或 LMDB 调用，因此没有移除该 guard，也没有将 Windows raw store 打开。

微软文档说明 `FlushFileBuffers` 的文件句柄要求，并介绍目录句柄如何打开；文档没有给出一个可普遍依赖的用户态目录项持久性保证。一次 rename 或目录 flush API 成功都不能单独证明父目录项在掉电后可靠。评估仍需结合文件系统、设备、驱动和掉电恢复实测。[FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)、[打开目录句柄](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory)、[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)。

进入 G1 前至少还需：Windows SDK/MSVC 在实际 Windows 10/11 上编译；x64 与 ARM64 目标的原生构建和收据；目录创建到句柄绑定及路径祖先身份的安全适配；ACL 并发竞态与失败清理验证；具体文件系统、权限/策略和异常重启/掉电矩阵；正式宿主集成与真实应用格式写回验收。Windows 12/后续版本按正式系统及 SDK 单独建立并执行验收门禁。当前代码源 SHA 不绑定二进制；文件 flush 与 `FlushFileBuffers` 对目录的调用观察不构成命名空间持久性保证。因此本增量不产生 `G1 durableReady`，不改变 G0—G4 验收状态。

## 本轮验证与证据

Node 24.15.0 与 Electron 41.4.0 的 Node 模式各通过 20/20 个契约测试：7 项严格报告测试、13 项源清单/受控路径/PE/进程结果/状态测试。全部是合成协议、源码或本机文件工具检查，不执行 Windows CRT/API；macOS 上 CMake 拒绝 Windows 构建是预期平台门禁，不能算 C++ 编译通过。

源收据覆盖 20 个 runner/native 依赖文件；其中 14 个 native 文件包含 7 个 CMake 编译单元。CMake 仅接受登记的固定构建配方，新增 source-bearing 语句必须显式更新 source inventory 与契约；这不认证外部编译器/SDK。两端 describe 与非 Windows self-test 均记录 15 项 NOT-RUN。

独立只读源码复审关闭了两项清理 P2、CRT 换行 P1 和 CMake 清单 P2，未发现新的 P1/P2；reviewer 没有运行测试。根审查另外修复 BOM 与透明 Proxy 输入检查。此前 408 项选定源码、15 个插件产物、2 个 store runtime 文件以及 43 份归档证据均保持原 SHA；v0.28 的全套测试只作为未变基线沿用，没有在本轮重跑。v0.26 journal timing 正文仍不可恢复，本轮不补造也不替代其证明。

本轮[根证据](EVIDENCE_INDEX.md#v029)、[独立复审](EVIDENCE_INDEX.md#v029)、[执行检查](EVIDENCE_INDEX.md#v029)记录具体范围。完整 G0—G4 保持未完成；未提交、推送或发布。
