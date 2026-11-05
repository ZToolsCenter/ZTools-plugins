# 格式保真验收与发布门禁

v0.32 当前增量：[精确清理身份与回灌抑制](HISTORY_CLEAR_BOUNDARY.md)。按用户限制，本轮源码、测试、构建、文档及验证输出均限定在 Paste 插件目录；宿主接线仅保留设计参考。最终收据见[v0.32 根证据](validation/v032/v032-root-evidence.json)。

v0.31 历史设计阶段仅补充[宿主接线](HOST_V2_INTEGRATION_CONTRACT.md)与[V2 计划/portable 契约](V2_PLANNER_PORTABLE_CONTRACT.md)设计候选，均 NOT-IMPLEMENTED。v0.30 实现和执行证据保持原样，完整 G0—G4 未通过。


v0.30 历史实现增量：[图片重试轮转与清空串行化](HISTORY_IMAGE_RETRY_ROTATION.md)；[根证据](EVIDENCE_INDEX.md#v030)；[独立审查](EVIDENCE_INDEX.md#v030)。Node/Electron Node 模式各 91/91 相关回归通过；实际 CJS 合成 SDK 两端红绿证明缺陷修复。完整 G0—G4 未通过。


v0.29 历史增量：[Windows 存储基础层](WINDOWS_STORAGE_FOUNDATION.md)；[根证据](EVIDENCE_INDEX.md#v029)；[独立复审](EVIDENCE_INDEX.md#v029)。Node/Electron Node 模式各 20/20 契约通过；Windows SDK 编译、15 项新基础探针和既有 105 项 G0 原生用例均 NOT-RUN，完整 G0—G4 仍未通过。

v0.28历史根证据：[root evidence](EVIDENCE_INDEX.md#v028)；独立源码review：[review](EVIDENCE_INDEX.md#v028)，结论为有限范围APPROVE；完整G0—G4仍未通过。
Windows 10/11 的105项原生cases仍NOT-RUN；v0.27 Windows source kit本轮未改动。Windows 12及后续版本需另行建立G0—G3门禁。
v0.27根证据与文档审计字段：[root evidence](EVIDENCE_INDEX.md#v027)。根收据记录`gateComplete=false`。

v0.24根证据：[root capsule](EVIDENCE_INDEX.md#v024)。
v0.26根证据与文档审计字段：[v0.26 root evidence](EVIDENCE_INDEX.md#v026)。最终字段见根收据。


版本：v0.32 V1 精确清理身份与回灌抑制；日期：2026-10-28。仅插件目录内实现与验证，完整 G0—G4 仍未完成。
v0.24历史矩阵：Node单独最终重跑706 PASS/5 fixture-entry skip；Electron同计数证据为已通过initial run的逐字副本，不是本轮执行。两端各57 pass files/5 skip，共62；不覆盖全仓UI/业务/sync。Windows105项NOT-RUN，production host/preload/目标应用与完整阶段验收仍开放。


v0.21历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v022)

v0.22历史根证据：[archived root capsule](EVIDENCE_INDEX.md#v023)。

## 三层判定

1. 字节层：枚举类型、item顺序、byteLength与SHA256一致；派生数据不计为原始字节通过。
2. 系统写回层：一次发布后全部承诺格式仍存在且按平台codec校验；无部分写回后误触发粘贴。
3. 目标应用层：在指定OS、源/目标应用版本中实际回贴；截图和应用数据检查支持范围。预览相似不能替代这一层。

## v0.14 V2 capture-policy core cases

以下自动化用例只验证core内存gate边界，不代表native、生产scanner、落盘或用户流程验收。

| ID | 反例 | 通过标准 |
| --- | --- | --- |
| CPV2-01 | preflight与capture/policy revision绑定 | 错误绑定时scanner不运行；扫描或hash期间policy revision变化时撤销admission，不返回receipt或admitted bytes。 |
| CPV2-02 | 任一表示出现敏感命中 | 任一requested scope命中即拒绝整次copy；返回不泄露命中表示、payload、摘要或receipt。 |
| CPV2-03 | 各格式required scopes完整 | text、HTML/RTF、URL、image、file-reference分别要求对应text/links/OCR/metadata scopes；缺少scope不得标passed。 |
| CPV2-04 | scanner响应缺scope、异常、无效或部分not-scanned | 当前表示不留存；其他安全表示可partial。scanner依赖本身不可用时请求失败关闭。规则关闭时准许的标准表示仍标not-scanned。 |
| CPV2-05 | scanner返回超过12行 | 整次拒绝并返回scanner-response-over-limit；超限自身不等于内容命中，也不保留部分receipt；已检查到的真实blocked scope仍按content-match拒绝。 |
| CPV2-06 | 文件正文扫描要求 | file-body始终not-scanned；要求正文检查时file-reference不得留存。 |
| CPV2-07 | owned-byte与typed-array边界 | SharedArrayBuffer、detached或非法view拒绝；异步前copy输入，scanner使用隔离副本，Buffer只对可见span计数/hash。 |
| CPV2-08 | 格式和snapshot预算 | text/rich-text/url 10 MiB、其他格式100 MiB、snapshot 200 MiB；超限在scan/hash前拒绝。 |
| CPV2-09 | preflight denial及native unavailable | preflight denial优先；允许时保留原native unavailable状态；source allow不等于内容检查通过。 |
| CPV2-10 | cloud eligibility和权限 | receipt记录native cloudUploadEligible不授予sync；preview、paste、sync必须false。 |

51项focused core tests覆盖以上范围。当前缺native DTO adapter、trusted host source/classification/current-policy映射、真实内容scanner及有界worker/helper；gate没有scan timeout/cancel。参见[实施状态](IMPLEMENTATION_STATUS.md)、[运行指南](G0_RUNBOOK.md)和[G0剩余清单](G0_REMAINING.md)。

## 可复现环境与证据模板

以下是必须填写的矩阵，不是通过结果。G0 冻结实际版本后才可开始 G2；缺失版本/证据的组合保持待验证。

| 环境 | 当前事实 / 执行时必填项 |
| --- | --- |
| macOS | OS版本及build、CPU架构、NSPasteboard adapter构建哈希：待冻结。 |
| 宿主 | 本机macOS安装ZTools 3.2.0 / Electron 41.4.0；Windows实际包和运行时须单独核实；POC时重新记录实际包版本、签名与构建哈希。 |
| 插件 | 工作区plugin/pasteboard-pro；运行包版本/哈希、schema/codec版本、三个feature flags：待冻结，不能仅以package.json代替运行实例。 |
| macOS源与目标 | Safari/Chrome→Notes、TextEdit/Word→Word、Excel→Excel/Numbers、飞书→飞书：分别记录每对版本；未安装应用不能记通过。 |
| Windows源与目标 | Edge/Chrome→Word/飞书，Word→Word，Excel→Excel/富文本编辑器，文本→Notepad/VS Code，图片→Paint/Word，文件→Explorer；WPS等另列实际应用版本，不由Office结果推断。 |
| 策略与资源 | 规则版本及范围、是否扫描图片/文件正文、每格式deadline、item/格式/内存/解码上限：待冻结。 |
| Windows 10 | 首期必选：22H2 x64，具体edition/build/KB与宿主/native版本待冻结；LTSC等单列。 |
| Windows 11 | 首期x64矩阵24H2/25H2/26H2各有结果；ARM64/26H1等需独立原生构建后单列条件验收。每项edition/build/KB及生命周期状态待冻结，24H2 Home/Pro与Enterprise/Education不能合并支持结论。 |
| Windows 12及后续 | 未来正式版本目标：正式OS/SDK/宿主可得后冻结版本并执行相同矩阵；当前NOT-RUN，不虚构通过记录。 |
| Linux | 独立X11/Wayland及版本矩阵；不由其他平台通过推断。 |

每条执行记录必须包含：case ID、测试数据fixture摘要、OS/build、源/目标应用与版本、宿主/插件/native构建哈希、helper与来源/目标应用代码页(涉及ANSI时)、策略/codec版本、原始item/type/摘要清单、写回清单及PublishResult、实际结果/截图、执行人和日期。状态只能是PASS/FAIL/BLOCKED/NOT-RUN，不把兼容转换标为原始字节通过。

## 首期平台执行规则

macOS、Windows 10、Windows 11均为P1必选。除F06-mac/win为平台专用外，下列F/R/P/S/C通用用例要在每个首期必选OS/build与声明的应用组合分别执行，Windows结果不能用macOS截图或platform mock代替。基础case是模板，不是一条PASS适用于全部系统。

M类用例明确按六条方向分别执行：Win10→Win11、Win11→Win10、Win10→macOS、macOS→Win10、Win11→macOS、macOS→Win11；含Unicode、HTML/RTF、表格、PNG、local-only引用及不可映射多item。跨平台转换单列compatible，原始表示不改；不能表示的关联明确拒绝或让用户显式选择兼容计划。首期交付必须分别列三平台结论；单端通过仅算该平台验证，不能宣布跨平台完成。

## P1 最小矩阵

| ID | 场景与操作 | 通过标准 |
| --- | --- | --- |
| F01 | Unicode/Emoji/组合字符/CRLF/超长文本，源→Paste→文本编辑器 | 原表示摘要不变，纯文本投影无乱码或截断。 |
| F02 | 浏览器粗体/链接/列表复制到Notes、Word、飞书编辑器 | 同项保plain+HTML，目标的已声明结构保持；记录版本和截图。 |
| F03 | Word/TextEdit RTF字体/颜色/段落 | RTF bytes可重启恢复；支持RTF的目标中声明属性保持。 |
| F04 | Excel/表格应用复制2×3和合并单元格，分别贴表格与富文本目标 | HTML与TSV均留存，数值/空单元格/行列无串位；公式和复杂样式仅在独立privatecodec通过后标支持。 |
| F05 | PNG alpha、JPEG、TIFF色彩与方向 | 原编码存在时字节一致；仅位图的情形标compatible；预览PNG不覆盖原件。Windows TIFF本轮验证范围限Classic TIFF 6结构与WIC可解码性，不等于BigTIFF/私有IFD图或色彩渲染验收。 |
| F06-mac | 同次多个NSPasteboardItem，各含不同plain/HTML/image | item次序、数量、对应关系不变，不能把A文本与B图片混合。 |
| F06-win | 同一逻辑item包含多格式，CF_HDROP含多文件；接收mac多item投影 | Windows格式集合正确关联；无法表示mac多item时明确unsupported-item-model，不静默合并。 |
| F07 | 多文件+目录引用，原件保留/移动/删除/权限变化后分别回贴 | 历史引用bytes与顺序不变；发布前只读检查本机元数据/权限，失效时不清空当前剪贴板、不读文件正文；其他设备路径显示不可用，不标本地文件已备份。已知filesystem symlink/junction经有界SYMLINK/MOUNT_POINT解析；33项portable wire/边界用例直接覆盖格式、损坏长度/offset/tag/flags、UTF-16、16KiB与63/64 hop guard，另有3项owned-junction原生case（63允许、64拒绝、cycle拒绝）源码已接入。Windows执行仍NOT-RUN。路径检查不构成跨全路径事务，组件/目标可被替换，不能保证目标应用之后仍可访问/复制；OPEN_NO_RECALL不是保证。未知/cloud/virtual reparse、真实ACL/driver与应用权限必须单列。 |
| F08 | HTML外链图、data图、cid/临时文件附件 | 无自动外网请求；附件未归档明确partial，不能凭预览宣称离线完整。 |
| F09 | URI/IRI边界：http、ftp、file、自定义scheme、data、javascript、userinfo、mailto headers、空path、Unicode NFC/NFD、percent与控制字符 | 语法检查依[RFC 3986](https://www.rfc-editor.org/rfc/rfc3986)/[RFC 3987](https://www.rfc-editor.org/rfc/rfc3987)识别合法绝对URI/IRI；合法表示保留原bytes，不按scheme白名单过滤，不自动打开/执行/网络访问/归一化；非法percent、控制字符与相对引用拒绝。scheme特有语义、打开权限和安全预览另行验收。 |
| R01 | 读取格式A期间源剪贴板被换为B | 版本不匹配结果拒绝或partial；绝不将B表示附加到A。 |
| R02 | 1000次合成变化，慢/快/突发三档，对照源事件ledger | 已durable-ready记录无缺失/重复；未观察或superseded数量明确，不用getHistory总数冒充源事件总数。 |
| R03 | 延迟渲染、源应用退出、权限拒绝、clipboard lock占用 | 主UI不被长期阻塞；超时/拒绝有具体状态，无无限重试和跨版本补内容。 |
| R04 | blob写、rename、manifest提交、通知、插件inbox/checkpoint各处崩溃；A慢于B就绪 | 重启可恢复已提交bytes；日志绑定manifestRevision，A后续事件可重放；不存在游标跳过后永久不可达。 |
| R05 | 磁盘满、单格式限额/快照限额、原生解码大图 | 分别检查上限与上限+1；结果可见且不误标ready，内存/CPU/磁盘有上限。 |
| P01 | 普通粘贴/纯文本/混合队列，发布中被外部复制打断 | 复用同planner，纯文本不改原件；失败/superseded不注入键、不重复消费队列。 |
| P02 | 清空后第N个格式写入失败；恢复前发生外部复制；目标不支持富格式 | 返回partial-write及已写/缺失格式、版本和clipboardMayHaveChanged；界面提示影响，队列停住且不注入键；不得覆盖外部复制。兼容模式显式选择，不能无声降为文本。 |
| P03 | partial原快照→用户明确选择兼容/部分计划→发布成功并重启查看记录 | PublishResult绑定planId/manifestRevision与planned/written/omitted清单；只把冻结计划标committed，源快照仍partial，重放/同步不改写源完整性。 |
| S01 | text干净而HTML/RTF含敏感字；confidential/未知来源；mac bundle ID与Windows AUMID/可执行文件身份隔离、同名应用；图片可见文本及EXIF、文件路径元数据 | 命中则整次拒绝。按规则范围区分passed/blocked/not-scanned；启用所需内容检查时未扫描表示默认不落盘/同步；关闭内容规则留存图片仍标not-scanned。文件正文未读取不得标已审查。 |
| S02 | HTML含脚本、事件、CSS资源、远程图、file URL | 主UI和预览无执行/外部网络；原件只在经验证发布路径读取。 |
| S03 | macOS读取前preflight：pause/history、strict unknown source、前台hint与排除规则、跨item marker、source/remote marker、revision race | 在任何普通payload读取前先枚举全部item types并执行策略；strict默认阻止unknown producer。hint匹配排除项拒绝，producer未知时任何非空排除表都fail closed。仅显式允许unknown且无排除规则可进行内存探针捕获，receipt仍标unknown及`not-scanned`。7种deny marker在整份snapshot上按type presence拒绝且不读取marker bytes；`org.nspasteboard.source`与remote marker只报告presence，不授予producer trust或cloud permission。固定reason codes/booleans不含ID或正文。此receipt不授权存储、预览、同步、回贴或V2 readiness。私有G0 probe的capture status `ready`仅表示已在内存取得请求codec bytes；receipt仍为`contentScanStatus=not-scanned`，这不是V2 manifest `ready`/`durable-ready`，也不表示敏感内容已扫描。|
| M01 | V1导入及旧客户端读/写/删除/清理/同步；V2→V2 | V2独立库、前缀、type、ID、墓碑和vault对账；旧record查询不命中V2；V2不能被旧schema剥字段或旧tombstone删除；旧库不受切换破坏。 |
| M02 | 同条含portable HTML+image与local-only私有格式/文件路径，跨设备同步 | 远端只有批准投影和blob引用，不含本机路径/私有载荷；接收方不覆盖源完整manifest；投影完整和源捕获完整分开显示。 |
| M03 | 多附件一项失败；下载清单已写但未activation时崩溃/重启 | pending区与检查点持久；未就绪记录不能回贴，重启续传并校验全部附件后才激活；GC不回收有效引用。 |
| M05 | 发送设备允许而接收设备秘密/应用/来源规则更严格；portable来源身份缺失/脱敏；下载中策略变严 | activation前重读策略版本，下载/扫描期间版本变化须重检或中止；接收端以当前规则重检，命中/来源不满足时无明文落盘、activation、搜索、预览、回贴或再同步；只记录不含内容的任务outcome，不反向删除发送端记录；超过内存预算明确拒绝。 |
| M04 | 索引可读、单条manifest版本较新；另测vault/index/envelope协议较新 | 单条opaque原件保留并quarantine，其他兼容条目继续；外层协议未知时停止整轮同步、无索引重写或远端删除。 |
| C01 | schema构造ready缺blobRef/摘要/长度、空文件引用、失败分支伪造fidelity | 全部被schema拒绝；合法引用可表达来源设备和原始观察可用性，当前设备可用性独立。 |

### macOS读取前策略新增24项固定case

本节记录v0.10进入Darwin registry的24项新增case（52→76）及preflight覆盖；AppKit marker no-read问题已修复。v0.10 source inventory为35项。v0.11最终冻结源码/二进制下，Node24与Electron41.4/Node24.15原生probe各76/76 PASS、AppKit延迟读取watchdog 2/2 PASS；source inventory36，binary SHA-256 `f43139fe5855837ad1178df4b6d3e1ce4f9e0b9bc6d60405a6c0c31969ad17e0`。一次较早的monitor unavailable运行被guard拒绝并确认退出（不是case FAIL），记录见[运行收据](EVIDENCE_INDEX.md#v010)；后续隔离重跑已通过。以下表格列出源码覆盖范围。

| 覆盖组 | 固定case ID |
| --- | --- |
| pause、默认strict unknown、前台hint不等于producer、匹配/不匹配排除规则、用户关闭history（6） | `mac-policy-paused-no-read`; `mac-policy-strict-unknown-no-read`; `mac-policy-frontmost-is-not-owner`; `mac-policy-excluded-hint-no-read`; `mac-policy-exclusions-fail-closed`; `mac-policy-history-disabled-no-read` |
| 三种通用deny marker与四种legacy deny marker（7） | `mac-policy-marker-concealed-no-read`; `mac-policy-marker-transient-no-read`; `mac-policy-marker-autogenerated-no-read`; `mac-policy-legacy-textpander-no-read`; `mac-policy-legacy-typeit4me-no-read`; `mac-policy-legacy-typinator-no-read`; `mac-policy-legacy-onepassword-no-read` |
| 后续item marker必须早于所有payload读取；真实首项`NSPasteboardItemDataProvider`与第二项concealed marker，普通reader路径`provider.callbackCount=0`（1） | `mac-policy-later-item-marker-no-read` |
| 显式unknown保留未知归属（2） | `mac-policy-explicit-unknown-preserved`; `mac-policy-real-reader-explicit-unknown` |
| source marker为metadata，不建立producer信任（2） | `mac-policy-source-marker-untrusted`; `mac-policy-source-marker-metadata-only` |
| 配置、revision race和异常隔离（5） | `mac-policy-invalid-config-no-read`; `mac-policy-revision-after-source-query-no-read`; `mac-policy-reader-exception-contained`; `mac-policy-revision-during-read-superseded`; `mac-policy-source-query-exception-contained` |
| remote clipboard marker不授予cloud权限（1） | `mac-policy-remote-marker-no-cloud-grant` |

以上7种拒绝marker是生态约定，系统不强制执行；frontmost应用只能提供启发式hint。

### macOS owned snapshot 与离线校验新增7项固定case

v0.13将Mac capture拆成锁敏感的native materialization阶段与只处理owned bytes的离线validation/summary阶段。只有全部允许的支持表示复制完毕并通过最终changeCount barrier后才开始codec验证和摘要；barrier前发现revision变化必须返回superseded且无items。barrier后的board变化不能改写captured revision或替换已拥有的旧bytes，返回值另记observedRevision。raw staged bytes按总量计入maxSnapshotBytes，即使后续验证无效也不回收预算；byteLength只计有效输出bytes。

| 固定case ID | 验收断言 |
| --- | --- |
| mac-capture-offline-validation-preserves-revision | validator期间替换pasteboard后仍返回原item bytes和captured revision，observedRevision反映新board；不补读新bytes。 |
| mac-capture-materialization-before-validation | 所有候选原生读取都完成之后才调用首个validator。 |
| mac-capture-read-race-discards-owned-bytes | 普通读取期间board变化时，返回superseded、不返回items/summary/byteLength且不启动validator。 |
| mac-capture-invalid-owned-bytes-budgeted | 两份各自无效的PNG bytes累计超出snapshot上限时，仍在validator之前返回over-limit，不输出阶段payload。 |
| mac-capture-owned-validation-partial | 保留通过的文本表示；拒绝的PNG记录format_validation_failed，capture为partial且byteLength仅计有效文本。 |
| mac-capture-validator-exception-contained | validator异常成为无payload的failed结果，不暴露异常reason或内容。 |
| mac-publish-offline-readback-race-unconfirmed | readback validation期间发生外部写入时返回partial-write/clipboard_superseded_during_readback，保留外部board且不报committed。 |

新增用例固定的是私有命名board探针边界，不表示general pasteboard monitoring、生产捕获或目标应用验收。Node24/Electron41.4均83/83 PASS，AppKit watchdog2/2 PASS，独立review APPROVE；证据边界见实施状态与根证据。


## Windows首期专用矩阵

| ID | 场景与操作 | 通过标准 |
| --- | --- | --- |
| W01 | Win10/11分别启动/重启helper，注册/注销listener；1000次连续变化、读取期间被替换 | 监听返回值检查，有效HWND、sequence校验与持久feed分离，覆盖DWORD回绕/0值访问失败；无混合快照，锁内复制后关闭，再对owned bytes深度验证；离线验证期间的新复制不能改写旧snapshot或被误记已捕获。未观察/已覆盖事件明示，不声称通知可追溯历史。 |
| W02 | 剪贴板被其他进程持锁；延迟HTML/RTF/image，源退出；Open/Close/第N次Set失败 | 有界退避/超时且UI不阻塞；真实WM_RENDERFORMAT阻塞由helper看护终止；不读取未来值补历史。所有Set成功后需逐项计划读回；读失败/抛错/Close失败及关闭后的外部覆盖不能committed，write/observed版本分开；资源正确释放，部分覆盖停止队列。 |
| W03 | UTF-16中文/Emoji/CRLF；CF_HTML 0.9/1.0字节偏移；RTF；HTML+TSV表格 | 原生有效载荷摘要可对账，注册格式按名称还原；Word/Excel正确选择富格式，TSV不虚构成CF_TSV。 |
| W04 | 注册PNG、CF_DIB、CF_DIBV5、仅CF_BITMAP；透明度、方向、畸形头/stride、超大像素 | 静态PNG须真实解码/尺寸/展开预算，正确CRC坏IDAT也拒绝；深解码不持clipboard锁；标准图片codec可用，未支持动画/变体明确报告；原件与转换分开；CF_BITMAP物化标compatible，不序列化句柄；分配冗余/越界/膨胀不落盘。 |
| W05 | CF_HDROP多文件/目录、中文路径、删除/移动/权限变化，含cut标记源；原12项file-reference边界用例及3项owned-junction测试 | 发布前在全部Prepare之后、Open/Empty之前只读检查元数据与权限；失败不清空剪贴板、不调用ReadFile、不改历史payload；检查期间新revision优先并保留新clipboard。默认复制、不重放cut/move、不备份正文或上传本机路径。known filesystem symlink/junction只解析受限SYMLINK/MOUNT_POINT；common parser的33项portable wire tests涵盖错误tag/长度/offset/flags、UTF-16、16KiB与63/64 hop guard。另有实际owned-junction的63-hop允许、64-hop拒绝、cycle拒绝3项原生case，源码已接入但Windows仍NOT-RUN。OPEN_REPARSE_POINT只约束被打开检查项，OPEN_NO_RECALL是向filter发出的请求；不提供跨路径事务或不发生recall的保证。组件/目标可在检查中或之后替换，目标应用也可能无法访问；cloud/remote driver、TOCTOU、系统返回畸形reparse数据与完整故障注入必须在Windows实测。未知/cloud/virtual reparse拒绝或unsupported。 |
| W09 | CF_TIFF Classic TIFF 6：LE/BE、多页、16-bit alpha、异常压缩/IFD与预算边界 | 8项固定Windows TIFF case验证原bytes回贴、main IFD全部页面、WIC像素可读性、坏LZW/结构拒绝、像素预算、clipboard Close后Capture验证、格式ID错误与validator异常partial保留其他格式。仅Classic TIFF 6支持；BigTIFF、未知field type、自定义私有pointer graph unsupported。所有WinSDK/WIC case当前NOT-RUN。 |
| W10 | owned junction reparse traversal：63/64 hop及cycle | 3项固定原生case在私有测试volume上创建owned junction链；验证63跳可达、64跳被拒、cycle被拒，并保持历史引用bytes。Windows未运行；portable hop guard不能替代实际文件系统 traversal。 |
| W11 | Windows逐格式Capture→Publish→Capture receipt：7个强制格式组，覆盖rich formats、TIFF、native images、wide/ANSI HDROP、ANSI/OEM/LOCALE、URL A/W | 绑定source/expected/write/readback/observed的非零DWORD revision；每个planned/readback格式摘要包含byteLength/SHA-256及固定codec/fidelity/materialization/context。只允许16个格式key、每组最多32行，planned/readback总字节分别≤20MiB；只有CF_BITMAP允许visible-RGB-compatible差异。JSON不得包含正文、路径、PID、source app、raw format ID或任意错误文本。成功Windows报告必须有7组；具体case ID见下方9项列表。ANSI HDROP需满足checkout绝对路径前缀可由GetACP无损表示，否则该用例NOT-RUN且G0不可PASS。全部Windows native cases仍NOT-RUN。 |
| W06 | 同等权限应用与提升权限目标，目标切换、输入受阻/失败 | 完整publish与输入submitted/失败分离；不伪报目标接受，不自动提权/重发；失败不消费当前队列，手动操作提示前重检当前revision仍属本次完整publish；被覆盖则superseded并撤销提示，不承诺随后目标读取无竞态。 |
| W07 | Win10/11 x64安装/升级、Electron41.4/native加载；ARM64另测原生产物 | 签名/模块架构/ABI/依赖及构建哈希对账；x64仿真不算ARM64原生；模块不可用则能力关闭，Windows Server构建CI不替代客户端交互验收。 |
| W08 | 本地锁屏/解锁、休眠/唤醒、会话切换；RDP/VM剪贴板重定向允许/禁止/限制格式 | 本地恢复监听与明确期间缺口；RDP/VM结果单列条件能力，策略禁用显示环境受限，不越权读其他会话，不承诺中间链路全格式无损。 |
| W12 | Windows adapter层Open/Empty/Set/Close API fault-plan与资源所有权路径（Publish 12项，Capture 3项） | 私有fault plan只在native API调用前注入失败；无注入时wrapper转发真实API。attempt与native-forward计数分开。验证适配器状态分支、partial/unconfirmed结果、HGLOBAL/GDI对象释放与capture output清理。该机制不制造内核级失败，不证明Windows在资源耗尽、权限或系统清理故障下的实际行为；105个case整体仍NOT-RUN。 |

### Windows逐格式receipt新增9项native case

`windowsFormatReceipts`是Windows报告独立的顶层字段，不是macOS `formatSummary`。7个成功required groups的case ID与`formats.key`覆盖如下；每个摘要只记录元数据、length与hash，不输出载荷：

| receipt case ID | `formats.key`要求 |
| --- | --- |
| `receipt-rich-formats` | `text`, `html`, `rtf`, `png`, `image-png` |
| `receipt-tiff` | `tiff` |
| `receipt-native-images` | `dib`, `dibv5`, `bitmap`, `palette` |
| `receipt-files-wide` | `file-list`，encoding=`utf16le-dropfiles` |
| `receipt-ansi-oem-locale` | `text-acp`, `text-oem`, `locale` |
| `receipt-url-wide-ansi` | `url-ansi`, `url-wide`；ANSI URL用`urlCodePage` |
| `receipt-files-ansi` | `file-list`，encoding=`ansi-dropfiles`且validationCodePage匹配helper ACP |
| `receipt-sha256-known-answers` | CNG SHA-256 known-answer验证 |
| `receipt-invalid-binding-rejected` | 错误case/source/revision/context或格式绑定必须拒绝 |

七组覆盖16个固定格式key。`sourceOrigin`固定为unknown；helper ACP/OEM code page只是执行环境，不证明producer编码。字段严格allowlist，inherited/prototype keys、额外字段、未知格式、错误digest/revision/context或超额预算均拒绝。receipt在Capture/Publish sessions关闭后基于owned logical bytes计算，不能由hash推断来源身份。Windows剪贴板receipt的真实Win10/11回合、WinSDK、BCrypt KAT、WinAPI和WIC目前均未运行。

### Windows API fault simulation新增15项adapter case

Windows private per-adapter `ClipboardApiFaultPlan`由`ClipboardNativeApi`包装OpenClipboard、EmptyClipboard、SetClipboardData和CloseClipboard。未注入时调用转发到系统API；故障注入在真实API调用之前结束。attempt计数与实际native-forward计数分别记录，不能把这些测试描述为内核返回了相同故障或证明OS资源清理成功。

| 范围 | 固定case ID | 覆盖点 |
| --- | --- | --- |
| Publish（12） | `api-open-exhaustion-preserves-clipboard`; `api-empty-failure-preserves-clipboard`; `api-set-first-failure-cleans-untransferred`; `api-set-middle-failure-keeps-partial-prefix`; `api-set-last-failure-reports-missing-tail`; `api-set-gdi-bitmap-failure-releases-object`; `api-set-palette-failure-keeps-bitmap-owner`; `api-close-failure-after-full-write-is-unconfirmed`; `api-close-failure-after-partial-write-cleans-rest`; `api-close-persistent-failure-never-commits`; `api-empty-and-close-failure-keeps-baseline`; `api-fault-hooks-reset-and-recover` | Open exhaustion、Empty/Set失败、首/中/尾项partial、GDI与palette ownership、单次及持续Close失败、Empty+Close组合和恢复。 |
| Capture（3） | `api-capture-open-exhaustion-resets-output`; `api-capture-close-failure-discards-output`; `api-capture-close-failure-after-policy-denial` | Open失败清空输出；Capture Close失败不返回结果；策略拒绝仍受Close失败结果约束且ordinary payload reader不执行。 |

Publish的三个prepared format RAII方法拆入`clipboard_prepared_format.cpp`，Publish主流程拆入`clipboard_publish.cpp`；Capture/Publish均在本地API/session生命周期内close。私有`noexcept` lifetime observer只用于断言真实`GlobalFree`/`DeleteObject`结果：系统接收所有权后本地不得再free，Set失败或未尝试转交的资源恰好释放一次。明确Close失败即保守失败，即便析构的第二次Close成功也不改结果；持续双Close失败用例仅由private station fixture直接调用原始CloseClipboard清场，不作为OS cleanup成功证据。既有第三参数pre-loop Set-index故障用例仍保留，但与上述15项wrapper case分开计数。Windows105项全部NOT-RUN。

v0.12报告case数量上限为128：128项接受、129项拒绝，以容纳当前105项Windows registry；此前100项上限不足。对应report suite为12项，v0.12 JS共44/44 PASS（report12、source5、Windows receipt16、bounded11）。

Windows12及后续正式系统沿用W01—W12和通用矩阵，新增系统API/格式只在codec/能力协商验证后开启。当前Windows SDK/MSVC/WinAPI/BCrypt KAT/WIC及所有Windows原生/应用测试均NOT-RUN；固定105个Windows原生case（旧90项+15项API fault case）不构成通过记录，portable测试、静态review和mock不改变这一状态。v0.12 Mac Node24/Electron各76/76、watchdog2/2与source36/binary SHA均为历史收据，已存入v013-inputs/。v0.13 Darwin registry为83项；Node24/Electron均83/83、watchdog2/2、JS44/44 PASS。独立review APPROVE、无P1/P2。Windows源码包33/33 fresh-extract结果只验证源码工具包脚本，不代表Mac native probe通过。这些结果不关闭内容隐私、一般监控或生产接线门禁。

## P2 独立门禁

PDF/SVG、HEIC/GIF动画、RTFD附件、Office公式/对象、Figma/Adobe私有表示、文件承诺、未纳入P1的Windows专用句柄/私有格式、Linux各显示协议都单独列case与结果。没有证据的项保持unsupported/待验证。

## 发布停止条件

- 无可审计native采集/整组发布，或只有当前值拼历史的实现。
- 一次writeBuffer循环等同整组原子写的假设未消除。
- 有机会把V2交给旧客户端读写后丢字段。
- pending附件、权限拒绝、资源超限或日志缺口被标为成功。
- 多格式隐私/安全预览未统一处理，或把not-scanned当作敏感内容检查通过。
- sync先激活item再校验附件/接收端当前策略，或把local-only引用放入远端必需清单。
- 版本矩阵、策略范围或原生资源预算尚未冻结。
- Windows10/11任一必选组合没有原生/真实目标应用证据，却以macOS或Windows构建CI通过代替。
- 用Windows版本名称、x64仿真或未来系统推断全部capability通过。

## 性能Gate（提案阈值，G0需冻结实测值）

- UI主线程不执行格式物化/压缩；普通已物化≤1MiB标准文本组合，capture-to-durable p95目标≤200ms，p99目标≤500ms。
- 不同大小图片/延迟源单独统计，不承诺同一延迟；每种格式给出read deadline及UI可见timeout。
- 256MiB队列阈值、200MiB快照阈值只是初始预算，不是未测过的性能保证。
- 记录源观察数、被策略拒绝数、partial数、ready数、write失败数及最大cursor lag，不记录正文。


## v0.15 有界内容扫描验收（历史）

| 验收项 | v0.15结果 | 证据与边界 |
| --- | --- | --- |
| Worker协议、输入复制、policy/codec/response绑定与严格编码 | Node测试覆盖并通过 | 本范围仅处理显式编码明文与URL；HTML/RTF、OCR、图片metadata与file-body仍not-scanned。 |
| V1 literal/wildcard与受限RE2JS规则 | Node测试覆盖并通过 | RE2JS 2.8.6；规则数≤32、单条≤256字符、flags为`imsu`子集；URL最多两层percent投影。 |
| Worker超时、busy不排队、输出计数、dispose与真实退出确认 | lifecycle测试覆盖并通过 | 终止未确认时scan/dispose保持pending且lease保留；注入terminate拒绝不等于OS/kernel失败证据。 |
| Node24.15.0回归 | **172/172 PASS** | 现有core 135项 + scanner/lifecycle 37项；见[v015-node-tests.txt](EVIDENCE_INDEX.md#v015)。 |
| Electron41.4.0 Node模式focused回归 | **37/37 PASS** | 仅测试suite在Electron Node模式运行；不等于已安装preload worker能力验收。见[v015-electron-tests.txt](EVIDENCE_INDEX.md#v015)。 |
| TypeScript、workspace contract、preload build、assembly及package contract | **全部PASS** | assembly验证15个文件；细项见[v015根证据](EVIDENCE_INDEX.md#v015)及同目录日志。 |
| 实际组装worker smoke（Node / Electron41.4 Node模式） | **PASS / PASS** | 仅synthetic-text-only；两者均确认线程退出、输出0字节，worker SHA-256相同：`e19ec0a632e1e880fbf747dd39bc2dc089dd0ca4a0e7b4eea031ecfbb58bc9ee`。不证明正式preload中可创建worker。 |
| 独立实现复核 | **APPROVE，无阻塞P1/P2** | 仅批准可信、已打包worker范围；不证明OS/RSS隔离、pre-clone分配保护、未支持格式或Windows。 |
| G0及后续阶段 | **未通过 / 未完成** | 有界RTF Worker projection与受监督native probes已验证，但无production capture/native DTO/host接线；未建模RTF及部分HTML/CSS仍not-scanned，Windows与真实应用矩阵NOT-RUN。trusted source/current-policy transport、storage/publish/sync未接入，gateComplete=false。 |



## v0.16 静态扫描与本机探针证据（历史）

| 范围 | 当前结果 | 验收边界 |
| --- | --- | --- |
| 共用RTF framing | 普通与ASan/UBSan CTest各1/1，256 named checks PASS；Windows复用结构validator并保留2 MiB cap；macOS cap10 MiB，新增4 native cases | 仅校验标准RTF1根、bin长度、括号、escape/参数和尾部padding；无RTF text/privacy scanner。Windows原生105项仍NOT-RUN。 |
| HTML/CSS静态投影 | 现有Node Worker使用锁定parse5 8.0.1/entities 8.1.0；Node HTML36项，budget3项，均在Node211/211与Electron focused76/76中通过 | 原HTML bytes不改；普通格式HTML可passed。外部CSS/import、图片背景、img/media、动态脚本SVG及不支持CSS为incomplete/not-scanned；命中仍拒绝整次copy。无执行、联网或OCR。 |
| 投影预算 | raw 10 MiB、累计10 Mi scalar、10000 AST nodes、depth128；有真实10 MiB/+1及3 MiB投影耗尽case | 超预算拒绝或not-scanned，不截断为passed。 |
| macOS隔离native probe | Node24.15.0与Electron41.4.0/Node24.15.0各87/87；source inventory46，binary SHA e9647de8813a211e649da461563a79be48a7fa9394db5628c8257f3aab501941；watchdog2/2 | 只代表命名board/native probe和watchdog，不是general listener、生产preload或应用回贴验收。 |
| Windows源码与环境门禁 | collectG0Sources inventory111；CMake58编译单元、portable exact-source closure39项（含CMake与headers，其中21项为编译单元）；整个native/clipboard-format跨平台、common与codec-tests合计154份源码/头文件最大499行；105项native case仍NOT-RUN | 用户已确认无Windows环境；不声明Windows10/11或未来Windows版本支持。 |
| 打包Worker smoke | Node24和Electron41.4 Node模式各5/5；线程与stdio退出已确认，output0，externalRequests0 | 合成case含plaintext-secret、HTML split token、普通HTML、外部img、CSS image；不代表production host或已安装preload验收。worker SHA 7ce9a649706eb18110de7542a5d30e4dad6a56cede0e7a7bd99c182b26895ad2。 |
| 构建与安装包 | assembly16 files、package contract、typecheck、workspace contract PASS；HTML_PARSER_NOTICES.txt入包 | 不等同正式Electron preload Worker可用性或最终应用矩阵。只验证Node24.15.0与Electron41.4 Node模式；不构成Node18支持证据。 |

v0.16历史portable为256 checks、Mac87-case probe/watchdog、Node211、Electron76、JS44与assembly16。该版Mac Node/Electron/watchdog receipts及dist现归档于[v017-inputs](EVIDENCE_INDEX.md#v017)；v0.16独立review的APPROVE仅限静态源码。生产listener/host/storage/sync和完整内容隐私门禁仍未通过；完整G0—G4矩阵与Windows105项、应用/格式验收要求保留。

## v0.17 supervised capture-wire fixture证据与门禁（历史）

native owned bytes经20-byte magic+length frame进入Node strict canonical-UTF-8 parser、known-format registry、bounded Worker与core gate。Parser拒绝duplicate keys；metadata/raw上限分别1 MiB/200 MiB，rows为1..1024，最多32个item（itemIndex 0..31），每item最多32个表示；名称非空且无C0/C1控制字符，名称与policy revision各限512 UTF-8 bytes，policy revision须trim后非空，request最多128 ASCII identifier。expected绑定captured revision，observed独立；保留raw SHA、owned copy及完整unavailable inventory，unknown source不升级为trusted。

macOS只在受监督固定public synthetic随机命名board fixture验证；Node24与Electron41.4 Node模式ingress各5/5，native probe仍各87/87。两份ingress receipt绑定source52与binary SHA-256 4680a3907ef65ecf74c57b8b5e601f6669465159507661bdb7aac06851722849。Mac UTF-16 framing不按尾部00 00猜NUL terminator；正文含NUL时not-scanned，真实Worker反例/回归2/2。Node275/275、Electron140/140、portable/ASan各307 checks、JS44、watchdog2、workspace/app typecheck与contract均通过。Windows source117/CMake61、portable closure45（24编译单元）、native164 max499为源码证据，Windows105项仍NOT-RUN。

Mac/Win native transport不是生产listener或IPC。没有general clipboard、trusted source/current-policy production transport、完整replay metadata、storage/publish/sync或manifest/blob接线；RTF仍not-scanned，unsupported decoder格式不伪装支持。因此v0.17只通过fixture集成范围，G0与G1—G4发布门禁仍未通过。

## v0.18 codec evidence与CF_HTML容器扫描验收（历史）

V2 wire新增8-byte magic和schemaVersion=2，每个captured native row保留nativeCodec encoding、materialization、可选validationCodePage及UTF-16 text证据。v1 strict writer/reader拒绝V2字段，不静默丢弃；neutral reader显式识别V1/V2。详细协议见[Native capture wire v2](NATIVE_CAPTURE_WIRE_V2.md)。

Mac UTF-16 analyzer字段必须绑定同item UTF-8原件，核验BOM、字节序、终止标志与解码相等/NFC等价。exact standalone且无derived可不带text证据；compatible或derived必须有text且fidelity=compatible。Windows validationCodePage只是helper上下文，不能说明producer编码。

native-known与scanner-supported分开判定。known格式若无scanner codec仍capture raw；策略开启时not-scanned且不准入，策略关闭时按既有策略保留raw并标not-scanned；unknown native保持unavailable。NUL alias与source-scan guard保留。

CF_HTML由共用bounded parser验证UTF-8 byte offsets，并供Node Worker显式htmlContainer扫描。扫描完整context，只有无context时扫fragment；另外投影扫描完整header和SourceURL，包含bounded percent/entity解码。Parser拒绝重复header、数字垃圾、UTF-8切分、marker/offset错误及无法解释的尾部；header最多4096 bytes/128 lines，raw最多8 MiB。HTML不执行、不fetch。

v0.18的Node/Electron suites、Mac probes与8/8 package smoke继续保留为历史结果；原文档、source和receipts归档于[v019-inputs](EVIDENCE_INDEX.md#v019)及[归档验收矩阵](EVIDENCE_INDEX.md#v019)。

v0.18证据只覆盖静态容器、命名board探针与受监督native/package fixture，不表示general clipboard、production host/IPC、trusted source/current-policy transport、storage、publish、sync或完整应用矩阵通过。G0整体与G1—G4发布门禁继续未通过，gateComplete=false。

## v0.19 RTF投影验收结果与边界（历史）

Node24 458/458（24 files）、Electron41.4 Node模式323/323（15 files），RTF增量Worker60/tokenizer8/charset43/projection-budget8。Node/Electron package smoke各11/11，线程退出与stdout/stderr end+close确认，0网络、0输出。

342-byte AppKit样本由root clang及worker Swift独立生成且逐字节一致，含unsigned u35797。Unicode与legacy fallback、hidden/visible、UPR两branch、font charset/cpg、HYPERLINK及文本metadata进入扫描；原RTF bytes不变，命中规则仍整次拒绝。

footnote/header/footer复位默认font；non-default inherited uc、annotation atnauthor/atnid/atndate、object/pict/bin/unknown/style/dynamic fields保持incomplete/not-scanned。UPR双分支及special destination/annotation红绿回归边界见[RTF projection说明](RTF_PRIVACY_PROJECTION.md)。v0.18 Mac/portable证据未重跑；Windows105项、production接线及应用矩阵仍未通过，完整G0—G4保持开放。


## v0.20 G1局部组件验收记录（完整门禁未关闭）

| 范围 | 阶段性证据 | 未关闭的验收边界 |
| --- | --- | --- |
| Node-only LMDB/blob组件 | LMDB 3.4.4；owned capture经policy/scan后提交manifest、receipt、blob references、change event/outbox与head；close/reopen读回原bytes；runtime package build/import与blob close/reopen在Node/Electron模式通过 | 尚非production host/preload或平台交付；完整G1未验收。 |
| native ingress与store fixture | v0.20 Node/Electron default ingress各5/5、codec ingress各6/6、native-to-store close/reopen各3/3通过 | 仅Mac synthetic/受监督fixture；不证明general clipboard、production listener或真实应用。Mac完整G0 87-case未重跑。 |
| Recovery与journal | bootstrap8、all-record-family验证/root-GC6、outcome integrity3通过；prune后duplicate保持有效；future event由writer显式拒绝且不写tombstone；reservation cleanup finally | full retention/GC leases、durable consumer inbox/cursor和跨平台故障矩阵仍开放。 |
| Owner与平台边界 | 同进程单一trusted owner内policy revision串行；Node-only injection；renderer无入口、permissions false | LMDB进程锁不提供跨进程policy一致性；无owner lease/current-policy transport。Windows创建目录前以private-directory-unavailable拒绝，105项Windows G0仍NOT-RUN。 |

历史v0.20 Node/Electron格式与存储定向回归各557 PASS、2项有意skip（39个文件通过、2个fixture文件跳过）；不是当前v0.21计数。两个fixture-entry skip由真实child/parent测试覆盖，不是Windows覆盖。v0.20最终日志：[Node](EVIDENCE_INDEX.md#v020)、[Electron](EVIDENCE_INDEX.md#v020)；旧Electron红日志保留为中间过程记录。

root/app typecheck、workspace contract、package contract、G1 runtime build均PASS；Node与Electron bounded package-import/LMDB close-reopen smoke均PASS。 renderer/preload rebuild与assembly15只为v0.19源/包hash未变基线，v0.20未重建。完整G1仍需要production owner/策略接线、durable inbox/cursor/lease、平台文件权限和同步语义、完整retention/GC与故障恢复；G0—G4原成功标准不变。详见[G1_DURABLE_STORE.md](G1_DURABLE_STORE.md)；[v0.20最终根证据](EVIDENCE_INDEX.md#v020)

## v0.21 G1 Consumer Inbox组件验收（历史记录；不关闭完整G1）

| 范围 | 当前证据 | 验收边界 |
| --- | --- | --- |
| Source staging与游标 | Node focused 23项PASS；真实journal events、原子inbox/enqueued cursor、cursor gaps、retention/consumer limits、owned clone、ACK holes及lease/token边界有覆盖 | 不接production consumer；source-pull retry不是下游delivery ACK。 |
| 崩溃恢复 | Node/Electron各3项SIGKILL路径PASS；staging和ACK cursor窗口均在重新打开LMDB后核对 | 进程崩溃证据不代表断电或硬件持久性；包含在本轮各585 PASS的定向矩阵中。 |
| Native integration | 每runtime新增2项AppKit synthetic native-to-consumer案例，加上既有3项native-to-store案例合计5项PASS；总数见[Node 5/5日志](EVIDENCE_INDEX.md#v021)、[Electron 5/5日志](EVIDENCE_INDEX.md#v021)。JSON收据仅支持2项新案例：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。 | 固定命名board synthetic fixture；不访问个人general clipboard，不验production listener或目标应用。 |
| Runtime/package路径 | Node和Electron bounded package import后完成LMDB commit、close/reopen、lease及ack；root/app typecheck通过 | 不等于renderer/preload rebuild、installed host或production storage验收；renderer/preload assembly仅沿用v0.19 hash基线。 |

Consumer Inbox完整契约见[G1_CONSUMER_INBOX.md](G1_CONSUMER_INBOX.md)。Windows105项NOT-RUN，Windows store在验证DACL/目录flush adapter前fail closed；production owner/current-policy transport、native host/preload、下游幂等应用、consumer retirement/resync、完整retention/GC及压力矩阵仍开放。G0及G1—G4整体保持未完成。

## v0.22 G1逻辑删除组件验收（历史；不关闭完整G1）

| 范围 | 当前证据 | 验收边界 |
| --- | --- | --- |
| Tombstone/CAS | strict schema；previousManifestRevision精确匹配；attempt kind/fingerprint冲突校验；同attempt同body仅只读replay，不复活。 | 本地LMDB逻辑删除；无物理blob/manifest/receipt回收策略。 |
| Atomic journal | tombstone、delete event/outbox、attempt、sequence与live/deleted head在单一writer事务提交；4个fault point回滚路径由定向回归覆盖。 | SIGKILL证明指定进程崩溃路径，不是断电/硬件耐久性。 |
| 定向矩阵 | Node/Electron各609 PASS、4项fixture-entry skip；日志：[Node](EVIDENCE_INDEX.md#v022)、[Electron](EVIDENCE_INDEX.md#v022)。runtime smoke：[Node](EVIDENCE_INDEX.md#v022)、[Electron](EVIDENCE_INDEX.md#v022)。 | 不包含全仓UI/业务/sync、Windows native、installed host或目标应用。 |
| Historical native integration | 每runtime的既有5项由2项native-to-consumer与3项native-to-store组成；aggregate日志见[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)，JSON仅支持新增2项：[Node](EVIDENCE_INDEX.md#v021)、[Electron](EVIDENCE_INDEX.md#v021)。 | 这是v0.21受监督synthetic board基线，不是v0.22新增删除集成或生产应用验收。 |

完整删除契约见[G1_DELETION.md](G1_DELETION.md)。Windows105项NOT-RUN；production owner/current-policy/host/preload、target idempotency/CAS、consumer retirement/resync、完整retention/GC和G0—G4其余门禁仍开放。

## v0.23 Payload lifecycle组件验收（历史；完整G1仍开放）

| 范围 | 当前阶段证据 | 未关闭门禁 |
| --- | --- | --- |
| schema2→3迁移与outbox proof | Node真实v0.22 source migration及ACK 8/8；migration强制roots核验，旧缺失row不生成receipt，新序号pending XOR ACK。 | 纳入两runtime最终定向矩阵；详细日志见[G1_RECLAMATION.md](G1_RECLAMATION.md)。 |
| payload pin API | caller-generated UUID leaseId/token；purpose export/paste/sync/pending-target；无TTL，128 active cap，release receipt终态幂等，summary不含token。 | 没有crash-owner解除协议；active pins可能持续阻塞回收，released metadata quota尚未定义。lease不授予内容读取或paste/sync权限。 |
| 单revision回收 | Node两测试文件合计16/16；要求source已越过deleteSeq、upsert/delete各有ACK proof、全部registered consumer连续ACK且无active pin；pre-marker逐blob完整性校验。 | recovery/restart、shared-hash与真实transactionSync reader/purger race三项通过；harness review有限范围APPROVE。 |
| filesystem安全顺序 | expiry marker在writer txn校验并提交/flush；随后新事务重新审计roots，才unlink orphan并fsync；共享hash由剩余引用保留。 | 目前不代表任意OS/断电硬件行为；Windows store未启用。 |
| 保留策略范围 | 只回收到期deleted revision的blob；manifest/receipt/raw/ref/attempt/tombstone仍保留，`readSnapshot`返回固定`payload-expired`。 | 不是完整metadata/time/capacity retention、full GC或compaction；压力与空间增长矩阵未完成。 |

Node/Electron最终定向矩阵各636 PASS、5项fixture入口skip：[Node](EVIDENCE_INDEX.md#v023)、[Electron](EVIDENCE_INDEX.md#v023)。Root/app typecheck、workspace/package contract、runtime build与bounded package smoke通过；smoke见[G1_RECLAMATION.md](G1_RECLAMATION.md)。这仍不代替生产owner/current-policy/target/Windows或完整G0—G4验收。


## v0.24 RTF隐私投影验收（有限范围通过；整体G0仍开放）

| 验收面 | 证据 | 判定与边界 |
| --- | --- | --- |
| 组状态、annotation、时间 | `uc`继承/恢复与特殊目的地行为；author ID可重复；parent排除当前record后唯一绑定，允许forward reference，歧义/环incomplete；时间字段重复、顺序、范围和日历检查。 | RTF focused tests共53/53，Worker annotation43 + destination10；不等于Word renderer或完整anchor语义验证。 |
| URL候选 | 线性枚举保留旧语义与20,000上限，结果走已有percent投影。 | 新增14项通过；隔离1 MiB regex baseline不是Worker性能证据。 |
| 原件与策略 | raw RTF bytes不变；确定命中阻断整次copy；unknown结构not-scanned/incomplete。 | storage read/reopen integration 3项通过；两端packaged Worker smoke各17/17，0网络/0输出，退出与双流关闭确认。 |
| 定向suite | Node24.15、Electron41.4 Node模式各706 PASS/5 child-fixture entry skip，57 pass files/5 skipped。 | Node为单独最终重跑；Electron日志是已通过initial结果的逐字副本，不是重跑。不是全仓UI/业务/sync。 |
| Build/review | root/app typecheck、workspace contract、renderer/preload builds、assembly15 files、package contract；独立source review。 | 全部PASS；review有限范围APPROVE且reviewer未执行测试。包15 files、7 paths新增/变化、3个旧hash名chunk替换。 |

Node initial 10k queue case曾超过既有5秒测试deadline（6461ms）；source与deadline未改，Node最终单独重跑通过。12.34秒/24.12秒为测试运行总耗时，不是产品吞吐/p95。以上只验收G0 RTF静态投影增量；Windows105项、完整Mac/Windows应用、production listener/host/current-policy、G1—G4完整门禁仍需独立证据。

## v0.25 V1 database integration supplement

这些用例覆盖现有 V1 store 接线，不满足 V2 store、listener、publisher 或 sync 门禁。

| Case | 验收条件 | 当前状态 |
| --- | --- | --- |
| Resolved write error | 宿主 error:true 回执必须拒绝操作；不能将其作为成功更新索引/cursor。后续重试应可写入同一变化且不重复。 | Node/Electron全工作区均1246 PASS/6 skips；两端packaged scanner各17/17、bundle preload synthetic SDK cases各6/6。最终根收据与文档审计字段见本节末尾链接。 |
| Put/remove success receipt | Put 要求 ok:true、请求ID和revision。Remove要求ok:true与请求ID；宿主remove可能不返回revision。错误文案不得泄露宿主原始正文/message。 | Adapter实现确认。对象remove必须有非空_rev，只传_id与_rev；字符串ID形式保留宿主API语义。成功回执的rev仍可省略，避免把请求版本与成功结果字段混淆。 |
| allDocs argument compatibility | Prefix/keys请求应按宿主原生形态传递；返回文档ID需落在请求范围内。 | 已实现。宿主内部错误仍可能被折叠为[]，因此不证明枚举完整。 |
| Legacy attachment migration | 先核验附件复制，再改写实际返回记录；宿主枚举被模拟为空时，旧副本仍在且marker标记hostEnumerationCompleteness=unverified。lstat拒绝已有source/destination root和ancestor symlink/junction以及嵌套目标链接。 | Node 24迁移用例8/8。路径检查与后续复制非单一文件系统事务，不能消除校验后的TOCTOU。完整枚举/改写及安全清理仍未确认。 |
| Existing enumerated deletion paths | 空allDocs结果不能作为每个请求记录均已删除的证明。 | P2开放：插件无法区分真正空结果和宿主折叠后的读取失败；需宿主错误传播或其他权威协议。 |

V1 adapter测试和边界见[V1数据库写入确认](LEGACY_DATABASE_CONFIRMATION.md)。v0.25 root evidence：[root capsule](EVIDENCE_INDEX.md#v025)。最终根收据与文档审计字段见此链接。当前没有Windows环境，Windows原生105项为NOT-RUN；synthetic SDK或Node/Electron VM结果不能作为Windows证据。完整G0—G4验收仍开放。


## v0.26 历史图片入库局部验收

| 验收面 | 证据 / 行为 | 当前判定与限制 |
| --- | --- | --- |
| v0.25旧包红测基线 | Node24与Electron41.4的实际preload CJS图各跑7个owned synthetic SDK/history场景：4类复现路径缺失、读取失败、写入失败和损坏cache问题；成功、隐私排除、暂停3项通过。 | 结果绑定修复前preload SHA，只说明旧包缺陷；见[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)和[进程收据](EVIDENCE_INDEX.md#v026)，不作为新实现失败或绿色证据。 |
| 图片准入与cursor | 允许保存的图片缺路径、read/stat/copy/store/verify失败应拒绝当前镜像并保持cursor；暂停或隐私排除仍可略过。 | v0.26 source目标见[历史图片入库说明](LEGACY_DATABASE_CONFIRMATION.md)；全工作区最终结果以v0.26根收据为准。 |
| blob bytes与缓存 | 有界handle read、nonempty/100 MiB JS byte budget、length/SHA验证、坏regular-file leaf repair；root/ancestor/prefix symlink guard与identity/realpath复核。 | 定向sync/blob 23/23，独立source review确认P1修复；Node/Electron完整矩阵各1279/6，scanner/base preload/image smoke各17/6/10，7项build/types/contracts通过。预算不是RSS/time硬上限；无path/DB事务或power-loss durability claim；Windows `O_NOFOLLOW` native equivalence未运行。 |
| 批次及回收 | 成功record在另一item失败时保留，重试按fingerprint去重；DB失败后共享hash blob留待重试/GC。 | 不提供durable pending attachment queue或health UI，失败项可能阻塞整批cursor；既有duplicate不自动revalidate。 |
| Test harness隔离与隐私回执 | 未知`node:` builtin改为allowlist拒绝，record-error验证固定event detail并扫描event/console sentinels。 | 两个harness P2修正分别获reviewer APPROVE。 |

Node与Electron v0.26全工作区均为142 passed files/5 skipped files、1279 PASS/6 skips；Node耗时24.16s，Electron 26.62s。两端scanner各17/17、base preload各6/6、image package各10/10；7项build/types/contracts通过，6个bounded process正常终止且stdout/stderr为空。结果见[Node](EVIDENCE_INDEX.md#v026)、[Electron](EVIDENCE_INDEX.md#v026)与本页root capsule。限定范围独立source review为APPROVE，reviewer未运行测试。当前证据不替代已安装ZTools、general clipboard、Windows系统调用或目标应用粘贴验收；Windows105项NOT-RUN，完整G0—G4继续保持开放。


## v0.27 Windows source-kit 局部验收

| 验收面 | 最终证据 | 判定与限制 |
| --- | --- | --- |
| source-only归档 | [ZIP](EVIDENCE_INDEX.md#v027)；153 entries/152 payload，payload 876744 B，ZIP 263096 B，SHA-256 `7f3b647e75f060b9b1fa57976842ff7df574cfdfd02ed5dfea55ca61efe9158e`；[receipt](EVIDENCE_INDEX.md#v027)。 | producer最终版本；manifest仍标记105 cases NOT-RUN、gateComplete=false。 |
| producer修复 | [Node24 root producer tests](EVIDENCE_INDEX.md#v027) 8/8；[修复后日志](EVIDENCE_INDEX.md#v027)；source reviewer有限范围APPROVE。 | 三个发现关闭：allowlist、cold checkout output root、文件/总payload/ZIP/entry/path budgets。source review不代表Windows执行。 |
| final artifact delivery | [final delivery report](EVIDENCE_INDEX.md#v027)：双生成字节一致，CRC/manifest/path/mode、clean extraction verifier、tamper rejection通过；152 payload hash稳定。 | 44/44 pure Node contracts与portable CTest 1/1按哈希继承，未在最终包上重跑；artifact report自身不声称source review。 |
| Windows执行与应用矩阵 | Windows 10/11、x64/ARM64、WinAPI/WIC、105 native cases与目标应用。 | 全部NOT-RUN；无Windows环境。source kit不是installed plugin，G0—G4仍未完成。 |

## v0.28 history mirror图片失败隔离（局部验收）

| 验收点 | 当前目标行为 | 最终判定 |
| --- | --- | --- |
| privacy与错误分类 | policy拒绝可跳过；仅图片固定持久化错误可继续，其余prepare/privacy/host/database异常快速失败。 | Node/Electron全量通过；source review有限范围APPROVE。 |
| 混合批次 | 图片失败后仍处理正常非图片；已写record保留，失败后整批返回固定错误且不推进cursor；重试指纹去重。 | 双端1298 PASS/6 skips；局部错误行为有回归覆盖。 |
| 失败上限 | 每轮最多16次失败图片prepare；达到上限不再做后续图片I/O，但非图片继续。 | 不代表图片公平重试或durable pending。 |
| Coordinator副作用 | 失败路径尝试dispatch history changed且保留原错；不发镜像成功事件、不运行retention、不启动vault sync。通知best-effort，测试不证明subscriber已收到，清空变更ID后无可靠重发。 | 两端package isolation各7/7通过；不证明subscriber实际收到。 |
| Deadline helper回归 | 250ms observation和20s/27s场景deadline不变；观察结束前复核marker/child，除ENOENT/ENOTDIR外检查错误fail closed。 | 首轮5-case red 2 FAIL/3 PASS；marker 10-case red 4 FAIL/6 PASS；最终journal+polling 25/25 PASS。有限source review APPROVE，reviewer未跑测试。 |
| Packaged/runtime与build | Node/Electron scanner/preload/image/isolation各17/6/10/7通过；6项build/types/contracts及root types通过；8 bounded processes exit0、signal null、stdio为空且确认终止。 | Renderer未改未重建；15个package输出仅preload变化，2个snapshot runtime未变且未重建。 |
| Node/Electron全量 | 两端各144 passed files/5 skipped files、1298 PASS/6 skips；Node 20.28s、Electron 20.91s。 | 双端全量通过；6 skips为5个child-fixture入口及1个opt-in macOS app catalog smoke。 |
| 历史证据可追溯性 | 保留v0.26 Node journal timing原始SHA及HISTORICAL_EVIDENCE_UNAVAILABLE状态；新v0.28收据不得冒充旧证明。 | 原正文无法恢复；benchmark已恢复exact SHA，见[incident report](EVIDENCE_INDEX.md#v028)。 |
| 完整阶段 | 不建立durable pending/failed状态、路径恢复；完整§6.2.5、G1及G0—G4仍开放。 | 不得标记阶段通过。 |

Windows105项NOT-RUN；installed host、general clipboard与目标应用矩阵未验收。

## v0.29 增量验收边界

新增 Windows 私有 ACL、对象身份、文件 flush 与受控 fixture 清理源码，未接入生产 store/LMDB，也未移除 Windows 创建目录前的失败关闭。目录 namespaceDurability 固定 NOT-VERIFIED；sourceToBinaryBinding 固定 UNVERIFIED。20 项双运行时契约覆盖报告拒绝、源码闭包、受控文件路径、PE 执行架构与进程结果；不能证明 Windows 原生编译、CRT、API 或实际应用格式保真。

独立源码复审关闭两项清理 P2、CRT 文本模式 P1 与 CMake 外部源码清单 P2，最终为有限范围 APPROVE，reviewer 未运行测试。原 408 项选定源码、15 个插件产物、2 个 store runtime 文件及 43 份归档证据 SHA 未变；v0.28 全套 1298 PASS/6 skips 是未重跑历史基线。原 v0.26 journal timing 正文仍不可恢复。

本轮未编辑宿主；宿主 owner/受控 IPC、通用采集、真实目标应用、Windows SDK/OS/文件系统及异常恢复、完整 G0—G4 继续开放。没有 Git add/commit/push 或发布。

## v0.30 当前验证范围

单个受限 metadata 文档持久化图片重试排序边界，使前 16 项持续失败时后续图片仍能获得 prepare 机会。所有 deferred/已知失败仍阻止主 cursor 提交；健康记录保存并按 fingerprint 去重，未知/host/privacy/database 失败仍中止。该边界不保存载荷，不提供逐项 durable pending/failed 队列或失效路径恢复；privacy 按本轮读取的快照逐项判断。

镜像和完整 clear 在主窗口共享队列；secondary 只发请求，无本地清空回退。RPC 16 pending/in-flight、128 completed 缓存、30s 未确认无自动重试。只能阻止已在途镜像跨过 clear；不永久抑制未来 host 重枚举，也不覆盖 vault sync 等其他写入口。

最终 11 文件 Node/Electron 各 91/91 PASS、6 项 types/build/contracts PASS；现有 scanner/preload/image/isolation 每端 17/6/10/7 通过。新 CJS 轮转 25 检查与清空队列 17 检查两端通过，旧冻结 CJS 对应红测两端复现。独立静态复审有限范围 APPROVE，未跑 runtime。只有 dist/ztools/preload.js 重建变化，renderer 与 2 个 store runtime 文件未变。初次旧 IPC 通道预期失败及修正后的结果均保留。

v0.29 428 项选定源码中 11 项变化、417 项未变；新增 8 个源码/测试文件，另外将两个既有测试文件纳入收据，当前选择集 438 项。两个新纳入测试的修改前正文不在 v0.29 capsule，不能用该 capsule 证明其旧正文。v0.29 的 25 份直接证据与 v0.28 的 43 份归档证据均保持原 SHA。v0.28 全套结果未在本轮重跑，v0.26 timing 历史缺口仍保留。Windows 15+105 项、生产宿主与完整原方案均未验收。

## v0.31 主路径依赖核对

当前 PastePlanV2 只有 schema；没有真正连接私有 V2 snapshot 的 planner/publisher，也没有 portable projection、V2 crypto wire或接收端激活链。完整 consumer retirement/resync 还缺 target intent、水位、sourceSeq/CAS与旧 worker撤销。本轮为这些主链准备具体 owner、受控 Interface、版本绑定、表示选择、转换冲突、GC roots、账号/策略生命周期及六方向门禁；不增加无调用方的 core 函数或空注册退役来替代完整目标。

宿主源码只读核对的 HEAD 为 9b15fb1a2a9f3ec886016632761c7bb21e39557a，原工作区 clean；尚未在其 fix/security-protocol-validation 分支开发。v0.31 曾提出独立宿主工作区接线候选；按用户 v0.32 的明确限制，该路径现在属于范围外依赖，本轮只修改插件目录，不创建宿主分支或修改宿主。Windows 10/11 105 个 G0 和 15 个存储基础探针仍 NOT-RUN；当前没有 Windows 环境。Windows 12/后续系统与 Linux 仍按原 G4 单独取证。

v0.31 当轮没有实现代码/依赖/产物变化，也没有重跑实现测试。v0.30 Node/Electron 各 91 项相关回归与 CJS 红绿收据仅作为已验证的未变基线保留；后续设计评审不能代替系统或应用验收。未提交、推送或发布。

两份候选契约的独立复审已关闭两项P2，有限范围APPROVE design；没有实现测试或平台验收。本轮[根证据](EVIDENCE_INDEX.md#v031)、[设计复审](EVIDENCE_INDEX.md#v031)和[主路径审计](EVIDENCE_INDEX.md#v031)绑定准确范围。完整目标未缩减；宿主真实接线属于本轮范围外依赖，Windows 运行仍缺环境。这些缺口不阻止继续完成插件内可验证工作。

## v0.32 插件内清理回灌修正

清空先读取有界宿主历史，正向确认每设备清理身份集合，再进入已有清理队列。镜像仅跳过精确的 `(id,timestamp)` 身份；被排除行不推进主游标。独立审查指出的时间范围误抑制、旧行推进游标、矛盾分页总数和验证输出根目录问题均进入本轮复验。

身份集合最多 100,000 项，长期合并达到上限时会在删除前失败关闭；没有自动遗忘或重置。真实宿主 IPC 大文档容量、单调 source sequence、分页快照及完整格式采集仍未验收。Windows 105 个 G0 和 15 个存储探针仍 NOT-RUN；本轮没有提交、推送或发布。

最终插件相关回归：Node/Electron 各 157/157（15 文件），类型/构建/契约 6 项通过。实际 assembled CJS 合成 SDK 两端各 35/35，通过冻结旧包预期失败对照；详情及适用边界见[清理身份记录](HISTORY_CLEAR_BOUNDARY.md)。没有将这些结果计为真实宿主、操作系统或应用回贴验收。
