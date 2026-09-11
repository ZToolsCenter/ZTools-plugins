/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

// Preload 暴露的服务能力，与 public/preload/services.js 保持一致
interface Services {
  createTempFile(ext: string): string
  appendFile(filePath: string, data: ArrayBuffer | Uint8Array): void
  removeFile(filePath: string): void
  readFileAsDataUrl(filePath: string): string
  saveGifTo(filePath: string): string
  onChildMessage(channel: string, callback: (payload: any) => void): void
  openRegionWindow(display: Display, initialAutoStopSeconds?: number): any
  openControlsWindow(): any
  closeWindow(win: any): void
}

declare global {
  // 框选出来的录制区域
  interface GifRegionRect {
    x: number
    y: number
    width: number
    height: number
  }

  interface Window {
    services: Services
  }
}

export {}
