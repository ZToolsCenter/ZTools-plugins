<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, inject } from 'vue'
import SkillCodeEditor from './SkillCodeEditor.vue'

interface FileTreeEntry {
  path: string
  relativePath: string
  isDirectory: boolean
  size?: number
  children?: FileTreeEntry[]
  expanded?: boolean
}

interface LoadedFile {
  path: string
  content: string
  isDirectory: boolean
}

const props = defineProps<{
  skillDir: string
}>()

const emit = defineEmits<{
  'saved': []
}>()

const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})

const files = ref<FileTreeEntry[]>([])
const selectedFile = ref<string | null>(null)
const loadedFiles = ref<Record<string, LoadedFile>>({})
const modifiedFiles = ref<Record<string, string>>({})
const isSaving = ref(false)
const isLoading = ref(false)

const currentContent = computed(() => {
  if (!selectedFile.value) return ''
  if (selectedFile.value in modifiedFiles.value) {
    return modifiedFiles.value[selectedFile.value]
  }
  return loadedFiles.value[selectedFile.value]?.content || ''
})

const isModified = computed(() => {
  if (!selectedFile.value) return false
  return selectedFile.value in modifiedFiles.value
})

const currentLanguage = computed(() => {
  if (!selectedFile.value) return 'plaintext'
  const fileName = selectedFile.value.split('/').pop()?.toLowerCase() || ''
  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : ''
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs') return 'javascript'
  if (ext === 'ts' || ext === 'tsx') return 'javascript'
  if (ext === 'json') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'py') return 'python'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'css') return 'css'
  return 'plaintext'
})

const currentFileName = computed(() => {
  if (!selectedFile.value) return ''
  return selectedFile.value.split('/').pop() || ''
})

const currentSize = computed(() => {
  return new TextEncoder().encode(currentContent.value).length
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isEditableFile(path: string): boolean {
  const fileName = path.split('/').pop()?.toLowerCase() || ''
  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : ''
  const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'zip', 'tar', 'gz', 'exe', 'dll', 'so', 'dylib', 'pdf', 'mp3', 'mp4', 'wav', 'avi']
  return !binaryExts.includes(ext)
}

const newFileDialogOpen = ref(false)
const newFolderDialogOpen = ref(false)
const deleteDialogFile = ref<string | null>(null)
const dialogInput = ref('')

async function loadFiles() {
  if (!props.skillDir) return
  isLoading.value = true
  try {
    const entries = window.services.readDir(props.skillDir)
    const tree = buildTree(entries, '')
    files.value = tree

    const firstFile = findFirstFile(tree)
    if (firstFile && !selectedFile.value) {
      selectFile(firstFile)
    }
  } catch (err: any) {
    showToast('加载文件失败: ' + (err.message || err), 'error')
  }
  isLoading.value = false
}

function buildTree(entries: any[], parentPath: string): FileTreeEntry[] {
  const items: FileTreeEntry[] = []
  for (const entry of entries) {
    const name = entry.name
    if (name === '.git' || name === '.prompthub' || name === 'node_modules') continue
    const relativePath = parentPath ? `${parentPath}/${name}` : name
    const item: FileTreeEntry = {
      path: entry.path,
      relativePath,
      isDirectory: entry.isDirectory,
      size: 0,
      expanded: entry.isDirectory ? true : undefined,
      children: entry.isDirectory ? [] : undefined,
    }
    if (entry.isDirectory) {
      try {
        const subEntries = window.services.readDir(entry.path)
        item.children = buildTree(subEntries, relativePath)
      } catch {
        item.children = []
      }
    }
    items.push(item)
  }
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.relativePath.localeCompare(b.relativePath)
  })
  return items
}

function findFirstFile(tree: FileTreeEntry[]): string | null {
  for (const item of tree) {
    if (!item.isDirectory) return item.relativePath
    if (item.children) {
      const found = findFirstFile(item.children)
      if (found) return found
    }
  }
  return null
}

function selectFile(relativePath: string) {
  if (relativePath === selectedFile.value) return
  if (isModified.value && !confirm('有未保存的更改，确定要切换文件吗？')) return
  selectedFile.value = relativePath
  loadFileContent(relativePath)
}

async function loadFileContent(relativePath: string) {
  if (relativePath in loadedFiles.value) return
  try {
    const fullPath = window.services.pathJoin(props.skillDir, relativePath)
    const stat = window.services.stat(fullPath)
    if (stat.isDirectory) {
      loadedFiles.value[relativePath] = {
        path: relativePath,
        content: '',
        isDirectory: true,
      }
      return
    }
    const content = window.services.readFile(fullPath)
    loadedFiles.value[relativePath] = {
      path: relativePath,
      content,
      isDirectory: false,
    }
  } catch (err: any) {
    showToast('读取文件失败: ' + (err.message || err), 'error')
  }
}

function handleContentChange(value: string) {
  if (!selectedFile.value) return
  const original = loadedFiles.value[selectedFile.value]?.content || ''
  if (value === original) {
    const next = { ...modifiedFiles.value }
    delete next[selectedFile.value]
    modifiedFiles.value = next
  } else {
    modifiedFiles.value = {
      ...modifiedFiles.value,
      [selectedFile.value]: value,
    }
  }
}

async function saveCurrentFile() {
  if (!selectedFile.value || !isModified.value) return
  isSaving.value = true
  try {
    const content = modifiedFiles.value[selectedFile.value]
    const fullPath = window.services.pathJoin(props.skillDir, selectedFile.value)
    window.services.writeFile(fullPath, content)
    loadedFiles.value[selectedFile.value] = {
      path: selectedFile.value,
      content,
      isDirectory: false,
    }
    const next = { ...modifiedFiles.value }
    delete next[selectedFile.value]
    modifiedFiles.value = next
    showToast('文件已保存', 'success')
    emit('saved')
  } catch (err: any) {
    showToast('保存失败: ' + (err.message || err), 'error')
  }
  isSaving.value = false
}

async function handleNewFile() {
  const name = dialogInput.value.trim()
  if (!name) return
  try {
    const fullPath = window.services.pathJoin(props.skillDir, name)
    window.services.writeFile(fullPath, '')
    newFileDialogOpen.value = false
    dialogInput.value = ''
    loadFiles()
    selectFile(name)
    showToast('文件已创建', 'success')
  } catch (err: any) {
    showToast('创建文件失败: ' + (err.message || err), 'error')
  }
}

function openInExplorer() {
  window.services.openFolder(props.skillDir)
}

async function handleNewFolder() {
  const name = dialogInput.value.trim()
  if (!name) return
  try {
    const fullPath = window.services.pathJoin(props.skillDir, name)
    window.services.mkdir(fullPath)
    newFolderDialogOpen.value = false
    dialogInput.value = ''
    loadFiles()
    showToast('文件夹已创建', 'success')
  } catch (err: any) {
    showToast('创建文件夹失败: ' + (err.message || err), 'error')
  }
}

async function handleDelete() {
  if (!deleteDialogFile.value) return
  try {
    const fullPath = window.services.pathJoin(props.skillDir, deleteDialogFile.value)
    window.services.removeFile(fullPath)
    if (selectedFile.value === deleteDialogFile.value) {
      selectedFile.value = null
    }
    delete loadedFiles.value[deleteDialogFile.value]
    delete modifiedFiles.value[deleteDialogFile.value]
    deleteDialogFile.value = null
    loadFiles()
    showToast('文件已删除', 'success')
  } catch (err: any) {
    showToast('删除失败: ' + (err.message || err), 'error')
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    saveCurrentFile()
  }
}

onMounted(() => {
  loadFiles()
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

watch(() => props.skillDir, () => {
  selectedFile.value = null
  loadedFiles.value = {}
  modifiedFiles.value = {}
  loadFiles()
})

function toggleExpand(item: FileTreeEntry) {
  item.expanded = !item.expanded
}

function getFileIcon(name: string, isDir: boolean, expanded?: boolean): string {
  if (isDir) return expanded ? '📂' : '📁'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'md' || ext === 'mdx') return '📝'
  if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') return '📜'
  if (ext === 'json') return '📋'
  if (ext === 'yaml' || ext === 'yml') return '⚙️'
  if (ext === 'py') return '🐍'
  if (ext === 'html' || ext === 'htm') return '🌐'
  if (ext === 'css') return '🎨'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'svg') return '🖼️'
  return '📄'
}
</script>

<template>
  <div class="file-editor">
    <!-- File tree sidebar -->
    <div class="file-tree">
      <div class="tree-header">
        <span class="tree-title">文件</span>
        <div class="tree-actions">
          <button class="tree-btn" @click="openInExplorer" title="在文件浏览器中打开">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button class="tree-btn" @click="dialogInput = ''; newFileDialogOpen = true" title="新建文件">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          </button>
          <button class="tree-btn" @click="dialogInput = ''; newFolderDialogOpen = true" title="新建文件夹">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
          </button>
        </div>
      </div>

      <div class="tree-list">
        <div v-if="isLoading" class="tree-loading">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        </div>
        <div v-else-if="files.length === 0" class="tree-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>暂无文件</span>
        </div>
        <template v-else>
          <template v-for="item in files" :key="item.relativePath">
            <!-- Directory -->
            <div v-if="item.isDirectory" class="tree-item-group">
              <button
                class="tree-item directory"
                @click="toggleExpand(item)"
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  class="chevron"
                  :class="{ expanded: item.expanded }"
                >
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span class="item-icon">{{ getFileIcon(item.relativePath, true, item.expanded) }}</span>
                <span class="item-name">{{ item.relativePath.split('/').pop() }}</span>
              </button>
              <div v-if="item.expanded && item.children" class="tree-children">
                <template v-for="child in item.children" :key="child.relativePath">
                  <div
                    v-if="!child.isDirectory"
                    class="tree-item file"
                    :class="{ active: selectedFile === child.relativePath, modified: child.relativePath in modifiedFiles }"
                    @click="selectFile(child.relativePath)"
                  >
                    <span class="item-icon">{{ getFileIcon(child.relativePath, false) }}</span>
                    <span class="item-name">{{ child.relativePath.split('/').pop() }}</span>
                    <span v-if="child.relativePath in modifiedFiles" class="modified-dot" />
                  </div>
                </template>
              </div>
            </div>
            <!-- File (top level) -->
            <div
              v-else
              class="tree-item file"
              :class="{ active: selectedFile === item.relativePath, modified: item.relativePath in modifiedFiles }"
              @click="selectFile(item.relativePath)"
            >
              <span class="item-icon">{{ getFileIcon(item.relativePath, false) }}</span>
              <span class="item-name">{{ item.relativePath.split('/').pop() }}</span>
              <span v-if="item.relativePath in modifiedFiles" class="modified-dot" />
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- Editor area -->
    <div class="editor-area">
      <template v-if="selectedFile">
        <!-- Editor header -->
        <div class="editor-header">
          <div class="editor-file-name">
            <span class="file-icon">{{ getFileIcon(currentFileName, false) }}</span>
            {{ selectedFile }}
            <span v-if="isModified" class="modified-dot" />
          </div>
          <div class="editor-actions">
            <button
              v-if="isModified"
              class="editor-btn"
              @click="saveCurrentFile"
              :disabled="isSaving"
              title="保存 (Ctrl+S)"
            >
              <svg v-if="isSaving" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {{ isSaving ? '保存中...' : '保存' }}
            </button>
            <button
              class="editor-btn delete-btn"
              @click="deleteDialogFile = selectedFile"
              title="删除文件"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>

        <!-- Code editor -->
        <div v-if="isEditableFile(selectedFile)" class="editor-content">
          <SkillCodeEditor
            :model-value="currentContent"
            :language="currentLanguage"
            @update:model-value="handleContentChange"
          />
        </div>
        <div v-else class="editor-readonly">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p>此文件类型不支持编辑</p>
        </div>

        <!-- Status bar -->
        <div class="status-bar">
          <span class="status-path">{{ selectedFile }}</span>
          <div class="status-right">
            <span>{{ formatSize(currentSize) }}</span>
            <span>UTF-8</span>
            <span>{{ currentLanguage }}</span>
            <span v-if="isModified" class="status-unsaved">未保存</span>
          </div>
        </div>
      </template>
      <div v-else class="editor-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <p>选择一个文件进行编辑</p>
      </div>
    </div>

    <!-- New File Dialog -->
    <div v-if="newFileDialogOpen" class="dialog-overlay" @click.self="newFileDialogOpen = false">
      <div class="dialog">
        <h3>新建文件</h3>
        <input
          v-model="dialogInput"
          class="dialog-input"
          placeholder="输入文件名，如 helpers/utils.py"
          @keydown.enter="handleNewFile"
          @keydown.escape="newFileDialogOpen = false"
          autofocus
        />
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="newFileDialogOpen = false">取消</button>
          <button class="dialog-btn primary" @click="handleNewFile" :disabled="!dialogInput.trim()">创建</button>
        </div>
      </div>
    </div>

    <!-- New Folder Dialog -->
    <div v-if="newFolderDialogOpen" class="dialog-overlay" @click.self="newFolderDialogOpen = false">
      <div class="dialog">
        <h3>新建文件夹</h3>
        <input
          v-model="dialogInput"
          class="dialog-input"
          placeholder="输入文件夹名"
          @keydown.enter="handleNewFolder"
          @keydown.escape="newFolderDialogOpen = false"
          autofocus
        />
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="newFolderDialogOpen = false">取消</button>
          <button class="dialog-btn primary" @click="handleNewFolder" :disabled="!dialogInput.trim()">创建</button>
        </div>
      </div>
    </div>

    <!-- Delete Confirm Dialog -->
    <div v-if="deleteDialogFile" class="dialog-overlay" @click.self="deleteDialogFile = null">
      <div class="dialog">
        <h3>确认删除</h3>
        <p class="dialog-desc">确定要删除 <strong>{{ deleteDialogFile }}</strong> 吗？此操作不可撤销。</p>
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="deleteDialogFile = null">取消</button>
          <button class="dialog-btn danger" @click="handleDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-editor {
  display: flex;
  height: 100%;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  overflow: hidden;
  background: hsl(var(--card));
}

/* File tree */
.file-tree {
  width: 220px;
  min-width: 180px;
  border-right: 1px solid hsl(var(--border));
  display: flex;
  flex-direction: column;
  background: hsl(var(--accent) / 0.15);
}

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid hsl(var(--border));
}

.tree-title {
  font-size: 11px;
  font-weight: 700;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.tree-actions {
  display: flex;
  gap: 2px;
}

.tree-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
}
.tree-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.tree-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: hsl(var(--muted-foreground));
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  opacity: 0.5;
}

.tree-item-group {
  .tree-children {
    padding-left: 12px;
  }
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: hsl(var(--foreground) / 0.8);
  cursor: pointer;
  transition: all var(--duration-instant) var(--ease-standard);
  border: none;
  background: none;
  width: 100%;
  text-align: left;
}
.tree-item:hover {
  background: hsl(var(--accent) / 0.5);
}
.tree-item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.tree-item.modified .item-name {
  font-weight: 500;
}

.chevron {
  flex-shrink: 0;
  transition: transform var(--duration-quick) var(--ease-standard);
  color: hsl(var(--muted-foreground));
}
.chevron.expanded {
  transform: rotate(90deg);
}

.item-icon {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 1;
}

.item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modified-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: hsl(var(--primary));
  flex-shrink: 0;
  margin-left: auto;
}

/* Editor area */
.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--accent) / 0.2);
}

.editor-file-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-icon {
  font-size: 14px;
  line-height: 1;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.editor-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
}
.editor-btn:hover:not(:disabled) {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.editor-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.editor-btn.delete-btn {
  border: none;
  background: transparent;
  padding: 5px 8px;
}
.editor-btn.delete-btn:hover {
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.08);
}

.editor-content {
  flex: 1;
  overflow: hidden;
}

.editor-readonly {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: hsl(var(--muted-foreground));
  opacity: 0.4;
}
.editor-readonly p {
  font-size: 13px;
}

.editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: hsl(var(--muted-foreground));
  opacity: 0.35;
}
.editor-empty p {
  font-size: 13px;
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px;
  border-top: 1px solid hsl(var(--border));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--accent) / 0.2);
}

.status-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.status-unsaved {
  color: hsl(var(--primary));
  font-weight: 500;
}

/* Dialogs */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: hsl(0 0% 0% / 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  width: 360px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 20px 60px hsl(0 0% 0% / 0.15);
}

.dialog h3 {
  font-size: 16px;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin: 0 0 16px;
}

.dialog-desc {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  line-height: 1.6;
  margin: 0 0 20px;
}
.dialog-desc strong {
  color: hsl(var(--foreground));
}

.dialog-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  outline: none;
  font-family: inherit;
  margin-bottom: 16px;
  box-sizing: border-box;
}
.dialog-input:focus {
  border-color: hsl(var(--primary) / 0.5);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
}
.dialog-btn:hover {
  background: hsl(var(--muted));
}
.dialog-btn.primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}
.dialog-btn.primary:hover {
  opacity: 0.9;
}
.dialog-btn.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.dialog-btn.danger {
  background: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
  border-color: hsl(var(--destructive));
}
.dialog-btn.danger:hover {
  opacity: 0.9;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; }
</style>
