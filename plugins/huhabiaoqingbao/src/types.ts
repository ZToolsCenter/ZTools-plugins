export type EmoticonSource = 'local' | 'qq' | 'wechat' | 'feishu'

export interface Emoticon {
  id: string
  name: string
  url: string
  type?: string
  tags: string[]
  favorite: boolean
  source?: EmoticonSource
  createdAt: number
  createTime?: number
  updateTime?: number
}

export interface EmoticonStore {
  allEmoticons: Emoticon[]
  favoriteEmoticons: Emoticon[]
  searchEmoticons: (query: string) => Emoticon[]
  addEmoticon: (file: File) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  addTag: (id: string, tag: string) => Promise<void>
  removeTag: (id: string, tag: string) => Promise<void>
  deleteEmoticon: (id: string) => Promise<void>
  addCustomTag: (tag: string) => Promise<void>
  customTags: string[]
  allTags: { name: string; count: number }[]
  sourceCount: Record<string, number>
  filterBySource: (source: string) => Emoticon[]
} 