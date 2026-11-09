# G3 验证预算持久化 ADR

**状态：ACCEPTED DESIGN / NOT IMPLEMENTED（限定设计复审通过）。** 本文设计一个可由现有 codec 调用的验证预算 Module，不改变 [G3 crypto ADR](G3_CRYPTO_ADR.md)、原 G0–G4 目标或生产授权；不提供可信宿主、密钥保护、生产同步或 Windows 支持。`formatSyncV2` 保持关闭。

## 1. 当前事实与本次切片

[`V2BudgetAdapter`](../../packages/sync-protocol/src/v2-node/types.ts) 的 `reserveVerification(lease, request): Promise<void>` 与 `recordAuthentication(lease, authenticated): Promise<void>` 不携带 reservation ID；`V2Lease` 只有 token 和 mode。当前 [`verification.ts`](../../packages/sync-protocol/src/v2-node/verification.ts) 的 `admitted` 为每次 control signature、control MAC、publication MAC 调用 `authorize` 再调用一次 `verifyAttempt`；[`encryption.ts`](../../packages/sync-protocol/src/v2-node/encryption.ts) 的 open/unlock 也为每次 GCM verify 申请独立 lease。recovery 的 parent lease 只用于 fence，子验证各自申请 lease。**代码没有保证 authorize 返回的 token 唯一**；测试 fake 的行为不能替代该保证。

[CodecGate](../../packages/sync-protocol/src/v2-node/gate.ts) 的 Map/Set 仅是当前进程的补充检查；真正的预算由注入 adapter 负责。现有 [snapshot-store journal](../../packages/snapshot-store/src/journal.ts) 使用 LMDB `transactionSync`、`SYNCHRONOUS_COMMIT` 和 `flushed`，但 `OPEN_DATABASES` 仅进程内；[snapshot-store](../../packages/snapshot-store/src/snapshot-store.ts) 明示没有跨进程 owner lease 和可信 current-policy transport，[Windows 私有目录](../../packages/snapshot-store/src/fs-directory.ts) 当前 fail closed。上述局部组件既不实现本设计，也不能证明断电、防回滚或实际宿主行为。

**本切片只实现验证预算**：真实 LMDB 持久预留、会话失败锁、完成幂等和进程恢复；注入现有 codec 后，实际四种 crypto verification unit 都计数。构造的 adapter 必须实现完整 `V2BudgetAdapter` 形状，但 `reserveSeal`、`registerAttempt` 固定 typed `unavailable`，绝不 noop 或虚报成功；因此 seal、wrapper 和 bootstrap 不可用。本切片不签发权威 lease、创建账号/vault/root、登记 writer、批准 admin、维护 checkpoint、启用 flags 或输出生产授权。seal counter、immutable wrapper ID、attempt registry、bootstrap 和 checkpoint/registry 持久化是后续独立模块；它们仍是 G3 必需项，不因本切片通过而关闭。

## 2. Interface 与可信 Seam

`openVerificationBudget({mode, directory, expectedStoreId, expectedInstallId, owner, resolver}) -> Promise<{budget, beginAttempt, finishAttempt, promotePreparedRoot, unlockSession, close}>`：`budget` 实现现有四方法 interface；`reserveVerification(lease,request)` 和 `recordAuthentication(lease,boolean)` 成功均 resolve `void`；这两个方法只记录 unit，可信 host 必须以 `finishAttempt` 结束完整操作，`reserveSeal`/`registerAttempt` 固定拒绝。`unlockSession(adminLease, sessionRef): Promise<void>` 为仅可信 host 持有的管理入口：sessionRef 是受限 `{storeId,accountBindingId,vaultId,deviceId}`，`keyEpoch/rootId` 如有仅作为 host 已认证的管理上下文交叉验证，不参与 security 定位；真实 session/security generation 由 host claim 解析，不能由调用者指定新计数或锁状态；需匹配专用 unlock 权限和独立一次性授权。`beginAttempt(hostLease, operation): Promise<attemptLease>` 在可信 host 接受完整 public codec 操作前固定预先批准的流程/identity；`finishAttempt(attemptLease, outcome): Promise<void>` 与 `promotePreparedRoot(preparationLease, authenticatedChain): Promise<void>` 是仅可信 host 能调用的管理入口，严格语义见下；不得由 renderer 指定其结果。`close(): Promise<void>` 幂等并等待事务关闭。Module 的 typed errors 为 `invalid-input | unauthorized | expired | conflict | locked | capacity | storage-failed | unavailable`，不含原始 exception、路径或内容；当前 CodecGate 会把 budget 方法异常折叠成对外 `unavailable`，测试须分别核对 Module 与 codec 实际结果。打开目录、锁和初始化必须 fail closed；只接受宿主提供的绝对专用私有根，不接受 renderer/plugin 路径。所有配置、request/lease 在首个 await 前复制为有界 owned 值，拒绝未知字段、非法 ID、非 canonical U64、过大输入、可变共享内存及无效 method；不写入密码、密钥、恢复材料、剪贴板或原始 payload。`close()` 拒绝新请求、等待已接收事务结束并关闭数据库；不把 close 当作 verification 成功。

可信 host resolver 的真实 Interface（尚未实现）不是 plugin 提交的 JSON：`resolveActive(token, request) -> immutable claim` 用于新预留，`resolveForFinalization(token) -> immutable claim` 仅查明既有身份/结果登记权限，`resolveUnlock(adminToken, sessionRef) -> immutable unlockClaim` 独立授权显式解锁；reserve/unlock 的同步 permission fence 与最终结果输出 fence 均由 owner 提供。finalization resolver 即便 token 已过期或撤销也必须安全识别已预留身份，不能把它当仍可消费权限。已认证 root 的 claim 包括：`storeId`、`rootId`、`managementInstanceId`、`accountBindingId/vaultId/keyEpoch`、`installGeneration`、`deviceId`、稳定 `securityGeneration`/unlock generation、`sessionId`、可信完整 `attemptId`、`ownerGeneration`、`operation`、`verificationUnit`、原 `bindingSha256`、单次 lease token identity、单调到期/撤销状态和 fence。`reserveVerification` 必须将其与 request 的 operation/scope/unit/hash 逐项比较；完成时只能按同 token 找已登记 claim，绝不能让调用方用不同请求或布尔值指定另一 session。准备态 claim 是 §3.1 的单独严格 union，可无 rootId/managementInstanceId，只能从可信旧锚点与 parent recovery intent 派生，禁止被当作已认证 claim。rootId 将相同 epoch 数字的不同 root 分叉分开；host 负责从已验证 control/可信 checkpoint 和实际 session 确立 claim，不能从未认证 envelope 或可写 plugin 自授。

**token 值与对象身份：** `CodecGate.authorize` 复制并冻结 lease，只保留 `{token,mode}`；resolver 必须按 token 的值查询可信持久绑定，不能依赖传入 object 引用、WeakMap 或 lease 附加字段。mode 也与可信 claim 比对；token 在所有验证及 store 生命周期全局唯一且不可复用。

**单次 lease 决策：** 对每一个实际 verification，可信 authorizer 必须签发全局不复用的高熵 token；host 持久或可验证地绑定恰好一个 claim，且同 session 至多一个完整 top-level attempt in-flight；该 attempt 的子验证按序逐项申请不同 lease、逐项终结。子验证各自 token，parent token 不可拿来计数。模块把 token 的 SHA-256 作为私有 reservation key 并拒绝重复 token；不存可重放明文 token。此约束下保留现有 `void` reserve 和 `recordAuthentication(lease,bool)` 可准确关联，不需新增返回字段。若真实 host 无法保证唯一 token、同步有效的 resolver/fence 或同 session 单飞，现有接口不足，必须先版本化 interface，不能猜测或匹配最近一条。

**线性化要求：** trusted owner 的独占 service lease/generation 与 active permission fence 必须覆盖从新 reserve/unlock 的 claim 验证到同步 LMDB transaction 提交的临界区；策略、账号、安装、会话撤销与该临界区具有同一串行次序。异步 `resolve` 后再单独提交数据库不能证明没有撤销竞态。实现用 owner 提供的受信、不可由 plugin 伪造的同步 guard/串行执行权，并在事务内验证 generation 与 claim 快照；实际宿主 transport/锁尚不存在，故生产 adapter 暂不可用。测试可注入显式、可控测试 resolver/owner，但必须标明 fixture，不把它称为真实授权。

## 3. 持久状态和事务

独立 LMDB environment、版本化私有 namespace；不得复用 V1 account DB、V1 固定槽或可写插件 DB。候选持久行：

| 行 | 键与值 | 不变量 |
| --- | --- | --- |
| `meta` | schema/version、storeId、设备实例、owner generation、初始化证明 | 缺失/不识别/损坏不能作为空库重置；初始化和重开协议须防误建。 |
| `epochBudget` | `(storeId,accountBindingId,vaultId,deviceId,keyEpoch)` → `{used,rootBinding?}` | 准备态和已认证正式态使用同一行同一 `used`，跨全部 origin domain 与四种 unit 累计；rootBinding 初始可未知，认证完成后 CAS 绑定，另一 root 返回 conflict、保留消费和证据。历史 root 只读恢复也按各 epoch 单独计数。 |
| `security` / `session` | 稳定 `(storeId,accountBindingId,vaultId,deviceId)` → `{securityGeneration,unlockGeneration,currentSessionId,activeAttemptId?,pendingTokenHash?,failureStreak,locked}`；另有有界 session/attempt 记录 | key 不含 epoch、root 或 session：同一设备同一 vault 的当前/历史/准备验证共用唯一 security generation、session、global streak/lock 和完整 attempt 单飞。换 epoch/root/session 或重启都不能清状态。 |
| `preparation` | `(stableSecurityKey,expectedEpoch,candidateDigest,parentAttemptId,step)` → 不可变受信准备 intent | 只保存锚点、候选与步骤身份，不保存另一套 used、streak 或 lock；先检查同一 security row，再使用目标 epochBudget。 |
| `attempt` / `reservation` | 可信完整 attemptId 与 tokenHash → immutable claim、securityGeneration、request hash、state 和 result | state 为 `pending | completed-success | completed-failure | unknown`；只允许一次完成，禁止 token 跨 scope/session/operation 重用。 |

**并发语义比较与选择：** 可按实际 durable completion 提交顺序定义连续失败，允许同 session 多个 in-flight，但必须处理第 32 次失败后迟到成功不得解锁及取消/未知排序；亦可按预留序号缓冲完成，但需额外持久缓冲和 crash 缺口规则。本切片选择每个稳定 `(storeId,accountBindingId,vaultId,deviceId)` security key 的 trusted security session 按完整 top-level attempt 单飞：`beginAttempt` 排斥另一 attempt；同一 attempt 的子 unit 逐项 reserve/complete，使预留序与 completion 序一致，避免乱序成功清零或解锁；不同 session 的切换也须经 host 显式交接且继承同一 security generation 的 streak/lock。此取舍需独立 review；不静默改变原 G3 总目标。

每次 reserve 由 owner guard 包围单一 LMDB 同步 writer transaction：解析/核验 claim，验证其绑定当前唯一 active attempt 和允许的下一验证步骤、绑定身份与请求、检查同一稳定 security row 未锁且 activeAttempt 正是当前 attempt、当前无 pending unit，并检查目标 `epochBudget.used < 2^32` 和 token 从未使用。formal claim 必须校验该 epochBudget 已有 rootBinding 与可信 rootId 一致；prepare claim 使用相同 epochBudget、只登记受限 preparation intent，不能建立 rootBinding。目标行若已 formal 绑定，也仍在该行计费；在同一事务 `used += 1`、创建 immutable pending reservation、设置同一 security row 的 pending。提交并等待 `db.flushed` 成功且再次 fence 后才返回；最后一次允许的预留使 used 恰为 2^32，下一次拒绝。无论验签失败、撤销、取消、timeout、崩溃、输出未知均不退款。`flushed` 失败或提交结果未知返回 typed storage/unavailable，不能当作未提交并重新运行；重开后读取 token 进行保守恢复。只依本地同步/flush 模型，不宣称任何硬件掉电保证。

`recordAuthentication` 使用 token 值和 `resolveForFinalization` 找回已持久 reservation 的原身份，即便权限已撤销/过期也必须允许可信执行者记下已发生的 crypto 结果；此入口只终结已有预算记录，不授予新消费，也不能由 plugin 任意提交结果。由持有执行权的 trusted owner 以同步 guard 在同一事务核验不可变 reservation/claim、pending token、session 与 result，写 `completed-success/failure`、清 session pending 并等待 flushed。真实失败 streak +1，达到 32 当场锁定；单个 unit 的真实成功只记录其成功，**绝不重置 streak**。仅可信 host 在完整 public codec 操作全部必要 unit 成功结束并确认最后 fence 后，通过 `finishAttempt(attemptLease,"success")` 原子复核该完整 attempt 的不可变记录、预定操作所需 unit 全部出现且真实成功（非空）、真实 codec 正常完成且结果满足操作的认证/结构/链要求、没有失败/unknown、未撤销且 security generation 仍一致，才将 streak 置 0。host 在可信进程内包装完整 codec 调用，只有 finish durable 成功后才向宿主调用者交付结果；无此 wrapper 不构成生产可用。操作失败用 `finishAttempt(attemptLease,"failure")` 终结但不重复计数已记录的失败；失败发生在 crypto 前则不伪造验签失败，结果/调用终态无法证明时锁定。quarantine 或普通 promise resolve 不能单独冒充完整认证成功；无成功 witness 的 quarantine 只可保留受限结果且不得清 streak，任何结果释放仍需 durable 终结及 fence。若已撤销/过期，在记录已知结果的同时保守锁定该 security session，成功结果不得清已有 streak 或解除锁；不能辨明身份或结果则 durable 标记 `unknown` 并锁定；若写入/flush 失败无法确认已持久化锁定，则停止整个 Module、保留原 pending，重开时先完成 unknown+锁定恢复，不能声称锁已落盘；used 不回退。CodecGate 之后的 permission fence 独立决定能否向调用方释放结果；记账成功不等于授权输出。并发 `true/false`、与授权撤销竞争均由 owner 串行；相同 token + 同结果的重复完成返回原确定结果而不再次计数，结果冲突拒绝并锁定该 session。每个 reservation 固定 securityGeneration/unlockGeneration，旧代次的迟到完成不得改变新代次 streak、pending 或锁；可以只对旧 reservation 幂等记事实。不同 token 不得越过单飞锁，避免乱序完成把较新失败重置成成功；不同稳定 security key 可并行申请，但 LMDB writer 事务串行且 epochBudget 不丢增量；同设备同 vault 的历史/当前/prepare 及不同 session 都不能绕过单飞或锁定。实际 codec 的 fence 失败可能在 reserve 后、`verifyAttempt` try 前发生；该 pending 不可被误判成功或退款。

重开在取得已证明独占 owner 后扫描 pending：将其标记 `unknown`、消费维持不变并持久锁定对应 session，再允许不同稳定 security key 且未锁的安全 session 操作；同设备同 vault 的 root/epoch/session ID 变化不能绕过锁；记录损坏或不可确认关联则整个 Module fail closed。运行中发现过期/撤销时不应先删除原 reservation：若可信执行者报告已发生结果，按上述终结记账并保持锁定；完成失败、结果未知或 worker 未确认终止时保守锁定并保留 unknown，不凭 TTL/PID 消失自动释放或将 pending 当失败完成。explicit unlock 仅通过可信 host 授权、在确认相关 helper 已终止并 durable 终结或隔离旧代次 pending 后执行独立同步事务：递增持久 unlock generation 并清该 generation 的 streak/lock，保留 lifetime 和历史 reservation；session 重建、不同 sessionId 或重启必须继承原 security generation 状态，不得绕过锁定或用相同 token。接口扩展给 host 的 unlock 属本 Module 管理入口，不暴露 renderer，不在 codec 内自动调用。

**恢复和存储身份：** 普通重启只有当同设备/安装身份、受信 owner 代次、真实私有目录和已初始化 store 完整性经 host 验证，且不是备份恢复/克隆/回滚，才允许继续原累计值；任何未知均停用，不能创建新空库冒充续存。此 Module 不能凭 LMDB 文件自证未回滚；OS 备份恢复、克隆或不可验证的状态须走 G3 规定的新身份/新 root 等可信恢复流程。Mac/Windows 的锁、ACL、namespace durability、设备身份及硬件防回滚不在本切片中实现或声称：缺少证据的平台保持不可用，尤其现有 Windows guard 不解除。

### 3.1 完整操作的失败计数与新 epoch 准备

**选择和反例：** 逐 unit 成功清零会使 `unlockPassword` 的合法 control 签名成功后、密码 GCM 失败循环始终停在 1；`verifyControl` 的签名成功后 wrong root MAC 同理。本设计采用上述可信完整 attempt 结束清零，而不是每种 secret 独立失败域：它保留原 ADR 的“session 连续 32 次失败”全局语义，混合失败也计入同一 streak。每个真实 signature/MAC/GCM false 仍立即计费、更新并可能锁定；中间 true 不重置。签名合法不会抹掉随后 GCM/MAC 失败。`beginAttempt` 的 attemptLease、操作种类、预定必要 unit 序列/可验证动态链规则与 `finishAttempt` 的成功终态只能由可信 owner 在同一受控进程从真实 codec execution/completion 生成并绑定；不同 unit lease 均解析并绑定到同一 attempt，renderer 不能选择失败域、步骤或声称成功。异常退出、取消、超时、被撤销、finish 提交未知时保守终止/锁定，不发输出、不清 streak。一个已失败/unknown unit 的 attempt 不得以伪造 finish-success 覆盖，不能以未运行 unit 的直接 resolve 清零。允许用户明确 unlock 仅在 §3 的受信条件下进行；不把用户输入次数或单个签名成功当完整验证成功。

**新 epoch 信任准备：** 当前 [`recoverWithChain`](../../packages/sync-protocol/src/v2-node/recovery.ts) 验证后继签名前未知新 root；不能用未认证 control 的 rootId 直接建立 epochBudget 的正式 rootBinding。可信 owner 从**已验证本地锚点和 parent recovery intent**签发有界 `verification-preparation` claim：绑定 store/device、旧 checkpoint/control/publication digest、parent attemptId、唯一候选 control digest、允许的 expectedEpoch、step ordinal 与最多 128 步、scope、security generation、operation/unit/request hash 及 owner generation。前置 budget transaction 先检查 parent 和目标都对应的**同一稳定 security row**：若已锁或已有其他 active attempt，立即拒绝，不得等 promotion 才检查。随后在目标 `(storeId,accountBindingId,vaultId,deviceId,expectedEpoch)` 的唯一 `epochBudget` 行预留并消费；若 rootBinding 尚未知则继续保持未知，若已有 formal binding 则仍使用该行和原 used，不建立第二套 provisional 额度。prepare claim 仅授权尝试验证，不授权数据写入、签发域或自授新 root；其 intent 单独记录 candidateDigest/parent/step，但不持有计数或锁。claim 不依候选字段自证，超出锚点允许的步数/epoch、digest 不匹配或同 security key 已有其他 attempt 均拒绝。所有跨 epoch 子步骤共享该 security row 的 streak/lock 和 generation；切换 epoch 不能获得新的失败预算。

在可信 wrapper 内完成所需 admin 签名、旧锚点/后继关系、wrapper GCM、root MAC、publication 及 keyring 等完整链检查和 policy/fence 后，`promotePreparedRoot(preparationLease, authenticatedChain)` 由可信 owner 证明链完成（不能仅由 renderer 传入对象宣称 authenticated），同步事务核对 candidateDigest、父 intent、全链 digest、rootId/managementInstanceId 和 security generation；在目标唯一 epochBudget 上 CAS rootBinding：未知时设置经认证 rootId；已有相同 rootId 时只确认一致，不修改 used；已有不同 rootId 返回 conflict，保留已发生计费和证据。prepare 与 formal 从始至终共享 used，不发生后期合并或二次相加；promotion 绝不清除、覆盖或解锁稳定 security row。只有已定义的完整认证 finish 成功可清 streak，但不能解已锁状态；unlock 只能由显式管理入口执行。promotion 成功后才有正式新 root 权限；任一失败/中断仍保留计费和去重，未知则锁。候选控制数据本身永远不是 authority。后续候选同 epoch 若冲突由可信用户显式选分支，但旧计费不可用分支切换清零。

### 3.2 容量和不可复用证明

候选全 store 硬上限：最多 4096 个 epochBudget（含 rootBinding 未知的准备行）、4096 个持久 session 行、100000 个 reservation/attempt 及终结墓碑、64 个 pending unit/attempt、512 MiB 逻辑记录字节；每条记录编码不超过 4 KiB，LMDB map 上限 1 GiB。每次预留在同一事务先核对上述全局计数及预留后字节数，达到任一上限返回 `capacity`，不先执行 crypto、不裁剪或覆盖记录。不同 root/scope/session 共享全 store 容量；可信 owner 绑定唯一 storeId/设备安装，禁止创建平行空根或新 session 来绕过限制。LMDB map 上限是配置和空间准入，不保证 OS 物理磁盘硬配额；map-full、磁盘满和异常增长均 typed `storage-failed` 并停写。

reservation 的 tokenHash 去重墓碑保留至整个 store 被经 host 明确退役且不再接受旧 token；禁止按 TTL、完成或会话解锁删除，不能压缩丢失 membership 后允许复用。清理必须有独立、受审的 owner/authorizer token 永久撤销证明和原子退役机制；本切片不实现该机制，容量耗尽即 fail closed，不宣称可用满 2^32。热路径只用主键、pending 索引和事务内计数，不做全表扫描。重开允许受监管全量一致性审计，最多扫描 100000 reservation、4096 session/epochBudget、512 MiB 逻辑字节、30 秒；任一超限/超时或计数不一致则打开 blocked，不提供部分成功。具体机器能否满足时间/空间预算须真实测量；上限不增加 G3 目标的任何完成声明。

### 3.3 初始化与 owner guard

`mode` 是严格判别联合：`create` 需 host 签发的一次性初始化许可，绑定 expectedStoreId、expectedInstallId、设备、专用路径和 owner generation；`openExisting` 必须携带同样的已登记 expected identities，不携带创建许可。create 在已确认不存在的专用根建立不可复用 initialization intent，经文件/父目录规定的持久步骤及单一事务写完整 meta，flush 确认后由可信 host 原子消费许可并登记 store；已存在环境绝不覆盖。openExisting 不使用会创建库的路径，任何目录/环境文件/meta 缺失、identity 不匹配、损坏或未知 schema 直接 blocked，不能当新库补建。create 任一崩溃/unknown 必须由相同可信 intent 和许可状态对账；只能恢复原有确切 storeId 或 fail closed，不得再次发新 storeId 清零。许可消费与宿主登记跨持久域没有隐含 ACID，具体 intent/对账与 crash case 属本切片交付。

`owner.withGuard(expectedStoreId,expectedInstallId,expectedOwnerGeneration, action)` 由可信 owner 获得独占 service lease 并持有串行执行权至 flush/fence 结束；`action` 内的 `owner.runSyncTxn(claim, callback)` 在同一有效 guard 下同步验证身份/generation、执行 LMDB `transactionSync`，callback 禁止返回 Promise、await 或 reentrant 调用，检测到立即 abort。权限撤销与 reserve/unlock 在 guard 内同序；finalization 使用独立身份解析、仍需有效 owner 但不要求旧消费权限 active。txn 外仍持 guard 等待 flushed 并执行输出 permission fence；owner 失效、flush 未确认或 guard 无法证明连续持有时返回 unavailable、停止释放结果并走 unknown/recovery，不能伪造原子提交。新 owner 接手须先独占、验证 store/install 和完整 pending 恢复。

## 4. 安装、依赖和文件归属

计划在 `packages/snapshot-store/src/g3-verification-budget/` 创建独立 Module：`types.ts`（可信 Interface/claim 与结果，预计 <200 行）、`records.ts`（严格持久记录及键，<250 行）、`store.ts`（LMDB 打开/版本/guard/flush，<350 行）、`budget.ts`（reserve、complete、unlock/recovery 状态机，<400 行）。各文件均 <500 行，职责可测试；确切拆分可按复杂度调整而不降低边界。通过该 package 的独立子路径导出和 runtime build 显式打包，仅引入项目已有 `lmdb@3.4.4`，复用现有锁定依赖；源码/构建配置及必要类型引用应在实施前审查依赖图，不从插件可写 runtime 加载为宿主可信代码。现有 snapshot-store 公共 journal 没有通用 G3 KV API，不能伪装调用它已提供的能力，也不把新逻辑堆入现有 `journal.ts`。

**包依赖及可交付入口：** 选择显式 `snapshot-store → sync-protocol` 的 workspace type-only 依赖：实施时在 `packages/snapshot-store/package.json` 添加 `@pasteboard-pro/sync-protocol: workspace:*`，在插件 `pnpm-lock.yaml` 的 snapshot-store importer 记录 `link:../sync-protocol`，并在其 `tsconfig.json` 增加 `../sync-protocol` project reference；现有 sync-protocol 只依赖 core，故方向不形成 cycle。通过公开子路径 `import type { V2BudgetAdapter, V2AuthorizationRequest, V2Lease } from "@pasteboard-pro/sync-protocol/v2-node"` 做类型绑定，Module 创建结果以 `satisfies V2BudgetAdapter` 和编译期 assignability 测试守护，不使用跨 package 相对私有路径或复制另一份权威 interface。可信 seam 仍须对输入做 runtime 防御性校验；其规则与公开类型/现有 codec 测试对照，变更引发 contract 测试失败，不把本地 validator 当第二个可独立漂移的协议。类型导入构建后擦除，不将 Node crypto 实现或插件可写 runtime 动态加载到可信 host。

预定在 snapshot-store package exports 中新增 `"./g3-verification-budget": {"types":"./dist/src/g3-verification-budget/index.d.ts","import":"./dist/runtime/g3-verification-budget.mjs"}`；入口 `src/g3-verification-budget/index.ts` 只导出 `openVerificationBudget` 和需要的 host Interface 类型。`scripts/build-runtime.mjs` 改为一次构建两个 entry，保留现有 `./dist/runtime/index.mjs`，并生成 `./dist/runtime/g3-verification-budget.mjs`；TypeScript build 输出对应 `./dist/src/g3-verification-budget/index.d.ts` 和模块声明。当前 build 使用 `emptyOutDir:true`，必须在同一次 build 中覆盖两个 entry，不能新增第二次构建而清掉旧产物；验证旧入口与新入口各自从打包产物导入、类型解析及 Node/Electron Node smoke。正式 host 仍须审查实际依赖、版本锁和可信打包图，产物可导入不等于授权。现在不安装依赖、不修改 package/lock/source。

本地 codec 接线测试使用明确标记的受控 resolver、owned 私有临时目录与真实 LMDB adapter，把其注入 `createV2NodeCodec`；测试作者提供的 fixture 不是生产 authorizer。跨进程仅在可验证的 OS lock/owner fixture 下测试，不能将同进程 `OPEN_DATABASES` 或 LMDB 自身写锁当 owner/授权证明；Windows ACL/目录同步未具备时该平台 typed unavailable。生产 host 可用前需实现/审查可信 owner、resolver、注册与策略、打包供应链、平台根和 lock，且不能从可写插件加载安全代码。

## 5. 需求、反例和验证

| 需求/测试 | 操作与必须观察到的结果 |
| --- | --- |
| 真实 codec 四类计数 | 调用 signature、control MAC、publication MAC、GCM 的真实 codec，逐次 reserve/complete；每个 unit 恰增 1，bad tag/signature 也消耗；成功 unit 不单独清 streak。测试与业务调用经过同一 public Interface。 |
| 上界与 scope | 2^32−1→2^32 边界仅作隔离的纯算术测试；真实 LMDB 100000 记录上限更早生效，不能伪造少量记录+巨大 used 当完整持久一致性证据；多个来源 domain 在同设备同 epoch 的唯一 epochBudget 累计；同 epoch 出现不同 rootId 返回 conflict、不得重置预算；只读历史 root 也按各 epoch 计数。 |
| lease 与授权 | 不同对象但相同 `{token,mode}` 可定位同一 claim；WeakMap/扩展字段不可作为身份。未知、复用、跨 scope/operation/unit/hash/session、旧 generation、过期及撤销的**新预留**均拒绝；父 lease 不代替子 lease。 |
| 撤销后完成 | 预留后 crypto 真实成功或失败、随后 token 撤销/过期：可信 finalizer 可按原 reservation 持久记录结果，保守锁定且不释放输出；身份/结果/提交未知 → unknown+锁定，used 不退款。伪造 finalizer 不能填写其他 session 结果。 |
| 并发及乱序 | 同 session 第二个 top-level attempt 在第一未终结时拒绝/有界等待，同一 attempt 的子 unit 顺序完成；不同稳定 security key 并发预留不丢计数；同设备同 vault 的 root/epoch/session 变化不得绕过 pending/锁定；迟到成功不可解锁，结果冲突锁定，相同完成幂等。 |
| 真实成功完成 | 完整 attempt 含操作要求的所有真实 unit 并取得 codec 认证/结构/链成功后，只有 finish durable + fence 才清 streak/释放结果；空 unit、promise resolve、quarantine、伪造 success 或含失败/unknown 均不得清零。 |
| 复合 public codec 失败 | 对真实 `unlockPassword` 连续 32 次合法 signature + 错密码 GCM，及 `verifyControl` 合法 signature + 错 root MAC；每次中间签名成功不得清 streak，第 32 次锁定；完整操作成功且 finish durable 才重置。 |
| 后继 epoch 准备 | 真实 `recoverPackageToControl` 首次后继签名前 root 未知：准备 claim 从旧锚和 parent intent 绑定 candidate/step，先计费再验证；未完成链不能 promote，失败不退款，非法候选不授权。 |
| 共享预算和全局锁反例 | 同设备同 vault 的全局 security 已锁或已有 formal attempt 时，从任何旧锚发 prepare 必须在首个验证前拒绝；若发现旧格式矛盾状态（target 锁而旧锚声称未锁）必须 fail closed，不得先信旧锚；已有相同 root binding 的 prepare 只增加同一 used、promotion 不重置；formal 与 prepare 竞争同一 security 单飞及同一 epochBudget，不能各用一套额度或二次合并。不同 root promotion conflict 保留计费，epoch 切换不能解锁。 |
| 初始化与 guard | create 初始化各崩溃点、许可消费未知、openExisting 缺库/缺 meta/ID 不符拒绝；异步/reentrant callback、owner 丢失及 flush 未知均 fail closed。 |
| 失败锁与解锁 | 连续 31 次失败后允许下一次、第 32 次失败锁定；真实成功仅在完整 public codec 操作的 finishAttempt 成功后清 streak；显式 host unlock 不清 lifetime，重启或变更 sessionId 不自动 unlock；unlock generation 单调，历史 used 不变。 |
| crash/fence | 在事务前、提交前后、flush 前后、reserve 与 crypto 之间、crypto 后及 completion 前后 kill/restart；pending → unknown+锁定，used 不回退；commit unknown 不重复运行。 |
| 失效与容量 | 恶意/损坏/未知版本、缺身份、磁盘满、写/flush 失败、resolver 延迟撤销、tokenHash 碰撞/冲突均 fail closed；100000 行、4096 scope/session、64 pending、512 MiB 与重开扫描/30 秒边界逐项测定；新 scope、session 或空目录不能绕过全局上限，墓碑不凭 TTL 删除；日志无内容/密钥。 |
| 多进程与克隆 | owner 竞争仅一个获得独占；锁丢失 fence，迟到 callback 不产生通过结果。复制/备份恢复或身份未知无法证明安全时禁用旧 store，不伪称可检测所有克隆。 |
| 非切片方法 | 实际 codec 调用 seal/wrap/registerAttempt 明确 unavailable，不能分配假 counter 或返回成功；测试确保 flags 未开启及 V1 未回写。 |

测试输出与故障 fixture 仅写本插件新 v037 owned 路径；不覆盖已有收据。至少运行 Node24 定向类型检查、真实 LMDB integration、单独子进程 kill/recovery、适当的 Electron Node 模式以及现有 V1 相关回归；平台、打包和运行环境分别记证据，失败或未运行不能称通过。独立复核须读取实际 diff 和源绑定证据。当前这些测试均 **NOT RUN**，设计接受不代表代码已实施或测试已通过。

## 6. 开放及验收门槛

设计复审须确认：trusted resolver 与 owner 同步 fence 的 Interface 能实现唯一 token 和真实 session；session 的重启/显式 unlock 不产生可绕过的重置；LMDB 初始化及 unknown 恢复满足上述事务顺序；真实 codec 的调用路径覆盖四类 unit。若无法给出可信同步 guard，停在设计 blocked，不引入 noop resolver。注册/bootstrap、checkpoint、seal durable adapter、可信 host 及 Windows 能力是本切片外的后续必需门禁；任何一项未完成都不能将本切片通过提升为完整 G3、G0–G4 或生产支持。

## 限定设计复审沿革

首轮提出 2 项 P1、2 项 P2；第二轮剩余 1 项 P1，其余闭合；最终定向复审确认剩余 P1 闭合，结论为 APPROVE DESIGN ONLY。受审文本 SHA-256 为 `86b43847d3eb4a0e9b2bf853af9caf66f3f437ec139ee0f880628c531af38e5b`，其后仅更新状态及沿革。该结论不代表实现完成、运行验收或宿主授权。

## v037 实施容量澄清（待源码复核）

64 表示全局至多 64 个 active top-level attempt 的逻辑 slot；每个 slot 最多有一个 pending unit，pending unit 自身全局也不得超过 64，但 attempt 与其 unit 不作为两条 slot 相加。第 65 个 begin 必须在同一持久事务中返回 capacity。此段是实现期间的容量语义澄清，**不属于此前已审定源码的通过结论**；实际实现及边界测试仍需独立复核，不改变已冻结的 G3 crypto ADR。
