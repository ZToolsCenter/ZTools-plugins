import type { AlgorithmModule, CategoryId } from './types'
import { base64 } from '../algorithms/base64'
import { hex } from '../algorithms/hex'
import { url } from '../algorithms/url'
import { md5 } from '../algorithms/md5'
import { sha1 } from '../algorithms/sha1'
import { sha256 } from '../algorithms/sha256'
import { sha512 } from '../algorithms/sha512'
import { base58 } from '../algorithms/base58'
import { aes } from '../algorithms/aes'
import { chacha } from '../algorithms/chacha'
import { rsa } from '../algorithms/rsa'
import { ed25519 } from '../algorithms/ed25519'
import { hmac } from '../algorithms/hmac'
import { pbkdf2 } from '../algorithms/pbkdf2'
import { bcrypt } from '../algorithms/bcrypt'
import { scrypt } from '../algorithms/scrypt'
import { argon2 } from '../algorithms/argon2'
import { hkdf } from '../algorithms/hkdf'
import { uuid } from '../algorithms/uuid'
import { crc32 } from '../algorithms/crc32'
import { sha384 } from '../algorithms/sha384'
import { sha3_256 } from '../algorithms/sha3_256'
import { sha3_512 } from '../algorithms/sha3_512'
import { ripemd160 } from '../algorithms/ripemd160'
import { safeBase64 } from '../algorithms/safeBase64'
import { base32 } from '../algorithms/base32'
import { ecdsa } from '../algorithms/ecdsa'
import { adler32 } from '../algorithms/adler32'
import { randomBytes } from '../algorithms/randomBytes'
import { des } from '../algorithms/des'

export const algorithms: AlgorithmModule[] = [
  base64,
  base58,
  hex,
  url,
  md5,
  sha1,
  sha256,
  sha512,
  sha384,
  sha3_256,
  sha3_512,
  ripemd160,
  aes,
  chacha,
  des,
  rsa,
  ed25519,
  ecdsa,
  hmac,
  pbkdf2,
  bcrypt,
  scrypt,
  argon2,
  hkdf,
  uuid,
  crc32,
  adler32,
  randomBytes,
  safeBase64,
  base32
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
