/// <reference types="vite/client" />
// 渲染进程通过 preload 暴露 window.services（Node 能力桥）+ window.ztools（ZTms 注入）。
// ztools 完整类型由 @ztools-center/ztools-api-types 提供（平铺命名空间）。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface CaptureDisplayInfo {
    id: string
    bounds: { x: number; y: number; width: number; height: number }
    scaleFactor: number
    dataURL: string
  }

  interface Services {
    captureDisplays(): Promise<CaptureDisplayInfo[]>
    getVirtualBounds(): { x: number; y: number; width: number; height: number }
    openCaptureWindow(opts: {
      dataURL: string
      x?: number
      y?: number
      width?: number
      height?: number
    }): unknown
    copyImageDataURL(dataURL: string): boolean
    saveImageDataURL(
      dataURL: string,
      opts?: { format?: 'png' | 'jpg' }
    ): { path: string | null; canceled: boolean }
    writeTempImage(dataURL: string): string
    readTempImage(filePath: string): string
    openPinWindow(opts: {
      dataURL: string
      x?: number
      y?: number
      width?: number
      height?: number
    }): { winId: string; x: number; y: number; width: number; height: number }
    pinGetBounds(winId: string): { x: number; y: number; width: number; height: number } | null
    pinSetBounds(winId: string, b: { x: number; y: number; width: number; height: number }): void
    pinMoveBy(winId: string, dx: number, dy: number): void
    pinResize(winId: string, dw: number, dh: number): void
    pinSetAlwaysOnTop(winId: string, flag: boolean): void
    pinClose(winId: string): void
    pathJoin(...p: string[]): string
  }

  interface Window {
    services: Services
  }
}

export {}