# V1 数据库写入确认、历史图片入库与旧附件迁移
v0.30 历史图片重试轮转与清空串行化说明：[实现记录](HISTORY_IMAGE_RETRY_ROTATION.md)。 机器收据见[v0.30 根证据](EVIDENCE_INDEX.md#v030)。
v0.28根证据：[root evidence](EVIDENCE_INDEX.md#v028)；独立源码review：[review](EVIDENCE_INDEX.md#v028)，结论为有限范围APPROVE；完整G0—G4仍未通过。
v0.26根证据与文档审计字段：[v0.26 root evidence](EVIDENCE_INDEX.md#v026)。

日期：2026-10-27。本文记录 v0.25 对 Pasteboard Pro 现有 V1 宿主数据库调用的修正，以及 v0.26 历史图片入库失败闭环、可验证边界和未关闭风险。它不代表 V2 durable store 已接入，也不改变完整 G0—G4 验收目标。

## 故障与影响

ZTools db.promises 的某些写入失败会以已完成 Promise 返回 { id, error: true, name, message }。此前插件只捕获 Promise rejection；把 resolved 错误对象当成成功后，记录镜像可能写入本地索引并推进剪贴板历史 cursor。这样后续运行无法从 cursor 判断这一段记录未落库，存在数据遗漏风险；旧行为由源码确认，v0.25的数据库回归没有在该修复前执行，因此不声称该项有修复前红测证据；v0.26图片链路的原包红测证据另见下文。

宿主接口的 allDocs 使用 prefix 或 ID 数组；旧适配层却把 Pouch 风格 options 对象原样传入。宿主会把对象当作没有有效过滤条件，不能依赖它执行预期的记录范围查询。v0.25 统一在 checked adapter 中转换和校验参数。宿主还会把 allDocs 异常折叠成空数组，并可能把 get 异常折叠成 null。插件无法从这些返回值区分真实空库与宿主内部读取失败，故本次修复没有建立可靠枚举或“空结果即删除”的保证。

## 当前 adapter 行为

apps/ztools/preload/clipboard-document-database.ts 将宿主原生接口适配成插件现有数据库端口，并缓存同一 raw DB 对应的 adapter：

- put 仅在结果为 ok: true、ID 与请求一致且 revision 非空时确认成功。resolved 错误和 rejection 映射成固定、不带宿主原始消息的错误；最多尝试三次，每次重读 revision；仍失败则返回错误。
- remove 仅在 ok: true 和 ID 一致时确认；宿主允许成功结果省略 revision。对象形态必须含非空字符串 _rev；传给宿主的对象只含 _id 与 _rev，避免把剪贴板正文和其他字段传入会记录参数的宿主路径。传字符串 ID 的旧宿主语义保留；不允许无 _rev 对象退化成按 ID 强制删除。无效或缺失 revision 直接失败。
- allDocs 仅接受已知的 prefix 或 keys 查询形态，将它们转换为宿主支持的 string/string[] 参数，再核对每条文档 ID 是否属于所请求范围。
- get 接受 ID 相符且 revision 有效的文档；null 或显式 404 作为缺失值。因为宿主可能把内部错误也变成 null，这一层仍无法证明读取权威性。

adapter 的成功回执只证明宿主调用报告了成功。它不证明断电、操作系统崩溃或设备故障下的物理持久性；也不证明真实安装宿主中的实现与合成 SDK 测试完全一致。

## 调用链与索引顺序

v0.25 将旧 clipboard-store 与 preload index 拆成有明确职责的模块。preload supported-host 初始化仅创建一个 checked DB adapter，并将同一实例交给迁移、历史 store、分组、隐私配置、窗口偏好、同步 repository 及记录索引调用方。现有 45 个 bridge 方法、窗口角色分支、同步和监听器注册顺序保留。

历史镜像必须先确认每笔记录写入，全部成功后才推进 cursor。某笔写入失败会拒绝当前镜像操作并保留 cursor，让后续变化可以重试；索引只在数据库确认之后更新。V1 仍没有 V2 source sequence/CAS，因此这不构成并发旧写入 fencing 或目标意图协议。

## 旧附件迁移

迁移在写入 marker 前用 lstat 检查 source root/现有祖先、destination root/现有祖先，并拒绝源树和目标树中已有的 symlink/junction；普通目标目录缺失时仍允许创建。复制至 pluginData 后逐文件核对长度与 SHA-256。对宿主枚举实际返回的记录，迁移会把旧附件路径改写为已复制路径，并检查写入回执。Node 24 的迁移目标用例 8/8 通过，覆盖源 root/ancestor、目标 root/ancestor 与嵌套目标 symlink。

旧目录不会删除。marker 表示复制校验完成、已返回记录的路径改写状态，以及 hostEnumerationCompleteness: unverified；不会写全迁移完成时间。lstat 与复制/改写不是目录句柄上的单次事务；路径仍可能在校验后被替换，因此不宣称消除 TOCTOU 或提供全路径原子性。若宿主读取失败被折叠为空，旧记录路径不改，旧文件仍保留。因此当前做法优先保护可恢复副本，但不能保证所有记录均已迁移完成。保留文件也会继续占用磁盘，主窗口每次启动仍需检查旧树；其清理时机尚无安全判定。

## v0.26 历史图片入库与cursor提交

### 修复前的可复现缺陷

v0.25实际组装的preload CJS图在Node与Electron合成SDK/历史剪贴板各运行7项：缺失图片路径、图片源读取失败、blob写入失败、损坏的缓存文件4类场景复现问题；成功写入、隐私排除和暂停3类场景通过。旧preload SHA与归档的v0.25插件包一致。原始收据：[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)和[有界进程收据](EVIDENCE_INDEX.md#v026)。这是修复前已发布CJS图的基线，不是当前源码或新包的失败结论；用例仅使用owned PNG、合成SDK和文件系统故障注入，不访问general clipboard或已安装宿主。

### 允许保存的图片如何入库

历史镜像先按暂停状态与隐私规则决定是否保存。被排除或暂停的item允许跳过，即使缺少路径也不触发图片I/O。允许保存的image若规范化后没有有效绝对路径，则拒绝该轮镜像；读取错误、空或超限内容、元数据异常、存储失败以及落盘后长度/SHA-256不匹配，也会返回固定错误message/code，不携带原始cause、文件路径或宿主错误正文。历史路径只读取当前item所带的source path，不调用“读取当前剪贴板”的layered fallback helper。

镜像循环只在全部分页成功后提交cursor。图片缺路径或I/O/存储失败会中止当前循环，因此不能把cursor越过失败项；先前已写入的record保留，后续重试通过fingerprint避免重复。文件blob在record数据库写失败后也保留，供相同内容重试并避免误删共享hash；数据库与blob之间没有事务或自动回滚。

### 有界读取与缓存验证

`readBoundedImageBytes`只接受绝对常规文件路径。实现先以bigint `lstat`读路径元数据，再打开文件句柄并比较device/inode、size、mtime和ctime；通过同一handle以64 KiB chunks读取，最多100 MiB，结束时再核对handle和路径身份/状态。零字节图片拒绝。平台支持时打开请求`O_NOFOLLOW | O_NONBLOCK`；Node 24.15文档见[fs constants与文件系统API](https://nodejs.org/download/release/v24.15.0/docs/api/fs.html)。100 MiB是此JS读入路径的字节预算，不是native helper监督、硬RSS上限或wall-clock deadline。Windows没有经本轮验证的`O_NOFOLLOW`等价门禁，因此不宣称Windows原生抗symlink/TOCTOU能力。

blob以SHA-256和媒体类型构成内容地址。已有regular-file缓存需重新读取并核验真实长度和摘要，只有校验有效才复用并保持原mtime；损坏regular-file缓存用`wx`独占的随机临时文件写入，再rename并核验。初版writer只用`path.resolve`词法containment，预置root、祖先及digest-prefix directory symlink可导出写入；修复前日志见[blob root逃逸复现](EVIDENCE_INDEX.md#v026)。当前代码在创建目录前检查root所有现存祖先/root/prefix，创建后、写临时文件后、rename前及最终校验后复核目录identity；缓存读取前后检查目录链，并以`realpath`确认文件位于实际managed root。独立源码review确认此P1修复；sync repository与两个blob测试文件定向23/23见[日志](EVIDENCE_INDEX.md#v026)。这些检查不构成单一目录句柄事务，也不消除所有检查后路径替换/TOCTOU或提供断电持久性；DB失败后的已写blob可能成为待后续GC的孤儿。

### 当前未关闭的边界

当前history `sync-error`事件只传固定错误消息，没有面向用户的健康状态UI或durable pending-attachment queue。不可读的允许保存图片会阻止整批cursor前进，重复重试可能造成阻塞；失败前已写入的其他record不会回滚。已有路径fingerprint去重的旧record不会自动重新验证或修复；历史路径已失效时可能持续失败。宿主`allDocs`错误折叠为空数组、`get`错误折叠为null的v0.25枚举P2仍存在。blob writer root/ancestor/digest-prefix symlink escape的P1已由目录链、realpath与identity guard修复，并有3类旧writer越界复现和定向23/23支持。独立review发现的两个test-harness P2现已修复并分别获reviewer APPROVE：`preload-database-fixture.mjs`显式allowlist需要的`node:` builtin，未知项拒绝且不暴露`getBuiltinModule`；image package的`record-error`场景要求sync-error event detail为固定`Database conflict`并在所有events与console中检查sentinels。限定范围的独立源码review最终APPROVE且没有新增P1/P2；reviewer未运行测试，详见[v0.26 independent review](EVIDENCE_INDEX.md#v026)。Node与Electron全工作区均142 passed files/5 skipped files、1279 PASS/6 skips；两端scanner各17/17、base preload各6/6、image package各10/10，7项build/types/contracts均通过。6个bounded进程全部exit0、signal null、stdout/stderr为空且确认终止。根/独立review收据见本文开头与本节末尾；VM不代表真实宿主/general clipboard/Windows API验收。

v0.26不实现private host store、native DTO/host owner与policy、target intent/sourceSeq CAS、general clipboard listener、目标应用粘贴、完整sync/GC或完整G0—G4。Windows105项原生case仍NOT-RUN；不能用Node/Electron VM代替Windows系统验证。打包15个文件，相对v0.25有3条输出路径变化：preload.js、history-worker.cjs、history-search-index-CXhy0P51.cjs；snapshot-store runtime 2个文件未变且未重建，完整macOS/Windows原生矩阵未重跑。全工作区针对性private-board用例随最终suite执行。DB冲突时已经写入的blob保留，恢复后同一item只有一条record且copy SHA正确；这不提供DB/blob事务或断电持久性。

### v0.26 最终运行证据

全工作区Node/Electron分别142 passed files/5 skipped files、1279 PASS/6 skips，耗时24.16s/26.62s；完整日志：[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)。两端packaged scanner各17/17、base preload synthetic SDK各6/6、image package各10/10。7项build/types/contracts均通过；[6个bounded进程收据](EVIDENCE_INDEX.md#v026)均exit0、signal null、stdio为空并确认终止。限定范围独立source review APPROVE，reviewer未运行测试；完整G0—G4与Windows105项仍开放。

## v0.25 数据库与迁移证据（历史）

- database adapter 目标用例：apps/ztools/tests/clipboard-document-database.test.ts，22 个 case；remove envelope 限制和错误回执验证均在其中。
- 写确认、cursor/index 顺序与 LMDB close/reopen 合成契约：apps/ztools/tests/clipboard-write-confirmation.test.ts、apps/ztools/tests/clipboard-database-fixture.ts。
- 迁移保护用例：apps/ztools/tests/plugin-data-migration.test.ts。
- 两端 final package smoke：[Node scanner](EVIDENCE_INDEX.md#v025)、[Electron scanner](EVIDENCE_INDEX.md#v025)，各17/17；[Node](EVIDENCE_INDEX.md#v025) 与 [Electron](EVIDENCE_INDEX.md#v025) 对实际打包 preload 的合成SDK用例各6/6。primary/shelf/panel各保留45 bridge API，unsupported role只暴露2个兼容API；同时覆盖失败写入不推进cursor、重试与迁移保留原件/空枚举路径。VM允许对owned目录的祖先执行只读lstat元数据检查，其他文件读取/写入仍限制在owned目录，并阻止网络、子进程及剪贴板写。它不是安全沙箱、真实宿主数据库、系统剪贴板或Windows原生验收。
- 四个bounded smoke进程的退出收据：[process receipts](EVIDENCE_INDEX.md#v025)；exit 0、signal null、termination confirmed、stdout/stderr为空。scanner确认worker退出及两条stdio stream结束关闭，0 output/0 resource requests。
- 定向 database fixture 历史日志：[v0.25 adapter 与写入确认日志](EVIDENCE_INDEX.md#v025)，记录后续删除版本校验与迁移symlink case加入前的49/49基线；当前adapter22 case与migration8 case随最终Node/Electron全workspace 1246/6矩阵通过，未另存更晚的focused日志。
- 全工作区最终矩阵：Node [日志](EVIDENCE_INDEX.md#v025) 与 Electron [日志](EVIDENCE_INDEX.md#v025) 均为 138 passed files/5 skipped files、1246 PASS/6 skips。6 skips 是 5 个 child-fixture entry skip 与 1 个 opt-in macOS application-catalog smoke。两端通过 Node/Electron 完整工作区运行，但仍不代表真实宿主、Windows原生或生产验收。symlink修复前1242/6日志另存于[v025-pre-symlink-inputs](EVIDENCE_INDEX.md#v025)作诊断；最终打包preload smoke已通过；最终根收据与文档审计字段见本节末尾链接。
- v0.25 最初一次 Node 全工作区运行有 1239 PASS、1 FAIL、6 skips；[日志](EVIDENCE_INDEX.md#v025)。唯一失败来自 assembly 测试 fixture 未列入打包流程已有要求的 content-scan-worker.cjs 与 HTML_PARSER_NOTICES.txt。修正仅补齐测试 fixture 文件条目，验证器和超时未放宽。该轮结果仅作为 fixture 修复前诊断。


## v0.28 V1历史镜像图片失败隔离（2026-10-28；局部，非durable pending queue）

当前mirrorHostHistory先做既有隐私判断，再把允许保存但规范化缺少image path或图片preparation的固定MirroredImagePersistenceError作为可隔离失败。错误码限制为image-path-unavailable、image-read-failed、image-storage-failed、image-verification-failed、image-metadata-invalid；错误信息不透出host路径或cause。普通非图片错误、非图片上的typed image error、未识别prepare异常以及privacy/host/database异常仍快速中止。

单次mirror最多继续尝试16次失败图片；达到上限后跳过后续图片prepare与I/O，但继续保存健康非图片及处理后续分页。出现可隔离失败时，分页结束仍返回首个固定错误且不提交cursor。此前成功写入record不回滚，下轮按fingerprint去重并重试未存入的图片；路径缺失仍受原privacy决策约束。

Coordinator捕获mirror失败后构造已确认record变化并尝试dispatch history changed；刷新异常被吞掉以保留原镜像错误。通知best-effort，测试不证明renderer subscriber实际收到；takeRecordChanges清空ID后没有可靠重发。失败不发history-mirrored成功事件、不执行retention、不调用vault sync。

这只是§6.2.5的局部failure isolation：没有durable pending/failed row、持久retry state、公平图片轮转或host路径恢复。16次失败后本轮余下图片不再处理但仍可阻塞cursor。它不等同完整§6.2.5、G1或G0—G4。

## v0.28 验证收据边界

Node/Electron全工作区均144 passed files/5 skipped files、1298 PASS/6 skips（20.28s/20.91s）。两端scanner/preload/image/isolation各17/6/10/7项，6项build/types/contracts和最终root types通过；8个bounded children均exit0、signal null、stdio为空且确认终止。15个package outputs仅dist/ztools/preload.js变化；renderer未重建，2个snapshot runtime未变且未重建。source review有限范围APPROVE，reviewer未运行测试；具体root与independent-review链接见本文开头。

初次Node full 1287/6/1是journal negative-observation helper deadline race；它不是mirror assertion失败。初始polling 5-case red为2 FAIL/3 PASS，marker 10-case red为4 FAIL/6 PASS；最终journal+polling target 25/25。观察窗250ms及20s/27s deadline未改，完整Node/Electron结果已独立记录在v0.28全量logs中。

同时，初次full/target run复用了v0.26固定Node JSON输出路径。v026-node-journal-process-timing.json原文不可恢复，SHA 3cced35a394c4467505d2cae66c29e14c904cb2740d1d11a8a1bcfa1a1d6218e保留并以HISTORICAL_EVIDENCE_UNAVAILABLE占位；v026-node-inbox-drain-benchmark.json恢复exact SHA 2e3fb05a8beb9f69eaa372a22c4a9946c49397c6133440c2979afccdee1ab790。v0.28新输出不得替代缺失的v0.26历史证明；v0.26其他source、package和workspace logs未因此全部失效，但不能声称每条历史JSON仍可复核。事故收据：[incident report](EVIDENCE_INDEX.md#v028)。

## 未关闭事项

v0.25的history prepareRecord曾在localizeMirroredImage失败时回退原record/原imagePath；v0.26仅在历史镜像路径修复该回退，使允许保存的图片I/O失败阻断当前cursor提交。既有路径fingerprint重复项仍不会自动核验或修复。宿主读取错误被折叠为空结果的API语义需要宿主层支持才能区分；deleteRecords及sync tombstone枚举受此边界影响，不能宣称空枚举证明记录已删除。V2 target intent、sourceSeq/CAS、隔离私有存储、native DTO接线、general listener、目标应用回贴、完整同步与回收仍未由本次V1修正实现。完整状态见[G0未完成清单](G0_REMAINING.md)与[实施状态](IMPLEMENTATION_STATUS.md)。
