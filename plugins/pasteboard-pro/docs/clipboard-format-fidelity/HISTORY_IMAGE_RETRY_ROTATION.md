# V1 历史图片重试轮转与清空串行化（v0.30 局部修正）

日期：2026-10-28。本文说明 Pasteboard Pro V1 历史镜像的图片失败轮转、清空操作的主窗口串行化及其边界。它是当前实现记录，不代表完整的 V2 存储、系统剪贴板监听或 G0—G4 验收。

## 图片失败轮转

`mirrorHostHistory` 在调用图片 prepare 前逐项执行隐私判断；当前 coordinator 每轮读取一次 privacy 快照，下一轮重新读取。该路径没有策略 revision 与最终写入的原子提交保证。被暂停或被策略排除的项目不会 prepare、不会计入图片失败上限。已有 canonical record 通过 fingerprint 去重；成功保存的文本及图片在后续轮次不会重复写入。

插件把以下可识别的图片持久化失败作为可隔离错误：`image-path-unavailable`、`image-read-failed`、`image-storage-failed`、`image-verification-failed` 和 `image-metadata-invalid`。一轮最多记录 16 次此类失败。达到上限后，本轮不再 prepare 后续图片，但仍继续处理健康文本、其他非图片和后续历史分页。未识别的 prepare 异常、非图片上的图片错误，以及 privacy、host page、database 错误仍会快速中止。

失败轮转位置存放在单个数据库文档 `pasteboard-pro:mirror-image-retry` 中，类型为 `pasteboard-pro-mirror-image-retry`、schema version 为 `1`，只保存 `before: { id, timestamp }` 或空值。它是游标边界，不是失败项目清单：不含图片正文、源路径、错误详情或逐项 payload。

边界比较按 `timestamp`，再按 `id` 字典序比较。下一轮仍先应用 privacy 和 fingerprint 去重；尚未保存且当前允许保存的图片只有在 cursor 严格早于边界时才尝试。边界本身及更新的图片延后到后续轮次。移除边界所指向的 host 项目不会阻断比较，较旧项目仍可继续处理。

一轮结束时，若累计至少 16 次已识别图片失败，就把本轮实际尝试的图片中最旧的 `HostCursor` 写为下一边界。少于 16 次失败则清除边界，包括尾部不足 16 张失败图片的情况；下一次扫描可从较新的部分重新轮转。隐私排除不算失败，不消耗上限。

本轮有图片尚未完成时不提交主历史 cursor。若本轮识别到真实图片失败，返回首个固定图片错误；若只因边界或上限延后了图片、没有真实图片错误，则返回 `MirrorImageRetryPendingError`，`code` 为 `image-retry-pending`，消息为 `Clipboard image retry is pending`。健康文本可以先写入，但它不会令主 cursor 越过待重试图片。所有图片都已保存或被当前 privacy 策略排除后，才清边界并推进主 cursor。数据库边界读写失败也会在推进主 cursor 前中止。

## 边界文档的校验

`before.id` 必须是去除首尾空白后非空、长度不超过 4096 的字符串；`timestamp` 必须是有效有限数值。读入文档只接受已知 `_id`、`_rev`、`type`、`schemaVersion` 和 `before` 字段，且 schema version 必须精确匹配。写入使用新建的 `{ id, timestamp }` 值，不保留宿主对象引用。未知 schema、畸形数据、插件可见的读取错误和未确认的数据库写入回执均失败关闭，不会被当成“没有边界”继续镜像。写成功要求宿主确认 `ok: true`、目标 ID 匹配及有效 revision。

这一校验只能检查插件实际收到的结果。现有 ZTools host API 在某些读取失败路径可能把错误折叠成 `null` 或空结果；插件不能从这种返回值恢复宿主已经丢失的错误信息。V1 的 host 枚举可靠性边界仍未解决。

## 清空操作与窗口 RPC

主窗口把历史镜像和历史清空放入同一 `runHistoryMutation` 串行队列。辅助窗口只能向主窗口发送清空 RPC；没有可用的 parent 通道时直接返回固定错误，不在辅助窗口执行本地清空回退。RPC 使用受限 request ID、无 getter/Proxy 的数据字段读取和规范化结果副本；清空结果只包含非负安全整数 `deleted`、`failed`、`blobFailures`。

**v0.30 历史顺序：**主窗口清空先确认 `setImageRetryBoundary(undefined)` 写入成功，再枚举和删除 canonical records 及可删除 blob，最后清系统剪贴板。重置边界失败时，清空操作会停止，不进入记录删除或系统剪贴板清除步骤。此句保留当时实现与验证的历史记录。辅助窗口 RPC 每个客户端最多 16 个 pending 请求；主窗口最多 16 个 in-flight 请求并缓存最近 128 个 completed replies。30 秒无确认时返回固定超时错误，不自动重发清空请求，因为原请求可能已经完成。

**v0.32 扩展后的顺序：**先有界读取当前可见 host 历史的最大游标及精确 cursor identities；若 source 非空，先确认当前设备的持久清理水位，再重置图片重试边界，删除 canonical records 和未被保留记录引用的插件 blob，最后清系统剪贴板。读取、水位容量或确认失败会在删除和系统清空前停止。水位的字段、回灌过滤顺序与边界详见[历史清空水位](HISTORY_CLEAR_BOUNDARY.md)。

上一段“后续镜像可能重新保存旧行”描述的是 v0.30 尚无清理水位时的限制。v0.32 已扩展为每设备有界持久 identity 集合；同设备镜像在转换记录和准备图片之前，仅跳过清空时实际观察到的精确 `(id, timestamp)` identity，不按 `cursor <= through` 做时间范围过滤。它仍不在 host 侧删除旧历史，也不等同于永久 tombstone；host 分页不稳定、相同 id 与 timestamp 被复用、identity 容量上限及 vault sync 或其他写入路径仍可能使内容重现。单条删除和跨设备永久删除不在该水位的保证范围内，详细限制见[历史清空水位](HISTORY_CLEAR_BOUNDARY.md)。

## 保证范围与未关闭边界

- retry 文档只保存一个边界，不是 durable per-item pending/failed payload queue；不会保存足以重建图片的数据。
- 若 host 剪贴板历史已删除项目，或图片源路径失效，插件无法从该边界恢复图片正文。无当前全局剪贴板 fallback。
- 不承诺自动定时重试；后续轮转依赖现有历史镜像再次运行。
- 轮转只覆盖每次 host page 实际返回、仍在主 cursor 范围内的项目。分页稳定性、host 清理/剪枝及 host 排序变化仍是边界。
- 在 v0.30 范围内，fingerprint 去重只覆盖已成功保存的记录；v0.32 增加了最多 100,000 项的每设备 clear identity marker，但它不是无上限的永久 tombstone 库。
- V1 host 数据库不提供跨 host 写入的原子事务。清空队列不覆盖 vault sync 或其他写入口。

## 实现与验证状态

源码锚点：[镜像轮转](../../apps/ztools/preload/clipboard-history-mirror.ts)、[边界文档](../../apps/ztools/preload/mirror-image-retry-progress.ts)、[清空实现](../../apps/ztools/preload/clear-history.ts)、[主窗口协调器](../../apps/ztools/preload/ztools-history-coordinator.ts)、[清空 RPC](../../apps/ztools/preload/history-clear-rpc.ts)。定向测试：[轮转](../../apps/ztools/tests/history-image-retry-rotation.test.ts)、[边界存储](../../apps/ztools/tests/mirror-image-retry-progress.test.ts)、[清空 RPC](../../apps/ztools/tests/history-clear-rpc.test.ts)。

最终 Node 24.15.0 与 Electron 41.4.0 Node 模式均为 11 个相关文件、91/91 PASS，无 skip；其中轮转 7/7、边界存储 7/7、RPC 9/9。其余覆盖既有镜像/图片/写入确认/清空及窗口投递。6 项类型、构建与契约检查通过。新打包 preload SHA 为 `e8dc8086fd64135666bbc73947969f2a7eef3566619d167e63bf55ca25daa217`，只有该文件在 15 个插件产物中改变，renderer 未重建，store runtime 2 个文件未改未重建。

冻结旧 CJS SHA `59de53a3ec23480be554745cdfe2ee1652b3bf2c61f9f4b784ffd1a20996a761` 在 Node/Electron 的 synthetic SDK 两端均复现轮转与 clear-barrier 缺陷。最终 CJS 两端均通过轮转 25 项检查及清空队列 17 项检查：第 17 图可保存、主 cursor 在未完成时保留、恢复后仅保存一次；受控 host barrier 释放前 clear 保持 pending，释放后镜像失败先结束，再完成 clear。8 份新红绿进程收据均有预期退出码、空 stdout/stderr 和确认终止；RSS 是采样观察，不是硬限额。此前 scanner/preload/image/isolation 两端各 17/6/10/7 项也通过。

这些是实际打包 CJS 图配合合成 SDK、受控公开图片/文件故障的证据，未验证安装版宿主、真实跨窗口 IPC、general clipboard、Windows 或目标应用。独立只读 source review 为有限范围 APPROVE，reviewer 未运行测试。首次既有 preload smoke 因新增主窗口清理通道而触发旧 exact-channel 预期失败；更新 primary-only 预期后两端 6/6 通过，过程记录保留。

具体源码、产物、执行收据与限制见[根证据](EVIDENCE_INDEX.md#v030)和[独立审查](EVIDENCE_INDEX.md#v030)。

本轮未重跑 v0.28 全工作区 1298 项；Windows 15 项基础探针及 105 项 G0 原生用例仍为 NOT-RUN，完整 G0—G4 尚未验收。v0.26 Node journal timing 正文仍不可恢复，本轮未补造或替代该证明。未提交、推送或发布。
