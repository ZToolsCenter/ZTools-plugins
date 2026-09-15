export type OutputFormat = 'svg' | 'png'
export type QuickIconAction = 'copy-svg' | 'copy-png' | 'save-svg' | 'save-png'

export interface IconLicense {
  title: string
  spdx?: string
  url?: string
}

export interface IconCollection {
  name: string
  palette?: boolean
  height?: number
  author?: {
    name: string
    url?: string
  }
  license?: IconLicense
}

export interface IconItem {
  id: string
  prefix: string
  name: string
  collectionName: string
  palette: boolean
  license?: IconLicense
}

export interface IconPage {
  items: IconItem[]
  page: number
  pageSize: number
  loadedCount: number
  hasPrevious: boolean
  hasNext: boolean
  capped: boolean
  effectiveQuery: string
}
