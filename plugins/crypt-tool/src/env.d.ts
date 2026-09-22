/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type { CryptResult } from './types/crypt'

declare global {
  interface Window {
    services: {
      crypt: {
        base64: { encode: (s: string) => CryptResult; decode: (s: string) => CryptResult }
        base58: { encode: (a: { input: string }) => CryptResult; decode: (a: { input: string }) => CryptResult }
        base58check: { encode: (a: { input: string }) => CryptResult; decode: (a: { input: string }) => CryptResult<{
          valid: boolean
          data: string
        }> }
        hex: { encode: (s: string) => CryptResult; decode: (s: string) => CryptResult }
        url: { encode: (s: string) => CryptResult; decode: (s: string) => CryptResult }
        md5: { digest: (s: string) => CryptResult }
        sha1: { digest: (s: string) => CryptResult }
        sha256: { digest: (s: string) => CryptResult }
        sha512: { digest: (s: string) => CryptResult }
        sha384: { digest: (s: string) => CryptResult }
        sha3_256: { digest: (s: string) => CryptResult }
        sha3_512: { digest: (s: string) => CryptResult }
        ripemd160: { digest: (s: string) => CryptResult }
        safeBase64: { encode: (a: { input: string; stripPadding?: boolean }) => CryptResult; decode: (a: { input: string }) => CryptResult }
        base32: { encode: (a: { input: string; padding?: boolean }) => CryptResult; decode: (a: { input: string }) => CryptResult }
        aes: {
          encrypt: (a: { key: string; iv: string; mode: string; plaintext: string }) => CryptResult
          decrypt: (a: { key: string; iv: string; mode: string; ciphertext: string }) => CryptResult
        }
        chacha: {
          encrypt: (a: { key: string; nonce: string; plaintext: string }) => CryptResult
          decrypt: (a: { key: string; nonce: string; ciphertext: string }) => CryptResult
          keygen: () => CryptResult
          noncegen: () => CryptResult
        }
        des: {
          encrypt: (a: { key: string; iv: string; plaintext: string }) => CryptResult
          decrypt: (a: { key: string; iv: string; ciphertext: string }) => CryptResult
          keygen: () => CryptResult
          ivgen: () => CryptResult
        }
        rsa: {
          encrypt: (a: { publicKey: string; plaintext: string }) => CryptResult
          decrypt: (a: { privateKey: string; ciphertext: string }) => CryptResult
          generateKeyPair: () => CryptResult
        }
        ecdsa: {
          generateKeyPair: (a: { curve?: string }) => CryptResult<{ publicKey: string; privateKey: string; curve: string }>
          sign: (a: { privateKey: string; data: string; hash?: string }) => CryptResult
          verify: (a: { publicKey: string; data: string; signature: string; hash?: string }) => CryptResult<boolean>
        }
        ed25519: {
          generateKeyPair: () => CryptResult<{ publicKey: string; privateKey: string }>
          sign: (a: { privateKey: string; data: string }) => CryptResult
          verify: (a: { publicKey: string; data: string; signature: string }) => CryptResult<boolean>
        }
        hmac: {
          sign: (a: { key: string; data: string; algo: string }) => CryptResult
          verify: (a: { key: string; data: string; algo: string; signature: string }) => CryptResult<boolean>
        }
        pbkdf2: {
          derive: (a: {
            password: string
            salt: string
            iterations: number
            keylen: number
            hash: string
          }) => CryptResult
        }
        bcrypt: {
          hash: (a: { password: string; cost?: number }) => CryptResult
          verify: (a: { password: string; hash: string }) => CryptResult<boolean>
        }
        scrypt: {
          derive: (a: {
            password: string
            salt: string
            keylen?: number
            N?: number
            r?: number
            p?: number
          }) => CryptResult
          hash: (a: { password: string; salt: string; cost?: number }) => CryptResult
        }
        argon2: {
          hash: (a: {
            password: string
            type?: string
            timeCost?: number
            memoryCost?: number
            parallelism?: number
            salt?: string
            hashLength?: number
          }) => CryptResult
          verify: (a: { password: string; hash: string }) => CryptResult<boolean>
        }
        hkdf: {
          derive: (a: {
            ikm: string
            salt?: string
            info?: string
            keylen?: number
            hash?: string
          }) => CryptResult
        }
        uuid: {
          v4: () => CryptResult
          v7: () => CryptResult
          generate: (a: { version?: string; count?: number }) => CryptResult
        }
        crc32: {
          checksum: (a: { input: string }) => CryptResult
        }
        adler32: {
          checksum: (a: { input: string }) => CryptResult
        }
        randomBytes: {
          generate: (a: { length?: number; encoding?: string }) => CryptResult
        }
      }
    }
  }
}

export {}
