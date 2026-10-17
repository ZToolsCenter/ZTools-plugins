/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export interface GpuInfo {
  gpuName: string
  vramGB: number
  isDedicated: boolean
  isIntegrated: boolean
}

export interface TierInfo {
  tier: number
  tierName: string
  recommendedWorkers: number
  maxAllowedWorkers: number
  tileSize: string
  threadsPerWorker: string
  warningNotice: string
}

export interface HardwareInfo {
  cpuCores: number
  totalMemGB: number
  freeMemGB?: number
  workerCount: number
  threadsPerWorker: string
  concurrencyTitle: string
  oomNotice?: string
  gpuInfo?: GpuInfo
  tierInfo?: TierInfo
}

export interface SystemInfo {
  platform: string
  arch: string
  totalMemGB: number
  isMac: boolean
  isWindows: boolean
  isAppleSilicon: boolean
  foundEnginePath: string
  isLocalAvailable: boolean
  defaultRecommendedEngine: 'local' | 'cloud'
  defaultInstallDir?: string
  hardwareInfo?: HardwareInfo
}

export interface VideoFileInfo {
  path: string
  name: string
  dir: string
  size: number
  sizeFormatted: string
  ext: string
  lastModified: number
}

export interface JobProgress {
  jobId: string
  percent: number
  currentFrame: number
  totalFrames: number
  fps: number
  etaSeconds: number
  statusText: string
}

export interface InstallProgress {
  percent: number
  downloadedBytes: number
  totalBytes: number
  downloadedFormatted: string
  totalFormatted: string
  speedText: string
}

export type WatermarkPosition =
  | 'bottom-right'
  | 'top-right'
  | 'bottom-left'
  | 'top-left'
  | 'both-right'
  | 'bottom-bar'
  | 'top-bar'

export interface EnhanceOptions {
  engineMode: 'local' | 'cloud'
  enginePath?: string
  cloudApiKey?: string
  inputPath: string
  preset: 'anime' | 'real' | 'interpolate'
  scale: number
  isPreview?: boolean
  speedMode?: 'fast' | 'quality'
  customWorkerCount?: number | 'auto'
  vramGuard?: boolean
  removeWatermark?: boolean
  watermarkPosition?: WatermarkPosition
}

export interface EnhanceResult {
  jobId: string
  outputPath: string
  costTimeSeconds?: number
}

export interface Services {
  detectEnvironment: (customWorkerCount?: number | 'auto') => Promise<SystemInfo>
  checkCommandExists: (cmd: string) => Promise<boolean>
  installLocalEngine: (
    onProgress?: (p: InstallProgress) => void,
    onLog?: (msg: string) => void
  ) => Promise<{ success: boolean; enginePath: string }>
  getVideoFileInfo: (filePath: string) => VideoFileInfo
  startEnhanceJob: (
    jobId: string,
    options: EnhanceOptions,
    callbacks: {
      onProgress?: (p: JobProgress) => void
      onLog?: (msg: string) => void
      onComplete?: (res: EnhanceResult) => void
      onError?: (err: Error) => void
    }
  ) => Promise<{ jobId: string; outputPath?: string; error?: string }>
  cancelJob: (jobId: string) => boolean
  showInFolder: (filePath: string) => void
  playVideoFile: (filePath: string) => void
}

declare global {
  interface Window {
    services?: Services
    ztools?: any
    utools?: any
  }
}

export {}
