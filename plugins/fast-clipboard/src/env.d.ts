/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 src-ztools/preload/services.js）
interface Services {
  ready: () => boolean
  readImageDataUrl: (filePath: string) => string | null
  fileExists: (filePath: string) => boolean
  /** 在文件管理器中选中该文件；失败返回 false */
  revealInFolder: (filePath: string) => boolean
  openPath: (filePath: string) => boolean
  /** 读磁盘上 dist/BUILD_ID（最新构建戳）；读不到返回 null */
  readBuildStamp: () => string | null
}

/** vite define 注入：本次页面构建的唯一戳（版本-时间戳），详见 vite.config.js */
declare global {
  const __BUILD_STAMP__: string
  /** vite define 注入：插件版本号（来自 plugin.json），显示在侧栏底部 */
  const __APP_VERSION__: string
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
