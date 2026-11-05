# G0 原生探针运行与证据说明
v0.28根证据：[root evidence](EVIDENCE_INDEX.md#v028)；独立源码review：[review](EVIDENCE_INDEX.md#v028)，结论为有限范围APPROVE；完整G0—G4仍未通过。
Windows 10/11 的105项原生cases仍NOT-RUN；v0.27 Windows source kit本轮未改动。Windows 12及后续版本需另行建立G0—G3门禁。
v0.27根证据与文档审计字段：[root evidence](EVIDENCE_INDEX.md#v027)。根收据记录`gateComplete=false`。

v0.26根证据与文档审计字段：[v0.26 root evidence](EVIDENCE_INDEX.md#v026)。最终字段见根收据。


版本：v0.28 history mirror局部改进；日期：2026-10-28。消费者命令仍见v0.27 source kit章节；该包本轮未改，Windows105项仍NOT-RUN。
v0.24 RTF定向矩阵历史结果为Node/Electron各706 PASS/5 child-fixture entry skips；不是本轮运行。Windows105项仍NOT-RUN。


v0.21历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v022)

v0.22历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v023)。

## 工具边界

- macOS 仅使用 UUID 命名的独立 NSPasteboard，禁止系统/general 名称；结束释放该命名 board。
- Windows 仅使用新建、当前用户受限 DACL 的非交互 window station 与独立 desktop；隔离无法建立则失败，不回退 WinSta0。
- 两端不读取个人历史，不模拟用户粘贴键；自测内容由程序内合成。
- 共享V2 schema、bounded Worker和capture-policy gate已实现；v0.20/v0.21有隔离Node-only snapshot-store与metadata-only Consumer Inbox，但native DTO、trusted production owner/current-policy transport、生产V1读写、preload/host与旧同步库没有接入V2。
- v0.13历史Mac materialization baseline：新增owned-byte离线校验边界与7项cases，registry83，Node/Electron各83/83、watchdog2/2、source42、binary SHA ca1f997746f08462865e5f8decd99278172a0692092a0d61e1c98844aa3910a1；旧receipt副本归档于v016-inputs。v0.16当前87-case结果见本页末段。Windows105项仍NOT-RUN。

## 运行前提

从插件根目录执行。使用Node 24；本机验证版本为24.15.0，不依赖全局pnpm。

macOS需要Command Line Tools与AppKit/Foundation/CoreGraphics/ImageIO/UniformTypeIdentifiers SDK。Windows需要Windows客户端、CMake 3.24+、Visual Studio C++工具和Windows SDK；CMake使用MSVC并固定`/utf-8`，链接User32/Advapi32/Gdi32/windowscodecs/ole32/Bcrypt；当前支持的宿主产物基线是x64，ARM64必须单独构建并验收。Windows Server构建机不代替Win10/11客户端交互验收。

```sh
node --test scripts/test-clipboard-format-g0.mjs scripts/test-clipboard-format-windows-receipts.mjs scripts/test-bounded-process.mjs scripts/test-clipboard-format-g0-sources.mjs
node node_modules/vitest/vitest.mjs run packages/core/tests
node node_modules/typescript/bin/tsc -b --pretty false
node scripts/clipboard-format-g0.mjs --self-test
```

只构建、不运行原生探针：

```sh
node scripts/clipboard-format-g0.mjs --build-only
```

构建和运行均有超时及输出上限，不经过shell拼接。原生helper先等待父进程的RUN信号；父进程完成有效RSS观测后才放行。运行时采样内存，超过256MiB观测阈值、监测失败、超时或输出超限会终止helper，并记录是否确认退出。采样不能防止两次观测之间的瞬时峰值，不是内核硬内存上限，也不保证防OOM。构建输出、模块缓存和证据都在插件的 `artifacts/pasteboardpro/clipboard-format-g0/` 中。

如果系统拒绝named-pasteboard服务或创建独立window station，保留失败结果，不改用系统剪贴板。工具不自动提权，不安装系统依赖。

## 收据判定

- `execution: PASS`：当前平台冻结的探针必测case全部真实通过，source/binary SHA-256、构建/自测命令与运行时版本完整。
- `execution: NOT-RUN`：只有构建、平台不可用或必测case仍未运行；不会变成PASS。混合pass/not-run也不能声称整体probe通过。
- `execution: FAIL`：构建、执行、报告契约或已执行case失败。
- `gateComplete: false`：本工具不批准整个G0，不批准目标应用、生产宿主、签名产物或跨平台发布。

Darwin registry仍87项。v0.18 Mac/Electron probes各87/87、source56、binary SHA fdc9f715e48c0fe39a6ba87f6058b9cdc13804f7ff5af6f0b142c5918affac82、watchdog2/2经v0.19 source hash复核未变、未重跑。v0.19 default ingress Node/Electron各5/5、codec ingress各6/6，见[v019 receipts](EVIDENCE_INDEX.md#v019)、[Electron](EVIDENCE_INDEX.md#v019)、[codec Node](EVIDENCE_INDEX.md#v019)、[codec Electron](EVIDENCE_INDEX.md#v019)。Windows registry105项及Win SDK/API仍NOT-RUN；v0.18 receipts归档于[v019-inputs](EVIDENCE_INDEX.md#v019)。

报告字段采用严格白名单；case只输出固定detailCode，unverified只输出受控范围代码。macOS/通用formatSummary仍只含有限格式标识/长度/摘要/编码信息；Windows另用windowsFormatReceipts，成功报告强制7组，并校验16个fixed format keys、bounded planned/readback长度和hash、revisions与代码页上下文，不含原文或二进制。v0.18 Windows CMake63个编译单元、collectG0Sources inventory121；portable target28个编译单元、local include closure53项；native/clipboard-format与codec-tests共174份源码/头文件最大499。该源码检查不替代Windows SDK/API运行。v0.12源码包仍冻结于历史版本，因Windows/common源码变化不是当前源码包。

## v0.14 core V2 capture-policy gate命令与证据

从插件根目录运行：

    node node_modules/vitest/vitest.mjs run packages/core/tests/clipboard-content-policy-v2.test.ts packages/core/tests/clipboard-content-policy-v2-boundaries.test.ts
    node node_modules/vitest/vitest.mjs run packages/core/tests
    ELECTRON_RUN_AS_NODE=1 /Users/harris/Desktop/ZTools/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run packages/core/tests/clipboard-content-policy-v2.test.ts packages/core/tests/clipboard-content-policy-v2-boundaries.test.ts
    node node_modules/typescript/bin/tsc -b --pretty false
    node scripts/test-workspace-contract.mjs

Node24.15.0/Vitest3.2.7 full core 135/135 PASS（84既有+51新增）；Electron41.4.0/Node24.15.0 focused 51/51 PASS；TypeScript5.6.3全workspace typecheck与workspace contract PASS。日志见[root evidence](EVIDENCE_INDEX.md#v014)、[core tests](EVIDENCE_INDEX.md#v014)、[Electron tests](EVIDENCE_INDEX.md#v014)、[typecheck](EVIDENCE_INDEX.md#v014)和[workspace contract](EVIDENCE_INDEX.md#v014)。

这些是core单元/类型/契约检查，不启动native probe，不读取系统剪贴板。v0.14没有重跑原生收据；Mac native83-case/watchdog2-case仍是v0.13基线，Windows105项仍NOT-RUN。gate没有实际scanner和扫描超时/取消，必须由有界worker/helper执行且不能放在UI线程。当前G0仍不完整。

## macOS v0.13 materialization 与离线validation执行边界（历史）

运行命令仍为node scripts/clipboard-format-g0.mjs --self-test；Electron Node模式按本页既有命令单独运行。Darwin报告必须包含83个必测case，且sourceHashes与binary SHA绑定到同一收据。v0.12收据保存在artifacts/pasteboardpro/clipboard-format-g0/v013-inputs/，仅作历史基线。

probe先枚举所有item types并完成读取前策略，然后逐个读取、复制allowlist支持的bytes。每次读取前后及所有候选复制后的final barrier都检查changeCount。barrier前发生变化：报告superseded，不返回items/summary/byteLength，也不启动validator；barrier后发生变化：离线validator/hash仍处理旧owned bytes，返回revision保持captured revision、observedRevision记录之后的board revision，不替代、不拼接新内容。

maxSnapshotBytes统计全部stage的supported candidate raw bytes，包括之后由codec validator拒绝的表示；单个越限长度在额外owned copy前拒绝，但reader/provider可能已分配返回值，这不是硬RSS上限。超过预算在validation前返回over-limit。报告byteLength仅统计validation通过的表示。validator false可产生partial及固定format_validation_failed；validator异常被边界捕获为无payload的failed，不返回异常文本。发布前旧revision仍会阻止清板；写后readback只有仍拥有write revision才可确认，readback期间被外部替换必须为partial-write而非committed。

v0.13历史Node24和Electron41.4均83/83 PASS，AppKit延迟provider watchdog2/2 PASS（providerEntered=true、readCallReturned=false、terminationConfirmed=true）。source inventory42，binary SHA ca1f997746f08462865e5f8decd99278172a0692092a0d61e1c98844aa3910a1；独立review APPROVE、无P1/P2。历史receipt副本见[v016-inputs Node24](EVIDENCE_INDEX.md#v016)、[Electron](EVIDENCE_INDEX.md#v016)和[watchdog](EVIDENCE_INDEX.md#v016)。即使probe通过，仍不证明general monitoring、producer trust、内容扫描、生产host或真实应用回贴。


## Windows v0.11逐格式receipt与ANSI fixture前置条件

运行Windows `--self-test`时，receipt回合先seed Publish并精确Capture；随后冻结Capture返回的完整格式集合（包括系统合成格式），按捕获的source revision Publish，再Capture写回。全部Capture/Publish clipboard sessions关闭后，receipt builder对owned logical bytes使用CNG `BCryptHash`计算SHA-256；serializer只序列化已生成并校验过的摘要。不会使用`GlobalSize`尾部padding，也不会为摘要额外读取剪贴板。摘要是字节证据，不是producer来源证明。receipt实现位于Capture/Publish adapter之外，不改变其行为。

成功Windows报告必须包含独立顶层`windowsFormatReceipts`七组；每组sourceRevision=expectedRevision且所有revision为非零DWORD，write/readback/observed revision相同。revision不排序，允许非零DWORD绕回，0或绑定不一致不生成receipt。每个group最多32 formats，planned总bytes和readback总bytes分别不超过20MiB；只有CF_BITMAP可显式记录`visible-rgb-compatible`差异。其他格式需planned/readback bytes精确一致。报告禁止输出正文、路径、source app、PID、raw format ID、任意格式名和底层错误文本；`sourceOrigin`为unknown。ANSI URL的`urlCodePage`和ANSI HDROP的`validationCodePage`不能混用，helper ACP/OEM只描述运行环境。

ANSI HDROP测试fixture使用单独owned path，保留原Unicode file fixture不变，并使用ASCII叶文件名。运行前必须确认**完整绝对checkout路径前缀能被当前`GetACP()`无损表示**；建议使用可写的ASCII路径。若[WideCharToMultiByte](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte)无法在不替换字符的情况下往返，ANSI case须记为`NOT-RUN`且G0不能判PASS；这只是fixture前置条件，不表示产品只支持ASCII路径。root已核验源码包README明确写出这项前置条件。CNG摘要依据[BCryptHash](https://learn.microsoft.com/en-us/windows/win32/api/bcrypt/nf-bcrypt-bcrypthash)文档；Windows真实API仍需实机验收。
## Windows v0.12 Clipboard API fault plan与资源ownership

`ClipboardNativeApi`包装OpenClipboard、EmptyClipboard、SetClipboardData和CloseClipboard，由每个Windows adapter持有自己的`ClipboardApiFaultPlan`。正常调用无故障时会forward到系统API；测试注入失败发生在native call之前，且分别记录attempt/native-forward计数。因此这些用例检查adapter如何处理故障和资源，不是OS/kernel真的返回该故障的证据。

105项registry中新增15项wrapper case：Publish 12项（Open耗尽、Empty失败、首/中/尾Set、GDI/Palette所有权、整组/部分/持续Close失败、Empty+Close组合、hook reset/recovery），Capture 3项（Open失败清空output、Close失败丢弃捕获、policy deny遇Close failure）。逐项固定ID见[验收矩阵W12](ACCEPTANCE.md)。旧第三参数控制的pre-loop Set-index故障用例保留并单独计数，不把它描述成真实`SetClipboardData`失败。

Publish流程与prepared-format RAII实现已拆分为`clipboard_publish.cpp`和`clipboard_prepared_format.cpp`。私有`noexcept` lifetime observer观测GlobalFree/DeleteObject真实返回：转交给系统的句柄不重复释放，失败或未尝试转交的prepared handle需释放一次。显式Close失败即保守失败，即便析构重试成功也不改变结果；持续双Close失败用例由private window-station fixture直接调用raw CloseClipboard清场，不证明Windows内核/session已清理。真实kernel资源耗尽、权限、session关闭和系统清理仍需Windows10/11运行验收。

## 两端真实延迟读取看护

先运行上面的原生 `--self-test` 生成当前PASS收据，再执行：

```sh
node --test scripts/test-clipboard-native-watchdog.mjs
```

同一测试入口按当前平台选择原生fixture：macOS在独立命名board实际进入`dataForType` provider；Windows在私有window station/desktop由owner线程实际处理`WM_RENDERFORMAT`，reader调用`GetClipboardData`。从provider marker起250ms后终止helper，要求读取尚未返回且确认退出，不能用单纯sleep冒充OS阻塞。线程/站点隔离失败保留失败，不回退系统clipboard。

裸`--delayed-read-fixture`缺少`PBF_G0_SUPERVISED=1`会拒绝；不要手工绕过guard。看护入口先核对当前完整PASS收据与binary/source SHA，保留按hash命名的原始收据，再测实际读取。证据只含固定marker、资源计数、binary/测试SHA，不含正文。v0.9 macOS两项watchdog测试为历史结果；v0.11历史源码下Mac watchdog 2/2 PASS。早期monitor-unavailable guard拒绝记录见[v0.10运行收据](EVIDENCE_INDEX.md#v010)，它不构成case FAIL。Windows源码已接线，SDK/MSVC/WinAPI及真实WM_RENDERFORMAT测试仍NOT-RUN。该fixture不证明general监听、源退出或目标应用通过。

## Electron版本证据

在Electron的Node模式运行同一探针，可以验证该版本进程能启动helper；它不验证已安装ZTools的preload/IPC、内容策略、签名或窗口回贴。收据会记录 `runtime.electron`；普通Node运行时该字段为null。

本机命令使用已核实的Electron41.4.0二进制：

```sh
ELECTRON_RUN_AS_NODE=1 /Users/harris/Desktop/ZTools/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/clipboard-format-g0.mjs --self-test
```

## Windows源码工具包（v0.12历史包；当前已过时）

历史收据：v0.12源码包当时包含132 payload+manifest、133 entries，SHA-256 `5def6a1218b39e6101e1c4d2ad02400c5551b918f5a2f3055c158dd23a2f92aa`；打包worker与root对该归档包fresh-extract后运行Node24.15.0三脚本33/33 PASS。README说明wrapper faults发生在OS API调用前，不能证明kernel resource fault/OS cleanup，并注明ANSI HDROP checkout绝对路径前缀GetACP无损表示前置条件。Windows/common源码此后已变化，因此该ZIP仍是历史包，不能作为当前源码执行或本轮证据。v0.27最终source-only包与producer复核已完成；Windows SDK/API/105项执行仍NOT-RUN，最终包消费者命令见本页v0.27章节。历史ZIP与receipt保留供复现：[ZIP](EVIDENCE_INDEX.md#local-raw-artifact-archive)、[root收据](EVIDENCE_INDEX.md#v012)、[tests](EVIDENCE_INDEX.md#v012)。v0.11包和32/32 fresh-extract收据仅作历史，见[评审记录](REVIEW.md)。

以下命令仅用于复现归档v0.12旧包的历史步骤，不能证明当前checkout源码或当前Windows验收：解压该归档包后从包根目录按其README执行，先report/source JS测试，再`node scripts/clipboard-format-g0.mjs --self-test`，最后`node --test scripts/test-clipboard-native-watchdog.mjs`。本节命令只复现v0.12历史包。当前v0.27最终source kit的消费者步骤见本页末尾；这些步骤可验证归档与portable codec，但不能替代Windows原生验收。任一必测case为NOT-RUN时非0退出，不能将构建成功当完整通过。

v0.9历史portable证据为普通及ASan/UBSan CTest各1/1、binary各244个named checks和35项sourceHashes不变。v0.10至v0.12均未重跑portable binary；这些结果只能作为历史证据，不是本轮收据。普通binary SHA-256：`7b828ba691822d1946cf3a17fe84c6fce2f4fd7fdbe8b33b3c3322310c115b4c`；ASan/UBSan binary SHA-256：`6aa49a09e8048c488d99c2d805b0a49645ba04011cf7f971a4e1f8a27a144da5`。证据只覆盖可移植解析/策略，不代表WIC、Win32或owned-junction真实traversal。

## 后续验收

1. Windows10/11分别构建并运行全部105项native case及WIC/BCrypt/WinAPI矩阵，保留OS edition/build/架构与真实结果；用户目前没有Windows环境，全部NOT-RUN。ANSI HDROP还需满足路径前置条件。
2. Mac完整native probe基线为历史v0.18：Node24/Electron41.4各87/87，source56、binary SHA-256 `fdc9f715e48c0fe39a6ba87f6058b9cdc13804f7ff5af6f0b142c5918affac82`，watchdog2/2。v0.23 root仅复核source/binary hash未变；本轮没有重跑完整Mac native probe、portable/ASan CTest、JS或watchdog。v0.23 targeted native ingress/store/consumer fixtures则单独执行并纳入本轮定向suite，不能将其描述为新的完整native probe；本轮证据入口见[G0剩余清单](G0_REMAINING.md)。仍需trusted producer、完整known-app exclusion、内容隐私、一般监控、真实host，并按该清单完成Windows SDK/WIC、源/目标应用及G1—G4门禁。
3. G0两端完整门禁通过后再接production host；现有G1 Node-only组件仍需owner/平台接线及完整恢复、inbox/cursor、retention/GC验收，G2真实应用和G3六方向同步仍按原scope推进。当前进度见[实施状态](IMPLEMENTATION_STATUS.md)。


## v0.15 bounded scanner运行命令与收据（历史）

从插件根目录执行；以下focused suite不启动系统剪贴板native probe：

```sh
node node_modules/vitest/vitest.mjs run packages/core/tests apps/ztools/tests/content-scanner-v2.test.ts apps/ztools/tests/content-scanner-v2-lifecycle.test.ts
ELECTRON_RUN_AS_NODE=1 /Users/harris/Desktop/ZTools/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run apps/ztools/tests/content-scanner-v2.test.ts apps/ztools/tests/content-scanner-v2-lifecycle.test.ts
node node_modules/typescript/bin/tsc -b --pretty false
node scripts/test-workspace-contract.mjs
```

From `apps/ztools`, build and verify the package:

```sh
node ../../node_modules/vite/bin/vite.js build --config vite.preload.config.ts
node scripts/assemble-dist.mjs
node scripts/verify-package.mjs
```

本轮Node24.15.0 suite 172/172 PASS（core135+scanner37）；Electron41.4.0 Node模式focused 37/37 PASS。workspace typecheck、workspace contract、preload build、assembly 15 files及package contract均PASS。结果见[v015-node-tests.txt](EVIDENCE_INDEX.md#v015)、[v015-electron-tests.txt](EVIDENCE_INDEX.md#v015)、[typecheck](EVIDENCE_INDEX.md#v015)、[workspace contract](EVIDENCE_INDEX.md#v015)、[preload build](EVIDENCE_INDEX.md#v015)、[assembly](EVIDENCE_INDEX.md#v015)、[package contract](EVIDENCE_INDEX.md#v015)及[v015-root-evidence.json](EVIDENCE_INDEX.md#v015)。

v0.15历史packed-worker smoke由当时脚本生成；旧脚本副本见[归档脚本](EVIDENCE_INDEX.md#v016)，v0.15 dist归档于v016-inputs/dist-ztools。原始结果见[Node24](EVIDENCE_INDEX.md#v016)与[Electron41.4 Node模式](EVIDENCE_INDEX.md#v016)均PASS，仅synthetic-text-only，threadExitConfirmed=true、outputBytes=0，worker SHA-256 `e19ec0a632e1e880fbf747dd39bc2dc089dd0ca4a0e7b4eea031ecfbb58bc9ee`；smoke script SHA-256 `a19d2057f53e3d08e57555a77ec7299f02d9e34b0dea6914e77bd6ada9151927`。这不验证installed Electron preload Worker可用性或Windows native路径。terminate未确认时调用持续pending并保持lease；注入Promise拒绝用例随后确认实际线程退出，不构成OS/kernel终止故障证明。


## v0.16 历史收据与工具边界

v0.16历史Mac Node24.15.0与Electron41.4.0/Node24.15.0命名board probe各87/87、AppKit watchdog2/2；binary SHA-256 e9647de8813a211e649da461563a79be48a7fa9394db5628c8257f3aab501941、source inventory46。旧receipt副本见[v017-inputs Node24](EVIDENCE_INDEX.md#v017)、[Electron](EVIDENCE_INDEX.md#v017)及[watchdog](EVIDENCE_INDEX.md#v017)；旧dist见[v017-inputs dist](EVIDENCE_INDEX.md#v017)。v0.13的83-case历史receipt仍归档于v016-inputs，不可混作v0.16收据。

共享RTF validator的普通与ASan/UBSan CTest各1/1、256 named checks；Windows CMake58编译单元、portable exact-source closure39项（含CMake与headers，其中21项为编译单元）、collectG0Sources inventory111。整个native/clipboard-format跨平台、common与codec-tests合计154份源码/头文件最大499行。Windows105项仍全部NOT-RUN；冻结的v0.12 Windows source kit保持历史原件。v0.27最终source-only包与producer/交付复核已完成，运行方式见本页v0.27节；Windows105项原生执行仍NOT-RUN。

当前扫描suite：Node24.15.0 211/211（core135+v0.15 scanner37+HTML36+budget3）；Electron41.4.0 Node模式focused76/76。JS44/44、typecheck与workspace contract PASS。打包assembly16 files、package contract PASS；新增HTML_PARSER_NOTICES.txt入包。Node与Electron Node模式packed-worker smoke各5/5，覆盖plaintext-secret、HTML split token、普通HTML、外部img和CSS image。线程退出与stdout/stderr end/close均确认、output0、externalRequests0；worker SHA-256 7ce9a649706eb18110de7542a5d30e4dad6a56cede0e7a7bd99c182b26895ad2。smoke不代表production host或installed preload验收。

v0.15的[dist-ztools归档](EVIDENCE_INDEX.md#v016)只作旧包输入；v0.16 dist已归档于[v017-inputs](EVIDENCE_INDEX.md#v017)。parse5 ParserOptions官方参考：[parse5.js.org](https://parse5.js.org/interfaces/parse5.ParserOptions.html)。v0.16仅验证Node24.15.0与Electron41.4 Node模式，不据此宣称Node18兼容。v0.17没有production listener/host/storage/publish/sync接线，整体gateComplete=false。

## v0.17 capture-wire receipts与范围（历史）

共享frame为20-byte magic+length prefix；metadata最多1 MiB、raw最多200 MiB、rows1..1024，最多32个item（itemIndex 0..31），每item最多32个表示。Node strict parser要求canonical UTF-8 JSON并拒绝duplicate keys；名称非空且无C0/C1控制字符，名称与policy revision各限512 UTF-8 bytes，policy revision须trim后非空，request限128 ASCII identifier。request/platform/policy绑定；expected=captured，observed独立，owned copy与raw SHA绑定，并保留完整unavailable inventory。缺decoder的Windows ANSI/OEM/CF_HTML与Mac BOM-less UTF-16不伪装支持；不从MIME或内容猜格式，RTF仍not-scanned。

v0.17历史Node/Electron default ingress各5/5；对应receipt及v17源码/dist/docs快照归档于[v018-inputs](EVIDENCE_INDEX.md#v018)。v17 Mac binary SHA-256 4680a3907ef65ecf74c57b8b5e601f6669465159507661bdb7aac06851722849/source52仅作历史值。
Mac UTF-16 framing不根据尾部00 00猜NUL terminator；内容含NUL时保守not-scanned，真实Worker反例与回归2/2通过。Node275/275、Electron41.4 Node模式140/140；Mac Node/Electron ingress receipts各5/5，source52与binary SHA-256 4680a3907ef65ecf74c57b8b5e601f6669465159507661bdb7aac06851722849，均为v0.17历史值。packaged worker smoke Node与Electron各5/5的历史结果记录于[v0.17实施状态快照](EVIDENCE_INDEX.md#v018)；当时脚本见上方归档脚本。上述均为fixture/package证据，不是生产host、IPC、存储或应用验收。Windows105项NOT-RUN，G0未通过且G1—G4完整范围保持不变。

v0.17的命令与package smoke属于历史快照；当时脚本副本见[归档脚本](EVIDENCE_INDEX.md#v018)，不要用当前脚本生成v0.17收据。v0.18 Node/Electron package smoke收据与当前结果见下节。Windows实际native运行仍为NOT-RUN。

## v0.18 codec与CF_HTML receipts（历史）

V2 codec evidence字段见[Native capture wire v2](NATIVE_CAPTURE_WIRE_V2.md)。Mac analyzer的UTF-16证据绑定同item owned UTF-8原件，核对BOM/order/nullTerm/exact/NFC；codepage为helper上下文，不证明producer编码。default ingress receipts两runtime各5/5；native analyzer ingress各6/6（3 positive、3 supervision-negative）：[Node default](EVIDENCE_INDEX.md#v018)、[Electron default](EVIDENCE_INDEX.md#v018)、[Node codec](EVIDENCE_INDEX.md#v018)、[Electron codec](EVIDENCE_INDEX.md#v018)。Mac与Electron G0 native probe各87/87、source56、binary SHA-256 fdc9f715e48c0fe39a6ba87f6058b9cdc13804f7ff5af6f0b142c5918affac82；[Mac G0](EVIDENCE_INDEX.md#local-raw-artifact-archive)、[Electron G0](EVIDENCE_INDEX.md#local-raw-artifact-archive)。AppKit watchdog2/2。

v0.18 Node/Electron suite339/204、Mac probes各87/87、portable357、JS44和package smoke8/8仍为历史结果；源码、receipts、dist/docs归档于[v019-inputs](EVIDENCE_INDEX.md#v019)及[旧runbook](EVIDENCE_INDEX.md#v019)。parse5/entities仅在Node24/Electron41 Node模式验证，不构成Node18支持证据。

## v0.19 RTF Worker证据（历史）

详见[RTF_PRIVACY_PROJECTION.md](RTF_PRIVACY_PROJECTION.md)。AppKit固定342-byte fixture由root clang与worker Swift独立生成且逐字节一致，含unsigned u35797；收据环境darwin27.0/build26A428/arm64/SDK27.0，不外推其他系统，且不读取general clipboard：[fixture](EVIDENCE_INDEX.md#v019)。

Node458/458、Electron Node模式323/323；package smoke各11/11，0网络/0输出，worker exit及stdout/stderr close确认。root/app typecheck、workspace contract、renderer/preload、assembly15与package contract PASS。UPR ANSI-u有修复后双分支回归，special destination font与annotation auxiliary group有独立red/green日志；见[special destination](EVIDENCE_INDEX.md#v019)与[annotation](EVIDENCE_INDEX.md#v019)。

v0.18 Mac/portable/JS数据仅经source hash确认未变、未重跑。Windows105项NOT-RUN；production listener/host/storage/publish/sync及应用验收未完成。


## v0.20 Node-only G1 store组件运行入口（历史基线）

完整API、写入顺序、限制和待验收项见[G1_DURABLE_STORE.md](G1_DURABLE_STORE.md)。以下命令运行隔离store包/测试，不启动系统剪贴板native probe，也不代表生产host验收。固定LMDB依赖为3.4.4。

~~~sh
node packages/snapshot-store/scripts/build-runtime.mjs
node packages/snapshot-store/scripts/test-runtime.mjs
ELECTRON_RUN_AS_NODE=1 /Users/harris/Desktop/ZTools/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron packages/snapshot-store/scripts/test-runtime.mjs
node node_modules/vitest/vitest.mjs run packages/snapshot-store/tests
~~~

root/app typecheck、workspace contract、package contract、G1 runtime build均PASS；Node与Electron bounded package-import/LMDB close-reopen smoke均PASS。 针对性bootstrap8、root-GC6、outcome integrity3及retention/replay/future-event/reservation回归通过；prefix Unicode与reverse-capture-attempt修复包含在store96项，unsupported delete fail-closed。完整retention/GC仍未验收。

本轮Node/Electron格式与存储定向回归PASS，完整计数见[实施状态](IMPLEMENTATION_STATUS.md)；日志：[Node](EVIDENCE_INDEX.md#v020)、[Electron](EVIDENCE_INDEX.md#v020)。旧Electron中间红日志仅作过程记录；测试侧scanner handshake修复未修改生产scanner，Electron exact-double-send回归30/30。SIGKILL只能证明进程崩溃路径，不代表断电或硬件持久性。Windows在创建目录前返回private-directory-unavailable。

## v0.21 Consumer Inbox证据入口（历史）

Consumer Inbox接口、cursor/ACK语义、租约、prune guard、恢复校验和当前实现性能边界见[G1_CONSUMER_INBOX.md](G1_CONSUMER_INBOX.md)。已经生成的定向收据：

- 每runtime有2个AppKit synthetic native-to-consumer案例；JSON收据仅对应这2项：Node [consumer receipt](EVIDENCE_INDEX.md#v021)、Electron [consumer receipt](EVIDENCE_INDEX.md#v021)。与此前3项native-to-store案例合计5/5，见[Node aggregate log](EVIDENCE_INDEX.md#v021)、[Electron aggregate log](EVIDENCE_INDEX.md#v021)。
- runtime package import后完成LMDB commit、close/reopen、lease和ack：[Node smoke](EVIDENCE_INDEX.md#v021)、[Electron smoke](EVIDENCE_INDEX.md#v021)。
- root/app类型检查日志：[root](EVIDENCE_INDEX.md#v021)、[app](EVIDENCE_INDEX.md#v021)。

以上均为隔离Node/Electron Node模式证据；不读取general clipboard、不运行生产host或Windows native。

## v0.22 逻辑删除证据入口（历史）

- 删除契约与store API：[G1_DELETION.md](G1_DELETION.md)、[snapshot-store.ts](../../packages/snapshot-store/src/snapshot-store.ts)、[tombstone schema](../../packages/core/src/clipboard-tombstone-v2.ts)。
- Node/Electron格式与存储定向矩阵（各609 PASS、4个fixture入口skip）：[Node](EVIDENCE_INDEX.md#v022)、[Electron](EVIDENCE_INDEX.md#v022)。
- Bounded package import/reopen/delete/ACK/replay smoke：[Node](EVIDENCE_INDEX.md#v022)、[Electron](EVIDENCE_INDEX.md#v022)。typecheck、app typecheck、workspace/package contract与runtime build收据见同目录`v022-*`文件。
- 当前宿主只读源码边界核对：[source audit receipt](EVIDENCE_INDEX.md#v022)。它不证明installed host/runtime。

以上是Node/Electron本地LMDB与synthetic fixture证据，不运行生产host、general clipboard、Windows native或真实目标应用。

## v0.23 durable ACK与payload lifecycle历史证据

- Payload lease/reclamation Node tests：lease 6/6与reclamation 10/10，focused合计16/16。基础运行日志记录lease6+reclamation8：[base](EVIDENCE_INDEX.md#v023)；包含新增missing/corrupt rollback cases的最新reclamation日志：[10/10](EVIDENCE_INDEX.md#v023)。
- 实际旧v0.22 journal迁移 + ACK proof Node 8/8：[accepted log](EVIDENCE_INDEX.md#v023)；测试依赖上下文：[receipt](EVIDENCE_INDEX.md#v023)。
- 三项process recovery/read-vs-unlink场景已纳入verified suite；Node/Electron全套定向日志：[Node](EVIDENCE_INDEX.md#v023)、[Electron](EVIDENCE_INDEX.md#v023)。

Root/app typecheck、workspace/package contract、runtime build与package import smoke均PASS，细节见[G1_RECLAMATION.md](G1_RECLAMATION.md)。以上都是Node/local LMDB及定向矩阵证据；installed host、production ownership/policy/target授权、Windows和用户剪贴板验收未证明。


## v0.24 RTF投影最终运行收据

Node24.15.0定向suite独立最终重跑706 PASS/5 intentional fixture-entry skip：[Node log](EVIDENCE_INDEX.md#v024)。Electron41.4 Node模式706/5使用已通过initial run的逐字日志副本，非重跑：[Electron log](EVIDENCE_INDEX.md#v024)。两目标RTF files 53/53通过：[focused tests](EVIDENCE_INDEX.md#v024)。两端packaged Worker smoke各17/17、0 network requests、0 stdout/stderr，确认真实thread exit及stdio end/close：[Node](EVIDENCE_INDEX.md#v024)、[Electron](EVIDENCE_INDEX.md#v024)。

root/app typecheck、workspace contract、renderer/preload build、assembly、package contract均PASS；日志分别见[root typecheck](EVIDENCE_INDEX.md#v024)、[app typecheck](EVIDENCE_INDEX.md#v024)、[workspace](EVIDENCE_INDEX.md#v024)、[renderer](EVIDENCE_INDEX.md#v024)、[preload](EVIDENCE_INDEX.md#v024)、[assembly](EVIDENCE_INDEX.md#v024)、[package contract](EVIDENCE_INDEX.md#v024)。Renderer/preload本轮重建；package15 files，7 paths新增/变化、3旧chunk名替换。snapshot-store runtime/native sources/binary仍为旧hash基线，Mac G0/portable/ASan/JS/watchdog未重跑。

initial Node有一个10k queue case超既有5秒测试deadline（6461ms）；source与deadline未改，最终Node独立重跑通过：[initial诊断](EVIDENCE_INDEX.md#v024)。12.34s/24.12s是suite进程耗时，不是生产性能/p95。独立source review有限APPROVE但reviewer未跑tests。固定synthetic输入不读取个人general clipboard；Windows105、production host/current-policy/target app和G0—G4仍需分别验收。

## v0.25 V1 数据库确认检查

v0.25 在现有 window.ztools.db.promises 接口外增加 checked adapter。使用锁定的 Node 24 环境，从插件工作区运行定向 DB 测试：

    node node_modules/vitest/vitest.mjs run apps/ztools/tests/clipboard-document-database.test.ts apps/ztools/tests/clipboard-write-confirmation.test.ts apps/ztools/tests/plugin-data-migration.test.ts

打包 preload harness 运行当前 assembly 包，使用 synthetic SDK/剪贴板和隔离 VM。文件读写限定在owned fixture目录；仅允许对其祖先执行只读lstat元数据探测，并阻断网络、子进程与剪贴板写。Node/Electron结果不代表Windows或Linux原生验收：

    node scripts/test-preload-database-package.mjs artifacts/pasteboardpro/clipboard-format-g0/v025-preload-package-tests/node-manual.json
    ELECTRON_RUN_AS_NODE=1 /Users/harris/Desktop/ZTools/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/test-preload-database-package.mjs artifacts/pasteboardpro/clipboard-format-g0/v025-preload-package-tests/electron-manual.json

全工作区矩阵使用有界 worker 并发运行：

    PAYLOAD_PROCESS_RUN_PHASE=v025-root-verified node node_modules/vitest/vitest.mjs run --maxWorkers=4
    PAYLOAD_PROCESS_RUN_PHASE=v025-root-verified ELECTRON_RUN_AS_NODE=1 /Users/harris/Desktop/ZTools/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --maxWorkers=4

记录实际runtime、命令退出状态、pass/skip数量与日志SHA。迁移路径加固后的Node/Electron结果相同：138 passed files/5 skipped files、1246 PASS/6 skips；[Node日志](EVIDENCE_INDEX.md#v025)、[Electron日志](EVIDENCE_INDEX.md#v025)。6 skips由5个child-fixture entry skip和1个opt-in macOS application-catalog smoke组成。最终package scanner smoke两端17/17，打包preload synthetic SDK cases两端6/6；bounded exit receipts见[v025 process receipts](EVIDENCE_INDEX.md#v025)。最终根收据与文档审计字段见本页开头链接；不得将VM矩阵等同于installed host或Windows验收。

迁移测试核对附件复制摘要、已返回记录路径重写，以及宿主枚举被模拟为空时旧文件仍保留。最后一项展示的是宿主边界，不是“完整迁移成功”。宿主 allDocs 错误折叠为 []、get错误折叠为null仍不可区分，详见[V1数据库确认](LEGACY_DATABASE_CONFIRMATION.md)。


## v0.26 历史图片入库定向验证

在插件工作区以Node 24运行当前四个定向文件：

    node node_modules/vitest/vitest.mjs run apps/ztools/tests/history-image-admission.test.ts apps/ztools/tests/mirrored-image-admission.test.ts apps/ztools/tests/sync-blob-read.test.ts apps/ztools/tests/sync-blob-files.test.ts

打包smoke必须先使用当前assemble产物，再分别从Node与Electron Node模式执行；固定CJS图、运行时版本、scenario集合与输出收据：

    node scripts/test-preload-image-package.mjs artifacts/pasteboardpro/clipboard-format-g0/v026-image-package-tests/node-final.json
    ELECTRON_RUN_AS_NODE=1 /Users/harris/Desktop/ZTools/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/test-preload-image-package.mjs artifacts/pasteboardpro/clipboard-format-g0/v026-image-package-tests/electron-final.json

修复前red收据绑定v0.25实际打包preload，不能替代当前CJS图的green smoke。blob writer新增root/全部现存祖先/digest-prefix symlink red cases，并在关键写入边界复核目录链、realpath与identity；source review确认P1修复，定向sync/blob日志23/23见[green receipt](EVIDENCE_INDEX.md#v026)。两个harness P2已修复并分别获reviewer APPROVE：对`node:` builtin实行显式allowlist；`record-error`断言固定sync-error event detail并扫描所有events/console的sentinels。Node与Electron全workspace均1279 PASS/6 skips（142 passed files/5 skipped files）；scanner、base preload、image smoke各17/6/10项两端均通过，7项build/types/contracts通过。全suite日志与package收据见[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)、[process receipts](EVIDENCE_INDEX.md#v026)和本轮root capsule。6个bounded process全部exit0、signal null、stdio为空且确认终止。VM/synthetic SDK不表示真实宿主/general clipboard或Windows API通过。文件读取采用Node公开fs接口的句柄、bigint stat与平台条件flags；100 MiB只是JS输入预算而非RSS/时间硬限额；参考[Node 24.15 fs API](https://nodejs.org/download/release/v24.15.0/docs/api/fs.html)。


## v0.27 Windows source kit 消费者检查
最终source-only归档：[ZIP](EVIDENCE_INDEX.md#v027)。归档内README给出下列命令；请在解压副本中运行。manifest verifier只确认列出的bytes与manifest相符，不是签名、Windows build或G0 approval。

```powershell
npm run verify:source-kit
npm run test:contracts
npm run configure:portable-codec
npm run build:portable-codec
npm run test:portable-codec
npm run configure:windows:x64
npm run configure:windows:arm64
cmake --build build/windows-x64 --config Release
cmake --build build/windows-arm64 --config Release
npm run g0:build-only
npm run g0:self-test
```

Node24 producer suite 8/8见[日志](EVIDENCE_INDEX.md#v027)；final ZIP/manifest/clean extract与tamper复核见[artifact delivery report](EVIDENCE_INDEX.md#v027)。44/44纯Node合同和portable CTest 1/1为哈希继承，不是final package上的本轮重跑。
README包预算为单文件≤4 MiB、总payload≤32 MiB、ZIP≤64 MiB、最多512 entries、路径名≤1024 UTF-8 bytes。Windows x64/ARM64须分开配置和构建；真实Windows环境分别验证，使用Node24.15、CMake3.24+、Visual Studio C++ workload、Windows SDK和支持-A的VS generator（不用Ninja）。g0:build-only结果仍是NOT-RUN。只在受控Windows运行self-test；private window station无法建立时记录NOT-RUN/失败，不退回WinSta0、不提权。完整路径符合Windows ACP是ANSI fixture要求，不是产品路径限制。

本轮没有Windows native build或执行；105 native cases与完整G0—G4均未验收。

## v0.28 history mirror错误路径说明（局部实现与验证）

当前只隔离隐私允许、可识别的图片持久化错误；累计16次后不再处理后续图片I/O，仍继续健康非图片。最终固定错误阻止cursor前进，之前已写record保留并可在下轮按fingerprint去重重试。通知为best-effort，测试只证明dispatch尝试和原错误保留，不证明subscriber delivery或可靠重发。

旧v0.27 CJS archive red基线Node/Electron各7项为5 FAIL/2 PASS，仅描述旧包。journal helper首轮5-case red为2 FAIL/3 PASS；marker修复前10-case red为4 FAIL/6 PASS。最终journal+polling target 25/25通过，250ms观察窗与20s/27s deadline未变。独立source review有限范围APPROVE，reviewer未执行测试。

Node/Electron全工作区最终均144 passed files/5 skipped files、1298 PASS/6 skips（20.28s/20.91s）；两端scanner/preload/image/isolation各17/6/10/7项及6项build/types/contracts通过，8个bounded processes均正常退出、输出为空且确认终止。15个package输出仅dist/ztools/preload.js变化；renderer和2个snapshot runtime未重建。日志见[Node](EVIDENCE_INDEX.md#v028)、[Electron](EVIDENCE_INDEX.md#v028)；根证据与source review链接见本文开头。

v0.26一份Node journal timing原始JSON正文不可恢复，恢复的benchmark保持原SHA；新v0.28结果不得替代v0.26证明，见[incident report](EVIDENCE_INDEX.md#v028)。本轮没有Windows native build/execute；Windows105项、真实应用矩阵及完整G0—G4仍未验收。
