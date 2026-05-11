<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Dark mode detection
const isDark = computed(() => {
  if (appSettings.value.darkMode === 'dark') return true
  if (appSettings.value.darkMode === 'light') return false
  // auto mode
  const ztools = (window as any).ztools
  if (typeof ztools?.isDarkColors === 'function') {
    return ztools.isDarkColors()
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
})
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  Bug,
  ChevronDown,
  Check,
  Circle,
  CircleDot,
  CircleCheck,
  Copy,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  FolderOpen,
  Folder,
  Image as ImageIcon,
  ListChecks,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  User,
  Wrench,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Cpu,
  FileText,
  Pencil
} from 'lucide-vue-next'

import type {
  MessageRole, ToolInvocationStatus, AttachmentKind, Attachment,
  ToolInvocation, TextMessageBlock,
  ChangeSummaryFile, ChangeSummary, ChatMessage, Provider, ChatSession,
  DebugLogEntry, SessionRuntimeState, TodoStatus, TodoItem,
  SafetyMode, ToolRiskLevel, AppSettings, ToolCategoryId,
  ToolConfirmationDecision, PendingToolConfirmation, ToolGateDecision,
  DiscoveredSkill, MemoryBlock
} from './types'

import {
  toolCategories, toolCatalog, toolCatalogMap, getDefaultEnabledToolNames,
  FILE_MUTATING_TOOLS, MUTATING_TOOL_NAMES
} from './toolCatalog'

import { md } from './utils/markdown'

import {
  createMessageId, createBlockId, normalizeToolDiff,
  cloneToolInvocation,
  cloneMessageBlocks,
  syncAssistantMessageState,
  serializeAttachmentForStorage, cloneAttachments,
  createMessage, normalizeMessages, tryParseJson,
  getArgumentByAliases, stringifyArgument, stringifyForBlock, isToolResultError
} from './utils/normalize'

import {
  MAX_TOOL_CALL_ROUNDS_SAFETY_CAP,
  clampToolRoundLimit,
  cloneAppSettings,
  normalizeAppSettings, createDefaultProviders,
  defaultSystemPrompt, systemPromptPresets, loadProviders, loadAppSettings
} from './utils/storage'


const messages = ref<ChatMessage[]>([])
const input = ref('')
const composerAttachments = ref<Attachment[]>([])
const isComposerDragActive = ref(false)
const isPlusMenuOpen = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const imageInputRef = ref<HTMLInputElement | null>(null)
const skillFileInputRef = ref<HTMLInputElement | null>(null)
const plusMenuRef = ref<HTMLElement | null>(null)
const messageImagePreview = ref<Record<string, string>>({})
const imagePreviewLoading = ref<Set<string>>(new Set())
const manualModelInput = ref('')
const showSettings = ref(false)
const activeSettingsTab = ref('general')
const isSidebarOpen = ref(true)
const isCompactInput = ref(window.innerWidth < 850)
const handleResize = () => {
  isCompactInput.value = window.innerWidth < 850
}
const isTodoDrawerOpen = ref(false)
const isBashShellsOpen = ref(false)
const sidebarSearch = ref('')
const activeBashShells = ref<Array<{
  bashId: string
  status: string
  command: string
  description: string
  pid: number | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
}>>([])
let bashShellsPollTimer: ReturnType<typeof setInterval> | undefined

const isFetchingModels = ref(false)
const isModelMenuOpen = ref(false)
const modelMenuSearch = ref('')
const environmentReady = ref(false)
const environmentInfo = ref<Record<string, string>>({})
const currentWorkspaceCwd = ref('')
const chatContainer = ref<HTMLElement | null>(null)
const modelMenuRef = ref<HTMLElement | null>(null)
const modelSearchInputRef = ref<HTMLInputElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const notice = ref<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
const providers = ref<Provider[]>(loadProviders())
const selectedProviderId = ref(localStorage.getItem('kuke_provider_id') || providers.value[0]?.id || 'openai')
const selectedModel = ref(localStorage.getItem('kuke_model') || providers.value[0]?.models[0] || '')
const systemPrompt = ref(localStorage.getItem('kuke_system') || defaultSystemPrompt)
const systemPromptDraft = ref(systemPrompt.value)
const appSettings = ref<AppSettings>(loadAppSettings())
const appSettingsDraft = ref<AppSettings>(cloneAppSettings(appSettings.value))
const sessions = ref<ChatSession[]>([])
const filteredSessions = computed(() => {
  const query = sidebarSearch.value.trim().toLowerCase()
  if (!query) return sessions.value
  return sessions.value.filter(s => s.title.toLowerCase().includes(query))
})
const currentSessionId = ref('')
const sessionRuntimeState = ref<Record<string, SessionRuntimeState>>({})
const debugLogs = ref<DebugLogEntry[]>([])
const isLoadingDebugLogs = ref(false)
const discoveredSkills = ref<DiscoveredSkill[]>([])
const showSkillCreateDialog = ref(false)
const skillCreateForm = ref({ name: '', description: '', content: '' })
const showSkillDetailDialog = ref(false)
const skillDetailContent = ref('')
const skillDetailName = ref('')
const isImportingSkill = ref(false)
const isSavingSkill = ref(false)
const standardSkillTemplates = ref<Array<{ name: string; description: string }>>([])
const userHomedir = computed(() => environmentInfo.value.homedir || '')

const memoryBlocksForSettings = ref<MemoryBlock[]>([])
const showMemoryDialog = ref(false)
const memoryDialogMode = ref<'create' | 'edit'>('create')
const memoryEditTarget = ref<MemoryBlock | null>(null)
const memoryForm = ref({ label: '', description: '', value: '', chars_limit: 5000, read_only: false })

interface McpServer {
  serverId: string
  name: string
  command: string
  args: string[]
  cwd: string
  status: string
  toolCount: number
  tools: Array<{ name: string; description: string; inputSchema: any }>
  error?: string
  extraHeaders?: Record<string, string>
  transport?: string
  env?: Record<string, string>
}

const mcpServers = ref<McpServer[]>([])
const showMcpAddDialog = ref(false)
const showMcpImportDialog = ref(false)
const showMcpLogDialog = ref(false)
const showMcpEditDialog = ref(false)
const mcpLogData = ref<{ serverId: string; name: string; status: string; error: string | null; logs: Array<{ channel: string; text: string; ts: number }> } | null>(null)
const mcpAddForm = ref({ name: '', command: '', args: '', cwd: '' })
const mcpEditJson = ref('')
const mcpEditJsonError = ref('')
const mcpEditOriginalServerId = ref('')
const isConnectingMcp = ref(false)
const mcpImportText = ref('')
const mcpImportError = ref('')
const isImportingMcp = ref(false)

const totalMcpTools = computed(() => mcpServers.value.reduce((sum, s) => sum + (s.tools?.length || 0), 0))

const refreshMcpServers = async () => {
  const listMcpServers = (window as any).localTools?.listMcpServers
  if (typeof listMcpServers !== 'function') return false
  try {
    const response = await listMcpServers()
    if (response?.success && Array.isArray(response.data)) {
      mcpServers.value = response.data
      return true
    }
    return false
  } catch {
    return false
  }
}

const connectMcpServer = async (options: { name?: string; command: string; args?: string[]; cwd?: string }) => {
  const connect = (window as any).localTools?.connectMcp
  if (typeof connect !== 'function') return { success: false, error: 'connectMcp not available' }
  try {
    const result = await connect(options)
    await refreshMcpServers()
    return result
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) }
  }
}

const disconnectMcpServer = async (serverId: string) => {
  const disconnect = (window as any).localTools?.disconnectMcp
  if (typeof disconnect !== 'function') return
  try {
    await disconnect({ serverId })
    await refreshMcpServers()
  } catch {
    // ignore
  }
}

const showMcpLogs = async (serverId: string) => {
  const getLogs = (window as any).localTools?.getMcpServerLogs
  if (typeof getLogs !== 'function') return
  try {
    const response = await getLogs({ serverId })
    if (response?.success) {
      mcpLogData.value = response.data
      showMcpLogDialog.value = true
    }
  } catch {
    // ignore
  }
}

const openMcpEditDialog = (server: McpServer) => {
  const config: any = {}
  if (server.command?.startsWith('http')) {
    config.url = server.command
    if (server.extraHeaders) {
      config.headers = server.extraHeaders
    }
    if (server.transport === 'sse') {
      config.transport = 'sse'
    }
  } else {
    config.command = server.command
    if (server.args?.length) {
      config.args = server.args
    }
    if (server.env) {
      config.env = server.env
    }
    if (server.cwd) {
      config.cwd = server.cwd
    }
  }
  mcpEditJson.value = JSON.stringify({ mcpServers: { [server.name]: config } }, null, 2)
  mcpEditJsonError.value = ''
  mcpEditOriginalServerId.value = server.serverId
  showMcpEditDialog.value = true
}

const updateMcpServer = async () => {
  mcpEditJsonError.value = ''
  let parsed: any
  try {
    parsed = JSON.parse(mcpEditJson.value)
  } catch {
    mcpEditJsonError.value = 'JSON 格式错误'
    return
  }

  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
    mcpEditJsonError.value = '缺少 mcpServers 对象'
    return
  }

  const entries = Object.entries(parsed.mcpServers)
  if (entries.length === 0) {
    mcpEditJsonError.value = 'mcpServers 不能为空'
    return
  }

  const [name, config] = entries[0] as [string, any]
  if (!config || typeof config !== 'object') {
    mcpEditJsonError.value = '配置格式错误'
    return
  }

  isConnectingMcp.value = true
  try {
    const disconnect = (window as any).localTools?.disconnectMcp
    if (typeof disconnect === 'function' && mcpEditOriginalServerId.value) {
      const disconnectResult = await disconnect({ serverId: mcpEditOriginalServerId.value })
      if (!disconnectResult?.success) {
        mcpEditJsonError.value = disconnectResult?.error || '断开旧连接失败'
        isConnectingMcp.value = false
        return
      }
    }

    const connect = (window as any).localTools?.connectMcp
    if (typeof connect !== 'function') {
      mcpEditJsonError.value = '连接功能不可用'
      isConnectingMcp.value = false
      return
    }
    let connectResult
    if (config.url) {
      connectResult = await connect({ name, url: config.url, headers: config.headers, transport: config.transport })
    } else if (config.command) {
      connectResult = await connect({ name, command: config.command, args: config.args, env: config.env, cwd: config.cwd })
    }
    if (!connectResult?.success) {
      mcpEditJsonError.value = connectResult?.error || '连接失败'
      isConnectingMcp.value = false
      return
    }
    await refreshMcpServers()
    mcpEditJson.value = ''
    mcpEditOriginalServerId.value = ''
    showMcpEditDialog.value = false
    showNotice('MCP Server 更新成功', 'success')
  } catch (error: any) {
    mcpEditJsonError.value = error?.message || '更新失败'
  } finally {
    isConnectingMcp.value = false
  }
}

const addMcpServer = async () => {
  if (!mcpAddForm.value.command.trim()) return
  isConnectingMcp.value = true
  try {
    const args = mcpAddForm.value.args.trim() ? mcpAddForm.value.args.trim().split(/\s+/) : []
    await connectMcpServer({
      name: mcpAddForm.value.name.trim() || undefined,
      command: mcpAddForm.value.command.trim(),
      args,
      cwd: mcpAddForm.value.cwd.trim() || undefined,
    })
    mcpAddForm.value = { name: '', command: '', args: '', cwd: '' }
    showMcpAddDialog.value = false
  } finally {
    isConnectingMcp.value = false
  }
}

const importMcpConfig = async () => {
  const text = mcpImportText.value.trim()
  if (!text) return
  isImportingMcp.value = true
  mcpImportError.value = ''
  try {
    let parsed: any
    if (text.startsWith('{')) {
      try {
        parsed = JSON.parse(text)
      } catch {
        mcpImportError.value = 'JSON 格式解析失败，请检查语法'
        isImportingMcp.value = false
        return
      }
    } else if (text.startsWith('http://') || text.startsWith('https://')) {
      parsed = { mcpServers: { unnamed: { url: text } } }
    } else {
      mcpImportError.value = '无法识别格式，请粘贴标准 MCP JSON 配置或以 http(s):// 开头的 URL'
      isImportingMcp.value = false
      return
    }

    if (!parsed || typeof parsed !== 'object') {
      mcpImportError.value = '配置解析结果无效'
      isImportingMcp.value = false
      return
    }

    const servers: Array<{ name?: string; command?: string; args?: string[]; url?: string; headers?: Record<string, string>; env?: Record<string, string>; cwd?: string; transport?: string }> = []

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      for (const [name, config] of Object.entries(parsed.mcpServers)) {
        if (!config || typeof config !== 'object') continue
        const c = config as any
        if (c.command) {
          servers.push({
            name: String(name),
            command: String(c.command),
            args: Array.isArray(c.args) ? c.args.map(String) : [],
            env: c.env && typeof c.env === 'object' ? c.env : undefined,
            cwd: typeof c.cwd === 'string' ? c.cwd : undefined,
          })
        } else if (c.url) {
          servers.push({
            name: String(name),
            url: String(c.url),
            headers: c.headers && typeof c.headers === 'object' ? c.headers : undefined,
            transport: c.transport === 'sse' ? 'sse' : undefined,
          })
        }
      }
    }

    if (servers.length === 0) {
      mcpImportError.value = '未找到有效的 MCP Server 配置（需要 command 或 url 字段）'
      isImportingMcp.value = false
      return
    }

    let successCount = 0
    let failCount = 0
    let lastError = ''
    for (const server of servers) {
      const connectAsync = (window as any).localTools?.connectMcpAsync
      let result
      if (server.url) {
        result = connectAsync({ name: server.name, url: server.url, headers: server.headers, transport: server.transport })
      } else {
        result = connectAsync({ name: server.name, command: server.command, args: server.args, env: server.env, cwd: server.cwd })
      }
      if (result?.success) {
        successCount++
      } else {
        failCount++
        lastError = result?.error || '未知错误'
      }
    }

    // 保存 MCP 配置到 localStorage
    try {
      const savedMcp = localStorage.getItem('kuke_mcp_servers')
      const saved = savedMcp ? JSON.parse(savedMcp) : {}
      for (const server of servers) {
        if (server.name && server.url) {
          saved[server.name] = { url: server.url, headers: server.headers, transport: server.transport }
        } else if (server.name && server.command) {
          saved[server.name] = { command: server.command, args: server.args, env: server.env, cwd: server.cwd }
        }
      }
      localStorage.setItem('kuke_mcp_servers', JSON.stringify(saved))
    } catch (e) {
      console.error('保存 MCP 配置失败:', e)
    }

    await refreshMcpServers()
    mcpImportText.value = ''
    showMcpImportDialog.value = false

    if (failCount === 0) {
      showNotice(`成功添加 ${successCount} 个 MCP Server，正在后台尝试连接...`, 'success')
    } else {
      showNotice(`添加完成：成功 ${successCount} 个，失败 ${failCount} 个 (${lastError})，正在后台尝试连接...`, 'error')
    }
  } catch (error: any) {
    showNotice(`导入异常: ${error?.message || '未知错误'}`, 'error')
    mcpImportText.value = ''
    showMcpImportDialog.value = false
  } finally {
    isImportingMcp.value = false
  }
}

const refreshDiscoveredSkills = async () => {
  const discover = (window as any).localTools?.discoverSkills
  if (typeof discover !== 'function') return
  try {
    const response = await discover()
    if (response?.success && Array.isArray(response.data)) {
      discoveredSkills.value = response.data
    }
  } catch {
    // ignore
  }
}

const openSkillCreateDialog = () => {
  skillCreateForm.value = { name: '', description: '', content: '' }
  showSkillCreateDialog.value = true
}

const closeSkillCreateDialog = () => {
  showSkillCreateDialog.value = false
}

const submitSkillCreate = async () => {
  const { name, description, content } = skillCreateForm.value
  if (!name.trim() || !description.trim()) {
    showNotice('名称和描述不能为空', 'error')
    return
  }
  isSavingSkill.value = true
  try {
    const saver = (window as any).localTools?.saveSkill
    if (typeof saver !== 'function') {
      showNotice('当前环境不支持创建 Skill', 'error')
      return
    }
    const response = await saver({ name: name.trim(), description: description.trim(), content })
    if (response?.success) {
      showNotice('Skill 创建成功', 'success')
      showSkillCreateDialog.value = false
      await refreshDiscoveredSkills()
    } else {
      showNotice(response?.error || '创建失败', 'error')
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '创建失败', 'error')
  } finally {
    isSavingSkill.value = false
  }
}

const removeSkill = async (entry: string) => {
  const deleter = (window as any).localTools?.deleteSkill
  if (typeof deleter !== 'function') return
  try {
    const response = await deleter({ entry })
    if (response?.success) {
      showNotice('Skill 已删除', 'success')
      await refreshDiscoveredSkills()
    } else {
      showNotice(response?.error || '删除失败', 'error')
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

const viewSkill = async (entry: string, name: string) => {
  const reader = (window as any).localTools?.readSkillFile
  if (typeof reader !== 'function') return
  try {
    const response = await reader({ entry })
    if (response?.success) {
      skillDetailName.value = name
      skillDetailContent.value = String(response.data ?? '')
      showSkillDetailDialog.value = true
    } else {
      showNotice(response?.error || '读取失败', 'error')
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '读取失败', 'error')
  }
}

const closeSkillDetailDialog = () => {
  showSkillDetailDialog.value = false
}

const loadMemoryBlocksForSettings = async () => {
  const lister = (window as any).localTools?.listMemoryBlocks
  if (typeof lister !== 'function') return
  try {
    const response = await lister()
    if (response?.success && Array.isArray(response.data)) {
      memoryBlocksForSettings.value = response.data
    }
  } catch {
    // ignore
  }
}

const openMemoryCreateDialog = () => {
  memoryDialogMode.value = 'create'
  memoryEditTarget.value = null
  memoryForm.value = { label: '', description: '', value: '', chars_limit: 5000, read_only: false }
  showMemoryDialog.value = true
}

const openMemoryEditDialog = (block: MemoryBlock) => {
  memoryDialogMode.value = 'edit'
  memoryEditTarget.value = block
  memoryForm.value = {
    label: block.label,
    description: block.description,
    value: block.value,
    chars_limit: block.chars_limit,
    read_only: block.read_only,
  }
  showMemoryDialog.value = true
}

const closeMemoryDialog = () => {
  showMemoryDialog.value = false
}

const submitMemoryForm = async () => {
  const { label, description, value, chars_limit, read_only } = memoryForm.value
  if (!label.trim()) {
    showNotice('标签不能为空', 'error')
    return
  }
  const setter = (window as any).localTools?.setMemoryBlock
  if (typeof setter !== 'function') {
    showNotice('当前环境不支持记忆操作', 'error')
    return
  }
  try {
    const response = await setter({ label: label.trim(), description: description.trim(), value, chars_limit, read_only })
    if (response?.success) {
      showNotice(memoryDialogMode.value === 'create' ? '记忆块创建成功' : '记忆块更新成功', 'success')
      showMemoryDialog.value = false
      await loadMemoryBlocksForSettings()
    } else {
      showNotice(response?.error || '操作失败', 'error')
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

const deleteMemoryBlockFromSettings = async (label: string) => {
  if (!confirm(`确定要删除记忆块「${label}」吗？此操作不可恢复。`)) return
  const deleter = (window as any).localTools?.deleteMemoryBlock
  if (typeof deleter !== 'function') {
    showNotice('当前环境不支持记忆操作', 'error')
    return
  }
  try {
    const response = await deleter({ label })
    if (response?.success) {
      showNotice('记忆块已删除', 'success')
      await loadMemoryBlocksForSettings()
    } else {
      showNotice(response?.error || '删除失败', 'error')
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

const loadStandardSkillTemplates = async () => {
  const lister = (window as any).localTools?.listStandardSkillTemplates
  if (typeof lister !== 'function') return
  try {
    const response = await lister()
    if (Array.isArray(response)) {
      standardSkillTemplates.value = response
    }
  } catch {
    // ignore
  }
}

const importStandardSkillTemplate = async (name: string) => {
  isImportingSkill.value = true
  try {
    const importer = (window as any).localTools?.importStandardSkill
    if (typeof importer !== 'function') {
      showNotice('当前环境不支持导入 Skill', 'error')
      return
    }
    const response = await importer({ name })
    if (response?.success) {
      showNotice(`标准 Skill「${name}」导入成功`, 'success')
      await refreshDiscoveredSkills()
    } else {
      showNotice(response?.error || '导入失败', 'error')
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '导入失败', 'error')
  } finally {
    isImportingSkill.value = false
  }
}

const triggerSkillFileImport = () => {
  skillFileInputRef.value?.click()
}

const handleSkillFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file) return
  const fileName = file.name
  const isZip = fileName.toLowerCase().endsWith('.zip')
  isImportingSkill.value = true
  target.value = ''
  try {
    if (isZip) {
      const saveToTemp = (window as any).localTools?.saveUploadedFileToTemp
      const importFromPath = (window as any).localTools?.importSkillFromFilePath
      if (typeof saveToTemp !== 'function' || typeof importFromPath !== 'function') {
        showNotice('当前环境不支持导入 ZIP 格式 Skill', 'error')
        return
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as ArrayBuffer
          const bytes = new Uint8Array(result)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          resolve(btoa(binary))
        }
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsArrayBuffer(file)
      })
      const saveResult = await saveToTemp({ content: base64, fileName })
      if (!saveResult?.success) {
        showNotice(saveResult?.error || '保存临时文件失败', 'error')
        return
      }
      const response = await importFromPath({ filePath: saveResult.filePath })
      if (response?.success) {
        showNotice('本地 Skill 导入成功', 'success')
        await refreshDiscoveredSkills()
      } else {
        showNotice(response?.error || '导入失败', 'error')
      }
    } else {
      const importer = (window as any).localTools?.saveSkillFromContent
      if (typeof importer !== 'function') {
        showNotice('当前环境不支持导入本地 Skill', 'error')
        return
      }
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsText(file)
      })
      const response = await importer({ content, fileName })
      if (response?.success) {
        showNotice('本地 Skill 导入成功', 'success')
        await refreshDiscoveredSkills()
      } else {
        showNotice(response?.error || '导入失败', 'error')
      }
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '导入失败', 'error')
  } finally {
    isImportingSkill.value = false
  }
}

const copiedMessageId = ref<string | null>(null)
const copiedToolFieldKey = ref<string | null>(null)
let copiedMessageResetTimer: ReturnType<typeof setTimeout> | undefined
let copiedToolResetTimer: ReturnType<typeof setTimeout> | undefined

const createAttachmentId = () => `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })

const getFileKind = (file: File): AttachmentKind => {
  if (file.type.startsWith('image/')) return 'image'
  return 'file'
}

const basenameFromPath = (value: string) => {
  const normalized = String(value ?? '').replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] || normalized
}

const splitDiffLines = (diffText: string) => {
  if (!diffText) return []
  return String(diffText).split('\n')
}

const diffLineClass = (line: string) => {
  if (!line) return 'diff-line diff-line-context'
  const first = line.charAt(0)
  if (first === '+') return 'diff-line diff-line-add'
  if (first === '-') return 'diff-line diff-line-del'
  if (first === '@' && line.startsWith('@@')) return 'diff-line diff-line-hunk'
  return 'diff-line diff-line-context'
}

const PATH_LIKE_REGEXP = /^(?:[a-zA-Z]:[\\\/][^<>"|?*\r\n]+|\/[^<>"|?*\r\n]+|\\\\[^<>"|?*\r\n]+)$/

const isPathLikeText = (text: string) => {
  const trimmed = String(text ?? '').trim().replace(/^["']|["']$/g, '')
  if (!trimmed || trimmed.length > 1024) {
    return false
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return false
  }
  return PATH_LIKE_REGEXP.test(trimmed)
}

const resolvePathLikeText = (text: string) =>
  String(text ?? '').trim().replace(/^["']|["']$/g, '')

const statPathViaLocalTools = async (candidate: string) => {
  const stat = (window as any).localTools?.statPath
  if (typeof stat !== 'function') {
    return null
  }
  try {
    const response = await stat(candidate)
    if (response?.success && response.data) {
      return response.data as { exists: boolean; path: string; isDirectory?: boolean; isFile?: boolean; size?: number }
    }
  } catch {
    // ignore
  }
  return null
}

const addAttachment = (attachment: Attachment) => {
  if (composerAttachments.value.some((item) => item.path === attachment.path && item.kind === attachment.kind)) {
    return
  }
  composerAttachments.value = [...composerAttachments.value, attachment]
}

const removeComposerAttachment = (id: string) => {
  composerAttachments.value = composerAttachments.value.filter((item) => item.id !== id)
}

const clearComposerAttachments = () => {
  composerAttachments.value = []
}

const ensureMessageImagePreview = async (attachment: Attachment) => {
  if (attachment.kind !== 'image') return
  if (attachment.previewDataUrl) {
    messageImagePreview.value[attachment.id] = attachment.previewDataUrl
    return
  }
  if (messageImagePreview.value[attachment.id]) return
  if (imagePreviewLoading.value.has(attachment.id)) return
  const reader = (window as any).localTools?.readFileAsDataURL
  if (typeof reader !== 'function' || !attachment.path) return
  imagePreviewLoading.value.add(attachment.id)
  try {
    const response = await reader(attachment.path)
    if (response?.success && response.data?.dataUrl) {
      messageImagePreview.value[attachment.id] = response.data.dataUrl
    }
  } catch {
    // ignore
  } finally {
    imagePreviewLoading.value.delete(attachment.id)
  }
}

const getMessageAttachmentPreview = (attachment: Attachment) =>
  attachment.previewDataUrl || messageImagePreview.value[attachment.id] || ''

const resolveFileLocalPath = (file: File): string => {
  const direct = String((file as any).path || '').trim()
  if (direct) return direct
  const resolver = (window as any).localTools?.getPathForFile
  if (typeof resolver === 'function') {
    try {
      const response = resolver(file)
      if (response?.success && response.data?.path) {
        return String(response.data.path).trim()
      }
    } catch {
      // ignore
    }
  }
  return ''
}

const addFileObjectsAsAttachments = async (files: File[]) => {
  for (const file of files) {
    const absolutePath = resolveFileLocalPath(file)
    const kind = getFileKind(file)
    let dataUrl = ''
    try {
      dataUrl = await readFileAsDataUrl(file)
    } catch {
      dataUrl = ''
    }

    if (!absolutePath) {
      const saver = (window as any).localTools?.saveUploadedFile
      if (!dataUrl || typeof saver !== 'function') {
        showNotice(file.name
          ? `无法读取 ${file.name} 的内容，请检查文件是否可访问。`
          : '无法读取文件内容。', 'error')
        continue
      }
      try {
        const response = await saver({ dataUrl, name: file.name })
        if (response?.success && response.data?.path) {
          addAttachment({
            id: createAttachmentId(),
            kind,
            name: file.name || basenameFromPath(response.data.path),
            path: response.data.path,
            size: file.size,
            mimeType: file.type,
            previewDataUrl: kind === 'image' ? dataUrl : undefined,
          })
          showNotice('该文件无法取得原始路径，已保存到临时副本，AI 对副本的改动不会同步回原文件。', 'info')
          continue
        }
        showNotice(response?.error || '保存上传文件失败。', 'error')
      } catch (error) {
        const message = error instanceof Error ? error.message : '保存上传文件失败'
        showNotice(message, 'error')
      }
      continue
    }

    addAttachment({
      id: createAttachmentId(),
      kind,
      name: file.name || basenameFromPath(absolutePath),
      path: absolutePath,
      size: file.size,
      mimeType: file.type,
      previewDataUrl: kind === 'image' && dataUrl ? dataUrl : undefined,
    })
  }
}

const handleComposerDragOver = (event: DragEvent) => {
  if (!event.dataTransfer) return
  const hasFiles = Array.from(event.dataTransfer.types || []).includes('Files')
  if (!hasFiles) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  isComposerDragActive.value = true
}

const handleComposerDragLeave = (event: DragEvent) => {
  if (event.currentTarget === event.target) {
    isComposerDragActive.value = false
  }
}

const handleComposerDrop = async (event: DragEvent) => {
  if (!event.dataTransfer) return
  const items = Array.from(event.dataTransfer.items || [])
  const files = Array.from(event.dataTransfer.files || [])
  if (!items.length && !files.length) return
  event.preventDefault()
  isComposerDragActive.value = false

  const folderPaths: string[] = []
  const directFiles: File[] = []

  for (const item of items) {
    if (item.kind !== 'file') continue
    const entry = typeof (item as any).webkitGetAsEntry === 'function' ? (item as any).webkitGetAsEntry() : null
    const file = item.getAsFile()
    if (entry && entry.isDirectory && file) {
      const pathCandidate = resolveFileLocalPath(file)
      if (pathCandidate) {
        folderPaths.push(pathCandidate)
        continue
      }
    }
    if (file) {
      directFiles.push(file)
    }
  }

  if (!items.length) {
    directFiles.push(...files)
  }

  for (const folderPath of folderPaths) {
    addAttachment({
      id: createAttachmentId(),
      kind: 'folder',
      name: basenameFromPath(folderPath),
      path: folderPath,
    })
  }

  if (directFiles.length) {
    const folderSet = new Set(folderPaths)
    const standaloneFiles = directFiles.filter((file) => {
      const absPath = resolveFileLocalPath(file)
      return !absPath || !folderSet.has(absPath)
    })
    await addFileObjectsAsAttachments(standaloneFiles)
  }
}

const handleComposerPaste = async (event: ClipboardEvent) => {
  const clipboardData = event.clipboardData
  if (!clipboardData) return
  const items = Array.from(clipboardData.items || [])
  const imageItems = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
  const stringItems = items.filter((item) => item.kind === 'string' && item.type === 'text/plain')

  if (imageItems.length) {
    event.preventDefault()
    const files = imageItems.map((item) => item.getAsFile()).filter((file): file is File => !!file)
    await addFileObjectsAsAttachments(files)
    return
  }

  if (stringItems.length) {
    const text = clipboardData.getData('text/plain')
    if (isPathLikeText(text)) {
      const candidate = resolvePathLikeText(text)
      const stat = await statPathViaLocalTools(candidate)
      if (stat?.exists) {
        event.preventDefault()
        addAttachment({
          id: createAttachmentId(),
          kind: stat.isDirectory ? 'folder' : 'file',
          name: basenameFromPath(stat.path || candidate),
          path: stat.path || candidate,
          size: stat.size,
        })
        return
      }
    }
  }
}

const handleFileInputChange = async (event: Event) => {
  const target = event.target as HTMLInputElement | null
  if (!target?.files?.length) return
  const files = Array.from(target.files)
  await addFileObjectsAsAttachments(files)
  target.value = ''
}

const handleFolderInputChange = async (event: Event) => {
  const target = event.target as HTMLInputElement | null
  if (!target?.files?.length) return
  const firstFile = target.files[0]
  const absolutePath = resolveFileLocalPath(firstFile)
  const relativePath = String(firstFile.webkitRelativePath || '').trim()
  if (absolutePath && relativePath) {
    const separator = absolutePath.includes('\\') ? '\\' : '/'
    const rootLength = absolutePath.length - relativePath.length - separator.length
    const rootPath = rootLength > 0 ? absolutePath.slice(0, rootLength) : absolutePath
    addAttachment({
      id: createAttachmentId(),
      kind: 'folder',
      name: basenameFromPath(rootPath) || rootPath,
      path: rootPath,
    })
  } else if (absolutePath) {
    const fallbackParent = absolutePath.replace(/[\\/][^\\/]*$/, '')
    addAttachment({
      id: createAttachmentId(),
      kind: 'folder',
      name: basenameFromPath(fallbackParent) || fallbackParent,
      path: fallbackParent || absolutePath,
    })
  } else {
    showNotice('当前环境下无法获取文件夹本地路径（Electron 已禁用 File.path 时，需要宿主暴露 webUtils.getPathForFile）。', 'error')
  }
  target.value = ''
}

const handleImageInputChange = async (event: Event) => {
  const target = event.target as HTMLInputElement | null
  if (!target?.files?.length) return
  const files = Array.from(target.files).filter((file) => file.type.startsWith('image/'))
  await addFileObjectsAsAttachments(files)
  target.value = ''
}

const triggerFileInput = () => {
  isPlusMenuOpen.value = false
  fileInputRef.value?.click()
}

const triggerFolderInput = () => {
  isPlusMenuOpen.value = false
  folderInputRef.value?.click()
}

const triggerImageInput = () => {
  imageInputRef.value?.click()
}

const getAttachmentLabel = (kind: AttachmentKind) =>
  ({ image: '图片', file: '文件', folder: '文件夹' })[kind]

const formatBytes = (value?: number) => {
  if (!value || value <= 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const buildAttachmentNoteText = (attachments: Attachment[]) => {
  const nonImage = attachments.filter((item) => item.kind !== 'image' && item.path)
  const images = attachments.filter((item) => item.kind === 'image')
  const lines: string[] = []
  if (nonImage.length) {
    lines.push('附件：')
    for (const attachment of nonImage) {
      const tag = attachment.kind === 'folder' ? '文件夹' : '文件'
      lines.push(`- ${tag}：\`${attachment.path}\``)
    }
  }
  if (images.length) {
    if (!nonImage.length) {
      lines.push('附件：')
    }
    for (const attachment of images) {
      const pathHint = attachment.path ? `（本地缓存：\`${attachment.path}\`）` : ''
      lines.push(`- 图片：${attachment.name || '粘贴图片'}${pathHint}`)
    }
  }
  return lines.join('\n')
}


const copyTextToClipboard = async (text: string) => {
  const value = String(text ?? '')
  if (!value) {
    return false
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  try {
    if (typeof document === 'undefined') {
      return false
    }
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined

const currentProvider = computed(
  () => providers.value.find((provider) => provider.id === selectedProviderId.value) || providers.value[0],
)
const activeSession = computed(
  () => sessions.value.find((session) => session.id === currentSessionId.value) || null,
)
const hasMessages = computed(() => messages.value.length > 0)
const isCurrentSessionLoading = computed(() => {
  if (!currentSessionId.value) {
    return false
  }
  return ensureSessionRuntime(currentSessionId.value).isLoading
})
const headerTitle = computed(() => (!isSidebarOpen.value && activeSession.value ? activeSession.value.title : 'Kuke Agent'))
const headerTitleKey = computed(() => (!isSidebarOpen.value && activeSession.value ? activeSession.value.id : 'brand'))

const currentSessionTodos = computed<TodoItem[]>(() => {
  const sessionId = currentSessionId.value
  if (!sessionId) return []
  const runtime = sessionRuntimeState.value[sessionId]
  return runtime?.todos ?? []
})

const currentTodoStats = computed(() => {
  const stats = { total: 0, pending: 0, in_progress: 0, completed: 0 }
  for (const todo of currentSessionTodos.value) {
    stats.total += 1
    stats[todo.status] += 1
  }
  return stats
})

const hasCurrentTodos = computed(() => currentSessionTodos.value.length > 0)

const activeBashCount = computed(() =>
  activeBashShells.value.filter((item) => item.status === 'running').length,
)

const refreshActiveBashShells = () => {
  const lister = (window as any).localTools?.listBackgroundBashes
  if (typeof lister !== 'function') return
  try {
    const response = lister()
    if (response?.success && Array.isArray(response?.data?.shells)) {
      activeBashShells.value = response.data.shells
    }
  } catch {
    // ignore polling errors
  }
}

const killBackgroundBashShell = async (bashId: string) => {
  const killer = (window as any).localTools?.KillShellTool
  if (typeof killer !== 'function') return
  try {
    await killer({ bashId })
    refreshActiveBashShells()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '终止失败', 'error')
  }
}

const toggleTodoDrawer = () => {
  isTodoDrawerOpen.value = !isTodoDrawerOpen.value
}

const toggleBashShellsPanel = () => {
  isBashShellsOpen.value = !isBashShellsOpen.value
  if (isBashShellsOpen.value) {
    refreshActiveBashShells()
  }
}
const debugLogItems = computed(() => [...debugLogs.value].reverse())
const effectiveSystemPromptDraft = computed(() => systemPromptDraft.value.trim() || defaultSystemPrompt)
const hasSystemPromptDraftChanges = computed(() => effectiveSystemPromptDraft.value !== systemPrompt.value)
const systemPromptDraftLength = computed(() => effectiveSystemPromptDraft.value.length)
const activeSessionPromptSnapshot = computed(() => activeSession.value?.systemPromptSnapshot?.trim() || '')
const selectedModelLabel = computed(() => selectedModel.value || '选择模型')
const filteredModelGroups = computed(() => {
  const keyword = modelMenuSearch.value.trim().toLowerCase()
  return providers.value
    .map((provider) => {
      const providerName = provider.name.toLowerCase()
      const providerUrl = provider.baseURL.toLowerCase()
      const matchedModels = keyword
        ? provider.models.filter((model) => {
            const normalizedModel = model.toLowerCase()
            return normalizedModel.includes(keyword) || providerName.includes(keyword) || providerUrl.includes(keyword)
          })
        : provider.models

      return {
        ...provider,
        matchedModels,
      }
    })
    .filter((provider) => provider.matchedModels.length > 0)
})
const hasFilteredModelOptions = computed(() => filteredModelGroups.value.length > 0)

const toolSettingsSummary = computed(() => (
  appSettings.value.enableLocalTools
    ? `已启用 ${appSettings.value.enabledToolNames.length}/${toolCatalog.length} 个工具`
    : '本地工具已关闭'
))
const hasTavilyKeyConfigured = computed(() => Boolean(appSettingsDraft.value.tavilyApiKey.trim()))
const draftEnabledToolCount = computed(() => appSettingsDraft.value.enabledToolNames.length)
const draftDisabledToolCount = computed(() => toolCatalog.length - draftEnabledToolCount.value)
const toolCatalogGroups = computed(() => (
  toolCategories.map((category) => {
    const tools = toolCatalog.filter((tool) => tool.category === category.id)
    const enabledCount = tools.filter((tool) => appSettingsDraft.value.enabledToolNames.includes(tool.name)).length
    return {
      ...category,
      tools,
      enabledCount,
    }
  })
))

const mcpToolDefinitions = computed(() => {
  const tools: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: any }
  }> = []
  for (const server of mcpServers.value) {
    if (server.status !== 'initialized' || !Array.isArray(server.tools)) continue
    for (const tool of server.tools) {
      tools.push({
        type: 'function',
        function: {
          name: `mcp_${server.serverId}__${tool.name}`,
          description: tool.description || `MCP tool from ${server.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      })
    }
  }
  return tools
})

const enabledTools = computed(() => {
  const localTools = toolCatalog
    .filter((tool) => appSettings.value.enabledToolNames.includes(tool.name))
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  return [...localTools, ...mcpToolDefinitions.value]
})

const getToolDefinition = (toolName: string) => toolCatalogMap.get(toolName) || null

const getToolDisplayName = (toolName: string) => getToolDefinition(toolName)?.label || toolName || '等待工具名称'

const getToolDisplayPurpose = (toolName: string) => getToolDefinition(toolName)?.purpose || ''

const isToolEnabled = (toolName: string, source: AppSettings) => source.enabledToolNames.includes(toolName)

const toggleToolDraft = (toolName: string) => {
  const currentSet = new Set(appSettingsDraft.value.enabledToolNames)
  if (currentSet.has(toolName)) {
    currentSet.delete(toolName)
  } else {
    currentSet.add(toolName)
  }
  appSettingsDraft.value.enabledToolNames = toolCatalog
    .map((tool) => tool.name)
    .filter((name) => currentSet.has(name))
}

const toggleToolCategoryDraft = (categoryId: ToolCategoryId) => {
  const categoryTools = toolCatalog.filter((tool) => tool.category === categoryId).map((tool) => tool.name)
  const enabledSet = new Set(appSettingsDraft.value.enabledToolNames)
  const shouldEnableAll = categoryTools.some((toolName) => !enabledSet.has(toolName))

  categoryTools.forEach((toolName) => {
    if (shouldEnableAll) {
      enabledSet.add(toolName)
    } else {
      enabledSet.delete(toolName)
    }
  })

  appSettingsDraft.value.enabledToolNames = toolCatalog
    .map((tool) => tool.name)
    .filter((name) => enabledSet.has(name))
}

const setAllToolDraftEnabled = (enabled: boolean) => {
  appSettingsDraft.value.enabledToolNames = enabled ? getDefaultEnabledToolNames() : []
}

const resetToolDraftSelection = () => {
  appSettingsDraft.value.enabledToolNames = getDefaultEnabledToolNames()
}

const clearWorkspaceRootDraft = () => {
  appSettingsDraft.value.workspaceRoot = ''
}

const toggleAllowlistToolDraft = (toolName: string) => {
  const canonical = toolCatalogMap.get(toolName)?.name ?? toolName
  const set = new Set(appSettingsDraft.value.toolListNames)
  if (set.has(canonical)) {
    set.delete(canonical)
  } else {
    set.add(canonical)
  }
  appSettingsDraft.value.toolListNames = toolCatalog
    .map((tool) => tool.name)
    .filter((name) => set.has(name))
}

const handleCommandListInput = (raw: string) => {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, index, arr) => line && arr.indexOf(line) === index)
  appSettingsDraft.value.commandListPatterns = lines.slice(0, 256)
}

const hasWorkspaceDraftChanged = computed(
  () => appSettingsDraft.value.workspaceRoot !== appSettings.value.workspaceRoot,
)

const applyWorkspaceRootFromSettings = async () => {
  const target = appSettings.value.workspaceRoot.trim()
  const setter = (window as any).localTools?.setWorkspaceRoot
  const getter = (window as any).localTools?.getWorkspaceRoot
  if (typeof setter === 'function') {
    try {
      // Pass target (may be empty) — setter will use default workspace if target is empty/undefined
      const response = await setter(target || undefined)
      if (response?.success && response.data?.cwd) {
        currentWorkspaceCwd.value = response.data.cwd
      } else if (response?.error) {
        showNotice(`应用工作目录失败：${response.error}`, 'error')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '应用工作目录失败'
      showNotice(message, 'error')
    }
  }
  if (typeof getter === 'function') {
    try {
      const response = await getter()
      if (response?.success && response.data?.cwd) {
        currentWorkspaceCwd.value = response.data.cwd
      }
    } catch {
      // ignore
    }
  }
}

const showNotice = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
  notice.value = { text, type }
  if (noticeTimer) {
    clearTimeout(noticeTimer)
  }
  noticeTimer = setTimeout(() => {
    notice.value = null
  }, 3200)
}

const ensureProviderSelection = () => {
  if (!providers.value.length) {
    providers.value = createDefaultProviders()
  }

  if (!providers.value.some((provider) => provider.id === selectedProviderId.value)) {
    selectedProviderId.value = providers.value[0].id
  }

  const provider = providers.value.find((item) => item.id === selectedProviderId.value)
  if (!provider) {
    return
  }

  if (!provider.models.includes(selectedModel.value)) {
    selectedModel.value = provider.models[0] || ''
  }
}

const persistConfig = () => {
  localStorage.setItem('kuke_providers', JSON.stringify(providers.value))
  localStorage.setItem('kuke_provider_id', selectedProviderId.value)
  localStorage.setItem('kuke_model', selectedModel.value)
  localStorage.setItem('kuke_system', systemPrompt.value)
  localStorage.setItem('kuke_settings', JSON.stringify(appSettings.value))
}

const openSettings = (tab = activeSettingsTab.value) => {
  activeSettingsTab.value = tab
  systemPromptDraft.value = systemPrompt.value
  appSettingsDraft.value = cloneAppSettings(appSettings.value)
  isModelMenuOpen.value = false
  showSettings.value = true
}

const closeSettings = () => {
  systemPromptDraft.value = systemPrompt.value
  appSettingsDraft.value = cloneAppSettings(appSettings.value)
  showSettings.value = false
}

const resetSystemPromptDraft = () => {
  systemPromptDraft.value = defaultSystemPrompt
}

const applySystemPromptPreset = (prompt: string) => {
  systemPromptDraft.value = prompt
}

const applyModelSelection = (
  rawValue: string,
  options: {
    persist?: boolean
    notice?: boolean
  } = {},
) => {
  const { persist = false, notice = false } = options

  try {
    const parsed = JSON.parse(rawValue) as { providerId?: string; model?: string }
    const providerId = String(parsed.providerId ?? '')
    const model = String(parsed.model ?? '')
    const provider = providers.value.find((item) => item.id === providerId)

    if (!provider) {
      return
    }

    selectedProviderId.value = provider.id
    selectedModel.value = provider.models.includes(model) ? model : (provider.models[0] || '')
    ensureProviderSelection()

    if (persist) {
      persistConfig()
    }

    if (notice) {
      showNotice(`已切换到 ${provider.name} / ${selectedModel.value}`, 'success')
    }
  } catch {
    showNotice('模型切换失败，请重新选择。', 'error')
  }
}

const toggleModelMenu = () => {
  isModelMenuOpen.value = !isModelMenuOpen.value
}

const selectHeaderModel = (providerId: string, model: string) => {
  if (providerId === selectedProviderId.value && model === selectedModel.value) {
    isModelMenuOpen.value = false
    return
  }

  applyModelSelection(JSON.stringify({ providerId, model }), { persist: true, notice: true })
  isModelMenuOpen.value = false
}

const ensureSessionSystemPrompt = (sessionId: string) => {
  const session = getSessionById(sessionId)
  if (!session) {
    return systemPrompt.value
  }

  if (!session.systemPromptSnapshot?.trim()) {
    session.systemPromptSnapshot = systemPrompt.value.trim() || defaultSystemPrompt
    saveSessionsToStorage()
  }

  return session.systemPromptSnapshot
}

const pad2 = (value: number) => String(value).padStart(2, '0')

const buildPlaceholderValues = (): Record<string, string> => {
  const now = new Date()
  const year = now.getFullYear()
  const month = pad2(now.getMonth() + 1)
  const day = pad2(now.getDate())
  const hour = pad2(now.getHours())
  const minute = pad2(now.getMinutes())
  const second = pad2(now.getSeconds())
  const currentDate = `${year}-${month}-${day}`
  const currentTime = `${currentDate} ${hour}:${minute}:${second}`
  let browserTimezone = ''
  try {
    browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    browserTimezone = ''
  }
  const env = environmentInfo.value
  const resolve = (key: string, fallback = '') => {
    const value = env[key]
    return typeof value === 'string' && value.trim() ? value : fallback
  }
  return {
    currentTime,
    current_time: currentTime,
    currentDate,
    current_date: currentDate,
    currentYear: String(year),
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
    timezone: resolve('timezone', browserTimezone),
    locale: resolve('locale', typeof navigator !== 'undefined' ? navigator.language || '' : ''),
    platform: resolve('platform'),
    os: resolve('osType', resolve('platform')),
    osType: resolve('osType'),
    osRelease: resolve('osRelease'),
    arch: resolve('arch'),
    cwd: resolve('cwd'),
    workingDirectory: resolve('cwd'),
    homedir: resolve('homedir'),
    hostname: resolve('hostname'),
    user: resolve('user'),
    username: resolve('user'),
    nodeVersion: resolve('nodeVersion'),
  }
}

const buildSkillsBlock = (skills: DiscoveredSkill[]): string => {
  if (!skills.length) return ''
  const lines: string[] = []
  lines.push('<available_skills>')
  lines.push('你可以按需使用以下 Skill。判断相关后，先用 `cat <entry>` 读取完整指令。')
  for (const s of skills) {
    lines.push(`  <skill>`)
    lines.push(`    <name>${s.name}</name>`)
    lines.push(`    <description>${s.description}</description>`)
    lines.push(`    <entry>${s.entry}</entry>`)
    lines.push(`  </skill>`)
  }
  lines.push('</available_skills>')
  lines.push('')
  lines.push('使用规则：')
  lines.push('1. 接到任务后，先判断是否有 Skill 的 description 与任务匹配。')
  lines.push('2. 若匹配，必须先执行 `cat <entry>` 读取完整 SKILL.md，再按其中步骤操作。')
  lines.push('3. SKILL.md 可能引用同目录下的其他文件（如 reference.md、forms.md），按需 `cat` 读取，不要一次全读。')
  lines.push('4. SKILL.md 中声明的脚本优先通过 `bash`/`python` 直接运行，不要把大文件读入上下文。')
  lines.push('5. 多个 Skill 可组合使用。若都不匹配，按常规方式完成任务。')
  return lines.join('\n')
}

const buildMemoryBlock = (blocks: MemoryBlock[]): string => {
  if (!blocks.length) return ''
  const lines: string[] = []
  lines.push('<memory_blocks>')
  lines.push('以下是持久化的记忆信息，这些是跨会话的重要上下文。请在适当时机使用记忆工具（listMemoryBlocks/getMemoryBlock/setMemoryBlock/replaceMemoryBlockText/deleteMemoryBlock）来管理记忆。')
  for (const b of blocks) {
    lines.push(`  <memory>`)
    lines.push(`    <label>${b.label}</label>`)
    lines.push(`    <description>${b.description}</description>`)
    lines.push(`    <value>${b.value}</value>`)
    lines.push(`    <chars_current>${b.chars_current}</chars_current>`)
    lines.push(`    <chars_limit>${b.chars_limit}</chars_limit>`)
    lines.push(`    <read_only>${b.read_only}</read_only>`)
    lines.push(`  </memory>`)
  }
  lines.push('</memory_blocks>')
  return lines.join('\n')
}

const loadMemoryBlocksForPrompt = async (): Promise<MemoryBlock[]> => {
  const lister = (window as any).localTools?.listMemoryBlocks
  if (typeof lister !== 'function') return []
  try {
    const response = await lister()
    if (response?.success && Array.isArray(response.data)) {
      return response.data as MemoryBlock[]
    }
  } catch {
    // ignore
  }
  return []
}

const resolveSystemPromptPlaceholders = (raw: string): string => {
  if (!raw) {
    return raw
  }
  const values = buildPlaceholderValues()
  return raw.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const value = values[key]
      return value ? value : match
    }
    return match
  })
}

const saveConfig = () => {
  ensureProviderSelection()
  systemPrompt.value = effectiveSystemPromptDraft.value
  appSettings.value = normalizeAppSettings(appSettingsDraft.value)
  persistConfig()
  systemPromptDraft.value = systemPrompt.value
  appSettingsDraft.value = cloneAppSettings(appSettings.value)
  showSettings.value = false
  showNotice('配置已保存，新对话会使用当前系统提示词、工具清单与交互设置。', 'success')
  void applyWorkspaceRootFromSettings()
  syncBashNotificationSetting()
}

const syncBashNotificationSetting = () => {
  const setter = (window as any).localTools?.setBashNotificationEnabled
  if (typeof setter === 'function') {
    setter(appSettings.value.enableBashNotification)
  }
}

const focusComposer = () => {
  nextTick(() => {
    textareaRef.value?.focus()
  })
}

let launchPayloadUnsubscribe: (() => void) | null = null

const handleLaunchPayload = (payload: string) => {
  const query = typeof payload === 'string' ? payload.trim() : ''
  if (!query) {
    return
  }
  const current = activeSession.value
  const currentRuntime = current ? ensureSessionRuntime(current.id) : null
  const canReuseCurrent = Boolean(
    current && current.messages.length === 0 && !currentRuntime?.isLoading,
  )
  if (!canReuseCurrent) {
    createNewSession()
  }
  const autoSend = appSettings.value.launchAutoSend
  nextTick(() => {
    input.value = query
    if (autoSend) {
      void sendMessage()
    } else {
      focusComposer()
    }
  })
}

const scrollToBottom = () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

const renderMarkdown = (content: string) => md.render(content)

const canCopyMessage = (message: ChatMessage) => {
  if (message.role === 'tool') {
    return false
  }
  return Boolean(String(message.content ?? '').trim())
}

const copyMessageText = async (message: ChatMessage) => {
  const value = String(message.content ?? '').trim()
  if (!value) {
    return
  }
  const ok = await copyTextToClipboard(value)
  if (!ok) {
    showNotice('复制失败，请手动选择文本复制。', 'error')
    return
  }
  copiedMessageId.value = message.id
  if (copiedMessageResetTimer) {
    clearTimeout(copiedMessageResetTimer)
  }
  copiedMessageResetTimer = setTimeout(() => {
    if (copiedMessageId.value === message.id) {
      copiedMessageId.value = null
    }
  }, 1800)
}

const copyToolField = async (blockId: string, field: 'arguments' | 'result', value: string) => {
  const text = String(value ?? '').trim()
  if (!text) {
    return
  }
  const ok = await copyTextToClipboard(text)
  if (!ok) {
    showNotice('复制失败，请手动选择文本复制。', 'error')
    return
  }
  const key = `${blockId}:${field}`
  copiedToolFieldKey.value = key
  if (copiedToolResetTimer) {
    clearTimeout(copiedToolResetTimer)
  }
  copiedToolResetTimer = setTimeout(() => {
    if (copiedToolFieldKey.value === key) {
      copiedToolFieldKey.value = null
    }
  }, 1800)
}

const isToolFieldCopied = (blockId: string, field: 'arguments' | 'result') =>
  copiedToolFieldKey.value === `${blockId}:${field}`

const handleDocumentCopyClick = (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  const copyBtn = target.closest('.md-code-copy') as HTMLButtonElement | null
  if (!copyBtn) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const encoded = copyBtn.dataset.code ?? ''
  let text = ''
  try {
    text = decodeURIComponent(encoded)
  } catch {
    text = ''
  }
  if (!text) {
    return
  }
  void copyTextToClipboard(text).then((success) => {
    if (!success) {
      showNotice('复制失败，请手动选择文本复制。', 'error')
      return
    }
    const label = copyBtn.querySelector('.md-code-copy-label') as HTMLElement | null
    copyBtn.classList.add('is-copied')
    if (label) {
      label.textContent = '已复制'
    }
    setTimeout(() => {
      copyBtn.classList.remove('is-copied')
      if (label) {
        label.textContent = '复制'
      }
    }, 1800)
  })
}

const runToolWithCancel = <T,>(sessionId: string, toolPromise: Promise<T>): Promise<T | { success: false; aborted: true; error: string }> => {
  const runtime = sessionRuntimeState.value[sessionId]
  if (runtime?.stopRequested) {
    return Promise.resolve({ success: false, aborted: true, error: '用户已中断本轮工具执行。' })
  }
  let unwatchStop: (() => void) | null = null
  const abortPromise = new Promise<{ success: false; aborted: true; error: string }>((resolve) => {
    unwatchStop = watch(
      () => sessionRuntimeState.value[sessionId]?.stopRequested,
      (stopRequested) => {
        if (stopRequested) {
          resolve({ success: false, aborted: true, error: '用户已中断本轮工具执行。' })
        }
      },
    )
  })
  return Promise.race([toolPromise, abortPromise]).finally(() => {
    if (unwatchStop) {
      unwatchStop()
    }
  })
}

const isAbortedToolResult = (value: unknown): value is { success: false; aborted: true; error: string } =>
  typeof value === 'object' && value !== null
  && (value as { success?: unknown }).success === false
  && (value as { aborted?: unknown }).aborted === true

const hasRenderableContent = (content: string) => Boolean(content.trim())

const shouldShowAssistantStreamPlaceholder = (message: ChatMessage) => {
  if (message.role !== 'assistant' || !message.isStreaming) {
    return false
  }

  const blocks = message.blocks ?? []
  if (!blocks.length) {
    return true
  }

  const lastBlock = blocks[blocks.length - 1]
  return lastBlock.type === 'tool' || !hasRenderableContent(lastBlock.content)
}

const getToolArgumentsPlaceholder = (tool: ToolInvocation) =>
  tool.status === 'draft' ? '参数正在生成中…' : '当前没有可展示的工具参数。'

const getToolResultPlaceholder = (tool: ToolInvocation) =>
  ({
    draft: '等待模型补全工具调用…',
    pending: '等待触发工具执行…',
    running: '正在等待本地工具返回结果…',
    success: '工具已完成，但当前没有结构化结果。',
    error: '工具执行失败，但当前没有错误详情。',
  })[tool.status]



const cloneMessages = (messageList: ChatMessage[]) =>
  messageList.map((message) => ({
    ...message,
    toolInvocations: message.toolInvocations.map((tool) => cloneToolInvocation(tool)),
    blocks: cloneMessageBlocks(message.blocks ?? []),
    attachments: cloneAttachments(message.attachments),
  }))

const getSessionById = (sessionId: string) =>
  sessions.value.find((session) => session.id === sessionId) || null

const ensureSessionRuntime = (sessionId: string): SessionRuntimeState => {
  if (!sessionRuntimeState.value[sessionId]) {
    sessionRuntimeState.value[sessionId] = {
      isLoading: false,
      activeRequestId: null,
      stopRequested: false,
      todos: [],
      todosUpdatedAt: 0,
    }
  }
  return sessionRuntimeState.value[sessionId]
}

const applySessionTodos = (sessionId: string, todos: TodoItem[]) => {
  const runtime = ensureSessionRuntime(sessionId)
  runtime.todos = Array.isArray(todos)
    ? todos.map((item) => ({
        content: String(item?.content ?? '').trim(),
        activeForm: String(item?.activeForm ?? item?.content ?? '').trim(),
        status: (['pending', 'in_progress', 'completed'] as const).includes(item?.status as TodoStatus)
          ? (item.status as TodoStatus)
          : 'pending',
      }))
    : []
  runtime.todosUpdatedAt = Date.now()
}

const syncActiveMessagesFromSession = (sessionId: string) => {
  if (currentSessionId.value !== sessionId) {
    return
  }
  const session = getSessionById(sessionId)
  messages.value = session ? cloneMessages(session.messages) : []
}

const mutateSessionMessages = (
  sessionId: string,
  updater: (messageList: ChatMessage[]) => void,
) => {
  const session = getSessionById(sessionId)
  if (!session) {
    return
  }
  const nextMessages = cloneMessages(session.messages)
  updater(nextMessages)
  session.messages = nextMessages
  syncActiveMessagesFromSession(sessionId)
}

const appendSessionMessage = (sessionId: string, message: ChatMessage) => {
  mutateSessionMessages(sessionId, (messageList) => {
    messageList.push(message)
  })
}

const loadDebugLogs = async () => {
  const getter = (window as any).localTools?.getDebugLogs
  if (typeof getter !== 'function') {
    return
  }

  isLoadingDebugLogs.value = true
  try {
    const response = await getter(200)
    if (response?.success && Array.isArray(response.data)) {
      debugLogs.value = response.data as DebugLogEntry[]
    }
  } finally {
    isLoadingDebugLogs.value = false
  }
}

const clearDebugLogs = async () => {
  const cleaner = (window as any).localTools?.clearDebugLogs
  if (typeof cleaner !== 'function') {
    return
  }

  await cleaner()
  await loadDebugLogs()
  showNotice('调试日志已清空。', 'success')
}

const maybeLoadDebugLogs = async (force = false) => {
  if (!force && !appSettings.value.autoRefreshDebugLogs && activeSettingsTab.value !== 'debug') {
    return
  }
  await loadDebugLogs()
}

const handleDocumentPointerDown = (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof Node)) {
    return
  }

  if (isModelMenuOpen.value && modelMenuRef.value && !modelMenuRef.value.contains(target)) {
    isModelMenuOpen.value = false
  }

  if (isPlusMenuOpen.value && plusMenuRef.value && !plusMenuRef.value.contains(target)) {
    isPlusMenuOpen.value = false
  }
}

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') {
    return
  }

  if (isPlusMenuOpen.value) {
    isPlusMenuOpen.value = false
  }

  if (isModelMenuOpen.value) {
    isModelMenuOpen.value = false
    return
  }

  if (showSettings.value) {
    closeSettings()
  }
}

watch(isModelMenuOpen, (open) => {
  if (!open) {
    modelMenuSearch.value = ''
    return
  }
  nextTick(() => {
    modelSearchInputRef.value?.focus()
  })
})

watch(messages, (list) => {
  for (const message of list) {
    if (!Array.isArray(message.attachments)) continue
    for (const attachment of message.attachments) {
      if (attachment.kind === 'image') {
        void ensureMessageImagePreview(attachment)
      }
    }
  }
}, { deep: true })

const handleComposerKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.isComposing) {
    return
  }

  const shouldSend = appSettings.value.composerSendMode === 'enter'
    ? !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    : (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey

  if (!shouldSend) {
    return
  }

  event.preventDefault()
  if (isCurrentSessionLoading.value) {
    void stopCurrentSessionRequest()
    return
  }

  void sendMessage()
}

const pendingConfirmation = ref<PendingToolConfirmation | null>(null)
const sessionAlwaysAllow = ref<Record<string, Set<string>>>({})

const normalizeRiskLevel = (value: unknown): ToolRiskLevel => {
  const raw = String(value ?? '').toLowerCase().trim()
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw
  return 'medium'
}

const riskLevelRank: Record<ToolRiskLevel, number> = { low: 0, medium: 1, high: 2 }

const getCanonicalToolName = (toolName: string) => {
  if (toolName === 'execCommand') return 'BashTool'
  if (toolName === 'writeFile') return 'FileWriteTool'
  if (toolName === 'readFile') return 'FileReadTool'
  if (toolName === 'readDir') return 'GlobTool'
  return toolName
}

const escapeRegExpForGlob = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

const matchCommandPattern = (command: string, rawPattern: string): boolean => {
  const normalized = String(command ?? '').trim()
  const pattern = String(rawPattern ?? '').trim()
  if (!pattern) return false
  if (pattern.includes('*')) {
    try {
      const regex = new RegExp(`^${escapeRegExpForGlob(pattern).replace(/\\\*/g, '.*')}$`)
      return regex.test(normalized)
    } catch {
      return false
    }
  }
  return normalized === pattern || normalized.startsWith(`${pattern} `)
}

const anyCommandPatternMatches = (command: string, patterns: string[]) =>
  patterns.some((pattern) => matchCommandPattern(command, pattern))

const decideToolGate = (
  toolName: string,
  parsedArguments: Record<string, unknown>,
  riskLevel: ToolRiskLevel,
  mode: SafetyMode,
  sessionId: string,
): ToolGateDecision => {
  if (mode === 'loose') return { kind: 'allow' }

  const canonical = getCanonicalToolName(toolName)

  if (mode === 'allowlist') {
    if (sessionAlwaysAllow.value[sessionId]?.has(canonical)) return { kind: 'allow' }

    const inToolList = appSettings.value.toolListNames.includes(canonical)
    const toolKind = appSettings.value.toolListKind
    const toolNeedsConfirm = toolKind === 'white' ? !inToolList : inToolList
    if (toolNeedsConfirm) {
      return { kind: 'confirm' }
    }

    if (canonical === 'BashTool') {
      const rawCommand = String((parsedArguments as any)?.command ?? '').trim()
      const patterns = appSettings.value.commandListPatterns
      const cmdInList = rawCommand ? anyCommandPatternMatches(rawCommand, patterns) : false
      const cmdKind = appSettings.value.commandListKind
      const cmdNeedsConfirm = cmdKind === 'white' ? !cmdInList : cmdInList
      if (cmdNeedsConfirm) {
        return {
          kind: 'confirm',
          allowlistAction: cmdKind === 'white' ? 'add_to_white' : 'remove_from_black',
          bashCommand: rawCommand,
        }
      }
    }

    return { kind: 'allow' }
  }

  if (!MUTATING_TOOL_NAMES.has(toolName)) return { kind: 'allow' }
  if (sessionAlwaysAllow.value[sessionId]?.has(canonical)) return { kind: 'allow' }

  if (mode === 'strict') return { kind: 'confirm' }

  const threshold = appSettings.value.moderateOnlyHigh ? riskLevelRank.high : riskLevelRank.medium
  return riskLevelRank[riskLevel] >= threshold ? { kind: 'confirm' } : { kind: 'allow' }
}

const requestToolConfirmation = (
  toolName: string,
  args: Record<string, unknown>,
  riskLevel: ToolRiskLevel,
  riskReason: string,
  sessionId: string,
  extras: { allowlistAction?: 'add_to_white' | 'remove_from_black'; bashCommand?: string } = {},
): Promise<ToolConfirmationDecision> => {
  const toolDef = getToolDefinition(toolName)
  const displayArgs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args || {})) {
    if (key === '__context' || key === 'riskLevel' || key === 'riskReason') continue
    displayArgs[key] = value
  }
  let argsPreview = ''
  try {
    argsPreview = JSON.stringify(displayArgs, null, 2)
  } catch {
    argsPreview = String(displayArgs)
  }
  return new Promise((resolve) => {
    pendingConfirmation.value = {
      id: `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      toolName,
      toolLabel: toolDef?.label || toolName,
      toolPurpose: toolDef?.purpose || '',
      args: displayArgs,
      argsPreview,
      riskLevel,
      riskReason,
      sessionId,
      allowlistAction: extras.allowlistAction,
      bashCommand: extras.bashCommand,
      resolve,
    }
  })
}

const applyAllowlistRemember = (pending: PendingToolConfirmation) => {
  const command = String(pending.bashCommand ?? '').trim()
  if (!command || !pending.allowlistAction) return
  const currentPatterns = [...appSettings.value.commandListPatterns]
  if (pending.allowlistAction === 'add_to_white') {
    if (!currentPatterns.includes(command)) {
      currentPatterns.push(command)
      const next = { ...appSettings.value, commandListPatterns: currentPatterns }
      appSettings.value = next
      appSettingsDraft.value = { ...appSettingsDraft.value, commandListPatterns: currentPatterns }
      persistConfig()
      showNotice(`已加入白名单：\`${command}\``, 'success')
    }
  } else if (pending.allowlistAction === 'remove_from_black') {
    const filtered = currentPatterns.filter((pattern) => !matchCommandPattern(command, pattern))
    if (filtered.length !== currentPatterns.length) {
      const next = { ...appSettings.value, commandListPatterns: filtered }
      appSettings.value = next
      appSettingsDraft.value = { ...appSettingsDraft.value, commandListPatterns: filtered }
      persistConfig()
      showNotice(`已从黑名单移除：\`${command}\``, 'success')
    }
  }
}

const resolvePendingConfirmation = (decision: ToolConfirmationDecision) => {
  const pending = pendingConfirmation.value
  if (!pending) return
  if (decision === 'allow_always') {
    const canonical = getCanonicalToolName(pending.toolName)
    const existing = sessionAlwaysAllow.value[pending.sessionId] ?? new Set<string>()
    existing.add(canonical)
    sessionAlwaysAllow.value = {
      ...sessionAlwaysAllow.value,
      [pending.sessionId]: existing,
    }
  }
  if (decision === 'allow_and_remember') {
    applyAllowlistRemember(pending)
  }
  pendingConfirmation.value = null
  pending.resolve(decision)
}

const getRiskLevelLabel = (risk: ToolRiskLevel) =>
  ({ low: '低风险', medium: '中风险', high: '高风险' })[risk]

const getSafetyModeLabel = (mode: SafetyMode) =>
  ({
    strict: '严格模式',
    moderate: '宽松模式',
    loose: '无视风险',
    allowlist: '黑白名单',
  })[mode]

const tryPrepareSnapshot = async (
  context: { sessionId: string; messageId: string } | null,
  filePath: unknown,
) => {
  if (!context) return
  const path = typeof filePath === 'string' ? filePath.trim() : ''
  if (!path) return
  const snapshotFile = (window as any).localTools?.snapshotFile
  if (typeof snapshotFile !== 'function') return
  try {
    const response = await snapshotFile(context, path)
    if (response?.success) {
      markMessageHasSnapshot(context.sessionId, context.messageId)
    }
  } catch {
    // best effort
  }
}

const executeLocalTool = async (
  functionName: string,
  parsedArguments: Record<string, unknown>,
  availableTool: any,
  context: { sessionId: string; messageId: string } | null = null,
) => {
  if (typeof functionName === 'string' && functionName.startsWith('mcp_')) {
    return await availableTool(parsedArguments)
  }

  if (typeof availableTool !== 'function') {
    return {
      success: false,
      error: '当前环境未提供此本地工具。',
    }
  }

  const sessionIdForConfirm = context?.sessionId ?? currentSessionId.value
  const riskLevel = normalizeRiskLevel(parsedArguments?.riskLevel)
  const riskReason = String(parsedArguments?.riskReason ?? '').trim()

  if (sessionIdForConfirm) {
    const gate = decideToolGate(
      functionName,
      parsedArguments,
      riskLevel,
      appSettings.value.safetyMode,
      sessionIdForConfirm,
    )
    if (gate.kind === 'deny') {
      return {
        success: false,
        denied: true,
        error: gate.reason,
        riskLevel,
        riskReason,
      }
    }
    if (gate.kind === 'confirm') {
      const decision = await requestToolConfirmation(
        functionName,
        parsedArguments,
        riskLevel,
        riskReason,
        sessionIdForConfirm,
        {
          allowlistAction: gate.allowlistAction,
          bashCommand: gate.bashCommand,
        },
      )
      if (decision === 'deny') {
        return {
          success: false,
          denied: true,
          error: '用户拒绝执行此操作。',
          riskLevel,
          riskReason,
        }
      }
    }
  }

  if (FILE_MUTATING_TOOLS.has(functionName)) {
    const targetPath = getArgumentByAliases(parsedArguments, ['filePath', 'path', 'file', 'targetPath', 'notebookPath'])
    await tryPrepareSnapshot(context, targetPath)
  }

  switch (functionName) {
    case 'FileReadTool':
    case 'readFile': {
      const filePath = getArgumentByAliases(parsedArguments, ['filePath', 'path', 'file', 'targetPath'])
      const offset = getArgumentByAliases(parsedArguments, ['offset', 'start', 'fromLine'])
      const limit = getArgumentByAliases(parsedArguments, ['limit', 'lines', 'maxLines', 'count'])
      return await availableTool({
        filePath: stringifyArgument(filePath),
        offset: offset === undefined || offset === null || offset === '' ? undefined : Number(offset),
        limit: limit === undefined || limit === null || limit === '' ? undefined : Number(limit),
      })
    }
    case 'FileWriteTool':
    case 'writeFile': {
      const filePath = getArgumentByAliases(parsedArguments, ['filePath', 'path', 'file', 'targetPath'])
      const content = getArgumentByAliases(parsedArguments, ['content', 'text', 'data', 'body'])
      return await availableTool(
        stringifyArgument(filePath),
        stringifyArgument(content),
      )
    }
    case 'FileDeleteTool': {
      const filePath = getArgumentByAliases(parsedArguments, ['filePath', 'path', 'file', 'targetPath'])
      const recursiveRaw = getArgumentByAliases(parsedArguments, ['recursive', 'force'])
      return await availableTool({
        filePath: stringifyArgument(filePath),
        recursive: Boolean(recursiveRaw),
        __context: context,
      })
    }
    case 'NotebookEditTool': {
      const notebookPath = getArgumentByAliases(parsedArguments, ['notebookPath', 'filePath', 'path', 'file'])
      const cellId = getArgumentByAliases(parsedArguments, ['cellId', 'cell_id', 'id'])
      const cellType = getArgumentByAliases(parsedArguments, ['cellType', 'cell_type'])
      const editMode = getArgumentByAliases(parsedArguments, ['editMode', 'edit_mode', 'mode'])
      const newSource = getArgumentByAliases(parsedArguments, ['newSource', 'new_source', 'source', 'content'])
      return await availableTool({
        notebookPath: stringifyArgument(notebookPath),
        cellId: cellId === undefined || cellId === null ? '' : String(cellId),
        cellType: cellType === undefined || cellType === null ? undefined : String(cellType),
        editMode: editMode === undefined || editMode === null ? undefined : String(editMode),
        newSource: newSource === undefined || newSource === null ? '' : String(newSource),
        __context: context,
      })
    }
    case 'BashTool':
    case 'execCommand': {
      const command = getArgumentByAliases(parsedArguments, ['command', 'cmd', 'script'])
      const cwd = getArgumentByAliases(parsedArguments, ['cwd', 'workdir', 'workingDirectory', 'path'])
      const description = getArgumentByAliases(parsedArguments, ['description', 'desc'])
      const timeoutRaw = getArgumentByAliases(parsedArguments, ['timeout', 'timeoutMs'])
      const runInBackground = getArgumentByAliases(parsedArguments, ['runInBackground', 'run_in_background', 'background'])
      return await availableTool({
        command: stringifyArgument(command),
        cwd: cwd === undefined || cwd === null || cwd === '' ? undefined : String(cwd),
        description: description === undefined || description === null ? '' : String(description),
        timeout: timeoutRaw === undefined || timeoutRaw === null || timeoutRaw === '' ? undefined : Number(timeoutRaw),
        runInBackground: Boolean(runInBackground),
      })
    }
    case 'BashOutputTool': {
      const bashId = getArgumentByAliases(parsedArguments, ['bashId', 'bash_id', 'id'])
      const filter = getArgumentByAliases(parsedArguments, ['filter', 'regex', 'pattern'])
      return await availableTool({
        bashId: stringifyArgument(bashId),
        filter: filter === undefined || filter === null ? '' : String(filter),
      })
    }
    case 'KillShellTool': {
      const bashId = getArgumentByAliases(parsedArguments, ['bashId', 'bash_id', 'id'])
      return await availableTool({ bashId: stringifyArgument(bashId) })
    }
    case 'SetWorkspaceRootTool': {
      const targetPath = getArgumentByAliases(parsedArguments, ['path', 'cwd', 'workspaceRoot', 'root', 'dir'])
      const result = await availableTool({ path: stringifyArgument(targetPath) })
      if (result?.success && typeof result?.data?.cwd === 'string') {
        currentWorkspaceCwd.value = result.data.cwd
      }
      return result
    }
    case 'GetWorkspaceRootTool': {
      const result = await availableTool()
      if (result?.success && typeof result?.data?.cwd === 'string') {
        currentWorkspaceCwd.value = result.data.cwd
      }
      return result
    }
    case 'WebFetchTool': {
      const url = getArgumentByAliases(parsedArguments, ['url', 'href', 'link', 'targetUrl'])
      const prompt = getArgumentByAliases(parsedArguments, ['prompt', 'question', 'query'])
      const llmConfig = currentProvider.value && selectedModel.value
        ? {
            apiKey: currentProvider.value.apiKey,
            baseURL: currentProvider.value.baseURL,
            model: selectedModel.value,
          }
        : null
      return await availableTool({
        url: stringifyArgument(url),
        prompt: prompt === undefined || prompt === null ? '' : String(prompt),
        llmConfig,
      })
    }
    case 'WebSearchTool': {
      const query = getArgumentByAliases(parsedArguments, ['query', 'keyword', 'keywords', 'q'])
      const count = getArgumentByAliases(parsedArguments, ['count', 'limit', 'num', 'maxResults'])
      const allowedDomains = getArgumentByAliases(parsedArguments, ['allowedDomains', 'allowed_domains', 'include_domains'])
      const blockedDomains = getArgumentByAliases(parsedArguments, ['blockedDomains', 'blocked_domains', 'exclude_domains'])
      return await availableTool({
        query: stringifyArgument(query),
        count: count === undefined || count === null || count === '' ? undefined : Number(count),
        apiKey: appSettings.value.tavilyApiKey,
        allowedDomains: Array.isArray(allowedDomains) ? allowedDomains.map((item) => String(item)) : [],
        blockedDomains: Array.isArray(blockedDomains) ? blockedDomains.map((item) => String(item)) : [],
      })
    }
    case 'GlobTool': {
      const limit = getArgumentByAliases(parsedArguments, ['limit', 'maxResults', 'max'])
      return await availableTool({
        pattern: stringifyArgument(getArgumentByAliases(parsedArguments, ['pattern', 'glob', 'match'])),
        path: stringifyArgument(getArgumentByAliases(parsedArguments, ['path', 'cwd', 'root', 'dir'])) || undefined,
        includeDirectories: Boolean(getArgumentByAliases(parsedArguments, ['includeDirectories', 'withDirectories'])),
        limit: limit === undefined || limit === null || limit === '' ? undefined : Number(limit),
      })
    }
    case 'GrepTool': {
      const outputMode = getArgumentByAliases(parsedArguments, ['outputMode', 'output_mode'])
      const beforeContextRaw = getArgumentByAliases(parsedArguments, ['beforeContext', 'before_context', '-B'])
      const afterContextRaw = getArgumentByAliases(parsedArguments, ['afterContext', 'after_context', '-A'])
      const contextRaw = getArgumentByAliases(parsedArguments, ['context', '-C'])
      const headLimitRaw = getArgumentByAliases(parsedArguments, ['headLimit', 'head_limit', 'limit', 'maxResults'])
      const offsetRaw = getArgumentByAliases(parsedArguments, ['offset'])
      const isRegexRaw = getArgumentByAliases(parsedArguments, ['isRegex', 'is_regex', 'regex'])
      const showLineNumbersRaw = getArgumentByAliases(parsedArguments, ['showLineNumbers', '-n', 'show_line_numbers'])
      return await availableTool({
        pattern: stringifyArgument(getArgumentByAliases(parsedArguments, ['pattern', 'query', 'keyword'])),
        path: stringifyArgument(getArgumentByAliases(parsedArguments, ['path', 'cwd', 'root', 'dir'])) || undefined,
        glob: stringifyArgument(getArgumentByAliases(parsedArguments, ['glob', 'filePattern', 'include'])) || undefined,
        type: getArgumentByAliases(parsedArguments, ['type', 'types']),
        outputMode: outputMode === undefined || outputMode === null ? undefined : String(outputMode),
        isRegex: isRegexRaw === undefined || isRegexRaw === null ? undefined : Boolean(isRegexRaw),
        caseSensitive: Boolean(getArgumentByAliases(parsedArguments, ['caseSensitive', 'matchCase'])),
        multiline: Boolean(getArgumentByAliases(parsedArguments, ['multiline', 'multi_line'])),
        beforeContext: beforeContextRaw === undefined || beforeContextRaw === null || beforeContextRaw === '' ? undefined : Number(beforeContextRaw),
        afterContext: afterContextRaw === undefined || afterContextRaw === null || afterContextRaw === '' ? undefined : Number(afterContextRaw),
        context: contextRaw === undefined || contextRaw === null || contextRaw === '' ? undefined : Number(contextRaw),
        showLineNumbers: showLineNumbersRaw === undefined || showLineNumbersRaw === null ? undefined : Boolean(showLineNumbersRaw),
        headLimit: headLimitRaw === undefined || headLimitRaw === null || headLimitRaw === '' ? undefined : Number(headLimitRaw),
        offset: offsetRaw === undefined || offsetRaw === null || offsetRaw === '' ? undefined : Number(offsetRaw),
      })
    }
    case 'TodoWriteTool': {
      const todos = getArgumentByAliases(parsedArguments, ['todos', 'tasks', 'items'])
      const result = await availableTool({
        todos: Array.isArray(todos) ? todos : [],
      })
      if (result?.success && Array.isArray(result?.data?.todos) && context?.sessionId) {
        applySessionTodos(context.sessionId, result.data.todos)
      }
      return result
    }
    case 'listMemoryBlocks': {
      return await availableTool()
    }
    case 'getMemoryBlock': {
      const label = getArgumentByAliases(parsedArguments, ['label', 'name', 'key'])
      return await availableTool({ label: label === undefined || label === null ? '' : String(label) })
    }
    case 'setMemoryBlock': {
      const label = getArgumentByAliases(parsedArguments, ['label', 'name', 'key'])
      const description = getArgumentByAliases(parsedArguments, ['description', 'desc'])
      const value = getArgumentByAliases(parsedArguments, ['value', 'content', 'text'])
      const chars_limit = getArgumentByAliases(parsedArguments, ['chars_limit', 'charsLimit', 'limit'])
      const read_only = getArgumentByAliases(parsedArguments, ['read_only', 'readOnly', 'readonly'])
      return await availableTool({
        label: label === undefined || label === null ? '' : String(label),
        description: description === undefined || description === null ? '' : String(description),
        value: value === undefined || value === null ? '' : String(value),
        chars_limit: chars_limit === undefined || chars_limit === null ? undefined : Number(chars_limit),
        read_only: Boolean(read_only),
      })
    }
    case 'replaceMemoryBlockText': {
      const label = getArgumentByAliases(parsedArguments, ['label', 'name', 'key'])
      const oldText = getArgumentByAliases(parsedArguments, ['oldText', 'old_text', 'oldString', 'search'])
      const newText = getArgumentByAliases(parsedArguments, ['newText', 'new_text', 'newString', 'replace'])
      return await availableTool({
        label: label === undefined || label === null ? '' : String(label),
        oldText: oldText === undefined || oldText === null ? '' : String(oldText),
        newText: newText === undefined || newText === null ? '' : String(newText),
      })
    }
    case 'deleteMemoryBlock': {
      const label = getArgumentByAliases(parsedArguments, ['label', 'name', 'key'])
      return await availableTool({ label: label === undefined || label === null ? '' : String(label) })
    }
    default: {
      const enrichedArgs = context
        ? { ...parsedArguments, __context: context }
        : parsedArguments
      return await availableTool(enrichedArgs)
    }
  }
}

const markMessageHasSnapshot = (sessionId: string, messageId: string) => {
  updateMessageById(sessionId, messageId, (message) =>
    message.hasSnapshot ? message : { ...message, hasSnapshot: true },
  )
}

const canRollbackMessage = (message: ChatMessage) => message.role === 'user'

const rollbackMessageState = ref<{ messageId: string; phase: 'restoring' | 'done' } | null>(null)

const rollbackToMessage = async (message: ChatMessage) => {
  if (message.role !== 'user') {
    return
  }
  const sessionId = currentSessionId.value
  if (!sessionId) return

  const runtime = ensureSessionRuntime(sessionId)
  if (runtime.isLoading) {
    await stopSessionRequest(sessionId, { silent: true })
  }

  rollbackMessageState.value = { messageId: message.id, phase: 'restoring' }
  let restoredFiles = 0
  let deletedFiles = 0
  let restoreErrorText = ''

  try {
    if (message.hasSnapshot) {
      const restore = (window as any).localTools?.restoreSnapshot
      if (typeof restore === 'function') {
        try {
          const response = await restore({ sessionId, messageId: message.id })
          if (response?.success) {
            restoredFiles = response.data?.restored ?? 0
            deletedFiles = response.data?.deleted ?? 0
          } else if (response?.error) {
            restoreErrorText = String(response.error)
          }
        } catch (error) {
          restoreErrorText = error instanceof Error ? error.message : '回滚失败'
        }
      }
    }

    const session = getSessionById(sessionId)
    if (!session) return
    const messageIndex = session.messages.findIndex((item) => item.id === message.id)
    if (messageIndex === -1) return

    const messagesToRemove = session.messages.slice(messageIndex)
    const clearMsgSnapshot = (window as any).localTools?.clearMessageSnapshot
    if (typeof clearMsgSnapshot === 'function') {
      for (const removed of messagesToRemove) {
        if (removed.id === message.id) continue
        if (removed.role === 'user' && removed.hasSnapshot) {
          try {
            await clearMsgSnapshot({ sessionId, messageId: removed.id })
          } catch {
            // ignore
          }
        }
      }
    }

    const restoredAttachments = Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => ({
          ...attachment,
          id: createAttachmentId(),
        }))
      : []
    for (const attachment of restoredAttachments) {
      if (attachment.kind === 'image' && !attachment.previewDataUrl && attachment.path) {
        void ensureMessageImagePreview(attachment)
      }
    }
    input.value = String(message.content ?? '')
    composerAttachments.value = restoredAttachments

    mutateSessionMessages(sessionId, (list) => {
      list.splice(messageIndex, list.length - messageIndex)
    })
    const sessionAfterSplice = getSessionById(sessionId)
    if (sessionAfterSplice) {
      const stillHasUserMessage = sessionAfterSplice.messages.some((item) => item.role === 'user')
      if (!stillHasUserMessage) {
        sessionAfterSplice.titleGenerated = false
      }
    }
    updateCurrentSession(sessionId)
    focusComposer()

    if (restoreErrorText) {
      showNotice(`已撤回消息，但文件回滚失败：${restoreErrorText}`, 'error')
    } else if (message.hasSnapshot && (restoredFiles || deletedFiles)) {
      const segments: string[] = []
      if (restoredFiles) segments.push(`恢复 ${restoredFiles} 个文件`)
      if (deletedFiles) segments.push(`删除 ${deletedFiles} 个`)
      showNotice(`已${segments.join('，')}，消息已放回输入框。`, 'success')
    } else if (message.hasSnapshot) {
      showNotice('已撤回消息，但没有文件需要恢复。', 'info')
    } else {
      showNotice('已撤回该消息到输入框。', 'success')
    }
  } finally {
    rollbackMessageState.value = null
  }
}

const isMessageRolling = (messageId: string) =>
  rollbackMessageState.value?.messageId === messageId && rollbackMessageState.value.phase === 'restoring'

const getRollbackButtonLabel = (message: ChatMessage) =>
  message.hasSnapshot ? '回滚到此处' : '撤回到此处'

const getRollbackButtonTitle = (message: ChatMessage) =>
  message.hasSnapshot
    ? '回滚 AI 在此消息之后对文件的改动，并将消息放回输入框'
    : '撤回此消息及其之后的对话，并放回输入框'




const getMessageRoleLabel = (role: MessageRole) =>
  ({
    assistant: '助手',
    user: '你',
    system: '系统',
    tool: '工具',
  })[role]

const getToolStatusLabel = (status: ToolInvocationStatus) =>
  ({
    draft: '生成参数',
    pending: '待执行',
    running: '执行中',
    success: '已完成',
    error: '失败',
  })[status]

const updateMessageById = (
  sessionId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
) => {
  mutateSessionMessages(sessionId, (messageList) => {
    const targetIndex = messageList.findIndex((message) => message.id === messageId)
    if (targetIndex === -1) {
      return
    }
    messageList[targetIndex] = updater(messageList[targetIndex])
  })
}

const appendMessageContent = (
  sessionId: string,
  messageId: string,
  delta: string,
  _options: {
    separate?: boolean
  } = {},
) => {
  updateMessageById(sessionId, messageId, (message) => {
    if (message.role !== 'assistant' || !delta) {
      return message
    }

    const nextBlocks = cloneMessageBlocks(message.blocks ?? [])
    const lastBlock = nextBlocks[nextBlocks.length - 1]

    if (lastBlock?.type === 'text') {
      lastBlock.content = `${lastBlock.content}${delta}`
    } else {
      nextBlocks.push({
        id: createBlockId(),
        type: 'text',
        content: delta,
      })
    }

    return syncAssistantMessageState({
      ...message,
      blocks: nextBlocks,
    })
  })
}

const replaceMessageContent = (
  sessionId: string,
  messageId: string,
  newContent: string,
) => {
  updateMessageById(sessionId, messageId, (message) => {
    if (message.role !== 'assistant') {
      return message
    }

    const nextBlocks = cloneMessageBlocks(message.blocks ?? [])
    const newTextBlocks = nextBlocks.filter((block) => block.type === 'text')
    const otherBlocks = nextBlocks.filter((block) => block.type !== 'text')

    if (newContent.trim()) {
      const mergedTextBlock: TextMessageBlock = {
        id: newTextBlocks.length > 0 ? newTextBlocks[0].id : createBlockId(),
        type: 'text',
        content: newContent,
      }
      return syncAssistantMessageState({
        ...message,
        blocks: [...otherBlocks, mergedTextBlock],
      })
    }

    return syncAssistantMessageState({
      ...message,
      blocks: otherBlocks,
    })
  })
}

const updateToolInvocation = (
  sessionId: string,
  messageId: string,
  matcher: { toolId?: string; index?: number },
  updater: (tool: ToolInvocation) => ToolInvocation,
) => {
  updateMessageById(sessionId, messageId, (message) => {
    if (message.role !== 'assistant') {
      return message
    }

    const nextBlocks = cloneMessageBlocks(message.blocks ?? [])
    const toolBlockIndices = nextBlocks
      .map((block, blockIndex) => block.type === 'tool' ? blockIndex : -1)
      .filter((blockIndex) => blockIndex >= 0)
    const targetBlockIndex = matcher.toolId
      ? nextBlocks.findIndex(
          (block) =>
            block.type === 'tool' &&
            (block.toolInvocation.id === matcher.toolId || block.toolInvocation.callId === matcher.toolId),
        )
      : toolBlockIndices[matcher.index ?? -1] ?? -1
    const currentBlock = nextBlocks[targetBlockIndex]

    if (!currentBlock || currentBlock.type !== 'tool') {
      return message
    }

    nextBlocks[targetBlockIndex] = {
      ...currentBlock,
      toolInvocation: updater(currentBlock.toolInvocation),
    }

    return syncAssistantMessageState({
      ...message,
      blocks: nextBlocks,
    })
  })
}

const appendToolInvocation = (
  sessionId: string,
  messageId: string,
  toolInvocation: ToolInvocation,
) => {
  updateMessageById(sessionId, messageId, (message) => {
    if (message.role !== 'assistant') {
      return message
    }

    return syncAssistantMessageState({
      ...message,
      blocks: [
        ...cloneMessageBlocks(message.blocks ?? []),
        {
          id: createBlockId(),
          type: 'tool',
          toolInvocation: {
            ...cloneToolInvocation(toolInvocation),
            expanded: toolInvocation.expanded || appSettings.value.autoExpandToolDetails,
          },
        },
      ],
    })
  })
}

const setToolExpandedByBlockId = (messageId: string, blockId: string, expanded: boolean) => {
  updateMessageById(currentSessionId.value, messageId, (message) => {
    if (message.role !== 'assistant') {
      return message
    }

    const nextBlocks = cloneMessageBlocks(message.blocks ?? [])
    const blockIndex = nextBlocks.findIndex((block) => block.id === blockId && block.type === 'tool')
    const currentBlock = nextBlocks[blockIndex]
    if (!currentBlock || currentBlock.type !== 'tool') {
      return message
    }

    nextBlocks[blockIndex] = {
      ...currentBlock,
      toolInvocation: {
        ...currentBlock.toolInvocation,
        expanded,
      },
    }

    return syncAssistantMessageState({
      ...message,
      blocks: nextBlocks,
    })
  })
}

const formatSessionTime = (value: number) => {
  const date = new Date(value)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()

  return new Intl.DateTimeFormat('zh-CN', isToday ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric' }).format(date)
}

const buildSessionTitle = (content: string) => {
  const summary = content.replace(/\s+/g, ' ').trim()
  if (!summary) {
    return '新对话'
  }
  return summary.length > 18 ? `${summary.slice(0, 18)}…` : summary
}

const saveSessionsToStorage = () => {
  localStorage.setItem('kuke_sessions', JSON.stringify(sessions.value))
}

const updateCurrentSession = (sessionId = currentSessionId.value) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  if (!session) {
    return
  }

  if (sessionId === currentSessionId.value) {
    session.messages = cloneMessages(messages.value)
  }
  session.updatedAt = Date.now()

  if (!session.titleGenerated) {
    const firstUserMessage = session.messages.find((message) => message.role === 'user')
    if (firstUserMessage) {
      session.title = buildSessionTitle(firstUserMessage.content)
    }
  }

  sessions.value.sort((a, b) => b.updatedAt - a.updatedAt)
  saveSessionsToStorage()
}

const switchSession = (id: string) => {
  const session = sessions.value.find((item) => item.id === id)
  if (!session) {
    return
  }

  currentSessionId.value = id
  messages.value = cloneMessages(session.messages)

  if (window.innerWidth < 768) {
    isSidebarOpen.value = false
  }

  scrollToBottom()
}

const createNewSession = () => {
  const newSession: ChatSession = {
    id: Date.now().toString(),
    title: '新对话',
    messages: [],
    updatedAt: Date.now(),
  }

  sessions.value.unshift(newSession)
  ensureSessionRuntime(newSession.id)
  switchSession(newSession.id)
  saveSessionsToStorage()
  focusComposer()
}

const deleteSession = async (id: string, event: Event) => {
  event.stopPropagation()
  await stopSessionRequest(id, { silent: true })
  delete sessionRuntimeState.value[id]
  delete sessionAlwaysAllow.value[id]
  sessions.value = sessions.value.filter((session) => session.id !== id)

  const clearSnapshots = (window as any).localTools?.clearSessionSnapshots
  if (typeof clearSnapshots === 'function') {
    try {
      await clearSnapshots(id)
    } catch {
      // best effort
    }
  }

  if (!sessions.value.length) {
    createNewSession()
    return
  }

  if (currentSessionId.value === id) {
    switchSession(sessions.value[0].id)
  }

  saveSessionsToStorage()
}

const loadSessionsFromStorage = () => {
  const stored = localStorage.getItem('kuke_sessions')

  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      sessions.value = Array.isArray(parsed)
        ? parsed.map((session) => ({
            ...session,
            messages: normalizeMessages((session as Partial<ChatSession>).messages),
            systemPromptSnapshot:
              typeof (session as Partial<ChatSession>).systemPromptSnapshot === 'string' &&
                (session as Partial<ChatSession>).systemPromptSnapshot?.trim()
                ? String((session as Partial<ChatSession>).systemPromptSnapshot)
                : undefined,
            titleGenerated: Boolean((session as Partial<ChatSession>).titleGenerated),
          }))
        : []
    } catch {
      sessions.value = []
    }
  }

  if (!sessions.value.length) {
    createNewSession()
    return
  }

  sessions.value.sort((a, b) => b.updatedAt - a.updatedAt)
  sessions.value.forEach((session) => {
    ensureSessionRuntime(session.id)
  })
  switchSession(sessions.value[0].id)
}

const selectProvider = (id: string) => {
  selectedProviderId.value = id
  ensureProviderSelection()
}

const addManualModel = () => {
  const nextModel = manualModelInput.value.trim()
  if (!nextModel) {
    return
  }

  if (!currentProvider.value.models.includes(nextModel)) {
    currentProvider.value.models = [...currentProvider.value.models, nextModel].sort()
    showNotice('已添加自定义模型。', 'success')
  }

  selectedModel.value = nextModel
  manualModelInput.value = ''
}

const removeModel = (modelToRemove: string) => {
  if (!currentProvider.value) return
  if (currentProvider.value.models.length <= 1) {
    showNotice('至少保留一个模型。', 'error')
    return
  }
  currentProvider.value.models = currentProvider.value.models.filter((m) => m !== modelToRemove)
  if (selectedModel.value === modelToRemove) {
    selectedModel.value = currentProvider.value.models[0] || ''
  }
}

const addNewProvider = () => {
  const newId = `provider_${Date.now()}`
  providers.value.push({
    id: newId,
    name: '新供应商',
    type: 'openai',
    baseURL: 'https://',
    apiKey: '',
    models: ['default-model'],
  })
  selectedProviderId.value = newId
  selectedModel.value = 'default-model'
  manualModelInput.value = ''
}

const removeProvider = (id: string) => {
  if (providers.value.length <= 1) {
    showNotice('至少保留一个供应商。', 'error')
    return
  }

  providers.value = providers.value.filter((provider) => provider.id !== id)

  if (selectedProviderId.value === id) {
    selectedProviderId.value = providers.value[0].id
    selectedModel.value = providers.value[0].models[0] || ''
  }
}

const exportProviders = () => {
  const data = JSON.stringify(providers.value, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kuke-providers-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  showNotice('供应商配置已导出', 'success')
}

const importProviders = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const imported = JSON.parse(text)
      if (!Array.isArray(imported)) {
        showNotice('导入失败：文件格式不正确，需要 JSON 数组。', 'error')
        return
      }
      for (const p of imported) {
        if (!p.id || !p.name) {
          showNotice('导入失败：供应商数据缺少必要字段。', 'error')
          return
        }
      }
      // Merge: add new providers with new IDs, skip if same ID already exists
      let added = 0
      for (const p of imported) {
        var existing = providers.value.find((existing) => existing.id === p.id)
        if (!existing) {
          providers.value.push(p)
          added += 1
        }
      }
      showNotice(`成功导入 ${added} 个供应商（已存在的未覆盖）。`, 'success')
    } catch (err) {
      showNotice('导入失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    }
  }
  input.click()
}

const fetchModels = async () => {
  if (!currentProvider.value.baseURL || !currentProvider.value.apiKey) {
    showNotice('请先填写完整的 Base URL 与 API Key。', 'error')
    return
  }

  const modelFetcher = (window as any).localTools?.getModels
  if (typeof modelFetcher !== 'function') {
    showNotice('当前环境不支持获取模型列表。', 'error')
    return
  }

  isFetchingModels.value = true
  try {
    const response = await modelFetcher({
      apiKey: currentProvider.value.apiKey,
      baseURL: currentProvider.value.baseURL,
      providerType: currentProvider.value.type,
    })

    if (!response.success || !response.data) {
      if (response.error) {
        throw new Error(response.error)
      }
      return
    }

    const fetchedModels = response.data.map((model: { id: string }) => model.id)
    if (fetchedModels.length > 0) {
      currentProvider.value.models = Array.from(new Set([...currentProvider.value.models, ...fetchedModels])).sort()
    }

    if (!currentProvider.value.models.includes(selectedModel.value)) {
      selectedModel.value = currentProvider.value.models[0] || ''
    }

    showNotice('模型列表已同步。', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取模型失败'
    showNotice(message, 'error')
  } finally {
    isFetchingModels.value = false
  }
}

const isRequestStillActive = (sessionId: string, requestId: string) => {
  const runtime = ensureSessionRuntime(sessionId)
  return runtime.activeRequestId === requestId && runtime.isLoading
}

const stopSessionRequest = async (sessionId: string, options: { silent?: boolean } = {}) => {
  const runtime = ensureSessionRuntime(sessionId)
  if (!runtime.isLoading || !runtime.activeRequestId) {
    return
  }

  runtime.stopRequested = true
  const cancelChat = (window as any).localTools?.cancelChat
  if (typeof cancelChat === 'function') {
    await cancelChat(runtime.activeRequestId)
  }

  if (!options.silent && currentSessionId.value === sessionId) {
    showNotice('已请求中断当前会话。', 'info')
  }
}

const stopCurrentSessionRequest = async () => {
  if (!currentSessionId.value) {
    return
  }
  await stopSessionRequest(currentSessionId.value)
}

const ensureImagePreviewDataUrls = async (attachments: Attachment[]) => {
  const readDataUrl = (window as any).localTools?.readFileAsDataURL
  for (const attachment of attachments) {
    if (attachment.kind !== 'image' || attachment.previewDataUrl) {
      continue
    }
    if (!attachment.path || typeof readDataUrl !== 'function') {
      continue
    }
    try {
      const response = await readDataUrl(attachment.path)
      if (response?.success && response.data?.dataUrl) {
        attachment.previewDataUrl = response.data.dataUrl
      }
    } catch {
      // ignore
    }
  }
}

const buildUserApiMessage = async (message: ChatMessage) => {
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  const attachmentNote = buildAttachmentNoteText(attachments)
  const textContent = [message.content, attachmentNote].filter(Boolean).join('\n\n')
  const imageAttachments = attachments.filter((item) => item.kind === 'image')
  if (!imageAttachments.length) {
    return { role: 'user', content: textContent }
  }
  await ensureImagePreviewDataUrls(imageAttachments)
  const imageParts = imageAttachments
    .filter((item) => item.previewDataUrl)
    .map((item) => ({
      type: 'image_url',
      image_url: { url: item.previewDataUrl as string },
    }))
  if (!imageParts.length) {
    return { role: 'user', content: textContent }
  }
  return {
    role: 'user',
    content: [
      { type: 'text', text: textContent },
      ...imageParts,
    ],
  }
}

const sanitizeGeneratedTitle = (raw: string) => {
  let value = String(raw ?? '').replace(/\r/g, '').trim()
  value = value.split(/\n+/)[0]?.trim() ?? ''
  value = value.replace(/^(标题|主题|title)\s*[:：\-]?\s*/i, '')
  value = value.replace(/^[\s"'`「」『』“”‹›《》【】\[\]（）()]+/, '')
  value = value.replace(/[\s"'`「」『』“”‹›《》【】\[\]（）()。,.!?！？;；]+$/, '')
  value = value.trim()
  if (!value) return ''
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

const generateSessionTitleAsync = async (sessionId: string, seedContent: string) => {
  const chat = (window as any).localTools?.chat
  if (typeof chat !== 'function') return
  const seed = String(seedContent ?? '').trim()
  if (!seed) return
  if (!currentProvider.value?.baseURL || !selectedModel.value) return
  try {
    const response = await chat(
      {
        apiKey: currentProvider.value.apiKey,
        baseURL: currentProvider.value.baseURL,
        model: selectedModel.value,
        providerType: currentProvider.value.type,
      },
      [
        {
          role: 'system',
          content: '根据用户接下来的一条消息，生成一个简短的中文会话标题。要求：直接输出标题本身，不加引号、不加前缀标签、不加句末标点，不超过 12 个汉字，精确概括话题。',
        },
        { role: 'user', content: seed.slice(0, 800) },
      ],
      [],
      {},
      { requestId: `${sessionId}_title_${createMessageId()}` },
    )
    if (!response?.success) return
    const raw = typeof response.data?.content === 'string'
      ? response.data.content
      : Array.isArray(response.data?.content)
        ? response.data.content
            .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
            .join('')
        : ''
    const title = sanitizeGeneratedTitle(raw)
    if (!title) return
    const targetSession = getSessionById(sessionId)
    if (!targetSession) return
    targetSession.title = title
    targetSession.titleGenerated = true
    saveSessionsToStorage()
  } catch {
    // 标题生成失败不影响主流程
  }
}

const sendMessage = async () => {
  const sessionId = currentSessionId.value
  if (!sessionId) {
    return
  }
  const runtime = ensureSessionRuntime(sessionId)
  const content = input.value.trim()
  const attachmentsSnapshot = composerAttachments.value.map((item) => ({ ...item }))
  if ((!content && !attachmentsSnapshot.length) || runtime.isLoading) {
    return
  }

  const chat = (window as any).localTools?.chat
  if (typeof chat !== 'function') {
    showNotice('未检测到插件运行环境，当前无法发起聊天请求。', 'error')
    return
  }

  const userMessage = createMessage('user', content, {
    attachments: attachmentsSnapshot.map(serializeAttachmentForStorage),
  })
  attachmentsSnapshot.forEach((attachment) => {
    if (attachment.kind === 'image' && attachment.previewDataUrl) {
      messageImagePreview.value[attachment.id] = attachment.previewDataUrl
    }
  })
  appendSessionMessage(sessionId, userMessage)
  input.value = ''
  clearComposerAttachments()
  updateCurrentSession(sessionId)

  const session = getSessionById(sessionId)
  if (!session) {
    return
  }

  const userMessageCount = session.messages.filter((item) => item.role === 'user').length
  if (userMessageCount === 1 && content) {
    void generateSessionTitleAsync(sessionId, content)
  }
  const sessionSystemPrompt = ensureSessionSystemPrompt(sessionId)
  const resolvedSystemPrompt = resolveSystemPromptPlaceholders(sessionSystemPrompt)
  const skillsBlock = buildSkillsBlock(discoveredSkills.value)

  const memoryBlocksForPrompt = await loadMemoryBlocksForPrompt()
  const memoryBlock = buildMemoryBlock(memoryBlocksForPrompt)
  let finalSystemPrompt = skillsBlock ? `${resolvedSystemPrompt}\n\n${skillsBlock}` : resolvedSystemPrompt
  if (memoryBlock) {
    finalSystemPrompt = `${finalSystemPrompt}\n\n${memoryBlock}`
  }

  const apiMessages: any[] = [
    { role: 'system', content: finalSystemPrompt },
  ]
  for (const existing of session.messages) {
    if (['system', 'tool'].includes(existing.role)) continue
    if (existing.role === 'user') {
      apiMessages.push(await buildUserApiMessage(existing))
    } else {
      apiMessages.push({ role: existing.role, content: existing.content })
    }
  }
  runtime.isLoading = true
  runtime.stopRequested = false
  const requestId = `${sessionId}_${createMessageId()}`
  runtime.activeRequestId = requestId
  const snapshotContext = { sessionId, messageId: userMessage.id }
  const assistantMessage = createMessage('assistant', '', {
    isStreaming: true,
    toolInvocations: [],
  })
  appendSessionMessage(sessionId, assistantMessage)
  const assistantMessageId = assistantMessage.id
  scrollToBottom()

  try {
    const chatConfig = {
      apiKey: currentProvider.value.apiKey,
      baseURL: currentProvider.value.baseURL,
      model: selectedModel.value,
      providerType: currentProvider.value.type,
    }
    const enabledToolsForRequest = appSettings.value.enableLocalTools ? enabledTools.value : []
    const configuredToolRoundLimit = appSettings.value.enableToolRoundLimit
      ? clampToolRoundLimit(appSettings.value.maxToolCallRounds)
      : null
    let currentRound = 0
    let hasAssistantText = false
    let stoppedByToolError = false
    const roundFileChanges = new Map<string, { added: number; removed: number; kind: string }>()

    while (true) {
      if (configuredToolRoundLimit !== null && currentRound >= configuredToolRoundLimit) {
        break
      }
      let currentRoundStreamed = false
      const response = await chat(
        chatConfig,
        apiMessages,
        enabledToolsForRequest,
        {
          onEvent: (event: any) => {
            if (!isRequestStillActive(sessionId, requestId)) {
              return
            }
            if (appSettings.value.enableStreamResponse && event.type === 'content_delta' && event.delta) {
              appendMessageContent(sessionId, assistantMessageId, String(event.delta), {
                separate: hasAssistantText && !currentRoundStreamed,
              })
              currentRoundStreamed = true
              hasAssistantText = true
            }

            if (event.type === 'content_replace') {
              replaceMessageContent(sessionId, assistantMessageId, String(event.content ?? ''))
            }

            if (appSettings.value.autoScrollWhileStreaming && currentSessionId.value === sessionId) {
              scrollToBottom()
            }
          },
        },
        { requestId, sessionId },
      )

      if (!isRequestStillActive(sessionId, requestId)) {
        break
      }
      if (!response.success) {
        if (response.aborted || runtime.stopRequested) {
          break
        }
        throw new Error(response.error || '请求失败')
      }

      const assistantRoundMessage = response.data
      const assistantRoundText =
        typeof assistantRoundMessage?.content === 'string' ? assistantRoundMessage.content : ''

      if (!currentRoundStreamed && assistantRoundText) {
        appendMessageContent(sessionId, assistantMessageId, assistantRoundText, {
          separate: hasAssistantText,
        })
        hasAssistantText = true
      }

      const toolCalls = Array.isArray(assistantRoundMessage?.tool_calls)
        ? assistantRoundMessage.tool_calls
        : []

      apiMessages.push(assistantRoundMessage)

      if (!toolCalls.length) {
        break
      }

      for (const [toolIndex, toolCall] of toolCalls.entries()) {
        if (!isRequestStillActive(sessionId, requestId) || runtime.stopRequested) {
          break
        }
        const functionName = toolCall.function?.name ?? toolCall.name ?? (toolCall as any).function_name
        const rawArguments = toolCall.function?.arguments ?? toolCall.arguments ?? (toolCall as any).arguments_json ?? '{}'
        const parsedArguments = tryParseJson(rawArguments)
        const isMcpTool = typeof functionName === 'string' && functionName.startsWith('mcp_')
        const mcpToolWrapper = isMcpTool && parsedArguments
          ? (async (_args: any) => {
              const MCP_PREFIX = 'mcp_'
              const SEP = '__'
              if (functionName.startsWith(MCP_PREFIX)) {
                const rest = functionName.substring(MCP_PREFIX.length)
                const lastSepIndex = rest.lastIndexOf(SEP)
                if (lastSepIndex > 0) {
                  const serverId = rest.substring(0, lastSepIndex)
                  const toolName = rest.substring(lastSepIndex + SEP.length)
                  const callMcp = (window as any).localTools?.callMcpTool
                  if (typeof callMcp === 'function') {
                    return await callMcp({ serverId, toolName, arguments: _args || {} })
                  }
                }
              }
              return { success: false, error: 'MCP tool handler not found' }
            })
          : null
        const availableTool = mcpToolWrapper ?? (window as any).localTools?.[functionName]
        const rawToolCallId = typeof toolCall.id === 'string'
          ? toolCall.id.trim()
          : toolCall.id === undefined || toolCall.id === null
            ? ''
            : String(toolCall.id).trim()
        const toolCallId = rawToolCallId || `tool_${currentRound}_${toolIndex}`
        ;(toolCall as any).id = toolCallId
        appendToolInvocation(sessionId, assistantMessageId, {
          id: toolCallId,
          callId: toolCallId,
          name: functionName,
          argumentsText: stringifyForBlock(rawArguments),
          resultText: '等待触发工具执行…',
          status: 'pending',
          expanded: false,
        })

        updateToolInvocation(sessionId, assistantMessageId, { toolId: toolCallId }, (tool) => ({
          ...tool,
          callId: toolCallId,
          name: functionName,
          argumentsText: stringifyForBlock(rawArguments),
          resultText: '正在等待本地工具返回结果…',
          status: 'running',
          expanded: tool.expanded,
        }))
        if (currentSessionId.value === sessionId) {
          scrollToBottom()
        }

        let toolResult: unknown = null

        if (parsedArguments === null || typeof parsedArguments !== 'object') {
          toolResult = {
            success: false,
            error: '工具参数解析失败',
            rawArguments,
          }
        } else if (typeof availableTool === 'function') {
          toolResult = await runToolWithCancel(
            sessionId,
            Promise.resolve().then(() =>
              executeLocalTool(
                functionName,
                parsedArguments as Record<string, unknown>,
                availableTool,
                snapshotContext,
              ),
            ),
          )
        } else {
          toolResult = {
            success: false,
            error: '当前环境未提供此本地工具。',
          }
        }

        const aborted = isAbortedToolResult(toolResult)
        const toolResultText = aborted
          ? '用户已中断该工具执行。'
          : stringifyForBlock(toolResult)
        const toolStatus: ToolInvocationStatus = aborted || isToolResultError(toolResult) ? 'error' : 'success'

        const toolResultDiff = !aborted && toolResult && typeof toolResult === 'object' && (toolResult as any)?.success
          ? normalizeToolDiff((toolResult as any)?.data?.diff)
          : null
        if (toolResultDiff && toolStatus === 'success') {
          const canonicalPath = toolResultDiff.filePath
            ?? String(getArgumentByAliases(parsedArguments as Record<string, unknown>, ['filePath', 'path', 'notebookPath', 'targetPath', 'file']) ?? '')
          if (canonicalPath) {
            const existing = roundFileChanges.get(canonicalPath) ?? { added: 0, removed: 0, kind: functionName }
            existing.added += toolResultDiff.addedLines
            existing.removed += toolResultDiff.removedLines
            existing.kind = functionName
            roundFileChanges.set(canonicalPath, existing)
          }
        }

        let serializedToolResult = ''
        if (typeof toolResult === 'string') {
          serializedToolResult = toolResult
        } else {
          try {
            serializedToolResult = JSON.stringify(toolResult)
          } catch {
            serializedToolResult = String(toolResult)
          }
        }

        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          name: functionName,
          content: serializedToolResult,
        })

        updateToolInvocation(sessionId, assistantMessageId, { toolId: toolCallId }, (tool) => ({
          ...tool,
          resultText: toolResultText,
          status: toolStatus,
          diff: toolResultDiff,
          expanded: tool.expanded,
        }))
        if (appSettings.value.stopWhenToolError && toolStatus === 'error') {
          stoppedByToolError = true
          break
        }
        await maybeLoadDebugLogs()
        if (appSettings.value.autoScrollWhileStreaming && currentSessionId.value === sessionId) {
          scrollToBottom()
        }
      }

      if (stoppedByToolError) {
        appendSessionMessage(
          sessionId,
          createMessage('system', '检测到工具调用失败，已根据设置停止后续工具链。请检查错误详情后重试。'),
        )
        break
      }

      if (runtime.stopRequested || !isRequestStillActive(sessionId, requestId)) {
        break
      }

      currentRound += 1
    }

    const summaryFiles: ChangeSummaryFile[] = []
    let summaryAdded = 0
    let summaryRemoved = 0
    for (const [path, stats] of roundFileChanges.entries()) {
      summaryFiles.push({
        path,
        added: stats.added,
        removed: stats.removed,
        kind: stats.kind,
      })
      summaryAdded += stats.added
      summaryRemoved += stats.removed
    }
    const roundChangeSummary: ChangeSummary | null = summaryFiles.length
      ? { files: summaryFiles, addedLines: summaryAdded, removedLines: summaryRemoved }
      : null

    updateMessageById(sessionId, assistantMessageId, (current) => ({
      ...current,
      isStreaming: false,
      content:
        (current.content.trim() || current.toolInvocations.length > 0)
          ? current.content
          : '已完成请求，但模型未返回可展示文本。',
      changeSummary: roundChangeSummary,
    }))

    if (runtime.stopRequested) {
      appendSessionMessage(sessionId, createMessage('system', '当前会话请求已中断。'))
    } else if (configuredToolRoundLimit !== null && currentRound >= configuredToolRoundLimit) {
      appendSessionMessage(
        sessionId,
        createMessage('system', `达到工具调用轮次上限（${configuredToolRoundLimit}），已停止继续调用。请检查工具输出或缩小问题范围后重试。`),
      )
    }

    updateCurrentSession(sessionId)
    if (appSettings.value.enableBashNotification && currentSessionId.value === sessionId) {
      const sender = (window as any).localTools?.sendNotification
      if (typeof sender === 'function') {
        sender({ title: 'AI 任务完成', body: '点击查看结果' })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败'
    mutateSessionMessages(sessionId, (messageList) => {
      const sanitizedList = messageList
        .filter((item) => !(item.role === 'assistant' && item.isStreaming && !item.content.trim() && !item.toolInvocations.length))
        .map((item) => (item.isStreaming ? { ...item, isStreaming: false } : item))
      messageList.splice(0, messageList.length, ...sanitizedList)
      messageList.push(createMessage('system', `请求失败：${message}`))
    })
    if (currentSessionId.value === sessionId) {
      showNotice(message, 'error')
    }
  } finally {
    const latestRuntime = sessionRuntimeState.value[sessionId]
    if (latestRuntime && latestRuntime.activeRequestId === requestId) {
      latestRuntime.isLoading = false
      latestRuntime.activeRequestId = null
      latestRuntime.stopRequested = false
    }
    updateCurrentSession(sessionId)
    if (currentSessionId.value === sessionId) {
      scrollToBottom()
    }
  }
}

onMounted(() => {
  ensureProviderSelection()
  syncBashNotificationSetting()
  loadSessionsFromStorage()
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  window.addEventListener('resize', handleResize)
  document.addEventListener('keydown', handleGlobalKeydown)
  document.addEventListener('click', handleDocumentCopyClick)
  void maybeLoadDebugLogs(true)
  environmentReady.value = Boolean((window as any).localTools?.chat)

  try {
    const subscribe = (window as any).localTools?.onLaunchPayload
    if (typeof subscribe === 'function') {
      launchPayloadUnsubscribe = subscribe((payload: unknown) => {
        if (typeof payload === 'string') {
          handleLaunchPayload(payload)
        }
      })
    } else {
      const getPayload = (window as any).localTools?.getPendingLaunchPayload
      if (typeof getPayload === 'function') {
        const pendingQuery = getPayload()
        if (typeof pendingQuery === 'string') {
          handleLaunchPayload(pendingQuery)
        }
      }
    }
  } catch { /* best effort */ }

  try {
    (window as any).localTools?.cleanupUploads?.()
  } catch { /* best effort */ }

  try {
    const envResult = (window as any).localTools?.getEnvironment?.()
    if (envResult?.success && envResult.data && typeof envResult.data === 'object') {
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(envResult.data)) {
        next[key] = value == null ? '' : String(value)
      }
      environmentInfo.value = next
    }
  } catch {
    // best-effort; placeholders will fall back to browser-side values
  }

  if (!environmentReady.value) {
    showNotice('当前处于浏览器预览模式，聊天与本地工具需在插件环境中使用。', 'info')
  }

  void applyWorkspaceRootFromSettings()

  // 自动加载保存的 MCP 配置
  try {
    const savedMcp = localStorage.getItem('kuke_mcp_servers')
    if (savedMcp) {
      const saved = JSON.parse(savedMcp)
      const entries = Object.entries(saved)
      if (entries.length > 0) {
        for (const [name, config] of entries) {
          const c = config as any
          if (c.url) {
            ;(window as any).localTools?.connectMcpAsync?.({ name, url: c.url, headers: c.headers, transport: c.transport })
          } else if (c.command) {
            ;(window as any).localTools?.connectMcpAsync?.({ name, command: c.command, args: c.args, env: c.env, cwd: c.cwd })
          }
        }
        setTimeout(() => refreshMcpServers(), 1000)
      }
    }
  } catch { /* best effort */ }

  try {
    const discover = (window as any).localTools?.discoverSkills
    if (typeof discover === 'function') {
      const response = discover()
      if (response?.success && Array.isArray(response.data)) {
        discoveredSkills.value = response.data as DiscoveredSkill[]
      }
    }
  } catch {
    // best effort
  }

  refreshActiveBashShells()
  bashShellsPollTimer = setInterval(refreshActiveBashShells, 3000)

  focusComposer()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleGlobalKeydown)
  document.removeEventListener('click', handleDocumentCopyClick)
  window.removeEventListener('resize', handleResize)
  if (noticeTimer) {
    clearTimeout(noticeTimer)
  }
  if (copiedMessageResetTimer) {
    clearTimeout(copiedMessageResetTimer)
  }
  if (copiedToolResetTimer) {
    clearTimeout(copiedToolResetTimer)
  }
  if (bashShellsPollTimer) {
    clearInterval(bashShellsPollTimer)
  }
  if (launchPayloadUnsubscribe) {
    try {
      launchPayloadUnsubscribe()
    } catch { /* best effort */ }
    launchPayloadUnsubscribe = null
  }
})
</script>

<template>
  <div :class="['app-root relative flex h-screen w-screen overflow-hidden bg-[var(--app-bg)] text-[var(--text)] font-sans', { dark: isDark }]">
    <Transition name="overlay-fade">
      <div
        v-if="isSidebarOpen"
        class="motion-overlay absolute inset-0 z-20 bg-zinc-900/28 backdrop-blur-md md:hidden"
        @click="isSidebarOpen = false"
      ></div>
    </Transition>

    <!-- Sidebar -->
    <aside
      :class="[
        'sidebar-drawer absolute inset-y-0 left-0 z-30 flex w-[260px] flex-col border-r border-[var(--border)] bg-[var(--surface-muted)]/75 md:static md:z-auto',
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:w-0 md:border-none'
      ]"
    >
      <div class="flex h-full w-[260px] flex-shrink-0 flex-col">
        <!-- Sidebar Header: New Chat & Toggle -->
        <div class="p-3 flex items-center gap-2">
          <button
            class="motion-surface flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-sm font-medium text-[var(--text-muted)] shadow-sm hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
            @click="createNewSession"
          >
            <Plus class="h-4 w-4" />
            新对话
          </button>
          <button
            class="motion-surface flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-[var(--text-subtle)] shadow-sm hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
            @click="isSidebarOpen = false"
            title="关闭侧边栏"
          >
            <PanelLeftClose class="h-4 w-4" />
          </button>
        </div>

        <!-- Search Bar -->
        <div class="px-3 pb-3">
          <div class="relative">
            <input
              type="text"
              v-model="sidebarSearch"
              placeholder="搜索会话..."
              class="motion-field h-8 w-full rounded-md border border-[var(--border)] bg-[var(--app-bg)] pl-3 pr-3 text-sm text-[var(--text-muted)] placeholder-[var(--text-subtle)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
        </div>

        <!-- Session List -->
        <div class="flex-1 overflow-y-auto px-2 pb-2 space-y-1 custom-scrollbar">
          <TransitionGroup name="list-stagger" tag="div" class="space-y-1">
            <div
              v-for="session in filteredSessions"
              :key="session.id"
              role="button"
              tabindex="0"
              class="motion-list-item group relative flex w-full cursor-pointer flex-col rounded-lg px-3 py-2.5 text-left"
              :class="currentSessionId === session.id ? 'bg-[var(--surface-soft)]/70 shadow-sm ring-1 ring-white/70 dark:ring-white/10' : 'hover:bg-[var(--surface-soft)]/40'"
              @click="switchSession(session.id)"
              @keydown.enter="switchSession(session.id)"
            >
              <div class="flex w-full items-center justify-between">
                <span class="truncate pr-4 text-sm font-medium text-[var(--text)]" :class="currentSessionId === session.id ? 'text-[var(--text)]' : ''">{{ session.title }}</span>
                <button
                  class="motion-icon absolute right-2 rounded-md p-1 text-[var(--text-subtle)] opacity-0 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 group-hover:opacity-100"
                  @click.stop="deleteSession(session.id, $event)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
              <span class="mt-0.5 text-[11px] text-[var(--text-subtle)]">{{ formatSessionTime(session.updatedAt) }}</span>
            </div>
          </TransitionGroup>
        </div>
        
        <!-- Settings Footer (Optional but good for config) -->
        <div class="p-3 border-t border-[var(--border)]/80">
          <button 
            class="motion-list-item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]"
            @click="openSettings('general')"
          >
            <Settings class="h-4 w-4" />
            设置
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="relative flex-1 flex flex-col min-w-0 bg-[var(--app-bg)]">
      <!-- Header -->
      <header class="h-14 flex items-center justify-between px-4 border-b border-[var(--border)] flex-shrink-0 bg-[var(--app-bg)]/80 backdrop-blur-md z-10 sticky top-0">
        <div class="flex min-w-0 items-center gap-3">
          <button
            v-if="!isSidebarOpen"
            class="motion-icon flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]"
            @click="isSidebarOpen = true"
          >
            <PanelLeftOpen class="h-5 w-5" />
          </button>
          <Transition name="title-fade" mode="out-in">
            <div :key="headerTitleKey" class="header-title-wrap min-w-0">
              <h2 class="max-w-[200px] truncate text-sm font-semibold text-[var(--text)] sm:max-w-xs">
                {{ headerTitle }}
              </h2>
            </div>
          </Transition>
          <div ref="modelMenuRef" class="model-switcher-shell">
            <button
              type="button"
              class="model-switcher-trigger motion-field"
              :aria-expanded="isModelMenuOpen"
              aria-haspopup="listbox"
              @click="toggleModelMenu"
            >
              <span class="model-switcher-copy">
                <span class="model-switcher-label">{{ selectedModelLabel }}</span>
              </span>
              <ChevronDown class="model-switcher-chevron" :class="{ 'is-open': isModelMenuOpen }" />
            </button>
            <Transition name="dropdown-fade">
              <div
                v-if="isModelMenuOpen"
                class="model-switcher-menu custom-scrollbar"
                role="listbox"
                aria-label="模型列表"
              >
                <div class="model-switcher-search-shell">
                  <input
                    ref="modelSearchInputRef"
                    v-model.trim="modelMenuSearch"
                    type="text"
                    class="motion-field model-switcher-search"
                    placeholder="搜索模型或供应商"
                  />
                </div>
                <div
                  v-for="provider in filteredModelGroups"
                  :key="provider.id"
                  class="model-switcher-group"
                >
                  <div class="model-switcher-group-label">{{ provider.name }}</div>
                  <button
                    v-for="model in provider.matchedModels"
                    :key="`${provider.id}_${model}`"
                    type="button"
                    class="model-switcher-option"
                    :class="{ 'is-active': selectedProviderId === provider.id && selectedModel === model }"
                    @click="selectHeaderModel(provider.id, model)"
                  >
                    <span class="model-switcher-option-copy">
                      <span class="model-switcher-option-title">{{ model }}</span>
                      <span class="model-switcher-option-meta">{{ provider.baseURL || '未配置 Base URL' }}</span>
                    </span>
                    <Check
                      v-if="selectedProviderId === provider.id && selectedModel === model"
                      class="h-4 w-4 text-[var(--text)]"
                    />
                  </button>
                </div>
                <div v-if="!hasFilteredModelOptions" class="model-switcher-empty">
                  未找到匹配模型，请调整关键词或在设置中新增模型。
                </div>
              </div>
            </Transition>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="activeBashCount > 0 || activeBashShells.length > 0"
            type="button"
            class="motion-chip relative flex items-center gap-1 rounded-md border border-sky-200/60 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
            :title="`后台进程：${activeBashCount} 运行中 / 共 ${activeBashShells.length}`"
            @click="toggleBashShellsPanel"
          >
            <Activity class="h-3.5 w-3.5" />
            <span>{{ activeBashCount }}</span>
          </button>
          <button
            type="button"
            class="motion-chip relative flex items-center gap-1 rounded-md border border-[var(--border)]/60 bg-[var(--app-bg)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
            :class="{ 'bg-[var(--accent)] text-[var(--shell-bg)] hover:bg-[var(--accent)] hover:text-[var(--shell-bg)] border-[var(--accent)]': isTodoDrawerOpen }"
            :title="hasCurrentTodos ? `任务：${currentTodoStats.in_progress} 进行中 / ${currentTodoStats.pending} 待办 / ${currentTodoStats.completed} 已完成` : '任务清单（空）'"
            @click="toggleTodoDrawer"
          >
            <ListChecks class="h-3.5 w-3.5" />
            <span v-if="hasCurrentTodos">{{ currentTodoStats.completed }}/{{ currentTodoStats.total }}</span>
            <span v-else>任务</span>
          </button>
          <span class="motion-chip rounded-md border border-[var(--border)]/50 bg-[var(--surface-strong)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)]">{{ currentProvider.name }}</span>
          <button
            type="button"
            class="motion-icon flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]"
            title="打开设置"
            @click="openSettings('general')"
          >
            <Settings class="h-4 w-4" />
          </button>
        </div>
      </header>

      <!-- Background Bash popover -->
      <Transition name="dropdown-fade">
        <div
          v-if="isBashShellsOpen"
          class="absolute right-4 top-16 z-30 w-[360px] rounded-xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl"
        >
          <div class="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
            <span>后台 Bash（{{ activeBashShells.length }}）</span>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="motion-icon flex h-6 w-6 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-muted)]"
                title="刷新"
                @click="refreshActiveBashShells"
              >
                <RefreshCw class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="motion-icon flex h-6 w-6 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-muted)]"
                title="关闭"
                @click="isBashShellsOpen = false"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div class="max-h-80 overflow-auto px-3 py-2 text-xs custom-scrollbar">
            <p v-if="!activeBashShells.length" class="py-4 text-center text-[var(--text-subtle)]">当前没有后台进程</p>
            <div v-else class="flex flex-col gap-2">
              <div
                v-for="shell in activeBashShells"
                :key="shell.bashId"
                class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/60 p-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-[11px] text-[var(--text-subtle)] truncate">{{ shell.bashId }}</span>
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    :class="{
                      'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300': shell.status === 'running',
                      'bg-[var(--surface-strong)] text-[var(--text-muted)]': shell.status === 'completed' || shell.status === 'exited',
                      'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300': shell.status === 'killed' || shell.status === 'error',
                    }"
                  >{{ shell.status }}</span>
                </div>
                <p class="mt-1 break-all font-mono text-[11px] text-[var(--text-muted)]">{{ shell.command }}</p>
                <p v-if="shell.description" class="mt-0.5 text-[11px] text-[var(--text-subtle)]">{{ shell.description }}</p>
                <div class="mt-2 flex items-center justify-between text-[10px] text-[var(--text-subtle)]">
                  <span>pid {{ shell.pid ?? '-' }} · 启动 {{ new Date(shell.startedAt).toLocaleTimeString() }}</span>
                  <button
                    v-if="shell.status === 'running'"
                    type="button"
                    class="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                    @click="killBackgroundBashShell(shell.bashId)"
                  >
                    终止
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Todo drawer -->
      <Transition name="dropdown-fade">
        <aside
          v-if="isTodoDrawerOpen"
          class="absolute right-0 top-14 bottom-0 z-20 flex w-[320px] flex-col border-l border-[var(--border)] bg-[var(--app-bg)]/95 backdrop-blur-md shadow-[-8px_0_24px_-16px_rgba(0,0,0,0.12)]"
        >
          <div class="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div class="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
              <ListChecks class="h-4 w-4" />
              <span>任务清单</span>
              <span class="rounded-full bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">{{ currentTodoStats.total }}</span>
            </div>
            <button
              type="button"
              class="motion-icon flex h-7 w-7 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-muted)]"
              title="关闭"
              @click="isTodoDrawerOpen = false"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <div class="flex-1 overflow-auto px-4 py-3 custom-scrollbar">
            <p v-if="!hasCurrentTodos" class="mt-8 text-center text-xs text-[var(--text-subtle)]">
              还没有任务。模型可以用 TodoWriteTool 创建任务清单来推进多步工作。
            </p>
            <div v-else class="flex flex-col gap-2">
              <div
                v-for="(todo, todoIndex) in currentSessionTodos"
                :key="`${todoIndex}_${todo.content}`"
                class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/60 p-3"
                :class="{
                  'border-sky-200 bg-sky-50/80 dark:border-sky-400/30 dark:bg-sky-500/10': todo.status === 'in_progress',
                  'border-emerald-200 bg-emerald-50/60 dark:border-emerald-400/25 dark:bg-emerald-500/10': todo.status === 'completed',
                }"
              >
                <div class="flex items-start gap-2">
                  <CircleCheck v-if="todo.status === 'completed'" class="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <CircleDot v-else-if="todo.status === 'in_progress'" class="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600 dark:text-sky-300" />
                  <Circle v-else class="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-subtle)]" />
                  <div class="min-w-0 flex-1">
                    <p
                      class="text-sm text-[var(--text)]"
                      :class="{
                        'line-through text-[var(--text-subtle)]': todo.status === 'completed',
                        'font-semibold text-sky-900 dark:text-sky-200': todo.status === 'in_progress',
                      }"
                    >{{ todo.status === 'in_progress' ? todo.activeForm : todo.content }}</p>
                    <p class="mt-0.5 text-[11px] text-[var(--text-subtle)]">
                      <span v-if="todo.status === 'pending'">待办</span>
                      <span v-else-if="todo.status === 'in_progress'">进行中</span>
                      <span v-else>已完成</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </Transition>

      <!-- Chat Area -->
      <div ref="chatContainer" class="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6 custom-scrollbar scroll-smooth">
        <div class="max-w-3xl mx-auto flex min-w-0 flex-col h-full w-full">
          <Transition name="content-switch" mode="out-in">
            <div :key="hasMessages ? 'messages' : 'empty'" class="flex min-w-0 min-h-0 flex-1 flex-col">
              <!-- Empty State -->
              <div v-if="!hasMessages" class="empty-state flex flex-1 flex-col items-center justify-center text-[var(--text-subtle)]">
                <div class="empty-state-icon mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] shadow-sm">
                  <Bot class="h-6 w-6 text-[var(--text-subtle)]" />
                </div>
                <p class="text-[15px] font-medium text-[var(--text-subtle)]">有什么我可以帮您的？</p>
              </div>

              <!-- Message List -->
              <div v-else class="flex min-w-0 flex-col gap-8 pb-4">
                <TransitionGroup name="message-stack" tag="div" class="flex min-w-0 flex-col gap-8">
                  <article
                    v-for="message in messages"
                    :key="message.id"
                    class="message-row group flex min-w-0 gap-4"
                    :class="message.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
                  >
                    <!-- Avatar -->
                    <div
                      class="message-avatar-shell mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full shadow-sm"
                      :class="[
                        message.role === 'user' ? 'bg-[var(--surface-strong)] text-[var(--text-muted)] border border-[var(--border)]/50' : 
                        message.role === 'system'
                          ? 'bg-amber-50 text-amber-500 border border-amber-200/50 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30'
                          : message.role === 'tool'
                            ? 'bg-sky-50 text-sky-600 border border-sky-200/60 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-400/30'
                            : 'bg-[var(--accent)] text-[var(--shell-bg)]'
                      ]"
                    >
                      <User v-if="message.role === 'user'" class="h-4 w-4" />
                      <Terminal v-else-if="message.role === 'system'" class="h-4 w-4" />
                      <Wrench v-else-if="message.role === 'tool'" class="h-4 w-4" />
                      <Bot v-else class="h-4 w-4" />
                    </div>

                    <!-- Content -->
                    <div
                      class="flex min-w-0 max-w-[85%] flex-col gap-2 sm:max-w-[80%]"
                      :class="message.role === 'user' ? 'items-end' : 'w-full items-start'"
                    >
                      <div
                        v-if="message.role === 'system' || message.role === 'tool'"
                        class="message-meta-row"
                      >
                        <span
                          v-if="message.role === 'system' || message.role === 'tool'"
                          class="message-role-label"
                          :class="`message-role-label-${message.role}`"
                        >
                          {{ getMessageRoleLabel(message.role) }}
                        </span>
                      </div>
                      <div
                        class="message-bubble-shell text-[15px] leading-relaxed"
                        :class="[
                          message.role === 'user'
                            ? 'rounded-2xl rounded-tr-sm bg-[var(--surface-strong)] px-4 py-2.5 text-[var(--text)]'
                            : message.role === 'system'
                              ? 'rounded-2xl rounded-tl-sm border border-amber-100 bg-amber-50/30 px-4 py-2.5 font-mono text-xs text-[var(--text-muted)] dark:border-amber-400/25 dark:bg-amber-500/10'
                              : message.role === 'tool'
                                ? 'w-full py-1 text-[var(--text)]'
                              : 'w-full py-1 text-[var(--text)]'
                        ]"
                      >
                        <template v-if="message.role === 'assistant'">
                          <div v-if="message.blocks.length" class="assistant-block-flow">
                            <template v-for="block in message.blocks" :key="block.id">
                              <div
                                v-if="block.type === 'text' && hasRenderableContent(block.content)"
                                class="assistant-rich-message markdown-body prose prose-sm prose-zinc max-w-none"
                                v-html="renderMarkdown(block.content)"
                              ></div>

                              <section
                                v-else-if="block.type === 'tool'"
                                class="tool-embed-card"
                                :class="`tool-embed-card-${block.toolInvocation.status}`"
                              >
                                <button
                                  type="button"
                                  class="tool-embed-summary"
                                  @click="setToolExpandedByBlockId(message.id, block.id, !block.toolInvocation.expanded)"
                                >
                                  <div class="tool-embed-summary-main">
                                    <div class="tool-embed-icon">
                                      <Wrench class="h-3.5 w-3.5" />
                                    </div>
                                    <div class="tool-embed-title-wrap">
                                      <span class="tool-embed-name">{{ getToolDisplayName(block.toolInvocation.name) }}</span>
                                      <span v-if="getToolDisplayPurpose(block.toolInvocation.name)" class="tool-embed-purpose">
                                        · {{ getToolDisplayPurpose(block.toolInvocation.name) }}
                                      </span>
                                    </div>
                                  </div>

                                  <div class="tool-embed-summary-side">
                                    <span
                                      v-if="block.toolInvocation.diff"
                                      class="tool-embed-summary-diff-stats"
                                    >
                                      <span class="tool-embed-diff-add">+{{ block.toolInvocation.diff.addedLines }}</span>
                                      <span class="tool-embed-diff-del">−{{ block.toolInvocation.diff.removedLines }}</span>
                                    </span>
                                    <span class="tool-status-chip" :class="`tool-status-chip-${block.toolInvocation.status}`">
                                      <span
                                        v-if="block.toolInvocation.status === 'running' || block.toolInvocation.status === 'pending' || block.toolInvocation.status === 'draft'"
                                        class="tool-status-pulse"
                                        aria-hidden="true"
                                      ></span>
                                      {{ getToolStatusLabel(block.toolInvocation.status) }}
                                    </span>
                                    <ChevronDown class="tool-embed-chevron" :class="{ 'is-open': block.toolInvocation.expanded }" />
                                  </div>
                                </button>

                                <Transition name="tool-details">
                                  <div v-if="block.toolInvocation.expanded" class="tool-embed-body">
                                    <section v-if="block.toolInvocation.diff" class="tool-embed-panel tool-embed-diff-panel">
                                      <header class="tool-embed-panel-header">
                                        <span class="tool-embed-panel-label">变更</span>
                                        <span class="tool-embed-diff-stats">
                                          <span class="tool-embed-diff-add">+{{ block.toolInvocation.diff.addedLines }}</span>
                                          <span class="tool-embed-diff-del">−{{ block.toolInvocation.diff.removedLines }}</span>
                                          <span v-if="block.toolInvocation.diff.filePath" class="tool-embed-diff-path">{{ basenameFromPath(block.toolInvocation.diff.filePath) }}</span>
                                          <span v-if="block.toolInvocation.diff.tooLarge" class="tool-embed-diff-flag">规模过大已简化</span>
                                          <span v-else-if="block.toolInvocation.diff.diffTruncated" class="tool-embed-diff-flag">已截断</span>
                                        </span>
                                      </header>
                                      <pre v-if="block.toolInvocation.diff.diffText" class="tool-embed-code tool-embed-diff custom-scrollbar"><template v-for="(line, lineIndex) in splitDiffLines(block.toolInvocation.diff.diffText)" :key="lineIndex"><div :class="diffLineClass(line)">{{ line }}</div></template></pre>
                                    </section>
                                    <section class="tool-embed-panel">
                                      <header class="tool-embed-panel-header">
                                        <span class="tool-embed-panel-label">参数</span>
                                        <button
                                          type="button"
                                          class="tool-embed-panel-copy"
                                          :class="{ 'is-copied': isToolFieldCopied(block.id, 'arguments') }"
                                          :disabled="!block.toolInvocation.argumentsText"
                                          @click.stop="copyToolField(block.id, 'arguments', block.toolInvocation.argumentsText)"
                                        >
                                          <Check v-if="isToolFieldCopied(block.id, 'arguments')" class="h-3 w-3" />
                                          <Copy v-else class="h-3 w-3" />
                                          <span>{{ isToolFieldCopied(block.id, 'arguments') ? '已复制' : '复制' }}</span>
                                        </button>
                                      </header>
                                      <pre class="tool-embed-code custom-scrollbar"><code>{{ block.toolInvocation.argumentsText || getToolArgumentsPlaceholder(block.toolInvocation) }}</code></pre>
                                    </section>
                                    <section class="tool-embed-panel">
                                      <header class="tool-embed-panel-header">
                                        <span class="tool-embed-panel-label">结果</span>
                                        <button
                                          type="button"
                                          class="tool-embed-panel-copy"
                                          :class="{ 'is-copied': isToolFieldCopied(block.id, 'result') }"
                                          :disabled="!block.toolInvocation.resultText"
                                          @click.stop="copyToolField(block.id, 'result', block.toolInvocation.resultText)"
                                        >
                                          <Check v-if="isToolFieldCopied(block.id, 'result')" class="h-3 w-3" />
                                          <Copy v-else class="h-3 w-3" />
                                          <span>{{ isToolFieldCopied(block.id, 'result') ? '已复制' : '复制' }}</span>
                                        </button>
                                      </header>
                                      <pre class="tool-embed-code custom-scrollbar"><code>{{ block.toolInvocation.resultText || getToolResultPlaceholder(block.toolInvocation) }}</code></pre>
                                    </section>
                                  </div>
                                </Transition>
                              </section>
                            </template>
                          </div>

                          <div
                            v-if="shouldShowAssistantStreamPlaceholder(message)"
                            class="assistant-stream-placeholder"
                          >
                            <span class="loading-dot"></span>
                            <span class="loading-dot" style="animation-delay: 0.12s"></span>
                            <span class="loading-dot" style="animation-delay: 0.24s"></span>
                          </div>
                          <section
                            v-if="message.changeSummary && message.changeSummary.files.length"
                            class="change-summary-card"
                          >
                            <header class="change-summary-header">
                              <span class="change-summary-title">本轮变更</span>
                              <span class="change-summary-meta">
                                <span>共 {{ message.changeSummary.files.length }} 个文件</span>
                                <span class="change-summary-add">+{{ message.changeSummary.addedLines }}</span>
                                <span class="change-summary-del">−{{ message.changeSummary.removedLines }}</span>
                              </span>
                            </header>
                            <ul class="change-summary-list">
                              <li
                                v-for="file in message.changeSummary.files"
                                :key="file.path"
                                class="change-summary-item"
                              >
                                <span class="change-summary-kind">{{ file.kind || '修改' }}</span>
                                <span class="change-summary-path" :title="file.path">{{ basenameFromPath(file.path) }}</span>
                                <span class="change-summary-stats">
                                  <span v-if="file.added" class="change-summary-add">+{{ file.added }}</span>
                                  <span v-if="file.removed" class="change-summary-del">−{{ file.removed }}</span>
                                </span>
                              </li>
                            </ul>
                          </section>
                        </template>
                        <div
                          v-else-if="message.role === 'system'"
                          class="markdown-body prose prose-sm prose-zinc max-w-none"
                          v-html="renderMarkdown(message.content)"
                        ></div>
                        <div v-else class="user-message-content">
                          <div v-if="message.content" class="whitespace-pre-wrap">{{ message.content }}</div>
                          <div
                            v-if="message.attachments && message.attachments.length"
                            class="message-attachment-row"
                          >
                            <div
                              v-for="attachment in message.attachments"
                              :key="attachment.id"
                              class="message-attachment-chip"
                              :class="`message-attachment-chip-${attachment.kind}`"
                              :title="attachment.path || attachment.name"
                            >
                              <div class="message-attachment-chip-media">
                                <img
                                  v-if="attachment.kind === 'image' && getMessageAttachmentPreview(attachment)"
                                  :src="getMessageAttachmentPreview(attachment)"
                                  alt=""
                                  @error="() => {}"
                                />
                                <Folder v-else-if="attachment.kind === 'folder'" class="h-4 w-4" />
                                <FileIcon v-else class="h-4 w-4" />
                              </div>
                              <div class="message-attachment-chip-body">
                                <div class="message-attachment-chip-title">{{ attachment.name }}</div>
                                <div class="message-attachment-chip-meta">{{ getAttachmentLabel(attachment.kind) }}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        v-if="canCopyMessage(message) || canRollbackMessage(message)"
                        class="message-actions"
                        :class="message.role === 'user' ? 'message-actions-user' : ''"
                      >
                        <button
                          v-if="canRollbackMessage(message)"
                          type="button"
                          class="message-action-btn message-action-btn-rollback"
                          :disabled="isMessageRolling(message.id)"
                          :title="isMessageRolling(message.id) ? '正在撤回…' : getRollbackButtonTitle(message)"
                          @click="rollbackToMessage(message)"
                        >
                          <RotateCcw class="h-3.5 w-3.5" />
                          <span>{{ isMessageRolling(message.id) ? '处理中…' : getRollbackButtonLabel(message) }}</span>
                        </button>
                        <button
                          v-if="canCopyMessage(message)"
                          type="button"
                          class="message-action-btn"
                          :class="{ 'is-copied': copiedMessageId === message.id }"
                          :title="copiedMessageId === message.id ? '已复制' : '复制消息'"
                          @click="copyMessageText(message)"
                        >
                          <Check v-if="copiedMessageId === message.id" class="h-3.5 w-3.5" />
                          <Copy v-else class="h-3.5 w-3.5" />
                          <span>{{ copiedMessageId === message.id ? '已复制' : '复制' }}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                </TransitionGroup>

              </div>
            </div>
          </Transition>
        </div>
      </div>

      <!-- Composer -->
      <div class="px-4 pb-6 pt-2 bg-gradient-to-t from-[var(--app-bg)] via-[var(--app-bg)] to-transparent">
        <div
          class="composer-root max-w-3xl mx-auto relative"
          :class="{ 'is-dragging': isComposerDragActive }"
          @dragover="handleComposerDragOver"
          @dragleave="handleComposerDragLeave"
          @drop="handleComposerDrop"
        >
          <div v-if="composerAttachments.length" class="composer-attachments">
            <div
              v-for="attachment in composerAttachments"
              :key="attachment.id"
              class="composer-attachment-chip"
              :class="`composer-attachment-chip-${attachment.kind}`"
            >
              <div class="composer-attachment-chip-media">
                <img
                  v-if="attachment.kind === 'image' && attachment.previewDataUrl"
                  :src="attachment.previewDataUrl"
                  alt=""
                />
                <Folder v-else-if="attachment.kind === 'folder'" class="h-4 w-4" />
                <FileIcon v-else class="h-4 w-4" />
              </div>
              <div class="composer-attachment-chip-body">
                <div class="composer-attachment-chip-title" :title="attachment.path || attachment.name">
                  {{ attachment.name }}
                </div>
                <div class="composer-attachment-chip-meta">
                  {{ getAttachmentLabel(attachment.kind) }}
                  <span v-if="formatBytes(attachment.size)"> · {{ formatBytes(attachment.size) }}</span>
                </div>
              </div>
              <button
                type="button"
                class="composer-attachment-chip-remove"
                title="移除附件"
                @click="removeComposerAttachment(attachment.id)"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <form
            class="composer-form motion-surface relative flex items-center min-h-[52px] rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]/50 shadow-sm"
            @submit.prevent="sendMessage"
          >
            <textarea
              ref="textareaRef"
              v-model="input"
              rows="1"
              class="w-full max-h-[200px] py-3 pl-4 pr-36 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 resize-none text-[15px] leading-[1.5] placeholder-[var(--text-subtle)] custom-scrollbar rounded-2xl"
              :placeholder="isCompactInput ? '支持拖拽 / 粘贴文件、文件夹与图片' : '输入消息'"
              @keydown="handleComposerKeydown"
              @paste="handleComposerPaste"
              style="field-sizing: content;"
            ></textarea>

            <div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              <div
                ref="plusMenuRef"
                class="composer-plus-wrap"
                @mouseenter="isPlusMenuOpen = true"
                @mouseleave="isPlusMenuOpen = false"
              >
                <button
                  type="button"
                  class="motion-icon rounded-xl p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-muted)]"
                  title="点击添加文件 · 悬停展开文件夹选项"
                  @click="triggerFileInput"
                >
                  <Plus class="h-5 w-5" />
                </button>
                <Transition name="dropdown-fade">
                  <div v-if="isPlusMenuOpen" class="composer-plus-menu" role="menu">
                    <button
                      type="button"
                      class="composer-plus-menu-item"
                      @click="triggerFileInput"
                    >
                      <FileIcon class="h-4 w-4" />
                      <span>添加文件</span>
                    </button>
                    <button
                      type="button"
                      class="composer-plus-menu-item"
                      @click="triggerFolderInput"
                    >
                      <Folder class="h-4 w-4" />
                      <span>添加文件夹</span>
                    </button>
                  </div>
                </Transition>
              </div>
              <button
                type="button"
                class="motion-icon rounded-xl p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-muted)]"
                title="上传图片"
                @click="triggerImageInput"
              >
                <ImageIcon class="h-5 w-5" />
              </button>
              <button
                :type="isCurrentSessionLoading ? 'button' : 'submit'"
                class="motion-surface flex items-center justify-center rounded-xl p-2 shadow-sm"
                :class="isCurrentSessionLoading ? 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-500/90 dark:hover:bg-red-500' : (input.trim() || composerAttachments.length) ? 'bg-[var(--accent)] text-[var(--shell-bg)] hover:bg-[var(--accent-strong)]' : 'bg-[var(--surface-soft)] text-[var(--text-subtle)] cursor-not-allowed'"
                :disabled="!isCurrentSessionLoading && !input.trim() && !composerAttachments.length"
                :title="isCurrentSessionLoading ? '中断当前会话请求' : '发送消息'"
                @click="isCurrentSessionLoading ? stopCurrentSessionRequest() : undefined"
              >
                <X v-if="isCurrentSessionLoading" class="h-4 w-4" />
                <Send v-else class="h-4 w-4" />
              </button>
            </div>
          </form>
          <input
            ref="fileInputRef"
            type="file"
            multiple
            class="hidden"
            @change="handleFileInputChange"
          />
          <input
            ref="folderInputRef"
            type="file"
            webkitdirectory
            directory
            multiple
            class="hidden"
            @change="handleFolderInputChange"
          />
          <input
            ref="imageInputRef"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            @change="handleImageInputChange"
          />
          <input
            ref="skillFileInputRef"
            type="file"
            accept=".md,.zip"
            class="hidden"
            @change="handleSkillFileChange"
          />
          <div v-if="isComposerDragActive" class="composer-drop-overlay">
            <Paperclip class="h-5 w-5" />
            <span>松开即附加到消息</span>
          </div>
          <div v-if="!isCompactInput" class="text-center mt-2.5">
            <span class="text-[11px] text-[var(--text-subtle)]">支持拖拽 / 粘贴文件、文件夹与图片</span>
          </div>
        </div>
      </div>
    </main>

    <!-- Tool Confirmation Modal -->
    <Transition name="modal-fade">
      <div
        v-if="pendingConfirmation"
        class="confirm-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/28 p-4 backdrop-blur-md"
      >
        <div
          class="confirm-modal-panel"
          :class="`confirm-modal-panel-${pendingConfirmation.riskLevel}`"
        >
          <div class="confirm-modal-accent-strip"></div>
          <div class="confirm-modal-header">
            <div class="confirm-modal-icon" :class="`confirm-modal-icon-${pendingConfirmation.riskLevel}`">
              <AlertTriangle class="h-5 w-5" />
            </div>
            <div class="confirm-modal-title-wrap">
              <h3 class="confirm-modal-title">等待你确认</h3>
              <span class="confirm-modal-subtitle">
                AI 想调用一个可能修改系统的工具 · 当前：{{ getSafetyModeLabel(appSettings.safetyMode) }}
              </span>
            </div>
            <span
              class="confirm-modal-risk-chip"
              :class="`confirm-modal-risk-chip-${pendingConfirmation.riskLevel}`"
            >
              {{ getRiskLevelLabel(pendingConfirmation.riskLevel) }}
            </span>
          </div>

          <div class="confirm-modal-body">
            <div class="confirm-modal-meta">
              <div class="confirm-modal-meta-cell">
                <span class="confirm-modal-meta-label">工具</span>
                <span class="confirm-modal-meta-value">
                  <Wrench class="h-3.5 w-3.5" /> {{ pendingConfirmation.toolLabel }}
                </span>
              </div>
              <div class="confirm-modal-meta-cell" v-if="pendingConfirmation.toolPurpose">
                <span class="confirm-modal-meta-label">用途</span>
                <span class="confirm-modal-meta-value">{{ pendingConfirmation.toolPurpose }}</span>
              </div>
            </div>

            <div v-if="pendingConfirmation.riskReason" class="confirm-modal-reason">
              <span class="confirm-modal-reason-label">AI 说明</span>
              <p class="confirm-modal-reason-text">{{ pendingConfirmation.riskReason }}</p>
            </div>

            <div class="confirm-modal-params">
              <span class="confirm-modal-params-label">调用参数</span>
              <pre class="confirm-modal-params-pre custom-scrollbar"><code>{{ pendingConfirmation.argsPreview }}</code></pre>
            </div>
          </div>

          <div class="confirm-modal-footer">
            <button
              type="button"
              class="confirm-modal-btn confirm-modal-btn-deny"
              @click="resolvePendingConfirmation('deny')"
            >
              拒绝
            </button>
            <button
              v-if="pendingConfirmation.allowlistAction"
              type="button"
              class="confirm-modal-btn confirm-modal-btn-remember"
              @click="resolvePendingConfirmation('allow_and_remember')"
            >
              {{ pendingConfirmation.allowlistAction === 'add_to_white' ? '加入白名单并允许' : '从黑名单移除并允许' }}
            </button>
            <button
              v-else
              type="button"
              class="confirm-modal-btn confirm-modal-btn-always"
              @click="resolvePendingConfirmation('allow_always')"
            >
              本会话始终允许
            </button>
            <button
              type="button"
              class="confirm-modal-btn confirm-modal-btn-allow"
              :class="`confirm-modal-btn-allow-${pendingConfirmation.riskLevel}`"
              @click="resolvePendingConfirmation('allow_once')"
            >
              允许一次
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Settings Modal -->
    <Transition name="modal-fade">
      <div
        v-if="showSettings"
        class="settings-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/24 p-3 sm:p-4 backdrop-blur-md"
        @click.self="closeSettings()"
      >
        <div class="settings-modal-panel flex w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-2xl">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <h3 class="text-base font-semibold text-[var(--text)]">设置</h3>
          <button @click="closeSettings()" class="motion-icon rounded-lg p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-muted)]">
            <X class="h-5 w-5" />
          </button>
        </div>

        <!-- Body -->
        <div class="settings-modal-body flex flex-1 overflow-hidden">
          <!-- Settings Sidebar -->
          <div class="settings-tabs border-r border-[var(--border)] bg-[var(--surface-muted)]/30 p-3 flex flex-col gap-1">
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'general' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'general'"
            >
              <span class="inline-flex items-center gap-2">
                <Settings class="h-4 w-4" />
                通用设置
              </span>
            </button>
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'safety' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'safety'"
            >
              <span class="inline-flex items-center gap-2">
                <Shield class="h-4 w-4" />
                安全与工作区
              </span>
            </button>
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'tools' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'tools'"
            >
              <span class="inline-flex items-center gap-2">
                <Wrench class="h-4 w-4" />
                工具中心
              </span>
            </button>
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'skills' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'skills'; loadStandardSkillTemplates()"
            >
              <span class="inline-flex items-center gap-2">
                <Sparkles class="h-4 w-4" />
                Skills
              </span>
            </button>
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'mcp' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'mcp'; refreshMcpServers()"
            >
              <span class="inline-flex items-center gap-2">
                <Cpu class="h-4 w-4" />
                MCP
              </span>
            </button>
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'providers' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'providers'"
            >
              <span class="inline-flex items-center gap-2">
                <Server class="h-4 w-4" />
                模型供应商
              </span>
            </button>
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'memory' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'memory'; loadMemoryBlocksForSettings()"
            >
              <span class="inline-flex items-center gap-2">
                <Brain class="h-4 w-4" />
                记忆管理
              </span>
            </button>
            <button
              class="motion-list-item settings-tab rounded-lg px-3 py-2 text-sm font-medium"
              :class="activeSettingsTab === 'debug' ? 'bg-[var(--app-bg)] shadow-sm text-[var(--text)] border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
              @click="activeSettingsTab = 'debug'; loadDebugLogs()"
            >
              <span class="inline-flex items-center gap-2">
                <Bug class="h-4 w-4" />
                调试日志
              </span>
            </button>
          </div>

          <!-- Settings Content -->
          <div class="flex-1 flex flex-col bg-[var(--app-bg)] overflow-hidden">
            <Transition name="tab-panel" mode="out-in">
              <!-- General Tab -->
              <div v-if="activeSettingsTab === 'general'" key="general" class="settings-tab-panel p-4 md:p-6 flex-1 overflow-y-auto custom-scrollbar">
                <div class="space-y-4">
                  <div class="preference-card-surface preference-card-surface-compact">
                    <div class="preference-row preference-row-plain">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">工具轮次上限</span>
                        <span class="preference-row-hint">默认不限制，开启后按下方数值停止自动链路。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.enableToolRoundLimit }"
                        @click="appSettingsDraft.enableToolRoundLimit = !appSettingsDraft.enableToolRoundLimit"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="preference-row preference-row-plain">
                      <span class="preference-row-title text-xs font-medium text-[var(--text-muted)]">最大轮次</span>
                      <div class="flex items-center gap-3">
                        <input
                          v-model.number="appSettingsDraft.maxToolCallRounds"
                          type="number"
                          min="1"
                          :max="MAX_TOOL_CALL_ROUNDS_SAFETY_CAP"
                          class="motion-field preference-number-input"
                          :disabled="!appSettingsDraft.enableToolRoundLimit"
                        />
                        <span class="settings-status-chip settings-status-chip-muted">
                          {{ appSettingsDraft.enableToolRoundLimit ? `最多 ${appSettingsDraft.maxToolCallRounds} 轮` : '已关闭限制' }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="preference-stack">
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">流式输出</span>
                        <span class="preference-row-hint">逐字显示模型回复。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.enableStreamResponse }"
                        @click="appSettingsDraft.enableStreamResponse = !appSettingsDraft.enableStreamResponse"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">流式自动滚动</span>
                        <span class="preference-row-hint">流式渲染与工具执行时保持视图贴底。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.autoScrollWhileStreaming }"
                        @click="appSettingsDraft.autoScrollWhileStreaming = !appSettingsDraft.autoScrollWhileStreaming"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">工具失败即停止</span>
                        <span class="preference-row-hint">任一工具失败就中止后续工具轮次。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.stopWhenToolError }"
                        @click="appSettingsDraft.stopWhenToolError = !appSettingsDraft.stopWhenToolError"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">任务完成通知</span>
                        <span class="preference-row-hint">AI 任务完成时显示 Windows 原生通知。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.enableBashNotification }"
                        @click="appSettingsDraft.enableBashNotification = !appSettingsDraft.enableBashNotification; syncBashNotificationSetting()"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">工具结果默认展开</span>
                        <span class="preference-row-hint">新工具卡自动展开参数与结果。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.autoExpandToolDetails }"
                        @click="appSettingsDraft.autoExpandToolDetails = !appSettingsDraft.autoExpandToolDetails"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">自动刷新调试日志</span>
                        <span class="preference-row-hint">每次工具执行完后自动刷新调试面板。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.autoRefreshDebugLogs }"
                        @click="appSettingsDraft.autoRefreshDebugLogs = !appSettingsDraft.autoRefreshDebugLogs"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="preference-row preference-row-wrap">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">发送快捷键</span>
                        <span class="preference-row-hint">切换 Enter / Ctrl+Enter 发送。</span>
                      </div>
                      <div class="preference-segment preference-segment-inline">
                        <button
                          type="button"
                          class="preference-segment-option"
                          :class="{ 'is-active': appSettingsDraft.composerSendMode === 'enter' }"
                          @click="appSettingsDraft.composerSendMode = 'enter'"
                        >
                          Enter
                        </button>
                        <button
                          type="button"
                          class="preference-segment-option"
                          :class="{ 'is-active': appSettingsDraft.composerSendMode === 'ctrlEnter' }"
                          @click="appSettingsDraft.composerSendMode = 'ctrlEnter'"
                        >
                          Ctrl+Enter
                        </button>
                      </div>
                    </div>
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">深色模式</span>
                        <span class="preference-row-hint">跟随系统 / 强制亮色 / 强制深色</span>
                      </div>
                      <div class="preference-segment preference-segment-inline">
                        <button
                          type="button"
                          class="preference-segment-option"
                          :class="{ 'is-active': appSettingsDraft.darkMode === 'auto' }"
                          @click="appSettingsDraft.darkMode = 'auto'"
                        >
                          自动
                        </button>
                        <button
                          type="button"
                          class="preference-segment-option"
                          :class="{ 'is-active': appSettingsDraft.darkMode === 'light' }"
                          @click="appSettingsDraft.darkMode = 'light'"
                        >
                          亮色
                        </button>
                        <button
                          type="button"
                          class="preference-segment-option"
                          :class="{ 'is-active': appSettingsDraft.darkMode === 'dark' }"
                          @click="appSettingsDraft.darkMode = 'dark'"
                        >
                          深色
                        </button>
                      </div>
                    </div>
                    <div class="preference-row">
                      <div class="preference-row-copy">
                        <span class="preference-row-title">从主输入框启动时自动发送</span>
                        <span class="preference-row-hint">开启后，ZTools 主搜索框传入的文本会直接作为第一条消息发送，而不是先填入对话框。</span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.launchAutoSend }"
                        @click="appSettingsDraft.launchAutoSend = !appSettingsDraft.launchAutoSend"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                  </div>

                  <div class="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]/70 p-4">
                    <h4 class="text-sm font-semibold text-[var(--text)]">系统提示词</h4>
                    <p class="mt-1.5 text-xs leading-6 text-[var(--text-subtle)]">
                      定义 Agent 的角色与边界。保存后仅影响后续新对话。
                    </p>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        v-for="preset in systemPromptPresets"
                        :key="preset.id"
                        type="button"
                        class="motion-surface rounded-full border border-[var(--border)] bg-[var(--app-bg)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                        @click="applySystemPromptPreset(preset.prompt)"
                      >
                        {{ preset.label }}
                      </button>
                    </div>
                  </div>

                  <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                    <div class="flex items-center justify-between gap-3">
                      <label class="block text-sm font-medium text-[var(--text-muted)]">提示词内容</label>
                      <span class="text-xs text-[var(--text-subtle)]">{{ systemPromptDraftLength }} 字</span>
                    </div>
                    <textarea
                      v-model="systemPromptDraft"
                      rows="8"
                      class="motion-field custom-scrollbar mt-3 w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-6 text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                      placeholder="输入系统提示词，用于定义新对话的默认角色、风格与约束。"
                    ></textarea>
                    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        class="motion-surface rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        @click="resetSystemPromptDraft"
                      >
                        恢复默认
                      </button>
                      <span
                        class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                        :class="hasSystemPromptDraftChanges ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'"
                      >
                        {{ hasSystemPromptDraftChanges ? '有未保存修改' : '已同步' }}
                      </span>
                    </div>
                  </div>

                  <div
                    v-if="activeSessionPromptSnapshot"
                    class="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-400/25 dark:bg-sky-500/10"
                  >
                    <div class="mb-2 text-sm font-medium text-sky-900 dark:text-sky-200">当前会话锁定提示词</div>
                    <pre class="tool-embed-code max-h-[160px] rounded-xl border border-sky-100 bg-[var(--app-bg)]/80 dark:border-sky-400/20"><code>{{ activeSessionPromptSnapshot }}</code></pre>
                  </div>
                </div>
              </div>

              <!-- Safety Tab -->
              <div v-else-if="activeSettingsTab === 'safety'" key="safety" class="settings-tab-panel p-4 md:p-6 flex-1 overflow-y-auto custom-scrollbar">
                <div class="space-y-4">
                  <div class="safety-hero-card">
                    <div class="safety-hero-icon">
                      <Shield class="h-5 w-5" />
                    </div>
                    <div class="safety-hero-copy">
                      <h4 class="text-sm font-semibold text-[var(--text)]">安全执行策略</h4>
                      <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                        控制 AI 在调用 Bash 与文件写入工具时是否需要你确认。调用方必须自评风险等级（low / medium / high），当风险达到当前模式阈值时会弹出审阅弹窗。
                      </p>
                    </div>
                    <span
                      class="settings-status-chip"
                      :class="appSettingsDraft.safetyMode === 'loose' ? 'settings-status-chip-pending' : 'settings-status-chip-ready'"
                    >
                      当前：{{ getSafetyModeLabel(appSettingsDraft.safetyMode) }}
                    </span>
                  </div>

                  <div class="safety-mode-grid">
                    <button
                      type="button"
                      class="safety-mode-card"
                      :class="{ 'is-active': appSettingsDraft.safetyMode === 'strict' }"
                      @click="appSettingsDraft.safetyMode = 'strict'"
                    >
                      <div class="safety-mode-card-head">
                        <span class="safety-mode-card-title">严格模式</span>
                        <span class="safety-mode-card-tag safety-mode-card-tag-strict">最安全</span>
                      </div>
                      <p class="safety-mode-card-desc">
                        每一次 Bash 和文件写入都会弹出审阅。适合第一次使用或关键生产环境。
                      </p>
                    </button>

                    <button
                      type="button"
                      class="safety-mode-card"
                      :class="{ 'is-active': appSettingsDraft.safetyMode === 'moderate' }"
                      @click="appSettingsDraft.safetyMode = 'moderate'"
                    >
                      <div class="safety-mode-card-head">
                        <span class="safety-mode-card-title">宽松模式</span>
                        <span class="safety-mode-card-tag safety-mode-card-tag-moderate">推荐</span>
                      </div>
                      <p class="safety-mode-card-desc">
                        默认拦截 AI 自评为中、高风险的操作；低风险放行。可在下方切换为仅高风险才拦截。
                      </p>
                    </button>

                    <button
                      type="button"
                      class="safety-mode-card"
                      :class="{ 'is-active': appSettingsDraft.safetyMode === 'loose' }"
                      @click="appSettingsDraft.safetyMode = 'loose'"
                    >
                      <div class="safety-mode-card-head">
                        <span class="safety-mode-card-title">无视风险</span>
                        <span class="safety-mode-card-tag safety-mode-card-tag-loose">不推荐</span>
                      </div>
                      <p class="safety-mode-card-desc">
                        AI 所有操作都无需确认，完全自动执行。仅在你对 AI 的行为有充分信任时开启。
                      </p>
                    </button>

                    <button
                      type="button"
                      class="safety-mode-card"
                      :class="{ 'is-active': appSettingsDraft.safetyMode === 'allowlist' }"
                      @click="appSettingsDraft.safetyMode = 'allowlist'"
                    >
                      <div class="safety-mode-card-head">
                        <span class="safety-mode-card-title">黑白名单</span>
                        <span class="safety-mode-card-tag safety-mode-card-tag-allowlist">精细</span>
                      </div>
                      <p class="safety-mode-card-desc">
                        由名单决定是否需要确认。白名单里的直接放行，其他弹确认；黑名单相反。
                      </p>
                    </button>
                  </div>

                  <Transition name="dropdown-fade">
                    <div v-if="appSettingsDraft.safetyMode === 'moderate'" class="safety-moderate-fine">
                      <div class="safety-moderate-fine-copy">
                        <span class="safety-moderate-fine-title">仅高风险时拦截</span>
                        <span class="safety-moderate-fine-hint">
                          {{ appSettingsDraft.moderateOnlyHigh
                            ? '当前：中风险操作会直接放行，只有 AI 自评为高风险时才弹确认。'
                            : '当前：中风险与高风险都会弹确认，低风险放行。' }}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.moderateOnlyHigh }"
                        @click="appSettingsDraft.moderateOnlyHigh = !appSettingsDraft.moderateOnlyHigh"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                  </Transition>

                  <Transition name="dropdown-fade">
                    <div v-if="appSettingsDraft.safetyMode === 'allowlist'" class="allowlist-config">
                      <section class="allowlist-section">
                        <header class="allowlist-section-head">
                          <div>
                            <h5 class="allowlist-section-title">工具名单</h5>
                            <span class="allowlist-section-hint">
                              {{ appSettingsDraft.toolListKind === 'white'
                                ? '白名单：被选中的工具直接放行，其他工具调用时弹出确认。'
                                : '黑名单：被选中的工具调用时弹出确认，其他工具直接放行。' }}
                            </span>
                          </div>
                          <div class="preference-segment preference-segment-inline">
                            <button
                              type="button"
                              class="preference-segment-option"
                              :class="{ 'is-active': appSettingsDraft.toolListKind === 'white' }"
                              @click="appSettingsDraft.toolListKind = 'white'"
                            >
                              白名单
                            </button>
                            <button
                              type="button"
                              class="preference-segment-option"
                              :class="{ 'is-active': appSettingsDraft.toolListKind === 'black' }"
                              @click="appSettingsDraft.toolListKind = 'black'"
                            >
                              黑名单
                            </button>
                          </div>
                        </header>
                        <div class="allowlist-tool-chips">
                          <button
                            v-for="tool in toolCatalog"
                            :key="tool.name"
                            type="button"
                            class="allowlist-tool-chip"
                            :class="{ 'is-active': appSettingsDraft.toolListNames.includes(tool.name) }"
                            @click="toggleAllowlistToolDraft(tool.name)"
                          >
                            <Wrench class="h-3.5 w-3.5" />
                            <span>{{ tool.label }}</span>
                          </button>
                        </div>
                      </section>

                      <section class="allowlist-section">
                        <header class="allowlist-section-head">
                          <div>
                            <h5 class="allowlist-section-title">Bash 命令名单</h5>
                            <span class="allowlist-section-hint">
                              {{ appSettingsDraft.commandListKind === 'white'
                                ? '白名单：匹配列表的命令直接放行，其他命令弹出确认；在确认弹窗里可以一键加入白名单。'
                                : '黑名单：匹配列表的命令弹出确认，其他命令直接放行；在确认弹窗里可以一键从黑名单移除。' }}
                            </span>
                          </div>
                          <div class="preference-segment preference-segment-inline">
                            <button
                              type="button"
                              class="preference-segment-option"
                              :class="{ 'is-active': appSettingsDraft.commandListKind === 'white' }"
                              @click="appSettingsDraft.commandListKind = 'white'"
                            >
                              白名单
                            </button>
                            <button
                              type="button"
                              class="preference-segment-option"
                              :class="{ 'is-active': appSettingsDraft.commandListKind === 'black' }"
                              @click="appSettingsDraft.commandListKind = 'black'"
                            >
                              黑名单
                            </button>
                          </div>
                        </header>
                        <textarea
                          :value="appSettingsDraft.commandListPatterns.join('\n')"
                          @input="handleCommandListInput(($event.target as HTMLTextAreaElement).value)"
                          rows="6"
                          class="motion-field custom-scrollbar allowlist-command-textarea"
                          placeholder="每行一条，例如：&#10;git&#10;npm *&#10;rm -rf /"
                        ></textarea>
                        <div class="allowlist-command-hint">
                          <span>匹配规则：</span>
                          <span>无 <code>*</code> 时按"命令前缀"匹配（如 <code>git</code> 命中所有 git 子命令）；含 <code>*</code> 时按 glob 整行匹配（如 <code>npm install *</code>）。</span>
                        </div>
                      </section>
                    </div>
                  </Transition>

                  <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                    <div class="flex items-center gap-2">
                      <FolderOpen class="h-4 w-4 text-[var(--text-subtle)]" />
                      <h4 class="text-sm font-semibold text-[var(--text)]">工作目录</h4>
                      <span
                        v-if="!appSettingsDraft.workspaceRoot"
                        class="settings-status-chip settings-status-chip-pending"
                      >未设置</span>
                    </div>
                    <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                      AI 执行相对路径命令与文件操作时的根目录。建议设为项目目录，避免 AI 在系统默认路径（可能是系统盘根或 Program Files）下误操作。
                    </p>
                    <div class="mt-3 flex flex-wrap items-stretch gap-2">
                      <input
                        v-model.trim="appSettingsDraft.workspaceRoot"
                        type="text"
                        class="motion-field h-10 flex-1 min-w-[240px] rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-mono text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                        placeholder="例如 D:\\编程\\my-project"
                      />
                      <button
                        type="button"
                        class="motion-surface rounded-xl border border-[var(--border)] px-3 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        @click="clearWorkspaceRootDraft"
                      >
                        清空
                      </button>
                    </div>
                    <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-subtle)]">
                      <span class="settings-status-chip settings-status-chip-muted">
                        当前生效：{{ currentWorkspaceCwd || '（未知）' }}
                      </span>
                      <span
                        v-if="hasWorkspaceDraftChanged"
                        class="settings-status-chip settings-status-chip-pending"
                      >保存后生效</span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="activeSettingsTab === 'tools'" key="tools" class="settings-tab-panel p-4 md:p-6 flex-1 overflow-y-auto custom-scrollbar">
                <div class="space-y-4">
                  <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 class="text-sm font-semibold text-[var(--text)]">本地工具总开关</h4>
                        <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                          {{ toolSettingsSummary }} · 已关闭 {{ draftDisabledToolCount }} 个。
                        </p>
                      </div>
                      <button
                        type="button"
                        class="preference-toggle"
                        :class="{ 'is-active': appSettingsDraft.enableLocalTools }"
                        @click="appSettingsDraft.enableLocalTools = !appSettingsDraft.enableLocalTools"
                      >
                        <span class="preference-toggle-thumb"></span>
                      </button>
                    </div>
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                      <span class="settings-status-chip settings-status-chip-muted">
                        {{ appSettingsDraft.enableLocalTools ? `草稿启用 ${draftEnabledToolCount} 个工具` : '草稿：全部隐藏' }}
                      </span>
                      <button
                        type="button"
                        class="motion-surface rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        @click="setAllToolDraftEnabled(true)"
                      >全部启用</button>
                      <button
                        type="button"
                        class="motion-surface rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        @click="setAllToolDraftEnabled(false)"
                      >全部关闭</button>
                      <button
                        type="button"
                        class="motion-surface rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        @click="resetToolDraftSelection"
                      >恢复默认</button>
                    </div>
                  </div>

                  <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 class="text-sm font-semibold text-[var(--text)]">Tavily 搜索密钥</h4>
                        <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">WebSearchTool 必需。</p>
                      </div>
                      <span
                        class="settings-status-chip"
                        :class="hasTavilyKeyConfigured ? 'settings-status-chip-ready' : 'settings-status-chip-pending'"
                      >
                        {{ hasTavilyKeyConfigured ? '已配置' : '未配置' }}
                      </span>
                    </div>
                    <input
                      v-model.trim="appSettingsDraft.tavilyApiKey"
                      type="password"
                      class="motion-field mt-3 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-mono text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                      placeholder="tvly-..."
                    />
                  </div>

                  <section
                    v-for="group in toolCatalogGroups"
                    :key="group.id"
                    class="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]/60 p-4"
                  >
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 class="text-sm font-semibold text-[var(--text)]">{{ group.label }}</h4>
                        <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">{{ group.description }}</p>
                      </div>
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="settings-status-chip settings-status-chip-muted">
                          {{ group.enabledCount }}/{{ group.tools.length }}
                        </span>
                        <button
                          type="button"
                          class="motion-surface rounded-lg border border-[var(--border)] bg-[var(--app-bg)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                          @click="toggleToolCategoryDraft(group.id)"
                        >
                          {{ group.enabledCount === group.tools.length ? '关闭本组' : '启用本组' }}
                        </button>
                      </div>
                    </div>

                    <div class="preference-stack mt-3">
                      <div
                        v-for="tool in group.tools"
                        :key="tool.name"
                        class="preference-row preference-row-wrap"
                      >
                        <div class="preference-row-copy">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="preference-row-title">{{ tool.label }}</span>
                            <span class="settings-status-chip settings-status-chip-muted">{{ tool.capabilityLabel }}</span>
                            <span
                              class="settings-status-chip"
                              :class="tool.riskLabel === '高风险' ? 'settings-status-chip-pending' : 'settings-status-chip-ready'"
                            >{{ tool.riskLabel }}</span>
                          </div>
                          <span class="preference-row-hint">{{ tool.summary }}</span>
                        </div>
                        <button
                          type="button"
                          class="preference-toggle"
                          :class="{ 'is-active': isToolEnabled(tool.name, appSettingsDraft) }"
                          @click="toggleToolDraft(tool.name)"
                        >
                          <span class="preference-toggle-thumb"></span>
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <!-- Providers Tab -->
              <div v-else-if="activeSettingsTab === 'providers'" key="providers" class="flex flex-1 overflow-hidden">
                <!-- Providers List -->
                <div class="flex w-[220px] flex-col border-r border-[var(--border)] bg-[var(--surface-muted)]/50">
                  <div class="flex items-center justify-between border-b border-[var(--border)] p-3">
                    <span class="text-xs font-semibold uppercase tracking-wider text-[var(--text-subtle)]">供应商列表</span>
                    <div class="flex items-center gap-1">
                      <button @click="exportProviders" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" title="导出供应商配置">
                        <Download class="h-4 w-4" />
                      </button>
                      <button @click="importProviders" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" title="导入供应商配置">
                        <Upload class="h-4 w-4" />
                      </button>
                      <button @click="addNewProvider" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" title="添加供应商">
                        <Plus class="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div class="custom-scrollbar flex-1 overflow-y-auto p-2 space-y-1">
                    <TransitionGroup name="list-stagger" tag="div" class="space-y-1">
                      <div
                        v-for="p in providers"
                        :key="p.id"
                        role="button"
                        tabindex="0"
                        class="motion-list-item group flex w-full cursor-pointer items-center justify-between rounded-lg border border-transparent px-3 py-2.5 text-left text-sm"
                        :class="selectedProviderId === p.id ? 'border-[var(--border)] bg-[var(--app-bg)] font-medium text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)]'"
                        @click="selectProvider(p.id)"
                        @keydown.enter="selectProvider(p.id)"
                      >
                        <span class="truncate pr-2">{{ p.name }}</span>
                        <button
                          class="motion-icon rounded-md p-1 text-[var(--text-subtle)] opacity-0 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 group-hover:opacity-100"
                          @click.stop="removeProvider(p.id)"
                        >
                          <Trash2 class="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TransitionGroup>
                  </div>
                </div>

                <!-- Provider Editor -->
                <div class="custom-scrollbar flex-1 overflow-y-auto p-6">
                  <div v-if="currentProvider" class="max-w-md space-y-5">
                    <div>
                      <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">供应商类型</label>
                      <select v-model="currentProvider.type" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]">
                        <option value="openai">OpenAI 兼容</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">供应商名称</label>
                      <input v-model="currentProvider.name" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" />
                    </div>
                    
                    <div>
                      <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">API Base URL</label>
                      <input v-model="currentProvider.baseURL" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-mono text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="OpenAI 兼容格式填写，Anthropic 可留空" />
                    </div>
                    
                    <div>
                      <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">API Key</label>
                      <div class="relative flex items-center">
                        <input v-model="currentProvider.apiKey" :type="currentProvider.showApiKey ? 'text' : 'password'" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 pr-10 text-sm font-mono text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" />
                        <button
                          type="button"
                          class="motion-icon absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text-muted)]"
                          @click="currentProvider.showApiKey = !currentProvider.showApiKey"
                          :title="currentProvider.showApiKey ? '隐藏密钥' : '显示密钥'"
                        >
                          <Eye v-if="!currentProvider.showApiKey" class="h-4 w-4" />
                          <EyeOff v-else class="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">模型列表</label>
                      <div class="flex gap-2">
                        <select v-model="selectedModel" class="motion-field h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]">
                          <option v-for="m in currentProvider.models" :key="m" :value="m">{{ m }}</option>
                        </select>
                        <button @click="fetchModels" :disabled="isFetchingModels" class="motion-surface flex h-9 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-[var(--text-muted)] shadow-sm hover:bg-[var(--surface-muted)] hover:text-[var(--text)]" title="同步模型">
                          <RefreshCw class="h-4 w-4" :class="{ 'spin-gentle': isFetchingModels }" />
                        </button>
                      </div>
                      <div v-if="currentProvider.models.length > 0" class="mt-2 flex flex-wrap gap-1.5">
                        <span
                          v-for="model in currentProvider.models"
                          :key="model"
                          class="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text)]"
                          :class="{ 'ring-1 ring-[var(--accent)]': model === selectedModel }"
                        >
                          <span class="max-w-[120px] truncate">{{ model }}</span>
                          <button
                            v-if="currentProvider.models.length > 1"
                            class="ml-0.5 rounded-sm p-0.5 text-[var(--text-subtle)] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                            title="删除模型"
                            @click="removeModel(model)"
                          >
                            <X class="h-3 w-3" />
                          </button>
                        </span>
                      </div>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">手动添加模型</label>
                      <div class="flex gap-2">
                        <input
                          v-model="manualModelInput"
                          type="text"
                          class="motion-field h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                          placeholder="输入模型名称"
                          @keydown.enter.prevent="addManualModel"
                        />
                        <button type="button" class="motion-surface h-9 rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--text-muted)] shadow-sm hover:bg-[var(--surface-muted)] hover:text-[var(--text)]" @click="addManualModel">
                          添加
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Memory Tab -->
              <div v-else-if="activeSettingsTab === 'memory'" key="memory" class="flex flex-1 overflow-hidden">
                <div class="custom-scrollbar flex-1 overflow-y-auto p-6">
                  <div class="max-w-3xl space-y-5">
                    <!-- Header -->
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 class="text-sm font-semibold text-[var(--text)]">记忆块管理</h4>
                        <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                          记忆用于存储跨会话的持久化信息。AI 可以自主创建和管理记忆。
                        </p>
                      </div>
                      <button
                        type="button"
                        class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 text-xs text-[var(--shell-bg)] hover:bg-[var(--accent-strong)]"
                        @click="openMemoryCreateDialog"
                      >
                        <Plus class="h-3.5 w-3.5" />
                        新建记忆
                      </button>
                    </div>

                    <!-- Memory Blocks List -->
                    <div class="space-y-3">
                      <div
                        v-for="block in memoryBlocksForSettings"
                        :key="block.label"
                        class="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/60 p-4"
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="text-sm font-medium text-[var(--text)]">{{ block.label }}</span>
                              <span v-if="block.read_only" class="settings-status-chip settings-status-chip-muted">只读</span>
                              <span class="text-xs text-[var(--text-subtle)]">{{ block.chars_current }}/{{ block.chars_limit }} 字符</span>
                            </div>
                            <p class="mt-1 text-xs text-[var(--text-subtle)]">{{ block.description }}</p>
                          </div>
                          <div class="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              class="motion-icon rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                              title="编辑"
                              @click="openMemoryEditDialog(block)"
                            >
                              <Pencil class="h-4 w-4" />
                            </button>
                            <button
                              v-if="!block.read_only"
                              type="button"
                              class="motion-icon rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                              title="删除"
                              @click="deleteMemoryBlockFromSettings(block.label)"
                            >
                              <Trash2 class="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div v-if="block.value" class="mt-3 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3">
                          <pre class="text-xs text-[var(--text-muted)] whitespace-pre-wrap break-all max-h-32 overflow-y-auto custom-scrollbar">{{ block.value }}</pre>
                        </div>
                      </div>

                      <div v-if="!memoryBlocksForSettings.length" class="rounded-xl border border-dashed border-[var(--border)] py-12 text-center">
                        <Brain class="mx-auto h-8 w-8 text-[var(--text-subtle)] opacity-50" />
                        <p class="mt-2 text-sm text-[var(--text-subtle)]">暂无记忆块</p>
                        <p class="mt-1 text-xs text-[var(--text-subtle)]">点击「新建记忆」创建第一个记忆块</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Skills Tab -->
              <div v-else-if="activeSettingsTab === 'skills'" key="skills" class="flex flex-1 overflow-hidden">
                <div class="custom-scrollbar flex-1 overflow-y-auto p-6">
                  <div class="max-w-2xl space-y-5">
                    <!-- 已安装 Skills -->
                    <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 class="text-sm font-semibold text-[var(--text)]">已安装 Skills</h4>
                          <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                            发现 {{ discoveredSkills.length }} 个 Skill，已注入系统提示词。
                          </p>
                        </div>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                            @click="refreshDiscoveredSkills"
                          >
                            <RefreshCw class="h-3.5 w-3.5" />
                            刷新
                          </button>
                          <button
                            type="button"
                            class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 text-xs text-[var(--shell-bg)] hover:bg-[var(--accent-strong)]"
                            @click="openSkillCreateDialog"
                          >
                            <Plus class="h-3.5 w-3.5" />
                            新建 Skill
                          </button>
                        </div>
                      </div>

                      <div class="mt-4 space-y-2">
                        <div
                          v-for="skill in discoveredSkills"
                          :key="skill.entry"
                          class="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/60 p-3"
                        >
                          <div class="flex flex-wrap items-start justify-between gap-2">
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-2">
                                <span class="text-sm font-medium text-[var(--text)]">{{ skill.name }}</span>
                                <span class="settings-status-chip settings-status-chip-muted">{{ skill.path.includes(userHomedir) ? '用户级' : '项目级' }}</span>
                              </div>
                              <p class="mt-0.5 text-xs text-[var(--text-subtle)]">{{ skill.description }}</p>
                              <p class="mt-1 text-[11px] font-mono text-[var(--text-subtle)] opacity-70">{{ skill.entry }}</p>
                            </div>
                            <div class="flex items-center gap-1">
                              <button
                                type="button"
                                class="motion-icon rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                                title="查看内容"
                                @click="viewSkill(skill.entry, skill.name)"
                              >
                                <Eye class="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                class="motion-icon rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                title="删除"
                                @click="removeSkill(skill.entry)"
                              >
                                <Trash2 class="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                        <div v-if="!discoveredSkills.length" class="py-8 text-center text-sm text-[var(--text-subtle)]">
                          尚未发现任何 Skill。你可以新建 Skill 或从标准库导入。
                        </div>
                      </div>
                    </div>

                    <!-- 导入本地 Skill -->
                    <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <h4 class="text-sm font-semibold text-[var(--text)]">导入本地 Skill</h4>
                          <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                            从本地文件导入 Skill，支持 .md 文件或包含 SKILL.md 的 .zip 压缩包。
                          </p>
                        </div>
                        <button
                          type="button"
                          class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 text-xs text-[var(--shell-bg)] hover:bg-[var(--accent-strong)]"
                          :disabled="isImportingSkill"
                          @click="triggerSkillFileImport"
                        >
                          <Upload class="h-3.5 w-3.5" />
                          选择文件
                        </button>
                      </div>
                    </div>

                    <!-- 导入标准 Skill -->
                    <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <h4 class="text-sm font-semibold text-[var(--text)]">导入标准 Skill</h4>
                          <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                            一键导入常用标准 Skill，安装到用户目录。
                          </p>
                        </div>
                      </div>
                      <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div
                          v-for="template in standardSkillTemplates"
                          :key="template.name"
                          class="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/60 p-3"
                        >
                          <div class="min-w-0">
                            <div class="text-sm font-medium text-[var(--text)]">{{ template.name }}</div>
                            <div class="text-xs text-[var(--text-subtle)] truncate">{{ template.description }}</div>
                          </div>
                          <button
                            type="button"
                            class="motion-surface shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                            :disabled="isImportingSkill"
                            @click="importStandardSkillTemplate(template.name)"
                          >
                            导入
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- MCP Tab -->
              <div v-else-if="activeSettingsTab === 'mcp'" key="mcp" class="flex flex-1 overflow-hidden">
                <div class="custom-scrollbar flex-1 overflow-y-auto p-6">
                  <div class="max-w-2xl space-y-5">
                    <!-- MCP Servers -->
                    <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 class="text-sm font-semibold text-[var(--text)]">MCP Servers</h4>
                          <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                            已连接 {{ mcpServers.length }} 个 MCP Server，共发现 {{ totalMcpTools }} 个工具。
                          </p>
                        </div>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                            @click="refreshMcpServers"
                          >
                            <RefreshCw class="h-3.5 w-3.5" />
                            刷新
                          </button>
                          <button
                            type="button"
                            class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 text-xs text-[var(--shell-bg)] hover:bg-[var(--accent-strong)]"
                            @click="showMcpAddDialog = true"
                          >
                            <Plus class="h-3.5 w-3.5" />
                            添加 Server
                          </button>
                        </div>
                      </div>

                      <div class="mt-4 space-y-2">
                        <div
                          v-for="server in mcpServers"
                          :key="server.serverId"
                          class="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/60 p-3"
                        >
                          <div class="flex flex-wrap items-start justify-between gap-2">
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-2">
                                <span class="text-sm font-medium text-[var(--text)]">{{ server.name }}</span>
                                <span
                                  class="settings-status-chip"
                                  :class="{
                                    'settings-status-chip-success': server.status === 'initialized' || server.status === 'connecting',
                                    'settings-status-chip-error': server.status === 'error' || server.status === 'exited' || server.status === 'completed'
                                  }"
                                >
                                  {{ server.status }}
                                </span>
                                <span class="text-xs text-[var(--text-subtle)]">{{ server.toolCount }} 工具</span>
                              </div>
                              <p class="mt-0.5 text-xs text-[var(--text-subtle)] font-mono">{{ server.command }} {{ server.args?.join(' ') }}</p>
                              <p v-if="server.error" class="mt-1 text-xs text-red-500">{{ server.error }}</p>
                            </div>
                            <div class="flex items-center gap-1">
                              <button
                                type="button"
                                class="motion-icon rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                                title="查看日志"
                                @click="showMcpLogs(server.serverId)"
                              >
                                <FileText class="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                class="motion-icon rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                                title="编辑配置"
                                @click="openMcpEditDialog(server)"
                              >
                                <Pencil class="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                class="motion-icon rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                title="断开连接"
                                @click="disconnectMcpServer(server.serverId)"
                              >
                                <Trash2 class="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div v-if="server.tools?.length" class="mt-3 flex flex-wrap gap-1.5">
                            <span
                              v-for="tool in server.tools"
                              :key="tool.name"
                              class="inline-flex items-center rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
                            >
                              {{ tool.name }}
                            </span>
                          </div>
                        </div>
                        <div v-if="!mcpServers.length" class="py-8 text-center text-sm text-[var(--text-subtle)]">
                          尚未连接任何 MCP Server。点击"添加 Server"开始配置。
                        </div>
                      </div>
                    </div>

                    <!-- 导入配置 -->
                    <div class="rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] p-4 shadow-sm">
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 class="text-sm font-semibold text-[var(--text)]">导入配置</h4>
                          <p class="mt-1 text-xs leading-6 text-[var(--text-subtle)]">
                            粘贴 MCP JSON 配置或 server URL，一键批量导入。
                          </p>
                        </div>
                        <button
                          type="button"
                          class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                          @click="showMcpImportDialog = true"
                        >
                          <Download class="h-3.5 w-3.5" />
                          导入配置
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else key="debug" class="flex h-full flex-col p-6">
                <div class="mb-4 flex items-center justify-between">
                  <h4 class="text-sm font-semibold text-[var(--text)]">结构化调试日志</h4>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                      @click="loadDebugLogs"
                    >
                      <RefreshCw class="h-3.5 w-3.5" :class="{ 'spin-gentle': isLoadingDebugLogs }" />
                      刷新
                    </button>
                    <button
                      type="button"
                      class="motion-surface flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                      @click="clearDebugLogs"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                      清空
                    </button>
                  </div>
                </div>
                <div class="debug-log-list custom-scrollbar flex-1 space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/60 p-3">
                  <article
                    v-for="item in debugLogItems"
                    :key="item.id"
                    class="debug-log-item rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3"
                  >
                    <div class="mb-1.5 flex items-center gap-2">
                      <span class="tool-status-chip" :class="item.level === 'error' ? 'tool-status-chip-error' : 'tool-status-chip-success'">
                        {{ item.level }}
                      </span>
                      <span class="text-[11px] text-[var(--text-subtle)]">{{ item.ts }}</span>
                    </div>
                    <div class="text-xs font-medium text-[var(--text-muted)]">{{ item.scope }} / {{ item.event }}</div>
                    <pre class="tool-embed-code mt-2 max-h-[160px] rounded-lg"><code>{{ stringifyForBlock(item.payload) }}</code></pre>
                  </article>
                  <div v-if="!debugLogItems.length" class="py-10 text-center text-sm text-[var(--text-subtle)]">
                    暂无调试日志，执行一次消息发送或工具调用后会出现记录。
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <div class="px-5 py-4 border-t border-[var(--border)] bg-[var(--surface-muted)] flex justify-end gap-3 flex-shrink-0">
          <button type="button" @click="closeSettings()" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]">取消</button>
          <button type="button" @click="saveConfig" class="motion-surface flex items-center gap-2 rounded-lg bg-[var(--accent)] text-[var(--shell-bg)] shadow-sm hover:bg-[var(--accent-strong)] px-2 py-2">
            <Check class="h-4 w-4" />
            保存配置
          </button>
        </div>
      </div>
      </div>
    </Transition>

    <!-- Skill Create Dialog -->
    <Transition name="overlay-fade">
      <div v-if="showSkillCreateDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4" @click.self="closeSkillCreateDialog">
        <div class="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl">
          <div class="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 class="text-base font-semibold text-[var(--text)]">新建 Skill</h3>
            <button type="button" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text)]" @click="closeSkillCreateDialog">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="space-y-4 p-5">
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">名称</label>
              <input v-model.trim="skillCreateForm.name" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="例如：pdf-processing" />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">描述</label>
              <input v-model.trim="skillCreateForm.description" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="简要描述 Skill 的用途和触发场景" />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">SKILL.md 内容</label>
              <textarea v-model="skillCreateForm.content" rows="10" class="motion-field custom-scrollbar w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm font-mono leading-6 text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="输入 SKILL.md 的完整 Markdown 内容。如果内容不包含 YAML frontmatter，系统会自动添加。"></textarea>
            </div>
          </div>
          <div class="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
            <button type="button" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]" @click="closeSkillCreateDialog">取消</button>
            <button type="button" class="motion-surface flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--shell-bg)] shadow-sm hover:bg-[var(--accent-strong)]" :disabled="isSavingSkill" @click="submitSkillCreate">
              <Check class="h-4 w-4" />
              保存
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Skill Detail Dialog -->
    <Transition name="overlay-fade">
      <div v-if="showSkillDetailDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4" @click.self="closeSkillDetailDialog">
        <div class="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl">
          <div class="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 class="text-base font-semibold text-[var(--text)]">{{ skillDetailName }}</h3>
            <button type="button" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text)]" @click="closeSkillDetailDialog">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="p-5">
            <pre class="tool-embed-code max-h-[60vh] overflow-y-auto rounded-xl"><code>{{ skillDetailContent }}</code></pre>
          </div>
          <div class="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
            <button type="button" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]" @click="closeSkillDetailDialog">关闭</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Memory Dialog -->
    <Transition name="overlay-fade">
      <div v-if="showMemoryDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4" @click.self="closeMemoryDialog">
        <div class="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl">
          <div class="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 class="text-base font-semibold text-[var(--text)]">{{ memoryDialogMode === 'create' ? '新建记忆块' : '编辑记忆块' }}</h3>
            <button type="button" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text)]" @click="closeMemoryDialog">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="space-y-4 p-5">
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">标签</label>
              <input v-model.trim="memoryForm.label" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="唯一的标识名称" :disabled="memoryDialogMode === 'edit'" />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">描述</label>
              <input v-model.trim="memoryForm.description" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="简要描述这个记忆块的用途" />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">内容</label>
              <textarea v-model="memoryForm.value" rows="8" class="motion-field custom-scrollbar w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm font-mono leading-6 text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="记忆内容..."></textarea>
            </div>
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <label class="text-sm font-medium text-[var(--text-muted)]">字符上限</label>
                <input v-model.number="memoryForm.chars_limit" type="number" min="100" max="100000" class="motion-field h-9 w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" />
              </div>
              <div class="flex items-center gap-2">
                <input v-model="memoryForm.read_only" type="checkbox" id="memoryReadOnly" class="h-4 w-4 rounded border-[var(--border)]" />
                <label for="memoryReadOnly" class="text-sm font-medium text-[var(--text-muted)]">只读</label>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
            <button type="button" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]" @click="closeMemoryDialog">取消</button>
            <button type="button" class="motion-surface flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--shell-bg)] shadow-sm hover:bg-[var(--accent-strong)]" @click="submitMemoryForm">
              <Check class="h-4 w-4" />
              保存
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- MCP Add Server Dialog -->
    <Transition name="overlay-fade">
      <div v-if="showMcpAddDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4" @click.self="showMcpAddDialog = false">
        <div class="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl">
          <div class="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 class="text-base font-semibold text-[var(--text)]">添加 MCP Server</h3>
            <button type="button" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text)]" @click="showMcpAddDialog = false">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="space-y-4 p-5">
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">名称（可选）</label>
              <input v-model.trim="mcpAddForm.name" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="例如：filesystem-server" />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">命令</label>
              <input v-model.trim="mcpAddForm.command" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-mono text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="例如：npx 或 /path/to/server" />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">参数（可选，空格分隔）</label>
              <input v-model.trim="mcpAddForm.args" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-mono text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="例如：-p 3000 --verbose" />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">工作目录（可选）</label>
              <input v-model.trim="mcpAddForm.cwd" type="text" class="motion-field h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-mono text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder="默认使用当前工作目录" />
            </div>
          </div>
          <div class="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
            <button type="button" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]" @click="showMcpAddDialog = false">取消</button>
            <button type="button" class="motion-surface flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--shell-bg)] shadow-sm hover:bg-[var(--accent-strong)]" :disabled="!mcpAddForm.command.trim() || isConnectingMcp" @click="addMcpServer">
              <Check class="h-4 w-4" />
              连接
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- MCP Import Config Dialog -->
    <Transition name="overlay-fade">
      <div v-if="showMcpImportDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4" @click.self="showMcpImportDialog = false">
        <div class="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl">
          <div class="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 class="text-base font-semibold text-[var(--text)]">导入 MCP 配置</h3>
            <button type="button" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text)]" @click="showMcpImportDialog = false">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="space-y-4 p-5">
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">粘贴 MCP 配置 JSON</label>
              <textarea v-model="mcpImportText" rows="10" class="motion-field custom-scrollbar w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm font-mono leading-6 text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder='{"mcpServers": {"Name": {"command": "npx", "args": ["-y", "@xxx/server"]}}}&#10;&#10;或直接粘贴 URL：&#10;https://your-mcp-server.com/sse'></textarea>
            </div>
            <div v-if="mcpImportError" class="text-xs text-red-500">{{ mcpImportError }}</div>
          </div>
          <div class="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
            <button type="button" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]" @click="showMcpImportDialog = false">取消</button>
            <button type="button" class="motion-surface flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--shell-bg)] shadow-sm hover:bg-[var(--accent-strong)]" :disabled="!mcpImportText.trim() || isImportingMcp" @click="importMcpConfig">
              <Check class="h-4 w-4" />
              导入
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- MCP Log Dialog -->
    <Transition name="overlay-fade">
      <div v-if="showMcpLogDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4" @click.self="showMcpLogDialog = false">
        <div class="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl">
          <div class="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 class="text-base font-semibold text-[var(--text)]">MCP 日志 - {{ mcpLogData?.name }}</h3>
            <button type="button" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text)]" @click="showMcpLogDialog = false">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="p-5">
            <div class="mb-3 flex items-center gap-2">
              <span class="text-xs text-[var(--text-muted)]">状态:</span>
              <span
                class="settings-status-chip"
                :class="{
                  'settings-status-chip-success': mcpLogData?.status === 'initialized' || mcpLogData?.status === 'connecting',
                  'settings-status-chip-error': mcpLogData?.status === 'error' || mcpLogData?.status === 'exited'
                }"
              >
                {{ mcpLogData?.status }}
              </span>
            </div>
            <div v-if="mcpLogData?.error" class="mb-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-500">
              {{ mcpLogData.error }}
            </div>
            <div class="custom-scrollbar max-h-[400px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <div v-if="mcpLogData?.logs?.length">
                <div
                  v-for="(log, i) in mcpLogData.logs"
                  :key="i"
                  class="mb-2 font-mono text-xs"
                >
                  <span class="text-[var(--text-subtle)]">[{{ new Date(log.ts).toLocaleTimeString() }}]</span>
                  <span :class="log.channel === 'stderr' ? 'text-yellow-500' : 'text-[var(--text-muted)]'">{{ log.channel }}</span>
                  <span class="ml-2 whitespace-pre-wrap break-all text-[var(--text)]">{{ log.text }}</span>
                </div>
              </div>
              <div v-else class="text-center text-sm text-[var(--text-subtle)]">暂无日志</div>
            </div>
          </div>
          <div class="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
            <button type="button" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]" @click="showMcpLogDialog = false">关闭</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- MCP Edit Server Dialog -->
    <Transition name="overlay-fade">
      <div v-if="showMcpEditDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4" @click.self="showMcpEditDialog = false">
        <div class="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--app-bg)] shadow-xl">
          <div class="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 class="text-base font-semibold text-[var(--text)]">编辑 MCP Server (JSON)</h3>
            <button type="button" class="motion-icon rounded-md p-1 text-[var(--text-subtle)] hover:text-[var(--text)]" @click="showMcpEditDialog = false">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="space-y-4 p-5">
            <div>
              <label class="block text-sm font-medium text-[var(--text-muted)] mb-1.5">mcpServers 配置</label>
              <textarea v-model="mcpEditJson" rows="12" class="motion-field custom-scrollbar w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm font-mono leading-6 text-[var(--text)] focus:bg-[var(--app-bg)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]" placeholder='{"mcpServers": {"Name": {"command": "npx", "args": ["-y", "@xxx/server"]}}}'></textarea>
            </div>
            <div v-if="mcpEditJsonError" class="text-xs text-red-500">{{ mcpEditJsonError }}</div>
          </div>
          <div class="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
            <button type="button" class="motion-list-item rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]/50 hover:text-[var(--text)]" @click="showMcpEditDialog = false">取消</button>
            <button type="button" class="motion-surface flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--shell-bg)] shadow-sm hover:bg-[var(--accent-strong)]" :disabled="!mcpEditJson.trim() || isConnectingMcp" @click="updateMcpServer">
              <Check class="h-4 w-4" />
              保存并更新
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Notice -->
    <Transition name="notice-float">
      <div v-if="notice" class="fixed top-4 right-4 z-50">
        <div class="notice-card-glass flex items-center gap-2 rounded-xl border px-4 py-3 shadow-lg"
             :class="notice.type === 'success' ? 'border-emerald-200 text-emerald-800 bg-emerald-50 dark:border-emerald-400/30 dark:text-emerald-200 dark:bg-emerald-500/15' : notice.type === 'error' ? 'border-red-200 text-red-800 bg-red-50 dark:border-red-400/30 dark:text-red-200 dark:bg-red-500/15' : 'border-blue-200 text-blue-800 bg-blue-50 dark:border-blue-400/30 dark:text-blue-200 dark:bg-blue-500/15'">
          <span class="text-sm font-medium">{{ notice.text }}</span>
        </div>
      </div>
    </Transition>

  </div>
</template>
