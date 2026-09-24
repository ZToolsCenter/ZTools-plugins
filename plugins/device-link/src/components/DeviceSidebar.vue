<script setup lang="ts">
import { computed } from 'vue'
import { Link2, MessagesSquare, Plus, Radio, Settings, Smartphone, Unplug } from 'lucide-vue-next'
import type { PairedDevice, ServerStatus } from '../types'

const props = defineProps<{
  devices: PairedDevice[]
  server: ServerStatus | null
  connectedCount: number
  selectedConversationId: string
}>()

const emit = defineEmits<{
  pair: []
  settings: []
  disconnect: [id: string]
  select: [conversationId: string]
}>()

const statusText = computed(() => props.server?.running ? `${props.connectedCount} 台在线` : '服务已停止')
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand__mark"><Link2 :size="20" /></span>
      <div><strong>设备互联</strong><small>Device Link</small></div>
    </div>

    <button class="pair-button" type="button" @click="emit('pair')"><Plus :size="17" />连接新设备</button>

    <div class="section-label"><span>会话</span><span class="live"><i />{{ statusText }}</span></div>
    <div class="device-list">
      <article class="device-card" :class="{ 'device-card--selected': selectedConversationId === 'shared' }">
        <button class="device-card__select" type="button" :aria-current="selectedConversationId === 'shared' ? 'page' : undefined" @click="emit('select', 'shared')">
          <span class="device-icon"><MessagesSquare :size="18" /></span>
          <span class="device-card__body"><strong>全部设备</strong><small><Radio :size="11" />共享会话</small></span>
        </button>
      </article>
      <article v-for="device in devices" :key="device.id" class="device-card" :class="{ 'device-card--selected': selectedConversationId === `device:${device.id}` }">
        <button class="device-card__select" type="button" :aria-current="selectedConversationId === `device:${device.id}` ? 'page' : undefined" @click="emit('select', `device:${device.id}`)">
          <span class="device-icon"><Smartphone :size="18" /></span>
          <span class="device-card__body"><strong>{{ device.name }}</strong><small :class="{ online: device.connected }"><Radio :size="11" />{{ device.connected ? '单独会话 · 在线' : '单独会话 · 离线' }}</small></span>
        </button>
        <button class="ghost-icon danger-hover" type="button" title="撤销设备授权" @click.stop="emit('disconnect', device.id)"><Unplug :size="15" /></button>
      </article>
      <p v-if="devices.length === 0" class="empty-device">还没有配对设备。手机扫码后会出现在这里。</p>
    </div>

    <button class="settings-button" type="button" @click="emit('settings')"><Settings :size="17" />设置与同步</button>
  </aside>
</template>
