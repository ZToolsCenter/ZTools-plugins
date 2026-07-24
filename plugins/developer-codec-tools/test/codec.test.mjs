import assert from 'node:assert/strict'
import test from 'node:test'
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  binaryToBytes,
  bytesToBinary,
  bytesToHex,
  bytesToText,
  decodeJwt,
  digestHex,
  formatJson,
  hexToBytes,
  hmacHex,
  htmlDecode,
  htmlEncode,
  md5,
  minifyJson,
  textToBytes,
  unicodeEscapeDecode,
  unicodeEscapeEncode,
  urlDecode,
  urlEncode,
  verifyJwtHs
} from '../codec.js'

test('base64 handles utf-8 text', () => {
  const text = 'hello 你好'
  assert.equal(base64Decode(base64Encode(text)), text)
})

test('base64url handles utf-8 text', () => {
  const text = 'a/b+c? 你好'
  const encoded = base64UrlEncode(text)
  assert.equal(encoded.includes('+'), false)
  assert.equal(encoded.includes('/'), false)
  assert.equal(base64UrlDecode(encoded), text)
})

test('hex and binary roundtrip utf-8 bytes', () => {
  const text = 'dev 工具'
  const hex = bytesToHex(textToBytes(text))
  assert.equal(bytesToText(hexToBytes(hex)), text)

  const binary = bytesToBinary(textToBytes(text))
  assert.equal(bytesToText(binaryToBytes(binary)), text)
})

test('url and html conversion', () => {
  const urlText = 'name=张三&role=dev tool'
  assert.equal(urlDecode(urlEncode(urlText)), urlText)

  const html = '<a title="x&y">hi</a>'
  assert.equal(htmlDecode(htmlEncode(html)), html)
})

test('unicode escape conversion', () => {
  const encoded = unicodeEscapeEncode('hello 你好')
  assert.equal(encoded, 'hello \\u4f60\\u597d')
  assert.equal(unicodeEscapeDecode(encoded), 'hello 你好')
})

test('json format and minify', () => {
  const compact = '{"b":2,"a":1}'
  assert.equal(formatJson(compact), '{\n  "b": 2,\n  "a": 1\n}')
  assert.equal(minifyJson(formatJson(compact)), compact)
})

test('md5 and sha256 digest', async () => {
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(await digestHex('MD5', 'abc'), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(
    await digestHex('SHA-256', 'abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})

test('hmac sha256', async () => {
  assert.equal(
    await hmacHex('SHA-256', 'abc', 'secret'),
    '9946dad4e00e913fc8be8e5d3f7e110a4a9e832f83fb09c345285d78638d8a0e'
  )
})

test('jwt decode and hs256 verify', async () => {
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiSm9obiJ9.GjA3qJod-V7bWgXvYQNZRynF7HeINz_x1fpbKHRzMSo'
  const decoded = decodeJwt(token)
  assert.equal(decoded.header.alg, 'HS256')
  assert.equal(decoded.payload.name, 'John')
  assert.equal(await verifyJwtHs(token, 'secret'), true)
  assert.equal(await verifyJwtHs(token, 'wrong'), false)
})
