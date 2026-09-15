'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  decryptBytes,
  decryptJson,
  derivePairKey,
  encryptBytes,
  encryptJson,
  pairingProof,
  randomId,
  secureEqual,
  sha256,
  sha256File,
} = require('../public/preload/core/crypto')

test('pair proof depends on both QR secret and matching code', () => {
  const secret = randomId(32)
  const salt = randomId(16)
  const correct = derivePairKey(secret, '834921', salt)
  const wrong = derivePairKey(secret, '834922', salt)
  const proof = pairingProof(correct, 'session', 'challenge')
  assert.equal(secureEqual(proof, pairingProof(correct, 'session', 'challenge')), true)
  assert.equal(secureEqual(proof, pairingProof(wrong, 'session', 'challenge')), false)
})

test('AES-GCM envelopes round-trip JSON and reject modified AAD', () => {
  const key = Buffer.from(randomId(32), 'base64url')
  const envelope = encryptJson(key, { text: '设备互联', count: 2 }, 'message:1')
  assert.deepEqual(decryptJson(key, envelope, 'message:1'), { text: '设备互联', count: 2 })
  assert.throws(() => decryptJson(key, envelope, 'message:2'))
})

test('AES-GCM binary envelope rejects tampering', () => {
  const key = Buffer.from(randomId(32), 'base64url')
  const envelope = encryptBytes(key, Buffer.from('hello'), 'chunk:0')
  envelope[envelope.length - 1] ^= 1
  assert.throws(() => decryptBytes(key, envelope, 'chunk:0'))
})

test('large file hashing streams from disk and matches an in-memory digest', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-hash-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filePath = path.join(root, 'large.bin')
  const content = Buffer.alloc(12 * 1024 * 1024 + 17, 0xa5)
  fs.writeFileSync(filePath, content)
  assert.equal(await sha256File(filePath), sha256(content))
})
