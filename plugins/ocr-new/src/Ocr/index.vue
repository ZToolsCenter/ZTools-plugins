<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  },
  exitTick: {
    type: Number,
    default: 0
  }
})

type OcrStatus = 'idle' | 'loading' | 'recognizing' | 'done' | 'error'

type TesseractProgress = {
  status?: string
  progress?: number
}

type RedirectLabel = string | [string, string]
type PostRecognizeAction = 'view' | 'copy' | 'translate'
type OcrProvider = 'ocr-space' | 'baidu' | 'tencent' | 'local-http' | 'openai-compatible' | 'ztools-ai' | 'local'
type OcrEngine = OcrProvider | 'priority'
type ActivePanel = 'work' | 'settings'
type LocalServicePolicy = 'keep-running' | 'stop-on-out'

type OcrResult = {
  text: string
  confidence: number
}

const supportedImageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'avif']
const ocrProviders: OcrProvider[] = ['ocr-space', 'baidu', 'tencent', 'local-http', 'openai-compatible', 'ztools-ai', 'local']
const defaultEnginePriority: OcrProvider[] = ['ocr-space', 'local-http', 'local', 'ztools-ai']
const engineLabels: Record<OcrProvider, string> = {
  'ocr-space': 'OCR.Space',
  baidu: '百度 OCR',
  tencent: '腾讯云 OCR',
  'local-http': '本地 RapidOCR/PaddleOCR',
  'openai-compatible': 'OpenAI 兼容视觉',
  'ztools-ai': 'ZTools AI',
  local: '本地 OCR'
}
const engineModes = ['priority', ...ocrProviders]
const localServicePolicies: LocalServicePolicy[] = ['keep-running', 'stop-on-out']

const loadEnginePriority = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('ocr-engine-priority') || '[]')
    const filtered = Array.isArray(saved) ? saved.filter((item) => ocrProviders.includes(item)) : []
    return [...new Set([...filtered, ...defaultEnginePriority])].slice(0, 4) as OcrProvider[]
  } catch {
    return [...defaultEnginePriority]
  }
}

const imageSource = ref('')
const imageName = ref('')
const recognizedText = ref('')
const errorMessage = ref('')
const progress = ref(0)
const status = ref<OcrStatus>('idle')
const activePanel = ref<ActivePanel>('work')
const savedOcrEngine = localStorage.getItem('ocr-engine') as OcrEngine | null
const ocrEngine = ref<OcrEngine>(
  savedOcrEngine && engineModes.includes(savedOcrEngine)
    ? savedOcrEngine
    : 'priority'
)
const enginePriority = ref<OcrProvider[]>(loadEnginePriority())
const language = ref(localStorage.getItem('ocr-language') || 'chi_sim+eng')
const translateTarget = ref(localStorage.getItem('ocr-translate-target') || '翻译')
const ocrSpaceApiKey = ref(localStorage.getItem('ocr-space-api-key') || '')
const baiduApiKey = ref(localStorage.getItem('ocr-baidu-api-key') || '')
const baiduSecretKey = ref(localStorage.getItem('ocr-baidu-secret-key') || '')
const tencentSecretId = ref(localStorage.getItem('ocr-tencent-secret-id') || '')
const tencentSecretKey = ref(localStorage.getItem('ocr-tencent-secret-key') || '')
const tencentRegion = ref(localStorage.getItem('ocr-tencent-region') || 'ap-guangzhou')
const openAiEndpoint = ref(localStorage.getItem('ocr-openai-endpoint') || '')
const openAiModel = ref(localStorage.getItem('ocr-openai-model') || 'deepseek-ai/DeepSeek-OCR')
const openAiApiKey = ref(localStorage.getItem('ocr-openai-api-key') || '')
const localOcrEndpoint = ref(localStorage.getItem('ocr-local-http-endpoint') || 'http://127.0.0.1:8765/ocr')
const requestTimeoutSeconds = ref(Number(localStorage.getItem('ocr-request-timeout-seconds') || 30))
const enableTextCleanup = ref(localStorage.getItem('ocr-enable-text-cleanup') !== 'false')
const savedLocalServicePolicy = localStorage.getItem('ocr-local-service-policy') as LocalServicePolicy | null
const localServicePolicy = ref<LocalServicePolicy>(
  savedLocalServicePolicy && localServicePolicies.includes(savedLocalServicePolicy)
    ? savedLocalServicePolicy
    : 'keep-running'
)
const localOcrRunning = ref(false)
const localOcrInstalled = ref(false)
const localRuntimeBundled = ref(false)
const localOcrMessage = ref('')
const localOcrBusy = ref(false)

if (translateTarget.value.trim() === '翻译文本') {
  translateTarget.value = '翻译'
  localStorage.setItem('ocr-translate-target', '翻译')
}

let recognitionTicket = 0

const statusText = computed(() => {
  if (status.value === 'loading') return '正在加载 OCR 引擎'
  if (status.value === 'recognizing') return `正在识别 ${Math.round(progress.value * 100)}%`
  if (status.value === 'done') return recognizedText.value ? '识别完成' : '未识别到文字'
  if (status.value === 'error') return '识别失败'
  return imageSource.value ? '图片已就绪' : '等待图片'
})

const canRecognize = computed(() => !!imageSource.value && status.value !== 'loading' && status.value !== 'recognizing')
const canTranslate = computed(() => !!recognizedText.value.trim())

const loadImageFromFile = (filePath: string) => {
  const image = window.services.readImageAsDataUrl(filePath)
  imageSource.value = image.dataUrl
  imageName.value = image.name || image.path
  recognizedText.value = ''
  errorMessage.value = ''
  progress.value = 0
  status.value = 'idle'
}

const loadImageFromDataUrl = (dataUrl: string, name = '剪贴板图片') => {
  imageSource.value = dataUrl.startsWith('data:') ? dataUrl : `data:image/png;base64,${dataUrl}`
  imageName.value = name
  recognizedText.value = ''
  errorMessage.value = ''
  progress.value = 0
  status.value = 'idle'
}

const handleUseClipboardImage = () => {
  const image = window.services.getCopyedImage()
  if (!image) {
    window.ztools.showNotification('剪贴板中没有图片')
    return
  }
  loadImageFromDataUrl(image)
}

const handleCaptureImage = () => {
  window.ztools.hideMainWindow()
  window.ztools.screenCapture((imageBase64) => {
    if (!imageBase64) {
      window.ztools.showMainWindow()
      return
    }
    loadImageFromDataUrl(imageBase64, '截图')
    window.ztools.showMainWindow()
  })
}

const handleOpenImage = () => {
  const files = window.ztools.showOpenDialog({
    title: '选择图片',
    properties: ['openFile'],
    filters: [
      {
        name: '图片',
        extensions: supportedImageExtensions
      }
    ]
  })
  if (!files?.[0]) return
  loadImageFromFile(files[0])
}

const cleanText = (text: string) => {
  const normalized = text
    .replace(/^```(?:text|txt)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!enableTextCleanup.value) return normalized

  return normalized
    .replace(/(^|\n)\s*[。．.]\s*(?=\S)/g, '$1• ')
    .replace(/\bOpenA[lI]\b/g, 'OpenAI')
    .replace(/\bOpenAI\s*-\s*compatible\b/gi, 'OpenAI-compatible')
    .replace(/(?:Z\s*Tools|ZTools|ztools|zrools|2Too1s|ZToo1s)\s*A[lI]\b/gi, 'ZTools AI')
    .replace(/(?:Z\s*Tools|ztools|zrools|2Too1s|ZToo1s)\s+AI\b/gi, 'ZTools AI')
    .replace(/\bZTools(?:AI|Al)\b/g, 'ZTools AI')
    .replace(/\bVLLM\b/g, 'vLLM')
    .replace(/\bVDeepSeek-OCR\b/g, 'DeepSeek-OCR')
    .replace(/\bDeepSeek-OCR[。o]\b/g, 'DeepSeek-OCR')
    .replace(/http:\s*\/[7l]\s*\//gi, 'http://')
    .replace(/\bAI模型\b/g, 'AI 模型')
}

const getRequestTimeoutMs = () => {
  const seconds = Number(requestTimeoutSeconds.value)
  return Math.max(5, Math.min(180, Number.isFinite(seconds) ? seconds : 30)) * 1000
}

const normalizeVisionError = (message: string) => {
  if (message.includes('unknown variant `image_url`') || message.includes('expected `text`')) {
    return '当前接口或模型不支持图片输入（image_url），请换支持视觉的模型'
  }
  return message
}

const withTimeout = async <T,>(task: any, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          task?.abort?.()
          reject(new Error(message))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const runAiOcr = async () => {
  status.value = 'recognizing'
  progress.value = 0.2
  try {
    const response = await withTimeout<any>(
      window.ztools.ai({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '请提取图片中的所有可见文字。只输出识别到的原文，保留自然换行，不要解释，不要翻译。'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageSource.value,
                  detail: 'high'
                }
              }
            ]
          }
        ]
      } as any),
      getRequestTimeoutMs(),
      `ZTools AI 识别超时（${Math.round(getRequestTimeoutMs() / 1000)} 秒）`
    )
    progress.value = 1
    return cleanText(String(response?.content || ''))
  } catch (error: any) {
    throw new Error(normalizeVisionError(error?.message || 'ZTools AI 识别失败'))
  }
}

const runOcrSpace = async () => {
  status.value = 'recognizing'
  progress.value = 0.2
  const text = await window.services.ocrSpaceRecognize({
    base64Url: imageSource.value,
    apiKey: ocrSpaceApiKey.value.trim(),
    language: language.value,
    timeoutMs: getRequestTimeoutMs()
  })
  progress.value = 1
  return cleanText(text)
}

const runBaiduOcr = async () => {
  status.value = 'recognizing'
  progress.value = 0.2
  const text = await window.services.baiduOcrRecognize({
    base64Url: imageSource.value,
    apiKey: baiduApiKey.value.trim(),
    secretKey: baiduSecretKey.value.trim(),
    language: language.value,
    timeoutMs: getRequestTimeoutMs()
  })
  progress.value = 1
  return cleanText(text)
}

const runTencentOcr = async () => {
  status.value = 'recognizing'
  progress.value = 0.2
  const text = await window.services.tencentOcrRecognize({
    base64Url: imageSource.value,
    secretId: tencentSecretId.value.trim(),
    secretKey: tencentSecretKey.value.trim(),
    region: tencentRegion.value.trim() || 'ap-guangzhou',
    timeoutMs: getRequestTimeoutMs()
  })
  progress.value = 1
  return cleanText(text)
}

const runOpenAiVisionOcr = async () => {
  status.value = 'recognizing'
  progress.value = 0.2
  const text = await window.services.openAiVisionRecognize({
    base64Url: imageSource.value,
    endpoint: openAiEndpoint.value.trim(),
    apiKey: openAiApiKey.value.trim(),
    model: openAiModel.value.trim(),
    prompt: '请提取图片中的所有可见文字。只输出识别到的原文，保留自然换行，不要解释，不要翻译。',
    timeoutMs: getRequestTimeoutMs()
  })
  progress.value = 1
  return cleanText(text)
}

const runLocalHttpOcr = async () => {
  status.value = 'recognizing'
  progress.value = 0.2
  const text = await window.services.localHttpRecognize({
    base64Url: imageSource.value,
    endpoint: localOcrEndpoint.value.trim(),
    language: language.value,
    timeoutMs: getRequestTimeoutMs()
  })
  progress.value = 1
  return cleanText(text)
}

const handleProgress = (message: TesseractProgress) => {
  if (typeof message.progress === 'number') {
    progress.value = Math.max(0, Math.min(1, message.progress))
  }
  if (message.status?.includes('recognizing')) {
    status.value = 'recognizing'
  }
}

const preprocessImageForOcr = (source: string) => {
  return new Promise<string>((resolve) => {
    const image = new Image()
    image.onload = () => {
      const longSide = Math.max(image.naturalWidth, image.naturalHeight)
      const scale = Math.min(3, Math.max(1.35, 2200 / Math.max(longSide, 1)))
      const width = Math.round(image.naturalWidth * scale)
      const height = Math.round(image.naturalHeight * scale)
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })

      if (!context || !width || !height) {
        resolve(source)
        return
      }

      canvas.width = width
      canvas.height = height
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, width, height)

      const imageData = context.getImageData(0, 0, width, height)
      const data = imageData.data
      const contrast = 1.55

      for (let index = 0; index < data.length; index += 4) {
        const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
        let gray = (luminance - 128) * contrast + 128
        if (gray > 244) gray = 255
        if (gray < 28) gray = 0
        gray = Math.max(0, Math.min(255, gray))
        data[index] = gray
        data[index + 1] = gray
        data[index + 2] = gray
      }

      context.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => resolve(source)
    image.src = source
  })
}

const recognizeImage = async (source: string): Promise<OcrResult> => {
  const tesseract = (await import('tesseract.js')) as any

  if (typeof tesseract.createWorker === 'function') {
    let worker: any
    try {
      worker = await tesseract.createWorker(language.value, undefined, {
        logger: handleProgress
      })
      await worker.setParameters?.({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '6'
      })
      const result = await worker.recognize(source)
      return {
        text: result?.data?.text || '',
        confidence: Number(result?.data?.confidence || 0)
      }
    } finally {
      await worker?.terminate?.()
    }
  }

  const recognize = tesseract.recognize || tesseract.default?.recognize
  if (typeof recognize !== 'function') {
    throw new Error('OCR 引擎加载失败')
  }

  const result = await recognize(source, language.value, {
    logger: handleProgress
  })
  return {
    text: result?.data?.text || '',
    confidence: Number(result?.data?.confidence || 0)
  }
}

const chooseBetterResult = (primary: OcrResult, fallback: OcrResult) => {
  const primaryText = cleanText(primary.text)
  const fallbackText = cleanText(fallback.text)
  const primaryScore = primaryText.length + primary.confidence * 0.25
  const fallbackScore = fallbackText.length + fallback.confidence * 0.25
  return fallbackScore > primaryScore ? fallbackText : primaryText
}

const runLocalOcr = async () => {
  const preparedSource = await preprocessImageForOcr(imageSource.value)
  const primaryResult = await recognizeImage(preparedSource)
  let text = cleanText(primaryResult.text)

  if ((text.length < 4 || primaryResult.confidence < 35) && preparedSource !== imageSource.value) {
    const fallbackResult = await recognizeImage(imageSource.value)
    text = chooseBetterResult(primaryResult, fallbackResult)
  }

  localStorage.setItem('ocr-language', language.value)
  return text
}

const runProviderOcr = (provider: OcrProvider) => {
  if (provider === 'openai-compatible') return runOpenAiVisionOcr()
  if (provider === 'ocr-space') return runOcrSpace()
  if (provider === 'baidu') return runBaiduOcr()
  if (provider === 'tencent') return runTencentOcr()
  if (provider === 'local-http') return runLocalHttpOcr()
  if (provider === 'ztools-ai') return runAiOcr()
  return runLocalOcr()
}

const getProviderSequence = () => {
  if (ocrEngine.value !== 'priority') return [ocrEngine.value as OcrProvider]
  const configuredProviders = enginePriority.value.filter((provider) => {
    if (!ocrProviders.includes(provider)) return false
    if (provider === 'baidu') return !!baiduApiKey.value.trim() && !!baiduSecretKey.value.trim()
    if (provider === 'tencent') return !!tencentSecretId.value.trim() && !!tencentSecretKey.value.trim()
    if (provider === 'openai-compatible') return !!openAiEndpoint.value.trim() && !!openAiModel.value.trim()
    return true
  })
  return [...new Set(configuredProviders.length ? configuredProviders : defaultEnginePriority)]
}

const runOcr = async () => {
  if (!imageSource.value) return ''

  const currentTicket = ++recognitionTicket
  status.value = 'loading'
  progress.value = 0
  errorMessage.value = ''

  try {
    const providers = getProviderSequence()
    let lastError = ''

    for (const provider of providers) {
      try {
        if (providers.length > 1) {
          errorMessage.value = `正在尝试 ${engineLabels[provider]}`
        }

        const text = await runProviderOcr(provider)

        if (currentTicket !== recognitionTicket) return recognizedText.value
        if (!text.trim() && providers.length > 1) {
          lastError = `${engineLabels[provider]} 未识别到文字`
          errorMessage.value = lastError
          continue
        }

        recognizedText.value = text
        status.value = 'done'
        progress.value = 1
        errorMessage.value = ''
        localStorage.setItem('ocr-engine', ocrEngine.value)
        return text
      } catch (providerError: any) {
        lastError = `${engineLabels[provider]}：${providerError?.message || '识别失败'}`
        if (providers.length === 1) throw providerError
        errorMessage.value = lastError
      }
    }

    if (currentTicket !== recognitionTicket) return recognizedText.value
    throw new Error(lastError || 'OCR 识别失败')
  } catch (error: any) {
    if (currentTicket !== recognitionTicket) return recognizedText.value
    errorMessage.value = error?.message || 'OCR 识别失败'
    status.value = 'error'
    progress.value = 0
    return ''
  }
}

const getRedirectLabel = (): RedirectLabel => {
  const target = translateTarget.value.trim() || '翻译'
  const parts = target.split('/').map((item) => item.trim()).filter(Boolean)
  if (parts.length === 2) return [parts[0], parts[1]]
  return target
}

const handleTranslate = () => {
  const text = recognizedText.value.trim()
  if (!text) {
    window.ztools.showNotification('没有可翻译的文字')
    return false
  }

  localStorage.setItem('ocr-translate-target', translateTarget.value.trim() || '翻译')
  window.ztools.copyText(text)
  const redirected = window.ztools.redirect(getRedirectLabel() as any, text)
  if (!redirected) {
    window.ztools.showNotification('未找到翻译指令，识别文本已复制')
  }
  return redirected
}

const handleCopyText = () => {
  const text = recognizedText.value.trim()
  if (!text) return
  window.ztools.copyText(text)
  window.ztools.showNotification('识别文本已复制')
}

const handleOpenAiModelSettings = () => {
  window.ztools.redirectAiModelsSetting()
}

const handleOpenExternal = (url: string) => {
  window.ztools.shellOpenExternal(url)
}

const handlePriorityChange = (index: number, event: Event) => {
  const target = event.target as HTMLSelectElement
  enginePriority.value[index] = target.value as OcrProvider
  localStorage.setItem('ocr-engine-priority', JSON.stringify(enginePriority.value))
}

const refreshLocalOcrStatus = async () => {
  const statusResult = await window.services.getLocalOcrStatus({ endpoint: localOcrEndpoint.value })
  localOcrRunning.value = statusResult.running
  localRuntimeBundled.value = statusResult.runtimeBundled
  if (statusResult.running) {
    localOcrMessage.value = '本地 OCR 服务运行中'
  } else if (statusResult.runtimeBundled) {
    localOcrMessage.value = '内置 RapidOCR 运行时已就绪'
  } else {
    localOcrMessage.value = '当前平台未集成 RapidOCR 运行时'
  }
}

const handleStartLocalOcr = async () => {
  localOcrBusy.value = true
  localOcrMessage.value = '正在启动本地 OCR 服务'
  try {
    await window.services.startLocalOcr()
    localOcrMessage.value = '本地 OCR 服务已启动，请稍后刷新状态'
    window.setTimeout(() => {
      void refreshLocalOcrStatus()
    }, 1200)
  } catch (error: any) {
    localOcrMessage.value = error?.message || '本地 OCR 启动失败'
  } finally {
    localOcrBusy.value = false
  }
}

const handleStopLocalOcr = async () => {
  localOcrBusy.value = true
  localOcrMessage.value = '正在停止本地 OCR 服务'
  try {
    const result = await window.services.stopLocalOcr()
    localOcrMessage.value = result.stopped ? '本地 OCR 服务已停止' : '没有找到由插件启动的本地服务'
    await refreshLocalOcrStatus()
  } catch (error: any) {
    localOcrMessage.value = error?.message || '本地 OCR 停止失败'
  } finally {
    localOcrBusy.value = false
  }
}

const stopLocalOcrByPolicy = async () => {
  if (localServicePolicy.value !== 'stop-on-out') return
  try {
    const result = await window.services.stopLocalOcr()
    if (result.stopped) {
      localOcrRunning.value = false
      localOcrMessage.value = '已按策略停止本地 OCR 服务'
    }
  } catch (_error) {
    localOcrMessage.value = '按策略停止本地 OCR 服务失败'
  }
}

const completeAfterRecognize = (action: PostRecognizeAction, shouldExit = false) => {
  const text = recognizedText.value.trim()
  if (!text) {
    if (shouldExit) {
      window.ztools.showNotification('未识别到文字')
      window.ztools.outPlugin()
    }
    return
  }

  if (action === 'copy') {
    window.ztools.copyText(text)
    window.ztools.showNotification('识别文本已复制')
    if (shouldExit) window.ztools.outPlugin()
    return
  }

  if (action === 'translate') {
    const redirected = handleTranslate()
    if (shouldExit && !redirected) window.ztools.outPlugin()
    return
  }

  if (shouldExit) {
    window.ztools.showMainWindow()
  }
}

const handleRecognize = async (postAction: PostRecognizeAction = 'view', shouldExit = false) => {
  const text = await runOcr()
  if (text.trim()) {
    completeAfterRecognize(postAction, shouldExit)
  } else if (shouldExit) {
    completeAfterRecognize(postAction, shouldExit)
  }
}

const getPostAction = (code = ''): PostRecognizeAction => {
  if (code.includes('translate')) return 'translate'
  if (code.includes('copy')) return 'copy'
  return 'view'
}

const shouldCaptureScreen = (enterAction: any) => {
  return typeof enterAction?.code === 'string' && enterAction.code.includes('screenshot')
}

const handleScreenshotAction = (enterAction: any) => {
  window.ztools.hideMainWindow()
  window.ztools.screenCapture(async (imageBase64) => {
    if (!imageBase64) {
      window.ztools.outPlugin()
      return
    }
    loadImageFromDataUrl(imageBase64, '截图')
    await handleRecognize(getPostAction(enterAction.code), enterAction.code !== 'ocr')
  })
}

const handleEnterAction = async (enterAction: any) => {
  try {
    if (enterAction?.code === 'ocr-settings') {
      activePanel.value = 'settings'
      return
    }

    if (!enterAction?.type && !shouldCaptureScreen(enterAction)) {
      if (enterAction?.code && enterAction.code !== 'ocr') {
        const image = window.services.getCopyedImage()
        if (!image) {
          window.ztools.showNotification('剪贴板中没有图片')
          window.ztools.outPlugin()
          return
        }
        loadImageFromDataUrl(image)
        await handleRecognize(getPostAction(enterAction.code), true)
      }
      return
    }

    if (shouldCaptureScreen(enterAction)) {
      handleScreenshotAction(enterAction)
      return
    }

    if (enterAction.type === 'img' && typeof enterAction.payload === 'string') {
      loadImageFromDataUrl(enterAction.payload)
      await handleRecognize(getPostAction(enterAction.code), enterAction.code !== 'ocr')
      return
    }

    if (enterAction.type === 'files' && enterAction.payload?.[0]?.path) {
      loadImageFromFile(enterAction.payload[0].path)
      await handleRecognize(getPostAction(enterAction.code), enterAction.code !== 'ocr')
    }
  } catch (error: any) {
    errorMessage.value = error?.message || '图片读取失败'
    status.value = 'error'
  }
}

watch(
  () => props.enterAction,
  (enterAction) => {
    void handleEnterAction(enterAction)
  },
  {
    immediate: true
  }
)

watch(language, (value) => {
  localStorage.setItem('ocr-language', value)
})

watch(ocrEngine, (value) => {
  localStorage.setItem('ocr-engine', value)
})

watch(
  enginePriority,
  (value) => {
    localStorage.setItem('ocr-engine-priority', JSON.stringify(value))
  },
  { deep: true }
)

watch(ocrSpaceApiKey, (value) => {
  localStorage.setItem('ocr-space-api-key', value.trim())
})

watch(baiduApiKey, (value) => {
  localStorage.setItem('ocr-baidu-api-key', value.trim())
})

watch(baiduSecretKey, (value) => {
  localStorage.setItem('ocr-baidu-secret-key', value.trim())
})

watch(tencentSecretId, (value) => {
  localStorage.setItem('ocr-tencent-secret-id', value.trim())
})

watch(tencentSecretKey, (value) => {
  localStorage.setItem('ocr-tencent-secret-key', value.trim())
})

watch(tencentRegion, (value) => {
  localStorage.setItem('ocr-tencent-region', value.trim() || 'ap-guangzhou')
})

watch(openAiEndpoint, (value) => {
  localStorage.setItem('ocr-openai-endpoint', value.trim())
})

watch(openAiModel, (value) => {
  localStorage.setItem('ocr-openai-model', value.trim())
})

watch(openAiApiKey, (value) => {
  localStorage.setItem('ocr-openai-api-key', value.trim())
})

watch(localOcrEndpoint, (value) => {
  localStorage.setItem('ocr-local-http-endpoint', value.trim() || 'http://127.0.0.1:8765/ocr')
})

watch(requestTimeoutSeconds, (value) => {
  const seconds = Math.max(5, Math.min(180, Number(value) || 30))
  requestTimeoutSeconds.value = seconds
  localStorage.setItem('ocr-request-timeout-seconds', String(seconds))
})

watch(enableTextCleanup, (value) => {
  localStorage.setItem('ocr-enable-text-cleanup', String(value))
})

watch(translateTarget, (value) => {
  localStorage.setItem('ocr-translate-target', value.trim() || '翻译')
})

watch(localServicePolicy, (value) => {
  localStorage.setItem('ocr-local-service-policy', value)
})

watch(
  () => props.exitTick,
  (value, previousValue) => {
    if (value !== previousValue) void stopLocalOcrByPolicy()
  }
)

onBeforeUnmount(() => {
  recognitionTicket += 1
  void stopLocalOcrByPolicy()
})

onMounted(() => {
  void refreshLocalOcrStatus()
})
</script>

<template>
  <div class="ocr">
    <header class="ocr-toolbar">
      <div class="ocr-title">
        <h1>OCR 翻译</h1>
        <span>{{ statusText }}</span>
      </div>
      <div class="ocr-actions">
        <button type="button" @click="activePanel = activePanel === 'settings' ? 'work' : 'settings'">设置</button>
        <button type="button" @click="handleOpenImage">图片</button>
        <button type="button" @click="handleUseClipboardImage">剪贴板</button>
        <button type="button" @click="handleCaptureImage">截图</button>
        <button type="button" :disabled="!canRecognize" @click="handleRecognize('view')">识别</button>
        <button type="button" :disabled="!canRecognize" @click="handleRecognize('translate')">翻译</button>
      </div>
    </header>

    <main v-if="activePanel === 'work'" class="ocr-layout">
      <section class="preview-pane">
        <img v-if="imageSource" :src="imageSource" :alt="imageName" />
        <div v-else class="empty-preview">选择图片后开始</div>
      </section>

      <section class="result-pane">
        <div class="home-controls">
          <label>
            <span>识别引擎</span>
            <select v-model="ocrEngine">
              <option value="priority">按优先级</option>
              <option value="ocr-space">OCR.Space</option>
              <option value="local-http">本地 RapidOCR/PaddleOCR</option>
              <option value="baidu">百度 OCR</option>
              <option value="tencent">腾讯云 OCR</option>
              <option value="openai-compatible">OpenAI 兼容视觉</option>
              <option value="ztools-ai">ZTools AI</option>
              <option value="local">本机 Tesseract</option>
            </select>
          </label>

          <label>
            <span>语言</span>
            <select v-model="language">
              <option value="chi_sim+eng">中文 + 英文</option>
              <option value="chi_sim">中文</option>
              <option value="eng">英文</option>
            </select>
          </label>
          <button type="button" class="text-button" @click="activePanel = 'settings'">
            优先级 / 高级设置
          </button>
        </div>

        <div v-if="status === 'loading' || status === 'recognizing'" class="progress-track">
          <div :style="{ width: `${Math.round(progress * 100)}%` }"></div>
        </div>

        <textarea v-model="recognizedText" spellcheck="false" placeholder="识别结果"></textarea>

        <div class="result-actions">
          <button type="button" :disabled="!canTranslate" @click="handleTranslate">翻译</button>
          <button type="button" :disabled="!canTranslate" @click="handleCopyText">复制文本</button>
        </div>

        <p v-if="imageName" class="image-name">{{ imageName }}</p>
        <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      </section>
    </main>

    <main v-else class="settings-panel">
      <section class="settings-group">
        <h2>识别策略</h2>
        <div class="settings-form">
          <label>
            <span>引擎</span>
            <select v-model="ocrEngine">
              <option value="priority">按优先级</option>
              <option value="ocr-space">OCR.Space</option>
              <option value="baidu">百度 OCR</option>
              <option value="tencent">腾讯云 OCR</option>
              <option value="local-http">本地 RapidOCR/PaddleOCR</option>
              <option value="openai-compatible">OpenAI 兼容视觉</option>
              <option value="ztools-ai">ZTools AI</option>
              <option value="local">本地 OCR</option>
            </select>
          </label>

          <label>
            <span>语言</span>
            <select v-model="language">
              <option value="chi_sim+eng">中文 + 英文</option>
              <option value="chi_sim">中文</option>
              <option value="eng">英文</option>
            </select>
          </label>

          <label>
            <span>请求超时（秒）</span>
            <input v-model.number="requestTimeoutSeconds" type="number" min="5" max="180" step="5" />
          </label>

          <label class="checkbox-field">
            <input v-model="enableTextCleanup" type="checkbox" />
            <span>清理常见误识别</span>
          </label>
        </div>

        <div class="priority-list">
          <label v-for="(_, index) in enginePriority" :key="index">
            <span>优先级 {{ index + 1 }}</span>
            <select :value="enginePriority[index]" @change="handlePriorityChange(index, $event)">
              <option v-for="provider in ocrProviders" :key="provider" :value="provider">
                {{ engineLabels[provider] }}
              </option>
            </select>
          </label>
        </div>
      </section>

      <section class="settings-group">
        <h2>免费云 OCR</h2>
        <div class="settings-form">

          <label>
            <span>OCR.Space API Key</span>
            <input v-model="ocrSpaceApiKey" type="password" placeholder="留空使用测试 Key" />
          </label>

          <label>
            <span>百度 API Key</span>
            <input v-model="baiduApiKey" type="password" placeholder="百度智能云 API Key" />
          </label>

          <label>
            <span>百度 Secret Key</span>
            <input v-model="baiduSecretKey" type="password" placeholder="百度智能云 Secret Key" />
          </label>

          <label>
            <span>腾讯 SecretId</span>
            <input v-model="tencentSecretId" type="password" placeholder="腾讯云 SecretId" />
          </label>

          <label>
            <span>腾讯 SecretKey</span>
            <input v-model="tencentSecretKey" type="password" placeholder="腾讯云 SecretKey" />
          </label>

          <label>
            <span>腾讯地域</span>
            <input v-model="tencentRegion" placeholder="ap-guangzhou" />
          </label>
        </div>
      </section>

      <section class="settings-group">
        <h2>本地 RapidOCR</h2>
        <div class="settings-form">
          <label>
            <span>服务 Endpoint</span>
            <input v-model="localOcrEndpoint" placeholder="http://127.0.0.1:8765/ocr" />
          </label>
          <label>
            <span>服务策略</span>
            <select v-model="localServicePolicy">
              <option value="keep-running">常驻后台，下次更快</option>
              <option value="stop-on-out">退出插件时自动停止</option>
            </select>
          </label>
        </div>
        <div class="local-status">
          <span :class="{ ok: localOcrRunning }">{{ localOcrMessage || '尚未检测' }}</span>
        </div>
        <div class="local-actions">
          <button type="button" :disabled="localOcrBusy || !localRuntimeBundled" @click="handleStartLocalOcr">启动服务</button>
          <button type="button" :disabled="localOcrBusy || !localOcrRunning" @click="handleStopLocalOcr">停止服务</button>
          <button type="button" :disabled="localOcrBusy" @click="refreshLocalOcrStatus">刷新状态</button>
        </div>
      </section>

      <section class="settings-group">
        <h2>高级视觉</h2>
        <div class="settings-form one-column">
          <label>
            <span>OpenAI Endpoint</span>
            <input v-model="openAiEndpoint" placeholder="https://host/v1" />
          </label>

          <label>
            <span>OpenAI Model</span>
            <input v-model="openAiModel" placeholder="deepseek-ai/DeepSeek-OCR" />
          </label>

          <label>
            <span>OpenAI API Key</span>
            <input v-model="openAiApiKey" type="password" placeholder="本地服务可留空" />
          </label>
        </div>
      </section>

      <section class="settings-group">
        <h2>跳转</h2>
        <div class="settings-form one-column">
          <label>
            <span>翻译目标</span>
            <input v-model="translateTarget" list="translate-targets" placeholder="翻译" />
            <datalist id="translate-targets">
              <option value="翻译"></option>
              <option value="OCR 翻译/翻译"></option>
              <option value="translate"></option>
            </datalist>
          </label>
        </div>
      </section>

      <section class="settings-group settings-help">
        <h2>获取 API</h2>
        <div class="help-list">
          <p>
            <strong>ZTools AI：</strong>在 ZTools AI 模型里添加支持图片的模型，然后选择“ZTools AI”。
          </p>
          <p>
            <strong>OCR.Space：</strong>访问
            <a href="https://ocr.space/ocrapi" @click.prevent="handleOpenExternal('https://ocr.space/ocrapi')">
              ocr.space/ocrapi
            </a>
            注册免费 Key；留空会使用测试 Key，适合临时验证。
          </p>
          <p>
            <strong>百度 / 腾讯：</strong>开通对应云 OCR 服务后填入密钥，通常有新用户免费额度或试用额度。
          </p>
          <p>
            <strong>云端视觉模型：</strong>选择支持 OpenAI-compatible 的供应商，填 Base URL、模型名和 API Key。
          </p>
          <p>
            <strong>DeepSeek-OCR：</strong>它是开源模型，不是官方免费 API；自建 vLLM 服务后填
            <span class="inline-code">http://127.0.0.1:8000/v1</span> 和模型名
            <span class="inline-code">deepseek-ai/DeepSeek-OCR</span>。
          </p>
          <p>
            <strong>本地 RapidOCR：</strong>插件已内置 RapidOCR 运行时，无需额外安装，可直接启动本地 OCR 服务。
             不想启动本地服务时，可以使用 OCR.Space / 百度 / 腾讯等云端 OCR。
          </p>
        </div>
        <button type="button" @click="handleOpenAiModelSettings">打开 AI 模型设置</button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.ocr {
  min-height: 100vh;
  padding: 14px;
  box-sizing: border-box;
  color: #1f2937;
  overflow-x: hidden;
}

.ocr-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.ocr-title h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0;
}

.ocr-title span {
  display: block;
  margin-top: 5px;
  color: #64748b;
  font-size: 13px;
}

.ocr-actions,
.result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.ocr-actions button,
.result-actions button {
  min-width: 72px;
  height: 34px;
  padding: 0 11px;
  border-radius: 6px;
  line-height: 34px;
  font-size: 13px;
  white-space: nowrap;
}

.ocr-actions button:last-child,
.result-actions button:first-child {
  background: #169b62;
}

.ocr-layout {
  display: grid;
  grid-template-columns: minmax(260px, 42%) minmax(0, 1fr);
  gap: 14px;
  min-height: calc(100vh - 84px);
  min-width: 0;
}

.preview-pane,
.result-pane {
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  box-sizing: border-box;
  min-width: 0;
}

.settings-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(260px, 1fr));
  gap: 14px;
}

.settings-group {
  padding: 14px;
  border: 1px solid #d7dee8;
  border-radius: 8px;
  background: #ffffff;
  box-sizing: border-box;
}

.settings-group h2 {
  margin: 0 0 12px;
  font-size: 16px;
  line-height: 1.25;
  letter-spacing: 0;
}

.settings-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.settings-form.one-column {
  grid-template-columns: 1fr;
}

.settings-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.settings-form span {
  color: #64748b;
  font-size: 12px;
}

.settings-form select,
.settings-form input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  box-sizing: border-box;
  background: #ffffff;
  color: #1f2937;
}

.settings-form .checkbox-field {
  justify-content: end;
  min-height: 57px;
}

.checkbox-field {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
}

.checkbox-field input {
  width: 16px !important;
  height: 16px !important;
  padding: 0 !important;
}

.checkbox-field span {
  color: #1f2937;
  font-size: 13px;
}

.priority-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.priority-list label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.priority-list span {
  color: #64748b;
  font-size: 12px;
}

.priority-list select {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  box-sizing: border-box;
  background: #ffffff;
  color: #1f2937;
}

.local-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
  color: #64748b;
  font-size: 13px;
}

.local-status .ok {
  color: #169b62;
}

.sub-status {
  color: #94a3b8;
  font-size: 12px;
}

.local-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.local-actions button {
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  line-height: 32px;
  font-size: 13px;
}

.settings-help {
  grid-column: 1 / -1;
}

.help-list {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.help-list p {
  margin: 0;
  color: #334155;
  line-height: 1.55;
  font-size: 13px;
}

.help-list a {
  color: #2563eb;
  text-decoration: none;
}

.help-list a:hover {
  text-decoration: underline;
}

.inline-code {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  background: #eef2f7;
  color: #0f172a;
  font-family: Consolas, monospace;
  font-size: 12px;
}

.preview-pane {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 320px;
}

.preview-pane img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.empty-preview {
  color: #64748b;
  font-size: 14px;
}

.result-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  min-width: 0;
}

.home-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(112px, 150px);
  gap: 10px;
  align-items: end;
  min-width: 0;
}

.home-controls label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.home-controls span {
  color: #64748b;
  font-size: 12px;
}

.text-button {
  all: unset;
  grid-column: 1 / -1;
  justify-self: start;
  box-sizing: border-box;
  min-height: 22px;
  max-width: 100%;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #2563eb;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-controls select,
.home-controls input[type='text'],
.home-controls input:not([type]) {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  box-sizing: border-box;
  background: #ffffff;
  color: #1f2937;
}

.progress-track {
  width: 100%;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}

.progress-track div {
  height: 100%;
  border-radius: inherit;
  background: #169b62;
  transition: width 0.2s ease;
}

textarea {
  flex: 1;
  min-height: 210px;
  width: 100%;
  padding: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-sizing: border-box;
  resize: none;
  background: #fbfdff;
  color: #111827;
  line-height: 1.55;
  font-family: Consolas, 'Microsoft YaHei', monospace;
  font-size: 14px;
}

.image-name,
.error-message {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.image-name {
  color: #64748b;
}

.error-message {
  color: #c2410c;
}

@media (max-width: 720px) {
  .ocr-toolbar,
  .ocr-layout {
    display: flex;
    flex-direction: column;
  }

  .ocr-toolbar {
    align-items: stretch;
  }

  .home-controls {
    grid-template-columns: 1fr;
  }

  .settings-panel,
  .settings-form,
  .priority-list {
    grid-template-columns: 1fr;
  }

  .preview-pane {
    min-height: 220px;
  }
}

@media (prefers-color-scheme: dark) {
  .ocr {
    color: #f8fafc;
  }

  .ocr-title span,
  .home-controls span,
  .empty-preview,
  .image-name {
    color: #a9b6c7;
  }

  .preview-pane,
  .result-pane,
  .settings-group {
    border-color: #4b5563;
    background: #374151;
  }

  .home-controls select,
  .home-controls input[type='text'],
  .home-controls input:not([type]),
  .settings-form select,
  .settings-form input,
  .priority-list select,
  textarea {
    border-color: #566274;
    background: #1f2937;
    color: #f8fafc;
  }

  .text-button {
    color: #93c5fd;
  }

  .help-list p {
    color: #d7dee8;
  }

  .local-status {
    color: #a9b6c7;
  }

  .checkbox-field span {
    color: #f8fafc;
  }

  .help-list a {
    color: #93c5fd;
  }

  .inline-code {
    background: #1f2937;
    color: #f8fafc;
  }

  .progress-track {
    background: #4b5563;
  }

  .error-message {
    color: #fdba74;
  }
}
</style>