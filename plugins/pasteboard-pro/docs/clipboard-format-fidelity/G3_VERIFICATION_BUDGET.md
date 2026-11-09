# G3 verification budget：当前有限实现

v0.38 当前增量：[启动预算、事务与资源验证](G3_BUDGET_RESOURCE_VALIDATION.md)。项目类型、构建和公共包检查通过；相关回归三运行时各 71 PASS / 2 child-only skips，独立复核限定通过。完整 G0–G4/G3、真实宿主和 Windows 仍未完成；见[本轮证据](EVIDENCE_INDEX.md#v038)。

本轮在插件内提供 verification-only Node LMDB ledger，并接入 V2 crypto codec 的验证预算接口。实施前设计快照 [ADR](G3_DURABLE_BUDGET_ADR.md) 保留当时 NOT IMPLEMENTED/NOT RUN 标签；当前有限实现状态以本文、[索引](EVIDENCE_INDEX.md#v037)和[根证据](validation/v037/v037-root-evidence.json)为准。不是完整 G3、生产可信宿主或跨平台验收。

公开入口为 @pasteboard-pro/snapshot-store/g3-verification-budget，openVerificationBudget(options) 必须显式提供 owner 与 resolver。mode 区分 create/openExisting，绑定 expectedStoreId/expectedInstallId，初始化私有目录和 .g3-init 意图，启动审计持久 schema、计数与身份。Windows 在开库前返回 unavailable。没有可运行的默认授权或 noop owner。

返回 budget.reserveVerification/recordAuthentication，以及 beginAttempt、finishAttempt、promotePreparedRoot、unlockSession、close。budget.reserveSeal/registerAttempt 明确 unavailable，本模块不提供 seal counter、完整 checkpoint/registry 或宿主授权服务。resolver 必须由可信宿主绑定 token 值与操作/单位/作用域、代际和实际 codec 完整结果；复制 lease 对象不产生新权限。

事务采用真实 LMDB synchronous commit 与 flushed 确认，串行队列每次执行时重查 owner。同步 guard 必须返回 undefined，Promise/thenable 不作为授权；异步 Promise 返回被拒绝且不调用任意 then/getter。重入标记使外层不能继续提交；提交结果不确定会 poison 当前实例，已排队及后续工作均拒绝。重开将已计费未完成 reservation/active attempt 转 unknown 并锁定，不回退 used。

一次完整可信 attempt 成功结束才清零失败 streak；单个 signature true 不清零，连续32次认证失败锁定。安全代际稳定绑定，解锁须可信 helper 已终止证明。最多64个 active attempt 逻辑 slot，每slot最多1个pending unit，分别<=64，不是合计128个独立slot。4096 scope/session、100000行、512MiB、4KiB行及2^32验证预算是实现限制，不是本轮极限压力验收。

preparation 先在旧可信 anchor/parent attempt 下计费，验证通过且同attempt无失败/未决、完整chain经可信resolver证明后才允许promote；既有root冲突拒绝。known failed attempt不能晋升。32失败、prepare/promote、queued poison、async guard与commit unknown等反例经普通独立和Astra受影响点复核，当前限定批准无残余P1/P2。

NodeNext兼容修正仅20文件79个相对specifier加.js；其余body字节和三个解析模式的目标相同。原九文件授权修复的历史字节保留，本轮import映射不伪称仍是原字节。最终candidate003验证真实公共包双入口、严格NodeNext类型导入、root tsc、workspace contract与build；三个运行时同73文件568case，562PASS/6个精准fixtureSKIP，14个父进程case实际PASS。完整进程与哈希绑定见根证据。

真实可信owner跨进程锁、resolver/key隔离、current policy、transport、activation、seal/checkpoint/registry、Windows105+15、真实应用与G3六方向仍未实现或未验收。after-reserve SIGKILL不等于事务内部kill、断电、OS owner或反回滚证明；4096/100k/512MiB/4KiB/30s大规模压力未验。所有生产flags保持关闭。

四个日志路径事故：artifacts/pasteboardpro/{build.stdout.txt,build.stderr.txt,nodenext.stdout.txt,nodenext.stderr.txt} 被误重定向truncate后移走，原状态UNKNOWN，无法排除旧日志丢失。未restore或cleanup；诊断empty logs不能证明build/NodeNext成功。最终成功只据candidate003完整process receipts。80份受保护收据与旧根JSON仍原hash，不能外推所有artifacts未变。
