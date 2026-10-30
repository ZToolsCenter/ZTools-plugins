# G1 Consumer Inbox V2：冻结契约与验证清单

v0.23根证据：[root capsule](EVIDENCE_INDEX.md#v023)。

版本：v0.23；Consumer Inbox仍是Node-only LMDB组件。当前另增durable outbox ACK proof；ACK proof与consumer acknowledgedThrough是两种不同确认。Node/Electron格式与存储定向矩阵各636 PASS、5项fixture入口skip。本页不修改G0—G4既有成功标准，payload pins/reclamation见[G1_RECLAMATION.md](G1_RECLAMATION.md)。

上一个阶段的根证据只作历史基线，归档在 [v0.20 root evidence](EVIDENCE_INDEX.md#v021)。它不证明本消费者 inbox 已实现或通过验收。


v0.21历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v022)

v0.22历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v023)。

## 范围

Consumer Inbox 是与 source journal 位于同一 LMDB 数据库中的 metadata-only durable inbox。它从真实 source journal 读取upsert/outcome/delete事件，将事件与inbox rows、enqueued cursor在同一事务中提交。调用者只给出consumer ID、epoch、cursor和page limit；不能注入事件或自带source page。逻辑删除见[G1_DELETION.md](G1_DELETION.md)；此组件不接production host/preload。

此契约对应 [技术方案 §6.1/§6.2](TECHNICAL_PLAN.md) 和 [G1 durable store](G1_DURABLE_STORE.md)。它不是新生产 wire protocol，不提供 payload fetch、preview、paste、sync、目标激活权限，也不表示已接 production host/preload。

## 数据和接口

| 类型/方法 | 冻结字段或返回 |
| --- | --- |
| ConsumerCheckpointV2 | consumerId、hostEpoch、enqueuedThrough、acknowledgedThrough。两个序号都是 source changeSeq 的十进制字符串，含义独立。 |
| ConsumerTaskV2 | consumerId、完整 metadata event、deliveryId、attempts；state 为 pending、leased 或 acknowledged。leased 带 token 与 expiresAtMs。 |
| stageConsumerPage(request) | 请求含 consumerId、hostEpoch、after、limit。结果为 staged（checkpoint、stagedCount、replayed）、queue-full（checkpoint、capacity），或 source journal 的非 ok 读状态。 |
| getConsumerCheckpoint(consumerId) | 返回已注册 checkpoint；未知 ID 返回 undefined。 |
| readConsumerInbox({consumerId, limit}) | 返回checkpoint和有界task page；leased summary只含expiresAtMs、不暴露bearer token；未知ID返回undefined。 |
| claimConsumerEvent({consumerId, hostEpoch, leaseMs}) | 返回 claimed（checkpoint、leased task）或 idle。 |
| acknowledgeConsumerEvent({consumerId, hostEpoch, changeSeq, token}) | 以当前 lease token 确认任务，返回 checkpoint 和 replayed 标志。 |
| releaseConsumerEvent({consumerId, hostEpoch, changeSeq, token}) | 只有匹配的 lease token 可释放任务，返回 checkpoint。 |

source event 本身来自 core 的 [ClipboardJournalChangeEventV2](../../packages/core/src/clipboard-publish-v2.ts)：upsert 携带 manifest 引用与摘要，outcome 携带 attempt ID 和受控 reason code，delete 携带 tombstone 引用与摘要。Inbox 是事件元数据副本，不是 payload 容器或格式完整性证明。

## 两个序号与原子 staging

- enqueuedThrough 表示 source event 已持久进入该 consumer inbox 的最高连续位置；它不代表 worker 已处理。
- acknowledgedThrough 只越过连续已确认的事件。高序号先确认时，已确认 row 作为 hole 保留；较低缺口补齐后才可连续推进。
- stageConsumerPage 从 LMDB 中读取 source journal，而不是接收 caller 注入的事件。写入 inbox rows 与推进 enqueuedThrough 在同一个 writer transaction 里提交，保证同页原子可见。
- 新 consumer 只能以 after="0" 注册。若 retention floor 已越过其起点，返回 cursor-expired 且不创建 checkpoint；不能无声跳到 latest。
- 对已注册 consumer，after 小于 enqueuedThrough 是 source-pull retry：返回持久 checkpoint、标记 replayed，不重放下游投递副作用。这与 acknowledgeConsumerEvent 完全不同。
- after 大于现有 enqueuedThrough 属于 ahead conflict，不推进游标。hostEpoch 不匹配返回 host-reset；新旧 epoch 的 changeSeq 不可比较，必须走显式 resync/rebuild 设计。
- queue-full 返回当前 checkpoint 和 capacity，不得部分写入页面。单页最多 500 events。

~~~mermaid
sequenceDiagram
    participant C as Trusted Node caller
    participant I as Consumer Inbox API
    participant J as Source Journal
    participant D as Shared LMDB

    C->>I: stageConsumerPage(id, epoch, after, limit)
    I->>D: Begin writer transaction
    I->>J: Read actual source page
    J-->>I: Events and source cursor status
    alt Cursor and capacity valid
        I->>D: Insert inbox rows + advance enqueuedThrough
        D-->>I: Atomic commit
        I-->>C: staged + checkpoint
    else Gap, epoch reset, conflict, or queue full
        I->>D: Abort without partial cursor advancement
        I-->>C: Typed status + persisted checkpoint if registered
    end
    C->>I: claimConsumerEvent(id, epoch, leaseMs)
    I->>D: Persist a fresh token lease
    I-->>C: Leased metadata task
    C->>I: acknowledgeConsumerEvent(id, epoch, seq, token)
    I->>D: Fence by token; advance only contiguous ACK cursor
    I-->>C: acknowledged + checkpoint
~~~

## Claim、lease 与 acknowledgement

- Claim的配置leaseMs限制为1秒至5分钟，并为每次claim生成fresh UUID token。lease时间来自可信Node host的`now()`并在写事务内读取、验证为有限安全整数；不能接受renderer时间戳。该TTL不提供抗wall-clock调整的monotonic hard deadline保证。
- expiresAtMs小于或等于本次可信时间读数即视为过期。旧token不能确认或释放被后来claim的任务；ack/release都必须匹配consumerId、hostEpoch、changeSeq和token。只读inbox summary不会暴露claim bearer token。
- 同一 snapshot 的 changeSeq 按顺序投递；一个 snapshot 的较早任务被 lease 时，不相关 snapshot 的任务可以继续推进。
- 已有 acknowledgedThrough 及之前的迟到 ack 是只读 replay，返回 replayed=true；不得再次改写 checkpoint 或副作用。
- acknowledge只表示trusted worker收到metadata task，不证明下游target adapter已写入，也不授权target activation、preview、paste或sync。adapter仍需自己的durable idempotency与source-sequence/CAS。

当前宿主source checkout只读审计显示单文档put使用`_rev` CAS，而`bulkDocs`返回逐文档结果、可混合成功与错误；它不提供整批all-or-nothing成功结论。当前宿主没有PouchDB依赖，以上结论不来自已安装host/runtime验证。[宿主源码审计receipt](EVIDENCE_INDEX.md#v022)。

## 固定资源界限与 source retention

- 一个数据库生命周期最多注册 32 个固定逻辑 consumer ID；即使 checkpoint 仍为空也占一个名额。当前没有 retire API，不得用临时 worker ID 绕过上限。
- 每个 consumer 的 cursor-span 最多 10,000 rows，包含尚未填平的 acknowledged holes；inbox read 和 source stage 单页最多 500 rows。
- source pruneThrough 不得跨过任一 registered consumer 的 enqueuedThrough；最受限的 consumer 决定可 prune 上界。已经入队的 pending/leased tasks 及其 attempt/capture roots 可以在对应 source journal event 被 prune 后继续存活。
- Recovery/root verifier 必须在回收前校验 consumers、checkpoint、inbox task、embedded event、attempt 与 capture 的关系，包括 source event 已 prune 的情形。缺失或不匹配的有效引用必须 fail closed；不得把仍由 inbox/attempt/capture 引用的对象判为 orphan。
- 这些约束保护 source 到 inbox 的边界，不是完整 retention/GC、容量/时间保留或 consumer retirement 方案。完整保留和 GC 策略仍开放。

## v0.21 当前实现与验证（历史）

| 检查 | 当前证据 | 尚未证明 |
| --- | --- | --- |
| Source staging与cursor | Node consumer focused 23项PASS；从真实journal取页、rows/enqueued原子提交、重放、retention gap、ahead/epoch冲突、queue capacity与ACK holes均有覆盖。 | 不接production caller或跨进程current-policy owner。 |
| 资源限制与lease | 32固定consumer IDs、10,000 cursor-span rows、500 page、uint64边界、clock/expiry、token fencing、token-free summary、owned clone等边界在focused suite覆盖。 | 配置TTL不是monotonic时钟承诺；active lease规模压力矩阵仍开放。 |
| Transaction/SIGKILL | Node/Electron在stage、ACK row与cursor推进窗口各3个SIGKILL重开case通过。 | SIGKILL不是断电/硬件耐久性证据；已纳入本轮各585 PASS的定向矩阵。 |
| Native consumer integration | 每runtime 2项AppKit synthetic owned capture到inbox案例；JSON收据仅支持这2项：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。与既有3项native-to-store案例合计5/5，见[Node aggregate log](EVIDENCE_INDEX.md#v021)、[Electron aggregate log](EVIDENCE_INDEX.md#v021)。 | 只读固定命名board，不是general listener、生产host或目标应用验收。 |
| Package/reopen smoke | Node/Electron bounded package import，合成LMDB commit/close/reopen/lease/ack通过：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。 | 不代表installed preload、Windows或全仓测试矩阵。 |

hot path按consumer/source sequence以及有界page/prefix做局部读取和校验；startup recovery、prune和GC会做全量source/record-family核验，不承诺每次API调用扫描整个queue。大量active leases下claim存在prefix-linear压力，后续pressure matrix开放。首次保留事件已ACK但cursor尚未越过的记录不符合正常连续ACK状态，必须由validator拒绝；source row校验先于ACK-hole删除。

`close()`只等待已接收的API request queue，不会排空持久inbox任务或取消lease。本轮Node/Electron格式与存储定向suite各585 PASS、3项child-fixture入口skip（46 files passed、3 fixture files skipped）；三项fixture entry测试由对应父进程case实际运行。最终日志：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。该定向矩阵不含全仓UI/业务/sync测试，也不改变G0—G4整体门禁。

## 与现有 V1 的边界

生产 V1 仍由 [clipboard-store.ts](../../apps/ztools/preload/clipboard-store.ts) 的 mirrorHostHistory 使用 getHistory(page, pageSize) offset 分页，并以 timestamp 与 id 组成 HostCursor；它没有接入 Consumer Inbox V2。v0.26 已移除历史图片失败后返回原路径的 fallback，v0.30 增加失败轮转与清空队列；当前 [preload history mirror](../../apps/ztools/preload/clipboard-history-mirror.ts) 在已识别图片失败或 deferred image 时不推进主 cursor。它仍不是 V2 durable inbox，也不证明原始格式完整交付或 V2 迁移。详见[当前 V1 修正](HISTORY_IMAGE_RETRY_ROTATION.md)。

Windows新store仍在创建目录前fail closed；Windows105项保持NOT-RUN。G1 consumer component不改变Windows必选目标，且不替代生产owner/current-policy transport、native DTO/host/preload接线、消费者目标幂等写入/retirement/resync、完整retention/GC或应用矩阵验收。

## v0.22 delete event消费边界（历史）

- source event的`eventType=delete`携带snapshotId、tombstoneRevision、tombstoneRef、tombstoneSha256及changeSeq。它是metadata-only任务，不携带payload。
- 同一snapshot的upsert与delete按source changeSeq顺序进入consumer inbox；删除event的ACK只表示trusted worker已处理metadata，不代表目标应用已删除内容。
- ACK、source prune与恢复校验必须验证deletion-kind attempt、fingerprint、event和tombstone/deleted-head/capture roots；prune event后，仍存活的关联记录继续作为校验依据。损坏或不一致状态fail closed。
- 下游target adapter尚未实现；将来必须具备幂等intent及sourceSeq/CAS fencing。当前host是共享account/sync scope，`PLUGIN/`与V2子ID不构成隔离，`clearPluginData`会清理whole-plugin prefix；不得把本地inbox ACK当成宿主清理、目标删除或production sync确认。

Node/Electron格式与存储定向矩阵各609 PASS、4项child-fixture入口skip；最终日志见[Node](EVIDENCE_INDEX.md#v022)与[Electron](EVIDENCE_INDEX.md#v022)。既有native integration总计5项，其中2项native-to-consumer、3项native-to-store；历史aggregate日志和仅支持2项的consumer receipt见[G1_DELETION.md](G1_DELETION.md)。G0—G4整体门禁、Windows与production host验收仍开放。

## v0.23 Outbox ACK proof 与 consumer ACK分离

`acknowledgeOutbox(changeSeq)`对pending event生成canonical event+SHA receipt，并同事务移除pending row；`getOutboxAcknowledgement`可在event prune后验证receipt仍绑定原attempt/event。该proof供payload reclamation与journal roots使用，不等同`acknowledgedThrough`，后者表示consumer已连续处理metadata task。legacy v0.22 missing outbox不会被升级成ACK；pending old row可在v0.23实际ACK。

Consumer inbox仍按sequence保存upsert/delete顺序。reclaim还要求source floor越过delete序号，所有registered consumer连续ACK达到delete序号；只完成stage/enqueued或source-pull retry都不够。payload pin可以保护pending target revision，但不提供目标授权；详见[G1_RECLAMATION.md](G1_RECLAMATION.md)。

本页定义的inbox API仍是Node-only local component；schema migration、ACK与payload reclaim已经纳入两runtime最终定向矩阵。Windows与production target/owner/current-policy接线仍未完成。

## v0.31 完整退役/resync 的接线前置条件

已有消费者可能持有 pending/leased/ACK holes、外部 target intent 和 payload pin。仅删除 checkpoint、从 0/0 空注册释放一个槽位，或重置 source cursor，均不能完成旧 worker fencing、目标删除/重建与 sourceSeq/CAS；本轮没有新增狭窄 retire API 冒充完整方案。实际主链须先有可信 host owner、target intent/水位及旧代次撤销，再在该权威事务/恢复流程内设计完整 retirement/resync。设计入口：[宿主接线](HOST_V2_INTEGRATION_CONTRACT.md)、[计划与接收激活](V2_PLANNER_PORTABLE_CONTRACT.md)。现有 32 固定 consumer 上限与所有 prune/reclamation guards 保留。
