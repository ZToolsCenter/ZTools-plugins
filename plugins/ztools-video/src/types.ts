export interface Result {
  v: string
  title: string
  cover: string | null
  year: string | null
  progress?: string | null
  rating?: string | null
}
export type VideoChannel = 'movie' | 'tv' | 'anime'
export interface BrowseSection {
  title: string
  items: Result[]
}
export interface Episode {
  v: string
  line: number
  number: number
}
export interface Catalog {
  title: string
  episodes: Episode[]
  selected: Episode
}
export interface Source {
  url: string
  format: 'mp4' | 'hls'
  quality: string
}
export type PlaybackRequest =
  | { kind: 'catalog'; v: string; title: string; cover?: string | null }
  | { kind: 'direct'; source: Source; title: string }
export interface VideoService {
  channel(key: VideoChannel): Promise<BrowseSection[]>
  search(query: string): Promise<Result[]>
  catalog(v: string): Promise<Catalog>
  resolve(v: string): Promise<Source[]>
  cancel(): void
}
