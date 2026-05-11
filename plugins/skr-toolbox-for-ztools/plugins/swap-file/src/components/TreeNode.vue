<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { Folder, File, ChevronDown, ChevronRight, Loader2 } from 'lucide-vue-next'
import { formatSize } from '../utils/format'

interface Props {
  node: FileNode
  level: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'load-children', node: FileNode): void
}>()

const expanded = ref(false)
const loading = ref(false)

const registerNode = inject<(id: string, controls: { expand: () => void; collapse: () => void; isFolder: boolean }) => void>('registerNode')

const hasChildren = computed(() => {
  return props.node.type === 'folder'
})

async function expand() {
  if (!hasChildren.value) return

  if (!props.node.children) {
    loading.value = true
    try {
      emit('load-children', props.node)
    } finally {
      loading.value = false
    }
  }

  expanded.value = true
}

function collapse() {
  if (!hasChildren.value) return
  expanded.value = false
}

async function toggleExpanded() {
  if (!hasChildren.value) return

  if (expanded.value) {
    collapse()
  } else {
    await expand()
  }
}

defineExpose({
  expand,
  collapse,
  toggleExpanded
})

onMounted(() => {
  if (registerNode) {
    registerNode(props.node.id, {
      expand,
      collapse,
      isFolder: props.node.type === 'folder'
    })
  }
})
</script>

<template>
  <div class="tree-node">
    <div
      class="node-content"
      :style="{ paddingLeft: `${level * 16 + 8}px` }"
      @click="toggleExpanded"
    >
      <!-- 展开/折叠图标 -->
      <span class="expand-icon" v-if="hasChildren">
        <Loader2 v-if="loading" :size="12" class="spinner" />
        <ChevronDown v-else-if="expanded" :size="12" />
        <ChevronRight v-else :size="12" />
      </span>
      <span class="expand-icon-placeholder" v-else></span>

      <!-- 文件/文件夹图标 -->
      <span class="type-icon">
        <Folder v-if="node.type === 'folder'" :size="16" />
        <File v-else :size="16" />
      </span>

      <!-- 文件名 -->
      <span class="node-name">{{ node.name }}</span>

      <!-- 文件大小 -->
      <span class="node-size" v-if="node.type === 'file'">{{ formatSize(node.size) }}</span>

      <!-- 操作插槽 -->
      <div class="node-actions">
        <slot name="actions" :node="node"></slot>
      </div>
    </div>

    <!-- 子节点 -->
    <div v-if="expanded && hasChildren && node.children" class="node-children">
      <TreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        @load-children="$emit('load-children', $event)"
      >
        <template #actions="{ node: childNode }">
          <slot name="actions" :node="childNode"></slot>
        </template>
      </TreeNode>
    </div>
  </div>
</template>

<style scoped>
.tree-node {
  user-select: none;
}

.node-content {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  border-radius: 6px;
  font-size: 13px;
  animation: fadeInSlideUp 0.3s ease backwards;

  &:hover {
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.05));
    transform: translateX(2px);
  }
}

.expand-icon {
  width: 12px;
  text-align: center;
  font-size: 10px;
  color: var(--text-secondary, #666);
  display: flex;
  align-items: center;
  justify-content: center;

  .spinner {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.expand-icon-placeholder {
  width: 12px;
}

.type-icon {
  font-size: 14px;
  display: flex;
  align-items: center;

  svg {
    flex-shrink: 0;
  }
}

.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #1d1d1f);
}

.node-size {
  color: var(--text-secondary, #6e6e73);
  font-size: 12px;
}

.node-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
