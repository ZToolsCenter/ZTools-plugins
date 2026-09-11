import type { VNodeChild } from 'vue'

/**
 * Shared ZTree types kept in a dedicated module so both ZTree.vue and ZTreeNode.vue
 * can reference them without creating a circular component import.
 *
 * The option shape mirrors naive-ui Tree so callers can reuse the same data.
 */
export interface TreeOption {
  key: string | number
  label: string
  children?: TreeOption[]
  disabled?: boolean
  isLeaf?: boolean
  prefix?: string | (() => VNodeChild)
  suffix?: string | (() => VNodeChild)
  checkboxDisabled?: boolean
  /** Arbitrary caller payload; not interpreted by the tree. */
  [key: string]: unknown
}

export type RenderInfo = { option: TreeOption; checked: boolean; selected: boolean }
export type RenderFn = (info: RenderInfo) => VNodeChild
export type FilterFn = (pattern: string, node: TreeOption) => boolean
export type SwitcherRenderFn = (info: { option: TreeOption; expanded: boolean; selected: boolean }) => VNodeChild

export interface UpdateMeta {
  node: TreeOption | null
  action: 'expand' | 'collapse' | 'select' | 'unselect' | 'filter'
}

/** Context provided by ZTree to every nested ZTreeNode so they share config and state. */
export interface TreeContext {
  keyField: string
  labelField: string
  childrenField: string
  disabledField: string
  indent: number
  blockLine: boolean
  blockNode: boolean
  showLine: boolean
  animated: boolean
  selectable: boolean
  expandOnClick: boolean
  renderLabel?: RenderFn
  renderPrefix?: RenderFn
  renderSuffix?: RenderFn
  renderSwitcherIcon?: SwitcherRenderFn
  pattern: string
  matchedKeys: Set<string | number> | null
  expandedKeys: Set<string | number>
  isSelected: (node: TreeOption) => boolean
  isExpanded: (node: TreeOption) => boolean
  toggleExpand: (node: TreeOption) => void
  selectNode: (node: TreeOption) => void
  handleNodeActivate: (node: TreeOption) => void
  handleContextmenu: (event: MouseEvent, option: TreeOption) => void
  registerNode: (key: string | number, instance: unknown) => void
}
