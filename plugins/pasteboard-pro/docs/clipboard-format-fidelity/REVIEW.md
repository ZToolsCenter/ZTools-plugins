# 格式保真技术方案独立评审

v0.32 当前增量：[精确清理身份与回灌抑制](HISTORY_CLEAR_BOUNDARY.md)。按用户限制，本轮源码、测试、构建、文档及验证输出均限定在 Paste 插件目录；宿主接线仅保留设计参考。最终收据见[v0.32 根证据](validation/v032/v032-root-evidence.json)。

v0.31 历史设计阶段仅补充[宿主接线](HOST_V2_INTEGRATION_CONTRACT.md)与[V2 计划/portable 契约](V2_PLANNER_PORTABLE_CONTRACT.md)设计候选，均 NOT-IMPLEMENTED。v0.30 实现和执行证据保持原样，完整 G0—G4 未通过。


v0.30 历史实现增量：[图片重试轮转与清空串行化](HISTORY_IMAGE_RETRY_ROTATION.md)；[根证据](EVIDENCE_INDEX.md#v030)；[独立审查](EVIDENCE_INDEX.md#v030)。Node/Electron Node 模式各 91/91 相关回归通过；实际 CJS 合成 SDK 两端红绿证明缺陷修复。完整 G0—G4 未通过。


v0.29 历史增量：[Windows 存储基础层](WINDOWS_STORAGE_FOUNDATION.md)；[根证据](EVIDENCE_INDEX.md#v029)；[独立复审](EVIDENCE_INDEX.md#v029)。Node/Electron Node 模式各 20/20 契约通过；Windows SDK 编译、15 项新基础探针和既有 105 项 G0 原生用例均 NOT-RUN，完整 G0—G4 仍未通过。

v0.28历史根证据：[root evidence](EVIDENCE_INDEX.md#v028)；独立源码review：[review](EVIDENCE_INDEX.md#v028)，结论为有限范围APPROVE；完整G0—G4仍未通过。
Windows 10/11 的105项原生cases仍NOT-RUN；v0.27 Windows source kit本轮未改动。Windows 12及后续版本需另行建立G0—G3门禁。
v0.27根证据与文档审计字段：[root evidence](EVIDENCE_INDEX.md#v027)。根收据记录`gateComplete=false`。
独立源码评审收据：[v0.27 independent review](EVIDENCE_INDEX.md#v027)，仅APPROVE有限范围source-kit producer修复，不代表Windows执行。

v0.24根证据：[root capsule](EVIDENCE_INDEX.md#v024)。
v0.26根证据与文档审计字段：[v0.26 root evidence](EVIDENCE_INDEX.md#v026)。最终字段见根收据。


版本：v0.32 V1 精确清理身份与回灌抑制；日期：2026-10-28。仅插件目录内实现与验证，完整 G0—G4 仍未完成。
Node/Electron矩阵与打包Worker执行由root提供独立运行收据；静态review不替代其执行，也不扩展到生产host、Windows或完整G0—G4。初审版本：v0.1；v0.3原设计复核：APPROVE（仅设计层）。v0.4将Windows10/11提升为首期必选；平台范围增补复核：两路APPROVE（仅设计层）。


v0.21历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v022)

v0.22历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v023)。

## 范围与方法

两个独立只读评审分别检查原生采集/写回可行性，以及持久化/同步/隐私契约；主 Agent 核对相关代码并修订方案。评审采用 code-review-expert 的职责、失败路径、数据完整性和安全检查方法。

核对工作区为 /Users/harris/Desktop/ZTools-plugins，实际开发分支 plugin/pasteboard-pro；宿主 /Users/harris/Desktop/ZTools 仅用作只读证据。当前宿主 checkout 是 fix/security-protocol-validation，未在该分支开发。

初审的 Electron 版本按实际安装的41.4.0与固定版本源码核对；没有采用latest新接口作为现有能力。初审仅维护方案/验收/评审三份文档；后续v0.5—v0.7实施记录保留为历史快照；v0.8历史评审和v0.9历史评审见文末与[实施状态](IMPLEMENTATION_STATUS.md)。各轮均不读取个人general剪贴板或个人数据库，已有UI/主题及其他插件工作保留，没有提交、推送或发布。

## 初审发现与修订

初审共 5 项 P1、6 项 P2；复核另补 1 项 P1、1 项 P2 及1处文档断链（P2），均已修订并通过独立复核。以下“已修订”只指文档契约，不代表运行时缺陷已经修复。

| ID | 等级 | 初审问题 | 最终修订与验收 |
| --- | --- | --- | --- |
| N1 | P1 | 发布失败无法表示系统剪贴板已被部分改写 | 第7节新增partial-write、已写/缺失表示key、版本、副作用和恢复结果；默认不恢复，停止队列且不模拟粘贴；P02。 |
| N2 | P1 | ready允许缺长度/摘要/blobRef，失败反而需伪造fidelity | 第5节改判别联合，ready/blob必需校验信息，文件引用单独约束；C01。 |
| N3 | P2 | macOS多item模型被直接套用于Windows | 第5节明确Windows单逻辑item，CF_HDROP为引用列表；跨平台无法表示须拒绝/显式转换；F06-mac/win。 |
| N4 | P2 | Electron41.4受限write字段漏bookmark | 第2/7节补text/bookmark/RTF/HTML/image，仍禁止循环writeBuffer伪造批写。 |
| N5 | P2 | 应用验收无可复现版本组合 | 验收文档增加OS/build、源/目标应用、host/plugin/native构建、策略/codec/预算与证据模板，G0冻结。 |
| D1 | P1 | 同步所有ready引用与私有格式local-only冲突 | 第9节区分本地完整manifest和远端portable投影，本机路径/私有refs不上传，源状态不被远端覆盖；M02。 |
| D2 | P1 | 现有先applyEntities后下载blob可能暴露不完整记录 | 第9节要求staged-import、全附件认证/摘要校验、activation与幂等恢复；M03。 |
| D3 | P1 | 图片/文件没有对应敏感扫描判定 | 第8节定义检查范围、passed/blocked/not-scanned及默认规则；文件正文与引用元数据分开；S01。 |
| D4 | P2 | V2前缀隔离缺少可测试边界 | 第9节指定独立host store/目录、V2前缀/type/ID/墓碑/vault；不得落入V1查询或清理范围；M01。 |
| D5 | P2 | 状态变化的feed未绑定不可变manifest修订 | 第6节定义manifestRevision、完整事件、nextCursor/retentionFloor/hostEpoch和幂等重放；R04。 |
| D6 | P2 | 未区分单条未知版本和整个索引协议未知 | 第9节前者opaque隔离继续，后者整轮停止且禁止回写索引；M04。 |
| R1 | P2 | 复核发现发布结果缺少冻结计划/修订和计划清单，难以审计partial子集成功 | 第7节结果携带planId/manifestRevision、planned/written/omitted；P03验证计划完成不改变源partial状态。 |
| R2 | P1 | 接收端更严格的隐私规则未进入同步激活门禁 | 第8/9节规定先在有界内存认证/解密并按本机当前策略重检，许可后才明文落盘/activation；拒绝不反向删除发送端；M05。 |
| R3 | P2 | 技术方案链接的REVIEW.md在复核读取时尚未创建 | 已补建本评审记录；交付前检查全部本地文档链接。 |

现有实现证据包括：core/types.ts 的固定payload；merge.ts 的逐字段clone；clipboard-store.ts 的V1 prefix/type；sync-runtime.ts 的先applyEntities后blob顺序；privacy.ts 的可选text及无text放行。相关入口见技术方案第12节。本轮没有修复这些实现。

主 Agent 另补充：PDF/SVG为条件支持；来源应用归属区分可信/推断/未知；解码展开资源预算；冻结回贴计划避免partial原快照被标完整；旧数据的经典UI切换不等于旧二进制/旧schema回退。

## 修订复核

- 原生/回贴评审：APPROVE；原5项及复核计划追溯、文档链接均关闭，无剩余设计级阻塞。
- 持久化/同步/隐私评审：APPROVE；原6项及接收端隐私门禁、文档链接均关闭，无剩余设计级阻塞。
- 主 Agent：核对关键现有调用链、全部文档修订与验收对应关系，接受设计层APPROVE。已补入实施提醒：activation前重读策略版本，变更则重检/中止。原生实现和任何计划用例均未执行。

## v0.4 平台范围修订评审

用户要求覆盖Windows10、11、12等；原v0.3将Windows闭环放在G4，不满足首期跨平台范围。v0.4变更仅涉及这三份文档：

- macOS、Win10和Win11同为首期P1，G0/G1/G2并行验证；G3必须双向跨平台同步，单端不能结案。
- Windows明确监听/锁/延迟渲染、原生格式映射、资源所有权、partial-write、UIPI及会话边界。
- 当前宿主Windows打包与native仅核实x64；ARM64另列产物门禁，不宣称已有支持。
- Windows12纳入未来正式版本目标；微软当前发布目录未列该名称，取得正式系统/SDK后执行相同矩阵，不能虚构build或通过记录。
- 验收增加逐OS/build/应用执行规则和W01—W08；Windows原生/安装包/应用测试仍全部NOT-RUN。

独立范围审阅给出的11项Windows增补建议已纳入。v0.4最终结果：

- 原生/平台复核：APPROVE，无P1。补充P2已修订：手动粘贴提示前确认writeRevision仍有效，被覆盖则superseded；不承诺随后手动读取无竞态。
- 持久化/同步复核：APPROVE，无P1。补充P2已修订：M类显式展开六个方向，Win11矩阵记录edition及生命周期。
- 主Agent补充：本机macOS运行证据不能外推Windows；Windows序号回绕/0值与平台来源身份规则进入门禁，避免照搬mac bundle ID排除逻辑。收尾P2已补：加密来源元数据明确平台身份，portable仅传策略许可的稳定ID，不传本机exe路径；缺失/脱敏身份按严格策略拒绝，M05覆盖。
- Windows12/后续版本仅是待正式环境验证的兼容目标，ARM64是待原生产物验证的条件目标；所有系统/应用测试仍NOT-RUN。

结论只批准跨平台方案设计，未实施、未提交、未发布，也不等于Windows或macOS实机验收通过。

## 尚未验证的实施门禁

1. G0：macOS与Windows10/11并行原生POC、可审计模块、格式/版本一致读取、helper超时与partial-write、Electron41.4实际架构产物、版本和资源预算冻结。
2. G1：文件/LMDB/宿主目标提交与重启恢复、延迟ready事件、游标过期、磁盘满和GC故障注入。
3. G2：macOS、Windows10、Windows11各必选build/架构分别执行合成数据真实回贴，具备字节/系统发布/应用三层证据；Windows增补W01—W08。
4. G3：Win10↔Win11、Windows↔macOS的V2多附件E2EE往返、portable投影、旧客户端隔离、未知版本、设备策略差异和staged-import恢复。
5. Windows12及后续正式版、Linux、Office/设计软件私有格式各自门禁；Windows10/11已移入首期，不能留在后续阶段。

以上全部为NOT-RUN。方案评审通过只表示设计可以进入G0验证，不代表原生可行性、实现、生产或发布验收通过。

## 资料

- [技术方案](TECHNICAL_PLAN.md)
- [验收矩阵](ACCEPTANCE.md)
- [Electron 41.4.0固定实现](https://raw.githubusercontent.com/electron/electron/v41.4.0/shell/common/api/electron_api_clipboard.cc)
- [Microsoft剪贴板操作](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations)
- [Apple NSPasteboard](https://developer.apple.com/documentation/appkit/nspasteboard)

## v0.5 G0前置代码审查

本轮进入实施，新增core V2 schema、隔离native探针与构建/证据入口。两路审查分别覆盖core/runner/macOS，以及Windows隔离/资源/格式处理；旧v0.4设计通过不等于本轮代码或整个G0通过。

| 缺陷 | 修订与反例证据 |
| --- | --- |
| P1 journal满页可越过latest head | 所有页限制next/event <= latest，且非法BigInt输入safeParse不会抛；core反例通过。 |
| 文件引用trim改写有效尾空格 | 改为无变换校验，原路径/URL尾空格保持。 |
| P1 首个格式可超总快照字节预算 | 先拒单格式大于snapshot上限，再无下溢累计；Mac capture/publish边界通过。 |
| P1 Windows创建窗口时错误使用空成员HWND | 回调传递真实HWND给HandleMessage/DefWindowProc；静态复核关闭，待Windows运行。 |
| P1 Windows忽略未知格式仍报committed | 未物化格式进入planned/missing及unsupported；空clipboard也不报完整，未知格式不回放；静态复核关闭。 |
| Windows合法CF_HTML -1及片段offset、CreateDesktop副作用、早退Close | 增加合法/非法fixture、精确边界，创建即记清理状态，统一ClipboardLock；静态复核关闭。 |
| Mac bool/小数/非有限revision可被截断 | 严格安全整数校验，发布前拒绝且不改写；新边界case通过。 |
| Mac预写失败未说明副作用、异常format名称超限 | 统一false副作用结果，名称脱敏；文本10MiB硬上限与PNG分离验证。 |
| 未确认发布被误报全missing | partial-write/publication-unconfirmed允许全written+空missing；真实隔离写后注入readback失败的case通过。 |
| probe缺case/混合not-run仍可能PASS | 冻结Darwin33/Windows21个case；缺失、单一伪case、任何not-run不能得到PASS。 |
| 报告自由文本/额外字段与缺指纹 | 逐层strict、固定detailCode/unverified、受限格式摘要；PASS强制native/runner SHA、binary SHA、runtime和build/selftest命令。 |

最终复核：

- core/runner/macOS：APPROVE（仅前置G0代码审查）。reviewer独立运行report 9/9、V2 targeted及发布契约测试；主Agent全core 84/84、workspace tsc/contract通过。
- macOS原生：主Agent独立在Node24与Electron41.4 Node模式各33/33，源码/runner与binary指纹记录完整；没有触碰general clipboard。
- Windows：静态代码复核APPROVE；未做MSVC编译、Win10/11运行，7个格式case仍not-run。
- 完整G0、生产host/preload/IPC、完整标准codec/来源/隐私、RSS/超时故障、应用回贴与G1—G4均未验收。当前gateComplete=false，详见 [实施状态](IMPLEMENTATION_STATUS.md)。

本轮没有Git add/commit/push或发布。代码审查结论不覆盖未执行的系统测试，也没有把本地Node/Electron隔离用例外推Windows。


## v0.6 标准格式与看护实现复核

本轮独立只读审查分别覆盖 macOS codec/文件引用、Windows原生与共用codec、Node看护与构建收据；主 Agent 审查关键调用链并执行最终独立验证。以下关闭只针对所列代码路径，不批准整个G0。

| 问题 | 最终修复与证据 |
| --- | --- |
| Node exit时丢失最后RSS样本、零观测可PASS | 收尾等待有时限的在途采样，晚到有效峰值仍参与阈值判断；零观测失败。首次有效观测后才RUN。实际内存分配子进程超限终止，Node/Electron各11项看护测试通过。 |
| watchdog旧/缺项receipt可支持PASS | 共用完整source inventory，校验平台/架构/G0/PASS、case/resource/runtime、binary路径/摘要及精确当前source集合；4项收据回归，输出绑定按hash保留的原始receipt和测试脚本SHA。 |
| Mac file fixture仅接受手工macos输出目录 | 固定darwin与macos布局均受canonical/symlink/越界guard约束；主CLI文件引用用例通过。 |
| Mac TSV单格/单列被错误拒绝 | typed TSV单格及多行单列保原bytes，无plain fallback冒充typed支持。 |
| Mac颜色secure根类校验不足/错误plist值抛异常 | 解档前限制binary plist/object graph/class/ICC/数值，逐值类型检查并捕获预检异常；拒绝pattern/image/URL及18种真实wrong-type plist；标准NSColor consumer样例通过。 |
| Mac解码预算只计调用线程/缺展开额度 | 改进程CPU时钟，限制估计及实际decoded bytes、像素、帧数，调用前后观察CPU/壁钟；外层终止。压力测试未跑，不宣称硬CPU/RSS限制。 |
| Mac已删除/移动/不可读引用仍可发布 | 独立file-reference模块仅publish清空前stat/access；失败保context/原board且false副作用，revision变化优先superseded；存在file+dir顺序及4类拒绝/版本case通过。检查不保证目标应用权限或未来可用性。 |
| Windows key/format ID错配 | 清空前绑定key/name/encoding/ID与明确物化元数据；bitmap/DIB错配及注册格式错误ID拒绝源码回归。WinAPI未跑。 |
| Windows DIB合成palette导致roundtrip不完整 | 实现有界LOGPALETTE/GetPaletteEntries/CreatePalette与GDI ownership，保留原DIB/DIBV5/BITMAP用例；GetObject输出4字节对齐，flags仅0/1/2/4，组合拒绝测试。 |
| Windows来源/上限声明 | 标准OS表示origin unknown，具体转换明确标记，不冒称源文件；capture/publish统一32项，超限明确不完整。 |

最终局部结果：Node24与Electron41.4 Node模式分别51/51原生合成用例；真实AppKit延迟provider终止1/1；报告10、source4、Node看护11均通过，Electron看护另11/11；可移植C++ CTest1/1、33个named checks通过；workspace类型/契约通过。Windows SDK/MSVC/WinAPI/真实应用仍NOT-RUN。完整指纹见[实施状态](IMPLEMENTATION_STATUS.md)。

静态复核关闭了上述P1/P2；未把未知格式、未实现P1或环境缺口删除。按当前源码盘点新增[剩余清单](G0_REMAINING.md)，其中Windows TIFF/URL/确认的JPEG/颜色、读取前隐私/来源、PNG解码安全、文件可访问性、延迟/API失败与预算尚未实现完整。生产V1未接线，无提交/推送/发布。


## v0.7 Windows G0与发布确认复核

本轮独立只读评审覆盖Windows URL/PNG、读取前策略、Capture锁边界、真实延迟fixture、自测的系统合成格式及发布读回。主Agent核对接线与全部目标源文件，原型仍不接生产V1。以下关闭仅指源码，全部Windows SDK/MSVC/WinAPI与目标应用保持NOT-RUN。

| 问题 | 最终修订与证据边界 |
| --- | --- |
| PNG重复WIC深解码 | Publish只在Open前PrepareFormat解码一次；锁内计划读回只复制/有界结构验证，不再WIC。 |
| Capture在OpenClipboard期间WIC深解码 | 先锁内复制与revision/owner检查、Close后验证owned bytes。真实WinAPI源码case检查锁已释放并在验证回调执行第二次真实发布，旧快照仍按captured revision返回，observed新版本独立。未运行。 |
| ANSI/非ASCII fixture受MSVC默认编码影响 | native及portable CMake使用`/utf-8`；URL A记录ACP，报告要求Windows codePage。helper ACP不证明producer编码，不冒称精确跨平台投影。 |
| 注册格式名及AUMID的比较规则混用 | OS注册名不区分大小写、canonical payload metadata仍严格；EXE按Windows路径比较，AUMID严格区分大小写并拒绝prefix/其他namespace。 |
| 创建时间查询失败仍可能确认进程身份 | 分离owner稳定观测与进程实例确认；实例确认需要creation time，排除/strict必要身份缺失拒绝。显式allow-unknown且无排除时保持unknown而不误报身份确认。 |
| history与cloud marker语义混用 | monitor/history禁止本地普通载荷读取；cloud=0/畸形禁止云但保留允许的本地采集；allow marker不覆盖用户规则。portable29项通过，18项WinAPI源码case未运行。 |
| 捕获后默认只有4项seed，忽略系统合成格式 | seed子集必须全留存；只接受文档合成闭包内额外项，冻结实际完整Capture后重发/逐项比对，第二批只改HTML。partial写按完整Set计划分区，不把合成项充作显式written。 |
| 全部Set接受便committed，缺逐项读回 | 按冻结计划读回；元数据默认严格、原bytes默认一致。仅验证过的规范CF_BITMAP允许非像素header/padding差异，RGB变化仍失败，DIB/PNG不放宽。 |
| P1 Close后被新复制覆盖却误确认本次发布 | 锁内独立write_revision，关闭后读取observed_revision；不同则publication-unconfirmed，不把新版本当本次写成功、不自动覆盖新复制。测试after-close hook一次性移出，内层Publish不递归。 |
| 故障fixture脱离外部看护/Windows CRLF | 两端裸fault-mode要求supervision环境；Windows真实WM_RENDERFORMAT owner/reader fixture已实现，JS规范化CRLF并先验证当前source/binary/PASS收据。Windows未运行，macOS实际provider看护通过。 |
| P2失败路径固定case漏记 | 私有clipboard非空且恢复成功时补station-cleanup/pass；初始Publish失败时补second-batch-retention/not-run，不加进另处已记同项的共用helper，避免重复。独立静态复核关闭，Windows未运行。 |
| 主自测文件超过规模警戒 | 按职责拆出self_test_registry，把case注册与场景分开；当前代码文件均少于500行，CMake/include/用例注册闭包已检查。 |

URL/PNG、策略、延迟fixture、合成全集与发布读回的独立静态复核均为APPROVE，无这些范围内已知P1/P2。作者自测之外，主Agent独立普通及ASan/UBSan构建通过125个portable named checks，JS 26/26，macOS Node24与Electron41.4各51/51，真实延迟看护2/2；完整收据/source/binary再次核对。源码包全新解压15项JS测试通过，仅证明包内工具完整，不证明Windows运行。

仍未关闭的实质缺口保留在[剩余清单](G0_REMAINING.md)：完整URL原始留存、TIFF/确认JPEG/颜色、Mac preflight、Windows HDROP可用性、API真实失败、逐格式摘要收据、内容隐私与预算；APNG未支持。没有把当前scheme白名单改写成最终P1范围，也没有把进程owner/AUMID当可信内容来源。G1—G4、生产、实际应用和Windows平台门禁未通过。

## v0.8 URI/IRI与Windows文件引用进展复核

本节记录v0.8更新，不覆盖上文的历史记录。G0—G4目标及Windows 10/11与macOS同为首期必选保持不变；生产V1未接入。Windows没有可用运行环境，因此任何WinSDK/MSVC/WinAPI或真实应用结果均保持NOT-RUN。

| 问题 / 变更 | 当前实现与证据边界 |
| --- | --- |
| URI scheme白名单会丢弃合法系统表示 | 共用absolute URI/IRI syntax按[RFC 3986](https://www.rfc-editor.org/rfc/rfc3986)与[RFC 3987](https://www.rfc-editor.org/rfc/rfc3987)检查语法，不限scheme，不做I/O/open/normalize/percent decode；捕获与回贴保留原始bytes。合法语法不是打开/执行授权，也不保证scheme-specific semantics。common URI、Mac/JS绑定与wrapper边界独立复核APPROVE；Windows运行未验。 |
| macOS URL边界与Windows A/W容量混淆 | macOS public.url严格UTF-8/64KiB，public.file-url继续使用专门约束。Windows A/W native buffer含NUL均限64KiB；文本validator cap为65535 UTF-16 code units，防止ANSI数据经UTF-16验证时被错误减半。A-only的`validation_code_page`记录helper GetACP；共享比较器纳入比较，缺失/变化拒绝，但不代表producer/target来源编码。wrapper静态复核APPROVE。 |
| CF_HDROP只做结构校验，发布前缺本机可用性检查 | 现在所有Prepare后、Open/Empty前只读检查引用metadata/permissions，不调用ReadFile、不变更原始引用bytes；失败保留现有clipboard，检查中的新revision优先返回superseded。known symlink/junction path/access源码已接入，独立静态review APPROVE并关闭offset validation与fixture路径复用两个P2。检查使用OPEN_REPARSE_POINT并请求OPEN_NO_RECALL，但没有跨路径filesystem事务；组件/目标可在检查中/之后替换，不能保证最终应用可访问/复制，也不声称排除所有未知filter或recall。官方最多63个reparse point，源码拒绝第64项（长目标可能令上限更低）；70项case未直接覆盖63/64边界与损坏known-tag缓冲区。cloud/remote driver行为、TOCTOU与完整故障注入待Windows实测。WinAPI未运行。 |
| G0证据更新 | 主Agent独立普通及ASan/UBSan portable构建各CTest 1/1、binary各150/150 checks；JS report11 + source5 + watchdog11 = 27/27；Mac Node24与Electron41.4各52/52，真实AppKit watchdog 2/2。Windows target36、portable exact C++ closure10、Windows inventory73（含runner）静态核对通过；Mac native/runner source inventory为28，两个probe binary SHA-256相同：`7b3191153f0dce4ad0a9686d92df8378e8ed0e55ee68fcc7b8fbfeb5309c0936`。具体证据路径见[实施状态](IMPLEMENTATION_STATUS.md)。 |
| Windows case与源码包 | 固定70个Windows case已包含12个file-reference边界用例，但全部WinSDK/MSVC/WinAPI NOT-RUN，且缺63/64跳数与损坏known-tag直接用例。v0.8工具包含87 payload+manifest、88 entries，SHA-256 `bfdfafab627feed7f376af99859f6a1e28ad098428dfcc62b08ac546f16b59b0`；打包worker在fresh extraction运行Node24 report/source 16/16。ZIP/source closure证据仅证明源码包完整，不证明WinSDK/API或应用运行。 |

本节对共用URI语法/macOS与JS wrapper的静态复核结论为APPROVE；HDROP metadata preflight接线与revision优先级的复核为APPROVE，范围不含跨路径原子性或TOCTOU消除。Windows file-reference path/access源码独立静态复核为APPROVE；CMake36、portable exact closure10、inventory73及include依赖检查通过。尚缺63/64跳数和损坏known-tag缓冲区直接用例，Windows build/runtime仍未验收。portable与macOS收据只证明对应测试路径；Windows运行、完整格式/应用矩阵及G0整体均未验收，所有probe仍为`gateComplete=false`。Windows TIFF、确认JPEG注册名、scalar color、真实API失败矩阵、逐格式收据、内容隐私和预算压力仍是G0缺口；G1—G4仍未完成。

## v0.9 Classic TIFF与Windows reparse边界复核

本节记录源码冻结后的v0.9实现与独立静态review，不改写v0.8历史结论。G0—G4总体目标不变，生产V1未接线；Windows没有可用运行环境，因此81项WinSDK/MSVC/WinAPI/WIC原生case及目标应用矩阵仍全部NOT-RUN。portable通过和静态APPROVE不表示Windows运行验收。

| 问题 / 变更 | 当前实现与证据边界 |
| --- | --- |
| Windows缺少CF_TIFF验证 | 已加入`key=tiff`、`encoding=tiff6-bytes`、`CF_TIFF` identity的Classic TIFF 6 Capture/Publish接线。Capture在锁内取得拥有的logical bytes并完成结构检查，Close后用WIC验证所有main IFD frame；Publish在Open/Empty前Prepare时深验一次，锁内计划读回不重复WIC。原始表示bytes不被预览或解码结果覆盖。8项Windows原生case已接入：byte roundtrip、多页、16-bit alpha、坏LZW/结构拒绝、像素预算、Close后Capture、错误format ID、validator异常partial保留其他格式；全部Windows NOT-RUN。 |
| TIFF指针图与长度边界不明确 | common Classic TIFF 6 parser支持LE/BE、多main IFD页、受限SubIFD/EXIF/GPS/Interop、strip/tile/free/JPEG/typed opaque ICC引用。逻辑长度取最大被引用extent；只允许分配末尾全零padding，不可解释的非零尾部按ambiguous拒绝。BigTIFF、未知field type、自定义私有pointer graph明确unsupported。 |
| TIFF字段类型/样本与预算误拒或越界 | 已按字段约束type/count；BitsPerSample接受正SHORT（包括6-bit），Exif/GPS/Interop links要求LONG count=1，type 13只接受SubIFD，PhotometricInterpretation要求存在且SHORT count=1；Compression缺省为1，显式值只要求SHORT count=1，结构层不做compression枚举白名单，实际压缩解码由WIC验证。边界覆盖raw 20MiB、32 main frames、256 IFD nodes、depth 32、262144 fields、4096 refs、最大图像单边8192 pixels、每页32M pixels。所有页native sample估算累计≤256MiB，所有页RGBA32展开估算另有独立≤256MiB上限；没有二者相加的联合限额。CPU/wall/RSS及实际WIC内存压力尚未冻结，观察值不是硬限额。 |
| TIFF fixture表述和规范化样本不准确 | 正向fixture已按tag排序并正确以NUL结束ASCII值；错误的“overflow”case改为实际越界/预算情形。独立review关闭tag-specific types、6-bit、必要tags和fixture等5个P2。 |
| WIC公共封装在异常路径分配错误文本 | 共享WIC wrapper的`bad_alloc`、`length_error`及固定error setter分配安全已修订并经独立review APPROVE；PNG原行为保留，避免继续维护重复的COM/budget/stream路径。逐页GUID/count/dimensions与CopyPixels RGBA32只证明像素可读，不证明16-bit/alpha渲染和颜色外观一致。 |
| reparse wire约束与真实链接访问接线 | common parser已拆出并由Windows path/access实际调用；33项portable cases覆盖偏移/长度、known tag与flags、Reserved字段忽略、UTF-16、16KiB边界、失败清空、63/64 hop guard。规范语义按Reserved SHOULD为0但MUST ignore；mount点仅拒绝完整`.`/`..`路径组件（`a..b`保留），relative symlink允许`.`/`..`。独立review APPROVE。 |
| 只测hop guard，未有Windows路径链用例 | 新增3项owned-junction原生case，实际遍历63-hop允许、64-hop拒绝与cycle拒绝；源码/静态review完成，Windows SDK/API仍NOT-RUN。33项portable guard不能证明filesystem traversal、driver行为或DeviceIoControl错误/短读。 |
| 文件引用检查可能被误读为原子安全 | 检查仍只读引用metadata/permissions，不调用ReadFile或改写原始path bytes。`OPEN_REPARSE_POINT`只约束被打开检查项；`OPEN_NO_RECALL`是给filter的请求。检查不是跨全路径文件系统事务，路径组件/目标仍可能在检查中或之后替换，也不保证不触发未知filter/recall、目标应用可访问或可复制。TOCTOU、ACL、cloud/remote/driver行为要在Windows实测。 |
| G0本轮独立证据 | portable普通及ASan/UBSan构建/CTest各1/1，binary各244/244 named checks（150既有+33 reparse+61 TIFF），35项sourceHashes执行前后不变。普通binary SHA-256：`7b828ba691822d1946cf3a17fe84c6fce2f4fd7fdbe8b33b3c3322310c115b4c`；ASan/UBSan：`6aa49a09e8048c488d99c2d805b0a49645ba04011cf7f971a4e1f8a27a144da5`。JS report/source/watchdog 27/27；macOS Node24及Electron41.4各52/52，AppKit watchdog 2/2，Mac native source 28、binary SHA-256 `7b3191153f0dce4ad0a9686d92df8378e8ed0e55ee68fcc7b8fbfeb5309c0936`。Windows case固定81项、CMake47、portable closure19、source inventory93（native67+common20+runner6）；100个C++头源均<500行，最大499。Windows运行仍NOT-RUN。 |

以上代码复核关闭本轮TIFF field/type/fixture、reparse Reserved/dot语义及WIC异常路径安全的已知静态问题。v0.9.0 ZIP现包含114个payload与manifest（115 entries），SHA-256为`b98acd500c43add02ccb9fe60b906c2624fcd29efc34ca1c92d4b03963ab0cce`；打包worker在fresh extraction实际运行Node24 report+sources 16/16并验证JS module closure。root独立核验包内文件与live native/scripts字节一致、manifest逐文件SHA/length、CRC/path、binary exclusion、sidecar、源码/runner、CMake47与native C++ include闭包；workspace report/source/watchdog 27/27是root另行运行，不是fresh extraction 16项测试。包无二进制，不能证明Windows API/WIC运行。生产接线、内容隐私、Mac preflight、Windows SDK/WIC/真实路径及应用证据、逐格式收据和资源压力仍未完成；G0整体`gateComplete=false`，G1—G4仍未完成。

## v0.10 macOS capture preflight

本节追加v0.10实现记录，不改写v0.9及更早评审。整体G0—G4 scope不变，G0仍未完成且生产V1未接线。`PBFCapture`现在与publish分离，limits/result contracts进入共享`ClipboardProbeContracts`；root确认既有publish validation与发布尾部逻辑未改变。Mac registry新增24项，总计76项。AppKit marker no-read问题已修复。最终冻结源码/二进制下，Node24原生probe 76/76 PASS、Electron41.4/Node24.15原生probe 76/76 PASS、AppKit延迟读取watchdog 2/2 PASS；Mac source inventory 35项，binary SHA-256 `f43139fe5855837ad1178df4b6d3e1ce4f9e0b9bc6d60405a6c0c31969ad17e0`。一次较早的monitor unavailable运行被guard拒绝并确认退出（不是case FAIL），记录见[运行收据](EVIDENCE_INDEX.md#v010)；后续隔离重跑已通过。不将v0.9的52项与28源收据冒充v0.10验收。

| 范围 | 当前实现与限制 |
| --- | --- |
| 默认策略及来源归属 | `allowUnknownSource=false`为strict default。捕获来源始终unknown，没有可信producer API；Apple的`NSWorkspace.frontmostApplication`返回的是当前接收键盘事件的前台app，只作heuristic hint，不能证明剪贴板producer。匹配排除hint时拒绝；producer未验证时任意非空excluded bundle list都fail closed，即使前台hint不匹配。显式unknown allowance只在无排除规则时允许探针继续采集，receipt仍保unknown。旧`PBFCapture`为私有命名board readback显式allow unknown，不是生产默认，也不构成已完成的known-app exclusion功能。 |
| 读取前marker | 先读取所有item的type列表，再统一执行policy。7个敏感deny marker（3个nspasteboard.org通用内容标记+4个legacy标记）按presence拒绝整个snapshot，不读取marker values或普通payload。source与remote markers只记录presence，不证明producer可信，也不授予cloud permission。上述marker semantics是生态约定，不是macOS强制访问控制。AppKit的`NSPasteboardItem`不接受含空格旧Typinator tag `Pasteboard generator type`的直接声明，fixture使用legacy `declareTypes`/`setData`；现代`item.types`可能给出dynamic UTI，策略只检查四个已知legacy tag经`UTType`以`nil`和`UTTypeData`查询得到的缓存精确别名，不将`dyn.*`作为统一拒绝条件。later-item用例以首项真实`NSPasteboardItemDataProvider`、第二项concealed marker验证跨item顺序；normal reader路径的`provider.callbackCount=0`证明marker preflight前没有请求首项payload。[NSPasteboard](https://developer.apple.com/documentation/appkit/nspasteboard)说明pasteboard可包含多item；[NSPasteboard.org](https://nspasteboard.org/)提供跨app标记约定，不是OS policy；[NSWorkspace.frontmostApplication](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)只定义frontmost app。 |
| 收据与捕获权限 | receipt只返回固定codes/booleans，不输出bundle IDs、marker values或剪贴板内容；`contentScanStatus=not-scanned`。`captureAllowed`只决定G0探针是否可继续构造内存快照，不能授权持久化、预览、同步、粘贴或V2 `ready`/`durable-ready`。私有G0 probe的capture status `ready`仅表示已在内存取得请求codec bytes，receipt为`contentScanStatus=not-scanned`，不表示敏感内容已扫描。正文内容扫描、当前策略重检、接生产与隐私策略仍未完成。 |
| revision与异常 | capture在types枚举/policy后以及每次普通数据读取前后检查changeCount；任一变化返回superseded并丢弃staged payload。reader/source hint异常不带出异常文本或用户数据。 |
| 固定用例 | 新增24个case，覆盖pause/history/default strict unknown、frontmost非producer、匹配与不匹配排除规则、3种universal deny markers、4种legacy markers、later-item marker、显式unknown、source marker、invalid config、revision race、异常隔离和remote marker不授予cloud。case ID与验收范围见[ACCEPTANCE](ACCEPTANCE.md)。静态源码存在不等同Node/Electron runtime通过。 |

独立门禁仍包括Mac trusted producer与功能完整的known-app exclusion、内容隐私/扫描、general monitoring、生产host/preload/IPC及源目标应用矩阵；Windows81项仍NOT-RUN。工具包v0.10.0为Windows-only，含114个payload+manifest、115 entries，SHA-256 `ef223caf953ece6cbb918ee10f9f0b1d1c7cff6561797b936ca11d390a37f541`。root独立验证最终ZIP的CRC/path、114个payload的SHA/length、live bytes/includes/imports、sidecar与无二进制，并fresh-extract运行Node24 report+sources 16/16 PASS；root工作区JS report/source/watchdog另有27/27 PASS。ZIP中Darwin registry IDs不包含Mac实现。G0保持`gateComplete=false`，G1—G4均未完成。

## v0.11 Windows逐格式回合收据

本节追加v0.11收据实现复核，不改写v0.10 Mac preflight与更早版本历史。整体G0—G4目标不变，生产V1仍未接线。Windows新报告在独立顶层`windowsFormatReceipts`提供Capture→Publish→Capture字节证据；它不是Mac `formatSummary`，不宣称来源身份或应用支持。

| 项目 | 当前实现与证据边界 |
| --- | --- |
| Receipt分组 | 7个成功报告必需group：rich formats、TIFF、native images、wide HDROP、ANSI/OEM/LOCALE、URL A/W、ANSI HDROP。固定9项case另含SHA-256 known answers和invalid-binding拒绝。16个`formats.key`和组内必需表示有严格allowlist。 |
| 回合与修订绑定 | 用seed Publish→Capture获取完整实际format set（包含系统合成项）→以captured旧source revision Publish→Capture readback；仅在sessions关闭后，从owned logical bytes生成摘要。source revision须与expected一致，write/readback/observed匹配且都为非零DWORD；不要求递增序号，允许非零wrap。Capture/Publish API与adapter未修改，新collector位于其外。 |
| 字节/哈希 | planned/readback分别记length、SHA-256、codec、encoding、fidelity、materialization和comparison；每组32行上限，planned与readback的总byte预算分别为20MiB。CNG `BCryptHash`摘要只覆盖logical bytes，不含`GlobalSize`尾部padding，也不额外读取剪贴板。普通格式要求字节一致；仅CF_BITMAP可声明`visible-rgb-compatible`。哈希不是来源证明。 |
| 严格信息边界 | `sourceOrigin`固定unknown；helper ACP/OEM只说明执行环境。ANSI URL用`urlCodePage`，ANSI HDROP只用`validationCodePage`；不得互换或解释为producer代码页。禁止正文、路径、PID、source app、raw format ID、自由格式名和任意系统错误文本；未知metadata、prototype/inherited keys、错hash/绑定或超额预算拒绝。 |
| ANSI fixture前置条件 | 默认Unicode文件fixture不变，ANSI HDROP用独立owned fixture与ASCII叶文件名。完整绝对checkout路径前缀必须能由当前GetACP无损往返，否则该ANSI case记NOT-RUN、G0不得PASS。这是测试fixture前置条件，不是产品路径支持限制；v0.11 source kit README已写明，并经root核验。 |
| 静态复核与收据状态 | CNG指针constness、ANSI HDROP早期context拒绝、palette fixture提取后物化丢失、JS inherited-prototype allowlist绕过、Windows误接受Mac `formatSummary`等审查问题已修复；独立静态review APPROVE，无已知P1/P2。Windows CMake51并链接Bcrypt、portable closure19、source inventory100（native73+common20+runner7）；133个native `.cpp/.mm/.h`均<500行。Windows SDK/MSVC/WinAPI/BCrypt KAT/WIC与90项native case全未运行。 |

v0.11 JS report/source/receipt/bounded共43/43 PASS，其中receipt validator 16项；Mac Node24和Electron41.4/Node24.15当前源码各76/76、AppKit watchdog 2/2 PASS，source36、binary SHA-256 `f43139fe5855837ad1178df4b6d3e1ce4f9e0b9bc6d60405a6c0c31969ad17e0`。v0.10 source35的相同76×2与watchdog结果仅是历史收据。v0.9普通与ASan/UBSan portable各244项证据同样只作历史背景，本轮未重跑。Windows v0.11源码包已生成，123 payload+manifest、124 entries，SHA-256 `564e613ad13d5bb0aff6cb7fe991c98c7842e7bd36597dba766d36278b17e03e`；打包worker验证包CRC/manifest/path/live source/CMake/include/JS import闭包；root独立核验最终包的全部123 payload SHA/length、live native/scripts/fixtures一致性、sidecar、CRC/path、无二进制及README ACP前置条件，并fresh-extract运行report/source/Windows receipt三脚本32/32 PASS，证据见[sourcekit收据](EVIDENCE_INDEX.md#v011)、[fresh-extract测试输出](EVIDENCE_INDEX.md#v011)和[本轮root汇总](EVIDENCE_INDEX.md#v011)。Win10/11真实Windows API、CNG known-answer实际调用、WIC、源/目标应用与ANSI fixture门槛尚未验收。内容隐私、生产host、durable journal及G1—G4仍未完成，所有整体probe保持`gateComplete=false`。

## v0.12 Windows Clipboard API故障注入与资源所有权

本节追加v0.12源码复核，不改写v0.11及更早收据。G0—G4范围保持不变，生产V1未接线。Windows新增私有per-adapter `ClipboardApiFaultPlan`与`ClipboardNativeApi` wrappers，覆盖OpenClipboard、EmptyClipboard、SetClipboardData和CloseClipboard；无注入时转发真实系统API，注入失败则在native调用之前返回。API attempt计数与native-forward计数分别统计，因此15项case验证adapter故障分支和ownership，不是kernel/Win32在真实故障条件下的运行证据。

| 复核项 | 当前事实与边界 |
| --- | --- |
| case新增 | 固定registry从90增至105；新增Publish 12项与Capture 3项。API case的精确ID和预期见[验收矩阵W12](ACCEPTANCE.md)。第三参数控制的旧pre-loop Set-index cases仍保留，不计作新wrapper API调用失败。Windows105项全部NOT-RUN。 |
| Close语义 | 显式Close失败保持保守未确认，即便析构中的第二次Close成功也不覆盖失败结果。Persistent double-Close用例仅由私有window-station fixture直接调用raw `CloseClipboard`清场，不证明Windows内核/session实际清理成功。真实资源耗尽、权限、Close失败与session清理仍需Win10/11验证。 |
| Handle所有权 | Publish prepared格式的lifetime observer为私有`noexcept`测试钩子，观测实际`GlobalFree`/`DeleteObject`结果。成功转交给系统的handle不由本地再次释放；Set失败或从未尝试转交的资源需释放一次。Observer不替代OS资源管理证据。 |
| 代码拆分与回读断言 | Publish核心拆至`clipboard_publish.cpp`；prepared-format三个RAII方法拆至`clipboard_prepared_format.cpp`。Bitmap readback用例校验实际clipboard format metadata和RGB内容，不以GDI object size替代格式正确性。 |
| 源码与闭包 | Windows CMake57并链接Bcrypt，source inventory109（native82+common20+runner7）；portable exact-source closure19保持不变。142个native `.cpp/.mm/.h`均少于500行。Windows原生SDK/API没有执行。 |

本轮复核指出的新增测试header外层namespace缺失和bitmap实际metadata/RGB断言问题已修复并冻结。未把fault wrapper描述成kernel-level seam，也未宣称system clipboard、Windows session或资源耗尽路径已通过。Capture/Publish普通无故障行为经与v0.11源码归档对比保持一致；本轮只记录源码边界，未以此代替Win10/11构建/运行验收。

v0.12 JS report/source/receipt/bounded共44/44 PASS（report12、source5、Windows receipt validator16、bounded11）；report case cap为128，128接受、129拒绝，用例覆盖旧100上限无法容纳当前105项registry的问题。Mac Node24 current probe 76/76 PASS、source36、binary SHA `f43139fe5855837ad1178df4b6d3e1ce4f9e0b9bc6d60405a6c0c31969ad17e0`；AppKit watchdog2/2 PASS。Electron41.4/Node24.15.0当前probe 76/76 PASS。Windows105项、真实API/kernel资源失败、session cleanup和真实应用均未验收。源码包132 payload+manifest、133 entries，SHA-256 `5def6a1218b39e6101e1c4d2ad02400c5551b918f5a2f3055c158dd23a2f92aa`；打包worker与root fresh-extract运行Node24.15.0三脚本均33/33 PASS，证据见[sourcekit root evidence](EVIDENCE_INDEX.md#v012)、[tests](EVIDENCE_INDEX.md#v012)、[ZIP](EVIDENCE_INDEX.md#local-raw-artifact-archive)和[完整root汇总](EVIDENCE_INDEX.md#v012)。整体`gateComplete=false`，隐私/生产接线及G1—G4仍未完成。


## v0.13 macOS materialization 与owned-bytes离线校验

本节记录v0.13 Mac capture时序、资源预算与revision结果契约。v0.12及更早评审历史保持原样；其Mac76-case收据原件位于artifacts/pasteboardpro/clipboard-format-g0/v013-inputs/。本轮独立实现复核结果为APPROVE，无P1/P2；根证据记录于[本轮汇总](EVIDENCE_INDEX.md#v013)。

| 复核项 | 源码行为与验收边界 |
| --- | --- |
| Native materialization | ClipboardCapture.mm枚举item/type并在每次普通读取前后核对changeCount，将支持表示复制到owned NSData；对reader返回长度先做预算判断，避免再复制一份超限payload；完成最终materialization barrier后才进入离线validator。barrier前board revision变化返回superseded且不输出items、summary或byteLength。 |
| Offline validation与revision | ClipboardOwnedCapture.h/.mm只接收owned NSData、unsupported列表及validator，不访问pasteboard。barrier之后发生变化不会撤销或替换已捕获bytes；返回revision绑定materialized snapshot，observedRevision单独记录之后的board revision。不会用后续clipboard bytes填充旧snapshot。 |
| Raw staging预算 | Capture阶段把所有owned supported candidate bytes累计到maxSnapshotBytes，即使validator随后判无效也计入预算；超限在离线validation前结束，不提供阶段payload。对外byteLength仅累计validation通过的表示。validator false记录固定format_validation_failed，其他有效表示可以保留为partial。 |
| Exception containment | Validator异常由capture边界捕获为不含items、summary、unsupported、byteLength及异常文本的失败结果。固定用例不输出载荷、board内容或自由文本错误。 |
| Publisher交互 | Publish现有prewrite expectedRevision guard仍防止在计划准备期间覆盖更新的board；写后readback期间外部变化必须经stillOwned校验识别并返回partial-write，不能把不确定回读称作committed，也不覆盖外部复制。 |
| 固定case与当前证据 | 新增7项Darwin时序/预算/异常case，registry从76增至83；Node24与Electron41.4均83/83 PASS，AppKit watchdog2/2 PASS，source inventory42，binary SHA-256 ca1f997746f08462865e5f8decd99278172a0692092a0d61e1c98844aa3910a1。JS44/44 PASS，独立review APPROVE、无P1/P2。Windows native cases105仍NOT-RUN，source inventory109；v0.12 Windows source kit保持历史SHA且不是v0.13完整当前源码包。 |

另核实148个native源码/头文件均少于500行，最大499；quoted-include closure PASS。自v0.12以来仅一个共享source文件变化：Darwin case registry；Windows/common native与shared codec bytes未变。没有生产接线，gateComplete=false。这不证明general monitoring、可信producer身份、正文隐私扫描、持久化、生产host或实际应用矩阵。

## v0.14 V2 in-memory capture-policy gate

本轮评审范围是packages/core/src/clipboard-content-policy-v2.ts、clipboard-content-policy-v2-types.ts、clipboard-content-policy-bytes.ts及其core focused tests。实现将host规范化的capture representations按当前policy revision做内存admission并生成strict receipt；没有改Windows行为、V2 manifest、native源码或runner。

| 复核项 | 结果与限制 |
| --- | --- |
| 整次copy与逐表示状态 | source preflight只允许进入后续policy gate，不算扫描passed；任一requested scope命中会拒绝整次copy。无效/不完整/抛错scanner response使当前representation not-scanned，其他安全表示可partial；规则关闭仍可留存获准格式，但标not-scanned。 |
| revision、bytes与receipt | 输入绑定capturedRevision及policyRevision；扫描前与扫描/摘要后复查当前policy。所有bytes在异步前owned copy，scanner拿隔离副本，hash只覆盖admitted bytes。preview/paste/sync权限为false；cloudUploadEligible不授予sync。 |
| 限制与缺口 | textual 10MiB、其他格式100MiB、snapshot200MiB、1024 representations、32/item；scanner response最多12行。file-body永远not-scanned；实际HTML/RTF/OCR/metadata scanner、native DTO adapter、trusted source/current-policy host mapping及bounded worker/helper均未交付。gate没有timeout/cancel。提交期仍须重验hash并与policy activation串行。 |
| root验证 | Node24.15.0 full core 135/135（84既有+51新增）；Electron41.4.0/Node24.15.0 focused 51/51；全workspace typecheck和workspace contract PASS。独立review APPROVE、无P1/P2。review后root补充hash阶段policy revision撤销case，并在最终focused suite通过。root evidence记录27项core/config source hashes及受影响文件行数。 |

证据：[root evidence](EVIDENCE_INDEX.md#v014)、[core log](EVIDENCE_INDEX.md#v014)、[Electron log](EVIDENCE_INDEX.md#v014)、[typecheck log](EVIDENCE_INDEX.md#v014)及[contract log](EVIDENCE_INDEX.md#v014)。

native baseline未在v0.14重跑。root复核Mac current receipt/binary及Mac42、Windows109 source hashes均与v0.13基线不变；Mac仍为83/83 per Node/Electron及watchdog2/2，Windows105 cases仍NOT-RUN。此复核不是新的native执行证据。整体G0仍未完成，gateComplete=false；不代表生产host、实际内容scanner、持久化、预览、paste、sync或应用矩阵通过。


## v0.15 bounded scanner独立复核（历史）

复核范围包括`content-scanner-v2.ts`、协议contracts、Worker session lifecycle、worker-only扫描器与规则、V2测试、Vite打包入口及package verifier。结论：**APPROVE（可信、已打包worker范围）**；未发现当前范围内阻塞P1/P2。此前发现的过早terminal结算、dispose提前返回和IPC消息大小检查缺口已修复；有效、重复及超限response均有回归用例。规则与现有`privacy.ts`的likely-secret、literal及wildcard语义相符，不支持内容或解码失败会fail closed。

root验证：Node24.15.0为172/172（core135+scanner37），Electron41.4.0 Node模式focused为37/37；workspace typecheck、workspace contract、preload build、15文件assembly与package contract均PASS。Node和Electron实际组装worker smoke均仅为synthetic-text-only，确认thread exit、零输出且worker SHA一致。独立reviewer没有重跑这些检查；结果详见[v015-root-evidence.json](EVIDENCE_INDEX.md#v015)。

批准边界不包含installed Electron preload中的Worker可用性，也不构成OS进程隔离、RSS硬上限或恶意worker structured-clone分配防护。HTML/RTF、OCR、图片metadata、file-content和Windows仍未验收；native DTO与production capture仍未接线。overall `gateComplete=false`。此前v0.13/v0.14 review及历史结论保持原样。


## v0.16 结构framing与静态投影独立复核

结论：APPROVE（仅静态源码复核）。复核范围为共享RTF framing validator、HTML/CSS静态投影及其Worker接入和有界预算。该结论不代表原生Win32/AppKit执行、真实应用格式选择、已安装preload/生产host接线或G0整体通过。

RTF validator只保证标准RTF1根、结构括号、escape/参数、bin长度和尾部padding边界；不输出RTF文本，不执行RTF privacy scanner。Windows继续沿用2 MiB cap，macOS cap为10 MiB并新增4个native cases。

HTML/CSS扫描在现有Node Worker中用锁定的parse5 8.0.1与entities 8.1.0进行静态投影，原HTML bytes不变。普通格式HTML可通过；外部CSS/import、图片背景、img/media、动态脚本SVG和不支持CSS保持保守incomplete/not-scanned，命中时仍拒绝整次copy。预算上限为raw 10 MiB、累计投影10 Mi标量、10000节点和128深度；超预算不截断为passed。

静态批准不替代运行门禁：Node24/Electron41.4 Node模式中的probe和Worker smoke证据见v016根证据及对应receipt；Windows105项仍NOT-RUN，Mac/Windows真实目标应用、正式host与生产listener未验收。此前v0.15批准仅覆盖当时的明文/URL Worker，HTML/CSS能力以本节v0.16范围为准。

## v0.17 native capture-wire与core gate独立复核（历史）

结论：APPROVE（静态源码范围，无P1/P2）。复核覆盖共享20-byte magic+length framing encoder、独立SHA helper、Node strict canonical-UTF-8 parser/known-format registry、request/platform/policy binding、完整unavailable inventory及已有bounded worker/core gate的fixture接线。

初审发现的empty rows处理与Unicode trim边界差异已修正，并增加回归用例。Mac UTF-16 framing曾尝试依尾部00 00推断NUL终止符，可能剥除正文真实NUL；现不按字节猜测终止符，遇NUL保守not-scanned，2项真实Worker反例回归通过。known-format registry对缺decoder的表示保持unsupported，不猜MIME；RTF仍not-scanned。

Mac native ingress收据仅绑定受监督synthetic命名board fixture。Windows SDK/WinAPI/WIC等105项仍NOT-RUN；该评审不证明production listener、trusted source/current-policy transport、storage/publish/sync或应用验收。运行证据与完整源码绑定见[v017根证据](EVIDENCE_INDEX.md#v018)。

## v0.18 V2 codec evidence与CF_HTML独立复核（历史）

结论：APPROVE（静态源码范围，无P1/P2）。复核覆盖schema V2与captured-row nativeCodec绑定、Mac UTF-16原件证据一致性、V1 strict reader/writer与V1/V2 neutral reader、共用CF_HTML parser及Node Worker htmlContainer投影。compatible/derived text缺失不得伪装fidelity=compatible；helper codepage不表示producer编码。

known native format与scanner支持能力保持分离；未扫描格式在规则开启时不准入，规则关闭时按既有策略保留raw及not-scanned，unknown native仍unavailable。NUL alias/source-scan guard未移除。CF_HTML按UTF-8原始byte offset验证和投影，静态扫描不执行、不fetch。Mac与Electron native G0 probe各87/87，source56且绑定相同binary SHA；Node/Electron package smoke各8/8。上述执行证据不扩展静态review边界；Windows平台运行和production host/应用验收仍待完成。

Mac与Electron native G0 probe各87/87，source56且绑定binary SHA；双runtime default ingress各5/5、codec/analyzer ingress各6/6。Node/Electron Node-mode suites分别339/339与204/204，package smoke各8/8。包增量review最终APPROVE；初审P2已修复为在server关闭后断言最终external-request计数，Node/Electron最终均0 requests、0 output且确认真实退出。运行收据只作为独立证据，不扩大本静态review结论。V2协议细节见[Native capture wire v2](NATIVE_CAPTURE_WIRE_V2.md)，完整源码与收据见[归档v018 capsule](EVIDENCE_INDEX.md#v019)。

## v0.19 RTF projection独立复核（历史）

静态源码review与package增量review最终均APPROVE，无未关闭P1/P2。范围含真实Worker的RTF framing/tokenizer/charset、Unicode与legacy fallback、hidden/visible、UPR branch审计、font charset/cpg、HYPERLINK、文本metadata和不完整状态处理。

P1修复有回归证据：UPR ANSI分支u漏扫、special destination继承错误font、孤立annotation辅助组误报完整；见[special destination green](EVIDENCE_INDEX.md#v019)与[annotation green](EVIDENCE_INDEX.md#v019)。AppKit 342-byte固定fixture由root clang与worker Swift独立生成且逐字节一致。

Node458/458、Electron Node模式323/323，package smoke各11/11且0网络/0输出、线程及stdio关闭确认。RTF不改写原件，未建模语义仍not-scanned。v0.18 Mac/portable基线经source hash确认未变、不宣称本轮重跑；Windows105项NOT-RUN，production listener/host、trusted source/current-policy及storage/publish/sync未接线。完整证据见[v019-root-evidence.json](EVIDENCE_INDEX.md#v019)。


## v0.20 Node-only G1 store独立复核状态（历史）

当前v0.20复核结论：独立storage静态与runtime-package review最终APPROVE，仅限该组件且无遗留实现P1/P2；reviewer未执行测试，本轮格式与存储定向回归由root运行。两项fixture-entry skip由真实child/parent测试覆盖，不是Windows覆盖。
policy authority仅在单进程单一trusted owner内串行；LMDB跨进程互斥不等于policy一致性。Windows105项NOT-RUN；G0—G4整体未完成。完整G1仍有生产owner/current-policy、service lease、inbox/cursor、Windows ACL/目录同步及完整retention/GC等门禁。根证据：[v0.20最终根证据](EVIDENCE_INDEX.md#v020)

## v0.21 Consumer Inbox静态复核状态（历史）

独立review对`stageConsumerPage`、cursor/ACK分离、lease token fencing、retention guard及recovery root validation作有限范围静态复核，结论APPROVE，无P1/P2。该结论只批准当前Node-only LMDB组件实现，不证明多个service的policy一致性、生产host/current-policy transport、下游Pouch写入或Windows支持。

root已运行Node/Electron格式与存储定向suite各585 PASS、3项child-fixture入口skip，并运行consumer focused cases、指定SIGKILL恢复、真实AppKit synthetic consumer集成及runtime package smokes；日志与收据见[实施状态](IMPLEMENTATION_STATUS.md)。test-only harness handshake经独立静态复核APPROVE，未改production scanner。reviewer没有执行测试，静态APPROVE与root执行证据分开记录。

## v0.22 逻辑删除静态源码复核（历史）

独立静态review对严格tombstone schema、previousManifestRevision CAS、deletion-kind attempt、防复活重放、原子head切换、delete event/outbox与retention/root validation作有限范围复核，结论APPROVE，无未关闭实现P1/P2。reviewer未运行测试，也未验证installed host。

root在Node24.15.0与Electron41.4 Node模式各运行609 PASS、4项child-fixture入口skip的格式与存储定向矩阵；范围及运行收据见[实施状态](IMPLEMENTATION_STATUS.md)。bounded runtime smoke验证delete sequence、consumer ACK、close/reopen及旧attempt replay不复活。逻辑删除不物理清理blob，完整retention/GC仍开放；Windows105项NOT-RUN，production host/target adapter、应用矩阵与G0—G4整体验收未通过。

## v0.23 Durable ACK与payload reclamation review（历史）

实现边界的独立静态review有限范围APPROVE，覆盖schema-2到3迁移、outbox ACK proof、lease终态及逐revision expiry前置条件/回收顺序；reviewer未执行测试。源码review不等于实际host或全阶段验收。

Payload lease/reclamation focused16/16、真实旧schema迁移与ACK8/8、三项SIGKILL/recovery与read/unlink并发case均通过。最终Node/Electron矩阵各636 PASS、5项fixture入口skip；root/app typecheck、workspace/package contract、runtime build、package smoke均PASS。harness review有限范围APPROVE；源码评审与测试执行分开记录，完整G1及G0—G4仍开放。证据见[G1_RECLAMATION.md](G1_RECLAMATION.md)。


## v0.24 RTF投影source review（有限范围APPROVE）

review覆盖`uc`组继承/恢复与特殊目的地状态、annotation helper/body结构、可重复author ID、允许forward-reference且排除当前record后唯一绑定的parent图、时间字段顺序/范围/日历、线性URL枚举与20,000预算、原件不变/命中整次拒绝/未知语义保持incomplete。结论为有限范围APPROVE，无未关闭实现P1/P2；reviewer未执行tests。

root执行的Node 706/5最终独立重跑、Electron 706/5已通过initial日志副本、RTF focused 53/53及两端package smoke各17/17与review结论分开记录。Electron没有本轮复跑。suite总耗时与isolated regex实验均不是产品性能或p95结论。Windows、生产host/current-policy和完整G0—G4不在批准范围。

## v0.25 V1 数据库写入确认评审状态

实现范围和边界见[V1数据库确认说明](LEGACY_DATABASE_CONFIRMATION.md)。Node/Electron全工作区最终矩阵现均为1246 PASS/6 skips；logs已链接于[实施状态](IMPLEMENTATION_STATUS.md)。独立源码评审有限范围APPROVE，reviewer未运行测试；结论见[independent review receipt](EVIDENCE_INDEX.md#v025)，完整记录见[root evidence capsule](EVIDENCE_INDEX.md#v025)。最终package smoke通过。最终根收据与文档审计字段见本节root capsule链接。迁移source/destination root/ancestor symlink边界已加入lstat拒绝检查；修复前矩阵仅作诊断基线。

仍有一个宿主P2：allDocs错误可能折叠成空数组，get错误可能折叠成null，插件无法据此确认权威枚举。不得将此宿主缺口标为已修复，也不能宣称空查询或删除结果可靠。V2 target intent/sourceSeq CAS及生产接线不属于本轮V1修复。


## v0.26 历史图片入库修复边界

修复前红测来自v0.25 frozen preload CJS graph；Node与Electron的7项synthetic SDK/history case均复现4个既有缺陷、通过3个正常/策略排除场景，收据中preload hash与旧包绑定。该证据可确认旧包问题，不可表述为新源码失败；也不证明真实clipboard/host行为。

独立源码review确认writer路径P1已修复：在managed root、现存祖先与digest-prefix建立/使用前检查identity链，关键写入边界复核路径链和realpath；blob/repository定向23/23由实现者运行，reviewer未运行测试。两个harness P2也已修复并分别获reviewer APPROVE：`preload-database-fixture.mjs`显式allowlist所需`node:` builtin，未知项拒绝；`test-preload-image-package.mjs`的`record-error`检查固定`Database conflict` detail且扫描全部events和console sentinels。该信息来自分项review；总体结论、完整Node/Electron和package smoke以最终独立review/root receipts为准。产品审查边界还包括nullable normalize后的privacy decision顺序、pathless allowed image的typed fail closed；history loop在record/blob write错误时不setCursor；不读取global clipboard；同handle bounded reader与路径identity复核；cache实际bytes验证；共享blob在DB失败后保留；固定错误不泄露路径/cause。100 MiB是JS读取预算，不是硬RSS/时间或native helper supervision。无跨资源事务/断电保证、Windows nofollow未验证、既有path fingerprint duplicate不自动修复、retry/GC和用户可见pending状态未提供。

限定范围独立源码review最终为APPROVE，未发现新增P1/P2；reviewer未运行测试，详见[v0.26 independent review](EVIDENCE_INDEX.md#v026)。Node与Electron全工作区各142 passed files/5 skipped files、1279 PASS/6 skips；两端scanner各17/17、base preload各6/6、image package各10/10，7项build/types/contracts均通过。6个bounded进程均exit0、signal null、stdout/stderr为空并确认终止。15个打包文件相对v0.25变更3条路径；snapshot-store runtime 2未变且未重建，完整macOS/Windows native matrix未重跑。最终根/独立review收据见本文开头及本节引用。红测fixture只绑定旧v0.25包，不代表新实现失败；Windows105项NOT-RUN，完整G0—G4仍开放。


## v0.27 Windows source-kit 独立复审（有限范围通过）
final source package：[ZIP](EVIDENCE_INDEX.md#v027)，SHA-256 `7f3b647e75f060b9b1fa57976842ff7df574cfdfd02ed5dfea55ca61efe9158e`；[manifest](EVIDENCE_INDEX.md#v027)与[producer receipt](EVIDENCE_INDEX.md#v027)绑定同一包。producer root Node24 suite 8/8通过，见[日志](EVIDENCE_INDEX.md#v027)；独立源码review对source-kit producer修复为有限范围APPROVE。
本轮关闭了三项producer问题：codec-tests source walk改为显式allowlist，cold checkout安全创建缺失artifacts路径，source/package总量上限在读取和ZIP构建前执行（单文件4 MiB、payload32 MiB、ZIP64 MiB、512 entries、1024-byte名称）。复现及修复结果见[红日志](EVIDENCE_INDEX.md#v027)与[绿日志](EVIDENCE_INDEX.md#v027)。
独立artifact delivery report [../../artifacts/pasteboardpro/clipboard-format-g0/v027-delivery-validation/final-review/delivery-report.json](EVIDENCE_INDEX.md#v027)验证双次生成匹配、CRC/manifest/路径模式、clean extraction verifier及tamper拒绝；44/44纯Node合同与portable CTest1/1通过source hash继承，非本轮重跑。报告字段sourceReview=NOT-CLAIMED只说明delivery validator未自行审源码，不覆盖独立review结论。
审查不含Windows SDK/MSVC/WinAPI/WIC实机执行。Windows10/11、x64/ARM64、105 native cases、目标应用及完整G0—G4仍NOT-RUN，manifest gateComplete=false。

## v0.28 V1 history mirror图片失败隔离（有限范围通过）

旧v0.27归档CJS图的Node/Electron各7项红基线为5 FAIL/2 PASS，说明旧包图片失败时健康文本未保存；不是当前实现失败。receipt分别见[Node](EVIDENCE_INDEX.md#v028)和[Electron](EVIDENCE_INDEX.md#v028)。

当前V1路径只隔离可归类的图片持久化错误。单轮累计16次后不再进行后续图片prepare/I/O，仍处理健康非图片；最后返回固定错误、不推进cursor，已写record保留并在重试时去重。未知prepare、privacy、host、database错误仍fail fast。Coordinator尝试dispatch已确认记录变化且保留原错误；通知best-effort，fixture在listener前抛错，不能证明subscriber收到；已清空的变更ID无可靠重发。

独立source review有限范围APPROVE，覆盖核心mirror/coordinator、packaged harness及marker观察改动；reviewer没有运行测试。helper review发现的marker终检和文件访问错误分类问题已修复：窗口结束时复查marker/child，只有ENOENT/ENOTDIR代表缺失。初始polling 5-case red为2 FAIL/3 PASS；marker 10-case red为4 FAIL/6 PASS；最终journal+polling target 25/25通过。初次Node full 1287/6/1和首版helper后的1293/6只作诊断。

Node/Electron最终全工作区均144 passed files/5 skipped files、1298 PASS/6 skips，耗时20.28s/20.91s。两端scanner/preload/image/isolation各17/6/10/7项、6项build/types/contracts与root types检查通过；8个bounded children exit0、signal null、stdio为空且确认终止。15个package outputs仅dist/ztools/preload.js变化；renderer未重建，2个snapshot runtime文件未变且未重建。最终全量logs见[Node](EVIDENCE_INDEX.md#v028)与[Electron](EVIDENCE_INDEX.md#v028)。

v0.28测试输出曾复用一个v0.26 hash-bound Node journal timing JSON路径；原正文不可恢复且必须保留历史缺口，另一个benchmark已恢复原SHA。新结果不能替代旧证明，见[incident report](EVIDENCE_INDEX.md#v028)。Windows105项、installed host/general clipboard、目标应用和完整G0—G4仍未验收。

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
