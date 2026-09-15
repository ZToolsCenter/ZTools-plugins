export interface Column {
  id: string
  name: string
}

export interface ProjectDoc {
  _id: string
  _rev?: string
  name: string
  columns: Column[]
  createdAt: number
}

export type Priority = 'low' | 'mid' | 'high'

export interface SubTask {
  id: string
  title: string
  done: boolean
}

export interface TaskDoc {
  _id: string
  _rev?: string
  projectId: string
  title: string
  desc: string
  columnId: string
  priority: Priority
  dueDate: string | null
  order: number
  createdAt: number
  subtasks: SubTask[]
}

export const START_NAME = '待办'
export const END_NAME = '已完成'
