/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  // Bing 壁纸记录（官方接口与历史归档统一为此结构）
  interface BingImage {
    startdate: string
    enddate: string
    url: string
    urlbase: string
    copyright: string
    title?: string
    story?: string
    archived?: boolean
  }

  // 下载模式：ask = 每次弹窗选择路径；default = 存到默认路径
  type DownloadMode = 'ask' | 'default'

  interface DownloadSettings {
    mode: DownloadMode
    defaultDir: string
  }

  // Preload 能力声明（对应 src-ztools/preload/services.js）
  interface BingPaperApi {
    fetchList(): Promise<BingImage[]>
    fetchArchive(year: number): Promise<BingImage[]>
    download(urlPath: string, savePath: string): Promise<string>
    thumbDataUrl(url: string): Promise<string>
    defaultSaveDir(): string
    ensureDir(dir: string): string
    buildFileName(enddate: string, resolution: string): string
    imageUrl(urlbase: string, resolution: string): string
    setWallpaper(filePath: string): Promise<string>
    pickDirectory(title: string): string | null
  }

  interface Window {
    bingpaper: BingPaperApi
  }
}

export {}
