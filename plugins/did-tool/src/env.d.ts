/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  type DockerSource = 'auto' | 'docker' | 'oneMs' | 'daoCloud' | 'custom'
  type ProxyMode = 'none' | 'system' | 'custom'
  type DownloadStatus =
    | 'preparing'
    | 'downloading'
    | 'processing'
    | 'packing'
    | 'completed'
    | 'failed'
    | 'cancelled'

  interface DockerRequestOptions {
    image: string
    source: DockerSource
    customRegistry: string
    platform: string
    outputDir: string
    concurrency: number
    proxyMode: ProxyMode
    proxyUrl: string
    verifySsl: boolean
    username: string
    password: string
  }

  interface DockerPlatform {
    os: string
    architecture: string
    variant: string
    digest: string
    key: string
  }

  interface DockerInspection {
    image: string
    registry: string
    repository: string
    reference: string
    repoTag: string
    manifestDigest: string
    mediaType: string
    selectedPlatform: DockerPlatform
    platforms: DockerPlatform[]
    layerCount: number
    totalSize: number
    outputFileName: string
    existingOutputPath: string
  }

  interface DownloadLayer {
    digest: string
    shortDigest: string
    mediaType: string
    label: string
    kind: 'config' | 'layer'
    size: number
    downloaded: number
    status: 'pending' | 'downloading' | 'verifying' | 'retrying' | 'processing' | 'completed'
  }

  interface DownloadLog {
    time: number
    level: 'info' | 'success' | 'warning' | 'error'
    message: string
  }

  interface DownloadTask {
    id: string
    status: DownloadStatus
    phase: string
    image: string
    platform: string
    registry: string
    outputPath: string
    fileName: string
    totalBytes: number
    downloadedBytes: number
    speed: number
    etaSeconds: number | null
    packedBytes: number
    packTotalBytes: number
    layers: DownloadLayer[]
    logs: DownloadLog[]
    error: string
    createdAt: number
    updatedAt: number
    finishedAt: number | null
  }

  interface ImageSourceSetting {
    id: string
    name: string
    url: string
    username: string
    password: string
    proxyEnabled: boolean
  }

  interface ProxySetting {
    protocol: 'http' | 'https'
    address: string
    username: string
    password: string
  }

  interface AppSettings {
    version: 4
    sources: ImageSourceSetting[]
    selectedSourceId: string
    proxy: ProxySetting
    downloadPath: string
  }

  interface Services {
    getDefaults: () => { outputDir: string }
    loadSettings: () => AppSettings | null
    saveSettings: (settings: AppSettings) => void
    chooseOutputDirectory: (defaultPath: string) => string | null
    inspectImage: (options: DockerRequestOptions) => Promise<DockerInspection>
    startDownload: (options: DockerRequestOptions) => DownloadTask
    getDownloadTask: (taskId: string) => DownloadTask | null
    cancelDownloadTask: (taskId: string) => boolean
    showOutputInFolder: (filePath: string) => void
  }

  interface Window {
    services: Services
  }
}

export {}
