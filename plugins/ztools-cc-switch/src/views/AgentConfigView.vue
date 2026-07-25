<script setup>
import { computed, onMounted, ref } from 'vue'
import OmoProfilesPanel from '../components/OmoProfilesPanel.vue'

const emit = defineEmits(['back', 'toast'])
const bridge = window.ccSwitch
const tab = ref('agents')
const loading = ref(true)
const busy = ref('')
const agents = ref({})
const agentForm = ref({ primary: '', fallbacks: '', workspace: '', timeoutSeconds: '', contextTokens: '', maxConcurrent: '' })
const defaultModel = ref({})
const modelForm = ref({ primary: '', fallbacks: '' })
const catalogEntries = ref([])
const tools = ref({})
const toolsForm = ref({ profile: '', allow: '', deny: '' })
const envText = ref('{}')
const health = ref([])
const memoryKind = ref('memory')
const memories = ref({ memory: '', user: '' })
const limits = ref({ memory: 2200, user: 1375, memoryEnabled: true, userEnabled: true })
const hermesModel = ref(null)
const hermesWeb = ref({ checking: false, online: false, statusCode: null, baseUrl: 'http://127.0.0.1:9119' })
const memoryContent = computed({ get: () => memories.value[memoryKind.value], set: (value) => { memories.value[memoryKind.value] = value } })
const currentLimit = computed(() => limits.value[memoryKind.value])
const currentEnabled = computed(() => memoryKind.value === 'memory' ? limits.value.memoryEnabled : limits.value.userEnabled)
const overLimit = computed(() => memoryContent.value.length > currentLimit.value)

function toast(message, tone = 'success') { emit('toast', message, tone) }
function outcomeToast(label, outcome) { toast(outcome?.warnings?.length ? `${label}已保存；发现 ${outcome.warnings.length} 个健康警告` : `${label}已保存`, outcome?.warnings?.length ? 'warning' : 'success') }

async function load() {
  loading.value = true
  try {
    const [defaults, currentDefaultModel, catalog, currentTools, env, warnings, hermesCurrentModel, memory, user, memoryLimits, webStatus] = await Promise.all([
      bridge.getOpenClawAgentsDefaults(), bridge.getOpenClawDefaultModel(), bridge.getOpenClawModelCatalog(),
      bridge.getOpenClawTools(), bridge.getOpenClawEnv(), bridge.scanOpenClawHealth(), bridge.getHermesModelConfig(),
      bridge.getHermesMemory('memory'), bridge.getHermesMemory('user'), bridge.getHermesMemoryLimits(), bridge.probeHermesWebUi()
    ])
    agents.value = defaults || {}
    agentForm.value = {
      primary: defaults?.model?.primary || '', fallbacks: (defaults?.model?.fallbacks || []).join('\n'), workspace: String(defaults?.workspace || ''),
      timeoutSeconds: defaults?.timeoutSeconds ?? defaults?.timeout ?? '', contextTokens: defaults?.contextTokens ?? '', maxConcurrent: defaults?.maxConcurrent ?? ''
    }
    defaultModel.value = currentDefaultModel || {}
    modelForm.value = { primary: currentDefaultModel?.primary || '', fallbacks: (currentDefaultModel?.fallbacks || []).join('\n') }
    catalogEntries.value = Object.entries(catalog || {}).map(([id, entry]) => {
      const { alias = '', ...extra } = entry || {}
      return { id, alias: alias || '', extraText: Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '' }
    })
    tools.value = currentTools || {}
    toolsForm.value = { profile: currentTools?.profile || '', allow: (currentTools?.allow || []).join('\n'), deny: (currentTools?.deny || []).join('\n') }
    envText.value = JSON.stringify(env || {}, null, 2)
    health.value = warnings
    hermesModel.value = hermesCurrentModel
    memories.value = { memory, user }; limits.value = memoryLimits; hermesWeb.value = { checking: false, ...webStatus }
  } catch (error) { toast(error.message, 'error') }
  finally { loading.value = false }
}

function optionalNumber(value, label) {
  if (String(value).trim() === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} 必须是非负数字`)
  return number
}

async function saveAgents() {
  busy.value = 'agents'
  try {
    const next = { ...agents.value }
    const fallbacks = agentForm.value.fallbacks.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
    if (agentForm.value.primary || fallbacks.length) next.model = { ...(next.model || {}), primary: agentForm.value.primary.trim(), ...(fallbacks.length ? { fallbacks } : {}) }
    else delete next.model
    for (const [key, label] of [['timeoutSeconds', '超时'], ['contextTokens', '上下文 Token'], ['maxConcurrent', '最大并发']]) {
      const number = optionalNumber(agentForm.value[key], label); if (number === undefined) delete next[key]; else next[key] = number
    }
    if (agentForm.value.workspace.trim()) next.workspace = agentForm.value.workspace.trim(); else delete next.workspace
    delete next.timeout
    const outcome = await bridge.setOpenClawAgentsDefaults(next); agents.value = next; health.value = await bridge.scanOpenClawHealth(); outcomeToast('Agents Defaults', outcome)
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function saveModels() {
  busy.value = 'models'
  try {
    const primary = modelForm.value.primary.trim()
    if (!primary) throw new Error('Primary Model 不能为空')
    const fallbacks = [...new Set(modelForm.value.fallbacks.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))]
    const nextDefault = { ...defaultModel.value, primary, fallbacks }
    const catalog = {}
    for (const row of catalogEntries.value) {
      const id = row.id.trim()
      if (!id) throw new Error('模型目录 ID 不能为空')
      if (catalog[id]) throw new Error(`模型目录 ID 重复：${id}`)
      let extra = {}
      if (row.extraText.trim()) {
        extra = JSON.parse(row.extraText)
        if (!extra || Array.isArray(extra) || typeof extra !== 'object') throw new Error(`${id} 的扩展字段必须是 JSON 对象`)
      }
      catalog[id] = { ...extra, ...(row.alias.trim() ? { alias: row.alias.trim() } : {}) }
    }
    const defaultOutcome = await bridge.setOpenClawDefaultModel(nextDefault)
    const catalogOutcome = await bridge.setOpenClawModelCatalog(catalog)
    defaultModel.value = nextDefault
    agents.value = { ...agents.value, model: nextDefault, models: catalog }
    outcomeToast('模型路由与目录', { warnings: [...(defaultOutcome?.warnings || []), ...(catalogOutcome?.warnings || [])] })
  } catch (error) { toast(`模型目录保存失败：${error.message}`, 'error') }
  finally { busy.value = '' }
}

function addCatalogEntry() { catalogEntries.value.push({ id: '', alias: '', extraText: '' }) }
function removeCatalogEntry(index) { catalogEntries.value.splice(index, 1) }

async function saveTools() {
  busy.value = 'tools'
  try {
    const next = { ...tools.value }
    if (toolsForm.value.profile) next.profile = toolsForm.value.profile; else delete next.profile
    next.allow = toolsForm.value.allow.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    next.deny = toolsForm.value.deny.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    const outcome = await bridge.setOpenClawTools(next); tools.value = next; health.value = await bridge.scanOpenClawHealth(); outcomeToast('Tools', outcome)
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function saveEnv() {
  busy.value = 'env'
  try {
    const parsed = JSON.parse(envText.value)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Env 必须是 JSON 对象')
    const outcome = await bridge.setOpenClawEnv(parsed); envText.value = JSON.stringify(parsed, null, 2); health.value = await bridge.scanOpenClawHealth(); outcomeToast('Env', outcome)
  } catch (error) { toast(`Env 保存失败：${error.message}`, 'error') }
  finally { busy.value = '' }
}

async function saveMemory() {
  busy.value = 'memory'
  try { await bridge.setHermesMemory(memoryKind.value, memoryContent.value); toast(`${memoryKind.value === 'memory' ? 'Agent Memory' : 'User Profile'} 已保存`) }
  catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function toggleMemory(enabled) {
  try { limits.value = { ...limits.value, ...(await bridge.setHermesMemoryEnabled(memoryKind.value, enabled)) }; toast(`Hermes Memory 已${enabled ? '启用' : '停用'}`) }
  catch (error) { toast(error.message, 'error') }
}

async function probeHermes() {
  hermesWeb.value = { ...hermesWeb.value, checking: true }
  try { hermesWeb.value = { checking: false, ...(await bridge.probeHermesWebUi()) } }
  catch (error) { hermesWeb.value = { ...hermesWeb.value, checking: false, online: false }; toast(error.message, 'error') }
}

async function openHermesWeb() {
  busy.value = 'hermes-web'
  try { const result = await bridge.openHermesWebUi('/config'); hermesWeb.value = { checking: false, ...result }; toast('已通过 ZTools 打开 Hermes Web UI') }
  catch (error) {
    hermesWeb.value = { ...hermesWeb.value, checking: false, online: false }
    toast(error.message === 'hermes_web_offline' ? 'Hermes Web 服务未运行，请先启动 Dashboard' : error.message, 'error')
  } finally { busy.value = '' }
}

async function launchHermes() {
  busy.value = 'hermes-launch'
  try { await bridge.launchHermesDashboard(); toast('已在终端启动 hermes dashboard，请等待服务就绪') }
  catch (error) { toast(`启动 Hermes Dashboard 失败：${error.message}`, 'error') }
  finally { busy.value = '' }
}

async function refreshHealth() { try { health.value = await bridge.scanOpenClawHealth(); toast(health.value.length ? `发现 ${health.value.length} 个配置警告` : 'OpenClaw 配置健康') } catch (error) { toast(error.message, 'error') } }
onMounted(load)
</script>

<template>
  <section class="settings-view extension-view agent-config-view">
    <header class="settings-heading"><button class="back-button" @click="$emit('back')">←</button><div><span class="eyebrow">AGENT RUNTIME / CONFIG</span><h1>Agent 配置中心</h1><p>管理 OpenClaw、Hermes Memory 与 OpenCode OMO Agent 编排。</p></div><button class="secondary-button heading-action" @click="load">重新载入</button></header>
    <div class="agent-runtime-strip"><div><i class="openclaw" /><span>OpenClaw</span><strong>~/.openclaw/openclaw.json</strong></div><div><i class="hermes" /><span>Hermes</span><strong>~/.hermes</strong></div><div><i class="opencode" /><span>OpenCode</span><strong>OMO / OMO Slim</strong></div><em :class="{ warning: health.length }">{{ health.length ? `${health.length} warnings` : 'healthy' }}</em></div>
    <div class="segmented-tabs agent-config-tabs"><button v-for="item in [{id:'agents',name:'Agents Defaults'},{id:'models',name:'Model Catalog'},{id:'tools',name:'Tools'},{id:'env',name:'Env'},{id:'health',name:'Health'},{id:'memory',name:'Hermes'},{id:'omo',name:'OMO Profiles'}]" :key="item.id" :class="{ active: tab === item.id }" @click="tab = item.id">{{ item.name }}<span v-if="item.id === 'health' && health.length">{{ health.length }}</span></button></div>
    <div v-if="loading" class="loading-grid"><div v-for="n in 3" :key="n" class="skeleton-card" /></div>
    <template v-else>
      <div v-if="tab === 'agents'" class="agent-config-grid">
        <article class="settings-card agent-section-card"><span class="card-label">MODEL ROUTING</span><h2>默认模型链</h2><label>Primary Model<input v-model="agentForm.primary" placeholder="provider/model" /></label><label>Fallback Models<textarea v-model="agentForm.fallbacks" rows="6" placeholder="每行一个 provider/model" /></label></article>
        <article class="settings-card agent-section-card"><span class="card-label">EXECUTION DEFAULTS</span><h2>运行参数</h2><label>Workspace<input v-model="agentForm.workspace" placeholder="~/workspace" /></label><div class="agent-number-grid"><label>Timeout Seconds<input v-model="agentForm.timeoutSeconds" inputmode="numeric" /></label><label>Context Tokens<input v-model="agentForm.contextTokens" inputmode="numeric" /></label><label>Max Concurrent<input v-model="agentForm.maxConcurrent" inputmode="numeric" /></label></div><button class="primary-button" :disabled="busy === 'agents'" @click="saveAgents">保存 Agents Defaults</button></article>
      </div>
      <div v-else-if="tab === 'models'" class="model-catalog-layout">
        <article class="settings-card model-route-card">
          <header><div><span class="card-label">OPENCLAW ROUTE</span><h2>默认模型链</h2></div><span>{{ 1 + modelForm.fallbacks.split(/\r?\n|,/).filter(Boolean).length }} routes</span></header>
          <label>Primary Model<input v-model="modelForm.primary" placeholder="provider/model" /></label>
          <label>Fallback Models<textarea v-model="modelForm.fallbacks" rows="5" placeholder="每行一个 provider/model" /></label>
          <p>保留上游未知字段；保存时仅更新 <code>agents.defaults.model</code>。</p>
        </article>
        <article class="settings-card model-catalog-card">
          <header><div><span class="card-label">ALLOWED MODELS</span><h2>模型目录</h2></div><button class="secondary-button" @click="addCatalogEntry">＋ 添加模型</button></header>
          <div v-if="!catalogEntries.length" class="catalog-empty"><strong>目录为空</strong><p>OpenClaw 将不使用显式模型允许列表。</p><button class="secondary-button" @click="addCatalogEntry">添加第一项</button></div>
          <div v-else class="catalog-list">
            <article v-for="(row, index) in catalogEntries" :key="index" class="catalog-row">
              <div class="catalog-row-main"><label>Model ID<input v-model="row.id" placeholder="provider/model" /></label><label>Alias<input v-model="row.alias" placeholder="可选别名" /></label><button class="icon-button" title="移除模型" @click="removeCatalogEntry(index)">×</button></div>
              <label class="catalog-extra">扩展字段 JSON<textarea v-model="row.extraText" rows="2" placeholder='例如 { "temperature": 0.2 }' /></label>
            </article>
          </div>
          <footer><span>{{ catalogEntries.length }} models · 未知字段原样往返</span><button class="primary-button" :disabled="busy === 'models'" @click="saveModels">保存模型配置</button></footer>
        </article>
      </div>
      <div v-else-if="tab === 'tools'" class="agent-config-grid">
        <article class="settings-card agent-section-card"><span class="card-label">PERMISSION PROFILE</span><h2>工具权限档案</h2><label>Profile<select v-model="toolsForm.profile"><option value="">未设置</option><option v-if="toolsForm.profile && !['minimal','coding','messaging','full'].includes(toolsForm.profile)" :value="toolsForm.profile">{{ toolsForm.profile }}（不受支持，保留）</option><option value="minimal">Minimal</option><option value="coding">Coding</option><option value="messaging">Messaging</option><option value="full">Full</option></select></label><p>选择 OpenClaw 内建权限基线，再用 Allow / Deny 精确覆盖。</p></article>
        <article class="settings-card agent-section-card"><span class="card-label">RULE OVERRIDES</span><h2>Allow / Deny</h2><div class="agent-two-editors"><label>Allow<textarea v-model="toolsForm.allow" rows="9" placeholder="read\nexec" /></label><label>Deny<textarea v-model="toolsForm.deny" rows="9" placeholder="browser" /></label></div><button class="primary-button" :disabled="busy === 'tools'" @click="saveTools">保存 Tools</button></article>
      </div>
      <article v-else-if="tab === 'env'" class="settings-card code-editor-card"><div><span class="card-label">OPENCLAW ENV</span><h2>完整 Env JSON</h2><p>支持 env.vars、env.shellEnv 及未知字段；保存时验证对象结构。</p></div><textarea v-model="envText" spellcheck="false" /><footer><span>{{ envText.length.toLocaleString() }} chars</span><button class="primary-button" :disabled="busy === 'env'" @click="saveEnv">验证并保存</button></footer></article>
      <div v-else-if="tab === 'health'" class="health-console"><header><div><span class="card-label">OPENCLAW HEALTH</span><h2>配置健康检查</h2></div><button class="secondary-button" @click="refreshHealth">重新扫描</button></header><article v-for="item in health" :key="`${item.code}:${item.path}`"><i>!</i><div><strong>{{ item.code }}</strong><p>{{ item.message }}</p><code>{{ item.path }}</code></div></article><div v-if="!health.length" class="health-ok"><i>✓</i><div><strong>配置健康</strong><p>未发现旧版 timeout、无效 Tools Profile 或畸形 Env 节点。</p></div></div></div>
      <div v-else-if="tab === 'memory'" class="memory-console">
        <div class="hermes-runtime-card">
          <div class="hermes-runtime-status"><i :class="{ online: hermesWeb.online }" /><div><span class="card-label">HERMES DASHBOARD</span><strong>{{ hermesWeb.online ? 'Web 服务在线' : 'Web 服务离线' }}</strong><small>{{ hermesWeb.baseUrl }}<template v-if="hermesWeb.statusCode"> · HTTP {{ hermesWeb.statusCode }}</template></small></div></div>
          <dl><div><dt>Provider</dt><dd>{{ hermesModel?.provider || '—' }}</dd></div><div><dt>Default Model</dt><dd>{{ hermesModel?.default || '—' }}</dd></div><div><dt>Context</dt><dd>{{ hermesModel?.context_length?.toLocaleString?.() || '—' }}</dd></div><div><dt>Max Tokens</dt><dd>{{ hermesModel?.max_tokens?.toLocaleString?.() || '—' }}</dd></div></dl>
          <div class="hermes-runtime-actions"><button class="secondary-button" :disabled="hermesWeb.checking" @click="probeHermes">{{ hermesWeb.checking ? '探测中…' : '刷新状态' }}</button><button v-if="!hermesWeb.online" class="secondary-button" :disabled="busy === 'hermes-launch'" @click="launchHermes">启动 Dashboard</button><button class="primary-button" :disabled="busy === 'hermes-web' || !hermesWeb.online" @click="openHermesWeb">打开 Web UI ↗</button></div>
        </div>
        <div class="memory-console-head"><div class="segmented-tabs"><button :class="{ active: memoryKind === 'memory' }" @click="memoryKind = 'memory'">Agent Memory</button><button :class="{ active: memoryKind === 'user' }" @click="memoryKind = 'user'">User Profile</button></div><label class="memory-toggle"><input :checked="currentEnabled" type="checkbox" @change="toggleMemory($event.target.checked)" />{{ currentEnabled ? '运行时启用' : '运行时停用' }}</label></div>
        <textarea v-model="memoryContent" spellcheck="false" :class="{ over: overLimit }" />
        <footer><span :class="{ over: overLimit }">{{ memoryContent.length.toLocaleString() }} / {{ currentLimit.toLocaleString() }} chars <em v-if="overLimit">· 超出运行时预算</em></span><small>Hermes 会在加载时按字符预算截断，文件仍完整保存。</small><button class="primary-button" :disabled="busy === 'memory'" @click="saveMemory">保存 Memory</button></footer>
      </div>
      <OmoProfilesPanel v-else @toast="(...args) => emit('toast', ...args)" />
    </template>
  </section>
</template>
