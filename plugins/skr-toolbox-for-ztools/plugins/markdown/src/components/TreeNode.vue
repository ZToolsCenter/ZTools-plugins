<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  item: Object,
  activeFileId: String,
  expandedKeys: Set,
  renamingId: String
})

const emit = defineEmits(['select', 'contextmenu', 'toggle-expand', 'node-drop', 'rename-item'])

const isExpanded = computed(() => props.expandedKeys.has(props.item.id))
const isRenaming = computed(() => props.renamingId === props.item.id)
const inputRef = ref(null)
const tempName = ref('')

watch(() => props.renamingId, (newId) => {
  if (newId === props.item.id) {
    tempName.value = props.item.name
    // Wait for DOM update to focus input
    setTimeout(() => {
      if (inputRef.value) {
        inputRef.value.focus()
      }
    }, 0)
  }
})

const finishRename = () => {
  if (tempName.value && tempName.value !== props.item.name) {
    emit('rename-item', { id: props.item.id, name: tempName.value })
  } else {
    // Cancel rename (emit with same name or handle cancellation)
    // For now, just emitting same name effectively cancels/resets renamingId in parent
    emit('rename-item', { id: props.item.id, name: props.item.name })
  }
}

// Drag and Drop State
const dragOverPosition = ref(null) // 'before', 'inside', 'after', or null

const handleSelect = (item) => {
  emit('select', item)
  if (item.children) {
    emit('toggle-expand', item)
  }
}

const handleContextMenu = (event, item) => {
  emit('contextmenu', event, item)
}

const handleChildContextMenu = (event, item) => {
  emit('contextmenu', event, item)
}

const toggleExpand = (item) => {
  emit('toggle-expand', item)
}

// Drag Events
const handleDragStart = (event, item) => {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', item.id)
  // Optional: Set drag image
}

const handleDragOver = (event, item) => {
  event.preventDefault() // Necessary to allow dropping
  event.dataTransfer.dropEffect = 'move'

  const rect = event.currentTarget.getBoundingClientRect()
  const y = event.clientY - rect.top
  const height = rect.height

  // Determine drop position
  if (item.children) {
    // For folders: top 25% -> before, middle 50% -> inside, bottom 25% -> after
    if (y < height * 0.25) {
      dragOverPosition.value = 'before'
    } else if (y > height * 0.75) {
      dragOverPosition.value = 'after'
    } else {
      dragOverPosition.value = 'inside'
    }
  } else {
    // For files: top 50% -> before, bottom 50% -> after
    if (y < height * 0.5) {
      dragOverPosition.value = 'before'
    } else {
      dragOverPosition.value = 'after'
    }
  }
}

const handleDragLeave = () => {
  dragOverPosition.value = null
}

const handleDrop = (event, targetItem) => {
  event.preventDefault()
  const sourceId = event.dataTransfer.getData('text/plain')
  if (sourceId && sourceId !== targetItem.id) {
    emit('node-drop', {
      sourceId,
      targetId: targetItem.id,
      position: dragOverPosition.value
    })
  }
  dragOverPosition.value = null
}
</script>

<template>
  <li class="tree-item">
    <div 
      class="tree-item-content"
      :class="{ 
        'active': activeFileId === item.id,
        'drop-before': dragOverPosition === 'before',
        'drop-inside': dragOverPosition === 'inside',
        'drop-after': dragOverPosition === 'after'
      }"
      draggable="true"
      @dragstart="handleDragStart($event, item)"
      @dragover="handleDragOver($event, item)"
      @dragleave="handleDragLeave"
      @drop="handleDrop($event, item)"
      @click="handleSelect(item)"
      @contextmenu="handleContextMenu($event, item)"
      :style="{ paddingLeft: (item.level * 12 + 12) + 'px' }"
    >
      <span 
        class="tree-arrow" 
        :class="{ 'expanded': isExpanded, 'invisible': !item.children }"
        @click.stop="toggleExpand(item)"
      >
        ▶
      </span>
      
      <input
        v-if="isRenaming"
        ref="inputRef"
        v-model="tempName"
        class="rename-input"
        @blur="finishRename"
        @keydown.enter="finishRename"
        @click.stop
      />
      <span v-else class="tree-label">{{ item.name }}</span>
    </div>
    
    <ul v-if="item.children && isExpanded" class="tree-children">
      <TreeNode 
        v-for="child in item.children" 
        :key="child.id" 
        :item="child" 
        :active-file-id="activeFileId"
        :expanded-keys="expandedKeys"
        :renaming-id="renamingId"
        @select="emit('select', $event)"
        @contextmenu="handleChildContextMenu" 
        @toggle-expand="emit('toggle-expand', $event)"
        @node-drop="emit('node-drop', $event)"
        @rename-item="emit('rename-item', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree-list, .tree-children {
  list-style: none;
  padding: 0;
  margin: 0;
}

.tree-item-content {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-color);
  border: 2px solid transparent; /* Reserve space for border to prevent layout shift */
}

.tree-item-content:hover {
  background-color: var(--hover-bg);
}

.tree-item-content.active {
  background-color: var(--active-bg);
  color: var(--active-text);
}

/* Drag and Drop Visuals */
.tree-item-content.drop-before {
  border-top-color: #1a73e8;
}

.tree-item-content.drop-after {
  border-bottom-color: #1a73e8;
}

.tree-item-content.drop-inside {
  background-color: #e8f0fe;
  border-color: #1a73e8;
}

.tree-arrow {
  font-size: 8px;
  margin-right: 4px;
  color: #888;
  transition: transform 0.2s;
  width: 12px;
  text-align: center;
}

.tree-arrow.expanded {
  transform: rotate(90deg);
}

.tree-arrow.invisible {
  visibility: hidden;
}

.tree-icon {
  margin-right: 6px;
  font-size: 14px;
}

.tree-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rename-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #1a73e8;
  border-radius: 2px;
  padding: 2px 4px;
  font-size: 13px;
  outline: none;
  background-color: var(--input-focus-bg);
  color: var(--text-color);
  margin-left: 4px;
}
</style>
