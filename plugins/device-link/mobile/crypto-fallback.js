import { gcm } from '@noble/ciphers/aes'
import { hmac } from '@noble/hashes/hmac'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'

globalThis.deviceLinkCryptoFallback = Object.freeze({
  decrypt(key, nonce, ciphertext, associatedData) {
    return gcm(key, nonce, associatedData).decrypt(ciphertext)
  },
  encrypt(key, nonce, plaintext, associatedData) {
    return gcm(key, nonce, associatedData).encrypt(plaintext)
  },
  hmacSha256(key, message) {
    return hmac(sha256, key, message)
  },
  pbkdf2Sha256(password, salt, iterations) {
    return pbkdf2(sha256, password, salt, { c: iterations, dkLen: 32 })
  },
})
