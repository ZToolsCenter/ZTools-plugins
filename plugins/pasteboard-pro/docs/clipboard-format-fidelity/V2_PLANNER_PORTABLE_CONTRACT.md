# V2 Planner/Publisher 与 Portable Projection 契约候选

> 状态：设计候选，尚未实现。本文只补充原方案的接口和实现边界，不修改 [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md) 的目标、P1范围或G0—G4验收门禁。所有新增planner、publisher、portable codec、projection和接收端激活能力均为 **NOT-IMPLEMENTED**。

## 1. 当前实现边界

- `ClipboardSnapshotManifestV2Schema` 定义本地快照清单形状、表示状态、唯一key、source顺序、coverage及同item的`derivedFrom`关系；V2 capture/store目前是局部组件，不代表生产host/preload接线完成。
- `PastePlanV2Schema` 只校验计划对象的严格字段、key唯一和planned/omitted不重叠。它不读取或验证manifest、receipt、payload bytes、codec能力、策略、lease或系统剪贴板状态。仓库没有实际`planPasteV2` / V2 publisher调用链。
- 当前 V1 `paste-item` 路径不构成V2派生格式计划。`content-html-projector.ts`和`content-rtf-projector.ts`生成隐私扫描投影，不能用作回贴codec或“原始纯文本”来源。
- 现有同步加密契约固定`VAULT_VERSION=1`及V1对象/AAD字段；它没有实现本节提议的V2 portable wire或密钥域。

见[快照schema](../../packages/core/src/clipboard-snapshot-v2.ts)、[发布schema](../../packages/core/src/clipboard-publish-v2.ts)、[HTML隐私投影](../../apps/ztools/preload/content-html-projector.ts)、[RTF隐私投影](../../apps/ztools/preload/content-rtf-projector.ts)、[V1加密契约](../../packages/sync-protocol/src/crypto-contract.ts)。

## 2. Planner 与 Publisher 边界

以下均为候选模块与接口，不表示现有实现。

| Module | 边界与职责 |
| --- | --- |
| Renderer Interface | 仅传opaque `snapshotId`、用户选择的`mode`以及host签发的`choiceToken`；只接收可展示的计划摘要与opaque `planId`。不得提交native format name、path、blob key/ref、bytes、命令或策略结论。 |
| Trusted `PastePlannerV2` | 从owner读取并验证manifest、policy receipt和owned payload；查询目标平台codec能力；生成内部冻结计划；处理用户确认。Renderer传来的schema-valid对象不能成为可信计划。 |
| `RepresentationCapabilityCatalog` | 按系统/构建/目标adapter报告版本化的可读、可转换、可写和文件引用能力。scanner codec只说明扫描解释能力，不代表发布能力。 |
| Trusted `ClipboardPublisherV2` | 只接受opaque `planId`；重新核验冻结计划的policy、lease、能力、引用与payload；在目标OS adapter执行整批写入并返回受控结果。 |
| `PortableProjectorV2` / `StagedImporterV2` | 只将经allowlist验证的portable表示编码入独立V2 projection；接收端先隔离、验摘要和策略，再以激活marker提交可见记录。 |

Renderer侧建议形状：`plan(snapshotId, mode) -> summary | choice-required(choiceToken, sanitizedSummary)`；`confirm(choiceToken) -> planId`；`publish(planId) -> accepted(resultId) | typed-reject`；`readResult(resultId) -> {submissionState, nativePublishResult}`。`choiceToken`由owner绑定manifest revision、遗漏集合、policy revision、capability catalog revision及请求身份；过期、重放或上下文变化时重新要求owner生成选择。返回renderer的summary不包含raw/native format名称、路径或私有payload信息，token本身不向renderer解释其内部绑定。`accepted`仅表示host已持久接受intent，不表示OS写入或目标app收到了内容；native结果与transport提交状态分层。

### 2.1 Host-only `PreparedPlanV2`

它是内部冻结对象，不是`PastePlanV2Schema`的别名，也不传给renderer。至少绑定：

- `planId`、`sourceSnapshotId`、`manifestRevision`、`hostEpoch`；
- 按原source顺序冻结的`itemIndex -> representationKey -> {rawDigest, targetCodecId, targetCodecVersion}`；file reference不伪造payload digest，而是冻结reference identity与可访问性检查结果；
- `plannedRepresentationKeys` / `omittedRepresentationKeys`始终是source manifest的选择单元。另有host-only `targetBindings[]`：`sourceRepresentationKeys -> {targetFormatSlot, itemIndex, codecId, codecVersion, outputDigest, length, ownedObjectRef}`。转换结果存为owned derived object，不插入或改写source immutable manifest，不伪装成manifest原key；
- `capabilityCatalogRevision`、`currentPolicyRevision`、service lease和sender lease；
- `expectedOSRevision`、payload pin，以及路径/引用权限与可用性检查的owner记录。

Planner须从可信store重新加载schema-valid manifest和与其绑定的receipt，再校验全部raw blob长度/hash及references。不能将`PastePlanV2Schema.parse()`当manifest或授权验证。发布时复核上述版本与权限；任一绑定已变化就返回superseded/明确失败，不静默重算另一份计划。 `expectedOSRevision` 是本次用户回贴意图生效时观察的当前板 revision，与历史 `capturedRevision` 分开：历史快照允许显式回贴，只有计划后又发生的外部复制才按预检/最终观察报告 superseded 或未确认。不能用“当前板不再等于历史 captured revision”拒绝所有历史回贴。

多个source key映射到相同`(itemIndex, targetFormatSlot)`时，只能在声明版本化codec等价规则且output bytes/digest相同后合并写入，并保留到全部源key的映射和确认关系；同slot产出不同payload则choice-required或拒绝，不能任取winner。source key只有其所有required target bindings均完成目标读回确认后才计入`writtenRepresentationKeys`。所有bindings已读回但整体publication/revision未确认时，可按现有schema报告`partial-write(reasonCode=publication-unconfirmed)`；有target binding缺失/失败时，partial结果必须保留每个binding的受控reason与状态以供`readResult`恢复/诊断。现有聚合schema不足时，先版化host结果契约，不静默丢弃细节。

### 2.2 Selection 与 mode 语义

冻结计划里的`plannedRepresentationKeys`与`omittedRepresentationKeys`必须无重复、无交集，并在每个item内合并后**恰好覆盖实际manifest的全部representation keys**；禁止unknown key、漏项、重排source items或将unavailable表示列入planned。计划应保留source item顺序。若任何item没有可写的planned representation，拒绝计划，不生成空写入。

每次plan都必须返回明确的source omission set；`compatible`和`plain-text`也可能省略原image、RTF或private表示。只有mode/UI事先明确声明、且与该次目标及可见遗漏语义完全对应的转换意图，才可视为已确认的loss contract。未声明的遗漏、unknown格式或整item无可写表示必须choice-required或blocked；`mode`字符串本身不是任意丢项授权。显式partial确认token绑定全部具体遗漏及对应revision/policy/catalog。

| mode | 允许的语义 |
| --- | --- |
| `original` | 仅同平台、已验证且目标adapter能原样写回的exact native表示和经owner验证的file reference。缺少要求的原格式时拒绝或走显式choice；不能悄悄替换为fallback。 |
| `compatible` | 仅使用注册的目标codec转换；输出有独立digest、codec版本和派生来源，保留raw原件，不把转换结果标为exact。 |
| `plain-text` | 从owned bytes经完整、获批准的文本codec生成；不以OCR结果、HTML/RTF隐私scanner projector或搜索索引冒充原始文本。 |
| `queue` | 每个队列项复用同一planner/publisher边界，逐项按source顺序发布，并记录每项结果；队列不承诺跨多次OS写入的整体原子性。 |
| `partial` | 只有owner提供绑定精确遗漏集合的choice-required token，用户确认后才可冻结。mode字符串本身不能授权任意省略。 |

Windows snapshot schema限定一个logical item、index 0。跨历史记录多选应明确提供逐项queue，或拒绝；不得只发布第一项，也不得拼接私有bytes伪造一个表示。 跨记录队列由owner把有序、受metadata预算及advertised item-count限制的snapshot ID列表解析为独立subplan IDs；不能把多记录伪装成一个`PastePlanV2.snapshotId`。队列session在第一项观察当前OS revision，后续项只在当前板仍归前一项write token/revision所有时衔接；不能给全部subplans冻结同一个旧expected revision。每项重新检查policy/能力和当前所有权；外部复制、partial或publication-unconfirmed时停在当前项，不发送粘贴键、不推进queue cursor，不自动重试。

## 3. Publish 状态与副作用顺序

建议顺序：完整预取所需payload和file references、逐项验证digest/额度/权限 → 持久化publication intent → 检查owner lease、当前policy、能力目录及`expectedOSRevision` → OS adapter执行一次clear/empty加一次整批写入 → 核验write revision和written keys → 持久化结果。

- Mac adapter按原方案构造所有`NSPasteboardItem`后clear一次、`writeObjects`一次；Windows adapter在同一次clipboard session内empty一次并设置整组批准格式，逐格式核验所有权转移与写入结果。Windows整组不是OS事务，部分失败必须如实报告。
- 复用现有`ClipboardPublishResultV2Schema`能表达的状态：`committed`必须确认冻结计划的全部planned keys及其target bindings；`partial-write`表示OS clipboard可能已改变，其中整体revision未确认用受控`reasonCode=publication-unconfirmed`；非变更错误明确`clipboardMayHaveChanged=false`。若契约不足，先版本化schema，不向结果偷加字段。
- durable intent在任何OS变更前提交。进程在`writing`阶段重启、写回结果不确定时保持unconfirmed并等待显式核对，不自动重放注入，以免重复覆盖剪贴板。不要做通用自动rollback：clipboard可能已被用户或其他进程更新。不得把模拟Ctrl+V当作OS写入成功或目标应用已接收；`submitted`与`appAccepted`是独立证据层。
- timeout/cancel后只有在确认helper/writer已终止且无active writer，且对应durable intent已终结或其payload仍由可恢复intent/既有GC roots持有时，才能释放本次临时payload pin。intent未确认时不能将pin当成可随账号切换销毁的授权lease；policy/sender lease撤销只阻止新消费，不能抹掉intent和recovery roots。helper状态未知时保留引用并进入可核对的未确认状态；不得按PID消失或超时自动释放。 publication intent/plan 若要成为持久 GC root，必须先实现并版本化 root verifier/recovery；当前 store 不认识这种 root。在此之前未确认操作须继续持有既有 durable payload pin，不能用候选 intent 行代替保护。

### 3.1 Adapter 输入/输出预算

所有平台capture、codec中间值、IPC、store、native publisher和sync transport都须分别限制输入与输出字节；对同一操作公布的能力取这些必需边界中**已实测验证的最小值**。现有capture-wire fixture边界为Windows 2 MiB、macOS 10 MiB；它们不能证明production IPC或native publisher可传更大内容。

| 约束面 | 当前schema/store或fixture的边界 | 超限规则 |
| --- | --- | --- |
| 清单结构 | 最多32 items × 每item 32 rows，即最多1024 representations。 | 在进入下一边界前typed reject/partial原因；不丢行后标ready。 |
| 单representation | text/rich-text/url均最多10 MiB；其他kind最多100 MiB。 | input与derived output都要分别检查。 |
| 快照/store | 单快照总计200 MiB；owned raw queue上限256 MiB。 | 真实pipeline任一组件未验证该值时，广告能力按更小值；不声称当前链路可端到端传满200 MiB。 |
| Native frame fixture | Windows 2 MiB；macOS 10 MiB。 | 不能因后续store预算较大而绕过frame限制。 |
| metadata IPC | request最多64 KiB；response最多512 KiB；与[host预算](HOST_V2_INTEGRATION_CONTRACT.md#33-预算设计候选限制不代表已实现)一致。 | 队列ID列表、choice摘要、metadata页均计入；分页或typed reject，不截断后宣称完整。 |

任何native或portable codec遇到超限都应在分配/写入前typed fail，不能截断、悄悄省略representation或继续用不完整digest/bytes。

## 4. Portable 表示映射候选

本表定义目标codec开发边界，不是已支持清单。`raw`始终在source设备保留为本地原件；portable值是独立派生表示。

| P1表示 | 本地原件与portable候选 | 保真/限制 |
| --- | --- | --- |
| Unicode text | 本地保留原生bytes；经严格验证的UTF-8或`CF_UNICODETEXT` UTF-16LE解码成独立UTF-8 portable text。 | 拒绝非法编码、歧义NUL及猜测ACP/OEM；保留逻辑字符与行尾，不做Unicode/行尾规范化，除非明确版本化codec定义并记录。Windows的CF_TEXT/CF_OEMTEXT须有明确codepage证据，否则不可解码。 |
| HTML | 本地保留`public.html`或完整CF_HTML原bytes；portable codec保留HTML context与fragment语义范围。 | CF_HTML容器为UTF-8，StartHTML/EndHTML/StartFragment/EndFragment按最终序列化的UTF-8 **byte offset**重建，不能用JS字符/UTF-16索引。SourceURL及私有header不默认同步。 |
| RTF | 本地保留原bytes。 | 只有独立、完整的跨平台codec、相应scope扫描、附件归档与缺失判定齐备时才portable；未知/外部/未归档附件令表示不可eligible或partial。隐私投影不等于RTF解码或纯文本codec。 |
| HTML + TSV | 两种representation独立保留、分别编码。 | 不从HTML推造TSV；不承诺工作簿对象、公式或全部Excel样式。 |
| PNG/JPEG/TIFF | 保留OS提供的编码原件及digest；可选另产像素派生representation。 | 同格式原bytes只有通过目标codec/应用验证才可exact。解码后转PNG等属于compatible；ImageIO/WIC解码能力不能自动证明色彩profile、bit depth或全部TIFF变体一致。 |
| URL | 保留校验通过的原URI bytes；portable表示仍是惰性文本/引用。 | 不自动打开、联网、percent-decode或归一化。`file:` URI及本机path只在来源设备本地可用，不作为跨设备路径上传。 |
| 多文件引用 | 本地保留已验证、有序的reference与来源设备。 | 本P1引用能力不意味着文件正文被复制或同步；目标设备无法验证可访问性时不得发布可执行引用。 |
| 颜色 | 保留可验证的local native原件。 | 必须新增专用、版本化、经过校验的portable color codec。不得把NSColor archive、native handle或应用JSON泛化为颜色协议。当前没有正式portable color codec，是实现/验收阻塞；不得以local-only措辞降低P1本地采集要求。 |

PDF、SVG、HEIC、RTFD、应用私有数据及native handles默认unavailable/local-only，直到各自拥有独立、受限、经过源/目标验证的codec。RTFD附件不能在未归档时压平后标成exact。没有任何codec通过时V2 sync必须保持关闭；部分表示local-only不等于全部P1或G3通过。

Microsoft文档说明CF_HTML以UTF-8容器和字节偏移表达片段；Windows标准格式文档说明系统文本/文件等格式的不同表示。此处按这些边界重新序列化，不把系统容器格式当作跨平台portable wire：[CF_HTML format](https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format)、[standard clipboard formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats)。

## 5. `PortableSnapshotProjectionV2` 候选与接收

建议的独立projection envelope字段：

| 字段 | 含义与约束 |
| --- | --- |
| `projectionVersion`, `projectionId` | 独立wire/schema版本与投影身份。 |
| `sourceSnapshotId`, `sourceManifestRevision` | 绑定本地来源快照版本，不携带完整本地manifest。 |
| `sourceCursor: { hostEpoch, changeSeq }` | 从真实source journal事件与manifest/receipt绑定取得，changeSeq为U64 decimal string；不是OS revision、壁钟或renderer传值。它参与projection摘要与authenticated envelope，供target sourceSeq/CAS fencing。 |
| `originDeviceId` | vault-scoped opaque identity，不暴露可跨vault关联的设备身份。 |
| `items[]` | 保留`itemIndex`次序；仅列portable codec已验证的表示。 |
| `representations[]` | 每项包含`portableCodecId`、codec version、投影自身的blob ref、SHA-256 digest、length和受限derived provenance；ref只能指向portable blob。 |
| `omissions[]` | 仅包含脱敏、枚举化的reason code及必要item index；不包含格式私有名、内容或路径。 |
| `projectionDigest` | 对版本化、规范编码后的projection body计算自身摘要；canonical byte encoding需单独冻结。 |

远端不得包含native private name、source bundle/app identity、SourceURL、本机路径、private raw blob refs或指回私有source payload的依赖。derived provenance只可使用opaque source representation key和digest，且须经同步策略明确允许；来源raw完整保留在本地。remote omission不能让receiver通过source device读取私有bytes。

本地`captureState`与接收设备的`availability/importState`分开存储，接收失败不改写源capture结果。下载先authenticate/digest、以内存执行receiver current-policy检查，再写隔离staging；全部required portable附件及同一policy revision通过后，才在串行化的activation marker中以target `sourceSeq`/CAS激活。读取者忽略marker之前的暂存数据。bulkDocs逐文档返回结果，不能被当作全批原子commit。

Target应用水位按 `(vaultScope, originDeviceId, approvedHostEpoch, sourceSnapshotId)` 保存，不能用一个全局“最高已完成seq”拒绝另一个snapshot的较早任务。相同snapshot的较旧upsert不得覆盖较新revision或delete。未知/变化的hostEpoch与旧epoch序号不可比较，必须显式origin-resync并切换target generation，撤销旧worker/任务；不得自行把新epoch视作较新数据直接激活。该resync机制尚未实现，未完成前保持typed blocked/quarantine。

V2删除另用无载荷的portable tombstone，绑定vault-scoped origin、sourceSnapshotId、sourceCursor、tombstoneRevision及受认证摘要；不能复用V1 tombstone或携带私有blob/path。接收端先持久化该snapshot的delete水位并通过target CAS，再处理可回收引用；晚到的下载/activation须被该水位和target generation拒绝。删除或策略拒绝不得把源captureState改写为失败，也不得跳过未完成task后虚报全局cursor已连续确认。

已知envelope中的未知单manifest版本可opaque quarantine，保留加密原件且不parse后重写丢字段；envelope/vault wire本身无法理解时停止本轮，不回写索引。V2须独立冻结vault namespace、KDF/key domain、AAD和envelope version，与当前V1隔离；在独立crypto实现、review和known-vector验证前，不启用V2同步，不宣称V1 crypto已支持V2。

Consumer Inbox的metadata ACK不等同target apply。即使以后增加“unstarted consumer 0/0”的狭窄退役，也不能替代已运行consumer的退役/resync：后者需target intent、水位、source sequence/CAS、撤销旧worker/lease和可恢复导入流程。

## 6. 实施与验收顺序

1. 先审定host owner/service lease/current-policy/capability接口及[host integration contract](HOST_V2_INTEGRATION_CONTRACT.md)；没有可信owner和具体平台adapter时，不创建孤立planner函数作为完成标记。
2. 接生产owned manifest/receipt/raw读路径与payload pin，再按macOS、Windows 10、Windows 11分别实现能力目录和版本化codec；每个codec都要有raw/derived provenance与target readback证据。
3. 实现host-only `PreparedPlanV2`、choice-required流程和真实普通/纯文本/队列共享publisher；按publisher intent、系统修订、部分写和崩溃恢复验证。
4. 独立完成portable projection、V2 crypto wire设计/review/known vectors；之后才做隔离staging、当前策略复核、target intent和CAS激活。
5. 按六个有向路径验收：Win10→Win11、Win11→Win10、Win10→macOS、macOS→Win10、Win11→macOS、macOS→Win11。每个方向都核对portable bytes、OS clipboard与实际目标app、重启恢复、policy变化和附件缺失；任一层失败都不能报该方向通过。

当前上述六方向均为 **NOT-RUN**；本任务没有Windows运行环境，且production host/目标adapter授权与集成仍待落实。Windows 12未来版本按原G4另立运行矩阵。原G0—G4所有门禁和G0/G1/G2/G3/G4完整成功标准保持不变。

## Review 结论

建议采用“host-owned prepared plan + 明确用户选择 + durable publish intent + 独立portable projection与接收激活”的边界作为后续评审候选。关键阻塞仍是生产host/current-policy/能力owner未接线、专用portable codecs缺失（颜色尤其明确）、V2 crypto wire未设计和Windows运行验收缺席。此结论是设计评审建议，不是G0—G4批准、实现完成或平台支持声明。

## 本轮独立设计复审

两项P2（planner预算遗漏rich-text/url与metadata IPC、renderer allowlist未细化）已关闭，结论为有限范围APPROVE design；reviewer未运行实现测试或平台验收。所有新增能力仍为NOT-IMPLEMENTED，设计复审不构成跨仓写入授权或任何G0—G4通过。

证据：[只读源核对与文档收据](EVIDENCE_INDEX.md#v031)、[独立设计复审](EVIDENCE_INDEX.md#v031)、[完整主路径差距](EVIDENCE_INDEX.md#v031)。
