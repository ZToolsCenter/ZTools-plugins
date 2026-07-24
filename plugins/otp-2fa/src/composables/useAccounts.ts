import { ref } from 'vue'
import { STORAGE_KEY, CONFIG_KEY } from '../constants'
import { encryptSecret, decryptSecret } from '../utils/crypto'

export function useAccounts() {
  const accounts = ref<any[]>([])
  
  const loadAccounts = async (masterSalt: any, masterKey: any, config: any, hooks: {
    onAutoUnlock: () => Promise<void>,
    onDecryptAll: () => Promise<void>,
    onShowVerify: (action: () => Promise<void>) => void,
    onTokensUpdate: () => void
  }) => {
    const z = (window as any).ztools
    if (!z || !z.db) return
    
    try {
      const res = z.db.get(STORAGE_KEY)
      if (res && res.data) {
        accounts.value = res.data
        
        const configRes = z.db.get(CONFIG_KEY)
        if (configRes) {
          if (configRes.salt) masterSalt.value = configRes.salt
          config.value.timerStyle = configRes.timerStyle || 'bar'
          config.value.nextPreview = configRes.nextPreview ?? true
          config.value.pinyinScheme = configRes.pinyinScheme || 'quanpin'
        }
        
        if (masterSalt.value && !masterKey.value) {
          await hooks.onAutoUnlock()
        }

        if (masterKey.value) {
          await hooks.onDecryptAll()
        } else if (masterSalt.value && accounts.value.length > 0) {
          const hasEncrypted = accounts.value.some(acc => acc.encrypted && acc.secret.includes(':'))
          if (hasEncrypted) {
            hooks.onShowVerify(hooks.onDecryptAll)
          }
        }
      }
    } catch (e) {
      console.error('Load Error:', e)
      const z2 = (window as any).ztools
      z2?.showNotification?.('数据加载失败，账户数据可能已损坏')
    }
    hooks.onTokensUpdate()
  }

  const decryptAllAccounts = async (masterKey: CryptoKey | null) => {
    if (!masterKey) return
    const z = (window as any).ztools
    for (const acc of accounts.value) {
      if (acc.encrypted && acc.secret.includes(':')) {
        try {
          acc.secret = await decryptSecret(acc.secret, masterKey)
          acc.encrypted = false
        } catch (e) {
          console.error('Decrypt failed for', acc.id, e)
          z?.showNotification?.(`账户「${acc.name}」数据已损坏，无法解密`)
        }
      }
    }
  }

  const saveAccounts = async (masterKey: CryptoKey | null, masterSalt: string | null, config: any) => {
    const z = (window as any).ztools
    if (!z || !z.db) return
    
    try {
      let existing = null
      try { existing = z.db.get(STORAGE_KEY) } catch(e){}
      
      const dataToSave = JSON.parse(JSON.stringify(accounts.value))
      if (masterKey) {
        for (const acc of dataToSave) {
          if (!acc.encrypted) {
            acc.secret = await encryptSecret(acc.secret, masterKey)
            acc.encrypted = true
          }
        }
      }

      z.db.put({ 
        _id: STORAGE_KEY, 
        _rev: existing ? existing._rev : undefined, 
        data: dataToSave 
      })
      
      if (masterSalt) {
        let conf = null
        try { conf = z.db.get(CONFIG_KEY) } catch(e){}
        z.db.put({
          ...conf,
          ...config,
          _id: CONFIG_KEY,
          _rev: conf ? conf._rev : undefined,
          salt: masterSalt
        })
      }
    } catch (e) { console.error('Save Error:', e) }
  }

  const saveConfig = (config: any) => {
    const z = (window as any).ztools
    if (!z || !z.db) return
    try {
      let existing = null
      try { existing = z.db.get(CONFIG_KEY) } catch (e) { }
      z.db.put({
        ...existing,
        ...config,
        _id: CONFIG_KEY,
        _rev: existing?._rev,
      })
    } catch (e) {
      console.error('Config Save Error:', e)
    }
  }

  const getPinnedCount = () => accounts.value.filter(a => a.pinned).length

  return {
    accounts,
    loadAccounts,
    decryptAllAccounts,
    saveAccounts,
    saveConfig,
    getPinnedCount
  }
}
