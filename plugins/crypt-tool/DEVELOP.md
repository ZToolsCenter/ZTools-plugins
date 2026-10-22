# crypt-tool 开发指南

本插件运行于 ZTools 桌面端，采用 React 19 + TypeScript + Vite 6，所有 crypto 运算通过 preload 注入 Node.js `node:crypto` 或经审查的标准库完成。

> ⚠️ **实现原则**：禁止手写加密算法实现（包括 Blowfish、SHA、AES 轮函数等底层密码原语）。所有算法必须优先使用 Node.js 内置 `node:crypto` 模块；若内置模块不覆盖（如 bcrypt），需引用成熟的标准 npm 包（如 `bcryptjs`）。这是保证输出与 Python/Go/Java/在线工具等外部实现兼容的唯一方式。

## 目录

- [架构总览](#架构总览)
- [新增一个算法](#新增一个算法)
- [UI 规范](#ui-规范)
- [已有算法清单](#已有算法清单)
- [后续算法计划](#后续算法计划)

---

## 架构总览

```
crypt-tool
├── public/preload/crypt/        # Preload 层：Node.js crypto 封装
│   ├── envelope.js              # ok / fail / tryCrypt 包装器
│   ├── index.js                 # 导出所有算法给 window.services.crypt
│   ├── encoding.js              # Base64 / Hex / URL
│   ├── hash.js                  # MD5 / SHA-256
│   ├── aes.js                   # AES
│   ├── rsa.js                   # RSA
│   └── hmac-pbkdf2.js           # HMAC / PBKDF2
├── src/algorithms/              # UI 层：每个算法三个文件
│   └── <id>/
│       ├── index.ts             # 导出 AlgorithmModule
│       ├── meta.ts              # 元数据（id / label / cmds / teach 等）
│       └── ui.tsx               # React 组件
├── src/registry/                # 算法注册表
│   ├── types.ts                 # AlgorithmMeta / AlgorithmModule / CategoryId
│   ├── algorithms.ts            # 算法数组 + helpers
│   └── categories.ts            # 分类列表
├── src/shared/                  # 公共 UI 组件
│   ├── Field.tsx                # 字段（text/secret/textarea/select）与复制反馈
│   ├── FieldNoteContext.ts      # 字段焦点 -> 右侧边注
│   ├── Icon.tsx                 # 线性图标
│   └── crypt-shell.css          # 整个插件的视觉系统
├── src/shell/                   # 信号台外壳
│   ├── Shell.tsx
│   ├── AlgorithmHost.tsx        # 标题、方向、信号路径与边注容器
│   ├── NotesPanel.tsx           # 右侧边注面板
│   ├── Sidebar.tsx              # 分类索引 + 搜索
│   └── SettingsPage.tsx         # 设置页（开关启停）
└── src/config/
    ├── settings.ts              # Settings 管理（dbStorage 持久化）
    └── features.ts              # syncFeatures() 同步到 ZTools 直达指令
```

---

## 新增一个算法

只需四步：

### Step 1 — Preload

在 `public/preload/crypt/` 新建或扩展 JS 文件，**必须使用 `node:crypto` 或成熟标准库**实现运算函数，返回 `{ ok: true, data }` 或 `{ ok: false, error }`：

```js
// 新文件 public/preload/crypt/chacha.js
const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function encrypt({ key, nonce, plaintext }) {
  return tryCrypt(() => {
    // 参数校验 → fail('...')
    const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce)
    const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    return ok(ct.toString('base64'))
  })
}

module.exports = { encrypt, decrypt }
```

> 校验失败直接 `fail('中文错误信息')`；运算用 `tryCrypt` 包裹。
>
> **禁止**：手写的 S-box、 Blowfish 轮函数、SHA 消息调度等底层实现——此类代码即使能自洽也无法与其他语言/在线工具互通。
>
> **推荐**：
> - 哈希/MAC：`crypto.createHash` / `crypto.createHmac`
> - 对称加密：`crypto.createCipheriv` / `crypto.createDecipheriv`
> - PBKDF2/scrypt：`crypto.pbkdf2Sync` / `crypto.scryptSync`
> - bcrypt：`bcryptjs`（同 API、纯 JS、兼容 C 实现）
> - RSA/ECC：`crypto.generateKeyPairSync` / `crypto.publicEncrypt` / `crypto.createSign`

在 `public/preload/crypt/index.js` 注册到 `window.services.crypt`：

```js
const chacha = require('./chacha')
module.exports = { /* ... */ chacha }
```

### Step 2 — 算法模块

在 `src/algorithms/<id>/` 下新建三个文件：

**meta.ts** — 元数据：

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'chacha',              // 唯一 ID，也用于直达指令 alg:chacha
  category: 'symmetric',     // 分类 ID（categories.ts 中）
  label: 'ChaCha20-Poly1305', // 标签页按钮文字
  title: 'ChaCha20-Poly1305 对称加密', // 页面标题
  reversible: true,          // 是否有解密（有则 Tab 切换加解密）
  cmds: ['chacha', 'chacha20'],   // ZTools 直达关键词
  defaultEnabled: true,
  teach: {
    summary: 'ChaCha20-Poly1305 是现代流密码 + AEAD 组合……'
  }
}
```

**index.ts** — 组合导出：

```ts
import { meta } from './meta'
import UI from './ui'
export const chacha = { meta, Component: UI }
```

**ui.tsx** — 遵循 UI 规范（见下文"UI 规范"章节）。

### Step 3 — 注册

在 `src/registry/algorithms.ts` import 并加入数组：

```ts
import { chacha } from '../algorithms/chacha'
export const algorithms = [ /* ... */ chacha ]
```

### Step 4 — 单元测试

为 preload 函数写 Vitest 测试：`public/preload/crypt/<algo>.test.ts`，覆盖正常路径与错误路径。

---

## UI 规范

所有算法页共用一层「信号台」外壳（`AlgorithmHost`）。外壳负责顶部标题、方向切换、边注栏和滚动容器；算法组件只负责自己的字段、动作和输出，不再各自绘制方向按钮或页面卡片。

### 页面结构

```
[ct-main]
  [ct-head]
    crumb            分类 / alg:<id>
    direction        编码/解码 或 加密/解密（仅 meta.reversible）
    note toggle      打开/收起边注
    title + badges   标题 / 可逆或单向 / 本地运算
  [ct-work]
    [ct-signal]      带信号线的滚动容器
      [ct-tabs]      可选：算法内部模式（如签名/验证、Base58/Base58check）
      [ct-input-zone]
      [ct-actions]
      [ct-output-zone]
    [ct-notes]       右侧边注（窄窗下变为覆盖面板）
```

### 必须遵守的规则

1. **方向只出现一次。** 编码/解码、加密/解密只由 `AlgorithmHost` 顶部渲染。算法 UI 必须读取 `direction` prop，禁止在主体里再放一组方向按钮。算法自身的模式（签名/验证、哈希/验证、变体切换）用 `.ct-tabs`，不要用 `.ct-dir`。
2. **教学说明从 meta 读取。** `meta.teach.summary` 会自动出现在边注里，不需要单独的教学卡片。
3. **字段说明写进 `help`。** 字段聚焦时，`Field` 会把 `label / hint / help` 送入右侧边注；不要在字段下面重复一长段说明。仅在字段需要生成随机值时，传入 `action`。
4. **输出区负责撑开页面。** `Field variant="output"` 会自动使用等宽字体、只读底色和贴底扩展。输出字段保持 `readOnly + variant="output" + copyable`。
5. **一个主动作。** 主按钮用 `.ct-btn-primary`，次级动作（互换、载入示例）用 `.ct-btn-ghost`。主按钮会自动占据更宽的空间。
6. **不要给算法页加外层卡片。** 外壳的 `.ct-signal` 已经是唯一的仪器面板；算法 UI 返回标准的 `ct-input-zone / ct-actions / ct-output-zone` 即可。
7. **换向只属于可逆算法。** 哈希、HMAC、KDF 等单向算法不要提供把结果塞回输入的按钮。可逆算法如果提供「转入解密/解码」，必须同时切换方向、把结果载入输入，并且只在已有输出时出现。

### 算法 UI 骨架

```tsx
return (
  <>
    {/* 可选：算法内部模式 */}
    <div className="ct-tabs">
      <button type="button" className="ct-tab on">签名</button>
      <button type="button" className="ct-tab">验证</button>
    </div>

    <div className="ct-input-zone">
      <div className="ct-zone-label">输入</div>
      <div className="ct-grid2">
        <Field
          label="密钥 Key"
          hint="32 字节"
          help="加密解密共用；右侧「生成」会创建随机密钥"
          value={key}
          onChange={setKey}
          copyable
          action={
            <button type="button" className="ct-inline-btn" onClick={keygen}>
              生成
            </button>
          }
        />
        {/* 其余字段 */}
      </div>
    </div>

    <div className="ct-actions">
      <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
        执行
      </button>
      <button type="button" className="ct-btn ct-btn-ghost" onClick={swap}>
        互换输入输出
      </button>
    </div>

    <div className="ct-output-zone">
      <div className="ct-zone-label">输出</div>
      <Field
        label="结果"
        type="textarea"
        value={output}
        onChange={() => {}}
        readOnly
        variant="output"
        copyable
      />
    </div>
    {error ? <div className="ct-field-error">{error}</div> : null}
  </>
)
```

### Field 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `label` | string | 字段名；聚焦时作为边注标题 |
| `hint` | string? | 行内格式/长度提示 |
| `help` | string? | 字段说明；聚焦时显示在边注里 |
| `type` | text / secret / textarea / select | 默认 text |
| `variant` | input / output | output 使用等宽字体与读数底色 |
| `copyable` | boolean? | 提供复制图标与已复制反馈 |
| `onClear` | () => void? | 提供清除图标 |
| `action` | ReactNode? | 字段头部的行内动作（如生成随机值） |
| `readOnly` | boolean? | 只读 |
| `error` | string? | 字段级错误 |

### 布局与响应式

- 宽窗：侧栏约 200px，主区右侧保留约 220px 边注栏。
- `max-width: 1040px`：字段改为单列。
- `max-width: 1000px`：边注变成覆盖面板；关闭按钮位于面板右上角。
- `max-width: 620px`：顶部工具栏换行，边注按钮收成图标，侧栏缩到 154px。
- 页面高度使用 `100vh`；主区、边注、侧栏各自滚动，不产生整页滚动。

### 主题

- 宿主主色写入 `--blue`，UI 通过 `--ct-accent` 引用；`useZtoolsTheme` 会同步写入 `theme-dark / theme-light` 与 `--ct-on-accent`。
- 不要硬编码彩色背景；面板、输入井、边注的底色必须使用 `--ct-surface / --ct-well / --ct-readout` 等变量。
- 动效只用于按钮反馈与面板开关；`prefers-reduced-motion` 下全部关闭。

## 已有算法清单

### 编码转换（encoding）

| ID | 标签 | 可逆 |
|----|------|------|
| base64 | Base64 | ✓ |
| base58 | Base58 | ✓ |
| safeBase64 | Safe Base64 | ✓ |
| base32 | Base32 | ✓ |
| hex | Hex | ✓ |
| url | URL | ✓ |
| unicodeEscape | Unicode 转义 | ✓ |
| htmlEntity | HTML 实体 | ✓ |
| punycode | Punycode/IDN | ✓ |
| morse | 莫尔斯电码 | ✓ |

### 哈希摘要（hash）

| ID | 标签 | 可逆 |
|----|------|------|
| md5 | MD5 | ✗ |
| sha1 | SHA-1 | ✗ |
| sha256 | SHA-256 | ✗ |
| sha384 | SHA-384 | ✗ |
| sha512 | SHA-512 | ✗ |
| sha3_256 | SHA3-256 | ✗ |
| sha3_512 | SHA3-512 | ✗ |
| ripemd160 | RIPEMD-160 | ✗ |

### 对称加密（symmetric）

| ID | 标签 | 可逆 |
|----|------|------|
| aes | AES | ✓ |
| chacha | ChaCha20 | ✓ |
| des | 3DES | ✓ |
| xorStream | XOR 流加密 | ✓ |

### 非对称加密（asymmetric）

| ID | 标签 | 可逆 |
|----|------|------|
| rsa | RSA | ✓ |
| ed25519 | Ed25519 | ✗ |
| ecdsa | ECDSA | ✗ |
| ecdh | ECDH | ✗ |

### 消息认证（hmac）

| ID | 标签 | 可逆 |
|----|------|------|
| hmac | HMAC | ✗ |

### 口令派生（kdf）

| ID | 标签 | 可逆 |
|----|------|------|
| pbkdf2 | PBKDF2 | ✗ |
| bcrypt | bcrypt | ✗ |
| scrypt | scrypt | ✗ |
| argon2 | Argon2 | ✗ |
| hkdf | HKDF | ✗ |

### 工具与实用（tools）

| ID | 标签 | 可逆 |
|----|------|------|
| uuid | UUID | ✗ |
| crc32 | CRC32 | ✗ |
| adler32 | Adler-32 | ✗ |
| randomBytes | Random Bytes | ✗ |
| jwt | JWT 解码 | ✗ |
| json | JSON 格式化 | ✓ |
| passwordStrength | 密码强度 | ✗ |

---

## 后续算法计划

按类别分组，按实现复杂度和实用价值排列。

### 编码转换（encoding）

- [x] **safe-base64** — URL 安全的 Base64（`+/` → `-_`，可去 `=` padding）
- [x] **base32** — Base32 编解码（RFC 4648，常用于 TOTP 密钥、可读性更好）
- [x] **base58 / base58check** — Base58 / Base58check（比特币地址风格，无 `0OIl` 歧义字符）
- [x] **unicode-escape** — Unicode 转义（`\u4e2d\u6587` ↔ `中文`）
- [x] **html-entity** — HTML 实体编解码（`&amp;` ↔ `&`，`&#x4E2D;` 十进制/十六进制数字实体）
- [x] **punycode** — Punycode 国际化域名（`中文.cn` ↔ `xn--fiq228c.cn`）
- [x] **morse** — 摩尔斯电码（字母/数字 ↔ 长短音，仅编码；中文可用 Unicode 转义）

### 哈希摘要（hash）

- [x] **sha1** — SHA-1（160 位；仍广泛用于 Git 对象 ID，但不应再用于安全场景）
- [x] **sha384** — SHA-384（SHA-384 摘要，与 SHA-512 同族，截断到 384 位）
- [x] **sha512** — SHA-512（512 位摘要，安全强度更高）
- [x] **sha3-256 / sha3-512** — SHA-3（Keccak，与 SHA-2 完全不同的结构）
- [ ] **blake2b / blake2s** — BLAKE2（比 MD5/SHA 快且安全，常用作现代哈希）
- [ ] **blake3** — BLAKE3（并行哈希、极快、可 Keyed 模式做伪 HMAC）
- [x] **ripemd160** — RIPEMD-160（比特币地址生成配套哈希）

### 对称加密（symmetric）

- [x] **des / 3des** — DES / 3DES（历史算法 `des-ede3-cbc`，用于兼容老数据；可用 `crypto.createCipheriv`）
- [x] **chacha20-poly1305** — ChaCha20-Poly1305（现代 AEAD，TLS 1.3 常用；可用 `crypto.createCipheriv('chacha20-poly1305', ...)`）
- [ ] **sm4** — SM4（国密对称加密标准，128 位分组；可用 Node.js SM4 实现如 `@wecom/crypto` 或自行调用 WebAssembly）
- [x] **xor-stream** — XOR 流密码（逐字节/逐字密钥循环 XOR，简单演示用；可用 `Buffer` 实现）

### 非对称加密（asymmetric）

- [x] **ecdsa** — ECDSA（椭圆曲线数字签名；支持 P-256/P-384）
- [x] **ed25519** — Ed25519（EdDSA 现代曲线；密钥短、速度快、抗侧信道）
- [x] **ecdh** — ECDH（椭圆曲线 Diffie-Hellman 密钥协商，双方各取私钥 × 对方公钥得共享秘密）
- [ ] **sm2** — SM2（国密椭圆曲线签名 + 加密）
- [ ] **dh** — Diffie-Hellman（经典 DH 密钥协商，与小素数和大素数域）

### 消息认证（hmac）

- [ ] **hmac-sha512** — 已有 HMAC 已支持 SHA-512，但可新增独立入口默认 SHA-512
- [ ] **cmac** — CMAC（基于分组密码的 MAC，适用于 AES 场景）
- [ ] **poly1305** — Poly1305（通用 MAC，常与 ChaCha20 组合）

### 口令派生（kdf）

- [x] **bcrypt** — bcrypt（自适应成本因子密码哈希，抗 GPU/ASIC，基于 `bcryptjs` 标准库；含自动 salt 生成与验证接口）
- [x] **scrypt** — scrypt（内存困难型 KDF，抗 GPU/ASIC；可用 `crypto.scryptSync` 实现）
- [x] **argon2** — Argon2（密码哈希竞赛冠军；argon2id 平衡侧信道与 GPU 抗性；可用 `argon2` npm 包）
- [x] **hkdf** — HKDF（基于 HMAC 的 KDF，适用于从主密钥派生子密钥；可用 `crypto.hkdf` 或 `@noble/hashes`）

### 工具与实用（tools，新分类）

若实现以下功能，建议在 `src/registry/categories.ts` 新增 `tools` 分类：

- [x] **uuid** — UUID v4 / v7 生成
- [x] **random-bytes** — 随机字节生成（可指定长度、编码 hex/base64）
- [x] **jwt-decode** — JWT 解码（解析 header.payload，不做签名验证）
- [ ] **hash-file** — 文件哈希（用户选文件，计算 SHA-256/MD5 等）
- [ ] **base64-image** — Base64 ↔ 图片预览（logo、小图标嵌入场景）
- [x] **password-strength** — 密码强度估算（zxcvbn or 简易长度+字符集评分）
- [ ] **qr-generate** — QR 码生成（文本 → ASCII-art 或 base64 PNG）
- [x] **json-format** — JSON 格式化 / 压缩（常见文本工具）
- [ ] **jwt-verify** — JWT 签名验证（给定公钥或对称密钥）

### 编码/序列化相关

- [ ] **json-escape** — JSON 字符串转义 / 反转义（`"\"中文\""` ↔ `"中文"`）
- [ ] **csv-escape** — CSV 字段转义（含逗号/引号/换行时加双引号）
- [ ] **quoted-printable** — Quoted-Printable 编解码（邮件 MIME）
- [ ] **percent-hex** — 百分比 + 十六进制（`%E4%B8%AD` + `%u4E2D` 两种变体）

### 校验和 / 指纹

- [x] **crc32** — CRC32 校验和（ZIP、PNG 等协议常用）
- [ ] **adler32** — Adler-32 校验和（zlib 默认）
- [ ] **luhn** — Luhn 算法（信用卡号校验位计算与验证）
- [ ] **fletcher16/32** — Fletcher 校验和（TCP 替代校验）

> 分类标签与 `categoryId` 定义在 `src/registry/categories.ts`，新增分类需在该文件 `CATEGORIES` 数组追加。
