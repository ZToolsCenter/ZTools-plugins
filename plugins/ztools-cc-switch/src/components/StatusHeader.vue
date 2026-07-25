<script setup>
import ProfileSwitcher from './ProfileSwitcher.vue'
defineProps({
  client: { type: Object, required: true },
  activeProvider: { type: Object, default: null },
  providerCount: { type: Number, default: 0 },
  routable: { type: Boolean, default: true },
  routeEnabled: { type: Boolean, default: false },
  routeBusy: { type: Boolean, default: false }
})
defineEmits(['add', 'route-toggle', 'route-settings', 'profile-applied', 'toast'])
</script>

<template>
  <header class="status-header" :style="{ '--client-accent': client.accent }">
    <div class="status-copy">
      <div class="eyebrow">
        <span class="live-dot" :class="{ on: activeProvider, routed: routeEnabled }" />
        {{ routeEnabled ? 'Local route active' : activeProvider ? 'Provider direct' : 'Provider not set' }}
      </div>
      <h1>{{ client.name }}</h1>
      <p v-if="activeProvider">
        {{ routeEnabled ? '本地路由目标' : '当前直连' }} <strong>{{ activeProvider.name }}</strong>
        <span class="inline-divider" />
        {{ activeProvider.model || '默认模型' }}
      </p>
      <p v-else>选择一个 Provider，为客户端建立 API 路由。</p>
    </div>

    <div class="header-actions">
      <ProfileSwitcher :client="client" @applied="$emit('profile-applied')" @toast="(...args) => $emit('toast', ...args)" />
      <div class="provider-count"><strong>{{ providerCount }}</strong><span>routes</span></div>
      <div class="provider-action-stack">
        <button class="primary-button" @click="$emit('add')">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 3h2v6h6v2h-6v6H9v-6H3V9h6V3Z"/></svg>
          添加 Provider
        </button>
        <div v-if="routable" class="client-route-control" :class="{ active: routeEnabled, busy: routeBusy }">
          <label class="client-route-switch" :title="routeEnabled ? `关闭 ${client.name} 路由` : `开启 ${client.name} 路由`">
            <span class="route-entry-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h5v2H7v10h3v2H5V5Zm9 0 5 4-5 4v-3h-4V8h4V5Zm0 8 5 4-5 4v-3h-4v-2h4v-3Z"/></svg></span>
            <span class="route-entry-copy"><strong>本地路由</strong><small>{{ routeEnabled ? '已接管 · Provider 热切换' : '当前为 Provider 直连' }}</small></span>
            <input type="checkbox" :checked="routeEnabled" :disabled="routeBusy" :aria-label="`${client.name} 本地路由`" @change="$emit('route-toggle', $event.target.checked)" />
          </label>
          <button class="route-settings-button" title="打开路由设置" aria-label="打开路由设置" @click="$emit('route-settings')">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h8v2H3V5Zm12-2h2v6h-2V3Zm-2 2h2v2h-2V5ZM9 13h8v2H9v-2ZM3 11h2v6H3v-6Zm2 2h2v2H5v-2Z"/></svg><span>设置</span>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
