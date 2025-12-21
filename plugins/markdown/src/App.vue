<script setup>
import { ref, reactive, onMounted } from 'vue'
import FileTree from './components/FileTree.vue'
import Vditor from 'vditor'
import MarkdownEditor from './components/MarkdownEditor.vue'

const handleExportMarkdown = async (item) => {
  const content = await loadFileContent(item.id)
  if (window.ztools && window.ztools.exportMarkdown) {
    await window.ztools.exportMarkdown(item.name, content)
  } else {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.name}.md`
    a.click()
    URL.revokeObjectURL(url)
  }
}

const handleExportHTML = async (item) => {
  const content = await loadFileContent(item.id)
  const html = await Vditor.md2html(content, {})
  const fullHtml = `
    <html>
      <head>
        <title>${item.name}</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/vditor/dist/index.css" />
        <style>
          body { padding: 20px; font-family: sans-serif; }
          .vditor-reset { max-width: 800px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="vditor-reset">${html}</div>
      </body>
    </html>
  `
  const blob = new Blob([fullHtml], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${item.name}.html`
  a.click()
  URL.revokeObjectURL(url)
}



const handleDuplicateFile = async (item) => {
  const content = await loadFileContent(item.id)
  const newId = Date.now().toString()
  const newName = `${item.name} copy`
  
  const newFile = {
    id: newId,
    name: newName,
    level: item.level
  }
  
  // Find parent to insert sibling
  const parent = findParent(files, item.id)
  if (parent) {
    const index = parent.children.findIndex(i => i.id === item.id)
    parent.children.splice(index + 1, 0, newFile)
  } else {
    const index = files.findIndex(i => i.id === item.id)
    files.splice(index + 1, 0, newFile)
  }
  
  await saveFileContent(newId, content)
  saveTree()
}

onMounted(async () => {
  await loadTree()
  await loadLastOpened()
})

// 持久化常量
const TREE_STORAGE_KEY = 'markdown_file_tree'
const CONTENT_PREFIX = 'markdown_content_'
const LAST_OPENED_KEY = 'markdown_last_opened'

// 状态
const files = reactive([])
const selectedItemId = ref(null)
const activeDocumentId = ref(null)
const activeContent = ref('')
const showSidebar = ref(true)
const activeFileTitle = ref('')
const isDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)

// Listen for theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
  isDark.value = event.matches
})

// 持久化方法
const loadTree = async () => {
  try {
    const doc = await window.ztools.db.promises.get(TREE_STORAGE_KEY)
    if (doc && doc.files) {
      files.splice(0, files.length, ...doc.files)
    }
  } catch (error) {
    if (error.status !== 404) {
      console.error('Failed to load tree:', error)
    }
    // 如果是 404，说明是第一次加载，保持为空即可
  }
}

const saveTree = async () => {
  try {
    // 查询旧数据以获取 _rev
    let record
    try {
      record = await window.ztools.db.promises.get(TREE_STORAGE_KEY)
    } catch (e) {
      // 忽略 404,说明是首次保存
    }

    await window.ztools.db.promises.put({
      _id: TREE_STORAGE_KEY,
      _rev: record?._rev,
      files: JSON.parse(JSON.stringify(files))
    })
  } catch (error) {
    console.error('Failed to save tree:', error)
  }
}

const loadFileContent = async (id) => {
  try {
    const doc = await window.ztools.db.promises.get(CONTENT_PREFIX + id)
    return doc.content || ''
  } catch (error) {
    if (error.status !== 404) {
      console.error(`Failed to load content for ${id}:`, error)
    }
    return ''
  }
}

const saveFileContent = async (id, content) => {
  try {
    // 查询旧数据以获取 _rev
    let record
    try {
      record = await window.ztools.db.promises.get(CONTENT_PREFIX + id)
    } catch (e) {
      // 忽略 404,说明是首次保存
    }

    await window.ztools.db.promises.put({
      _id: CONTENT_PREFIX + id,
      _rev: record?._rev,
      content
    })
  } catch (error) {
    console.error(`Failed to save content for ${id}:`, error)
  }
}

const deleteFileContent = async (id) => {
  try {
    const doc = await window.ztools.db.promises.get(CONTENT_PREFIX + id)
    await window.ztools.db.promises.remove(doc)
  } catch (error) {
    if (error.status !== 404) {
      console.error(`Failed to delete content for ${id}:`, error)
    }
  }
}

const saveLastOpened = async (id) => {
  try {
    // 查询旧数据以获取 _rev
    let record
    try {
      record = await window.ztools.db.promises.get(LAST_OPENED_KEY)
    } catch (e) {
      // 忽略 404,说明是首次保存
    }

    await window.ztools.db.promises.put({
      _id: LAST_OPENED_KEY,
      _rev: record?._rev,
      id
    })
  } catch (error) {
    console.error('Failed to save last opened:', error)
  }
}

const loadLastOpened = async () => {
  try {
    const doc = await window.ztools.db.promises.get(LAST_OPENED_KEY)
    if (doc && doc.id) {
      const file = findFile(files, doc.id)
      if (file) {
        handleSelectFile(file)
      }
    }
  } catch (error) {
    // 忽略
  }
}

// 防抖保存内容
let saveTimeout = null
const debouncedSaveContent = (id, content) => {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    saveFileContent(id, content)
  }, 1000)
}

// 根据 ID 查找文件的辅助函数
const findFile = (items, id) => {
  for (const item of items) {
    if (item.id === id) return item
    if (item.children) {
      const found = findFile(item.children, id)
      if (found) return found
    }
  }
  return null
}

// 查找文件父级的辅助函数
const findParent = (items, id, parent = null) => {
  for (const item of items) {
    if (item.id === id) return parent
    if (item.children) {
      const found = findParent(item.children, id, item)
      if (found !== undefined) return found
    }
  }
  return undefined
}

const fileTreeRef = ref(null)

const handleSelectFile = async (file) => {
  selectedItemId.value = file.id
  if (!file.children) {
    activeDocumentId.value = file.id
    activeFileTitle.value = file.name
    // 加载内容
    activeContent.value = await loadFileContent(file.id)
    saveLastOpened(file.id)
    
    // 展开父文件夹
    if (fileTreeRef.value) {
      fileTreeRef.value.expandTo(file.id)
    }
  }
}

const handleTitleChange = (event) => {
  const newTitle = event.target.value
  activeFileTitle.value = newTitle
  if (activeDocumentId.value) {
    const file = findFile(files, activeDocumentId.value)
    if (file) {
      file.name = newTitle
      saveTree()
    }
  }
}

const toggleSidebar = () => {
  showSidebar.value = !showSidebar.value
}

const handleContentChange = (value) => {
  const file = findFile(files, activeDocumentId.value)
  if (file && !file.children) {
    file.content = value // 在内存中更新（可选，也许从树结构中删除内容以节省内存？）
    // 实际上，如果我们单独保存内容，就不应该再在树结构中存储内容了。
    // 但现在为了简单起见，先保留在内存中，或者删除它。
    // 如果我们从 `files` 中删除它，`saveTree` 就不会保存它，这很好。
    // 这里不要更新 `file.content` 如果我们想保持树的轻量。
    // 但是 `handleSelectFile` 设置了 `activeContent`。
    // 我们只更新 `activeContent` 并保存到数据库。
    // 我们可以从 `files` 项中删除 `content` 属性。
    debouncedSaveContent(activeDocumentId.value, value)
  }
}

const handleDeleteFile = async (item) => {
  const deleteRecursive = async (items, id) => {
    const index = items.findIndex(i => i.id === id)
    if (index !== -1) {
      const deletedItem = items[index]
      items.splice(index, 1)
      
      // 递归删除内容
      const deleteContentRecursive = async (node) => {
        if (!node.children) {
          await deleteFileContent(node.id)
        } else {
          for (const child of node.children) {
            await deleteContentRecursive(child)
          }
        }
      }
      await deleteContentRecursive(deletedItem)
      
      return true
    }
    for (const i of items) {
      if (i.children) {
        if (await deleteRecursive(i.children, id)) return true
      }
    }
    return false
  }

  await deleteRecursive(files, item.id)
  saveTree()
  
  // 如果删除的文件是当前打开的文档，重置文档状态
  if (activeDocumentId.value === item.id) {
    activeDocumentId.value = null
    activeContent.value = ''
    activeFileTitle.value = ''
  }
  
  // 如果删除的文件被选中，重置选中状态
  if (selectedItemId.value === item.id) {
    selectedItemId.value = null
  }
}

const handleAddFile = () => {
  const date = new Date()
  const dateStr = `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`
  
  const newFile = {
    id: Date.now().toString(),
    name: `新建笔记(${dateStr})`,
    // content: '', // 不在树结构中存储内容
    level: 0 // 层级将被调整
  }

  if (selectedItemId.value) {
    const activeItem = findFile(files, selectedItemId.value)
    if (activeItem) {
      if (activeItem.children) {
        // 添加到选中的文件夹
        newFile.level = activeItem.level + 1
        activeItem.children.push(newFile)
      } else {
        // 添加到选中文件的父级
        const parent = findParent(files, selectedItemId.value)
        if (parent) {
          newFile.level = parent.level + 1
          parent.children.push(newFile)
        } else {
          // 选中了根目录文件
          newFile.level = 0
          files.push(newFile)
        }
      }
    }
  } else {
    // 没有选中项，添加到根目录
    files.push(newFile)
  }
  
  saveTree()
  // 选中并打开新文件
  handleSelectFile(newFile)
}

const handleAddFolder = () => {
  const newFolder = {
    id: Date.now().toString(),
    name: '新建文件夹',
    children: [],
    level: 0
  }

  if (selectedItemId.value) {
    const activeItem = findFile(files, selectedItemId.value)
    if (activeItem) {
      if (activeItem.children) {
        // Add to selected folder
        newFolder.level = activeItem.level + 1
        activeItem.children.push(newFolder)
      } else {
        // Add to parent of selected file
        const parent = findParent(files, selectedItemId.value)
        if (parent) {
          newFolder.level = parent.level + 1
          parent.children.push(newFolder)
        } else {
          // Root level file selected
          newFolder.level = 0
          files.push(newFolder)
        }
      }
    }
  } else {
    files.push(newFolder)
  }
  saveTree()
}

const handleNodeDrop = ({ sourceId, targetId, position }) => {
  console.log('Drop:', sourceId, targetId, position)
  if (sourceId === targetId) return

  // 1. 查找源项及其父项
  let sourceItem = null
  let sourceParent = null
  let sourceIndex = -1

  const findSource = (items, parent = null) => {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === sourceId) {
        sourceItem = items[i]
        sourceParent = parent
        sourceIndex = i
        return true
      }
      if (items[i].children) {
        if (findSource(items[i].children, items[i])) return true
      }
    }
    return false
  }

  findSource(files)
  if (!sourceItem) return

  // 2. 查找目标项及其父项
  let targetItem = null
  let targetParent = null
  let targetIndex = -1

  const findTarget = (items, parent = null) => {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === targetId) {
        targetItem = items[i]
        targetParent = parent
        targetIndex = i
        return true
      }
      if (items[i].children) {
        if (findTarget(items[i].children, items[i])) return true
      }
    }
    return false
  }

  findTarget(files)
  if (!targetItem) return

  // 检查目标是否是源的后代（防止循环嵌套）
  const isDescendant = (parent, childId) => {
    if (!parent.children) return false
    for (const child of parent.children) {
      if (child.id === childId) return true
      if (isDescendant(child, childId)) return true
    }
    return false
  }

  if (sourceItem.children && isDescendant(sourceItem, targetId)) {
    console.warn('Cannot move folder into its own child')
    return
  }

  // 3. 从旧位置移除源项
  if (sourceParent) {
    sourceParent.children.splice(sourceIndex, 1)
  } else {
    files.splice(sourceIndex, 1)
  }

  // 4. 插入到新位置
  if (position === 'inside') {
    if (!targetItem.children) targetItem.children = []
    targetItem.children.push(sourceItem)
  } else if (position === 'before') {
    if (targetParent) {
      targetParent.children.splice(targetIndex, 0, sourceItem)
    } else {
      files.splice(targetIndex, 0, sourceItem)
    }
  } else if (position === 'after') {
    if (targetParent) {
      targetParent.children.splice(targetIndex + 1, 0, sourceItem)
    } else {
      files.splice(targetIndex + 1, 0, sourceItem)
    }
  }

  // 5. 递归更新层级
  const updateLevels = (items, level) => {
    items.forEach(item => {
      item.level = level
      if (item.children) {
        updateLevels(item.children, level + 1)
      }
    })
  }
  
  // 重新计算整个树或受影响部分的层级。
  // 最简单的是整个树或只是移动项的新上下文。
  // 让我们只更新移动项及其子项。
  let newLevel = 0
  if (position === 'inside') {
    newLevel = targetItem.level + 1
  } else {
    newLevel = targetParent ? targetParent.level + 1 : 0
  }
  
  sourceItem.level = newLevel
  if (sourceItem.children) {
    updateLevels(sourceItem.children, newLevel + 1)
  }

  saveTree()
}

const renamingId = ref(null)

const handleRenameRequest = (item) => {
  renamingId.value = item.id
}

const handleRenameItem = ({ id, name }) => {
  renamingId.value = null
  const file = findFile(files, id)
  if (file) {
    file.name = name
    saveTree()
    if (activeDocumentId.value === id) {
      activeFileTitle.value = name
    }
  }
}

onMounted(async () => {
  await loadTree()
  await loadLastOpened()
})

</script>

<template>
  <div class="app-container" :class="{ 'dark': isDark }">
    <div class="sidebar" :class="{ 'sidebar-hidden': !showSidebar }">
      <FileTree 
        ref="fileTreeRef"
        :files="files" 
        :active-file-id="selectedItemId"
        :is-dark="isDark"
        :renaming-id="renamingId"
        @select="handleSelectFile"
        @delete="handleDeleteFile"
        @add-file="handleAddFile"
        @add-folder="handleAddFolder"
        @node-drop="handleNodeDrop"
        @export-markdown="handleExportMarkdown"
        @export-html="handleExportHTML"
        @duplicate-file="handleDuplicateFile"
        @rename-request="handleRenameRequest"
        @rename-item="handleRenameItem"
      />
    </div>
    <div class="main-content">
      <div class="editor-toolbar">
        <button 
          class="icon-btn toggle-sidebar-btn" 
          @click="toggleSidebar" 
          :title="showSidebar ? 'Hide Sidebar' : 'Show Sidebar'"
        >
          <!-- Sidebar Visible (Click to Hide) -->
          <svg v-if="showSidebar" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2"/>
            <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" stroke-width="2"/>
            <path d="M15 9l-3 3 3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <!-- Sidebar Hidden (Click to Show) -->
          <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2"/>
            <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" stroke-width="2"/>
            <path d="M12 9l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <input 
          v-if="activeDocumentId"
          type="text" 
          class="title-input" 
          :value="activeFileTitle" 
          @input="handleTitleChange"
          placeholder="Untitled"
        />
      </div>
      <div v-if="activeDocumentId" class="editor-wrapper">
        <MarkdownEditor 
          :initial-value="activeContent"
          :is-dark="isDark"
          @change="handleContentChange"
        />
      </div>
      <div v-else class="empty-state">
        <p>Select a file to view or edit</p>
      </div>
    </div>
  </div>
</template>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  
  /* Light Theme Variables */
  --bg-color: #fff;
  --sidebar-bg: #f3f3f3;
  --sidebar-border: #ddd;
  --text-color: #333;
  --toolbar-bg: #f9f9f9;
  --toolbar-border: #ddd;
  --icon-color: #555;
  --hover-bg: #e0e0e0;
  --input-bg: transparent;
  --input-focus-bg: #fff;
  --empty-text: #888;
  --active-bg: #d4e2ff;
  --active-text: #1a73e8;
}

/* Dark Theme Variables */
.app-container.dark {
  --bg-color: #1e1e1e;
  --sidebar-bg: #252526;
  --sidebar-border: #333;
  --text-color: #ccc;
  --toolbar-bg: #2d2d2d;
  --toolbar-border: #333;
  --icon-color: #aaa;
  --hover-bg: #3e3e42;
  --input-bg: transparent;
  --input-focus-bg: #3e3e42;
  --empty-text: #666;
  --active-bg: #094771;
  --active-text: #fff;
}

.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: var(--bg-color);
  color: var(--text-color);
}

.sidebar {
  width: 200px;
  flex-shrink: 0;
  height: 100%;
  border-right: 1px solid var(--sidebar-border);
  transition: width 0.3s ease, border-right-color 0.3s ease;
  overflow: hidden;
  white-space: nowrap; /* Prevent text wrapping during transition */
  background-color: var(--sidebar-bg);
}

.sidebar-hidden {
  width: 0;
  border-right: 1px solid transparent;
}

.main-content {
  flex: 1;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-color);
  display: flex;
  flex-direction: column;
}

.editor-toolbar {
  height: 40px;
  border-bottom: 1px solid var(--toolbar-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  background-color: var(--toolbar-bg);
  gap: 12px;
}

.toggle-sidebar-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--icon-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.toggle-sidebar-btn:hover {
  background-color: var(--hover-bg);
}

.toggle-sidebar-btn svg {
  width: 20px;
  height: 20px;
}

.title-input {
  flex: 1;
  border: none;
  background: var(--input-bg);
  font-size: 16px;
  font-weight: 500;
  color: var(--text-color);
  outline: none;
  padding: 4px 8px;
  border-radius: 4px;
}

.title-input:hover {
  background-color: var(--hover-bg);
}

.title-input:focus {
  background-color: var(--input-focus-bg);
  box-shadow: 0 0 0 2px #1a73e8;
}

.editor-wrapper {
  flex: 1;
  width: 100%;
  min-height: 0;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: var(--empty-text);
}
</style>
