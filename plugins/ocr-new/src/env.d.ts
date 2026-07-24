/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  readFile: (file: string) => string
  readImageAsDataUrl: (file: string) => {
    dataUrl: string
    name: string
    path: string
  }
  getCopyedImage: () => string | null
  ocrSpaceRecognize: (options: {
    base64Url: string
    apiKey: string
    language: string
    timeoutMs: number
  }) => Promise<string>
  openAiVisionRecognize: (options: {
    base64Url: string
    endpoint: string
    apiKey: string
    model: string
    prompt: string
    timeoutMs: number
  }) => Promise<string>
  baiduOcrRecognize: (options: {
    base64Url: string
    apiKey: string
    secretKey: string
    language: string
    timeoutMs: number
  }) => Promise<string>
  tencentOcrRecognize: (options: {
    base64Url: string
    secretId: string
    secretKey: string
    region: string
    timeoutMs: number
  }) => Promise<string>
  localHttpRecognize: (options: {
    base64Url: string
    endpoint: string
    language: string
    timeoutMs: number
  }) => Promise<string>
  getLocalOcrStatus: (options?: { endpoint?: string }) => Promise<{
    running: boolean
    installed: boolean
    runtimeBundled: boolean
    pythonAvailable: boolean
    pythonVersion: string
    pythonCommand: string
  }>
  installLocalOcr: () => Promise<{ ok: boolean; output: string }>
  startLocalOcr: () => Promise<{ ok: boolean }>
  stopLocalOcr: () => Promise<{ ok: boolean; stopped: boolean }>
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
