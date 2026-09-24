const encoding = require('./encoding')
const hash = require('./hash')
const aes = require('./aes')
const rsa = require('./rsa')
const { hmac, pbkdf2 } = require('./hmac-pbkdf2')
const { bcrypt } = require('./bcrypt')
const chacha = require('./chacha')
const ed25519 = require('./ed25519')
const scryptKdf = require('./scrypt-kdf')
const argon2 = require('./argon2')
const hkdfKdf = require('./hkdf-kdf')
const { uuid, base58, base58check, crc32 } = require('./serde-utils')
const { urlSafeBase64Encode, urlSafeBase64Decode } = require('./safe-base64')
const { base32Encode, base32Decode } = require('./base32')
const ecdsa = require('./ecdsa')
const { checksum: adler32Checksum } = require('./adler32')
const { generate: randomBytesGenerate } = require('./random-bytes')
const des = require('./des')
const { encode: unicodeEncode, decode: unicodeDecode } = require('./unicode-escape')
const { encode: htmlEncode, decode: htmlDecode } = require('./html-entity')
const { encode: punycodeEncode, decode: punycodeDecode } = require('./punycode-idn')
const { encode: morseEncode, decode: morseDecode } = require('./morse')
const { encrypt: xorEncrypt, decrypt: xorDecrypt } = require('./xor-cipher')
const ecdh = require('./ecdh')
const { decode: jwtDecode } = require('./jwt')
const { format: jsonFormat, minify: jsonMinify } = require('./text-utils')
const { analyze: passwordAnalyze } = require('./password-strength')

module.exports = {
  base64: encoding.base64,
  hex: encoding.hex,
  url: encoding.url,
  md5: hash.md5,
  sha1: hash.sha1,
  sha256: hash.sha256,
  sha384: hash.sha384,
  sha512: hash.sha512,
  sha3_256: hash.sha3_256,
  sha3_512: hash.sha3_512,
  ripemd160: hash.ripemd160,
  safeBase64: { encode: urlSafeBase64Encode, decode: urlSafeBase64Decode },
  base32: { encode: base32Encode, decode: base32Decode },
  unicodeEscape: { encode: unicodeEncode, decode: unicodeDecode },
  htmlEntity: { encode: htmlEncode, decode: htmlDecode },
  punycode: { encode: punycodeEncode, decode: punycodeDecode },
  morse: { encode: morseEncode, decode: morseDecode },
  aes,
  des,
  rsa,
  ecdsa,
  ed25519,
  ecdh,
  hmac,
  pbkdf2,
  bcrypt,
  chacha,
  scrypt: scryptKdf,
  argon2,
  hkdf: hkdfKdf,
  uuid,
  base58,
  base58check,
  crc32,
  adler32: { checksum: adler32Checksum },
  randomBytes: { generate: randomBytesGenerate },
  xorStream: { encrypt: xorEncrypt, decrypt: xorDecrypt },
  jwt: { decode: jwtDecode },
  json: { format: jsonFormat, minify: jsonMinify },
  passwordStrength: { analyze: passwordAnalyze }
}
