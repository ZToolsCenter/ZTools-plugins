<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import ZTreeNode from './ZTreeNode.vue'
import type {
  FilterFn,
  RenderFn,
  SwitcherRenderFn,
  TreeContext,
  TreeOption,
  UpdateMeta
} from './treeTypes.ts'

/** Re-exported so callers can `import { type TreeOption } from './ZTree.vue'`. */
export type { TreeOption, RenderFn, FilterFn, SwitcherRenderFn } from './treeTypes.ts'

const props = withDefaults(
  defineProps<{
    data?: TreeOption[]
    keyField?: string
    labelField?: string
    childrenField?: string
    disabledField?: string
    indent?: number
    blockLine?: boolean
    blockNode?: boolean
    showLine?: boolean
    animated?: boolean
    selectable?: boolean
    multiple?: boolean
    cancelable?: boolean
    expandOnClick?: boolean
    keyboard?: boolean
    expandedKeys?: Array<string | number>
    selectedKeys?: Array<string | number>
    defaultExpandAll?: boolean
    defaultExpandedKeys?: Array<string | number>
    defaultSelectedKeys?: Array<string | number>
    pattern?: string
    filter?: FilterFn
    renderLabel?: RenderFn
    renderPrefix?: RenderFn
    renderSuffix?: RenderFn
    renderSwitcherIcon?: SwitcherRenderFn
  }>(),
  {
    data: () => [],
    keyField: 'key',
    labelField: 'label',
    childrenField: 'children',
    disabledField: 'disabled',
    indent: 24,
    blockLine: false,
    blockNode: false,
    showLine: false,
    animated: true,
    selectable: true,
    multiple: false,
    cancelable: true,
    expandOnClick: false,
    keyboard: true,
    pattern: ''
  }
)

const emit = defineEmits<{
  (event: 'update:expandedKeys', keys: Array<string | number>, option: Array<TreeOption | null>, meta: UpdateMeta): void
  (event: 'update:selectedKeys', keys: Array<string | number>, option: Array<TreeOption | null>, meta: UpdateMeta): void
  (event: 'nodeContextmenu', payload: { event: MouseEvent; option: TreeOption }): void
}>()

/** Indexes every option by its key so selection/expansion events can echo full option objects. */
const optionByKey = computed(() => {
  const map = new Map<string | number, TreeOption>()
  const walk = (nodes: TreeOption[]) => {
    for (const node of nodes) {
      map.set(readKey(node), node)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(props.data)
  return map
})

function readKey(node: TreeOption) {
  return node[props.keyField] as string | number
}
function readLabel(node: TreeOption) {
  return node[props.labelField] as string
}
function readChildren(node: TreeOption): TreeOption[] | undefined {
  return node[props.childrenField] as TreeOption[] | undefined
}
function isDisabled(node: TreeOption) {
  return Boolean(node[props.disabledField])
}

/** Keys of every branch that has at least one non-leaf child, for default-expand-all. */
function collectBranchKeys(nodes: TreeOption[], acc: Array<string | number> = []) {
  for (const node of nodes) {
    const children = readChildren(node)
    if (children?.length) {
      acc.push(readKey(node))
      collectBranchKeys(children, acc)
    }
  }
  return acc
}

const expandedControlled = computed(() => props.expandedKeys !== undefined)
const selectedControlled = computed(() => props.selectedKeys !== undefined)

/** Internal non-controlled expanded keys, seeded once from default props. */
const internalExpanded = ref<Array<string | number>>(props.defaultExpandAll ? collectBranchKeys(props.data) : (props.defaultExpandedKeys ?? []))
/** Internal non-controlled selected keys, seeded once from default props. */
const internalSelected = ref<Array<string | number>>(props.defaultSelectedKeys ?? [])

watch(
  () => props.data,
  () => {
    // Mirrors naive-ui: resetting data clears non-controlled state.
    if (!expandedControlled.value) internalExpanded.value = props.defaultExpandAll ? collectBranchKeys(props.data) : []
    if (!selectedControlled.value) internalSelected.value = []
  }
)

const effectiveExpanded = computed<Array<string | number>>(() =>
  expandedControlled.value ? props.expandedKeys! : internalExpanded.value
)
const effectiveSelected = computed<Array<string | number>>(() =>
  selectedControlled.value ? props.selectedKeys! : internalSelected.value
)

/** Pattern-driven expansion: any branch whose subtree contains a match is forced open. */
const matchedKeys = computed(() => {
  const pattern = props.pattern?.trim() ?? ''
  if (!pattern && !props.filter) return null
  const keys = new Set<string | number>()
  let hasMatch = false
  const walk = (nodes: TreeOption[], ancestors: Array<string | number>) => {
    for (const node of nodes) {
      const key = readKey(node)
      const ownMatch = props.filter ? props.filter(pattern, node) : String(readLabel(node)).toLowerCase().includes(pattern.toLowerCase())
      const childMatched = readChildren(node) ? walk(readChildren(node)!, [...ancestors, key]) : false
      if (ownMatch) {
        keys.add(key)
        hasMatch = true
        ancestors.forEach((a) => keys.add(a))
      }
      if (childMatched) {
        keys.add(key)
        ancestors.forEach((a) => keys.add(a))
      }
    }
    return hasMatch
  }
  walk(props.data, [])
  return keys
})

/** Effective expanded keys combined with pattern-forced expansion. */
const visibleExpanded = computed(() => {
  const base = new Set(effectiveExpanded.value)
  if (matchedKeys.value) matchedKeys.value.forEach((k) => base.add(k))
  return base
})

function isSelected(node: TreeOption) {
  return effectiveSelected.value.includes(readKey(node))
}

/** Emits the expanded-keys update and applies it internally when non-controlled. */
function commitExpanded(next: Array<string | number>, node: TreeOption | null, action: UpdateMeta['action']) {
  if (!expandedControlled.value) internalExpanded.value = next
  const options = next.map((k) => optionByKey.value.get(k) ?? null)
  emit('update:expandedKeys', next, options, { node, action })
}

/** Toggles one branch's expansion while preserving all sibling/descendant expansion state. */
function toggleExpand(node: TreeOption) {
  const key = readKey(node)
  const expanded = effectiveExpanded.value
  const exists = expanded.includes(key)
  const next = exists ? expanded.filter((k) => k !== key) : [...expanded, key]
  commitExpanded(next, node, exists ? 'collapse' : 'expand')
}

/** Emits the selected-keys update and applies it internally when non-controlled. */
function commitSelected(next: Array<string | number>, node: TreeOption | null, action: UpdateMeta['action']) {
  if (!selectedControlled.value) internalSelected.value = next
  const options = next.map((k) => optionByKey.value.get(k) ?? null)
  emit('update:selectedKeys', next, options, { node, action })
}

/** Applies single/multi/cancelable selection semantics to one node click. */
function selectNode(node: TreeOption) {
  if (!props.selectable || isDisabled(node)) return
  const key = readKey(node)
  const selected = effectiveSelected.value
  const exists = selected.includes(key)
  if (exists && props.cancelable) {
    commitSelected(selected.filter((k) => k !== key), node, 'unselect')
  } else if (!exists) {
    if (props.multiple) commitSelected([...selected, key], node, 'select')
    else commitSelected([key], node, 'select')
  }
}

/** Routes a node click through selection or expansion depending on props and target. */
function handleNodeActivate(node: TreeOption) {
  if (props.expandOnClick && readChildren(node)?.length) toggleExpand(node)
  else selectNode(node)
}

function handleContextmenu(event: MouseEvent, option: TreeOption) {
  emit('nodeContextmenu', { event, option })
}

const treeRef = ref<HTMLElement | null>(null)
const nodeInstances = new Map<string | number, ComponentPublicInstance>()

/** Registers a rendered node instance so keyboard navigation can focus it later. */
function registerNode(key: string | number, instance: ComponentPublicInstance | null) {
  if (instance) nodeInstances.set(key, instance)
  else nodeInstances.delete(key)
}

/** Flat key order as currently rendered, for keyboard prev/next traversal. */
const flatKeyOrder = computed(() => {
  const order: Array<string | number> = []
  const walk = (nodes: TreeOption[]) => {
    for (const node of nodes) {
      order.push(readKey(node))
      if (visibleExpanded.value.has(readKey(node))) {
        const children = readChildren(node)
        if (children?.length) walk(children)
      }
    }
  }
  walk(props.data)
  return order
})

function focusKey(key: string | number) {
  const instance = nodeInstances.get(key) as { $el?: HTMLElement } | undefined
  instance?.$el?.focus()
}

/** Handles ArrowUp/Down/Left/Right/Home/End/Enter on the tree root for full keyboard support. */
function handleKeydown(event: KeyboardEvent) {
  if (!props.keyboard) return
  const active = document.activeElement as HTMLElement | null
  const activeKey = active?.getAttribute('data-tree-key')
  const currentIndex = activeKey ? flatKeyOrder.value.findIndex((k) => String(k) === activeKey) : -1

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    let nextIndex: number
    if (currentIndex === -1) nextIndex = event.key === 'ArrowDown' ? 0 : flatKeyOrder.value.length - 1
    else nextIndex = event.key === 'ArrowDown' ? Math.min(currentIndex + 1, flatKeyOrder.value.length - 1) : Math.max(currentIndex - 1, 0)
    const nextKey = flatKeyOrder.value[nextIndex]
    if (nextKey !== undefined) {
      focusKey(nextKey)
      nextTick(() => focusKey(nextKey))
    }
  } else if (event.key === 'ArrowRight' && currentIndex >= 0) {
    const node = optionByKey.value.get(flatKeyOrder.value[currentIndex])
    if (node && readChildren(node)?.length && !visibleExpanded.value.has(readKey(node))) {
      event.preventDefault()
      toggleExpand(node)
    }
  } else if (event.key === 'ArrowLeft' && currentIndex >= 0) {
    const node = optionByKey.value.get(flatKeyOrder.value[currentIndex])
    if (node && readChildren(node)?.length && visibleExpanded.value.has(readKey(node))) {
      event.preventDefault()
      toggleExpand(node)
    }
  } else if ((event.key === 'Enter' || event.key === ' ') && currentIndex >= 0) {
    event.preventDefault()
    const node = optionByKey.value.get(flatKeyOrder.value[currentIndex])
    if (node) handleNodeActivate(node)
  } else if (event.key === 'Home') {
    event.preventDefault()
    if (flatKeyOrder.value[0] !== undefined) {
      focusKey(flatKeyOrder.value[0])
      nextTick(() => focusKey(flatKeyOrder.value[0]))
    }
  } else if (event.key === 'End') {
    event.preventDefault()
    const last = flatKeyOrder.value[flatKeyOrder.value.length - 1]
    if (last !== undefined) {
      focusKey(last)
      nextTick(() => focusKey(last))
    }
  }
}

const isEmpty = computed(() => props.data.length === 0)

const context = computed<TreeContext>(() => ({
  keyField: props.keyField,
  labelField: props.labelField,
  childrenField: props.childrenField,
  disabledField: props.disabledField,
  indent: props.indent,
  blockLine: props.blockLine,
  blockNode: props.blockNode,
  showLine: props.showLine,
  animated: props.animated,
  selectable: props.selectable,
  expandOnClick: props.expandOnClick,
  renderLabel: props.renderLabel,
  renderPrefix: props.renderPrefix,
  renderSuffix: props.renderSuffix,
  renderSwitcherIcon: props.renderSwitcherIcon,
  pattern: props.pattern ?? '',
  matchedKeys: matchedKeys.value,
  expandedKeys: visibleExpanded.value,
  isSelected,
  isExpanded: (node: TreeOption) => visibleExpanded.value.has(readKey(node)),
  toggleExpand,
  selectNode,
  handleNodeActivate,
  handleContextmenu,
  registerNode
}))

defineExpose({
  /** Scrolls a key into view when virtual scrolling is later enabled; today it focuses it. */
  scrollTo(key: string | number) {
    focusKey(key)
  }
})
</script>

<template>
  <div
    ref="treeRef"
    class="ztree"
    :class="{ 'ztree--block-line': blockLine, 'ztree--show-line': showLine }"
    role="tree"
    aria-label="树形数据"
    @keydown="handleKeydown"
  >
    <ZTreeNode
      v-for="node in data"
      :key="readKey(node)"
      :node="node"
      :context="context"
      :depth="0"
    />
    <div v-if="isEmpty" class="ztree__empty">
      <slot name="empty" />
    </div>
  </div>
</template>

<style scoped lang="scss">
/* The whole tree (root + recursive ZTreeNode children) is styled here. ZTreeNode renders
   itself recursively, so all node classes are reached via :deep() to avoid scope drift. */
.ztree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--card-bg);
}

.ztree__empty {
  padding: 32px 16px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

:deep(.ztree-node__row) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 12px 6px 0;
  border-radius: 8px;
  color: var(--text-color);
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  outline: none;
  transition: background-color 0.12s ease, color 0.12s ease;
}

:deep(.ztree-node__row:hover) {
  background: var(--hover-bg);
}

:deep(.ztree-node__row--selected) {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

:deep(.ztree-node__row--disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

/* cut: half-transparent node signalling it is pending a move on paste */
:deep(.ztree-node__row--cut) {
  opacity: 0.45;
}

:deep(.ztree-node__row:focus-visible) {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--primary-color) 55%, transparent);
}

/* inline rename input rendered in place of the static label.
   NOTE: the rename <input> is rendered via ScriptsView's renderLabel h() call, so it
   carries ScriptsView's scope id — its style lives in ScriptsView.vue, not here. */

/* block-line: the whole row is the clickable hit area */
.ztree--block-line :deep(.ztree-node__row) {
  width: 100%;
}

:deep(.ztree-node__switcher) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 22px;
  color: var(--text-secondary);
  user-select: none;
}

:deep(.ztree-node__switcher-icon) {
  width: 14px;
  height: 14px;
  transition: transform 0.18s ease;
}

:deep(.ztree-node__switcher-icon--expanded) {
  transform: rotate(90deg);
}

:deep(.ztree-node__prefix),
:deep(.ztree-node__suffix) {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}

:deep(.ztree-node__icon) {
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
}

:deep(.ztree-node__icon--folder) {
  color: color-mix(in srgb, var(--primary-color) 70%, var(--text-secondary));
}

:deep(.ztree-node__label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* block-node: label fills remaining width so the row spans fully */
.ztree--block-node :deep(.ztree-node__label) {
  flex: 1 1 auto;
}

:deep(.ztree-node__suffix) {
  gap: 8px;
  margin-left: auto;
  padding-left: 12px;
}

:deep(.ztree-node__suffix .script-row__actions) {
  gap: 4px;
}

:deep(.ztree-node__children) {
  display: flex;
  flex-direction: column;
}

:deep(.ztree-node__children--animated .ztree-node) {
  animation: ztree-fade-in 0.16s ease;
}

@keyframes ztree-fade-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}

/* show-line: subtle vertical guides per naive-ui */
.ztree--show-line :deep(.ztree-node) {
  position: relative;
}
</style>
