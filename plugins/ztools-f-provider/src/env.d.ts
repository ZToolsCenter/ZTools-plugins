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
  }

  // ─── 翻译 Provider 相关 ───────────────────────────────────────────────
  /** 翻译 Provider 输出（对齐宿主 TranslationOutput）。 */
  interface TranslateProviderOutput {
    text: string
    detectedFrom?: string
  }

  /** 翻译 Provider 名称（即 plugin.json providers 字段的 key）。 */
  type TranslateProviderName = 'baidu' | 'google' | 'youdao' | 'microsoft'

  /** 微软翻译鉴权方案。 */
  type MicrosoftRequestMode = 'edge' | 'signature'

  /** 各 provider 的设置（凭据 + 非敏感配置）。 */
  interface TranslateSettingsMap {
    baidu: { appID: string; appKey: string }
    google: Record<string, never>
    youdao: { appKey: string; appSecret: string }
    microsoft: { requestMode: MicrosoftRequestMode }
  }

  interface Services {
    readFile: (file: string) => string
    /** 读图片二进制并返回 data URI（供 <img>/<canvas> 直接预览本地 path 图片）。 */
    readFileAsDataURL: (file: string) => string
    writeTextFile: (text: string) => string
    writeImageFile: (base64Url: string) => string | undefined
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
    nativeDownload: (onProgress?: (progress: NativeDownloadProgress) => void) => Promise<NativeDownloadResult>
    /** 删除已下载的 native 目录（释放旧引擎、便于重新下载）。 */
    nativeRemove: () => boolean

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
  }

  interface Window {
    services: Services
  }
}

export {}
