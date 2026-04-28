import { ref } from 'vue'
import {
  generateSalt,
  deriveKey,
  encrypt,
  decrypt,
  toBase64,
  fromBase64,
} from '@/utils/crypto'
import type { EncryptionKeyMeta } from '@/types'

const KEY_CHECK_PLAINTEXT = 'ztools-mfa-key-check'
const STORAGE_KEY = 'encryption_key_meta'

const isUnlocked = ref(false)
const isFirstTime = ref(true)
const isInitialized = ref(false)

let masterKey: CryptoKey | null = null

function getStoredMeta(): EncryptionKeyMeta | null {
  try {
    const raw = window.ztools.dbStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as EncryptionKeyMeta
  } catch {
    return null
  }
}

export function useCrypto() {
  async function initialize(): Promise<void> {
    try {
      const meta = getStoredMeta()
      isFirstTime.value = meta === null
    } catch {
      isFirstTime.value = true
    }
    isInitialized.value = true
  }

  async function setupPassword(password: string): Promise<void> {
    const salt = generateSalt()
    const key = await deriveKey(password, salt)

    const { ciphertext, iv } = await encrypt(key, KEY_CHECK_PLAINTEXT)

    const meta: EncryptionKeyMeta = {
      salt: toBase64(salt.buffer as ArrayBuffer),
      keyCheckValue: ciphertext,
      iv,
    }

    window.ztools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(meta))

    masterKey = key
    isUnlocked.value = true
    isFirstTime.value = false
  }

  async function unlock(password: string): Promise<boolean> {
    const meta = getStoredMeta()
    if (!meta) return false

    const salt = new Uint8Array(fromBase64(meta.salt))
    const key = await deriveKey(password, salt)

    try {
      const plaintext = await decrypt(key, meta.keyCheckValue, meta.iv)
      if (plaintext !== KEY_CHECK_PLAINTEXT) return false
    } catch {
      return false
    }

    masterKey = key
    isUnlocked.value = true
    return true
  }

  async function encryptData(
    plaintext: string,
  ): Promise<{ ciphertext: string; iv: string }> {
    if (!masterKey) throw new Error('Vault is locked')
    return encrypt(masterKey, plaintext)
  }

  async function decryptData(
    ciphertext: string,
    iv: string,
  ): Promise<string> {
    if (!masterKey) throw new Error('Vault is locked')
    return decrypt(masterKey, ciphertext, iv)
  }

  async function changePassword(
    oldPassword: string,
    newPassword: string,
    reEncryptAccounts: (newEncryptFn: typeof encryptData) => Promise<void>,
  ): Promise<boolean> {
    const meta = getStoredMeta()
    if (!meta) return false

    const oldSalt = new Uint8Array(fromBase64(meta.salt))
    const oldKey = await deriveKey(oldPassword, oldSalt)

    try {
      const plaintext = await decrypt(oldKey, meta.keyCheckValue, meta.iv)
      if (plaintext !== KEY_CHECK_PLAINTEXT) return false
    } catch {
      return false
    }

    const newSalt = generateSalt()
    const newKey = await deriveKey(newPassword, newSalt)
    const { ciphertext: newCheckValue, iv: newIv } = await encrypt(newKey, KEY_CHECK_PLAINTEXT)

    masterKey = newKey

    await reEncryptAccounts(encryptData)

    const newMeta: EncryptionKeyMeta = {
      salt: toBase64(newSalt.buffer as ArrayBuffer),
      keyCheckValue: newCheckValue,
      iv: newIv,
    }
    window.ztools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(newMeta))

    return true
  }

  async function verifyPassword(password: string): Promise<boolean> {
    const meta = getStoredMeta()
    if (!meta) return false
    const salt = new Uint8Array(fromBase64(meta.salt))
    const key = await deriveKey(password, salt)
    try {
      const plaintext = await decrypt(key, meta.keyCheckValue, meta.iv)
      return plaintext === KEY_CHECK_PLAINTEXT
    } catch {
      return false
    }
  }

  function lock(): void {
    masterKey = null
    isUnlocked.value = false
  }

  return {
    isUnlocked,
    isFirstTime,
    isInitialized,
    initialize,
    setupPassword,
    unlock,
    changePassword,
    verifyPassword,
    encrypt: encryptData,
    decrypt: decryptData,
    lock,
  }
}
