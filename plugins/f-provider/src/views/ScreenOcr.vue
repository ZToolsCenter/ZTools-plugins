<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ZButton, useToast } from 'ztools-ui'
import EngineStatusCard from '../components/EngineStatusCard.vue'
import { useNativeEngine } from '../composables/useNativeEngine'

/**
 * 截图识别子页（独立 feature screen-ocr 的全屏视图，Windows / macOS）。
 *
 * 流程（每次进入触发）：
 *   1. 检查 OCR 引擎是否就绪（nativeStatus）。
 *   2. 未就绪 → 留在本页展示下载引导（内嵌 EngineStatusCard，可一键下载；
 *      下载完成后自动进入截图流程，不跳转其它页）。
 *   3. 已就绪 → 调系统截图 ztools.screenCapture，截完作为参数调 OCR 识别。
 *   4. 识别完成 → 通过 ztools.createBrowserWindow 打开「结果展示窗口」，
 *      把图片 + 识别结果注入该窗口（webContents.executeJavaScript），窗口内
 *      左图右文展示（1:1 图片 + 贴合识别位置的透明文字层 + 可拖动缩放 + 结果列表）。
 *   5. 退出主插件（outPlugin），识别结果在独立窗口中查看。
 *
 * 主窗口只做「编排」：截图、识别、开窗、注入、退出。展示全部在子窗口完成
 * （子窗口不带 preload / 不可靠的 window.ztools，故只做展示）。
 *
 * 每次进入都重置状态并重新推进（startFlow），保证「已开结果窗口后再次触发
 * 快捷键」能正常重新截图，不会卡在 done 态。
 */

type Phase = 'idle' | 'capturing' | 'recognizing' | 'done' | 'error'

const { success, error: errorToast, info: infoToast } = useToast()
// useNativeEngine 实例：用于读取就绪态以触发 capture。
// EngineStatusCard 内部另有自己的 useNativeEngine 实例负责下载 UI，
// 通过 downloaded 事件回传此处刷新。
const { nativeReady, nativeState, checkNative } = useNativeEngine()

const phase = ref<Phase>('idle')
const errorText = ref('')

const busy = computed(
  () => phase.value === 'capturing' || phase.value === 'recognizing'
)

/** 未就绪：展示内嵌下载卡片（EngineStatusCard 自带下载/进度/错误/就绪态）。 */
const showDownloadGuide = computed(
  () => !nativeReady.value && nativeState.value !== 'checking'
)

/**
 * 每次进入的入口：重置状态 → 检查引擎 → 就绪则截图，未就绪则展示下载卡。
 * 由 onMounted（首次进入）与 onPluginEnter（每次重新唤醒）统一调用，
 * 不再依赖 watch，避免状态翻转竞态导致卡住。
 */
async function startFlow(): Promise<void> {
  phase.value = 'idle'
  errorText.value = ''
  await checkNative()
  // checkNative 是同步文件检查（async 但内部同步），执行完状态已确定
  if (nativeState.value === 'ready') {
    capture()
  }
  // 否则停留在 idle，showDownloadGuide 自动展示下载卡
}

/**
 * 已就绪 → 触发系统截屏并识别。
 * screenCapture 回调在用户按 Esc 取消时返回空字符串。
 */
function capture(): void {
  if (busy.value) return
  phase.value = 'capturing'

  window.ztools.screenCapture((imgBase64: string) => {
    // 用户取消截屏：不报错，退出本次流程
    if (!imgBase64) {
      errorToast('已取消截图')
      // 取消后退出插件，回到宿主
      try {
        window.ztools.outPlugin()
      } catch (_) {
        /* ignore */
      }
      return
    }
    const dataUri = imgBase64.startsWith('data:')
      ? imgBase64
      : 'data:image/png;base64,' + imgBase64
    recognize(dataUri)
  })
}

/** 调微信 OCR 识别 data URI 图片；成功后开窗展示，失败提示并退出。 */
async function recognize(image: string): Promise<void> {
  phase.value = 'recognizing'
  errorText.value = ''
  try {
    const result = await window.services.ocrImageDetail(image)
    if (result.ok) {
      phase.value = 'done'
      const lines = result.lines ?? []
      if (lines.length === 0) {
        // 无文字也开窗展示（让用户确认截图），但提示未识别到
        infoToast('未识别到文字')
      } else {
        success(`识别完成，共 ${lines.length} 行`)
      }
      openResultWindow(image, lines)
    } else {
      phase.value = 'error'
      errorText.value = result.error || '识别失败'
      errorToast(errorText.value)
    }
  } catch (err: any) {
    phase.value = 'error'
    errorText.value = err?.message ? String(err.message) : String(err)
    errorToast(errorText.value)
  }
}

/**
 * 打开结果展示窗口并把识别数据注入。
 *
 * 窗口由 ztools.createBrowserWindow 创建，加载打包后的 screen-ocr-result.html。
 * 创建后通过 win.webContents.executeJavaScript 调用子窗口挂载的
 * window.__loadScreenOcrResult({ image, lines, isDark }) 注入数据。
 *
 * 窗口大小：依据截图自然尺寸换算为 DIP 后计算，但严格夹在 [最小, 屏幕工作区] 之间，
 * 保证任何系统缩放下都不超屏。窗口为无边框（frame:false），标题栏与关闭按钮在子窗口内实现。
 *
 * 关键：截图 PNG 为物理像素，workAreaSize 与 createBrowserWindow 宽高均为 DIP，
 * 故需 ÷ scaleFactor 换算。不同宿主对 scaleFactor / 物理像素口径不一致，
 * 这里用「图片 DIP 尺寸 vs 剩余可用 DIP」取较小者，确保不溢出。
 */
function openResultWindow(image: string, linesData: OcrLine[]): void {
  const imgSize = decodePngSize(image)

  const display = window.ztools.getPrimaryDisplay()
  // workArea 同为 DIP，含任务栏扣除，比 size 更安全
  const workArea = display.workArea
  const screenWDip = workArea.width
  const screenHDip = workArea.height
  // scaleFactor：如 1 / 1.25 / 1.5 / 1.9 / 2
  const scaleFactor = display.scaleFactor || 1

  // 固定的非图区开销：右侧结果区 + 自绘标题栏
  const RESULT_PANE_W = 360
  const TITLEBAR_H = 40

  // 图区可用 DIP（屏幕工作区扣除非图区开销，留 16px 边距）
  const availImgWDip = Math.max(200, screenWDip - RESULT_PANE_W - 16)
  const availImgHDip = Math.max(150, screenHDip - TITLEBAR_H - 16)

  let winW: number
  let winH: number
  if (imgSize) {
    // 图片物理像素 → DIP
    const imgWDip = imgSize.width / scaleFactor
    const imgHDip = imgSize.height / scaleFactor
    // 图区 DIP = min(图片 DIP, 可用 DIP)，保证不超屏
    const imgAreaW = Math.min(imgWDip, availImgWDip)
    const imgAreaH = Math.min(imgHDip, availImgHDip)
    winW = Math.round(imgAreaW + RESULT_PANE_W)
    winH = Math.round(Math.max(imgAreaH + TITLEBAR_H, 320))
  } else {
    // 解不出尺寸：回退到屏幕工作区的 75% 宽 / 85% 高
    winW = Math.round(screenWDip * 0.75)
    winH = Math.round(screenHDip * 0.85)
  }
  // 最终再夹一次，绝不超屏
  winW = Math.min(winW, screenWDip)
  winH = Math.min(winH, screenHDip)

  const isDark = window.ztools.isDarkColors()
  const logo = window.services.pluginLogoDataUrl()

  // 子窗口 URL：打包后为 screen-ocr-result.html（相对插件根）。
  const url = 'screen-ocr-result.html'

  try {
    const win = window.ztools.createBrowserWindow(
      url,
      {
        width: winW,
        height: winH,
        x: workArea.x + Math.floor((screenWDip - winW) / 2),
        y: workArea.y + Math.floor((screenHDip - winH) / 2),
        resizable: true,
        frame: false, // 无边框：标题栏与关闭按钮在子窗口内自绘
        title: '截图识别结果',
        // 任务栏/标题栏图标用插件 logo NativeImage（Windows 任务栏认 NativeImage 更可靠）
        icon: window.services.pluginLogoNativeImage() || window.services.pluginLogoPath(),
        minWidth: 480,
        minHeight: 320,
        maxWidth: screenWDip,
        maxHeight: screenHDip,
        webPreferences: {
          zoomFactor: 1
        }
      },
      () => {
        // 页面加载完成回调：注入识别数据
        injectData(win, { image, lines: linesData, isDark, logo })
      }
    )
    // 兜底：部分实现 callback 不可靠，延后再注入一次（幂等）
    window.setTimeout(
      () => injectData(win, { image, lines: linesData, isDark, logo }),
      800
    )

    // 开窗后退出主插件窗口
    try {
      window.ztools.outPlugin()
    } catch (_) {
      /* ignore */
    }
  } catch (err: any) {
    errorToast('打开结果窗口失败：' + (err?.message ? String(err.message) : String(err)))
    phase.value = 'error'
  }
}

/** 把数据注入子窗口：调用其 window.__loadScreenOcrResult。 */
function injectData(
  win: BrowserWindow.WindowInstance,
  data: { image: string; lines: OcrLine[]; isDark: boolean; logo?: string }
): void {
  try {
    // 序列化为安全的 JSON，避免引号/换行破坏 JS 字符串
    const payload = JSON.stringify(data)
    const code = `window.__loadScreenOcrResult && window.__loadScreenOcrResult(${payload});`
    win.webContents.executeJavaScript(code)
  } catch (_) {
    /* ignore：兜底注入会再试 */
  }
}

/** 从 PNG data URI 解析宽高（IHDR 在固定偏移）。非 PNG / 解析失败返回 null。 */
function decodePngSize(dataUri: string): { width: number; height: number } | null {
  try {
    const m = /^data:image\/png;base64,(.+)$/i.exec(dataUri)
    if (!m) return null
    // PNG 头：8 字节签名 + 25 字节 IHDR 长度/类型/CRC 中，宽高在 base64 解码后的
    // 第 16~23 字节（大端 uint32）。仅需前 ~24 字节，解码前 32 个 base64 字符即可。
    const b64 = m[1].slice(0, 32)
    // base64 -> binary string（atob 在渲染进程可用）
    const bin = atob(b64)
    if (bin.length < 24) return null
    const width =
      (bin.charCodeAt(16) << 24) |
      (bin.charCodeAt(17) << 16) |
      (bin.charCodeAt(18) << 8) |
      bin.charCodeAt(19)
    const height =
      (bin.charCodeAt(20) << 24) |
      (bin.charCodeAt(21) << 16) |
      (bin.charCodeAt(22) << 8) |
      bin.charCodeAt(23)
    if (width > 0 && height > 0) return { width, height }
  } catch (_) {
    /* ignore */
  }
  return null
}

/** Esc 退出（截屏进行中由系统接管）。 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && phase.value !== 'capturing') {
    try {
      window.ztools.outPlugin()
    } catch (_) {
      /* ignore */
    }
  }
}

// EngineStatusCard 下载完成回调：引擎就绪后自动进入截图流程（直接调 capture，
// 不走 startFlow 以避免再次 checkNative 的翻转）。
function onDownloaded(): void {
  capture()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 每次进入（含「开结果窗口后再次触发快捷键」的重新唤醒）都重置并重新推进
  window.ztools.onPluginEnter(() => {
    startFlow()
  })
  // 首次进入：onPluginEnter 可能在 onMounted 注册前已触发，故这里显式启动一次
  startFlow()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  // 释放 OCR 引擎子进程
  window.services.ocrDispose()
})
</script>

<template>
  <div class="screen-orchestrator">
    <!-- 未就绪：内嵌下载引导（一键下载、进度、错误、就绪），下载完成后自动截图 -->
    <div v-if="showDownloadGuide" class="download-wrap">
      <EngineStatusCard :show-actions="false" @downloaded="onDownloaded" />
      <p class="after-tip">下载完成后将自动开始截图识别</p>
    </div>

    <!-- 就绪后 / 识别流程中的状态展示 -->
    <div v-else class="status-card">
      <div class="status-icon" :class="{ spin: phase === 'recognizing' }">
        {{ phase === 'capturing' ? '✂️' : phase === 'recognizing' ? '🔍' : '📷' }}
      </div>
      <div class="status-text">
        <template v-if="phase === 'capturing'">请在屏幕上框选要识别的区域…</template>
        <template v-else-if="phase === 'recognizing'">正在识别…</template>
        <template v-else-if="phase === 'error'">{{ errorText || '识别失败' }}</template>
        <template v-else-if="phase === 'done'">识别完成，已打开结果窗口</template>
        <template v-else>
          {{ nativeState === 'checking' ? '检查引擎中…' : '准备截图…' }}
        </template>
      </div>
      <ZButton v-if="phase === 'error'" type="primary" @click="capture">重试截图</ZButton>
    </div>
  </div>
</template>

<style scoped>
.screen-orchestrator {
  padding: 24px 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  box-sizing: border-box;
}

/* 未就绪：下载引导区 */
.download-wrap {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.after-tip {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #999);
  text-align: center;
}

/* 就绪 / 识别流程状态卡 */
.status-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.status-icon {
  font-size: 36px;
  opacity: 0.85;
}

.status-icon.spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.status-text {
  font-size: 14px;
  color: var(--text-secondary, #999);
}
</style>
