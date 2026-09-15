export const ONLINE_SEARCH_PAGE_SIZE = 24

export type SearchSource =
  | 'sougou'
  | 'baidu'
  | 'bing'
  | 'gif'
  | 'dou'
  | 'apihz'
  | 'adoutu'
  | 'dogetu'
  | 'pkdoutu'
  | 'doutula'
  | 'fabiaoqing'
  | 'doutuba'
  | 'doutuwang'
  | 'qudoutu'
  | 'dbbqb'
  | 'randomgirl'
  | 'randomboy'
  | 'yaohud'

export interface SearchResult {
  id: string
  url: string
  originalUrl?: string
  previewUrl?: string
  thumbnailUrl?: string
  title?: string
  gifCandidate?: boolean
  source: SearchSource
}
