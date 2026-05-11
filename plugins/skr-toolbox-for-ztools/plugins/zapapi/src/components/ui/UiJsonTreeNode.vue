<template>
  <div class="json-node" v-if="isVisible">
    <div class="json-line">
        <button
          v-if="isExpandable"
          class="json-toggle"
          :aria-label="t('response.toggleNode')"
          @click="expanded = !expanded"
        >
          {{ expanded ? '▼' : '▶' }}
        </button>
      <span v-else class="json-spacer"></span>

      <span v-if="nodeKey" class="json-key">"{{ nodeKey }}"</span>
      <span v-if="nodeKey" class="json-colon">:</span>

      <span v-if="isPrimitive" class="json-value" :class="valueClass">{{ displayValue }}</span>
      <span v-else class="json-type">{{ typeLabel }}</span>

      <div class="json-actions">
        <UiTooltip v-if="nodeKey" :content="t('response.copyKey')" placement="top">
          <button
            class="json-action"
            :aria-label="t('response.copyKey')"
            @click="$emit('copy-key', nodeKey)"
          >
            K
          </button>
        </UiTooltip>
        <UiTooltip :content="t('response.copyPath')" placement="top">
          <button
            class="json-action"
            :aria-label="t('response.copyPath')"
            @click="$emit('copy-path', path)"
          >
            P
          </button>
        </UiTooltip>
        <UiTooltip :content="t('response.copyValue')" placement="top">
          <button
            class="json-action"
            :aria-label="t('response.copyValue')"
            @click="$emit('copy-value', serializedValue)"
          >
            V
          </button>
        </UiTooltip>
      </div>
    </div>

    <div v-if="expanded && isExpandable" class="json-children">
      <UiJsonTreeNode
        v-for="child in children"
        :key="child.path"
        :node="child.value"
        :node-key="child.key"
        :path="child.path"
        :depth="depth + 1"
        :search-keyword="searchKeyword"
        @copy-value="$emit('copy-value', $event)"
        @copy-path="$emit('copy-path', $event)"
        @copy-key="$emit('copy-key', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiTooltip from './UiTooltip.vue'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  node: unknown
  nodeKey?: string
  path: string
  depth: number
  searchKeyword?: string
}>(), {
  nodeKey: '',
  searchKeyword: ''
})

defineEmits<{
  'copy-value': [value: string]
  'copy-path': [path: string]
  'copy-key': [key: string]
}>()

const expanded = ref(true)

const isPrimitive = computed(() => {
  return props.node === null || typeof props.node !== 'object'
})

const isExpandable = computed(() => {
  if (props.node === null || typeof props.node !== 'object') {
    return false
  }

  if (Array.isArray(props.node)) {
    return props.node.length > 0
  }

  return Object.keys(props.node as Record<string, unknown>).length > 0
})

const children = computed(() => {
  if (props.node === null || typeof props.node !== 'object') {
    return [] as Array<{ key: string; value: unknown; path: string }>
  }

  if (Array.isArray(props.node)) {
    return props.node.map((value, index) => ({
      key: String(index),
      value,
      path: `${props.path}[${index}]`
    }))
  }

  return Object.entries(props.node as Record<string, unknown>).map(([key, value]) => ({
    key,
    value,
    path: `${props.path}.${key}`
  }))
})

const typeLabel = computed(() => {
  if (Array.isArray(props.node)) {
    return `Array(${props.node.length})`
  }

  return 'Object'
})

const serializedValue = computed(() => {
  if (typeof props.node === 'string') {
    return props.node
  }

  return JSON.stringify(props.node, null, 2)
})

const displayValue = computed(() => {
  if (typeof props.node === 'string') {
    return `"${props.node}"`
  }
  if (props.node === null) {
    return 'null'
  }

  return String(props.node)
})

const valueClass = computed(() => {
  if (typeof props.node === 'string') {
    return 'json-value--string'
  }
  if (typeof props.node === 'number') {
    return 'json-value--number'
  }
  if (typeof props.node === 'boolean') {
    return 'json-value--boolean'
  }

  return 'json-value--null'
})

const isVisible = computed(() => {
  const keyword = (props.searchKeyword || '').trim().toLowerCase()
  if (!keyword) {
    return true
  }

  const keyText = props.nodeKey.toLowerCase()
  const valueText = serializedValue.value.toLowerCase()
  const pathText = props.path.toLowerCase()

  return keyText.includes(keyword) || valueText.includes(keyword) || pathText.includes(keyword)
})
</script>

<style scoped>
.json-node {
  margin-left: 10px;
}

.json-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 12px;
  color: var(--text-primary);
}

.json-toggle,
.json-action {
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
}

.json-toggle {
  width: 18px;
  height: 18px;
}

.json-action {
  width: 18px;
  height: 18px;
}

.json-spacer {
  width: 18px;
}

.json-key {
  color: var(--accent-primary);
}

.json-colon {
  color: var(--text-muted);
}

.json-type {
  color: var(--text-secondary);
}

.json-value--string {
  color: #22c55e;
}

.json-value--number {
  color: #f59e0b;
}

.json-value--boolean {
  color: #4da3ff;
}

.json-value--null {
  color: #f43f5e;
}

.json-actions {
  display: inline-flex;
  gap: 4px;
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.json-line:hover .json-actions {
  opacity: 1;
}

.json-children {
  margin-left: 8px;
  border-left: 1px dashed var(--border-color);
  padding-left: 8px;
}
</style>
