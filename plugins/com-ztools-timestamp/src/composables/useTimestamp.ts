import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { TimestampUnit, TimezoneOption } from '@/types'
import { TIMEZONE_OPTIONS, getLocalTimezoneIndex } from '@/types'
import { msToUnit } from '@/utils/timezone'

export function useTimestamp() {
  const unit = ref<TimestampUnit>('second')
  const timezoneIndex = ref(getLocalTimezoneIndex())
  const timezone = computed<TimezoneOption>(() => TIMEZONE_OPTIONS[timezoneIndex.value])

  function highResNow(): number {
    if (typeof performance !== 'undefined' && performance.timeOrigin) {
      return performance.timeOrigin + performance.now()
    }
    return Date.now()
  }

  const nowMs = ref(highResNow())
  const paused = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  const currentTimestamp = computed(() => msToUnit(nowMs.value, unit.value))

  function startTimer() {
    timer = setInterval(() => {
      if (!paused.value) {
        nowMs.value = highResNow()
      }
    }, 100)
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function togglePause() {
    paused.value = !paused.value
  }

  const selectedDateMs = ref<number | null>(null)

  const inputTimestamp = ref('')

  function resetAll() {
    selectedDateMs.value = null
    inputTimestamp.value = ''
    paused.value = false
    nowMs.value = highResNow()
  }

  function copyToClipboard(text: string) {
    try {
      if (window.ztools?.copyText) {
        window.ztools.copyText(text)
      } else {
        navigator.clipboard.writeText(text)
      }
    } catch {
      navigator.clipboard.writeText(text)
    }
  }

  onMounted(startTimer)
  onUnmounted(stopTimer)

  return {
    unit,
    timezoneIndex,
    timezone,
    nowMs,
    paused,
    currentTimestamp,
    selectedDateMs,
    inputTimestamp,
    togglePause,
    resetAll,
    copyToClipboard
  }
}
