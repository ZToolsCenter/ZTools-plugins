/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 src-ztools/preload/services.js）
interface Services {
  // 读取本地持久化数据（userData/quickterm-storage.json），无文件返回 null
  loadStorage: () => { folders?: unknown[]; settings?: Record<string, unknown> } | null
  // 写入本地持久化数据
  saveStorage: (data: unknown) => boolean
  // 校验路径存在且为目录；是文件则取父目录，返回规范化后的目录路径
  normalizeTarget: (p: string) => string
  // 探测本机可用终端
  detectTerminals: () => import('./types').TerminalInfo[]
  // 在指定终端打开目标路径（'auto' 走降级链），返回实际使用的终端类型
  openInTerminal: (
    targetPath: string,
    terminalType?: string
  ) => { type: import('./types').TerminalType }
  // 弹系统目录选择框（可多选），取消返回空数组
  pickFolders: () => string[]
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
