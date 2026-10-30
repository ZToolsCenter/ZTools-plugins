# V1 历史清空水位与回灌抑制

日期：2026-10-28。本文记录 Pasteboard Pro v0.32 在插件侧实现的历史清空边界。它针对“清空后，下一次 host 历史镜像又把旧记录导回”的路径；不代表完整的 V2 存储、操作系统剪贴板事务或 G0—G4 验收。

## 问题与适用范围

Pasteboard Pro 会从 ZTools host 提供的历史分页读取记录。清空 canonical records 不会删除 host 保存的历史行。此前，镜像主游标停在旧失败图片之前时，清空可能删掉已经写入的文本；下一次镜像仍会再次读到这些行并重新导入。失败图片即使尚无 canonical record，也可能在清空后被后续镜像保存。

v0.32 在清空时读取当前可见 host 历史，并为每条行建立精确游标 identity。后续镜像只跳过清空时实际观察到的 identity，而不是把 `through` 当成时间范围上界。这样既抑制已删除的 canonical 记录和未落库失败图片，也不会因为新行与旧水位处于同一毫秒就把新行一并滤掉。

## 清空前读取 source 水位

`readHostHistoryClearBoundary` 使用 host 的只读 `getHistory(page, pageSize)` 接口分页，仅处理返回 DTO 的 ID 和时间戳；不主动读取正文、图片字节、额外来源信息或异常详情。宿主返回的完整 DTO 仍可能包含其他字段。默认每页 100 条、最多 1000 页；单页上限 500 条，页数上限 1000。超过读取预算、返回页结构无效、游标无效或插件可见的读取异常时，返回固定错误并停止清空流程。

每条可见历史行只提取 `{ id, timestamp }`。identity 编码为 `sha256(JSON.stringify([id, timestamp]) UTF-8)`，不含剪贴板内容或来源元数据；完全相同的游标只保存一次。`through` 取全量读取结果中的 `compareCursor` 最大游标：先比较 `timestamp`，再按 `id` 字典序比较。最大游标的 identity 必须同时存在于 identity 集合中。

每设备 marker 最多保存 100,000 个不同 identity。source 扫描遇到第 100,001 个不同 identity 会按读取超限中止，清空不会继续删除。整个读取有界，但分页期间 host 历史若发生插入、删除、排序变化或总量变化，读取结果不构成同一时刻的原子快照；被分页跳过的行不会进入 identity 集合。

若读取确认为空，函数返回 `undefined`，清空流程不会写入水位文档，也不会降低已有水位。host 将读取错误折叠为合法的空页 `{ items: [], total: 0 }` 时，插件无法区分该结果与真实空历史；这种情况下也没有新的可确认 source 水位。明确返回的 `null`、畸形页和异常会按读取失败处理，不继续清空。

## 每设备持久水位

水位存在 ZTools 插件数据库的一份文档中，文档 ID 为：

```text
pasteboard-pro:history-clear-boundary:<sha256(deviceId UTF-8)>
```

文档类型为 `pasteboard-pro-history-clear-boundary`，`schemaVersion` 为 `1`。正文只包含 `deviceIdHash`、`through: { id, timestamp }`、`clearedIdentities`，以及数据库需要的 `_id`、可选 `_rev`。identity 是 64 位小写十六进制 SHA-256，按字典序严格升序且无重复；明文 device ID 和剪贴板 payload 不写入该文档。每台设备使用各自的 hash ID 与独立 marker。

`through` 只记录历史扫描的最大游标，供诊断和比较使用；镜像不得据此将整个较早时间段过滤。推进 marker 时用 `compareCursor` 保留较大的 `through`，并把当前已确认 identity 与新扫描 identity 做集合并集。并发冲突后会重新读取当前文档，再合并两侧集合，因此不会丢弃并发写入的 identity，也不会降低 `through`。

集合超过 100,000 个 identity 时，推进失败并返回固定错误 `History clear boundary capacity exceeded`；不截断集合、不写部分 marker。清空流程因此会在重置 retry 边界、删除 canonical records 和系统清空之前停止。100,000 是 V1 硬上限，不是可无限增长的归档或 tombstone store。

写入只有在数据库返回与文档 ID 匹配的正向确认及有效 revision 后才算成功；最多重试三次冲突。无确认、读取错误或损坏文档都会失败关闭。

读取和写入都校验固定文档 ID、类型、schema、设备 hash、游标和 identity 集合。额外字段、缺失字段、错误设备 hash、无效游标、格式错误的 identity、未排序/重复集合或集合为空，都返回固定错误，不会退化为“没有水位”。`through` identity 必须在集合中。游标保留有效的有限数值时间戳，包括小数，不会四舍五入。

## 清空顺序与镜像过滤

主窗口将清空和历史镜像放在同一 `runHistoryMutation` 队列。当前清空操作依次执行：

1. 有界读取当前 host 历史并求最大游标；读取无效或超出预算时停止。
2. 若 source 非空，推进并确认当前设备的持久水位；未确认时停止。
3. 重置图片重试边界并确认写入；失败时停止。
4. 删除本地 canonical records，并删除不再被其他保留记录引用的插件 blob。
5. 调用系统剪贴板清空接口，并返回 canonical 删除失败数与 blob 删除失败数。

镜像启动时读取一次已保存的 snapshot，对已校验排序的 `clearedIdentities` 做二分查找，避免再创建一份大 Set。对每个 host 行，先提取游标、计算精确 identity；若该 identity 在集合中，则在 `normalizeHostClipboardItem`、隐私策略、fingerprint 查询及 `prepareRecord` 之前跳过该行。因此清空时尚未形成 canonical 记录的图片也会被抑制。只有被清空扫描实际观察到的游标对会被过滤；相同毫秒但 ID 不同的后续复制不会因 `through` 而被误滤。

精确匹配的旧行不会推进主历史游标。这样同一分页中被排除的旧行不会把主游标推高，遮住排序更靠后的新副本。未匹配 identity 的新行仍经过原有主游标、隐私、fingerprint 和图片重试流程。

队列只序列化插件主窗口中使用该协调器的镜像与清空操作。它不能阻止外部应用在 source 读取、水位确认和系统剪贴板清空之间继续复制内容，也不能使 host 历史读取、插件数据库写入和 OS 剪贴板操作成为一个原子事务。删除失败会在结果中计数；它不回滚已确认的水位，且不能保证本轮所有 canonical records 或 blob 均已删除。

### 失败时序

| 失败点 | 当前流程行为 |
| --- | --- |
| host 读取异常、页结构/游标无效或超过读取上限 | 在写水位、重置 retry 边界、删除记录和系统清空之前失败。 |
| source identity 扫描超过 100,000 项，或 marker 并集超过 100,000 项 | source 返回 `history-clear-source-over-limit`，并集超限返回固定容量错误；不写部分 marker、不继续删除或系统清空。 |
| 非空 source 的清理水位写入无正向确认 | 不继续重置 retry 边界，不删除 canonical records，不清系统剪贴板。 |
| retry 边界重置未确认 | 保留此前 canonical records，不执行后续删除或系统清空。已确认的清理水位保持不变。 |
| canonical 删除或 blob 删除部分失败 | 返回失败计数并继续到最后的系统清空调用；水位不会回滚，残留内容之后仍可能由其他写入路径重新出现。 |
| 系统剪贴板清空调用抛错 | 此时前面的数据库删除可能已经完成；流程没有跨数据库与 OS 的回滚事务。 |

`readHostHistoryClearBoundary` 对分页设置有预算上限，防止异常 host history 使清空前读取无限循环。默认总预算为 100,000 条；source 页数/总量或 identity 容量超限时，按 source 读取失败处理，不以已读部分水位继续清空。

## V1 边界与未覆盖情形

- `through` 使用 `{ timestamp, id }` 排序，不是 host 单调递增的 `sourceSeq`；它只是最大游标参考，不参与镜像排除。时钟回退会让这个参考顺序不等于真实复制顺序。过滤依据是精确 `(id, timestamp)` identity；若 host 复用完全相同的 ID 和时间戳，新的行仍会与已清空行无法区分并被抑制。
- 主镜像游标仍按 `(timestamp,id)` 排序；若清空前的主游标已经越过新行，新行仍可能被原有游标去重逻辑过滤。精确清理身份不能修复这一 V1 缺口。
- host 分页采用 offset/page 读取，读取期间发生插入、删除、排序或总量变化时，扫描可能遗漏行或与清空时刻不一致；遗漏的行不在 identity 集合内，之后仍可能回灌。明确 `null` 会失败关闭；host 若把读取错误折叠成合法空页，插件无法区分它与真实空历史。
- 每设备 identity 并集最多 100,000 项。超过硬上限时后续非空 source 清空会停止，要求后续设计提供可安全回收的 marker 或 host source sequence；当前实现不会静默截断历史 identity。
- 100,000 项 identity 单文档约 6.7 MB；每轮仍需读取、验证及复制 marker。主游标落后或时钟回拨时，旧行还可能使镜像反复扫描多页。二分查询避免了额外 Set，但没有消除这些开销；真实宿主 IPC 容量和延迟尚未验收。
- 该边界只约束当前设备的 host 历史镜像。它不是逐条 tombstone，不解决单条删除后回灌、跨设备 vault sync 重新导入或跨设备永久删除。
- 水位不提供 OS 当前剪贴板与 host 历史的共同事务；source 读取后到 `systemClipboard.clear()` 前发生的外部复制可能被系统清空，但若其游标 identity 不在扫描集合内，后续仍可能被镜像导入。
- 如果 host 在保存历史前已经丢失 RTF、HTML、图片或其他格式表示，水位只保存游标，不能恢复此前丢失的格式内容。
- 当前没有 Windows 10/11/12 环境；Windows 基础探针 15 项与 G0 原生用例 105 项为 `NOT-RUN`。G0—G4 均未验收。

## 实现与验证证据

实现锚点：[source 边界读取](../../apps/ztools/preload/host-history-boundary.ts)、[每设备水位存储](../../apps/ztools/preload/history-clear-boundary.ts)、[清空顺序](../../apps/ztools/preload/clear-history.ts)、[镜像过滤](../../apps/ztools/preload/clipboard-history-mirror.ts)。定向测试：[source 读取](../../apps/ztools/tests/host-history-boundary.test.ts)、[水位持久化](../../apps/ztools/tests/history-clear-boundary.test.ts)。

最终相关回归为 15 个文件，Node 24 与 Electron Node 各 **157/157 通过**；其中存储 9 项、reader 26 项、clear replay 9 项。类型、构建及契约检查 6 项通过。真实 LMDB fixture 完成 100,000 identity 写入、重开相等及超容量拒写；计时仅为合成 fixture 结果。

同一 harness 与 fixture 对冻结 v0.31 CJS 和本轮 CJS 分别做红绿对照：Node/Electron 两端旧包均按预期失败，本轮包各 **35/35 通过**，包含旧行独立重扫、旧图片恢复、新同毫秒低字典序 ID 和时间回拨的新副本。fixture 对成功与失败的源图片读取均计数，且从未读取真实系统剪贴板。VM 合成平台固定 Linux；这不构成已安装 ZTools、macOS/Windows 原生剪贴板或目标应用验收。

关联记录：[v0.32 根证据](validation/v032/v032-root-evidence.json)、[v0.32 独立审查](validation/v032/v032-independent-review.json)。主 Agent 在根证据中绑定最终源码、产物、测试收据及文档审计。

本轮实现、文档、构建和验证输出仅写入插件目录；未修改 ZTools host、未提交、未推送、未发布。Windows 环境缺失与 G0—G4 未验收状态保持开放。
