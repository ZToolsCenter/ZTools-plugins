import { ref } from 'vue'
import { TOTP, HOTP, Secret } from 'otpauth'
import type { Account, TotpDisplay } from '@/types'
import { generateSteamCode } from '@/utils/steam'

export function useTotp() {
  const totpState = ref<Record<string, TotpDisplay>>({})

  const tracking = new Map<string, { account: Account; lastCode: string; cachedNextCode: string; lastPeriodIndex: number }>()
  let timerId: ReturnType<typeof setTimeout> | null = null

  function generateCode(account: Account): string {
    if (account.type === 'hotp') {
      return HOTP.generate({
        secret: Secret.fromBase32(account.secret),
        algorithm: account.algorithm,
        digits: account.digits,
        counter: account.counter ?? 0,
      })
    }
    return new TOTP({
      issuer: account.issuer,
      label: account.label,
      algorithm: account.algorithm,
      digits: account.digits,
      period: account.period,
      secret: Secret.fromBase32(account.secret),
    }).generate()
  }

  function generateNextCode(account: Account): string {
    const totp = new TOTP({
      issuer: account.issuer,
      label: account.label,
      algorithm: account.algorithm,
      digits: account.digits,
      period: account.period,
      secret: Secret.fromBase32(account.secret),
    })
    const nextTimestamp = (Math.floor(Date.now() / 1000 / account.period) + 1) * account.period
    return totp.generate({ timestamp: nextTimestamp * 1000 })
  }

  async function refreshSteamCode(id: string, entry: { account: Account; lastCode: string; cachedNextCode: string; lastPeriodIndex: number }) {
    try {
      entry.lastCode = await generateSteamCode(entry.account.secret)
    } catch {
      entry.lastCode = '-----'
    }
    emitState()
  }

  function emitState() {
    const now = Math.floor(Date.now() / 1000)
    const result: Record<string, TotpDisplay> = {}

    for (const [id, entry] of tracking) {
      const { account } = entry

      if (account.type === 'hotp') {
        result[id] = { code: entry.lastCode, nextCode: '', remaining: 0, period: 0, isHotp: true }
        continue
      }

      const period = account.period || 30
      const remaining = period - (now % period)

      if (account.type === 'steam') {
        result[id] = { code: entry.lastCode, nextCode: '', remaining, period, isHotp: false }
        continue
      }

      let nextCode = ''
      if (remaining <= 5) {
        try {
          if (!entry.cachedNextCode) {
            entry.cachedNextCode = generateNextCode(account)
          }
          nextCode = entry.cachedNextCode
        } catch {
          nextCode = ''
        }
      }

      result[id] = { code: entry.lastCode, nextCode, remaining, period: account.period, isHotp: false }
    }

    totpState.value = result
  }

  function tick() {
    const now = Math.floor(Date.now() / 1000)

    for (const [id, entry] of tracking) {
      const { account } = entry

      if (account.type === 'hotp') continue

      const period = account.period || 30
      const periodIndex = Math.floor(now / period)

      if (periodIndex !== entry.lastPeriodIndex || entry.lastCode === '') {
        entry.lastPeriodIndex = periodIndex
        entry.cachedNextCode = ''

        if (account.type === 'steam') {
          refreshSteamCode(id, entry)
        } else {
          entry.lastCode = generateCode(account)
        }
      }
    }

    emitState()
  }

  async function registerAccount(account: Account) {
    let code: string
    if (account.type === 'steam') {
      try {
        code = await generateSteamCode(account.secret)
      } catch {
        code = '-----'
      }
    } else {
      code = generateCode(account)
    }

    const period = account.period || 30
    const now = Math.floor(Date.now() / 1000)
    tracking.set(account.id, {
      account,
      lastCode: code,
      cachedNextCode: '',
      lastPeriodIndex: Math.floor(now / period),
    })
    emitState()
  }

  function unregisterAccount(id: string) {
    tracking.delete(id)
    emitState()
  }

  function refreshHotp(
    accountId: string,
    persistCounterFn: (id: string, newCounter: number) => void,
  ) {
    const entry = tracking.get(accountId)
    if (!entry || entry.account.type !== 'hotp') return

    entry.account.counter = (entry.account.counter ?? 0) + 1
    entry.lastCode = generateCode(entry.account)
    persistCounterFn(accountId, entry.account.counter)
    emitState()
  }

  function scheduleNext() {
    timerId = setTimeout(() => {
      tick()
      scheduleNext()
    }, 1000)
  }

  function start() {
    if (timerId !== null) return
    tick()
    scheduleNext()
  }

  function stop() {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  return {
    totpState,
    registerAccount,
    unregisterAccount,
    refreshHotp,
    start,
    stop,
  }
}
