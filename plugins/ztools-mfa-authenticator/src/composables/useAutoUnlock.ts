const KEY_STORAGE = 'auto_unlock_key'
const DATA_STORAGE = 'auto_unlock_data'

export function useAutoUnlock() {
  function isEnabled(): boolean {
    return !!(
      window.ztools.dbStorage.getItem(KEY_STORAGE) &&
      window.ztools.dbStorage.getItem(DATA_STORAGE)
    )
  }

  async function save(password: string): Promise<void> {
    const rawKey = crypto.getRandomValues(new Uint8Array(32))
    const aesKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, [
      'encrypt',
    ])

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(password)
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded)

    const toB64 = (buf: ArrayBuffer) => {
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }

    window.ztools.dbStorage.setItem(KEY_STORAGE, toB64(rawKey.buffer as ArrayBuffer))
    window.ztools.dbStorage.setItem(
      DATA_STORAGE,
      JSON.stringify({ ciphertext: toB64(cipherBuf), iv: toB64(iv.buffer as ArrayBuffer) }),
    )
  }

  async function tryRestore(): Promise<string | null> {
    const keyB64 = window.ztools.dbStorage.getItem(KEY_STORAGE)
    const dataRaw = window.ztools.dbStorage.getItem(DATA_STORAGE)
    if (!keyB64 || !dataRaw) return null

    try {
      const fromB64 = (b64: string) => {
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes.buffer as ArrayBuffer
      }

      const rawKey = new Uint8Array(fromB64(keyB64))
      const aesKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, [
        'decrypt',
      ])

      const { ciphertext, iv } = JSON.parse(dataRaw)
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(fromB64(iv)) },
        aesKey,
        fromB64(ciphertext),
      )

      return new TextDecoder().decode(plainBuf)
    } catch {
      return null
    }
  }

  function clear(): void {
    window.ztools.dbStorage.removeItem(KEY_STORAGE)
    window.ztools.dbStorage.removeItem(DATA_STORAGE)
  }

  return { isEnabled, save, tryRestore, clear }
}
