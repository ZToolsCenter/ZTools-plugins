export type {
  DesktopPetServices,
  InstalledPet,
  PetDownloadProgress,
  PetRuntimeConfig,
  PetSearchItem,
  PetSearchResponse
} from './env'

export type PetTab = 'gallery' | 'installed' | 'settings'

export type PetAction =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export interface PetWindowHandle {
  id: number
  isDestroyed(): boolean
  close(): void
  show(): void
  hide(): void
  setPosition(x: number, y: number): void
  getPosition(): [number, number]
  setAlwaysOnTop(flag: boolean): void
  setSize(width: number, height: number): void
  webContents: {
    id: number
    executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>
  }
}
