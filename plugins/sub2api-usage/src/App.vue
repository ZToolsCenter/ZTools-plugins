<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Copy, ExternalLink, Eye, Minus, PanelLeftClose, Plus, RefreshCw, Settings, Trash2, X } from 'lucide-vue-next'
import { ZButton, ZInput } from 'ztools-ui'

type NoticeType = 'success' | 'error' | 'info'

const isFloating = new URLSearchParams(window.location.search).get('floating') === '1'
const runtime = computed(() => window.sub2ApiUsage || createBrowserFallback())

const config = ref<Sub2ApiUsageConfig>({
  baseUrl: '',
  authorization: '',
  refreshToken: '',
  apiKeys: [{ id: 1418, alias: '默认 Key' }],
  autoRefreshSeconds: 60
})
const usage = ref<Sub2ApiUsagePayload | null>(null)
const loading = ref(false)
const saving = ref(false)
const refreshingToken = ref(false)
const floatingDocked = ref(false)
const notice = ref<{ type: NoticeType; text: string } | null>(null)
let noticeTimer = 0
let refreshTimer = 0
let floatingDragOffset: { x: number; y: number } | null = null

const hasConfig = computed(() => {
  return Boolean(config.value.baseUrl.trim() && config.value.authorization.trim() && config.value.apiKeys.length)
})

const totalTokensText = computed(() => formatNumber(usage.value?.summary.tokens || 0))
const hasTokenUsage = computed(() => Boolean((usage.value?.summary.tokens || 0) > 0))
const primaryMetricLabel = computed(() => (hasTokenUsage.value ? 'Total Tokens' : 'Total Cost'))
const primaryMetricValue = computed(() =>
  hasTokenUsage.value ? totalTokensText.value : formatCurrency(usage.value?.summary.cost || 0)
)
const secondaryMetricLabel = computed(() => (hasTokenUsage.value ? 'Input' : 'Today'))
const secondaryMetricValue = computed(() =>
  hasTokenUsage.value ? formatNumber(usage.value?.summary.inputTokens || 0) : formatCurrency(usage.value?.summary.todayCost || 0)
)
const floatingPrimaryMetricValue = computed(() =>
  hasTokenUsage.value ? formatFloatNumber(usage.value?.summary.tokens || 0) : formatFloatCurrency(usage.value?.summary.cost || 0)
)
const floatingSecondaryMetricValue = computed(() =>
  hasTokenUsage.value ? formatFloatNumber(usage.value?.summary.inputTokens || 0) : formatFloatCurrency(usage.value?.summary.todayCost || 0)
)
const fetchedAtText = computed(() => {
  if (!usage.value?.fetchedAt) return '尚未刷新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(usage.value.fetchedAt))
})

function showNotice(type: NoticeType, text: string): void {
  notice.value = { type, text }
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = null
  }, 2400)
}

function loadConfig(): void {
  const result = runtime.value.getConfig()
  if (result.success && result.data) {
    config.value = result.data
    return
  }
  showNotice('error', result.error || '读取配置失败')
}

async function saveConfig(showSuccess = true): Promise<boolean> {
  saving.value = true
  try {
    const result = runtime.value.saveConfig(config.value)
    if (!result.success || !result.data) {
      showNotice('error', result.error || '保存失败')
      return false
    }
    config.value = result.data
    if (showSuccess) showNotice('success', '配置已保存')
    resetAutoRefresh()
    return true
  } catch (error) {
    console.error('[Sub2API Usage] save failed:', error)
    showNotice('error', '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

async function refreshUsage(): Promise<void> {
  if (!hasConfig.value || loading.value) return
  loading.value = true
  try {
    const result = await runtime.value.fetchUsage()
    if (!result.success || !result.data) {
      showNotice('error', result.error || '刷新失败')
      return
    }
    usage.value = result.data
    if (result.data.authUpdated && result.data.config) {
      config.value = result.data.config
      if (!isFloating) showNotice('success', 'Token 已刷新并保存')
    } else if (!isFloating) {
      showNotice('success', '用量已刷新')
    }
  } catch (error) {
    console.error('[Sub2API Usage] fetch failed:', error)
    showNotice('error', '刷新失败')
  } finally {
    loading.value = false
  }
}

async function saveAndRefresh(): Promise<void> {
  const saved = await saveConfig(false)
  if (saved) await refreshUsage()
}

function addApiKey(): void {
  config.value.apiKeys.push({
    id: 0,
    alias: ''
  })
}

function removeApiKey(index: number): void {
  if (config.value.apiKeys.length <= 1) {
    showNotice('info', '至少保留一个 api_key_id')
    return
  }
  config.value.apiKeys.splice(index, 1)
}

function normalizeKeyId(key: Sub2ApiKeyConfig, value: string | number): void {
  key.id = Number(value) || 0
}

function openFloatingWindow(): void {
  const result = runtime.value.openFloatingWindow()
  if (result.success) {
    showNotice('success', '悬浮小窗已打开')
    return
  }
  showNotice('error', result.error || '打开失败')
}

async function testRefreshToken(): Promise<void> {
  if (refreshingToken.value) return
  const saved = await saveConfig(false)
  if (!saved) return

  refreshingToken.value = true
  try {
    const result = await runtime.value.refreshAuthToken()
    if (!result.success || !result.data) {
      showNotice('error', result.error || '刷新 token 失败')
      return
    }
    config.value = result.data
    showNotice('success', 'Token 刷新测试成功')
  } catch (error) {
    console.error('[Sub2API Usage] refresh token failed:', error)
    showNotice('error', '刷新 token 失败')
  } finally {
    refreshingToken.value = false
  }
}

function copySummary(): void {
  const lines = [
    `Sub2API ${primaryMetricLabel.value}: ${primaryMetricValue.value}`,
    `更新时间: ${fetchedAtText.value}`,
    ...(usage.value?.records || []).map((record) =>
      hasTokenUsage.value
        ? `${record.alias}(${record.id}): ${formatNumber(record.tokens)} tokens`
        : `${record.alias}(${record.id}): total ${formatCurrency(record.cost)}, today ${formatCurrency(record.todayCost)}`
    )
  ]
  const result = runtime.value.copyText(lines.join('\n'))
  showNotice(result.success ? 'success' : 'error', result.success ? '已复制' : result.error || '复制失败')
}

function closeFloatingWindow(): void {
  window.close()
}

function startFloatingDrag(event: MouseEvent): void {
  if (event.button !== 0 || (event.target as HTMLElement | null)?.closest('.no-drag')) return
  floatingDragOffset = {
    x: event.pageX,
    y: event.pageY
  }
  window.addEventListener('mousemove', moveFloatingDrag)
  window.addEventListener('mouseup', stopFloatingDrag)
}

function moveFloatingDrag(event: MouseEvent): void {
  if (!floatingDragOffset) return
  runtime.value.moveFloatingWindow(event.screenX - floatingDragOffset.x, event.screenY - floatingDragOffset.y)
}

function stopFloatingDrag(): void {
  if (!floatingDragOffset) return
  floatingDragOffset = null
  window.removeEventListener('mousemove', moveFloatingDrag)
  window.removeEventListener('mouseup', stopFloatingDrag)
  runtime.value.stopFloatingMove()
}

function dockFloatingWindow(): void {
  const result = runtime.value.dockFloatingWindow()
  if (result.success) {
    floatingDocked.value = true
    return
  }
  showNotice('error', result.error || '贴边失败')
}

function resetAutoRefresh(): void {
  window.clearInterval(refreshTimer)
  if (!isFloating || !config.value.autoRefreshSeconds) return
  refreshTimer = window.setInterval(refreshUsage, config.value.autoRefreshSeconds * 1000)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value || 0)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  }).format(value || 0)
}

function formatFloatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0)
}

function formatFloatCurrency(value: number): string {
  return formatFloatNumber(value)
}

function createBrowserFallback(): Sub2ApiUsageApi {
  return {
    getConfig: () => ({ success: true, data: config.value }),
    saveConfig: (nextConfig) => {
      config.value = nextConfig
      return { success: true, data: nextConfig }
    },
    fetchUsage: async () => ({ success: false, error: '等待 ZTools 插件运行时' }),
    refreshAuthToken: async () => ({ success: false, error: '等待 ZTools 插件运行时' }),
    dockFloatingWindow: () => ({ success: true }),
    expandDockedFloatingWindow: () => ({ success: true }),
    collapseDockedFloatingWindow: () => ({ success: true }),
    moveFloatingWindow: () => ({ success: true }),
    stopFloatingMove: () => ({ success: true }),
    openFloatingWindow: () => {
      window.open(`${window.location.origin}${window.location.pathname}?floating=1`, '_blank', 'width=248,height=116')
      return { success: true }
    },
    copyText: (text) => {
      void navigator.clipboard?.writeText(text)
      return { success: true }
    }
  }
}

onMounted(async () => {
  if (!isFloating) {
    window.ztools?.setExpendHeight?.(620)
  }
  loadConfig()
  await refreshUsage()
  resetAutoRefresh()
})

onUnmounted(() => {
  window.clearTimeout(noticeTimer)
  window.clearInterval(refreshTimer)
  stopFloatingDrag()
})
</script>

<template>
  <main class="app-shell" :class="{ floating: isFloating }">
    <section v-if="isFloating" class="floating-panel" @mousedown="startFloatingDrag">
      <header class="float-header">
        <div class="float-metrics">
          <div>
            <p>{{ primaryMetricLabel }}</p>
            <strong>{{ floatingPrimaryMetricValue }}</strong>
          </div>
          <div>
            <p>{{ secondaryMetricLabel }}</p>
            <strong>{{ floatingSecondaryMetricValue }}</strong>
          </div>
        </div>
        <div class="float-actions">
          <button class="icon-button no-drag" title="贴边隐藏" @click="dockFloatingWindow">
            <PanelLeftClose :size="13" />
          </button>
          <button class="icon-button no-drag" title="刷新" :disabled="loading" @click="refreshUsage">
            <RefreshCw :size="13" :class="{ spinning: loading }" />
          </button>
          <button class="icon-button no-drag" title="关闭" @click="closeFloatingWindow">
            <X :size="13" />
          </button>
        </div>
      </header>

      <div class="float-list">
        <div v-for="record in usage?.records || []" :key="record.id" class="float-row">
          <span>{{ record.alias }}</span>
          <strong>
            {{
              hasTokenUsage
                ? `${formatFloatNumber(record.tokens)} / ${formatFloatNumber(record.inputTokens)}`
                : `${formatFloatCurrency(record.cost)} / ${formatFloatCurrency(record.todayCost)}`
            }}
          </strong>
        </div>
      </div>
    </section>

    <section v-else class="manager-panel">
      <header class="topbar">
        <div class="title-block">
          <span class="logo-mark">S2</span>
          <div>
            <h1>Sub2API 用量</h1>
            <p>{{ config.baseUrl }}</p>
          </div>
        </div>
        <div class="topbar-actions">
          <ZButton size="medium" :disabled="loading || !hasConfig" @click="copySummary">
            <Copy :size="16" />
            复制
          </ZButton>
          <ZButton size="medium" @click="openFloatingWindow">
            <Eye :size="16" />
            小窗
          </ZButton>
          <ZButton type="primary" size="medium" :loading="loading" @click="saveAndRefresh">
            <RefreshCw :size="16" />
            刷新
          </ZButton>
        </div>
      </header>

      <div class="overview-grid">
        <article class="metric-card primary">
          <span>{{ primaryMetricLabel }}</span>
          <strong>{{ primaryMetricValue }}</strong>
          <p>{{ hasTokenUsage ? '所有配置的 api_key_ids 汇总' : '接口返回的 total_actual_cost 汇总' }}</p>
        </article>
        <article class="metric-card">
          <span>{{ hasTokenUsage ? 'Input' : 'Today Cost' }}</span>
          <strong>{{ hasTokenUsage ? formatNumber(usage?.summary.inputTokens || 0) : formatCurrency(usage?.summary.todayCost || 0) }}</strong>
          <p>{{ hasTokenUsage ? 'Prompt tokens' : 'today_actual_cost 汇总' }}</p>
        </article>
        <article class="metric-card">
          <span>{{ hasTokenUsage ? 'Output' : 'Keys' }}</span>
          <strong>{{ hasTokenUsage ? formatNumber(usage?.summary.outputTokens || 0) : formatNumber(usage?.records.length || 0) }}</strong>
          <p>{{ hasTokenUsage ? 'Completion tokens' : '已返回统计的 API Keys' }}</p>
        </article>
        <article class="metric-card">
          <span>Requests</span>
          <strong>{{ formatNumber(usage?.summary.requests || 0) }}</strong>
          <p>{{ fetchedAtText }}</p>
        </article>
      </div>

      <div class="content-grid">
        <section class="settings-pane">
          <div class="section-heading">
            <Settings :size="17" />
            <h2>配置</h2>
          </div>

          <label class="field">
            <span>域名</span>
            <ZInput v-model="config.baseUrl" clearable />
          </label>

          <label class="field">
            <span>authorization</span>
            <ZInput
              v-model="config.authorization"
              type="text"
              clearable
              placeholder="Bearer ... 或直接粘贴 token"
            />
          </label>

          <label class="field">
            <span>refresh_token</span>
            <div class="inline-control">
              <ZInput
                v-model="config.refreshToken"
                type="text"
                clearable
                placeholder="rt_...，401 时自动刷新并保存"
              />
              <button
                class="icon-button bordered"
                title="刷新 token 测试"
                :disabled="refreshingToken || !config.refreshToken"
                @click="testRefreshToken"
              >
                <RefreshCw :size="15" :class="{ spinning: refreshingToken }" />
              </button>
            </div>
          </label>

          <label class="field small">
            <span>自动刷新秒数</span>
            <ZInput v-model="config.autoRefreshSeconds" type="number" min="15" placeholder="60" />
          </label>

          <div class="keys-header">
            <span>api_key_ids</span>
            <button class="text-button" @click="addApiKey">
              <Plus :size="15" />
              添加
            </button>
          </div>

          <div class="key-list">
            <div v-for="(key, index) in config.apiKeys" :key="index" class="key-editor">
              <ZInput :model-value="String(key.id || '')" type="number" placeholder="1418" @update:model-value="normalizeKeyId(key, $event)" />
              <ZInput v-model="key.alias" clearable placeholder="别名，例如：主账号" />
              <button class="icon-button danger" title="删除" @click="removeApiKey(index)">
                <Trash2 :size="15" />
              </button>
            </div>
          </div>

          <div class="settings-actions">
            <ZButton :loading="saving" @click="saveConfig(true)">保存配置</ZButton>
            <ZButton type="primary" :loading="loading" @click="saveAndRefresh">保存并刷新</ZButton>
          </div>
        </section>

        <section class="usage-pane">
          <div class="section-heading">
            <ExternalLink :size="17" />
            <h2>API Key 用量</h2>
          </div>

          <div v-if="!usage?.records.length" class="empty-state">
            <Minus :size="22" />
            <span>{{ hasConfig ? '还没有用量数据' : '先填写 authorization 和 api_key_ids' }}</span>
          </div>

          <div v-else class="usage-list">
            <article v-for="record in usage.records" :key="record.id" class="usage-row">
              <div class="usage-main">
                <span>{{ record.alias }}</span>
                <strong>{{ hasTokenUsage ? formatNumber(record.tokens) : formatCurrency(record.cost) }}</strong>
              </div>
              <div class="usage-sub">
                <span>ID {{ record.id }}</span>
                <template v-if="hasTokenUsage">
                  <span>Input {{ formatNumber(record.inputTokens) }}</span>
                  <span>Output {{ formatNumber(record.outputTokens) }}</span>
                  <span>Requests {{ formatNumber(record.requests) }}</span>
                </template>
                <template v-else>
                  <span>Today {{ formatCurrency(record.todayCost) }}</span>
                  <span>Total {{ formatCurrency(record.cost) }}</span>
                </template>
              </div>
            </article>
          </div>
        </section>
      </div>
    </section>

    <Transition name="notice">
      <div v-if="notice" class="notice" :class="notice.type">{{ notice.text }}</div>
    </Transition>
  </main>
</template>
