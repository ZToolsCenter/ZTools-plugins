# Clipboard format fidelity 实施历史

本文保留 v0.15—v0.18 与 v0.20—v0.23 的版本记录原文。记录中的实现状态、测试数量、收据与限制均绑定其标注版本；这些历史结果不替代当前状态判断。原有相对链接因文件仍处于同一目录而保持有效。

当前实施与证据见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)，未完成事项见 [G0_REMAINING.md](G0_REMAINING.md)，完整目标与门禁仍以 [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md) 为准。

## v0.15 有界内容扫描 worker（历史）

v0.15在 `apps/ztools/preload/content-scanner-v2.ts`、`content-scanner-v2-contracts.ts`、`content-scanner-worker-session.ts`、`content-scan-worker.ts` 与 `content-scan-rules.ts` 提供实际 Node Worker 扫描器，并纳入 Vite preload worker 构建与 ZTools 包装配。它可作为 core gate 的 scanner 依赖；尚未接入生产 capture、native DTO、真实host策略或存储，因此不是生产隐私门禁已启用的证据。

扫描范围严格限于显式编码的明文与URL：UTF-8、UTF-16LE、UTF-16BE使用严格fatal解码，NUL framing按协议处理。规则沿用V1 literal/wildcard语义；regex使用RE2JS 2.8.6，最多32条规则、每条256字符，flags仅`i`、`m`、`s`、`u`；内置5类likely-secret模式。URL保留原始值并最多扫描两层percent-decoded投影；无效或仍含无法解析escape的投影为not-scanned。HTML/RTF projector、OCR、图片metadata、file-body均未实现，不能将这些scope计作已扫描。

请求和回复绑定policy、codec、worker response ID、representation key及requested scopes。输入在发送前经Uint8Array intrinsic读取并复制为owned bytes；拒绝SharedArrayBuffer及detached view。固定字段与大小检查在Zod解析之前执行，但Node Worker structured clone会在worker回调之前分配，因此这不是对不可信worker的pre-clone内存防护。worker绝对路径由可信host提供，API不做签名/认证，renderer不可配置该路径。

默认timeout为5000ms，可设20—15000ms；并发默认1、最多2，worker busy时不排队；进程内flight lease上限64MiB。每worker V8 old-space 64MiB、young-space 16MiB、stack 4MiB只约束V8配置，不是OS/RSS/native ArrayBuffer硬上限。stdout与stderr合计最多计数16KiB后丢弃。这里提供的是Node Worker线程隔离，不是OS进程隔离；不设in-process fallback或自动重试。

成功、失败与dispose都等待实际Worker退出及stdout/stderr结束/关闭后才产生terminal result并释放lease。首次terminate promise拒绝时，scan和dispose保持pending且lease继续占用，直到确认实际退出；测试注入的拒绝随后由测试清理/确认退出，不证明OS或kernel终止失败。当前验证仅覆盖可信打包worker的synthetic-text-only smoke；Electron preload实际worker可用性、Windows native行为、恶意worker与进程级资源隔离均未验收。整体G0仍未完成，见[v0.15根证据](EVIDENCE_INDEX.md#v015)。


## v0.16 共享RTF framing与HTML/CSS静态投影（能力基线）

### RTF结构校验

native/clipboard-format/common/clipboard_rtf.h 与 clipboard_rtf.cpp 提供共享framing validator：要求标准RTF1根，校验括号平衡、转义、控制字参数、二进制段长度与尾部padding边界。Windows调用复用该validator且既有2 MiB上限不变；macOS采用10 MiB上限并新增4个native cases。该实现只检查容器结构，不提取RTF文本，也不执行RTF隐私/秘密扫描。

### HTML/CSS静态投影

HTML与CSS projector运行在现有真实Node Worker中，使用锁定的parse5 8.0.1与entities 8.1.0依赖。投影从parse5 typed AST的text.value读取文本；对隐藏节点、注释、template、noscript、属性、实体，以及最多两层percent投影执行静态检查。CSS扫描考虑escape、注释与URL元数据。HTML原始字节保持不变；解析结果只作为隐私扫描投影，不作为回贴原件。ParserOptions的官方接口见[parse5 ParserOptions](https://parse5.js.org/interfaces/parse5.ParserOptions.html)。

普通格式HTML可通过。外部CSS/import、图片背景引用、img/media、动态脚本SVG和不支持CSS构造保守标为incomplete/not-scanned；任何已命中的规则仍拒绝整次copy。流程不执行HTML/CSS/脚本、不联网、不做OCR，也不扫描RTF文本。

### 投影预算与证据边界

每个HTML原始输入上限10 MiB，累计投影上限10 Mi标量，AST节点最多10000、深度最多128。任一预算不足均拒绝或标not-scanned，不能截断后标passed；固定case覆盖真实10 MiB与10 MiB+1输入及3 MiB投影耗尽。

v0.16历史验证：Node24.15.0全套211/211（core135、scanner/lifecycle37、HTML36、budget3）；Electron41.4 Node模式focused76/76；JS44/44；Mac Node/Electron原生probe各87/87、watchdog2/2、source46、binary SHA-256 e9647de8813a211e649da461563a79be48a7fa9394db5628c8257f3aab501941。Windows inventory111、CMake58编译单元、portable closure39项（含CMake/headers，其中21项为编译单元），跨平台native源码154份最大499行；Windows105项仍NOT-RUN。普通与ASan/UBSan CTest各1/1、256 named checks。

v0.16 Node/Electron打包Worker smoke各5/5，assembly16 files、package contract通过，HTML_PARSER_NOTICES.txt入包；该smoke不代表production host/installed preload。v0.16原Mac Node/Electron、watchdog及dist收据现归档于[v017-inputs](EVIDENCE_INDEX.md#v017)；parse5/entities仅在Node24.15.0与Electron41.4 Node模式验证，不构成Node18支持证据。v0.12 Windows source kit仍为历史冻结包，因Windows/common源码已变不是当前源码包。

## v0.17 受监督native capture-wire fixture到core gate（历史）

[Native capture wire v1协议](NATIVE_CAPTURE_WIRE.md)定义本轮frame、边界与来源限制。

native/clipboard-format/common/clipboard_capture_wire.{h,cpp}提供共享encoder，clipboard_sha256.{h,cpp}独立提供PortableSha256Hex；Mac与Windows各有PayloadTransport和薄main接线，Windows stdout为binary。Node侧native-capture-wire.ts、native-capture-adapter.ts与native-format-registry.ts将owned bytes经有界frame、strict parser和known-format registry映射到已有bounded worker与core gate。

Wire使用20-byte magic+length prefix；metadata最多1 MiB、raw payload最多200 MiB、rows为1..1024，最多32个item（itemIndex 0..31），每item最多32个表示。Parser只接受canonical UTF-8 JSON并拒绝duplicate keys；名称非空且无C0/C1控制字符，名称与policy revision各限512 UTF-8 bytes，policy revision须trim后非空，request为最多128 ASCII identifier。request/platform/policy绑定；expectedRevision保留请求值并须等于capturedRevision，observedRevision独立，raw SHA与owned copy绑定，并保留完整unavailable inventory；source仍为unknown。v1不含完整production replay metadata。

registry只依据平台与nativeName，不从MIME或内容推断格式。Mac登记UTF-8/HTML/RTF/TSV等已知表示；Windows ANSI/OEM/CF_HTML及Mac BOM-less UTF-16等缺decoder的表示不伪装成支持。RTF仍not-scanned。Mac UTF-16不根据尾部00 00猜NUL terminator，避免剥除正文真实NUL；遇NUL保守not-scanned，真实Worker反例及2项回归通过。Frame和metadata仅在fixture流中使用；raw bytes/metadata不进入持久层，不代表manifest-ready、blobRef或sync。

只允许受监督固定public synthetic随机命名board/private station的--capture-wire-fixture模式；不读取个人general clipboard。macOS Node24与Electron41.4 Node模式native ingress各5/5，binary SHA-256 4680a3907ef65ecf74c57b8b5e601f6669465159507661bdb7aac06851722849、source52；Node275/275、Electron140/140，JS44/44、watchdog2/2、workspace tsc、app vue-tsc、workspace contract通过。portable normal/ASan CTest各1/1且各307 named checks；assembly15 files、package contract及Node/Electron packaged worker smoke各5/5通过。Windows105项仍NOT-RUN，Windows inventory117/CMake61、portable closure45（24编译单元）只是源码证据。无production listener、trusted source/current-policy transport、存储/发布/同步接线；整体gateComplete=false。完整G0—G4验收目标未变。

## v0.18 native codec evidence与CF_HTML扫描（历史）

本节补充fixture-only native codec evidence与HTML容器扫描，不改变G0—G4完整验收范围。v0.17 receipts、native源码、dist与文档快照归档于[v018-inputs](EVIDENCE_INDEX.md#v018)；v0.12 source kit仍是历史包，不代表当前源码。

V2 wire使用8-byte PBCAP02 magic和schemaVersion=2；captured native row携带nativeCodec encoding、materialization及可选helper validationCodePage，并可携UTF-16 text evidence。v1 writer/reader继续strict且拒绝丢弃V2字段；neutral reader明确识别V1/V2。完整字段、预算和校验契约见[Native capture wire v2](NATIVE_CAPTURE_WIRE_V2.md)。

Mac UTF-16证据绑定同一item的owned UTF-8原件，并核对BOM、byte order、null terminator、解码相等或NFC等价。只有exact standalone且无derivedFrom时可无text evidence；compatible/derived表示必须提供text且fidelity=compatible。不得依据尾部字节猜nullTerminated。Windows codepage仅是helper验证上下文，不是producer编码证明。

已知native格式分类与scanner可用性分离：无scanner codec时仍可capture owned raw；规则开启时保持not-scanned且不准入，规则关闭时按既有策略可准入raw并保留not-scanned。未知native格式仍unavailable。既有NUL alias/source scanning guard继续生效，未降低保护。

共用bounded CF_HTML parser接Windows native validator与Node Worker显式htmlContainer。offset按UTF-8 bytes；扫描完整context，或仅在无context时扫描fragment，并扫描完整header/SourceURL及其bounded percent/entity投影。不执行HTML、不fetch。拒绝重复header、数字垃圾/overflow、截断UTF-8、marker/offset不一致和无法解释尾部；header最多4096 bytes/128行（含blank separator），raw最多8 MiB。Windows SDK/API与真实应用仍NOT-RUN。

v0.18历史结果继续保留；旧receipt与source/docs/dist快照见[v019-inputs](EVIDENCE_INDEX.md#v019)、[归档方案](EVIDENCE_INDEX.md#v019)及[归档v018 capsule](EVIDENCE_INDEX.md#v019)。

## v0.20—v0.23 G1局部组件历史记录

以下四个历史版本段落从TECHNICAL_PLAN.md尾部原文迁入，保留当时实现、证据与限制；不表示当前阶段通过。

## v0.20 G1局部存储组件状态（历史基线）

packages/snapshot-store以Node-only注入方式把owned capture、同进程串行化的policy authority、内容寻址blob和LMDB journal连成close/reopen路径；Mac public synthetic fixture经真实Worker与core gate到store的Node/Electron各3项通过。该组件不是production host/preload，不提供跨进程policy一致性、Windows ACL/目录flush适配、consumer inbox/cursor或完整G1。

root/app typecheck、workspace contract、package contract、G1 runtime build均PASS；Node与Electron bounded package-import/LMDB close-reopen smoke均PASS。renderer/preload rebuild和assembly15只沿用v0.19未变hash基线，本轮未重跑。 Mac default native ingress、codec ingress与native-to-store fixture均已按当前证据通过；完整Mac G0、portable/ASan及JS基线未在v0.20重跑。

Recovery与journal针对性修复已有PASS：bootstrap 8项覆盖intent先于DB初始化、无intent的partial-zero拒绝和stale intent保留旧epoch；all-record-family验证下的root-GC 6项通过；outcome完整性3项通过；prune后重复请求仍核验；未来事件由当前writer显式拒绝且不生成tombstone；reservation cleanup移入finally。retention/replay这些修复不等于完整租约、保留策略或blob GC验收。

本轮Node/Electron格式与存储定向回归PASS，具体计数见[实施状态](IMPLEMENTATION_STATUS.md)。此前Electron中间红日志保留为历史过程记录，最终日志：[Node](EVIDENCE_INDEX.md#v020)、[Electron](EVIDENCE_INDEX.md#v020)。精确双发测试Electron30/30；scanner handshake为测试侧修改，生产scanner未改。

P2 prefix worker Unicode与reverse-capture-attempt修复已包含在store 96项中；unsupported delete继续fail closed。完整G1仍缺production owner/current-policy transport与service lease、native DTO/host/preload/storage调用链、Windows ACL/directory-sync adapter、consumer inbox/cursor/lease、完整retention与blob GC及跨平台故障矩阵；G0—G4完整成功标准保持不变。 [v0.20最终根证据](EVIDENCE_INDEX.md#v020)

## v0.21 Consumer Inbox 局部实现状态（历史）

`packages/snapshot-store`新增与source journal共用LMDB的metadata-only durable inbox：真实journal分页与inbox rows/enqueued cursor同事务提交，acknowledged cursor单独连续推进；token lease、prune guard及recovery roots见[G1_CONSUMER_INBOX.md](G1_CONSUMER_INBOX.md)。它不接收caller注入事件，也不承载payload、preview、paste、sync或target activation权限。

Node/Electron格式与存储定向suite各585 PASS、3项child-fixture入口skip；日志：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。Node consumer focused 23项、Node/Electron各3项SIGKILL及package import/lease/reopen/ack smoke通过。每runtime的真实Worker/LMDB集成含2项native-to-consumer案例及既有3项native-to-store案例，共5项；总数见[Node 5/5日志](EVIDENCE_INDEX.md#v021)、[Electron 5/5日志](EVIDENCE_INDEX.md#v021)，native-consumer JSON仅支持新2项：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。矩阵不含全仓UI/业务/sync测试，也不等于生产host、Windows或完整G1验收。

完整G1仍开放production owner/current-policy transport与service lease、native DTO/host/preload、Windows安全目录/flush适配、目标写入幂等CAS、consumer retirement/resync方案、完整retention/GC与容量/压力矩阵。G0—G4成功标准保持原样。

## v0.22 G1逻辑删除局部实现（历史）

`ClipboardSnapshotTombstoneV2`以严格V2 schema绑定hostEpoch、snapshotId、tombstoneRevision、attemptId、previousManifestRevision及`user-deleted|retention`原因码。`deleteSnapshot`要求live head的manifestRevision精确匹配previousManifestRevision；同attempt、同body只读重放，不能复活快照。

单个LMDB writer transaction原子写tombstone、delete event/outbox/attempt及新sequence，移除live head并写deleted head；四个fault injection边界均在该事务内。`getTombstone`、`getDeletedHead`和`getHead`用于读取墓碑/当前状态。既有raw、manifest、receipt、references和blob不物理删除；完整保留策略与blob GC仍未完成。

source journal与consumer保留同一snapshot的upsert/delete顺序。prune/recovery及重放须校验tombstone、previous capture、deleted head、attempt及事件关系，坏状态fail closed。设计细节见[G1_DELETION.md](G1_DELETION.md)；实现锚点为[core tombstone schema](../../packages/core/src/clipboard-tombstone-v2.ts)、[delete writer](../../packages/snapshot-store/src/deletion-write.ts)和[store API](../../packages/snapshot-store/src/snapshot-store.ts)。

Node24.15.0与Electron41.4 Node模式定向矩阵各609 PASS、4项child-fixture入口skip；日志见[Node](EVIDENCE_INDEX.md#v022)与[Electron](EVIDENCE_INDEX.md#v022)。bounded runtime smoke覆盖upsert、delete、inbox ACK、close/reopen、旧attempt重放不复活及raw SHA不变。该局部验证不关闭G1；Windows105项NOT-RUN，production host/target adapter和完整G0—G4门禁仍开放。

## v0.23 durable ACK与逐revision payload lifecycle

LMDB内部journal storage schema升至3；core manifest/event继续V2。旧schema2先完整校验记录roots，再在一个初始化事务设置`outboxAckLegacyHeadSeq=headSeq`并迁移；新库horizon为0。迁移不把旧缺失outbox补成ACK，旧pending row可由真实ACK操作产生proof；horizon后每序号必须有pending row或已验证ACK receipt二选一。旧v0.22代码拒绝schema3。

Outbox ACK receipt绑定canonical event与SHA，ACK写proof及移除pending row同事务提交；它不同于consumer acknowledgedThrough。Payload lease由trusted caller预生成UUID leaseId/token，purpose限export/paste/sync/pending-target；无TTL，active最多128，释放为终态，摘要不暴露token。lease只保护payload不被回收，不授予读取/预览/粘贴/同步权限。

`expireDeletedPayload(snapshotId, manifestRevision, tombstoneRevision)`按每个历史revision校验删除状态、upsert/delete ACK proof、source prune、全部registered consumer连续ACK与无active lease；marker commit前在同一writer txn核验每个payload length/hash。提交并flush后，以新roots审计及blob listing执行无引用unlink/fsync；共享hash保持。marker、manifest、receipt、raw/ref、attempt和tombstone仍保留。

Node/Electron最终定向矩阵各636 PASS、5项fixture入口skip，包含3项跨进程恢复/并发回收case；typecheck、workspace/package contract、runtime build及bounded smoke均通过，日志见[G1_RECLAMATION.md](G1_RECLAMATION.md)。完整metadata retention/compaction、crashed-pin回收、生产owner/current-policy/target授权、Windows和G0—G4门禁均未完成。

## v0.24 RTF隐私投影增量（局部验证通过）

保留原RTF bytes与既有预算。`\uc0`/`\uc2`按组继承并在组退出时恢复；footnote、annotation、header/footer复位默认font、codepage和hidden状态但保留uc，`\plain`不重置uc。annotation关联author ID、author、可选time、`\chatn`与body，可含`\atndate`/`\atnparent`；author ID可复用，不是comment唯一ID。parent在有界完整record集合中解析，允许forward reference；排除当前record后必须唯一匹配，未知、歧义、self-only或有环保持incomplete。时间字段可选，但若出现则唯一、有序、限范围且日历有效。

RTF Worker本轮新增70项：annotation 43、destination direct 10、linear URL 14、RTF storage integration 3；两个RTF目标测试文件共53/53通过：[focused green receipt](EVIDENCE_INDEX.md#v024)。Node24.15.0定向矩阵706 PASS/5 intentional child-fixture entry skips（57 pass files/5 skipped）；Electron41.4 Node模式同为706/5。日志：[Node独立最终重跑](EVIDENCE_INDEX.md#v024)、[Electron已通过initial日志的逐字副本](EVIDENCE_INDEX.md#v024)；Electron未另行重跑。该定向矩阵不包含全仓UI/业务/sync。

Node/Electron packaged Worker smoke各17/17，0 network requests、0 stdout/stderr，确认thread exit及双流end/close：[Node](EVIDENCE_INDEX.md#v024)、[Electron](EVIDENCE_INDEX.md#v024)。root/app typecheck、workspace contract、renderer/preload build、assembly与package contract均PASS。renderer/preload本轮重建后package为15 files，7 paths新增/变化、3个旧hash命名chunk被替换；snapshot-store runtime 2 files与native sources/binary沿用既有hash基线，没有本轮重建。

独立静态source review有限范围APPROVE，reviewer未执行测试；review仅覆盖本轮RTF投影边界。初次Node矩阵有1个10k queue case因5秒测试deadline超时（6461ms），source和deadline未放宽；Node最终独立重跑通过。12.34秒/24.12秒为测试进程总耗时，不是产品吞吐或p95。1 MiB无冒号regex实验只测隔离matcher且由2秒限时终止，不代表Worker/生产性能：[baseline](EVIDENCE_INDEX.md#v024)。

最终projection仍不是Word renderer或完整anchor语义验证；`\atnref`、bookmark/icon/pict、object/bin、unknown styles和dynamic fields继续incomplete/not-scanned。确定命中仍阻断整次copy，RTF原件不改写。完整Mac G0、portable/ASan/JS/watchdog未重跑；Windows105项NOT-RUN；生产host/current-policy/general listener/target应用及G0—G4整体仍未完成。

## v0.25 V1 宿主数据库确认与迁移安全

本轮修复现有 V1 写入误判：ZTools 可能以 {id,error:true,name,message} 完成写入 Promise，而旧插件只处理 rejection。checked adapter 现在要求 put/remove 正向回执、把错误映射为固定文案、将 prefix/keys 查询转换成宿主原生参数并校验返回 ID。历史镜像必须先完成确认写入，再更新索引和 cursor。preload 入口与 clipboard-store 已按职责拆分，文件均小于500行；45个 bridge 方法与原有窗口角色保留。

pluginData 附件迁移现在逐文件核验复制内容，只改写宿主枚举实际返回的记录路径。迁移保留每个 legacy root，并把宿主枚举完整性标成 unverified，避免被掩盖的空查询删除唯一副本。lstat会拒绝source/destination root、现存祖先和嵌套目标里的symlink/junction（迁移测试8/8）。路径检查与后续复制不是单一文件系统事务，不能消除校验后的TOCTOU。备份清理仍未确定，主窗口启动时可能继续核对旧目录。

迁移 symlink 检查加入后，Node与Electron全工作区矩阵均通过1246项、跳过6项（138个测试文件通过、5个文件跳过）。6项由5个child-fixture入口skip和1个opt-in macOS应用目录smoke组成。最终日志：[Node](EVIDENCE_INDEX.md#v025)、[Electron](EVIDENCE_INDEX.md#v025)。归档的修复前1242/6日志仅用于诊断。Node最初运行有1239 PASS/1 FAIL/6 skips，因为assembly fixture漏列既有打包流程要求的content-scan-worker.cjs与HTML_PARSER_NOTICES.txt；仅补了fixture条目，未改验证器或timeout。两端packaged scanner smoke各17/17，打包preload synthetic SDK矩阵各6/6；四个有界进程均exit0、无signal、确认终止且stdout/stderr为空。独立源码review有限范围APPROVE，reviewer未运行测试；v0.25最终文档审计状态记录在[v0.25根收据](EVIDENCE_INDEX.md#v025)。

这只是V1数据库接线修正。宿主把读取错误折叠为[]/null、枚举删除/tombstone歧义、legacy image localization失败回退、V2 target intent/sourceSeq CAS、宿主私有存储、native DTO/general listener/目标回贴/sync及完整G0—G4门禁仍未完成。范围与实现：[V1数据库确认](LEGACY_DATABASE_CONFIRMATION.md)；当前状态：[实施状态](IMPLEMENTATION_STATUS.md)。


## v0.26 V1 历史图片入库失败闭环（局部修复；整体门禁仍开放）
v0.26 root evidence：[v0.26 root evidence](EVIDENCE_INDEX.md#v026)；[v0.26 independent review](EVIDENCE_INDEX.md#v026)。

最终Node/Electron全工作区日志：[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)。package smoke：[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)；base preload：[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)；image：[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)；[bounded process receipts](EVIDENCE_INDEX.md#v026)。最终根证据与独立review链接见本节开头/下方。

v0.25实际打包preload CJS图的Node与Electron合成SDK/history各7项红基线中，pathless image、源读取失败、blob写入失败和损坏cache 4类场景复现问题；成功、privacy-excluded、paused 3类通过。preload SHA与v0.25 capsule记录的实际打包文件一致。红收据只描述修复前包，不是新版失败结果：见[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)及[process receipts](EVIDENCE_INDEX.md#v026)。

v0.26历史镜像对允许保留的图片要求有效absolute path；pathless normalization、读取/元数据、storage或实际bytes核验失败会拒绝本轮镜像，cursor只在完整分页成功后更新。明确paused或privacy-excluded项可按策略跳过。已经成功写入的record不回滚；blob先于DB record写入时，DB失败后的content-addressed blob保留给retry与后续GC。每个history item仅读取自身path，不调用当前clipboard layered fallback。读取用同一handle、bigint身份和mtime/ctime/size复核，64KiB分块、100MiB应用层上限；这不是hard RSS/time或native helper supervision。缓存leaf核验长度/SHA，损坏regular-file leaf可暂存替换。

早期Node全工作区候选1276 PASS/6 skips（147 files，142 passed/5 skipped）发生在后续blob-writer root symlink P1被发现之前，只作diagnostic。P1现由root/所有现存祖先/digest-prefix目录链检查、realpath与写入边界identity复核修复；三类pre-fix escape见[red log](EVIDENCE_INDEX.md#v026)，sync repository与两个blob测试定向23/23见[green log](EVIDENCE_INDEX.md#v026)，独立source review确认此P1关闭。两个harness P2已由root修复并分别获reviewer APPROVE：未知`node:` imports显式allowlist且拒绝其余导入；`record-error`检查固定sync-error detail并扫描全部events与console sentinels。限定范围独立source review最终APPROVE、无新增P1/P2，reviewer未运行测试。Node与Electron全工作区各142 passed files/5 skipped files、1279 PASS/6 skips，分别耗时24.16s/26.62s；6 skips均为5个child-fixture入口和1个opt-in macOS应用目录smoke。两端scanner各17/17、base preload各6/6、image package各10/10；7项build/types/contracts全通过，6个bounded进程均exit0、signal null、stdout/stderr为空且确认终止。15个打包文件相对v0.25有3个输出路径变化：preload.js、history-worker.cjs、history-search-index-CXhy0P51.cjs。最终收据与限制见本节末尾链接和[实施状态](IMPLEMENTATION_STATUS.md)。

Windows原生`O_NOFOLLOW`等价性未运行；path fingerprint命中的旧record不会自动重新验证/修复；固定`sync-error`没有health UI或durable pending attachment queue，失败可阻塞整批cursor；DB与blob写入无事务、无power-loss durability guarantee。general clipboard监听、native DTO/host owner-policy/targetIntent/CAS、真实目标应用粘贴、Windows 105项及完整G0—G4仍开放。


## v0.27 Windows G0 source-kit 实施与验收记录
v0.27根证据与文档审计字段：[root evidence](EVIDENCE_INDEX.md#v027)。根收据记录`gateComplete=false`。
独立源码评审收据：[v0.27 independent review](EVIDENCE_INDEX.md#v027)，仅APPROVE有限范围source-kit producer修复，不代表Windows执行。
记录日期：2026-10-28；Windows 12及后续版本未纳入本轮source-kit验收，需后续独立完成G0—G3兼容性验证。
初始review前候选曾为153 entries/152 payload、SHA-256 `19193deac0dc47c041517bb2ea401f9126d0f4b116d83c9c6139dcac49740530`，其producer red log记录3个失败；冻结包与早期交付报告保留在[v027-before-review-fixes ZIP](EVIDENCE_INDEX.md#v027)及[red log](EVIDENCE_INDEX.md#v027)。独立review提出codec目录缺少路径allowlist、cold checkout缺少artifacts根时失败、文件/ZIP缺实用总量budget。
修复后final package为153 entries/152 payload，payload 876744 B，ZIP 263096 B，SHA-256 `7f3b647e75f060b9b1fa57976842ff7df574cfdfd02ed5dfea55ca61efe9158e`；manifest SHA-256 `b904f301d6c7cade45ff18b3fb668454f3722208b6a929dd3528b2179acf1312`。见[final ZIP](EVIDENCE_INDEX.md#v027)、[receipt](EVIDENCE_INDEX.md#v027)、[manifest](EVIDENCE_INDEX.md#v027)。producer新增显式codec文件allowlist、cold checkout output identity/create guards和4/32/64 MiB及512-entry/1024-byte路径预算；Node24 producer tests 8/8，source reviewer有限范围APPROVE。
最终artifact-only delivery报告 [../../artifacts/pasteboardpro/clipboard-format-g0/v027-delivery-validation/final-review/delivery-report.json](EVIDENCE_INDEX.md#v027)确认二次构建归档字节一致、152 payload校验、CRC/manifest/clean extract verifier/tamper拒绝。121 Windows inventory paths、53 portable-codec closure paths及4个Node contract tests+fixture与前轮逐路径字节一致；44/44 pure Node contracts和portable CTest1/1据此哈希继承，final validation没有重跑它们。source reviewer独立于artifact-only delivery worker。
本轮未运行Windows真实环境、Win10/11 native build、x64/ARM64、API/WIC或105 native cases；目标应用矩阵未执行，source-only包不代表完整G0—G4验收。旧v0.12 ZIP未覆盖，SHA-256仍为5def6a1218b39e6101e1c4d2ad02400c5551b918f5a2f3055c158dd23a2f92aa。manifest gateComplete=false。

## v0.28 V1 history mirror图片失败隔离（2026-10-28；局部实现）

v0.28根证据：[root evidence](EVIDENCE_INDEX.md#v028)；有限范围独立source review：[review](EVIDENCE_INDEX.md#v028)，APPROVE且reviewer未运行测试。根证据记录gateComplete=false。

冻结基线为404 selected source paths、15 package outputs、2 runtime snapshots和15 docs；本轮仅选定输入哈希闭合，未重跑完整Mac native矩阵。v0.27 Windows source kit保持不变；Windows105 native cases NOT-RUN。

旧v0.27实际归档CJS图Node/Electron各7项红基线为5 FAIL/2 PASS，问题均是图片失败后健康文本未保存，control覆盖database fail-fast与privacy excluded。旧包red receipt不表示当前实现失败：[Node](EVIDENCE_INDEX.md#v028)、[Electron](EVIDENCE_INDEX.md#v028)。

当前V1 mirror只对允许保存、可分类的图片持久化错误继续处理；累计16次后跳过后续图片prepare/I/O但继续处理非图片。批次最终仍返回固定错误、不推进cursor；已经写入的record保留，后续按fingerprint去重并重试失败图片。privacy排除沿用策略；未识别prepare、host、database和其他错误仍快速中止。

Coordinator失败路径构造已确认record变化并尝试dispatch history changed，刷新错误不覆盖原mirror错误。通知仅best-effort；fixture在event push后、listener前抛错，只证明dispatch尝试与错误保留，不证明subscriber收到。takeRecordChanges清空ID后无可靠重发；失败不发成功事件、不运行retention或启动vault sync。

Node negative-observation helper的deadline race导致初次全量1287 PASS/6 skip/1 FAIL（[diagnostic](EVIDENCE_INDEX.md#v028)），不是mirror断言。首版helper 5-case red为2 FAIL/3 PASS；第一次修复后的Node1293/6只作review前诊断。随后marker helper 10-case red为4 FAIL/6 PASS。最终journal+polling target suite 25/25通过；观察窗250ms、场景20s/child27s deadline未改。红绿链见[poll red](EVIDENCE_INDEX.md#v028)、[marker red](EVIDENCE_INDEX.md#v028)与[marker green](EVIDENCE_INDEX.md#v028)。

Node/Electron全workspace均144 passed files/5 skipped files、1298 PASS/6 skips，耗时20.28s/20.91s：[Node](EVIDENCE_INDEX.md#v028)、[Electron](EVIDENCE_INDEX.md#v028)。scanner/preload/image/isolation各17/6/10/7通过；6 build/types/contracts与root types通过；8 bounded child全部exit0、signal null、stdout/stderr为空且termination confirmed。15个package outputs仅dist/ztools/preload.js改变；renderer未重建，两个snapshot runtime文件保持原样且未重建。root reports及具体receipts列于v0.28 capsule。

本轮发生历史输出路径事故：[incident receipt](EVIDENCE_INDEX.md#v028)。一份v0.26 hash-bound Node journal timing JSON正文不可恢复，原SHA 3cced35a394c4467505d2cae66c29e14c904cb2740d1d11a8a1bcfa1a1d6218e保留并标记HISTORICAL_EVIDENCE_UNAVAILABLE；Node inbox-drain benchmark恢复exact SHA 2e3fb05a8beb9f69eaa372a22c4a9946c49397c6133440c2979afccdee1ab790。v0.28输出不能替代缺失的历史JSON；v0.26其余source、package和full logs仍各自绑定历史，但不应称所有逐项JSON均可复核。

15 package outputs与2 runtime snapshot仅使用hash对比，没有因此重跑全套native矩阵/renderer；Windows kit、宿主general clipboard、真实目标应用与完整G0—G4仍未通过。不存在durable pending/failed state、图片公平轮转、lost-path recovery或可靠通知重发。
