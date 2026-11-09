# V1 历史图片逐项重试日志（v0.33）

本次推进 [技术方案 §6.2.5](TECHNICAL_PLAN.md#62-blob-提交与消费者)：为现有 ZTools preload 历史镜像增加逐图持久 pending/failed 元数据、启动恢复、有界重试和设置状态。源码接线、打包产物验证、真实宿主验收是不同证据层；日期：2026-11-02（北京时间）。最终收据见[本轮证据](validation/v033/v033-root-evidence.json)。

完整目标仍为原方案 G0—G4。本增量不创建另一套系统剪贴板监听器，不替代可信宿主 owner、V2 journal/target CAS、格式统一回贴或跨平台同步。

## 保存顺序与游标

设备隔离的 `MirrorImageRetryJournal` 由真实 `ClipboardRecordStore` 持有，生产 `mirrorHostHistory` 调用它；不是只供测试使用的日志。身份按已有精确 `(host id, timestamp)` 摘要规则关联。

1. 先执行精确清空身份排除、当前轮次隐私检查和已保存记录去重。
2. 对允许处理的图片确认 pending 观察记录。受轮转边界或本轮 16 次失败预算延后的图片仅记录观察，不增加实际尝试次数。
3. 确认 begin/attempt 写入后才读取图片源、准备附件和保存 canonical record。
4. 可识别的图片保存错误写为 failed，原因只能来自既有固定枚举；健康的后续条目仍沿现有路径处理。
5. canonical put 确认后才完成任务。若 canonical 已写成而任务完成确认失败，下轮由 fingerprint 去重确认记录已存在，再移除任务，不重复写 canonical。
6. 只要仍有未解决任务，主历史 cursor 不越过它们。宿主不再返回某个已知任务，不等于该图片已保存或已恢复。

这里的 pending 是一次观察/尝试的元数据状态，failed 是已观察到的固定图片错误，均不表示图片 bytes 已持久化。原始图片始终只从对应历史 item 的路径读取，不使用当前全局剪贴板填补旧记录。

## 数据与容量

日志采用设备 ID 摘要命名空间，与其他设备状态隔离。仅保存 cursor/identity、pending/failed、精确尝试次数和固定原因；不保存 rawItem、图片源路径、图片正文或原始异常。

最多 4096 项，单文档 JSON 上限 1 MiB；写入预算预留宿主 revision 字段空间。容量不足时拒绝新增任务准入，不读取被拒图片的源；已登记任务和健康条目继续处理，最终返回固定容量错误且不推进主 cursor。未知 schema、畸形数据、身份不一致、现有文档损坏超限、插件可见读取错误和未确认写入仍失败关闭，不作为可隔离的准入不足吞掉；不静默截断或丢任务。读/写使用现有 checked DB adapter 和冲突重试。

**宿主读取语义仍是缺口。** 现有 host 可能将内部读取错误折叠为 `null`，其结果与不存在文档无法在插件内可靠区分。上述检查不提供这一场景的失败关闭保证，也不证明跨进程 policy/owner 一致性或宿主枚举完整性。完整修复需宿主提供明确错误语义或可验证读取协议，当前仅修改插件目录的限制下未改宿主。

## 清空与旧任务

清空沿原主窗口 mutation queue 串行。先合并当前 host 可见身份和日志内身份（包括已不在 host 页中的任务），确认设备精确清理 marker；再确认日志清空和图片轮转边界重置；最后才删除 canonical record、可回收的插件附件和当前系统剪贴板。

日志 clear 会在更新时再次检查所有任务均被已确认 marker 覆盖。若并发新增未覆盖任务、marker/日志写入失败或容量超限，停止在删除和系统清空之前。不引入按时间范围排除，也不自动遗忘已有身份。

## 重试与展示

生产协调器使用独立的有界 scheduler；仅主窗口 owner 执行，辅助窗口只向主窗口请求。自动轮次重新读取隐私设置，使用退避及会话预算；清空和卸载撤销旧 timer 和排队工作的许可，旧回调不得在清空后重新启动。

设置展示仅接收 pending/failed/total/capacity 汇总，不向 renderer 暴露任务身份、路径或异常。手动请求只表示“已请求重试”，不当作保存成功；完成状态需重新读取持久日志。读取失败或旧版本缺少接口不当作零任务。

初次请求后最多5轮自动重试，退避1/2/4/8/16秒；截图历史尚未出现时可做最多3次250ms补查，但存在pending时不在5轮之后追加fast轮次。旧频道无参数为截图fast，手动图片重试用固定purpose；未知或多余参数拒绝。源历史或临时图片已经失效时，元数据日志无法重建原图；保留未解决状态，允许用户明确清空，不承诺恢复不曾保存的 bytes。

## 验证与未验收

最终源码清单797项SHA256 `60eda5be280b94accb62279ee3f9b22b753443a92226b69b4c2f7730e74a7b16`。Node24/Electron完整各1439 PASS、6 skips；Node20定向113 PASS。旧实际CJS各11 PASS/9预期FAIL，新图两端各27/27；晋升回开发目录后两端再27/27。ZTools15文件、ATools6文件与已验清单一致，原构建目录已保留。Astra两项数据一致性P2与普通review三项调度/刷新P2均已修复并复核；容量真实重开窄缺口也补齐。浏览器新旧版2/2，原始Playwright JSON及截图已哈希绑定。中间1433/6、22项包测试保留为历史候选。

仍未关闭：已安装宿主/general clipboard/目标应用、宿主静默读取错误、原生双平台 G0、Windows 10/11 105 项和存储基础 15 项、Windows 后续正式版本、完整 G1、统一 V2 planner/publisher、V2 portable/crypto/六方向同步。生产 feature flags 不因这一局部进展开启。


## 诊断证据与继承边界

损坏记录重开测试的初次native close阻塞发生在codec读取前：同步fixture seed的transactionSync回调返回thenable而未等待。合法/损坏对照均复现；改为明确等待checked host-shaped put后保留原损坏+reopen测试，两组均通过。原阶段记录和进程采样保留，不以其他正常重开替代。

第一浏览器尝试因缺少managed Chromium在断言前停止；最终复用系统Chrome156.0.8078.74、Playwright1.61.1的公开mock两场景通过。最终helper即时端口清理检查曾非零，随后wrapper退出和5179端口释放已核实；Playwright自身exit0，两者分别记录。

最终scanner worker和ATools依赖/源码字节与首轮相同，分别继承首轮17项scanner与ATools build/Svelte/package证据，不称最终轮次重新执行。所有详细摘要及原始收据哈希见[根证据](validation/v033/v033-root-evidence.json)。
