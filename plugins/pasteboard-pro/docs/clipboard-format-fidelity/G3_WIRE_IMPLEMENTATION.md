# V2 wire 实施映射（v036 局部组件）

仅 `@pasteboard-pro/sync-protocol/v2` 纯结构模块：RFC 8785 风格 canonical 编码/严格解码、PBV2 frame、header、control/publication/recovery/keyring 和 portable body 结构校验；解析得到的结果都是未受信数据。它不认证签名、MAC、GCM、scope、policy 或 sender，不启用同步，也不实现 host owner、持久化、nonce/counter 或运行验收。签名与摘要及 expected context 须由可信调用方独立验证；摘要回调仅验证字节完整性，不提供授权。

`encodeCanonicalV2/decodeCanonicalV2` 采用 UTF-16 key 顺序直接拼接，拒绝非有限数字、孤立 surrogate、cycle、accessor、sparse array、非常规 prototype、重复/非 canonical JSON；调用方必须给 `maxBytes`，depth/node 另有限额。framing 需显式 `maxPlaintextBytes`，不超过 200 MiB；不把 schema 可接受上限当平台能力。header 4 KiB；blob metadata 4 KiB；control/keyring 64 KiB、publication 8 KiB、recovery package 256 KiB。受保护的 plaintext 不得在 GCM `final` 成功前交给这些 body 校验器。

ADR 未固定的 portable `portableCodecId`、`codecVersion` 及 provenance codec ID/version，此实现保守选用 1–128 ASCII 核心 identifier；`byteLength` 选非负安全整数，历史 cursor 沿用核心 identifier 和 U64 十进制。若跨设备 codec 标准不同，应先修订并评审 wire 版本，不能静默改写已有值。投影的 source/manifest 标识为 host 签发的 128-bit opaque alias，不从 core 源 ID 直接推断。结构层保留 representation 数组顺序和独立身份，不能证明源顺序或策略授权；caller 必须对照可信源映射及 policy。

`parseUntrustedBlobBodyV2` 复制输入并核长度；`verifyBlobBodyV2`、`verifyProjectionDigestV2` 使用调用方提供的可信 SHA-256 对 owned bytes 验证。原 blob 不能被 SharedArrayBuffer 或回调可变视图替换；来源 blob descriptor、投影关系及签名、GCM 验证仍属可信 owner 的责任。`parseProjectionOrQuarantineV2` 只表示已认证密文的后续兼容分流，调用者须先完成认证；未知 control/index/wire 不能用它绕过整轮停止。结构函数不检验 control signature、publication MAC、package checksum 或嵌套 wrapper hash；安全调用方必须验证它们及可信 checkpoint。

此记录不更改 [G3 加密 ADR](G3_CRYPTO_ADR.md) 或 G0–G4。Node crypto、固定向量、集成、Windows 和真实宿主能力各自另取证；无本模块结果可替代它们。

身份与 revision 编码：header 的 `keyEpoch/revision/plaintextLength`、descriptor `revision`、body 的 `blobRevision/indexRevision/tombstoneRevision`、control `controlRevision`、publication `publicationRevision`、keyring 的 `keyEpoch` 和 `sourceCursor.changeSeq` 均为无前导零的 U64 十进制字符串；root wrapper 的 header revision 固定 `"0"`。projection 的 `sourceManifestRevision`、`sourceSnapshotId`、`projectionId`、`originDeviceId` 为独立 16-byte opaque alias，不等同 core 的任意字符串；`sourceCursor.hostEpoch` 使用核心 identifier。`byteLength` 是非负安全整数，与 header 的 `plaintextLength` 字符串不同。Python fixture oracle 若仅覆盖固定 ASCII schema keys 和 safe integers，不得当作通用 JCS oracle。
