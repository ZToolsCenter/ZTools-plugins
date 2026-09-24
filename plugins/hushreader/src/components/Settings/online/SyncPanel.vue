<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useOnlineStore } from '../../../stores/online'
import { useBookStore } from '../../../stores/books'
import Toast from '../../Bookshelf/Toast.vue'

const onlineStore = useOnlineStore()
const bookStore = useBookStore()

const toastMsg = ref('')
const toastType = ref<'info' | 'success' | 'error'>('info')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  if (toastTimer) clearTimeout(toastTimer)
  toastMsg.value = msg
  toastType.value = type
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 2500)
}

onMounted(() => {
  onlineStore.load()
})

function persist() {
  onlineStore.save()
}

const legado = computed(() => onlineStore.legado)
const syncing = computed(() => onlineStore.syncing)

const lastSyncText = computed(() => {
  if (!onlineStore.lastSyncAt) return ''
  const d = new Date(onlineStore.lastSyncAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

async function doSync() {
  if (!legado.value.url.trim()) {
    showToast('请先填写服务地址', 'error')
    return
  }
  try {
    const summary = await onlineStore.syncLegado(bookStore)
    if (summary) {
      showToast(`同步完成：新增 ${summary.added} 本，更新进度 ${summary.updated} 本，移除 ${summary.removed} 本`, 'success')
    }
  } catch (e: any) {
    showToast(`同步失败：${e?.message || e}`, 'error')
  }
}
</script>

<template>
  <div class="sync-panel">
    <div class="section-label">开源阅读（Legado）同步</div>
    <p class="hint">同步「开源阅读」的书架与阅读进度。开启后在设置页可一键拉取远端书架，阅读时自动回写进度。</p>

    <div class="setting-row">
      <label>启用同步</label>
      <label class="toggle">
        <input v-model="legado.enabled" type="checkbox" @change="persist" />
        <span class="toggle-track"></span>
      </label>
    </div>

    <div v-if="legado.enabled" class="legado-config">
      <div class="setting-row">
        <label>服务类型</label>
        <div class="input-group">
          <select v-model.number="legado.type" class="select" @change="persist">
            <option :value="1">阅读 APP Web 服务</option>
            <option :value="2">阅读网页版</option>
          </select>
        </div>
      </div>
      <div class="setting-row">
        <label>服务地址</label>
        <div class="input-group full">
          <input v-model="legado.url" class="text-input full-width" placeholder="http://127.0.0.1:1745" @change="persist" />
        </div>
      </div>
      <div v-if="legado.type === 2" class="setting-row">
        <label>访问令牌</label>
        <div class="input-group full">
          <input v-model="legado.accessToken" class="text-input full-width" placeholder="accessToken" @change="persist" />
        </div>
      </div>
      <div class="sync-actions">
        <button class="btn-primary" :disabled="syncing || !legado.url.trim()" @click="doSync">
          <span v-if="syncing" class="spinner" style="width:14px;height:14px;border-width:1.5px;margin-right:4px"></span>
          {{ syncing ? '同步中…' : '立即同步' }}
        </button>
        <span v-if="lastSyncText" class="sync-time">上次同步：{{ lastSyncText }}</span>
      </div>
    </div>

    <ul class="note-list">
      <li>需要在「开源阅读」中开启「Web 服务」，或填写「阅读网页版」地址与令牌。</li>
      <li>同步进度仅以开源阅读端较新的进度为准，本地阅读进度会实时回写。</li>
    </ul>

    <Toast :message="toastMsg" :type="toastType" />
  </div>
</template>

<style scoped>
.sync-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--c-ink-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 10px 0 6px;
}

.hint {
  font-size: 11px;
  color: var(--c-ink-tertiary);
  margin: 0 0 6px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  gap: 16px;
  min-height: 36px;
}

.setting-row > label:first-child {
  font-size: 13px;
  color: var(--c-ink);
  flex-shrink: 0;
  min-width: 100px;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.input-group.full {
  flex: 1;
}

.full-width {
  width: 100%;
}

.select {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}

.select:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.text-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 7px 12px;
  font-size: 13px;
}

.text-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.toggle {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--c-border-strong);
  border-radius: var(--radius-full);
  transition: background 0.2s var(--ease-out);
  position: relative;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--c-ink-inverse);
  border-radius: 50%;
  transition: transform 0.2s var(--ease-out);
  box-shadow: 0 1px 3px rgba(28, 25, 23, 0.15);
}

.toggle input:checked + .toggle-track {
  background: var(--c-accent);
}

.toggle input:checked + .toggle-track::after {
  transform: translateX(16px);
}

.legado-config {
  display: flex;
  flex-direction: column;
}

.sync-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.sync-time {
  font-size: 11px;
  color: var(--c-ink-tertiary);
}

.btn-primary {
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  background: var(--c-accent);
  color: var(--c-ink-inverse);
  transition: all 0.15s var(--ease-out);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
}

.note-list {
  margin: 8px 0 0;
  padding: 0 0 0 16px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--c-ink-tertiary);
}
</style>
