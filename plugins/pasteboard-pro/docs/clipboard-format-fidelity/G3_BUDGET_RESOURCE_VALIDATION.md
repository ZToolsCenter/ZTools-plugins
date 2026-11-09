# G3 verification budget：v038 资源验证

状态：**局部实现和测试证据；不是生产或完整 G3 验收**。本记录不修改已接受的设计 ADR；V2 功能开关仍关闭。

启动时使用同一个单调 30 秒预算，覆盖初始审计、跨行关联校验、未完成操作恢复、相关 await 及交付前检查。已由 LMDB 物化的 key/value 可确定的行数、逻辑字节、epoch/security 数量和单行大小，在 JSON 解析及关联索引插入前检查。正常运行期操作不继承启动截止时间。

预算是协作式检查：JavaScript 无法抢占正在阻塞的原生调用；LMDB 可能在返回字符串前分配或扩容。因此这不是硬性 30 秒墙钟或 RSS 上限，也不是断电持久性保证。恢复事务提交前超时应中止；提交或 flush 后发现超时不能声称撤销已提交记录。

## 已有证据及范围

以下 `artifacts` 原始收据仅本地可用，不随仓库提供；可随仓库审阅的摘要见 [v038 根证据](validation/v038/v038-root-evidence-002.json)。

- Node 24 启动与事务专项：17 个案例中 16 通过、0 失败、1 个仅子进程案例在父进程跳过；包含两例真实原生事务回调提交前 SIGKILL。该数字不代表全量套件。[专项收据](../../artifacts/pasteboardpro/clipboard-format-g0/v038-budget-tests/focused-result-final-001.json)
- 资源验证汇总覆盖 10 个不重复案例：100,000 行、4,096 security、4 KiB 单行及 64 active/pending 等实际边界包含公开入口断言；满库和大规模状态包含受控种子，不能等同逐条通过公开 API 生成。`writeRow` 和 `setPending` 测试使用私有接缝。各运行的四个产品源码哈希一致；八个资源运行的 88 文件清单与当前一致，修正后的小规模运行中 `evidence.ts` 后续有差异。[资源汇总与原始运行目录](../../artifacts/pasteboardpro/clipboard-format-g0/v038-resource-limits/final-summary-001.json)
- 4,096 epoch 案例验证 schema 和关联种子；其单 parent、step 0 不构成符合 128 步约束的真实受信恢复历史，真实恢复历史边界仍未验。
- 100,000 行和每行 value 4 KiB 加最长 76 字节 key 的上界约 397.873 MiB，低于 512 MiB；`2^32` 次计数也先受行数限制。两者在合法一致库中不可达，此处仅有算术分析，不声称数据库实测达到。

## 证据完整性和待验证项

初始诊断的缓存隔离存在未知历史状态，不能证明当时共享缓存未受影响；见[隔离评估](../../artifacts/pasteboardpro/clipboard-format-g0/v038-resource-limits/initial-diagnostic-isolation-assessment.json)。v037 四个日志路径写入前的存在性与内容仍为 UNKNOWN，可能发生内容损失，见[事故记录](../../artifacts/pasteboardpro/clipboard-format-g0/v037-nodenext-diagnostic-001/log-path-incident.json)。不推测或恢复未知内容。

[v038 正式回归收据](../../artifacts/pasteboardpro/clipboard-format-g0/v038-final-checks/candidate001/summary.json)记录：原配置全项目 `tsc -b --force`、contract、snapshot 双入口构建与公开运行时导入，以及无 `skipLibCheck` 的严格公开 NodeNext 检查均退出 0。Node 24、Node 20 和 Electron-as-Node 各运行相同的 15 个文件、73 个案例：71 通过、0 失败、2 个仅子进程 fixture 案例在父进程跳过；三端案例和状态集合一致。11 项检查包含 3 项版本检查，860 项源码清单 SHA `3595a5e874516b67c3327276f9fa372f777ec84954c572952db6717317db92a2` 前后不变。此为 budget 相关回归，不是产品全套件；独立的 10 个资源案例不计入各运行时的 73 个案例。Sol 非实施者已对实际源码、测试、日志和子进程证据作限定批准，无本轮残余 P1/P2；结论不覆盖下述未验范围。[v037 历史证据根](../../artifacts/pasteboardpro/clipboard-format-g0/v037-root-evidence.json)仅对应当时的候选。

Windows、可信 host owner/resolver、独立 watchdog、传输和激活、seal/checkpoint、真实应用与六个方向，以及完整 G0–G4 均未完成或未验收。本地专项不证明生产 p95、硬 RSS 上限或硬件断电行为。
