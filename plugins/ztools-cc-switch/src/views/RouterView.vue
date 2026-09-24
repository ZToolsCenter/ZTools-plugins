<script setup>
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps({
  client: { type: Object, required: true },
  clients: { type: Array, default: () => [] }
})
const emit = defineEmits(['back', 'toast', 'routing-change'])
const bridge = window.ccSwitch
const status = ref({ running: false, config: { routes: {}, rectifier: {}, optimizer: {}, copilotOptimizer: {} } })
const routeBusy = ref(false)
const providers = ref([])
const routerClients = ['claude', 'codex', 'gemini', 'opencode', 'openclaw', 'hermes', 'grokbuild']
const selectedClientId = computed(() => routerClients.includes(props.client.id) ? props.client.id : 'claude')
const selectedClient = computed(() => props.clients.find((item) => item.id === selectedClientId.value) || props.client)
const routeEnabled = computed(() => Boolean(status.value.config.routes?.[selectedClientId.value]))
const routeUrl = computed(() => {
  const origin = status.value.url || 'http://127.0.0.1:15721'
  const suffix = ({ codex: '/v1', opencode: '/opencode/v1', openclaw: '/openclaw/v1', hermes: '/hermes/v1', grokbuild: '/grokbuild/v1' })[selectedClientId.value] || ''
  return `${origin}${suffix}`
})
const failoverClient = ref(selectedClientId.value)
const failoverQueue = ref([])
const failoverAvailable = ref([])
const failoverSelection = ref('')
const healthRows = computed(() => providers.value.filter((item) => item.clients?.includes(selectedClientId.value)).map((provider) => ({ provider, stats: status.value.circuitBreakers?.find((item) => item.client === selectedClientId.value && item.providerId === provider.id) || { state: 'closed', totalRequests: 0, failedRequests: 0, errorRate: 0, consecutiveFailures: 0 } })))

async function load() {
  try { const [nextStatus, data] = await Promise.all([bridge.getRouterStatus(), bridge.listProviders()]); status.value = nextStatus; providers.value = data.providers || []; await loadFailoverQueue() }
  catch (error) { emit('toast', error.message, 'error') }
}
async function loadFailoverQueue() {
  const [queue, available] = await Promise.all([bridge.getFailoverQueue(failoverClient.value), bridge.getAvailableProvidersForFailover(failoverClient.value)])
  failoverQueue.value = queue; failoverAvailable.value = available
  failoverSelection.value = available[0]?.providerId || ''
}
async function toggleFailover(client, enabled) {
  try {
    const result = await bridge.setAutoFailoverEnabled(client, enabled)
    status.value = { ...status.value, config: result.config }
    if (client === failoverClient.value) await loadFailoverQueue()
    emit('toast', `${client} 自动故障转移已${enabled ? '开启' : '关闭'}${enabled && result.queue.length === 1 ? '，当前 Provider 已加入 P1' : ''}`)
  } catch (error) { emit('toast', error.message, 'error') }
}
async function addFailoverProvider() {
  if (!failoverSelection.value) return
  try { await bridge.addToFailoverQueue(failoverClient.value, failoverSelection.value); await loadFailoverQueue(); emit('toast', 'Provider 已加入故障转移队列') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function removeFailoverProvider(providerId) {
  try { await bridge.removeFromFailoverQueue(failoverClient.value, providerId); await loadFailoverQueue(); emit('toast', 'Provider 已移出故障转移队列') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function save(patch) {
  try {
    const config = await bridge.saveRouterConfig(patch)
    status.value = { ...status.value, config, url: `http://${config.host}:${config.port}` }
    emit('toast', '路由配置已保存')
  } catch (error) { emit('toast', error.message, 'error') }
}
async function toggleRoute(client, enabled) {
  routeBusy.value = true
  try {
    const result = await bridge.setRouterRoute(client, enabled)
    status.value = result.status
    emit('routing-change', { client, enabled })
    emit('toast', enabled
      ? `${selectedClient.value.name} 已接管${result.autoStarted ? '，路由引擎已自动启动' : ''}`
      : `${selectedClient.value.name} 已恢复直连${result.autoStopped ? '，没有其他路由后引擎已自动停止' : ''}`)
  } catch (error) { emit('toast', error.message, 'error') }
  finally { routeBusy.value = false }
}
async function resetBreaker(providerId) {
  try { await bridge.resetCircuitBreaker(selectedClientId.value, providerId); await load(); emit('toast', 'Provider 熔断器已复位') }
  catch (error) { emit('toast', error.message, 'error') }
}
watch(failoverClient, () => loadFailoverQueue().catch((error) => emit('toast', error.message, 'error')))
watch(selectedClientId, (client) => { failoverClient.value = client; load().catch((error) => emit('toast', error.message, 'error')) })
onMounted(load)
</script>

<template>
  <section class="settings-view extension-view">
    <header class="settings-heading">
      <button class="back-button" @click="$emit('back')">←</button>
      <div><span class="eyebrow">{{ selectedClient.name.toUpperCase() }} / LOCAL ROUTE</span><h1>{{ selectedClient.name }} 路由</h1><p>当前客户端独立接管、故障转移与请求整流。</p></div>
      <span class="router-engine-state" :class="{ running: status.running }"><i />{{ status.running ? '共享引擎运行中' : '按需自动启动' }}</span>
    </header>
    <div class="router-hero" :class="{ running: status.running }">
      <i /><div><span>{{ routeEnabled ? `${selectedClient.name.toUpperCase()} ROUTE ONLINE` : status.running ? 'ENGINE READY / ROUTE OFF' : 'ROUTER OFFLINE' }}</span><strong>{{ routeUrl }}</strong></div>
      <dl><div><dt>连接</dt><dd>{{ status.activeConnections || 0 }}</dd></div><div><dt>请求</dt><dd>{{ status.requestCount || 0 }}</dd></div><div><dt>运行</dt><dd>{{ Math.round((status.uptimeMs || 0) / 1000) }}s</dd></div></dl>
      <label
        class="router-client-toggle"
        :class="{ active: routeEnabled, busy: routeBusy }"
        :title="routeEnabled ? `关闭 ${selectedClient.name} 接管` : `开启 ${selectedClient.name} 接管`"
      >
        <span><strong>{{ routeEnabled ? '已接管' : '开启接管' }}</strong><small>{{ selectedClient.name }}</small></span>
        <input type="checkbox" :checked="routeEnabled" :disabled="routeBusy" @change="toggleRoute(selectedClientId, $event.target.checked)" />
      </label>
    </div>
    <div class="settings-grid">
      <article class="settings-card">
        <span class="card-label">LISTEN</span><h2>监听与日志</h2>
        <div class="compact-fields">
          <label>地址<select :value="status.config.host" disabled><option>127.0.0.1</option></select><small>仅允许本机访问</small></label>
          <label>端口<input type="number" :value="status.config.port" :disabled="status.running" @change="save({ port: Number($event.target.value) })" /></label>
        </div>
        <label class="toggle-row"><span><strong>请求日志</strong><small>记录 Token、延迟与状态码</small></span><input type="checkbox" :checked="status.config.logging" @change="save({ logging: $event.target.checked })" /></label>
      </article>
      <article class="settings-card rectifier-card">
        <span class="card-label">THINKING RECTIFIER</span><h2>思考预算整流器</h2>
        <label class="toggle-row"><span><strong>启用整流</strong><small>约束 thinking budget 不超过输出上限</small></span><input type="checkbox" :checked="status.config.rectifier?.enabled" @change="save({ rectifier: { enabled: $event.target.checked } })" /></label>
        <label class="toggle-row"><span><strong>自动注入 Thinking</strong><small>请求未提供时添加默认预算</small></span><input type="checkbox" :checked="status.config.rectifier?.injectThinking" @change="save({ rectifier: { injectThinking: $event.target.checked } })" /></label>
        <div class="compact-fields"><label>默认预算<input type="number" :value="status.config.rectifier?.defaultThinkingBudget" @change="save({ rectifier: { defaultThinkingBudget: Number($event.target.value) } })" /></label><label>输出上限<input type="number" :value="status.config.rectifier?.maxOutputTokens" @change="save({ rectifier: { maxOutputTokens: Number($event.target.value) } })" /></label></div>
      </article>
      <article class="settings-card optimizer-card">
        <span class="card-label">BEDROCK REQUEST OPTIMIZER</span><h2>Bedrock 请求优化器</h2><p>仅作用于 Provider 编辑器中明确标记为 AWS Bedrock 的路由。</p>
        <label class="toggle-row"><span><strong>启用优化</strong><small>Provider 级别、故障转移尝试间完全隔离</small></span><input type="checkbox" :checked="status.config.optimizer?.enabled" @change="save({ optimizer: { enabled: $event.target.checked } })" /></label>
        <label class="toggle-row"><span><strong>Thinking Optimizer</strong><small>Haiku 跳过，新模型 Adaptive，旧模型使用 max_tokens - 1</small></span><input type="checkbox" :checked="status.config.optimizer?.thinkingOptimizer" @change="save({ optimizer: { thinkingOptimizer: $event.target.checked } })" /></label>
        <label class="toggle-row"><span><strong>Prompt Cache Injection</strong><small>Tools、System 与消息中最多注入四个 ephemeral 断点</small></span><input type="checkbox" :checked="status.config.optimizer?.cacheInjection" @change="save({ optimizer: { cacheInjection: $event.target.checked } })" /></label>
      </article>
      <article class="settings-card copilot-optimizer-card">
        <span class="card-label">COPILOT QUOTA OPTIMIZER</span><h2>GitHub Copilot 优化器</h2><p>按上游请求管道降低工具续写、子代理和 Warmup 对 Premium 配额的额外消耗。</p>
        <label class="toggle-row"><span><strong>启用优化</strong><small>默认开启，仅作用于 Copilot 托管账号</small></span><input type="checkbox" :checked="status.config.copilotOptimizer?.enabled" @change="save({ copilotOptimizer: { enabled: $event.target.checked } })" /></label>
        <div class="optimizer-toggle-grid"><label v-for="item in [{k:'requestClassification',n:'请求分类'},{k:'toolResultMerging',n:'Tool Result 合并'},{k:'compactDetection',n:'Compact 检测'},{k:'deterministicRequestId',n:'稳定 Request ID'},{k:'subagentDetection',n:'Subagent 检测'},{k:'warmupDowngrade',n:'Warmup 降级'},{k:'stripThinking',n:'剥离 Thinking'}]" :key="item.k"><span>{{ item.n }}</span><input type="checkbox" :checked="status.config.copilotOptimizer?.[item.k]" @change="save({ copilotOptimizer: { [item.k]: $event.target.checked } })" /></label></div>
        <label class="optimizer-model">Warmup 模型<input :value="status.config.copilotOptimizer?.warmupModel" @change="save({ copilotOptimizer: { warmupModel: $event.target.value } })" /></label>
      </article>
      <article class="settings-card failover-card">
        <span class="card-label">{{ selectedClientId.toUpperCase() }} / AUTOMATIC FAILOVER</span><h2>{{ selectedClient.name }} 故障转移</h2><p>只在当前客户端的显式队列中按 P1 → Pn 重试；关闭不会清空队列。</p>
        <label class="toggle-row"><span><strong>启用 {{ selectedClient.name }} 自动故障转移</strong><small>需要当前客户端路由已接管</small></span><input type="checkbox" :checked="status.config.failover?.enabled?.[selectedClientId]" @change="toggleFailover(selectedClientId, $event.target.checked)" /></label>
        <div class="failover-queue-console">
          <header><strong>{{ selectedClient.name }} QUEUE</strong><div><select v-model="failoverSelection" :disabled="!failoverAvailable.length"><option value="">{{ failoverAvailable.length ? '选择 Provider' : '没有可添加项' }}</option><option v-for="item in failoverAvailable" :key="item.providerId" :value="item.providerId">{{ item.name }}</option></select><button class="secondary-button" :disabled="!failoverSelection" @click="addFailoverProvider">加入</button></div></header>
          <div v-if="failoverQueue.length" class="failover-queue-list"><article v-for="item in failoverQueue" :key="item.providerId" class="failover-queue-row"><b>P{{ item.priority }}</b><i :style="{ background: item.color }"/><span><strong>{{ item.name }}</strong><small>{{ item.model || 'Client default' }}</small></span><button class="icon-button danger" title="移出故障转移队列" @click="removeFailoverProvider(item.providerId)">×</button></article></div>
          <p v-else class="failover-empty">队列为空；开启时会自动把当前 Provider 加为 P1。</p>
        </div>
      </article>
      <article class="settings-card breaker-config-card">
        <span class="card-label">CIRCUIT BREAKER</span><h2>熔断与恢复策略</h2>
        <div class="breaker-fields"><label>连续失败阈值<input type="number" min="1" max="100" :value="status.config.failover?.circuitBreaker?.failureThreshold" @change="save({ failover: { circuitBreaker: { failureThreshold: Number($event.target.value) } } })" /></label><label>半开成功阈值<input type="number" min="1" max="100" :value="status.config.failover?.circuitBreaker?.successThreshold" @change="save({ failover: { circuitBreaker: { successThreshold: Number($event.target.value) } } })" /></label><label>恢复等待（秒）<input type="number" min="1" max="3600" :value="status.config.failover?.circuitBreaker?.timeoutSeconds" @change="save({ failover: { circuitBreaker: { timeoutSeconds: Number($event.target.value) } } })" /></label><label>错误率阈值<input type="number" min="0.01" max="1" step="0.05" :value="status.config.failover?.circuitBreaker?.errorRateThreshold" @change="save({ failover: { circuitBreaker: { errorRateThreshold: Number($event.target.value) } } })" /></label><label>最小请求数<input type="number" min="1" max="10000" :value="status.config.failover?.circuitBreaker?.minRequests" @change="save({ failover: { circuitBreaker: { minRequests: Number($event.target.value) } } })" /></label></div>
      </article>
      <article class="settings-card breaker-health-card">
        <header><div><span class="card-label">{{ selectedClientId.toUpperCase() }} / PROVIDER HEALTH</span><h2>{{ selectedClient.name }} 实时熔断状态</h2></div></header>
        <div class="breaker-health-list"><div v-for="row in healthRows" :key="row.provider.id"><i :class="row.stats.state"/><span><strong>{{ row.provider.name }}</strong><small>{{ row.stats.totalRequests }} req · {{ Math.round(row.stats.errorRate * 100) }}% error · {{ row.stats.consecutiveFailures }} consecutive</small></span><em :class="row.stats.state">{{ row.stats.state }}</em><button class="icon-button" title="复位熔断器" @click="resetBreaker(row.provider.id)">↻</button></div><p v-if="!healthRows.length">当前应用没有 Provider。</p></div>
      </article>
    </div>
  </section>
</template>
