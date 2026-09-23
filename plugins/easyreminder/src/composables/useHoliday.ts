import { ref } from 'vue'

export interface HolidayStatus {
  years: number[]
  updatedAt: number
  refreshing: boolean
  // preload 未更新（需要重启 ZTools）时置 true
  legacy?: boolean
}

// 模块级单例，保证各处共享同一份状态
const holidayStatus = ref<HolidayStatus | null>(null)

function readFromServices(): HolidayStatus | null {
  try {
    if (typeof window.services?.getHolidayStatus !== 'function') {
      return { years: [], updatedAt: 0, refreshing: false, legacy: true }
    }
    return window.services.getHolidayStatus() as HolidayStatus
  } catch {
    return null
  }
}

export function useHoliday() {
  function refreshStatus(): void {
    holidayStatus.value = readFromServices()
  }

  async function updateHolidayData(): Promise<boolean> {
    try {
      if (typeof window.services?.refreshHolidayData !== 'function') return false
      const ok = await window.services.refreshHolidayData()
      refreshStatus()
      return !!ok
    } catch {
      refreshStatus()
      return false
    }
  }

  return { holidayStatus, refreshStatus, updateHolidayData }
}
