# 独立审查与最终修复记录

本页保留0.1.0的审查过程。0.1.1本轮设置修复的复核及实际验收见[设置逐项验收](settings-validation-report.md)。

最终代码审查结论：**Spec compliance Approved；Quality Approved；三个Important全部ADDRESSED，新增Critical 0 / Important 0**。结论对应修复代码 `5ac4946`；随后新ZIP `8318ebb161be9d95a5c3c6edebd714f30beed2fd8e022cfebe91708561f5cf1e` 已由协调者完成159项Node检查、14个宿主脚本、7项认证即时落盘、用户源真实播放下载及50次短回归。具体运行范围见 [验证回执](verification-report.md)。

以下保留最初发现和后续复核的时间顺序，因此最初的Request changes不是当前未关闭状态。私有脚本、URL、凭据和原始临时数据均未复制到本文或安装包。

---

# 全分支最终代码审查

日期：2026-11-10
审查范围：`f985bf4..2dcaefa22dfe36cdc94b0f6098d2abb2c30a643f`，23 个本地提交。
审查角色：独立、只读、merge 级全分支审查；没有启动 Electron/ZTools/官方 LX peer，没有修改产品代码、index、HEAD，也没有分派其他审查员。仅新增本报告。

## 双 verdict

- **Spec compliance：Request changes。** 核心模块已实质实现，但标准 LX 源 HTTP 默认编码不兼容，以及同步设备撤销在成功返回前没有持久化，违反标准 API 2.0.0 兼容和“业务提交即持久化、强杀不依赖退出钩子”的要求。
- **Quality：Request changes。** 另有可复现的歌词窗口旧轮询覆盖新成功操作问题。现有全套 PASS 有有效证据，但没有覆盖这三个触发条件，不能关闭本次全分支 gate。
- **Ready to merge：No。** Critical：0；Important：3；新增 Minor：0。三个 Important 均需修复和定点回归后重新审查。

## 范围、方法与已经做好的部分

审查先读设计、计划 Global Constraints / Review Focus / 阶段验收、implementation-decisions、compatibility、verification-report 与 SDD ledger。以完整 `review-f985bf4..2dcaefa.diff` 为审查范围，以 reading 视图分段定位变更，再直接读取当前文件及生成的可读 CJS 校核实际契约，没有重新生成 git diff。完整上游拷贝/许可没有机械逐行复审；核对了已有 vendor integrity 记录（736 个文件、0 内容差异、689 个仅 EOL 差异）。因具体适配风险，额外读取了原源 preload、原 renderer request、原同步认证/设备数据/设备撤销调用链。

本次检查覆盖新增运行时/所有 renderer 适配边界、构建加载器、独立组装、宿主 fixture 和主要契约/故障/真实宿主验证代码。测试文件按实际行为和风险抽查，不把测试数量或旧 scopedApproved 当作实现正确性的替代。

主要优点：

- 保留原 Vue/业务 store/播放器，桥接白名单明确；业务服务 context 与 renderer 的 `window.lx` 分开，桌面歌词没有建立第二个播放器。
- SQLite 使用原 SQL 模型和同步事务；列表失败后的模块缓存失效、备份设置与曲库同事务提交、提交后再发布事件的方向正确。设备本地 SQLite 的 P0 决定及云账号边界有明确说明。
- 源脚本只在浏览器 Worker 中执行，loopback frame 加 CSP、会话 token/source/origin 校验、HTTP 参数筛选、切源代次与外部 deadline 都有实际实现，没有把 fs/require/ipcRenderer 交给源。
- 下载区分传输、原子发布、标签写入、UI/SQL 完成 ACK；Range/validator 校验、inode 归属、cancel/drain 以及原 UI 的 epoch/write barrier 都针对真实失败路径设计。
- 同步保留原协议和加密/合并模块，新增串行启动/停止、取消旧认证、socket 所有权、快照创建与 prune 同一 owner queue、失败写重试代次校验。官方对端双角色证据比“两份插件互通”更有说服力。
- 安装包显式组装、逐文件 receipt、传递依赖和许可检查、ZIP 模式不复制开发插件目录，能支撑独立交付判断。产品没有使用宿主内部业务 IPC；测试安装驱动的 internal handler 与产品边界分开。
- 文档区分已实现、受控响应、指定宿主、LIVE、人工未验，并保留 Electron 42 长测失败。没有把最终 ZIP 的短测冒称该字节包已通过 30 分钟长测。

## Important

### I1 — 标准源 lx.request 被音乐目录传输层改写默认编码

位置：

- `src-ztools/preload/runtime/source/session.cjs:69-70`
- `src-ztools/preload/runtime/network.cjs:16`
- 契约参照：`vendor/lx/src/main/modules/userApi/renderer/preload.js:194-213`；`vendor/lx/src/renderer/utils/request.js:280-304`。

**触发与影响：** 标准 API 源执行 `lx.request(url, { method: 'post', body: { message: 'hello world' } }, callback)`，或发送没有自行指定 Content-Type 的表单字符串。原源 preload 直接调用 needle，并没有强制 JSON；新实现把该请求送入原“音乐目录” httpFetch，后者默认 `format='json'` 并设置 `json:true`。对象 body 从 URL 编码表单变成 JSON；字符串 body 的默认 Content-Type 也变成 JSON。依赖原默认表单编码/Content-Type 的源会收到参数或签名错误，无法取播放/下载地址。这是标准接口兼容问题，与 DOM 扩展限制无关；已有 monster.js 成功不能覆盖。

**本次实际定点结果：** Node 进程内创建 loopback echo server，按原源 preload 的相同 needle 调用与真实 `createNetwork().request` 对照；没有运行宿主、没有用第三方源。

| 输入 body | 原源 preload 传输 | 移植版传输 |
| --- | --- | --- |
| `{ message: 'hello world' }` | `message=hello%20world`；`application/x-www-form-urlencoded` | `{"message":"hello world"}`；`application/json; charset=utf-8` |
| `'message=hello%20world'` | 同一字符串；`application/x-www-form-urlencoded` | 同一字符串；`application/json; charset=utf-8` |

**修复方向：** 为标准源 HTTP 保留其自己的请求选项/默认值边界，不能直接继承目录 SDK 的 JSON、默认头等策略。保持目录 SDK 原行为。不要简单统一强制 `json:false` 后忽略用户显式 JSON Content-Type 对 needle 的原生推断；应对照上游 source preload 的实际契约。

**回归要求：** 经过真实 SourceSession/Worker 消息边界的无 header 对象 body、字符串 body、显式 JSON header、form、formData、二进制/typed-array 及 callback/cancel 断言；另确认目录 SDK 的现有 JSON 请求未受影响。当前 network 单测主要覆盖 GET、form、独立 headers、cancel，没有覆盖 body 的原源默认值。

### I2 — 歌词窗口轮询会把已成功的新尺寸回滚为旧尺寸

位置：

- `src-ztools/preload/runtime/windows.cjs:117-129`，尤其 `getBounds` 后的 `update_config`。
- 关联：同文件 `serial`、resize RPC 和 `changed -> serial(apply)`。

**触发与影响：** 500 ms 轮询发起异步 `getBounds`，宿主返回较慢；期间用户 resize RPC 已在 serial queue 内成功应用并保存新尺寸。旧轮询随后返回旧 rectangle，只检查窗口对象是否仍是 current，没有操作 revision 校验，也不在相同串行队列中。它把旧 rectangle 写入设置，再触发 apply，把窗口也改回旧尺寸。用户刚完成的拖动/缩放会回跳，旧尺寸还会持久化；新 RPC 已返回成功。

**本次实际定点结果：** 使用真实 `createWindows` 与内存窗口/公开异步方法 fixture，捕获 interval，不等待真实 500 ms。挂起第一次轮询 getBounds，发送并完成 width=700 的 resize，再释放旧 width=450 的轮询结果：

```text
after successful resize 700 700
after older poll returns 450 450
reply {"kind":"result","id":"new-resize", ...}
```

两列分别为实际窗口宽度和 appSetting 宽度；成功 reply 中没有 error。已有“旧失败 resize 不能覆盖新成功 resize”测试只覆盖两个 RPC，没覆盖队列外 poll。

**修复方向：** 轮询的读取、有效性判断和回写要与窗口操作共用完成边界，或用可靠 revision/请求代次使旧读无效。处理多次轮询重叠、close/dispose、窗口被替换；不要仅在轮询开始时做一次 current 校验。

**回归要求：** 旧 poll → 新成功 resize → 旧 poll 返回；重叠 poll 乱序；poll pending 时 close/dispose；保留既有异步拒绝/返回 Error 和 resize 队列恢复测试。

### I3 — 同步认证状态成功 ACK 早于持久化，强杀可恢复旧授权或丢失新授权

位置：

- `src-ztools/preload/runtime/sync/index.cjs:93`（直接返回原 removeServerDevice）。
- `src-ztools/preload/runtime/sync/storage.cjs:28-40`（默认 100 ms 延迟且调用方不等待）。
- `src-ztools/preload/runtime/sync/adapt-source.cjs:12-15`（仅替换写队列，仍保留原撤销 throttle）。
- 实际生成链：`preload/upstream/main/modules/sync/server/user/data.cjs` 的 `removeClientKeyInfo`；原实现 `vendor/lx/src/main/modules/sync/server/user/data.ts:125-128`，调用经 server/server/server.ts 的 removeDevice → userSpace.removeDevice。

**触发与影响：** 用户撤销已认证设备，Promise 已成功返回且当前设备列表已移除，但底层仅删除内存条目并排入 100 ms throttle。此时强杀/崩溃，重开后的设备数据仍包含旧 key；服务再次开启后旧客户端仍可使用已撤销 key。若写入失败，错误还只是留给稍后 flush/console，撤销调用仍已成功。关闭服务中的 `storage.flush()` 不能代替“业务提交即持久化”，也不能保证强杀会执行。

**本次实际定点结果：** 对真实生成的 UserDataManage 使用内存 FS 映射，种入一个已授权设备；await removeClientKeyInfo 后立即从同一持久内容新建 manager。未启动任何宿主、peer 或 listener：

```json
{
  "removePromiseResolved": true,
  "inMemoryRemoved": true,
  "persistedStillContainsKey": true,
  "reopenedAcceptsRevokedKey": true
}
```

显式 `storage.flush()` 后旧 key 才从持久内容删除。原 auth 的 verifyByKey / verifyConnection 正是从该 manager 取 key，所以“重开重新认证可用”的调用链成立。此实验直接证明 ACK 与持久化间的窗口；没有冒称实际宿主强杀已复现。

**同一缺陷也影响新授权，不应只修 removeDevice 外层：** 原 `server/server/auth.ts` 的 `verifyByCode` 创建 key 后调用 `saveClientKeyInfo`，随后直接返回 RSA 包；`authCode` 把该结果作为 HTTP 200 发给客户端。生成代码保留这一同步返回链，而 `saveClientKeyInfo` 同样只排队 throttle。本次追加同一内存 FS 定点实验，结果为 `authorizationCallReturned=true, inMemoryKeyPresent=true, persistedMissing=true, reopenedMissing=true`。因此新设备已收到成功认证结果后立即强杀，服务端会丢失刚授予的 key，重开只能重新配对。`server/user/data.ts` 的首次 `initServerInfo` / `setVersion` 也通过同样的 `saveServerInfoThrottle` 返回，serverId 在监听/握手可用前缺少持久化完成保证（该 serverId 路径是代码调用链判断，没有单独启动宿主复现）。客户端 `client/data.ts` 的 await 修补已经存在，不能据此认为服务端也已覆盖。

**修复方向：** 新授权、撤销以及首次 server identity 的成功响应必须等待可恢复的认证数据提交；失败要返回给对应调用方/握手，不能只在关机 flush 才暴露。对认证数据使用原子写/发布并处理失败时内存与持久状态，不能仅缩短 throttle，也不能以“非 fsync 保证”解释当前连 write 都尚未开始的 ACK 窗口。关闭整个 server 不是每次授权的合理持久化办法；应在认证状态服务本身建立完成边界，并保持原 wire protocol。

**回归要求：** 在业务 removeDevice 层，成功返回后立即重新打开持久数据，旧 key 必须不存在；在新认证 HTTP 成功边界，持久数据必须已包含新 key，首次 serverId 必须能重开保持；注入写入失败不得报告授权/撤销成功，文件不能成为部分 JSON；新增/撤销/重配并发不能被旧写覆盖。增加“不执行 dispose/flush 即模拟强杀”的认证状态回归。现有官方互通的 revoke/re-auth 验证仅证明存活进程中的效果，不足以覆盖这一条件。

## 其他边界与技术决定

| 项目 | 判断 |
| --- | --- |
| pluginData + node:sqlite | 接受已记录的 P0 决定。直接 SQL 事务比模拟宿主跨文档原子性可靠，模块加载/启动错误能显露缺失 SQLite；代价是宿主版本、设备本地存储及云账号语义，文档已说明。此判断不豁免 I3 的独立文件认证状态。 |
| 独立 Electron 41.4.0 + 已安装 app.asar | 能支持该组合的自动宿主证据；不等于日常 EXE/所有版本验收。原生移植产品本身不依赖独立 LX 程序，官方 peer 仅是测试对端。 |
| Worker 与 DOM 限制 | 作为已记录 fallback 合理；没有发现特权 eval 或给源任意 require。DOM 扩展不能一概承诺兼容，但标准 API 仍须修复 I1。 |
| 所有新下载需要 hard link | 在 Windows/本地 NTFS 首验范围内可接受，安装指南准确写明“所有新任务”，未仅写成 skip-existing 限制。保持此前 Minor/deferred 边界，不再增列同一 finding。 |
| 标签 rename → fingerprint 窄窗 | 选择保留文件并报 ownership，而不认领/删除不确定文件，是负责任的保守恢复；不能称所有崩溃窗口自动恢复成功。当前文档没有该冒称。 |
| 原桌面未支持功能 | 宿主管理/无公开接口的设置有说明和禁用，独立升级页/快捷键页有明确替换；不以媒体键/人工物理键 PASS 背书。 |
| 原独立桌面发行包构建 | vendor 无语义修改，本次独立 web/preload 适配范围内接受“上游 blob 完整性 + 产品构建”，不要求无关桌面安装器构建。后续修改 vendor/桌面入口需重新判断。 |

## 测试证据评估

本次读取并核对现有证据，而没有重复跑全套：

- 当前 HEAD 为指定 `2dcaefa22dfe36cdc94b0f6098d2abb2c30a643f`，审查前后工作区没有产品改动。
- 本地 ZIP 的 SHA256 实测为 `f86ccdfa3d2be22d4ce4c97ae2030106f8db9fc7d9766e2d856ec0ac73f6d9cf`，与报告一致。
- `artifacts/final-unit.log` 为 139 总数、138 PASS、0 FAIL、1 明确默认 peer SKIP。没有把 skip 算 PASS。
- `artifacts/e2e/report.json` 的最终 ZIP 14 个串行脚本退出码均为 0；检查了 host fixture 的 ZIP 分支确实不复制开发 src-ztools。
- 源初始化/请求 dead loop deadline、播放/恢复、library 请求页码与数据、下载 PCM、官方双角色同步等脚本有实质断言；受控网络替换没有被文档包装成外部 LIVE。
- recovery 检查原列表内容/顺序摘要、同 pluginData 重开、不同 PID、无自动播放、Range 和 PCM，有效覆盖对应场景；它没有覆盖认证撤销提交，不能排除 I3。
- stability 记录确为 1,807,934 ms 的核心服务检查点；final 的另一次为 14,880 ms / 50 次，不混为最终 ZIP 30 分钟。
- 私有源最终 ZIP 播放/下载及五平台 LIVE 是协调者提供的额外证据；本审查没有打开或复制原始私有源，也未以该样本替代标准契约检查。

本次新增执行仅三个轻量定点实验：loopback HTTP 编码对照、内存窗口乱序完成、内存认证状态重开。它们没有调用宿主，没有修改日常配置、产品源码或官方对端；结果分别直接对应 I1/I2/I3。

## Declined to judge / 保留未验

以下不是被悄悄丢弃的问题，也不计 PASS：

- 人工可听输出、物理全局快捷键、日常 ZTools.exe 全流程：没有本次直接观察证据，保持“未验”，不能把自动状态/PCM/app.asar 证据替代它们。
- 任意第三方源、DOM 扩展脚本、所有外部平台/歌曲永久可用：超出可保证的标准 API 和已提供指定样本范围；但 I1 属于范围内，未以此免责。
- 其他 OS/未验宿主版本、外网/移动同步及全部冲突策略长期运行：首验和现有测试矩阵没有这些覆盖，保持条件性结论。
- Electron 42.3.3 约 695 秒 WebContents 消失和历史 cold-start preload 缺失的根因：本次未扩大诊断；原 FAIL/未定位记录必须保留，不能声称已修复。
- 未修改的完整上游桌面安装器构建：按已记录 P0/构建决定，不纳入本次产品构建验收；未把它写成通过。

除上述明确保留项外，本次没有因为“过去已有 scoped review”或“原上游也有该行为”而把目标模块的交付缺陷排除出审查。I3 正是原行为在此次持久化/强杀要求下必须处理的适配责任。

## 建议的关闭条件

一次修复可同时覆盖三个 finding，但需分别保留失败到成功的定点证据。重点是源传输默认契约、窗口轮询与操作的完成顺序、认证撤销的持久化 ACK；修复后先跑相应单测及受影响宿主专项，再由协调者决定新的 ZIP 回归范围。当前报告不授权发布/推送，也不要求无关重跑或修改用户真实配置。

**最终结论：本分支尚不能合并；修复 I1、I2、I3 后复审。**

## 2026-11-10 Scoped re-review：唯一最终修复波次

**当前代码审查结论以本节为准，前面的 Request changes 保留为原审查记录。**

范围严格限定为 `2dcaefa22dfe36cdc94b0f6098d2abb2c30a643f..5ac4946dc73f557cd93ab07a634f15a0f1fb8f86`，即 `f7cb288`、`5704c0d`、`5ac4946` 三个修复提交。先读取 `final-fix-report.md`，再完整分段读取唯一 `review-2dcaefa..5ac4946.diff`（91,507 字节），并针对修复调用链读取生成 CJS。没有重新进行全分支审查，没有生成新 git diff，没有重跑已通过的 52 项专项，也没有启动 host/peer、分派其他 agent 或修改产品/index/HEAD。此轮只追加本节。

### 双 verdict 与原 finding 状态

- **Spec compliance：Approved（本次代码修复范围）。**
- **Quality：Approved（本次代码修复范围）。**
- **Ready to merge：Yes（代码审查 gate）。** 原 I1/I2/I3 均已关闭，本 fix 内没有发现新增 Critical/Important。最终新 ZIP 的完整交付验证仍由协调者完成，不能用旧 `f86ccdfa...` ZIP 的结论代替新产物。
- 原人工听音、物理快捷键/拖动、日常 EXE、其他 OS/宿主、全部外部源与断电/硬件存储保证等未验边界均保留，不计为本次 PASS。

| 原问题 | 状态 | 本次独立核查结论 |
| --- | --- | --- |
| I1 标准源 HTTP 默认值被目录 SDK 改写 | **ADDRESSED** | SourceSession 改用独立 requestSource/eager needle；目录 request 仍走原 httpFetch。源端按上游 body → form → formData 优先级、原 Content-Type 推断、timeout 和 callback 响应结构处理；不把目录 JSON/默认头带入源请求。 |
| I2 旧歌词 poll 回滚新成功操作 | **ADDRESSED** | serial 在入队/完成推进 revision，并维护 pending operations；poll 对每个异步完成边界校验 revision/current/closed/operations，且按窗口身份合并。旧窗口挂起不会阻塞替换窗口，也不能清掉新窗口的 polling 标记。 |
| I3 认证成功 ACK 早于持久化 | **ADDRESSED** | 服务端新授权、撤销、首次 identity/version 和客户端 key 都经过独立认证文件串行事务；从最后已提交内容构造 next，临时文件 write/sync/close/rename 后才更新内存并完成成功响应。失败直接返回，认证失败不进入 snapshot 的退出重试队列。 |

### 针对修复新增边界的核查

**I1。** 读取 network、SourceSession、Worker、protocol 和相应测试。共享 pending/cancel/并发限额仍在统一层，目录请求行为未被修改。只携带实际 Buffer 的字段路径，再沿已存在 own properties 恢复 Buffer；普通字段名、嵌套对象、显式 typed array/ArrayBuffer 保留原类型语义。恢复逻辑没有得到 Node 模块或文件句柄，也没有把 formData 自动升级为 multipart；新增字段不突破现有 options 白名单。源码的 synchronous needle throw 被 Promise 捕获，返回受控错误；取消仍阻止迟到 callback。

已核对 SourceSession 单测使用 structuredClone 经过真实服务边界，echo oracle 按原源 preload 选项构造，未用新实现自证。真实 CSP Worker 专项另检查 callback 的 this、三参数、body identity、raw/status/headers/bytes、错误 null 参数、幂等取消，以及保护文件内容没有进入请求；12 个请求形状涵盖原 finding 的两种直接触发。该证据明确是受控本地 HTTP，并非外部 LIVE。

**I2。** 读取所有 poll/serial 变更及新增 5 类场景。当前修改不是把 poll 无界堆入 queue，而是跳过正在进行的操作并合并同一窗口的未完成 poll；在 isDestroyed、moveTop、getBounds 返回后都再验证代次。resize 成功后旧读、多个 tick、宿主 setBounds 未完成、close/dispose、旧窗口未完成但新窗口已打开的路径都有直接断言。此前异步 reject/返回 Error、失败后继续、两个 resize 交错的测试保留。未发现该修复引入新的状态覆盖路径。

**I3。** 不只检查 removeDevice 包装。核查了 adapt-source 及其实际生成的 UserDataManage、verifyByCode/verifyByKey/authCode、server connection、首次 serverInfo 和 client data/auth 调用链：

- 新 key 的持久化在 RSA 返回/HTTP 200 前完成；撤销在原业务 Promise 完成前提交；首次 serverId 在监听/握手发布前提交。
- 认证事务由单独 authQueues 管理，失败没有放入 snapshot failedWrites；flush 可等待在途认证，但不是成功 ACK 的前提。
- getter/list 返回 detached 数据，未提交前不提前变更授权态；existing-only metadata update 在已提交状态中重新检查 key，不能将已撤销 key 重新加入。
- 客户端保留其他 server 的 pairing，原子替换失败后仍保留之前已提交的本地 key；不把远端可能已创建但本地未接受的 grant 宣称本地配对成功。
- 新增 await 影响的 WebSocket setup 已补 socket key ownership、未就绪 socket 安全撤销、关闭状态检查；对应 pending metadata 立即 revoke 回归存在，未把原来的同步完成假设遗留在新增 await 两侧。
- 真实错误沿 HTTP 500/业务 reject/客户端认证 reject 返回。协议成功报文、加密、快照/合并算法没有因认证写入改成另一套协议。

atomicWriteJSON 使用同目录随机 wx 临时文件、file.sync、rename 后发布，能满足本 finding 的进程成功 ACK/立即重开边界。这里不新增“所有文件系统断电安全”承诺；这一限制不能与原先连 write 都未开始的 ACK 缺陷混同。

### 核对的验证证据与交付边界

- `artifacts/final-fix-focused-green.log`：**52/52 PASS，0 FAIL，0 SKIP**。本审查没有重复执行。
- `artifacts/source/http-contract-report.json`：实际隔离 ZTools + CSP Worker，**12 cases PASS**；callback/cancel、typed array 区别、保护文件不上传、目录 JSON 均明确断言。
- `[OS临时目录]/auth-commit.json`：实际 ZTools 41.4.0 配套运行时 + 未修改官方 LX 2.12.6，**7 checks PASS**。包括即时读盘 identity/新授权/撤销、旧 key 拒绝/重配、插件客户端本地 key 和官方服务端一致、免码重连。
- 认证测试在成功响应后直接读盘/重建 manager，再做清理；没有用 dispose/flush 的最终结果偷换成功提交。故障注入覆盖部分临时写、rename 失败、旧写挂起/撤销/新授权、客户端并发 pairing。
- 修复报告列出的 build-runtime 117、build-worker、vue-tsc、diffcheck 为通过；本轮读取代码与回执，未自行重新执行构建。
- 上述 focused host 使用当前开发生产树，回执中的 ZIP 为 null，**不是新 ZIP 的整包验收**。本节没有把之前 `f86ccdfa...` 的全量/用户源结果转移到修复版本，也不预先宣称协调者尚在执行的新 ZIP 全套通过。

**Scoped 最终结论：I1 ADDRESSED、I2 ADDRESSED、I3 ADDRESSED；本 fix 内新增 Critical 0 / Important 0。代码审查 gate 已关闭，允许协调者完成新产物验证与本地交付收尾；没有授权 push/publish。**
