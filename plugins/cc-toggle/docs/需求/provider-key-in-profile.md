# 供应商 Key 迁入 Profile（Node crypto 加密）

## 概述

将供应商的 API Key 从独立的 `dbCryptoStorage` 存储迁入 profile 文档内，与供应商其他配置存在一起，并使用 Node.js 内置 `crypto` 模块（AES-256-GCM）加密存储。

---

## 背景

当前 Key 存储现状：

| 数据       | 存储位置                     | 说明                                   |
| ---------- | ---------------------------- | -------------------------------------- |
| 供应商配置 | profile（`ztools.db`，明文） | `cctoggle_profile_{profileId}`         |
| API Key    | `ztools.dbStorage`（加密）   | key 名 `apikey_{appType}_{providerId}` |

存在的问题：

1. **Key 与配置分离**：Key 存在 `dbCryptoStorage`，键名不含 profile id，导致**不同 profile 中相同 providerId 共享同一个 Key**，无法实现「每个项目独立 Key」。
2. **冗余存储**：同一条 Key 数据分散在两处，读写逻辑割裂。

目标：Key 跟随供应商配置一起存入 profile，同时保证落盘非明文。

---

## 加密方案

### 选型

- **对称加密**：Node 内置 `crypto`，`aes-256-gcm` 算法（自带认证标签，防篡改）。
- **零第三方依赖**：preload 为纯 `tsc` 编译不打 bundle，用内置 `crypto` 避免改构建流程。

### 加密流程

```
写入：
  apiKey 明文
    → AES-256-GCM 加密（key=主密钥, iv=随机 12 字节）
    → 得到密文 ciphertext + authTag + iv
    → 拼接为字符串存入 profile：`v1:{iv_hex}:{tag_hex}:{ciphertext_hex}`

读取：
  profile 中的密文字符串
    → 拆分 iv / tag / ciphertext
    → AES-256-GCM 解密还原 apiKey 明文
```

### 主密钥来源

| 方案                              | 描述                                                                                                       | 安全级别            | 优点             | 缺点                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------- | ---------------- | ------------------------- |
| A. safeStorage 托管主密钥（推荐） | 首次生成随机 32 字节主密钥，用 `safeStorage` 加密后存入 `dbStorage`；每次加密用 safeStorage 解密取出主密钥 | 高（OS 级密钥托管） | 真加密、用户无感 | 依赖 Electron safeStorage |
| B. 固定硬编码密钥                 | 密钥写在代码里                                                                                             | 低（仅混淆）        | 实现简单         | 可被逆向，非真安全        |
| C. 用户口令派生                   | 用户输入口令，`scrypt` 派生密钥                                                                            | 中高                | 跨设备可用       | 需用户每次输入，体验差    |

> **建议采用方案 A**：主密钥本身用 `safeStorage` 加密存储（等价于现 `dbCryptoStorage` 的加密强度），业务 Key 用 Node crypto AES-256-GCM 加密后存进 profile，两者兼顾「存一起」与「真加密」。

---

## 数据结构

### Profile 内新增字段

每个 provider 对象新增 `encryptedApiKey` 字段（替代原先 `dbCryptoStorage` 存储）：

```ts
interface Provider {
  // ...现有字段
  encryptedApiKey?: string // v1:{iv_hex}:{tag_hex}:{ciphertext_hex}，空字符串/缺省表示无 Key
}
```

### 示例

```json
{
  "_id": "cctoggle_profile_default",
  "id": "default",
  "name": "全局默认",
  "providers": {
    "claude": {
      "deepseek_001": {
        "name": "DeepSeek",
        "baseUrl": "https://api.deepseek.com",
        "model": "deepseek-coder",
        "encryptedApiKey": "v1:a1b2c3...:d4e5f6...:0f1e2d..."
      }
    }
  }
}
```

### 加密模块（新增）

新增 `src/preload/crypto.ts`（函数式模块）：

```ts
// 主密钥获取（safeStorage 托管，惰性生成）
getMasterKey(): Buffer
// 加密：明文 → v1:{iv}:{tag}:{cipher}
encryptSecret(plain: string): string
// 解密：v1:{iv}:{tag}:{cipher} → 明文
decryptSecret(payload: string): string
// 旧密文识别（供迁移用）
isCryptoStorageKey(appType: string, providerId: string): boolean
```

---

## 功能需求

### 1. 写入（saveProvider）

`provider-db.ts` `saveProvider()` 改造：

- 收到 `apiKey` 明文后，调用 `encryptSecret(apiKey)` 得到密文，存入 `provider.encryptedApiKey`，随 profile 一起 `db.put`。
- **不再调用** `ztools.dbStorage.setItem(...)`。
- 保留「数据无改动跳过写入」逻辑：比较时需考虑 `encryptedApiKey` 变化（明文 Key 变化 → 重新加密 → 密文变化 → 触发写入）。

### 2. 读取（getProvider / listProviders）

`provider-db.ts` `getProvider()` 改造：

- 从 `p.encryptedApiKey` 读取，`decryptSecret()` 解密后填入返回对象的 `apiKey` 字段。
- **不再调用** `ztools.dbStorage.getItem(...)`。
- `listProviders()` 仍不返回 `apiKey`（避免列表页暴露），保持不变。

### 3. 删除（deleteProvider）

`provider-db.ts` `deleteProvider()` 改造：

- 删除 profile 中该 provider（含 `encryptedApiKey`）即可。
- **不再调用** `ztools.dbStorage.removeItem(...)`。

### 4. 无 Key 场景

- `encryptedApiKey` 为空/缺省 → `apiKey` 返回 `""`，各调用方（`config-rw.ts`、`proxy.ts`）已有空值兜底，无需改动。

---

## 数据迁移

### 迁移时机

preload 初始化时（`DataMigration.migrateAgentPaths()` 内追加），幂等执行。

### 迁移步骤

```
migrateApiKeysToProfile():
  1. 遍历所有 profile 文档（cctoggle_profile_*）
  2. 对每个 provider：
     a. 若 profile 中已有 encryptedApiKey → 跳过（已迁移）
     b. 从 dbCryptoStorage 读取旧 Key：apikey_{appType}_{providerId}
        - 无旧 Key → 跳过
     c. encryptSecret(旧 Key) → 写入 provider.encryptedApiKey
     d. 标记该旧 Key 已迁移
  3. 保存变更后的 profile 文档
  4. 删除所有已迁移的 dbCryptoStorage 旧 Key
```

### 删除旧数据

- 迁移成功后删除旧 `dbCryptoStorage` Key（`apikey_{appType}_{providerId}`）。
- 删除前需确保 profile 中已成功写入 `encryptedApiKey`，**先写后删**，避免数据丢失。

### 迁移校验

- 迁移完成后，`getProvider()` 解密结果与迁移前明文一致。
- 抽样验证：选择任意 provider，比较迁移前后 `apiKey` 值。

---

## API 兼容性

- **API 接口不变**：`listProviders` / `getProvider` / `saveProvider` / `deleteProvider` 签名与返回结构不变，前端无需修改。
- 内部实现变化仅限 `provider-db.ts` 读写 Key 的方式。

### 需同步修改的文件

| 文件                         | 改动                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `src/preload/crypto.ts`      | 新增：加密/解密/主密钥管理                                             |
| `src/preload/provider-db.ts` | `saveProvider`/`getProvider`/`deleteProvider` 改读写 `encryptedApiKey` |
| `src/preload/cleanup.ts`     | 新增迁移方法 `migrateApiKeysToProfile()`，挂到 `migrateAgentPaths()`   |

---

## 边界情况

1. **解密失败**：主密钥不可用或密文损坏时，`decryptSecret` 抛错 → `getProvider` 返回 `apiKey: ""`，并 `console.error`，不影响其他功能。
2. **主密钥丢失**：safeStorage 存储的主密钥被清空时，用 `isCryptoStorageKey` 兜底回读旧 `dbCryptoStorage` Key（兼容期双读双写），下次写入时迁移到 profile。
3. **重复迁移**：`encryptedApiKey` 已存在即跳过，幂等。
4. **同一 provider 多 profile**：迁移时按 profile 逐个处理，每个 profile 的 provider 各自独立加密存储，互不影响。

---

## 合并后影响功能

Key 从 `dbCryptoStorage` 迁入 profile 后，对现有功能的影响分析：

### 1. 供应商 CRUD

| 功能                     | 影响                                  | 处理                 |
| ------------------------ | ------------------------------------- | -------------------- |
| 列表查询 `listProviders` | 不返回 apiKey，逻辑不变               | 无改动               |
| 详情读取 `getProvider`   | 需从 `encryptedApiKey` 解密           | 改读 source          |
| 新增/编辑 `saveProvider` | Key 写入 profile 而非 dbCryptoStorage | 改写逻辑             |
| 删除 `deleteProvider`    | Key 随 provider 一起删除              | 去掉 removeItem 调用 |

### 2. 供应商切换（switchProvider）

- 流程：`switchProvider` → `getProvider`（解密拿 Key）→ `config-rw` 写入 agent 配置文件。
- **行为不变**：只要 `getProvider` 能正确解密返回 `apiKey`，切换逻辑无需改动。
- 代理模式下 `config-rw.ts:430` 用 `provider.apiKey` 判断是否代理转发，解密成功后照常工作。

### 3. 路由/代理转发

- `proxy.ts:_resolveMembers`（`proxy.ts:175`）调用 `getProvider` 拿 `p.apiKey`，daemon 用真实 Key 转发。
- **行为不变**：解密在 `getProvider` 内完成，下游 `proxy-daemon.ts` 无感知。

### 4. Profile 切换（激活/取消激活）

- `activateProfile` 遍历各 appType 调 `switchProvider` → `getProvider`。
- **新能力**：合并后每个 profile 的 Key 独立，切换项目时 Key 跟随 profile 一起切换（现状是不同 profile 共享同一 Key）。

### 5. 导入/导出

- `exportAllProviders` / `importProviders` 基于 `getProvider` / `saveProvider`。
- **行为变化**：导出的 JSON 中 `apiKey` 为明文（现状导出即明文，未变化）；导入时 `saveProvider` 自动重新加密。
- **注意**：导出的 JSON 文件包含明文 Key，安全性由用户保管，与现状一致。

### 6. 连接测试 / 模型拉取

- `testConnection` / `fetchAvailableModels` 使用表单输入的 `apiKey`，不经存储层。
- **无影响**。

### 7. MCP / 技能 / Prompt / Session / 统计

- 均为独立模块，MCP 的 apiKey 属于 MCP 服务器自身配置，不来自供应商存储。
- **无影响**。

### 8. 性能

- 每次 `getProvider` 需解密（AES-GCM 毫秒级）。
- 若出现频繁读取场景（如代理 daemon 启动时批量 resolve），可加内存级解密缓存，本期不做。

### 9. 数据安全（相对现状）

- 现状：`dbCryptoStorage` 由 OS 密钥加密，但 Key 与配置分离、跨 profile 共享。
- 合并后：Key 以 AES-GCM 密文随 profile 存储，主密钥由 safeStorage 托管，加密强度与现状等价，且获得 profile 隔离能力。
- **风险点**：若迁移出错或主密钥丢失，需保留「兜底回读旧 dbCryptoStorage」的兼容路径，见边界情况 2。

---

## 验收标准

1. 新增/编辑供应商时，Key 写入 profile 的 `encryptedApiKey`，落盘数据中无明文 Key。
2. `dbCryptoStorage` 中不再产生新的 `apikey_*` 数据。
3. 迁移后旧 `apikey_*` 数据被清除，`getProvider` 返回的 `apiKey` 与迁移前一致。
4. 不同 profile 中相同 providerId 可配置不同 Key，切换项目后读取到各自 Key。
5. 前端 API 无需任何改动，供应商列表/表单/连接测试/代理转发功能正常。
