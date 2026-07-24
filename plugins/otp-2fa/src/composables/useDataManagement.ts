import { ref } from 'vue'
import { STORAGE_KEY, CONFIG_KEY } from '../constants'
import { encryptSecret, decryptSecret, deriveKey, exportKey, hashVerifier } from '../utils/crypto'

export interface ExportData {
  version: string
  timestamp: number
  salt: string
  accounts: any[]
}

export function useDataManagement() {
  const showImportModal = ref(false)
  const importDataInput = ref('')
  const importPasswordInput = ref('')
  const importDataError = ref('')
  const importPasswordError = ref('')

  /**
   * 导出数据为加密密文，写入剪贴板
   * 格式: MasterSalt(Base64):IV(Base64):Ciphertext(Base64)
   */
  const exportData = async (accounts: any[], masterSalt: string | null, masterKey: CryptoKey | null) => {
    const z = (window as any).ztools
    if (!z?.copyText) return

    try {
      if (!masterKey) throw new Error('主密钥不可用')
      if (!masterSalt) throw new Error('主密码盐值不可用')

      const dataToExport = JSON.parse(JSON.stringify(accounts))
      for (const acc of dataToExport) {
        if (!acc.encrypted) {
          acc.secret = await encryptSecret(acc.secret, masterKey)
          acc.encrypted = true
        }
      }

      const exportPayload: ExportData = {
        version: '1.0',
        timestamp: Date.now(),
        salt: masterSalt,
        accounts: dataToExport
      }

      const encryptedPayload = await encryptSecret(JSON.stringify(exportPayload), masterKey)
      const exportString = masterSalt + ':' + encryptedPayload

      z.copyText(exportString)
      z.showNotification('数据已复制到剪贴板')
    } catch (e) {
      z?.showNotification?.('数据导出失败：' + (e as Error).message)
    }
  }

  /**
   * 打开导入模态框
   */
  const importData = async () => {
    importDataInput.value = ''
    importPasswordInput.value = ''
    importDataError.value = ''
    importPasswordError.value = ''
    showImportModal.value = true
  }

  /**
   * 验证并应用导入数据
   */
  const verifyAndApplyImportData = async (
    dataString: string,
    password: string,
    accounts: any[],
    masterSalt: any,
    masterKey: any,
    config: any,
    getHardwareKey?: () => Promise<CryptoKey>
  ) => {
    const z = (window as any).ztools

    // 每次调用先清除上次的错误，保证重试干净
    importDataError.value = ''
    importPasswordError.value = ''

    try {
      // 1. 数据非空
      if (!dataString.trim()) {
        importDataError.value = '数据不能为空'
        return
      }

      // 2. 密码非空
      if (!password.trim()) {
        importPasswordError.value = '主密码不能为空'
        return
      }

      const raw = dataString.trim()

      // 3. 格式校验：Base64 字符 + 冒号
      if (!/^[A-Za-z0-9+/=:]+$/.test(raw)) {
        importDataError.value = '数据错误，请检查后重新粘贴'
        return
      }

      // 拆分：第一段是 masterSalt，剩余是 IV:Ciphertext
      const firstColon = raw.indexOf(':')
      const secondColon = raw.indexOf(':', firstColon + 1)
      if (firstColon === -1 || secondColon === -1) {
        importDataError.value = '数据错误，请检查后重新粘贴'
        return
      }

      const saltBase64 = raw.substring(0, firstColon)
      const encryptedPayload = raw.substring(firstColon + 1)

      // 4. 用 salt + 密码 派生密钥
      let saltBuf: Uint8Array
      try {
        saltBuf = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0))
      } catch (e) {
        importDataError.value = '数据错误，请检查后重新粘贴'
        return
      }

      const derivedKey = await deriveKey(password, saltBuf)

      // 5. 解密外层 payload
      let decryptedJson: string
      try {
        decryptedJson = await decryptSecret(encryptedPayload, derivedKey)
      } catch (e) {
        importPasswordError.value = '主密码错误'
        return
      }

      // 6. 解析 JSON
      let importedData: ExportData
      try {
        importedData = JSON.parse(decryptedJson)
      } catch (e) {
        importDataError.value = '数据错误，请检查后重新粘贴'
        return
      }

      // 7. 校验结构
      if (!importedData.version || !Array.isArray(importedData.accounts)) {
        importDataError.value = '数据错误，请检查后重新粘贴'
        return
      }

      // 8. 校验结构通过，直接使用导出时已加密的账户数据
      // importedData.accounts 在导出时已用主密钥加密，无需解密后再存储
      const encryptedAccounts = importedData.accounts

      // 9. 应用数据：内存中保持解密状态供 UI 使用
      masterSalt.value = saltBase64
      masterKey.value = derivedKey

      // 解密账户供内存使用
      const decryptedAccounts = JSON.parse(JSON.stringify(importedData.accounts))
      for (const acc of decryptedAccounts) {
        if (acc.encrypted && acc.secret.includes(':')) {
          acc.secret = await decryptSecret(acc.secret, derivedKey)
          acc.encrypted = false
        }
      }

      accounts.length = 0
      accounts.push(...decryptedAccounts)

      // 生成 verifier 和 hardwareEncryptedKey，确保重启后验证流程正常
      const rawKey = await exportKey(derivedKey)
      const verifier = await hashVerifier(rawKey)
      let hwEncrypted: string | undefined
      if (getHardwareKey) {
        try {
          const hwKey = await getHardwareKey()
          hwEncrypted = await encryptSecret(rawKey, hwKey)
        } catch (e) {
          console.error('Hardware key encryption failed', e)
        }
      }

      let conf = null
      try { conf = z.db.get(CONFIG_KEY) } catch(e){}
      z.db.put({
        ...conf, ...config,
        _id: CONFIG_KEY,
        _rev: conf ? conf._rev : undefined,
        salt: saltBase64,
        verifier: verifier,
        ...(hwEncrypted ? { hardwareEncryptedKey: hwEncrypted } : {}),
        timerStyle: config.timerStyle || 'bar',
        nextPreview: config.nextPreview ?? true
      })

      // 数据库存储加密后的原始数据
      let existing = null
      try { existing = z.db.get(STORAGE_KEY) } catch(e){}
      z.db.put({
        _id: STORAGE_KEY,
        _rev: existing ? existing._rev : undefined,
        data: encryptedAccounts
      })

      showImportModal.value = false
      z.showNotification('数据导入成功')
    } catch (e) {
      if (!importDataError.value && !importPasswordError.value) {
        importDataError.value = '导入失败：' + (e as Error).message
      }
    }
  }

  const cancelImport = () => {
    showImportModal.value = false
    importDataInput.value = ''
    importPasswordInput.value = ''
    importDataError.value = ''
    importPasswordError.value = ''
  }

  return {
    showImportModal,
    importDataInput,
    importPasswordInput,
    importDataError,
    importPasswordError,
    exportData,
    importData,
    verifyAndApplyImportData,
    cancelImport
  }
}
