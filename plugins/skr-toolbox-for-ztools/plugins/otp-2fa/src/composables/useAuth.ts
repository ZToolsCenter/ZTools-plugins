import { ref } from 'vue'
import { 
  deriveKey, encryptSecret, decryptSecret, 
  generateSalt, exportKey, importKeyFromRaw, hashVerifier 
} from '../utils/crypto'
import { CONFIG_KEY, STORAGE_KEY } from '../constants'

export function useAuth() {
  const masterKey = ref<CryptoKey | null>(null)
  const masterSalt = ref<string | null>(null) // Base64
  const lastAuthTime = ref(0)
  
  const showSetPasswordModal = ref(false)
  const showVerifyPasswordModal = ref(false)
  const passwordInput = ref('')
  const confirmPasswordInput = ref('')
  const passwordErrorMsg = ref('')
  const verifyErrorMsg = ref('')
  const verifyInput = ref<HTMLInputElement | null>(null)
  const pendingAction = ref<(() => void | Promise<void>) | null>(null)

  const getHardwareKey = async () => {
    const z = (window as any).ztools
    const nativeId = z.getNativeId()
    const hwSalt = new Uint8Array([90, 84, 111, 111, 108, 115, 45, 72, 97, 114, 100, 119, 97, 114, 101]) // "ZTools-Hardware"
    return await deriveKey(nativeId, hwSalt)
  }

  const tryAutoUnlock = async () => {
    const z = (window as any).ztools
    if (!masterSalt.value) return
    
    try {
      let rawKey: string | null = null
      const doc = z.db.get(CONFIG_KEY)
      const storedVerifier = doc?.verifier

      const encrypted = doc?.hardwareEncryptedKey
      if (encrypted) {
        const hwKey = await getHardwareKey()
        rawKey = await decryptSecret(encrypted, hwKey)
      }

      if (rawKey && storedVerifier) {
        const currentVerifier = await hashVerifier(rawKey)
        if (currentVerifier === storedVerifier) {
          masterKey.value = await importKeyFromRaw(rawKey)
        }
      }
    } catch (e) {
      console.error('Auto unlock failed', e)
    }
  }

  const setMasterPassword = async (config: any, onComplete?: () => Promise<void>) => {
    if (passwordInput.value !== confirmPasswordInput.value) {
      passwordErrorMsg.value = '两次输入的密码不一致'
      return
    }
    if (passwordInput.value.length < 4) {
      passwordErrorMsg.value = '密码长度至少为 4 位'
      return
    }

    try {
      if (!masterSalt.value) masterSalt.value = btoa(String.fromCharCode(...generateSalt()))
      
      const saltBuf = Uint8Array.from(atob(masterSalt.value), c => c.charCodeAt(0))
      masterKey.value = await deriveKey(passwordInput.value, saltBuf)
      
      const rawKey = await exportKey(masterKey.value)
      const hwKey = await getHardwareKey()
      const hwEncrypted = await encryptSecret(rawKey, hwKey)
      const verifier = await hashVerifier(rawKey)
      
      const z = (window as any).ztools
      let conf = null
      try { conf = z.db.get(CONFIG_KEY) } catch(e){}
      z.db.put({
        ...config,
        _id: CONFIG_KEY,
        _rev: conf ? conf._rev : undefined,
        salt: masterSalt.value,
        verifier: verifier,
        hardwareEncryptedKey: hwEncrypted
      })

      showSetPasswordModal.value = false
      lastAuthTime.value = Date.now()
      
      if (onComplete) await onComplete()
      
      if (pendingAction.value) {
        await pendingAction.value()
        pendingAction.value = null
      }
    } catch (e) {
      passwordErrorMsg.value = '密码设置失败: ' + e
    }
  }

  const verifyMasterPassword = async (onComplete?: () => Promise<void>) => {
    try {
      const saltBuf = Uint8Array.from(atob(masterSalt.value!), c => c.charCodeAt(0))
      const testKey = await deriveKey(passwordInput.value, saltBuf)
      const testRaw = await exportKey(testKey)
      
      const z = (window as any).ztools
      const doc = z.db.get(CONFIG_KEY)
      const storedVerifier = doc?.verifier
      
      if (!storedVerifier) throw new Error('无效的配置数据，请重新设置主密码')
      
      const testVerifier = await hashVerifier(testRaw)
      
      if (testVerifier === storedVerifier) {
        masterKey.value = testKey
        lastAuthTime.value = Date.now()
        
        const hwKey = await getHardwareKey()
        const hwEnc = await encryptSecret(testRaw, hwKey)
        z.db.put({ ...doc, hardwareEncryptedKey: hwEnc })
        
        showVerifyPasswordModal.value = false
        
        if (onComplete) await onComplete()

        if (pendingAction.value) {
          await pendingAction.value()
          pendingAction.value = null
        }
      } else {
        verifyErrorMsg.value = '密码错误'
      }
    } catch (e: any) {
      verifyErrorMsg.value = e.message || '验证失败'
    }
  }

  const clearAuthData = () => {
    masterKey.value = null
    masterSalt.value = null
    lastAuthTime.value = 0
    passwordInput.value = ''
    confirmPasswordInput.value = ''
  }

  const changeMasterPassword = async (
    currentPwd: string,
    newPwd: string,
    confirmPwd: string,
    accounts: any[],
    onCurrentError: (msg: string) => void,
    onNewError: (msg: string) => void,
    onConfirmError: (msg: string) => void
  ) => {
    onCurrentError(''); onNewError(''); onConfirmError('')

    // 验证新密码格式
    if (newPwd.length < 4) { onNewError('密码长度至少为 4 位'); return }
    if (newPwd !== confirmPwd) { onConfirmError('两次输入的密码不一致'); return }

    const z = (window as any).ztools
    try {
      // 验证当前密码
      if (!masterSalt.value) { onCurrentError('当前无主密码'); return }
      const saltBuf = Uint8Array.from(atob(masterSalt.value), c => c.charCodeAt(0))
      const testKey = await deriveKey(currentPwd, saltBuf)
      const testRaw = await exportKey(testKey)
      const doc = z.db.get(CONFIG_KEY)
      const storedVerifier = doc?.verifier
      if (!storedVerifier) { onCurrentError('配置数据异常'); return }
      const testVerifier = await hashVerifier(testRaw)
      if (testVerifier !== storedVerifier) { onCurrentError('当前密码错误'); return }

      // 派生新密钥（复用原 salt）
      const newKey = await deriveKey(newPwd, saltBuf)
      const newRaw = await exportKey(newKey)
      const hwKey = await getHardwareKey()
      const hwEncrypted = await encryptSecret(newRaw, hwKey)
      const newVerifier = await hashVerifier(newRaw)

      // 重新加密所有账户，操作深拷贝避免污染内存数据
      const accountsToSave = JSON.parse(JSON.stringify(accounts))
      for (const acc of accountsToSave) {
        if (!acc.encrypted) {
          acc.secret = await encryptSecret(acc.secret, newKey)
          acc.encrypted = true
        } else if (acc.secret.includes(':')) {
          const plain = await decryptSecret(acc.secret, testKey)
          acc.secret = await encryptSecret(plain, newKey)
        }
      }

      // 保存账户
      let existing = null
      try { existing = z.db.get(STORAGE_KEY) } catch(e){}
      z.db.put({
        _id: STORAGE_KEY,
        _rev: existing ? existing._rev : undefined,
        data: accountsToSave
      })

      // 更新配置
      z.db.put({
        ...doc,
        verifier: newVerifier,
        hardwareEncryptedKey: hwEncrypted
      })

      masterKey.value = newKey
      lastAuthTime.value = Date.now()
      z.showNotification('主密码修改成功')
      return true
    } catch (e: any) {
      onCurrentError(e.message || '修改失败')
      return false
    }
  }

  return {
    masterKey, masterSalt, lastAuthTime,
    showSetPasswordModal, showVerifyPasswordModal,
    passwordInput, confirmPasswordInput,
    passwordErrorMsg, verifyErrorMsg,
    verifyInput, pendingAction,
    tryAutoUnlock, setMasterPassword, verifyMasterPassword,
    clearAuthData, getHardwareKey, changeMasterPassword
  }
}
