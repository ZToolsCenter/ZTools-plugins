/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type { PlaybackRequest, VideoService } from './types'

declare global {
  interface Window {
    videoService?: VideoService
    videoPlayback?: {
      subscribe(callback: (request: PlaybackRequest) => void): () => void
      notifyHistoryChanged(): void
    }
    videoHistory?: { onChange(callback: () => void): () => void }
  }
}

export {}
