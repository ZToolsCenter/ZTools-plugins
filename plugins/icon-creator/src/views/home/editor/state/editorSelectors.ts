import type { FabricObject } from 'fabric'
import type { EditorStore } from './editorStore'

export interface EditorSelectors {
  readonly activeObject: FabricObject | null
  readonly canRedo: boolean
  readonly canUndo: boolean
  readonly hasEditablePoints: boolean
  readonly isKeylineActive: boolean
  readonly selectionMode: 'shape' | 'point' | 'segment'
  readonly shortcutDrawerOpen: boolean
  readonly showArtboardList: boolean
  readonly showPixelGrid: boolean
  readonly showRuler: boolean
  readonly snapToPixelGrid: boolean
  readonly zoom: number
}

/**
 * 从共享 store 投影页面和面板需要的只读选择器，避免 UI 继续关心底层状态分散在哪些模块。
 * 选择器通过 getter 保持实时读取并向 Vue 模板暴露普通值，后续模块可以在这里继续沉淀派生状态。
 */
export function createEditorSelectors(store: EditorStore): EditorSelectors {
  return {
    get activeObject() {
      return store.activeObject.value
    },
    get canRedo() {
      return store.canRedo.value
    },
    get canUndo() {
      return store.canUndo.value
    },
    get hasEditablePoints() {
      return store.hasEditablePoints.value
    },
    get isKeylineActive() {
      return store.keylineTemplate.value !== 'none'
    },
    get selectionMode() {
      return store.selectionMode.value
    },
    get shortcutDrawerOpen() {
      return store.shortcutDrawerOpen.value
    },
    get showArtboardList() {
      return store.showArtboardList.value
    },
    get showPixelGrid() {
      return store.showPixelGrid.value
    },
    get showRuler() {
      return store.showRuler.value
    },
    get snapToPixelGrid() {
      return store.snapToPixelGrid.value
    },
    get zoom() {
      return store.zoom.value
    }
  }
}
