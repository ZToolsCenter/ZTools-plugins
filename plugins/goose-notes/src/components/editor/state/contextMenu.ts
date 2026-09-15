import { create } from 'zustand'

interface ContextMenuStore {
  // 使用唯一 key 标识打开的菜单
  openMenuId: string | null
  
  // 打开菜单
  open: (id: string) => void
  
  // 关闭菜单
  close: () => void
  
  // 生成唯一 id
  generateId: () => string
}

let idCounter = 0

export const useContextMenu = create<ContextMenuStore>((set) => ({
  openMenuId: null,
  
  open: (id) => set({ openMenuId: id }),
  
  close: () => set({ openMenuId: null }),
  
  generateId: () => `ctx-menu-${++idCounter}`
}))
