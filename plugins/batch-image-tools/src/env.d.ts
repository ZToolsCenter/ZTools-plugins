/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type { ToolOptions, ProcessResult, ImageItem, RenameOptions } from './BatchImage/types'

interface Services {
  isImageFile: (filePath: string) => boolean
  collectImages: (paths: string[], recursive?: boolean) => string[]
  saveBase64Image: (base64Url: string) => string
  getImageInfo: (filePath: string) => Promise<ImageItem>
  getThumbnail: (filePath: string, size?: number) => Promise<string>
  processOne: (inputPath: string, options: ToolOptions) => Promise<ProcessResult>
  processMerge: (inputPaths: string[], options: ToolOptions) => Promise<ProcessResult>
  renameOne: (inputPath: string, options: RenameOptions, index?: number) => Promise<ProcessResult>
}

declare global {
  interface ZToolsApi {
    getPathForFile(file: File): string
  }

  interface Window {
    services: Services
  }
}

export {}
