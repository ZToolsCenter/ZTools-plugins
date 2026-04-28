import { ref } from 'vue'
import type { Account, AccountInput, AccountData } from '@/types'

const accounts = ref<Account[]>([])

export function useAccounts() {

  async function loadAccounts(
    decryptFn: (ciphertext: string, iv: string) => Promise<string>,
  ) {
    const raw = window.ztools.dbStorage.getItem('account_ids')
    if (!raw) {
      accounts.value = []
      return
    }

    const ids: string[] = JSON.parse(raw)
    const loaded: Account[] = []

    for (const id of ids) {
      const record = window.ztools.db.get('account:' + id)
      if (!record) continue

      const data = record.data as AccountData
      const secret = await decryptFn(data.encryptedSecret, data.iv)

      loaded.push({
        id: data.id,
        issuer: data.issuer,
        label: data.label,
        secret,
        algorithm: data.algorithm,
        digits: data.digits,
        period: data.period,
        type: (data as any).type ?? 'totp',
        counter: (data as any).counter ?? 0,
        sortOrder: data.sortOrder,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      })
    }

    loaded.sort((a, b) => a.sortOrder - b.sortOrder)
    accounts.value = loaded
  }

  async function addAccount(
    input: AccountInput,
    encryptFn: (secret: string) => Promise<{ ciphertext: string; iv: string }>,
  ) {
    const id = crypto.randomUUID()
    const now = Date.now()
    const { ciphertext, iv } = await encryptFn(input.secret)

    const data: AccountData = {
      id,
      issuer: input.issuer,
      label: input.label,
      encryptedSecret: ciphertext,
      iv,
      algorithm: input.algorithm ?? 'SHA1',
      digits: input.digits ?? 6,
      period: input.period ?? 30,
      type: input.type ?? 'totp',
      counter: input.counter ?? 0,
      sortOrder: accounts.value.length,
      createdAt: now,
      updatedAt: now,
    }

    window.ztools.db.put({ _id: 'account:' + id, data })

    const raw = window.ztools.dbStorage.getItem('account_ids')
    const ids: string[] = raw ? JSON.parse(raw) : []
    ids.push(id)
    window.ztools.dbStorage.setItem('account_ids', JSON.stringify(ids))

    accounts.value.push({
      id,
      issuer: input.issuer,
      label: input.label,
      secret: input.secret,
      algorithm: data.algorithm,
      digits: data.digits,
      period: data.period,
      type: data.type,
      counter: data.counter,
      sortOrder: data.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
  }

  async function updateAccount(
    id: string,
    changes: Partial<AccountInput>,
    encryptFn: (secret: string) => Promise<{ ciphertext: string; iv: string }>,
  ) {
    const record = window.ztools.db.get('account:' + id)
    if (!record) return

    const data = record.data as AccountData
    const now = Date.now()

    if (changes.issuer !== undefined) data.issuer = changes.issuer
    if (changes.label !== undefined) data.label = changes.label
    if (changes.algorithm !== undefined) data.algorithm = changes.algorithm
    if (changes.digits !== undefined) data.digits = changes.digits
    if (changes.period !== undefined) data.period = changes.period

    if (changes.secret !== undefined) {
      const { ciphertext, iv } = await encryptFn(changes.secret)
      data.encryptedSecret = ciphertext
      data.iv = iv
    }
    if (changes.type !== undefined) data.type = changes.type
    if (changes.counter !== undefined) data.counter = changes.counter

    data.updatedAt = now

    window.ztools.db.put({ _id: 'account:' + id, data })

    const index = accounts.value.findIndex((a) => a.id === id)
    if (index !== -1) {
      const account = accounts.value[index]
      if (changes.issuer !== undefined) account.issuer = changes.issuer
      if (changes.label !== undefined) account.label = changes.label
      if (changes.secret !== undefined) account.secret = changes.secret
      if (changes.algorithm !== undefined) account.algorithm = changes.algorithm
      if (changes.digits !== undefined) account.digits = changes.digits
      if (changes.period !== undefined) account.period = changes.period
      if (changes.type !== undefined) account.type = changes.type
      if (changes.counter !== undefined) account.counter = changes.counter
      account.updatedAt = now
    }
  }

  function removeAccount(id: string) {
    window.ztools.db.remove('account:' + id)

    const raw = window.ztools.dbStorage.getItem('account_ids')
    const ids: string[] = raw ? JSON.parse(raw) : []
    const filtered = ids.filter((i) => i !== id)
    window.ztools.dbStorage.setItem('account_ids', JSON.stringify(filtered))

    accounts.value = accounts.value.filter((a) => a.id !== id)
  }

  function removeBatch(idsToRemove: string[]) {
    const set = new Set(idsToRemove)
    for (const id of idsToRemove) {
      window.ztools.db.remove('account:' + id)
    }
    const raw = window.ztools.dbStorage.getItem('account_ids')
    const ids: string[] = raw ? JSON.parse(raw) : []
    window.ztools.dbStorage.setItem('account_ids', JSON.stringify(ids.filter((i) => !set.has(i))))
    accounts.value = accounts.value.filter((a) => !set.has(a.id))
  }

  function removeAll() {
    for (const a of accounts.value) {
      window.ztools.db.remove('account:' + a.id)
    }
    window.ztools.dbStorage.setItem('account_ids', '[]')
    accounts.value = []
  }

  function pinAccount(id: string) {
    const idx = accounts.value.findIndex((a) => a.id === id)
    if (idx <= 0) return

    const [account] = accounts.value.splice(idx, 1)
    accounts.value.unshift(account)

    persistSortOrder()
  }

  function reorderAccounts(orderedIds: string[]) {
    const map = new Map(accounts.value.map((a) => [a.id, a]))
    const reordered: Account[] = []
    for (const id of orderedIds) {
      const a = map.get(id)
      if (a) reordered.push(a)
    }
    accounts.value = reordered
    persistSortOrder()
  }

  function persistSortOrder() {
    const ids: string[] = []
    accounts.value.forEach((a, i) => {
      a.sortOrder = i
      ids.push(a.id)

      const record = window.ztools.db.get('account:' + a.id)
      if (record) {
        const data = record.data as AccountData
        data.sortOrder = i
        window.ztools.db.put({ _id: 'account:' + a.id, data })
      }
    })
    window.ztools.dbStorage.setItem('account_ids', JSON.stringify(ids))
  }

  function updateCounter(id: string, newCounter: number) {
    const record = window.ztools.db.get('account:' + id)
    if (!record) return
    const data = record.data as AccountData
    data.counter = newCounter
    data.updatedAt = Date.now()
    window.ztools.db.put({ _id: 'account:' + id, data })

    const account = accounts.value.find((a) => a.id === id)
    if (account) {
      account.counter = newCounter
      account.updatedAt = data.updatedAt
    }
  }

  async function reEncryptAll(
    encryptFn: (plaintext: string) => Promise<{ ciphertext: string; iv: string }>,
  ) {
    for (const account of accounts.value) {
      const { ciphertext, iv } = await encryptFn(account.secret)
      const record = window.ztools.db.get('account:' + account.id)
      if (!record) continue
      const data = record.data as AccountData
      data.encryptedSecret = ciphertext
      data.iv = iv
      window.ztools.db.put({ _id: 'account:' + account.id, data })
    }
  }

  return {
    accounts,
    loadAccounts,
    addAccount,
    updateAccount,
    removeAccount,
    removeBatch,
    removeAll,
    updateCounter,
    reEncryptAll,
    pinAccount,
    reorderAccounts,
  }
}
