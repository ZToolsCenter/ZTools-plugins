# G1 Snapshot Logical Deletion：v0.23局部契约

v0.23根证据：[root capsule](EVIDENCE_INDEX.md#v023)。

版本：v0.23；本文说明Node-only `packages/snapshot-store`的逻辑删除仍是不可逆metadata状态，而v0.23只增加满足门禁后的逐manifestRevision payload回收。它不是完整G1或生产删除接线；原G0—G4标准仍以[TECHNICAL_PLAN.md](TECHNICAL_PLAN.md)第1—11节为准。回收门禁见[G1_RECLAMATION.md](G1_RECLAMATION.md)。

v0.21历史实现与结果见[v021归档文档](EVIDENCE_INDEX.md#v022)；v0.22历史capsule：[root evidence](EVIDENCE_INDEX.md#v023)。

## Scope与schema

`ClipboardSnapshotTombstoneV2Schema`为strict schema，字段为：`schemaVersion: 2`、UUID v4 `hostEpoch`、`snapshotId`、`tombstoneRevision`、`attemptId`、`previousManifestRevision`和`reasonCode`（`user-deleted`或`retention`）。标识符受128字符和ASCII字符集约束；额外字段拒绝。源码：[schema](../../packages/core/src/clipboard-tombstone-v2.ts)。

公共store API为`deleteSnapshot(tombstone)`、`getTombstone(snapshotId, revision)`、`getDeletedHead(snapshotId)`及`getHead(snapshotId)`，见[snapshot-store.ts](../../packages/snapshot-store/src/snapshot-store.ts)。存储实现入口为[deletion-write.ts](../../packages/snapshot-store/src/deletion-write.ts)和[deletion-records.ts](../../packages/snapshot-store/src/deletion-records.ts)。

该协议是在本地LMDB source journal上的logical deletion；tombstone本身不删除旧manifest、receipt、raw-object bindings、引用文件或blob，也不代表用户可见目标已删除。v0.23允许对满足门禁的特定deleted manifest revision单独回收无共享引用的payload blob；完整metadata/time/capacity retention与GC仍未完成，详见[G1_RECLAMATION.md](G1_RECLAMATION.md)。

## Atomic writer与CAS

~~~mermaid
sequenceDiagram
    participant C as Trusted caller
    participant S as snapshot-store
    participant D as LMDB writer transaction
    C->>S: deleteSnapshot(tombstone)
    S->>D: validate epoch, prior attempt, live head and capture
    D->>D: exact previousManifestRevision CAS
    D->>D: tombstone + delete event/outbox + attempt + sequence
    D->>D: remove live head + write deleted head
    D-->>S: committed event or verified read-only replay
~~~

新删除要求live head的`manifestRevision`与`previousManifestRevision`完全相等，并要求原capture可验证。事务将tombstone及SHA-256、`eventType=delete` event/outbox、全局唯一`kind=deletion` attempt和新changeSeq，与live head移除及deleted head创建放在同一LMDB writer transaction中。四个fault injection点为`after-tombstone`、`after-delete-event`、`before-delete-head`、`after-delete-head`；任何中途失败都不能留下部分删除状态。

`attemptId`跨所有attempt kind全局唯一：已被upsert/outcome占用时delete冲突。删除成功后新capture或另一个delete attempt均冲突。相同deletion attempt与相同body只有在event、attempt fingerprint、tombstone摘要及deleted head均核验一致后才只读返回`replayed=true`；重放不会重建live head或“复活”快照。记录损坏时返回storage-corrupt并fail closed。

## Journal、consumer与prune

Delete event携带hostEpoch、changeSeq、snapshotId、tombstoneRevision、tombstoneRef和tombstoneSha256。Inbox仍只接收metadata event；同一snapshot的upsert/delete按changeSeq有序，ACK表示worker处理metadata，不表示目标应用已删除。source event即使已prune，恢复、重放或consumer root validation仍须核对保留的tombstone、previous capture、deleted head、attempt与关联event。删除prune范围中的event前必须完成所有record-family roots校验；不一致即停止写入/回收。

## Host隔离与未完成边界

当前组件是Node-only LMDB注入API，不接production host、preload、general listener、native DTO、current-policy transport、目标adapter、paste或sync。当前宿主只读源码checkout收据是[storage source audit](EVIDENCE_INDEX.md#v022)：记录7份源码hash与clean checkout，但明确`installedHost NOT-RUN`。该源码使用单文档`_rev` CAS；`bulkDocs`为逐文档结果，允许混合成功/错误，不能作为整批all-or-nothing事务依据。宿主的`PLUGIN/`前缀是account/sync scope，`clearPluginData`删除整个plugin prefix，改V2子ID不构成隔离。当前宿主没有PouchDB依赖，也没有由本组件进行的宿主写入。

尚未完成：production owner/service lease与认证current-policy transport；native DTO/host/preload接线；Windows verified DACL/目录flush adapter（Windows105项NOT-RUN且store在mkdir前fail closed）；consumer到真实target的幂等intent和sourceSeq/CAS；retirement/resync；完整retention策略、全库GC策略与容量/压力矩阵；真实应用验收。SIGKILL只证明指定进程终止后的恢复，不是断电或硬件持久性保证。

## v0.22验证状态（历史）

Node24.15.0与Electron41.4 Node模式格式与存储定向矩阵各609 PASS、4项child-fixture入口skip（49个文件通过，4个fixture入口由父进程真实运行），不含全仓UI/业务/sync测试：[Node log](EVIDENCE_INDEX.md#v022)、[Electron log](EVIDENCE_INDEX.md#v022)。本轮相对v0.21增加deletion12、integrity9及SIGKILL3项；root/app typecheck、workspace/package contract和runtime build通过。

Node/Electron bounded runtime smoke均通过，验证capture、inbox ACK、delete sequence、delete inbox ACK、close/reopen、旧attempt重放不复活及raw SHA不变：[Node receipt](EVIDENCE_INDEX.md#v022)、[Electron receipt](EVIDENCE_INDEX.md#v022)。既有native integration每runtime共5项，其中2项native-to-consumer、3项native-to-store；aggregate历史日志为[Node 5/5](EVIDENCE_INDEX.md#v021)及[Electron 5/5](EVIDENCE_INDEX.md#v021)，对应consumer JSON仅支持2项新案例：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。

独立静态源码review有限范围APPROVE，无未关闭实现P1/P2；reviewer未运行测试。上述结果只覆盖该Node-only组件与定向矩阵，G1及G0—G4整体未通过。

## v0.23 tombstone后的payload生命周期

Tombstone仍是不可逆删除metadata，不会被payload reclaim移除。v0.23可对每个`manifestRevision`独立证明旧upsert与delete已通过durable outbox ACK、source事件已prune、所有registered consumers已连续ACK且无active payload pin；满足后仅写该revision的expiry marker，再回收不再被其他revision引用的blob。历史manifest/receipt/raw/ref/attempt/tombstone全部保留。

expire API、lease fences、legacy outbox horizon及文件系统回收时序见[G1_RECLAMATION.md](G1_RECLAMATION.md)。Node/Electron最终定向矩阵各636 PASS、5项fixture入口skip，bounded smoke实测pin阻挡/release、物理unlink与重启后typed expired行为；这一局部过程不等价于宿主同步删除、全局retention、metadata GC或生产target授权。
