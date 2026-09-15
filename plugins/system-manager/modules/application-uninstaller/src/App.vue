<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AlertTriangle, ArrowLeft, Check, ChevronRight, LoaderCircle, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-vue-next'
import type { AppSummary, ExecutionResult, ScanResult, UninstallPlan } from './types'
import { defaultSelectedIds, filterApps, formatBytes, summarizeResult } from './model/uninstall'

const scan = ref<ScanResult | null>(null)
const plan = ref<UninstallPlan | null>(null)
const query = ref('')
const selectedIds = ref<string[]>([])
const confirmation = ref('')
const loading = ref(false)
const executing = ref(false)
const error = ref('')
const result = ref<ExecutionResult | null>(null)
const errorAlert = ref<HTMLElement | null>(null)
const resultDialog = ref<HTMLDialogElement | null>(null)

const bridge = () => window.applicationUninstaller
const visibleApps = computed(() => filterApps(scan.value?.apps ?? [], query.value))
const selectedCount = computed(() => selectedIds.value.length)
const canExecute = computed(() => Boolean(plan.value) && selectedCount.value > 0 && confirmation.value === plan.value?.app.name && !executing.value)
const resultSummary = computed(() => result.value ? summarizeResult(result.value) : null)

function friendlyError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || '')
  return message && message.length < 180 ? message : '操作失败，请重试'
}

async function refresh() {
  const api = bridge()
  if (!api) { error.value = '请在 ZTools 中打开此插件'; return }
  loading.value = true; error.value = ''; plan.value = null
  try { scan.value = await api.scanApps() } catch (value) { error.value = friendlyError(value) }
  finally { loading.value = false }
}

async function chooseApp(app: AppSummary) {
  const api = bridge()
  if (!api) return
  loading.value = true; error.value = ''
  try {
    plan.value = await api.inspectApp(app.id)
    selectedIds.value = defaultSelectedIds(plan.value.candidates)
    confirmation.value = ''
  } catch (value) { error.value = friendlyError(value) }
  finally { loading.value = false }
}

function toggle(id: string, allowed: boolean) {
  if (!allowed) return
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter((item) => item !== id) : [...selectedIds.value, id]
}

function back() { plan.value = null; confirmation.value = ''; selectedIds.value = []; error.value = '' }
function clearQuery() { query.value = '' }

async function execute() {
  const api = bridge()
  if (!api || !plan.value || !canExecute.value) return
  executing.value = true; error.value = ''
  try {
    result.value = await api.executePlan({ planId: plan.value.id, selectedIds: selectedIds.value, confirmation: confirmation.value })
  } catch (value) { error.value = friendlyError(value) }
  finally { executing.value = false }
}

function reveal(id: string) { bridge()?.revealPath(id) }

async function closeResult() {
  result.value = null
  await refresh()
}

watch(result, async (value) => {
  if (!value) return
  await nextTick()
  if (resultDialog.value && !resultDialog.value.open) resultDialog.value.showModal()
})

watch(error, async (value) => {
  if (!value) return
  await nextTick()
  errorAlert.value?.focus()
})

onMounted(refresh)
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark"><Trash2 :size="19" /></div><div><h1>应用卸载助手</h1><p>完整预览 · 安全移入废纸篓</p></div></div>
      <button class="icon-button" type="button" :disabled="loading" aria-label="重新扫描应用" @click="refresh"><RefreshCw :size="18" :class="{ spin: loading }" /></button>
    </header>

    <div v-if="error" ref="errorAlert" class="alert error" role="alert" aria-atomic="true" tabindex="-1"><AlertTriangle :size="17" /><span>{{ error }}</span><button type="button" aria-label="关闭错误提示" @click="error = ''"><X :size="15" /></button></div>

    <section v-if="!plan" class="catalog">
      <div class="hero">
        <div><span class="eyebrow">LOCAL APP CATALOG</span><h2>选择要卸载的应用</h2><p>只扫描标准应用入口，不上传任何本机信息。</p></div>
        <div class="scan-stat"><strong>{{ scan?.apps.length ?? 0 }}</strong><span>个应用</span></div>
      </div>
      <label class="search"><Search :size="17" /><input v-model="query" aria-label="搜索应用" placeholder="搜索名称、发布者或版本" /></label>
      <div v-for="warning in scan?.warnings ?? []" :key="warning" class="alert warning"><AlertTriangle :size="17" /><span>{{ warning }}</span></div>
      <div v-if="loading && !scan" class="empty"><LoaderCircle class="spin" :size="28" /><p>正在读取系统应用目录…</p></div>
      <div v-else-if="visibleApps.length" class="app-list">
        <button v-for="app in visibleApps" :key="app.id" class="app-row" type="button" @click="chooseApp(app)">
          <span class="app-icon">{{ app.name.slice(0, 1).toUpperCase() }}</span>
          <span class="app-copy"><strong>{{ app.name }}</strong><small>{{ [app.publisher, app.version].filter(Boolean).join(' · ') || app.install.kind }}</small></span>
          <span class="scope" :class="app.install.scope">{{ app.install.scope === 'user' ? '用户' : '系统' }}</span>
          <ChevronRight :size="18" />
        </button>
      </div>
      <div v-else-if="scan" class="empty">
        <Search :size="28" />
        <p>{{ query.trim() ? '没有匹配的应用' : '没有发现可列出的应用' }}</p>
        <button v-if="query.trim()" class="empty-action" type="button" @click="clearQuery">清除搜索</button>
        <button v-else class="empty-action" type="button" @click="refresh">重新扫描</button>
      </div>
    </section>

    <section v-else class="plan">
      <button class="back" type="button" @click="back"><ArrowLeft :size="16" />返回应用列表</button>
      <div class="plan-head">
        <div class="app-icon large">{{ plan.app.name.slice(0, 1).toUpperCase() }}</div>
        <div><span class="eyebrow">UNINSTALL PREVIEW</span><h2>{{ plan.app.name }}</h2><p>{{ plan.app.version || '未知版本' }} · {{ plan.app.install.scope === 'user' ? '用户级安装' : '系统级安装' }}</p></div>
      </div>
      <div v-for="warning in plan.warnings" :key="warning" class="alert warning"><AlertTriangle :size="17" /><span>{{ warning }}</span></div>
      <div class="safety-note"><ShieldCheck :size="20" /><div><strong>不会直接永久删除</strong><p>执行前会再次核对真实路径和文件指纹，处理项将移入系统废纸篓。</p></div></div>
      <div class="section-title"><div><h3>关联项目</h3><p>已选择 {{ selectedCount }} / {{ plan.candidates.length }} 项</p></div></div>
      <div v-if="!plan.candidates.length" class="empty compact"><Check :size="26" /><p>没有发现标准用户级残留</p></div>
      <div v-else class="candidate-list">
        <article v-for="item in plan.candidates" :key="item.id" class="candidate" :class="{ disabled: !item.deletable }">
          <button class="checkbox" type="button" role="checkbox" :aria-checked="selectedIds.includes(item.id)" :aria-label="`${selectedIds.includes(item.id) ? '取消选择' : '选择'} ${item.path}`" :class="{ checked: selectedIds.includes(item.id) }" :disabled="!item.deletable" @click="toggle(item.id, item.deletable)"><Check v-if="selectedIds.includes(item.id)" :size="14" /></button>
          <div class="candidate-copy"><div><span class="category">{{ item.category }}</span><span class="confidence" :class="{ inferred: item.confidence === 'strong' || !item.selectedByDefault }">{{ item.category === 'application' && item.selectedByDefault ? '应用本体' : item.confidence === 'exact' ? '声明标识 · 默认不选' : item.confidence === 'strong' ? '名称推断 · 默认不选' : '低关联' }}</span></div><button class="path" title="在文件管理器中显示" @click="reveal(item.id)">{{ item.path }}</button><small>{{ item.reason }}</small></div>
          <span class="size">{{ formatBytes(item.sizeBytes) }}</span>
        </article>
      </div>
      <div class="confirm-box">
        <label for="uninstall-confirmation">输入 <strong>{{ plan.app.name }}</strong> 确认</label>
        <input id="uninstall-confirmation" v-model="confirmation" :placeholder="plan.app.name" autocomplete="off" />
        <button class="danger-button" :disabled="!canExecute" @click="execute"><LoaderCircle v-if="executing" class="spin" :size="17" /><Trash2 v-else :size="17" />{{ executing ? '正在处理…' : `移到废纸篓 ${selectedCount} 项` }}</button>
      </div>
    </section>

    <dialog v-if="result && resultSummary" ref="resultDialog" class="modal" aria-labelledby="result-title" @cancel.prevent="closeResult">
      <div class="result-icon"><Check :size="26" /></div><h2 id="result-title">处理完成</h2><p>移入废纸篓 {{ resultSummary.trashed }} 项，卸载器 {{ resultSummary.launched }} 项，失败 {{ resultSummary.failed }} 项。</p><div v-if="resultSummary.failed" class="result-errors"><p v-for="item in result.results.filter(i => i.status === 'failed')" :key="item.candidateId">{{ item.message }}</p></div><button class="primary-button" type="button" @click="closeResult">返回并重新扫描</button>
    </dialog>
  </main>
</template>
