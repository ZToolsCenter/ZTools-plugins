import { computed, ref, type ComputedRef } from 'vue'
import type { Settings, TaskDoc } from '../types'
import { defaultSettings } from './todoConstants'
import { getStorage, setStorage } from './todoPersistence'

interface TomatoTimerOptions {
  settings: Settings
  currentTomatoTask: ComputedRef<TaskDoc | undefined>
  saveSettings: () => void
}

export function useTomatoTimer(options: TomatoTimerOptions) {
  const tomatoRemaining = ref(defaultSettings.tomatoMinutes * 60)
  const tomatoRunning = ref(false)

  const tomatoProgress = computed(() => {
    const total = options.settings.tomatoMinutes * 60
    return total ? 1 - tomatoRemaining.value / total : 0
  })
  const tomatoSegments = computed(() => Array.from({ length: 25 }, (_, index) => index < Math.ceil(tomatoProgress.value * 25)))

  function syncTomatoSettings() {
    tomatoRemaining.value = options.settings.tomatoMinutes * 60
  }

  function resetTomato() {
    tomatoRunning.value = false
    tomatoRemaining.value = options.settings.tomatoMinutes * 60
  }

  function toggleTomato() {
    tomatoRunning.value = !tomatoRunning.value
  }

  function completeTomato() {
    tomatoRunning.value = false
    tomatoRemaining.value = 0
    window.ztools?.showNotification?.('番茄钟已完成')
    if (options.currentTomatoTask.value) {
      const history = getStorage<any[]>('todo-tomato-history', [])
      history.push({
        taskId: options.currentTomatoTask.value._id,
        text: options.currentTomatoTask.value.text,
        minutes: options.settings.tomatoMinutes,
        completed_at: Date.now()
      })
      setStorage('todo-tomato-history', history)
    }
  }

  function updateTomatoMinutes(minutes: number) {
    if (tomatoRunning.value) return
    options.settings.tomatoMinutes = Math.min(60, Math.max(5, minutes))
    tomatoRemaining.value = options.settings.tomatoMinutes * 60
    options.saveSettings()
  }

  function tickTomato() {
    if (!tomatoRunning.value) return
    if (tomatoRemaining.value <= 1) completeTomato()
    else tomatoRemaining.value -= 1
  }

  return {
    tomatoRemaining,
    tomatoRunning,
    tomatoProgress,
    tomatoSegments,
    syncTomatoSettings,
    resetTomato,
    toggleTomato,
    completeTomato,
    updateTomatoMinutes,
    tickTomato
  }
}

