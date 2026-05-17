/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface Category {
  id: string
  name: string
  color: string
}

interface TodoItem {
  id: string
  text: string
  category: string
  completed: boolean
  createdAt: string
  completedAt: string | null
  deletedAt?: string
}

interface Settings {
  categories: Category[]
  bgColor: string
}

interface Services {
  getTodos(): TodoItem[]
  addTodo(text: string, category?: string): TodoItem
  toggleTodo(id: string): TodoItem[]
  deleteTodo(id: string): TodoItem[]
  updateTodo(id: string, updates: Partial<TodoItem>): TodoItem[]
  clearCompleted(): TodoItem[]
  getTrash(): TodoItem[]
  restoreTodo(id: string): { todos: TodoItem[], trash: TodoItem[] }
  clearTrash(): TodoItem[]
  deleteFromTrash(id: string): TodoItem[]
  getSettings(): Settings
  saveSettings(settings: Settings): Settings
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
