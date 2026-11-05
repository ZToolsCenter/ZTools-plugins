# G1 Durable Snapshot Store：v0.23 Node-only局部组件

v0.23根证据：[root capsule](EVIDENCE_INDEX.md#v023)。

版本：v0.23；日期：2026-10-27。本文描述 packages/snapshot-store 的Node-only local store、consumer inbox、逻辑删除及payload生命周期接口，对照完整G1目标。Node/Electron定向矩阵各636 PASS、5项fixture入口skip；G1、G0及G0—G4整体仍未验收通过。契约分别见[G1_CONSUMER_INBOX.md](G1_CONSUMER_INBOX.md)、[G1_DELETION.md](G1_DELETION.md)及[G1_RECLAMATION.md](G1_RECLAMATION.md)。


v0.21历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v022)

v0.22历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v023)。

## 范围与所有权

packages/snapshot-store 是Node-only可信owner注入组件，依赖固定版本 lmdb 3.4.4；v0.21新增与source journal共用LMDB事务的metadata-only Consumer Inbox，v0.22新增原子逻辑删除writer及deleted-head读取。它不是 renderer/preload API，不读取系统general clipboard，也没有接到production host、listener、native DTO或用户存储/同步链路。包依赖和导出入口见[package.json](../../packages/snapshot-store/package.json)，主要实现见[snapshot-store.ts](../../packages/snapshot-store/src/snapshot-store.ts)、[journal.ts](../../packages/snapshot-store/src/journal.ts)、[blob-store.ts](../../packages/snapshot-store/src/blob-store.ts)及[consumer-inbox.ts](../../packages/snapshot-store/src/consumer-inbox.ts)。

PolicyCommitAuthorityV2 将 policy activation 和 commit 校验排在同一进程内的串行队列；它只保证同一个trusted owner的revision顺序。LMDB writer lock能协调数据库事务，不提供跨进程当前策略一致性或service owner身份认证。当前没有service-owner lease，也没有认证的current-policy transport；不得把多个各自持有policy的service描述为受支持。注入policy与scan函数是trusted Node-only边界。renderer无入口，receipt里的preview、paste、sync permissions保持false。

固定依赖来源：[lmdb-js v3.4.4](https://github.com/kriszyp/lmdb-js/tree/v3.4.4)。其Node-API实现和transactionSync语义只作为本组件依赖说明，不代表任意Node/Electron版本或跨平台运行均已验收。

## 接口概览

入口为 openSnapshotStoreV2({directory, policy, scan, faults?})。目录由trusted owner提供；policy为PolicyCommitAuthorityV2实例；scan是core内容检查的trusted async callback。返回只读store对象，主要方法：

| 方法 | 当前语义 |
| --- | --- |
| captureAndCommit(request) | 校验并复制owned captured bytes，执行core policy gate、当前revision检查、manifest/CAS校验、blob stage及journal提交；返回committed/replayed或受控rejected outcome。 |
| readChanges({hostEpoch, after, limit}) | 按hostEpoch及changeSeq读取有界连续事件页，limit为1..500；过期cursor返回带retentionFloor的受控状态。 |
| readSnapshot(snapshotId, manifestRevision) | 读manifest、receipt及绑定的blob bytes，并验证引用、长度和SHA-256；v0.23持LMDB writer锁完成整段读取，避免与回收unlink竞争。 |
| readOutbox(limit) / acknowledgeOutbox(changeSeq) / getOutboxAcknowledgement(changeSeq) | ACK把canonical event与digest receipt写入并在同一事务移除pending row；receipt是durable outbox proof，独立于Consumer Inbox acknowledgedThrough。 |
| deleteSnapshot(tombstone) | 对当前live head执行previousManifestRevision精确CAS；原子写tombstone/delete event/outbox/deletion attempt并切换为deleted head。 |
| getTombstone(snapshotId, revision) / getDeletedHead(snapshotId) / getHead(snapshotId) | 读取规范化墓碑、删除head或live head；storage corruption fail closed。 |
| acquirePayloadLease(request) / releasePayloadLease(request) / getPayloadLease(leaseId) | 通过caller预生成UUID leaseId/token固定payload revision；无TTL，active上限128；summary不返回token。 |
| expireDeletedPayload(request) / getPayloadExpiry(snapshotId, revision) | 在prune、双outbox ACK、全部consumer ACK且无active pin时为单revision写expiry marker，之后由fresh recovery roots unlink无主blob。 |
| pruneThrough(changeSeq) | 删除指定范围内journal events并推进retentionFloor；修复后，已prune event对应的duplicate attempt仍核验保留的原始manifest/receipt/blob。未来event由writer显式拒绝且不创建tombstone。完整保留/GC协议仍是G1门禁。 |
| recover() / close() | 在store owner内恢复或关闭；close等待已接收的API request queue工作完成，不会排空持久化inbox任务，也不会取消或自动回收其lease。 |

当前组件validator上限为最多1024个items、representations和raw bindings；这是底层总量安全边界，不改变方案目标每个snapshot最多32 items、每item最多32 representations。每个captured representation继续按core maxFormatBytesV2(contentKind)限额，总raw捕获不超过200 MiB；pending store queue最多64个job及256 MiB owned-byte lease。元数据准入预算为manifest JSON、receipt JSON和normalized command fingerprint JSON合计最多8 MiB。

这些是输入准入和持久化记录预算，不是Node heap/RSS硬上限：manifest解析与canonical JSON序列化在最终metadata预算判定前仍会产生分配；256 MiB计量也不包括Node runtime、scanner或LMDB的全部内存。生产host/helper必须对输入构造、扫描和执行资源继续加有界隔离，不能把这些数字作为总内存保证。

## 提交顺序

~~~mermaid
flowchart TD
  A[Capture input becomes owned bytes] --> B[Core policy scan and revision gate]
  B --> C[CAS and prior-attempt check under LMDB writer]
  C --> D[Write staged blob and fsync file]
  D --> E[Rename and fsync affected directories]
  E --> F[One synchronous LMDB commit: manifest, receipt, bindings, attempt, event, outbox, head]
  F --> G[Await LMDB flushed before success]
  D -. failure .-> H[Fixed storage failure; no ready result]
  E -. failure .-> H
  F -. transaction abort .-> H
~~~

captureAndCommit在首个异步扫描前复制raw input并计算排队预算。内容先由core gate扫描；策略被撤销时不得提交。commit authority和LMDB writer范围内再次校验策略revision及CAS，避免stale manifest在写blob前开始stage。blob按SHA-256寻址，写staging文件、同步文件数据、关闭后rename到shard，然后同步shard和staging目录。目录sync不可用会以directory-sync-unavailable失败关闭。

Journal在一个可中止且同步提交的transaction中写入canonical manifest、receipt、raw bindings、幂等attempt fingerprint、连续change event、outbox event和snapshot head。交易成功后等待lmdb db.flushed；配置明确关闭noSync/noMetaSync/useWritemap/overlappingSync。replay仅是对既有提交的acknowledgement，不重新授权preview、paste或sync；replay路径须复核已引用blob。

## 数据模型与有限队列

| 项目 | 组件边界 |
| --- | --- |
| Snapshot输入 | core ClipboardSnapshotManifestV2、policy receipt、captured raw bytes与expectedManifestRevision。manifest factory可依gate receipt补充receipt ID。 |
| Capture来源 | 当前只有可信Node caller注入的owned capture；Mac public synthetic fixture走真实Worker/core gate/store集成，不取个人剪贴板。 |
| Metadata上限 | 一份commit的canonical manifest JSON + receipt JSON + normalized command fingerprint JSON累计8 MiB准入上限；非heap/RSS配额。 |
| Raw数据上限 | 每表示使用core内容类型额度，snapshot raw合计200 MiB；排队64 jobs、queued raw bytes lease合计256 MiB；不等于总RSS。 |
| 序号与epoch | hostEpoch为每个journal初始化的标识；changeSeq为uint64范围的十进制字符串。读页限制1..500。 |
| Recovery保留 | retentionFloor用于让落后cursor显式过期；outbox acknowledgement可重放。设计要求所有仍承诺保留的manifest/receipt/blob引用都保持root，不做完整GC。 |

文件引用representation沿core规则保留原始引用，不读目标文件正文。未知或not-scanned内容不得因存在store就被视为策略通过；capture gate的拒绝/partial状态照常约束可留存表示。

## 目录与平台边界

POSIX目录必须为绝对非root路径；父目录需要可解析，store目录归当前uid所有且group/other权限为零。组件创建目录及LMDB/blob子目录时使用私有权限，并对目录执行同步；不修改既有父目录权限。LMDB数据文件按打开前后lstat的device/inode身份校验；lock.mdb在LMDB打开后只做lstat身份检查，不另开并关闭一个可能影响LMDB writer lock的fd。

Windows当前仍在mkdir之前返回private-directory-unavailable。v0.29新增了独立的Windows DACL/对象identity/文件flush受控基础源和15项原生探针，但不是完整文件系统适配器；未接入snapshot store，也未移除此guard。目录句柄flush观察不等于命名空间持久性证明，Windows不得启用此store。用户目前没有Windows环境；新增15项和G0 Windows 105项均NOT-RUN，边界与待验收流程见[Windows基础层说明](WINDOWS_STORAGE_FOUNDATION.md)。

LMDB使用ABORTABLE | SYNCHRONOUS_COMMIT transaction flags；noSync、noMetaSync、useWritemap、overlappingSync均为false。该配置不等于对所有文件系统、存储控制器和断电场景的硬件持久性证明。SIGKILL只测进程崩溃，不能替代power-loss测试。

## Journal读取、重放和保留

changeSeq由同一LMDB提交递增；event和outbox都包含hostEpoch和sequence，readChanges要求hostEpoch一致、after值连续且不超过500 events。读者落后于retentionFloor时返回cursor-expired，不能把缺口报告为正常完整分页。readOutbox/acknowledgeOutbox只提供发送队列基础；v0.21的本地Consumer Inbox在[G1_CONSUMER_INBOX.md](G1_CONSUMER_INBOX.md)单独定义，不提供跨设备activation。

pruneThrough只管理journal event与retentionFloor，并受已注册consumer的enqueuedThrough guard约束；v0.22提供logical tombstone但不物理删除历史manifest、receipt、raw-object bindings或blob。当前仍没有全量manifest/blob garbage collection、consumer retirement或容量/时间完整保留策略。prune后duplicate仍需核验，future event由writer显式拒绝且不写tombstone。已stage的inbox tasks/attempt/capture roots可在source event prune后存活；细节见Consumer Inbox契约。存储空间回收仍须完整根校验与租约/GC协议验收后单独实现。

## Open/recovery约束与待关闭项

打开store时先进入真实LMDB writer mutation scope，再盘点journal与blob。删除任何blob orphan前先交叉验证所有committed record families：manifest、receipt、live/deleted head、tombstone、event、outbox、attempt、raw binding/reference。被有效记录引用但不存在或摘要不匹配的blob须报storage-corrupt；只有经验证确认无根引用的orphan才可移除。

启动流程先写bootstrap intent，再初始化LMDB数据库。bootstrap 8项回归通过，覆盖intent-before-DB ordering、无intent partial-zero metadata拒绝和stale intent恢复时保留原host epoch。all-record-family recovery下root-GC 6个sole-root corruption回归通过；outcome完整性3项通过。进程内reservation cleanup放进finally。针对性恢复修复已绿；本轮格式与存储定向回归通过，storage组件独立review为有限范围APPROVE。

进程终止验证使用SIGKILL场景；它只证明进程崩溃后的指定恢复路径，不是断电或硬件持久性证明。v0.21实现本地consumer durable inbox/cursor/lease，v0.22增加逻辑删除事件；完整G1仍缺生产owner/current-policy/host接线、consumer target adapter、retirement/resync、完整retention/GC和跨平台真实部署故障矩阵。

## 单进程策略owner边界

当前store只在单进程单一trusted owner上提供policy和写入串行。低层多进程journal测试只证明LMDB writer互斥及顺序SIGKILL后重新打开路径，不证明多service policy一致性。所有跨进程capture、current-policy授权和owner lease仍是生产门禁。

## v0.20 store基线证据（历史；完整G1仍开放）

Mac AppKit synthetic owned fixture经真实Worker/core gate写入实际store并关闭重开：Node与Electron Node模式各3项通过。Node24.15.0与Electron41.4.0 Node模式v0.20定向回归各557 PASS、2项有意跳过（39个文件通过、2个跳过），不含全仓UI/业务/sync测试；这仅为历史v0.20总数。最终日志：[Node](EVIDENCE_INDEX.md#v020)、[Electron](EVIDENCE_INDEX.md#v020)。renderer/preload rebuild和assembly15仅沿用v0.19未变hash基线，v0.20未重跑。Mac完整G0 87-case、portable/ASan357及JS44沿用已校验基线未重跑。

此前Electron中间红日志保留为过程记录；本轮Node/Electron格式与存储定向回归均PASS。scanner handshake只在测试侧做203行确定性调整，生产scanner未改；Electron exact-double-send回归30/30。prefix Unicode与reverse-capture-attempt修复纳入store96项，unsupported delete fail-closed。独立storage静态与runtime-package review最终APPROVE，仅限该组件且无遗留实现P1/P2；reviewer未执行测试，定向回归由root运行。

参考：[bootstrap/root store log](EVIDENCE_INDEX.md#v020)、[Node native-to-store receipt](EVIDENCE_INDEX.md#v020)、[Electron native-to-store receipt](EVIDENCE_INDEX.md#v020)、[replay regression log](EVIDENCE_INDEX.md#v020)。

剩余G1至少包括：trusted production service owner/lease与认证current-policy transport；native DTO/host/preload/host storage调用链；Windows verified DACL和目录同步；inbox到真实target的幂等sourceSeq/CAS应用、consumer retirement/resync；完整retention/blob GC、容量/压力矩阵及跨平台部署故障矩阵。没有完成这些门禁前，不启用G1生产功能。

完整目标和发布成功标准仍以[TECHNICAL_PLAN.md](TECHNICAL_PLAN.md)第1—11节及[G0_REMAINING.md](G0_REMAINING.md)为准；当前阶段入口见[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)和[ACCEPTANCE.md](ACCEPTANCE.md)。
[v0.20最终根证据](EVIDENCE_INDEX.md#v020)

## v0.21 Consumer Inbox增量与验证（历史）

`stageConsumerPage`从真实source journal读取事件，并在同一LMDB writer transaction原子写入inbox rows与`enqueuedThrough`；`acknowledgedThrough`独立连续推进。`claim/ack/release`使用token-fenced配置租约，`readConsumerInbox`不泄露claim bearer token。source prune受所有registered consumer checkpoint约束；recovery verifier检查checkpoint/task/event/attempt/capture引用。

Node/Electron格式与存储定向suite各585 PASS、3项child-fixture入口skip（46 files passed、3 fixture files skipped）；范围不含全仓UI/业务/sync测试。Node consumer focused 23项、Node/Electron各3项SIGKILL通过；每runtime真实AppKit synthetic integration由2项native-to-consumer和既有3项native-to-store组成，合计5项，见[Node 5/5日志](EVIDENCE_INDEX.md#v021)、[Electron 5/5日志](EVIDENCE_INDEX.md#v021)。native-consumer JSON收据仅支持新增2项：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。Node/Electron runtime package import后执行commit、close/reopen、lease及ack smoke通过。完整suite日志：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。runtime smoke：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。

hot path按consumer/source sequence与有界page/prefix做局部读取和校验；启动恢复、prune及GC执行更完整的source/record-family审计，不能承诺每次API调用都扫描整个queue或恒定成本。大量active leases下claim有prefix-linear压力，未来pressure matrix仍开放。`close()`只等待当前API request queue，不会排空持久inbox或取消lease。完整G1仍开放：生产owner/current-policy/service lease、native DTO/host/preload、Windows verified DACL/目录flush、下游幂等target adapter、retirement/resync及完整retention/GC。

## v0.22 逻辑删除writer（历史）

`deleteSnapshot`委托`commitDeletion`，只接受strict `ClipboardSnapshotTombstoneV2`且要求同hostEpoch。新删除前核对snapshot live head、其精确manifestRevision、previous capture及全局attempt ID；attempt若已用于非deletion kind则conflict。相同deletion attempt及相同规范化body必须通过event/tombstone/deleted-head完整性校验后才返回只读replay。

新删除在同一LMDB writer transaction写入摘要绑定的tombstone record、`eventType=delete`事件及outbox、`kind=deletion` attempt和递增changeSeq；随后移除live head并写deleted head。事务失败回滚所有记录。成功删除后，新的capture或另一delete attempt均conflict；历史blob、manifest、receipt和引用不被删除。

API与schema细节、consumer/prune校验及宿主边界见[G1_DELETION.md](G1_DELETION.md)。v0.22定向矩阵Node/Electron各609 PASS、4项fixture-entry skip；runtime smoke含delete、ACK、close/reopen和历史replay。Windows store仍mkdir前fail closed；完整保留/回收策略未验收。

## v0.23 ACK、payload pins与逐revision reclaim

journal内部storage schema3仅扩展LMDB metadata；core manifest/event保留V2。打开schema2库时先完整roots验证，再同事务持久化`outboxAckLegacyHeadSeq`及版本迁移；老缺失outbox只记作unknown，不能伪造ACK。新序号要求pending outbox与valid ACK proof恰有一个；ACK receipt与pending row移除原子提交。

新增`acquirePayloadLease`、`releasePayloadLease`、`getPayloadLease`、`getOutboxAcknowledgement`、`expireDeletedPayload`与`getPayloadExpiry`。payload lease无TTL，release记录terminal receipt，最多128 active；expired marker按snapshotId+manifestRevision管理。候选必须满足prune、两条outbox ACK、全部consumer ACK与无active pin；marker前同一writer txn核验每个payload hash/length。flush后在新roots recovery中unlink/fsync无引用blob。

Final Node/Electron格式与存储定向矩阵各636 PASS、5项fixture入口skip，含3项process recovery；root/app typecheck、workspace/package contract、runtime build与bounded package smoke均PASS。lease quota hotpath只对最多129项做bounded canonical/key/epoch/exclusivity校验，不深验无关pins；当前请求/retry/release/get仍深验自身source，startup/expiry/prune/GC保持full roots audit。cap case默认5秒时限与逐操作durable transaction未改；单次Node 881ms/Electron 1650ms仅是本机观察，不是p95或生产吞吐。完整API、legacy horizon、expiry marker和物理回收顺序见[G1_RECLAMATION.md](G1_RECLAMATION.md)。这仍不提供production authorization，也未实现完整metadata/time/capacity retention、metadata compaction或crashed-pin自动清理。


## v0.29 Windows存储基础源（尚未验收）

`native/clipboard-storage/windows/` 提供 Windows 专用 C++17 基础源：protected DACL、非模拟进程用户 SID、句柄身份与文件 flush 检查，以及15项仅使用公开固定 fixture 的原生探针。Node CLI 提供 `--describe` 与受控 Windows `--self-test`，不会自动调用 CMake。源 SHA 与二进制 SHA 仅记录观察值，不证明两者构建来源一致；报告固定 `namespaceDurability=NOT-VERIFIED`、`productionStorageEnabled=false`、`gateComplete=false`。

这不是 G1 Windows 文件系统 adapter：目录创建后按路径重开的竞态、祖先绑定、目录项持久性、ACL并发竞争、清理失败和掉电行为都需 Windows 实机验证。当前无 Windows SDK 编译/运行证据；不声明真实应用回贴或 G1 durableReady。详见[Windows存储基础层说明](WINDOWS_STORAGE_FOUNDATION.md)。

本轮工具契约在 Node/Electron Node 模式各 20/20；Windows 15 项基础探针全部 NOT-RUN。详见[根证据](EVIDENCE_INDEX.md#v029)，不替代 Windows 文件系统/LMDB 适配或 G1 验收。
