<script setup lang="ts">
import { ref, onMounted, computed, inject, watch, nextTick } from 'vue'
import { defaultPlatforms } from '../../data/platforms'
import { BUILTIN_PROVIDERS, getProviderInfo, AVAILABLE_ICONS } from '../../data/ai-providers'
import { storage } from '../../utils/storage'
import { getMandiThemes, hexToHsl } from '../../utils/theme'
import type { AppSettings, PlatformInfo, ThemeMode, FontSize, MotionPreference, ModelConfig } from '../../types'
import { MORANDI_THEMES } from '../../types'
import { useSettings } from '../../composables/useSettings'
import { fetchAvailableModels, chatCompletion } from '../../utils/ai'
import PlatformIcon from '../../components/PlatformIcon.vue'
import ProviderIcon from '../../components/ProviderIcon.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import CleanupSelectModal from '../../components/CleanupSelectModal.vue'
import { loadRegistry } from '../../utils/skill-registry'

const props = defineProps<{ anchor?: string }>()
const { settings, updateSettings } = useSettings()
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})

const activeSection = ref('general')
const showToken = ref(false)
const platforms = ref<PlatformInfo[]>([])
const customColorInput = ref('#58a4f6')
const sidebarWidth = ref(180)
const confirmDeleteProviderId = ref<string | null>(null)
const confirmDeleteProviderName = ref('')
const confirmDeleteApiKey = ref<string | null>(null)
const confirmDeleteApiKeyLabel = ref('')
const confirmDeleteGroup = ref<string | null>(null)
const confirmDeleteGroupLabel = ref('')
const confirmDeleteModel = ref<string | null>(null)
const confirmDeleteModelLabel = ref('')

// === Cleanup Unregistered Skills ===
const showCleanupSelect = ref(false)
const unregisteredDirs = ref<string[]>([])
const cleanupResult = ref<{ found: number; deleted: number } | null>(null)

function scanUnregisteredSkills(): string[] {
  const stateDir = window.services.getStateDir()
  const registry = loadRegistry()
  const registeredIds = new Set<string>()
  for (const identity of registry.values()) {
    registeredIds.add(identity.canonicalId)
  }
  const entries = window.services.readDir(stateDir)
  const unregistered: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory) continue
    const folderName = entry.name
    const isRegistered = Array.from(registeredIds).some(id => id.includes(folderName))
    if (!isRegistered) {
      unregistered.push(entry.path)
    }
  }
  return unregistered
}

function getUnregisteredCount(): number {
  return scanUnregisteredSkills().length
}

function openCleanupSelect() {
  unregisteredDirs.value = scanUnregisteredSkills()
  showCleanupSelect.value = true
}

function onCleanupDeleted(count: number) {
  cleanupResult.value = { found: unregisteredDirs.value.length, deleted: count }
  showCleanupSelect.value = false
  showToast(`已清理 ${count} 个未注册的技能文件夹`, 'success')
}

// Sidebar resize
let isResizing = false

function startSidebarResize(e: MouseEvent | TouchEvent) {
  isResizing = true
  const startX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const startWidth = sidebarWidth.value
  let rafId: number | null = null

  function onMove(ev: MouseEvent | TouchEvent) {
    if (!isResizing) return
    const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX
    const delta = cx - startX
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      sidebarWidth.value = Math.max(140, Math.min(280, startWidth + delta))
    })
  }

  function onEnd() {
    isResizing = false
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.addEventListener('mousemove', onMove, { passive: true })
  document.addEventListener('mouseup', onEnd)
  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', onEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

const sections = [
  { id: 'general', label: '通用设置', icon: '⚙' },
  { id: 'appearance', label: '显示设置', icon: '🎨' },
  { id: 'ai', label: '模型服务', icon: '🧠' },
  { id: 'default-model', label: '默认模型', icon: '🎯' },
  { id: 'agent', label: 'Agent 配置', icon: '🤖' },
]

const themeModes: { id: ThemeMode; label: string; icon: string }[] = [
  { id: 'light', label: '浅色', icon: '☀️' },
  { id: 'dark', label: '深色', icon: '🌙' },
  { id: 'auto', label: '跟随系统', icon: '🖥' },
]

const fontSizeOptions: { id: FontSize; label: string; size: string }[] = [
  { id: 'small', label: '小', size: '14px' },
  { id: 'medium', label: '中', size: '16px' },
  { id: 'large', label: '大', size: '18px' },
]

const motionOptions: { id: MotionPreference; label: string; desc: string }[] = [
  { id: 'off', label: '关闭', desc: '无动画' },
  { id: 'reduced', label: '减弱', desc: '最少动效' },
  { id: 'standard', label: '标准', desc: '完整动画' },
]

const morandiThemes = getMandiThemes()

onMounted(() => {
  loadPlatforms()
  if (isCustomColor()) {
    customColorInput.value = settings.themeColor.startsWith('#') ? settings.themeColor : '#58a4f6'
  }
  scrollToAnchor()
})

// Watch for anchor changes (e.g., when navigating from error link)
watch(() => props.anchor, () => {
  nextTick(scrollToAnchor)
})

function scrollToAnchor() {
  if (props.anchor) {
    // Navigate to general section first
    activeSection.value = 'general'
    // Then scroll to the element
    nextTick(() => {
      const el = document.getElementById(props.anchor!)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Add highlight effect
        el.classList.add('highlight-section')
        setTimeout(() => el.classList.remove('highlight-section'), 2000)
      }
    })
  }
}

function loadPlatforms() {
  const saved = storage.getPlatformConfigs()
  platforms.value = defaultPlatforms.map((p) => {
    const savedConfig = saved.find((c) => c.id === p.id)
    return {
      ...p,
      customPath: savedConfig?.customPath || p.customPath,
      customProjectPath: savedConfig?.customProjectPath || p.customProjectPath,
      enabled: savedConfig ? savedConfig.enabled : p.enabled,
    }
  })
}

function setThemeMode(mode: ThemeMode) {
  updateSettings({ themeMode: mode })
}

function setFontSize(size: FontSize) {
  updateSettings({ fontSize: size })
}

function setMotion(pref: MotionPreference) {
  updateSettings({ motionPreference: pref })
}

function setCompactMode(val: boolean) {
  updateSettings({ compactMode: val })
}

function savePlatforms() {
  storage.savePlatformConfigs(platforms.value)
}

function togglePlatformEnabled(platform: PlatformInfo) {
  platform.enabled = !platform.enabled
  savePlatforms()
}

function detectAgent(platform: PlatformInfo): boolean {
  if (platform.rootDir) {
    const osKey = window.services.isWindows() ? 'win32' : window.services.isMacOS() ? 'darwin' : 'linux'
    const root = (platform.rootDir[osKey as keyof typeof platform.rootDir] || platform.rootDir.linux).replace(/^~/, window.services.homeDir())
    return window.services.pathExists(root)
  }
  const p = platform.defaultPath || platform.projectPath || ''
  if (!p) return false
  return window.services.pathExists(p.replace(/^~/, window.services.homeDir()))
}

function detectAllAgents() {
  let count = 0
  for (const p of platforms.value) {
    if (detectAgent(p)) count++
  }
}

function setThemeColor(id: string) {
  if (id === 'custom') {
    if (!settings.themeColor.startsWith('#')) {
      updateSettings({ themeColor: customColorInput.value || '#58a4f6' })
    }
  } else {
    updateSettings({ themeColor: id })
  }
}

function setCustomColor(hex: string) {
  const cleaned = hex.startsWith('#') ? hex : '#' + hex
  customColorInput.value = cleaned
  updateSettings({ themeColor: cleaned })
}

function isCustomColor(): boolean {
  return settings.themeColor.startsWith('#') || settings.themeColor === 'custom'
}

function isThemeColorActive(id: string): boolean {
  return settings.themeColor === id
}

function getThemePreviewHue(id: string): number {
  const t = MORANDI_THEMES.find((t) => t.id === id)
  return t ? t.hue : 210
}

function getThemePreviewSat(id: string): number {
  const t = MORANDI_THEMES.find((t) => t.id === id)
  return t ? t.saturation : 35
}

const detectedCount = computed(() => platforms.value.filter(p => detectAgent(p)).length)

// Platform ordering
const defaultPlatformOrder = defaultPlatforms.map(p => p.id)
const savedOrder = storage.getPlatformOrder()
const platformOrder = ref<string[]>(savedOrder.length ? savedOrder : [...defaultPlatformOrder])

function savePlatformOrder() {
  storage.savePlatformOrder(platformOrder.value)
}

function movePlatformUp(index: number) {
  if (index <= 0) return
  const newOrder = [...platformOrder.value]
  ;[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
  platformOrder.value = newOrder
  savePlatformOrder()
}

function movePlatformDown(index: number) {
  if (index >= platformOrder.value.length - 1) return
  const newOrder = [...platformOrder.value]
  ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
  platformOrder.value = newOrder
  savePlatformOrder()
}

function resetPlatformOrder() {
  platformOrder.value = [...defaultPlatformOrder]
  savePlatformOrder()
}

const sortedPlatforms = computed(() => {
  const platformMap = new Map(platforms.value.map(p => [p.id, p]))
  return platformOrder.value
    .map(id => platformMap.get(id))
    .filter((p): p is PlatformInfo => p !== undefined)
})

// Drag and drop with auto-scroll
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
let autoScrollRafId: number | null = null
let lastDragY = 0
let scrollContainer: HTMLElement | null = null

function startAutoScroll() {
  stopAutoScroll()
  scrollContainer = document.querySelector('.settings-scroll')
  if (!scrollContainer) return

  const SCROLL_ZONE = 80
  const MAX_SCROLL_SPEED = 12

  function tick() {
    if (dragIndex.value === null) { stopAutoScroll(); return }
    const rect = scrollContainer!.getBoundingClientRect()
    const y = lastDragY
    const distFromTop = y - rect.top
    const distFromBottom = rect.bottom - y

    if (distFromTop < SCROLL_ZONE && distFromTop > 0) {
      const speed = Math.round(MAX_SCROLL_SPEED * (1 - distFromTop / SCROLL_ZONE))
      scrollContainer!.scrollTop -= speed
    } else if (distFromBottom < SCROLL_ZONE && distFromBottom > 0) {
      const speed = Math.round(MAX_SCROLL_SPEED * (1 - distFromBottom / SCROLL_ZONE))
      scrollContainer!.scrollTop += speed
    }
    autoScrollRafId = requestAnimationFrame(tick)
  }
  autoScrollRafId = requestAnimationFrame(tick)
}

function stopAutoScroll() {
  if (autoScrollRafId) {
    cancelAnimationFrame(autoScrollRafId)
    autoScrollRafId = null
  }
}

function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index
  lastDragY = event.clientY
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', index.toString())
  }
  startAutoScroll()
}

function onDragOver(index: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  lastDragY = event.clientY
  dragOverIndex.value = index
}

function onDragLeave() {
  dragOverIndex.value = null
}

function onDrop(index: number, event: DragEvent) {
  event.preventDefault()
  stopAutoScroll()

  if (dragIndex.value === null || dragIndex.value === index) return

  const newOrder = [...platformOrder.value]
  const draggedItem = newOrder.splice(dragIndex.value, 1)[0]
  newOrder.splice(index, 0, draggedItem)
  platformOrder.value = newOrder
  savePlatformOrder()

  dragIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  stopAutoScroll()
  dragIndex.value = null
  dragOverIndex.value = null
}

function getPlatformOsPath(platform: PlatformInfo): string {
  const osKey = window.services.isWindows() ? 'win32' : 'darwin'
  const rootDir = platform.rootDir?.[osKey] || platform.rootDir?.linux || ''
  return rootDir.replace(/~/g, '%USERPROFILE%').replace(/\//g, '\\')
}

function onBgOpacity(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  const el = document.querySelector('.app-background') as HTMLElement | null
  if (el) el.style.opacity = String(val / 100)
  updateSettings({ backgroundOpacity: val })
}

function onBgBlur(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  const el = document.querySelector('.app-background') as HTMLElement | null
  if (el) el.style.filter = val > 0 ? `blur(${val}px)` : ''
  updateSettings({ backgroundBlur: val })
}

async function uploadBackground() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      updateSettings({
        backgroundImage: reader.result as string,
        backgroundImageEnabled: true,
      })
    }
    reader.onerror = () => { }
    reader.readAsDataURL(file)
  }
  input.click()
}

function clearBackground() {
  updateSettings({ backgroundImage: '', backgroundImageEnabled: false })
}

function handleToggleBackground() {
  updateSettings({ backgroundImageEnabled: !settings.backgroundImageEnabled })
}

// === AI Model Management ===
const showAddModelModal = ref(false)
const addModelTargetIndex = ref<number | null>(null)
const newModelName = ref('')
const newModelCustomName = ref('')

const showModelModal = ref(false)
const editingModelIndex = ref<number | null>(null)
const modelForm = ref<ModelConfig>({
  id: '', name: '', provider: 'openai', baseUrl: '', apiPath: '', apiKeys: [], model: '', isDefault: false, isBuiltin: false, enabled: true, models: [], icon: '',
})
const showIconPicker = ref(false)
const iconSearchQuery = ref('')
const iconSearchRef = ref<HTMLInputElement>()
const editingIconProviderId = ref<string | null>(null)
watch(showIconPicker, (v) => {
  if (v) {
    iconSearchQuery.value = ''
    nextTick(() => iconSearchRef.value?.focus())
  }
})
const filteredIcons = computed(() => {
  const q = iconSearchQuery.value.toLowerCase()
  const list = q ? AVAILABLE_ICONS.filter(name => name.includes(q)) : AVAILABLE_ICONS
  return list.filter(name => name !== 'openai')
})
const defaultProviderIcon = computed(() => {
  const providerId = editingIconProviderId.value
    ? (settings.aiModels.find(m => m.id === editingIconProviderId.value)?.provider || '')
    : modelForm.value.provider
  return getProviderInfo(providerId)?.icon || 'openai'
})
const showFetchModal = ref(false)
const fetchModelsResult = ref<{ id: string; name: string; owned_by?: string }[]>([])
const fetchLoading = ref(false)
const fetchError = ref('')
const selectedFetchIds = ref<Set<string>>(new Set())
const fetchTargetIndex = ref<number | null>(null)
const expandedFetchGroups = ref<Set<string>>(new Set())
const fetchSearchQuery = ref('')
const fetchFilteredModels = computed(() => {
  if (!fetchSearchQuery.value.trim()) return fetchModelsResult.value
  const q = fetchSearchQuery.value.toLowerCase()
  return fetchModelsResult.value.filter(m => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q) || m.owned_by?.toLowerCase().includes(q))
})
const fetchModelGroups = computed(() => {
  const groups: Record<string, { name: string; models: typeof fetchModelsResult.value }> = {}
  for (const m of fetchFilteredModels.value) {
    const g = m.owned_by || '其他'
    if (!groups[g]) groups[g] = { name: g, models: [] }
    groups[g].models.push(m)
  }
  return Object.values(groups).sort((a, b) => a.name === '其他' ? 1 : b.name === '其他' ? -1 : a.name.localeCompare(b.name))
})
function toggleFetchGroup(name: string) {
  const s = new Set(expandedFetchGroups.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  expandedFetchGroups.value = s
}
function toggleAllFetchGroups() {
  const allGroupNames = fetchModelGroups.value.map(g => g.name)
  const allExpanded = allGroupNames.every(n => expandedFetchGroups.value.has(n))
  expandedFetchGroups.value = allExpanded ? new Set() : new Set(allGroupNames)
}
function handleFetchModelToggle(id: string) {
  const s = new Set(selectedFetchIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedFetchIds.value = s
}
function toggleFetchGroupSelection(group: { name: string; models: { id: string }[] }) {
  const allSelected = group.models.every(m => selectedFetchIds.value.has(m.id))
  const s = new Set(selectedFetchIds.value)
  for (const m of group.models) {
    if (allSelected) s.delete(m.id)
    else s.add(m.id)
  }
  selectedFetchIds.value = s
}
const GROUP_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#a78bfa', '#fbbf24', '#34d399', '#f87171', '#818cf8', '#fb923c', '#22d3ee']
function getGroupColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length]
}
const testResult = ref<{ index: number; success: boolean; message: string } | null>(null)
const modelTestResults = ref<Record<string, { success: boolean; message: string } | 'loading'>>({})

const showApiKeyModal = ref(false)
const editingKeyIndex = ref<number | null>(null)
const editingProviderIndex = ref<number | null>(null)
const apiKeyForm = ref({ key: '' })

function maskKey(key: string): string {
  if (!key) return '未配置'
  if (key.length <= 4) return key + '*'.repeat(12)
  return key.substring(0, 4) + '*'.repeat(Math.min(key.length - 4, 12))
}

function maskUrl(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.protocol + '//' + u.hostname + (u.port ? ':' + u.port : '') + (u.pathname.length > 1 ? u.pathname.substring(0, 20) + '...' : '')
  } catch {
    return url.length > 30 ? url.substring(0, 30) + '...' : url
  }
}

function getModelUrl(model: any): string {
  const base = (model.baseUrl || '').replace(/\/+$/, '')
  const path = model.apiPath || '/v1/chat/completions'
  return `${base}${path}`
}

function getModelsEndpoint(model: any): string {
  const base = (model.baseUrl || '').replace(/\/+$/, '')
  return `${base}/v1/models`
}

function isChatModel(model: any): boolean {
  const name = (model.name || '').toLowerCase()
  return name.includes('chat') || name.includes('gpt') || name.includes('claude') || name.includes('gemini') || name.includes('deepseek') || name.includes('qwen') || name.includes('glm')
}

function isImageModel(model: any): boolean {
  const name = (model.name || '').toLowerCase()
  return name.includes('image') || name.includes('dall-e') || name.includes('stable') || name.includes('midjourney') || name.includes('flux')
}

function getModelContextLength(model: any): string {
  const name = (model.name || '').toLowerCase()
  if (name.includes('128k') || name.includes('128k')) return '128K'
  if (name.includes('32k')) return '32K'
  if (name.includes('16k')) return '16K'
  if (name.includes('8k')) return '8K'
  if (name.includes('4k')) return '4K'
  if (name.includes('1m') || name.includes('million')) return '1M'
  return ''
}

function expandAllGroups(providerId: string) {
  const provider = settings.aiModels.find(m => m.id === providerId)
  if (provider?.models) {
    const groups = groupModels(provider.models)
    const newSet = new Set(groups.map(g => g.name))
    expandedGroups.value[providerId] = newSet
  }
}

function toggleAllModels(provider: any) {
  if (!provider.models) return
  const allEnabled = provider.models.every((m: any) => m.enabled)
  provider.models.forEach((m: any) => m.enabled = !allEnabled)
  updateSettings({ aiModels: [...settings.aiModels] })
}

function startEditApiKey(provider: any) {
  showApiKey.value[provider.id] = true
}

function addApiKey(providerIndex: number) {
  editingProviderIndex.value = providerIndex
  editingKeyIndex.value = null
  apiKeyForm.value = { key: '' }
  showApiKeyModal.value = true
}

function editApiKey(providerIndex: number, keyIndex: number) {
  editingProviderIndex.value = providerIndex
  editingKeyIndex.value = keyIndex
  apiKeyForm.value = { key: settings.aiModels[providerIndex].apiKeys[keyIndex].key }
  showApiKeyModal.value = true
}

function saveApiKey() {
  if (editingProviderIndex.value === null) return
  const provider = settings.aiModels[editingProviderIndex.value]
  if (!provider.apiKeys) provider.apiKeys = []

  if (editingKeyIndex.value !== null) {
    provider.apiKeys[editingKeyIndex.value].key = apiKeyForm.value.key
  } else {
    const hasEnabled = provider.apiKeys.some(k => k.enabled)
    provider.apiKeys.push({
      id: 'key-' + Date.now(),
      key: apiKeyForm.value.key,
      enabled: !hasEnabled,
    })
  }
  updateSettings({ aiModels: [...settings.aiModels] })
  showApiKeyModal.value = false
  showToast('密钥已保存', 'success')
}

function deleteApiKey(providerIndex: number, keyIndex: number) {
  const provider = settings.aiModels[providerIndex]
  const wasEnabled = provider.apiKeys[keyIndex].enabled
  provider.apiKeys.splice(keyIndex, 1)
  if (wasEnabled && provider.apiKeys.length > 0) {
    provider.apiKeys[0].enabled = true
  }
  updateSettings({ aiModels: [...settings.aiModels] })
  confirmDeleteApiKey.value = null
  showToast('密钥已删除', 'success')
}

function toggleApiKeyEnabled(providerIndex: number, keyIndex: number) {
  const provider = settings.aiModels[providerIndex]
  const target = provider.apiKeys[keyIndex]
  target.enabled = !target.enabled
  updateSettings({ aiModels: [...settings.aiModels] })
}

function getActiveApiKey(provider: any): string {
  return provider.apiKeys?.find((k: any) => k.enabled)?.key || ''
}

const showApiKey = ref<Record<string, boolean>>({})
const expandedSections = ref<Record<string, { apiInfo: boolean; models: boolean }>>({})

function openAddModel() {
  editingModelIndex.value = null
  modelForm.value = {
    id: 'custom-' + Date.now(),
    name: '',
    provider: 'openai',
    baseUrl: '',
    apiPath: '',
    apiKeys: [],
    model: '',
    isDefault: false,
    isBuiltin: false,
    enabled: true,
    models: [],
    icon: '',
  }
  applyProviderPreset()
  showModelModal.value = true
}

function openEditModel(index: number) {
  editingModelIndex.value = index
  const m = settings.aiModels[index]
  modelForm.value = { ...m, models: m.models ? [...m.models] : [], apiKeys: m.apiKeys ? [...m.apiKeys] : [] }
  showModelModal.value = true
}

function applyProviderPreset() {
  const info = getProviderInfo(modelForm.value.provider)
  if (info) {
    modelForm.value.baseUrl = info.defaultBaseUrl
    modelForm.value.apiPath = info.defaultApiPath
    modelForm.value.icon = info.icon
  }
}

function saveModel() {
  if (!modelForm.value.name.trim()) return
  if (!modelForm.value.provider) {
    showToast('请选择供应商类型', 'error')
    return
  }
  // Auto-fill API path from preset if empty
  if (!modelForm.value.apiPath.trim()) {
    const info = getProviderInfo(modelForm.value.provider)
    if (info) {
      modelForm.value.apiPath = info.defaultApiPath
    }
  }
  const models = [...settings.aiModels]
  if (editingModelIndex.value !== null) {
    models[editingModelIndex.value] = { ...modelForm.value }
  } else {
    if (!models.length) modelForm.value.isDefault = true
    models.push({ ...modelForm.value })
  }
  updateSettings({ aiModels: models })
  showModelModal.value = false
  showToast(editingModelIndex.value !== null ? '供应商已更新' : '供应商已添加', 'success')
}

function deleteModel(index: number) {
  const models = settings.aiModels.filter((_, i) => i !== index)
  if (models.length && !models.some((m) => m.isDefault)) {
    models[0].isDefault = true
  }
  if (settings.translationModelId === settings.aiModels[index]?.id) {
    updateSettings({ aiModels: models, translationModelId: models.find((m) => m.isDefault)?.id || '' })
  } else {
    updateSettings({ aiModels: models })
  }
}

function deleteModelFromProvider(providerIndex: number, modelId: string) {
  const models = [...settings.aiModels]
  const provider = { ...models[providerIndex] }
  provider.models = (provider.models || []).filter((m) => m.id !== modelId)
  models[providerIndex] = provider
  if (settings.translationModelId === modelId) {
    updateSettings({ aiModels: models, translationModelId: '' })
  } else {
    updateSettings({ aiModels: models })
  }
  confirmDeleteModel.value = null
}

function toggleGroupModels(providerIndex: number, groupName: string) {
  const models = [...settings.aiModels]
  const m = { ...models[providerIndex] }
  const groupModels = (m.models || []).filter(mm => (mm.owned_by || '其他') === groupName)
  const allEnabled = groupModels.every(mm => mm.enabled)
  const newEnabled = !allEnabled
  m.models = (m.models || []).map(mm =>
    (mm.owned_by || '其他') === groupName ? { ...mm, enabled: newEnabled } : mm,
  )
  models[providerIndex] = m
  const patch: Partial<AppSettings> = { aiModels: models }
  if (!newEnabled && settings.translationModelId && groupModels.some(mm => mm.id === settings.translationModelId)) {
    patch.translationModelId = ''
  }
  updateSettings(patch)
}

function deleteGroupModels(providerIndex: number, groupName: string) {
  const models = [...settings.aiModels]
  const m = { ...models[providerIndex] }
  const deletedIds = new Set((m.models || []).filter(mm => (mm.owned_by || '其他') === groupName).map(mm => mm.id))
  m.models = (m.models || []).filter(mm => (mm.owned_by || '其他') !== groupName)
  models[providerIndex] = m
  const patch: Partial<AppSettings> = { aiModels: models }
  if (settings.translationModelId && deletedIds.has(settings.translationModelId)) {
    patch.translationModelId = ''
  }
  updateSettings(patch)
  confirmDeleteGroup.value = null
}

function deleteProvider(id: string) {
  const provider = settings.aiModels.find(m => m.id === id)
  if (provider?.isBuiltin) {
    showToast('内置供应商不能删除', 'error')
    return
  }
  const models = settings.aiModels.filter(m => m.id !== id)
  if (models.length && !models.some((m) => m.isDefault)) {
    models[0].isDefault = true
  }
  if (settings.translationModelId === id) {
    updateSettings({ aiModels: models, translationModelId: models.find((m) => m.isDefault)?.id || '' })
  } else {
    updateSettings({ aiModels: models })
  }
  confirmDeleteProviderId.value = null
  showToast('供应商已删除', 'success')
}

function doDeleteApiKey() {
  const key = confirmDeleteApiKey.value
  confirmDeleteApiKey.value = null
  if (!key) return
  const lastDash = key.lastIndexOf('-')
  const providerId = key.substring(0, lastDash)
  const ki = parseInt(key.substring(lastDash + 1))
  const idx = settings.aiModels.findIndex(m => m.id === providerId)
  if (idx >= 0) deleteApiKey(idx, ki)
}

function doDeleteGroup() {
  const key = confirmDeleteGroup.value
  confirmDeleteGroup.value = null
  if (!key) return
  const lastDash = key.lastIndexOf('-')
  const providerId = key.substring(0, lastDash)
  const groupName = key.substring(lastDash + 1)
  const idx = settings.aiModels.findIndex(m => m.id === providerId)
  if (idx >= 0) deleteGroupModels(idx, groupName)
}

function doDeleteModel() {
  const modelId = confirmDeleteModel.value
  confirmDeleteModel.value = null
  if (!modelId) return
  settings.aiModels.forEach((m, i) => {
    if (m.models?.some((mm: any) => mm.id === modelId)) deleteModelFromProvider(i, modelId)
  })
}

function setDefaultModel(index: number) {
  const models = settings.aiModels.map((m, i) => ({ ...m, isDefault: i === index }))
  updateSettings({ aiModels: models })
}

function setTranslationModel(modelId: string) {
  updateSettings({ translationModelId: modelId })
}

function getTranslationModelName(): string {
  if (!settings.translationModelId) {
    return '未配置'
  }
  
  // 先按供应商 ID 查找
  const byProvider = settings.aiModels.find(m => m.id === settings.translationModelId)
  if (byProvider) {
    return `${byProvider.name || getProviderInfo(byProvider.provider)?.name} (供应商)`
  }
  // 遍历所有供应商的模型列表查找
  for (const provider of settings.aiModels) {
    const model = provider.models?.find(m => m.id === settings.translationModelId)
    if (model) {
      return `${model.name || model.id} (${provider.name || getProviderInfo(provider.provider)?.name})`
    }
  }
  return '未找到'
}

async function openFetchModels(index: number) {
  let baseUrl = ''
  let apiKey = ''
  if (index === -1) {
    baseUrl = modelForm.value.baseUrl
    apiKey = modelForm.value.apiKeys?.find(k => k.enabled)?.key || ''
  } else {
    const m = settings.aiModels[index]
    if (!m) return
    baseUrl = m.baseUrl
    apiKey = m.apiKeys?.find(k => k.enabled)?.key || ''
  }
  if (!baseUrl || !apiKey) return
  fetchTargetIndex.value = index
  fetchLoading.value = true
  fetchError.value = ''
  const existingModels = index >= 0 ? settings.aiModels[index]?.models?.filter(m => m.enabled).map(m => m.id) : []
  selectedFetchIds.value = new Set(existingModels || [])
  try {
    const result = await fetchAvailableModels(baseUrl, apiKey)
    if (result.success) {
      fetchModelsResult.value = result.models
      expandedFetchGroups.value = new Set(result.models.map(m => m.owned_by || '其他'))
      showFetchModal.value = true
    } else {
      fetchError.value = result.error || '获取失败'
      showToast(fetchError.value, 'error')
    }
  } catch (err: unknown) {
    fetchError.value = (err as any)?.message || '获取失败'
    showToast(fetchError.value, 'error')
  }
  fetchLoading.value = false
}

function confirmFetchModels() {
  if (!selectedFetchIds.value.size || fetchTargetIndex.value === null) return
  const selectedIds = Array.from(selectedFetchIds.value)
  if (fetchTargetIndex.value === -1) {
    const firstSelected = fetchModelsResult.value.find((m) => m.id === selectedIds[0])
    modelForm.value.model = firstSelected?.id || selectedIds[0]
    if (!modelForm.value.name) modelForm.value.name = firstSelected?.name || selectedIds[0]
    modelForm.value.models = fetchModelsResult.value
      .filter((m) => selectedIds.includes(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        enabled: true,
        owned_by: m.owned_by,
      }))
  } else {
    const models = [...settings.aiModels]
    const existing = models[fetchTargetIndex.value]
    const selectedModels = fetchModelsResult.value
      .filter((m) => selectedIds.includes(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        enabled: true,
        owned_by: m.owned_by,
      }))
    models[fetchTargetIndex.value] = {
      ...existing,
      models: selectedModels,
    }
    if (!existing.model && selectedModels.length) {
      models[fetchTargetIndex.value].model = selectedModels[0].id
    }
    updateSettings({ aiModels: models })
  }
  showFetchModal.value = false
}

async function testModelConnection(index: number) {
  const m = settings.aiModels[index]
  if (!m.baseUrl || !m.apiKeys?.length || !m.model) return
  testResult.value = null
  try {
    await chatCompletion(m, [{ role: 'user', content: 'Reply with exactly: OK' }], { temperature: 0, maxTokens: 8 })
    testResult.value = { index, success: true, message: '连接成功 ✓' }
  } catch (err: unknown) {
    const errMsg = (err as any)?.message || '连接失败'
    const msg = errMsg === 'AI_AUTH_ERROR' ? '认证失败，请检查 API Key' : errMsg
    testResult.value = { index, success: false, message: msg }
  }
  setTimeout(() => { testResult.value = null }, 5000)
}

async function testSingleModel(providerIndex: number, modelId: string) {
  const key = `${providerIndex}-${modelId}`
  const m = settings.aiModels[providerIndex]
  if (!m.baseUrl || !m.apiKeys?.length) return
  modelTestResults.value = { ...modelTestResults.value, [key]: 'loading' }
  try {
    const testConfig = { ...m, model: modelId }
    await chatCompletion(testConfig, [{ role: 'user', content: 'Reply with exactly: OK' }], { temperature: 0, maxTokens: 8 })
    modelTestResults.value = { ...modelTestResults.value, [key]: { success: true, message: '可用 ✓' } }
  } catch (err: unknown) {
    const errMsg = (err as any)?.message || '连接失败'
    const msg = errMsg === 'AI_AUTH_ERROR' ? '认证失败' : errMsg
    modelTestResults.value = { ...modelTestResults.value, [key]: { success: false, message: msg } }
  }
  setTimeout(() => {
    const copy = { ...modelTestResults.value }
    delete copy[key]
    modelTestResults.value = copy
  }, 5000)
}

async function testAllModels(providerIndex: number) {
  const m = settings.aiModels[providerIndex]
  if (!m.baseUrl || !m.apiKeys?.length || !m.models?.length) return
  for (const model of m.models) {
    testSingleModel(providerIndex, model.id)
  }
}

function getModelTestKey(providerIndex: number, modelId: string): string {
  return `${providerIndex}-${modelId}`
}

function getModelTestResult(providerIndex: number, modelId: string) {
  return modelTestResults.value[getModelTestKey(providerIndex, modelId)]
}

function isModelTestLoading(providerIndex: number, modelId: string): boolean {
  return getModelTestResult(providerIndex, modelId) === 'loading'
}

function isModelTestSuccess(providerIndex: number, modelId: string): boolean {
  const r = getModelTestResult(providerIndex, modelId)
  return r !== undefined && r !== 'loading' && r.success === true
}

function isModelTestFail(providerIndex: number, modelId: string): boolean {
  const r = getModelTestResult(providerIndex, modelId)
  return r !== undefined && r !== 'loading' && r.success === false
}

function restoreBaseUrl(index: number) {
  const m = settings.aiModels[index]
  const info = getProviderInfo(m.provider)
  if (info) {
    const models = [...settings.aiModels]
    models[index] = { ...m, baseUrl: info.defaultBaseUrl, apiPath: info.defaultApiPath }
    updateSettings({ aiModels: models })
  }
}

function toggleModelEnabled(modelIndex: number, modelId: string) {
  const models = [...settings.aiModels]
  const m = { ...models[modelIndex] }
  const modelList = m.models ? [...m.models] : []
  const idx = modelList.findIndex((item) => item.id === modelId)
  if (idx >= 0) {
    modelList[idx] = { ...modelList[idx], enabled: !modelList[idx].enabled }
    m.models = modelList
    models[modelIndex] = m
    const patch: Partial<AppSettings> = { aiModels: models }
    if (!modelList[idx].enabled && settings.translationModelId === modelId) {
      patch.translationModelId = ''
    }
    updateSettings(patch)
  }
}

function toggleApiKeyVisibility(modelId: string) {
  showApiKey.value = { ...showApiKey.value, [modelId]: !showApiKey.value[modelId] }
}

async function copyApiKey(apiKey: string) {
  try {
    await navigator.clipboard.writeText(apiKey)
    showToast('已复制到剪贴板', 'success')
  } catch {
    showToast('复制失败', 'error')
  }
}

function toggleExpandedSection(modelId: string, section: 'apiInfo' | 'models') {
  const current = expandedSections.value[modelId] || { apiInfo: false, models: false }
  expandedSections.value = {
    ...expandedSections.value,
    [modelId]: { ...current, [section]: !current[section] },
  }
}

const enabledProviders = computed(() => settings.aiModels.filter(m => m.enabled && m.apiKeys?.some(k => k.enabled) && m.models?.length))
const allEnabledProviders = computed(() => settings.aiModels.filter(m => m.enabled && m.models?.length))
const hasValidTranslationModel = computed(() => {
  if (!settings.translationModelId) return false
  for (const provider of settings.aiModels) {
    if (provider.id === settings.translationModelId && provider.enabled) return true
    if (provider.models?.some(m => m.id === settings.translationModelId && m.enabled && provider.enabled)) return true
  }
  return false
})
const pendingProviders = computed(() => settings.aiModels.filter(m => m.enabled && (!m.apiKeys?.some(k => k.enabled) || !m.models?.length)))
const disabledProviders = computed(() => settings.aiModels.filter(m => !m.enabled))

function getModelIndex(id: string): number {
  return settings.aiModels.findIndex(m => m.id === id)
}

function toggleProviderEnabled(provider: ModelConfig) {
  const models = [...settings.aiModels]
  const idx = models.findIndex(m => m.id === provider.id)
  if (idx >= 0) {
    models[idx] = { ...models[idx], enabled: !models[idx].enabled }
    updateSettings({ aiModels: models })
  }
}

function openIconPickerForProvider(providerId: string) {
  editingIconProviderId.value = providerId
  editingModelIndex.value = null
  showIconPicker.value = true
}

function onIconPickerSelect(iconName: string) {
  if (editingIconProviderId.value) {
    const models = [...settings.aiModels]
    const idx = models.findIndex(m => m.id === editingIconProviderId.value)
    if (idx >= 0) {
      models[idx] = { ...models[idx], icon: iconName }
      updateSettings({ aiModels: models })
    }
    editingIconProviderId.value = null
  } else if (editingModelIndex.value !== null) {
    modelForm.value.icon = iconName
  }
  showIconPicker.value = false
}

function openAddModelModal(providerIndex: number) {
  addModelTargetIndex.value = providerIndex
  newModelName.value = ''
  newModelCustomName.value = ''
  showAddModelModal.value = true
}

function saveNewModel() {
  if (!newModelName.value.trim() || addModelTargetIndex.value === null) return
  const models = [...settings.aiModels]
  const provider = models[addModelTargetIndex.value]
  const modelList = provider.models ? [...provider.models] : []
  const modelId = newModelName.value.trim()
  const existingIndex = modelList.findIndex(m => m.id === modelId)
  if (existingIndex >= 0) {
    showToast('模型已存在', 'warning')
    return
  }
  modelList.push({
    id: modelId,
    name: newModelCustomName.value.trim() || modelId,
    enabled: true,
  })
  models[addModelTargetIndex.value] = { ...provider, models: modelList }
  updateSettings({ aiModels: models })
  showAddModelModal.value = false
  showToast('模型已添加', 'success')
}

interface ModelGroup {
  name: string
  models: Array<{ id: string; name: string; enabled: boolean; owned_by?: string; capabilities?: string[] }>
}

const expandedGroups = ref<Record<string, Set<string>>>({})

function toggleGroup(providerId: string, groupName: string) {
  const current = expandedGroups.value[providerId] || new Set<string>()
  const newSet = new Set(current)
  if (newSet.has(groupName)) {
    newSet.delete(groupName)
  } else {
    newSet.add(groupName)
  }
  expandedGroups.value = { ...expandedGroups.value, [providerId]: newSet }
}

function groupModels(models: Array<{ id: string; name: string; enabled: boolean; owned_by?: string; capabilities?: string[] }>): ModelGroup[] {
  const groups: Record<string, ModelGroup> = {}

  for (const model of models) {
    const groupName = model.owned_by || '其他'

    if (!groups[groupName]) {
      groups[groupName] = { name: groupName, models: [] }
    }
    groups[groupName].models.push(model)
  }

  // Sort groups: named groups first (alphabetically), then "其他" last
  const sortedGroups = Object.values(groups).sort((a, b) => {
    if (a.name === '其他') return 1
    if (b.name === '其他') return -1
    return a.name.localeCompare(b.name)
  })

  return sortedGroups
}
</script>

<template>
  <div class="settings-layout">
    <aside class="settings-sidebar" :style="{ width: sidebarWidth + 'px' }">
      <div class="settings-sidebar-header">
        <h2>设置</h2>
      </div>
      <nav class="settings-nav">
        <button
          v-for="s in sections"
          :key="s.id"
          class="settings-nav-item"
          :class="{ active: activeSection === s.id }"
          @click="activeSection = s.id"
        >
          <span class="settings-nav-icon">{{ s.icon }}</span>
          <span class="settings-nav-label">{{ s.label }}</span>
        </button>
      </nav>
      <div class="settings-sidebar-resize" @mousedown="startSidebarResize" @touchstart.prevent="startSidebarResize"></div>
    </aside>

    <div class="settings-content">
      <!-- ===== APPEARANCE ===== -->
      <template v-if="activeSection === 'appearance'">
        <div class="settings-scroll">
          <h1 class="settings-page-title">显示设置</h1>
          <p class="settings-page-desc">自定义应用的外观和视觉效果。</p>

          <!-- Theme Mode -->
          <div class="setting-section">
            <h3 class="setting-section-title">主题模式</h3>
            <div class="setting-card">
              <div class="segmented-control">
                <button
                  v-for="m in themeModes"
                  :key="m.id"
                  class="segment-btn"
                  :class="{ active: settings.themeMode === m.id }"
                  @click="setThemeMode(m.id)"
                >
                  <span class="segment-icon">{{ m.icon }}</span>
                  <span>{{ m.label }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Theme Color -->
          <div class="setting-section">
            <h3 class="setting-section-title">主题颜色</h3>
            <div class="setting-card">
              <div class="color-name-bar">
                <template v-if="isCustomColor()">
                  {{ '自定义' }} {{ settings.themeColor }}
                </template>
                <template v-else>
                  {{ morandiThemes.find(t => t.id === settings.themeColor)?.name || '' }}
                </template>
              </div>
              <div class="color-swatches-row">
                <div v-for="t in morandiThemes" :key="t.id" class="color-swatch-cell">
                  <button
                    class="color-swatch-btn"
                    :class="{ active: isThemeColorActive(t.id) }"
                    :style="{ background: `hsl(${t.hue}, ${t.saturation}%, 55%)` }"
                    :title="t.name"
                    @click="setThemeColor(t.id)"
                  >
                    <svg v-if="isThemeColorActive(t.id)" class="swatch-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                </div>
                <div class="color-swatch-cell">
                  <button
                    class="color-swatch-btn"
                    :class="{ active: isCustomColor() }"
                    :style="{ background: settings.themeColor.startsWith('#') ? settings.themeColor : '#58a4f6' }"
                    title="自定义"
                    @click="setThemeColor('custom')"
                  >
                    <svg v-if="isCustomColor()" class="swatch-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div v-if="isCustomColor()" class="custom-color-panel">
                <div class="custom-color-header">
                  <div>
                    <div class="custom-color-title">自定义颜色</div>
                    <div class="custom-color-desc">选择任意颜色并全局应用</div>
                  </div>
                  <div class="custom-color-inputs">
                    <input
                      type="color"
                      :value="settings.themeColor.startsWith('#') ? settings.themeColor : '#58a4f6'"
                      @input="setCustomColor(($event.target as HTMLInputElement).value)"
                      class="color-picker-native"
                    />
                    <input
                      v-model="customColorInput"
                      @change="setCustomColor(customColorInput)"
                      class="color-hex-native"
                      placeholder="#58a4f6"
                    />
                  </div>
                </div>
                <div class="preview-strip">
                  <div class="preview-block primary" :style="{ background: `hsl(${hexToHsl(settings.themeColor)?.h || 210}, ${hexToHsl(settings.themeColor)?.s || 35}%, 55%)` }">
                    主色
                  </div>
                  <div class="preview-block accent" :style="{ background: `hsl(${hexToHsl(settings.themeColor)?.h || 210}, ${Math.round((hexToHsl(settings.themeColor)?.s || 35) * 0.5)}%, 94%)` }">
                    强调色
                  </div>
                  <div class="preview-block neutral">
                    中性色
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Font Size -->
          <div class="setting-section">
            <h3 class="setting-section-title">字体大小</h3>
            <div class="setting-card">
              <div class="option-grid">
                <button
                  v-for="f in fontSizeOptions"
                  :key="f.id"
                  class="option-btn"
                  :class="{ active: settings.fontSize === f.id }"
                  @click="setFontSize(f.id)"
                >
                  <span class="option-label">{{ f.label }}</span>
                  <span class="option-meta">{{ f.size }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Motion -->
          <div class="setting-section">
            <h3 class="setting-section-title">动画效果</h3>
            <div class="setting-card">
              <p class="setting-card-desc">控制应用中的动画量。"标准"会覆盖系统的"减少动效"设置。</p>
              <div class="option-grid">
                <button
                  v-for="m in motionOptions"
                  :key="m.id"
                  class="option-btn"
                  :class="{ active: settings.motionPreference === m.id }"
                  @click="setMotion(m.id)"
                >
                  <span class="option-label">{{ m.label }}</span>
                  <span class="option-meta">{{ m.desc }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Compact Mode -->
          <div class="setting-section">
            <h3 class="setting-section-title">紧凑模式</h3>
            <div class="setting-card">
              <div class="setting-row">
                <div class="setting-row-info">
                  <div class="setting-row-label">启用紧凑模式</div>
                  <div class="setting-row-desc">减少间距和内边距，显示更多内容</div>
                </div>
                <button
                  class="toggle-switch"
                  :class="{ on: settings.compactMode }"
                  @click="setCompactMode(!settings.compactMode)"
                >
                  <span class="toggle-thumb"></span>
                </button>
              </div>
            </div>
          </div>

          <!-- Background Image -->
          <div class="setting-section">
            <h3 class="setting-section-title">背景图片</h3>
            <div class="setting-card">
              <div class="bg-header">
                <div class="bg-header-left">
                  <div class="bg-header-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="bg-header-icon">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    {{ settings.backgroundImage ? '桌面背景' : '桌面背景' }}
                  </div>
                  <p class="bg-header-desc">选择一张本地图片作为应用背景。文件将保存在插件存储中，设置中仅保存引用。</p>
                </div>
                <div class="bg-header-actions">
                  <button class="bg-choose-btn" @click="uploadBackground">
                    {{ settings.backgroundImage ? '更换图片' : '选择图片' }}
                  </button>
                  <button
                    class="bg-toggle-btn"
                    :disabled="!settings.backgroundImage"
                    @click="handleToggleBackground"
                  >
                    {{ settings.backgroundImageEnabled ? '禁用' : '启用' }}
                  </button>
                </div>
              </div>

              <p v-if="settings.backgroundImage" class="bg-status-hint">
                {{ settings.backgroundImageEnabled ? '背景图片已启用。' : '背景图片已保存但当前已禁用。' }}
              </p>

              <div class="bg-preview-box">
                <div class="bg-preview-stage" :style="{ backgroundImage: `url(${settings.backgroundImage})`, opacity: settings.backgroundOpacity / 100, filter: settings.backgroundBlur > 0 ? `blur(${settings.backgroundBlur}px)` : '' }">
                  <div v-if="!settings.backgroundImage" class="bg-preview-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="bg-empty-icon">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>未选择背景图片</span>
                  </div>
                </div>
              </div>

              <div v-if="settings.backgroundImage" class="bg-sliders-box">
                <div class="bg-slider-group">
                  <div class="slider-header">
                    <label>背景可见度</label>
                    <span>{{ settings.backgroundOpacity }}%</span>
                  </div>
                  <input type="range" min="0" max="100" :value="settings.backgroundOpacity" @input="onBgOpacity($event)" class="slider" />
                </div>
                <div class="bg-slider-group">
                  <div class="slider-header">
                    <label>模糊强度</label>
                    <span>{{ settings.backgroundBlur }}px</span>
                  </div>
                  <input type="range" min="0" max="50" step="0.5" :value="settings.backgroundBlur" @input="onBgBlur($event)" class="slider" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== GENERAL ===== -->
      <template v-if="activeSection === 'general'">
        <div class="settings-scroll">
          <h1 class="settings-page-title">通用设置</h1>
          <p class="settings-page-desc">配置技能安装的默认行为和 GitHub 访问令牌。</p>

          <div class="setting-section">
            <h3 class="setting-section-title">安装模式</h3>
            <div class="setting-card">
              <div class="setting-row">
                <div class="setting-row-info">
                  <div class="setting-row-label">默认安装模式</div>
                  <div class="setting-row-desc">技能文件分发到 Agent 平台的方式</div>
                </div>
              </div>
              <div class="mode-grid">
                <button
                  class="mode-card"
                  :class="{ active: settings.defaultInstallMode === 'copy' }"
                  @click="updateSettings({ defaultInstallMode: 'copy' })"
                >
                  <span class="mode-icon">📄</span>
                  <span class="mode-name">复制</span>
                  <span class="mode-desc">每个平台独立副本</span>
                </button>
                <button
                  class="mode-card"
                  :class="{ active: settings.defaultInstallMode === 'symlink' }"
                  @click="updateSettings({ defaultInstallMode: 'symlink' })"
                >
                  <span class="mode-icon">🔗</span>
                  <span class="mode-name">软链接</span>
                  <span class="mode-desc">共享编辑，同步更新</span>
                </button>
              </div>
            </div>
          </div>

          <!-- GitHub -->
          <div id="github-token-section" class="setting-section">
            <h3 class="setting-section-title">GitHub 访问令牌</h3>
            <div class="setting-card">
              <div class="setting-row">
                <div class="setting-row-info">
                  <div class="setting-row-label">访问令牌</div>
                  <div class="setting-row-desc">将速率限制从 60 次/小时提高到 5000 次/小时。仅需 repo 读取权限。</div>
                </div>
              </div>
              <div class="token-row">
                <input
                  v-model="settings.githubToken"
                  :type="showToken ? 'text' : 'password'"
                  class="token-input"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  @change="updateSettings({ githubToken: settings.githubToken })"
                />
                <button class="token-toggle" @click="showToken = !showToken">
                  {{ showToken ? '隐藏' : '显示' }}
                </button>
              </div>
              <a class="token-link" href="https://github.com/settings/tokens/new?scopes=repo&description=skill-hub" target="_blank">
                创建个人访问令牌 →
              </a>
            </div>
          </div>

          <!-- Cleanup Unregistered Skills -->
          <div class="setting-section">
            <h3 class="setting-section-title">数据清理</h3>
            <div class="setting-card">
              <div class="setting-row">
                <div class="setting-row-info">
                  <div class="setting-row-label">清理未注册的技能</div>
                  <div class="setting-row-desc">删除 skills-repo 目录中未被注册的技能文件夹。已注册的技能会被保留。</div>
                </div>
                <button class="cleanup-btn" @click="openCleanupSelect">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  清理
                </button>
              </div>
              <div v-if="cleanupResult" class="cleanup-result">
                <span class="cleanup-result-icon">✓</span>
                已扫描并清理：发现 {{ cleanupResult.found }} 个，删除 {{ cleanupResult.deleted }} 个
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== AI 模型服务 ===== -->
      <template v-if="activeSection === 'ai'">
        <div class="settings-scroll">
          <h1 class="settings-page-title">模型服务</h1>
          <p class="settings-page-desc">配置 AI 模型服务用于翻译等功能。支持多个提供商，每个提供商可配置多个模型。</p>

          <div class="ai-model-toolbar">
            <button class="toolbar-btn primary" @click="openAddModel">+ 添加提供商</button>
          </div>

          <div class="ai-model-list">
            <div v-if="!settings.aiModels.length" class="ai-model-empty">
              还没有配置 AI 模型。点击上方按钮添加。
            </div>

            <!-- Enabled Providers -->
            <div v-if="enabledProviders.length" class="provider-group">
              <div class="provider-group-title">已启用</div>
              <div v-for="m in enabledProviders" :key="m.id" class="ai-model-provider-card">
                <div class="provider-card-header" @click="toggleExpandedSection(m.id, 'apiInfo')">
                  <div class="provider-card-left">
                    <span class="provider-card-icon clickable" @click.stop="openIconPickerForProvider(m.id)"><ProviderIcon :icon="m.icon || getProviderInfo(m.provider)?.icon" :size="20" /></span>
                    <span class="provider-card-name">{{ m.name || getProviderInfo(m.provider)?.name }}</span>
                  </div>
                  <div class="provider-card-right">
                    <button v-if="!m.isBuiltin" class="provider-delete-btn" @click.stop="confirmDeleteProviderId = m.id; confirmDeleteProviderName = m.name || getProviderInfo(m.provider)?.name || ''" title="删除供应商">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                    <label class="provider-toggle on" @click.stop>
                      <input type="checkbox" :checked="m.enabled" @change="toggleProviderEnabled(m)" />
                      <span class="provider-toggle-slider"></span>
                    </label>
                  </div>
                </div>
                <div v-show="expandedSections[m.id]?.apiInfo" class="provider-card-body">
                  <!-- API Key Section -->
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">API 密钥</span>
                      <div class="provider-section-header-actions">
                        <a v-if="m.isBuiltin && getProviderInfo(m.provider)?.getKeyUrl" :href="getProviderInfo(m.provider)?.getKeyUrl" target="_blank" class="provider-getkey-link" @click.stop>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          获取密钥
                        </a>
                        <button class="provider-section-add-btn" @click.stop="addApiKey(getModelIndex(m.id))">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          添加密钥
                        </button>
                      </div>
                    </div>
                    <div v-if="!m.apiKeys?.length" class="provider-section-empty">暂无密钥，点击上方按钮添加</div>
                    <div v-else class="apikey-list">
                      <div v-for="(ak, ki) in m.apiKeys" :key="ak.id" class="provider-apikey-row">
                        <div class="apikey-masked">
                          <label class="provider-toggle" :class="{ on: ak.enabled }">
                            <input type="checkbox" :checked="ak.enabled" @change="toggleApiKeyEnabled(getModelIndex(m.id), ki)" />
                            <span class="provider-toggle-slider"></span>
                          </label>
                          <span class="apikey-lock">🔒</span>
                          <span v-if="!showApiKey[ak.id]" class="apikey-text">{{ maskKey(ak.key) }}</span>
                          <span v-else class="apikey-text apikey-text-visible">{{ ak.key }}</span>
                        </div>
                        <div class="apikey-actions">
                          <button class="apikey-action-btn" @click="showApiKey[ak.id] = !showApiKey[ak.id]">
                            <svg v-if="showApiKey[ak.id]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          <button class="apikey-action-btn" @click="editApiKey(getModelIndex(m.id), ki)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          <button class="apikey-action-btn" @click="copyApiKey(ak.key)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                          <button class="apikey-action-btn danger" @click="confirmDeleteApiKey = m.id + '-' + ki; confirmDeleteApiKeyLabel = maskKey(ak.key)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <!-- API URL Section -->
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">API 地址</span>
                    </div>
                    <div v-if="!m.baseUrl" class="provider-section-empty">请填写 API 地址以启用模型同步</div>
                    <div v-else class="provider-url-form">
                      <div class="url-form-row">
                        <label class="url-form-label">Base URL <span class="tooltip-icon" title="API 服务器的基础地址">?</span></label>
                        <div class="url-form-input-group">
                          <input v-model="m.baseUrl" type="text" class="url-form-input" placeholder="https://api.openai.com" @change="updateSettings({ aiModels: [...settings.aiModels] })" />
                          <button class="url-restore-btn" @click="restoreBaseUrl(getModelIndex(m.id))">恢复默认</button>
                        </div>
                      </div>
                      <div class="url-preview">
                        <div>实际请求: {{ m.baseUrl }}{{ m.apiPath || '/v1/chat/completions' }}</div>
                        <div>模型同步: {{ m.baseUrl }}/v1/models</div>
                      </div>
                      <div class="url-form-row">
                        <label class="url-form-label">API 路径 <span class="tooltip-icon" title="聊天补全接口的路径">?</span></label>
                        <input v-model="m.apiPath" type="text" class="url-form-input" placeholder="/v1/chat/completions" @change="updateSettings({ aiModels: [...settings.aiModels] })" />
                      </div>
                    </div>
                  </div>
                  <!-- Model List Section -->
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">模型列表 <span class="model-count">{{ m.models?.length || 0 }}</span></span>
                      <div class="provider-section-actions">
                        <button class="provider-section-btn" @click="openFetchModels(getModelIndex(m.id))" :disabled="!m.baseUrl || !m.apiKeys?.length || fetchLoading" title="同步模型"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
                        <button class="provider-section-btn" @click="openAddModelModal(getModelIndex(m.id))" title="添加模型"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                        <button class="provider-section-btn" @click="testAllModels(getModelIndex(m.id))" title="测试全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>
                        <button class="provider-section-btn" @click="toggleAllModels(m)" title="启用/禁用全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3"/></svg></button>
                        <button class="provider-section-btn" @click="expandAllGroups(m.id)" title="展开全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
                      </div>
                    </div>
                    <div v-if="!m.models?.length" class="model-list-empty">点击上方按钮同步模型</div>
                    <div v-else class="model-list-grouped">
                      <div v-for="group in groupModels(m.models)" :key="group.name" class="model-group">
                        <div class="model-group-header" @click="toggleGroup(m.id, group.name)">
                          <svg class="model-group-arrow" :class="{ expanded: expandedGroups[m.id]?.has(group.name) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                          <span class="model-group-name">{{ group.name }}</span>
                          <span class="model-group-count">{{ group.models.length }}</span>
                          <div class="model-group-actions" @click.stop>
                            <label class="model-group-toggle" title="开关分组所有模型"><input type="checkbox" :checked="group.models.every(m => m.enabled)" @change="toggleGroupModels(getModelIndex(m.id), group.name)" /><span class="model-item-toggle-slider"></span></label>
                            <button class="model-group-btn danger" title="删除分组所有模型" @click="confirmDeleteGroup = m.id + '-' + group.name; confirmDeleteGroupLabel = group.name"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                          </div>
                        </div>
                        <div v-show="expandedGroups[m.id]?.has(group.name)" class="model-group-items">
                          <div v-for="model in group.models" :key="model.id" class="model-list-item">
                            <div class="model-list-item-left">
                              <span class="model-item-icon">🤖</span>
                              <span class="model-item-name">{{ model.name }}</span>
                              <span v-if="isChatModel(model)" class="model-tag chat">对话</span>
                              <span v-if="isImageModel(model)" class="model-tag image">绘图</span>
                              <span v-if="getModelContextLength(model)" class="model-tag context">{{ getModelContextLength(model) }}</span>
                            </div>
                            <div class="model-list-item-right">
                              <span v-if="isModelTestLoading(getModelIndex(m.id), model.id)" class="model-test-status testing">测试中...</span>
                              <span v-else-if="isModelTestSuccess(getModelIndex(m.id), model.id)" class="model-test-status ok">可用</span>
                              <span v-else-if="isModelTestFail(getModelIndex(m.id), model.id)" class="model-test-status fail">不可用</span>
                              <label class="model-item-toggle"><input type="checkbox" :checked="model.enabled" @change="toggleModelEnabled(getModelIndex(m.id), model.id)" /><span class="model-item-toggle-slider"></span></label>
                              <button class="model-item-action-btn" title="设置"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                              <button class="model-item-action-btn" title="测试" :class="{ testing: isModelTestLoading(getModelIndex(m.id), model.id), 'test-ok': isModelTestSuccess(getModelIndex(m.id), model.id), 'test-fail': isModelTestFail(getModelIndex(m.id), model.id) }" @click="testSingleModel(getModelIndex(m.id), model.id)" :disabled="isModelTestLoading(getModelIndex(m.id), model.id)">
                                <svg v-if="isModelTestLoading(getModelIndex(m.id), model.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                              </button>
                              <button class="model-item-action-btn danger" @click="confirmDeleteModel = model.id; confirmDeleteModelLabel = model.id"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pending Providers (enabled but not fully configured) -->
            <div v-if="pendingProviders.length" class="provider-group">
              <div class="provider-group-title">待配置</div>
              <div v-for="m in pendingProviders" :key="m.id" class="ai-model-provider-card pending">
                <div class="provider-card-header" @click="toggleExpandedSection(m.id, 'apiInfo')">
                  <div class="provider-card-left">
                    <span class="provider-card-icon clickable" @click.stop="openIconPickerForProvider(m.id)"><ProviderIcon :icon="m.icon || getProviderInfo(m.provider)?.icon" :size="20" /></span>
                    <span class="provider-card-name">{{ m.name || getProviderInfo(m.provider)?.name }}</span>
                    <span class="provider-pending-badge">需要配置</span>
                  </div>
                  <div class="provider-card-right">
                    <button v-if="!m.isBuiltin" class="provider-delete-btn" @click.stop="confirmDeleteProviderId = m.id; confirmDeleteProviderName = m.name || getProviderInfo(m.provider)?.name || ''" title="删除供应商">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                    <label class="provider-toggle on" @click.stop>
                      <input type="checkbox" :checked="m.enabled" @change="toggleProviderEnabled(m)" />
                      <span class="provider-toggle-slider"></span>
                    </label>
                  </div>
                </div>
                <div v-show="expandedSections[m.id]?.apiInfo" class="provider-card-body">
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">API 密钥</span>
                      <div class="provider-section-header-actions">
                        <a v-if="m.isBuiltin && getProviderInfo(m.provider)?.getKeyUrl" :href="getProviderInfo(m.provider)?.getKeyUrl" target="_blank" class="provider-getkey-link" @click.stop>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          获取密钥
                        </a>
                        <button class="provider-section-add-btn" @click.stop="addApiKey(getModelIndex(m.id))">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          添加密钥
                        </button>
                      </div>
                    </div>
                    <div v-if="!m.apiKeys?.length" class="provider-section-empty">暂无密钥，点击上方按钮添加</div>
                    <div v-else class="apikey-list">
                      <div v-for="(ak, ki) in m.apiKeys" :key="ak.id" class="provider-apikey-row">
                        <div class="apikey-masked">
                          <label class="provider-toggle" :class="{ on: ak.enabled }">
                            <input type="checkbox" :checked="ak.enabled" @change="toggleApiKeyEnabled(getModelIndex(m.id), ki)" />
                            <span class="provider-toggle-slider"></span>
                          </label>
                          <span class="apikey-lock">🔒</span>
                          <span v-if="!showApiKey[ak.id]" class="apikey-text">{{ maskKey(ak.key) }}</span>
                          <span v-else class="apikey-text apikey-text-visible">{{ ak.key }}</span>
                        </div>
                        <div class="apikey-actions">
                          <button class="apikey-action-btn" @click="showApiKey[ak.id] = !showApiKey[ak.id]">
                            <svg v-if="showApiKey[ak.id]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          <button class="apikey-action-btn" @click="editApiKey(getModelIndex(m.id), ki)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          <button class="apikey-action-btn" @click="copyApiKey(ak.key)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                          <button class="apikey-action-btn danger" @click="confirmDeleteApiKey = m.id + '-' + ki; confirmDeleteApiKeyLabel = maskKey(ak.key)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">API 地址</span>
                    </div>
                    <div v-if="!m.baseUrl" class="provider-section-empty">请填写 API 地址以启用模型同步</div>
                    <div v-else class="provider-url-form">
                      <div class="url-form-row">
                        <label class="url-form-label">Base URL <span class="tooltip-icon" title="API 服务器的基础地址">?</span></label>
                        <div class="url-form-input-group">
                          <input v-model="m.baseUrl" type="text" class="url-form-input" placeholder="https://api.openai.com" @change="updateSettings({ aiModels: [...settings.aiModels] })" />
                          <button class="url-restore-btn" @click="restoreBaseUrl(getModelIndex(m.id))">恢复默认</button>
                        </div>
                      </div>
                      <div class="url-preview">
                        <div>实际请求: {{ m.baseUrl }}{{ m.apiPath || '/v1/chat/completions' }}</div>
                        <div>模型同步: {{ m.baseUrl }}/v1/models</div>
                      </div>
                      <div class="url-form-row">
                        <label class="url-form-label">API 路径 <span class="tooltip-icon" title="聊天补全接口的路径">?</span></label>
                        <input v-model="m.apiPath" type="text" class="url-form-input" placeholder="/v1/chat/completions" @change="updateSettings({ aiModels: [...settings.aiModels] })" />
                      </div>
                    </div>
                  </div>
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">模型列表 <span class="model-count">{{ m.models?.length || 0 }}</span></span>
                      <div class="provider-section-actions">
                        <button class="provider-section-btn" @click="openFetchModels(getModelIndex(m.id))" :disabled="!m.baseUrl || !m.apiKeys?.length || fetchLoading" title="同步模型"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
                        <button class="provider-section-btn" @click="openAddModelModal(getModelIndex(m.id))" title="添加模型"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                        <button class="provider-section-btn" @click="testAllModels(getModelIndex(m.id))" title="测试全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>
                        <button class="provider-section-btn" @click="toggleAllModels(m)" title="启用/禁用全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3"/></svg></button>
                        <button class="provider-section-btn" @click="expandAllGroups(m.id)" title="展开全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
                      </div>
                    </div>
                    <div v-if="!m.models?.length" class="model-list-empty">点击上方按钮同步模型</div>
                    <div v-else class="model-list-grouped">
                      <div v-for="group in groupModels(m.models)" :key="group.name" class="model-group">
                        <div class="model-group-header" @click="toggleGroup(m.id, group.name)">
                          <svg class="model-group-arrow" :class="{ expanded: expandedGroups[m.id]?.has(group.name) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                          <span class="model-group-name">{{ group.name }}</span>
                          <span class="model-group-count">{{ group.models.length }}</span>
                          <div class="model-group-actions" @click.stop>
                            <label class="model-group-toggle" title="开关分组所有模型"><input type="checkbox" :checked="group.models.every(m => m.enabled)" @change="toggleGroupModels(getModelIndex(m.id), group.name)" /><span class="model-item-toggle-slider"></span></label>
                            <button class="model-group-btn danger" title="删除分组所有模型" @click="confirmDeleteGroup = m.id + '-' + group.name; confirmDeleteGroupLabel = group.name"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                          </div>
                        </div>
                        <div v-show="expandedGroups[m.id]?.has(group.name)" class="model-group-items">
                          <div v-for="model in group.models" :key="model.id" class="model-list-item">
                            <div class="model-list-item-left">
                              <span class="model-item-icon">🤖</span>
                              <span class="model-item-name">{{ model.name }}</span>
                              <span v-if="isChatModel(model)" class="model-tag chat">对话</span>
                              <span v-if="isImageModel(model)" class="model-tag image">绘图</span>
                              <span v-if="getModelContextLength(model)" class="model-tag context">{{ getModelContextLength(model) }}</span>
                            </div>
                            <div class="model-list-item-right">
                              <span v-if="isModelTestLoading(getModelIndex(m.id), model.id)" class="model-test-status testing">测试中...</span>
                              <span v-else-if="isModelTestSuccess(getModelIndex(m.id), model.id)" class="model-test-status ok">可用</span>
                              <span v-else-if="isModelTestFail(getModelIndex(m.id), model.id)" class="model-test-status fail">不可用</span>
                              <label class="model-item-toggle"><input type="checkbox" :checked="model.enabled" @change="toggleModelEnabled(getModelIndex(m.id), model.id)" /><span class="model-item-toggle-slider"></span></label>
                              <button class="model-item-action-btn" title="设置"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                              <button class="model-item-action-btn" title="测试" :class="{ testing: isModelTestLoading(getModelIndex(m.id), model.id), 'test-ok': isModelTestSuccess(getModelIndex(m.id), model.id), 'test-fail': isModelTestFail(getModelIndex(m.id), model.id) }" @click="testSingleModel(getModelIndex(m.id), model.id)" :disabled="isModelTestLoading(getModelIndex(m.id), model.id)">
                                <svg v-if="isModelTestLoading(getModelIndex(m.id), model.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                              </button>
                              <button class="model-item-action-btn danger" @click="confirmDeleteModel = model.id; confirmDeleteModelLabel = model.id"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Disabled Providers -->
            <div v-if="disabledProviders.length" class="provider-group">
              <div class="provider-group-title">未启用</div>
              <div v-for="m in disabledProviders" :key="m.id" class="ai-model-provider-card disabled">
                <div class="provider-card-header" @click="toggleExpandedSection(m.id, 'apiInfo')">
                  <div class="provider-card-left">
                    <span class="provider-card-icon clickable" @click.stop="openIconPickerForProvider(m.id)"><ProviderIcon :icon="m.icon || getProviderInfo(m.provider)?.icon" :size="20" /></span>
                    <span class="provider-card-name">{{ m.name || getProviderInfo(m.provider)?.name }}</span>
                  </div>
                  <div class="provider-card-right">
                    <button v-if="!m.isBuiltin" class="provider-delete-btn" @click.stop="confirmDeleteProviderId = m.id; confirmDeleteProviderName = m.name || getProviderInfo(m.provider)?.name || ''" title="删除供应商">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                    <label class="provider-toggle" @click.stop>
                      <input type="checkbox" :checked="m.enabled" @change="toggleProviderEnabled(m)" />
                      <span class="provider-toggle-slider"></span>
                    </label>
                  </div>
                </div>
                <div v-show="expandedSections[m.id]?.apiInfo" class="provider-card-body">
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">API 密钥</span>
                      <div class="provider-section-header-actions">
                        <a v-if="m.isBuiltin && getProviderInfo(m.provider)?.getKeyUrl" :href="getProviderInfo(m.provider)?.getKeyUrl" target="_blank" class="provider-getkey-link" @click.stop>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          获取密钥
                        </a>
                        <button class="provider-section-add-btn" @click.stop="addApiKey(getModelIndex(m.id))">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          添加密钥
                        </button>
                      </div>
                    </div>
                    <div v-if="!m.apiKeys?.length" class="provider-section-empty">暂无密钥，点击上方按钮添加</div>
                    <div v-else class="apikey-list">
                      <div v-for="(ak, ki) in m.apiKeys" :key="ak.id" class="provider-apikey-row">
                        <div class="apikey-masked">
                          <label class="provider-toggle" :class="{ on: ak.enabled }">
                            <input type="checkbox" :checked="ak.enabled" @change="toggleApiKeyEnabled(getModelIndex(m.id), ki)" />
                            <span class="provider-toggle-slider"></span>
                          </label>
                          <span class="apikey-lock">🔒</span>
                          <span v-if="!showApiKey[ak.id]" class="apikey-text">{{ maskKey(ak.key) }}</span>
                          <span v-else class="apikey-text apikey-text-visible">{{ ak.key }}</span>
                        </div>
                        <div class="apikey-actions">
                          <button class="apikey-action-btn" @click="showApiKey[ak.id] = !showApiKey[ak.id]">
                            <svg v-if="showApiKey[ak.id]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          <button class="apikey-action-btn" @click="editApiKey(getModelIndex(m.id), ki)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          <button class="apikey-action-btn" @click="copyApiKey(ak.key)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                          <button class="apikey-action-btn danger" @click="confirmDeleteApiKey = m.id + '-' + ki; confirmDeleteApiKeyLabel = maskKey(ak.key)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">API 地址</span>
                    </div>
                    <div v-if="!m.baseUrl" class="provider-section-empty">请填写 API 地址以启用模型同步</div>
                    <div v-else class="provider-url-form">
                      <div class="url-form-row">
                        <label class="url-form-label">Base URL <span class="tooltip-icon" title="API 服务器的基础地址">?</span></label>
                        <div class="url-form-input-group">
                          <input v-model="m.baseUrl" type="text" class="url-form-input" placeholder="https://api.openai.com" @change="updateSettings({ aiModels: [...settings.aiModels] })" />
                          <button class="url-restore-btn" @click="restoreBaseUrl(getModelIndex(m.id))">恢复默认</button>
                        </div>
                      </div>
                      <div class="url-preview">
                        <div>实际请求: {{ m.baseUrl }}{{ m.apiPath || '/v1/chat/completions' }}</div>
                        <div>模型同步: {{ m.baseUrl }}/v1/models</div>
                      </div>
                      <div class="url-form-row">
                        <label class="url-form-label">API 路径 <span class="tooltip-icon" title="聊天补全接口的路径">?</span></label>
                        <input v-model="m.apiPath" type="text" class="url-form-input" placeholder="/v1/chat/completions" @change="updateSettings({ aiModels: [...settings.aiModels] })" />
                      </div>
                    </div>
                  </div>
                  <!-- Model List Section -->
                  <div class="provider-section">
                    <div class="provider-section-header">
                      <span class="provider-section-title">模型列表 <span class="model-count">{{ m.models?.length || 0 }}</span></span>
                      <div class="provider-section-actions">
                        <button class="provider-section-btn" @click="openFetchModels(getModelIndex(m.id))" :disabled="!m.baseUrl || !m.apiKeys?.length || fetchLoading" title="同步模型"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
                        <button class="provider-section-btn" @click="openAddModelModal(getModelIndex(m.id))" title="添加模型"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                        <button class="provider-section-btn" @click="testAllModels(getModelIndex(m.id))" title="测试全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>
                        <button class="provider-section-btn" @click="toggleAllModels(m)" title="启用/禁用全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3"/></svg></button>
                        <button class="provider-section-btn" @click="expandAllGroups(m.id)" title="展开全部"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
                      </div>
                    </div>
                    <div v-if="!m.models?.length" class="model-list-empty">点击上方按钮同步模型</div>
                    <div v-else class="model-list-grouped">
                      <div v-for="group in groupModels(m.models)" :key="group.name" class="model-group">
                        <div class="model-group-header" @click="toggleGroup(m.id, group.name)">
                          <svg class="model-group-arrow" :class="{ expanded: expandedGroups[m.id]?.has(group.name) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                          <span class="model-group-name">{{ group.name }}</span>
                          <span class="model-group-count">{{ group.models.length }}</span>
                          <div class="model-group-actions" @click.stop>
                            <label class="model-group-toggle" title="开关分组所有模型"><input type="checkbox" :checked="group.models.every(m => m.enabled)" @change="toggleGroupModels(getModelIndex(m.id), group.name)" /><span class="model-item-toggle-slider"></span></label>
                            <button class="model-group-btn danger" title="删除分组所有模型" @click="confirmDeleteGroup = m.id + '-' + group.name; confirmDeleteGroupLabel = group.name"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                          </div>
                        </div>
                        <div v-show="expandedGroups[m.id]?.has(group.name)" class="model-group-items">
                          <div v-for="model in group.models" :key="model.id" class="model-list-item">
                            <div class="model-list-item-left">
                              <span class="model-item-icon">🤖</span>
                              <span class="model-item-name">{{ model.name }}</span>
                              <span v-if="isChatModel(model)" class="model-tag chat">对话</span>
                              <span v-if="isImageModel(model)" class="model-tag image">绘图</span>
                              <span v-if="getModelContextLength(model)" class="model-tag context">{{ getModelContextLength(model) }}</span>
                            </div>
                            <div class="model-list-item-right">
                              <span v-if="isModelTestLoading(getModelIndex(m.id), model.id)" class="model-test-status testing">测试中...</span>
                              <span v-else-if="isModelTestSuccess(getModelIndex(m.id), model.id)" class="model-test-status ok">可用</span>
                              <span v-else-if="isModelTestFail(getModelIndex(m.id), model.id)" class="model-test-status fail">不可用</span>
                              <label class="model-item-toggle"><input type="checkbox" :checked="model.enabled" @change="toggleModelEnabled(getModelIndex(m.id), model.id)" /><span class="model-item-toggle-slider"></span></label>
                              <button class="model-item-action-btn" title="设置"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                              <button class="model-item-action-btn" title="测试" :class="{ testing: isModelTestLoading(getModelIndex(m.id), model.id), 'test-ok': isModelTestSuccess(getModelIndex(m.id), model.id), 'test-fail': isModelTestFail(getModelIndex(m.id), model.id) }" @click="testSingleModel(getModelIndex(m.id), model.id)" :disabled="isModelTestLoading(getModelIndex(m.id), model.id)">
                                <svg v-if="isModelTestLoading(getModelIndex(m.id), model.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                              </button>
                              <button class="model-item-action-btn danger" @click="confirmDeleteModel = model.id; confirmDeleteModelLabel = model.id"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Add/Edit Model Modal -->
        <div v-if="showModelModal" class="modal-overlay">
          <div class="modal modal-sm">
            <div class="modal-header">
              <h3 class="modal-title">{{ editingModelIndex !== null ? '编辑供应商' : '添加供应商' }}</h3>
              <button class="modal-close" @click="showModelModal = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">供应商名称 <span class="form-required">*</span></label>
                <input v-model="modelForm.name" type="text" class="form-input" placeholder="例如: 我的 OpenAI" @keyup.enter="saveModel" />
              </div>
              <div class="form-group">
                <label class="form-label">供应商类型 <span class="form-required">*</span></label>
                <select v-model="modelForm.provider" class="form-select" @change="applyProviderPreset">
                  <option v-for="p in BUILTIN_PROVIDERS" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Base URL</label>
                <input v-model="modelForm.baseUrl" type="text" class="form-input" placeholder="https://api.openai.com" />
              </div>
              <div class="form-group">
                <label class="form-label">API 路径</label>
                <input v-model="modelForm.apiPath" type="text" class="form-input" placeholder="/v1/chat/completions" />
              </div>
              <div class="form-group">
                <label class="form-label">图标</label>
                <div class="icon-picker-trigger" @click="editingIconProviderId = null; showIconPicker = true">
                  <span class="icon-picker-preview"><ProviderIcon :icon="modelForm.icon || getProviderInfo(modelForm.provider)?.icon || 'openai'" :size="28" /></span>
                  <span class="icon-picker-label">{{ modelForm.icon || getProviderInfo(modelForm.provider)?.icon || 'openai' }}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="showModelModal = false">取消</button>
              <button class="modal-btn confirm" :disabled="!modelForm.name.trim() || !modelForm.provider" @click="saveModel">创建</button>
            </div>
          </div>
        </div>

        <!-- Icon Picker Modal -->
        <div v-if="showIconPicker" class="modal-overlay" style="z-index: 1100;" @click.self="showIconPicker = false">
          <div class="modal modal-sm" style="width: 420px;">
            <div class="modal-header">
              <h3 class="modal-title">选择图标 <span class="modal-title-count">{{ filteredIcons.length }}/{{ AVAILABLE_ICONS.length }}</span></h3>
              <button class="modal-close" @click="showIconPicker = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body" style="padding: 12px;">
              <div class="icon-picker-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input v-model="iconSearchQuery" type="text" class="icon-picker-input" placeholder="搜索图标..." @keydown.escape="showIconPicker = false" ref="iconSearchRef" />
              </div>
              <div class="icon-picker-grid">
                <div class="icon-picker-item" :class="{ active: editingIconProviderId ? !(settings.aiModels.find(m => m.id === editingIconProviderId)?.icon) : !modelForm.icon }" @click="onIconPickerSelect('')">
                  <span class="icon-picker-item-icon"><ProviderIcon :icon="defaultProviderIcon" :size="28" /></span>
                  <span class="icon-picker-item-label">默认</span>
                </div>
                <div class="icon-picker-item" :class="{ active: editingIconProviderId ? settings.aiModels.find(m => m.id === editingIconProviderId)?.icon === 'openai' : modelForm.icon === 'openai' }" @click="onIconPickerSelect('openai')">
                  <span class="icon-picker-item-icon"><ProviderIcon icon="openai" :size="28" /></span>
                  <span class="icon-picker-item-label">openai</span>
                </div>
                <div
                  v-for="name in filteredIcons" :key="name"
                  class="icon-picker-item"
                  :class="{ active: editingIconProviderId ? settings.aiModels.find(m => m.id === editingIconProviderId)?.icon === name : modelForm.icon === name }"
                  @click="onIconPickerSelect(name)"
                >
                  <span class="icon-picker-item-icon"><ProviderIcon :icon="name" :size="28" /></span>
                  <span class="icon-picker-item-label">{{ name }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Add Model Modal -->
        <div v-if="showAddModelModal" class="modal-overlay">
          <div class="modal modal-sm">
            <div class="modal-header">
              <h3 class="modal-title">添加模型</h3>
              <button class="modal-close" @click="showAddModelModal = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">模型名称 <span class="form-required">*</span></label>
                <input v-model="newModelName" type="text" class="form-input" placeholder="例如: gpt-4o, claude-3-opus" @keyup.enter="saveNewModel" />
              </div>
              <div class="form-group">
                <label class="form-label">自定义名称（可选）</label>
                <input v-model="newModelCustomName" type="text" class="form-input" placeholder="用于显示的友好名称" @keyup.enter="saveNewModel" />
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="showAddModelModal = false">取消</button>
              <button class="modal-btn confirm" :disabled="!newModelName.trim()" @click="saveNewModel">添加</button>
            </div>
          </div>
        </div>

        <!-- API Key Modal -->
        <div v-if="showApiKeyModal" class="modal-overlay">
          <div class="modal modal-sm">
            <div class="modal-header">
              <h3 class="modal-title">{{ editingKeyIndex !== null ? '编辑密钥' : '添加密钥' }}</h3>
              <button class="modal-close" @click="showApiKeyModal = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">API 密钥 <span class="form-required">*</span></label>
                <input v-model="apiKeyForm.key" type="password" class="form-input" placeholder="sk-..." @keyup.enter="saveApiKey" />
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="showApiKeyModal = false">取消</button>
              <button class="modal-btn confirm" :disabled="!apiKeyForm.key.trim()" @click="saveApiKey">保存</button>
            </div>
          </div>
        </div>

        <!-- Fetch Models Modal -->
        <div v-if="showFetchModal" class="modal-overlay">
          <div class="modal">
            <div class="modal-header">
              <h3 class="modal-title">同步模型 <span v-if="fetchModelsResult.length" class="modal-title-count">{{ fetchModelsResult.length }}</span></h3>
              <button class="modal-close" @click="showFetchModal = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div v-if="fetchError" class="modal-error">{{ fetchError }}</div>
              <div v-if="!fetchModelsResult.length && !fetchError" class="modal-empty">暂无可用模型</div>
              <div v-else class="fetch-model-list">
                <div class="fetch-model-toolbar">
                  <label class="fetch-toolbar-select-all">
                    <input type="checkbox" :checked="selectedFetchIds.size === fetchModelsResult.length && fetchModelsResult.length > 0" @change="selectedFetchIds = selectedFetchIds.size === fetchModelsResult.length ? new Set() : new Set(fetchModelsResult.map(m => m.id))" />
                    <span class="fetch-toolbar-label">全选 ({{ selectedFetchIds.size }}/{{ fetchModelsResult.length }})</span>
                  </label>
                  <div class="fetch-toolbar-search">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input v-model="fetchSearchQuery" type="text" placeholder="搜索模型..." />
                  </div>
                  <button class="fetch-toolbar-btn" @click="toggleAllFetchGroups" :title="fetchModelGroups.every(g => expandedFetchGroups.has(g.name)) ? '收起所有' : '展开所有'">
                    <svg v-if="fetchModelGroups.every(g => expandedFetchGroups.has(g.name))" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="14 14 10 10 10 14"/><polyline points="10 10 14 10 10 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
                  </button>
                </div>
                <div v-for="group in fetchModelGroups" :key="group.name" class="fetch-model-group">
                  <div class="fetch-model-group-header" @click="toggleFetchGroup(group.name)">
                    <svg class="fetch-model-group-arrow" :class="{ expanded: expandedFetchGroups.has(group.name) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    <label class="fetch-group-checkbox" @click.stop>
                      <input type="checkbox" :checked="group.models.every(m => selectedFetchIds.has(m.id))" @change="toggleFetchGroupSelection(group)" />
                    </label>
                    <span class="fetch-group-icon" :style="{ background: getGroupColor(group.name) }">{{ group.name.charAt(0).toUpperCase() }}</span>
                    <span class="fetch-model-group-name">{{ group.name }}</span>
                    <span class="fetch-model-group-count">{{ group.models.length }}</span>
                  </div>
                  <div v-show="expandedFetchGroups.has(group.name)" class="fetch-model-group-items">
                    <div
                      v-for="m in group.models"
                      :key="m.id"
                      class="fetch-model-item"
                      :class="{ selected: selectedFetchIds.has(m.id) }"
                    >
                      <label class="fetch-model-checkbox">
                        <input type="checkbox" :checked="selectedFetchIds.has(m.id)" @change="handleFetchModelToggle(m.id)" />
                        <span class="fetch-item-icon" :style="{ background: getGroupColor(group.name) }">{{ group.name.charAt(0).toUpperCase() }}</span>
                        <span class="fetch-model-id">{{ m.id }}</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="showFetchModal = false">取消</button>
              <button class="modal-btn confirm" :disabled="!selectedFetchIds.size" @click="confirmFetchModels">导入所选 ({{ selectedFetchIds.size }})</button>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== DEFAULT MODEL ===== -->
      <template v-if="activeSection === 'default-model'">
        <div class="settings-scroll">
          <h1 class="settings-page-title">默认模型</h1>
          <p class="settings-page-desc">配置用于翻译等功能的默认 AI 模型。</p>

          <div class="setting-section">
            <h3 class="setting-section-title">翻译模型</h3>
            <div class="setting-card">
              <div class="setting-row">
                <div class="setting-row-info">
                  <div class="setting-row-label">选择默认翻译模型</div>
                  <div class="setting-row-desc">用于技能描述和内容的翻译功能。如果不设置，翻译功能将不可用。</div>
                </div>
              </div>
                <div class="default-model-select">
                  <div class="select-wrapper">
                    <select 
                      :value="hasValidTranslationModel ? settings.translationModelId : ''" 
                      @change="setTranslationModel(($event.target as HTMLSelectElement).value)"
                      class="form-select"
                    >
                      <template v-for="provider in allEnabledProviders" :key="provider.id">
                        <optgroup v-if="provider.models?.filter(m => m.enabled).length" :label="provider.name || getProviderInfo(provider.provider)?.name">
                          <option v-for="model in provider.models?.filter(m => m.enabled)" :key="model.id" :value="model.id">
                            {{ model.name || model.id }}
                          </option>
                        </optgroup>
                      </template>
                    </select>
                    <span v-if="!hasValidTranslationModel" class="select-placeholder">请选择模型</span>
                  </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== AGENT ===== -->
      <template v-if="activeSection === 'agent'">
        <div class="settings-scroll">
          <h1 class="settings-page-title">Agent 配置</h1>
          <p class="settings-page-desc">控制整个 Agent 平台是否启用，以及它们在 Skills 和 Rules 中的显示顺序。</p>

          <div class="setting-section">
            <div class="agent-toolbar">
              <button class="toolbar-btn reset-btn" @click="resetPlatformOrder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
                重置顺序
              </button>
            </div>
            <div class="platform-order-list">
              <div
                v-for="(p, index) in sortedPlatforms"
                :key="p.id"
                class="platform-order-item"
                :class="{ 
                  'dragging': dragIndex === index,
                  'drag-over': dragOverIndex === index,
                  'disabled': !p.enabled
                }"
                draggable="true"
                @dragstart="onDragStart(index, $event)"
                @dragover="onDragOver(index, $event)"
                @dragleave="onDragLeave"
                @drop="onDrop(index, $event)"
                @dragend="onDragEnd"
              >
                <div class="platform-drag-handle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="8" cy="6" r="2"/>
                    <circle cx="16" cy="6" r="2"/>
                    <circle cx="8" cy="12" r="2"/>
                    <circle cx="16" cy="12" r="2"/>
                    <circle cx="8" cy="18" r="2"/>
                    <circle cx="16" cy="18" r="2"/>
                  </svg>
                </div>
                <div class="platform-icon-wrapper">
                  <PlatformIcon :platform-id="p.id" :size="32" />
                </div>
                <div class="platform-info">
                  <div class="platform-name-row">
                    <span class="platform-name">{{ p.name }}</span>
                    <span class="platform-builtin-tag">内置</span>
                    <span class="platform-status" :class="{ detected: detectAgent(p) }">
                      {{ detectAgent(p) ? '已启用' : '未检测' }}
                    </span>
                  </div>
                  <div class="platform-path">{{ getPlatformOsPath(p) }}</div>
                </div>
                <div class="platform-actions">
                  <button
                    class="toggle-switch"
                    :class="{ on: p.enabled }"
                    @click="togglePlatformEnabled(p)"
                  >
                    <span class="toggle-thumb"></span>
                  </button>
                  <button
                    class="order-btn"
                    :disabled="index === 0"
                    @click="movePlatformUp(index)"
                    title="上移"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="18 15 12 9 6 15"/>
                    </svg>
                  </button>
                  <button
                    class="order-btn"
                    :disabled="index === sortedPlatforms.length - 1"
                    @click="movePlatformDown(index)"
                    title="下移"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <ConfirmModal v-if="confirmDeleteProviderId" title="删除供应商" :message="`确定要删除供应商 <strong>${confirmDeleteProviderName}</strong> 吗？`" @confirm="deleteProvider(confirmDeleteProviderId!)" @cancel="confirmDeleteProviderId = null" />
  <ConfirmModal v-if="confirmDeleteApiKey" title="删除密钥" :message="`确定要删除密钥 <strong>${confirmDeleteApiKeyLabel}</strong> 吗？`" @confirm="doDeleteApiKey" @cancel="confirmDeleteApiKey = null" />
  <ConfirmModal v-if="confirmDeleteGroup" title="删除模型分组" :message="`确定要删除分组 <strong>${confirmDeleteGroupLabel}</strong> 中的所有模型吗？`" @confirm="doDeleteGroup" @cancel="confirmDeleteGroup = null" />
  <ConfirmModal v-if="confirmDeleteModel" title="删除模型" :message="`确定要删除模型 <strong>${confirmDeleteModelLabel}</strong> 吗？`" @confirm="doDeleteModel" @cancel="confirmDeleteModel = null" />
  <CleanupSelectModal v-if="showCleanupSelect" :dirs="unregisteredDirs" @close="showCleanupSelect = false" @deleted="onCleanupDeleted" />
</template>

<style scoped>
.settings-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.settings-sidebar {
  width: 180px;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--app-ui-panel-bg));
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
}

.settings-sidebar-header {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid hsl(var(--border));
}

.settings-sidebar-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.settings-nav {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
}

.settings-sidebar-resize {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  touch-action: none;
  transition: background var(--duration-quick) var(--ease-standard);
}

.settings-sidebar-resize:hover {
  background: hsl(var(--primary) / 0.3);
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.7);
  cursor: pointer;
  text-align: left;
  transition: all var(--duration-base) var(--ease-standard);
}

.settings-nav-item:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.settings-nav-item.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.settings-nav-icon {
  font-size: 15px;
  width: 20px;
  text-align: center;
}

.settings-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.settings-scroll {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px 32px;
  max-width: 720px;
}

.settings-page-title {
  font-size: 22px;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin-bottom: 4px;
}

.settings-page-desc {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 28px;
}

.setting-section {
  margin-bottom: 24px;
}

.highlight-section {
  animation: highlight-pulse 2s ease-out;
}

@keyframes highlight-pulse {
  0% { box-shadow: 0 0 0 4px hsl(var(--primary) / 0.4); }
  100% { box-shadow: none; }
}

.setting-section-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  letter-spacing: 0.02em;
  margin-bottom: 12px;
}

.setting-card {
  background: hsl(var(--app-settings-card-bg));
  border: 1px solid hsl(var(--app-settings-card-border));
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: hsl(var(--app-settings-card-shadow));
}

/* Segmented Control */
.segmented-control {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: hsl(var(--app-settings-subtle-bg));
}

.segment-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.7);
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.segment-btn:hover {
  color: hsl(var(--foreground));
}

.segment-btn.active {
  background: hsl(var(--app-settings-segment-active-bg));
  color: hsl(var(--app-settings-segment-active-color));
  box-shadow: hsl(var(--app-settings-segment-active-shadow));
  font-weight: 600;
}

.segment-icon {
  font-size: 15px;
}

/* Color Name Bar */
.color-name-bar {
  text-align: right;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
  min-height: 18px;
}

/* Color Swatches Row */
.color-swatches-row {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 4px;
}

.color-swatch-cell {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}

.color-swatch-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
  flex-shrink: 0;
}

.color-swatch-btn:hover {
  transform: scale(1.1);
}

.color-swatch-btn.active {
  box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--primary));
}

.swatch-check {
  color: #fff;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
}

/* Custom Color Panel — only visible when custom is selected */
.custom-color-panel {
  margin-top: 12px;
  padding: 16px;
  border-radius: 12px;
  background: hsl(var(--muted) / 0.4);
  border: 1px solid hsl(var(--border));
  animation: fadeSlideIn var(--duration-base) var(--ease-standard) both;
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.custom-color-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.custom-color-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.custom-color-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin-top: 2px;
}

.custom-color-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.color-picker-native {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: none;
  padding: 2px;
  cursor: pointer;
}

.color-picker-native::-webkit-color-swatch-wrapper { padding: 2px; }
.color-picker-native::-webkit-color-swatch { border-radius: 4px; border: none; }

.color-hex-native {
  width: 110px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  font-size: 13px;
  font-family: 'SF Mono', Consolas, monospace;
  outline: none;
}

.color-hex-native:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

/* Preview Strip (Primary / Accent / Neutral) */
.preview-strip {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.preview-block {
  flex: 1;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.preview-block.primary {
  color: #fff;
}

.preview-block.accent {
  color: hsl(var(--foreground));
}

.preview-block.neutral {
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.setting-card-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 14px;
  line-height: 1.5;
}

/* Option Grid (Font Size, Motion) */
.option-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.option-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 14px 10px;
  border: none;
  border-radius: 12px;
  background: hsl(var(--app-settings-subtle-bg));
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.option-btn:hover {
  box-shadow: var(--shadow-sm);
  transform: translateY(-2px);
}

.option-btn:active {
  transform: translateY(0);
}

.option-btn.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 8px 24px hsl(var(--primary) / 0.25);
}

.option-label {
  font-size: 13px;
  font-weight: 600;
}

.option-meta {
  font-size: 11px;
  opacity: 0.7;
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  width: 44px;
  height: 26px;
  border-radius: 13px;
  border: 2px solid hsl(var(--border));
  background: hsl(var(--muted));
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--duration-base) var(--ease-standard);
}

.toggle-switch.on {
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
}

.toggle-switch:disabled {
  opacity: 0.4;
  cursor: default;
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  transition: transform var(--duration-base) var(--ease-standard);
}

.toggle-switch.on .toggle-thumb {
  transform: translateX(18px);
}

/* Setting Row */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.setting-row + .setting-row {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid hsl(var(--border) / 0.6);
}

.setting-row-info {
  flex: 1;
  min-width: 0;
}

.setting-row-label {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.setting-row-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin-top: 2px;
  line-height: 1.4;
}

/* Mode Grid */
.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.mode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px;
  border: 2px solid hsl(var(--border));
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.mode-card:hover {
  border-color: hsl(var(--primary) / 0.4);
}

.mode-card.active {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.06);
}

.mode-icon { font-size: 24px; }
.mode-name { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
.mode-desc { font-size: 11px; color: hsl(var(--muted-foreground)); text-align: center; }

/* Token */
.token-row {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.token-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 12px;
  font-family: 'SF Mono', Consolas, monospace;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  outline: none;
}

.token-input:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

.token-toggle {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--foreground) / 0.7);
  cursor: pointer;
}

.token-toggle:hover {
  background: hsl(var(--accent));
}

.token-link {
  display: inline-block;
  font-size: 12px;
  color: hsl(var(--primary));
  text-decoration: none;
  margin-top: 8px;
}

.token-link:hover { text-decoration: underline; }

/* Cleanup */
.cleanup-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid hsl(var(--destructive) / 0.3);
  border-radius: 8px;
  background: transparent;
  color: hsl(var(--destructive));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.cleanup-btn:hover {
  background: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
}

.cleanup-result {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 14px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted));
  border-radius: 8px;
}

.cleanup-result-icon {
  color: hsl(142, 70%, 45%);
  font-weight: 600;
}

/* Agent */
.agent-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.toolbar-btn {
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--foreground) / 0.7);
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.toolbar-btn:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.toolbar-btn.primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}

.agent-list {
  background: hsl(var(--app-settings-card-bg));
  border: 1px solid hsl(var(--app-settings-card-border));
  border-radius: var(--radius);
  overflow: hidden;
}

.agent-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
}

.agent-row + .agent-row {
  border-top: 1px solid hsl(var(--border) / 0.6);
}

.agent-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.agent-info { min-width: 0; }
.agent-name { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
.agent-path {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  font-family: 'SF Mono', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.agent-status {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  flex-shrink: 0;
}

.agent-status.detected { color: hsl(142 50% 45%); }

/* Platform Order List */
.platform-order-list {
  background: hsl(var(--app-settings-card-bg));
  border: 1px solid hsl(var(--app-settings-card-border));
  border-radius: var(--radius);
  overflow: hidden;
}

.platform-order-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
  transition: all var(--duration-base) var(--ease-standard);
  cursor: grab;
}

.platform-order-item:last-child {
  border-bottom: none;
}

.platform-order-item:hover {
  background: hsl(var(--muted) / 0.3);
}

.platform-order-item.dragging {
  opacity: 0.5;
  background: hsl(var(--primary) / 0.1);
}

.platform-order-item.drag-over {
  border-top: 2px solid hsl(var(--primary));
}

.platform-order-item.disabled {
  opacity: 0.6;
}

.platform-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  color: hsl(var(--muted-foreground) / 0.5);
  cursor: grab;
  flex-shrink: 0;
}

.platform-drag-handle:active {
  cursor: grabbing;
}

.platform-icon-wrapper {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.platform-info {
  flex: 1;
  min-width: 0;
}

.platform-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.platform-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.platform-builtin-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.platform-status {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.platform-status.detected {
  color: hsl(142 50% 45%);
}

.platform-path {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  font-family: 'SF Mono', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.order-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.order-btn:hover:not(:disabled) {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.order-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.reset-btn {
  margin-left: auto;
}

/* Tags */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 8px;
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}

.tag-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  opacity: 0.7;
}

.tag-remove:hover { opacity: 1; }

.tag-input-row {
  display: flex;
  gap: 6px;
}

.tag-input {
  flex: 1;
  padding: 7px 10px;
  font-size: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  outline: none;
}

.tag-input:focus {
  border-color: hsl(var(--ring));
}

.tag-add-btn {
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 8px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  cursor: pointer;
}

.tag-add-btn:hover {
  opacity: 0.9;
}

/* Background Image */
.bg-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.bg-header-left {
  min-width: 0;
}

.bg-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.bg-header-icon {
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
}

.bg-header-desc {
  margin-top: 4px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.6;
}

.bg-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.bg-choose-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  border: none;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-base) var(--ease-standard);
  white-space: nowrap;
}

.bg-choose-btn:hover {
  background: hsl(var(--primary) / 0.9);
}

.bg-toggle-btn {
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  white-space: nowrap;
}

.bg-toggle-btn:hover:not(:disabled) {
  background: hsl(var(--accent));
}

.bg-toggle-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.bg-status-hint {
  margin-top: 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.bg-preview-box {
  margin-top: 16px;
  border-radius: 12px;
  background: hsl(var(--app-settings-subtle-bg));
  padding: 12px;
}

.bg-preview-stage {
  aspect-ratio: 16 / 9;
  width: 100%;
  border-radius: 10px;
  background-size: cover;
  background-position: center;
  border: 1px solid hsl(var(--border));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.bg-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

.bg-empty-icon {
  opacity: 0.5;
}

.bg-sliders-box {
  margin-top: 16px;
  border-radius: 12px;
  background: hsl(var(--app-settings-subtle-bg));
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.bg-slider-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.slider-header label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.slider {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: hsl(var(--muted));
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: hsl(var(--primary));
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}

/* ═══ AI Model Management ═══ */
/* AI Model Settings */
.ai-model-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.ai-model-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-model-empty {
  padding: 32px;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  background: hsl(var(--card));
  border: 1px dashed hsl(var(--border));
  border-radius: 12px;
}

/* Provider Card */
.ai-model-provider-card {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  overflow: hidden;
  transition: border-color var(--duration-base) var(--ease-standard);
}

.ai-model-provider-card:hover {
  border-color: hsl(var(--primary) / 0.3);
}

.ai-model-provider-card.disabled {
  opacity: 0.7;
}

.ai-model-provider-card.disabled:hover {
  opacity: 1;
}

/* Provider Group */
.provider-group {
  margin-bottom: 16px;
}

.provider-group-title {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  margin-bottom: 8px;
  padding-left: 4px;
}

.provider-card-body {
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.1);
}

/* Provider Header */
.provider-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: hsl(var(--muted) / 0.3);
  border-bottom: 1px solid hsl(var(--border));
}

.provider-card-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-card-icon {
  font-size: 20px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.provider-card-icon.clickable {
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.2s, transform 0.15s;
}

.provider-card-icon.clickable:hover {
  background-color: hsl(var(--muted));
  transform: scale(1.1);
}

.provider-card-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.provider-pending-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background: hsl(38 92% 50% / 0.12);
  color: hsl(38 92% 40%);
  white-space: nowrap;
}

.ai-model-provider-card.pending {
  border-color: hsl(38 92% 50% / 0.3);
}

.provider-edit-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.provider-edit-btn:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.provider-card-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Toggle Switch */
.provider-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.provider-toggle input {
  display: none;
}

.provider-toggle-slider {
  width: 36px;
  height: 20px;
  background: hsl(var(--muted));
  border-radius: 10px;
  position: relative;
  transition: all var(--duration-base) var(--ease-standard);
}

.provider-toggle-slider::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform var(--duration-base) var(--ease-standard);
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.provider-toggle.on .provider-toggle-slider {
  background: hsl(142 50% 45%);
}

.provider-toggle.on .provider-toggle-slider::before {
  transform: translateX(16px);
}

.provider-toggle-label {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.provider-toggle.on .provider-toggle-label {
  color: hsl(142 50% 45%);
}

.provider-delete-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.provider-delete-btn:hover {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}

/* Provider Sections */
.provider-section {
  padding: 12px 16px;
  border-bottom: 1px solid hsl(var(--border));
}

.provider-section:last-child {
  border-bottom: none;
}

.provider-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.provider-section-title {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
  display: flex;
  align-items: center;
  gap: 6px;
}

.provider-section-empty {
  padding: 12px;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 6px;
  border: 1px dashed hsl(var(--border));
}

.model-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: hsl(var(--muted));
  border-radius: 9px;
  font-size: 10px;
  font-weight: 600;
}

.provider-section-actions {
  display: flex;
  gap: 4px;
}

.provider-section-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.provider-section-btn:hover:not(:disabled) {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.provider-section-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.provider-section-btn.success {
  border-color: hsl(142 50% 45%);
  color: hsl(142 50% 35%);
  background: hsl(142 50% 45% / 0.1);
}

.provider-section-btn.error {
  border-color: hsl(var(--destructive));
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.1);
}

/* API Key Row */
.provider-apikey-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.apikey-masked {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: hsl(var(--muted) / 0.3);
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.apikey-icon {
  flex-shrink: 0;
}

.apikey-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.apikey-text-visible {
  word-break: break-all;
  white-space: normal;
  font-size: 11px;
}

.apikey-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.apikey-input {
  flex: 1;
  border: none;
  background: transparent;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  color: hsl(var(--foreground));
  outline: none;
}

.apikey-actions {
  display: flex;
  gap: 4px;
}

.apikey-action-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.apikey-action-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.apikey-action-btn.danger:hover {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}

/* URL Form */
.provider-url-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.url-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.url-form-label {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.url-form-input-group {
  display: flex;
  gap: 8px;
}

.url-form-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  font-family: 'SF Mono', Consolas, monospace;
  outline: none;
  transition: all var(--duration-base) var(--ease-standard);
}

.url-form-input:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

.url-restore-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-base) var(--ease-standard);
}

.url-restore-btn:hover {
  background: hsl(var(--muted));
}

.url-preview {
  padding: 6px 10px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 6px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
}

/* Model List */
.model-list-empty {
  padding: 20px;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  background: hsl(var(--muted) / 0.2);
  border-radius: 8px;
}

/* Model Grouped List */
.model-list-grouped {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-group {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  overflow: hidden;
}

.model-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: hsl(var(--muted) / 0.3);
  cursor: pointer;
  user-select: none;
  transition: background var(--duration-base) var(--ease-standard);
}

.model-group-header:hover {
  background: hsl(var(--muted) / 0.5);
}

.model-group-arrow {
  flex-shrink: 0;
  transition: transform var(--duration-base) var(--ease-standard);
  color: hsl(var(--muted-foreground));
}

.model-group-arrow.expanded {
  transform: rotate(90deg);
}

.model-group-name {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
  flex: 1;
}

.model-group-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  background: hsl(var(--muted));
  border-radius: 9px;
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
}

.model-group-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.model-group-toggle {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
  cursor: pointer;
}

.model-group-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.model-group-toggle .model-item-toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: hsl(var(--muted));
  border-radius: 8px;
  transition: all var(--duration-base) var(--ease-standard);
}

.model-group-toggle .model-item-toggle-slider::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  transition: transform var(--duration-base) var(--ease-standard);
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.model-group-toggle input:checked + .model-item-toggle-slider {
  background: hsl(142 50% 45%);
}

.model-group-toggle input:checked + .model-item-toggle-slider::before {
  transform: translateX(12px);
}

.model-group-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
  transition: color var(--duration-base) var(--ease-standard), background var(--duration-base) var(--ease-standard);
}

.model-group-btn:hover {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}

.model-group-items {
  border-top: 1px solid hsl(var(--border));
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 8px;
  transition: background var(--duration-base) var(--ease-standard);
}

.model-list-item:hover {
  background: hsl(var(--muted) / 0.5);
}

.model-list-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.model-item-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.model-item-name {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
}

.model-tag.chat {
  background: hsl(210 50% 50% / 0.15);
  color: hsl(210 50% 50%);
}

.model-tag.image {
  background: hsl(280 50% 50% / 0.15);
  color: hsl(280 50% 50%);
}

.model-tag.context {
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.tooltip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 600;
  cursor: help;
}

.provider-section-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.provider-section-add-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.provider-section-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.provider-getkey-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid hsl(var(--primary) / 0.3);
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.provider-getkey-link:hover {
  background: hsl(var(--primary) / 0.15);
  border-color: hsl(var(--primary) / 0.5);
}

.apikey-lock {
  flex-shrink: 0;
}

.model-item-owner {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
}

.model-list-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.model-item-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
}

.model-item-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.model-item-toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: hsl(var(--muted));
  border-radius: 9px;
  transition: all var(--duration-base) var(--ease-standard);
}

.model-item-toggle-slider::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  transition: transform var(--duration-base) var(--ease-standard);
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.model-item-toggle input:checked + .model-item-toggle-slider {
  background: hsl(142 50% 45%);
}

.model-item-toggle input:checked + .model-item-toggle-slider::before {
  transform: translateX(14px);
}

.model-item-action-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.model-item-action-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.model-item-action-btn.danger:hover {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}

.model-item-action-btn.testing {
  color: hsl(var(--muted-foreground));
  opacity: 0.6;
}

.model-item-action-btn.test-ok {
  color: hsl(142 71% 45%);
}

.model-item-action-btn.test-fail {
  color: hsl(var(--destructive));
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
}

.model-test-status {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.model-test-status.testing {
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted));
}

.model-test-status.ok {
  color: hsl(142 71% 45%);
  background: hsl(142 71% 45% / 0.1);
}

.model-test-status.fail {
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.1);
}

/* Modal */
/* Modal Base */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: hsl(0 0% 0% / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn var(--duration-quick) var(--ease-standard);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  box-shadow: 0 20px 60px hsl(0 0% 0% / 0.2);
  display: flex;
  flex-direction: column;
  max-height: 85vh;
  width: 520px;
  animation: slideUp var(--duration-base) var(--ease-standard);
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.modal-sm {
  width: 480px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid hsl(var(--border));
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.modal-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.modal-close:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.2);
}

.modal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.modal-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.modal-btn.cancel {
  background: hsl(var(--card));
  border-color: hsl(var(--border));
  color: hsl(var(--foreground));
}

.modal-btn.cancel:hover:not(:disabled) {
  background: hsl(var(--muted));
}

.modal-btn.secondary {
  background: hsl(var(--card));
  border-color: hsl(var(--border));
  color: hsl(var(--foreground));
}

.modal-btn.secondary:hover:not(:disabled) {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.modal-btn.confirm {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.modal-btn.confirm:hover:not(:disabled) {
  opacity: 0.9;
}

.modal-body {
  padding: 16px 24px;
  flex: 1;
  overflow-y: auto;
}

.modal-title-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: hsl(var(--muted));
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  margin-left: 6px;
}

.modal-error {
  padding: 10px 14px;
  margin-bottom: 12px;
  background: hsl(var(--destructive) / 0.1);
  border: 1px solid hsl(var(--destructive) / 0.2);
  border-radius: 8px;
  font-size: 13px;
  color: hsl(var(--destructive));
}

.form-group {
  margin-bottom: 14px;
}

.form-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 6px;
}

.form-required {
  color: hsl(var(--destructive));
  margin-left: 2px;
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  outline: none;
  transition: all var(--duration-base) var(--ease-standard);
}

.form-input:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

.form-input::placeholder {
  color: hsl(var(--muted-foreground));
}

.form-select {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  outline: none;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.form-select:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

/* Fetch Models Modal */
.fetch-model-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  border-bottom: 1px solid hsl(var(--border));
}

.fetch-toolbar-select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  flex-shrink: 0;
}

.fetch-toolbar-select-all input {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  accent-color: hsl(var(--primary));
  cursor: pointer;
}

.fetch-toolbar-label {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

.fetch-toolbar-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: hsl(var(--muted) / 0.5);
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

.fetch-toolbar-search svg {
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
}

.fetch-toolbar-search input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: hsl(var(--foreground));
  min-width: 0;
}

.fetch-toolbar-search input::placeholder {
  color: hsl(var(--muted-foreground));
}

.fetch-toolbar-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.fetch-toolbar-btn:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.fetch-model-list {
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fetch-model-group {
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
}

.fetch-model-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: hsl(var(--accent) / 0.3);
  transition: background var(--duration-base) var(--ease-standard);
  user-select: none;
}

.fetch-model-group-header:hover {
  background: hsl(var(--accent) / 0.5);
}

.fetch-model-group-arrow {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
  transform-origin: center;
}

.fetch-model-group-arrow:not(.expanded) {
  transform: rotate(-90deg);
}

.fetch-group-checkbox {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.fetch-group-checkbox input {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  accent-color: hsl(var(--primary));
  cursor: pointer;
}

.fetch-group-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.fetch-model-group-name {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.fetch-model-group-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted));
  padding: 2px 8px;
  border-radius: 6px;
}

.fetch-model-group-items {
  padding: 4px;
}

.fetch-model-group-items .fetch-model-item {
  padding: 6px 10px 6px 32px;
  border-radius: 6px;
}

.fetch-model-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  transition: background var(--duration-base) var(--ease-standard);
}

.fetch-model-item:hover {
  background: hsl(var(--muted) / 0.5);
}

.fetch-model-item.selected {
  background: hsl(var(--primary) / 0.08);
}

.fetch-model-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.fetch-model-checkbox input {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  accent-color: hsl(var(--primary));
  cursor: pointer;
}

.fetch-item-icon {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.fetch-model-id {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.modal-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

/* Default Translation Model */
.default-model-select {
  margin-top: 12px;
}

.default-model-select .form-select {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  outline: none;
  transition: all var(--duration-base) var(--ease-standard);
  cursor: pointer;
}

.default-model-select .form-select:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

.select-wrapper {
  position: relative;
}

.select-placeholder {
  position: absolute;
  left: 1px;
  top: 1px;
  right: 1px;
  bottom: 1px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  pointer-events: none;
  background: hsl(var(--card));
  border-radius: 7px;
  z-index: 1;
}

.current-model-info {
  margin-top: 8px;
  padding: 8px 12px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.model-info-label {
  font-weight: 500;
  margin-right: 6px;
}

.model-info-name {
  color: hsl(var(--foreground));
  font-weight: 500;
}

.model-info-placeholder {
  color: hsl(var(--muted-foreground));
  font-style: italic;
}

/* Model Info Card */
.model-info-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-info-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 8px;
}

.model-info-icon {
  font-size: 20px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--card));
  border-radius: 8px;
  flex-shrink: 0;
}

.model-info-content {
  flex: 1;
}

.model-info-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 4px;
}

.model-info-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
}

.icon-picker-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
  background: hsl(var(--card));
}
.icon-picker-trigger:hover {
  border-color: hsl(var(--ring));
}

.icon-picker-label {
  flex: 1;
  font-size: 13px;
  color: hsl(var(--foreground));
}

.icon-picker-preview {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--muted));
  border-radius: 8px;
  flex-shrink: 0;
}

.icon-picker-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  margin-bottom: 8px;
  color: hsl(var(--muted-foreground));
}

.icon-picker-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: hsl(var(--foreground));
}
.icon-picker-input::placeholder {
  color: hsl(var(--muted-foreground));
}

.icon-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
  padding: 8px;
  max-height: 360px;
  overflow-y: auto;
}

.icon-picker-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.icon-picker-item:hover {
  background: hsl(var(--accent));
}
.icon-picker-item.active {
  background: hsl(var(--primary) / 0.12);
  outline: 2px solid hsl(var(--primary));
  outline-offset: -2px;
}

.icon-picker-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.icon-picker-item-label {
  font-size: 10px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 52px;
  white-space: nowrap;
}
</style>
