<script setup>
import { computed } from 'vue'

const props = defineProps({
  provider: { type: Object, required: true },
  client: { type: Object, required: true },
  active: Boolean,
  routed: Boolean,
  inLiveConfig: Boolean,
  busy: Boolean,
  dragging: Boolean,
  dropTarget: Boolean,
  testResult: { type: Object, default: null }
})
const emit = defineEmits(['switch', 'test', 'terminal', 'edit', 'delete', 'remove-live', 'drag-start', 'drag-enter', 'drag-end', 'drop'])

function startDrag(event) {
  if (event.target.closest('button')) { event.preventDefault(); return }
  emit('drag-start', event)
}

const host = computed(() => {
  try { return new URL(props.provider.baseUrl).host }
  catch { return props.provider.baseUrl }
})
const keyPreview = computed(() => {
  if (props.provider.id === 'claude-desktop-official') return 'Claude 账号登录'
  if (props.provider.authProvider) return props.provider.authAccountId ? '已绑定订阅账号' : '使用默认订阅账号'
  const key = props.provider.apiKey || ''
  if (!key) return '未配置密钥'
  if (key.length < 9) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
})
const isDesktop = computed(() => props.client.id === 'claude-desktop')
const isOfficialDesktop = computed(() => props.provider.id === 'claude-desktop-official')
const isAdditive = computed(() => ['opencode', 'openclaw', 'hermes'].includes(props.client.id))
const canSwitch = computed(() => isOfficialDesktop.value || Boolean(props.provider.apiKey || props.provider.authProvider))
</script>

<template>
  <article
    class="provider-card"
    :class="{ active, 'route-active': active && routed, dragging, 'drop-target': dropTarget }"
    :style="{ '--provider-color': provider.color || client.accent }"
    draggable="true"
    :aria-grabbed="dragging"
    title="拖拽卡片调整排序"
    @dragstart="startDrag"
    @dragenter.prevent="$emit('drag-enter', $event)"
    @dragover.prevent
    @drop.prevent="$emit('drop', $event)"
    @dragend="$emit('drag-end')"
  >
    <div class="card-beam" />
    <div class="card-topline">
      <div class="provider-identity">
        <span class="provider-monogram">{{ provider.name.slice(0, 1).toUpperCase() }}</span>
        <div>
          <div class="provider-title-row">
            <h2>{{ provider.name }}</h2>
            <span v-if="provider.source === 'preset'" class="preset-badge">Preset</span>
            <span v-else-if="provider.source === 'imported'" class="preset-badge imported">Imported</span>
          </div>
          <span class="provider-host">{{ host }}</span>
          <span v-if="isDesktop && !isOfficialDesktop" class="desktop-mode-badge">{{ provider.claudeDesktopMode === 'proxy' ? 'LOCAL GATEWAY' : 'DIRECT 3P' }}</span>
        </div>
      </div>
      <div class="provider-state-badges"><span v-if="inLiveConfig && isAdditive" class="live-config-badge"><i /> Live</span><span v-if="active" class="active-badge"><i /> {{ routed ? 'Routed' : 'Active' }}</span><span class="drag-grip" aria-hidden="true"><i/><i/><i/><i/><i/><i/></span></div>
    </div>

    <dl class="provider-meta">
      <div>
        <dt>MODEL</dt>
        <dd>{{ isDesktop ? (isOfficialDesktop ? 'Claude 1P' : `${provider.claudeDesktopRoutes?.length || 0} routes`) : (provider.model || 'Client default') }}</dd>
      </div>
      <div>
        <dt>{{ provider.authProvider ? 'AUTH ACCOUNT' : 'API KEY' }}</dt>
        <dd :class="{ missing: !provider.apiKey && !provider.authProvider }">{{ keyPreview }}</dd>
      </div>
    </dl>

    <div v-if="testResult" class="test-result" :class="{ ok: testResult.ok, warning: testResult.reachable && !testResult.ok }">
      <span class="result-dot" />
      <span v-if="testResult.loading">正在探测 API…</span>
      <span v-else>{{ testResult.message }}</span>
      <strong v-if="testResult.latency">{{ testResult.latency }} ms</strong>
    </div>

    <footer class="card-actions">
      <button class="switch-button" :disabled="active || busy || !canSwitch" @click="$emit('switch')">
        <span v-if="busy" class="spinner" />
        <template v-else>{{ active ? (routed ? '路由正在使用' : '当前直连') : canSwitch ? (isOfficialDesktop ? '恢复官方模式' : routed ? '切换路由目标' : '切换到此 Provider') : '配置后切换' }}</template>
      </button>
      <button v-if="!isOfficialDesktop" class="icon-button" :disabled="(!provider.apiKey && !provider.authProvider) || testResult?.loading" title="测试连接" @click="$emit('test')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L11 9h7V2l-2.34 2.34A7.96 7.96 0 0 0 10 2Z"/></svg>
      </button>
      <button v-if="!isDesktop" class="icon-button terminal-button" :disabled="!provider.apiKey" title="用此 Provider 打开终端" @click="$emit('terminal')">&gt;_</button>
      <button v-if="isAdditive && inLiveConfig" class="icon-button live-remove-button" :disabled="busy" title="仅从当前客户端 Live 配置移除" @click="$emit('remove-live')">−</button>
      <button v-if="!isOfficialDesktop" class="icon-button" title="编辑" @click="$emit('edit')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m14.7 2.3 3 3-10 10-4.2 1.2 1.2-4.2 10-10ZM3 18h14v-2H9l-2 1H3v1Z"/></svg>
      </button>
      <button v-if="!isOfficialDesktop" class="icon-button danger" title="删除" @click="$emit('delete')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 2h6l1 2h4v2H2V4h4l1-2Zm-2 6h10l-1 10H6L5 8Zm3 2v6h2v-6H8Zm4 0v6h2v-6h-2Z"/></svg>
      </button>
    </footer>
  </article>
</template>
