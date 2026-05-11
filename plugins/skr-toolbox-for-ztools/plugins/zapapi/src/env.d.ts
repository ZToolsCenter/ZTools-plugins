/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string, filename?: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  sendHttpRequest: (payload: HttpRequestPayload) => Promise<HttpResponsePayload>
  cookiesList: (domain?: string) => CookieRecord[]
  cookiesDelete: (id: string) => boolean
  cookiesClear: (domain?: string) => number
  cookiesAdd: (cookies: AddCookieItem | AddCookieItem[]) => number
  createTcpClient: (
    host: string,
    port: number,
    onMessage: (type: string, data: string) => void,
    onError: (error: string) => void,
    onClose: () => void
  ) => {
    send: (text: string) => void
    close: () => void
  }
  createUdpClient: (
    host: string,
    port: number,
    onMessage: (type: string, data: string) => void,
    onError: (error: string) => void
  ) => {
    send: (text: string) => void
    close: () => void
  }
}

interface HttpRequestHeader {
  name: string
  value: string
}

interface HttpRequestPayload {
  method: string
  url: string
  headers: HttpRequestHeader[]
  bodyBase64?: string
  bodyMode?: 'base64'
  timeoutMs?: number
  maxRedirects?: number
  cookieJar?: {
    enabled: boolean
    persistSessionCookies: boolean
    maxCookies?: number
  }
  onChunk?: (chunk: string) => void
  onFinished?: () => void
}

interface HttpResponsePayload {
  status: number
  statusText: string
  headersRaw: HttpRequestHeader[]
  bodyBase64: string
  time: number
}

interface AddCookieItem {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: string
  expiresAt?: number | null
}

interface CookieRecord {
  id: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'Strict' | 'Lax' | 'None' | ''
  expiresAt: number | null
  session: boolean
  createdAt: number
  updatedAt: number
}

interface ZToolsApiExtended {
  showTip: (msg: string) => void
  hideMainWindow: () => void
  getClipboardContent: () => Promise<string>
  getPath: (name: string) => string
  onPluginOut: (cb: () => void) => void
  isDarkColors: () => boolean
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApiExtended
  }
}

export {}
