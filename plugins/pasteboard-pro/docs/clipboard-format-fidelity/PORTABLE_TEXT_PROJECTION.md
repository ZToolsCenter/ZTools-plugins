# Portable Unicode text 与 projection 候选

状态：插件内组件增量，**未接生产宿主，不构成完整 P1、G2 或 G3 验收**。V2 同步仍关闭；本文不改变现有设计 ADR 或原方案门禁。

## 数据流与边界

`buildPortableProjectionV2` 接收 `readSnapshot` 的 manifest、capture receipt 和 owned raw bytes，以及真实 journal upsert、调用方提供的 vault-scoped opaque aliases、格式选择、预算和 SHA-256 回调。它复核 snapshot/revision/hostEpoch、upsert manifest 摘要与引用、receipt、raw 长度和摘要，再输出 `ProjectionV2` 候选及独立 owned portable blobs；已有 V2 schema 和 projection digest 校验参与组装。

source snapshot 和 revision 是本地标识，不能直接充作 wire 的 opaque 16 字节别名。投影不输出 native format name、source app、路径、SourceURL 或 private raw blob reference；来源关系默认 `undisclosed`。未选择的表示产生脱敏 omission；整项无 portable 表示时该项不进入 items，仍保留 omission；整份快照没有 portable 表示则返回受控错误。文件引用保留 local-only omission，不将本地路径传到 wire。

SHA-256 与 opaque alias 由调用方注入，schema 和 capture receipt 校验均不提供授权，也不证明当前 sync policy。此组件不执行系统剪贴板写入、上传或 target activation；可信 host、当前策略、payload pin、能力目录及用户选择仍需独立实现。

## 格式和预算

严格 Unicode codec 支持 UTF-8 与独立的 `CF_UNICODETEXT` UTF-16LE 解码：拒绝非法编码、孤立 surrogate 和正文 NUL；后者要求一个尾部 UTF-16LE NUL 终止符。保留 BOM 的逻辑值、Unicode 内容和行尾，不作规范化或截断。

当前 builder 的实际源格式白名单仅为 macOS 的 `formatId` 和 `nativeName` 均为 `public.utf8-plain-text`，且选择 UTF-8。UTF-16 codec 可独立调用和测试，但 Windows producer 到 manifest 的映射尚未核实，Windows projection 保持 blocked；其他 P1 格式仍需各自 codec、策略和平台证据，不能以此增量代替。

upsert 的 manifest 摘要使用 store `canonicalJsonV2` 的排序 JSON 规则；wire projection 摘要使用其独立 canonical 编码，两者不可互换。本地 metadata 的 8 MiB 检查仅覆盖 manifest 与 receipt 输入，不等于 store 提交中还包含 fingerprint 的完整预算；wire projection 限 512 KiB 并取调用方已验证的更小值。raw 总量、单文本输入与 portable 输出分别受各自上限和调用方更小预算限制。

## 验证状态

Node 24 独立专项为 **68/68 PASS、0 skip，strict 类型诊断无错误**；包含真实 store capture/commit、journal upsert、重开读取、projection 和 digest 路径，以及本地 lone surrogate 和文件引用的边界。原始产物仅在本地：[专项收据](../../artifacts/pasteboardpro/clipboard-format-g0/v039-projection-tests/focused-result-final-001.json)。早期 run001/run003 有测试夹具错误，不计作产品 RED；有效的六个行为反例和两个资源边界反例修后通过。资源边界中的 generic/private helper 测试不代表合法 store 端到端历史。

独立 Sol 已对本范围源码和具名检查作 LIMITED APPROVE，未发现本范围残余 P1/P2。九项具名产品命令均退出 0；Node 24、Node 20 与 Electron-as-Node 各运行相同的 4 个文件、87 个案例，均为 87 PASS、0 FAIL、0 skip（68 个新增案例加 19 个既有 wire 案例）。两次候选的 867 项源码与依赖 fingerprint 一致。[candidate002 汇总（本地原始产物）](../../artifacts/pasteboardpro/clipboard-format-g0/v039-projection-validation/candidate002/summary.json)

两个顶层 runner 均退出 1：candidate001 因文件排序比较错误，candidate002 在汇总落盘后因 `json.dumps(flush=True)` 输出错误。具名检查证据经独立核对，不能将其写成整条 pipeline 成功；原始失败记录分别保留在 [candidate001](../../artifacts/pasteboardpro/clipboard-format-g0/v039-projection-validation/candidate001/failure.json) 和 [candidate002](../../artifacts/pasteboardpro/clipboard-format-g0/v039-projection-validation/candidate002/failure.json)。这不证明真实 host、Windows、系统 clipboard、目标应用或六个有向跨设备路径。原 G0–G4、完整 P1 和后续 codec 的目标及验收要求保持不变。
