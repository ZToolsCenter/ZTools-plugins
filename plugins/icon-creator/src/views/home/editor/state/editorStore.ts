import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { FabricObject } from 'fabric'
import type { KeylineTemplate, RightPanelTab } from '../../types'

export interface EditorStoreOptions {
  activeObject: ShallowRef<FabricObject | null>
  activeRightTab: Ref<RightPanelTab>
  canRedo: Ref<boolean>
  canUndo: Ref<boolean>
  canvasBg: Ref<string>
  canvasHeight: Ref<number>
  canvasWidth: Ref<number>
  hasEditablePoints: ComputedRef<boolean>
  keylineTemplate: Ref<KeylineTemplate>
  selectionMode: Ref<'shape' | 'point' | 'segment'>
  shortcutDrawerOpen: Ref<boolean>
  showArtboardList: Ref<boolean>
  showPixelGrid: Ref<boolean>
  showRuler: Ref<boolean>
  snapToPixelGrid: Ref<boolean>
  zoom: Ref<number>
}

export interface EditorStore extends EditorStoreOptions {}

/**
 * 创建 Home 编辑器的共享状态索引，先集中保存壳层和模块都会读取的核心 refs。
 * 该 store 不复制状态、不改变现有所有权，只提供明确入口，后续模块迁移时可逐步替代页面顶层散落传参。
 */
export function createEditorStore(options: EditorStoreOptions): EditorStore {
  return options
}
