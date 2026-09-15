'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isPrivateAddress,
  safeFilename,
  validatePairingCode,
  validateWebDavUrl,
} = require('../public/preload/core/validation')

test('pairing code rejects short and trivial values', () => {
  assert.equal(validatePairingCode('834921'), '834921')
  assert.throws(() => validatePairingCode('1234'))
  assert.throws(() => validatePairingCode('111111'))
  assert.throws(() => validatePairingCode('123456'))
})

test('LAN address filter accepts private ranges only', () => {
  for (const address of ['127.0.0.1', '::1', '10.1.2.3', '172.16.0.1', '172.31.255.2', '192.168.20.5']) assert.equal(isPrivateAddress(address), true)
  for (const address of ['8.8.8.8', '172.32.0.1', '1.1.1.1', 'not-an-ip']) assert.equal(isPrivateAddress(address), false)
})

test('WebDAV requires HTTPS except loopback and pins its directory', () => {
  assert.equal(validateWebDavUrl('https://dav.example.com/team/'), 'https://dav.example.com/team/device-link-v1/')
  assert.equal(validateWebDavUrl('http://localhost:8080/dav'), 'http://localhost:8080/dav/device-link-v1/')
  assert.throws(() => validateWebDavUrl('http://dav.example.com/team'))
  assert.throws(() => validateWebDavUrl('https://user:pass@dav.example.com/team'))
})

test('filenames cannot escape receiving directory', () => {
  assert.equal(safeFilename('../../secret.txt'), 'secret.txt')
  assert.equal(safeFilename('bad:name?.txt'), 'bad_name_.txt')
})
