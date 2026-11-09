# G0 剩余实现与验证清单

> v039：插件内 Unicode portable text/projection 候选已获有限范围源码复核；具名检查通过，两个顶层 runner 失败事实及证据见 [组件说明](PORTABLE_TEXT_PROJECTION.md)。完整 G0–G4、G2/G3、可信 host 与 Windows 仍未完成或未验收；V2 开关关闭，未提交或发布。

v0.38 当前增量：[启动预算、事务与资源验证](G3_BUDGET_RESOURCE_VALIDATION.md)。项目类型、构建和公共包检查通过；相关回归三运行时各 71 PASS / 2 child-only skips，独立复核限定通过。完整 G0–G4/G3、真实宿主和 Windows 仍未完成；见[本轮证据](EVIDENCE_INDEX.md#v038)。

v0.37: [verification-only budget](G3_VERIFICATION_BUDGET.md); [current evidence](EVIDENCE_INDEX.md#v037). Component-only, full G0-G4/G3 incomplete.


v0.36 当前增量：[pure wire](G3_WIRE_IMPLEMENTATION.md)与[Node crypto组件](G3_CRYPTO_COMPONENT.md)已实现并经限定代码安全复审。这是独立库组件，不是生产同步、宿主激活或完整G3验收；最终证据见[本轮索引](EVIDENCE_INDEX.md#v036)，原G0–G4、Windows和六方向门禁不变。


v0.35 当前增量：[G3 crypto ADR](G3_CRYPTO_ADR.md) 限定设计接受，尚未实施；公开原语在三个 darwin/arm64 运行时各通过24项标准KAT，另各1次候选KDF观测。不是协议vectors、Windows或六方向同步验收，G0–G4仍未完成；A/B范围审批仍pending。见[v0.35根证据](validation/v035/v035-root-evidence.json)。


v0.34 当前推进：[宿主实施 ADR](IMPLEMENTATION_ADR.md) 的限定设计门禁与 [A/B 范围审批](MAINLINE_SCOPE_APPROVAL.md)。本轮仅文档和只读源码审计；宿主、根 CI 与本 ADR 新增 wire/bootstrap/queue 均未实施，审批待用户。v0.33 是上一运行基线，本轮不重跑其测试。见[本轮根证据](validation/v034/v034-root-evidence.json)。

v0.33 上一实现基线：[逐图持久重试与恢复](HISTORY_IMAGE_RETRY_JOURNAL.md)。Node24/Electron 各 1439 PASS、6 skips；Node20 定向 113 PASS；实际开发目录打包图两端各 27/27 PASS；新版/旧版设置浏览器 2/2 PASS。按限制仅修改插件目录，完整 G0—G4 仍未通过。见[本轮根证据](validation/v033/v033-root-evidence.json)。

v0.28根证据：[root evidence](EVIDENCE_INDEX.md#v028)；独立源码review：[review](EVIDENCE_INDEX.md#v028)，结论为有限范围APPROVE；完整G0—G4仍未通过。
Windows 10/11 的105项原生cases仍NOT-RUN；v0.27 Windows source kit本轮未改动。Windows 12及后续版本需另行建立G0—G3门禁。
v0.27根证据与文档审计字段：[root evidence](EVIDENCE_INDEX.md#v027)。根收据记录`gateComplete=false`。

v0.26根证据与文档审计字段：[v0.26 root evidence](EVIDENCE_INDEX.md#v026)。最终字段见根收据。


版本：v0.28 V1 history mirror局部改进；日期：2026-10-28。Node/Electron全量与有限source review已完成；完整G0—G4仍未完成，Windows原生105项NOT-RUN。
v0.24 RTF投影历史矩阵：Node/Electron各706 PASS/5 fixture入口skip，Node独立最终重跑、Electron日志为已通过initial副本；不是本轮Windows source-kit验收。


v0.21历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v022)

v0.22历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v023)。

## v0.19历史局部基线

- v0.19 Node全套458/458（24 files，core135+其余323）、Electron41.4 Node模式323/323（15 files）；RTF Worker60、tokenizer8、charset43、projection-budget8共新增119项。memory capture-policy仍不是生产storage或native/host接线。
- Mac/Electron native G0 probes沿用v0.18各87/87、source56、binary SHA fdc9f715e48c0fe39a6ba87f6058b9cdc13804f7ff5af6f0b142c5918affac82与watchdog2/2；v0.19仅经source hash复核未变、未重跑。v0.19 default ingress各5/5、codec各6/6，均为受监督fixture。trusted source/current-policy production transport、general listener或host仍未接入。
- Windows：逐格式receipt仍含7组、16 key和9项receipt case；registry105项且全部Win10/11 SDK/API/WIC及native execution NOT-RUN。collectG0Sources实核inventory121；Windows CMake63编译单元，portable target28编译单元/local include closure53项；native/clipboard-format跨平台、common与codec-tests合计174份源码/头文件最大499。v0.12 source kit仍为历史包，不代表当前完整源码。
- v0.18 normal/ASan CTest各1/1、各357 checks及RTF framing仅经source hash确认未变、未在v0.19重跑。v0.19新增Worker RTF projection覆盖Unicode/fallback、UPR各branch、hidden/visible、font charset/cpg、HYPERLINK与text metadata；special destination/annotation auxiliary states及object/pict/bin/unknown/style/dynamic fields仍incomplete。
- v0.19：Node458/458、Electron Node模式323/323；Node/Electron package smoke各11/11、0网络/0输出且退出/stdio close确认；root/app typecheck、workspace contract、renderer/preload rebuild、assembly15、package contract PASS；static/package review APPROVE。
- v0.15 bounded明文/URL scanner及Worker生命周期是历史基线：Node172/172、Electron focused37/37与synthetic-text-only package smoke通过；worker SHA-256 e19ec0a632e1e880fbf747dd39bc2dc089dd0ca4a0e7b4eea031ecfbb58bc9ee。v0.16保留该范围并增加HTML/CSS投影；v0.15的HTML/RTF projector未实现只描述v0.15时点，不是当前HTML能力。见[v015-root-evidence.json](EVIDENCE_INDEX.md#v015)。
- Windows读取前策略覆盖暂停、EXE/AUMID排除、严格未知来源及history/cloud marker分流；锁内实例确认与unknown策略已分离。只是preflight，不是全部隐私检查完成。
- macOS capture在全部候选bytes复制并通过final materialization revision barrier后，才离线codec校验/摘要owned NSData；barrier前board变化丢弃整份阶段payload，barrier后变化保留一致旧快照并分别报告captured/observed revision。raw staged bytes全额计入snapshot预算，超限长度在额外owned copy前拒绝，但不限制原生reader/provider的首次分配；输出byteLength只计有效表示。Windows Capture锁内复制与版本确认后关闭，WIC离线验证旧owned bytes；Publish一次预检、计划读回，write/observed版本分开；系统合成格式按实际全集冻结回放。v0.12 Windows新增包装API fault plan、显式session close与资源生命周期用例，尚无Windows runtime证据。
- 进程看护：真实子进程超时/输出/RSS阈值及首采样握手已验证；macOS真实dataForType延迟provider终止已验证。Windows真实WM_RENDERFORMAT延迟fixture与supervision guard已接线，未运行。RSS是观测阈值，不是内核硬限额。

当前case数、构建指纹及收据见[实施状态](IMPLEMENTATION_STATUS.md)。以下项目未关闭前整体G0仍不通过。

## 尚未完成的实现与运行缺口

| 模块 | 具体差距 | 必需反例/证据 |
| --- | --- | --- |
| macOS来源/读取前策略 | v0.18 native probes各87/87、source56、binary SHA fdc9f715e48c0fe39a6ba87f6058b9cdc13804f7ff5af6f0b142c5918affac82及watchdog2/2经v0.19 source hash复核未变、未重跑；v0.19 default ingress各5/5、codec各6/6。producer identity仍unknown，frontmost bundle只是hint，producer未知时fail closed。 | 隔离probe仍需trusted producer/current-policy、general monitoring、host和真实应用证据；capture ready不等于存储/预览/同步/回贴授权。 |
| Windows来源完整性 | 已有owner窗口/PID/creation time/EXE/进程包AUMID及排除；尚无Shell窗口级AppUserModel.ID。owner不证明原始producer，转发/RDP/应用内部代理需明确。 | EXE/AUMID必要信息失败即拒绝，同名与大小写隔离；PID重用/源退出/窗口替换实测；不能把进程owner标成可信内容来源。 |
| 两端内容隐私与接线 | HTML/CSS与CF_HTML bounded projection保留；v0.19 RTF静态隐私投影是历史基线且保留原件；v0.24的uc/annotation/URL扩展已由定向Worker/storage矩阵通过。 | v0.19时non-default inherited uc与annotation atnauthor/atnid/atndate未建模；v0.24对应静态projection、时间/关联边界及Worker/store定向集成现已通过本轮矩阵，unknown constructs仍保持不完整。object/pict/bin/unknown/style/dynamic仍incomplete；trusted source/current-policy生产接线、general listener/host/storage/sync未完成。 |
| Windows TIFF/JPEG | Classic TIFF 6 parser、CF_TIFF/WIC源码及8项case已接入；BigTIFF、未知type、私有pointer图unsupported，Windows仍NOT-RUN。JPEG格式注册名仍需实际应用核实。 | Win10/11真实WIC/WinAPI、错误压缩和预算边界、目标应用，确认JPEG名称与颜色/渲染验收。 |
| URI/IRI语法与策略分离 | 共用语法检查器按RFC 3986/3987解析绝对URI/IRI，无scheme白名单并保留原始bytes；Mac public.url为严格UTF-8/64KiB，file-url专用语义保留；Win Shell A/W含NUL的wire buffer限64KiB。合法语法不证明scheme语义、打开授权或安全预览；Windows未运行。 | portable/Mac用例覆盖ftp/file/custom/data/javascript/userinfo/mailto headers/空path/NFC与NFD、非法percent/control/relative；保持原bytes且不I/O/打开/归一化/解码percent。分别验收scheme打开/预览策略。 |
| Windows颜色 | 无统一scalar-color标准格式；CF_PALETTE是图像调色板。真实来源表示与codec仍需样本确认。 | 不造JSON、不把palette当P1颜色完成；文本色值仍保文本，具体颜色表示逐项结构/预算/目标应用验证。 |
| ANSI来源编码 | receipt模型区分helper ACP/OEM、ANSI URL `urlCodePage`与ANSI HDROP `validationCodePage`；均为helper/fixture上下文，不是producer provenance。 | 保留A格式原bytes，Windows真实路径和目标应用矩阵确认编码；未运行时保持NOT-RUN，不冒称跨平台精确投影。 |
| Windows PNG范围/压力 | 静态PNG结构及WIC像素验证已有；APNG明确unsupported，实际解码压力与预算尚未验收。 | 真实高压/边界+1、无效IDAT、16-bit/alpha、色彩元数据；若扩展APNG需专门codec，不能默认为动画保真。 |
| Windows文件回贴与链接目标 | HDROP发布前只读检查本机引用元数据/权限已接入：在全部Prepare后、Open/Empty前运行，不调用ReadFile；失效/不可访问不清空当前clipboard，新revision superseded优先。common reparse parser及真实path/access调用已接入并通过独立静态review。33项portable checks直接覆盖wire长度/tag/offset/flags/UTF-16/16KiB/Reserved/dot语义与63/64 guard；新增3项owned-junction原生case覆盖63允许、64拒绝、cycle拒绝，源码已冻结但Windows全NOT-RUN。`OPEN_REPARSE_POINT`只约束被打开检查项，`OPEN_NO_RECALL`只是请求；检查没有全路径事务，组件/目标仍可能被替换，也不保证回贴应用能访问/复制。 | 补Win10/11 SDK/API运行和真实owned-junction traversal；以API seam验证DeviceIoControl错误/短读/畸形返回、ACL、link cycle、组件/目标替换TOCTOU、remote/cloud/longpath与driver recall。路径最多63个reparse points（长路径可能更低），未知/cloud/virtual reparse拒绝，原始引用bytes不改；portable wire cases不能替代OS filter/driver行为。 |
| macOS文件回贴 | 发布前stat/access已有隔离证据，捕获仍保留已删除目标的URL bytes。 | 文件/目录有序、删除/移动/权限拒绝；当前检查不保证目标应用权限或之后仍可用，真实应用矩阵未完成。 |
| 两端延迟/权限完整性 | Mac v0.16 Node/Electron各87/87，AppKit watchdog2/2；Windows真实WM_RENDERFORMAT fixture尚未运行，API fault wrappers也没有kernel/session故障证据。general监听、源退出、锁/会话/真实权限尚无完整矩阵。 | helper可终止，deadline受控；不补未来值；锁内一致的旧快照在离线验证遇新复制仍留存，并另排当前版本。 |
| Windows API故障/资源所有权 | v0.12已实现私有per-adapter `ClipboardApiFaultPlan`及Open/Empty/Set/Close wrappers；注入失败发生在native call前，attempt与native-forward计数分别记录。15项source case覆盖Publish12/Capture3、HGLOBAL/GDI ownership、partial/unconfirmed写入、Close失败和reset/recovery；旧第三参数pre-loop Set-index用例仍单独保留，独立静态review APPROVE。 | Win10/11 SDK及native运行验证adapter输出、API返回/错误和实际资源行为。明确Close失败即保守失败，即使析构重试成功；persistent双Close故障只用fixture直接raw CloseClipboard清场，不证明OS/kernel cleanup。覆盖真实Empty/Set/Close失败、权限/系统资源耗尽、handle/session cleanup与下一回合恢复，保持105项全NOT-RUN。 |
| Windows逐格式收据 | v0.11已实现独立顶层`windowsFormatReceipts`、C++ serializer与JS strict validator；固定7组、16个format keys及9项native cases已注册。独立静态review APPROVE；capture/publish API未改，新增摘要在sessions关闭后从owned logical bytes生成。Windows全部NOT-RUN。 | 在Win10/11确认成功报告必须具备7组、planned/readback SHA与length、revision/context绑定、CNG known answers及invalid binding拒绝；确认20MiB planned/readback分开预算、每组32行、只允许CF_BITMAP visible-RGB-compatible。ANSI URL code page与ANSI HDROP validation code page分别记录，sourceOrigin仍unknown，不把helper ACP/OEM说成来源编码。ANSI HDROP完整绝对checkout前缀不能由GetACP无损表示时该case记NOT-RUN且G0不PASS；默认Unicode fixture不变。 |
| DTO到V2映射 | v0.18 nativeCodec evidence随captured rows绑定encoding/materialization/helper codepage与可选Mac UTF-16 text evidence；v1 reader/writer不静默丢v2 metadata，neutral reader显式支持v1/v2。仍是fixture admission路径，无trusted source/current-policy生产transport或host adapter；gate输出不是manifest-ready/durable-ready。 | compatible/derived需要原件text及compatible fidelity；helper codepage不证明producer编码；observed新版本不能冒充captured旧版本。 |
| 容量/解码预算冻结 | 方案起始100MiB/格式、200MiB/快照；Win累计20MiB、PNG8MiB更小。同步解码只有CPU/壁钟前后观察，RSS外部采样。 | 明确支持额度及边界+1，压力测量后冻结；无证据不放大，不把观察阈值当硬CPU/RSS限额。 |

## 只能由实际环境关闭的门禁

1. Windows SDK/MSVC构建；Win10/11各必选edition/build/架构运行全部105项native cases（含9项receipt、8项TIFF、3项owned-junction和15项API fault cases），并运行Win32/BCryptHash/WIC/真实延迟fixture及Node/PowerShell看护。包装故障注入只覆盖adapter调用前路径，不替代真实API/kernel/资源压力证据；33 portable wire checks和v0.9的244 parser checks不能代替Windows系统行为。ANSI HDROP先确认完整checkout前缀可被GetACP无损往返，否则单项NOT-RUN且G0不得PASS。
2. macOS native baseline沿用v0.18 probes各87/87、source56、binary SHA fdc9f715e48c0fe39a6ba87f6058b9cdc13804f7ff5af6f0b142c5918affac82及watchdog2/2；本轮source hash复核未变，不是v0.19重跑。v0.19 default ingress各5/5、codec ingress各6/6。仍需general monitoring、签名/ABI/host、可信来源和真实源/目标应用证据。
3. general监听、revision与source ledger、源退出、锁/权限/会话/休眠恢复；私有board/station不是交互会话证据。
4. 必需源/目标应用回贴需具备字节、系统发布、应用内容三层证据。Word/Excel/飞书/文件管理器等未测不标支持。
5. G1完整durable blob/journal/outbox/inbox/cursor/reclamation/GC仍未通过；v0.20 store、v0.21 consumer inbox、v0.22 deletion及v0.23 ACK/pin/per-revision reclaim都是Node-only局部组件，不等于生产G1。G2生产统一planner/publisher及隐私、G3六方向同步仍未完成，不能由G0或局部store合成测试代替。
6. Windows12/后续正式版、Linux保留独立未来验收门禁，不从Win10/11结果外推。

## 资料与范围

- [Windows标准格式](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats)
- [系统合成格式与历史/云控制标记](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats)
- [Shell URL与HDROP](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard)
- [Windows reparse points与路径上限](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points)
- [NtCreateFile reparse/no-recall选项](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile)
- [延迟渲染与所有权](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations)
- [W3C PNG规范](https://www.w3.org/TR/png/)
- [完整方案](TECHNICAL_PLAN.md) / [验收矩阵](ACCEPTANCE.md)

本页对照当前源码盘点；官方格式说明只证明契约定义，不证明实现或应用通过。没有提交、推送或发布。

v0.15历史记录：只补上bounded worker执行能力


## v0.16 边界摘要（历史）

v0.16历史边界：portable CTest各1/1、256 named checks；Windows inventory111/CMake58/closure39（21编译单元）；跨平台native154份源码/头文件max499；Mac Node/Electron probe各87/87、watchdog2/2、source46；Node211/211、Electron76/76、JS44/44；assembly16与worker smoke各5/5。v0.16 Mac Node/Electron/watchdog receipts及dist现归档于[v017-inputs](EVIDENCE_INDEX.md#v017)。v0.12 source kit仍是132 payload+manifest、133 entries、SHA 5def6a1218b39e6101e1c4d2ad02400c5551b918f5a2f3055c158dd23a2f92aa，因Windows/common源码变化不是当前源码包。Windows未来版本不因v0.16结果而宣称支持；完整G0—G4范围不变。

## v0.17 边界摘要（历史）

v0.17历史Node275/275（17 files）、Electron140/140（8 files）；Mac native probe各runtime87/87、source52；portable CTest各1/1、307 checks；Windows inventory117/CMake61/closure45，native164 max499。v0.17 receipts、native源码、dist与docs快照现归档于[v018-inputs](EVIDENCE_INDEX.md#v018)。完整G0—G4范围保持不变。

## v0.18 边界摘要（历史）

v0.18历史suite、Mac probes、portable/JS、package smoke与源码状态保留于[v019-inputs](EVIDENCE_INDEX.md#v019)及[归档剩余清单](EVIDENCE_INDEX.md#v019)。

v0.18时RTF仅framing的历史结论由v0.19 Worker privacy projection更新；V2 codec、CF_HTML及known-format/scanner-availability仍仅在fixture范围验证，不降低NUL alias/source guards。

## v0.19 边界摘要（历史）

RTF Node Worker projection通过：Node458/458（24 files）、Electron Node模式323/323，Node/Electron package smoke各11/11且0网络/0输出、真实退出与stdio关闭确认。342-byte AppKit样本含unsigned u35797，由root clang和worker Swift生成且逐字节一致。已修复UPR ANSI-u、special destination font、annotation辅助组三项P1；UPR有双分支回归，后两项有独立red/green日志。

non-default inherited uc、annotation辅助metadata、object/pict/bin/unknown/style/dynamic constructs仍incomplete/not-scanned。Mac G0 87/source56/binary、watchdog2、portable357、JS44与native174/max499均是v0.18基线，仅经source hash复核未变、未重跑。

Windows inventory121/CMake63、portable28/closure53仍为源码证据，Windows105项NOT-RUN。production listener、trusted source/current-policy、host/storage/publish/sync及应用矩阵未接入，G0—G4未完成，gateComplete=false。当前证据：[v019-root-evidence.json](EVIDENCE_INDEX.md#v019)。


## v0.20 G1组件边界（历史基线）

Node-only packages/snapshot-store使用LMDB 3.4.4与content-addressed blob files；policy scan和commit authority由同进程的单一trusted owner注入。AppKit public synthetic owned fixture经真实Worker/core gate/store close/reopen，Node/Electron Node模式各3项通过。root/app TypeScript、workspace contract和runtime package build/import/blob close/reopen均通过。package contract在本轮重跑通过；renderer/preload rebuild与assembly15仅为v0.19 hash未变基线，未在v0.20重建。

v0.20 native ingress定向重跑：Node/Electron default各5/5、codec各6/6、store integration各3/3通过；完整Mac G0 probe87、portable/ASan357与JS44未重跑。bootstrap8、all-record-family验证/root-GC6及outcome integrity3通过；prune后duplicate有效性通过，当前未实现的delete事件由backend明确拒绝，尚无tombstone writer，reservation cleanup使用finally。完整retention/GC/lease仍为G1缺口。

Node/Electron本轮格式与存储定向回归PASS，准确计数与skip说明见[实施状态](IMPLEMENTATION_STATUS.md)。最终日志：[Node](EVIDENCE_INDEX.md#v020)、[Electron](EVIDENCE_INDEX.md#v020)；旧Electron中间红日志保留为过程记录。

LMDB跨进程writer lock不是跨进程policy一致性；没有owner lease或认证current-policy transport。Windows在mkdir前fail closed为private-directory-unavailable，Windows105项仍NOT-RUN。v0.20时尚无consumer inbox；v0.21加入本地metadata-only inbox，但仍未接production host/preload、general listener、paste或sync。完整G1仍缺production owner/current-policy transport与service lease、native DTO/host/preload/storage调用链、Windows ACL/directory-sync adapter、下游幂等target写入、consumer retirement/resync、完整retention/GC与跨平台故障矩阵；G0—G4完整成功标准保持不变。历史证据：[v0.20 root](EVIDENCE_INDEX.md#v020)。

## v0.21 Consumer Inbox局部进展（历史）

同一LMDB source journal现可原子stage真实事件与inbox rows/enqueuedThrough，并独立维护连续acknowledgedThrough；source-pull retry不冒充delivery ACK。支持fresh-token lease、token-fenced acknowledge/release、registered-consumer prune guard与recovery roots校验。Node/Electron格式与存储定向suite各585 PASS、3项child-fixture入口skip；对应fixture由父进程case实际执行。Node consumer focused 23项，Node/Electron各3项SIGKILL；每runtime 2项synthetic AppKit native-to-consumer与既有3项native-to-store合计5项通过，见[Node集成日志](EVIDENCE_INDEX.md#v021)、[Electron集成日志](EVIDENCE_INDEX.md#v021)。两份native-consumer JSON只支持新增2项：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。Package-import/lease/reopen/ack smoke通过。该suite不含全仓UI/业务/sync测试。日志：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。详细边界见[G1_CONSUMER_INBOX.md](G1_CONSUMER_INBOX.md)。

这一组件不代表宿主目标写入、生产owner/current-policy transport、跨service lease、Windows存储适配或完整retention/GC已完成；Windows105项仍NOT-RUN。G0—G4完整发布门禁保持开放。

## v0.22 G1逻辑删除局部进展（历史）

本地LMDB writer现将strict tombstone、delete event/outbox/attempt/sequence、live-head移除和deleted-head写入同一事务；`previousManifestRevision`精确CAS，重复attempt仅可验证后只读重放。ACK/prune/recovery校验关联记录并在损坏时fail closed。完整字段和transaction boundary见[G1_DELETION.md](G1_DELETION.md)。

Node/Electron格式与存储定向回归各609 PASS、4项child-fixture入口skip；bounded runtime smoke覆盖capture/inbox ACK/delete sequence/delete ACK/close-reopen/replay不复活/raw SHA不变。它们只证明本地组件和Node/Electron Node模式路径，不关闭production listener/host/current-policy、Windows或目标应用验收。

删除是逻辑删除；历史manifest/receipt/raw/ref/blob均保留。当前宿主source-only审计显示`_rev`是单文档CAS，bulkDocs逐项返回而非整组成功原子事务；`PLUGIN/`属于account/sync scope，`clearPluginData`按whole-plugin prefix清理，不能以V2子ID隔离用户数据。详见[只读源码收据](EVIDENCE_INDEX.md#v022)；installed host/runtime未验证。

完整G1仍开放：production owner/current-policy与service lease、native DTO/host/preload、Windows verified DACL/目录flush、真实target幂等sourceSeq/CAS、consumer retirement/resync、容量/压力和完整retention/GC。G0—G4原成功标准不变。

## v0.23 G1 payload lifecycle局部进展（历史基线）

journal schema3迁移、canonical outbox ACK、无TTL payload pin与逐manifestRevision payload expiry已加入Node-only store。Node24.15.0与Electron41.4 Node模式定向矩阵各636 PASS、5项fixture入口skip，含migration/ACK、lease/reclamation和3项process recovery。

每revision回收需要已删除状态、sourceFloor超过deleteSeq、upsert和delete的durable ACK proof、全部注册consumer连续ACK且无active pin。expiry marker和该revision的所有blob length/hash检查在同一未提交writer transaction；成功flush后由fresh roots审计再做unlink/fsync。共享blob保留。expiry后仍保留所有metadata；这不是full retention/GC。

未关闭：crashed pin保守常驻及lease历史元数据配额；生产authorized intent/current-policy/host/target adapter；Windows DACL/flush与105项实机；metadata compaction/time/capacity retention和压力矩阵。完整G1与G0—G4成功标准保持开放。详见[G1_RECLAMATION.md](G1_RECLAMATION.md)。


## v0.24 RTF投影已验证范围与剩余门禁

Node24.15 / Electron41.4 Node模式定向矩阵各706 PASS/5 skips；Node为独立最终重跑，Electron verified log是已通过initial文件逐字副本。两份RTF target tests 53/53、store read/reopen integration3项及packaged Worker smoke两端17/17通过；独立静态source review有限APPROVE。RTF原件不改，命中仍拒绝整copy。

尚未支持：`\atnref`、annotation bookmark/icon、pict/object/bin、unknown styles与动态字段；这只是privacy projection，不是Word renderer或完整anchor验证。Mac完整native probe/portable/ASan/JS/watchdog未重跑，Windows105项NOT-RUN。生产host/current-policy/general listener/target app、完整G1与G0—G4门禁仍开放。测试耗时不是生产性能/p95；isolated 1MiB regex timeout仅为matcher诊断：[baseline](EVIDENCE_INDEX.md#v024)。

## v0.25 V1 数据库边界

本轮在现有 V1 插件调用链补上写入确认：resolved error 不再当成成功；失败写入不推进索引/cursor；allDocs 参数转换到宿主原生形式。详细的接口语义、迁移状态和局部证据见[数据库确认说明](LEGACY_DATABASE_CONFIRMATION.md)。

以下事项仍未关闭：

- 宿主 allDocs 内部异常会折叠为空数组，get 内部异常可能折叠为 null。插件不能区分“确实为空”与“宿主读取失败”；需要宿主传播错误或提供可验证枚举协议。
- deleteRecords 根据枚举缺失判断已删除，sync tombstone也依赖枚举；在上述宿主语义下，空结果可能造成假删除/遗漏 tombstone。不能以 adapter 的 shape/range 验证替代读取完整性。
- 迁移保留旧附件目录并将宿主枚举 completeness 标为 unverified，避免读取失败时删除唯一副本；这会增加磁盘占用和主窗口启动重新核验的成本。source/destination root、现存祖先及嵌套目标 symlink/junction 已做 lstat 拒绝，但路径检查与后续复制非原子，仍有 TOCTOU 窗口；未确定满足何种可证明条件后才能安全清理。
- V1 adapter 的确认回执不实现 V2 durable target intent、sourceSeq/CAS、private store、native DTO、生产 clipboard listener、目标应用回贴或跨设备激活协议。
- v0.26的history镜像已在允许保存的图片路径/读取/落盘/核验失败时阻止cursor提交，但不提供durable pending队列或用户可见健康状态；批次内已写record不回滚，DB写失败后已写blob留给重试/后续GC。按路径fingerprint命中的既有record不会自动核验或修复。

v0.25迁移路径加固后的历史Node/Electron矩阵均为1246 PASS/6 skips（138 pass files/5 skip files）；日志见[Node](EVIDENCE_INDEX.md#v025)与[Electron](EVIDENCE_INDEX.md#v025)。两端package smoke各17/17，实际bundle preload合成SDK各6/6；reviewer有限源码范围APPROVE且未运行测试，历史root capsule：[v0.25](EVIDENCE_INDEX.md#v025)。Windows native 105 项 NOT-RUN；用户确认目前没有Windows测试环境，不把静态检查或VM合成SDK计作Windows验收。


## v0.26 历史图片入库门禁补充

- 当前历史镜像不再把图片本地化失败降级成原record；允许保存的图片失败会拒绝该轮cursor前进。暂停或隐私规则明确排除的item仍可跳过。不可读的单项可能阻塞整批后续cursor推进；已有成功record保留并可重试去重，不提供全批原子提交。
- 图片reader按常规文件、非空、最大100 MiB、64 KiB分块及路径/handle状态复核实现；Node平台旗标不能替代Windows对reparse/symlink与TOCTOU的原生验证。根收据仍需单独记录Windows105项NOT-RUN。
- content-addressed cache先对实际bytes核对length/SHA-256，坏的regular-file leaf重写并复核。root/ancestor/digest-prefix symlink escape已加入path-chain、realpath与identity guard，定向sync/blob suite 23/23通过，source review确认P1修复；但不消除所有TOCTOU，也不是文件/host DB事务或power-loss durability。DB写入失败留下的blob需后续GC策略。读取100 MiB预算也不是native helper监督、硬RSS或wall-clock deadline。
- `sync-error`仅有固定消息事件，没有health UI或durable pending-attachment queue。既有路径fingerprint duplicate不会自动验证旧附件，旧路径失效可能持续失败。

当前完整Node候选1276/6是在该root/prefix symlink风险加入红测前运行，属于diagnostic，不是最终绿色矩阵；修复后的Node最终为1279/6。
- 两个测试harness P2已修复并分别获reviewer APPROVE：未知`node:` imports改为显式allowlist，`record-error` smoke检查固定event detail及所有event/console中的sentinels。Node与Electron全工作区均为142 passed files/5 skipped files、1279 PASS/6 skips；两端scanner/base preload/image package各17/6/10项通过，7项build/types/contracts及6个bounded process均通过。日志和进程收据见[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)及本页开头根收据。Windows105项NOT-RUN、snapshot-store runtime 2未改未重建；完整G0—G4仍开放。


## v0.27 Windows source-kit 交付与G0剩余项
最终source-only包已通过有限范围交付复核：[ZIP](EVIDENCE_INDEX.md#v027)、[receipt](EVIDENCE_INDEX.md#v027)、[delivery report](EVIDENCE_INDEX.md#v027)。ZIP 153 entries/152 payload、SHA-256 `7f3b647e75f060b9b1fa57976842ff7df574cfdfd02ed5dfea55ca61efe9158e`。producer P1/P2均修复，Node24 root producer 8/8；source reviewer limited APPROVE。
包内Windows fingerprint inventory 121 paths（114 native+7 runner），Windows CMake63 units；portable codec target28 units、53-path exact closure。delivery report复验最终双生成、ZIP CRC、manifest、clean extraction verifier和tamper rejection。44/44 Node合同及CTest1/1按前轮路径哈希继承、没有针对最终ZIP重跑。
Windows10/11、x64/ARM64 SDK/MSVC/WIC/native execution仍NOT-RUN；105 cases、真实应用矩阵和内容/隐私生产链路未验收。旧v0.12包保持历史原件；source kit不改变G0—G4状态，整体gateComplete=false。

## v0.28 V1 mirror局部进展与剩余事项

允许保存的图片遇到固定持久化错误时继续处理后续记录；累计16次后跳过余下图片I/O，健康非图片仍继续。批次最终返回固定错误且cursor不前进；此前已写record保留，重试按fingerprint去重。privacy、host、database与未识别prepare错误仍立即停止。

仍缺durable pending/failed状态、持久重试队列、图片公平轮转和源路径恢复。Coordinator仅best-effort dispatch刷新，错误不会覆盖原错误，但变更ID清空后没有可靠重发。该增量不是完整§6.2.5、G1或G0—G4。

Node/Electron最终均为1298 PASS/6 skips、144 passed files/5 skipped files；journal+polling target 25/25。source review有限范围APPROVE且reviewer未跑测试。v0.26 Node journal timing原JSON不可恢复，benchmark已恢复原SHA；新收据不能补作旧阶段证明，见[incident report](EVIDENCE_INDEX.md#v028)。Windows105项仍NOT-RUN。


## v0.33 当前范围与外部执行依赖

本轮关闭的是现有插件历史图片逐项状态/重试与清空协作的局部缺口，非完整 G0。旧格式探针和 Windows 验收结论保持不变。宿主 raw get 的静默 null 与 trusted owner/transport 仍须宿主改造，不能在插件层推断成功。

2026-11-02 只读核对 GitHub 默认 main 的 `.github/workflows/build-pr-plugin.yml`（blob `7e2139b8947d1188334c75a6ea3b3646cd33ddc9`）：只有单独 `['win32']` 走 Windows，只有单独 `['darwin']` 走 macOS，其余走 Linux。Paste 当前声明三平台，不能为申请 runner 改成仅 Windows 或在 Linux 脚本内私自 dispatch 云任务。现有 Windows G0/CMake 和 storage runner 可被明确的新 Windows job 调用，但根 workflow 不在当前插件修改授权内；托管 WindowsServer 结果也不等于 Win10/Win11 客户端矩阵。当前读取证据保留于本轮根收据。


## v0.34 主链接入前置与授权状态

[实施 ADR](IMPLEMENTATION_ADR.md)的有限设计门禁已接受，原[主链契约](HOST_V2_INTEGRATION_CONTRACT.md)的宿主实施仍未开始。A宿主隔离工作区、B根Windows workflow分别待用户审批，当前不得写入宿主或CI，也不能在落后main/security历史分支直接开发。

本轮仅保存pin `76addc` 的10文件静态审计与797项旧源字节/权限验证；不是general监听、可信current-policy、原生编译、Windows runner或目标应用结果。140提交比较的原响应未留存，StorageManager factory与安装包均未在该pin验证。v0.33运行测试只继承未重跑。Windows105+15、Win10/11真实客户端、G2本地格式闭环、G3独立crypto/六方向及G4全部保持原门禁；不能靠ADR或托管Server构建替代。[本轮根证据](validation/v034/v034-root-evidence.json)。


## v0.35 G3 独立加密设计与公开原语验证

[G3 ADR](G3_CRYPTO_ADR.md)完成独立安全设计复审，结论为 APPROVE DESIGN ONLY / NOT IMPLEMENTED。首审4项P1和2项P2、次审剩余1项P1和2项P2经定向修正后闭合；末次受审文本与当前仅状态/沿革更新后的文本分别绑定本轮根收据。publicationRoot绑定精确index/control checkpoint和删除水位；恢复包需可信anchor、RSK与独立Ed25519管理权，epoch cutover/历史keyring不能仅凭root MAC授权。设计采用最多32个lifetime domain的本地counter预算，不依赖恶意WebDAV提供全局allocator；provenance union、immutable wrappers与分阶段expected context/bootstrap边界一并明确。

V1仍是scrypt N=32768、旧AAD未绑定account/vault/model、固定凭据槽及先apply实体后处理附件的独立旧路径；新V2设计不复用其wire/AAD/key slot，未改产品代码、依赖、sync flag或接收端激活链。不能据设计接受声称V2加密已接入。

公开RFC5869/RFC7914/NIST AES-GCM用例每运行时14项标准原语KAT，另1次候选scrypt N=131072/r=8/p=1、maxmem192MiB的API/耗时观测；RFC8032两个Ed25519向量另各10项KAT。Node24.15.0、Node20.19.3、Electron41.4.0（ELECTRON_RUN_AS_NODE）各合计24项标准KAT+1次观测，子进程均exit0，均仅darwin/arm64。不是25项协议测试、NIST/FIPS认证、硬RSS/生产KDF预算或宿主应用运行；原始脚本、公开来源及运行日志仅保存在owned local artifacts，公开根JSON保存其哈希和限定摘要。非实施者已限定复核原语来源、脚本、日志与hash，无P1/P2；本轮不重跑这些用例。

组合协议known vectors、可信宿主key隔离、持久checkpoint/恢复与fault测试、Win10/11客户端及G3六方向仍未完成。实现测试、构建和原生探针本轮未运行；v0.33的1439/6等只继承。797项原源码选择集、字节/执行位与原§1–11不变，v0.34根收据保持原SHA；宿主/根CI仍未写入，A/B授权pending，无暂存、提交、推送或发布。完整目标active，goalComplete=false、gateComplete=false、G3Complete=false。详见[v0.35根证据](validation/v035/v035-root-evidence.json)。


## v0.36 V2 wire 与 Node crypto 库组件

新增独立`./v2` pure wire/schema/JCS/PBV2与`./v2-node` Node crypto组件，包括CSPRNG seal、HKDF/GCM/scrypt wrappers、control MAC和独立Ed25519签名、publication、readonly包及后继root/keyring恢复。授权fence和durable budget要求显式callback，无默认伪授权。详见[pure模块](G3_WIRE_IMPLEMENTATION.md)和[crypto组件](G3_CRYPTO_COMPONENT.md)。V1默认exports与调用链不改；原797项源码中仅package.json新增两个subpath，formatSyncV2仍关闭。

普通非实施者分别发现pure与Node各3项P2并经独立probe确认修复。Astra对实际crypto恢复链另发现2项P1和1项P2，4个原公开probe全部RED。修复曾被自动审批两次拒绝（原风险及缺少具体授权），未绕过执行机制。用户随后明确确认仅7源码和2测试的九文件修复与验证，原执行机制接受新授权后应用精确字节。原probe正文不改，修复后4/4 GREEN；Node24相关包11文件147项及严格类型边界通过。Astra基于实际九文件、trace与日志作受影响点LIMITED APPROVE，无本轮残余P1/P2；不是只审proposal，也不是完整G3安全证明。

独立Python cryptography generator给出12份公开固定输入golden records，fixture111522字节、SHA256 `cc7d06a489bbda8be501cf53d0750d81b8a04ff5ac043061fc60f176047f2e15`。Python/Node交叉向量仅覆盖组合库和受限ASCII/safe-integer输入，不是可信宿主、密钥隔离、远端同步或六方向实机证据。最终snapshot与三运行时同一测试集合的实收据绑定[本轮根证据](validation/v036/v036-root-evidence.json)；中间158/167项候选不能冒充修复后最终结果。

诊断原件保留：首候选两处TS2532、HOME重定向导致Python假缺包、首次runner hash缺口；820项候选167项通过仍早于Astra恢复链红测，其sameTestFiles=false来自有序数组比较，另以实际集合收据限定纠正。interop类型guard未放宽规则，旧210行摘要不替代当前213行源码。最终用安全修复后新snapshot和实际日志，不覆盖旧收据。

本轮componentOnly：可信宿主owner/authorizer、keychain/helper隔离、持久counter/budget/registry/checkpoint store、watchdog/current-policy、transport与activation尚未接入。Win10/11的105项原生与15项存储探针、真实应用格式闭环、G3六方向和G4未验收。原§1–11和完整P1标准不变；A宿主/B根CI审批仍pending，九文件授权不包含这些范围或Git发布。未暂存、提交、推送或发布，goalStatus=active、goalComplete=false、gateComplete=false、G3Complete=false。


最终安全修复后验证：Node20.19.3、Node24.15.0和Electron41.4.0 as Node各19文件189项通过，fail/skip/timeout均0；排序(path,count)集合一致。root tsc、workspace contract与Python3.9.6/cryptography50 oracle通过，111522字节fixture逐字节一致。最终823项源码aggregate 76b856c8d175a02827c90846d1d6b9294d01c593589d1eba04167db22b90aaae，相对原797项新增26、删除0、仅既有package.json新增两个exports。[本轮根证据](validation/v036/v036-root-evidence.json)绑定最终收据。未重跑全工作区1439测试、生产宿主、Windows或原生探针。运行summary冻结时sourceSecurityReview仍标PENDING；其后Astra实际LIMITED APPROVE及最终运行证据补充复核另行记录，不覆盖旧收据。


## v0.37 verification-only 持久预算组件

新增[verification budget有限实现](G3_VERIFICATION_BUDGET.md)：Node LMDB日志、验证预算与codec接线、unknown恢复锁定、32失败、prepare/promote和同步guard。设计ADR保留实施前快照状态；当前实现不是生产owner/完整G3。普通与Astra实际受影响点复核LIMITED APPROVE，无残余同范围P1/P2；NodeNext20文件79个specifier仅路径literal变更，旧九文件已授权应用完成，宿主A/根CIB仍pending。

最终candidate003：Node24/20/Electron各73文件568case=562PASS、6个精确fixtureSKIP；14个父进程case实际PASS，选集/状态digest一致。11个process checks均exit0且无timeout；roottypes、workspace contract、build、公共包双运行入口与strict NodeNext imports通过。845项源码aggregate cbfee85bd51cf63d3b5e75a9ef5a3ba40cfc3ecc8cc17dd10257cd3c0d289329，相对823基线新增22、改22（4config+18core/sync import）、删0。manifest原文件SHA和内部metadataDigest分开绑定[根证据](validation/v037/v037-root-evidence.json)，不混称。此前focused55PASS/1childskip和旧candidate仅历史证据。

日志事故必须保留：四个artifacts/pasteboardpro下build/nodenext stdout/stderr旧状态UNKNOWN，被误truncate后移走，无法排除旧日志丢失；没有restore/cleanup。空诊断日志不作成功证明；80份受保护收据保持原hash不能外推所有artifacts未变。

可信host owner/锁/resolver/key隔离/current policy、transport/activation、seal/checkpoint/registry、Win10/11的105+15、真实应用、六方向和G4仍未验；大规模容量/30s压力、事务内部kill/断电与反回滚也未验。after-reserve SIGKILL不替代这些证明。原§1–11与完整P1不变，flags off，无Git/发布，goalStatus=active、goalComplete=false、gateComplete=false、G3Complete=false。
