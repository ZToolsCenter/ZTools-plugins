<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import type { VNode, VNodeChild } from 'vue'
import type { TreeContext, TreeOption } from './treeTypes.ts'

const props = defineProps<{
  node: TreeOption
  context: TreeContext
  depth: number
}>()

const ctx = props.context

const key = computed(() => props.node[ctx.keyField] as string | number)
const label = computed(() => String(props.node[ctx.labelField] ?? ''))
const children = computed<TreeOption[] | undefined>(() => props.node[ctx.childrenField] as TreeOption[] | undefined)
const disabled = computed(() => Boolean(props.node[ctx.disabledField]))
const isLeaf = computed(() => props.node.isLeaf === true || !children.value?.length)
const expanded = computed(() => ctx.isExpanded(props.node))
const selected = computed(() => ctx.isSelected(props.node))
/** Caller-set cut flag on the option (e.g. ScriptsView marks cut clipboard nodes). */
const cut = computed(() => props.node.__cut === true)
const nodeRef = computed(() => ({ option: props.node, checked: false, selected: selected.value }))

/** Hides nodes that fail the pattern filter while always keeping matched ancestors visible. */
const visible = computed(() => {
  if (!ctx.matchedKeys) return true
  return ctx.matchedKeys.has(key.value)
})

/** Registers this node's DOM row with the parent tree so keyboard navigation can focus it. */
const rowRef = ref<HTMLElement | null>(null)
onMounted(() => ctx.registerNode(key.value, rowRef.value))
onBeforeUnmount(() => ctx.registerNode(key.value, null))

/** Stops propagation so clicking the expand toggle never also selects/activates the node. */
function onSwitcherClick(event: MouseEvent) {
  event.stopPropagation()
  ctx.toggleExpand(props.node)
}

function onRowClick() {
  ctx.handleNodeActivate(props.node)
}

function onRowContextmenu(event: MouseEvent) {
  ctx.handleContextmenu(event, props.node)
}

/**
 * Coerces a VNodeChild (which may be a raw string/number) into a real VNode so
 * `<component :is>` never interprets text content as a tag name. Returns
 * undefined for empty content so the template can skip the slot entirely.
 */
function toVNode(child: VNodeChild): VNode | undefined {
  if (child == null || child === false) return undefined
  if (typeof child === 'string' || typeof child === 'number') return h('span', String(child))
  if (Array.isArray(child)) return h('span', child)
  return child as VNode
}

const labelContent = computed<VNodeChild>(() => {
  if (ctx.renderLabel) return ctx.renderLabel(nodeRef.value)
  return label.value
})
const prefixContent = computed<VNodeChild>(() => {
  const raw = props.node.prefix
  if (typeof raw === 'function') return raw()
  if (raw !== undefined) return raw
  if (ctx.renderPrefix) return ctx.renderPrefix(nodeRef.value)
  return undefined
})
const suffixContent = computed<VNodeChild>(() => {
  const raw = props.node.suffix
  if (typeof raw === 'function') return raw()
  if (raw !== undefined) return raw
  if (ctx.renderSuffix) return ctx.renderSuffix(nodeRef.value)
  return undefined
})
const switcherContent = computed<VNodeChild>(() => {
  if (ctx.renderSwitcherIcon) return ctx.renderSwitcherIcon({ option: props.node, expanded: expanded.value, selected: selected.value })
  return undefined
})

/** Normalized views safe for `<component :is>` (always a VNode or undefined). */
const labelVNode = computed(() => toVNode(labelContent.value))
const prefixVNode = computed(() => toVNode(prefixContent.value))
const suffixVNode = computed(() => toVNode(suffixContent.value))
const switcherVNode = computed(() => toVNode(switcherContent.value))
</script>

<template>
  <div v-if="visible" class="ztree-node">
    <div
      ref="rowRef"
      class="ztree-node__row"
      :class="{
        'ztree-node__row--selected': selected,
        'ztree-node__row--disabled': disabled,
        'ztree-node__row--cut': cut,
        'ztree-node__row--block-line': ctx.blockLine,
        'ztree-node__row--block-node': ctx.blockNode
      }"
      role="treeitem"
      :aria-expanded="isLeaf ? undefined : expanded"
      :aria-selected="selected"
      :aria-disabled="disabled || undefined"
      :title="cut ? '已剪切' : undefined"
      :data-tree-key="key"
      :style="{ paddingLeft: `${depth * ctx.indent}px` }"
      tabindex="0"
      @click="onRowClick"
      @contextmenu="onRowContextmenu"
    >
      <span class="ztree-node__switcher" :style="{ width: `${ctx.indent}px` }" @click="onSwitcherClick">
        <template v-if="!isLeaf">
          <component :is="switcherVNode" v-if="switcherVNode" />
          <svg v-else class="ztree-node__switcher-icon" :class="{ 'ztree-node__switcher-icon--expanded': expanded }" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </template>
      </span>
      <span v-if="prefixVNode" class="ztree-node__prefix"><component :is="prefixVNode" /></span>
      <span class="ztree-node__label" :title="label">
        <component :is="labelVNode" v-if="labelVNode" />
      </span>
      <span v-if="suffixVNode" class="ztree-node__suffix"><component :is="suffixVNode" /></span>
    </div>
    <div
      v-if="!isLeaf && expanded"
      class="ztree-node__children"
      :class="{ 'ztree-node__children--animated': ctx.animated }"
      role="group"
    >
      <ZTreeNode
        v-for="child in children"
        :key="child[ctx.keyField] as string | number"
        :node="child"
        :context="ctx"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
