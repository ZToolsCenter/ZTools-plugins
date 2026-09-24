<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Check, CheckSquare, HardDrive, LoaderCircle, RefreshCw, Search, Square, Trash2, X } from 'lucide-vue-next'
import type { AppSummary, ExecutionResult, ScanResult } from './types'

const scan = ref<ScanResult | null>(null)
const query = ref('')
const loading = ref(false)
const executing = ref(false)
const error = ref('')
const result = ref<ExecutionResult | null>(null)
const resultDialog = ref<HTMLDialogElement | null>(null)

// 选中的 App ID 集合（支持多选）
const selectedAppIds = ref<Set<string>>(new Set())

// 用户偏好：是否保留应用个人数据/缓存（默认 true 保留个人数据，仅卸载应用本体）
const keepUserData = ref(true)

// 当前正在卸载处理的进度提示
const batchProgress = ref({ current: 0, total: 0, currentAppName: '' })

const bridge = () => window.applicationUninstaller
const visibleApps = computed(() => {
  const apps = scan.value?.apps ?? []
  const q = query.value.trim().toLowerCase()
  if (!q) return apps
  return apps.filter(app => 
    app.name.toLowerCase().includes(q) ||
    (app.publisher && app.publisher.toLowerCase().includes(q)) ||
    (app.bundleId && app.bundleId.toLowerCase().includes(q))
  )
})

const selectedCount = computed(() => selectedAppIds.value.size)
const allSelected = computed(() => visibleApps.value.length > 0 && visibleApps.value.every(a => selectedAppIds.value.has(a.id)))
const someSelected = computed(() => selectedCount.value > 0 && !allSelected.value)

function friendlyError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || '')
  return message && message.length < 180 ? message : '操作失败，请重试'
}

async function refresh() {
  const api = bridge()
  if (!api) { error.value = '请在 ZTools 中打开此插件'; return }
  loading.value = true; error.value = ''; selectedAppIds.value.clear()
  try { 
    scan.value = await api.scanApps() 
  } catch (value) { 
    error.value = friendlyError(value) 
  } finally { 
    loading.value = false 
  }
}

function toggleSelectApp(id: string) {
  const next = new Set(selectedAppIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedAppIds.value = next
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedAppIds.value = new Set()
  } else {
    selectedAppIds.value = new Set(visibleApps.value.map(a => a.id))
  }
}

function clearQuery() { query.value = '' }

// 核心批量/单选一键卸载流程（直接在列表操作）
async function executeBatchUninstall() {
  const api = bridge()
  if (!api || selectedCount.value === 0 || executing.value) return

  const targetApps = (scan.value?.apps ?? []).filter(a => selectedAppIds.value.has(a.id))
  if (targetApps.length === 0) return

  const appNames = targetApps.map(a => a.name).join('、')
  const modeText = keepUserData.value ? '【保留个人配置与数据缓存】' : '【彻底清除应用本体及所有残留数据】'
  const confirmMsg = `确定要卸载以下 ${targetApps.length} 个应用吗？\n\n${appNames}\n\n模式：${modeText}\n\n应用将移入系统废纸篓，安全可恢复。`

  if (!window.confirm(confirmMsg)) return

  executing.value = true
  error.value = ''
  batchProgress.value = { current: 0, total: targetApps.length, currentAppName: '' }

  const combinedResults: ExecutionResult['results'] = []

  try {
    for (let i = 0; i < targetApps.length; i++) {
      const app = targetApps[i]
      batchProgress.value = { current: i + 1, total: targetApps.length, currentAppName: app.name }
      
      try {
        const inspectPlan = await api.inspectApp(app.id)
        
        let targetCandidateIds: string[] = []
        if (keepUserData.value) {
          // 保留数据：只删除应用本体
          targetCandidateIds = inspectPlan.candidates
            .filter(c => c.deletable && c.category === 'application')
            .map(c => c.id)
        } else {
          // 彻底清除：删除所有可安全删除项
          targetCandidateIds = inspectPlan.candidates
            .filter(c => c.deletable)
            .map(c => c.id)
        }

        if (targetCandidateIds.length > 0) {
          const res = await api.executePlan({
            planId: inspectPlan.id,
            selectedIds: targetCandidateIds,
            confirmation: app.name
          })
          combinedResults.push(...res.results)
        }
      } catch (err) {
        combinedResults.push({
          candidateId: app.id,
          status: 'failed',
          message: `${app.name}: ${friendlyError(err)}`
        })
      }
    }

    result.value = {
      planId: 'batch-' + Date.now(),
      results: combinedResults
    }
  } catch (val) {
    error.value = friendlyError(val)
  } finally {
    executing.value = false
  }
}

async function closeResult() {
  result.value = null
  await refresh()
}

watch(result, async (value) => {
  if (!value) return
  await nextTick()
  if (resultDialog.value && !resultDialog.value.open) resultDialog.value.showModal()
})

onMounted(refresh)
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><Trash2 :size="19" /></div>
        <div>
          <h1>应用卸载助手</h1>
          <p>列表直观多选 · 自由保留个人数据 · 移入废纸篓安全可恢复</p>
        </div>
      </div>
      <button class="icon-button" type="button" :disabled="loading || executing" aria-label="重新扫描应用" @click="refresh">
        <RefreshCw :size="18" :class="{ spin: loading }" />
      </button>
    </header>

    <div v-if="error" class="alert error" role="alert" tabindex="-1">
      <AlertTriangle :size="17" />
      <span>{{ error }}</span>
      <button type="button" aria-label="关闭错误提示" @click="error = ''"><X :size="15" /></button>
    </div>

    <!-- 批量与配置操作栏 -->
    <section class="batch-bar">
      <div class="batch-left">
        <button class="select-all-btn" type="button" @click="toggleSelectAll">
          <CheckSquare v-if="allSelected" :size="18" class="check-icon checked" />
          <Square v-else-if="!someSelected" :size="18" class="check-icon" />
          <div v-else class="check-indeterminate" />
          <span>全选 ({{ selectedCount }} / {{ visibleApps.length }})</span>
        </button>

        <label class="data-option-label" title="开启后仅移除软件本体，保留该应用的用户文档、本地数据库与偏好设置">
          <input type="checkbox" v-model="keepUserData" class="custom-checkbox" />
          <span class="data-option-text">
            <strong>保留个人数据与配置</strong>
            <small>（取消勾选则抹除缓存残留）</small>
          </span>
        </label>
      </div>

      <div class="batch-right">
        <button 
          class="danger-batch-btn" 
          :disabled="selectedCount === 0 || executing" 
          @click="executeBatchUninstall"
        >
          <LoaderCircle v-if="executing" class="spin" :size="16" />
          <Trash2 v-else :size="16" />
          <span>{{ executing ? `正在卸载 (${batchProgress.current}/${batchProgress.total})…` : `一键卸载 (${selectedCount})` }}</span>
        </button>
      </div>
    </section>

    <!-- 应用列表 -->
    <section class="catalog">
      <label class="search">
        <Search :size="17" />
        <input v-model="query" aria-label="搜索应用" placeholder="搜索已安装的应用名称、发布者或包名…" />
      </label>

      <div v-if="loading && !scan" class="empty">
        <LoaderCircle class="spin" :size="28" />
        <p>正在读取系统应用目录与图标…</p>
      </div>

      <div v-else-if="visibleApps.length" class="app-list">
        <div 
          v-for="app in visibleApps" 
          :key="app.id" 
          class="app-row" 
          :class="{ selected: selectedAppIds.has(app.id) }"
          @click="toggleSelectApp(app.id)"
        >
          <!-- 勾选框 -->
          <div class="row-checkbox">
            <CheckSquare v-if="selectedAppIds.has(app.id)" :size="18" class="row-check checked" />
            <Square v-else :size="18" class="row-check" />
          </div>

          <!-- 应用图标 -->
          <div class="app-icon-wrap">
            <img v-if="app.icon" :src="app.icon" class="real-app-icon" alt="" />
            <div v-else class="app-icon-fallback">{{ app.name.slice(0, 1).toUpperCase() }}</div>
          </div>

          <!-- 应用信息 -->
          <div class="app-copy">
            <div class="app-title-row">
              <strong class="app-name-text">{{ app.name }}</strong>
              <span class="scope" :class="app.install.scope">{{ app.install.scope === 'user' ? '用户级' : '系统级' }}</span>
            </div>
            <small class="app-sub-text">
              {{ [app.publisher, app.version].filter(Boolean).join(' · ') || app.install.path || app.install.kind }}
            </small>
          </div>

          <!-- 快速状态提示 -->
          <div class="row-tail">
            <span class="data-mode-tag" :class="{ 'tag-clean': !keepUserData }">
              {{ keepUserData ? '保留数据' : '清理残留' }}
            </span>
          </div>
        </div>
      </div>

      <div v-else-if="scan" class="empty">
        <Search :size="28" />
        <p>{{ query.trim() ? '没有匹配的应用' : '没有发现可列出的应用' }}</p>
        <button v-if="query.trim()" class="empty-action" type="button" @click="clearQuery">清除搜索</button>
        <button v-else class="empty-action" type="button" @click="refresh">重新扫描</button>
      </div>
    </section>

    <!-- 卸载结果弹窗 -->
    <dialog v-if="result" ref="resultDialog" class="modal" aria-labelledby="result-title" @cancel.prevent="closeResult">
      <div class="result-icon"><Check :size="26" /></div>
      <h2 id="result-title">卸载处理完成</h2>
      <p>本次共成功处理 {{ result.results.filter(r => r.status === 'trashed' || r.status === 'uninstalled').length }} 项项目，均已安全移入系统废纸篓。</p>
      <div v-if="result.results.filter(r => r.status === 'failed').length > 0" class="result-errors">
        <p v-for="item in result.results.filter(i => i.status === 'failed')" :key="item.candidateId">{{ item.message }}</p>
      </div>
      <button class="primary-button" type="button" @click="closeResult">确定并刷新</button>
    </dialog>
  </main>
</template>
