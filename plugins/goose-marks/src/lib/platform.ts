/** 是否在 uTools 运行时（window.utools 由 preload 注入） */
export type RuntimePlatform = 'utools' | 'standalone'

export const isUToolsRuntime = (): boolean =>
  typeof window !== 'undefined' && typeof (window as { utools?: unknown }).utools !== 'undefined'

export const getRuntimePlatform = (): RuntimePlatform => (isUToolsRuntime() ? 'utools' : 'standalone')
