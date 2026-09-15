/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

export interface PetMetrics {
  installCount: number
  likeCount: number
  zipDownloadCount: number
}

export interface PetAuthor {
  name: string
  imageUrl?: string
}

export interface PetSearchItem {
  slug: string
  displayName: string
  description: string
  spritesheetPath: string
  previewUrl?: string
  zipUrl: string
  soundUrl?: string
  featured: boolean
  kind: 'creature' | 'object' | 'character'
  vibes: string[]
  tags: string[]
  dominantColor?: string
  submittedBy: PetAuthor
  spriteVersionNumber: 1 | 2
  dexNumber?: number
  metrics: PetMetrics
}

export interface PetSearchResponse {
  pets: PetSearchItem[]
  nextCursor: number | null
  total: number
  searchMode: string
  facets: Record<string, unknown>
}

export interface InstalledPet {
  slug: string
  packageId?: string
  displayName: string
  description: string
  spriteVersionNumber: 1 | 2
  spritesheetFileName: string
  spritesheetUrl?: string
  soundFileName?: string | null
  soundUrl?: string | null
  installedAt: string
}

export interface PetRuntimeConfig {
  activeSlug: string | null
  enabled: boolean
  scale: number
  opacity: number
  alwaysOnTop: boolean
  soundEnabled: boolean
  returnToDefaultAnimation: boolean
  position: { x: number; y: number } | null
}

export interface PetDownloadProgress {
  receivedBytes: number
  totalBytes: number | null
  percent: number | null
}

export interface DesktopPetServices {
  searchPets(params: {
    query?: string
    sort?: string
    cursor?: number
    limit?: number
    kinds?: string[]
    vibes?: string[]
  }): Promise<PetSearchResponse>
  loadPreviewAsset(url: string): Promise<string>
  listInstalledPets(): Promise<InstalledPet[]>
  installPet(
    pet: PetSearchItem,
    onProgress?: (progress: PetDownloadProgress) => void
  ): Promise<InstalledPet>
  uninstallPet(slug: string): Promise<void>
  getRuntimeConfig(): Promise<PetRuntimeConfig>
  saveRuntimeConfig(config: PetRuntimeConfig): Promise<PetRuntimeConfig>
  getPetWindowPayload(slug: string): Promise<{
    pet: InstalledPet
    spritesheetUrl: string
    soundUrl: string | null
  }>
  emitPetEvent(type: string, detail?: Record<string, unknown>): void
  onPetEvent(
    callback: (payload: { type: string; detail: Record<string, unknown> }) => void
  ): () => void
  showPetContextMenu(): Promise<void>
  onPetContextMenuCommand(
    callback: (
      command: 'zoom-in' | 'zoom-out' | 'opacity-increase' | 'opacity-decrease' | 'close'
    ) => void
  ): () => void
}

declare global {
  interface Window {
    desktopPet: DesktopPetServices
  }
}
