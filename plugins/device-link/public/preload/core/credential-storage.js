'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16
const LOCAL_V2_PREFIX = 'local:v2:'

function credentialError(code, message, cause) {
  const error = new Error(message)
  error.name = code === 'CREDENTIAL_INVALID' ? 'CredentialInvalidError' : 'CredentialStorageUnavailableError'
  error.code = code
  if (cause) error.cause = cause
  return error
}

function unavailable(message, cause) {
  return credentialError('CREDENTIAL_BACKEND_UNAVAILABLE', message, cause)
}

function invalid(cause) {
  return credentialError('CREDENTIAL_INVALID', '设备授权凭据无效', cause)
}

function hasSafeStorageApi(safeStorage) {
  return Boolean(
    safeStorage
      && typeof safeStorage.isEncryptionAvailable === 'function'
      && typeof safeStorage.encryptString === 'function'
      && typeof safeStorage.decryptString === 'function',
  )
}

function decryptAesGcm(encoded, key) {
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length <= NONCE_BYTES + TAG_BYTES) throw invalid()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, NONCE_BYTES))
  decipher.setAuthTag(bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES))
  return Buffer.concat([
    decipher.update(bytes.subarray(NONCE_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8')
}

function encryptAesGcm(value, key) {
  const nonce = crypto.randomBytes(NONCE_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64')
}

function createCredentialStorage({
  dataDir,
  safeStorage,
  legacyKey,
  localKeyDataDir = dataDir,
  fallbackLocalKeyDataDirs = [],
}) {
  if (!dataDir) throw new TypeError('dataDir is required')
  if (!localKeyDataDir) throw new TypeError('localKeyDataDir is required')
  const keyPath = path.join(localKeyDataDir, 'credential-key-v2')
  const fallbackKeyPaths = [...new Set(fallbackLocalKeyDataDirs
    .filter((directory) => typeof directory === 'string' && directory)
    .map((directory) => path.join(directory, 'credential-key-v2')))]
    .filter((candidate) => candidate !== keyPath)
  let cachedLocalKey = null

  function readLocalKeyAt(candidate) {
    const stat = fs.lstatSync(candidate)
    if (!stat.isFile() || stat.isSymbolicLink()) throw unavailable('本机设备授权密钥路径无效')
    const key = fs.readFileSync(candidate)
    if (key.length !== KEY_BYTES) throw unavailable('本机设备授权密钥无效')
    try { fs.chmodSync(candidate, 0o600) } catch {}
    return key
  }

  function readLocalKey() {
    return readLocalKeyAt(keyPath)
  }

  function localKey() {
    if (cachedLocalKey) return cachedLocalKey
    try {
      cachedLocalKey = readLocalKey()
      return cachedLocalKey
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error?.code === 'CREDENTIAL_BACKEND_UNAVAILABLE') throw error
        throw unavailable('无法读取本机设备授权密钥', error)
      }
    }

    const generated = crypto.randomBytes(KEY_BYTES)
    const temporaryPath = path.join(localKeyDataDir, `.credential-key-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`)
    try {
      fs.mkdirSync(localKeyDataDir, { recursive: true })
      const descriptor = fs.openSync(temporaryPath, 'wx', 0o600)
      try {
        let offset = 0
        while (offset < generated.length) {
          const bytesWritten = fs.writeSync(descriptor, generated, offset, generated.length - offset, null)
          if (bytesWritten <= 0) throw new Error('credential key write made no progress')
          offset += bytesWritten
        }
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
      // A hard link publishes the already-complete key atomically and, unlike
      // rename on POSIX, never overwrites a key installed by another process.
      try {
        fs.linkSync(temporaryPath, keyPath)
        cachedLocalKey = generated
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        cachedLocalKey = readLocalKey()
      }
    } catch (error) {
      if (error?.code === 'CREDENTIAL_BACKEND_UNAVAILABLE') throw error
      throw unavailable('无法创建本机设备授权密钥', error)
    } finally {
      try { fs.unlinkSync(temporaryPath) } catch {}
    }
    return cachedLocalKey
  }

  function localKeysForUnseal() {
    const keys = [localKey()]
    for (const fallbackPath of fallbackKeyPaths) {
      try {
        keys.push(readLocalKeyAt(fallbackPath))
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        throw error
      }
    }
    return keys
  }

  function seal(value) {
    if (!value) return ''
    const plain = String(value)
    if (hasSafeStorageApi(safeStorage)) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = Buffer.from(safeStorage.encryptString(plain))
          if (encrypted.length > 0) return `safe:${encrypted.toString('base64')}`
        }
      } catch {
        // Renderer/preload implementations may expose only part of Electron's
        // main-process safeStorage API. Fall through to the local key backend.
      }
    }
    try {
      return `${LOCAL_V2_PREFIX}${encryptAesGcm(plain, localKey())}`
    } catch (error) {
      if (error?.code === 'CREDENTIAL_BACKEND_UNAVAILABLE') throw error
      throw unavailable('无法加密设备授权凭据', error)
    }
  }

  function unseal(value) {
    if (!value) return ''
    const sealed = String(value)
    if (sealed.startsWith('safe:')) {
      if (!hasSafeStorageApi(safeStorage)) throw unavailable('系统安全存储在当前运行环境中不可用')
      let available
      try {
        available = safeStorage.isEncryptionAvailable()
      } catch (error) {
        throw unavailable('无法访问系统安全存储', error)
      }
      if (!available) throw unavailable('系统安全存储暂时不可用')
      try {
        const plain = safeStorage.decryptString(Buffer.from(sealed.slice(5), 'base64'))
        if (typeof plain !== 'string' || !plain) throw invalid()
        return plain
      } catch (error) {
        if (error?.code === 'CREDENTIAL_INVALID') throw error
        // safeStorage does not distinguish a corrupt ciphertext from a
        // temporarily unavailable keychain. Preserve the phone credential and
        // let the user retry or manually re-pair instead of deleting it.
        throw unavailable('系统安全存储暂时无法解密设备授权', error)
      }
    }
    if (sealed.startsWith(LOCAL_V2_PREFIX)) {
      try {
        const encoded = sealed.slice(LOCAL_V2_PREFIX.length)
        let lastError
        for (const key of localKeysForUnseal()) {
          try {
            return decryptAesGcm(encoded, key)
          } catch (error) {
            lastError = error
          }
        }
        throw lastError || invalid()
      } catch (error) {
        if (error?.code === 'CREDENTIAL_BACKEND_UNAVAILABLE' || error?.code === 'CREDENTIAL_INVALID') throw error
        throw invalid(error)
      }
    }
    if (sealed.startsWith('local:')) {
      if (!Buffer.isBuffer(legacyKey) || legacyKey.length !== KEY_BYTES) throw invalid()
      try {
        return decryptAesGcm(sealed.slice(6), legacyKey)
      } catch (error) {
        if (error?.code === 'CREDENTIAL_INVALID') throw error
        throw invalid(error)
      }
    }
    return ''
  }

  return { seal, unseal }
}

module.exports = { createCredentialStorage, hasSafeStorageApi }
