export type StatusFilter = 'done' | 'pending'
export type ViewName = 'main' | 'note' | 'tomato'

export interface TaskDoc {
  _id: string
  text: string
  groupId: string
  completed: boolean
  completed_at?: number
  first_completed_at?: number
  created_at: number
  sort: number
  dueAt?: number
}

export interface GroupDoc {
  _id: string
  title: string
  sort: number
  created_at: number
}

export interface Settings {
  hideCompleted: boolean
  bottomCompleted: boolean
  renderMarkdown: boolean
  noteBlurTransparent: boolean
  noteOpacity: number
  noteBackground: string
  tomatoSkin: 'tomato' | 'EWatch'
  tomatoMinutes: number
  tomatoScale: number
}
