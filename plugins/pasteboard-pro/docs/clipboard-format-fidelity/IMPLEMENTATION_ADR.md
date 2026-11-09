# Clipboard V2 宿主实施 ADR

**状态：ACCEPTED DESIGN / NOT IMPLEMENTED（限定设计复审通过；范围待授权）。** 本文是 [接线契约 §6.1](HOST_V2_INTEGRATION_CONTRACT.md#61-implementation-adr-gate) 的独立实施决策；不构成宿主代码实施授权、能力声明或 G0–G4 通过。目标与必选范围仍为 [技术方案 §1–11](TECHNICAL_PLAN.md) 和 [Planner/Portable 契约](V2_PLANNER_PORTABLE_CONTRACT.md)。插件工作区基线 `plugin/pasteboard-pro@db6fb73c` 加现有未提交改动；宿主上游 main 的只读审计基线为 `76addc6a03940006b5c208e125737d7d4ce953e9`（五个入口已通过 connector 逐文件核对，尚未本地 fetch/checkout）；本地 main/origin main `b185` 落后，历史只读快照 `9b15fb1` 属于本地 security 分支。实施开发分支、工作区与最终 pin 仍待 root 确认；不可将历史快照或测试分支当作实施基线。

## 1. 决策、边界与证据

宿主主进程拥有 `ClipboardSnapshotV2Service`、唯一 monitor hub、policy authority、私有 store、planner/publisher 和平台 adapter；V1 只消费 hub 扇出的信号。可信核心必须经宿主锁定、审查及打包，检查实际 import graph 和运行产物；不从可写插件目录加载宿主安全代码。插件新旧 UI 使用同一 adapter。启动先取得独占 service lease、恢复 store、装载策略再启动 hub；失败时 V2 capability 不可用，不静默退成 V1 成功。每个源文件按职责拆分并保持小于 500 行。

**基线事实。** 只读核对 `76addc`：`clipboardManager.ts` blob `45041abbfc2496b60a976572cb3c815da436b99a` 的 ClipboardItem 仍为单 text/image/file（21–55 行），构造并启动 monitor（122–149），单类型选择和 `lastSavedHash`（238–271），Office 文本优先（278–293）；`native/index.ts` blob `006beb8310e9ecda443f816f60dc4bb6d8d86935` 的 monitor callback 无参数（118–119、277–306），仅有基础 files 接口（142–143）。`resources/preload` blob `50d3468829c54c960a5fdcd4c4c05e4f184dd617` 的 clipboard 接口（600–620）无完整 V2 接线；dispatcher blob `f807dcda60cec3b7a6028bfc4f4bfe1577374090`（38–71）本层无 sender 校验。插件公开 DB 读取链经 preload（560/563 的 `sendSync`，572/575 的 `invoke`）→ shared/database handler → `lmdbInstance` blob `382c4819b2892dbb3c2888b65cf854adf51ab9a3`（7–11、21）→ storageRouter blob `21e5bb69b1f4c65e3529ce95cf2f8772a457a921`（30–36 的 Promise 包装自身同步接口，62–85 的 get/allDocs 直返数据库，数组逐 get 并 filter(Boolean)）→ LMDB index（137–138、168–169）→ syncApi blob `99682ee4e51513a49dece1dc19eff2517479491b`；其 get（427–437）catch 返回 null、allDocs（561–596）catch 返回空数组，此链不经过 PromiseApi。Promise 入口中 Router 等未捕获异常会自然 reject；`sendSync` 未捕获异常的实际 IPC/runtime 与安装包行为尚未验证。database blob `2472551d02beb523a01e386e5f05dd26bcf2cd08` 的内部 `dbGet`（420–432）亦 catch 转 null。五文件未发现完整 snapshot/representations/current-policy/capability/revision service 接口。行号据 connector 完整内容；未检查 native 二进制或安装包。旧 [接线契约 §1](HOST_V2_INTEGRATION_CONTRACT.md#1-现状证据与边界) 是 `9b15fb1` 历史事实，不覆盖当前审计。实施前须授权 fetch/隔离并复核精确 pin、依赖图；两个独立监听器可能竞态，实机验收监听数量。

## 2. Wire、授权与生命周期

选独立版本化 IPC channel，所有对象严格拒绝未知字段。请求 envelope 固定 `{wireVersion: 1, requestId, operation, body}`，响应 `{wireVersion: 1, requestId, ok: true, body}` 或 `{wireVersion: 1, requestId, ok: false, error: {code}}`；`requestId` 为调用方生成的 UUID v4 ASCII 字符串（固定 36 字节），只做关联，不承担授权或幂等身份；不合法或缺失时返回 transport-level `invalid-request`，requestId 为 null，不回显原始输入。合法 ID 的过期、撤销或错误请求只返回 ID 和固定错误，不 echo body。未知版本、操作和字段 fail closed；未来不兼容变更使用新 wireVersion，协商失败则关闭能力，不将未知字段静默吞掉或回写。订阅只提示可拉取，权威顺序仍是 durable journal。

`operation` 冻结为 `capabilities | beginBootstrap | readBootstrap | completeBootstrap | readChanges | getMetadata | plan | planQueue | confirmChoice | publish | readResult | startQueue | nextQueue | readQueue | cancelQueue | preview | readIcon`；每个 body 按该 operation 的独立 strict schema 解析。`error.code` 冻结为 `invalid-request | unsupported-version | unauthorized | expired | not-found | over-limit | superseded | policy-changed | storage-failed | unavailable | conflict | internal-error`，不返回底层异常、路径或内容；具体 journal 和 publish 的领域结果仍放在成功 body 的原有严格 union 中，不重命名或追加字段。无法解析 envelope 时固定返回 `invalid-request`，版本不支持返回 `unsupported-version`；不可解析或不可信 requestId 一律 null。

各 operation 的 request body（仅以下字段，strict）：

| operation | body |
| --- | --- |
| `capabilities` | `{}` |
| `beginBootstrap` | `{}`；建立新的 scope baseline |
| `readBootstrap` | `{baselineToken, pageToken?, limit}` |
| `completeBootstrap` | `{baselineToken, completionToken}` |
| `readChanges` | `{viewEpoch, after, limit}`；view cursor 为 U64 decimal |
| `getMetadata` | `{snapshotId}` |
| `plan` | `{snapshotId, mode}`；mode 采用 `PastePlanV2Schema` 的 enum |
| `planQueue` | `{snapshotIds, mode}`；有序 1–128 项 |
| `confirmChoice` | `{choiceToken, choiceId}` |
| `publish` | `{planId}` |
| `readResult` | `{resultId}` |
| `startQueue` | `{queuePlanId}` |
| `nextQueue` | `{queueSessionId, previousResultId}` |
| `readQueue` | `{queueSessionId}` |
| `cancelQueue` | `{queueSessionId}` |
| `preview` | `{snapshotId, projection}`；projection 为 `text | thumbnail` |
| `readIcon` | `{iconId}` |

所有 ID/handle 为 host 生成的随机 opaque ASCII，长度 1–128；不得将可含原生标识的 source key 直接充当 handle。能力 response 和安全投影另按严格 version 1 DTO 实现和审查，超预算分页或 typed reject。

每次调用在主进程由 live sender 查插件安装身份，校验主 frame、session/partition、install generation、feature flag、当前账号 scope 和按操作分别授予的 capability；未知、销毁或重装的 sender 一律拒绝。grant 绑定 sender、安装代次、session、scope、policy revision、权限集及到期时间；grant 最长 30 分钟、choice 最长 2 分钟、plan 最长 5 分钟，均以 host 单调时钟判断，进程重启统一失效，不依赖墙钟回拨；代次、策略、scope 或能力目录变化立即失效。关闭、卸载、账号或策略变更立即撤销。metadata、preview-text、preview-thumbnail、source-badge、plan/publish、sync 各自授权。renderer 只能提交 opaque ID、mode、choice ID/token 和受限 cursor/limit；严禁传 path、native format、blob ref、bytes、命令或策略结论。metadata/preview 采用 [接线契约 §3.4](HOST_V2_INTEGRATION_CONTRACT.md#34-renderer-metadata-与-preview-字段协议设计候选) 的 allowlist；受授权缩略图 bytes 是 host 派生响应，不是 renderer 输入。插件不把 V2 metadata/preview 自动写入 V1 record/vault。

**逐字段复用。** 宿主内部完整清单直接验证 `ClipboardSnapshotManifestV2Schema`：`schemaVersion/snapshotId/manifestRevision/source/policyReceiptId/items/coverage/captureState`，source 的 `osRevision` 绑定 captured revision，items 的原生标识、引用与摘要只留 host；不可从 renderer 提交或将 schema-valid key 当作脱敏 ID。`CaptureContentPolicyInputV2Schema` 和 `CaptureContentPolicyReceiptV2Schema` 原样在可信 owner 内验证，receipt 与 owned bytes、manifest、policy revision 绑定，不接受 renderer 代签。`PastePlanV2Schema` 保留 `schemaVersion/planId/snapshotId/manifestRevision/mode/plannedRepresentationKeys/omittedRepresentationKeys` 原语义，只是 host-only 冻结计划的一部分；按原序精确覆盖所有 source keys，derived target bindings 另存 host-only 对象，不改源 manifest。计划摘要只暴露 opaque handles 和受限说明。

内部 `ClipboardJournalReadResultV2Schema` 原样保存和校验：请求 `hostEpoch/after/limit`（U64 十进制，1–500）；`ok` 原有 `hostEpoch/after/nextCursor/retentionFloor/latestChangeSeq/limit/events` 与三种严格 event 字段不改名；`host-reset` 和 `cursor-expired` 保持原有类型。含 `manifestRef/manifestSha256` 或 `tombstoneRef/tombstoneSha256` 的 canonical page 仅供宿主内部静态可信代码读取；任何插件角色（包括可写 preload）都不是可信 consumer，授予 capability 也不改变其代码信任级别。所有插件只获得版本化安全投影，保留顺序、cursor 和事件种类但不暴露内部 ref/hash。不可将该投影宣称为原 schema。过期 cursor 明确返回重建入口，viewEpoch 改变须显式 resync，绝不伪装空页。消费 ACK 仅确认 inbox，不代表 target apply；逐 snapshot sourceSeq/CAS 与 activation marker 才确认应用。

### Scope view bootstrap / resync（NOT IMPLEMENTED）

公有 feed 使用独立 scope-bound `viewEpoch/viewSeq` 连续 durable 日志，不能从 core 全局序列删 raw refs 后再跨账号过滤。host 私有记录每个 view event 对应 global `(hostEpoch, sourceSeq)`，供排序、去重及 sourceSeq/CAS；未授权事件不进入 view、不暴露内容也不制造公开序号缺口。`readChanges({viewEpoch, after, limit})` 返回严格版本化 view page（`viewEpoch/after/nextCursor/retentionFloor/latestViewSeq/limit/events`，仅安全投影）或 `cursor-expired | view-reset`；viewSeq 不等于 core sourceSeq，view page 不是 core schema。策略、scope 或 host epoch 改变即撤销 view 并显式 resync。

1. `beginBootstrap({})` 重新授权并 fence 旧 view generation、cache 和 worker。owner 在同一 writer 串行边界内建立 MVCC 一致 read snapshot、固定 private live heads 与 global 水位 S0，并登记 S0 后 tail 保留任务，消除 snapshot 与 pin 之间的 prune 窗口；不能跳到 retentionFloor 充当恢复。S0/sourceSeq 只在 host 内使用，不返回公开 view。返回 `{baselineToken, viewEpoch}`。
2. owner 在有界时间和内存/磁盘预算内把一致 heads 物化为 immutable、仅宿主可读的安全 baseline，完成后释放数据库 read snapshot，不长期阻塞 capture writer。候选上限为 baseline 100000 条/64 MiB、tail backlog 10000 event/64 MiB，均受实际 verified 更低值约束；构建最长 30 秒、baseline lease 最长 2 分钟；超限、超时或增量保留不足返回 typed `over-limit`/`unavailable`，丢弃不完整 baseline，不得截断报 ready；增量积压超限则重建而非阻塞 capture。完成或失效后，先确认 read cursor 和 worker 已退出，再释放相应 durable root；状态未知时保留 root。
3. `readBootstrap({baselineToken, pageToken?, limit})` 返回 `{viewEpoch, entries, nextPageToken}`；末页返回 `{viewEpoch, entries, completionToken}`。limit 1–500，整个响应不超过 512 KiB。高熵 opaque token 绑定 sender、grant/install generation、scope、policy revision、baseline/view generation、页位置及单调期限；当前授权下同一页请求可幂等重试并返回同页和同一下一 token；拒绝跳页、过期或绑定变化。
4. 客户端将所有页写入临时新 generation，用 `completeBootstrap({baselineToken, completionToken})` 确认完整遍历；host 验证授权并串行将 S0 后已持久增量投影到新 view，建立与新事件投影的原子交接点。baseline 表示 S0，viewSeq 预留 `0`；S0 后 tail 按 `1..N` 连续投影，`completeBootstrap` 幂等返回 `{viewEpoch, after:"0", latestViewSeq:N}`，客户端原子切换 baseline 后从 0 完整读取 tail，绝不能把 N 用作起点。complete 只确认遍历和 view 代次切换，客户端声称已保存不是 source/target durable apply ACK；host-owned projection/index 另用 sourceSeq CAS 与激活记录。无法恢复或绑定变化则重新 bootstrap，旧 generation 不得写入。

验收需覆盖 S0 前被 prune 的 live head、并发 upsert/delete、跨账号隐藏事件、分页超限和过期、policy 变化与崩溃；对账 baseline 加 S0 后增量与 scope 的真实 heads，确认旧 worker 不可写。现有 core 无 live-head 枚举，此为新增宿主能力，不声称已接线。

### 跨记录队列（NOT IMPLEMENTED）

`planQueue({snapshotIds, mode})` 的 mode 仅为 `original | compatible | plain-text | partial`，partial 必须先有绑定全部遗漏的 choice；单 snapshot 的 `mode=queue` 不能代替跨记录 session。该接口只接受有序 opaque IDs，最多 128 项，另受 64 KiB 请求及必需 adapter 已验证最小能力约束；支持 100 项为目标，非当前能力证明。owner 按序冻结每项 manifest revision、policy、catalog 和权限，每项仍使用单 snapshot 的 `PastePlanV2`，不改 core schema。任何未声明损失须以一个 choice token 绑定完整有序集合、各 revision 与精确遗漏；显式确认后才可准备队列。

`startQueue({queuePlanId})` 原子消费 queue plan 并持久创建 queueSession、首项 intent 与稳定 resultId；重复 start 返回同 session，不重复写或发键。队列计划对应的用户回贴意图被接受时，owner 观察并冻结首项 `expectedOSRevision`，与历史 captured revision 分开；`startQueue` 接受时及首项预取校验 owned bytes 之后、开始写入之前都只比较该冻结值，不得刷新。计划后或预取期间外部复制导致 revision 不匹配时返回 `superseded`，不覆盖外部内容。逐项通过统一 publisher 发布，不同时预取 100 个大对象；累计仍受 256 MiB 和 verified limits 约束。单项结果分开记录 OS publish 和 paste-session `submitted`/`focus-failed`；submitted 不代表 app 已消费。

`nextQueue({queueSessionId, previousResultId})` 只在前项 `committed` 且 `submitted`、剪贴板仍属于前项精确 write token/revision 时前进；host 确定下项 expected revision，不接受 renderer 提供 index、revision 或 native 字段。外部复制、focus-failed、partial、publication-unconfirmed 均停在当前项，不注入键、不推进。每项发布前重新检查 policy/catalog/owner 并预取该项、核对 digest；durable queue index CAS 和逐项 intent/resultId 将请求绑定其原 currentIndex、previousResultId 及产生的 next resultId；重复 next 返回原结果，不重复 OS 写或键。`readQueue({queueSessionId})` 只给受限状态与 opaque result ID；`cancelQueue({queueSessionId})` fence 尚未开始操作，已开始 OS 写必须报告 partial/unconfirmed，pin 按既有 intent/root 门槛释放。100 次自动输入须独立真实环境验证，不因设计支持就执行。

验收覆盖 100 项目标与 128 上界、预算、队列中外部复制、loss choice 失效、重复 next、写后崩溃与恢复；核对顺序、CAS、内存、各项 OS 写与 submitted，不能把 submitted 当 app 接收。

| 请求/状态 | 重试与反例判定 |
| --- | --- |
| baseline 同页读取 | 当前授权下重试返回相同页与 token；不能跳页或在过期后复用。 |
| complete 已成功 | 返回同一 viewEpoch、after=0；若返回最新 N 会漏掉 S0 后 tail，禁止。 |
| complete 前崩溃或权限变化 | 不确认完整视图，保留必要 root 并 resync；不能把客户端保存声明当 durable apply ACK。 |
| queue start 已消费 | 返回同一 session/首项 intent；不能再次写 OS 或输入。 |
| 队列计划后或首项预取期间外部复制 | start 或写前比较发现 revision 不匹配，返回 superseded；不得刷新 expected revision 或覆盖外部内容。 |
| next 同一 previousResultId 重试 | 根据原 index/CAS 返回同一 next resultId；不能把重试解释为再推进一项。 |
| 前项 partial、失焦或外部复制 | 保持当前项并停止输入；不得推进或用 renderer 提供的 revision 绕过。 |

`plan(snapshotId, mode)` 返回 `prepared(planId)`、`choice-required(choiceToken, sanitized choices)` 或 typed blocked；choice token 为高熵一次性 opaque handle，host 保存绑定的 sender/install generation、session/scope、snapshot+manifest revision、mode、精确遗漏集、policy 与 catalog revision 和有效期。确认只提交 token 和其选项 ID；原子消费、重放/过期/任一绑定变化则拒绝并重新 plan。`planId` 绑定同样上下文及 owned target bindings；不得用 mode 字符串暗示授权所有遗漏。`publish(planId)` 在同一 durable writer transaction 内原子检查并消费 planId、创建唯一 intent 和 resultId；同 plan 重复请求经当前 sender/scope/grant 重新授权后查询已持久的消费记录，即使 plan 已过期也只返回原 resultId，绝不再次 OS 写入或发送粘贴键；无权调用者不得借幂等查询探知结果。提交结果不确定时按 planId 查询 durable intent 后恢复；writing 崩溃保持 unconfirmed，不自动重放。accepted/resultId 仅表示接单。`readResult` 保留原 `ClipboardPublishResultV2Schema` 字段及判定；`publication-unconfirmed` 是 `partial-write.reasonCode`，单独 envelope 承载 paste-session 结果。原 schema 含内部 representation keys 时，普通 renderer 获得单独安全投影；需要逐 target binding 诊断时先版化单独 host-only 扩展，不偷偷添加原 schema 字段。committed 不代表目标应用已消费。

**验收：** unknown sender/frame、重装、跨 scope、超时及 choice 重放均拒绝；伪造 path/bytes/extra field 拒绝；严格 schema 正反例、跨页无漏项、cursor expired/epoch reset 与混版本测试均有真实调用链收据。反例：只校验共享 dispatcher 或只校验 ID 语法无法证明身份或脱敏。

## 3. 本地私有根、配额和回收

路径由宿主解析，macOS 使用当前用户 `~/Library/Application Support/ZTools/ClipboardSnapshotV2/`，Windows 使用当前用户 LocalAppData 下 `ZTools/ClipboardSnapshotV2/`；均独立于 V1 `PLUGIN/`、账号数据库及同步路由，拒绝重解析点/符号链接逃逸，校验已打开对象身份、祖先和所有者。macOS 新目录 owner-only `0700`、文件 `0600` 并检查有效 ACL；Windows 新建受保护 DACL，仅当前用户 SID、SYSTEM 和必要管理员权限，关闭不安全继承，逐层验证实际访问。不可 chmod 现有祖先。平台 ACL 或路径身份不能验证时关闭 store，不能根据 mode 假称 Windows 私有。现有 [`fs-directory.ts`](../../packages/snapshot-store/src/fs-directory.ts) 对 win32 明确 fail closed；上述 Windows adapter 尚不存在。

此隔离防止 V1 API 和其他普通 OS 用户直接读取，并非同一 OS 用户任意代码、管理员、恶意 host 或离线磁盘攻击的沙箱。默认本地 raw 存储不声称加密：产品须明确展示该边界，依赖设备全盘加密不作为 V2 自身保证。若产品要求离线攻击保护，必须在启用前另行批准 local encryption/key 生命周期设计；本 ADR 不虚构 key 或宣称 Keychain/DPAPI 已接入。此限制不削减任何格式及 G0–G4 目标。

初始配额候选：单快照 200 MiB、owned 队列 256 MiB、最多 32 items × 32 rows；这是上限而非能力广告。空间不足 typed reject，已有 pin/待恢复任务不被强删。保留时长与空间配额由 host 拥有的用户配置作为策略参数；未配置时 capture disabled，开启前由 host UI 明确展示并取得确认。不得信任插件声明为当前策略，也不擅自修改用户既有设置。按配置选择最旧 eligible 记录回收；用户可显式删除，删除先 tombstone。回收只对无 live manifest/remote projection/staging/upload 引用、无 consumer lease、无 durable payload pin、无未终结 intent 且满足 journal retention/ACK 条件的对象执行；有歧义保留并报告容量压力，不能凭 TTL 或账户切换释放 pin。startup 在独占 lease 下核对 journal、对象摘要、outbox、tombstone、pins 和引用：未引用对象只在原 GC 条件满足时删除；引用缺失/损坏 quarantine 或 typed storage failure，不能伪装完整；未完成 outbox 幂等重放。host 必须在捕获预检和提交 fence 时读取实际当前配置；不可凭 renderer 传入参数启用或改变保留策略。

## 4. 持久化顺序与失败窗口

macOS/POSIX：同文件系统私有 staging 中排他创建、完整写入并核验 digest/length，对文件调用经验证的 `fsync`/`handle.sync()`（失败即 typed storage failure）；`rename` 到内容寻址最终名后，对目的及 staging 目录执行经目标文件系统验证的目录同步。创建 shard 亦先同步其父目录。再以单个 LMDB writer transaction 原子写 manifest、receipt、blob bindings、changeSeq、outbox/必要 CAS，等待 durable flush 完成再对外确认。当前 Node 组件以 `handle.sync()`、`rename`、目录 `handle.sync()` 和 `db.transactionSync`/`db.flushed` 实现局部候选；host 须固定 LMDB durable flags 和 flush 映射并验证。macOS `F_FULLFSYNC` 仅作为有实际能力证据时可选的更强模式，不要求所有实现使用。支持的模型是所支持文件系统上成功返回的文件及目录 sync 和 LMDB flush，并以重启故障注入验证；不保证所有硬件突然断电后的结果，也不把普通 fsync 等同强持久。

Windows：使用验证 DACL 的 `CreateFileW` 在同卷 staging 排他创建、写全、`FlushFileBuffers`，并用经验证的同卷原子 rename 操作；再完成**已证明的 namespace durability barrier**，随后同样进行 LMDB writer transaction/flush。当前 Windows namespace barrier 的可用 API、文件系统与断电语义 **OPEN / BLOCKED**；`FlushFileBuffers` 文件句柄、目录句柄可打开或 write-through 文档均不单独证明 rename 的 namespace durable，禁止用伪目录 fsync 或仅靠进程重启替代。Win10 和 Win11 的 V2 durable store flag 在证明前均关闭。

故障边界：写入/flush 前 staging 可丢；rename 后事务前可能孤儿，不能作为已提交；事务成功但 flush 未确认结果为 unknown，重启先查同一幂等身份，不盲目重复；提交后引用缺失是损坏，禁止成功展示；outbox 提交后投递/ACK 前可重复但不可漏；GC 必须先持久 expiry marker、重新计算 roots 再删除并同步命名空间。注入每个边界并对账内容、序号、ACK、pin 和恢复；进程 kill 与断电/文件系统证据分别标注，二者不可互换。文件系统与 LMDB 之间没有跨系统 ACID。

Node 文档锚定 [v24.15.0 `filehandle.sync()`](https://nodejs.org/download/release/v24.15.0/docs/api/fs.html#filehandlesync)，文档本身不证明生产宿主实际 runtime 或目录持久性。官方依据：[Apple fsync](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)、[Apple fcntl](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html)、[Microsoft FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)、[Microsoft directory handles](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory)。这些资料不证明目标系统、硬件或文件系统的完整断电保证。

## 5. Native revision、写回和监督

monitor 回调仅是 signal；adapter 读取前后取得真实 OS revision 并建立一致性 barrier。barrier 前变化则丢弃混合结果并 typed superseded；barrier 成功后冻结 captured revision 和独立 owned bytes，另记返回时 observed revision。后者改变时仍提交已一致捕获的旧值并排新采集；不能将 signal sequence 或 observed revision 写成 source.osRevision。host 在原始读取前检查当前隐私、大小、格式和健康，offline 扫描 owned bytes 后，提交串行临界区再次 fence policy、generation、scope、lease、manifest/receipt/digest；无需要求系统板仍为旧 revision。

发布前先预取并核验所有必需数据，持久 intent，再复核 owner、策略、catalog 和 expected OS revision；macOS 一次 clear、一次整组 writeObjects，Windows 同一 clipboard session empty 一次并写入批准的整组格式。逐 binding 读回及 revision 确认后才计对应 source key written；写入中失败如实 partial，所有 key 已写但整体未确认用 `publication-unconfirmed`。发布生成精确 write token 与实际 write revision，monitor 仅在平台可证明两者关联时识别自写；未知或竞争事件照常采集，不采用 300ms 全局忽略窗口。若平台不能可靠识别，则该能力 blocked，不能跳过附近用户复制。

延迟 provider 与 codec 在隔离 helper 中受 wall time、输出、并发和观测 RSS 预算监督，超限停止并确认进程与 stdio 关闭；采样不是内核硬内存上限。取消后的晚返回必须过 fence。状态未知的 helper 不视作终止，保留 pin。当前 [`bounded-process.mjs`](../../scripts/lib/bounded-process.mjs) 和 native probes 是隔离验证，不是生产 supervisor；Windows SDK/WinAPI/WIC/BCrypt 的 105+15 用例尚未运行。每个格式分别验证枚举、preflight、materialization、revision barrier、完整 bytes/摘要、publisher 所有权转移、读回、超时及真实目标应用；一个 codec 的通过不外推其他格式。

## 6. Owner、fence、取消和 pin 状态机

单进程串行队列不足以阻止第二进程：主进程先打开专用私有 lock 文件并持有可信 native lock handle：Darwin 使用 `flock(LOCK_EX | LOCK_NB)`，Windows 对固定首字节使用 `LockFileEx(LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY)`；获取失败返回 typed `unavailable`，不得监听或打开写服务。持有期间不删除或替换锁文件，校验其路径/文件身份，禁止 helper 继承或关闭主进程句柄；helper 重启不释放 owner 锁。Darwin `flock` 为 advisory，仅协调合作进程；dup/fork 可能共享锁，helper 不得继承 owner fd，不能视作阻止同用户恶意进程。Windows byte-range 锁不能阻止 mapped view 访问，进程退出后的释放可能延迟；它同样不隔离同用户恶意代码。锁句柄异常或身份不能证明时按锁丢失处理。在 durable store 中以 CAS 推进单调 generation，所有提交和 intent 绑定 `(hostEpoch, generation, owner, policyRevision, scope)`，提交临界区再次检查锁持有及 generation。锁丢失即停止接单并 fence；接任者先独占、推进 generation、恢复再监听。锁 API、崩溃释放和多进程测试需分别在真实 macOS/Windows 验证；未验平台运行 gate blocked、flag 关闭。官方 API 边界：[Apple flock](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html)、[Microsoft LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)。当前 [`snapshot-store.ts`](../../packages/snapshot-store/src/snapshot-store.ts) 明示没有跨进程 owner lease，现有 [`policy-authority.ts`](../../packages/snapshot-store/src/policy-authority.ts) 只在 owner 内串行 policy/commit。

`admitted → pinned → running → result-durable → terminated → releasable`；任何阶段 scope/policy/install/owner 变化转为 `fenced + cancel-requested`，停止新读取、提交和写入；异步返回即使成功也重新检查 generation/CAS 和策略。只有确认 helper/writer 已退出、target intent 已终结或其有效且已实现的 root 保护数据、全部原 GC 条件满足，才通过 durable pin release 记录进入 releasable。intent root verifier 尚未实现时，未确认操作继续持有现有 durable payload pin；授权 lease 撤销不是 pin release，TTL/PID 消失也不是终止证明。写入已进入 OS 后无法保证撤销回滚：持久记录 partial 或 unconfirmed，重启不得自动重放，也不覆盖用户后续复制。重启遇 writing/未知状态需显式核对。

验收以双 owner 竞争、锁丢失、cancel 后迟到、policy 与 commit 竞争、账号切换、helper 未退出、写入中 kill 和恢复逐例对账；反例是仅 0 待消费、inbox ACK 或取消信号就提前回收。

## 7. 账号、vault 和显式授权

本地根为设备与 OS 用户所有，账号切换先 fence 旧 grant、plan、授权 lease、导出及 activation，再绑定新 scope；既有本地 snapshot 不自动迁移、上传或授权新账号。宿主给用户展示来源账号/设备范围、数据种类、目标 vault 和用途，用户对读取旧本地记录及对同步分别明确授权；撤销停止未来操作并遵守 pin/intent 恢复规则。无账号或无授权可按本地策略使用；用户重新授权不隐含跨账号迁移。

同步必须用明确 `(account, vault)` scope、vault-scoped origin identity 和独立 V2 namespace；用户明确选择创建或解锁 vault，恢复流程须能在新设备重新获得密钥，失败时保持加密原件及不可激活状态，不能悄悄重置覆盖。具体 KDF、密钥派生/包装、AAD、nonce、恢复/轮换和加密 wire 仍 **OPEN，独立 G3 crypto ADR、review 与 known vectors 前禁止同步**；不得复用 V1 `VAULT_VERSION=1` 假称 V2 已设计。Portable 只同步批准的独立 projection/blob；私有 native 名称、路径和 raw refs 不出设备。接收端认证/摘要与当前策略通过后隔离 staging，再按 `(vaultScope, originDeviceId, approvedHostEpoch, sourceSnapshotId)` 的 sourceSeq/CAS 和 activation marker 激活；epoch 改变先显式 resync。六方向及删除、缺附件、冲突、断网、密钥恢复和策略竞争均为原 G3 必选。

## 8. Verified limits、门禁与开放项

能力取该平台、构建、格式、操作的 adapter capture/codec/publisher、store、scanner、transport 和资源限制中**已实测且全部必需路径的最小值**；缺任何一项则该能力不可广告。当前 native capture fixture frame 上限冻结 Windows 2 MiB、macOS 10 MiB；metadata request 64 KiB、response 512 KiB（含 envelope、队列 ID 和 choice 摘要）。此为候选最大值而非生产已验证能力；store 200 MiB 不可作为端到端广告。每 representation 和转换输出都检查，超限 typed reject/明确 partial，不能截断后报完整。并发候选 sender 16、全局 64；32×32 和单项 text/rich-text/url 10 MiB、其他 100 MiB 受所有更低 verified limits 限制。冻结限制或增加限制均需重新取证，不借低限缩减 P1 目标。

`formatSnapshotV2`、`formatReplayV2`、`formatSyncV2` 默认关闭，分别按实际 capability 和原 G0–G4 gate 启用。设计 review 要求七项决策、schema 映射、反例、授权与恢复可追溯；ADR 接受只允许进入经授权的实施准备，不代表运行通过。G0 要求 Mac 和 Windows10/11 原生 revision、格式、写回、资源及真实 App；G1 要求两端真实文件系统、进程、锁、崩溃和 recovery；G2 要求两端 P1、新旧 UI、队列及真实应用；G3 六方向与 crypto 独立 review；G4 Windows12/未来平台另按原方案运行。Windows 10/11 为首期必选，105+15 尚未运行；Mac 本地证据不外推 Windows、安装宿主或正式 App。

**限定设计复审：** Astra 对实际 ADR 定向复核结论为 APPROVE DESIGN ONLY；bootstrap/scope view 与跨记录队列的两项 P2，以及首项 expected revision 锚定的后续一项 P2，均已按复审关闭。此结论只接受设计，不构成实施范围授权、功能实现或平台能力通过。复审未运行测试，宿主运行和平台验收未完成。

**后续实施与运行 gate，非 ADR 接受前置：** (1) root 确认宿主开发 pin、工作区并授权 fetch/隔离，核对可信打包依赖；(2) host UI 配置与本地明文边界落实，若要求离线保护另设计 local encryption；(3) 在 Windows 10/11 实现并验证 DACL、锁和 namespace durability，当前 barrier 未证时保持 blocked；(4) 在支持的 macOS 文件系统核验目录 sync 和 LMDB flush；(5) 每平台验证 self-write 标识与 helper 确认终止；(6) G3 完成独立 crypto wire/key 恢复、review 和 known vectors。相应证据缺失时仅依赖该证据的运行能力保持关闭，不能据此缩减原 G0–G4。SIGKILL 测试不等于断电测试，也不把本文扩展为所有硬件断电保证。
