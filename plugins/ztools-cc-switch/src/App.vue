<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import StatusHeader from './components/StatusHeader.vue'
import ProviderCard from './components/ProviderCard.vue'
import ProviderModal from './components/ProviderModal.vue'
import ToastStack from './components/ToastStack.vue'
import SettingsView from './views/SettingsView.vue'
import SkillsView from './views/SkillsView.vue'
import RouterView from './views/RouterView.vue'
import UsageView from './views/UsageView.vue'
import ExtensionsView from './views/ExtensionsView.vue'
import AuthCenterView from './views/AuthCenterView.vue'
import SessionsView from './views/SessionsView.vue'
import WorkspaceView from './views/WorkspaceView.vue'
import EnvDiagnosticsView from './views/EnvDiagnosticsView.vue'
import AgentConfigView from './views/AgentConfigView.vue'
import UniversalProvidersView from './views/UniversalProvidersView.vue'
import DeepLinkImportModal from './components/DeepLinkImportModal.vue'
import { moveProviderToTarget } from './providerOrder.js'

const bridge = window.ccSwitch
const themePreference = ref(bridge?.getThemePreference?.() || 'light')
const systemThemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
const clients = ref([
  { id: 'claude', name: 'Claude Code', accent: '#E8A66A' },
  { id: 'codex', name: 'Codex', accent: '#5EEAD4' },
  { id: 'gemini', name: 'Gemini CLI', accent: '#79A7FF' }
])
const visibleClientIds = ref(bridge?.getVisibleClients?.() || [])
const providers = ref([])
const active = ref({})
const sortOrders = ref({})
const clientStatus = ref({})
const selectedClient = ref('claude')
const currentView = ref('providers')
const settingsSection = ref('appearance')
const loading = ref(true)
const modalOpen = ref(false)
const editingProvider = ref(null)
const busyProviderId = ref('')
const routeBusyClient = ref('')
const draggedProviderId = ref('')
const dragTargetProviderId = ref('')
const testResults = ref({})
const toasts = ref([])
const runtimeInfo = ref(null)
const deepLinkRequest = ref(null)

function applyTheme(value = themePreference.value) {
  const resolved = value === 'system' && systemThemeQuery?.matches ? 'dark' : value === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themePreference = value
  document.documentElement.style.colorScheme = resolved
}

function changeTheme(value) {
  themePreference.value = bridge?.setThemePreference?.(value) || value
  applyTheme()
  toast(`外观已切换为${({ light: '浅色', system: '跟随系统', dark: '深色' })[themePreference.value]}`)
}

function handleSystemThemeChange() { if (themePreference.value === 'system') applyTheme() }

applyTheme()

const filteredProviders = computed(() => {
  const items = providers.value.filter((provider) => provider.clients.includes(selectedClient.value))
  const order = sortOrders.value[selectedClient.value] || []
  const indexes = new Map(order.map((id, index) => [id, index]))
  return [...items].sort((a, b) => (indexes.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (indexes.get(b.id) ?? Number.MAX_SAFE_INTEGER))
})
const visibleClients = computed(() => {
  if (!visibleClientIds.value.length) return clients.value
  const visible = new Set(visibleClientIds.value)
  return clients.value.filter((client) => visible.has(client.id))
})
const selectedClientInfo = computed(() =>
  clients.value.find((client) => client.id === selectedClient.value) || clients.value[0]
)
const activeProvider = computed(() =>
  providers.value.find((provider) => provider.id === active.value[selectedClient.value]) || null
)
const desktopStatus = computed(() => clientStatus.value['claude-desktop']?.desktopStatus || null)
const selectedLiveProviderIds = computed(() => new Set(clientStatus.value[selectedClient.value]?.liveProviderIds || []))

function toast(message, tone = 'success') {
  const id = `${Date.now()}-${Math.random()}`
  toasts.value.push({ id, message, tone })
  window.setTimeout(() => removeToast(id), 3600)
}

function removeToast(id) {
  toasts.value = toasts.value.filter((item) => item.id !== id)
}

function clientGlyph(client) {
  return ({ claude: 'C', 'claude-desktop': 'CD', codex: 'X', gemini: 'G', opencode: 'O', openclaw: 'W', hermes: 'H', grokbuild: 'K' })[client] || '?'
}

async function loadData() {
  if (!bridge) {
    loading.value = false
    toast('Preload 未加载，请在 ZTools 中运行插件', 'error')
    return
  }
  try {
    const [data, status, runtime] = await Promise.all([
      bridge.listProviders(),
      bridge.getClientStatus(),
      bridge.getRuntimeInfo()
    ])
    providers.value = data.providers
    active.value = data.active
    sortOrders.value = data.sortOrders || {}
    clients.value = data.clients
    visibleClientIds.value = bridge.getVisibleClients?.() || data.clients.map((client) => client.id)
    if (!visibleClientIds.value.includes(selectedClient.value)) selectedClient.value = visibleClientIds.value[0]
    clientStatus.value = status
    runtimeInfo.value = runtime
  } catch (error) {
    toast(error.message || '加载 Provider 失败', 'error')
  } finally {
    loading.value = false
  }
}

function changeClientVisibility(ids) {
  try {
    const saved = bridge.setVisibleClients(ids)
    visibleClientIds.value = saved
    if (!saved.includes(selectedClient.value)) {
      selectedClient.value = saved[0]
      if (selectedClient.value === 'claude-desktop' && currentView.value === 'router') currentView.value = 'providers'
    }
    toast(saved.length === 1 ? `左侧菜单现在只显示 ${clients.value.find((client) => client.id === saved[0])?.name || saved[0]}` : `已显示 ${saved.length} 个 AI 客户端菜单`)
  } catch (error) {
    toast(error.message || '保存客户端菜单失败', 'error')
  }
}

function updateClientRouting({ client, enabled }) {
  clientStatus.value = {
    ...clientStatus.value,
    [client]: { ...(clientStatus.value[client] || {}), routed: enabled }
  }
}

async function toggleClientRouting(enabled) {
  const client = selectedClient.value
  if (client === 'claude-desktop' || routeBusyClient.value) return
  const clientInfo = clients.value.find((item) => item.id === client)
  routeBusyClient.value = client
  try {
    const result = await bridge.setRouterRoute(client, enabled)
    updateClientRouting({ client, enabled: result.enabled })
    clientStatus.value = await bridge.getClientStatus()
    toast(result.enabled
      ? `${clientInfo?.name || client} 已接管${result.autoStarted ? '，共享路由引擎已自动启动' : ''}`
      : `${clientInfo?.name || client} 已恢复直连${result.autoStopped ? '，共享路由引擎已自动停止' : ''}`)
  } catch (error) {
    toast(error.message || '切换路由失败', 'error')
    try { clientStatus.value = await bridge.getClientStatus() } catch {}
  } finally {
    routeBusyClient.value = ''
  }
}

function openSettings(section = 'appearance') {
  settingsSection.value = section
  currentView.value = 'settings'
}

function openCreate() {
  const desktop = selectedClient.value === 'claude-desktop'
  editingProvider.value = {
    name: '', apiKey: '', baseUrl: '', model: '',
    clients: [selectedClient.value], color: selectedClientInfo.value.accent,
    wireApi: 'responses', promptCacheRouting: 'auto', claudeAuthField: 'ANTHROPIC_AUTH_TOKEN', apiType: desktop ? 'anthropic' : 'openai_compat', failoverPriority: 0, modelMap: {}, authProvider: '', authAccountId: '', fastMode: false, costMultiplier: '', pricingModelSource: '',
    claudeDesktopMode: desktop ? 'proxy' : 'direct', claudeDesktopApiFormat: 'anthropic', claudeDesktopRoutes: desktop ? [
      { routeId: 'claude-sonnet-5', upstreamModel: '', labelOverride: '', supports1m: true },
      { routeId: 'claude-opus-4-8', upstreamModel: '', labelOverride: '', supports1m: true },
      { routeId: 'claude-haiku-4-5', upstreamModel: '', labelOverride: '', supports1m: true }
    ] : []
  }
  modalOpen.value = true
}

function openEdit(provider) {
  editingProvider.value = { ...provider, clients: [...provider.clients] }
  modalOpen.value = true
}

async function saveProvider(provider) {
  try {
    const saved = await bridge.saveProvider(provider)
    modalOpen.value = false
    toast(`${saved.name} 已保存`)
    await loadData()
  } catch (error) {
    toast(error.message || '保存失败', 'error')
  }
}

async function deleteProvider(provider) {
  if (!window.confirm(`删除 ${provider.name}？这不会修改当前客户端配置文件。`)) return
  try {
    await bridge.deleteProvider(provider.id)
    toast(`${provider.name} 已删除`)
    await loadData()
  } catch (error) {
    toast(error.message || '删除失败', 'error')
  }
}

async function removeProviderFromLive(provider) {
  if (!window.confirm(`仅从 ${selectedClientInfo.value.name} 的 Live 配置移除 ${provider.name}？管理库记录会保留。`)) return
  busyProviderId.value = provider.id
  try {
    const result = await bridge.removeProviderFromLiveConfig(selectedClient.value, provider.id)
    toast(result.removed ? `${provider.name} 已移出 ${selectedClientInfo.value.name} Live 配置` : `${provider.name} 不在当前 Live 配置中`, result.removed ? 'success' : 'warning')
    clientStatus.value = await bridge.getClientStatus()
  } catch (error) { toast(error.message || '移出 Live 配置失败', 'error') }
  finally { busyProviderId.value = '' }
}

async function switchProvider(provider) {
  busyProviderId.value = provider.id
  try {
    const result = await bridge.switchProvider(selectedClient.value, provider.id)
    active.value = { ...active.value, [selectedClient.value]: provider.id }
    toast(`${clients.value.find((item) => item.id === result.client)?.name || result.client} 已切换至 ${result.providerName}`)
    clientStatus.value = await bridge.getClientStatus()
  } catch (error) {
    toast(error.message || '切换失败', 'error')
  } finally {
    busyProviderId.value = ''
  }
}

async function testProvider(provider) {
  const key = `${selectedClient.value}:${provider.id}`
  testResults.value = { ...testResults.value, [key]: { loading: true } }
  try {
    const result = await bridge.testProvider(provider.id, selectedClient.value)
    testResults.value = { ...testResults.value, [key]: result }
    toast(result.message, result.ok ? 'success' : result.reachable ? 'warning' : 'error')
  } catch (error) {
    testResults.value = { ...testResults.value, [key]: { ok: false, message: error.message } }
    toast(error.message || '连接测试失败', 'error')
  }
}

async function openProviderTerminal(provider) {
  try {
    const cwd = await bridge.chooseProviderTerminalDirectory()
    if (!cwd) return
    await bridge.openProviderTerminal(selectedClient.value, provider.id, cwd)
    toast(`${provider.name} 终端已打开`)
  } catch (error) { toast(error.message || '打开 Provider 终端失败', 'error') }
}

function startProviderDrag(provider, event) {
  draggedProviderId.value = provider.id
  dragTargetProviderId.value = ''
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', provider.id)
}

function enterProviderDrag(provider) {
  if (provider.id !== draggedProviderId.value) dragTargetProviderId.value = provider.id
}

function endProviderDrag() {
  draggedProviderId.value = ''
  dragTargetProviderId.value = ''
}

async function dropProvider(provider, event) {
  const sourceId = draggedProviderId.value || event.dataTransfer.getData('text/plain')
  const currentIds = filteredProviders.value.map((item) => item.id)
  const ids = moveProviderToTarget(currentIds, sourceId, provider.id)
  if (ids.every((id, index) => id === currentIds[index])) { endProviderDrag(); return }
  try {
    const order = await bridge.updateProviderSortOrder(selectedClient.value, ids)
    sortOrders.value = { ...sortOrders.value, [selectedClient.value]: order }
    toast('Provider 排序已更新')
  } catch (error) { toast(error.message || '排序更新失败', 'error') }
  finally { endProviderDrag() }
}

async function importLiveProviders() {
  try {
    const result = await bridge.importLiveProviders()
    if (result.imported.length) {
      toast(`已导入 ${result.imported.length} 个当前客户端配置`)
      await loadData()
      return
    }
    toast('没有发现可导入的客户端 API 配置', 'warning')
  } catch (error) {
    toast(error.message || '导入当前配置失败', 'error')
  }
}

async function importDesktopProviders() {
  try {
    const result = await bridge.importClaudeDesktopProvidersFromClaude()
    toast(result.imported.length ? `已将 ${result.imported.length} 个 Claude Provider 适配到 Desktop` : 'Claude Provider 均已同步到 Desktop', result.imported.length ? 'success' : 'warning')
    await loadData()
  } catch (error) { toast(error.message || '同步 Claude Desktop Provider 失败', 'error') }
}

async function openDesktopLibrary() {
  try { await bridge.openClaudeDesktopConfigLibrary(); toast('已打开 Claude Desktop 配置库') }
  catch (error) { toast(error.message || '打开配置库失败', 'error') }
}

function handlePluginEntry(event) {
  if (event.detail?.code === 'provider-settings') openSettings('appearance')
  if (event.detail?.code === 'provider-skills') currentView.value = 'skills'
  if (event.detail?.code === 'provider-router') {
    if (selectedClient.value === 'claude-desktop') {
      selectedClient.value = visibleClients.value.find((client) => client.id !== 'claude-desktop')?.id || 'claude'
    }
    currentView.value = 'router'
  }
  if (event.detail?.code === 'provider-usage') currentView.value = 'usage'
  if (event.detail?.code === 'provider-extensions') currentView.value = 'extensions'
  if (event.detail?.code === 'provider-webdav') openSettings('sync')
  if (event.detail?.code === 'provider-auth') currentView.value = 'auth'
  if (event.detail?.code === 'provider-sessions') currentView.value = 'sessions'
  if (event.detail?.code === 'provider-workspace') currentView.value = 'workspace'
  if (event.detail?.code === 'provider-env') currentView.value = 'env'
  if (event.detail?.code === 'provider-agent-config') currentView.value = 'agent-config'
}

function handleDeepLink(event) {
  deepLinkRequest.value = event.detail
}

function handleDeepLinkError(event) {
  toast(event.detail?.message || 'Deep Link 解析失败', 'error')
}

async function handleDeepLinkImported(result) {
  if (result.type === 'provider') { selectedClient.value = result.app; currentView.value = 'providers'; await loadData() }
  else if (result.type === 'skill') currentView.value = 'skills'
  else if (result.type === 'prompt' || result.type === 'mcp') currentView.value = 'extensions'
  const message = result.type === 'mcp' ? `已导入 ${result.importedCount} 个 MCP Server${result.failed.length ? `，${result.failed.length} 个失败` : ''}` : `${result.name || result.repo || result.type} 已导入`
  toast(message, result.failed?.length ? 'warning' : 'success')
}

onMounted(async () => {
  window.addEventListener('cc-switch:enter', handlePluginEntry)
  window.addEventListener('cc-switch:deeplink', handleDeepLink)
  window.addEventListener('cc-switch:deeplink-error', handleDeepLinkError)
  systemThemeQuery?.addEventListener?.('change', handleSystemThemeChange)
  await loadData()
})

onBeforeUnmount(() => {
  window.removeEventListener('cc-switch:enter', handlePluginEntry)
  window.removeEventListener('cc-switch:deeplink', handleDeepLink)
  window.removeEventListener('cc-switch:deeplink-error', handleDeepLinkError)
  systemThemeQuery?.removeEventListener?.('change', handleSystemThemeChange)
})
</script>

<template>
  <div class="app-shell antialiased">
    <DeepLinkImportModal v-if="deepLinkRequest" :request="deepLinkRequest" @close="deepLinkRequest = null" @imported="handleDeepLinkImported" @toast="toast" />
    <aside class="side-rail select-none" aria-label="客户端与页面导航">
      <div class="rail-brand" title="AI Provider Switch">
        <div class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 10h18l-4-4 3-3 9 9-9 9-3-3 4-4H4v-4Zm24 12H10l4 4-3 3-9-9 9-9 3 3-4 4h18v4Z"/></svg></div>
        <div class="rail-brand-copy"><strong>Signal Desk</strong><span>AI ROUTE CONTROL</span></div>
      </div>

      <div class="nav-section rail-track" aria-label="选择客户端">
        <span class="nav-kicker">CLIENTS</span>
        <button
          v-for="client in visibleClients"
          :key="client.id"
          class="client-node"
          :class="{ active: selectedClient === client.id }"
          :style="{ '--client-accent': client.accent }"
          :title="client.name"
          @click="selectedClient = client.id; currentView = 'providers'"
        >
          <span class="node-glyph">{{ clientGlyph(client.id) }}</span><span class="nav-label">{{ client.name }}</span>
          <span class="node-status" :class="{ routed: clientStatus[client.id]?.routed }" />
        </button>
      </div>

      <nav class="nav-section rail-tools" aria-label="扩展能力">
        <span class="nav-kicker">OPERATIONS</span>
        <button :class="{ active: currentView === 'skills' }" title="Skills" @click="currentView = 'skills'"><span>S</span><em>Skills</em></button>
        <button :class="{ active: currentView === 'extensions' }" title="MCP 与 Prompts" @click="currentView = 'extensions'"><span>E</span><em>MCP 与 Prompts</em></button>
        <button :class="{ active: currentView === 'universal' }" title="统一 Provider" @click="currentView = 'universal'"><span>V</span><em>统一 Provider</em></button>
        <button :class="{ active: currentView === 'auth' }" title="认证中心" @click="currentView = 'auth'"><span>A</span><em>认证中心</em></button>
        <button :class="{ active: currentView === 'sessions' }" title="Sessions" @click="currentView = 'sessions'"><span>Q</span><em>Sessions</em></button>
        <button :class="{ active: currentView === 'workspace' }" title="OpenClaw Workspace" @click="currentView = 'workspace'"><span>W</span><em>Workspace</em></button>
        <button :class="{ active: currentView === 'agent-config' }" title="Agent 配置中心" @click="currentView = 'agent-config'"><span>N</span><em>Agent 配置</em></button>
        <button :class="{ active: currentView === 'env' }" title="环境诊断" @click="currentView = 'env'"><span>D</span><em>环境诊断</em></button>
        <button :class="{ active: currentView === 'usage' }" title="用量与日志" @click="currentView = 'usage'"><span>U</span><em>用量与日志</em></button>
      </nav>

      <button class="rail-settings" :class="{ active: currentView === 'settings' }" title="设置" @click="openSettings('appearance')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94a7.4 7.4 0 0 0 .05-.94 7.4 7.4 0 0 0-.05-.94l2.03-1.58-1.92-3.32-2.39.96a7.3 7.3 0 0 0-1.62-.94L14.88 3h-3.84l-.36 2.18c-.58.24-1.12.56-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58a7.4 7.4 0 0 0-.05.94c0 .32.02.63.05.94l-2.03 1.58 1.92 3.32 2.39-.96c.5.38 1.04.7 1.62.94l.36 2.18h3.84l.36-2.18c.58-.24 1.12-.56 1.62-.94l2.39.96 1.92-3.32-2.03-1.58ZM13 15.5A3.5 3.5 0 1 1 13 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>
        <span>设置与诊断</span>
      </button>
    </aside>

    <main class="workspace">
      <template v-if="currentView === 'providers'">
        <StatusHeader
          :client="selectedClientInfo"
          :active-provider="activeProvider"
          :provider-count="filteredProviders.length"
          :routable="selectedClient !== 'claude-desktop'"
          :route-enabled="clientStatus[selectedClient]?.routed"
          :route-busy="routeBusyClient === selectedClient"
          @add="openCreate"
          @route-toggle="toggleClientRouting"
          @route-settings="currentView = 'router'"
          @settings="openSettings('appearance')"
          @profile-applied="loadData"
          @toast="toast"
        />

        <section v-if="selectedClient === 'claude-desktop'" class="desktop-status-strip">
          <div class="desktop-status-orb" :class="{ online: desktopStatus?.configured }"><i /></div>
          <div><span>CLAUDE DESKTOP 3P CONTROL</span><strong>{{ desktopStatus?.supported === false ? '当前平台不支持' : desktopStatus?.configured ? 'CC Switch Profile 已应用' : '官方 1P 模式' }}</strong><small>{{ desktopStatus?.configured ? desktopStatus.actualBaseUrl : '切换 Provider 后将以事务方式写入 Desktop 配置库' }}</small></div>
          <dl><div><dt>GATEWAY</dt><dd>{{ desktopStatus?.proxyRunning ? 'ONLINE' : 'STANDBY' }}</dd></div><div><dt>PROFILE</dt><dd>{{ desktopStatus?.appliedId ? 'APPLIED' : '1P' }}</dd></div></dl>
          <div class="desktop-status-actions"><button class="secondary-button" @click="importDesktopProviders">同步 Claude Provider</button><button class="secondary-button" @click="openDesktopLibrary">打开配置库</button></div>
        </section>

        <section class="provider-section" aria-live="polite">
          <div v-if="loading" class="loading-grid">
            <div v-for="index in 4" :key="index" class="skeleton-card" />
          </div>
          <div v-else-if="filteredProviders.length" class="provider-grid">
            <ProviderCard
              v-for="provider in filteredProviders"
              :key="provider.id"
              :provider="provider"
              :client="selectedClientInfo"
              :active="active[selectedClient] === provider.id"
              :routed="Boolean(clientStatus[selectedClient]?.routed)"
              :in-live-config="selectedLiveProviderIds.has(provider.id)"
              :busy="busyProviderId === provider.id"
              :dragging="draggedProviderId === provider.id"
              :drop-target="dragTargetProviderId === provider.id"
              :test-result="testResults[`${selectedClient}:${provider.id}`]"
              @switch="switchProvider(provider)"
              @test="testProvider(provider)"
              @terminal="openProviderTerminal(provider)"
              @drag-start="startProviderDrag(provider, $event)"
              @drag-enter="enterProviderDrag(provider)"
              @drag-end="endProviderDrag"
              @drop="dropProvider(provider, $event)"
              @edit="openEdit(provider)"
              @delete="deleteProvider(provider)"
              @remove-live="removeProviderFromLive(provider)"
            />
          </div>
          <div v-else class="empty-state">
            <div class="empty-orbit"><span /></div>
            <h2>还没有可用路由</h2>
            <p>为 {{ selectedClientInfo.name }} 添加第一个 Provider。</p>
            <button class="primary-button" @click="openCreate">添加 Provider</button>
          </div>
        </section>
      </template>

      <SettingsView
        v-else-if="currentView === 'settings'"
        :runtime-info="runtimeInfo"
        :client-status="clientStatus"
        :theme-preference="themePreference"
        :clients="clients"
        :visible-client-ids="visibleClientIds"
        :initial-tab="settingsSection"
        @back="currentView = 'providers'"
        @import-live="importLiveProviders"
        @toast="toast"
        @reload="loadData"
        @theme-change="changeTheme"
        @client-visibility-change="changeClientVisibility"
      />
      <SkillsView v-else-if="currentView === 'skills'" :clients="clients" @back="currentView = 'providers'" @toast="toast" />
      <ExtensionsView v-else-if="currentView === 'extensions'" :clients="clients" @back="currentView = 'providers'" @toast="toast" />
      <UniversalProvidersView v-else-if="currentView === 'universal'" @back="currentView = 'providers'" @toast="toast" @reload="loadData" />
      <RouterView v-else-if="currentView === 'router'" :client="selectedClientInfo" :clients="clients" @back="currentView = 'providers'" @toast="toast" @routing-change="updateClientRouting" />
      <UsageView v-else-if="currentView === 'usage'" @back="currentView = 'providers'" @toast="toast" />
      <AuthCenterView v-else-if="currentView === 'auth'" @back="currentView = 'providers'" @toast="toast" @changed="loadData" />
      <SessionsView v-else-if="currentView === 'sessions'" @back="currentView = 'providers'" @toast="toast" />
      <WorkspaceView v-else-if="currentView === 'workspace'" @back="currentView = 'providers'" @toast="toast" />
      <EnvDiagnosticsView v-else-if="currentView === 'env'" @back="currentView = 'providers'" @toast="toast" />
      <AgentConfigView v-else-if="currentView === 'agent-config'" @back="currentView = 'providers'" @toast="toast" />
    </main>

    <ProviderModal
      v-if="modalOpen"
      :provider="editingProvider"
      :clients="clients"
      @close="modalOpen = false"
      @save="saveProvider"
    />
    <ToastStack :items="toasts" @dismiss="removeToast" />
  </div>
</template>
