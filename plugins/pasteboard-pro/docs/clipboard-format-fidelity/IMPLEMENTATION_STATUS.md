# 格式保真实施状态

v0.32 当前增量：[精确清理身份与回灌抑制](HISTORY_CLEAR_BOUNDARY.md)。按用户限制，本轮源码、测试、构建、文档及验证输出均限定在 Paste 插件目录；宿主接线仅保留设计参考。最终收据见[v0.32 根证据](validation/v032/v032-root-evidence.json)。

v0.31 历史设计阶段仅补充[宿主接线](HOST_V2_INTEGRATION_CONTRACT.md)与[V2 计划/portable 契约](V2_PLANNER_PORTABLE_CONTRACT.md)设计候选，均 NOT-IMPLEMENTED。v0.30 实现和执行证据保持原样，完整 G0—G4 未通过。


v0.30 历史实现增量：[图片重试轮转与清空串行化](HISTORY_IMAGE_RETRY_ROTATION.md)；[根证据](EVIDENCE_INDEX.md#v030)；[独立审查](EVIDENCE_INDEX.md#v030)。Node/Electron Node 模式各 91/91 相关回归通过；实际 CJS 合成 SDK 两端红绿证明缺陷修复。完整 G0—G4 未通过。


v0.29 历史增量：[Windows 存储基础层](WINDOWS_STORAGE_FOUNDATION.md)；[根证据](EVIDENCE_INDEX.md#v029)；[独立复审](EVIDENCE_INDEX.md#v029)。Node/Electron Node 模式各 20/20 契约通过；Windows SDK 编译、15 项新基础探针和既有 105 项 G0 原生用例均 NOT-RUN，完整 G0—G4 仍未通过。

v0.28历史根证据：[root evidence](EVIDENCE_INDEX.md#v028)；独立源码review：[review](EVIDENCE_INDEX.md#v028)，结论为有限范围APPROVE；完整G0—G4仍未通过。
Windows 10/11 的105项原生cases仍NOT-RUN；v0.27 Windows source kit本轮未改动。Windows 12及后续版本需另行建立G0—G3门禁。
v0.27根证据与文档审计字段：[root evidence](EVIDENCE_INDEX.md#v027)。根收据记录`gateComplete=false`。

v0.25历史根证据：[root capsule](EVIDENCE_INDEX.md#v025)。下方标注v0.25的1246/6矩阵与package smoke属于历史基线，不作为v0.26图片入库验收结果。
v0.26根证据与文档审计字段：[v0.26 root evidence](EVIDENCE_INDEX.md#v026)。
v0.25实施记录：[V1 数据库写入确认与迁移边界](LEGACY_DATABASE_CONFIRMATION.md)。


版本：v0.32 V1 精确清理身份与回灌抑制；日期：2026-10-28。仅插件目录内实现与验证，完整 G0—G4 仍未完成。
当前实现包含 v0.25 的 V1 写入确认、native allDocs 参数适配、preload/store 职责拆分与旧附件备份保护；本轮 v0.26 新增历史图片缺路径/读写失败时不推进 cursor、源与副本摘要确认、损坏缓存修复及目录链保护。45项 bridge 接口和窗口角色保留，宿主枚举完整性仍未验证。逐项实现及局限见[数据库确认说明](LEGACY_DATABASE_CONFIRMATION.md)。
完整 G0—G4 未完成。Windows 10/11 105 项原生 case 仍 NOT-RUN；用户确认当前没有 Windows 环境。macOS 完整原生矩阵、真实 ZTools 宿主/general clipboard、trusted source/current policy、真实目标应用回贴、V2 target intent/CAS 与生产同步链路仍需独立证据。v0.24 RTF 证据保留为历史记录。


v0.21历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v022)

v0.22历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v023)。

## 已有实现与当前证据

| 交付物 | 当前证据 | 结论与范围 |
| --- | --- | --- |
| core V2 snapshot/schema | packages/core/src/clipboard-snapshot-v2.ts 及对应 tests | strict 字段、ready 完整性、source/item 模型、文件引用不改写、coverage/state 约束已实现；v0.20/v0.21隔离store组件验证这些契约，未接production。 |
| core 计划/结果/journal 契约 | packages/core/src/clipboard-publish-v2.ts 及对应 tests | 冻结计划、部分/未确认写、受控 outcome、64位序号、连续分页/head 边界已实现；这些文件本身定义契约，实际局部journal见v0.20 store，未接production。 |
| Node-only durable store基础组件（v0.20起） | packages/snapshot-store；LMDB 3.4.4 + content-addressed blob files | owned bytes、policy scan、manifest/receipt/journal、consumer inbox、v0.22 tombstone、v0.23 schema3/ACK/pin/逐revision payload expiry。生产host/preload仍未接线；详见[G1_DURABLE_STORE.md](G1_DURABLE_STORE.md)及[G1_RECLAMATION.md](G1_RECLAMATION.md)。 |
| v0.20 native-to-store synthetic integration（历史基线） | Mac AppKit owned fixture → actual Worker/core gate → actual store → close/reopen | v0.20 Node与Electron Node模式各3项PASS。v0.21每runtime新增2项native-to-consumer案例，与此前3项native-to-store案例合计5项；总数由[Node 5/5集成日志](EVIDENCE_INDEX.md#v021)、[Electron 5/5集成日志](EVIDENCE_INDEX.md#v021)支持，JSON收据只对应新增2项：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。均不读取个人general clipboard或证明生产listener/真实应用。 |
| V2 capture-policy gate（v0.14历史） | packages/core/src/clipboard-content-policy-v2.ts、clipboard-content-policy-v2-types.ts、clipboard-content-policy-bytes.ts及51项新增测试 | 内存admission与strict receipt契约；不是生产host映射、存储或capture接线。v0.16扫描器和v0.17 fixture-only ingress见下行。 |
| v0.15 bounded text/URL scanner与Worker生命周期（历史） | apps/ztools/preload/content-scanner-v2.ts及其contracts、worker session、worker与rules | 当时范围仅为显式明文/URL与Node Worker生命周期。v0.16保留此前能力并增加HTML/CSS静态投影；历史收据见v015-root-evidence。 |
| v0.16 HTML/CSS静态投影与预算 | apps/ztools/preload/content-html-projector.ts、content-css-projector.ts及现有Node Worker | 锁定parse5 8.0.1/entities 8.1.0；typed AST文本、属性、entity/percent与CSS URL metadata静态扫描，raw10MiB、projection10Mi scalar、10000 nodes、depth128。unsupported构造保守incomplete/not-scanned，命中仍整次拒绝；不执行、不联网、不OCR。 |
| v0.16打包Worker smoke（历史） | Node24与Electron41.4 Node模式各5/5，worker SHA 7ce9a649706eb18110de7542a5d30e4dad6a56cede0e7a7bd99c182b26895ad2 | HTML_PARSER_NOTICES.txt入包；当时assembly16 files。不是production host或installed preload验收。v0.17打包结果见本页末段。 |
| v0.17 core/scanner/native-wire回归（历史） | Node24.15.0全套275/275（17 files）；Electron41.4.0 Node模式140/140（8 files）。 | v0.18更完整回归见下行；v0.17 receipts与文档快照已归档至v018-inputs。 |
| v0.18 codec/CF_HTML/native-wire回归（历史） | Node339/339；Electron Node模式204/204。 | v0.18源码、receipt与文档快照归档于[v019-inputs/docs](EVIDENCE_INDEX.md#v019)，root evidence见[v018 capsule](EVIDENCE_INDEX.md#v019)。 |
| v0.18工作区类型与契约（历史） | root typecheck与app vue-tsc通过 | 历史日志归档于v019-inputs；v0.19以后各轮typecheck分别见其版本记录 | 不证明生产native或应用行为。 |
| v0.18 G0报告、源码收据与看护测试（历史） | JS44/44 | 仅source hash确认基线未变，未在后续轮次重跑 | 只覆盖report/source/receipt/bounded fixture路径；Windows105项仍NOT-RUN。 |
| v0.18 macOS命名 board与capture-wire ingress（历史） | Mac/Electron native probes各87/87、source56、binary SHA-256 fdc9f715e48c0fe39a6ba87f6058b9cdc13804f7ff5af6f0b142c5918affac82。 | v0.19仅以source hash复核未变、未重跑；v0.18 receipts见[v019-inputs](EVIDENCE_INDEX.md#v019)。 |
| macOS采集源码 | ClipboardOwnedCapture与shared nativeCodec evidence fields | v0.18记录真实encoding/materialization/validationCodePage/UTF-16证据；UTF16 bytes保留原样，source/producer编码不由helper codepage推断。仅fixture，不是production capture。 |
| v0.18 Electron41.4 Node模式（历史） | Node suite204/204、native probe87/87。 | v0.19 Electron Node模式323/323另见本轮日志。 |
| v0.18看护与打包验证（历史） | watchdog2/2；Node/Electron package smoke各8/8 | 线程及stdio end/close、0 output、0 externalRequests；assembly15 files和package/workspace contract PASS | v0.18历史结果见v019-inputs/docs/IMPLEMENTATION_STATUS.md，不是production host验收。 |
| v0.17 AppKit阻塞读取（历史） | [archived watchdog](EVIDENCE_INDEX.md#v018) | v0.17 watchdog2/2，仅命名board延迟provider fixture与guard。 |
| v0.19 RTF privacy projection | [RTF_PRIVACY_PROJECTION.md](RTF_PRIVACY_PROJECTION.md) | Worker60、tokenizer8、charset43、projection-budget8；342-byte AppKit fixture相等；未建模语义保留not-scanned。 |
| Windows 原生源码 | `native/clipboard-format/windows/` | 固定case registry 105项（原90+15 API fault cases）；全部Windows SDK/MSVC/WinAPI/BCrypt KAT/WIC运行仍NOT-RUN。 |
| Windows逐格式receipt | `clipboard_format_receipts.*`、`clipboard_format_receipt_tests.*`、`clipboard-format-g0-windows-receipts.mjs` | v0.11的`windowsFormatReceipts`七组/16 key与9项receipt case保留；Capture/Publish adapter仍不变，WinSDK/BCrypt/WIC与实际回合NOT-RUN。 |
| Windows API fault plan/资源生命周期 | `clipboard_native_api.*`、`clipboard_api_*_fault_tests.*`、`clipboard_publish.cpp`、`clipboard_prepared_format.cpp` | 新增12项Publish+3项Capture case。私有wrapper在调用前注入故障，attempt/native-forward计数分开；无故障时forward系统API。RAII按所有权释放，Close失败保守未确认；独立静态review APPROVE。所有Windows测试NOT-RUN，且不构成kernel failure/resource cleanup证明。 |
| Windows源码闭包 | v0.18经v0.19 root source hashes复核未变 | Windows CMake63编译单元、collectG0Sources inventory121；portable CMake28编译单元/local include closure53；native/clipboard-format含各平台、common及codec-tests合计174份源码/头文件，最大499行 | Windows运行仍NOT-RUN；数据不替代Win10/11 SDK/API验收。 |
| v0.18共用解析器、RTF framing、capture wire与CF_HTML（历史） | normal/ASan CTest各357 checks；当时RTF只有framing。 | v0.19新增Worker RTF projection；v0.18 CTest仅经source hash确认未变、未重跑。 |

v0.12历史Mac：Node24.15.0与Electron41.4.0/Node24.15.0各76/76、watchdog2/2；source inventory36，binary SHA-256 f43139fe5855837ad1178df4b6d3e1ce4f9e0b9bc6d60405a6c0c31969ad17e0。收据副本见[Node24](EVIDENCE_INDEX.md#v013)、[Electron](EVIDENCE_INDEX.md#v013)和[watchdog](EVIDENCE_INDEX.md#v013)。

## v0.13 Mac owned-snapshot materialization 边界（历史）

v0.13历史Mac：Darwin registry83项、Node24与Electron41.4各83/83、watchdog2/2、source inventory42及binary SHA ca1f997746f08462865e5f8decd99278172a0692092a0d61e1c98844aa3910a1。收据副本见[Node24](EVIDENCE_INDEX.md#v016)、[Electron](EVIDENCE_INDEX.md#v016)和[watchdog](EVIDENCE_INDEX.md#v016)；review记录见[v013-root-evidence.json](EVIDENCE_INDEX.md#v013)。

ClipboardCapture.mm完成格式枚举、普通数据读取、owned copy及最终changeCount barrier后，才调用ClipboardOwnedCapture.mm做codec validation和摘要生成。验证模块只接收已拥有的NSData，没有pasteboard参数或读板操作。barrier前revision变化返回superseded且无payload；barrier后revision变化保留captured bytes和旧revision，另报返回时observedRevision，不拼接新复制的内容。

stage到的所有候选raw bytes在验证前累计到maxSnapshotBytes，其中即使之后被validator拒绝也计入上限；超限会在额外owned copy前按reader提供的长度拒绝，避免第二份过限拷贝。原生reader可能已分配其返回bytes，因此这不构成限制原始provider分配的硬内存上限。对外byteLength只统计通过validation的representation。validation返回false保留其他有效representation并将结果置为partial，无效表示带format_validation_failed；validator抛异常则捕获为无payload的失败，不暴露异常文本。Publisher代码保持原来的pre-write expectedRevision拒绝与post-readback stillOwned确认。

七个Darwin固定case已加入registry，形成83项；Node24与Electron41.4均83/83 PASS，AppKit watchdog 2/2 PASS，JS44/44 PASS。source inventory42，binary SHA-256 ca1f997746f08462865e5f8decd99278172a0692092a0d61e1c98844aa3910a1。独立review APPROVE、无P1/P2；完整证据见[v013-root-evidence.json](EVIDENCE_INDEX.md#v013)。整体gateComplete仍为false。


## v0.14 V2 capture-policy gate（历史实现基线）

输入strict绑定captured revision、policy revision、preflight、snapshot与有序representations。source preflight allow只授权进入后续policy检查，不算内容passed；扫描前与扫描/摘要后均检查当前policy revision。recognised blocked scope拒绝整次copy。缺scope、无效/不完整响应或scanner异常时当前representation不留存；其他通过的representation可partial。规则关闭时获准标准格式可留存但仍为not-scanned。

所有字节在首次异步scanner前复制为owned bytes，scanner拿独立副本；仅admitted bytes计算摘要。text/rich-text/url上限10 MiB、其他kind100 MiB、snapshot总计200 MiB；最多1024项、每item最多32。Buffer按可见span处理，SharedArrayBuffer与detached views拒绝。scanner response超过12行整次拒绝。file-body始终not-scanned；要求正文检查时file-reference不能留存。

receipt preview/paste/sync固定false，cloudUploadEligible不等于sync授权。此gate无scan timeout/cancel；scanner不settle会使调用pending，必须由有界worker/helper执行且不能在UI线程运行扫描/解码。最终提交前仍需复核hash并与policy activation串行化。当前缺native DTO到normalized input adapter、trusted source/classification/current-policy host mapping和实际HTML/RTF/OCR/metadata/file-body扫描器；没有ready/durable-ready、blobRef、cursor、storage或host writes。v0.14未改V2 manifest、native源码或runner。

## 本轮能力与明确边界

macOS 既有 JPEG/TIFF、typed TSV（含单格/单列）、URL、本机 file URL 和受限安全 RGB 颜色 archive 保持通过。颜色先有界验证 plist/object graph，再 secure unarchive；正常样例经标准 NSColor consumer 消费。并非任意 NSColor archive 支持。文件历史保留原 URL bytes；发布前只检查本机元数据/权限，不读文件正文，不保证目标应用权限或随后文件仍存在。

两端共用URI/IRI语法检查器按RFC 3986/3987验证绝对引用，不使用scheme白名单，不做I/O、打开、归一化或percent解码；保留原始URI bytes。FTP、file、自定义scheme、data、javascript、userinfo、mailto headers、空path及Unicode NFC/NFD均可按语法留存，不代表scheme语义、打开授权或安全预览已验收。非法percent、控制字符及相对引用拒绝。macOS public.url要求严格UTF-8且≤64KiB，public.file-url继续采用专用语义；Windows Shell URL A/W原生wire buffer（含NUL）≤64KiB，UTF-16文本最多65535 code units以避免误砍ANSI容量。`FormatPayload.validation_code_page`仅在A路径记录helper `GetACP()`，缺失/变化拒绝重放；这是验证环境上下文，不证明producer/目标编码。W表示不带此上下文；共享比较器会比较该字段。

Windows CF_HDROP在全部Prepare完成后、OpenClipboard/EmptyClipboard之前只读检查本机引用元数据与权限；不调用ReadFile、不改写捕获的原始引用bytes。引用已删除/移动/不可访问时发布失败且不清空当前剪贴板；检查期间若出现新revision，以superseded优先并保留新clipboard。common reparse parser已抽出并真实接入Windows path/access调用；33项portable wire/边界case覆盖偏移、长度、tag、flags、Reserved忽略、UTF-16、16KiB、失败清空、mount完整dot组件与relative symlink dot组件及63/64 hop guard。3项owned-junction Windows原生case覆盖63跳允许、64跳拒绝与cycle拒绝，源码和独立review通过但仍NOT-RUN。`OPEN_REPARSE_POINT`只约束被打开检查项，`OPEN_NO_RECALL`是请求；无跨全路径事务或“不跟随未知filter/永不recall”保证。路径组件/目标可在检查中或之后替换，目标应用也可能无法访问/复制；未知/cloud/virtual reparse拒绝。Windows运行仍需真实SDK/API、driver、ACL与TOCTOU验收。

PNG先校验结构/CRC/顺序/IHDR，再以WIC验证像素；预算包括8MiB编码、8192单边、32M像素、256MiB展开及CPU/壁钟观察，APNG明确不支持。Windows现有Classic TIFF 6 parser按LE/BE处理多main-IFD页及受限指针图，逻辑长度取最大引用extent，只允许全零末尾padding，无法解释非零尾部拒绝。资源界限为raw20MiB、32 main frames、256 IFD、depth32、262144 fields、4096 references、最大单边8192 pixels、32M pixels/page。所有页的native sample展开估算累计≤256MiB，所有页的RGBA32展开估算另有独立≤256MiB上限；没有两者相加后的256MiB联合限额。CPU/wall/RSS与实际WIC内存压力尚未冻结，不是硬配额。BitsPerSample接受正SHORT（含6-bit）；tag type/count按字段约束，Exif/GPS/Interop LONG count=1，type13只用于SubIFD，Photometric SHORT count=1必需，Compression缺省1或显式SHORT count=1且结构层不设compression枚举白名单；实际压缩解码由WIC验证。WIC逐页检查GUID/count/dimensions/CopyPixels RGBA32，不修改原始16-bit/alpha bytes，也不证明渲染色彩一致。8项Windows TIFF case源码已接入，但所有WIC/WinSDK运行未验；BigTIFF、未知type、自定义私有指针图不支持。Capture先关闭clipboard，再解码已拥有的bytes；发布仅Open前Prepare深验一次，锁内读回不重复WIC。验证期间新复制不会抹掉一致捕获的旧快照；captured与observed revision分开。

Windows读取前策略新增暂停、EXE/AUMID排除、严格未知来源及系统marker。owner观测稳定、进程实例确认和内容原始来源分开；实例确认需要PID/creation time，进程owner仍不是可信内容producer。EXE按Windows路径不区分大小写，AUMID区分大小写；只查询进程/包AUMID，尚无Shell窗口级AppUserModel.ID。策略无法确认必要身份时拒绝，显式允许未知且无排除规则时保持unknown，不虚构可信来源。

`ExcludeClipboardContentFromMonitorProcessing`及history=0/畸形阻止本地普通载荷读取；cloud=0/畸形仅禁止云投影，不误删允许的本地记录。拒绝路径通过私有ordinary-reader计数seam验证为0，18项WinAPI源码用例仍未运行。这里只是读取前preflight，未接正文扫描、V2 durable存储、当前策略重检、系统marker回放或同步执行。

Windows发布逐项读回冻结计划。实际系统可能合成额外格式，自测冻结完整Capture集合再重发比对，不假设只有4个seed。所有元数据严格比较、默认bytes一致；只对明确CF_BITMAP 24bpp规范表示比较可见RGB，其他DIB/PNG不放宽。`write_revision`记录锁内本次写，关闭后`observed_revision`不同则未确认，不误报committed、不自动恢复覆盖新复制。

ImageIO/WIC的CPU与壁钟是同步调用前后观察，不能中断调用；外部helper负责超时终止。RSS 256MiB是采样观测阈值，不是内核硬限额，不保证捕获瞬时峰值或防OOM。真实解码压力仍待验证。原生DTO的committed是内存快照检查完成，不是G1 durable-ready；尚无DTO到V2 manifest/policy receipt/outcome的生产映射。

v0.14结果：Node24.15.0 full core 135/135；Electron41.4.0/Node24.15.0 focused 51/51；workspace typecheck及contract通过。独立review APPROVE、无P1/P2；review后补充hash阶段policy revision撤销case，并在最终focused suite通过。root复核Mac42、Windows109 source hashes及Mac binary SHA仍与v0.13基线一致，没有重跑native。见[v014-root-evidence.json](EVIDENCE_INDEX.md#v014)及同目录v014日志。整体gateComplete=false。

## 代码审查

- Windows URL/PNG、来源策略、锁释放与合成格式回放：独立静态复核APPROVE；关闭重复WIC解码、注册名大小写、AUMID比较、creation-time缺失误确认及持锁深解码问题。
- 发布读回与关闭竞态：独立静态复核APPROVE；本次写版本与后续观察版本分离，借用/转移句柄边界、未确认与确切mismatch分区已审查。
- Windows延迟fixture与跨平台看护：独立静态复核APPROVE；真实WM_RENDERFORMAT路径、supervision guard和CRLF处理已接入，Windows未执行。
- Windows reparse path/access与common wire parser独立静态review APPROVE；33项portable wire/边界用例和3项owned-junction原生case已加入。Windows SDK/API/owned-junction链运行仍未验收。TIFF parser、tag type/count、6-bit样本、必要tag与fixture修正通过独立review；WIC公共wrapper的bad_alloc/length_error/fixed-error-setter异常路径分配安全修正也APPROVE。v0.12 API fault-plan两处review问题（新测试header缺namespace外层、bitmap回读需检查真实metadata与RGB而非object size）已修正；注入失败发生在系统API调用前，不能视为kernel故障证明。v0.9历史复核：主Agent复核CMake47、portable exact closure19、inventory93、100个源码文件规模及include依赖；这些结论不含Windows SDK/WIC/应用验收。
- 已有UI/主题及其他插件工作保留。没有Git add/commit/push或发布。

## 完整目标逐项差距

| 方案要求 | 当前状态 | 还需的权威证据 |
| --- | --- | --- |
| G0 macOS原生 | v0.18 native probes各87/87、source56/binary hash经v0.19 source hash复核未变、未重跑；v0.19 default ingress各5/5、codec ingress各6/6。 | trusted producer、general listener、production host及应用矩阵仍未验收。 |
| G0 Windows10/11 | registry105项；collectG0Sources inventory121，CMake63 units，portable exact-source closure53项（28个编译单元），整个native/clipboard-format（含common与codec-tests）174份源码/头文件最大499；Windows运行未开始。 | Win10/11 SDK/MSVC、全部105项native case、BCrypt KAT、WIC/WinAPI、ANSI fixture与真实源/目标应用均未运行；用户目前暂无Windows。 |
| G0 完整P1 codec/预算 | v0.19 RTF bounded static projection是历史基线；v0.24组作用域`uc`、annotation author/time/body/parent与线性URL扩展已在定向Worker/storage矩阵通过。 | 两个RTF目标测试文件53/53通过，17-case package smoke两端各通过；有限静态source review APPROVE（reviewer未执行测试）。object/pict/bin/unknown/style/dynamic等仍incomplete。Windows API/应用、trusted production transport、预算与paste仍待验收。 |
| G1 durable journal/blob/inbox/delete/payload lifecycle | v0.20—v0.23是Node-only局部组件历史；v0.23 outbox ACK、payload lease及逐revision reclamation定向矩阵各636 PASS、5 fixture skip；完整G1仍未通过 | production owner/current-policy transport、native host/preload、Windows ACL/flush、target授权与幂等CAS、consumer retirement/resync、全量metadata retention/GC与容量矩阵仍未完成。见[G1_DURABLE_STORE.md](G1_DURABLE_STORE.md)、[G1_CONSUMER_INBOX.md](G1_CONSUMER_INBOX.md)、[G1_DELETION.md](G1_DELETION.md)及[G1_RECLAMATION.md](G1_RECLAMATION.md)。 |
| G2 生产采集和回贴 | 未接入 | 独立host开发工作区、capabilities桥、统一planner/publisher、普通/纯文本/队列、新旧UI及privacy receipts。 |
| G2 安全/应用矩阵 | 未完成 | 所有表示落盘前策略、受限投影/预览、策略变更重检及各必选OS/源目标应用三层证据。 |
| G3 V2隔离/迁移 | 未实现 | 独立host store/vault、旧数据账本/备份/对账、旧客户端不能读写/删V2、未来版本隔离。 |
| G3 跨平台同步 | 未实现 | 六方向portable/E2EE多blob、staged-import/activation、接收端当前策略、断网/冲突/删除证据。 |
| G4 未来平台/私有格式 | 未验收 | Windows12/后续正式环境、Linux与私有codec独立门禁；不从本轮结果外推。 |

## 验收映射与复验工具

C01 schema已有历史证据；F01—F09、R01/R03/R05、P02/P03及W01/W02/W04/W05/W09/W10只有局部portable/源码证据，不能整条标PASS。R02/R04、完整P/S/M/W及真实源/目标应用矩阵均未验收。

v0.12 Windows源码包是历史收据：当时包含132 payload+manifest、133 entries，SHA-256 `5def6a1218b39e6101e1c4d2ad02400c5551b918f5a2f3055c158dd23a2f92aa`；打包worker与root对该归档包fresh-extract后运行Node24.15.0三脚本33/33 PASS，README注明API faults在native dispatch前注入及ANSI HDROP ACP路径前置条件。Windows/common源码此后变化，该ZIP仍是历史包，不能作为当前源码执行或本轮证据。v0.27最终source-only包已生成并通过producer/交付复核；有限范围源码review为APPROVE。详细的最终哈希、继承测试边界与Windows NOT-RUN状态见本节v0.27记录。历史链接：[源码包](EVIDENCE_INDEX.md#local-raw-artifact-archive)、[sourcekit root evidence](EVIDENCE_INDEX.md#v012)、[tests](EVIDENCE_INDEX.md#v012)、[完整root汇总](EVIDENCE_INDEX.md#v012)。Windows105项仍未在真实Windows上运行；v0.11包亦仅为历史收据。

下一步按[剩余清单](G0_REMAINING.md)继续补齐源码和双平台证据，完成G0再推进G1—G4；本目标保持进行中。


## v0.15 有界scanner实现与验证（历史）

Worker只检查显式UTF-8/UTF-16LE/UTF-16BE明文及raw/最多两层percent-decoded URL投影；严格解码失败、无效或未解析escape均not-scanned。规则为V1 literal/wildcard与RE2JS 2.8.6（最多32条、每条256字符、flags `imsu`子集）及5类likely-secret模式。请求和响应绑定policy、codec、worker ID、representation key及scopes；输入采用intrinsic byte-span owned copy，拒绝SAB/detached view。NUL framing严格处理。

默认timeout 5000ms（20—15000ms范围），并发默认1、最大2、不排队，in-flight lease最多64MiB。V8每worker old/young/stack限制为64/16/4MiB，但不是OS/RSS/native内存上限；stdout+stderr合计计数上限16KiB后丢弃。固定字段/大小检查先于Zod，但Worker structured clone会先于回调分配，故不提供不可信worker的pre-clone内存保护。host提供绝对worker路径；本API不签名或认证路径，renderer不能配置。无in-process fallback或自动重试。

所有terminal结果及dispose均等待真实Worker退出和stdio drain/close；未确认退出则保持pending并持有lease。首次terminate Promise拒绝测试只证明pending直到实际退出，不证明OS/kernel故障路径。Node24.15.0：172/172（core135+scanner37）；Electron41.4.0 Node模式focused：37/37；workspace typecheck、workspace contract、preload build、assembly15 files、package contract全PASS。Node/Electron实际组装worker smoke均为synthetic-text-only、threadExitConfirmed、outputBytes=0；worker SHA-256为`e19ec0a632e1e880fbf747dd39bc2dc089dd0ca4a0e7b4eea031ecfbb58bc9ee`；根证据绑定18项source hashes与15项package hashes。独立review APPROVE仅覆盖trusted packaged worker。见[v015-root-evidence.json](EVIDENCE_INDEX.md#v015)及同目录日志。

仍未验证installed Electron preload worker availability与Windows执行；未实现HTML/RTF projectors、OCR、image metadata、file-content scanner、native DTO或production capture integration。Mac42/Windows109 source hashes与Mac binary receipt由root复核仍同v0.13基线，但native probe没有v0.15 rerun；Windows105仍NOT-RUN。`gateComplete=false`。


## v0.16 实现与验证（历史）

共享RTF framing validator位于native/clipboard-format/common/clipboard_rtf.h与clipboard_rtf.cpp，检查标准RTF1根、bin段长度、括号、escape/参数和尾部padding边界。Windows复用且保留2 MiB cap；macOS cap为10 MiB并新增4 native cases。此validator不提取RTF文本，RTF privacy scanner尚无。

HTML/CSS静态投影位于现有Node Worker，不改变原始HTML bytes；使用锁定parse5 8.0.1与entities 8.1.0。扫描parse5 typed AST text.value及hidden/comment/template/noscript、属性、实体、最多两层percent投影和CSS escape/comment/URL metadata。普通格式HTML可passed；外部CSS/import、图片背景、img/media、动态脚本SVG及不支持CSS保守为incomplete/not-scanned；命中仍拒绝整次copy。raw 10 MiB、累计投影10 Mi scalar、10000 nodes、depth128；预算耗尽不截断为passed。无内容执行、网络或OCR。解析器选项参考[官方parse5 ParserOptions](https://parse5.js.org/interfaces/parse5.ParserOptions.html)。

Node24.15.0全套211/211（core135+scanner37+HTML36+budget3）；Electron41.4.0 Node模式focused76/76（37+36+3）；JS44/44、typecheck、workspace contract PASS。Mac Node24.15.0与Electron41.4/Node24.15.0原生probe各87/87，watchdog2/2，source46，binary SHA e9647de8813a211e649da461563a79be48a7fa9394db5628c8257f3aab501941。Node与Electron Node模式打包Worker text+HTML smoke各5/5；worker SHA 7ce9a649706eb18110de7542a5d30e4dad6a56cede0e7a7bd99c182b26895ad2，output0、externalRequests0且线程/stdio退出均确认。assembly16 files及package contract PASS，HTML_PARSER_NOTICES.txt入包。此smoke不替代生产host验收；parse5/entities不构成Node18支持证据。

Windows collectG0Sources inventory111，CMake58 units、portable exact-source closure39项（含CMake/headers，其中21项为编译单元）；整个native/clipboard-format（含common与codec-tests）154份源码/头文件最大499行。Win10/11 SDK/API/WIC与105 native cases仍NOT-RUN。v0.16原Mac Node/Electron/watchdog receipts及dist已归档于[v017-inputs](EVIDENCE_INDEX.md#v017)；冻结v0.12 source kit仍是132 payload+manifest、133 entries、SHA 5def6a1218b39e6101e1c4d2ad02400c5551b918f5a2f3055c158dd23a2f92aa，Windows/common源码已变化，不是当前源码包。v0.17 receipts、native源码、dist与docs快照已归档于[v018-inputs](EVIDENCE_INDEX.md#v018)；v0.17仅增加受监督fixture adapter，production listener/host/storage/sync仍未接线，整体gateComplete=false。

## v0.17 实现与验证（历史）

native/clipboard-format/common/clipboard_capture_wire.{h,cpp}共享20-byte magic+length frame encoder；clipboard_sha256.{h,cpp}独立提供PortableSha256Hex。Mac/Win各有PayloadTransport与薄main，Win stdout为binary。Node侧native-capture-wire.ts、native-capture-adapter.ts、native-format-registry.ts绑定request/platform/policy；expected=captured，observed独立，保留owned copy、raw SHA、完整unavailable inventory，source仍unknown。strict parser拒绝duplicate keys及非canonical UTF-8 JSON；metadata1 MiB、raw200 MiB、1..1024 rows、最多32个item（itemIndex 0..31），每item最多32个表示；名称非空且无C0/C1控制字符，名称与policy revision各限512 UTF-8 bytes，policy revision须trim后非空，request ASCII identifier最多128字节。

Mac UTF-8/HTML/RTF/TSV等已登记；不从MIME或内容猜格式。Windows ANSI/OEM/CF_HTML与Mac BOM-less UTF-16等缺decoder的格式不宣称支持。v1不含完整production replay metadata，RTF仍not-scanned；raw payload与metadata未落盘。只允许受监督固定public synthetic随机命名board/private station的--capture-wire-fixture；这不是个人general clipboard接线。

Mac UTF-16 framing不再凭尾部00 00猜NUL终止符，以免剥除正文真实NUL；遇NUL保守not-scanned，真实Worker反例与回归2/2通过。Node275/275、Electron41.4 Node模式140/140；Electron分解为native wire48、registry9、ingress5、framing2及既有scanner/HTML/budget76，不含core135。Mac Node/Electron ingress receipts各5/5并绑定binary SHA-256 4680a3907ef65ecf74c57b8b5e601f6669465159507661bdb7aac06851722849、source52：[Node](EVIDENCE_INDEX.md#v018)、[Electron](EVIDENCE_INDEX.md#v018)。portable normal/ASan CTest各1/1、每份307 named checks；JS44/44、watchdog2/2、workspace tsc、原app vue-tsc、workspace contract通过。assembly15 files、package contract PASS，HTML_PARSER_NOTICES.txt入包；Node与Electron packaged worker smoke各5/5。Windows105项NOT-RUN，production listener、trusted source/current-policy transport、native DTO到生产host/storage/publish/sync均未接线，gateComplete=false。

## v0.18 实现与验证（历史）

V2 wire携带每个captured native row的nativeCodec事实；V1 writer/reader不静默丢弃V2 metadata，新neutral reader显式兼容V1/V2。Mac UTF-16 analyzer证据绑定同item UTF-8原件并校验BOM/order/nullTerm/exact/NFC；exact standalone无derived可不带text，compatible/derived必须带text且fidelity compatible。helper codepage不证明producer编码。字段详见[Native capture wire v2](NATIVE_CAPTURE_WIRE_V2.md)。

CF_HTML共用bounded C++ parser接Windows validator和Node Worker显式htmlContainer。按原UTF-8 byte offset扫描完整context，或无context时扫描fragment；另扫描全部header/SourceURL的bounded percent/entity投影。不执行、不fetch。重复header、数字垃圾、UTF-8切分、marker/tail等畸形输入拒绝；header4096 bytes/128 lines、raw8 MiB上限。

native format支持与scanner availability分离：known native无scanner codec仍保留owned raw；规则开启时not-scanned且不准入，规则关闭时依既有策略可保留raw+not-scanned；unknown native仍unavailable。NUL alias/source-scan保护继续生效。

v0.18历史实现与验证见[归档实施状态](EVIDENCE_INDEX.md#v019)，原生probe、root capsule与source snapshot见[v019-inputs](EVIDENCE_INDEX.md#v019)。

## v0.19 实现与验证（历史）

RTF static projection在既有Node Worker中检查Unicode/legacy fallback、hidden/visible、UPR branches、font charset/cpg、HYPERLINK及文本metadata，不改raw bytes。footnote/header/footer按默认字体复位；non-default inherited uc、annotation helper metadata、object/pict/bin/unknown/style/dynamic fields仍incomplete。详情见[RTF_PRIVACY_PROJECTION.md](RTF_PRIVACY_PROJECTION.md)。

Node458/458（24 files）、Electron41.4 Node模式323/323；新增119项。已修复三项P1：UPR ANSI-u由双分支回归覆盖；special destination font继承与annotation辅助组误报passed另保留独立red/green cases。AppKit 342 bytes由root clang和worker Swift独立生成相等，含unsigned u35797；receipt仅适用于darwin27.0/build26A428/arm64/SDK27.0。

Node/Electron package smoke各11/11，0网络/0输出，worker退出及stdout/stderr close确认。root/app typecheck、workspace contract、renderer/preload rebuild、assembly15、package contract PASS，static/package review APPROVE。

v0.18 Mac G0 probes各87/87、source56/binary、watchdog2/2、portable normal/ASan各357 checks、JS44和native174/max499均仅source hash复核、未声称本轮重跑。Windows inventory121/CMake63、portable28/closure53；Windows105项NOT-RUN。production listener、trusted source/current-policy、host/storage/publish/sync与完整应用验收未完成，G0—G4保持开放。


## v0.20 G1 durable store组件状态（历史基线）

组件和接口、存储顺序、预算及边界见[G1_DURABLE_STORE.md](G1_DURABLE_STORE.md)。Node-only本地组件使用LMDB 3.4.4和文件blob；生产host/preload、native general listener及Windows store adapter未接线。

root/app typecheck、workspace contract、package contract、G1 runtime build均PASS；Node与Electron bounded package-import/LMDB close-reopen smoke均PASS。 v0.20 Mac default/codec native ingress及native-to-store integration分别每runtime5/6/3项PASS。Mac完整G0 probe87、portable/ASan357与JS44沿用已校验基线且未重跑；renderer/preload rebuild与assembly15仅沿用v0.19未变hash基线，本轮未重跑。

针对性恢复与journal回归已通过：bootstrap8、all-record-family验证/root-GC6、outcome integrity3；prune后duplicate仍核验，future event被writer拒绝且无tombstone，reservation cleanup在finally。prefix Unicode与reverse-capture-attempt修复已纳入store96项；unsupported delete fail-closed。

Node 24.15.0与Electron 41.4.0 Node模式本轮格式与存储定向回归各557 PASS、2项有意跳过（39个文件通过、2个跳过）；跳过的fixture-entry检查由真实child/parent测试覆盖，不是Windows覆盖。 557项覆盖core135、既有format/scanner/ingress323、snapshot-store96、native-to-store3；不含全仓UI/业务/sync测试。 [Node](EVIDENCE_INDEX.md#v020)、[Electron](EVIDENCE_INDEX.md#v020)。此前Electron中间红日志v020-electron-tests.txt仅作过程记录；测试侧scanner handshake修改已冻结203行，未改生产scanner；Electron exact-double-send回归30/30。

独立storage静态与runtime-package review最终APPROVE，仅限该组件且无遗留实现P1/P2；reviewer未执行测试，本轮格式与存储定向回归由root运行。测试handshake的独立静态复核也APPROVE、无缺陷；此前中间红日志不证明存在已确认的生产缺陷。完整G1仍缺production owner/current-policy transport与service lease、native DTO/host/preload/storage调用链、Windows ACL/directory-sync adapter、consumer inbox/cursor/lease、完整retention与blob GC及跨平台故障矩阵；G0—G4完整成功标准保持不变。Windows105项NOT-RUN；renderer/preload rebuild与assembly15仅沿用v0.19未变hash基线，本轮未重跑。
[v0.20最终根证据](EVIDENCE_INDEX.md#v020)

## v0.21 Consumer Inbox局部证据（历史）

| 范围 | 当前结果 | 边界 |
| --- | --- | --- |
| Consumer Inbox API | Node focused 23项通过；覆盖真实source journal staging、retention/32-ID/10,000-row限制、lease/token、ACK holes、损坏记录及owned clone | Node-only本地组件；不允许caller注入source pages，不是production consumer或目标写入验收。 |
| 进程崩溃窗口 | Node/Electron各3项SIGKILL覆盖staging、ACK row写入至cursor推进前、ACK完成后的reopen路径 | 只证明指定进程崩溃恢复，不是断电/硬件持久性。纳入各585 PASS的定向矩阵；不代表全仓测试。 |
| Native consumer集成 | 每runtime 2项AppKit synthetic native-to-consumer案例；连同既有3项native-to-store案例共5项通过。总数见[Node 5/5日志](EVIDENCE_INDEX.md#v021)、[Electron 5/5日志](EVIDENCE_INDEX.md#v021)；native-consumer JSON收据仅支持2项新案例：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。 | 不读取general clipboard、不接production host/native listener，不证明应用回贴。 |
| Runtime smoke/typecheck | Node/Electron bounded package import、consumer lease/reopen/ack通过；root/app TypeScript通过 | renderer/preload rebuild与assembly15沿用v0.19未变hash基线，v0.21未重建。smoke：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)；suite：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。 |
| G1局部组件 / 完整阶段 | Node-only Consumer Inbox及其cursor/lease局部实现和定向测试通过；独立静态review有限范围APPROVE，无P1/P2。Node/Electron格式与存储定向suite各585 PASS、3个child-fixture入口skip。 | 这不是完整G1验收。production owner/host/current-policy/service lease、native DTO/preload接线、Windows ACL/目录同步、下游target sourceSeq/CAS、consumer retirement/resync和完整retention/GC仍开放；Windows105项NOT-RUN，G0—G4未完成。 |

## v0.22 G1逻辑删除局部证据（历史）

| 范围 | 当前结果 | 边界 |
| --- | --- | --- |
| Tombstone与writer | strict `ClipboardSnapshotTombstoneV2`、exact previous-manifest CAS、deletion-kind attempt和同事务live/deleted head切换；4个fault hook覆盖回滚路径。 | 仅隔离Node-only LMDB store；旧manifest、receipt、raw/ref和blob保留，不做物理清除。 |
| Delete event与consumer | delete event/outbox与sequence原子提交；same-snapshot upsert/delete有序，ACK/replay/prune校验关联tombstone/capture/attempt。 | 不接production consumer/target；逻辑删除不代表应用同步清除或paste权限。 |
| 回归与运行路径 | Node/Electron各609 PASS、4项child-fixture入口skip：[Node日志](EVIDENCE_INDEX.md#v022)、[Electron日志](EVIDENCE_INDEX.md#v022)。bounded runtime smoke：[Node](EVIDENCE_INDEX.md#v022)、[Electron](EVIDENCE_INDEX.md#v022)。 | 定向矩阵，不含全仓UI/业务/sync；SIGKILL不代表断电或硬件持久性。 |
| Host/source boundary | 当前宿主source-only审计见[receipt](EVIDENCE_INDEX.md#v022)。 | 不证明installed host/runtime；生产host、preload/current-policy与target adapter仍未接线。 |

本轮与完整G1剩余边界见[G1_DELETION.md](G1_DELETION.md)。Windows105项NOT-RUN；完整retention/GC、consumer retirement/resync、Windows安全目录/flush及G0—G4发布门禁仍开放。

## v0.23 G1 ACK、pin与payload reclaim阶段结果（历史基线）

| 范围 | 当前证据 | 状态/边界 |
| --- | --- | --- |
| journal storage schema | schema2完整roots审计后原子迁移schema3及`outboxAckLegacyHeadSeq`；新库horizon0；manifest/event仍core V2。 | ACK旧缺失row不补造；旧v0.22代码不接受schema3。Node迁移+ACK focused 8/8，见[accepted log](EVIDENCE_INDEX.md#v023)和[fixture context](EVIDENCE_INDEX.md#v023)。 |
| payload leases | caller预生成UUID/token、4种purpose、token-free summary、terminal release receipt、128 active cap、无TTL。 | crashed pin没有owner-death自动解除；released metadata增长/quota仍开放。 |
| per-revision expiry | source prune、两条upsert/delete ACK、全部consumer ACK、无active lease；同一未提交writer transaction逐blob校验后写marker，flush后新roots回收。 | Node lease/reclamation 16/16；三项process recovery含在最终矩阵。实现为deleted revision payload回收，不删除metadata。 |
| production/G0—G4 | 仍是Node-only local component。 | installed host/current-policy/target authorization、Windows、full metadata retention/GC及G0—G4未完成。 |

最终Node/Electron定向矩阵各636 PASS、5项fixture入口skip；[Node日志](EVIDENCE_INDEX.md#v023)、[Electron日志](EVIDENCE_INDEX.md#v023)。Root/app typecheck、workspace/package contract、runtime build与package smoke均PASS。v0.22的609/4仅作历史证据；完整G1与G0—G4仍开放。


## v0.24 RTF投影实施与证据

Node24.15.0及Electron41.4 Node模式格式与存储定向矩阵各706 PASS/5 intentional child-fixture entry skips（57 passed files/5 skipped）。Node日志为单独最终重跑；Electron日志逐字复制已通过的initial结果、没有重跑：[Node](EVIDENCE_INDEX.md#v024)、[Electron](EVIDENCE_INDEX.md#v024)。新增70项由annotation Worker43、destination direct10、linear URL14、RTF storage integration3组成；两份目标RTF tests共53/53：[focused receipt](EVIDENCE_INDEX.md#v024)。

RTF投影边界、author-ID/parent语义、time范围、剩余unknown构造及预算见[RTF_PRIVACY_PROJECTION.md](RTF_PRIVACY_PROJECTION.md)。raw bytes不变、确定命中阻断整次copy；annotation提取不是Word renderer或完整anchor语义验证。

Node/Electron packaged Worker smoke各17/17，0网络请求/0 stdout/stderr，实际thread exit和两条stream end/close确认：[Node](EVIDENCE_INDEX.md#v024)、[Electron](EVIDENCE_INDEX.md#v024)。root/app typecheck、workspace contract、renderer/preload builds、assembly与package contract PASS。renderer/preload本轮确实重建，package 15 files，7 paths新增/变化、3个旧hash命名chunk被替换；snapshot-store runtime 2 files和native sources/binary沿用旧hash基线、未重建。

独立静态source review有限范围APPROVE，reviewer未执行tests。Node initial 10k queue case超过既有5秒测试deadline（6461ms）；source和deadline未改，Node最终独立全矩阵重跑通过。12.34秒(Node)/24.12秒(Electron)是完整测试进程耗时，不是产品吞吐或p95。首次日志保留作诊断：[Node initial](EVIDENCE_INDEX.md#v024)。Mac完整G0/portable/ASan/JS/watchdog未重跑；本轮只重跑targeted native ingress/store/consumer cases。Windows105项NOT-RUN，production host/current-policy/target应用和完整G0—G4仍未通过。

## v0.25 V1 数据库与 preload 状态

| 范围 | 当前证据 | 判定与限制 |
| --- | --- | --- |
| DB 写入回执 | checked adapter 将 resolved error/rejection 转为固定错误；put 要求 ok/ID/revision；remove 对象输入必须含非空revision，显式string ID保留原API语义；成功回执rev可省略；冲突最多重试三次。 | 修复 V1 false success；不构成物理断电持久性或真实宿主验收。 |
| 查询参数 | prefix 与 ID keys 转为宿主 string/string[] allDocs 形式，并过滤 ID 范围。 | 宿主内部 allDocs 错误会变成空数组；get 错误可能变 null，空结果完整性仍不可证明。 |
| 历史顺序 | DB 写确认后才更新索引和 history cursor；失败后可由后续镜像重试。 | 没有 V2 sourceSeq/CAS，并发旧写仍未被隔离。 |
| 模块边界 | clipboard-store 与 preload index 已拆分；共用一个 checked adapter；45 项 bridge 方法、窗口角色与监听器时序保留。 | 结合实际assembly包和synthetic SDK角色case已通过；仍不等于已安装host。 |
| 附件迁移 | 文件复制后核验SHA-256，保留旧目录，marker 标记枚举完整性 unverified；source/destination root、现存祖先与嵌套目标symlink/junction用lstat拒绝。 | Node迁移目标用例8/8；lstat与复制不是路径事务，仍有post-check TOCTOU窗口。备份占磁盘且启动重新检查；清理条件未定。 |
| package smoke / Electron VM | 两端packaged scanner各17/17；实际bundle preload synthetic SDK case各6/6；bounded进程exit0、signal null、termination确认、输出为空。打包15 files，3条输出路径变化：preload.js、history-worker.cjs、history-search-index chunk。 | 只对owned fixture目录读写，祖先仅只读lstat；不是已安装host/系统剪贴板，Windows native未运行。 |
| Node 全工作区 | 138 passed files、5 skipped files；1246 PASS、6 skips，[最终日志](EVIDENCE_INDEX.md#v025)。 | 5 child-fixture entry cases + 1 opt-in macOS application-catalog smoke。 |
| Electron 全工作区 | 138 passed files、5 skipped files；1246 PASS、6 skips，[最终日志](EVIDENCE_INDEX.md#v025)。 | package smoke见下行；矩阵不等于已安装host验收。 |

宿主读取错误折叠为空的 P2、legacy image localization failure 时保留旧路径的既有缺口、完整 G1 retention/GC 及所有 G0—G4生产门禁仍开放。迁移 symlink 检查后的Node/Electron矩阵与packaged smoke均已重跑通过；这不代表installed host/Windows验收。


## v0.26 历史图片入库与失败边界

本轮修复范围限于现有V1历史镜像：允许保存的图片缺少有效绝对路径、源文件读取失败、空内容、元数据错误、blob实际写入失败或缓存字节核验不一致时，拒绝当前镜像，不回退保存未本地化的原record。暂停/隐私规则排除的item仍允许按策略略过。镜像cursor只在分页全部完成后写入；前面成功写入的record不会随失败回滚，之后通过fingerprint重试去重。

历史图片读取只使用该history item的路径，不读取当前全局剪贴板。JS读入路径按句柄身份与路径状态复核，64 KiB分块、最多100 MiB；该字节预算不是native helper监督、硬RSS上限或wall-clock deadline。内容地址缓存校验真实bytes，损坏regular-file leaf可重写并复核；writer现已检查root/现存祖先/digest-prefix目录链并在关键写入边界复核identity及realpath；定向sync repository/blob测试23/23通过，独立source review确认P1修复。最终Node/Electron全工作区各1279/6，package scanner/base preload/image分别17/6/10项两端全通过，7项build/types/contracts通过，最终字段见本页开头根收据。写blob后host数据库写失败时保留blob以便重试，可能留下待GC的孤儿；无数据库/文件事务或断电持久性保证。

修复前的v0.25实际preload CJS图有Node/Electron synthetic SDK red receipts，见[历史图片入库说明](LEGACY_DATABASE_CONFIRMATION.md)。早期Node候选全套1276 PASS/6 skips（147 files，142 pass/5 skip）发生在blob-root symlink guard之前，只能作为diagnostic；[日志](EVIDENCE_INDEX.md#v026)不可代替最终矩阵。完成P1目录链修复与两个harness P2修正后，Node与Electron全工作区最终均为142 passed files/5 skipped files、1279 PASS/6 skips（[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)）。两端scanner 17/17、base preload 6/6、image package 10/10，7项build/types/contracts全通过；6个bounded进程正常终止且输出为空。VM证据不证明installed host、general clipboard或Windows native behavior。



## v0.27 Windows source kit 最终局部状态
最终归档为153 entries/152 payload，payload 876744 B，ZIP 263096 B，SHA-256 `7f3b647e75f060b9b1fa57976842ff7df574cfdfd02ed5dfea55ca61efe9158e`；manifest SHA-256 `b904f301d6c7cade45ff18b3fb668454f3722208b6a929dd3528b2179acf1312`。见[ZIP](EVIDENCE_INDEX.md#v027)、[manifest](EVIDENCE_INDEX.md#v027)、[producer receipt](EVIDENCE_INDEX.md#v027)、[final delivery report](EVIDENCE_INDEX.md#v027)。
Node24 producer root verification 8/8：[日志](EVIDENCE_INDEX.md#v027)。三个review findings已关闭：codec目录输入显式allowlist；cold checkout输出目录安全初始化；单文件/总payload/ZIP与entry/path预算限制分别为4/32/64 MiB、512 entries/1024-byte名称。有限范围source review APPROVE。
final delivery validation确认双构建产物完全一致、manifest/ZIP CRC和路径/权限检查、clean extraction verifier与缺失/修改文件拒绝；payload 152项共876744 B。44/44纯Node contracts及portable CTest 1/1由先前报告按路径哈希继承，本轮未重跑；121 Windows inventory、53 portable codec closure与4个Node tests+fixture路径字节保持一致。artifact-only validator自身不声明source review，source-review结论单独记录。
本轮没有Windows环境、没有Windows10/11或x64/ARM64构建/执行，也没有运行105项native cases或目标应用矩阵；source kit不是installed plugin或G0完成证明。manifest gateComplete=false；完整G0—G4仍开放。

## v0.28 V1历史镜像图片失败隔离（局部实现与验证）

仅允许保存且属于固定分类的图片持久化错误会隔离并继续分页；privacy排除仍按原策略跳过。单次镜像累计16次失败后跳过后续图片prepare和图像I/O，但继续处理健康非图片。只要出现图片失败，分页结束仍返回固定错误且不推进cursor；已写record保留，后续按fingerprint去重并重试。未知prepare、非图片错误及privacy/host/database异常仍fail fast。

Coordinator失败路径构造已确认record变化并尝试dispatch；刷新异常不覆盖原错误。通知为best-effort，不证明renderer subscriber收到；takeRecordChanges清空ID后没有可靠重发。失败不发送镜像成功事件、不运行retention或启动vault sync。无durable pending/failed状态、公平图片轮转或路径恢复能力，不构成完整§6.2.5或G1。

最终Node/Electron全工作区均144 passed files/5 skipped files、1298 PASS/6 skips（Node 20.28s；Electron 20.91s）。两端scanner/preload/image/isolation分别17/6/10/7项通过，8个bounded children退出0且stdio为空并确认终止；6项build/types/contracts和最终root types检查通过。15个package输出仅dist/ztools/preload.js变化，renderer未重建；2个snapshot-store runtime文件未变、未重建。source review有限范围APPROVE，reviewer未运行测试。

journal helper修复保留250ms观察窗和20s/27s场景deadline；新增最后marker/child终检及错误分类。初次全量1287/6/1、首版helper后的1293/6只作诊断；marker red 4 FAIL/6 PASS，最终journal+polling suite 25/25。历史输出路径事故及v0.26一份无法恢复的Node timing JSON见[incident report](EVIDENCE_INDEX.md#v028)；benchmark恢复原SHA，v0.28结果不替代v0.26收据。Windows105项、生产host/general clipboard/目标应用与完整G0—G4仍未验收。

## v0.29 增量验收边界

新增 Windows 私有 ACL、对象身份、文件 flush 与受控 fixture 清理源码，未接入生产 store/LMDB，也未移除 Windows 创建目录前的失败关闭。目录 namespaceDurability 固定 NOT-VERIFIED；sourceToBinaryBinding 固定 UNVERIFIED。20 项双运行时契约覆盖报告拒绝、源码闭包、受控文件路径、PE 执行架构与进程结果；不能证明 Windows 原生编译、CRT、API 或实际应用格式保真。

独立源码复审关闭两项清理 P2、CRT 文本模式 P1 与 CMake 外部源码清单 P2，最终为有限范围 APPROVE，reviewer 未运行测试。原 408 项选定源码、15 个插件产物、2 个 store runtime 文件及 43 份归档证据 SHA 未变；v0.28 全套 1298 PASS/6 skips 是未重跑历史基线。原 v0.26 journal timing 正文仍不可恢复。

本轮未编辑宿主；宿主 owner/受控 IPC、通用采集、真实目标应用、Windows SDK/OS/文件系统及异常恢复、完整 G0—G4 继续开放。没有 Git add/commit/push 或发布。

## v0.30 当前验证范围

单个受限 metadata 文档持久化图片重试排序边界，使前 16 项持续失败时后续图片仍能获得 prepare 机会。所有 deferred/已知失败仍阻止主 cursor 提交；健康记录保存并按 fingerprint 去重，未知/host/privacy/database 失败仍中止。该边界不保存载荷，不提供逐项 durable pending/failed 队列或失效路径恢复；privacy 按本轮读取的快照逐项判断。

镜像和完整 clear 在主窗口共享队列；secondary 只发请求，无本地清空回退。RPC 16 pending/in-flight、128 completed 缓存、30s 未确认无自动重试。只能阻止已在途镜像跨过 clear；不永久抑制未来 host 重枚举，也不覆盖 vault sync 等其他写入口。

最终 11 文件 Node/Electron 各 91/91 PASS、6 项 types/build/contracts PASS；现有 scanner/preload/image/isolation 每端 17/6/10/7 通过。新 CJS 轮转 25 检查与清空队列 17 检查两端通过，旧冻结 CJS 对应红测两端复现。独立静态复审有限范围 APPROVE，未跑 runtime。只有 dist/ztools/preload.js 重建变化，renderer 与 2 个 store runtime 文件未变。初次旧 IPC 通道预期失败及修正后的结果均保留。

v0.29 428 项选定源码中 11 项变化、417 项未变；新增 8 个源码/测试文件，另外将两个既有测试文件纳入收据，当前选择集 438 项。两个新纳入测试的修改前正文不在 v0.29 capsule，不能用该 capsule 证明其旧正文。v0.29 的 25 份直接证据与 v0.28 的 43 份归档证据均保持原 SHA。v0.28 全套结果未在本轮重跑，v0.26 timing 历史缺口仍保留。Windows 15+105 项、生产宿主与完整原方案均未验收。

## v0.31 主路径依赖核对

当前 PastePlanV2 只有 schema；没有真正连接私有 V2 snapshot 的 planner/publisher，也没有 portable projection、V2 crypto wire或接收端激活链。完整 consumer retirement/resync 还缺 target intent、水位、sourceSeq/CAS与旧 worker撤销。本轮为这些主链准备具体 owner、受控 Interface、版本绑定、表示选择、转换冲突、GC roots、账号/策略生命周期及六方向门禁；不增加无调用方的 core 函数或空注册退役来替代完整目标。

宿主源码只读核对的 HEAD 为 9b15fb1a2a9f3ec886016632761c7bb21e39557a，原工作区 clean；尚未在其 fix/security-protocol-validation 分支开发。v0.31 曾提出独立宿主工作区接线候选；按用户 v0.32 的明确限制，该路径现在属于范围外依赖，本轮只修改插件目录，不创建宿主分支或修改宿主。Windows 10/11 105 个 G0 和 15 个存储基础探针仍 NOT-RUN；当前没有 Windows 环境。Windows 12/后续系统与 Linux 仍按原 G4 单独取证。

v0.31 当轮没有实现代码/依赖/产物变化，也没有重跑实现测试。v0.30 Node/Electron 各 91 项相关回归与 CJS 红绿收据仅作为已验证的未变基线保留；后续设计评审不能代替系统或应用验收。未提交、推送或发布。

两份候选契约的独立复审已关闭两项P2，有限范围APPROVE design；没有实现测试或平台验收。本轮[根证据](EVIDENCE_INDEX.md#v031)、[设计复审](EVIDENCE_INDEX.md#v031)和[主路径审计](EVIDENCE_INDEX.md#v031)绑定准确范围。完整目标未缩减；宿主真实接线属于本轮范围外依赖，Windows 运行仍缺环境。这些缺口不阻止继续完成插件内可验证工作。

## v0.32 插件内清理回灌修正

清空先读取有界宿主历史，正向确认每设备清理身份集合，再进入已有清理队列。镜像仅跳过精确的 `(id,timestamp)` 身份；被排除行不推进主游标。独立审查指出的时间范围误抑制、旧行推进游标、矛盾分页总数和验证输出根目录问题均进入本轮复验。

身份集合最多 100,000 项，长期合并达到上限时会在删除前失败关闭；没有自动遗忘或重置。真实宿主 IPC 大文档容量、单调 source sequence、分页快照及完整格式采集仍未验收。Windows 105 个 G0 和 15 个存储探针仍 NOT-RUN；本轮没有提交、推送或发布。

最终插件相关回归：Node/Electron 各 157/157（15 文件），类型/构建/契约 6 项通过。实际 assembled CJS 合成 SDK 两端各 35/35，通过冻结旧包预期失败对照；详情及适用边界见[清理身份记录](HISTORY_CLEAR_BOUNDARY.md)。没有将这些结果计为真实宿主、操作系统或应用回贴验收。
