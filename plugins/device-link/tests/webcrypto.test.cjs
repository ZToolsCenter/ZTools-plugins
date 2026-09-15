'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { webcrypto } = require('node:crypto')
const { gcm } = require('@noble/ciphers/aes')
const { hmac } = require('@noble/hashes/hmac')
const { pbkdf2 } = require('@noble/hashes/pbkdf2')
const { sha256 } = require('@noble/hashes/sha256')
const { decryptBytes, derivePairKey, encryptBytes, pairingProof, randomId } = require('../public/preload/core/crypto')

const encoder = new TextEncoder()

function nodeEnvelope(iv, webCryptoBody) {
  const body = new Uint8Array(webCryptoBody)
  const tag = body.slice(body.length - 16)
  const ciphertext = body.slice(0, -16)
  const output = new Uint8Array(28 + ciphertext.length)
  output.set(iv)
  output.set(tag, 12)
  output.set(ciphertext, 28)
  return output
}

function webCryptoEnvelope(nodeBytes) {
  const bytes = new Uint8Array(nodeBytes)
  const ciphertext = bytes.slice(28)
  const tag = bytes.slice(12, 28)
  const body = new Uint8Array(ciphertext.length + 16)
  body.set(ciphertext)
  body.set(tag, ciphertext.length)
  return { iv: bytes.slice(0, 12), body }
}

test('browser WebCrypto envelopes interoperate with Node encryption', async () => {
  const keyBytes = Buffer.from(randomId(32), 'base64url')
  const browserKey = await webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  const aad = 'device-link:interop'
  const message = encoder.encode('phone to desktop')

  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const browserBody = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, browserKey, message)
  assert.equal(decryptBytes(keyBytes, nodeEnvelope(iv, browserBody), aad).toString(), 'phone to desktop')

  const nodeBody = encryptBytes(keyBytes, Buffer.from('desktop to phone'), aad)
  const envelope = webCryptoEnvelope(nodeBody)
  const browserPlain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.iv, additionalData: encoder.encode(aad) }, browserKey, envelope.body)
  assert.equal(Buffer.from(browserPlain).toString(), 'desktop to phone')
})

test('insecure-context Noble fallback matches pairing proof and Node AES-GCM envelopes', () => {
  const secret = randomId(32)
  const salt = randomId(16)
  const fallbackKey = pbkdf2(sha256, encoder.encode(`${secret}:834921`), Buffer.from(salt, 'base64url'), { c: 210000, dkLen: 32 })
  const nodeKey = derivePairKey(secret, '834921', salt)
  assert.deepEqual(Buffer.from(fallbackKey), nodeKey)

  const proof = hmac(sha256, fallbackKey, encoder.encode('device-link-pair-v1:session:challenge'))
  assert.equal(Buffer.from(proof).toString('base64url'), pairingProof(nodeKey, 'session', 'challenge'))

  const aad = 'device-link:fallback'
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const message = encoder.encode('fallback phone to desktop')
  const fallbackBody = gcm(fallbackKey, iv, encoder.encode(aad)).encrypt(message)
  assert.equal(decryptBytes(nodeKey, nodeEnvelope(iv, fallbackBody), aad).toString(), 'fallback phone to desktop')

  const nodeBody = encryptBytes(nodeKey, Buffer.from('desktop to fallback phone'), aad)
  const envelope = webCryptoEnvelope(nodeBody)
  const fallbackPlain = gcm(fallbackKey, envelope.iv, encoder.encode(aad)).decrypt(envelope.body)
  assert.equal(Buffer.from(fallbackPlain).toString(), 'desktop to fallback phone')
})
