<template>
  <div class="zapapi-app">
    <div class="zapapi-header">
      <div class="zapapi-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span>ZapApi</span>
      </div>
      <div class="zapapi-actions">
        <UiButton data-tour-id="code-generator" variant="secondary" size="sm"
          :disabled="!activeTab || !activeTab.request.url" @click="showCodeGenerator = true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          {{ t('app.code') }}
        </UiButton>
      </div>
    </div>
    <div class="zapapi-body">
      <ActivityBar :active-panel="activePanel" :collapsed="sidePanelCollapsed" :active-env-name="activeEnvName"
        @select-panel="onSelectPanel" @open-settings="showSettings = true" @open-shortcuts="showShortcuts = true" />
      <SidePanel :active-panel="activePanel" :collapsed="sidePanelCollapsed">
        <template #header-actions>
          <UiButton v-if="activePanel === 'collections'" variant="ghost" size="sm" icon-only @click="onNewCollection">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </UiButton>
          <UiButton v-if="activePanel === 'environments'" variant="ghost" size="sm" icon-only
            @click="envPanelRef?.createNewEnv()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </UiButton>
        </template>
        <CollectionsPanel v-if="activePanel === 'collections'" :active-collection="activeCollectionId"
          :active-request="activeRequestId" @select-request="onSelectRequest"
          @open-request-in-new-tab="onOpenRequestInNewTab" @new-request="onNewRequest"
          @new-collection="onNewCollection" />
        <HistoryPanel v-if="activePanel === 'history'" @load-history="onLoadHistory" />
        <EnvironmentPanel v-if="activePanel === 'environments'" ref="envPanelRef" />
        <CookiePanel v-show="activePanel === 'cookies'" ref="cookiePanelRef" />
      </SidePanel>
      <div class="zapapi-main">
        <RequestTabs data-tour-id="tabs-root" :tabs="tabItems" :active-tab-id="activeTabId" @select="switchTab"
          @close="closeTab" @close-others="closeOtherTabs" @close-right="closeRightTabs" @duplicate="duplicateTab"
          @new="newTab" @rename="renameTab" />
        <div class="workspace-region">
          <RequestBuilder ref="requestBuilderRef" :request="activeTab.request" :response="activeTab.response"
            :sending="activeTab.sending" :has-response="showResponsePanel" :response-collapsed="responseCollapsed"
            :sidebar-collapsed="sidePanelCollapsed" @send="onSend" @connect="onConnectSocket"
            @disconnect="onDisconnectSocket" @socket-send="onSocketSend" @save="onSave" @cancel="onCancelSend"
            @new-tab-with-url="openUrlInNewTab" />
          <div v-if="showResponsePanel" class="response-region"
            :class="{ 'response-region--collapsed': responseCollapsed }">
            <div class="response-region__expanded">
              <ResponseViewer :response="activeTab.response" :sending="activeTab.sending"
                @toggle-collapse="responseCollapsed = true" />
            </div>
            <div class="response-toggle-bar">
              <div class="response-toggle-bar__spacer"></div>
              <UiButton variant="ghost" size="xs" @click="responseCollapsed = !responseCollapsed">
                <svg class="response-toggle-icon" :class="{ 'response-toggle-icon--collapsed': responseCollapsed }"
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <UiModal v-if="showCodeGenerator" :title="t('app.codeGeneratorTitle')" size="md" @close="showCodeGenerator = false">
      <CodeGenerator :request="activeTab.request" />
    </UiModal>
    <UiConfirm v-if="pendingTabClose" :title="t('tabs.unsavedTitle')" :message="pendingTabClose.message"
      :confirm-text="t('tabs.closeAnyway')" :cancel-text="t('common.cancel')" confirm-variant="danger"
      @confirm="confirmPendingTabClose" @cancel="pendingTabClose = null" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" @open-shortcuts="showShortcuts = true"
      @replay-onboarding="replayOnboarding" />
    <ShortcutsModal v-if="showShortcuts" @close="showShortcuts = false" />
    <UiToast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import ActivityBar from './components/ActivityBar.vue'
import type { PanelId } from './components/ActivityBar.vue'
import SidePanel from './components/SidePanel.vue'
import CollectionsPanel from './components/panels/CollectionsPanel.vue'
import HistoryPanel from './components/panels/HistoryPanel.vue'
import EnvironmentPanel from './components/panels/EnvironmentPanel.vue'
import CookiePanel from './components/panels/CookiePanel.vue'
import RequestBuilder from './components/RequestBuilder.vue'
import ResponseViewer from './components/ResponseViewer.vue'
import RequestTabs from './components/RequestTabs.vue'
import CodeGenerator from './components/CodeGenerator.vue'
import SettingsModal from './components/SettingsModal.vue'
import ShortcutsModal from './components/ShortcutsModal.vue'
import UiButton from './components/ui/UiButton.vue'
import UiModal from './components/ui/UiModal.vue'
import UiToast from './components/ui/UiToast.vue'
import UiConfirm from './components/ui/UiConfirm.vue'
import type { RequestState, ResponseState } from './store/request'
import { useEnvironmentStore } from './store/environments'
import { useCollectionsStore } from './store/collections'
import { useHistoryStore, type HistoryItem } from './store/history'
import { useSettingsStore } from './store/settings'
import { useShortcuts } from './composables/useShortcuts'
import { useOnboarding } from './composables/useOnboarding'
import { createRequestController, type SendController } from './utils/requestExecutor'
import { connectSocket, getSocketController } from './utils/socketExecutor'
import { normalizeHttpUrl } from './utils/urlNormalizer'

const { t } = useI18n()

const envStore = useEnvironmentStore()
const collectionsStore = useCollectionsStore()
const historyStore = useHistoryStore()
const settingsStore = useSettingsStore()
const toastRef = ref<InstanceType<typeof UiToast> | null>(null)
const requestBuilderRef = ref<{ focusRequestUrlInput: () => void } | null>(null)

const showCodeGenerator = ref(false)
const showSettings = ref(false)
const showShortcuts = ref(false)

const activePanel = ref<PanelId | null>(null)
const lastActivePanel = ref<PanelId>('collections')
const envPanelRef = ref<InstanceType<typeof EnvironmentPanel> | null>(null)
const cookiePanelRef = ref<InstanceType<typeof CookiePanel> | null>(null)

const sidePanelCollapsed = computed(() => activePanel.value === null)

const activeEnvName = computed(() => {
  const envId = envStore.state.activeEnvId
  if (!envId) return null
  const env = envStore.state.environments.find((e) => e.id === envId)
  return env?.name || null
})

function onSelectPanel(panel: PanelId) {
  if (activePanel.value === panel) {
    lastActivePanel.value = panel
    activePanel.value = null
  } else {
    activePanel.value = panel
    lastActivePanel.value = panel
  }
}

function toggleSidePanel() {
  if (activePanel.value !== null) {
    lastActivePanel.value = activePanel.value
    activePanel.value = null
  } else {
    activePanel.value = lastActivePanel.value || 'collections'
  }
}
const pendingTabClose = ref<PendingTabCloseState | null>(null)

interface RequestTabState {
  id: string
  request: RequestState
  savedSnapshot: RequestState
  response: ResponseState
  collectionId: string | null
  requestId: string | null
  customTitle: string | null
  sending: boolean
  controller: SendController | null
}

interface PendingTabCloseState {
  ids: string[]
  message: string
}

const DEFAULT_REQUEST: RequestState = {
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  auth: {
    type: 'none',
    token: '',
    username: '',
    password: '',
    apiKey: '',
    apiKeyLocation: 'header',
    apiKeyHeader: 'X-API-Key',
    jwtSecret: '',
    jwtAlgorithm: 'HS256',
    jwtHeaderPrefix: 'Bearer',
    jwtHeader: '{"alg":"HS256","typ":"JWT"}',
    jwtPayload: '{}',
    jwtAutoIat: true,
    jwtAutoExp: false,
    jwtExpSeconds: '3600',
    digestUsername: '',
    digestPassword: '',
    digestAlgorithm: 'MD5'
  },
  body: {
    type: 'none',
    kind: 'none',
    contentType: '',
    raw: '',
    formData: [],
    binary: {}
  },
  cookiePolicy: {
    mode: 'inherit'
  },
  socket: {
    status: 'disconnected',
    messages: [],
    messageType: 'Text'
  }
}

const DEFAULT_RESPONSE: ResponseState = {
  status: null,
  statusText: '',
  time: null,
  size: null,
  headers: {},
  headersRaw: [],
  body: '',
  raw: '',
  error: null,
  contentType: '',
  isBinary: false,
  base64Body: null,
  fileName: null
}

function cloneData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T
}

function createEmptyRequest(): RequestState {
  return cloneData(DEFAULT_REQUEST)
}

function createEmptyResponse(): ResponseState {
  return cloneData(DEFAULT_RESPONSE)
}

function createTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyTab(): RequestTabState {
  const request = createEmptyRequest()
  return {
    id: createTabId(),
    request,
    savedSnapshot: cloneData(request),
    response: createEmptyResponse(),
    collectionId: null,
    requestId: null,
    customTitle: null,
    sending: false,
    controller: null
  }
}

const tabs = ref<RequestTabState[]>([createEmptyTab()])
const activeTabId = ref(tabs.value[0].id)

const activeTab = computed(() => {
  const found = tabs.value.find((tab) => tab.id === activeTabId.value)
  return found || tabs.value[0]
})

const activeCollectionId = computed(() => activeTab.value?.collectionId || null)
const activeRequestId = computed(() => activeTab.value?.requestId || null)



const hasResponse = computed(() => {
  return (
    activeTab.value.sending ||
    activeTab.value.response.status !== null ||
    Boolean(activeTab.value.response.error)
  )
})

const isSocketMethod = computed(() => {
  return ['WS', 'TCP', 'UDP'].includes(activeTab.value.request.method)
})

const responseCollapsed = ref(false)

const showResponsePanel = computed(() => {
  return hasResponse.value && !isSocketMethod.value
})

watch(showResponsePanel, (visible) => {
  if (!visible) {
    responseCollapsed.value = false
  }
})

function tabTitle(tab: RequestTabState): string {
  if (tab.customTitle?.trim()) {
    return tab.customTitle
  }

  if (tab.collectionId && tab.requestId) {
    const collection = collectionsStore.state.collections.find((item) => item.id === tab.collectionId)
    const req = collection?.requests.find((item) => item.id === tab.requestId)
    if (req?.name?.trim()) {
      return req.name
    }
  }

  if (tab.request.url.trim()) {
    return tab.request.url
  }

  return t('tabs.untitledRequest')
}

function isTabDirty(tab: RequestTabState): boolean {
  return JSON.stringify(tab.request) !== JSON.stringify(tab.savedSnapshot)
}

const tabItems = computed(() => {
  return tabs.value.map((tab) => ({
    id: tab.id,
    title: tabTitle(tab),
    method: tab.request.method || 'GET',
    dirty: isTabDirty(tab)
  }))
})

function toast(msg: string) {
  if (toastRef.value) {
    toastRef.value.success(msg)
  } else {
    window.ztools.showTip(msg)
  }
}

function loadIntoActiveTab(request: RequestState, collectionId: string | null, requestId: string | null) {
  if (activeTab.value.controller) {
    activeTab.value.controller.cancel()
  }
  activeTab.value.request = cloneData(request)
  activeTab.value.savedSnapshot = cloneData(request)
  activeTab.value.response = createEmptyResponse()
  activeTab.value.collectionId = collectionId
  activeTab.value.requestId = requestId
  activeTab.value.customTitle = null
  activeTab.value.sending = false
  activeTab.value.controller = null
}

function onSelectRequest(collectionId: string, requestId: string) {
  const collection = collectionsStore.state.collections.find((c) => c.id === collectionId)
  if (collection) {
    const request = collection.requests.find((r) => r.id === requestId)
    if (request) {
      loadIntoActiveTab(request as any, collectionId, requestId)
    }
  }
}

function onOpenRequestInNewTab(collectionId: string, requestId: string) {
  const collection = collectionsStore.state.collections.find((c) => c.id === collectionId)
  if (!collection) {
    return
  }

  const request = collection.requests.find((r) => r.id === requestId)
  if (!request) {
    return
  }

  const requestData = cloneData(request as any)
  const tab: RequestTabState = {
    id: createTabId(),
    request: requestData,
    savedSnapshot: cloneData(requestData),
    response: createEmptyResponse(),
    collectionId,
    requestId,
    customTitle: null,
    sending: false,
    controller: null
  }

  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function onNewRequest(collectionId: string) {
  const newReq = collectionsStore.addRequest(collectionId, {
    name: t('app.newRequest'),
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: {
      type: 'none',
      token: '',
      username: '',
      password: '',
      apiKey: '',
      apiKeyLocation: 'header',
      apiKeyHeader: '',
      jwtSecret: '',
      jwtAlgorithm: 'HS256',
      jwtHeaderPrefix: 'Bearer',
      jwtHeader: '{"alg":"HS256","typ":"JWT"}',
      jwtPayload: '{}',
      jwtAutoIat: true,
      jwtAutoExp: false,
      jwtExpSeconds: '3600',
      digestUsername: '',
      digestPassword: '',
      digestAlgorithm: 'MD5'
    },
    body: { type: 'none', kind: 'none', contentType: '', raw: '', formData: [], binary: {} },
    cookiePolicy: { mode: 'inherit' },
    socket: { status: 'disconnected', messages: [], messageType: 'Text' }
  })
  loadIntoActiveTab(newReq as any, collectionId, newReq.id)
}

function onNewCollection() {
  const name = `${t('collection.defaultName')} ${collectionsStore.state.collections.length + 1}`
  collectionsStore.createCollection(name)
}

function onLoadHistory(item: HistoryItem) {
  loadIntoActiveTab(
    {
      method: item.method,
      url: item.url,
      params: item.params,
      headers: item.headers,
      auth: item.auth,
      body: item.body,
      cookiePolicy: item.cookiePolicy || { mode: 'inherit' },
      socket: { status: 'disconnected', messages: [], messageType: 'Text' }
    } as any,
    null,
    null
  )
}

function newTab() {
  const tab = createEmptyTab()
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function openUrlInNewTab(url: string) {
  const tab = createEmptyTab()
  tab.request.url = url
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function switchTab(tabId: string) {
  const target = tabs.value.find((tab) => tab.id === tabId)
  if (target) {
    activeTabId.value = tabId
  }
}

function switchTabByOffset(offset: 1 | -1) {
  if (tabs.value.length <= 1) {
    return
  }
  const currentIndex = tabs.value.findIndex((tab) => tab.id === activeTabId.value)
  const baseIndex = currentIndex === -1 ? 0 : currentIndex
  const targetIndex = (baseIndex + offset + tabs.value.length) % tabs.value.length
  activeTabId.value = tabs.value[targetIndex].id
}

function closeCurrentTab() {
  closeTab(activeTabId.value)
}

function closeTab(tabId: string) {
  requestCloseTabs([tabId])
}

function renameTab(tabId: string, title: string) {
  const tab = tabs.value.find((item) => item.id === tabId)
  if (!tab) {
    return
  }
  tab.customTitle = title.trim()
}

function closeOtherTabs(tabId: string) {
  const ids = tabs.value.filter((tab) => tab.id !== tabId).map((tab) => tab.id)
  requestCloseTabs(ids)
}

function closeRightTabs(tabId: string) {
  const index = tabs.value.findIndex((tab) => tab.id === tabId)
  if (index === -1) {
    return
  }
  const ids = tabs.value.slice(index + 1).map((tab) => tab.id)
  requestCloseTabs(ids)
}

function duplicateTab(tabId: string) {
  const index = tabs.value.findIndex((tab) => tab.id === tabId)
  if (index === -1) {
    return
  }

  const source = tabs.value[index]
  const copiedRequest = cloneData(source.request)
  const copyTitle = source.customTitle?.trim() ? `${source.customTitle} (${t('tabs.copySuffix')})` : null
  const newTabState: RequestTabState = {
    id: createTabId(),
    request: copiedRequest,
    savedSnapshot: cloneData(copiedRequest),
    response: createEmptyResponse(),
    collectionId: null,
    requestId: null,
    customTitle: copyTitle,
    sending: false,
    controller: null
  }

  tabs.value.splice(index + 1, 0, newTabState)
  activeTabId.value = newTabState.id
}

function forceCloseTabs(ids: string[]) {
  if (ids.length === 0) {
    return
  }

  const idSet = new Set(ids)
  const currentTabs = tabs.value
  const currentActiveId = activeTabId.value
  const activeIndex = currentTabs.findIndex((tab) => tab.id === currentActiveId)

  for (const tab of currentTabs) {
    if (idSet.has(tab.id) && tab.controller) {
      tab.controller.cancel()
    }
  }

  const remaining = currentTabs.filter((tab) => !idSet.has(tab.id))

  if (remaining.length === 0) {
    const fallback = createEmptyTab()
    tabs.value = [fallback]
    activeTabId.value = fallback.id
    return
  }

  if (!idSet.has(currentActiveId)) {
    tabs.value = remaining
    return
  }

  let nextActiveId: string | null = null

  for (let i = activeIndex + 1; i < currentTabs.length; i += 1) {
    if (!idSet.has(currentTabs[i].id)) {
      nextActiveId = currentTabs[i].id
      break
    }
  }

  if (!nextActiveId) {
    for (let i = activeIndex - 1; i >= 0; i -= 1) {
      if (!idSet.has(currentTabs[i].id)) {
        nextActiveId = currentTabs[i].id
        break
      }
    }
  }

  tabs.value = remaining
  activeTabId.value = nextActiveId || remaining[0].id
}

function requestCloseTabs(ids: string[]) {
  const closeIds = Array.from(new Set(ids)).filter((id) => tabs.value.some((tab) => tab.id === id))
  if (closeIds.length === 0) {
    return
  }

  const dirtyCount = closeIds.filter((id) => {
    const tab = tabs.value.find((item) => item.id === id)
    return tab ? isTabDirty(tab) : false
  }).length

  if (dirtyCount > 0) {
    pendingTabClose.value = {
      ids: closeIds,
      message: dirtyCount === 1
        ? t('tabs.unsavedMsgSingle')
        : t('tabs.unsavedMsgBatch', { count: dirtyCount })
    }
    return
  }

  forceCloseTabs(closeIds)
}

function confirmPendingTabClose() {
  if (!pendingTabClose.value) {
    return
  }
  forceCloseTabs(pendingTabClose.value.ids)
  pendingTabClose.value = null
}

function isAnyModalOpen(): boolean {
  return (
    showCodeGenerator.value ||
    showSettings.value ||
    showShortcuts.value ||
    pendingTabClose.value !== null
  )
}

function sendOrToggleConnectionShortcut() {
  if (isSocketMethod.value) {
    if (!activeTab.value.request.url || activeTab.value.request.socket.status === 'connecting') {
      return
    }
    if (activeTab.value.request.socket.status === 'connected') {
      onDisconnectSocket()
      return
    }
    onConnectSocket()
    return
  }

  if (activeTab.value.sending || !activeTab.value.request.url) {
    return
  }

  onSend()
}

function focusRequestUrlInputShortcut() {
  requestBuilderRef.value?.focusRequestUrlInput()
}

function toggleResponsePanelShortcut() {
  if (!showResponsePanel.value) {
    return
  }
  responseCollapsed.value = !responseCollapsed.value
}

async function replayOnboarding() {
  showSettings.value = false
  showShortcuts.value = false
  await onboarding.replay()
}

const onboarding = useOnboarding({
  t,
  hasSeen: () => settingsStore.hasSeenOnboarding(),
  markSeen: () => settingsStore.setOnboardingSeen(true),
  prepareUi: () => {
    showCodeGenerator.value = false
    showSettings.value = false
    showShortcuts.value = false
    activePanel.value = 'collections'
    if (!hasResponse.value && activeTab.value) {
      activeTab.value.request.url = 'https://api.example.com/demo'
      activeTab.value.response = {
        ...createEmptyResponse(),
        status: 200,
        statusText: 'OK',
        time: 42,
        size: 1024,
        contentType: 'application/json',
        body: '{\n  "message": "Welcome to ZapApi!"\n}',
        raw: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{\n  "message": "Welcome to ZapApi!"\n}'
      }
    }
  }
})

const shortcuts = useShortcuts(
  {
    openShortcuts: () => {
      showShortcuts.value = true
    },
    openSettings: () => {
      showSettings.value = true
    },
    replayOnboarding: () => {
      replayOnboarding()
    },
    newTab,
    closeCurrentTab,
    duplicateTab: () => duplicateTab(activeTabId.value),
    nextTab: () => switchTabByOffset(1),
    prevTab: () => switchTabByOffset(-1),
    sendOrToggleConnection: sendOrToggleConnectionShortcut,
    saveRequest: () => {
      if (!activeTab.value.sending) {
        onSave()
      }
    },
    cancelSend: onCancelSend,
    toggleSidebar: toggleSidePanel,
    focusRequestUrl: focusRequestUrlInputShortcut,
    toggleResponsePanel: toggleResponsePanelShortcut
  },
  {
    enabled: () => settingsStore.isShortcutsEnabled(),
    isModalOpen: isAnyModalOpen,
    isSending: () => activeTab.value.sending
  }
)

onMounted(() => {
  shortcuts.mount()
  onboarding.startIfNeeded()
})

onBeforeUnmount(() => {
  shortcuts.unmount()
})

async function onSend() {
  const variables = envStore.getVariables()
  const normalizedUrl = normalizeHttpUrl(activeTab.value.request.url, variables)
  if (!normalizedUrl.ok) {
    const messageKey = normalizedUrl.reason === 'unsupported_protocol'
      ? 'request.invalidHttpProtocol'
      : 'request.invalidHttpUrl'
    toastRef.value?.error(t(messageKey))
    return
  }

  activeTab.value.request.url = normalizedUrl.url

  activeTab.value.sending = true
  activeTab.value.response = createEmptyResponse()
  const snapshot = cloneData(activeTab.value.request)
  snapshot.url = normalizedUrl.url

  const historyItem = historyStore.addItem({
    method: snapshot.method,
    url: snapshot.url,
    params: snapshot.params,
    headers: snapshot.headers,
    auth: snapshot.auth,
    body: snapshot.body,
    cookiePolicy: snapshot.cookiePolicy
  })

  try {
    const controller = createRequestController(snapshot, variables)
    activeTab.value.controller = controller
    const result = await controller.promise
    historyStore.updateResult(historyItem.id, result.status, result.time)

    activeTab.value.response = {
      status: result.status,
      statusText: result.statusText,
      time: result.time,
      size: result.size,
      headers: result.headers,
      headersRaw: result.headersRaw,
      body: result.body,
      raw: result.raw,
      error: result.error,
      contentType: result.contentType,
      isBinary: result.isBinary,
      base64Body: result.base64Body,
      fileName: result.fileName
    }
  } catch (error: unknown) {
    activeTab.value.response = {
      ...activeTab.value.response,
      error: error instanceof Error ? error.message : t('response.failed')
    }
  } finally {
    activeTab.value.controller = null
    activeTab.value.sending = false
    cookiePanelRef.value?.refreshCookies()
  }
}

function onCancelSend() {
  if (activeTab.value.controller) {
    activeTab.value.controller.cancel()
  }
}
function onConnectSocket() {
  if (!activeTab.value.request.url) return;
  const variables = envStore.getVariables();
  const snapshot = cloneData(activeTab.value.request);
  const tabId = activeTab.value.id;

  activeTab.value.request.socket.messages = [];
  activeTab.value.request.socket.status = 'connecting';

  connectSocket(
    tabId,
    snapshot,
    variables,
    (type, data) => {
      const tab = tabs.value.find(t => t.id === tabId);
      if (tab) {
        tab.request.socket.messages.push({
          id: Date.now() + '-' + Math.random(),
          type,
          data,
          time: Date.now()
        });
      }
    },
    (status) => {
      const tab = tabs.value.find(t => t.id === tabId);
      if (tab) {
        tab.request.socket.status = status;
      }
    },
    t as any
  );
}

function onDisconnectSocket() {
  const tabId = activeTab.value.id;
  const ctrl = getSocketController(tabId);
  if (ctrl) {
    ctrl.close();
  }
}

function onSocketSend(message: string) {
  const tabId = activeTab.value.id;
  const ctrl = getSocketController(tabId);
  if (ctrl) {
    ctrl.send(message);
  }
}
function onSave() {
  if (activeTab.value.collectionId && activeTab.value.requestId) {
    collectionsStore.updateRequest(activeTab.value.collectionId, activeTab.value.requestId, {
      ...cloneData(activeTab.value.request)
    })
    activeTab.value.savedSnapshot = cloneData(activeTab.value.request)
    toast(t('app.saved'))
    return
  }

  const targetCollectionId = activeCollectionId.value
  if (!targetCollectionId) {
    toast(t('tabs.saveNeedCollection'))
    return
  }

  const defaultName = activeTab.value.customTitle?.trim() || activeTab.value.request.url.trim() || t('tabs.untitledRequest')
  const newReq = collectionsStore.addRequest(targetCollectionId, {
    name: defaultName,
    method: activeTab.value.request.method,
    url: activeTab.value.request.url,
    params: cloneData(activeTab.value.request.params),
    headers: cloneData(activeTab.value.request.headers),
    auth: cloneData(activeTab.value.request.auth),
    body: cloneData(activeTab.value.request.body),
    cookiePolicy: cloneData(activeTab.value.request.cookiePolicy),
    socket: cloneData(activeTab.value.request.socket)
  })

  activeTab.value.collectionId = targetCollectionId
  activeTab.value.requestId = newReq.id
  activeTab.value.savedSnapshot = cloneData(activeTab.value.request)
  toast(t('tabs.savedAsNewRequest'))
}

</script>

<style scoped>
.zapapi-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: inherit;
}

.zapapi-header {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: 0 16px;
  height: 48px;
  background: var(--header-bg);
  border-bottom: 1px solid var(--border-color);
}

.zapapi-logo {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.zapapi-actions {
  display: flex;
  gap: var(--space-sm);
  margin-left: auto;
}

.zapapi-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.zapapi-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  background: var(--bg-base);
}

.workspace-region {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.response-toggle-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-sm);
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.response-toggle-bar__spacer {
  flex: 1;
}

.response-toggle-icon {
  transition: transform var(--transition-fast);
}

.response-toggle-icon--collapsed {
  transform: rotate(180deg);
}

.response-region {
  display: flex;
  flex-direction: column;
  flex: 0 0 max(0px, calc(100% - 260px));
  height: max(0px, calc(100% - 260px));
  min-height: 0;
  overflow: hidden;
  transition: flex-basis var(--transition-base), height var(--transition-base), opacity 0.16s ease;
}

.response-region__expanded {
  display: flex;
  flex: 1;
  height: 100%;
  min-height: 0;
  opacity: 1;
  overflow: hidden;
  transform: translateY(0);
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.response-region:not(.response-region--collapsed) .response-region__expanded {
  transition-delay: 60ms;
}

.response-region__expanded>* {
  min-height: 0;
}

.response-region .response-toggle-bar {
  height: 0;
  min-height: 0;
  max-height: 0;
  flex-basis: 0;
  opacity: 0;
  overflow: hidden;
  padding-top: 0;
  padding-bottom: 0;
  border-bottom: none;
  pointer-events: none;
  transition: max-height var(--transition-base), opacity 0.16s ease;
}

.response-region--collapsed .response-region__expanded {
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
  transition-delay: 0ms;
}

.response-region--collapsed .response-toggle-bar {
  height: 42px;
  min-height: 42px;
  max-height: 42px;
  opacity: 1;
  padding-top: 0;
  padding-bottom: 0;
  border-bottom: 1px solid var(--border-color);
  pointer-events: auto;
}

.response-region--collapsed {
  flex: 0 0 42px;
  height: 42px;
}
</style>
