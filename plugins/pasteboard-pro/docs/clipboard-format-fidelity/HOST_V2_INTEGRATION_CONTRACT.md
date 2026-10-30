# 宿主 V2 接线契约（v0.31 设计候选）

> **状态：DESIGN CANDIDATE / NOT IMPLEMENTED。** 本文定义未来宿主接线边界，所有新接口、能力位、私有存储和生命周期行为均尚未实现。本文件不构成实现授权、发布记录、安装包能力声明或平台验收结果。
>
> 这是根据 ZTools 源码工作区 `fix/security-protocol-validation`、HEAD `9b15fb1a2a9f3ec886016632761c7bb21e39557a`（检查时工作区 clean）的只读检查形成的源码快照；源码事实不代表已安装宿主或 Windows 运行时行为。Windows 10/11/12 原生运行验证均未由本文完成。

`v0.31` 是设计候选的文档版本，不是实现里程碑或 host wire 版本。宿主 Module、transport envelope 与新增状态机仍为 `NOT IMPLEMENTED`，尚未冻结；插件 shared core 中已存在的 schemas 需复用，不在此重新定义。

本契约补充 [技术方案 §1–11](TECHNICAL_PLAN.md) 的宿主实现接线方式，不修改原方案、目标、格式边界或 G0–G4 验收门禁。Planner 与 portable/native 接口边界另见 [V2 Planner 与 Portable 契约](V2_PLANNER_PORTABLE_CONTRACT.md)（配套设计文档）。

## 1. 现状证据与边界

下表仅记录被检查的宿主源码实现，不从预编译原生二进制、安装包或目标系统推断额外行为。

| 源码位置 | 源码可确认的事实 | 接线含义 |
| --- | --- | --- |
| `clipboardManager.ts`（本机只读源码定位：`ZTools/src/main/managers/clipboardManager.ts:L114-L150`） `clipboardManager.ts`（本机只读源码定位：`ZTools/src/main/managers/clipboardManager.ts:L229-L260`） | 构造函数创建 monitor；异步 `init()` 启动监听。变化处理在 `handleClipboardChange()` 中按 `files > image > text` 选择单一类型，再保存并广播。只读搜索未找到 `lastSavedHash`、manager stop 或 cleanup 接线。 | 不能把 V2 多表示快照直接塞进现有单类型记录；不得再创建第二个独立 OS 监听器，并须补齐 host 生命周期 fencing/cleanup。 |
| `native/index.ts`（本机只读源码定位：`ZTools/src/main/core/native/index.ts:L69-L94`） `native/index.ts`（本机只读源码定位：`ZTools/src/main/core/native/index.ts:L194-L249`） | TypeScript façade 通过静态导入路径加载平台 `.node`；监听回调无参数，API 声明包含 start/stop。 | 回调只可作为变化信号；原生二进制内部能力必须另行检查与实机验证，不能从 façade 推断。 |
| `clipboardFiles.ts`（本机只读源码定位：`ZTools/src/main/utils/clipboardFiles.ts:L14-L59`） | 文件读取按 macOS `NSFilenamesPboardType` 与 Windows 原生文件列表分支处理。 | 此 helper 不是任意格式枚举或多表示读取接口。 |
| `database.ts`（本机只读源码定位：`ZTools/src/main/api/shared/database.ts:L47-L69`） `database.ts`（本机只读源码定位：`ZTools/src/main/api/shared/database.ts:L418-L431`） `database.ts`（本机只读源码定位：`ZTools/src/main/api/shared/database.ts:L701-L747`） | 插件 DB 以 `PLUGIN/<name>/` 分区；无 key 的全量读取/清空可触及插件整个前缀；`dbGet()` 将读取异常折叠为 `null`。 | V2 私有原始快照不得进入此命名空间；V2 API 必须返回可区分的类型化错误。 |
| `storageRouting.ts`（本机只读源码定位：`ZTools/src/main/core/storage/storageRouting.ts:L5-L11`） `storageRouter.ts`（本机只读源码定位：`ZTools/src/main/core/storage/storageRouter.ts:L83-L95`） | `PLUGIN/` 属于 account scope；`bulkDocs()` 对每个文档分别执行 `put`。 | V1 插件数据库既不提供独立的设备私有根，也不提供 V2 事务提交语义。 |
| `storageManager.ts`（本机只读源码定位：`ZTools/src/main/core/storage/storageManager.ts:L80-L135`） | 管理当前账号数据库的切换、重绑与关闭。 | 可作为未来账号切换生命周期接线点；它本身不提供 V2 授权撤销或 lease fencing。 |
| `pluginApiDispatcher.ts`（本机只读源码定位：`ZTools/src/main/api/plugin/pluginApiDispatcher.ts:L38-L71`） | `plugin.api` 经共享 registry 分发同步/异步处理器；dispatcher 本身不校验 sender 身份或权限。 | 高权限 API 不得只依赖“调用了 plugin.api”。 |
| `pluginManager.ts`（本机只读源码定位：`ZTools/src/main/managers/pluginManager.ts:L237-L249`） `pluginManager.ts`（本机只读源码定位：`ZTools/src/main/managers/pluginManager.ts:L611-L621`） `pluginManager.ts`（本机只读源码定位：`ZTools/src/main/managers/pluginManager.ts:L945-L956`） | 插件视图加载其插件目录中的 preload；上下文配置含 `sandbox: false`、`contextIsolation: false`、`webSecurity: false`。 | 不可信的可写插件运行时不能成为宿主快照服务的代码依赖。 |
| `pluginManager.ts`（本机只读源码定位：`ZTools/src/main/managers/pluginManager.ts:L1929-L1968`） | 宿主可由 live `WebContents` 查到插件信息及内部 API 标记。 | 新 IPC 应以实时 sender 映射为身份事实，并额外验证安装代次、frame/session 与 capability grant。 |
| `internalPlugins.ts`（本机只读源码定位：`ZTools/src/main/core/internalPlugins.ts`） `plugin/internal.ts`（本机只读源码定位：`ZTools/src/main/api/plugin/internal.ts`） | 通用内部插件检查器对未识别 sender 有放行分支。 | 此 helper 不适用于 V2 的 fail-closed 授权。 |
| `api/index.ts`（本机只读源码定位：`ZTools/src/main/api/index.ts:L251-L253`） `appMain.ts`（本机只读源码定位：`ZTools/src/main/appMain.ts:L214-L226`） | 当前 API cleanup 与 app `will-quit` 接线未包含 clipboard V2 service stop/drain。 | V2 service 必须新增对称的生命周期关闭流程。 |

> 上表位置是宿主兄弟仓库 `ZTools` 的本机只读源码定位（仓库内相对路径与行号），不是本插件仓库中的文件。定位基于宿主快照 HEAD `9b15fb1a2a9f3ec886016632761c7bb21e39557a`；该快照不随本 PR 交付，这些源码引用不是远端证据，PR 检出中无法打开。本文未复制或修改宿主源码。

## 2. Module、Interface、Implementation、Adapter 与 Seam

### 2.1 宿主拥有的 Module

新增宿主 Module 建议命名为 `ClipboardSnapshotV2Service`，位于主进程可信代码链。它是以下职责的唯一所有者：

- 持有单一 clipboard monitor owner/hub，并把 OS 通知当作“需要重新读取”的信号；
- 执行隐私策略、当前 policy revision、预检、捕获/提交生命周期；
- 管理设备本地私有 snapshot store、变更序列、读取 lease 与 target intent；
- 协调受限 IPC、能力协商及平台 capture/publisher adapter；
- 处理账号切换、策略变化、插件关闭和应用退出时的 fence/cancel/drain。

不得从可写插件目录加载该服务、共享 runtime 或关键安全逻辑。被 service 引用的 shared package 必须纳入宿主可信依赖链，锁定版本、构建产物和供应链审查。将 npm 包安装在宿主仓库里本身不等于 trusted；应核对实际 import graph、打包产物及运行入口。

### 2.2 接口和 Adapter

宿主在实现 ADR 评审后定义版本化、窄范围的 IPC `Interface`；平台 `Adapter` 负责把系统原生数据转成受限的内部 DTO；插件 adapter 只向旧/新版 UI 提供统一的展示与消费调用。旧版 UI 与新版 UI 不得各自直接连接原生接口或拥有独立监听器。

建议新增代码集中在宿主 `src/main/core/clipboard-v2/`：

| 候选模块 | 单一职责 |
| --- | --- |
| `contracts.ts` | 快照 ID、变更游标、计划 ID、能力和类型化结果 schema。 |
| `service.ts` | 生命周期、策略 revision、capture/commit、intent 与 adapter 协调。 |
| `ipc.ts` | sender 身份/capability 授权、参数 schema、速率及 payload 限制。 |
| `privateStore.ts` | 私有 manifest/blob journal、lease 和持久 target intent。 |
| `adapters/macos.ts`、`adapters/windows.ts` | 各平台原生快照枚举、revision 和整组发布；能力按平台分别声明。 |

这些是待创建的候选模块，当前宿主仓库没有已接线的 `clipboard-v2` 实现。避免在 `clipboardManager.ts`、IPC 总入口或 preload 大文件中继续堆叠职责；只保留薄 wiring。每个新增源文件须少于 500 行。

### 2.3 明确的 Seam

- **OS 到宿主：** monitor 只通知；host adapter 在其后读取当前 OS snapshot 和 revision。若通知合并或内容已被覆盖，返回明确的 superseded/coalesced 结果，不承诺恢复从未读到且已被覆盖的中间值。
- **宿主到插件：** 只传 schema 验证过的 opaque ID、metadata、状态和游标；原始 native format name、系统对象及裸文件路径不由 renderer 控制或枚举。
- **插件到回贴：** 插件提交预览模式及 `planId` 等逻辑选择；目标发现、原始表示读取和原生写入留在 host adapter 内部。
- **账号与本地历史：** app account/session 是远端同步身份，不是设备本地 store 的 ACL。local store 与账号 vault 是两个独立 Seam。

## 3. 私有存储、账号与授权

### 3.1 提议的默认策略（待 review）

V2 snapshot 默认写入设备本地、当前 OS 用户拥有的专用私有根，和 app account 及 V1 `PLUGIN/`、account-sync、dbStorage 路径分离。确切物理路径、加密/key 生命周期及数据保留周期须在实现 ADR 与隐私评审中确定；不得复用会被插件全量枚举/清空的 V1 前缀。

专用目录的设计作用是把数据与 V1 API、storage routing 和 clear 操作隔离；目标是由平台 ACL 限制不同 OS 用户的常规访问。它不构成对同一 OS 用户下任意 Node 代码、管理员或恶意宿主进程的隔离。macOS 与 Windows 的实际 ACL 效果必须分别实测，不在本文中宣称已验证。需要防护本地磁盘离线攻击时，须另行设计密钥和加密门禁。

app account/session 发生变化时，立即使旧的 capability grant、未发布 plan 与 export/read lease 失效；停止其跨账号导出或激活。默认不自动迁移、重写或上传本地 snapshot，不自动授权新账号读取旧账号留下的本地记录。用户重新授权后才允许相关读取或导出。同步标识始终绑定明确的 account/vault scope，不从 device-local ID 推断同步身份。

### 3.2 IPC 授权契约

每个受保护调用都要由 main process 在执行时重新验证：

1. live `event.sender` 仍映射到当前已安装插件；拒绝已关闭、销毁或映射过期的 sender；
2. plugin identity 与 install generation 匹配已授权对象；
3. 请求来自允许的主 frame、session/partition 与当前有效会话；
4. 该插件获得了本操作对应的 capability grant，且对应 feature flag 已启用；
5. 策略 revision、lease、snapshot/plan owner 和账号 scope 仍有效。

未识别 sender 必须拒绝；不得复用 `requireInternalPlugin` 的未知 sender 放行分支。参数仅接受 opaque ID、受限 mode enum、plan ID 和 cursor。严格限制字段数量、编码长度、单次/累计 payload 字节、分页大小、调用频率和待处理队列；IPC 边界要校验后复制成宿主拥有的 buffer，禁止 renderer 传入可变 shared view。失败用稳定的 typed error code 区分 not-found、unauthorized、expired、over-limit、superseded、storage-failed 等，不能用 `null` 或空数组混淆“无数据”与“读取失败”。

### 3.3 预算设计（候选限制，不代表已实现）

| 预算面 | 候选限制 | 超限行为 |
| --- | --- | --- |
| 并发工作 | 每 sender 最多 16 个 pending；service 总计最多 64 个 job。 | typed `over-limit`，不得排队后静默丢弃。 |
| metadata IPC | request 最多 64 KiB；response 最多 512 KiB。 | 分页；超限返回 typed `over-limit`，禁止截断后伪装成功。 |
| owned raw memory queue 与单快照 | owned raw queue 总量最多 256 MiB；单快照总量最多 200 MiB。 | typed reject/容量结果，不静默降级为 V1 或部分记录。 |
| 单快照结构与表示 | 最多 32 items；每 item 最多 32 representation rows；text/rich-text/url 单表示最多 10 MiB，其他 kind 单表示最多 100 MiB。 | 保留明确拒绝/部分状态；不能丢掉超限 representation 后标记完整成功。 |

Advertised limits 必须取当前平台所有必需 Adapter、私有 store 与 transport 实际验证能力的交集/最小值。现有 capture-wire fixture 的上限为 Windows 2 MiB、macOS 10 MiB；它们不证明生产 IPC、host transport 或 durable store 支持 200 MiB snapshot。生产 transport 尚未实现及验证，不得通过提高配置值宣称扩容。低预算仅能 typed reject，不能 silent fallback。 上述均为应用层准入/输出限制，不是Node heap/RSS硬限额，也不能消除IPC框架或底层provider已经发生的分配；实现还须有隔离执行、超时及可核对终止，不能把采样峰值当内核配额。

### 3.4 Renderer metadata 与 preview 字段协议（设计候选）

以下定义的是拟新增的严格 DTO；尚未有对应 schema 或 IPC Implementation。默认 deny unknown fields。`history-metadata` grant 只允许本表的最小历史摘要，不隐含读取正文、来源应用身份、raw bytes 或同步许可。所有对外 ID 均须由 host 随机生成或生成 opaque alias；通过现有 IdentifierSchema 不代表字符串已经脱敏，不能直接复用可能含原生名字的 representation key。

| 默认 metadata 字段 | 类型/上限与语义 |
| --- | --- |
| `schemaVersion`, `snapshotId`, `manifestRevision` | 版本固定；ID/修订引用为 opaque ASCII，长度1..128，绑定当前设备 store/session/snapshot；不是path、bundle ID或用户自带字符串。 |
| `captureState`, `coverage`, `itemCount`, `copiedAt` | 状态沿用核心enum；coverage仅非负计数，itemCount不超过32；时间为host捕获时间的ISO串，不含窗口标题。该摘要本身受metadata授权和当前策略约束。 |
| `items[].itemIndex` | 维持source顺序，最多32 items；不伪造或合并多item。 |
| `items[].representations[]` | 每item最多32项，仅有host签发的`representationHandle`、固定`kind` enum（text/rich-text/image/url/files/color/other）、核心`state`，以及ready时才有的`fidelity`/已知`byteLength`；unavailable分支不伪造这些值。不返回 source representationKey、nativeName、formatId、MIME、file references、SourceURL或私有header。handle只可在同一snapshot revision/lease下解析。 |
| `continuationToken` | 512 KiB响应预算内分页所需的opaque token，绑定snapshot revision、请求scope及policy revision；不是数据库key，不能访问任意路径。 |

默认不返回 app/bundle/executable/AUMID、source window/title、native私有类型名、绝对路径、账户UID、原始blob ref、原件内容摘要或原始异常。不同用途不能透传一份完整manifest：canonical `readChanges`/inbox 使用的内部引用与回执仅供明确授权的consumer，进入renderer前必须投影为上述DTO；普通renderer metadata grant不能读取内部manifest/ref/hash。源journal schema及持久序号语义保持不变，不将安全投影误作新的权威feed。

可选的 `source-badge` grant 由用户明确授权，并在host侧重新检查snapshot及当前scope：只增加 `sourceBadge: { displayName, iconId? }`。displayName来自host应用目录的受限静态显示名（最多80 Unicode scalars，拒绝控制符），不得取active window标题、文档名、bundle ID或可执行路径。iconId是opaque、短期且snapshot/sender绑定的安全图标标识；配套受控 `readIcon(iconId)` 最多返回128×128、64 KiB的重新编码PNG，不暴露原图标文件、任意路径或联网取图能力。该附加访问不自动授权同步来源身份。

`preview(snapshotId, projection)` 另需对应 `preview-text` 或 `preview-thumbnail` grant；只接收固定projection enum，不接收nativeName/HTML/path。返回严格的discriminated DTO：

| preview kind | 唯一允许的载荷 |
| --- | --- |
| `text` | `{kind:'text', snapshotId, manifestRevision, text, truncated, totalUtf8Bytes}`；由独立获批文本preview codec从owned bytes产生，输出text最多64 KiB UTF-8，不割裂字符边界，控制符受明确展示策略处理。超过显示预算时必须`truncated:true`，不把预览冒充完整内容或用于回贴。UI只以text node显示，无innerHTML。 |
| `thumbnail` | `{kind:'thumbnail', snapshotId, manifestRevision, mediaType:'image/png', width, height, bytes}`；最大256×256、重新编码后最多256 KiB，元数据被移除，执行解码的隔离worker/helper另受资源预算；仍遵守512 KiB总响应限制。它是派生预览，不是exact原件。 |
| `unavailable` | `{kind:'unavailable', snapshotId, manifestRevision, reasonCode}`；固定错误enum，不含内容、SourceURL、本机path或底层exception。 |

其余字段均拒绝。初期不返回可执行HTML/SVG/PDF或带外部资源的markup；需要富预览时必须另建受限codec、字段协议及独立验收，不能借plain/text预览绕过。preview输出之前重验sender/lease/policy，preview grant与导出/同步grant分离；新旧UI同样遵守。任何合法preview仍会向获准调用者展示内容：这些最小化规则减少误透传与错误复用，不能保证具有同一OS用户任意Node权限的恶意插件无法复制已获准内容。实现必须禁止V2 adapter将metadata/preview自动回写V1 record/vault；不得把API命名空间隔离宣传成恶意代码sandbox。

## 4. Capture、策略和自写回环

1. **单监听 owner：** 由 host monitor hub 管理一份 OS 监听。V1 逻辑若仍需变化事件，由 hub 扇出信号；V2 不得再启动一份会与旧监听冲突的 watcher。旧 `clipboardManager` 的长文件只做接线调整。
2. **signal 后读取：** native callback 不携带 revision 或快照；host 可记录自己的 signal sequence，但不得将其伪称为 OS revision。Adapter 在读取/物化前后取得实际 OS revision 并做一致性 barrier，成功后冻结 `capturedRevision` 与 owned bytes；返回时再观察到的 `observedRevision` 单独记录。barrier 前变化且未得到一致内容时不拼接载荷；barrier 后外部新复制不能让已一致捕获的旧快照被丢弃，应保留旧 captured bytes 并另排新版本采集。 对应现有core source的`osRevision`必须绑定captured revision；返回时的observed revision另记于观测上下文，不能覆盖immutable source。
3. **读取前预检：** 在读取原始 bytes 前，于 host 内评估当前隐私策略、大小/格式预算、capability 与存储健康；拒绝时不读取或导出 payload。UI 不能通过传入任意格式名绕开预检。
4. **拥有型数据与提交：** 平台 Adapter 返回有界、独立拥有的 byte copies。service 对策略/账号变化做 fence；在串行提交临界区内再次检查 policy revision、授权、lease，以及 manifest/receipt/bytes 与已冻结 captured revision 的绑定；不要求此刻全局 clipboard 仍停在 captured revision。持久化顺序是：先将 raw blob 写入 staging 文件并 flush，rename 到最终 blob 名后同步目录；再用一个 LMDB writer transaction 提交 manifest、blob refs、changeSeq 与 outbox，并等待 flush 完成。文件系统与 LMDB 之间没有跨系统 ACID 事务；崩溃/失败窗口须由 startup reconciliation 识别孤儿 blob、缺失引用及未完成 outbox，且只有在原 GC 条件满足时才能回收。任一策略/授权不匹配则不提交元数据并报告 typed failure。
5. **自写识别：** 发布剪贴板内容时生成精确 write token/expected revision 并绑定写入结果；后续 monitor 通过 token 或平台 revision 判定自写事件。不得用全局 300ms 时间窗忽略监听，因为它可能遮蔽用户紧随其后的复制。

能力发现只可报告实际验证过的 capture、prepare、write、revision 和 private-store 能力。feature flags `formatSnapshotV2`、`formatReplayV2`、`formatSyncV2` 各自独立保持 `false`，直到相应平台和端到端门禁完整通过。任一平台的 Windows storage/G1 guard 未闭合时，不得启用需要该能力的 Windows flag；macOS 通过也不自动启用 Windows。

## 5. 生命周期、结果和 IPC 面

| 生命周期事件 | 必需行为 |
| --- | --- |
| app start | 校验私有根/版本/配额；初始化 store 与策略，再启用唯一 monitor；失败时报告能力不可用，不静默回退到 V1。 |
| account/session switch | 先撤销旧 scope 的 grants、plan 与读写授权 lease，停止旧账号导出和激活，再绑定新同步身份；授权撤销不自动释放 durable payload pin，设备本地 snapshot 不迁移、不自动授权。 |
| plugin close/uninstall | fence 该 install generation 的任务并拒绝后续调用；撤销该插件的授权 lease，但不据此自动释放 durable payload pin。等待 helper 确认任务终止，且关联 target intent 已终结或满足原 GC 条件后才可回收。 |
| policy change | 增加 revision 并撤销受影响的读写授权/plan，串行阻止旧策略下的最终提交；授权撤销不等于释放 payload pin。 |
| app quit | 停止/解除 monitor、停止接收新请求、fence 在途任务、取消并 drain workers，flush durable intent/store，最后释放 adapter。未确认终止或状态未知的 pin 不自动删除，也不能用 TTL 越过原 GC 条件。 |

取消信号不是完成证明：异步读取即使在 cancel 后返回，也必须因 generation/policy fence 失败而不能落库或写回。撤销授权 lease 只阻止新的消费，不等于 helper 已终止或 durable payload pin 已解除。owner 失效时，仍有有效消费者 lease、未终结 target intent 或状态未知的 pin 都不得提前回收；只有 helper 确认终止，且 target intent 终结并满足原 GC 条件后才能回收。plugin close 不得任意清理 active pins，未知 pin 不按超时自动删除。 授权撤销可阻止尚未开始的提交/写回；若OS写入已经开始或已经发生，仍须按partial-write/publication-unconfirmed核对副作用，不能声称撤销能回滚已写出的字节。

| IPC Interface（候选） | 插件可见内容 | host 内部责任 |
| --- | --- | --- |
| `capabilities()` | 版本、平台和已验证 feature flags。 | 从实际可用且通过门禁的 adapter/store 派生，禁止静态常量冒充能力。 |
| `readChanges({ hostEpoch, after, limit })` | 复用 `ClipboardJournalReadResultV2`：page 含 typed `upsert`、`outcome`、`delete` event、`nextCursor`、`retentionFloor`；host reset/cursor expired 是独立 typed 结果。 | page 还绑定 hostEpoch、after、limit、latestChangeSeq；`after` 使用 U64 decimal string，limit 按既有 schema 限于 1..500。操作失败由 IPC typed error 表达，host reset、cursor expired、error 均不得伪装为空 page。 |
| `getMetadata(snapshotId)` | 仅§3.4严格metadata DTO；sourceBadge额外授权。 | 校验 owner、权限及当前 scope；不提供任意 blob/path 查询。 |
| `plan(snapshotId, mode, choice?)` | 联合结果：`prepared` 才返回 `planId`；`choice-required` 返回不含 payload 的 `choiceToken` 与选项摘要；`blocked` 返回 typed reason。 | host 读取私有 raw representation，验证预算、策略、目标和实际平台 write 能力；后续 choice 只提交 opaque token/choice ID，不得把待选择或不可执行请求伪装成 ready plan。 |
| `publish(planId)` | 只表示 durable intent 是否被 host 接受：`accepted` 时返回 `resultId`；拒绝时返回 typed error。 | 重验授权、policy revision 与 target intent；接受仅表示 host 接单，不代表原生写入成功或目标应用已接收。 |
| `readResult(resultId)` | 持久、typed 的原 `ClipboardPublishResultV2`，以及分离的 paste-session result（例如 `submitted` / `focus-failed`）。 | `publication-unconfirmed` 是 `partial-write.reasonCode`，不是顶层 status；OS 写回与键盘/焦点提交分开记录，不宣称 app accepted。 |
| `readIcon(iconId)` | 仅source-badge授权的受限PNG。 | 验证opaque图标标识、sender/snapshot/lease，禁止任意path及联网。 |
| `preview(snapshotId, projection)` | 仅§3.4 text/thumbnail/unavailable DTO及对应grant。 | 使用隔离的无网络 projection；预览不得覆写或降级原 representation。 |

插件共享 core 已定义 [`ClipboardJournalReadResultV2Schema`](../../packages/core/src/clipboard-publish-v2.ts#L241-L400)，包括带 hostEpoch/changeSeq 的三类 event、带 nextCursor/retentionFloor/latestChangeSeq 的 page、`host-reset` 与 `cursor-expired`。未来 host `readChanges` 应复用这份 typed contract；production host transport、sender authorization 与 IPC error envelope 仍未接线，不能因此宣称宿主 wire 已验收或全部冻结。

`plan()` 的概念结果同样不是冻结 wire：

```ts
type PlanResult =
  | { kind: 'prepared'; planId: string; expiresAt: string }
  | { kind: 'choice-required'; choiceToken: string; choicesSummary: Array<{ id: string; label: string }> }
  | { kind: 'blocked'; code: string; reason: string };
```

再次调用 `plan()` 时只可提交 opaque `choiceToken` 与选中的 choice ID；token 必须绑定原 snapshot、mode、授权、policy revision 和有效期，不能由 renderer 重写计划内容。

插件共享 core 已定义 [`ClipboardPublishResultV2Schema`](../../packages/core/src/clipboard-publish-v2.ts#L64-L174)；其 status 区分 `committed`、`partial-write` 及非变更错误，`publication-unconfirmed` 通过 `partial-write.reasonCode` 表达。回贴会话的 `submitted` / `focus-failed` 与该 schema 分离，边界见[技术方案 §7](TECHNICAL_PLAN.md#L292-L313)。Host API `publish()` 的 `accepted` 只表示 durable intent 已接单；后续 `readResult()` 返回原 schema result 与独立 paste-session result。`committed` 仅表示冻结计划的 OS 写回结果，不代表应用侧确认消费；不得增加 `app-accepted` 之类无证据状态。Host transport envelope 及 wiring 仍需 ADR 与实机验收。

不开放通用 `getBlob(rawPath)`、任意 MIME/raw name 读取或 renderer 可调用的 native write。插件负责 history projection、搜索及新旧 UI 的 consumer interaction；两版 UI 共用同一插件 adapter 与 host Interface。

目标写回按 durable intent 设计：保存稳定 `sourceSeq`、幂等 plan、目标/激活标记和可恢复结果；通过 source sequence CAS 与明确的 intent 状态，确保崩溃恢复后不会漏处理或重复激活。V1 `bulkDocs()` 是逐项 put，不能作为原子提交依据；inbox ACK 不能替代 durable intent/activation marker。

## 6. 实施批次与验收

此节是后续实施顺序建议，不改变 [原方案 §1–11 与 G0–G4](TECHNICAL_PLAN.md) 的通过条件：

1. **授权后准备 host worktree：** 从上述 clean host HEAD 建立独立开发 worktree/branch `codex/paste-format-v2-service`；本次没有创建 worktree，也没有对宿主仓库写入。核对分支与工作区后，先冻结 Interface、schema、威胁边界和格式预算。
2. **宿主核心与 fail-closed IPC：** 实现 private store、monitor hub、capability grants、typed errors、account/policy fences 与生命周期；增加单元/集成测试，覆盖未知 sender、关闭 sender、安装代次变化、cancel 后晚到返回、policy 竞争提交及存储错误。
3. **原生平台 Adapter：** 分别实现 macOS 与 Windows capture/revision/整组 publish；逐项通过 portable/native probes、source+binary hash 绑定、自写回环及本机应用验证。Windows10/11 是原技术方案首期必需平台；缺少 Windows 环境时不能用模拟接口代替原生验收。
4. **插件 Adapter 与消费/恢复：** 旧/新版 UI 共用 interface；验证持久游标、冷启动恢复、durable target intent/sourceSeq CAS、并发 owner/lease fencing、删除和配额行为。
5. **账号同步与正式发布 gate：** 仅在明确的 account/vault identity、密钥、恢复和隐私门禁后逐项开启 `formatSyncV2`；没有相应 evidence 时保留关闭状态。

### 6.1 Implementation ADR gate

进入 host 代码实现前，需在独立 Implementation ADR 中明确并 review 下列目前尚未定义或尚未在 host wire 中冻结的决策；完成 ADR 也不代表实现或能力已验证：

- host IPC envelope、sender grant、cursor/event transport 与 choice-token 生命周期及兼容/升级策略（复用既有 shared schema 的映射不另造字段）；
- 专用根的物理位置、跨平台 ACL/key 方案、配额、保留策略、GC 与 startup reconciliation；
- 每个平台文件 flush/rename/directory sync 与 LMDB writer transaction/flush 的具体 API、失败窗口和恢复证据；
- OS revision、自写 token/变更识别、延迟渲染 helper 监督和平台 Adapter 的逐格式可验证边界；
- producer/helper 取消及 lease 授权撤销与 durable payload pin 释放之间的状态机；
- sync account/vault scope、加密密钥、恢复与显式授权交互；
- production transport 的大小预算、adapter verified-limit 协商，以及 Mac/Windows 的实机验收矩阵。


G0/G1/G2/G3/G4 各门禁仍按原计划逐项取证；以“待消费数为 0”之类局部结果退休记录或用例，不等价于完整 consumer fencing 或整组闭环。Windows 12 及后续正式版本需有可运行宿主/SDK/系统环境，再按原 G0–G3 要求形成正式证据；本候选文档不声称支持它们。Mac、Windows 10/11、具体格式与目标应用的运行验收不能以 source-only、fake host API、package smoke 或其他平台结果替代。

## 7. 当前交付状态

- 本次只新增此接线设计文档；未改宿主代码、插件实现、原方案章节或 G0–G4 证据。
- 本文全部 `ClipboardSnapshotV2Service`、IPC、私有 store、平台 Adapter 和 feature flags 均为 proposed / NOT IMPLEMENTED。
- 文档中的宿主引用用于定位检查过的源码；安装版能力、Mac 完整运行 gate、Windows 10/11 原生测试及 Windows 12 测试仍须独立核验。

## 本轮独立设计复审

两项P2（planner预算遗漏rich-text/url与metadata IPC、renderer allowlist未细化）已关闭，结论为有限范围APPROVE design；reviewer未运行实现测试或平台验收。所有新增能力仍为NOT-IMPLEMENTED，设计复审不构成跨仓写入授权或任何G0—G4通过。

证据：[只读源核对与文档收据](EVIDENCE_INDEX.md#v031)、[独立设计复审](EVIDENCE_INDEX.md#v031)、[完整主路径差距](EVIDENCE_INDEX.md#v031)。
