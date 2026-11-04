'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { createCredentialStorage } = require('../public/preload/core/credential-storage')

const execFileAsync = promisify(execFile)

function testDirectory(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-credential-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function legacySeal(value, key) {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `local:${Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64')}`
}

test('missing renderer safeStorage uses a persistent local AES-GCM key', (context) => {
  const root = testDirectory(context)
  const first = createCredentialStorage({ dataDir: root, safeStorage: undefined, legacyKey: crypto.randomBytes(32) })
  const sealed = first.seal('trusted-device-secret')
  assert.match(sealed, /^local:v2:/)
  assert.equal(sealed.includes('trusted-device-secret'), false)

  const second = createCredentialStorage({ dataDir: root, safeStorage: undefined, legacyKey: crypto.randomBytes(32) })
  assert.equal(second.unseal(sealed), 'trusted-device-secret')
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(root, 'credential-key-v2')).mode & 0o777, 0o600)
  }
})

test('concurrent processes atomically install one complete local key', async (context) => {
  const root = testDirectory(context)
  const modulePath = path.resolve(__dirname, '../public/preload/core/credential-storage.js')
  const childScript = `
    const { createCredentialStorage } = require(${JSON.stringify(modulePath)})
    const [, dataDir, value] = process.argv
    const storage = createCredentialStorage({ dataDir, safeStorage: undefined, legacyKey: Buffer.alloc(32, 1) })
    process.stdout.write(storage.seal(value))
  `
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => execFileAsync(
    process.execPath,
    ['-e', childScript, root, `process-secret-${index}`],
    { encoding: 'utf8' },
  )))
  const storage = createCredentialStorage({ dataDir: root, safeStorage: undefined, legacyKey: crypto.randomBytes(32) })
  results.forEach(({ stdout }, index) => {
    assert.equal(storage.unseal(stdout), `process-secret-${index}`)
  })
  assert.equal(fs.readFileSync(path.join(root, 'credential-key-v2')).length, 32)
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith('.tmp')), [])
})

test('partial or throwing safeStorage APIs fall back to local encryption', (context) => {
  const cases = [{}, {
    isEncryptionAvailable() { throw new Error('renderer API unavailable') },
    encryptString() { throw new Error('not reached') },
    decryptString() { throw new Error('not reached') },
  }, {
    isEncryptionAvailable() { return true },
    encryptString() { throw new Error('keychain locked') },
    decryptString() { throw new Error('not reached') },
  }]

  for (const [index, safeStorage] of cases.entries()) {
    const root = path.join(testDirectory(context), String(index))
    const storage = createCredentialStorage({ dataDir: root, safeStorage, legacyKey: crypto.randomBytes(32) })
    const sealed = storage.seal(`secret-${index}`)
    assert.match(sealed, /^local:v2:/)
    assert.equal(storage.unseal(sealed), `secret-${index}`)
  }
})

test('available safeStorage keeps the system-backed credential format', (context) => {
  const root = testDirectory(context)
  const safeStorage = {
    isEncryptionAvailable() { return true },
    encryptString(value) { return Buffer.from([...Buffer.from(value)].reverse()) },
    decryptString(value) { return Buffer.from([...value].reverse()).toString('utf8') },
  }
  const storage = createCredentialStorage({ dataDir: root, safeStorage, legacyKey: crypto.randomBytes(32) })
  const sealed = storage.seal('system-secret')
  assert.match(sealed, /^safe:/)
  assert.equal(storage.unseal(sealed), 'system-secret')
  assert.equal(fs.existsSync(path.join(root, 'credential-key-v2')), false)
})

test('existing local credentials remain readable and unavailable safeStorage is classified', (context) => {
  const root = testDirectory(context)
  const legacyKey = crypto.randomBytes(32)
  const storage = createCredentialStorage({ dataDir: root, safeStorage: undefined, legacyKey })
  assert.equal(storage.unseal(legacySeal('legacy-secret', legacyKey)), 'legacy-secret')
  assert.throws(
    () => storage.unseal(`safe:${Buffer.from('ciphertext').toString('base64')}`),
    (error) => error.code === 'CREDENTIAL_BACKEND_UNAVAILABLE',
  )
  const temporarilyUnavailable = createCredentialStorage({
    dataDir: root,
    legacyKey,
    safeStorage: {
      isEncryptionAvailable() { return true },
      encryptString(value) { return Buffer.from(value) },
      decryptString() { throw new Error('keychain is locked') },
    },
  })
  assert.throws(
    () => temporarilyUnavailable.unseal(`safe:${Buffer.from('ciphertext').toString('base64')}`),
    (error) => error.code === 'CREDENTIAL_BACKEND_UNAVAILABLE',
  )
  assert.throws(
    () => storage.unseal('local:v2:not-valid-ciphertext'),
    (error) => error.code === 'CREDENTIAL_INVALID',
  )
})

test('local:v2 credentials remain readable across the 2.4–3.1 and 3.2 data-directory boundary', (context) => {
  const root = testDirectory(context)
  const legacyDataDir = path.join(root, 'userData', 'device-link')
  const pluginDataDir = path.join(root, 'pluginData')
  const legacy = createCredentialStorage({ dataDir: legacyDataDir, safeStorage: undefined, legacyKey: crypto.randomBytes(32) })
  const beforeUpgrade = legacy.seal('trusted-before-upgrade')
  const modern = createCredentialStorage({
    dataDir: pluginDataDir,
    safeStorage: undefined,
    legacyKey: crypto.randomBytes(32),
    localKeyDataDir: legacyDataDir,
    fallbackLocalKeyDataDirs: [pluginDataDir],
  })

  assert.equal(modern.unseal(beforeUpgrade), 'trusted-before-upgrade')
  const beforeDowngrade = modern.seal('trusted-before-downgrade')
  assert.equal(legacy.unseal(beforeDowngrade), 'trusted-before-downgrade')
  assert.equal(fs.existsSync(path.join(pluginDataDir, 'credential-key-v2')), false)
})

test('3.2 safely falls back to a previously-created pluginData local:v2 key', (context) => {
  const root = testDirectory(context)
  const legacyDataDir = path.join(root, 'userData', 'device-link')
  const pluginDataDir = path.join(root, 'pluginData')
  const early32 = createCredentialStorage({ dataDir: pluginDataDir, safeStorage: undefined, legacyKey: crypto.randomBytes(32) })
  const earlyCredential = early32.seal('trusted-early-3.2')
  const modern = createCredentialStorage({
    dataDir: pluginDataDir,
    safeStorage: undefined,
    legacyKey: crypto.randomBytes(32),
    localKeyDataDir: legacyDataDir,
    fallbackLocalKeyDataDirs: [pluginDataDir],
  })

  assert.equal(modern.unseal(earlyCredential), 'trusted-early-3.2')
  const downgradeCredential = modern.seal('trusted-after-migration')
  const legacy = createCredentialStorage({ dataDir: legacyDataDir, safeStorage: undefined, legacyKey: crypto.randomBytes(32) })
  assert.equal(legacy.unseal(downgradeCredential), 'trusted-after-migration')
})
