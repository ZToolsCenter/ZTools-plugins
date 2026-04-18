<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { IDEConfig, SearchItem } from '../types'
import { getIDEConfigs } from '../config'

const props = defineProps<{ enterAction?: any }>()

const searchWord = ref('')
const configs = ref<IDEConfig[]>([])
const selectedConfigIndex = ref(0)
const searchResults = ref<SearchItem[]>([])
const loading = ref(false)
const errorMsg = ref('')
const hasSearched = ref(false)

const hasConfigs = computed(() => configs.value.length > 0)

// 防抖定时器
let _searchTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSearch() {
  if (_searchTimer) clearTimeout(_searchTimer)
  const word = searchWord.value.trim()
  // 空输入时不触发搜索
  if (!word || /^\s*$/.test(word)) return
  _searchTimer = setTimeout(async () => {
    await doSearch()
  }, 200)
}

// 监听搜索词变化，实时触发搜索
watch(searchWord, async (newVal) => {
  const trimmed = newVal.trim()
  if (!trimmed) {
    // 清空输入时恢复默认最近 20 条
    hasSearched.value = false
    searchResults.value = []
    loading.value = false
    errorMsg.value = ''
    if (hasConfigs.value) {
      const results = await loadHistory()
      searchResults.value = results
      hasSearched.value = true
    }
    return
  }
  debouncedSearch()
})

// 加载 IDE 配置
function loadConfigs() {
  try {
    configs.value = getIDEConfigs()
    if (configs.value.length === 0) {
      errorMsg.value = '未找到任何 IDE 配置，请先在"IDE 管理"中添加'
    }
  } catch (e: any) {
    errorMsg.value = String(e.message ?? e ?? '加载配置失败')
  }
}

// 加载历史记录（不依赖搜索，用于默认展示）
async function loadHistory(keyword = ''): Promise<SearchItem[]> {
  const config = configs.value[selectedConfigIndex.value]
  if (!config || !config.database) {
    return []
  }

  const services = window.services
  if (!services) {
    return []
  }

  try {
    const paths: string[] = await services.getVSCodeHistory(config.database)

    // 按路径排序（越长的路径通常越新），取最新 20 条
    const sorted = [...paths].sort((a, b) => b.localeCompare(a))
    const limited = keyword ? sorted : sorted.slice(0, 20)

    // 过滤搜索
    let filtered = limited
    if (keyword) {
      const keywords = keyword.split(/\s+/).filter(Boolean)
      filtered = limited.filter((p) =>
        keywords.every((kw) => p.toLowerCase().includes(kw.toLowerCase()))
      )
    }

    return filtered.map((p) => createSearchItem(p))
  } catch {
    return []
  }
}

// 搜索项目
async function doSearch() {
  if (!hasConfigs.value) return

  const word = searchWord.value.trim()

  if (!word) return

  loading.value = true
  errorMsg.value = ''
  hasSearched.value = true

  try {
    const results = await loadHistory(word)
    searchResults.value = results
  } catch (e: any) {
    errorMsg.value = String(e.message ?? e ?? '搜索失败')
    searchResults.value = []
  } finally {
    loading.value = false
  }
}

function createSearchItem(path: string): SearchItem {
  const basename = path.split(/[\\/]/).pop() || path
  const isWorkspace = path.includes('.code-workspace')
  return { path, title: basename, isWorkspace, isRemote: path.includes('remote'), ext: '' }
}

// 打开项目
async function openItem(item: SearchItem) {
  const config = configs.value[selectedConfigIndex.value]
  if (!config) return

  const cmd = config.command.trim()
  const safeCmd = cmd.includes(' ') ? `"${cmd}"` : cmd

  const args = item.isWorkspace ? '--file-uri' : '--folder-uri'
  const fullCmd = `${safeCmd} ${args} "${item.path}"`

  let shell = config.terminal.trim()
  if (shell) {
    const shellCmd = shell.includes(' ') ? `"${shell}"` : shell
    const finalCmd = `env; ${fullCmd}`
    execCmd(`${shellCmd} "${finalCmd}"`, config)
  } else {
    execCmd(fullCmd, config)
  }
}

function execCmd(cmd: string, _config: IDEConfig) {
  if (!window.services) {
    errorMsg.value = 'preload services 未初始化'
    return
  }
  const timeout = parseInt(_config.timeout) || 3000
  window.services.shellExec(cmd, { timeout })
    .then(() => {
      window.ztools.outPlugin()
    })
    .catch((e: any) => {
      errorMsg.value = String(e.message ?? e ?? '执行失败')
    })
}

// 复制路径到剪贴板
function copyPath(item: SearchItem) {
  const osPath = window.services._uriToOSPath(item.path)
  const success = window.ztools.copyText(osPath)
  if (success) {
    window.ztools.showNotification(`已复制路径: ${item.title}`)
  } else {
    window.ztools.showNotification('复制失败')
  }
}

// 切换 IDE 配置
async function onConfigChange() {
  searchResults.value = []
  errorMsg.value = ''

  const word = searchWord.value.trim()
  try {
    if (word) {
      // 有搜索词则重新搜索
      hasSearched.value = true
      await doSearch()
    } else {
      // 无搜索词则恢复默认最近 20 条
      hasSearched.value = false
      const results = await loadHistory()
      searchResults.value = results
      hasSearched.value = true
    }
  } catch (e: any) {
    errorMsg.value = String(e.message ?? e ?? '切换配置失败')
  }
}

// 初始化
onMounted(() => {
  loadConfigs()
  if (hasConfigs.value) {
    // 自动加载最新 20 条记录
    loadHistory().then((results) => {
      searchResults.value = results
      hasSearched.value = true
    })
  }
})

// 清理防抖定时器
onUnmounted(() => {
  if (_searchTimer) clearTimeout(_searchTimer)
})
</script>

<template>
  <div class="search-page">
    <!-- 无配置提示 -->
    <div v-if="!hasConfigs" class="empty-state">
      <div class="empty-icon">⚙️</div>
      <p class="empty-title">未找到 IDE 配置</p>
      <p class="empty-desc">请先在"IDE 管理"中添加你的 IDE 配置</p>
    </div>

    <!-- 主内容 -->
    <template v-else>
      <!-- 顶部栏：配置选择 + 搜索 -->
      <div class="toolbar">
        <div v-if="configs.length > 1" class="config-selector">
          <select v-model="selectedConfigIndex" @change="onConfigChange">
            <option v-for="(cfg, i) in configs" :key="cfg.code" :value="i">
              {{ cfg.code }}
            </option>
          </select>
        </div>
        <div class="search-wrap">
          <input
            v-model="searchWord"
            type="text"
            placeholder="输入关键词搜索项目"
            class="search-input"
          />
        </div>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="status-bar">
        <span class="spinner"></span>
        <span class="status-text">搜索中...</span>
      </div>

      <!-- 错误信息 -->
      <div v-if="errorMsg" class="status-bar error-bar">
        <span class="error-icon">✕</span>
        <span>{{ errorMsg }}</span>
      </div>

      <!-- 搜索结果 -->
      <template v-if="!loading && !errorMsg">
        <!-- 默认展示/无搜索 -->
        <div v-if="!hasSearched" class="hint-area">
          <div class="hint-icon">🔍</div>
          <p class="hint-text">输入关键词搜索历史项目</p>
          <p class="hint-hint">未搜索时默认显示最近 20 条项目记录</p>
        </div>

        <!-- 搜索结果列表 -->
        <div v-else-if="searchResults.length > 0" class="results-list">
          <div
            v-for="item in searchResults"
            :key="item.path"
            class="result-card"
          >
            <div class="result-main" @click="openItem(item)">
              <div class="result-icon">
                <span v-if="item.isWorkspace">📦</span>
                <span v-else>📁</span>
              </div>
              <div class="result-details">
                <span class="result-title">{{ item.title }}</span>
                <span class="result-path" :title="item.path">{{ item.path }}</span>
              </div>
            </div>
            <div class="result-actions">
              <button
                class="btn btn-primary btn-sm"
                @click.stop="openItem(item)"
              >
                打开
              </button>
              <button
                class="btn btn-sm"
                style="background:#8b5cf6;color:#fff"
                @click.stop="copyPath(item)"
              >
                复制路径
              </button>
            </div>
          </div>
        </div>

        <!-- 空搜索结果 -->
        <div v-else-if="hasSearched && searchResults.length === 0" class="empty-result">
          <div class="empty-result-icon">🔎</div>
          <p class="empty-result-text">未找到匹配的项目</p>
          <p class="empty-result-hint">尝试其他关键词，或使用回车键重新搜索</p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.search-page {
  margin: 10px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--vscode-editor-bg, #ffffff);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.config-selector {
		flex-shrink: 0;
	}

	.config-selector select {
  padding: 6px 10px;
  border: 1px solid var(--border-color, #d0d0d0);
  border-radius: 6px;
  background: var(--input-bg, #fafafa);
  color: var(--text-color, #333);
  font-size: 12px;
  cursor: pointer;
  outline: none;
}

.config-selector select:focus {
  border-color: var(--primary-color, #4a90d9);
}

.search-wrap {
	flex: 1;
	min-width: 0;
}

.search-input {
  width: 100%;
  padding: 8px 14px;
  border: 1px solid var(--border-color, #d0d0d0);
  border-radius: 6px;
  background: var(--input-bg, #fafafa);
  color: var(--text-color, #333);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-sizing: border-box;
}

.search-input:focus {
  border-color: var(--primary-color, #4a90d9);
  box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.15);
}

.search-input::placeholder {
  color: var(--text-secondary, #999);
}

/* ===== 状态栏 ===== */
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  background: var(--vscode-editor-bg, #fff);
}

.status-bar.error-bar {
  color: #c0392b;
  background: #fef2f2;
}

.error-icon {
  font-size: 12px;
  font-weight: bold;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-color, #e0e0e0);
  border-top-color: var(--primary-color, #4a90d9);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== 空状态 ===== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.empty-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-secondary, #888);
}

.empty-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  text-align: center;
}

.empty-result-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.empty-result-text {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--text-color, #333);
  font-weight: 500;
}

.empty-result-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

/* ===== 提示区域 ===== */
.hint-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.hint-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.hint-text {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--text-color, #555);
  font-weight: 500;
}

.hint-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

/* ===== 结果列表 ===== */
.results-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.result-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  margin: 0 12px;
  border-radius: 6px;
  transition: background 0.15s;
}

.result-card:hover {
  background: var(--hover-bg, #f5f7fa);
}

.result-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  padding: 4px 0;
}

.result-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.result-details {
  flex: 1;
  min-width: 0;
}

.result-title {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color, #333);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-path {
  display: block;
  font-size: 11px;
  color: var(--text-secondary, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-actions {
  flex-shrink: 0;
  row-gap: 4px;
  margin-left: 12px;
}

/* ===== 按钮 ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 30px;
  margin: 0 3px 0 3px;
  border: none;
  border-radius: 2px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
}

.btn-sm {
  padding: 5px 12px;
  font-size: 12px;
}

.btn-primary {
  background: var(--primary-color, #4a90d9);
  color: #fff;
}

.btn-primary:hover {
  background: var(--primary-hover, #3a7bc8);
}

.btn-danger {
  background: #ef4444;
  color: #fff;
}

.btn-danger:hover {
  background: #dc2626;
}
</style>
