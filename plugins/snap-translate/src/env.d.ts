/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  // ─── 宿主 Provider 消费方 API 增补 ───────────────────────────────────
  // @ztools-center/ztools-api-types 尚未收录 provider 聚合 API（ztools.ocr /
  // ztools.translate / ztools.providers.invokeProvider），此处按 f-provider
  // README 描述的契约做声明合并；官方类型跟上后可删除。
  interface ZToolsApi {
    /** 走默认 OCR 提供商识别图片（image: 本地路径 / data: URI / http(s) URL）。 */
    ocr(image: string, options?: { lang?: string; providerId?: string }): Promise<OcrProviderOutput>
    /**
     * 走翻译提供商。providerId 可选，缺省宿主默认；
     * 插件渠道 id 形如 plugin:snap-translate:microsoft。
     */
    translate(
      text: string,
      options?: { from?: string; to?: string; providerId?: string }
    ): Promise<TranslateProviderOutput>
    /**
     * 宿主聚合 API（真实签名）：
     *   getProviders(type?) → 渠道列表
     *   invokeProvider(type, input, providerId?)  // type = 'translation' | 'ocr'
     */
    providers: {
      getProviders(type?: string): Promise<
        Array<{
          id: string
          type: string
          key?: string
          label?: string
          description?: string
          source?: string
          pluginName?: string
          isDefault?: boolean
        }>
      >
      getDefaultProvider(type: string): Promise<{ id: string; type: string; isDefault?: boolean } | null>
      invokeProvider(type: string, input: unknown, providerId?: string): Promise<unknown>
    }
  }

  // ─── 宿主 Provider 契约（消费方视角） ────────────────────────────────

  /** OCR Provider 契约输出：{ text, blocks?, confidence? }（ztools.ocr 返回值）。 */
  interface OcrProviderOutput {
    /** 全部识别文字（以换行拼接）。 */
    text: string
    /** 逐行文字（有的 provider 可能不给）。 */
    blocks?: string[]
    /** 置信度 0~1（可选）。 */
    confidence?: number
  }

  /** 微信 OCR 明细行（贴图覆盖翻译用）。 */
  interface OcrDetailLine {
    text: string
    rate?: number
    left?: number
    top?: number
    right?: number
    bottom?: number
    boxPoints?: { x: number; y: number }[]
  }

  /** 翻译 Provider 契约输出：{ text, detectedFrom? }（ztools.translate 返回值）。 */
  interface TranslateProviderOutput {
    text: string
    detectedFrom?: string
  }

  // ─── 本插件内部数据结构 ──────────────────────────────────────────────

  /**
   * 一条「原文 ↔ 译文」对照行。
   * 当 OCR provider 不提供逐行 blocks 时，整段作为单行（box 为空）。
   */
  interface SnapLine {
    /** OCR 原文。 */
    text: string
    /** 译文（翻译失败/未翻译时为空串）。 */
    translated: string
  }

  /** 注入结果窗口的完整数据包。 */
  interface SnapResultPayload {
    /** 截图 / 图片的 data URI。 */
    image: string
    /** 原文/译文对照行。 */
    lines: SnapLine[]
    /** 目标语言码（中性语言码，如 zh-CN / en）。 */
    targetLang: string
    /** 检测到的源语言（provider 返回，可为空）。 */
    detectedFrom?: string
    /** 是否深色主题（进入时从宿主读取，注入给无 ztools 的子窗口）。 */
    isDark: boolean
    /** 插件 logo data URI（子窗口标题栏图标）。 */
    logo?: string
    /** 翻译是否可用（false = 降级为纯 OCR 展示）。 */
    translateOk: boolean
    /** 翻译不可用时的原因说明。 */
    translateError?: string
    /** 诊断日志（逐步 OCR/翻译尝试痕迹）。 */
    diagnostics?: string[]
    /** 实际命中的 OCR provider。 */
    ocrProvider?: string
    /** 实际命中的翻译 provider。 */
    translateProvider?: string
  }

  interface BoardHandlers {
    onOcr?: (data?: any) => void | Promise<void>
    onTranslate?: (data?: any) => void | Promise<void>
    onOcrTranslate?: (data?: any) => void | Promise<void>
    onClose?: (data?: any) => void | Promise<void>
    onLog?: (data?: any) => void
    onCopyImage?: (data?: any) => void | Promise<void>
    onOpenSettings?: (data?: any) => void | Promise<void>
    onSave?: (data?: any) => void | Promise<void>
  }

  /** 下载/解压进度上报。 */
  interface NativeDownloadProgress {
    phase: 'downloading' | 'extracting'
    percent: number
    loaded: number
    total: number
  }

  /** nativeDownload / paddleDownload 返回结果。 */
  interface NativeDownloadResult {
    ok: boolean
    error?: string
    cancelled?: boolean
  }

  type TranslateProviderName =
    | 'baidu'
    | 'google'
    | 'youdao'
    | 'microsoft'
    | 'ai-translation'

  type MicrosoftRequestMode = 'edge' | 'signature'

  interface TranslateSettingsMap {
    baidu: { appID: string; appKey: string }
    google: Record<string, never>
    youdao: { appKey: string; appSecret: string }
    microsoft: { requestMode: MicrosoftRequestMode }
    'ai-translation': { model: string; systemPrompt: string }
  }

  interface OcrSettingsMap {
    'ai-ocr': { model: string; systemPrompt: string }
  }

  type ImageHostType = 'img-scdn'

  interface ImageHostSettings {
    enabled: boolean
    type: ImageHostType
  }

  /** Preload 注入的 window.services（见 public/preload/services.js）。 */
  interface Services {
    /** 读图片二进制并返回 data URI（供 <img>/<canvas> 直接预览本地 path 图片）。 */
    readFileAsDataURL: (file: string) => string
    /** 插件 logo 绝对路径（用于 createBrowserWindow 的 icon 兜底）。 */
    pluginLogoPath: () => string
    /** 插件 logo 的 data URI（注入子窗口展示）。 */
    pluginLogoDataUrl: () => string
    /** 插件 logo 的 NativeImage（Windows 任务栏图标）。 */
    pluginLogoNativeImage: () => unknown
    setBoardHandlers: (handlers: BoardHandlers | null) => void
    injectBoardUpdate: (payload: Record<string, unknown>) => void
    openStickyBoard: (payload: {
      image: string
      isDark?: boolean
      logo?: string
      title?: string
      /** screenCapture 回调的截图区域，用于把贴图放在截图原处。 */
      captureBounds?: { x: number; y: number; width?: number; height?: number }
    }) => boolean
    closeStickyBoard: () => void
    saveImageFile: (dataUrl: string, destPath: string) => string
    /** 贴在悬浮图旁的结果侧窗。 */
    openSideResult: (payload: SnapResultPayload) => boolean
    closeSideResult?: () => void
    ocrImageDetail?: (image: string) => Promise<{
      ok: boolean
      error?: string
      lines?: OcrDetailLine[]
    }>
    getBoardBounds?: () => { x: number; y: number; width: number; height: number } | null
    getTranslateSettings: <P extends TranslateProviderName | string>(
      provider: P
    ) => P extends TranslateProviderName ? TranslateSettingsMap[P] : any
    setTranslateSettings: (provider: string, data: Record<string, unknown>) => void
    getOcrSettings: <P extends keyof OcrSettingsMap>(provider: P) => OcrSettingsMap[P]
    setOcrSettings: <P extends keyof OcrSettingsMap>(provider: P, data: OcrSettingsMap[P]) => void
    getImageHostSettings: () => ImageHostSettings
    setImageHostSettings: (data: ImageHostSettings) => void
    getPaddleSettings?: () => { exePath?: string }
    setPaddleSettings?: (data: { exePath?: string }) => void
    paddleStatus: () => { ready: boolean; exePath: string; missing: string[]; version?: string | null }
    paddleRecognize?: (image: string) => Promise<{
      text: string
      blocks: string[]
      confidence?: number
      boxes?: Array<{ text: string; left: number; top: number; right: number; bottom: number }>
    }>
    paddleDownload: (
      onProgress?: (p: NativeDownloadProgress) => void,
      hostIndex?: number
    ) => Promise<NativeDownloadResult>
    paddleRemove: () => boolean
    paddleCancel?: () => void
    nativeStatus: () => { ready: boolean; missing: string[]; version: string | null }
    nativeDownload: (
      onProgress?: (p: NativeDownloadProgress) => void,
      hostIndex?: number
    ) => Promise<NativeDownloadResult>
    nativeRemove: () => boolean
    nativeCancel?: () => void
    translateAi?: (text: string, from?: string, to?: string) => Promise<TranslateProviderOutput>
    ocrAi?: (image: string, lang?: string) => Promise<OcrProviderOutput>
    engineRoot?: () => string
    engineDir?: (kind: 'native' | 'paddle' | 'cache') => string
    engineCatalog?: () => {
      root: string
      native: { dir: string; files: string[]; url: string }
      paddle: { dir: string; files: string[]; url: string }
    }
    openEngineDir?: (kind: 'root' | 'native' | 'paddle' | 'cache') => string
  }

  interface Window {
    services: Services
    /** 结果子窗口挂载的注入入口（由主窗口 executeJavaScript 调用）。 */
    __loadSnapResult?: (payload: SnapResultPayload) => void
    /** 悬浮贴加载入口。 */
    __loadSnapBoard?: (payload: {
      image: string
      isDark?: boolean
      logo?: string
      title?: string
      pin?: { x: number; y: number; width: number; height: number; dockH?: number }
      overlay?: { x: number; y: number; width: number; height: number }
    }) => void
    /** 悬浮贴状态/结果更新。 */
    __boardUpdate?: (payload: Record<string, unknown>) => void
  }
}

export {}
