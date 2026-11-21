/// <reference types="vite/client" />

/**
 * window.services 由 preload 提供（src-ztools/preload/services.js），
 * 类型对齐 src/api.ts 的 Services 接口。
 */
declare global {
  interface Window {
    services?: {
      ready(): boolean
      maxQueryBytes(): number
      loadCreds(): import('./types').CredsInfo | null
      saveCreds(appId: string, secretKey: string): import('./types').SaveResult
      clearCreds(): import('./types').SaveResult
      translate(args: { text: string; from: string; to: string }): Promise<import('./types').TranslateResult>
    }
    ztools?: unknown
  }
}

export {}
