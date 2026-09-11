/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js），全局可用。
declare global {
  /** OCR 识别结果中的一行文本及其位置信息（交互式 feature 用）。 */
  interface OcrLine {
    /** 该行识别文字（UTF-8 解码后的明文）。 */
    text: string
    /** 识别置信度（0~1）。 */
    rate: number
    /** 识别矩形包围盒（像素坐标）。 */
    left: number
    top: number
    right: number
    bottom: number
    /** 四个角点坐标（左上、右上、右下、左下）。 */
    boxPoints: { x: number; y: number }[]
  }

  /** OCR Provider 契约输出：{ text, blocks?, confidence? } */
  interface OcrProviderOutput {
    text: string
    blocks?: string[]
    confidence?: number
  }

  /** 交互式 feature 用的明细返回结构（ok=false 时不抛错）。 */
  interface OcrDetailResult {
    ok: boolean
    error?: string
    taskId?: number
    lines: OcrLine[]
  }

  /** LaTeX 公式识别明细返回结构（交互式 feature 用，ok=false 时不抛错）。 */
  interface LatexRecognizeResult {
    /** 是否识别成功。 */
    ok: boolean
    /** 识别得到的 LaTeX 源码（成功时返回）。 */
    latex?: string
    /** 失败时的错误描述。 */
    error?: string
  }

  /** LaTeX 引擎就绪状态。真值来源 = 关键文件是否存在（与 NativeStatus 对齐）。 */
  interface LatexEngineStatus {
    /** 引擎是否就绪（onnxruntime-node 与三个 ONNX 模型 + tokenizer 均存在）。 */
    ready: boolean
    /** 缺失的关键文件相对路径列表（ready=true 时为空）。 */
    missing: string[]
    /** plugin.json 中配置的 nativeLatex 版本号。 */
    version: string | null
  }

  /** native 引擎就绪状态。真值来源 = 关键文件是否存在。 */
  interface NativeStatus {
    /** 引擎是否就绪（.node 与 WeChatOCR.exe 均存在）。 */
    ready: boolean
    /** 缺失的关键文件相对路径列表（ready=true 时为空）。 */
    missing: string[]
    /** plugin.json 中配置的 native 版本号。 */
    version: string | null
  }

  /** 下载/解压进度上报。 */
  interface NativeDownloadProgress {
    /** 阶段：downloading 下载中 / extracting 解压中。 */
    phase: 'downloading' | 'extracting'
    /** 进度百分比（0~100；total 未知时 downloading 阶段为 0）。 */
    percent: number
    /** 已下载字节数。 */
    loaded: number
    /** 总字节数（content-length，未知为 0）。 */
    total: number
  }

  /** nativeDownload 返回结果。 */
  interface NativeDownloadResult {
    ok: boolean
    error?: string
    /** 用户取消下载时为 true。 */
    cancelled?: boolean
  }

  // ─── 历史记录 ─────────────────────────────────────────────────────────
  /** 历史记录的类型：OCR 文字 / OCR 公式 / 翻译。 */
  type HistoryKind = 'ocr-text' | 'ocr-formula' | 'translate'

  /**
   * 历史记录条目。由 Recognize / Translate 在完成识别/翻译后上抛给 Manage，
   * 由 Manage 统一写入 dbStorage（key: `history.list`），最多保留 100 条。
   *
   * - OCR 记录：thumbnail / payload.imageSrc 均为 data URI（用户选择直接存，
   *   不落盘），点缩略图可复用 OcrImageViewer 的全屏预览能力。
   * - 翻译记录：thumbnail 字段不用（HistoryView 按 payload.source 首字动态渲染
   *   圆形首字缩略图），故置空串；payload 含原文 / 译文 / 语言 / provider。
   */
  interface HistoryItem {
    /** 唯一 id（crypto.randomUUID()）。 */
    id: string
    /** 记录类型。 */
    kind: HistoryKind
    /** 缩略图源：OCR 为 data URI，翻译为空串（渲染时按首字动态生成）。 */
    thumbnail: string
    /** 标题：截取的一段结果文本，约 40 字。 */
    title: string
    /** 触发时间戳（ms）。 */
    ts: number
    /** 类型相关的明细 payload。 */
    payload:
      | { kind: 'ocr-text'; imageSrc: string; lines: OcrLine[] }
      | { kind: 'ocr-formula'; imageSrc: string; latex: string }
      | {
          kind: 'translate'
          source: string
          target: string
          from: string
          to: string
          provider: TranslateProviderName
        }
  }

  /** 上抛给父级的历史记录条目（不含 id / ts，由父级补全）。 */
  type HistoryEmitItem = Omit<HistoryItem, 'id' | 'ts'>

  // ─── 翻译 Provider 相关 ───────────────────────────────────────────────
  /** 翻译 Provider 输出（对齐宿主 TranslationOutput）。 */
  interface TranslateProviderOutput {
    text: string
    detectedFrom?: string
  }

  /** 翻译 Provider 名称（即 plugin.json providers 字段的 key）。 */
  type TranslateProviderName =
    | 'baidu'
    | 'google'
    | 'youdao'
    | 'microsoft'
    | 'ai-translation'

  /** 微软翻译鉴权方案。 */
  type MicrosoftRequestMode = 'edge' | 'signature'

  /** 各 provider 的设置（凭据 + 非敏感配置）。 */
  interface TranslateSettingsMap {
    baidu: { appID: string; appKey: string }
    google: Record<string, never>
    youdao: { appKey: string; appSecret: string }
    microsoft: { requestMode: MicrosoftRequestMode }
    /** AI 翻译：复用宿主 AI 模型，不存密钥；model 留空走宿主默认。 */
    'ai-translation': { model: string; systemPrompt: string }
  }

  /** AI OCR provider 的设置（复用宿主 AI 视觉模型，不存密钥）。 */
  interface OcrSettingsMap {
    'ai-ocr': { model: string; systemPrompt: string }
    /** AI 公式识别：独立 model + systemPrompt（prompt 要求输出 LaTeX 源码）。 */
    'ai-latex-ocr': { model: string; systemPrompt: string }
  }

  /** 图床类型联合：后续新增图床在此扩展。 */
  type ImageHostType = 'img-scdn'

  /**
   * 图床设置（ai-ocr / ai-latex-ocr 共用）。AI 识图默认先把图片上传图床，
   * 拿到可访问 URL 再发给视觉模型，省 token 且避免大图 base64 截断；
   * 关闭或上传失败自动回退 base64 data URI 直传。
   */
  interface ImageHostSettings {
    /** 是否启用图床上传（关闭则 base64 直发 AI）。默认 true。 */
    enabled: boolean
    /** 图床适配器类型（当前仅 img-scdn，预留扩展）。 */
    type: ImageHostType
  }

  interface Services {
    readFile: (file: string) => string
    /** 读图片二进制并返回 data URI（供 <img>/<canvas> 直接预览本地 path 图片）。 */
    readFileAsDataURL: (file: string) => string
    writeTextFile: (text: string) => string
    writeImageFile: (base64Url: string) => string | undefined
    /** 插件 logo 绝对路径（用于 createBrowserWindow 的 icon）。 */
    pluginLogoPath: () => string
    /** 插件 logo 的 data URI（用于子窗口 <img> 展示图标）。 */
    pluginLogoDataUrl: () => string
    /** 插件 logo 的 NativeImage（用于 createBrowserWindow 的 icon，Windows 任务栏更可靠）。 */
    pluginLogoNativeImage: () => BrowserWindow.NativeImage | null
    /**
     * OCR Provider 核心能力：image 为 本地路径 / data URI / http(s) URL。
     * 返回 provider 契约结构；失败抛错。
     */
    ocrRecognize: (image: string, lang?: string) => Promise<OcrProviderOutput>
    /**
     * 交互式 feature 用：返回带坐标的明细结构（ok=false 时不抛错）。
     */
    ocrImageDetail: (image: string, lang?: string) => Promise<OcrDetailResult>
    /** 释放 OCR 引擎（停止 WeChatOCR.exe 子进程）。 */
    ocrDispose: () => void
    /** 检查 native 引擎是否就绪（按文件存在性判断）。 */
    nativeStatus: () => NativeStatus
    /**
     * 下载 native.zip 并解压到插件根目录。全程通过 onProgress 上报进度。
     * 流程：下载（带重定向）→ 可选 sha256 校验 → PowerShell 解压 → 复检。
     */
    /**
     * 下载 native.zip 并解压到插件根目录。全程通过 onProgress 上报进度。
     * 流程：下载（带重定向）→ 可选 sha256 校验 → PowerShell 解压 → 复检。
     * hostIndex: undefined 竞速选最快镜像；-1 直连；0..N-1 指定镜像。
     */
    nativeDownload: (
      onProgress?: (progress: NativeDownloadProgress) => void,
      hostIndex?: number
    ) => Promise<NativeDownloadResult>
    /** 删除已下载的 native 目录（释放旧引擎、便于重新下载）。 */
    nativeRemove: () => boolean
    /** 取消进行中的 native 下载。 */
    nativeCancel: () => void
    /** GitHub 下载加速镜像列表（用于「选择 host 重试」UI）。 */
    ghProxyHosts: () => string[]

    // ─── LaTeX 公式识别（本地 ONNX 引擎）─────────────────────────────────
    /**
     * LaTeX Provider 核心能力：image 为 本地路径 / data URI / http(s) URL。
     * 返回 provider 契约结构 { text, blocks, confidence }；失败抛错。
     */
    latexRecognize: (image: string) => Promise<OcrProviderOutput>
    /**
     * 交互式 feature 用：返回 LaTeX 源码明细结构（ok=false 时不抛错）。
     */
    latexRecognizeDetail: (image: string) => Promise<LatexRecognizeResult>
    /** 检查 LaTeX 引擎是否就绪（按 onnxruntime-node + 模型文件存在性判断）。 */
    latexStatus: () => LatexEngineStatus
    /**
     * 下载 LaTeX 引擎包并解压到 userData 数据目录。全程通过 onProgress 上报进度。
     * hostIndex: undefined 竞速选最快镜像；-1 直连；0..N-1 指定镜像。
     */
    latexDownload: (
      onProgress?: (progress: NativeDownloadProgress) => void,
      hostIndex?: number
    ) => Promise<NativeDownloadResult>
    /** 删除已下载的 LaTeX 引擎目录。 */
    latexRemove: () => boolean
    /** 取消进行中的 LaTeX 下载。 */
    latexCancel: () => void
    /** 释放 LaTeX 引擎（关闭 ONNX Session）。 */
    latexDispose: () => void

    // ─── 翻译 ───
    /** 通用 HTTP 请求；非 2xx 抛错。 */
  _httpRequest: (
    method: string,
    url: string,
    opts?: {
      headers?: Record<string, string>
      query?: Record<string, string | number>
      json?: unknown
      form?: Record<string, string>
      /** multipart/form-data 文件上传（图床用）；data 为 Buffer 二进制。 */
      multipart?: {
        fields?: Record<string, string>
        files?: Record<string, { filename?: string; contentType?: string; data: Buffer }>
      }
      body?: string
      timeoutMs?: number
      maxRedirects?: number
    }
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>
    /** 语言映射表（provider -> 中性码 -> 自家码；null 表示不支持）。 */
    TRANSLATE_LANG_MAP: Record<TranslateProviderName, Record<string, string | null>>
    /** 读某 provider 的设置（合并默认值）。 */
    getTranslateSettings: <P extends TranslateProviderName>(provider: P) => TranslateSettingsMap[P]
    /** 写某 provider 的设置。 */
    setTranslateSettings: <P extends TranslateProviderName>(provider: P, data: TranslateSettingsMap[P]) => void
    /** 中性语言码 -> provider 自家码；不支持的语种返回 null。 */
    _mapLang: (provider: TranslateProviderName, lang: string | undefined) => string | null
    /** 百度翻译。 */
    translateBaidu: (text: string, from?: string, to?: string) => Promise<TranslateProviderOutput>
    /** 谷歌翻译。 */
    translateGoogle: (text: string, from?: string, to?: string) => Promise<TranslateProviderOutput>
    /** 有道翻译。 */
    translateYoudao: (text: string, from?: string, to?: string) => Promise<TranslateProviderOutput>
    /** 微软翻译。 */
    translateMicrosoft: (text: string, from?: string, to?: string) => Promise<TranslateProviderOutput>
    /** 读某 OCR provider 的设置（合并默认值）。 */
    getOcrSettings: <P extends keyof OcrSettingsMap>(provider: P) => OcrSettingsMap[P]
    /** 写某 OCR provider 的设置。 */
    setOcrSettings: <P extends keyof OcrSettingsMap>(provider: P, data: OcrSettingsMap[P]) => void
    /** 读图床设置（ai-ocr / ai-latex-ocr 共用，合并默认值 enabled=true）。 */
    getImageHostSettings: () => ImageHostSettings
    /** 写图床设置。 */
    setImageHostSettings: (data: ImageHostSettings) => void
    /**
     * 上传图片到已启用图床，返回可访问 URL。
     * 关闭 / 未知类型 / 上传失败时返回 null，由调用方回退 base64 data URI 直传。
     * 入参 image 可为 本地路径 / data URI / http(s) URL；已是 URL 时直接原样返回不二次转存。
     */
    uploadImage: (image: string) => Promise<string | null>
    /** AI 翻译（走宿主 ztools.ai，model 留空走宿主默认模型）。 */
    translateAi: (text: string, from?: string, to?: string) => Promise<TranslateProviderOutput>
    /** AI 识图（走宿主 ztools.ai，需选择支持视觉的模型）。 */
    ocrAi: (image: string, lang?: string) => Promise<OcrProviderOutput>
    /** AI 公式识别（走宿主 ztools.ai，需选择支持视觉的模型）。返回 LaTeX 源码。 */
    latexAi: (image: string) => Promise<{ latex: string }>
  }

  interface Window {
    services: Services
  }
}

export {}
