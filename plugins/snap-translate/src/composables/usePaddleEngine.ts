import { ref, computed } from 'vue'

export type PaddleState =
  | 'checking'
  | 'missing'
  | 'downloading'
  | 'extracting'
  | 'ready'
  | 'error'

export function usePaddleEngine() {
  const paddleState = ref<PaddleState>('checking')
  const downloadPercent = ref(0)
  const downloadLoaded = ref(0)
  const downloadTotal = ref(0)
  const paddleError = ref('')
  const paddleExe = ref('')

  async function checkPaddle() {
    if (paddleState.value === 'downloading' || paddleState.value === 'extracting') return
    paddleState.value = 'checking'
    try {
      const status = window.services.paddleStatus()
      paddleExe.value = status.exePath || ''
      paddleState.value = status.ready ? 'ready' : 'missing'
    } catch (_) {
      paddleState.value = 'missing'
    }
  }

  async function downloadPaddle(hostIndex?: number): Promise<boolean> {
    if (paddleState.value === 'downloading' || paddleState.value === 'extracting') return false
    paddleState.value = 'downloading'
    downloadPercent.value = 0
    downloadLoaded.value = 0
    downloadTotal.value = 0
    paddleError.value = ''
    try {
      const result = await window.services.paddleDownload((progress) => {
        if (progress.phase === 'downloading') {
          paddleState.value = 'downloading'
          downloadPercent.value = progress.percent
          downloadLoaded.value = progress.loaded
          downloadTotal.value = progress.total
        } else if (progress.phase === 'extracting') {
          paddleState.value = 'extracting'
        }
      }, hostIndex)
      if (result.ok) {
        paddleState.value = 'ready'
        await checkPaddle()
        return true
      }
      paddleState.value = result.cancelled ? 'missing' : 'error'
      paddleError.value = result.error || '下载失败'
      return false
    } catch (err: any) {
      paddleState.value = 'error'
      paddleError.value = err?.message ? String(err.message) : String(err)
      return false
    }
  }

  function removePaddle() {
    try {
      window.services.paddleRemove()
    } catch (_) {}
    paddleExe.value = ''
    paddleState.value = 'missing'
    checkPaddle()
  }

  const paddleReady = computed(() => paddleState.value === 'ready')
  const isBusy = computed(
    () => paddleState.value === 'downloading' || paddleState.value === 'extracting'
  )

  function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let n = bytes
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024
      i++
    }
    return `${n.toFixed(1)} ${units[i]}`
  }

  return {
    paddleState,
    downloadPercent,
    downloadLoaded,
    downloadTotal,
    paddleError,
    paddleExe,
    paddleReady,
    isBusy,
    checkPaddle,
    downloadPaddle,
    removePaddle,
    formatBytes
  }
}
