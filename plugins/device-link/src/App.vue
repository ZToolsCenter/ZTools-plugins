<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { AlertTriangle, MoreHorizontal, Radio, Search, Settings, ShieldCheck, Trash2, Upload, UserPlus, X } from 'lucide-vue-next'
import ClearHistoryDialog from './components/ClearHistoryDialog.vue'
import DeviceSidebar from './components/DeviceSidebar.vue'
import MessageComposer from './components/MessageComposer.vue'
import MessageList from './components/MessageList.vue'
import PairingDialog from './components/PairingDialog.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { useDeviceLink } from './composables/useDeviceLink'
import { detectZToolsHostCompatibility } from './lib/ztoolsCompat'

const pairingOpen = ref(false)
const settingsOpen = ref(false)
const historyClearOpen = ref(false)
const searchOpen = ref(false)
const searchQuery = ref('')
const moreOpen = ref(false)
const headerActions = ref<HTMLElement | null>(null)
const searchButton = ref<HTMLButtonElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const moreButton = ref<HTMLButtonElement | null>(null)
const moreMenu = ref<HTMLElement | null>(null)
const dropActive = ref(false)
const dropCount = ref(0)
let dragDepth = 0
const ztoolsCompatibility = detectZToolsHostCompatibility(window.ztools)
const ztoolsVersion = ztoolsCompatibility.version
const upgradeRequired = ztoolsCompatibility.requiresUpgrade
const link = useDeviceLink({ enabled: !upgradeRequired && Boolean(window.deviceLink) })

const filteredMessages = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query) return link.messages.value
  return link.messages.value.filter((message) => [
    message.senderName,
    message.text || '',
    ...message.attachments.flatMap((attachment) => [attachment.name, attachment.mime]),
  ].some((value) => value.toLocaleLowerCase().includes(query)))
})

async function sendText(text: string) {
  await link.sendText(text)
}

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  moreOpen.value = false
  if (searchOpen.value) void nextTick(() => searchInput.value?.focus())
  else searchQuery.value = ''
}

function closeSearch(restoreFocus = false) {
  if (!searchOpen.value) return
  searchOpen.value = false
  searchQuery.value = ''
  if (restoreFocus) void nextTick(() => searchButton.value?.focus())
}

function toggleMore() {
  if (!moreOpen.value && searchOpen.value) {
    searchOpen.value = false
    searchQuery.value = ''
  }
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) void nextTick(() => moreMenu.value?.querySelector<HTMLButtonElement>('button')?.focus())
}

function closeMore(restoreFocus = false) {
  if (!moreOpen.value) return
  moreOpen.value = false
  if (restoreFocus) void nextTick(() => moreButton.value?.focus())
}

function openPairing() {
  closeMore()
  pairingOpen.value = true
}

function openSettings() {
  closeMore()
  settingsOpen.value = true
}

async function toggleServer() {
  closeMore()
  await link.toggleServer()
}

function openClearHistory() {
  closeMore()
  historyClearOpen.value = true
}

async function confirmClearHistory() {
  if (await link.clearHistory()) {
    historyClearOpen.value = false
    closeSearch()
  }
}

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function resetDropState() {
  dragDepth = 0
  dropActive.value = false
  dropCount.value = 0
}

function handleDragEnter(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  dragDepth += 1
  dropActive.value = true
  const itemCount = Array.from(event.dataTransfer?.items || []).filter((item) => item.kind === 'file').length
  dropCount.value = itemCount || event.dataTransfer?.files.length || 0
}

function handleDragOver(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleDragLeave(event: DragEvent) {
  if (!dropActive.value) return
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) resetDropState()
}

async function handleDrop(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  const files = Array.from(event.dataTransfer?.files || [])
  resetDropState()
  await link.sendDroppedFiles(files)
}

function handlePointerDown(event: PointerEvent) {
  if (headerActions.value?.contains(event.target as Node)) return
  if (moreOpen.value) closeMore()
  if (searchOpen.value) closeSearch()
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (moreOpen.value) {
    event.stopPropagation()
    closeMore(true)
  } else if (searchOpen.value) {
    event.stopPropagation()
    closeSearch(true)
  }
}

function resetTransientUi() {
  // Do not stop the preload server: backgroundRunning is intentional. Only UI
  // layers are reset so 3.2's ESC direct-hide and later re-entry are stable.
  closeMore()
  closeSearch()
  pairingOpen.value = false
  settingsOpen.value = false
  historyClearOpen.value = false
  resetDropState()
}

onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown)
  document.addEventListener('keydown', handleKeyDown)
  window.ztools?.onPluginOut?.(resetTransientUi)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handlePointerDown)
  document.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <main v-if="upgradeRequired" class="app-shell upgrade-required" role="alert">
    <section class="upgrade-required__card">
      <span>需要更新 ZTOOLS</span>
      <h1>请升级后使用设备互联</h1>
      <p>{{ ztoolsVersion ? `当前版本 ${ztoolsVersion} 低于 2.4.0。` : '无法确认当前 ZTools 版本。' }} 为了获得更完整、稳定的体验，请升级至 ZTools 2.4.0 或更高版本。</p>
    </section>
  </main>
  <main v-else class="app-shell">
    <DeviceSidebar
      :devices="link.devices.value"
      :server="link.server.value"
      :connected-count="link.connectedCount.value"
      :selected-conversation-id="link.selectedConversationId.value"
      @pair="pairingOpen = true"
      @settings="settingsOpen = true"
      @disconnect="link.disconnectDevice"
      @select="link.selectedConversationId.value = $event"
    />

    <section
      class="conversation"
      :class="{ 'conversation--drop-active': dropActive }"
      :aria-busy="link.busy.value"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <div v-if="dropActive" class="conversation-drop" role="status" aria-live="polite">
        <span class="conversation-drop__icon"><Upload :size="30" aria-hidden="true" /></span>
        <strong>{{ dropCount ? `释放以发送 ${dropCount} 个项目` : '释放以发送文件或文件夹' }}</strong>
        <small>将通过加密会话和大文件分块通道传输</small>
      </div>
      <header class="conversation-header">
        <div><div class="conversation-header__title"><h1>{{ link.conversationTitle.value }}</h1><span><ShieldCheck :size="13" />{{ link.selectedConversationId.value === 'shared' ? '共享会话' : '单独会话' }}</span></div><p>{{ link.server.value?.running ? `${link.server.value.selectedIP}:${link.server.value.port} · ${link.selectedConversationId.value === 'shared' ? '已授权设备共同可见' : '仅此设备可见'}` : '接收服务已停止' }}</p></div>
        <div ref="headerActions" class="conversation-header__actions">
          <div class="header-search">
            <button
              ref="searchButton"
              type="button"
              aria-label="搜索消息"
              aria-controls="conversation-search"
              :aria-expanded="searchOpen"
              :class="{ active: searchOpen }"
              @click="toggleSearch"
            ><Search :size="17" aria-hidden="true" /></button>
            <div v-if="searchOpen" id="conversation-search" class="conversation-search" role="search">
              <label for="conversation-search-input">搜索会话</label>
              <div class="conversation-search__field">
                <Search :size="15" aria-hidden="true" />
                <input id="conversation-search-input" ref="searchInput" v-model="searchQuery" type="search" aria-label="搜索会话消息" placeholder="消息、设备或文件" />
                <span class="conversation-search__count" aria-live="polite">{{ filteredMessages.length }}/{{ link.messages.value.length }}</span>
                <button v-if="searchQuery" type="button" aria-label="清空搜索" @click="searchQuery = ''"><X :size="14" aria-hidden="true" /></button>
              </div>
            </div>
          </div>
          <div class="header-more">
            <button
              ref="moreButton"
              type="button"
              aria-label="更多操作"
              aria-controls="conversation-more-menu"
              :aria-expanded="moreOpen"
              :class="{ active: moreOpen }"
              @click="toggleMore"
            ><MoreHorizontal :size="18" aria-hidden="true" /></button>
            <div v-if="moreOpen" id="conversation-more-menu" ref="moreMenu" class="header-more__menu" role="group" aria-label="会话操作">
              <button type="button" @click="openPairing"><UserPlus :size="15" aria-hidden="true" /><span><strong>连接新设备</strong><small>显示二维码和匹配码</small></span></button>
              <button type="button" @click="openSettings"><Settings :size="15" aria-hidden="true" /><span><strong>设置与同步</strong><small>端口、权限与 WebDAV</small></span></button>
              <button type="button" :disabled="link.busy.value" @click="toggleServer"><Radio :size="15" aria-hidden="true" /><span><strong>{{ link.server.value?.running ? '停止接收服务' : '启动接收服务' }}</strong><small>{{ link.server.value?.running ? '暂停局域网连接' : '恢复局域网连接' }}</small></span></button>
              <div class="header-more__separator" role="separator" />
              <button class="header-more__danger" type="button" :disabled="link.busy.value || !link.allMessages.value.length" @click="openClearHistory"><Trash2 :size="15" aria-hidden="true" /><span><strong>清理全部历史</strong><small>删除所有会话消息与本地附件</small></span></button>
            </div>
          </div>
        </div>
      </header>

      <div v-if="link.loading.value" class="loading-state"><span class="spinner" />正在建立本机会话…</div>
      <MessageList v-else :messages="filteredMessages" :search-query="searchQuery" :saving-attachment-ids="link.savingAttachmentIds.value" @copy="link.copyMessage" @open="link.openAttachment" @download="link.saveAttachment" @delete="link.deleteMessage" />
      <MessageComposer :busy="link.busy.value" :target-count="link.conversationTargetCount.value" :target-label="link.conversationTitle.value" @send="sendText" @attach="link.chooseAndSendFiles" />
    </section>

    <PairingDialog v-if="pairingOpen" :server="link.server.value" :busy="link.busy.value" @close="pairingOpen = false" @regenerate="link.regeneratePairing" @toggle="link.toggleServer" />
    <ClearHistoryDialog v-if="historyClearOpen" :busy="link.busy.value" :message-count="link.allMessages.value.length" @close="historyClearOpen = false" @confirm="confirmClearHistory" />
    <SettingsPanel
      v-if="settingsOpen && link.settings.value"
      :settings="link.settings.value"
      :busy="link.busy.value"
      @close="settingsOpen = false"
      @save-settings="link.saveSettings"
      @save-web-dav="link.saveWebDav"
      @sync="link.syncWebDav"
    />

    <div v-if="link.error.value" class="error-banner"><AlertTriangle :size="16" /><span>{{ link.error.value }}</span><button type="button" @click="link.error.value = ''">关闭</button></div>
    <div v-if="link.notice.value" class="notice-toast">{{ link.notice.value }}</div>
  </main>
</template>
