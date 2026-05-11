<script setup lang="ts">
import { onMounted, onUnmounted, ref, provide, computed } from 'vue'
import { useFileShareStore } from '../store/fileShare'
import TreeNode from '../components/TreeNode.vue'
import QRCode from '../components/QRCode.vue'
import Toast from '../components/Toast.vue'
import { Copy, Search, Play, Square, X, FolderOpen } from 'lucide-vue-next'
import { IP_LIST_HIDE_DELAY } from '../utils/constants'

const store = useFileShareStore()
const theme = ref<'light' | 'dark'>('light')
const searchKeyword = ref('')
const showIPList = ref(false)
let hideTimer: number | null = null

const nodeControls = new Map<string, { expand: () => void; collapse: () => void; isFolder: boolean }>()

provide('registerNode', (id: string, controls: { expand: () => void; collapse: () => void; isFolder: boolean }) => {
  nodeControls.set(id, controls)
})

const filteredFiles = computed(() => {
  if (!searchKeyword.value.trim()) {
    return store.sharedFiles
  }
  return filterFiles(store.sharedFiles, searchKeyword.value.toLowerCase())
})

function filterFiles(files: FileNode[], keyword: string): FileNode[] {
  const result: FileNode[] = []
  for (const file of files) {
    if (file.name.toLowerCase().includes(keyword)) {
      result.push(file)
    } else if (file.type === 'folder' && file.children) {
      const filteredChildren = filterFiles(file.children, keyword)
      if (filteredChildren.length > 0) {
        result.push({ ...file, children: filteredChildren })
      }
    }
  }
  return result
}

function detectTheme() {
  theme.value = window.ztools.isDarkColors() ? 'dark' : 'light'
}

onMounted(async () => {
  detectTheme()
  await store.init()

  if (!store.serverRunning) {
    try {
      await store.startServer()
    } catch (err) {
      console.error('Failed to start server:', err)
    }
  }
})

onUnmounted(() => {
  store.cleanup()
  nodeControls.clear()
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
})

function handleMouseEnter() {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  showIPList.value = true
}

function handleMouseLeave() {
  hideTimer = window.setTimeout(() => {
    showIPList.value = false
    hideTimer = null
  }, IP_LIST_HIDE_DELAY)
}

async function handleSelectFiles() {
  try {
    await store.selectFiles()
  } catch (err) {
    console.error('Failed to select files:', err)
  }
}

async function handleSelectFolder() {
  try {
    await store.selectFolder()
    await handleRefresh()
  } catch (err) {
    console.error('Failed to select folder:', err)
  }
}

async function handleClear() {
  try {
    await store.clearFiles()
  } catch (err) {
    console.error('Failed to clear files:', err)
  }
}

async function handleRefresh() {
  try {
    await store.scanFiles()
    await store.refreshServerStatus()
  } catch (err) {
    console.error('Failed to refresh:', err)
  }
}

async function handleCopyUrl() {
  if (store.currentAccessUrl) {
    await store.copyUrl(store.currentAccessUrl)
  }
}

function handleSelectIP(ip: string) {
  store.selectIP(ip)
  showIPList.value = false
}

async function handleRemoveFile(fileId: string) {
  await store.removeFile(fileId)
}

async function handleCopyFileUrl(file: FileNode) {
  const url = store.getFileDownloadUrl(file)
  if (url) {
    await store.copyUrl(url)
  }
}

async function handleToggleServer() {
  try {
    if (store.serverRunning) {
      await store.stopServer()
    } else {
      await store.startServer()
    }
  } catch (err) {
    console.error('Failed to toggle server:', err)
  }
}

async function handleExpandAll() {
  const expandPromises: Promise<void>[] = []
  nodeControls.forEach((controls) => {
    if (controls.isFolder) {
      expandPromises.push(controls.expand() as any)
    }
  })
  await Promise.all(expandPromises)
}

function handleCollapseAll() {
  nodeControls.forEach((controls) => {
    if (controls.isFolder) {
      controls.collapse()
    }
  })
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

function handleOpenUploadDir() {
  store.openUploadDir()
  store.dismissUploadNotification()
}

async function handleChangeUploadDir() {
  await store.changeUploadDir()
}
</script>

<template>
  <div class="file-share" :data-theme="theme">
    <Toast />
    <!-- 上传目录和端口控制 -->
    <div class="status-bar-bottom">
      <div class="status-item upload-dir-item" v-if="store.uploadDir">
        <span class="status-label">上传目录:</span>
        <span
          class="status-value upload-dir-path"
          @click="handleChangeUploadDir"
          title="点击修改目录"
        >{{ store.uploadDir }}</span>
        <button class="btn-icon-small" @click="handleOpenUploadDir" title="打开目录">
          <FolderOpen :size="14" />
        </button>
      </div>

      <!-- 端口控制 -->
      <div class="port-control">
        <span class="status-label">端口:</span>
        <input
          v-model.number="store.serverPort"
          type="number"
          class="port-input"
          :disabled="store.serverRunning"
          :class="{ disabled: store.serverRunning }"
          min="1024"
          max="65535"
        />
        <button
          class="btn btn-icon-toggle"
          :class="store.serverRunning ? 'btn-danger' : 'btn-primary'"
          @click="handleToggleServer"
          :disabled="store.loading"
          :title="store.serverRunning ? '停止服务' : '启动服务'"
        >
          <Square :size="16" v-if="store.serverRunning" />
          <Play :size="16" v-else />
        </button>
      </div>
    </div>

    <!-- 上传通知 -->
    <div class="upload-notification" v-if="store.uploadNotification">
      <span class="upload-notification-text" v-if="store.uploadNotification.count > 1">
        收到 {{ store.uploadNotification.count }} 个文件，最新: {{ store.uploadNotification.name }} ({{ formatSize(store.uploadNotification.size) }})
      </span>
      <span class="upload-notification-text" v-else>
        收到文件: {{ store.uploadNotification.name }} ({{ formatSize(store.uploadNotification.size) }})
      </span>
      <div class="upload-notification-actions">
        <button class="btn btn-primary btn-sm" @click="handleOpenUploadDir">打开目录</button>
        <button class="btn-icon dismiss" @click="store.dismissUploadNotification()">
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- 文件树列表 -->
    <div class="file-tree-area">
      <div class="area-header">
        <div class="selection-area">
          <button class="btn btn-primary" @click="handleSelectFiles" :disabled="store.loading">
            选择文件
          </button>
          <button class="btn btn-primary" @click="handleSelectFolder" :disabled="store.loading">
            选择文件夹
          </button>
          <button class="btn btn-secondary" @click="handleClear" :disabled="store.sharedFiles.length === 0">
            清空列表
          </button>
          <button class="btn btn-secondary" @click="handleRefresh" :disabled="store.loading || store.sharedFiles.length === 0">
            刷新
          </button>
        </div>
        <div class="search-box">
          <Search :size="14" />
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索文件..."
            :disabled="store.loading || store.sharedFiles.length === 0"
          />
        </div>
        <div class="header-actions">
          <button class="btn btn-link" @click="handleExpandAll">展开全部</button>
          <button class="btn btn-link" @click="handleCollapseAll">折叠全部</button>
        </div>
      </div>

      <div class="file-list" v-if="filteredFiles.length > 0">
        <TreeNode
          v-for="item in filteredFiles"
          :key="item.id"
          :node="item"
          :level="0"
          @load-children="store.loadChildren"
        >
          <template #actions="{ node }">
            <div class="node-actions">
              <QRCode
                v-if="node.type === 'file'"
                :url="store.getFileDownloadUrl(node)"
                :size="120"
              />
              <button
                v-if="node.type === 'file'"
                class="btn-icon copy"
                @click.stop="handleCopyFileUrl(node)"
                title="复制链接"
              >
                <Copy :size="14" />
              </button>
              <button
                class="btn-icon delete"
                @click.stop="handleRemoveFile(node.id)"
                title="删除"
              >
                <X :size="16" />
              </button>
            </div>
          </template>
        </TreeNode>
      </div>

      <div class="empty-state" v-else>
        {{ searchKeyword ? '未找到匹配的文件' : '请选择文件或文件夹开始分享' }}
      </div>
    </div>

    <!-- 状态栏 -->
    <div class="status-bar">
      <div class="status-item">
        <span class="status-label">服务状态:</span>
        <span :class="['status-value', store.serverRunning ? 'running' : 'stopped']">
          {{ store.serverStatus }}
        </span>
      </div>
      <div class="status-item flex-1">
        <span class="status-label">共享文件:</span>
        <span class="status-value">{{ store.fileCount }} 个</span>
      </div>
      <div class="status-item" v-if="store.currentAccessUrl">
        <span class="status-label">访问地址:</span>
        <div
          class="url-selector"
          @mouseenter="handleMouseEnter"
          @mouseleave="handleMouseLeave"
        >
          <span class="status-value url">{{ store.currentAccessUrl }}</span>

          <!-- IP列表弹出框 -->
          <div
            class="ip-list-popup"
            v-if="showIPList && store.lanIPs.length >= 1"
            @mouseenter="handleMouseEnter"
            @mouseleave="handleMouseLeave"
          >
            <div class="ip-list-header">选择IP地址</div>
            <div class="ip-list-items">
              <div
                v-for="ip in store.lanIPs"
                :key="ip"
                class="ip-list-item"
                :class="{ active: ip === store.selectedIP }"
                @click="handleSelectIP(ip)"
              >
                <span class="ip-address">{{ ip }}</span>
                <span class="ip-check" v-if="ip === store.selectedIP">✓</span>
              </div>
            </div>
          </div>
        </div>
        <button class="btn-icon-small" @click="handleCopyUrl" title="复制地址">
          <Copy :size="14" />
        </button>
        <QRCode :url="store.currentAccessUrl" :size="160" />
      </div>
    </div>
    </div>
</template>

<style src="./style.scss" scoped></style>

<style>
.file-share .delete,
.file-share .copy {
  opacity: 0;
}
.file-share .node-content:hover .delete,
.file-share .node-content:hover .copy {
  opacity: 1;
}
</style>
