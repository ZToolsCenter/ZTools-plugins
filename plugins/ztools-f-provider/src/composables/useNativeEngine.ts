import { ref, computed } from 'vue'

/**
 * native OCR 引擎状态机：复用给「引擎管理」「识别测试」「快捷识别」三处视图。
 *
 * 流程：checking -> (missing | ready) -> downloading/extracting -> ready
 */

export type NativeState =
  | 'checking'
  | 'missing'
  | 'downloading'
  | 'extracting'
  | 'ready'
  | 'error'

export function useNativeEngine() {
  const nativeState = ref<NativeState>('checking')
  const downloadPercent = ref(0)
  const downloadLoaded = ref(0)
  const downloadTotal = ref(0)
  const nativeError = ref('')
  const nativeVersion = ref<string | null>(null)
  const nativeMissing = ref<string[]>([])

  // 检查 native 引擎状态（按文件存在性判断）
  async function checkNative() {
    nativeState.value = 'checking'
    try {
      const status = window.services.nativeStatus()
      nativeVersion.value = status.version
      nativeMissing.value = status.missing || []
      nativeState.value = status.ready ? 'ready' : 'missing'
    } catch (_) {
      // preload 方法缺失等异常：保守地进入 missing，避免阻塞
      nativeState.value = 'missing'
    }
  }

  // 下载并解压 native 引擎
  async function downloadNative(): Promise<boolean> {
    if (nativeState.value === 'downloading' || nativeState.value === 'extracting') {
      return false
    }
    nativeState.value = 'downloading'
    downloadPercent.value = 0
    downloadLoaded.value = 0
    downloadTotal.value = 0
    nativeError.value = ''
    try {
      const result = await window.services.nativeDownload((progress) => {
        if (progress.phase === 'downloading') {
          nativeState.value = 'downloading'
          downloadPercent.value = progress.percent
          downloadLoaded.value = progress.loaded
          downloadTotal.value = progress.total
        } else if (progress.phase === 'extracting') {
          nativeState.value = 'extracting'
        }
      })
      if (result.ok) {
        nativeState.value = 'ready'
        return true
      } else {
        nativeState.value = 'error'
        nativeError.value = result.error || '下载失败'
        return false
      }
    } catch (err: any) {
      nativeState.value = 'error'
      nativeError.value = err?.message ? String(err.message) : String(err)
      return false
    }
  }

  // 删除已下载的 native 引擎，回到 missing 态
  function removeNative() {
    try {
      window.services.nativeRemove()
    } catch (_) {}
    nativeState.value = 'missing'
    checkNative()
  }

  const nativeReady = computed(() => nativeState.value === 'ready')
  const isBusy = computed(
    () => nativeState.value === 'downloading' || nativeState.value === 'extracting'
  )

  // 把字节格式化为人类可读
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
    // state
    nativeState,
    downloadPercent,
    downloadLoaded,
    downloadTotal,
    nativeError,
    nativeVersion,
    nativeMissing,
    // computed
    nativeReady,
    isBusy,
    // actions
    checkNative,
    downloadNative,
    removeNative,
    // utils
    formatBytes
  }
}
