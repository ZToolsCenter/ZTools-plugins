import { ref, computed } from 'vue'

/**
 * native OCR 引擎状态机:复用给「引擎管理」「识别测试」「快捷识别」三处视图。
 *
 * 流程:checking -> (missing | ready) -> downloading/extracting -> ready
 *
 * 状态为**模块级单例**:所有调用 useNativeEngine() 的组件共享同一份进度 ref
 * 与进行中下载 Promise。这样切换 tab 卸载组件时,下载进度不会丢失;重新挂载
 * 时仍读到同一份进度,切 tab 不再"中断"下载 UI。底层 preload 的
 * window.services.nativeDownload 本就是异步任务,单例化让前端状态与之同寿。
 */

export type NativeState =
  | 'checking'
  | 'missing'
  | 'downloading'
  | 'extracting'
  | 'ready'
  | 'error'

// ─── 模块级单例(进程内唯一,跨组件共享)──────────────────────────────────
const nativeState = ref<NativeState>('checking')
const downloadPercent = ref(0)
const downloadLoaded = ref(0)
const downloadTotal = ref(0)
const nativeError = ref('')
const nativeVersion = ref<string | null>(null)
const nativeMissing = ref<string[]>([])
// 进行中的下载 Promise:存在则表示下载/解压进行中,复用此 Promise 幂等返回。
let downloadPromise: Promise<boolean> | null = null

// 检查 native 引擎状态(按文件存在性判断)。
// 下载/解压进行中时跳过:避免组件重挂(onMounted 调 check)把进行中的
// downloading/extracting 态覆盖成 missing/ready(此时文件尚未就位)。
async function checkNative() {
  if (nativeState.value === 'downloading' || nativeState.value === 'extracting') {
    return
  }
  nativeState.value = 'checking'
  try {
    const status = window.services.nativeStatus()
    nativeVersion.value = status.version
    nativeMissing.value = status.missing || []
    nativeState.value = status.ready ? 'ready' : 'missing'
  } catch (_) {
    // preload 方法缺失等异常:保守地进入 missing,避免阻塞
    nativeState.value = 'missing'
  }
}

// 下载并解压 native 引擎。
// 幂等:若已有进行中的 downloadPromise(下载/解压中),直接返回它,防重复点击
// 与多组件并发触发。下载进行中的状态写在单例 ref 上,切 tab 也不丢。
// hostIndex: undefined 竞速选最快镜像；-1 直连；0..N-1 指定镜像（用于重试）。
async function downloadNative(hostIndex?: number): Promise<boolean> {
  if (downloadPromise) return downloadPromise
  nativeState.value = 'downloading'
  downloadPercent.value = 0
  downloadLoaded.value = 0
  downloadTotal.value = 0
  nativeError.value = ''
  downloadPromise = (async () => {
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
      }, hostIndex)
      if (result.ok) {
        nativeState.value = 'ready'
        return true
      } else if (result.cancelled) {
        nativeState.value = 'missing'
        return false
      } else {
        nativeState.value = 'error'
        nativeError.value = result.error || '下载失败'
        return false
      }
    } catch (err: any) {
      nativeState.value = 'error'
      nativeError.value = err?.message ? String(err.message) : String(err)
      return false
    } finally {
      downloadPromise = null
    }
  })()
  return downloadPromise
}

// 删除已下载的 native 引擎,回到 missing 态。
// 下载/解压进行中时跳过:避免边下载边删目录的竞态(文件正被写,删了会出错)。
function removeNative() {
  if (nativeState.value === 'downloading' || nativeState.value === 'extracting') {
    return
  }
  try {
    window.services.nativeRemove()
  } catch (_) {}
  nativeState.value = 'missing'
  checkNative()
}

// 取消进行中的 native 下载（用户点「取消」时调用）。
// preload 的 nativeDownload 会在 signal.aborted 后 reject，触发上面的 cancelled 分支。
function cancelNative() {
  try {
    window.services.nativeCancel()
  } catch (_) {}
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

export function useNativeEngine() {
  return {
    // state(单例 ref,跨组件共享)
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
    cancelNative,
    removeNative,
    // utils
    formatBytes
  }
}
