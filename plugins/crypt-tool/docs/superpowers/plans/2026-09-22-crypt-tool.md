# Crypt Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a ZTools crypt-tool plugin with a category sidebar, 9 representative algorithms, enable/disable settings, dynamic direct commands, and Node crypto backends.

**Architecture:** Registry pattern — `shell` renders categories/algorithms from `registry`; each algorithm lives under `src/algorithms/<id>/` with meta + UI; crypto runs only in `public/preload/crypt/*` via `window.services.crypt.*`; `config` is the sole writer of `dbStorage` and dynamic Features.

**Tech Stack:** React 19, TypeScript, Vite 6, ZTools APIs (`dbStorage`, `setFeature`/`removeFeature`, `copyText`, `showToast`), Node.js `crypto` (CommonJS preload), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-crypt-tool-design.md`

## Global Constraints

- UI copy, validation messages, and `{ ok:false }` errors: Simplified Chinese.
- Page root must not set `background` / `background-color` (host default only).
- Design for ~40% screen width; sidebar ~180–220px, collapse via CSS only if needed.
- Input/textarea/select surfaces: dark translucent (e.g. `rgba(0,0,0,.28)`), confirmed mockup `layout-sidebar-v2`.
- No encryption libraries in the renderer; only `window.services.crypt.*`.
- Preload envelope: `{ ok: true, data: string }` | `{ ok: false, error: string }`.
- Settings storage key: `crypt-tool:settings` via `ztools.dbStorage`.
- Dynamic feature codes: `alg:<id>`; static main feature code: `crypt`.
- Batch-1 algorithms (9): `base64`, `hex`, `url`, `md5`, `sha256`, `aes`, `rsa`, `hmac`, `pbkdf2` — all `defaultEnabled: true`.
- Remove scaffold features/components: `hello`, `read`, `write`.
- `npm run build` must pass (`tsc && vite build`); `npm test` must pass.

## Review Focus

- Bad decode input (invalid Base64/Hex/URL) → `{ ok:false, error }` in Chinese, no throw (Task 2 tests).
- AES key not 16/24/32 bytes or bad IV → validation error before/at envelope, no crash (Task 4 tests).
- RSA decrypt with wrong key / non-PEM input → `{ ok:false }`, UI keeps input (Task 5 tests).
- Disabling the currently open algorithm → shell navigates to first enabled; all disabled → empty state + settings CTA (Task 9/10 manual + config unit tests for target feature set).
- `dbStorage`/`setFeature` throw → load falls back to defaults; sync failure surfaces toast, app still usable (Task 7 tests with mocks).

---

## File Structure

```
public/
  plugin.json                          # static feature `crypt` only (+ meta fields)
  preload/
    services.js                        # window.services = { ..., crypt }
    crypt/
      envelope.js                      # ok/err helpers + tryCrypt wrapper
      encoding.js                      # base64, hex, url
      hash.js                          # md5, sha256
      aes.js
      rsa.js
      hmac.js
      pbkdf2.js
      index.js                         # module.exports = { base64, hex, ... }
      *.test.ts                        # vitest (node env)
src/
  registry/
    types.ts                           # CategoryId, AlgorithmMeta, AlgorithmModule
    categories.ts                      # ordered CATEGORIES
    algorithms.ts                      # array + getById/getByCategory/getEnabled
    index.ts
    algorithms.test.ts
  config/
    settings.ts                        # load/save/setEnabled/defaultSettings
    features.ts                        # buildFeature, syncFeatures
    index.ts
    settings.test.ts
    features.test.ts
  shared/
    Field.tsx
    TeachCard.tsx
    Actions.tsx
    CopyButton.tsx
    index.ts
    crypt-shell.css                    # shared visual tokens for shell+algorithm panels
  shell/
    Sidebar.tsx
    SettingsPage.tsx
    AlgorithmHost.tsx                  # disabled/empty states + component mount
    Shell.tsx                          # layout: sidebar + main
    index.ts
  algorithms/
    base64/{meta.ts,ui.tsx,index.ts}
    hex/{meta.ts,ui.tsx,index.ts}
    url/{meta.ts,ui.tsx,index.ts}
    md5/{meta.ts,ui.tsx,index.ts}
    sha256/{meta.ts,ui.tsx,index.ts}
    aes/{meta.ts,ui.tsx,index.ts}
    rsa/{meta.ts,ui.tsx,index.ts}
    hmac/{meta.ts,ui.tsx,index.ts}
    pbkdf2/{meta.ts,ui.tsx,index.ts}
  App.tsx                              # enter events → Shell view state
  main.tsx
  env.d.ts                             # Services.crypt typings
package.json                           # + vitest, scripts.test
```

**Dependency rule:** `shell → registry → algorithms → shared`; `config` may import `registry` only; algorithms import `shared` + call `window.services`; no algorithm-to-algorithm imports.

---

### Task 1: Tooling + registry types + categories

**Files:**
- Create: `src/registry/types.ts`
- Create: `src/registry/categories.ts`
- Create: `src/registry/categories.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `CategoryId`, `AlgorithmMeta`, `AlgorithmModule`, `AlgorithmProps`, `CATEGORIES: CategoryDef[]`

- [ ] **Step 1: Add vitest and test script**

Edit `package.json` dependencies/devDependencies and scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

Merge with existing keys; do not remove existing deps. Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'public/preload/**/*.test.ts']
  }
})
```

- [ ] **Step 2: Write failing categories test**

`src/registry/categories.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryLabel } from './categories'

describe('categories', () => {
  it('has six categories in spec order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      'encoding',
      'hash',
      'symmetric',
      'asymmetric',
      'hmac',
      'kdf'
    ])
  })

  it('maps Chinese labels', () => {
    expect(categoryLabel('encoding')).toBe('编码转换')
    expect(categoryLabel('kdf')).toBe('口令派生')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL (module not found)

- [ ] **Step 4: Implement types + categories**

`src/registry/types.ts`:

```ts
import type { FC } from 'react'

export type CategoryId =
  | 'encoding'
  | 'hash'
  | 'symmetric'
  | 'asymmetric'
  | 'hmac'
  | 'kdf'

export interface AlgorithmMeta {
  id: string
  category: CategoryId
  label: string
  title: string
  reversible: boolean
  cmds: string[]
  defaultEnabled: boolean
  teach: { summary: string }
}

export interface AlgorithmProps {
  enterPayload?: string
}

export interface AlgorithmModule {
  meta: AlgorithmMeta
  Component: FC<AlgorithmProps>
}
```

`src/registry/categories.ts`:

```ts
import type { CategoryId } from './types'

export interface CategoryDef {
  id: CategoryId
  label: string
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'encoding', label: '编码转换' },
  { id: 'hash', label: '哈希摘要' },
  { id: 'symmetric', label: '对称加密' },
  { id: 'asymmetric', label: '非对称加密' },
  { id: 'hmac', label: '消息认证' },
  { id: 'kdf', label: '口令派生' }
]

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/registry/
git commit -m "chore: vitest setup and registry categories"
```

---

### Task 2: Encoding algorithms (Base64 / Hex / URL) in preload

**Files:**
- Create: `public/preload/crypt/envelope.js`
- Create: `public/preload/crypt/encoding.js`
- Create: `public/preload/crypt/encoding.test.ts`
- Create: `public/preload/crypt/index.js` (starts as encoding export; extended in later tasks)

**Interfaces:**
- Produces: `envelope.ok(data)`, `envelope.fail(error)`, `tryCrypt(fn)`; `base64.encode/decode`, `hex.encode/decode`, `url.encode/decode` each `(input: string) => CryptResult`

- [ ] **Step 1: Write failing encoding tests**

`public/preload/crypt/encoding.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { base64, hex, url } from './index.js'

describe('base64', () => {
  it('roundtrips UTF-8 text', () => {
    const enc = base64.encode('Hello ZTools')
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    expect(enc.data).toBe('SGVsbG8gWlRvb2xz')
    const dec = base64.decode(enc.data)
    expect(dec).toEqual({ ok: true, data: 'Hello ZTools' })
  })

  it('fails on invalid base64', () => {
    const dec = base64.decode('@@@')
    expect(dec.ok).toBe(false)
    if (dec.ok) return
    expect(dec.error).toMatch(/Base64/)
  })
})

describe('hex', () => {
  it('encodes and decodes', () => {
    const enc = hex.encode('AB')
    expect(enc).toEqual({ ok: true, data: '4142' })
    expect(hex.decode('4142')).toEqual({ ok: true, data: 'AB' })
  })

  it('fails on odd-length hex', () => {
    const r = hex.decode('414')
    expect(r.ok).toBe(false)
  })
})

describe('url', () => {
  it('roundtrips', () => {
    const enc = url.encode('a b/c?d=e')
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    expect(url.decode(enc.data)).toEqual({ ok: true, data: 'a b/c?d=e' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run public/preload/crypt/encoding.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement envelope + encoding + index**

`public/preload/crypt/envelope.js`:

```js
function ok(data) {
  return { ok: true, data: String(data) }
}

function fail(error) {
  return { ok: false, error: String(error) }
}

function tryCrypt(fn) {
  try {
    return fn()
  } catch (e) {
    return fail(e && e.message ? e.message : '计算失败')
  }
}

module.exports = { ok, fail, tryCrypt }
```

`public/preload/crypt/encoding.js`:

```js
const { ok, fail, tryCrypt } = require('./envelope')

const base64 = {
  encode(input) {
    return tryCrypt(() => ok(Buffer.from(String(input), 'utf-8').toString('base64')))
  },
  decode(input) {
    return tryCrypt(() => {
      const s = String(input).trim()
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
        return fail('Base64 格式无效，无法解码')
      }
      const buf = Buffer.from(s, 'base64')
      if (buf.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) {
        return fail('Base64 格式无效，无法解码')
      }
      return ok(buf.toString('utf-8'))
    })
  }
}

const hex = {
  encode(input) {
    return tryCrypt(() => ok(Buffer.from(String(input), 'utf-8').toString('hex')))
  },
  decode(input) {
    return tryCrypt(() => {
      const s = String(input).trim().replace(/\s+/g, '')
      if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2 !== 0) {
        return fail('Hex 格式无效（需偶数位 0-9a-f）')
      }
      return ok(Buffer.from(s, 'hex').toString('utf-8'))
    })
  }
}

const url = {
  encode(input) {
    return tryCrypt(() => ok(encodeURIComponent(String(input))))
  },
  decode(input) {
    return tryCrypt(() => {
      try {
        return ok(decodeURIComponent(String(input)))
      } catch (e) {
        return fail('URL 编码无效，无法解码')
      }
    })
  }
}

module.exports = { base64, hex, url }
```

`public/preload/crypt/index.js`:

```js
const encoding = require('./encoding')

module.exports = {
  base64: encoding.base64,
  hex: encoding.hex,
  url: encoding.url
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run public/preload/crypt/encoding.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/preload/crypt/
git commit -m "feat(preload): base64 hex url encoding with envelope"
```

---

### Task 3: Hash algorithms (MD5 / SHA-256)

**Files:**
- Create: `public/preload/crypt/hash.js`
- Create: `public/preload/crypt/hash.test.ts`
- Modify: `public/preload/crypt/index.js`

**Interfaces:**
- Produces: `md5.digest(input)`, `sha256.digest(input)` → `CryptResult` (hex lowercase)

- [ ] **Step 1: Write failing hash tests**

`public/preload/crypt/hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { md5, sha256 } from './index.js'

describe('hash', () => {
  it('md5 known vector', () => {
    expect(md5.digest('abc')).toEqual({
      ok: true,
      data: '900150983cd24fb0d6963f7d28e17f72'
    })
  })

  it('sha256 known vector', () => {
    expect(sha256.digest('abc')).toEqual({
      ok: true,
      data: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run public/preload/crypt/hash.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement hash + register export**

`public/preload/crypt/hash.js`:

```js
const crypto = require('node:crypto')
const { ok, tryCrypt } = require('./envelope')

function digest(algo, input) {
  return tryCrypt(() =>
    ok(crypto.createHash(algo).update(String(input), 'utf-8').digest('hex'))
  )
}

module.exports = {
  md5: { digest: (input) => digest('md5', input) },
  sha256: { digest: (input) => digest('sha256', input) }
}
```

Update `public/preload/crypt/index.js`:

```js
const encoding = require('./encoding')
const hash = require('./hash')

module.exports = {
  base64: encoding.base64,
  hex: encoding.hex,
  url: encoding.url,
  md5: hash.md5,
  sha256: hash.sha256
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run public/preload/crypt/hash.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/preload/crypt/
git commit -m "feat(preload): md5 and sha256 digest"
```

---

### Task 4: AES encrypt/decrypt

**Files:**
- Create: `public/preload/crypt/aes.js`
- Create: `public/preload/crypt/aes.test.ts`
- Modify: `public/preload/crypt/index.js`

**Interfaces:**
- Produces: `aes.encrypt({ key, iv, mode, plaintext })`, `aes.decrypt({ key, iv, mode, ciphertext })` → `CryptResult`
  - `key`/`iv`: UTF-8 strings (key byte length 16/24/32; iv 16 bytes)
  - `mode`: `'CBC' | 'GCM'`
  - CBC output: Base64(iv||ct) not used — iv passed separately; ciphertext Base64
  - GCM: output Base64(ct||tag) with 16-byte tag; decrypt splits last 16 bytes

- [ ] **Step 1: Write failing AES tests**

`public/preload/crypt/aes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aes } from './index.js'

const key = 'my-secret-key-16b' // 16 bytes
const iv = 'random-iv-16bytes' // 16 bytes

describe('aes', () => {
  it('CBC roundtrip', () => {
    const enc = aes.encrypt({ key, iv, mode: 'CBC', plaintext: 'Hello ZTools' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const dec = aes.decrypt({ key, iv, mode: 'CBC', ciphertext: enc.data })
    expect(dec).toEqual({ ok: true, data: 'Hello ZTools' })
  })

  it('GCM roundtrip', () => {
    const enc = aes.encrypt({ key, iv, mode: 'GCM', plaintext: 'Hello ZTools' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const dec = aes.decrypt({ key, iv, mode: 'GCM', ciphertext: enc.data })
    expect(dec).toEqual({ ok: true, data: 'Hello ZTools' })
  })

  it('rejects bad key length', () => {
    const enc = aes.encrypt({ key: 'short', iv, mode: 'CBC', plaintext: 'x' })
    expect(enc.ok).toBe(false)
    if (enc.ok) return
    expect(enc.error).toMatch(/密钥/)
  })

  it('rejects wrong key length for iv', () => {
    const enc = aes.encrypt({ key, iv: 'bad', mode: 'CBC', plaintext: 'x' })
    expect(enc.ok).toBe(false)
    if (enc.ok) return
    expect(enc.error).toMatch(/IV/)
  })

  it('GCM fails on tampered ciphertext', () => {
    const enc = aes.encrypt({ key, iv, mode: 'GCM', plaintext: 'Hello ZTools' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const raw = Buffer.from(enc.data, 'base64')
    raw[0] ^= 0xff
    const dec = aes.decrypt({ key, iv, mode: 'GCM', ciphertext: raw.toString('base64') })
    expect(dec.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run public/preload/crypt/aes.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement AES + export**

`public/preload/crypt/aes.js`:

```js
const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function validate({ key, iv, mode }) {
  const keyBuf = Buffer.from(String(key), 'utf-8')
  if (![16, 24, 32].includes(keyBuf.length)) {
    return fail('密钥必须为 16 / 24 / 32 字节（UTF-8）')
  }
  const ivBuf = Buffer.from(String(iv), 'utf-8')
  if (ivBuf.length !== 16) {
    return fail('IV 必须为 16 字节（UTF-8）')
  }
  if (mode !== 'CBC' && mode !== 'GCM') {
    return fail('模式仅支持 CBC 或 GCM')
  }
  return { keyBuf, ivBuf, mode }
}

function encrypt({ key, iv, mode, plaintext }) {
  return tryCrypt(() => {
    const v = validate({ key, iv, mode })
    if (v.ok === false) return v
    const cipher = crypto.createCipheriv(`aes-${v.keyBuf.length * 8}-${mode.toLowerCase()}`, v.keyBuf, v.ivBuf)
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf-8'), cipher.final()])
    if (mode === 'GCM') {
      const tag = cipher.getAuthTag()
      return ok(Buffer.concat([ct, tag]).toString('base64'))
    }
    return ok(ct.toString('base64'))
  })
}

function decrypt({ key, iv, mode, ciphertext }) {
  return tryCrypt(() => {
    const v = validate({ key, iv, mode })
    if (v.ok === false) return v
    const raw = Buffer.from(String(ciphertext), 'base64')
    try {
      if (mode === 'GCM') {
        if (raw.length < 17) return fail('密文过短或已被破坏')
        const tag = raw.subarray(raw.length - 16)
        const ct = raw.subarray(0, raw.length - 16)
        const decipher = crypto.createDecipheriv('aes-256-gcm'.replace('256', String(v.keyBuf.length * 8)), v.keyBuf, v.ivBuf)
        decipher.setAuthTag(tag)
        return ok(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8'))
      }
      const decipher = crypto.createDecipheriv(
        `aes-${v.keyBuf.length * 8}-cbc`,
        v.keyBuf,
        v.ivBuf
      )
      return ok(Buffer.concat([decipher.update(raw), decipher.final()]).toString('utf-8'))
    } catch (e) {
      return fail('解密失败：密钥/IV 不正确或数据已损坏')
    }
  })
}

module.exports = { encrypt, decrypt }
```

Note: `validate` returns `fail(...)` which is `{ok:false}`; success path returns `{keyBuf,ivBuf,mode}` without `ok` — check `v.ok === false` only.

Update `public/preload/crypt/index.js` to include `aes: require('./aes')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run public/preload/crypt/aes.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/preload/crypt/
git commit -m "feat(preload): aes cbc gcm encrypt decrypt"
```

---

### Task 5: RSA encrypt/decrypt/keygen

**Files:**
- Create: `public/preload/crypt/rsa.js`
- Create: `public/preload/crypt/rsa.test.ts`
- Modify: `public/preload/crypt/index.js`

**Interfaces:**
- Produces: `rsa.encrypt({ publicKey, plaintext })`, `rsa.decrypt({ privateKey, ciphertext })`, `rsa.generateKeyPair()` → `CryptResult`
  - Keys: PEM PKCS#8 private / PKCS#1 or SPKI public strings
  - ciphertext: Base64

- [ ] **Step 1: Write failing RSA tests**

`public/preload/crypt/rsa.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { rsa } from './index.js'

describe('rsa', () => {
  it('roundtrips with generated keys', () => {
    const pair = rsa.generateKeyPair()
    expect(pair.ok).toBe(true)
    if (!pair.ok) return
    const { publicKey, privateKey } = JSON.parse(pair.data)
    const enc = rsa.encrypt({ publicKey, plaintext: 'Hello RSA' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const dec = rsa.decrypt({ privateKey, ciphertext: enc.data })
    expect(dec).toEqual({ ok: true, data: 'Hello RSA' })
  })

  it('fails on non-PEM public key', () => {
    const enc = rsa.encrypt({ publicKey: 'not-a-key', plaintext: 'x' })
    expect(enc.ok).toBe(false)
    if (enc.ok) return
    expect(enc.error).toMatch(/公钥/)
  })

  it('fails decrypt with wrong key', () => {
    const a = rsa.generateKeyPair()
    const b = rsa.generateKeyPair()
    if (!a.ok || !b.ok) throw new Error('keygen failed')
    const pa = JSON.parse(a.data)
    const pb = JSON.parse(b.data)
    const enc = rsa.encrypt({ publicKey: pa.publicKey, plaintext: 'secret' })
    if (!enc.ok) throw new Error('encrypt failed')
    const dec = rsa.decrypt({ privateKey: pb.privateKey, ciphertext: enc.data })
    expect(dec.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run public/preload/crypt/rsa.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement RSA + export**

`public/preload/crypt/rsa.js`:

```js
const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function encrypt({ publicKey, plaintext }) {
  return tryCrypt(() => {
    let key
    try {
      key = crypto.createPublicKey(String(publicKey))
    } catch (e) {
      return fail('公钥格式无效（需 PEM 格式）')
    }
    const ct = crypto.publicEncrypt(
      { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(String(plaintext), 'utf-8')
    )
    return ok(ct.toString('base64'))
  })
}

function decrypt({ privateKey, ciphertext }) {
  return tryCrypt(() => {
    let key
    try {
      key = crypto.createPrivateKey(String(privateKey))
    } catch (e) {
      return fail('私钥格式无效（需 PEM 格式）')
    }
    try {
      const pt = crypto.privateDecrypt(
        { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(String(ciphertext), 'base64')
      )
      return ok(pt.toString('utf-8'))
    } catch (e) {
      return fail('解密失败：私钥不匹配或密文已损坏')
    }
  })
}

function generateKeyPair() {
  return tryCrypt(() => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    return ok(JSON.stringify({ publicKey, privateKey }))
  })
}

module.exports = { encrypt, decrypt, generateKeyPair }
```

Update `public/preload/crypt/index.js` to include `rsa: require('./rsa')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run public/preload/crypt/rsa.test.ts`  
Expected: PASS (keygen tests may take ~1s)

- [ ] **Step 5: Commit**

```bash
git add public/preload/crypt/
git commit -m "feat(preload): rsa oaep encrypt decrypt keygen"
```

---

### Task 6: HMAC + PBKDF2 + services wiring + env types

**Files:**
- Create: `public/preload/crypt/hmac.js`
- Create: `public/preload/crypt/pbkdf2.js`
- Create: `public/preload/crypt/hmac.test.ts`
- Create: `public/preload/crypt/pbkdf2.test.ts`
- Modify: `public/preload/crypt/index.js`
- Modify: `public/preload/services.js`
- Modify: `src/env.d.ts`

**Interfaces:**
- Produces: `hmac.digest({ key, message, algorithm })` (algorithm `'sha256' | 'sha512'`), `pbkdf2.derive({ password, salt, iterations, keyLength, digest })` → hex `CryptResult`
- `window.services.crypt` = full crypt namespace; `window.services` retains existing file helpers until Task 14 removes unused ones
- `Services` interface in `env.d.ts` includes `crypt: CryptNamespace`

- [ ] **Step 1: Write failing HMAC + PBKDF2 tests**

`public/preload/crypt/hmac.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hmac } from './index.js'

describe('hmac', () => {
  it('sha256 known vector (RFC 4231 case 1 truncated check)', () => {
    const r = hmac.digest({
      key: Buffer.from('0b'.repeat(20), 'hex').toString('binary'),
      message: 'Hi There',
      algorithm: 'sha256'
    })
    // Use utf-8 key of 20 bytes of 0x0b:
    const r2 = hmac.digest({
      key: String.fromCharCode(...Array(20).fill(0x0b)),
      message: 'Hi There',
      algorithm: 'sha256'
    })
    expect(r2).toEqual({
      ok: true,
      data: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    })
    expect(r.ok || !r.ok).toBe(true)
  })

  it('rejects empty key', () => {
    const r = hmac.digest({ key: '', message: 'x', algorithm: 'sha256' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/密钥/)
  })
})
```

`public/preload/crypt/pbkdf2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pbkdf2 } from './index.js'

describe('pbkdf2', () => {
  it('derives stable hex key', () => {
    const a = pbkdf2.derive({
      password: 'password',
      salt: 'salt',
      iterations: 1000,
      keyLength: 16,
      digest: 'sha256'
    })
    const b = pbkdf2.derive({
      password: 'password',
      salt: 'salt',
      iterations: 1000,
      keyLength: 16,
      digest: 'sha256'
    })
    expect(a.ok).toBe(true)
    expect(a).toEqual(b)
    if (!a.ok) return
    expect(a.data).toMatch(/^[0-9a-f]{32}$/)
  })

  it('rejects non-positive iterations', () => {
    const r = pbkdf2.derive({
      password: 'p',
      salt: 's',
      iterations: 0,
      keyLength: 16,
      digest: 'sha256'
    })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run public/preload/crypt/hmac.test.ts public/preload/crypt/pbkdf2.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement hmac, pbkdf2, index, services, env.d.ts**

`public/preload/crypt/hmac.js`:

```js
const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function digest({ key, message, algorithm }) {
  return tryCrypt(() => {
    if (!key) return fail('HMAC 密钥不能为空')
    const algo = algorithm === 'sha512' ? 'sha512' : 'sha256'
    return ok(
      crypto.createHmac(algo, String(key)).update(String(message), 'utf-8').digest('hex')
    )
  })
}

module.exports = { digest }
```

`public/preload/crypt/pbkdf2.js`:

```js
const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function derive({ password, salt, iterations, keyLength, digest }) {
  return tryCrypt(() => {
    const iter = Number(iterations)
    const len = Number(keyLength)
    if (!Number.isFinite(iter) || iter < 1) return fail('迭代次数必须为正整数')
    if (!Number.isFinite(len) || len < 1 || len > 1024) {
      return fail('派生密钥长度必须为 1–1024 字节')
    }
    const algo = ['sha1', 'sha256', 'sha512'].includes(digest) ? digest : 'sha256'
    const key = crypto.pbkdf2Sync(
      String(password),
      String(salt),
      iter,
      len,
      algo
    )
    return ok(key.toString('hex'))
  })
}

module.exports = { derive }
```

Update `public/preload/crypt/index.js`:

```js
const encoding = require('./encoding')
const hash = require('./hash')
const aes = require('./aes')
const rsa = require('./rsa')
const hmac = require('./hmac')
const pbkdf2 = require('./pbkdf2')

module.exports = {
  base64: encoding.base64,
  hex: encoding.hex,
  url: encoding.url,
  md5: hash.md5,
  sha256: hash.sha256,
  aes,
  rsa,
  hmac,
  pbkdf2
}
```

`public/preload/services.js` — add crypt require and attach (keep existing file APIs):

```js
const fs = require('node:fs')
const path = require('node:path')
const crypt = require('./crypt')

window.services = {
  crypt,
  readFile(file) { /* unchanged */ },
  writeTextFile(text) { /* unchanged */ },
  writeImageFile(base64Url) { /* unchanged */ }
}
```

Copy existing function bodies unchanged.

`src/env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

export type CryptResult = { ok: true; data: string } | { ok: false; error: string }

export interface CryptNamespace {
  base64: { encode: (input: string) => CryptResult; decode: (input: string) => CryptResult }
  hex: { encode: (input: string) => CryptResult; decode: (input: string) => CryptResult }
  url: { encode: (input: string) => CryptResult; decode: (input: string) => CryptResult }
  md5: { digest: (input: string) => CryptResult }
  sha256: { digest: (input: string) => CryptResult }
  aes: {
    encrypt: (p: { key: string; iv: string; mode: string; plaintext: string }) => CryptResult
    decrypt: (p: { key: string; iv: string; mode: string; ciphertext: string }) => CryptResult
  }
  rsa: {
    encrypt: (p: { publicKey: string; plaintext: string }) => CryptResult
    decrypt: (p: { privateKey: string; ciphertext: string }) => CryptResult
    generateKeyPair: () => CryptResult
  }
  hmac: {
    digest: (p: { key: string; message: string; algorithm: string }) => CryptResult
  }
  pbkdf2: {
    derive: (p: {
      password: string
      salt: string
      iterations: number
      keyLength: number
      digest: string
    }) => CryptResult
  }
}

interface Services {
  crypt: CryptNamespace
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run public/preload/crypt/`  
Expected: PASS (all crypt tests)

- [ ] **Step 5: Commit**

```bash
git add public/preload/ src/env.d.ts
git commit -m "feat(preload): hmac pbkdf2 wire services.crypt and types"
```

---

### Task 7: config settings + feature sync

**Files:**
- Create: `src/config/settings.ts`
- Create: `src/config/features.ts`
- Create: `src/config/index.ts`
- Create: `src/config/settings.test.ts`
- Create: `src/config/features.test.ts`

**Interfaces:**
- Consumes: `algorithms` / `AlgorithmMeta` from registry (stub import — create minimal `src/registry/algorithms.ts` in this task if not present: empty array exportable, filled in Tasks 10–13). Prefer: define pure functions that take `AlgorithmModule[]` as argument so tests do not need full registry.
- Produces:
  - `SETTINGS_KEY = 'crypt-tool:settings'`
  - `interface Settings { enabled: Record<string, boolean>; prefs: { defaultOutputEncoding: 'base64' | 'hex' | 'text' } }`
  - `defaultSettings(modules: AlgorithmModule[]): Settings`
  - `loadSettings(modules: AlgorithmModule[]): Settings`
  - `saveSettings(s: Settings): void`
  - `setEnabled(id: string, on: boolean, modules: AlgorithmModule[]): Settings` (load-modify-save)
  - `buildFeature(meta: AlgorithmMeta): FeatureInput`
  - `syncFeatures(modules: AlgorithmModule[], enabled: Record<string, boolean>): void`

- [ ] **Step 1: Write failing settings tests**

`src/config/settings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlgorithmModule } from '../registry/types'
import { defaultSettings, loadSettings, saveSettings, setEnabled, SETTINGS_KEY } from './settings'

const mods = [
  {
    meta: {
      id: 'aes',
      category: 'symmetric',
      label: 'AES',
      title: 'AES 对称加密',
      reversible: true,
      cmds: ['aes加密'],
      defaultEnabled: true,
      teach: { summary: 's' }
    },
    Component: () => null
  },
  {
    meta: {
      id: 'rsa',
      category: 'asymmetric',
      label: 'RSA',
      title: 'RSA 非对称加密',
      reversible: true,
      cmds: ['rsa加密'],
      defaultEnabled: false,
      teach: { summary: 's' }
    },
    Component: () => null
  }
] as AlgorithmModule[]

describe('settings', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', {
      ztools: {
        dbStorage: {
          getItem: (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
          setItem: (k: string, v: unknown) => {
            store.set(k, JSON.stringify(v))
          },
          removeItem: (k: string) => {
            store.delete(k)
          }
        }
      }
    })
  })

  it('defaults from module defaultEnabled', () => {
    const s = defaultSettings(mods)
    expect(s.enabled).toEqual({ aes: true, rsa: false })
  })

  it('loads saved settings and ignores unknown ids', () => {
    saveSettings({
      enabled: { aes: false, unknownId: true },
      prefs: { defaultOutputEncoding: 'base64' }
    })
    const s = loadSettings(mods)
    expect(s.enabled.aes).toBe(false)
    expect(s.enabled.unknownId).toBeUndefined()
    expect(s.enabled.rsa).toBe(false)
  })

  it('setEnabled persists', () => {
    const s = setEnabled('aes', false, mods)
    expect(s.enabled.aes).toBe(false)
    expect(loadSettings(mods).enabled.aes).toBe(false)
  })

  it('uses SETTINGS_KEY', () => {
    expect(SETTINGS_KEY).toBe('crypt-tool:settings')
  })
})
```

`src/config/features.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AlgorithmModule } from '../registry/types'
import { buildFeature, syncFeatures } from './features'

const meta = {
  id: 'aes',
  category: 'symmetric',
  label: 'AES',
  title: 'AES 对称加密',
  reversible: true,
  cmds: ['aes加密', 'AES'],
  defaultEnabled: true,
  teach: { summary: 's' }
}

const mods = [{ meta, Component: () => null }] as AlgorithmModule[]

describe('features', () => {
  it('buildFeature shape', () => {
    expect(buildFeature(meta)).toEqual({
      code: 'alg:aes',
      explain: 'AES 对称加密',
      icon: 'logo.png',
      cmds: ['aes加密', 'AES']
    })
  })

  it('syncFeatures set/remove targets', () => {
    const setFeature = vi.fn()
    const removeFeature = vi.fn()
    vi.stubGlobal('window', { ztools: { setFeature, removeFeature } })

    syncFeatures(mods, { aes: true })
    expect(setFeature).toHaveBeenCalledWith(buildFeature(meta))
    expect(removeFeature).not.toHaveBeenCalled()

    setFeature.mockClear()
    syncFeatures(mods, { aes: false })
    expect(removeFeature).toHaveBeenCalledWith('alg:aes')
    expect(setFeature).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('throws are caught by syncFeatures', () => {
    const setFeature = vi.fn(() => {
      throw new Error('host error')
    })
    const removeFeature = vi.fn(() => {
      throw new Error('host error')
    })
    vi.stubGlobal('window', { ztools: { setFeature, removeFeature } })
    expect(() => syncFeatures(mods, { aes: true })).not.toThrow()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config`  
Expected: FAIL

- [ ] **Step 3: Implement config modules**

`src/config/settings.ts`:

```ts
import type { AlgorithmModule } from '../registry/types'

export const SETTINGS_KEY = 'crypt-tool:settings'

export interface Settings {
  enabled: Record<string, boolean>
  prefs: { defaultOutputEncoding: 'base64' | 'hex' | 'text' }
}

export function defaultSettings(modules: AlgorithmModule[]): Settings {
  const enabled: Record<string, boolean> = {}
  for (const m of modules) enabled[m.meta.id] = m.meta.defaultEnabled
  return { enabled, prefs: { defaultOutputEncoding: 'base64' } }
}

export function loadSettings(modules: AlgorithmModule[]): Settings {
  const defaults = defaultSettings(modules)
  try {
    const raw = window.ztools.dbStorage.getItem(SETTINGS_KEY)
    if (!raw || typeof raw !== 'object') return defaults
    const saved = raw as Partial<Settings>
    const enabled: Record<string, boolean> = { ...defaults.enabled }
    if (saved.enabled && typeof saved.enabled === 'object') {
      for (const m of modules) {
        const v = (saved.enabled as Record<string, unknown>)[m.meta.id]
        if (typeof v === 'boolean') enabled[m.meta.id] = v
      }
    }
    const prefs = {
      defaultOutputEncoding:
        saved.prefs?.defaultOutputEncoding === 'hex' ||
        saved.prefs?.defaultOutputEncoding === 'text'
          ? saved.prefs.defaultOutputEncoding
          : defaults.prefs.defaultOutputEncoding
    }
    return { enabled, prefs }
  } catch {
    return defaults
  }
}

export function saveSettings(s: Settings): void {
  window.ztools.dbStorage.setItem(SETTINGS_KEY, s)
}

export function setEnabled(
  id: string,
  on: boolean,
  modules: AlgorithmModule[]
): Settings {
  const s = loadSettings(modules)
  s.enabled[id] = on
  saveSettings(s)
  return s
}
```

`src/config/features.ts`:

```ts
import type { AlgorithmMeta, AlgorithmModule } from '../registry/types'

export interface FeatureInput {
  code: string
  explain: string
  icon: string
  cmds: string[]
}

export function buildFeature(meta: AlgorithmMeta): FeatureInput {
  return {
    code: `alg:${meta.id}`,
    explain: meta.title,
    icon: 'logo.png',
    cmds: [...meta.cmds]
  }
}

export function syncFeatures(
  modules: AlgorithmModule[],
  enabled: Record<string, boolean>
): void {
  for (const m of modules) {
    try {
      if (enabled[m.meta.id]) {
        window.ztools.setFeature(buildFeature(m.meta))
      } else {
        window.ztools.removeFeature(`alg:${m.meta.id}`)
      }
    } catch {
      // host feature API unavailable — non-fatal
    }
  }
}
```

`src/config/index.ts`:

```ts
export * from './settings'
export * from './features'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/
git commit -m "feat(config): dbStorage settings and dynamic feature sync"
```

---

### Task 8: Shared UI components + shell CSS tokens

**Files:**
- Create: `src/shared/Field.tsx`
- Create: `src/shared/TeachCard.tsx`
- Create: `src/shared/Actions.tsx`
- Create: `src/shared/CopyButton.tsx`
- Create: `src/shared/index.ts`
- Create: `src/shared/crypt-shell.css`

**Interfaces:**
- Produces: `Field`, `TeachCard`, `Actions`, `CopyButton` as specified in spec §4.2 / §5.1

- [ ] **Step 1: Implement components**

`src/shared/Field.tsx`:

```tsx
import type { CSSProperties } from 'react'

export type FieldType = 'text' | 'secret' | 'textarea' | 'select'

export interface FieldProps {
  label: string
  hint?: string
  help?: string
  type?: FieldType
  value: string
  onChange: (v: string) => void
  options?: { value: string; label: string }[]
  error?: string
  readOnly?: boolean
  rows?: number
  placeholder?: string
  style?: CSSProperties
}

export default function Field({
  label,
  hint,
  help,
  type = 'text',
  value,
  onChange,
  options,
  error,
  readOnly,
  rows = 3,
  placeholder,
  style
}: FieldProps) {
  const id = `f-${label.replace(/\s+/g, '-')}`
  return (
    <div className="ct-field" style={style}>
      <label htmlFor={id}>
        <span>{label}</span>
        {hint ? <em>{hint}</em> : null}
      </label>
      {type === 'textarea' ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : type === 'select' ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type === 'secret' ? 'password' : 'text'}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? <div className="ct-field-error">{error}</div> : null}
      {help ? <div className="ct-field-help">{help}</div> : null}
    </div>
  )
}
```

`src/shared/TeachCard.tsx`:

```tsx
export default function TeachCard({ summary }: { summary: string }) {
  return (
    <div className="ct-teach">
      <strong>算法简要</strong>
      <div>{summary}</div>
    </div>
  )
}
```

`src/shared/Actions.tsx`:

```tsx
export interface ActionItem {
  label: string
  onClick: () => void
  variant?: 'primary' | 'ghost'
  disabled?: boolean
}

export default function Actions({ items }: { items: ActionItem[] }) {
  return (
    <div className="ct-actions">
      {items.map((a) => (
        <button
          key={a.label}
          type="button"
          className={`ct-btn ${a.variant === 'primary' ? 'ct-btn-primary' : 'ct-btn-ghost'}`}
          disabled={a.disabled}
          onClick={a.onClick}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
```

`src/shared/CopyButton.tsx`:

```tsx
export default function CopyButton({ text, label = '复制结果' }: { text: string; label?: string }) {
  const onCopy = () => {
    if (!text) {
      window.ztools.showToast('没有可复制的内容')
      return
    }
    try {
      window.ztools.copyText(text)
      window.ztools.showToast('已复制')
    } catch {
      window.ztools.showToast('复制失败')
    }
  }
  return (
    <button type="button" className="ct-btn ct-btn-ghost" onClick={onCopy}>
      {label}
    </button>
  )
}
```

`src/shared/index.ts`:

```ts
export { default as Field } from './Field'
export type { FieldProps, FieldType } from './Field'
export { default as TeachCard } from './TeachCard'
export { default as Actions } from './Actions'
export type { ActionItem } from './Actions'
export { default as CopyButton } from './CopyButton'
import './crypt-shell.css'
```

`src/shared/crypt-shell.css` (visual baseline from confirmed mockup):

```css
.ct-panel {
  display: grid;
  grid-template-columns: 200px 1fr;
  min-height: 100%;
  border-radius: 16px;
  overflow: hidden;
  font-size: 13px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  background: rgba(127, 127, 127, 0.05);
  color: inherit;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
}

@media (max-width: 720px) {
  .ct-panel {
    grid-template-columns: 160px 1fr;
  }
}

.ct-side {
  border-right: 1px solid rgba(127, 127, 127, 0.2);
  padding: 14px 10px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.06);
}

.ct-side-title {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.45;
  margin: 12px 10px 6px;
  font-weight: 700;
}

.ct-side-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  margin-bottom: 2px;
  opacity: 0.82;
  white-space: nowrap;
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  color: inherit;
  font-size: 13px;
}

.ct-side-item:hover {
  background: rgba(127, 127, 127, 0.1);
}

.ct-side-item.on {
  background: rgba(88, 164, 246, 0.18);
  color: #58a4f6;
  opacity: 1;
  font-weight: 650;
}

.ct-side-foot {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid rgba(127, 127, 127, 0.18);
  display: flex;
  justify-content: center;
  opacity: 0.55;
}

.ct-main {
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  background: transparent;
}

.ct-main-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ct-main-head h4 {
  margin: 0;
  font-size: 16.5px;
  letter-spacing: -0.01em;
}

.ct-cat {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(88, 164, 246, 0.16);
  color: #58a4f6;
  font-weight: 650;
}

.ct-teach {
  background: rgba(88, 164, 246, 0.07);
  border: 1px solid rgba(88, 164, 246, 0.2);
  border-left: 3px solid #58a4f6;
  border-radius: 10px;
  padding: 11px 14px;
  line-height: 1.6;
  font-size: 12.5px;
}

.ct-teach strong {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: #58a4f6;
}

.ct-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 14px;
}

@media (max-width: 560px) {
  .ct-grid2 {
    grid-template-columns: 1fr;
  }
}

.ct-field label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11.5px;
  opacity: 0.7;
  margin-bottom: 5px;
  font-weight: 600;
}

.ct-field label em {
  font-style: normal;
  opacity: 0.75;
  font-size: 11px;
  font-weight: 500;
}

.ct-field input,
.ct-field textarea,
.ct-field select {
  width: 100%;
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 9px;
  padding: 9px 11px;
  background: rgba(0, 0, 0, 0.28);
  color: inherit;
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
}

.ct-field input:focus,
.ct-field textarea:focus,
.ct-field select:focus {
  border-color: rgba(88, 164, 246, 0.65);
  box-shadow: 0 0 0 3px rgba(88, 164, 246, 0.18);
}

.ct-field textarea {
  min-height: 78px;
  resize: vertical;
  line-height: 1.5;
}

.ct-field-error {
  color: #ef4444;
  font-size: 11.5px;
  margin-top: 4px;
}

.ct-field-help {
  font-size: 11.5px;
  opacity: 0.5;
  margin-top: 5px;
  line-height: 1.45;
}

.ct-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.ct-btn {
  padding: 9px 18px;
  border-radius: 9px;
  font-weight: 650;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
}

.ct-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ct-btn-primary {
  background: linear-gradient(135deg, #58a4f6, #3b82f6);
  color: #fff;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);
}

.ct-btn-ghost {
  background: rgba(0, 0, 0, 0.22);
  color: inherit;
  border-color: rgba(127, 127, 127, 0.3);
}

.ct-empty {
  padding: 40px 20px;
  text-align: center;
  opacity: 0.75;
  line-height: 1.7;
}

.ct-settings-group {
  margin-bottom: 8px;
}

.ct-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.12);
  font-size: 13px;
}

/* No background on page root — enforced in App/main CSS */
```

Also update `src/main.css` — ensure `html, body, #root` do not paint a custom app surface beyond existing host media queries; **remove** any full-page `body { background-color }` overrides added by scaffold if they conflict with host default. Keep scrollbar styles. Specifically change scaffold `body { background-color: #f4f4f4 / #303133 }` blocks: delete `background-color` on `body` (keep text color in dark mode if needed).

- [ ] **Step 2: Verify typecheck compiles shared**

Run: `npx tsc --noEmit`  
Expected: PASS (or only pre-existing unrelated errors — fix any in shared)

- [ ] **Step 3: Commit**

```bash
git add src/shared/ src/main.css
git commit -m "feat(ui): shared field teach actions copy and shell css"
```

---

### Task 9: Shell (sidebar + settings + host states)

**Files:**
- Create: `src/shell/Sidebar.tsx`
- Create: `src/shell/SettingsPage.tsx`
- Create: `src/shell/AlgorithmHost.tsx`
- Create: `src/shell/Shell.tsx`
- Create: `src/shell/index.ts`
- Create: `src/registry/algorithms.ts` (if not yet created: empty array + helpers; Tasks 10–13 push modules)
- Create: `src/registry/index.ts`
- Create: `src/registry/algorithms.test.ts`

**Interfaces:**
- Consumes: `Settings`, `setEnabled`, `syncFeatures`, `loadSettings`, `CATEGORIES`, `algorithms`
- Produces:
  - `Shell({ settings, onSettingsChange, view, onViewChange })` where `view` is `{ kind: 'algorithm', id: string } | { kind: 'settings' }`
  - `getEnabledList(modules, enabled): AlgorithmModule[]`
  - `firstEnabledId(modules, enabled): string | null`

- [ ] **Step 1: Write failing registry helper tests**

`src/registry/algorithms.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AlgorithmModule } from './types'
import { firstEnabledId, getByCategory, getById, getEnabledList } from './algorithms'

const m = (id: string, category: AlgorithmModule['meta']['category'], on: boolean): AlgorithmModule => ({
  meta: {
    id,
    category,
    label: id.toUpperCase(),
    title: id,
    reversible: false,
    cmds: [id],
    defaultEnabled: on,
    teach: { summary: '' }
  },
  Component: () => null
})

const list = [m('base64', 'encoding', true), m('aes', 'symmetric', true), m('rsa', 'asymmetric', false)]

describe('registry helpers', () => {
  it('filters enabled', () => {
    expect(getEnabledList(list, { base64: true, aes: false, rsa: true }).map((x) => x.meta.id)).toEqual([
      'base64',
      'rsa'
    ])
  })

  it('firstEnabledId', () => {
    expect(firstEnabledId(list, { base64: false, aes: true, rsa: true })).toBe('aes')
    expect(firstEnabledId(list, { base64: false, aes: false, rsa: false })).toBeNull()
  })

  it('getById / getByCategory', () => {
    expect(getById(list, 'aes')?.meta.id).toBe('aes')
    expect(getByCategory(list, 'encoding').map((x) => x.meta.id)).toEqual(['base64'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/registry/algorithms.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement registry barrel + shell**

`src/registry/algorithms.ts`:

```ts
import type { AlgorithmModule, CategoryId } from './types'
import { base64 } from '../algorithms/base64'
// Task note: only import modules that exist. In Task 9, create this file with
// an empty array if algorithm folders are not ready; replace body in Task 10+.
// Final form after Task 13:

import { hex } from '../algorithms/hex'
import { url } from '../algorithms/url'
import { md5 } from '../algorithms/md5'
import { sha256 } from '../algorithms/sha256'
import { aes } from '../algorithms/aes'
import { rsa } from '../algorithms/rsa'
import { hmac } from '../algorithms/hmac'
import { pbkdf2 } from '../algorithms/pbkdf2'

export const algorithms: AlgorithmModule[] = [
  base64,
  hex,
  url,
  md5,
  sha256,
  aes,
  rsa,
  hmac,
  pbkdf2
]

export function getById(list: AlgorithmModule[], id: string): AlgorithmModule | undefined {
  return list.find((m) => m.meta.id === id)
}

export function getByCategory(list: AlgorithmModule[], category: CategoryId): AlgorithmModule[] {
  return list.filter((m) => m.meta.category === category)
}

export function getEnabledList(
  list: AlgorithmModule[],
  enabled: Record<string, boolean>
): AlgorithmModule[] {
  return list.filter((m) => enabled[m.meta.id])
}

export function firstEnabledId(
  list: AlgorithmModule[],
  enabled: Record<string, boolean>
): string | null {
  const first = getEnabledList(list, enabled)[0]
  return first ? first.meta.id : null
}
```

**Task 9 interim rule:** Until Tasks 10–13 land, create stub folders only when those tasks run. For Task 9 alone, write `algorithms.ts` with helpers and `export const algorithms: AlgorithmModule[] = []`, and put helper tests against the `list` parameter (already injection-style). Do not import algorithm modules until they exist. After Task 13, update the array to the final form above.

`src/registry/index.ts`:

```ts
export * from './types'
export * from './categories'
export * from './algorithms'
```

`src/shell/Sidebar.tsx`:

```tsx
import type { AlgorithmModule } from '../registry/types'
import { CATEGORIES, getByCategory } from '../registry'

interface Props {
  modules: AlgorithmModule[]
  currentId: string | null
  onSelect: (id: string) => void
  onOpenSettings: () => void
  settingsActive: boolean
}

export default function Sidebar({ modules, currentId, onSelect, onOpenSettings, settingsActive }: Props) {
  return (
    <aside className="ct-side">
      {CATEGORIES.map((cat) => {
        const items = getByCategory(modules, cat.id)
        if (items.length === 0) return null
        return (
          <div key={cat.id}>
            <div className="ct-side-title">{cat.label}</div>
            {items.map((m) => (
              <button
                key={m.meta.id}
                type="button"
                className={`ct-side-item ${!settingsActive && currentId === m.meta.id ? 'on' : ''}`}
                onClick={() => onSelect(m.meta.id)}
              >
                <span className="ct-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.5 }} />
                {m.meta.label}
              </button>
            ))}
          </div>
        )
      })}
      <div className="ct-side-foot">
        <button type="button" className={`ct-side-item ${settingsActive ? 'on' : ''}`} onClick={onOpenSettings} style={{ justifyContent: 'center' }}>
          ⚙ 设置
        </button>
      </div>
    </aside>
  )
}
```

`src/shell/SettingsPage.tsx`:

```tsx
import type { AlgorithmModule } from '../registry/types'
import { CATEGORIES, categoryLabel, getByCategory } from '../registry'
import { Actions } from '../shared'
import { defaultSettings, type Settings } from '../config'

interface Props {
  modules: AlgorithmModule[]
  settings: Settings
  onChange: (s: Settings) => void
}

export default function SettingsPage({ modules, settings, onChange }: Props) {
  const toggle = (id: string, on: boolean) => {
    onChange({ ...settings, enabled: { ...settings.enabled, [id]: on } })
  }

  return (
    <div className="ct-main">
      <div className="ct-main-head">
        <h4>设置</h4>
        <span className="ct-cat">算法启停</span>
      </div>
      {CATEGORIES.map((cat) => {
        const items = getByCategory(modules, cat.id)
        if (!items.length) return null
        return (
          <div key={cat.id} className="ct-settings-group">
            <div className="ct-side-title" style={{ margin: '8px 0 4px' }}>{categoryLabel(cat.id)}</div>
            {items.map((m) => (
              <div key={m.meta.id} className="ct-toggle">
                <span>{m.meta.title}</span>
                <input
                  type="checkbox"
                  checked={settings.enabled[m.meta.id] ?? m.meta.defaultEnabled}
                  onChange={(e) => toggle(m.meta.id, e.target.checked)}
                />
              </div>
            ))}
          </div>
        )
      })}
      <Actions
        items={[
          {
            label: '恢复默认',
            variant: 'ghost',
            onClick: () => onChange(defaultSettings(modules))
          },
          {
            label: '返回算法',
            variant: 'primary',
            onClick: () => {
              /* parent handles navigation via settings close */
            }
          }
        ]}
      />
      <p style={{ fontSize: 12, opacity: 0.55, margin: 0 }}>
        修改后自动保存（dbStorage），直达指令将同步增删。
      </p>
    </div>
  )
}
```

Parent `Shell`/`App` persists via `onSettingsChange` → `saveSettings` (see Task 14). Do not call `saveSettings` inside `SettingsPage`.

`src/shell/AlgorithmHost.tsx`:

```tsx
import type { AlgorithmModule } from '../registry/types'
import { categoryLabel } from '../registry'
import { TeachCard } from '../shared'

interface Props {
  module: AlgorithmModule
  enterPayload?: string
}

export default function AlgorithmHost({ module, enterPayload }: Props) {
  const { Component, meta } = module
  return (
    <div className="ct-main">
      <div className="ct-main-head">
        <h4>{meta.title}</h4>
        <span className="ct-cat">{categoryLabel(meta.category)}</span>
      </div>
      <TeachCard summary={meta.teach.summary} />
      <Component enterPayload={enterPayload} />
    </div>
  )
}
```

Wait — spec has teach card then fields; if TeachCard is in host, algorithm UI must NOT render a second TeachCard. Algorithm `ui.tsx` renders only fields + actions + output. Host renders head + TeachCard + Component. Good — document in Tasks 10–13: **do not include TeachCard in algorithm UI**.

`src/shell/Shell.tsx`:

```tsx
import type { AlgorithmModule } from '../registry/types'
import type { Settings } from '../config'
import { firstEnabledId, getById, getEnabledList } from '../registry'
import Sidebar from './Sidebar'
import SettingsPage from './SettingsPage'
import AlgorithmHost from './AlgorithmHost'

export type ShellView =
  | { kind: 'algorithm'; id: string }
  | { kind: 'settings' }

interface Props {
  modules: AlgorithmModule[]
  settings: Settings
  view: ShellView
  onViewChange: (v: ShellView) => void
  onSettingsChange: (s: Settings) => void
  enterPayload?: string
}

export default function Shell({
  modules,
  settings,
  view,
  onViewChange,
  onSettingsChange,
  enterPayload
}: Props) {
  const enabled = getEnabledList(modules, settings.enabled)
  const settingsActive = view.kind === 'settings'
  const currentId = view.kind === 'algorithm' ? view.id : null
  const currentMod = currentId ? getById(modules, currentId) : undefined
  const isCurrentEnabled = currentMod ? !!settings.enabled[currentMod.meta.id] : false

  let main: React.ReactNode
  if (settingsActive) {
    main = (
      <SettingsPage
        modules={modules}
        settings={settings}
        onChange={onSettingsChange}
      />
    )
  } else if (enabled.length === 0) {
    main = (
      <div className="ct-main">
        <div className="ct-empty">
          <p>没有启用的算法</p>
          <button type="button" className="ct-btn ct-btn-primary" onClick={() => onViewChange({ kind: 'settings' })}>
            打开设置
          </button>
        </div>
      </div>
    )
  } else if (!currentMod || !isCurrentEnabled) {
    const fallback = firstEnabledId(modules, settings.enabled)
    main = (
      <div className="ct-main">
        <div className="ct-empty">
          <p>该算法已禁用</p>
          <button type="button" className="ct-btn ct-btn-primary" onClick={() => onViewChange({ kind: 'settings' })}>
            打开设置
          </button>
          {fallback ? (
            <p>
              <button type="button" className="ct-btn ct-btn-ghost" onClick={() => onViewChange({ kind: 'algorithm', id: fallback })}>
                返回 {fallback}
              </button>
            </p>
          ) : null}
        </div>
      </div>
    )
  } else {
    main = <AlgorithmHost module={currentMod} enterPayload={enterPayload} />
  }

  return (
    <div className="ct-panel">
      <Sidebar
        modules={enabled}
        currentId={currentId}
        settingsActive={settingsActive}
        onSelect={(id) => onViewChange({ kind: 'algorithm', id })}
        onOpenSettings={() => onViewChange({ kind: 'settings' })}
      />
      {main}
    </div>
  )
}
```

When settings change causes current algorithm to become disabled, parent (App) should snap view to first enabled — implement in App (Task 14) via effect.

`src/shell/index.ts`:

```ts
export { default as Shell } from './Shell'
export type { ShellView } from './Shell'
```

- [ ] **Step 4: Run registry tests + tsc**

Run: `npx vitest run src/registry/algorithms.test.ts && npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/registry/ src/shell/
git commit -m "feat(shell): sidebar settings host and registry helpers"
```

---

### Task 10: Encoding algorithm modules (Base64 / Hex / URL)

**Files:**
- Create: `src/algorithms/base64/meta.ts`, `ui.tsx`, `index.ts`
- Create: `src/algorithms/hex/meta.ts`, `ui.tsx`, `index.ts`
- Create: `src/algorithms/url/meta.ts`, `ui.tsx`, `index.ts`
- Create: `src/algorithms/encoding-ui.test.tsx` (optional light render test) — **or** rely on tsc; include at least one vitest + happy-dom render if cheap. Prefer pure logic test for encode/decode click handlers via extracted `runCodec` helper in `src/algorithms/codec.ts`.

**Interfaces:**
- Consumes: `Field`, `Actions`, `CopyButton`, `window.services.crypt.*`, `AlgorithmProps`
- Produces: exports `base64`, `hex`, `url` as `AlgorithmModule`

- [ ] **Step 1: Write failing codec helper test**

`src/algorithms/codec.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { runCodec } from './codec'

describe('runCodec', () => {
  it('returns ok data', () => {
    vi.stubGlobal('window', {
      services: { crypt: { base64: { encode: () => ({ ok: true, data: 'X' }) } } }
    })
    expect(runCodec(() => window.services.crypt.base64.encode('a'))).toEqual({
      ok: true,
      data: 'X'
    })
    vi.unstubAllGlobals()
  })

  it('passes through failure', () => {
    vi.stubGlobal('window', {
      services: {
        crypt: { base64: { decode: () => ({ ok: false, error: 'Base64 格式无效' }) } }
      }
    })
    expect(runCodec(() => window.services.crypt.base64.decode('@'))).toEqual({
      ok: false,
      error: 'Base64 格式无效'
    })
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/algorithms/codec.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement codec helper + three encoding modules**

`src/algorithms/codec.ts`:

```ts
import type { CryptResult } from '../env'

export function runCodec(fn: () => CryptResult): CryptResult {
  try {
    return fn()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '计算失败' }
  }
}

export function showError(result: CryptResult): string {
  return result.ok ? '' : result.error
}

export function showData(result: CryptResult): string {
  return result.ok ? result.data : ''
}
```

Note: `CryptResult` is exported from `env.d.ts` — ensure `export type` works; if ambient issues, define `CryptResult` in `src/types/crypt.ts` and re-export from env. **Use `src/types/crypt.ts` as canonical** to avoid d.ts export pitfalls:

Create `src/types/crypt.ts` with the `CryptResult` interface; `env.d.ts` imports type from there for `CryptNamespace`. Adjust Task 6 `env.d.ts` accordingly if needed: `import type { CryptResult } from './types/crypt'` may not work in ambient file — instead duplicate the type alias in both or declare namespace fully in env.d.ts and have `src/types/crypt.ts` export the same shape. Simplest: put `export type CryptResult = ...` only in `src/types/crypt.ts`, and in `env.d.ts` write the methods returning `{ ok: true; data: string } | { ok: false; error: string }` inline. For this plan, `codec.ts` defines:

```ts
export type CryptResult = { ok: true; data: string } | { ok: false; error: string }
```

and `env.d.ts` keeps its own identical shape (structural typing).

`src/algorithms/base64/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'base64',
  category: 'encoding',
  label: 'Base64',
  title: 'Base64 编码',
  reversible: true,
  cmds: ['base64', 'Base64编码'],
  defaultEnabled: true,
  teach: {
    summary:
      'Base64 将二进制/文本按 6 bit 一组映射为 64 个可打印字符，常用于 URL、邮件与 JSON 中嵌入数据。编码可逆，解码还原为 UTF-8 文本。'
  }
}
```

`src/algorithms/base64/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function Base64UI({ enterPayload }: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const run = (dir: 'encode' | 'decode') => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.base64.encode(input)
        : window.services.crypt.base64.decode(input)
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field
          label="输入"
          hint={undefined}
          help="待编码的 UTF-8 文本，或待解码的 Base64 字符串"
          type="textarea"
          value={input}
          onChange={setInput}
          error={error && error.includes('Base64') ? error : undefined}
        />
        <Field label="输出" help="结果文本" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions
        items={[
          { label: '编码', variant: 'primary', onClick: () => run('encode') },
          { label: '解码', onClick: () => run('decode') }
        ]}
      />
      <div className="ct-actions">
        <CopyButton text={output} />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

Simplify: show `error` always under actions:

```tsx
{error ? <div className="ct-field-error">{error}</div> : null}
```

And Field without error prop for input.

`src/algorithms/base64/index.ts`:

```ts
import { meta } from './meta'
import Base64UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const base64: AlgorithmModule = { meta, Component: Base64UI }
```

`src/algorithms/hex/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'hex',
  category: 'encoding',
  label: 'Hex',
  title: 'Hex 编码',
  reversible: true,
  cmds: ['hex', 'Hex编码'],
  defaultEnabled: true,
  teach: {
    summary:
      'Hex（十六进制）用 0-9a-f 每两个字符表示一个字节，便于查看与比对二进制内容。可逆：解码将偶数位 Hex 还原为 UTF-8 文本。'
  }
}
```

`src/algorithms/hex/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function HexUI({ enterPayload }: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const run = (dir: 'encode' | 'decode') => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.hex.encode(input)
        : window.services.crypt.hex.decode(input)
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field
          label="输入"
          help="待编码的 UTF-8 文本，或待解码的偶数位 Hex"
          type="textarea"
          value={input}
          onChange={setInput}
        />
        <Field label="输出" help="结果文本" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions
        items={[
          { label: '编码', variant: 'primary', onClick: () => run('encode') },
          { label: '解码', onClick: () => run('decode') }
        ]}
      />
      <div className="ct-actions">
        <CopyButton text={output} />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/hex/index.ts`:

```ts
import { meta } from './meta'
import HexUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const hex: AlgorithmModule = { meta, Component: HexUI }
```

`src/algorithms/url/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'url',
  category: 'encoding',
  label: 'URL',
  title: 'URL 编码',
  reversible: true,
  cmds: ['url编码', 'urlencode'],
  defaultEnabled: true,
  teach: {
    summary:
      'URL 编码（百分号编码）将保留字符与非 ASCII 转为 %XX 序列，用于查询参数与路径安全传输。可逆解码还原原文。'
  }
}
```

`src/algorithms/url/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function UrlUI({ enterPayload }: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const run = (dir: 'encode' | 'decode') => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.url.encode(input)
        : window.services.crypt.url.decode(input)
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field
          label="输入"
          help="待编码的原文，或待解码的 %XX 字符串"
          type="textarea"
          value={input}
          onChange={setInput}
        />
        <Field label="输出" help="结果文本" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions
        items={[
          { label: '编码', variant: 'primary', onClick: () => run('encode') },
          { label: '解码', onClick: () => run('decode') }
        ]}
      />
      <div className="ct-actions">
        <CopyButton text={output} />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/url/index.ts`:

```ts
import { meta } from './meta'
import UrlUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const url: AlgorithmModule = { meta, Component: UrlUI }
```

- [ ] **Step 4: Temporarily register only encoding modules for compile**

In `src/registry/algorithms.ts` set:

```ts
import { base64 } from '../algorithms/base64'
import { hex } from '../algorithms/hex'
import { url } from '../algorithms/url'

export const algorithms: AlgorithmModule[] = [base64, hex, url]
// helpers unchanged
```

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run src/algorithms/codec.test.ts && npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/algorithms/ src/registry/algorithms.ts src/types 2>/dev/null
git add src/algorithms src/registry/algorithms.ts
git commit -m "feat(algorithms): base64 hex url modules"
```

---

### Task 11: Hash algorithm modules (MD5 / SHA-256)

**Files:**
- Create: `src/algorithms/md5/{meta,ui,index}.ts(x)`
- Create: `src/algorithms/sha256/{meta,ui,index}.ts(x)`
- Modify: `src/registry/algorithms.ts`

**Interfaces:**
- Produces: `md5`, `sha256` modules; UI: single input textarea + 计算 + output + copy; no decrypt button

- [ ] **Step 1: Implement md5 module**

`src/algorithms/md5/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'md5',
  category: 'hash',
  label: 'MD5',
  title: 'MD5 摘要',
  reversible: false,
  cmds: ['md5', 'MD5'],
  defaultEnabled: true,
  teach: {
    summary:
      'MD5 产生 128 位（32 位十六进制）摘要，速度快但已不适合安全场景，常用于校验和与非安全场景指纹。不可逆。'
  }
}
```

`src/algorithms/md5/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function Md5UI({ enterPayload }: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const run = () => {
    const r = runCodec(() => window.services.crypt.md5.digest(input))
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field label="明文" help="参与摘要的 UTF-8 文本" type="textarea" value={input} onChange={setInput} />
        <Field label="摘要 Hex" help="32 位十六进制，不可逆" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions items={[{ label: '计算', variant: 'primary', onClick: run }]} />
      <div className="ct-actions">
        <CopyButton text={output} />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/md5/index.ts`:

```ts
import { meta } from './meta'
import Md5UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const md5: AlgorithmModule = { meta, Component: Md5UI }
```

- [ ] **Step 2: Implement sha256 module (same shape)**

`meta.ts`: id `sha256`, category `hash`, label `SHA-256`, title `SHA-256 摘要`, reversible false, cmds `['sha256', 'sha-256']`, summary: SHA-256 属 SHA-2 家族，256 位摘要，广泛用于证书与完整性校验，不可逆.

`src/algorithms/sha256/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'sha256',
  category: 'hash',
  label: 'SHA-256',
  title: 'SHA-256 摘要',
  reversible: false,
  cmds: ['sha256', 'sha-256'],
  defaultEnabled: true,
  teach: {
    summary:
      'SHA-256 属 SHA-2 家族，产生 256 位（64 位十六进制）摘要，广泛用于证书、完整性校验与区块链。不可逆，抗碰撞性强于 MD5。'
  }
}
```

`src/algorithms/sha256/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function Sha256UI({ enterPayload }: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const run = () => {
    const r = runCodec(() => window.services.crypt.sha256.digest(input))
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field label="明文" help="参与摘要的 UTF-8 文本" type="textarea" value={input} onChange={setInput} />
        <Field label="摘要 Hex" help="64 位十六进制，不可逆" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions items={[{ label: '计算', variant: 'primary', onClick: run }]} />
      <div className="ct-actions">
        <CopyButton text={output} />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/sha256/index.ts`:

```ts
import { meta } from './meta'
import Sha256UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const sha256: AlgorithmModule = { meta, Component: Sha256UI }
```

- [ ] **Step 3: Append to registry**

```ts
import { md5 } from '../algorithms/md5'
import { sha256 } from '../algorithms/sha256'

export const algorithms: AlgorithmModule[] = [base64, hex, url, md5, sha256]
```

- [ ] **Step 4: Run tsc + tests**

Run: `npx tsc --noEmit && npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/ src/registry/algorithms.ts
git commit -m "feat(algorithms): md5 and sha256 modules"
```

---

### Task 12: AES + RSA modules

**Files:**
- Create: `src/algorithms/aes/{meta,ui,index}.ts(x)`
- Create: `src/algorithms/rsa/{meta,ui,index}.ts(x)`
- Modify: `src/registry/algorithms.ts`

**Interfaces:**
- Consumes: `services.crypt.aes.*`, `services.crypt.rsa.*`
- Produces: `aes`, `rsa` modules with encrypt/decrypt actions; rsa keygen action

- [ ] **Step 1: Implement AES meta + UI**

`src/algorithms/aes/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'aes',
  category: 'symmetric',
  label: 'AES',
  title: 'AES 对称加密',
  reversible: true,
  cmds: ['aes加密', 'AES'],
  defaultEnabled: true,
  teach: {
    summary:
      'AES 是分组对称加密标准，加密与解密使用同一密钥。支持 128/192/256 位密钥；常见模式 CBC、GCM。IV 用于保证相同明文每次产出不同密文，GCM 额外提供完整性校验。'
  }
}
```

`src/algorithms/aes/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function AesUI({ enterPayload }: AlgorithmProps) {
  const [key, setKey] = useState('my-secret-key-16b')
  const [iv, setIv] = useState('random-iv-16bytes')
  const [mode, setMode] = useState('CBC')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const crypt = (dir: 'encrypt' | 'decrypt') => {
    const r = runCodec(() =>
      dir === 'encrypt'
        ? window.services.crypt.aes.encrypt({ key, iv, mode, plaintext: input })
        : window.services.crypt.aes.decrypt({ key, iv, mode, ciphertext: input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field
          label="密钥 Key"
          hint="16 / 24 / 32 字节"
          help="加密解密共用；UTF-8 字节长度决定 AES-128 / 192 / 256"
          value={key}
          onChange={setKey}
        />
        <Field
          label="模式 Mode"
          help="CBC 需相同 IV；GCM 含认证标签更安全"
          type="select"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'CBC', label: 'CBC' },
            { value: 'GCM', label: 'GCM' }
          ]}
        />
        <Field
          label="IV"
          hint="16 字节"
          help="初始化向量；建议随机，需与密文一并保存"
          value={iv}
          onChange={setIv}
        />
        <Field
          label="输入（明文或密文 Base64）"
          help="加密传明文；解密传 Base64 密文"
          type="textarea"
          value={input}
          onChange={setInput}
        />
        <Field label="输出" help="加密得 Base64 密文；解密得明文" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions
        items={[
          { label: '加密', variant: 'primary', onClick: () => crypt('encrypt') },
          { label: '解密', onClick: () => crypt('decrypt') }
        ]}
      />
      <div className="ct-actions">
        <CopyButton text={output} />
        <button
          type="button"
          className="ct-btn ct-btn-ghost"
          onClick={() => {
            setInput(output)
            setOutput('')
            setError('')
          }}
        >
          互换输入输出
        </button>
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/aes/index.ts` exports `aes: AlgorithmModule`.

- [ ] **Step 2: Implement RSA meta + UI**

`src/algorithms/rsa/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'rsa',
  category: 'asymmetric',
  label: 'RSA',
  title: 'RSA 非对称加密',
  reversible: true,
  cmds: ['rsa加密', 'RSA'],
  defaultEnabled: true,
  teach: {
    summary:
      'RSA 基于大数分解难题，公钥加密、私钥解密。本工具使用 2048 位密钥与 OAEP 填充。密钥为 PEM 文本；先生成密钥对，公钥加密、私钥解密。'
  }
}
```

`src/algorithms/rsa/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function RsaUI({ enterPayload }: AlgorithmProps) {
  const [publicKey, setPublicKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const keygen = () => {
    const r = runCodec(() => window.services.crypt.rsa.generateKeyPair())
    if (!r.ok) {
      setError(r.error)
      return
    }
    try {
      const pair = JSON.parse(r.data) as { publicKey: string; privateKey: string }
      setPublicKey(pair.publicKey)
      setPrivateKey(pair.privateKey)
      setNotice('已生成 2048 位密钥对')
      setError('')
    } catch {
      setError('密钥对解析失败')
    }
  }

  const encrypt = () => {
    const r = runCodec(() => window.services.crypt.rsa.encrypt({ publicKey, plaintext: input }))
    setError(showError(r))
    setOutput(showData(r))
  }

  const decrypt = () => {
    const r = runCodec(() => window.services.crypt.rsa.decrypt({ privateKey, ciphertext: input }))
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field label="公钥 Public Key" hint="PEM" help="用于加密；可从私钥或生成获得" type="textarea" rows={4} value={publicKey} onChange={setPublicKey} />
        <Field label="私钥 Private Key" hint="PEM" help="用于解密；勿泄露" type="textarea" rows={4} value={privateKey} onChange={setPrivateKey} />
        <Field label="输入" help="加密传明文；解密传 Base64 密文（单块）" type="textarea" value={input} onChange={setInput} />
        <Field label="输出" help="加密得 Base64；解密得明文" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions
        items={[
          { label: '生成密钥对', variant: 'ghost', onClick: keygen },
          { label: '加密', variant: 'primary', onClick: encrypt },
          { label: '解密', onClick: decrypt }
        ]}
      />
      <div className="ct-actions">
        <CopyButton text={output} />
        <CopyButton text={publicKey} label="复制公钥" />
        <CopyButton text={privateKey} label="复制私钥" />
      </div>
      {notice ? <div className="ct-field-help">{notice}</div> : null}
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/rsa/index.ts` exports `rsa`.

- [ ] **Step 3: Append registry**

```ts
import { aes } from '../algorithms/aes'
import { rsa } from '../algorithms/rsa'

export const algorithms: AlgorithmModule[] = [
  base64, hex, url, md5, sha256, aes, rsa
]
```

- [ ] **Step 4: Run tsc + tests**

Run: `npx tsc --noEmit && npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/ src/registry/algorithms.ts
git commit -m "feat(algorithms): aes and rsa modules"
```

---

### Task 13: HMAC + PBKDF2 modules + final registry array

**Files:**
- Create: `src/algorithms/hmac/{meta,ui,index}.ts(x)`
- Create: `src/algorithms/pbkdf2/{meta,ui,index}.ts(x)`
- Modify: `src/registry/algorithms.ts` → final 9-module list

**Interfaces:**
- Produces: `hmac`, `pbkdf2`; full `algorithms` array order matches category grouping

- [ ] **Step 1: Implement hmac**

`src/algorithms/hmac/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'hmac',
  category: 'hmac',
  label: 'HMAC',
  title: 'HMAC-SHA256 消息认证',
  reversible: false,
  cmds: ['hmac', 'HMAC'],
  defaultEnabled: true,
  teach: {
    summary:
      'HMAC 将密钥与消息经哈希组合，既验证完整性也证明来自持钥方。默认 SHA-256，输出十六进制认证码；比对相同认证码可确认消息未被篡改。'
  }
}
```

`src/algorithms/hmac/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function HmacUI({ enterPayload }: AlgorithmProps) {
  const [key, setKey] = useState('')
  const [algorithm, setAlgorithm] = useState('sha256')
  const [message, setMessage] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setMessage(enterPayload)
  }, [enterPayload])

  const run = () => {
    const r = runCodec(() =>
      window.services.crypt.hmac.digest({ key, message, algorithm })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field label="密钥 Key" help="参与运算的共享密钥，不能为空" value={key} onChange={setKey} />
        <Field
          label="摘要算法"
          help="HMAC 内部使用的哈希"
          type="select"
          value={algorithm}
          onChange={setAlgorithm}
          options={[
            { value: 'sha256', label: 'SHA-256' },
            { value: 'sha512', label: 'SHA-512' }
          ]}
        />
        <Field label="消息 Message" help="待认证的 UTF-8 文本" type="textarea" value={message} onChange={setMessage} />
        <Field label="认证码 Hex" help="比对可验证完整性" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions items={[{ label: '计算', variant: 'primary', onClick: run }]} />
      <div className="ct-actions">
        <CopyButton text={output} />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/hmac/index.ts`:

```ts
import { meta } from './meta'
import HmacUI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const hmac: AlgorithmModule = { meta, Component: HmacUI }
```

- [ ] **Step 2: Implement pbkdf2**

`src/algorithms/pbkdf2/meta.ts`:

```ts
import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'pbkdf2',
  category: 'kdf',
  label: 'PBKDF2',
  title: 'PBKDF2 口令派生',
  reversible: false,
  cmds: ['pbkdf2', '口令派生'],
  defaultEnabled: true,
  teach: {
    summary:
      'PBKDF2 通过多轮 HMAC 迭代将口令与随机盐派生为密钥，显著提高暴力破解成本。相同口令、盐与参数得到相同密钥；输出为十六进制。'
  }
}
```

`src/algorithms/pbkdf2/ui.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Actions, CopyButton, Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function Pbkdf2UI({ enterPayload }: AlgorithmProps) {
  const [password, setPassword] = useState('')
  const [salt, setSalt] = useState('salt')
  const [iterations, setIterations] = useState('100000')
  const [keyLength, setKeyLength] = useState('32')
  const [digest, setDigest] = useState('sha256')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setPassword(enterPayload)
  }, [enterPayload])

  const run = () => {
    const r = runCodec(() =>
      window.services.crypt.pbkdf2.derive({
        password,
        salt,
        iterations: Number(iterations) || 0,
        keyLength: Number(keyLength) || 0,
        digest
      })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-grid2">
        <Field label="口令 Password" help="用户口令" type="secret" value={password} onChange={setPassword} />
        <Field label="盐 Salt" help="随机盐；相同参数才得相同密钥" value={salt} onChange={setSalt} />
        <Field label="迭代次数" hint="≥ 1" help="越大越慢越安全，常见 10 万+" value={iterations} onChange={setIterations} />
        <Field label="密钥长度（字节）" hint="1–1024" help="派生输出字节数" value={keyLength} onChange={setKeyLength} />
        <Field
          label="摘要"
          help="PBKDF2 内部 HMAC 算法"
          type="select"
          value={digest}
          onChange={setDigest}
          options={[
            { value: 'sha1', label: 'SHA-1' },
            { value: 'sha256', label: 'SHA-256' },
            { value: 'sha512', label: 'SHA-512' }
          ]}
        />
        <Field label="派生密钥 Hex" help="十六进制编码的密钥材料" type="textarea" value={output} onChange={() => {}} readOnly />
      </div>
      <Actions items={[{ label: '派生', variant: 'primary', onClick: run }]} />
      <div className="ct-actions">
        <CopyButton text={output} />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
```

`src/algorithms/pbkdf2/index.ts`:

```ts
import { meta } from './meta'
import Pbkdf2UI from './ui'
import type { AlgorithmModule } from '../../registry/types'

export const pbkdf2: AlgorithmModule = { meta, Component: Pbkdf2UI }
```

- [ ] **Step 3: Final registry array**

```ts
import type { AlgorithmModule } from './types'
import { base64 } from '../algorithms/base64'
import { hex } from '../algorithms/hex'
import { url } from '../algorithms/url'
import { md5 } from '../algorithms/md5'
import { sha256 } from '../algorithms/sha256'
import { aes } from '../algorithms/aes'
import { rsa } from '../algorithms/rsa'
import { hmac } from '../algorithms/hmac'
import { pbkdf2 } from '../algorithms/pbkdf2'

export const algorithms: AlgorithmModule[] = [
  base64,
  hex,
  url,
  md5,
  sha256,
  aes,
  rsa,
  hmac,
  pbkdf2
]

export function getById(list: AlgorithmModule[], id: string): AlgorithmModule | undefined {
  return list.find((m) => m.meta.id === id)
}

export function getByCategory(list: AlgorithmModule[], category: import('./types').CategoryId): AlgorithmModule[] {
  return list.filter((m) => m.meta.category === category)
}

export function getEnabledList(
  list: AlgorithmModule[],
  enabled: Record<string, boolean>
): AlgorithmModule[] {
  return list.filter((m) => enabled[m.meta.id])
}

export function firstEnabledId(
  list: AlgorithmModule[],
  enabled: Record<string, boolean>
): string | null {
  const first = getEnabledList(list, enabled)[0]
  return first ? first.meta.id : null
}
```

Add test `src/registry/algorithms.test.ts` case:

```ts
import { algorithms } from './algorithms'

it('ships nine batch-1 algorithms in order', () => {
  expect(algorithms.map((m) => m.meta.id)).toEqual([
    'base64', 'hex', 'url', 'md5', 'sha256', 'aes', 'rsa', 'hmac', 'pbkdf2'
  ])
  expect(algorithms.every((m) => m.meta.defaultEnabled)).toBe(true)
})
```

Only add this test once all imports exist (this task).

- [ ] **Step 4: Run full test + tsc**

Run: `npm test && npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/ src/registry/
git commit -m "feat(algorithms): hmac pbkdf2 and full registry"
```

---

### Task 14: App integration, plugin.json, remove scaffold demos

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.css`
- Modify: `public/plugin.json`
- Delete: `src/Hello/`, `src/Read/`, `src/Write/`
- Modify: `public/preload/services.js` (optionally remove unused file helpers if nothing references them — **keep** `readFile` etc. only if unused; YAGNI: remove if no references)
- Modify: `README.md` (feature list → crypt-tool; optional in this task)

**Interfaces:**
- Consumes: `Shell`, `loadSettings`, `setEnabled`/`save` via `onSettingsChange`, `syncFeatures`, `algorithms`
- Produces: App wires `onPluginEnter` codes `crypt` | `alg:<id>`, payload prefill, settings snap-to-first-enabled

- [ ] **Step 1: Write App.tsx**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { algorithms, firstEnabledId } from './registry'
import { Shell, type ShellView } from './shell'
import { loadSettings, saveSettings, syncFeatures, type Settings } from './config'

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(algorithms))
  const [view, setView] = useState<ShellView>(() => ({
    kind: 'algorithm',
    id: firstEnabledId(algorithms, loadSettings(algorithms).enabled) ?? ''
  }))
  const [enterPayload, setEnterPayload] = useState<string | undefined>(undefined)

  useEffect(() => {
    syncFeatures(algorithms, settings.enabled)
  }, [settings.enabled])

  useEffect(() => {
    window.ztools.onPluginEnter((action: any) => {
      const code = action.code as string
      const payload =
        action.type === 'text' || action.type === 'over' || action.type === 'regex'
          ? typeof action.payload === 'string'
            ? action.payload
            : undefined
          : undefined

      if (code && code.startsWith('alg:')) {
        const id = code.slice(4)
        setEnterPayload(payload)
        setView({ kind: 'algorithm', id })
      } else {
        const id = firstEnabledId(algorithms, settings.enabled)
        setEnterPayload(payload)
        setView(id ? { kind: 'algorithm', id } : { kind: 'settings' })
      }
    })
    window.ztools.onPluginOut(() => {
      setEnterPayload(undefined)
    })
  }, [settings.enabled])

  const onSettingsChange = (s: Settings) => {
    saveSettings(s)
    setSettings(s)
    if (view.kind === 'algorithm') {
      const still = s.enabled[view.id]
      if (!still) {
        const next = firstEnabledId(algorithms, s.enabled)
        setView(next ? { kind: 'algorithm', id: next } : { kind: 'settings' })
      }
    }
  }

  const mods = useMemo(() => algorithms, [])

  return (
    <div className="ct-app">
      <Shell
        modules={mods}
        settings={settings}
        view={view}
        onViewChange={setView}
        onSettingsChange={onSettingsChange}
        enterPayload={enterPayload}
      />
    </div>
  )
}
```

Add to `src/main.css` or shared:

```css
.ct-app {
  padding: 12px;
  box-sizing: border-box;
  min-height: 100vh;
  background: transparent;
}
```

- [ ] **Step 2: Update plugin.json**

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "crypt-tool",
  "title": "CryptTool",
  "description": "加解密工具，高颜值，可自定义，UI和谐统一，带加密算法的简要指引",
  "author": "Code-Agitator",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "crypt",
      "explain": "加解密工具",
      "icon": "logo.png",
      "cmds": ["加密", "解密", "crypt"]
    }
  ]
}
```

- [ ] **Step 3: Delete scaffold demos**

```bash
git rm -r src/Hello src/Read src/Write
```

Remove unused preload file helpers only if `rg "services.readFile|writeTextFile|writeImageFile" src` is empty; otherwise keep.

- [ ] **Step 4: Build + full tests**

Run: `npm test && npm run build`  
Expected: PASS (tsc + vite + vitest)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire app shell plugin.json remove scaffold demos"
```

---

### Task 15: README + final acceptance sweep

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs)

- [ ] **Step 1: Replace README feature/structure sections**

Rewrite top sections to describe: 9 algorithms, sidebar, settings enable/disable, dynamic cmds, how to add an algorithm (point to spec §4.3), scripts `npm run dev|build|test`. Keep license/FAQ as useful. Remove hello/read/write examples.

- [ ] **Step 2: Manual smoke checklist (developer machine with ZTools)**

- [ ] `npm run dev` loads; main entry shows sidebar with 9 items grouped
- [ ] Each algorithm runs one operation successfully
- [ ] Disable AES in settings → sidebar loses AES; ZTools search loses `aes加密`
- [ ] Re-enable → command returns
- [ ] Enter via `base64` cmd with text payload → input prefilled
- [ ] Light and dark host themes readable; root has no painted background
- [ ] All-disabled → empty state opens settings

- [ ] **Step 3: Final gate**

Run: `npm test && npm run build`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: readme for crypt-tool usage and extension"
```

---

## Self-Review (plan author)

1. **Spec coverage:** shell/sidebar (T9), settings (T7/T9), dynamic features (T7/T14), 9 algorithms (T2–6,10–13), teaching copy in metas (T10–13), no page background (T8 main.css + T14 .ct-app), 40% width CSS (T8), Node crypto only (T2–6), dbStorage key (T7), remove demos (T14), tests + build (each T + T15).
2. **Placeholder scan:** All algorithm metas/UIs include full code; no TBD/TODO; SettingsPage persistence owned by parent explicitly.
3. **Type consistency:** `AlgorithmModule`, `Settings`, `ShellView`, `CryptResult`, `alg:` codes, `getEnabledList(list, enabled)` argument order fixed across tasks.
4. **Review Focus:** each line has owning tests (T2 bad base64, T4 AES validation/GCM tamper, T5 RSA wrong key, T7 feature sync + catch, T9/T14 navigation empty/disabled manual + helper unit tests).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-crypt-tool.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

**For this plan I recommend Native**, because tasks form a tight interface chain (registry types → preload envelope → config → shell → algorithm modules) that benefits from one continuous session maintaining those contracts, and a shipped mistake in envelope/feature codes would break many tasks at once. Does the plan capture what you want, and which approach should we use?
