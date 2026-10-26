import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  DeviceLinkMessage,
  DeviceLinkSettings,
  DeviceLinkState,
  PairedDevice,
  SaveSettingsInput,
  SaveWebDavInput,
  ServerStatus,
  WebDavSettings,
} from '../types'

export function useDeviceLink(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled !== false
  const loading = ref(enabled)
  const busy = ref(false)
  const messages = ref<DeviceLinkMessage[]>([])
  const devices = ref<PairedDevice[]>([])
  const server = ref<ServerStatus | null>(null)
  const settings = ref<DeviceLinkSettings | null>(null)
  const error = ref('')
  const notice = ref('')
  const savingAttachmentIds = ref<Set<string>>(new Set())
  const selectedConversationId = ref('shared')
  let unsubscribe: (() => void) | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let selectionInitialized = false

  const connectedCount = computed(() => devices.value.filter((device) => device.connected).length)
  const orderedMessages = computed(() => [...messages.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
  const selectedDevice = computed(() => {
    if (!selectedConversationId.value.startsWith('device:')) return null
    return devices.value.find((device) => `device:${device.id}` === selectedConversationId.value) || null
  })
  const conversationMessages = computed(() => orderedMessages.value.filter((message) => message.conversationId === selectedConversationId.value))
  const conversationTitle = computed(() => selectedConversationId.value === 'shared' ? '全部设备' : selectedDevice.value?.name || '设备会话')
  const conversationTargetCount = computed(() => selectedConversationId.value === 'shared' ? connectedCount.value : Number(Boolean(selectedDevice.value?.connected)))

  function toast(message: string) {
    notice.value = message
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (notice.value = ''), 2400)
  }

  function report(reason: unknown) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }

  function upsertMessage(message: DeviceLinkMessage) {
    const index = messages.value.findIndex((item) => item.id === message.id)
    if (index >= 0) messages.value[index] = message
    else messages.value.push(message)
  }

  function upsertDevice(device: PairedDevice) {
    const index = devices.value.findIndex((item) => item.id === device.id)
    if (index >= 0) devices.value[index] = device
    else devices.value.unshift(device)
  }

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const state: DeviceLinkState = await window.deviceLink.getState()
      messages.value = state.messages
      devices.value = state.devices
      server.value = state.server
      settings.value = state.settings
      const selectionStillExists = selectedConversationId.value === 'shared' || state.devices.some((device) => `device:${device.id}` === selectedConversationId.value)
      if (!selectionInitialized) {
        const firstDevice = state.devices.find((device) => device.connected) || state.devices[0]
        selectedConversationId.value = firstDevice ? `device:${firstDevice.id}` : 'shared'
        selectionInitialized = true
      } else if (!selectionStillExists) selectedConversationId.value = 'shared'
    } catch (reason) {
      report(reason)
    } finally {
      loading.value = false
    }
  }

  async function sendText(text: string) {
    if (!text.trim()) return
    busy.value = true
    try {
      upsertMessage(await window.deviceLink.sendText(text, selectedConversationId.value))
    } catch (reason) {
      report(reason)
      throw reason
    } finally {
      busy.value = false
    }
  }

  async function chooseAndSendFiles() {
    const paths = await window.deviceLink.selectFiles()
    if (!paths.length) return
    busy.value = true
    try {
      upsertMessage(await window.deviceLink.sendFiles(paths, selectedConversationId.value))
      toast(paths.length === 1 ? '文件已加入会话' : `${paths.length} 个项目已加入会话`)
    } catch (reason) {
      report(reason)
    } finally {
      busy.value = false
    }
  }

  async function sendDroppedFiles(files: File[]) {
    if (!files.length) return
    busy.value = true
    try {
      upsertMessage(await window.deviceLink.sendDroppedFiles(files, selectedConversationId.value))
      toast(files.length === 1 ? '拖入项目已加入会话' : `${files.length} 个拖入项目已加入会话`)
    } catch (reason) {
      report(reason)
    } finally {
      busy.value = false
    }
  }

  async function copyMessage(id: string) {
    if (await window.deviceLink.copyMessage(id)) toast('已复制')
  }

  async function openAttachment(messageId: string, attachmentId: string) {
    if (!(await window.deviceLink.openAttachment(messageId, attachmentId))) report(new Error('附件尚未同步到本机'))
  }

  async function saveAttachment(messageId: string, attachmentId: string) {
    if (savingAttachmentIds.value.has(attachmentId)) return
    savingAttachmentIds.value = new Set(savingAttachmentIds.value).add(attachmentId)
    try {
      const result = await window.deviceLink.saveAttachment(messageId, attachmentId)
      if (result.status === 'saved') toast(`已保存 ${result.name || '附件'}`)
      else if (result.status === 'missing') report(new Error('附件尚未同步到本机'))
    } catch (reason) {
      report(reason)
    } finally {
      const remaining = new Set(savingAttachmentIds.value)
      remaining.delete(attachmentId)
      savingAttachmentIds.value = remaining
    }
  }

  async function deleteMessage(id: string) {
    if (await window.deviceLink.deleteMessage(id)) messages.value = messages.value.filter((item) => item.id !== id)
  }

  async function clearHistory() {
    busy.value = true
    error.value = ''
    try {
      const result = await window.deviceLink.clearHistory()
      messages.value = []
      toast(result.deleted ? `已清理 ${result.deleted} 条历史消息` : '没有需要清理的历史消息')
      return true
    } catch (reason) {
      report(reason)
      return false
    } finally {
      busy.value = false
    }
  }

  async function regeneratePairing() {
    server.value = await window.deviceLink.regeneratePairingCode()
    toast('已生成新的配对信息')
  }

  async function toggleServer() {
    busy.value = true
    try {
      server.value = server.value?.running ? await window.deviceLink.stopServer() : await window.deviceLink.startServer()
    } catch (reason) {
      report(reason)
    } finally {
      busy.value = false
    }
  }

  async function saveSettings(input: SaveSettingsInput) {
    settings.value = await window.deviceLink.saveSettings(input)
    const state = await window.deviceLink.getState()
    server.value = state.server
    toast('设置已保存')
  }

  async function saveWebDav(input: SaveWebDavInput) {
    const webdav: WebDavSettings = await window.deviceLink.saveWebDavSettings(input)
    if (settings.value) settings.value = { ...settings.value, webdav }
    toast('WebDAV 设置已保存')
  }

  async function syncWebDav() {
    busy.value = true
    try {
      const result = await window.deviceLink.syncWebDav()
      await load()
      toast(`同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}`)
    } catch (reason) {
      report(reason)
    } finally {
      busy.value = false
    }
  }

  async function disconnectDevice(id: string) {
    await window.deviceLink.disconnectDevice(id)
    devices.value = devices.value.filter((device) => device.id !== id)
    if (selectedConversationId.value === `device:${id}`) selectedConversationId.value = 'shared'
    toast('设备授权已撤销')
  }

  function registerLaunchHandlers() {
    window.ztools?.onPluginEnter?.((params) => {
      void (async () => {
        try {
          if (params.type === 'over' && typeof params.payload === 'string') {
            await sendText(params.payload)
            toast('文本已发送')
          } else if (params.type === 'files' && Array.isArray(params.payload)) {
            const paths = params.payload
              .map((item) => (typeof item === 'string' ? item : typeof item === 'object' && item && 'path' in item ? String(item.path) : ''))
              .filter(Boolean)
            if (paths.length) upsertMessage(await window.deviceLink.sendFiles(paths, selectedConversationId.value))
          } else if (params.type === 'img' && typeof params.payload === 'string') {
            upsertMessage(await window.deviceLink.sendImage(params.payload, selectedConversationId.value))
          }
        } catch (reason) {
          report(reason)
        }
      })()
    })
  }

  onMounted(() => {
    if (!enabled) {
      loading.value = false
      return
    }
    void load()
    registerLaunchHandlers()
    unsubscribe = window.deviceLink.subscribe((event) => {
      if (event.type === 'message:new') upsertMessage(event.data as DeviceLinkMessage)
      if (event.type === 'message:deleted') messages.value = messages.value.filter((item) => item.id !== (event.data as { id: string }).id)
      if (event.type === 'device:changed') {
        const device = event.data as PairedDevice
        const isNew = !devices.value.some((item) => item.id === device.id)
        upsertDevice(device)
        if (isNew) {
          selectedConversationId.value = `device:${device.id}`
          selectionInitialized = true
        }
      }
      if (event.type === 'device:deleted') {
        const { id } = event.data as { id: string }
        devices.value = devices.value.filter((item) => item.id !== id)
        if (selectedConversationId.value === `device:${id}`) selectedConversationId.value = 'shared'
      }
      if (event.type === 'server:changed') server.value = event.data as ServerStatus
      if (event.type === 'messages:changed') messages.value = event.data as DeviceLinkMessage[]
      if (event.type === 'sync:changed' && settings.value) settings.value = { ...settings.value, webdav: { ...settings.value.webdav, ...(event.data as Partial<WebDavSettings>) } }
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
    if (noticeTimer) clearTimeout(noticeTimer)
  })

  return {
    busy,
    allMessages: orderedMessages,
    connectedCount,
    conversationTargetCount,
    conversationTitle,
    devices,
    error,
    loading,
    messages: conversationMessages,
    notice,
    savingAttachmentIds,
    server,
    selectedConversationId,
    selectedDevice,
    settings,
    chooseAndSendFiles,
    clearHistory,
    copyMessage,
    deleteMessage,
    disconnectDevice,
    openAttachment,
    regeneratePairing,
    saveAttachment,
    saveSettings,
    saveWebDav,
    sendDroppedFiles,
    sendText,
    syncWebDav,
    toggleServer,
  }
}
