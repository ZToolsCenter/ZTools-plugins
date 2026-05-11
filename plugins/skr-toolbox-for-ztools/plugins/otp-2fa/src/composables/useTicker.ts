import { ref } from 'vue'
import { getOTP } from '../utils/otp'

export function useTicker() {
  const tokens = ref<Record<string, string>>({})
  const nextTokens = ref<Record<string, string>>({})
  const currentTime = ref(Math.floor(Date.now() / 1000))
  const msNow = ref(Date.now())
  
  let timer: any = null
  let msTimer: any = null
  const lastUpdateBlocks = new Map<string, number>()

  const performTokenUpdate = async (acc: any) => {
    tokens.value[acc.id] = await getOTP(acc)
    nextTokens.value[acc.id] = await getOTP(acc, true)
  }

  const updateAllTokens = async (accounts: any[]) => {
    const now = Date.now() / 1000.0
    for (const acc of accounts) {
      const period = acc.period || 30
      const block = Math.floor(now / period)
      await performTokenUpdate(acc)
      lastUpdateBlocks.set(acc.id, block)
    }
  }

  const updateTokens = async (accounts: any[]) => {
    const now = Date.now() / 1000.0
    const epoch = Math.floor(now)
    currentTime.value = epoch

    for (const acc of accounts) {
      const period = acc.period || 30
      const block = Math.floor(epoch / period)
      if (lastUpdateBlocks.get(acc.id) !== block) {
        await performTokenUpdate(acc)
        lastUpdateBlocks.set(acc.id, block)
      }
    }
  }

  const startTicker = (accounts: any) => {
    if (timer) clearInterval(timer)
    if (msTimer) clearInterval(msTimer)
    
    timer = setInterval(() => {
      currentTime.value = Math.floor(Date.now() / 1000)
      msNow.value = Date.now()
      updateTokens(accounts.value)
    }, 1000)
    
    msTimer = setInterval(() => { msNow.value = Date.now() }, 100)
  }

  const stopTicker = () => {
    if (timer) clearInterval(timer)
    if (msTimer) clearInterval(msTimer)
  }

  const getAccountTimeLeft = (acc: any) => {
    const period = (acc.period || 30) * 1000
    const timeLeftMs = period - (msNow.value % period)
    return timeLeftMs / 1000
  }

  return {
    tokens, nextTokens, currentTime, msNow,
    startTicker, stopTicker, updateAllTokens, updateTokens,
    getAccountTimeLeft, performTokenUpdate
  }
}
