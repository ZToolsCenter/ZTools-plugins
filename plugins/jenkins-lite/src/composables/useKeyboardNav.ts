import { ref, provide, inject, type Ref, type InjectionKey } from 'vue'

export type FocusedPanel = 'sidebar' | 'jobs' | 'history'

const PANEL_ORDER: FocusedPanel[] = ['sidebar', 'jobs', 'history']

// 模块级共享状态：单实例插件只需一份
export const focusedPanel = ref<FocusedPanel>('sidebar')
export const sidebarIndex = ref(0)
// jobs 面板采用 (parentPath, index) 二元定位以支持跨层导航
// parentPath=null 代表顶级（filteredJobs 顶层）
export const jobsParentPath = ref<string | null>(null)
export const jobsIndex = ref(0)
export const historyIndex = ref(0)

export function setFocusedPanel(p: FocusedPanel) {
  focusedPanel.value = p
}

export function cyclePanel(dir: 1 | -1) {
  const i = PANEL_ORDER.indexOf(focusedPanel.value)
  focusedPanel.value = PANEL_ORDER[(i + dir + PANEL_ORDER.length) % PANEL_ORDER.length]
}

export interface KeyboardNav {
  focusedPanel: Ref<FocusedPanel>
  sidebarIndex: Ref<number>
  jobsParentPath: Ref<string | null>
  jobsIndex: Ref<number>
  historyIndex: Ref<number>
  setFocusedPanel: (p: FocusedPanel) => void
  cyclePanel: (dir: 1 | -1) => void
}

export const KEYBOARD_NAV_KEY: InjectionKey<KeyboardNav> = Symbol('keyboard-nav')

/**
 * 在根组件 setup 中调用，向后代注入键盘导航上下文。
 * 注意：provide/inject 在 Vue 3 里只能父→子，不能同组件自取自用（provide 存到
 * instance.provides，但同组件 inject 走的是 appContext / parent.provides）。
 * 因此本组件要使用导航状态，请直接 import 模块级 ref（如 focusedPanel）。
 */
export function provideKeyboardNav() {
  provide(KEYBOARD_NAV_KEY, {
    focusedPanel,
    sidebarIndex,
    jobsParentPath,
    jobsIndex,
    historyIndex,
    setFocusedPanel,
    cyclePanel,
  })
}

export function useKeyboardNav(): KeyboardNav {
  const nav = inject(KEYBOARD_NAV_KEY)
  if (!nav) throw new Error('KeyboardNav context not provided')
  return nav
}