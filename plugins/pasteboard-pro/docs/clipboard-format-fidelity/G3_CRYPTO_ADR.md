# G3 V2 vault 加密、控制与恢复 ADR

**状态：ACCEPTED DESIGN / NOT IMPLEMENTED（限定安全设计复审通过）。** 本文为已通过限定复审的设计，不表示算法实现、known vectors、宿主密钥隔离、Windows 运行、同步能力或 G0–G4 已通过，也不构成宿主或根 CI 写授权。关联 [技术方案 §8–9](TECHNICAL_PLAN.md#8-安全隐私与预览)、[portable 契约 §5–6](V2_PLANNER_PORTABLE_CONTRACT.md#5-portablesnapshotprojectionv2-候选与接收) 与 [实施 ADR §7](IMPLEMENTATION_ADR.md#7-账号vault-和显式授权)。原 P1、Win10/11 及 G3 六方向不缩减；`formatSyncV2` 保持关闭。

## 1. 目标和威胁边界

V2 与 V1 使用独立 `PasteboardPro/v2` namespace、wire、密钥域和凭据槽。网络/远端存储可读、篡改、重放、删除、分叉对象；加密和认证检测篡改及跨 scope 替换，本地可信 checkpoint 检测已见控制版本的回滚/分叉。远端可拒绝服务、观察长度/操作时序和明文 header 的 opaque 标识；首次设备没有可信 checkpoint 时无法凭远端 HEAD 证明新鲜性。已持有明文、密码或 root 的受信设备一旦被攻破，协议不能保证其内容保密，也不能追回已泄露内容。

现有 [V1 crypto-contract](../../packages/sync-protocol/src/crypto-contract.ts)、[node-crypto](../../packages/sync-protocol/src/node-crypto.ts) 固定 `VAULT_VERSION=1`、scrypt N=32768/r=8/p=1、至少 16 字节 salt、AES-256-GCM 12 字节 nonce/16 字节 tag，直接由密码派生对象密钥；现有 V1 envelope/descriptor、密钥、凭据槽和索引均不作为 V2。V2 不是向 V1 增加 optional 字段；不自动迁移、覆盖 V1 或声称旧客户端可读。V1 旧数据保持原有处理和备份，任何未来迁移须单独授权、inventory 与验证。

## 2. 原语、密码和 root

- Suite 标识固定 `PBV2-A256GCM-HKDF256-SCRYPT1`：AES-256-GCM、96-bit IV、128-bit tag；HKDF-SHA256、SHA-256、HMAC-SHA256。每个 vault epoch 的 root 由可信宿主 CSPRNG 独立生成 32 字节；不得由账户 ID 或密码直接充当 root。
- `syncPassword` 独立于 WebDAV 登录密码。严格将 Unicode scalar 序列编码 UTF-8，不做隐式 Unicode 规范化，拒绝孤立 surrogate，最多 1024 UTF-8 bytes；新密码最少 16 scalar 为候选交互规则，须产品/可用性验证，不代表密码具备特定熵。解锁时不得静默修改用户输入或把最低长度用于拒绝既有合法密钥材料。
- 密码包装使用 scrypt 固定 `N=131072, r=8, p=1, dkLen=32`，每次新包装独立随机 32 字节 salt，`maxmem=192 MiB`。先严格验证固定参数、salt 长度、总输入/输出预算，未知或超预算在 KDF 前拒绝；受监督 helper 全局单并发，UI 主线程不运行 KDF，限制时间/内存并在取消后确认退出。参数只是候选；各目标平台实际 RSS、耗时、终止能力未测前不得广告。离线攻击者仍可猜测弱密码，scrypt 不保证高熵。
- 每个新 vault 必须生成独立随机 256-bit recovery secret 和 §5 的 RecoveryPackageV2 离线秘密文件；包同时含独立 admin 私钥与可信锚点，丢失时密码可解当前 root 但不能凭空恢复 admin 权限。明确提示包等同解锁与管理权限，用户确认保存后才可首次启用。密码和可用恢复材料均丢失时不可恢复；不得静默 reset 或覆盖旧 vault。材料安全转移 UX 须验证，确认点击不能证明用户真的保管。

## 3. Writer 域、每次 seal 和 nonce

admin 为每个 epoch 生命周期内最多签发 32 个 `writerDomainId`，包括所有已撤销或退役域，不得删除旧域再添加以绕过上限；满额只能新 root/epoch，普通密码重包不能重置。每个为可信 host CSPRNG 独立生成的 256-bit canonical base64url。仅本 root 的唯一创建管理实例经 admin 显式授权并签入 ControlV2 后可用于普通数据；§5 bootstrap-prepare 仅为构造新 signed control 允许受限预留和 seal。普通 root 持有者不能自行注册。每个 domain 在可信 host 的本地 durable 状态中从 0 单调预留 seal counter，上限 2^32 次；加密前持久预留，失败、崩溃或结果未知也消耗，已预留号不能回退或复用。domain 的记录与安装身份绑定；状态未知、丢失或疑似回滚时该 domain 停写。重启、密码重包不清零；普通 reader 重装、OS 备份恢复或克隆须由原唯一管理实例显式签发新 domain，管理实例自身恢复则必须新 root/epoch。超过 32 个须经 admin 创建新 epoch。这里依赖本地 durable counter 未被用户回滚或克隆的支持假设；回滚/克隆不属于支持的旧 domain 恢复路径，须按上述身份规则重新注册。不能检测的恢复环境不得继续旧 domain；硬件防回滚尚未实现或验证。锁/存储崩溃语义须实测。

每个新 seal 独立产生 CSPRNG `attemptId` 32 bytes 与 IV 12 bytes，调用方不能指定。一次 attempt 对其派生 key 只 encrypt 一次；重试只可重发完全相同的完整密文，输出丢失/未知则废弃已消耗 counter 并用新 counter、attemptId、key、IV。host 拒绝检测到本地域重复；不宣称随机值绝无碰撞。每 domain 最多 2^32 次 seal；每接收设备对所有来源 domain 的验证持久累计最多 2^32 次（包含失败及未知），达到上限则该设备停止该 epoch 验证，不因解锁或重启清零；每 session 连续 32 次认证失败即锁定并需显式用户解锁，不自动重试或解锁，该速率门槛不能替代累计上限。每消息加密明文绝对不超过 200 MiB，AAD 包含至多 4 KiB header 及固定 framing，实际取所有链路 verified limits 更小值；失败验证与消息 cap 需标准合规审查和平台证据。

HKDF-SHA256 extract+expand 的 salt 固定 32 个零字节、output 32 bytes，info 为 RFC 8785 JCS UTF-8 数组 `["PasteboardPro/v2",suite,model,purpose,accountBindingId,vaultId,keyEpoch,writerDomainId,objectType,objectId,revision,attemptId]`。所有随机字段 canonical base64url 无 padding。对象 IKM 为当 epoch root，purpose=`object-seal`；密码 wrapper IKM 为 scrypt 输出、purpose=`password-wrap`，recovery wrapper IKM 为 recovery secret、purpose=`recovery-wrap`。wrapper 也使用已授权 writer domain 与独立计数、attempt、IV。除 §5 明确的 bootstrap-prepare 外，新授权域必须提交并耐久保存 admin 签名的 control 才能使用；不可把普通 owner 的 root 访问当作 admin 授权。

在每个相同 root 的诚实唯一管理实例模型和每 root 生命周期最多 32 域假设下，每域 2^32 次，合计 q≤2^37；仅在 CSPRNG 独立及 HKDF 作为 PRF 的假设下，256-bit attempt/key 输入碰撞 birthday 上界约 q²/2^257 ≤2^-183，这是候选分析，不是安全证明；各 derived key 单次加密并另生成 IV，进一步降低 key/IV 复用风险。域作为 info 的分离输入，签名列表防服务器伪造域；恶意服务器仍可隐瞒或分叉 HEAD，已授权恶意设备或 root 泄漏不在当 epoch 保证内。不要求恶意 WebDAV 提供全局串行 allocator，也不把 NIST 的同 key 调用限制当 root 调用次数。

## 4. 对象 wire 和严格上下文

二进制 container 为 ASCII magic `PBV2`（4 bytes）`|| u32BE(headerLength) || headerBytes || ciphertext || tag`，tag 固定最后 16 bytes；headerLength 为 1..4096，body 长度由 `plaintextLength` 和实际总长度一致性验证。header 是严格 RFC 8785 JCS UTF-8 JSON：拒绝非法 UTF-8、重复键、未知/缺字段、非 canonical 编码，重新序列化与原 bytes 逐字节相等。先检查有限长度、schema、标识与 suite 再分配或 KDF；超限 typed reject，不截断成功。`AAD = magic || u32BE(headerLength) || headerBytes`，包括每个字段。

header 固定字段，全部必需、无附加字段：

| 字段 | 候选编码和约束 |
| --- | --- |
| `wireVersion`, `suite`, `model`, `purpose` | `2`、上述 suite、`portable-snapshot-v2`；purpose 是 `object-seal`、`password-wrap` 或 `recovery-wrap`。 |
| `accountBindingId`, `vaultId` | host 已绑定的随机 opaque 128-bit ID，canonical base64url 无 padding；不使用邮箱、URL、用户名或原生路径。 |
| `keyEpoch`, `revision` | 无前导零 U64 decimal 字符串，范围 `0..18446744073709551615`；不同 epoch 不比较隐含大小以代替已验证控制链。 |
| `objectType`, `objectId` | 类型 enum `projection | blob | index | tombstone | keyring | root-wrap`；objectId 为 host 生成的 128-bit canonical base64url opaque ID。包装固定 type=`root-wrap`，不得让 renderer 传入路径或选择原生格式。 |
| `writerDomainId`, `attemptId`, `nonce` | domain 和 attempt 各 32-byte、nonce 12-byte canonical base64url；由 host CSPRNG 产生，domain 须经 admin 签名注册；仅 §5 限定 bootstrap-prepare 可在签名前预留。 |
| `plaintextLength` | U64 decimal 字符串；等于 ciphertext 长度，绝对不超过 200 MiB，受操作端到端 verified limits 及 GCM 限制的最小值约束。 |
| `wrapParams` | 仅 root-wrap 必需：password 为严格 `{kind:"password",kdf:"scrypt",N:131072,r:8,p:1,dkLen:32,salt:<32-byte base64url>}`；recovery 为严格 `{kind:"recovery",kdf:"hkdf-sha256"}`。非包装对象禁止此字段。 |

接收方从可信 package/本地 checkpoint 或经验证的 signed control、可达 publication 和认证 index 得到 expected scope/epoch/type/ID/revision/digest 并逐项比较；对 nonce/attempt 等随机字段先做有界解析，再用 AAD/tag 验证，不能假装调用方事先知道。路径从可信 descriptor 确定；不能用未可信 envelope 自行授予 account/scope/type/epoch。明文 digest、sourceCursor、原件私有名及内容只在认证加密 body，绝不放在 header。AAD 包括 IV 和所有包装参数，故篡改会认证失败；解锁前读取固定 scrypt 参数只是有界运算准备，不使未认证控制数据可信。

### 4.1 加密 body 候选 schema

`projection`、`index`、`tombstone` 明文均为 strict JCS UTF-8 JSON，不接受重复/未知字段，认证成功后再解析；`bodyVersion` 固定 2。portable 身份字段使用 host 签发并持久映射到 core 源身份的 canonical 128-bit opaque alias；不得将原 core identifier 直接假定为此编码。cursor 的 epoch 使用 host 原有严格 identifier，sequence 为 U64 decimal；哈希固定 SHA-256 小写 hex。数组与全部编码的字节数必须受 verified limits 约束。

- `projection`：严格 `{bodyVersion,projectionId,sourceSnapshotId,sourceManifestRevision,sourceCursor:{hostEpoch,changeSeq},originDeviceId,items,omissions,projectionDigest}`；`items` 按唯一递增 itemIndex 排序，每项严格 `{itemIndex,representations}`；每个 representation 严格 `{representationHandle,portableCodecId,codecVersion,blobId,blobRevision,sha256,byteLength,provenance}`，只引用本投影已批准 portable blob。provenance 是经 policy 明确允许的严格 union：`{relation:"byte-identical",sourceAlias,sourceSha256}` 或 `{relation:"converted",sourceAlias,sourceSha256,codecId,codecVersion}`；不允许披露时仅 `{relation:"undisclosed"}`，不得根据输出 digest 推断 source exact。每个 projection 的 representationHandle 全局唯一，同 item 内保留批准的 source 相对顺序；多个 source 映射到同 target codec 仍为独立身份，不自动合并，由 planner 明确处理冲突与 loss choice。`omissions` 项严格 `{itemIndex,reasonCode}`，reasonCode 为 `unsupported | policy-blocked | local-only | over-limit | unavailable`。`projectionDigest` 对不含自身字段的完整 JCS body 求 SHA-256；来源原始标识、私有引用、路径和 app 信息禁止入体。codecId/version 使用 host allowlist；只有 codec 的严格语义与格式证据通过才可发布。
- `blob`：明文为 `u32BE(metadataLength) || JCS(metadata) || portableBytes`，metadata 不超过 4096 bytes，严格 `{bodyVersion,blobId,blobRevision,byteLength,sha256,portableCodecId,codecVersion}`；长度、digest、expected projection binding 和实际字节逐项相等，不能只信 body 自述。整个 body 的长度包括前缀和 metadata。
- `index`：严格 `{bodyVersion,indexRevision,entries,sourceWatermarks}`，每项 `{objectType,objectId,revision,envelopeSha256}`；objectType 仅 `projection | tombstone`，ID/type 唯一，按 `(objectType,objectId)` ASCII 字节序递增；`sourceWatermarks` 项严格 `{originDeviceId,approvedHostEpoch,sourceSnapshotId,changeSeq,deleted}`，按 `(originDeviceId,approvedHostEpoch,sourceSnapshotId)` 排序且身份唯一，记录每个 retained live head 和 tombstone 的源水位；blob 必须由已认证 projection 引用，不允许索引任意 native/private 对象。envelopeSha256 对完整 container 原 bytes 计算。
- `tombstone`：严格 `{bodyVersion,sourceSnapshotId,originDeviceId,sourceCursor:{hostEpoch,changeSeq},tombstoneRevision}`，无 payload 或本地路径；其 replay 和 target CAS 以已认证 scope、origin 和 approved hostEpoch 为准。

以上为拟冻结 V2 形状，projection/body 规范及 codec 的跨实现一致性须 review 与 vectors；既有 portable 契约所需的来源关联、sourceSeq 和删除水位不因 opaque ID 而省略。仅已知 envelope 的未来单 projection bodyVersion 按 §6 隔离；不得用未受信的 body 去自授 expected context。

## 5. 签名控制、publication root 与恢复

**独立 authority。** vault 创建者以 CSPRNG 生成独立 Ed25519 32-byte seed；admin 公私钥不由 root、密码或 recovery secret 派生。私钥只存在于创建者可信 host 的独立受保护 admin 角色槽和用户保管的 RecoveryPackageV2；普通 root 持有者不得获得。签名操作必须经可信 host 显式授权，不能由可写插件授予。Ed25519 public key 为 32 raw bytes、signature 为 64 raw bytes，均 canonical base64url；fingerprint 为 public key 原 32 bytes 的 SHA-256 小写 hex。信任的公钥来自离线 package 或已有可信设备 checkpoint，绝不从远端 control 的自述建立信任。

**唯一管理实例与恢复。** 每个新 root 独立随机生成 256-bit `rootId` 和 `managementInstanceId`（canonical base64url），二者连同 root 绑定在签名 control 和可信 checkpoint；新 root 必须生成新 IDs，不能经 control 转让管理实例而保持原 root。仅 root 的原唯一创建管理实例在其受保护、未回滚的 durable 管理状态下，可签发该 root 的新域或更新管理状态；正常新 reader 仅由该实例签发域。普通重启可复用未回滚状态；状态 unknown、OS 备份恢复、克隆或新安装导入 admin seed 均不能自动继承原 managementInstance 身份，旧 root/epoch 仅允许恢复读取，不得增发域或修改管理状态。需要写/管理时必须经用户显式恢复：prepare 新随机 root/epoch 和新管理实例→初始化新域集合→签署绑定旧锚点的 transition→导出并确认新包→发布并激活。管理权迁移同样必须新 root。两台诚实管理员从同一旧包分别恢复时，必须各生独立 rootId；即使 epoch 数字相同，rootId 或 control digest 不同即为不同分叉，typed conflict，用户显式选择可信分支，不能把它们视作同一 root 或合并预算。旧 epoch 数据只通过新 root 的 history keyring 恢复读取。此规则依赖不克隆/回滚本地管理状态的支持假设；恶意 admin 或可复制完整运行状态的攻击不在此保证内，不声称物理防克隆或全球最新。

**Bootstrap 例外。** admin 显式授权的一次 `bootstrap-prepare` 可在待注册 domain 持久预留 counter，并仅 seal 32-byte root wrapper 与 history keyring，用于构造唯一一份新 signed control；禁止借此 seal/publish 普通 projection、blob 或 index。失败或未知输出保留 durable intent、消耗 counter，按该 intent 恢复，不复用已用随机性、不伪装普通发布。固定 control 并签名、耐久保存后，该已签 domain 才可 seal 初始 index、构造 publicationRoot；随后条件更新 HEAD、耐久 checkpoint，最后激活。每个未知窗口均先查原 intent 与已存 bytes，禁止盲重包或复用随机性。

**ControlV2 候选。** 严格 JCS UTF-8 `{controlVersion:2,suite,model,accountBindingId,vaultId,keyEpoch,rootId,managementInstanceId,controlRevision,prevControlDigest,adminPublicKey,writerDomains,passwordWrap,recoveryWrap,keyringDescriptor,transition,rootMac,adminSignature}`，大小≤64 KiB。ID/suite 与 §4 一致，`rootId` 和 `managementInstanceId` 为各自随机 32-byte canonical base64url；revision 为 U64 decimal，初始 `"0"` 的 prev 为 null，后续为前份完整 canonical control bytes 的 SHA-256 小写 hex。`writerDomains` 最多 32 条、唯一，按 ID ASCII 排序，项严格 `{writerDomainId,status}`，status 为 `active | revoked`，不得重复分配或删除已登记域；跨 epoch 可新建域。`passwordWrap`/`recoveryWrap` 是完整 immutable container 的 canonical base64url，与 account/vault/epoch 绑定；`keyringDescriptor` 为 null（epoch 0）或严格 `{objectType:"keyring",objectId,revision,envelopeSha256}`。`transition` 为 null（epoch 0/同 epoch 更新）或严格 `{previousEpoch,previousRootId,previousManagementInstanceId,previousControlDigest,previousPublicationDigest}`，绑定旧可信 checkpoint 与新 epoch；不可回到旧 epoch。所有 descriptor 的 hash 是完整对象原 bytes SHA-256。

`rootMac` 为 HMAC-SHA256：当前 root 经 HKDF-SHA256 零 salt、info JCS `["PasteboardPro/v2",suite,model,"control-auth",accountBindingId,vaultId,keyEpoch]` 导出独立 32-byte key，对不含 `rootMac/adminSignature` 的完整 control body 的 JCS bytes 计算；它只确认 root 与控制内容一致，不能替代管理员授权。`adminSignature` 为 Ed25519 对包含 rootMac 但不含自身字段的完整 canonical body 签名，覆盖所有包装、keyring、域、epoch 与过渡；验证使用锚定公钥，不信自述。签名失败禁止 KDF、激活和写入；rootMac 常量时间验证后才使用 root。初始信任来自可信 package/已配对设备，不可循环信任远端 control。

**PublicationRootV2 候选。** 严格 JCS `{publicationVersion:2,suite,model,accountBindingId,vaultId,keyEpoch,publicationRevision,previousPublicationDigest,controlDescriptor,indexDescriptor,auth}`，≤8 KiB。revision 为同一 vault 的单调 U64 decimal，初始 `"0"` 的 previous 为 null，后续为前 publication 完整 bytes 的 SHA-256；controlDescriptor 精确 `{controlRevision,controlSha256}`，indexDescriptor 精确 `{objectType:"index",objectId,revision,envelopeSha256}`。`auth` 是 HMAC-SHA256，以当 epoch root 经 HKDF 零 salt 和 JCS `["PasteboardPro/v2",suite,model,"publication-auth",accountBindingId,vaultId,keyEpoch]` 生成的独立 key 对不含 auth 的 canonical body 计算；该认证证明 root 持有者发布，管理员授权仅来自签名 control。publication 及 control 都要与可信 checkpoint 中 scope、epoch、descriptor 与可达链核对，拒绝不一致。

**索引和发布顺序。** index 是受认证加密的完整保留 live heads 和墓碑/source 水位集合，而不是只有本次差量；每个 source/origin 的 delete 水位持续保留，除非另经独立安全证明的保留/压缩协议可防旧记录复活。reader 从 checkpoint 或已验证可达后继 publication 的 index descriptor 获取期望值，不信服务器自述 descriptor。写入顺序为 durable 加密 blob → projection/tombstone → index → immutable publication root（及必要新 control/keyring）→ 对旧 HEAD 的条件更新 → 确认后本地 durable checkpoint；每步校验 bytes/hash 并幂等重试，结果未知先读取并验证，不盲覆盖。缺附件或失败不激活，不把 bulkDocs 当事务。HEAD 条件更新只处理诚实服务器的并发；恶意服务器可隐藏最新版本、拒绝服务或分叉，checkpoint 只能保证不早于可信锚点及检测所见冲突，不保证全球最新。

**Checkpoint 和离线恢复包。** 本地 checkpoint 绑定 scope、锚定 admin public key、rootId、managementInstanceId、完整 control 和 publication bytes 或精确 descriptor/digest，以及 revision/epoch；同版本不同 hash、较旧、链断、错误签名或 scope 均停写保留证据。新建 vault 必须生成 `RecoveryPackageV2` 离线秘密文件，严格 `{packageVersion:2,suite,model,accountBindingId,vaultId,recoverySecret,adminSeed,adminPublicKeyFingerprint,anchorControl,anchorPublication,checksum}`，总大小≤256 KiB；两个 anchor 仅允许完整 canonical bytes 的 canonical base64url：解码后 control ≤64 KiB、publication ≤8 KiB，严格解析与重编码逐字节一致并计算完整 bytes 的 SHA-256；核对 scope、control descriptor、签名和 publication MAC。禁止 descriptor/snapshot 二选一。checksum 为不含自身字段的 JCS body SHA-256，仅识别误抄/损坏，不能认证恶意修改。导出前验证 seed 所导出公钥的 fingerprint、scope、control 签名、wrapper 与 publication MAC；可信 host 明示包含 admin 权限及解锁秘密，用户保存并确认后才允许首次启用。包的本地离线原件是信任锚，不接受远端 metadata 自授 scope/public key，包本身不得上传或入普通 DB/日志。

仅凭可信 package + 诚实远端：用包中 secret 解锚点 recovery wrapper 得 root，校验 rootMac、publication MAC 和 admin 签名，再验证同一 authority 签署的 control 后继与 publication 可达链，从认证 index 恢复至少锚点仍保留的数据；真实 HEAD 可能被恶意服务隐藏，不能声称最新。远端删除或合法 retention 已移除的内容无法恢复，须明确展示。密码重包保留原 immutable recovery wrapper 时旧包仍可恢复；换 epoch 若未更换 recovery secret，新 wrapper 可解新 root，再解新 root 保护的 keyring 获取保留历史 roots。若换 recovery secret，切换前必须导出并确认新包；旧包遇诚实后继返回 `obsolete-recovery-package`，不得静默 reset。包损坏/丢失或秘密泄漏的提示不包含秘密。

**Root wrapper 和 bootstrap。** wrapperId 为独立 128-bit opaque ID，wrapperRevision 固定 `"0"`，不同包装必须新 ID；controlRevision 不作为 wrapperRevision。明文严格为 32 raw root bytes。purpose/type/params 唯一对应：`password-wrap/root-wrap/password` 或 `recovery-wrap/root-wrap/recovery`；签名 control 直接包含完整 container bytes；可信 descriptor 的 SHA-256 对完整 container 计算并比对，密码更新可保留原 recoveryWrap 原 bytes，无需持有 recovery secret。pre-auth expected scope/epoch/type/ID/revision/digest 只能来自可信 package、本地 anchor 或已验证签名 control；attempt/IV 在有限 schema 内从 header 解析，随后通过 AAD/tag 认证，不假设调用方预先知道。先限额检查参数不等于信任它们；签名确保管理员授权、GCM 验证 wrapper 内容及 AAD、rootMac 检验 root/control 一致，三者职责不可替代。解锁结果统一受控失败，不记录密钥或口令。

**Epoch 切换和泄漏。** admin 显式授权后依上文 bootstrap-prepare 预留 counter，构造唯一目标 control 所需的 root wrappers 与 history keyring；签名并耐久保存 control 后才以已签 domain 生成初始 index 和 publication，条件 HEAD 切换、持久 checkpoint 后才激活新 epoch；崩溃/结果未知回读验证后恢复，不盲写或提前激活。keyring 是新 root 加密的严格 `{keyringVersion:2,accountBindingId,vaultId,keyEpoch,history:[{keyEpoch,root}]}`，≤64 KiB，历史 epoch 唯一、递增、最多 128 项，root 均 32-byte canonical base64url，仅可信 host 解密持有；签名 control 绑定精确 keyring descriptor。新 root 只通过新 syncPassword 或 recovery wrapper 授予被允许设备，不经旧 root 自动分发。切换签名绑定旧 epoch/control/publication checkpoint 和新 epoch/control/keyring/domains；已见 cutover 的设备拒绝旧域新写。离线设备若被恶意服务隐瞒 transition，不能保证即时撤销，也不能据此声称可写新 epoch；旧密文和明文无法追回。

root 或 syncPassword 泄漏时使用 fresh root、新密码和 salt，可保留未泄漏 recovery secret；recovery secret 泄漏时同时换 root/secret，先导出并确认新版包。admin 私钥或整包泄漏时旧 authority 不再可信，停止写入；用户须独立新建 vault/admin 锚点并明确导入/配对，不删除旧 vault、不自动 reset。不得把双 MAC 视为用户授权。跨 epoch 具体恢复故障注入与平台实现未验。

## 6. 密钥生命周期与接收

host 维护 owned key handle，renderer/可写 plugin、日志、普通数据库与网络 payload 不可获得 root、派生 key、密码或恢复 secret；受保护密钥存储槽按规范化 endpoint、host account principal、vaultId 和 epoch 隔离，WebDAV credential 与 V2 vault key 使用不同类型槽，禁止复用 V1 固定槽。endpoint 规范化、平台可信 key-store backend 及迁移行为须先实现并审计；不可因为存密文便声称同 OS 用户恶意代码隔离。账号、policy、授权撤销、lock、退出立即 fence 新操作和旧 generation；中止 worker 后确认 helper 终止再释放 key handle 和必要 payload pin，未知状态保留保护。内存擦除为 best effort；JS、复制与 OS 缓存不保证物理抹除。

下载先对 header/expected context 做有界校验，再在隔离 helper 的内存中执行 GCM 全量认证和 `final`；`update` 的未认证 bytes 不得输出、展示、落盘或交 scanner。tag 验证成功后核验 body schema、明文长度/digest，并在内存执行接收端当前策略及全部必需表示扫描；只有全部通过才允许隔离明文 staging，activation 前在串行临界区重新 fence policy/scope/generation 与 target sourceSeq/CAS。预算不足或无法完整扫描 typed blocked，不借临时明文磁盘绕过。上传依 §5 的 blob→projection/tombstone→index→publication root→HEAD→checkpoint 顺序；不把 V1 bulkDocs 逐项成功当事务。

未知 vault/index/control/root-wrap/envelope 版本或 suite：整轮停止，保留原件、不重写索引。已知 wire/envelope 且仅单个 projection body schema 为未来版本：保留 opaque 密文 quarantine，其他兼容项可按原契约处理；不能解后截字段重写或回写 V1。损坏 tag、错误 scope、重放旧控制、缺附件、策略变化和不可信 source 均不能激活；隐私拒绝不向发送端伪造删除或降级。

## 7. 验证与开放 gate

定向反例：两台诚实管理员 A/B 从同一旧包在恶意 server fork 下恢复时，不能给旧 root 增发域；各自生成不同 rootId/managementInstanceId，新 control 同 epoch 数字也必须产生 typed conflict，由用户选择可信分支。还需验证 bootstrapping 的每个崩溃窗口、未签域无法 seal 普通内容、已持久签名后才能建初始 index，以及 package anchor 非 canonical 或仅 descriptor 必须拒绝。

必须形成可重复、跨实现的固定输入 known vectors：scrypt、HKDF info/JCS bytes、密码和恢复包装、对象 header/AAD/cipher/tag、control 签名/MAC、publication root 与恢复包、keyring digest、合法解密与跨用途/跨账号/跨 vault/epoch 替换失败；测试 duplicate JSON key、非法 UTF-8、非 canonical、超长、未知 KDF 在运行前拒绝、截断/tag 篡改、attempt 重复与 crash 重试。另做密码重包、恢复材料、新设备 checkpoint、并发冲突/回滚/分叉、未知版本 quarantine、当前策略竞争和丢附件。`decipher.update()` 的未认证输出不可逃逸必须有针对性断言。

实机验证 scrypt 峰值、时限、单并发、helper 终止、可信 key-store 和所有平台端到端 verified limits；上限为 adapter、scanner、内存、store、transport 和 crypto 实测能力最小值，不因 store 的 200 MiB 配置推定可支持。原 G3 六方向（Win10↔Win11、Win10↔macOS、Win11↔macOS）逐方向核对 portable bytes、OS clipboard、真实目标应用、断网/重启、策略及密钥恢复；当前全部 **NOT RUN**。Win10/11 是首期必选，Windows 12 等属于 G4，不可用托管 runner、mock 或 macOS 替代。

**设计开放项：** (1) 本地 counter 防回滚/克隆的真实平台支持与失效检测；(2) 恢复包离线保存、可信设备配对和防钓鱼交互；(3) scrypt 成本、KDF helper、key-store 与 scope/endpoint 规范的真实平台数据；(4) 域/尝试碰撞界与 GCM 消息/失败预算的独立密码学审查；(5) 诚实服务器条件 HEAD 更新、unknown 恢复与恶意服务器分叉限制的实现验证；(6) epoch 切换和历史 keyring 的崩溃恢复及保留上界验证。各项决定、风险及故障恢复须经独立安全 review；未关闭相应 gate 不启用依赖能力。设计接受不关闭上述实施和运行 gate，不能以本文或局部单测宣称 G3 通过。

## 8. 标准与源码依据

[RFC 8032 Ed25519](https://www.rfc-editor.org/rfc/rfc8032)、[RFC 5869 HKDF](https://www.rfc-editor.org/rfc/rfc5869)、[RFC 7914 scrypt](https://www.rfc-editor.org/rfc/rfc7914)、[RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785)、[NIST SP 800-38D GCM](https://csrc.nist.gov/pubs/sp/800/38/d/final)、[Node.js 24.15.0 crypto](https://nodejs.org/download/release/v24.15.0/docs/api/crypto.html)。这些资料定义原语或 API，不能证明本候选组合安全、当前宿主运行版本、硬件或平台通过。V1 事实另见 [vault.ts](../../packages/sync-protocol/src/vault.ts)、[sync-config.ts](../../apps/ztools/preload/sync-config.ts) 和 [sync-store.ts](../../apps/ztools/preload/sync-store.ts)。

## 限定安全设计复审沿革

首审提出 4 项 P1、2 项 P2；次审剩余 1 项 P1、2 项 P2；最终定向复审确认剩余三项均已闭合，结论为 APPROVE DESIGN ONLY。最后受审文本 SHA-256 为 `f09de8a145324e9c417b8fe3bc40257b7903d0230c1d8d20e74cf9150a4c784b`，其后仅更新本文状态和复审记录。该结论不代表协议已实现、全部组合安全性已证明或平台已获批准；复审未运行实现测试或平台验收。
