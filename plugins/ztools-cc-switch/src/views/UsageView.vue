<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
const emit = defineEmits(['back', 'toast'])
const bridge = window.ccSwitch
const apiKey = '{{apiKey}}'; const baseUrl = '{{baseUrl}}'; const accessToken = '{{accessToken}}'; const userId = '{{userId}}'
const summary = ref({})
const logs = ref([])
const filter = ref('')
const tab = ref('local')
const quotas = ref([])
const codingPlanProviders = ref([])
const codingPlanQuotas = ref({})
const codingPlanBusy = ref('')
const balanceProviders = ref([])
const balances = ref({})
const balanceBusy = ref('')
const codingPlanModal = ref(false)
const codingPlanForm = ref({ providerId: '', providerName: '', type: '', codingPlanProvider: 'auto', accessKeyId: '', secretAccessKey: '', teamOrganizationId: '', teamProjectId: '' })
const providers = ref([])
const quotaLoading = ref(false)
const speedLoading = ref(false)
const speedResults = ref([])
const speedClient = ref('claude')
const endpointProviderId = ref('')
const endpointInput = ref('')
const customEndpoints = ref([])
const endpointResults = ref([])
const endpointBusy = ref(false)
const proxyTargetsOnly = ref(false)
const reachabilityConfig = ref({ timeoutSecs: 8, maxRetries: 1, degradedThresholdMs: 6000 })
const sources = ref([])
const syncingUsage = ref(false)
const rebuildingCodex = ref(false)
const localSection = ref('overview')
const range = ref('7d')
const trends = ref([])
const providerStats = ref([])
const modelStats = ref([])
const appStats = ref([])
const pricing = ref([])
const billingDefaults = ref({ claude: { multiplier: '1', source: 'response' }, codex: { multiplier: '1', source: 'response' }, gemini: { multiplier: '1', source: 'response' }, grokbuild: { multiplier: '1', source: 'response' } })
const billingBusy = ref(false)
const providerLimits = ref([])
const usageScripts = ref([])
const usageScriptResults = ref({})
const usageScriptBusy = ref('')
const usageScriptModal = ref(false)
const usageScriptTemplates = ref({})
const usageScriptForm = ref({ providerId: '', enabled: true, templateType: 'general', code: '', baseUrl: '', timeout: 10, autoQueryInterval: 0, apiKey: '', accessToken: '', userId: '', clearApiKey: false, clearAccessToken: false, clearUserId: false })
let usageScriptTimer = null
const selectedLog = ref(null)
const pricingModal = ref(false)
const pricingForm = ref({ modelId: '', displayName: '', inputCostPerMillion: '0', outputCostPerMillion: '0', cacheReadCostPerMillion: '0', cacheCreationCostPerMillion: '0' })
const analyticsFilters = computed(() => {
  const duration = ({ '1d': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 })[range.value]
  return { ...(duration ? { from: Date.now() - duration, to: Date.now() } : {}), ...(filter.value ? { client: filter.value } : {}) }
})
const visibleLogs = computed(() => filter.value ? logs.value.filter((item) => item.client === filter.value) : logs.value)
const chartMax = computed(() => Math.max(...trends.value.map((item) => item.totalTokens || 0), 1))
const chartPoints = computed(() => trends.value.map((item, index) => {
  const x = trends.value.length === 1 ? 400 : index * 800 / Math.max(trends.value.length - 1, 1)
  const y = 150 - (item.totalTokens || 0) / chartMax.value * 130
  return `${x.toFixed(1)},${y.toFixed(1)}`
}).join(' '))
async function load() {
  try {
    const filters = analyticsFilters.value
    const [nextSummary, nextLogs, usageStatus, nextTrends, nextProviders, nextModels, nextApps, nextPricing] = await Promise.all([
      bridge.getUsageSummary(filters), bridge.getRequestLogs(filters), bridge.getUsageImportStatus ? bridge.getUsageImportStatus() : { sources: [] },
      bridge.getUsageTrends?.(filters) || [], bridge.getProviderStats?.(filters) || [], bridge.getModelStats?.(filters) || [], bridge.getUsageSummaryByApp?.(filters) || [], bridge.getModelPricing?.() || []
    ])
    summary.value = nextSummary; logs.value = nextLogs; sources.value = usageStatus.sources || []; trends.value = nextTrends; providerStats.value = nextProviders; modelStats.value = nextModels; appStats.value = nextApps; pricing.value = nextPricing
    if (providers.value.length) await loadProviderLimits()
  }
  catch (error) { emit('toast', error.message, 'error') }
}
async function loadProviderLimits() {
  if (!bridge.checkProviderLimits) return
  const configured = providers.value.filter((provider) => String(provider.limitDailyUsd || '').trim() || String(provider.limitMonthlyUsd || '').trim())
  providerLimits.value = await Promise.all(configured.map(async (provider) => ({ provider, status: await bridge.checkProviderLimits(provider.id) })))
}
async function syncUsage(force = false) {
  syncingUsage.value = true
  try { const result = await bridge.syncSessionUsage({ force }); emit('toast', result.imported ? `从会话日志导入 ${result.imported} 条用量记录` : '会话用量已经是最新状态', result.errors?.length ? 'warning' : 'success'); await load() }
  catch (error) { emit('toast', error.message, 'error') }
  finally { syncingUsage.value = false }
}
async function rebuildCodexUsage() {
  let confirmed
  try { confirmed = bridge.confirmCodexUsageRebuild ? await bridge.confirmCodexUsageRebuild() : null }
  catch (error) { emit('toast', `无法打开 ZTools 确认框：${error.message}`, 'error'); return }
  if (confirmed === null && !window.confirm('只重建 Codex Session 用量？操作前会创建可恢复备份，其他数据来源不受影响。')) return
  if (confirmed === false) return
  rebuildingCodex.value = true
  try {
    const result = await bridge.rebuildCodexUsage()
    const backupText = result.backupsCreated ? `，已创建 ${result.backupsCreated} 份备份` : ''
    emit('toast', `Codex 用量已重建：移除 ${result.removed} 条，导入 ${result.imported} 条${backupText}`, result.errors?.length ? 'warning' : 'success')
    await load()
  }
  catch (error) { emit('toast', error.message, 'error') }
  finally { rebuildingCodex.value = false }
}
async function loadQuotas(force = false) {
  quotaLoading.value = true
  try {
    quotas.value = await bridge.getAllSubscriptionQuotas({ force })
    if (bridge.listCodingPlanProviders) {
      codingPlanProviders.value = await bridge.listCodingPlanProviders()
      await Promise.all(codingPlanProviders.value.map((provider) => queryCodingPlan(provider, false)))
    }
    if (bridge.listBalanceProviders) {
      balanceProviders.value = await bridge.listBalanceProviders()
      await Promise.all(balanceProviders.value.map((provider) => queryBalance(provider, false)))
    }
    if (bridge.listConfiguredUsageScripts) {
      usageScripts.value = await bridge.listConfiguredUsageScripts()
      await Promise.all(usageScripts.value.map((provider) => queryUsageScript(provider, false)))
      scheduleUsageScripts()
    }
  }
  catch (error) { emit('toast', error.message, 'error') }
  finally { quotaLoading.value = false }
}
async function queryUsageScript(provider, notify = true) {
  usageScriptBusy.value = provider.id
  try { const result = await bridge.queryProviderUsage(provider.id); usageScriptResults.value = { ...usageScriptResults.value, [provider.id]: result }; if (notify) emit('toast', `${provider.name} 用量已刷新`) }
  catch (error) { usageScriptResults.value = { ...usageScriptResults.value, [provider.id]: { success: false, data: [], error: error.message } }; if (notify) emit('toast', error.message, 'warning') }
  finally { usageScriptBusy.value = '' }
}
function scheduleUsageScripts() {
  if (usageScriptTimer) clearInterval(usageScriptTimer)
  const intervals = usageScripts.value.map((item) => Number(item.autoQueryInterval)).filter((value) => value > 0)
  if (!intervals.length) return
  const tick = Math.max(1, Math.min(...intervals))
  usageScriptTimer = setInterval(() => { const now = Date.now(); for (const item of usageScripts.value) { const interval = Number(item.autoQueryInterval) * 60000; const last = usageScriptResults.value[item.id]?.queriedAt || 0; if (interval && now - last >= interval) queryUsageScript(item, false) } }, tick * 60000)
}
async function openUsageScript(providerId = '') {
  const id = providerId || providers.value.find((item) => item.id !== 'claude-desktop-official')?.id || ''
  if (!id) return
  usageScriptTemplates.value = await bridge.getUsageScriptTemplates()
  const config = await bridge.getProviderUsageScript(id)
  usageScriptForm.value = { providerId: id, ...config, apiKey: '', accessToken: '', userId: '', clearApiKey: false, clearAccessToken: false, clearUserId: false }
  usageScriptModal.value = true
}
async function changeUsageScriptProvider() { await openUsageScript(usageScriptForm.value.providerId) }
function applyUsageTemplate() { usageScriptForm.value.code = usageScriptTemplates.value[usageScriptForm.value.templateType] || usageScriptForm.value.code }
async function testUsageScript() {
  usageScriptBusy.value = 'test'
  try { const result = await bridge.testProviderUsageScript(usageScriptForm.value.providerId, usageScriptForm.value); usageScriptResults.value = { ...usageScriptResults.value, [usageScriptForm.value.providerId]: result }; emit('toast', '用量脚本测试成功') }
  catch (error) { emit('toast', error.message, 'error') }
  finally { usageScriptBusy.value = '' }
}
async function saveUsageScript() {
  usageScriptBusy.value = 'save'
  try { await bridge.saveProviderUsageScript(usageScriptForm.value.providerId, usageScriptForm.value); usageScriptModal.value = false; usageScripts.value = await bridge.listConfiguredUsageScripts(); scheduleUsageScripts(); emit('toast', 'Provider 用量脚本已保存') }
  catch (error) { emit('toast', error.message, 'error') }
  finally { usageScriptBusy.value = '' }
}
async function queryBalance(provider, notify = true) {
  balanceBusy.value = provider.id
  try {
    const result = await bridge.queryProviderBalance(provider.id)
    balances.value = { ...balances.value, [provider.id]: result }
    if (notify) emit('toast', result.success ? `${provider.name} 余额已刷新` : result.error, result.success ? 'success' : 'warning')
  } catch (error) { if (notify) emit('toast', error.message, 'error') }
  finally { balanceBusy.value = '' }
}
async function queryCodingPlan(provider, notify = true) {
  codingPlanBusy.value = provider.id
  try {
    const quota = await bridge.queryCodingPlanQuota(provider.id)
    codingPlanQuotas.value = { ...codingPlanQuotas.value, [provider.id]: quota }
    if (notify) emit('toast', quota.success ? `${provider.name} 套餐额度已刷新` : (quota.error || '额度查询失败'), quota.success ? 'success' : 'warning')
  } catch (error) { if (notify) emit('toast', error.message, 'error') }
  finally { codingPlanBusy.value = '' }
}
function configureCodingPlan(provider) {
  codingPlanForm.value = { providerId: provider.id, providerName: provider.name, type: provider.type, codingPlanProvider: provider.codingPlanProvider || 'auto', accessKeyId: '', secretAccessKey: '', teamOrganizationId: '', teamProjectId: '' }
  codingPlanModal.value = true
}
async function saveCodingPlanConfig() {
  codingPlanBusy.value = 'save-config'
  try {
    await bridge.saveCodingPlanCredentials(codingPlanForm.value.providerId, codingPlanForm.value)
    codingPlanModal.value = false
    codingPlanProviders.value = await bridge.listCodingPlanProviders()
    const provider = codingPlanProviders.value.find((item) => item.id === codingPlanForm.value.providerId)
    emit('toast', 'Coding Plan 凭据已加密保存')
    if (provider) await queryCodingPlan(provider, false)
  } catch (error) { emit('toast', error.message, 'error') }
  finally { codingPlanBusy.value = '' }
}
async function runSpeedtest() {
  speedLoading.value = true
  try {
    const rows = await bridge.checkAllProviderReachability(speedClient.value, proxyTargetsOnly.value)
    speedResults.value = rows.map(([providerId, result]) => ({ providerId, ...result }))
    const failed = speedResults.value.filter((item) => !item.success).length
    emit('toast', `已完成 ${speedResults.value.length} 个 Provider 连通检测${failed ? `，${failed} 个不可达` : ''}`, failed ? 'warning' : 'success')
  } catch (error) { emit('toast', error.message, 'error') }
  finally { speedLoading.value = false }
}
const endpointProviders = computed(() => providers.value.filter((provider) => provider.clients?.includes(speedClient.value) && provider.id !== 'claude-desktop-official'))
async function loadCustomEndpoints() {
  endpointResults.value = []
  if (!endpointProviderId.value) { customEndpoints.value = []; return }
  try { customEndpoints.value = await bridge.getCustomEndpoints(speedClient.value, endpointProviderId.value) }
  catch (error) { emit('toast', error.message, 'error') }
}
async function addEndpoint() {
  try { customEndpoints.value = await bridge.addCustomEndpoint(speedClient.value, endpointProviderId.value, endpointInput.value); endpointInput.value = ''; emit('toast', '自定义端点已添加') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function removeEndpoint(url) {
  try { await bridge.removeCustomEndpoint(speedClient.value, endpointProviderId.value, url); await loadCustomEndpoints(); emit('toast', '自定义端点已移除') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function testCustomEndpoints() {
  const provider = providers.value.find((item) => item.id === endpointProviderId.value)
  if (!provider) return
  endpointBusy.value = true
  try { endpointResults.value = await bridge.testEndpoints([provider.baseUrl, ...customEndpoints.value.map((item) => item.url)], reachabilityConfig.value.timeoutSecs); emit('toast', `已完成 ${endpointResults.value.length} 个端点双请求测速`) }
  catch (error) { emit('toast', error.message, 'error') }
  finally { endpointBusy.value = false }
}
async function useEndpoint(url) {
  try { await bridge.selectCustomEndpoint(speedClient.value, endpointProviderId.value, url); const provider = providers.value.find((item) => item.id === endpointProviderId.value); if (provider) provider.baseUrl = url; await loadCustomEndpoints(); emit('toast', '已切换到该端点') }
  catch (error) { emit('toast', error.message, 'error') }
}
function changeSpeedClient() { endpointProviderId.value = ''; customEndpoints.value = []; endpointResults.value = [] }
async function saveReachabilityConfig() {
  try { reachabilityConfig.value = await bridge.saveConnectivityCheckConfig(reachabilityConfig.value); emit('toast', '连通检测配置已保存') }
  catch (error) { emit('toast', error.message, 'error') }
}
function tierLabel(name) { return ({ five_hour: '5 小时窗口', seven_day: '7 天窗口', '30_day': '30 天窗口', seven_day_opus: '7 天 Opus', seven_day_sonnet: '7 天 Sonnet', gemini_pro: 'Gemini Pro', gemini_flash: 'Gemini Flash', gemini_flash_lite: 'Gemini Flash Lite' })[name] || name.replaceAll('_', ' ') }
function codingPlanLabel(type) { return ({ kimi: 'Kimi Coding', zhipu_cn: '智谱 GLM', zhipu_en: 'Z.ai GLM', zhipu_team: '智谱团队版', minimax_cn: 'MiniMax CN', minimax_en: 'MiniMax Global', zenmux: 'ZenMux', volcengine: '火山方舟' })[type] || type }
function toolLabel(quota) { if (quota.tool === 'codex_oauth') return quota.accountLabel || 'Codex OAuth'; return ({ claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Gemini CLI' })[quota.tool] || quota.tool }
function quotaTone(value) { return value >= 90 ? 'critical' : value >= 70 ? 'warning' : 'healthy' }
async function clear() {
  if (!window.confirm('清空请求日志？现有日志会先移动为备份。')) return
  const result = await bridge.clearRequestLogs(); emit('toast', result.backupPath ? '日志已清空并保留备份' : '当前没有日志'); await load()
}
function formatNumber(value) { return Number(value || 0).toLocaleString() }
function formatCost(value, digits = 4) { return `$${Number(value || 0).toFixed(digits)}` }
function formatDateLabel(value) { const date = new Date(value); return range.value === '1d' ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { month: '2-digit', day: '2-digit' }) }
async function openRequest(item) {
  try { selectedLog.value = await bridge.getRequestDetail(item.id); if (!selectedLog.value) emit('toast', '请求详情不存在', 'warning') }
  catch (error) { emit('toast', error.message, 'error') }
}
function editPricing(item = null) {
  pricingForm.value = item ? { modelId: item.modelId, displayName: item.displayName, inputCostPerMillion: item.inputCostPerMillion, outputCostPerMillion: item.outputCostPerMillion, cacheReadCostPerMillion: item.cacheReadCostPerMillion, cacheCreationCostPerMillion: item.cacheCreationCostPerMillion } : { modelId: '', displayName: '', inputCostPerMillion: '0', outputCostPerMillion: '0', cacheReadCostPerMillion: '0', cacheCreationCostPerMillion: '0' }
  pricingModal.value = true
}
async function savePricing() {
  try { const result = await bridge.updateModelPricing(pricingForm.value); pricingModal.value = false; emit('toast', result.backfilled ? `定价已保存，并回填 ${result.backfilled} 条历史记录` : '模型定价已保存'); await load() }
  catch (error) { emit('toast', error.message, 'error') }
}
async function deletePricing(item) {
  if (!window.confirm(`删除 ${item.displayName} 的自定义定价？`)) return
  try { await bridge.deleteModelPricing(item.modelId); emit('toast', '自定义定价已删除'); await load() } catch (error) { emit('toast', error.message, 'error') }
}
async function loadBillingDefaults() {
  if (bridge.getBillingDefaults) billingDefaults.value = await bridge.getBillingDefaults()
}
async function saveBillingDefaults() {
  billingBusy.value = true
  try { billingDefaults.value = await bridge.saveBillingDefaults(billingDefaults.value); emit('toast', '应用级计费默认值已保存') }
  catch (error) { emit('toast', error.message, 'error') }
  finally { billingBusy.value = false }
}
onMounted(async () => { await Promise.all([load(), loadBillingDefaults()]); if (bridge.listProviders) { providers.value = (await bridge.listProviders()).providers; await loadProviderLimits() } if (bridge.getConnectivityCheckConfig) reachabilityConfig.value = await bridge.getConnectivityCheckConfig() })
onBeforeUnmount(() => { if (usageScriptTimer) clearInterval(usageScriptTimer) })
</script>
<template>
  <section class="settings-view extension-view">
    <header class="settings-heading"><button class="back-button" @click="$emit('back')">←</button><div><span class="eyebrow">USAGE / NETWORK TELEMETRY</span><h1>用量与健康</h1><p>本地请求、官方订阅窗口与 Provider 端点延迟。</p></div><button v-if="tab === 'local'" class="secondary-button heading-action" @click="clear">清理日志</button></header>
    <div class="segmented-tabs usage-tabs"><button :class="{ active: tab === 'local' }" @click="tab = 'local'">本地统计</button><button :class="{ active: tab === 'quota' }" @click="tab = 'quota'; quotas.length || loadQuotas()">订阅额度</button><button :class="{ active: tab === 'speed' }" @click="tab = 'speed'">端点测速</button></div>
    <template v-if="tab === 'local'">
      <div class="usage-command-bar"><div class="segmented-tabs"><button :class="{ active: localSection === 'overview' }" @click="localSection = 'overview'">概览</button><button :class="{ active: localSection === 'requests' }" @click="localSection = 'requests'">请求日志 <span>{{ logs.length }}</span></button><button :class="{ active: localSection === 'pricing' }" @click="localSection = 'pricing'">模型定价 <span>{{ pricing.length }}</span></button></div><div class="usage-scope"><select v-model="range" @change="load"><option value="1d">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="all">全部时间</option></select><select v-model="filter" @change="load"><option value="">全部应用</option><option v-for="client in ['claude','codex','gemini','grokbuild','opencode']" :key="client">{{ client }}</option></select><button class="secondary-button" @click="load">刷新</button></div></div>
      <template v-if="localSection === 'overview'">
        <div class="usage-metrics usage-metrics-five"><article><span>REQUESTS</span><strong>{{ formatNumber(summary.totalRequests ?? summary.requests) }}</strong></article><article><span>REAL TOKENS</span><strong>{{ formatNumber(summary.realTotalTokens) }}</strong></article><article><span>TOTAL COST</span><strong>{{ formatCost(summary.totalCost) }}</strong></article><article><span>SUCCESS</span><strong>{{ Math.round((summary.successRate || 0) * 100) }}%</strong></article><article><span>CACHE HIT</span><strong>{{ Math.round((summary.cacheHitRate || 0) * 100) }}%</strong></article></div>
        <div class="usage-source-bar"><div><span class="card-label">DATA SOURCES</span><p>本地路由与 CLI 会话日志使用稳定指纹合并，避免重复计数。</p></div><div class="source-chips"><span v-for="source in sources" :key="source.dataSource"><i />{{ source.dataSource }} <strong>{{ source.requestCount }}</strong></span></div><div class="usage-source-actions"><button class="secondary-button" :disabled="syncingUsage || rebuildingCodex" @click="syncUsage(false)"><span v-if="syncingUsage" class="spinner" />同步 Sessions</button><button class="secondary-button danger-outline" :disabled="syncingUsage || rebuildingCodex" @click="rebuildCodexUsage"><span v-if="rebuildingCodex" class="spinner" />{{ rebuildingCodex ? '重建中…' : '重建 Codex' }}</button></div></div>
        <div v-if="providerLimits.length" class="provider-limit-grid"><article v-for="item in providerLimits" :key="item.provider.id" :class="{ exceeded: item.status.dailyExceeded || item.status.monthlyExceeded }"><header><div><span class="card-label">SPEND GUARD</span><strong>{{ item.provider.name }}</strong></div><em>{{ item.status.dailyExceeded || item.status.monthlyExceeded ? 'LIMIT EXCEEDED' : `×${item.provider.costMultiplier || 1}` }}</em></header><div v-if="item.status.dailyLimit !== null"><span>今日</span><strong>{{ formatCost(item.status.dailyUsage) }} / {{ formatCost(item.status.dailyLimit) }}</strong><i><b :style="{ width: `${Math.min(100, Number(item.status.dailyUsage) / Math.max(Number(item.status.dailyLimit), .000001) * 100)}%` }" /></i></div><div v-if="item.status.monthlyLimit !== null"><span>本月</span><strong>{{ formatCost(item.status.monthlyUsage) }} / {{ formatCost(item.status.monthlyLimit) }}</strong><i><b :style="{ width: `${Math.min(100, Number(item.status.monthlyUsage) / Math.max(Number(item.status.monthlyLimit), .000001) * 100)}%` }" /></i></div></article></div>
        <article class="usage-trend-card"><header><div><span class="card-label">TOKEN / COST TREND</span><h2>使用趋势</h2></div><strong>{{ trends.length }} buckets</strong></header><div v-if="trends.length" class="trend-chart"><svg viewBox="0 0 800 170" preserveAspectRatio="none"><defs><linearGradient id="usageArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5eead4" stop-opacity=".24"/><stop offset="1" stop-color="#5eead4" stop-opacity="0"/></linearGradient></defs><polygon :points="`0,160 ${chartPoints} 800,160`" fill="url(#usageArea)"/><polyline :points="chartPoints" fill="none" stroke="#5eead4" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="trend-labels"><span v-for="item in trends" :key="item.date"><i :style="{ height: `${Math.max(4,(item.totalTokens || 0) / chartMax * 36)}px` }"/><small>{{ formatDateLabel(item.date) }}</small><strong>{{ formatNumber(item.totalTokens) }}</strong></span></div></div><div v-else class="log-empty">当前范围暂无趋势数据</div></article>
        <div class="usage-breakdown-grid">
          <article class="usage-stat-board"><header><span class="card-label">PROVIDERS</span><strong>{{ providerStats.length }}</strong></header><div v-for="item in providerStats.slice(0,8)" :key="item.providerId"><span><strong>{{ item.providerName || item.providerId }}</strong><small>{{ item.requestCount }} requests · {{ Math.round(item.successRate * 100) }}%</small></span><em>{{ formatCost(item.totalCost) }}</em></div><div v-if="!providerStats.length" class="log-empty">暂无 Provider 统计</div></article>
          <article class="usage-stat-board"><header><span class="card-label">MODELS</span><strong>{{ modelStats.length }}</strong></header><div v-for="item in modelStats.slice(0,8)" :key="item.model"><span><strong>{{ item.model }}</strong><small>{{ formatNumber(item.totalTokens) }} tokens · {{ item.requestCount }} requests</small></span><em>{{ formatCost(item.totalCost) }}</em></div><div v-if="!modelStats.length" class="log-empty">暂无模型统计</div></article>
        </div>
      </template>
      <template v-else-if="localSection === 'requests'">
        <div class="request-table detail-enabled"><div class="request-row request-head"><span>时间</span><span>应用 / Provider</span><span>模型</span><span>Token / 成本</span><span>延迟</span><span>状态</span></div><button v-for="item in visibleLogs" :key="item.id" class="request-row" @click="openRequest(item)"><span>{{ new Date(item.createdAt).toLocaleString() }}</span><span><strong>{{ item.client }}</strong><small>{{ item.providerName }}</small></span><span><strong>{{ item.pricingModel || item.model || '—' }}</strong><small v-if="item.requestModel">requested {{ item.requestModel }}</small></span><span><strong>{{ formatNumber(item.inputTokens + item.outputTokens + item.cacheReadTokens + item.cacheCreationTokens) }}</strong><small>{{ Number(item.totalCostUsd) ? formatCost(item.totalCostUsd,6) : '未定价' }}</small></span><span><strong>{{ item.latencyMs }} ms</strong><small v-if="item.firstTokenMs !== null">TTFT {{ item.firstTokenMs }} ms</small></span><span :class="{ ok: item.statusCode >= 200 && item.statusCode < 400, bad: item.statusCode >= 400 }">{{ item.statusCode }}</span></button><div v-if="!visibleLogs.length" class="log-empty">暂无请求日志</div></div>
      </template>
      <template v-else>
        <article class="app-billing-defaults">
          <header><div><span class="card-label">APP BILLING DEFAULTS</span><h2>应用级计费策略</h2><p>Provider 未设置覆盖值时使用；Claude Desktop 继承 Claude。</p></div><button class="primary-button" :disabled="billingBusy" @click="saveBillingDefaults">{{ billingBusy ? '保存中…' : '保存默认值' }}</button></header>
          <div class="app-billing-head"><span>应用</span><span>默认成本倍率</span><span>计价模型来源</span></div>
          <div v-for="app in ['claude','codex','gemini','grokbuild']" :key="app" class="app-billing-row"><strong>{{ ({claude:'Claude',codex:'Codex',gemini:'Gemini',grokbuild:'GrokBuild'})[app] }}</strong><input v-model="billingDefaults[app].multiplier" inputmode="decimal" min="0" /><select v-model="billingDefaults[app].source"><option value="response">响应模型</option><option value="request">请求 / 出站模型</option></select></div>
        </article>
        <div class="pricing-toolbar"><div><span class="card-label">USD / 1M TOKENS</span><p>新增价格后自动回填同模型的未定价历史记录。</p></div><button class="primary-button" @click="editPricing()">添加模型定价</button></div>
        <div class="pricing-table"><div class="pricing-row pricing-head"><span>模型</span><span>Input</span><span>Output</span><span>Cache Read</span><span>Cache Write</span><span /></div><div v-for="item in pricing" :key="item.modelId" class="pricing-row"><span><strong>{{ item.displayName }}</strong><small>{{ item.modelId }} · {{ item.builtin ? '内置' : '自定义' }}</small></span><code>{{ item.inputCostPerMillion }}</code><code>{{ item.outputCostPerMillion }}</code><code>{{ item.cacheReadCostPerMillion }}</code><code>{{ item.cacheCreationCostPerMillion }}</code><span><button class="icon-button" @click="editPricing(item)">✎</button><button v-if="!item.builtin" class="icon-button danger" @click="deletePricing(item)">×</button></span></div></div>
      </template>
    </template>
    <template v-else-if="tab === 'quota'">
      <div class="telemetry-toolbar"><div><span class="card-label">OFFICIAL RATE WINDOWS</span><p>读取 CLI 或认证中心已有 OAuth 凭据，不会在网页层展示 Token。</p></div><button class="secondary-button" :disabled="quotaLoading" @click="loadQuotas(true)"><span v-if="quotaLoading" class="spinner" />刷新额度</button></div>
      <div class="quota-grid">
        <article v-for="quota in quotas" :key="`${quota.tool}:${quota.accountId || ''}`" class="quota-card settings-card">
          <header><div><span class="card-label">{{ quota.tool.toUpperCase() }}</span><h2>{{ toolLabel(quota) }}</h2></div><span class="quota-credential" :class="quota.credentialStatus">{{ quota.credentialStatus.replace('_', ' ') }}</span></header>
          <div v-if="quota.success && quota.tiers.length" class="quota-tiers">
            <div v-for="tier in quota.tiers" :key="tier.name" class="quota-tier" :class="quotaTone(tier.utilization)"><div><strong>{{ tierLabel(tier.name) }}</strong><span>{{ Math.round(tier.utilization * 10) / 10 }}%</span></div><div class="quota-track"><i :style="{ width: `${Math.min(Math.max(tier.utilization, 0), 100)}%` }" /></div><small>{{ tier.resetsAt ? `重置 ${new Date(tier.resetsAt).toLocaleString()}` : '未提供重置时间' }}</small></div>
          </div>
          <div v-else class="quota-empty"><i /><strong>{{ quota.error || quota.credentialMessage || '未发现可查询的 OAuth 凭据' }}</strong><small>{{ quota.credentialStatus === 'not_found' ? '请先在对应 CLI 中完成官方登录。' : '检查登录状态后重新查询。' }}</small></div>
          <div v-if="quota.extraUsage?.isEnabled" class="extra-usage"><span>EXTRA USAGE</span><strong>{{ quota.extraUsage.usedCredits ?? 0 }} / {{ quota.extraUsage.monthlyLimit ?? '—' }} {{ quota.extraUsage.currency || '' }}</strong></div>
        </article>
      </div>
      <div v-if="balanceProviders.length" class="coding-plan-section balance-section">
        <header><div><span class="card-label">NATIVE PROVIDER BALANCE</span><h2>Provider 账户余额</h2><p>原生查询 DeepSeek、StepFun、SiliconFlow、OpenRouter 与 Novita；API Key 只在 Preload 请求中使用。</p></div><span>{{ balanceProviders.length }} ACCOUNTS</span></header>
        <div class="quota-grid balance-grid">
          <article v-for="provider in balanceProviders" :key="provider.id" class="quota-card balance-card settings-card">
            <header><div><span class="card-label">{{ provider.providerType.replace('_', ' ') }}</span><h2>{{ provider.name }}</h2></div><span class="quota-credential" :class="balances[provider.id]?.success ? 'valid' : 'not_found'">{{ balances[provider.id]?.success ? 'available' : 'check' }}</span></header>
            <div v-if="balances[provider.id]?.success && balances[provider.id]?.data?.length" class="balance-values"><div v-for="item in balances[provider.id].data" :key="`${item.planName}:${item.unit}`"><span>{{ item.planName || 'Balance' }}</span><strong>{{ Number(item.remaining || 0).toLocaleString(undefined,{maximumFractionDigits:4}) }} <small>{{ item.unit }}</small></strong><em v-if="item.total !== null && item.total !== undefined">used {{ item.used }} / total {{ item.total }}</em></div></div>
            <div v-else class="quota-empty"><i /><strong>{{ balances[provider.id]?.error || '等待查询余额' }}</strong><small>支持服务商官方余额 API。</small></div>
            <footer class="coding-plan-actions"><button class="secondary-button" :disabled="balanceBusy === provider.id" @click="queryBalance(provider)"><span v-if="balanceBusy === provider.id" class="spinner" />刷新余额</button></footer>
          </article>
        </div>
      </div>
      <div class="coding-plan-section usage-script-section">
        <header><div><span class="card-label">PROVIDER USAGE SCRIPTS</span><h2>自定义用量查询</h2><p>脚本在受限 Preload 上下文中生成请求并提取 JSON；凭据由 ZTools 安全存储保存。</p></div><button class="secondary-button" @click="openUsageScript()">配置脚本</button></header>
        <div v-if="usageScripts.length" class="quota-grid usage-script-grid">
          <article v-for="provider in usageScripts" :key="provider.id" class="quota-card usage-script-card settings-card">
            <header><div><span class="card-label">{{ provider.templateType.replace('_',' ') }}</span><h2>{{ provider.name }}</h2></div><span class="quota-credential" :class="usageScriptResults[provider.id]?.success ? 'valid' : 'not_found'">{{ usageScriptResults[provider.id]?.success ? 'available' : 'check' }}</span></header>
            <div v-if="usageScriptResults[provider.id]?.success" class="balance-values"><div v-for="(item,index) in usageScriptResults[provider.id].data" :key="index"><span>{{ item.planName || 'Usage' }}</span><strong>{{ item.remaining ?? '—' }} <small>{{ item.unit || '' }}</small></strong><em v-if="item.total !== null && item.total !== undefined">used {{ item.used ?? '—' }} / total {{ item.total }}</em><em v-if="item.extra">{{ item.extra }}</em></div></div>
            <div v-else class="quota-empty"><i /><strong>{{ usageScriptResults[provider.id]?.error || '等待查询' }}</strong><small>{{ provider.autoQueryInterval ? `每 ${provider.autoQueryInterval} 分钟自动刷新` : '仅手动查询' }}</small></div>
            <footer class="coding-plan-actions"><button class="secondary-button" :disabled="usageScriptBusy === provider.id" @click="queryUsageScript(provider)"><span v-if="usageScriptBusy === provider.id" class="spinner" />刷新</button><button class="secondary-button" @click="openUsageScript(provider.id)">编辑</button></footer>
          </article>
        </div>
        <div v-else class="log-empty">尚未启用 Provider 自定义用量脚本。</div>
      </div>
      <div v-if="codingPlanProviders.length" class="coding-plan-section">
        <header><div><span class="card-label">PROVIDER CODING PLANS</span><h2>编程套餐额度</h2><p>复用 Provider API Key；火山 AK/SK 与智谱团队标识由 ZTools 安全存储加密保存。</p></div><span>{{ codingPlanProviders.length }} PLANS</span></header>
        <div class="quota-grid coding-plan-grid">
          <article v-for="provider in codingPlanProviders" :key="provider.id" class="quota-card coding-plan-card settings-card">
            <header><div><span class="card-label">{{ codingPlanLabel(provider.type) }}</span><h2>{{ provider.name }}</h2></div><span class="quota-credential" :class="codingPlanQuotas[provider.id]?.credentialStatus || 'not_found'">{{ codingPlanQuotas[provider.id]?.credentialStatus || 'ready' }}</span></header>
            <div v-if="codingPlanQuotas[provider.id]?.success && codingPlanQuotas[provider.id]?.tiers?.length" class="quota-tiers">
              <div v-for="item in codingPlanQuotas[provider.id].tiers" :key="item.name" class="quota-tier" :class="quotaTone(item.utilization)"><div><strong>{{ tierLabel(item.name) }}</strong><span>{{ Math.round(item.utilization * 10) / 10 }}%</span></div><div class="quota-track"><i :style="{ width: `${Math.min(Math.max(item.utilization, 0), 100)}%` }" /></div><small>{{ item.resetsAt ? `重置 ${new Date(item.resetsAt).toLocaleString()}` : '未提供重置时间' }}<template v-if="item.maxValueUsd !== null && item.maxValueUsd !== undefined"> · ${{ item.usedValueUsd ?? 0 }} / ${{ item.maxValueUsd }}</template></small></div>
            </div>
            <div v-else class="quota-empty"><i /><strong>{{ codingPlanQuotas[provider.id]?.error || '等待查询套餐额度' }}</strong><small>{{ provider.type === 'volcengine' ? '火山控制面需要独立 AK/SK。' : provider.type === 'zhipu_team' ? '团队版需要组织与项目 ID。' : '使用该 Provider 已保存的 API Key 查询。' }}</small></div>
            <footer class="coding-plan-actions"><button class="secondary-button" :disabled="codingPlanBusy === provider.id" @click="queryCodingPlan(provider)"><span v-if="codingPlanBusy === provider.id" class="spinner" />刷新</button><button v-if="provider.type === 'volcengine' || provider.type.startsWith('zhipu')" class="secondary-button" @click="configureCodingPlan(provider)">凭据设置</button></footer>
          </article>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="telemetry-toolbar reachability-toolbar"><div><span class="card-label">BASE URL REACHABILITY / TTFB</span><p>只向 Base URL 发送无鉴权 GET；任意 HTTP 响应均视为可达，不发送模型请求、不改变熔断状态。</p></div><div class="reachability-actions"><select v-model="speedClient" @change="changeSpeedClient"><option v-for="client in ['claude','claude-desktop','codex','gemini','grokbuild','opencode','openclaw','hermes']" :key="client">{{ client }}</option></select><label><input v-model="proxyTargetsOnly" type="checkbox" /> 仅当前与故障转移目标</label><button class="primary-button" :disabled="speedLoading" @click="runSpeedtest"><span v-if="speedLoading" class="spinner" />检测 Provider</button></div></div>
      <article class="reachability-config settings-card"><header><div><span class="card-label">CHECK PARAMETERS</span><h2>连通检测参数</h2></div><button class="secondary-button" @click="saveReachabilityConfig">保存参数</button></header><div><label>超时（秒）<input v-model.number="reachabilityConfig.timeoutSecs" type="number" min="2" max="60" /></label><label>超时重试<input v-model.number="reachabilityConfig.maxRetries" type="number" min="0" max="5" /></label><label>较慢阈值（ms）<input v-model.number="reachabilityConfig.degradedThresholdMs" type="number" min="1000" max="30000" step="1000" /></label></div></article>
      <article class="endpoint-console settings-card">
        <header><div><span class="card-label">CUSTOM ENDPOINT MATRIX</span><h2>Provider 自定义端点</h2><p>管理候选地址，执行一次热身 + 一次计时请求，并可把最佳端点应用到当前 Provider。</p></div><div><select v-model="endpointProviderId" @change="loadCustomEndpoints"><option value="">选择 Provider</option><option v-for="provider in endpointProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option></select><button class="secondary-button" :disabled="!endpointProviderId || endpointBusy" @click="testCustomEndpoints"><span v-if="endpointBusy" class="spinner" />双请求测速</button></div></header>
        <form @submit.prevent="addEndpoint"><input v-model="endpointInput" type="url" :disabled="!endpointProviderId" placeholder="https://edge.example.com/v1" required /><button class="secondary-button" :disabled="!endpointProviderId">添加端点</button></form>
        <div v-if="endpointProviderId" class="endpoint-list"><div v-for="row in [{ url: providers.find((item) => item.id === endpointProviderId)?.baseUrl, builtin: true }, ...customEndpoints]" :key="row.url"><i :class="{ active: row.url === providers.find((item) => item.id === endpointProviderId)?.baseUrl }"/><code><strong>{{ row.url }}</strong><small>{{ row.builtin ? '当前 Base URL' : `添加于 ${new Date(row.addedAt).toLocaleString()}${row.lastUsed ? ` · 最近使用 ${new Date(row.lastUsed).toLocaleString()}` : ''}` }}</small></code><span>{{ endpointResults.find((item) => item.url === row.url)?.status ?? '—' }}</span><em>{{ endpointResults.find((item) => item.url === row.url)?.latency !== null && endpointResults.find((item) => item.url === row.url)?.latency !== undefined ? `${endpointResults.find((item) => item.url === row.url).latency} ms` : '—' }}</em><button class="secondary-button" @click="useEndpoint(row.url)">使用</button><button v-if="!row.builtin" class="icon-button danger" @click="removeEndpoint(row.url)">×</button></div><p v-if="!customEndpoints.length" class="log-empty">尚未添加自定义端点；当前 Base URL 仍可参与测速。</p></div>
      </article>
      <div class="speed-board request-table"><div class="speed-row request-head"><span>Provider / Base URL</span><span>HTTP</span><span>TTFB</span><span>状态</span></div><div v-for="item in speedResults" :key="item.providerId" class="speed-row"><code><strong>{{ item.providerName || item.providerId }}</strong><small>{{ providers.find((provider) => provider.id === item.providerId)?.baseUrl }}</small></code><span>{{ item.httpStatus ?? '—' }}</span><strong :class="{ fast: item.responseTimeMs !== null && item.responseTimeMs <= reachabilityConfig.degradedThresholdMs, slow: item.status === 'degraded' }">{{ item.responseTimeMs === null ? '—' : `${item.responseTimeMs} ms` }}</strong><span :class="item.success ? item.status === 'degraded' ? 'warning' : 'ok' : 'bad'">{{ item.success ? item.status === 'degraded' ? '可达但较慢' : '可达' : item.message }}</span></div><div v-if="!speedResults.length" class="log-empty">选择应用后检测 Provider Base URL 可达性</div></div>
    </template>
    <div v-if="selectedLog" class="modal-backdrop" @click.self="selectedLog = null"><section class="provider-modal request-detail-modal"><header class="modal-header"><div><span class="eyebrow">REQUEST TRACE</span><h2>请求详情</h2><p>{{ selectedLog.requestId || selectedLog.id }}</p></div><button class="icon-button" @click="selectedLog = null">×</button></header><div class="request-detail-body"><article><span class="card-label">BASIC INFO</span><dl><div><dt>时间</dt><dd>{{ new Date(selectedLog.createdAt).toLocaleString() }}</dd></div><div><dt>应用</dt><dd>{{ selectedLog.appType || selectedLog.client }}</dd></div><div><dt>Provider</dt><dd>{{ selectedLog.providerName || selectedLog.providerId }}</dd></div><div><dt>状态</dt><dd :class="selectedLog.statusCode < 400 ? 'ok' : 'bad'">HTTP {{ selectedLog.statusCode }}</dd></div><div><dt>请求模型</dt><dd>{{ selectedLog.requestModel || '—' }}</dd></div><div><dt>响应 / 计价模型</dt><dd>{{ selectedLog.model || '—' }} / {{ selectedLog.pricingModel || '未定价' }}</dd></div></dl></article><article><span class="card-label">TOKENS</span><dl><div><dt>Input</dt><dd>{{ formatNumber(selectedLog.inputTokens) }}</dd></div><div><dt>Output</dt><dd>{{ formatNumber(selectedLog.outputTokens) }}</dd></div><div><dt>Cache Read</dt><dd>{{ formatNumber(selectedLog.cacheReadTokens) }}</dd></div><div><dt>Cache Write</dt><dd>{{ formatNumber(selectedLog.cacheCreationTokens) }}</dd></div></dl></article><article><span class="card-label">COST BREAKDOWN</span><dl><div><dt>Input</dt><dd>{{ formatCost(selectedLog.inputCostUsd,6) }}</dd></div><div><dt>Output</dt><dd>{{ formatCost(selectedLog.outputCostUsd,6) }}</dd></div><div><dt>Cache Read</dt><dd>{{ formatCost(selectedLog.cacheReadCostUsd,6) }}</dd></div><div><dt>Cache Write</dt><dd>{{ formatCost(selectedLog.cacheCreationCostUsd,6) }}</dd></div><div><dt>Multiplier</dt><dd>×{{ selectedLog.costMultiplier }}</dd></div><div><dt>Total</dt><dd class="cost-accent">{{ Number(selectedLog.totalCostUsd) ? formatCost(selectedLog.totalCostUsd,6) : '未定价' }}</dd></div></dl></article><article><span class="card-label">PERFORMANCE</span><dl><div><dt>Latency</dt><dd>{{ selectedLog.latencyMs }} ms</dd></div><div><dt>First Token</dt><dd>{{ selectedLog.firstTokenMs === null ? '—' : `${selectedLog.firstTokenMs} ms` }}</dd></div><div><dt>Streaming</dt><dd>{{ (selectedLog.isStreaming ?? selectedLog.streaming) ? 'yes' : 'no' }}</dd></div><div><dt>Source</dt><dd>{{ selectedLog.dataSource }}</dd></div></dl><p v-if="selectedLog.errorMessage" class="request-error">{{ selectedLog.errorMessage }}</p></article></div></section></div>
    <div v-if="pricingModal" class="modal-backdrop" @click.self="pricingModal = false"><section class="provider-modal pricing-modal"><header class="modal-header"><div><span class="eyebrow">MODEL PRICING</span><h2>{{ pricingForm.modelId ? '编辑模型定价' : '添加模型定价' }}</h2><p>所有价格单位均为 USD / 1M Tokens。</p></div><button class="icon-button" @click="pricingModal = false">×</button></header><form @submit.prevent="savePricing"><div class="form-grid two-columns"><label class="field"><span>模型 ID</span><input v-model="pricingForm.modelId" required placeholder="vendor/model-id" /></label><label class="field"><span>显示名称</span><input v-model="pricingForm.displayName" required /></label><label class="field"><span>Input</span><input v-model="pricingForm.inputCostPerMillion" required inputmode="decimal" /></label><label class="field"><span>Output</span><input v-model="pricingForm.outputCostPerMillion" required inputmode="decimal" /></label><label class="field"><span>Cache Read</span><input v-model="pricingForm.cacheReadCostPerMillion" required inputmode="decimal" /></label><label class="field"><span>Cache Write</span><input v-model="pricingForm.cacheCreationCostPerMillion" required inputmode="decimal" /></label></div><div class="modal-actions"><button type="button" class="secondary-button" @click="pricingModal = false">取消</button><button class="primary-button">保存并回填</button></div></form></section></div>
    <div v-if="usageScriptModal" class="modal-backdrop" @click.self="usageScriptModal = false"><section class="provider-modal usage-script-modal"><header class="modal-header"><div><span class="eyebrow">RESTRICTED USAGE RUNTIME</span><h2>Provider 用量脚本</h2><p>请求由 Preload 执行；脚本无法直接访问 Node.js 或 ZTools API。</p></div><button class="icon-button" @click="usageScriptModal = false">×</button></header><form @submit.prevent="saveUsageScript"><div class="form-grid two-columns"><label class="field"><span>Provider</span><select v-model="usageScriptForm.providerId" @change="changeUsageScriptProvider"><option v-for="provider in providers.filter((item)=>item.id!=='claude-desktop-official')" :key="provider.id" :value="provider.id">{{ provider.name }}</option></select></label><label class="field"><span>模板</span><select v-model="usageScriptForm.templateType" @change="applyUsageTemplate"><option value="custom">自定义</option><option value="general">通用余额</option><option value="new_api">New API</option></select></label><label class="field"><span>Base URL（可选覆盖）</span><input v-model="usageScriptForm.baseUrl" type="url" placeholder="留空使用 Provider Base URL" /></label><label class="field"><span>API Key</span><input v-model="usageScriptForm.apiKey" type="password" autocomplete="new-password" :placeholder="usageScriptForm.hasApiKey ? '已安全保存，留空保持' : '留空使用 Provider API Key'" /></label><label class="field"><span>Access Token</span><input v-model="usageScriptForm.accessToken" type="password" autocomplete="new-password" :placeholder="usageScriptForm.hasAccessToken ? '已安全保存，留空保持' : 'New API 可选'" /></label><label class="field"><span>User ID</span><input v-model="usageScriptForm.userId" type="password" autocomplete="new-password" :placeholder="usageScriptForm.hasUserId ? '已安全保存，留空保持' : 'New API 可选'" /></label><label class="field"><span>超时（秒）</span><input v-model.number="usageScriptForm.timeout" type="number" min="2" max="30" /></label><label class="field"><span>自动查询间隔（分钟）</span><input v-model.number="usageScriptForm.autoQueryInterval" type="number" min="0" max="1440" /><small>0 表示仅手动刷新。</small></label></div><label class="toggle-row"><span><strong>启用用量查询</strong><small>启用后显示在订阅额度页。</small></span><input v-model="usageScriptForm.enabled" type="checkbox" /></label><label class="field usage-script-code"><span>请求与提取脚本</span><textarea v-model="usageScriptForm.code" spellcheck="false" required /></label><div class="secure-note"><i>◆</i><div><strong>{{ usageScriptForm.secureStorage ? '系统安全存储可用' : '系统安全存储降级' }}</strong><p>支持变量：{{apiKey}}、{{baseUrl}}、{{accessToken}}、{{userId}}；非自定义模板强制 HTTPS 同源。</p></div></div><div class="modal-actions"><button type="button" class="secondary-button" :disabled="usageScriptBusy === 'test'" @click="testUsageScript"><span v-if="usageScriptBusy === 'test'" class="spinner" />测试脚本</button><button type="button" class="secondary-button" @click="usageScriptModal = false">取消</button><button class="primary-button" :disabled="usageScriptBusy === 'save'">保存配置</button></div></form></section></div>
    <div v-if="codingPlanModal" class="modal-backdrop coding-plan-backdrop" @click.self="codingPlanModal = false"><section class="provider-modal coding-plan-modal"><header class="modal-header"><div><span class="eyebrow">SECURE PLAN CREDENTIALS</span><h2>{{ codingPlanForm.providerName }}</h2><p>敏感值保存在 ZTools 隔离存储，网页层无法再次读取。</p></div><button class="icon-button" @click="codingPlanModal = false">×</button></header><form @submit.prevent="saveCodingPlanConfig"><label v-if="codingPlanForm.type.startsWith('zhipu')" class="field"><span>套餐模式</span><select v-model="codingPlanForm.codingPlanProvider"><option value="auto">个人版（自动）</option><option value="zhipu_team">团队版</option></select></label><template v-if="codingPlanForm.codingPlanProvider === 'zhipu_team'"><label class="field"><span>Organization ID</span><input v-model="codingPlanForm.teamOrganizationId" autocomplete="off" placeholder="留空则保留已保存值" /></label><label class="field"><span>Project ID</span><input v-model="codingPlanForm.teamProjectId" autocomplete="off" placeholder="留空则保留已保存值" /></label></template><template v-if="codingPlanForm.type === 'volcengine'"><label class="field"><span>AccessKey ID</span><input v-model="codingPlanForm.accessKeyId" autocomplete="off" placeholder="留空则保留已保存值" /></label><label class="field"><span>Secret AccessKey</span><input v-model="codingPlanForm.secretAccessKey" type="password" autocomplete="new-password" placeholder="留空则保留已保存值" /></label></template><div class="secure-note"><i>◆</i><div><strong>安全存储</strong><p>火山控制面凭据不同于推理 API Key；智谱团队模式还需要组织和项目标识。</p></div></div><div class="modal-actions"><button type="button" class="secondary-button" @click="codingPlanModal = false">取消</button><button class="primary-button" :disabled="codingPlanBusy === 'save-config'">保存并查询</button></div></form></section></div>
  </section>
</template>
