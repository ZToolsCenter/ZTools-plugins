# G1 Payload Pin 与逐 Revision Reclamation：v0.23

v0.23根证据：[root capsule](EVIDENCE_INDEX.md#v023)。

版本：v0.23；日期：2026-10-27。本文记录Node-only `packages/snapshot-store`的journal schema迁移、durable outbox ACK、payload lease与已删除manifest revision的blob回收边界。完整G1和G0—G4成功标准仍以[TECHNICAL_PLAN.md](TECHNICAL_PLAN.md)第1—11节为准。v0.22证据归档：[root capsule](EVIDENCE_INDEX.md#v023)。

## 当前范围

本组件仅在trusted Node owner注入的本地LMDB store中运行；不接production host/preload、general clipboard listener、native DTO、authenticated current-policy transport、下游target或paste/sync。payload lease是GC保护记录，不是读取许可、preview许可、paste/sync授权或已执行的target intent。Windows store仍在创建目录前fail closed；installed host/runtime未由本轮验证。当前宿主边界仅有只读源码收据[host audit](EVIDENCE_INDEX.md#v022)，不等同installed runtime。

## Journal storage schema 2 → 3

这是LMDB journal的内部`meta:schema`迁移；core `ClipboardSnapshotManifestV2`及`ClipboardJournalChangeEventV2`仍保持V2。新增`meta:outboxAckLegacyHeadSeq`，作为v2中可能缺少ACK证明的历史序号界线。

| 打开情形 | 初始化/迁移 | ACK含义 |
| --- | --- | --- |
| 新库 | 在持久初始化事务写schema3及`outboxAckLegacyHeadSeq=0`。 | 所有新增序号必须由pending outbox row或有效ACK receipt表示。 |
| 旧v0.22 schema2库 | 先在真实LMDB writer事务内完整验证已有record roots；成功后在同一事务把旧headSeq写为legacy horizon并改schema3。 | horizon及之前的missing outbox保持unknown；迁移不合成ACK证据。仍存在的旧pending row可由真实`acknowledgeOutbox`转成proof。 |
| schema3由旧代码打开 | 旧v0.22实现不理解schema3，读取时fail closed。 | 不支持降级写旧格式；不能在新库中运行旧writer。 |

对于`changeSeq > outboxAckLegacyHeadSeq`，journal roots要求pending outbox row与durable ACK receipt恰有一个；两者并存或均缺均视为损坏。旧horizon范围内若历史pending row已缺失，不会据此推断已ACK。升级日志：[8/8 migration + ACK](EVIDENCE_INDEX.md#v023)；测试使用的旧源码/config/依赖上下文见[receipt](EVIDENCE_INDEX.md#v023)。

## Durable outbox ACK proof

`acknowledgeOutbox(changeSeq)`验证pending event、source attempt及hostEpoch，在同一LMDB writer transaction写入规范化ACK record并移除pending row。ACK record带schemaVersion、完整canonical event和event SHA-256；root validator在event已prune后仍可校验它绑定的attempt与source event。`getOutboxAcknowledgement`读取此proof。

它与Consumer Inbox的`acknowledgedThrough`含义不同：outbox ACK记录发送侧事件已被外部确认；consumer ACK记录consumer worker已连续处理metadata event。任何一项都不单独证明最终target UI或宿主存储已更新。

## Payload lease API与状态

| API/type | 合同 |
| --- | --- |
| `acquirePayloadLease(request)` | trusted caller在调用前生成UUID v4 `leaseId`和token；绑定hostEpoch、snapshotId、manifestRevision与purpose。purpose仅`export`、`paste`、`sync`、`pending-target`。相同request重试可幂等返回。 |
| `getPayloadLease(leaseId)` | 返回active lease metadata summary，不返回bearer token。 |
| `releasePayloadLease({hostEpoch, leaseId, token})` | token匹配时移除active pin并留下terminal release receipt；相同release可replay，release后迟到的同lease acquire返回released而不重新pin。 |

lease没有TTL，也不按PID或进程退出自动解除；默认防止owner崩溃时误删payload，因此orphaned active pin可能一直阻塞回收。active数量上限为128。released receipt不会使lease重新有效，released metadata增长/配额仍开放。为限制128 active cap查询成本，quota hotpath只遍历最多129条lease的canonical/key/epoch/互斥字段，不重复深验无关pin；当前lease请求/重试/release/get仍深验其自身source，startup、expiry、prune和GC仍执行full roots audit。

trusted caller可为已删除但尚未expiry的历史manifest revision创建pin，以保护pending recovery；这只延迟回收。调用lease不验证或赋予读取、preview、paste、sync或target activation权限；生产层仍需经授权的intent和current-policy owner。

## Per-revision expiry前置条件

`expireDeletedPayload({hostEpoch, snapshotId, manifestRevision, tombstoneRevision})`针对**一个具体revision**处理；不要求它恰是delete tombstone引用的唯一revision。候选必须完整验证manifest/capture、upsert与delete attempt/event/tombstone/deleted-head，并满足：

1. snapshot已有deleted head且没有live head；目标manifest revision仍能通过metadata及receipt/raw binding验证。
2. retentionFloor严格大于该delete event的changeSeq，也即相关source事件已prune。
3. upsert和delete event各自都有event-bound、hash-valid durable outbox ACK proof。
4. 每个registered consumer的连续`acknowledgedThrough`都大于或等于delete changeSeq；仅staged/enqueued不够。
5. 该snapshotId+manifestRevision没有active payload lease。

条件未满足时返回具体blocked reason：`snapshot-live`、`source-not-pruned`、`consumer-not-acknowledged`、`outbox-not-acknowledged`或`active-payload-lease`。每个历史revision可单独到期。

## Marker提交与blob unlink顺序

~~~mermaid
sequenceDiagram
    participant C as Trusted store caller
    participant S as snapshot-store
    participant L as LMDB writer
    participant F as Blob files
    C->>S: expireDeletedPayload(snapshotId, manifestRevision)
    S->>L: full roots audit + eligibility checks
    L->>F: read each bound blob; verify length and SHA
    alt Any source or blob invalid
        L-->>S: abort uncommitted expiry marker
        S-->>C: fixed storage error; no unlink
    else All checks pass
        L->>L: write per-revision expiry marker
        L-->>S: commit and flush marker
        S->>L: open fresh writer scope; recompute roots
        L->>F: list objects; unlink only unreferenced blobs
        F-->>L: fsync directory after unlink
        S-->>C: expired result plus recovery outcome
    end
~~~

在marker仍处于未提交writer transaction时，组件读取该revision的所有bindings，并逐个读取blob、核验预期length/hash；缺失或损坏会abort transaction，不能先留下“已过期”marker再把损坏误作刻意删除。marker commit并flush后，unlink计划必须由新roots audit/current object listing产生，不把锁外旧计划带入文件操作。共享content hash仍被任一未过期binding引用时保留；只有没有其他有效引用才unlink并同步目录。

`readSnapshot`在读取完整bytes、验证摘要并生成owned copy期间持跨process LMDB writer lock，以避免与回收并发unlink。marker存在后，`readSnapshot`返回固定`payload-expired`；同一已过期capture attempt重试返回`status=payload-expired`和`replayed=true`，不重新stage、不复活。manifest、receipt、raw bindings/references、attempt、tombstone和expiry marker仍保留，供审计和根校验。

这实现的是**deleted revision payload reclamation**，不是完整retention/GC：当前没有metadata/time/capacity删除、manifest/receipt/raw/ref/attempt/tombstone compaction或保留期限策略。expiry记录仍可能增长。

## v0.23最终检查状态

| 检查 | 当前报告 | 证据边界 |
| --- | --- | --- |
| Payload lease + reclamation API/FS | Node 16/16：lease 6、reclamation 10，含pre-marker runtime missing/corrupt rollback。 | [latest reclamation 10/10](EVIDENCE_INDEX.md#v023)；lease cap运行：[Node](EVIDENCE_INDEX.md#v023)、[Electron](EVIDENCE_INDEX.md#v023)。 |
| Legacy schema migration + ACK | Node 8/8；实际导入归档v0.22源码建库，再由v0.23打开并验证horizon/真实ACK。 | [accepted log](EVIDENCE_INDEX.md#v023)；旧source/lockfile上下文：[receipt](EVIDENCE_INDEX.md#v023)。 |
| Process recovery/read-vs-unlink | 3/3通过：marker提交后SIGKILL重开恢复、共享hash并发新根保留、真实transactionSync reader/purger边界probe（负观察至少250ms且小于2s，owned-memory hash在GC后不变）。 | 已包含于final Node/Electron suite；harness静态review有限范围APPROVE。SIGKILL不证明断电或硬件持久性。 |
| Node/Electron格式与存储定向suite | 各636 PASS、5项child-fixture入口skip（53 pass files/5 skipped），分解为v0.22 609 + migration/ACK 8 + lease 6 + reclamation 10 + process 3。 | [Node](EVIDENCE_INDEX.md#v023)、[Electron](EVIDENCE_INDEX.md#v023)。不含全仓UI/业务/sync；fixture由父case真实执行，不代表Windows。 |

Root/app typecheck、workspace/package contract、runtime build及bounded package smoke均PASS：[root typecheck](EVIDENCE_INDEX.md#v023)、[app typecheck](EVIDENCE_INDEX.md#v023)、[workspace contract](EVIDENCE_INDEX.md#v023)、[package contract](EVIDENCE_INDEX.md#v023)、[runtime build](EVIDENCE_INDEX.md#v023)、[Node smoke](EVIDENCE_INDEX.md#v023)、[Electron smoke](EVIDENCE_INDEX.md#v023)。smoke确认capture/ACK/pin阻挡/release、unlink 1 object、close/reopen后typed expired与旧capture replay不restage且terminal lease不复活。cap case单次观测Node 881ms/Electron 1650ms；未改5秒用例时限或逐操作durable transaction，不代表p95或生产吞吐。

## 未关闭的G1边界

production owner/service lease/current-policy transport、授权target intent、native DTO/host/preload、Windows verified DACL与directory flush、目标应用/平台验收仍未接线。active pin没有owner-death回收协议；released receipt quota、full time/capacity retention、metadata compaction、回收压力/空间矩阵及完整跨平台故障证据仍开放。Windows105项NOT-RUN；本组件不改变完整G0—G4成功标准。
