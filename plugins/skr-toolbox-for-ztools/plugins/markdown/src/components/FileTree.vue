<script setup>
import { ref, computed } from 'vue'
import TreeNode from './TreeNode.vue'

const props = defineProps({
  files: {
    type: Array,
    default: () => []
  },
  activeFileId: {
    type: String,
    default: null
  },
  renamingId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['select', 'delete', 'add-file', 'add-folder', 'node-drop', 'export-markdown', 'export-html', 'duplicate-file', 'rename-request', 'rename-item'])

const expandedKeys = ref(new Set())
const isAllExpanded = ref(false)
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  item: null
})

const toggleExpand = (item) => {
  if (item.children) {
    if (expandedKeys.value.has(item.id)) {
      expandedKeys.value.delete(item.id)
    } else {
      expandedKeys.value.add(item.id)
    }
    // Optional: check if all expanded to update icon, but might be expensive
    // For now, let's just let the button drive the "All" state visually or reset it if user interacts manually?
    // Or just keep it simple: The button toggles state.
  }
}

const handleContextMenu = (event, item) => {
  event.preventDefault()
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    item: item
  }
}

const hideContextMenu = () => {
  contextMenu.value.show = false
}

const handleDelete = () => {
  if (contextMenu.value.item) {
    emit('delete', contextMenu.value.item)
    hideContextMenu()
  }
}

const handleExportMarkdown = () => {
  if (contextMenu.value.item) {
    emit('export-markdown', contextMenu.value.item)
    hideContextMenu()
  }
}

const handleExportHTML = () => {
  if (contextMenu.value.item) {
    emit('export-html', contextMenu.value.item)
    hideContextMenu()
  }
}


const handleDuplicateFile = () => {
  if (contextMenu.value.item) {
    emit('duplicate-file', contextMenu.value.item)
    hideContextMenu()
  }
}

const handleRename = () => {
  if (contextMenu.value.item) {
    emit('rename-request', contextMenu.value.item)
    hideContextMenu()
  }
}

const handleAddFile = () => {
  emit('add-file')
}

const handleAddFolder = () => {
  emit('add-folder')
}

// 递归查找文件路径
const findPath = (items, targetId, currentPath = []) => {
  for (const item of items) {
    if (item.id === targetId) {
      return currentPath
    }
    if (item.children) {
      const path = findPath(item.children, targetId, [...currentPath, item.id])
      if (path) return path
    }
  }
  return null
}

const expandTo = (fileId) => {
  const path = findPath(props.files, fileId)
  if (path) {
    path.forEach(id => expandedKeys.value.add(id))
  }
}

const toggleExpandAll = () => {
  // 检查是否所有文件夹都已展开
  let allExpanded = true
  const checkAllExpanded = (items) => {
    for (const item of items) {
      if (item.children) {
        if (!expandedKeys.value.has(item.id)) {
          allExpanded = false
          return
        }
        checkAllExpanded(item.children)
        if (!allExpanded) return
      }
    }
  }
  checkAllExpanded(props.files)

  if (allExpanded) {
    // 全部折叠
    expandedKeys.value.clear()
    isAllExpanded.value = false
  } else {
    // 全部展开
    const expandAll = (items) => {
      items.forEach(item => {
        if (item.children) {
          expandedKeys.value.add(item.id)
          expandAll(item.children)
        }
      })
    }
    expandAll(props.files)
    isAllExpanded.value = true
  }
}

defineExpose({
  expandTo
})

// Click outside to close context menu
if (typeof window !== 'undefined') {
  window.addEventListener('click', hideContextMenu)
}

</script>

<template>
  <div class="file-tree">
    <div class="tree-toolbar">
      <span class="toolbar-title">EXPLORER</span>
      <div class="toolbar-actions">
        <button @click="toggleExpandAll" :title="isAllExpanded ? 'Collapse All' : 'Expand All'" class="icon-btn">
          <!-- Collapse All Icon (Inward Arrows) -->
          <svg v-if="isAllExpanded" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 19l4-4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <!-- Expand All Icon (Outward Arrows) -->
          <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 9l4-4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 15l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button @click="handleAddFile" title="New File" class="icon-btn">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M13 2v7h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 18v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 15h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button @click="handleAddFolder" title="New Folder" class="icon-btn">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 14h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
    
    <div class="tree-content">
      <ul class="tree-list">
        <TreeNode 
          v-for="item in files" 
          :key="item.id" 
          :item="item" 
          :active-file-id="activeFileId"
          :expanded-keys="expandedKeys"
          :renaming-id="renamingId"
          @select="emit('select', $event)"
          @contextmenu="handleContextMenu"
          @toggle-expand="toggleExpand"
          @node-drop="emit('node-drop', $event)"
          @rename-item="emit('rename-item', $event)"
        />
      </ul>
    </div>

    <!-- Context Menu -->
    <div 
      v-if="contextMenu.show" 
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <div v-if="!contextMenu.item.children" class="context-menu-item" @click="handleDuplicateFile">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
          <path d="M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        创建副本
      </div>
      <div v-if="!contextMenu.item.children" class="context-menu-separator"></div>
      <div v-if="!contextMenu.item.children" class="context-menu-item" @click="handleExportMarkdown">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        导出 Markdown
      </div>
      <div v-if="!contextMenu.item.children" class="context-menu-item" @click="handleExportHTML">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        导出 HTML
      </div>
      <div v-if="!contextMenu.item.children" class="context-menu-separator"></div>
      <div v-if="contextMenu.item.children" class="context-menu-item" @click="handleRename">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        重命名
      </div>
      <div class="context-menu-item delete" @click="handleDelete">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
          <path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        删除
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--sidebar-bg);
  user-select: none;
}

.tree-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--toolbar-bg);
  border-bottom: 1px solid var(--sidebar-border);
}

.toolbar-title {
  font-size: 11px;
  font-weight: bold;
  color: var(--icon-color);
  letter-spacing: 0.5px;
}

.toolbar-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  color: var(--icon-color);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background-color: var(--hover-bg);
  color: var(--text-color);
}

.icon-btn svg {
  width: 14px;
  height: 14px;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  padding-top: 4px;
}

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
}

.tree-item-content:hover {
  background-color: var(--hover-bg);
}

.tree-item-content.active {
  background-color: var(--active-bg);
  color: var(--active-text);
}

.tree-arrow {
  font-size: 8px;
  margin-right: 4px;
  color: var(--icon-color);
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

.context-menu {
  position: fixed;
  background: var(--bg-color);
  border: 1px solid var(--sidebar-border);
  box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  border-radius: 4px;
  padding: 4px 0;
  z-index: 1000;
  min-width: 120px;
  color: var(--text-color);
}

.context-menu-item {
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.context-menu-item:hover {
  background-color: var(--hover-bg);
}

.context-menu-item.delete {
  color: #d32f2f;
}

.context-menu-separator {
  height: 1px;
  background-color: var(--sidebar-border);
  margin: 4px 0;
}
</style>
