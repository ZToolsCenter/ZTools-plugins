# Native capture wire v1

此协议承载原生 Capture 已拥有的字节，以供 V2 admission；不是持久化格式或已安装宿主 API。本轮 CLI 只接受受监督的固定合成 fixture，使用命名 pasteboard / private window station，禁止读取 general/personal clipboard。来源一律 unknown，不把 owner 或前台应用当 producer。生产监听、请求策略传输与身份认证仍需后续接入。

## Frame

单次 stdout 恰好一个 frame，不混入日志：8 bytes ASCII `PBCAP01\n`，随后 uint32 LE metadata 长度、uint64 LE payload 长度，再跟 metadata UTF-8 JSON 和按 row 顺序拼接的原始 bytes。固定前缀共 20 bytes。metadata 最多 1 MiB；payload 最多 200 MiB；1—1024 rows，每 item 最多 32 rows，itemIndex 0—31 且不递减。同 item 的 nativeName 唯一。先校验完整输入，再写 prefix；I/O 失败视为 frame 失败，不接受半帧、尾部或第二帧。

metadata 必须是与 `JSON.stringify(JSON.parse(text))` 一致的紧凑 JSON：拒绝重复键、额外空白和非 canonical escaping。字段名顺序由 encoder 保持；decoder 不依赖字段顺序。UTF-8 必须严格合法。十进制 revision 必须规范、非负且在 uint64 内；Windows 另限 uint32。expectedRevision 必须等于 capturedRevision；observedRevision 可以不同，绝不能替代 capturedRevision。

```json
{"schemaVersion":1,"requestId":"fixture-v17","platform":"macos","expectedRevision":"1","capturedRevision":"1","observedRevision":"2","captureState":"partial","sourceAttribution":"unknown","policy":{"revision":"fixture-policy-v17","captureAllowed":true,"localHistoryAllowed":true,"cloudUploadAllowed":true},"representations":[{"itemIndex":0,"nativeName":"public.utf8-plain-text","state":"captured","offset":0,"byteLength":5,"sha256":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","fidelity":"exact"},{"itemIndex":0,"nativeName":"example.private","state":"unavailable","reasonCode":"unsupported"}]}
```

captured row 的字段为 itemIndex、nativeName、state、offset、byteLength、sha256、fidelity，及可选 derivedFrom（同 item 中另一条 captured nativeName）。fidelity 只允许 exact/compatible/reference。unavailable row 只有 itemIndex、nativeName、state、reasonCode，原因只允许 unsupported/timeout/over-limit/failed。offset 必须从 0 连续推进，byteLength 可为 0，所有长度的和必须等于 payload 长度。逐 row SHA-256 必须匹配原件。ready 不允许 unavailable，partial 必须至少一条 unavailable；所有 row 不可用时也保持 partial，不能伪造完整 capture。

## Native producer and host consumer

共用 C++ encoder 接收平台 adapter 的真实 Capture 结果，独立于平台 JSON receipt；不把摘要当原件。成功 capture 的 expected/captured/observed revision 和 native preflight capture/local-history/cloud flags分别保留。失败、policy-denied、superseded、over-limit 不产生 payload frame。fixture 的 policy revision 是固定测试请求上下文，不是生产策略请求协议。

Node decoder 在复制 payload 前检查 magic、长度、strict metadata/schema、offset 和总预算，再逐段校验 SHA-256并取得 owned copies。错误只返回固定代码，异常中不包含原文、链接或 nativeName。必须从受信任 helper 的专用 pipe 获得 bytes；framing 和 SHA 不是 helper 身份认证。调用者负责进程 deadline、输出上限和实际退出确认。

Native-format registry 以 platform + nativeName 分类；不使用 MIME、renderer 内容或来源 app 猜测。只为有明确解码依据的格式生成 ScanCodecV2。当前 adapter 将已知原生格式与扫描能力分开：缺少 codec 时保留 captured raw；内容规则开启时由 core 返回 not-scanned 并禁止留存，关闭时才可按 allowlist 策略保留原件。未知格式仍为 unavailable；不把未知 Windows ANSI code page 或 CF_HTML header 当普通 UTF-8。representationKey 在当前 capture 内按 item/row 生成并冻结，原始 rows 不从 admitted 子集中反推。

Host context 提供 attemptId、snapshotId、manifestRevision、receiptId、当前 policy revision 和规则设置，必须与 frame requestId/platform/policy revision绑定。Mapper 只产生 core CaptureContentPolicyInputV2、scanner codecs 与原格式身份；不产生 blobRef、manifest ready、游标或落盘授权。gate 仍在扫描前后读取当前策略；preview/paste/sync 权限保持 false。observed 新版本由监听者另排，不丢弃已一致拥有的旧 bytes。

名称与 policy revision 的长度限额均以 UTF-8 bytes 计：nativeName/derivedFrom 与 policy revision 各最多 512 bytes。fixture v1不携带 Windows ANSI code page、原生 UTF-16 analyzer 证据或完整生产回放元数据，因此不能当作完整的 production replay DTO；不得猜测缺少的解码上下文。当前 CF_HTML 使用已知原生格式选择独立容器 scanner；原生 codec 事实与明确 UTF-16 证据由 [wire v2](NATIVE_CAPTURE_WIRE_V2.md) 承载。

requestId 为 1—128 ASCII bytes，语法 `[A-Za-z0-9][A-Za-z0-9._:-]*`。nativeName/derivedFrom 不能为空、必须是 Unicode scalar sequence，拒绝 C0/C1 控制字符（U+0000—001F、007F—009F）。policy revision 不规范化，但必须包含 JavaScript `trim()` 后的非空内容，拒绝纯空白或纯 BOM。两端使用同一 [ECMAScript WhiteSpace/LineTerminator 定义](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-white-space)。Windows [CF_HTML 有独立容器 header/offset](https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format)，不能将完整容器当作已扫描的普通 HTML；[标准格式定义](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats)不替代实际 Windows 执行。

Mac 外部 UTF-16 只用 BOM 确定字节序，不从末尾 `00 00` 推断终止符。v1未传 native analyzer 的 `nullTerminated` 证据，因此 scanner codec 固定 `termination:none`，遇到 NUL保持 not-scanned；保留 raw bytes，不剥掉可能属于正文的码元。允许尾 NUL 的扫描需后续将该 native framing 证据纳入协议并严格关联原表示。

RTF v0.19 scanner: [RTF privacy projection](RTF_PRIVACY_PROJECTION.md). 脚注、批注、页眉/页脚目的地先按 Microsoft 约定恢复默认字体、清除继承的显式 codepage/隐藏状态；非默认继承 uc 暂不能声明完整。注释辅助目的地 atnauthor/atnid/atndate 的整体结构尚未建模，保持 incomplete，不因孤立组可读就批准。
