import { ref, computed } from 'vue'

/**
 * LaTeX OCR 引擎状态机:复用给「公式识别」「截图识别公式」「引擎管理」三处视图。
 *
 * 与 useNativeEngine 完全同构,只是调用 latex* 系列服务(独立于微信 OCR 引擎)。
 * 流程:checking -> (missing | ready) -> downloading/extracting -> ready
 *
 * 状态为**模块级单例**:所有调用 useLatexEngine() 的组件共享同一份进度 ref
 * 与进行中下载 Promise。切换 tab 卸载组件时不丢失下载进度;重新挂载仍读到
 * 同一份进度,切 tab 不再"中断"下载 UI。与 useNativeEngine 对称实现。
 */

export type LatexState =
  | 'checking'
  | 'missing'
  | 'downloading'
  | 'extracting'
  | 'ready'
  | 'error'

// ─── 模块级单例(进程内唯一,跨组件共享)──────────────────────────────────
const latexState = ref<LatexState>('checking')
const downloadPercent = ref(0)
const downloadLoaded = ref(0)
const downloadTotal = ref(0)
const latexError = ref('')
const latexVersion = ref<string | null>(null)
const latexMissing = ref<string[]>([])
// 进行中的下载 Promise:存在则表示下载/解压进行中,复用此 Promise 幂等返回。
let downloadPromise: Promise<boolean> | null = null

// 检查 LaTeX 引擎状态(按文件存在性判断)。
// 下载/解压进行中时跳过:避免组件重挂(onMounted 调 check)把进行中的
// downloading/extracting 态覆盖成 missing/ready(此时文件尚未就位)。
async function checkLatex() {
  if (latexState.value === 'downloading' || latexState.value === 'extracting') {
    return
  }
  latexState.value = 'checking'
  try {
    const status = window.services.latexStatus()
    latexVersion.value = status.version
    latexMissing.value = status.missing || []
    latexState.value = status.ready ? 'ready' : 'missing'
  } catch (_) {
    // preload 方法缺失等异常:保守地进入 missing,避免阻塞
    latexState.value = 'missing'
  }
}

// 下载并解压 LaTeX 引擎。
// 幂等:若已有进行中的 downloadPromise(下载/解压中),直接返回它,防重复点击
// 与多组件并发触发。下载进行中的状态写在单例 ref 上,切 tab 也不丢。
// hostIndex: undefined 竞速选最快镜像；-1 直连；0..N-1 指定镜像（用于重试）。
async function downloadLatex(hostIndex?: number): Promise<boolean> {
  if (downloadPromise) return downloadPromise
  latexState.value = 'downloading'
  downloadPercent.value = 0
  downloadLoaded.value = 0
  downloadTotal.value = 0
  latexError.value = ''
  downloadPromise = (async () => {
    try {
      const result = await window.services.latexDownload((progress) => {
        if (progress.phase === 'downloading') {
          latexState.value = 'downloading'
          downloadPercent.value = progress.percent
          downloadLoaded.value = progress.loaded
          downloadTotal.value = progress.total
        } else if (progress.phase === 'extracting') {
          latexState.value = 'extracting'
        }
      }, hostIndex)
      if (result.ok) {
        latexState.value = 'ready'
        return true
      } else if (result.cancelled) {
        latexState.value = 'missing'
        return false
      } else {
        latexState.value = 'error'
        latexError.value = result.error || '下载失败'
        return false
      }
    } catch (err: any) {
      latexState.value = 'error'
      latexError.value = err?.message ? String(err.message) : String(err)
      return false
    } finally {
      downloadPromise = null
    }
  })()
  return downloadPromise
}

// 删除已下载的 LaTeX 引擎,回到 missing 态。
// 下载/解压进行中时跳过:避免边下载边删目录的竞态(文件正被写,删了会出错)。
function removeLatex() {
  if (latexState.value === 'downloading' || latexState.value === 'extracting') {
    return
  }
  try {
    window.services.latexRemove()
  } catch (_) {}
  latexState.value = 'missing'
  checkLatex()
}

// 取消进行中的 LaTeX 下载（用户点「取消」时调用）。
function cancelLatex() {
  try {
    window.services.latexCancel()
  } catch (_) {}
}

const latexReady = computed(() => latexState.value === 'ready')
const isBusy = computed(
  () => latexState.value === 'downloading' || latexState.value === 'extracting'
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

export function useLatexEngine() {
  return {
    // state(单例 ref,跨组件共享)
    latexState,
    downloadPercent,
    downloadLoaded,
    downloadTotal,
    latexError,
    latexVersion,
    latexMissing,
    // computed
    latexReady,
    isBusy,
    // actions
    checkLatex,
    downloadLatex,
    cancelLatex,
    removeLatex,
    // utils
    formatBytes
  }
}
