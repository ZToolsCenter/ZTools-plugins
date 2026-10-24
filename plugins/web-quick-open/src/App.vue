<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Globe,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Upload
} from 'lucide-vue-next'
import { ZButton, ZInput, ZSwitch, ZTag } from 'ztools-ui'

function debugUi(event: string, details: Record<string, string | number | boolean> = {}): void {
  try {
    if (window.webQuickOpen?.writeDebugLog) {
      window.webQuickOpen.writeDebugLog(event, details)
      return
    }
    console.debug('[WebQuickOpen][ui]', { timestamp: new Date().toISOString(), event, ...details })
  } catch {
    // Logging must never interrupt UI interactions
  }
}

function debugUiError(event: string, error: unknown): void {
  const code = String((error as { code?: unknown })?.code || '')
  debugUi(event, { errorCode: /^[A-Z][A-Z0-9_]{0,39}$/.test(code) ? code : 'UNSPECIFIED' })
}

type NoticeType = 'success' | 'error' | 'info'
type SearchPreset = {
  name: string
  url: string
}

const FEATURE_PREFIX = 'quick-open-'
const ALL_GROUPS = '全部'
const DEFAULT_GROUP = '默认'
const searchPresets: SearchPreset[] = [
  {
    name: '百度',
    url: 'https://www.baidu.com/s?wd={q}'
  },
  {
    name: '必应',
    url: 'https://www.bing.com/search?q={q}'
  },
  {
    name: 'Google',
    url: 'https://www.google.com/search?q={q}'
  },
  {
    name: '哔哩哔哩',
    url: 'https://search.bilibili.com/all?keyword={q}'
  }
]

const engines = ref<WebSearchEngine[]>([])
const groups = ref<string[]>([])
const browserProfiles = ref<WebQuickOpenBrowserProfile[]>([])
const selectedGroup = ref(ALL_GROUPS)
const loading = ref(true)
const saving = ref(false)
const fetchingIcon = ref(false)
const quickSavingPreset = ref('')
const query = ref('')
const editingEngine = ref<WebSearchEngine | null>(null)
const showEditor = ref(false)
const notice = ref<{ type: NoticeType; text: string } | null>(null)
const iconFileInput = ref<HTMLInputElement | null>(null)
const importFileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const exporting = ref(false)
const groupDialogMode = ref<'create' | 'rename' | null>(null)
const groupNameInput = ref('')
const showBrowserManager = ref(false)
const browserManagerReturnToEditor = ref(false)
const browserProfileQuery = ref('')
const browserIconFileInput = ref<HTMLInputElement | null>(null)
const fetchingBrowserIcon = ref(false)
const brokenBrowserIcons = ref(new Set<string>())
let browserIconTaskSequence = 0
const browserProfileDialog = ref(false)
const testingBrowserProfile = ref(false)
const editingBrowserProfileId = ref('')
const browserProfileForm = ref(createEmptyBrowserProfile())
let noticeTimer = 0

const formData = ref<WebSearchEngine>(createEmptyEngine())

const groupFilteredEngines = computed(() => {
  if (selectedGroup.value === ALL_GROUPS) return engines.value
  return engines.value.filter((engine) => resolveGroup(engine) === selectedGroup.value)
})

const filteredEngines = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return groupFilteredEngines.value

  return groupFilteredEngines.value.filter((engine) => {
    return [engine.name, engine.url, engine.keyword || '', engine.type]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })
})

const isEditing = computed(() => Boolean(editingEngine.value))
const isWebpage = computed(() => formData.value.type === 'webpage')
const currentPlatform = computed(() => {
  if (window.ztools?.isWindows?.()) return 'win32'
  if (window.ztools?.isMacOS?.() || window.ztools?.isMacOs?.()) return 'darwin'
  return 'linux'
})
const visibleBrowserProfiles = computed(() =>
  browserProfiles.value.filter(
    (profile) =>
      !profile.hidden &&
      (!profile.platform.length || profile.platform.includes(currentPlatform.value))
  )
)
const filteredBrowserProfiles = computed(() => {
  const keyword = browserProfileQuery.value.trim().toLowerCase()
  const profiles = browserProfiles.value.filter(
    (profile) =>
      !profile.builtin ||
      !profile.platform.length ||
      profile.platform.includes(currentPlatform.value)
  )
  if (!keyword) return profiles
  return profiles.filter((profile) =>
    [profile.name, profile.path, profile.args.join(' ')].join(' ').toLowerCase().includes(keyword)
  )
})
const selectedBrowserProfile = computed(() =>
  browserProfiles.value.find((profile) => profile.id === formData.value.browserId)
)
const emptyText = computed(() => {
  if (query.value.trim()) return '没有匹配的网页快开'
  return selectedGroup.value === ALL_GROUPS
    ? '还没有网页快开'
    : `${selectedGroup.value}分组还没有入口`
})
const isUserGroupSelected = computed(
  () => selectedGroup.value !== ALL_GROUPS && selectedGroup.value !== DEFAULT_GROUP
)
const groupCounts = computed(() => {
  const counts = new Map<string, number>([[DEFAULT_GROUP, 0]])
  for (const group of groups.value) counts.set(group, 0)
  for (const engine of engines.value) {
    const group = resolveGroup(engine)
    counts.set(group, (counts.get(group) || 0) + 1)
  }
  return counts
})
const existingSearchUrls = computed(
  () =>
    new Set(engines.value.filter((engine) => engine.type === 'search').map((engine) => engine.url))
)

function createEmptyEngine(): WebSearchEngine {
  return {
    id: '',
    name: '',
    url: '',
    icon: '',
    enabled: true,
    type: 'webpage',
    keyword: '',
    group: null,
    browserId: null
  }
}

function createEmptyBrowserProfile(): WebQuickOpenBrowserProfile {
  return {
    id: '',
    name: '',
    icon: 'custom',
    path: '',
    args: ['{url}'],
    builtin: false,
    hidden: false,
    platform: []
  }
}

function resolveGroup(engine: WebSearchEngine): string {
  const value = engine.group?.trim().toLowerCase()
  return groups.value.find((group) => group.toLowerCase() === value) || DEFAULT_GROUP
}

function showNotice(type: NoticeType, text: string): void {
  debugUi('notice.show', { type })
  notice.value = { type, text }
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = null
  }, 2400)
}

async function loadEngines(): Promise<void> {
  debugUi('entries.load.start')
  loading.value = true
  try {
    if (!window.webQuickOpen) {
      engines.value = []
      showNotice('info', '等待 ZTools 插件运行时')
      return
    }
    const [engineResult, groupResult, profileResult] = await Promise.all([
      window.webQuickOpen.getAll(),
      window.webQuickOpen.getGroups(),
      window.webQuickOpen.getBrowserProfiles(true)
    ])
    if (!engineResult.success || !groupResult.success || !profileResult.success) {
      showNotice(
        'error',
        engineResult.error || groupResult.error || profileResult.error || '加载失败'
      )
      return
    }
    engines.value = engineResult.data || []
    groups.value = groupResult.data || []
    browserProfiles.value = profileResult.data || []
    debugUi('entries.load.complete', {
      entryCount: engines.value.length,
      groupCount: groups.value.length,
      profileCount: browserProfiles.value.length
    })
    if (
      selectedGroup.value !== ALL_GROUPS &&
      selectedGroup.value !== DEFAULT_GROUP &&
      !groups.value.includes(selectedGroup.value)
    ) {
      selectedGroup.value = ALL_GROUPS
    }
  } catch (error) {
    debugUiError('load.engines.failed', error)
    showNotice('error', '加载失败')
  } finally {
    loading.value = false
  }
}

function openAddEditor(url = ''): void {
  debugUi('editor.add.open')
  editingEngine.value = null
  const normalizedUrl = url.trim() ? ensureUrlProtocol(url.trim()) : ''
  formData.value = {
    ...createEmptyEngine(),
    name: normalizedUrl ? getUrlName(normalizedUrl) : '',
    url: normalizedUrl,
    group: groups.value.includes(selectedGroup.value) ? selectedGroup.value : null
  }
  showEditor.value = true
}

function getUrlName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\\./i, '')
  } catch {
    return url
  }
}

function openEditEditor(engine: WebSearchEngine): void {
  debugUi('editor.edit.open')
  editingEngine.value = engine
  formData.value = {
    ...engine,
    type: engine.type || 'search',
    keyword: engine.keyword || '',
    browserId: engine.browserId || null
  }
  showEditor.value = true
}

function closeEditor(): void {
  debugUi('editor.close')
  showEditor.value = false
  editingEngine.value = null
  formData.value = createEmptyEngine()
}

function startCreateGroup(): void {
  groupDialogMode.value = 'create'
  groupNameInput.value = ''
}

function startRenameGroup(): void {
  if (!isUserGroupSelected.value) return
  groupDialogMode.value = 'rename'
  groupNameInput.value = selectedGroup.value
}

function cancelGroupDialog(): void {
  groupDialogMode.value = null
  groupNameInput.value = ''
}

async function saveGroupName(): Promise<void> {
  const name = groupNameInput.value.trim()
  const renaming = groupDialogMode.value === 'rename'
  if (!name) {
    showNotice('error', '分组名称不能为空')
    return
  }

  try {
    const result = renaming
      ? await window.webQuickOpen.renameGroup(selectedGroup.value, name)
      : await window.webQuickOpen.createGroup(name)
    if (!result.success) {
      showNotice('error', result.error || '分组保存失败')
      return
    }
    groups.value = result.data || []
    selectedGroup.value = name
    cancelGroupDialog()
    await loadEngines()
    showNotice('success', renaming ? '分组已更新' : '分组已创建')
  } catch (error) {
    debugUiError('save.group.failed', error)
    showNotice('error', '分组保存失败')
  }
}

async function deleteSelectedGroup(): Promise<void> {
  if (!isUserGroupSelected.value) return
  const count = groupCounts.value.get(selectedGroup.value) || 0
  const confirmed = window.confirm(
    `确定删除分组「${selectedGroup.value}」吗？${count} 个入口将移至默认分组。`
  )
  if (!confirmed) return

  try {
    const result = await window.webQuickOpen.deleteGroup(selectedGroup.value)
    if (!result.success) {
      showNotice('error', result.error || '删除分组失败')
      return
    }
    groups.value = result.data || []
    selectedGroup.value = DEFAULT_GROUP
    await loadEngines()
    showNotice('success', '分组已删除，入口已移至默认')
  } catch (error) {
    debugUiError('delete.group.failed', error)
    showNotice('error', '删除分组失败')
  }
}

async function toggleEnabled(engine: WebSearchEngine, enabled: boolean): Promise<void> {
  const previous = engine.enabled
  engine.enabled = enabled
  try {
    const result = await window.webQuickOpen.update({ ...engine, enabled })
    if (!result.success) {
      engine.enabled = previous
      showNotice('error', result.error || '更新失败')
      return
    }
    await loadEngines()
  } catch (error) {
    engine.enabled = previous
    debugUiError('toggle.failed', error)
    showNotice('error', '更新失败')
  }
}

async function saveEngine(): Promise<void> {
  const normalized = validateEngine(formData.value)
  if (!normalized.success) {
    showNotice('error', normalized.error || '保存失败')
    return
  }

  saving.value = true
  try {
    const result = isEditing.value
      ? await window.webQuickOpen.update(normalized.engine)
      : await window.webQuickOpen.add(normalized.engine)

    if (!result.success) {
      showNotice('error', result.error || '保存失败')
      return
    }

    showNotice('success', isEditing.value ? '已更新' : '已添加')
    await loadEngines()
    closeEditor()
  } catch (error) {
    debugUiError('save.failed', error)
    showNotice('error', '保存失败')
  } finally {
    saving.value = false
  }
}

async function quickAddSearchPreset(preset: SearchPreset): Promise<void> {
  if (quickSavingPreset.value) return
  if (existingSearchUrls.value.has(preset.url)) {
    showNotice('info', `已存在「${preset.name}」`)
    return
  }

  quickSavingPreset.value = preset.name
  try {
    const iconResult = await window.webQuickOpen.fetchFavicon(preset.url)
    const result = await window.webQuickOpen.add({
      id: '',
      name: preset.name,
      url: preset.url,
      icon: iconResult.success && iconResult.data ? iconResult.data : '',
      enabled: true,
      type: 'search',
      keyword: ''
    })

    if (!result.success) {
      showNotice('error', result.error || '添加失败')
      return
    }

    showNotice('success', `已添加「${preset.name}」`)
    await loadEngines()
    closeEditor()
  } catch (error) {
    debugUiError('quick.add.search.preset.failed', error)
    showNotice('error', '添加失败')
  } finally {
    quickSavingPreset.value = ''
  }
}

async function deleteEngine(engine: WebSearchEngine): Promise<void> {
  const confirmed = window.confirm(`确定删除「${engine.name}」吗？`)
  if (!confirmed) return

  try {
    const result = await window.webQuickOpen.delete(engine.id)
    if (!result.success) {
      showNotice('error', result.error || '删除失败')
      return
    }
    showNotice('success', '已删除')
    await loadEngines()
  } catch (error) {
    debugUiError('delete.failed', error)
    showNotice('error', '删除失败')
  }
}

async function fetchFavicon(): Promise<void> {
  if (!formData.value.url.trim()) {
    showNotice('error', '请先填写 URL')
    return
  }

  fetchingIcon.value = true
  try {
    const result = await window.webQuickOpen.fetchFavicon(formData.value.url)
    if (result.success && result.data) {
      formData.value.icon = result.data
      showNotice('success', '已获取图标')
    } else {
      showNotice('error', result.error || '未能获取图标')
    }
  } catch (error) {
    debugUiError('fetch.favicon.failed', error)
    showNotice('error', '获取图标失败')
  } finally {
    fetchingIcon.value = false
  }
}

function pickIconFile(): void {
  debugUi('icon.filePicker.open')
  iconFileInput.value?.click()
}

function openBrowserManager(): void {
  debugUi('browserManager.open')
  browserManagerReturnToEditor.value = showEditor.value
  showBrowserManager.value = true
  showEditor.value = false
}

function closeBrowserManager(): void {
  invalidateBrowserIconTask()
  debugUi('browserManager.close')
  showBrowserManager.value = false
  showEditor.value = browserManagerReturnToEditor.value
}

function isBrowserImage(icon: string): boolean {
  return icon.startsWith('data:image/') && !brokenBrowserIcons.value.has(icon)
}

function invalidateBrowserIconTask(): void {
  browserIconTaskSequence++
  fetchingBrowserIcon.value = false
}

async function fetchBrowserProfileIcon(): Promise<void> {
  const task = ++browserIconTaskSequence
  const snapshot = JSON.stringify([browserProfileForm.value.path, browserProfileForm.value.args])
  fetchingBrowserIcon.value = true
  try {
    const result = await window.webQuickOpen.fetchBrowserIcon({
      ...browserProfileForm.value,
      args: [...browserProfileForm.value.args]
    })
    if (
      task !== browserIconTaskSequence ||
      !browserProfileDialog.value ||
      snapshot !== JSON.stringify([browserProfileForm.value.path, browserProfileForm.value.args])
    )
      return
    if (result.success && result.data) {
      browserProfileForm.value.icon = result.data
      showNotice('success', '已获取浏览器图标')
    } else showNotice('error', result.error || '未能获取图标，请上传图片')
  } catch (error) {
    debugUiError('browser.icon.failed', error)
    if (task === browserIconTaskSequence) showNotice('error', '获取图标失败，请上传图片')
  } finally {
    if (task === browserIconTaskSequence) fetchingBrowserIcon.value = false
  }
}

function handleBrowserIconFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (
    !/^image\/(png|jpeg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(file.type) ||
    file.size > 1024 * 1024
  ) {
    showNotice('error', '请选择不超过 1 MB 的 PNG、JPEG、WebP、SVG 或 ICO 图片')
    return
  }
  invalidateBrowserIconTask()
  const task = browserIconTaskSequence
  const reader = new FileReader()
  reader.onload = () => {
    if (task !== browserIconTaskSequence || !browserProfileDialog.value) return
    if (typeof reader.result === 'string') {
      browserProfileForm.value.icon = reader.result
      debugUi('browser.icon.uploaded', { byteCount: file.size })
      showNotice('success', '已上传浏览器图标')
    }
  }
  reader.onerror = () => {
    if (task === browserIconTaskSequence) showNotice('error', '读取图标失败')
  }
  reader.readAsDataURL(file)
}

function openNewBrowserProfile(): void {
  invalidateBrowserIconTask()
  debugUi('browserProfile.add.open')
  editingBrowserProfileId.value = ''
  browserProfileForm.value = createEmptyBrowserProfile()
  browserProfileDialog.value = true
}

function editBrowserProfile(profile: WebQuickOpenBrowserProfile): void {
  invalidateBrowserIconTask()
  debugUi('browserProfile.edit.open')
  editingBrowserProfileId.value = profile.id
  browserProfileForm.value = { ...profile, args: [...profile.args] }
  browserProfileDialog.value = true
}

function copyBrowserProfile(profile: WebQuickOpenBrowserProfile): void {
  invalidateBrowserIconTask()
  debugUi('browserProfile.copy.open')
  editingBrowserProfileId.value = ''
  browserProfileForm.value = {
    ...profile,
    id: '',
    name: `${profile.name} - 副本`,
    builtin: false,
    hidden: false,
    args: [...profile.args]
  }
  browserProfileDialog.value = true
}

function cancelBrowserProfile(): void {
  invalidateBrowserIconTask()
  debugUi('browserProfile.dialog.close')
  browserProfileDialog.value = false
  editingBrowserProfileId.value = ''
}

function parseBrowserArgs(value: string): string[] {
  const result: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(value))) result.push(match[1] ?? match[2] ?? match[3])
  return result
}

function stringifyBrowserArgs(args: string[]): string {
  return args.map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(' ')
}

function browserCommandPreview(profile: WebQuickOpenBrowserProfile): string {
  return `${profile.path} ${stringifyBrowserArgs(profile.args).replace(/\{url\}/g, 'https://example.com')}`.trim()
}

async function saveBrowserProfile(): Promise<void> {
  const form = browserProfileForm.value
  if (!form.name.trim() || !form.path.trim()) {
    showNotice('error', '请填写配置名称和启动路径')
    return
  }
  const profile = {
    ...form,
    id: editingBrowserProfileId.value || `custom-${Date.now().toString(36)}`,
    name: form.name.trim(),
    path: form.path.trim(),
    args: Array.isArray(form.args) ? form.args.filter(Boolean) : []
  }
  const result = await window.webQuickOpen.saveBrowserProfile(profile)
  if (!result.success) {
    showNotice('error', result.error || '保存浏览器配置失败')
    return
  }
  browserProfiles.value = result.data || []
  cancelBrowserProfile()
  showNotice('success', '浏览器配置已保存')
}

async function deleteBrowserProfile(profile: WebQuickOpenBrowserProfile): Promise<void> {
  if (profile.builtin) {
    const result = await window.webQuickOpen.toggleBrowserProfileHidden(profile.id)
    if (!result.success) {
      showNotice('error', result.error || '隐藏浏览器配置失败')
      return
    }
    browserProfiles.value = result.data || []
    if (profile.hidden && formData.value.browserId === profile.id) formData.value.browserId = null
    showNotice('success', profile.hidden ? '预设已显示' : '预设已隐藏')
    return
  }
  if (!window.confirm(`确定删除“${profile.name}”吗？`)) return
  const result = await window.webQuickOpen.deleteBrowserProfile(profile.id)
  if (!result.success) {
    showNotice('error', result.error || '删除浏览器配置失败')
    return
  }
  browserProfiles.value = result.data || []
  if (formData.value.browserId === profile.id) formData.value.browserId = null
  showNotice('success', '浏览器配置已删除')
}

async function resetBrowserProfiles(): Promise<void> {
  const result = await window.webQuickOpen.resetBrowserProfiles()
  if (result.success) {
    browserProfiles.value = result.data || []
    showNotice('success', '已恢复内置浏览器预设')
  }
}

async function pickBrowserExecutableForProfile(): Promise<void> {
  const result = await window.webQuickOpen.pickBrowserExecutable()
  if (result.success && result.data) browserProfileForm.value.path = result.data
}

async function testBrowserProfile(): Promise<void> {
  const form = browserProfileForm.value
  const url = formData.value.url.trim()
    ? formData.value.type === 'search'
      ? formData.value.url.replace('{q}', encodeURIComponent('ztools'))
      : formData.value.url
    : 'https://example.com'
  const normalizedUrl = ensureUrlProtocol(url.trim())
  if (!isHttpUrl(normalizedUrl)) {
    showNotice('error', '请输入有效的 HTTP 或 HTTPS 地址')
    return
  }
  testingBrowserProfile.value = true
  try {
    const result = await window.webQuickOpen.testBrowserProfile(normalizedUrl, {
      ...form,
      args: Array.isArray(form.args) ? form.args : []
    })
    showNotice(
      result.success ? 'success' : 'error',
      result.success ? '已发送启动命令' : result.error || '浏览器启动失败'
    )
  } finally {
    testingBrowserProfile.value = false
  }
}

function exportEngines(): void {
  if (exporting.value) return
  exporting.value = true
  void window.webQuickOpen
    .exportJson()
    .then((result) => {
      if (!result.success || !result.data) {
        showNotice('error', result.error || '导出失败')
        return
      }

      const blob = new Blob([result.data], {
        type: 'application/json;charset=utf-8'
      })
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = `web-quick-open-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      const data = JSON.parse(result.data) as {
        engines?: unknown[]
        groups?: unknown[]
      }
      showNotice(
        'success',
        `已导出 ${data.engines?.length || 0} 条入口、${data.groups?.length || 0} 个分组`
      )
    })
    .catch((error) => {
      debugUiError('export.failed', error)
      showNotice('error', '导出失败')
    })
    .finally(() => {
      exporting.value = false
    })
}

function pickImportFile(): void {
  debugUi('import.filePicker.open')
  if (importing.value) return
  importFileInput.value?.click()
}

function handleImportFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) return

  if (file.size > 20 * 1024 * 1024) {
    showNotice('error', '导入文件不能超过 20 MB')
    return
  }
  importing.value = true
  const reader = new FileReader()
  debugUi('import.fileRead.start', { byteCount: file.size })
  reader.onload = async () => {
    debugUi('import.fileRead.complete', {
      inputCharacters: typeof reader.result === 'string' ? reader.result.length : 0
    })
    try {
      if (typeof reader.result !== 'string') {
        showNotice('error', '读取导入文件失败')
        return
      }

      const result = await window.webQuickOpen.importFromJsonText(reader.result)
      if (!result.success) {
        showNotice('error', result.error || '导入失败')
        return
      }

      await loadEngines()
      if ((result.importedCount || 0) > 0) {
        showNotice(
          'success',
          `已导入 ${result.importedCount} 条、${result.importedGroupCount || 0} 个分组，跳过 ${result.skippedCount || 0} 条`
        )
        return
      }

      showNotice('info', '未导入新数据，可能已存在或格式无效')
    } catch (error) {
      debugUiError('import.failed', error)
      showNotice('error', '导入失败')
    } finally {
      importing.value = false
    }
  }
  reader.onerror = () => {
    importing.value = false
    showNotice('error', '读取导入文件失败')
  }
  reader.readAsText(file, 'utf-8')
}

function handleIconFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!file.type.startsWith('image/')) {
    showNotice('error', '请选择图片文件')
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      formData.value.icon = reader.result
      showNotice('success', '已上传图标')
    }
  }
  reader.onerror = () => showNotice('error', '读取图标失败')
  reader.readAsDataURL(file)
}

function validateEngine(engine: WebSearchEngine):
  | {
      success: true
      engine: WebSearchEngine
    }
  | {
      success: false
      error: string
    } {
  const nextEngine: WebSearchEngine = {
    id: engine.id,
    name: engine.name.trim(),
    url: engine.url.trim(),
    icon: engine.icon || '',
    enabled: engine.enabled,
    type: engine.type,
    keyword: engine.keyword?.trim() || '',
    group: engine.group || null,
    browserId: engine.browserId || null
  }

  if (!nextEngine.name || !nextEngine.url) {
    return { success: false, error: '请填写名称和 URL' }
  }

  if (
    nextEngine.browserId &&
    !browserProfiles.value.some((profile) => profile.id === nextEngine.browserId)
  ) {
    nextEngine.browserId = null
  }

  nextEngine.url = ensureUrlProtocol(nextEngine.url)
  if (nextEngine.type === 'webpage') {
    if (!nextEngine.keyword) {
      return { success: false, error: '请填写匹配关键字' }
    }
    if (nextEngine.url.includes('{q}')) {
      return { success: false, error: '网页 URL 不能包含 {q}' }
    }
    if (!isHttpUrl(nextEngine.url)) {
      return { success: false, error: '网页 URL 必须是 http/https 地址' }
    }
  } else {
    if (!nextEngine.url.includes('{q}')) {
      return { success: false, error: '搜索 URL 必须包含 {q}' }
    }
    if (!isHttpUrl(nextEngine.url.replace('{q}', 'test'))) {
      return { success: false, error: '搜索 URL 必须是 http/https 地址' }
    }
    nextEngine.keyword = ''
  }

  return { success: true, engine: nextEngine }
}

function ensureUrlProtocol(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `https://${url}`
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isWebUrl(value: string): boolean {
  return isHttpUrl(ensureUrlProtocol(value.trim()))
}

function getLaunchPayload(param: LaunchParam): string {
  return (
    param.payload ||
    param.inputState?.pastedText ||
    param.inputState?.searchQuery ||
    ''
  ).trim()
}

async function handlePluginEnter(param: LaunchParam): Promise<void> {
  debugUi('plugin.enter')
  const code = param?.code || ''
  if (code === 'main-push') {
    const url = param.option?.url || getLaunchPayload(param)
    if (url && isWebUrl(url)) {
      openAddEditor(url)
    }
    return
  }
  if (!code.startsWith(FEATURE_PREFIX)) return

  try {
    const result = await window.webQuickOpen.getAll()
    const engine = result.data?.find((item) => `${FEATURE_PREFIX}${item.id}` === code)
    if (!engine) {
      window.ztools.showNotification?.('未找到网页快开配置')
      window.webQuickOpen.outPlugin()
      return
    }

    const payload = engine.type === 'search' ? getLaunchPayload(param) : ''
    if (engine.type === 'search' && !payload) {
      window.ztools.showNotification?.('缺少搜索关键词')
      window.webQuickOpen.outPlugin()
      return
    }

    const openResult = await window.webQuickOpen.openEngine(engine.id, payload)
    if (!openResult.success) {
      window.ztools.showNotification?.(openResult.error || '网页快开启动失败')
      window.webQuickOpen.outPlugin()
      return
    }

    window.webQuickOpen.hideMainWindow()
    window.webQuickOpen.outPlugin()
  } catch (error) {
    debugUiError('launch.failed', error)
    window.ztools.showNotification?.('网页快开启动失败')
    window.webQuickOpen.outPlugin()
  }
}

async function openPreview(engine: WebSearchEngine): Promise<void> {
  const result = await window.webQuickOpen.openEngine(
    engine.id,
    engine.type === 'search' ? 'ztools' : ''
  )
  if (!result.success) {
    showNotice('error', result.error || '打开失败')
  }
}

watch(
  () => [browserProfileForm.value.path, JSON.stringify(browserProfileForm.value.args)],
  invalidateBrowserIconTask
)

watch([showEditor, showBrowserManager, browserProfileDialog], () => {
  debugUi('view.changed', {
    editor: showEditor.value,
    browserManager: showBrowserManager.value,
    browserProfileDialog: browserProfileDialog.value
  })
})

onMounted(() => {
  debugUi('runtime.mounted')
  loadEngines()
  window.ztools?.onPluginEnter?.((param) => {
    void handlePluginEnter(param)
  })
})

onUnmounted(() => {
  debugUi('runtime.unmounted')
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <main class="app-shell">
    <Transition name="notice">
      <div v-if="notice" class="notice" :class="`notice-${notice.type}`">
        {{ notice.text }}
      </div>
    </Transition>

    <section v-if="!showEditor && !showBrowserManager" class="manager-view">
      <div class="toolbar">
        <ZInput v-model="query" type="search" clearable placeholder="搜索名称、URL 或关键字">
          <template #prefix>
            <Search :size="16" />
          </template>
        </ZInput>
        <div class="toolbar-actions">
          <ZButton size="medium" :disabled="loading || importing" @click="loadEngines">
            <template #icon>
              <RotateCw :size="15" />
            </template>
            刷新
          </ZButton>
          <ZButton size="medium" type="primary" @click="() => openAddEditor()">
            <template #icon>
              <Plus :size="15" />
            </template>
            添加
          </ZButton>
          <ZButton size="medium" :disabled="loading || importing" @click="pickImportFile">
            <template #icon>
              <Upload :size="15" />
            </template>
            {{ importing ? '导入中...' : '导入' }}
          </ZButton>
          <ZButton
            size="medium"
            :disabled="loading || exporting || engines.length === 0"
            @click="exportEngines"
          >
            <template #icon>
              <Download :size="15" />
            </template>
            {{ exporting ? '导出中...' : '导出' }}
          </ZButton>
          <input
            ref="importFileInput"
            type="file"
            accept=".json,application/json"
            class="file-input"
            @change="handleImportFileChange"
          />
        </div>
      </div>

      <div class="manager-layout">
        <aside class="group-sidebar" :class="{ 'editing-group': groupDialogMode }">
          <nav class="group-nav" aria-label="入口分组">
            <button
              class="group-nav-item"
              :class="{ active: selectedGroup === ALL_GROUPS }"
              type="button"
              @click="selectedGroup = ALL_GROUPS"
            >
              <span>{{ ALL_GROUPS }}</span>
              <span class="group-count">{{ engines.length }}</span>
            </button>
            <button
              class="group-nav-item"
              :class="{ active: selectedGroup === DEFAULT_GROUP }"
              type="button"
              @click="selectedGroup = DEFAULT_GROUP"
            >
              <span>{{ DEFAULT_GROUP }}</span>
              <span class="group-count">{{ groupCounts.get(DEFAULT_GROUP) || 0 }}</span>
            </button>
            <button
              v-for="group in groups"
              :key="group"
              class="group-nav-item"
              :class="{ active: selectedGroup === group }"
              type="button"
              @click="selectedGroup = group"
            >
              <span>{{ group }}</span>
              <span class="group-count">{{ groupCounts.get(group) || 0 }}</span>
            </button>
          </nav>

          <div class="group-sidebar-footer">
            <div v-if="groupDialogMode" class="group-editor" @keydown.enter.prevent="saveGroupName">
              <ZInput
                v-model="groupNameInput"
                size="small"
                :placeholder="groupDialogMode === 'rename' ? '修改分组名称' : '新分组名称'"
              />
              <div class="group-editor-actions">
                <ZButton size="small" type="primary" @click="saveGroupName">保存</ZButton>
                <ZButton size="small" @click="cancelGroupDialog">取消</ZButton>
              </div>
            </div>
            <div class="group-tools">
              <button
                class="icon-button"
                type="button"
                title="新增分组"
                aria-label="新增分组"
                @click="startCreateGroup"
              >
                <Plus :size="16" />
              </button>
              <button
                class="icon-button"
                type="button"
                :title="isUserGroupSelected ? '修改分组' : '请选择自定义分组后修改'"
                aria-label="修改分组"
                :disabled="!isUserGroupSelected"
                @click="startRenameGroup"
              >
                <Pencil :size="15" />
              </button>
              <button
                class="icon-button danger"
                type="button"
                :title="isUserGroupSelected ? '删除分组' : '请选择自定义分组后删除'"
                aria-label="删除分组"
                :disabled="!isUserGroupSelected"
                @click="deleteSelectedGroup"
              >
                <Trash2 :size="15" />
              </button>
            </div>
          </div>
        </aside>

        <div class="content-area">
          <div v-if="loading" class="state-panel">加载中...</div>
          <div v-else-if="filteredEngines.length === 0" class="state-panel">
            <Search :size="26" />
            <span>{{ emptyText }}</span>
            <ZButton v-if="selectedGroup !== ALL_GROUPS" size="small" @click="openAddEditor()"
              >添加入口</ZButton
            >
          </div>
          <div v-else class="engine-list">
            <article v-for="engine in filteredEngines" :key="engine.id" class="engine-card">
              <div class="engine-main">
                <div class="engine-icon">
                  <img v-if="engine.icon" :src="engine.icon" alt="" />
                  <Globe v-else :size="20" />
                </div>
                <div class="engine-text">
                  <div class="engine-heading">
                    <h2>{{ engine.name }}</h2>
                    <ZTag :type="engine.type === 'webpage' ? 'success' : 'info'" size="small">
                      {{ engine.type === 'webpage' ? '网页' : '搜索' }}
                    </ZTag>
                  </div>
                  <p>{{ engine.url }}</p>
                  <span v-if="engine.type === 'webpage' && engine.keyword">
                    匹配关键字：{{ engine.keyword }}
                  </span>
                </div>
              </div>
              <div class="engine-actions">
                <ZSwitch
                  :model-value="engine.enabled"
                  size="small"
                  @update:model-value="(value: boolean) => toggleEnabled(engine, value)"
                />
                <button class="icon-button" title="试开" @click="openPreview(engine)">
                  <ExternalLink :size="16" />
                </button>
                <button class="icon-button" title="编辑" @click="openEditEditor(engine)">
                  <Pencil :size="16" />
                </button>
                <button class="icon-button danger" title="删除" @click="deleteEngine(engine)">
                  <Trash2 :size="16" />
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="showBrowserManager" class="browser-manager-view">
      <header class="editor-header">
        <button class="icon-button" title="返回" @click="closeBrowserManager">
          <ArrowLeft :size="17" />
        </button>
        <div>
          <h1>浏览器管理</h1>
          <p>集中维护浏览器路径和启动参数，入口只保存配置引用</p>
        </div>
      </header>
      <div class="toolbar browser-manager-toolbar">
        <ZInput v-model="browserProfileQuery" type="search" clearable placeholder="搜索浏览器配置">
          <template #prefix><Search :size="16" /></template>
        </ZInput>
        <div class="toolbar-actions">
          <ZButton size="medium" @click="resetBrowserProfiles">
            <template #icon><RotateCw :size="15" /></template>
            恢复默认
          </ZButton>
          <ZButton size="medium" type="primary" @click="openNewBrowserProfile">
            <template #icon><Plus :size="15" /></template>
            新增
          </ZButton>
        </div>
      </div>
      <div class="browser-manager-content">
        <div v-if="filteredBrowserProfiles.length === 0" class="state-panel">暂无浏览器配置</div>
        <div v-else class="browser-profile-list">
          <article
            v-for="profile in filteredBrowserProfiles"
            :key="profile.id"
            class="browser-profile-card"
          >
            <div class="browser-profile-icon">
              <img
                v-if="isBrowserImage(profile.icon)"
                :src="profile.icon"
                alt=""
                @error="brokenBrowserIcons.add(profile.icon)"
              />
              <Globe v-else :size="24" />
            </div>
            <div class="browser-profile-main">
              <strong>{{ profile.name }}</strong>
              <div class="browser-profile-details">
                <span :title="profile.path">{{ profile.path }}</span>
                <code :title="stringifyBrowserArgs(profile.args)">{{
                  stringifyBrowserArgs(profile.args)
                }}</code>
              </div>
            </div>
            <div class="engine-actions">
              <button class="icon-button" title="编辑" @click="editBrowserProfile(profile)">
                <Pencil :size="16" />
              </button>
              <button class="icon-button" title="复制" @click="copyBrowserProfile(profile)">
                <Plus :size="16" />
              </button>
              <button
                class="icon-button"
                :class="{ danger: !profile.builtin }"
                :title="profile.builtin ? (profile.hidden ? '显示预设' : '隐藏预设') : '删除'"
                @click="deleteBrowserProfile(profile)"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </article>
        </div>
      </div>
      <div v-if="browserProfileDialog" class="browser-profile-dialog">
        <div class="browser-profile-dialog-card">
          <h2>
            {{ editingBrowserProfileId ? '编辑浏览器配置' : '新增浏览器配置' }}
          </h2>
          <div class="form-field">
            <label>名称</label
            ><ZInput v-model="browserProfileForm.name" placeholder="例如：Chrome 隐私模式打开" />
          </div>
          <div class="form-field">
            <label>图标</label>
            <div class="icon-editor">
              <div class="icon-preview">
                <img
                  v-if="isBrowserImage(browserProfileForm.icon)"
                  :src="browserProfileForm.icon"
                  alt=""
                  @error="brokenBrowserIcons.add(browserProfileForm.icon)"
                />
                <Globe v-else :size="24" />
              </div>
              <ZButton
                size="small"
                :loading="fetchingBrowserIcon"
                :disabled="!browserProfileForm.path"
                @click="fetchBrowserProfileIcon"
              >
                <template #icon><Download :size="14" /></template>
                自动获取
              </ZButton>
              <ZButton size="small" @click="browserIconFileInput?.click()">
                <template #icon><Upload :size="14" /></template>
                上传
              </ZButton>
              <input
                ref="browserIconFileInput"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
                class="file-input"
                @change="handleBrowserIconFileChange"
              />
            </div>
            <p class="hint">从指定程序提取图标，最多等待 2 秒，也可上传不超过 1 MB 的图片</p>
          </div>
          <div class="form-field">
            <label>启动路径</label>
            <div class="browser-path-row">
              <ZInput
                v-model="browserProfileForm.path"
                placeholder="chrome.exe 或完整路径"
              /><ZButton size="small" @click="pickBrowserExecutableForProfile">选择程序</ZButton>
            </div>
          </div>
          <div class="form-field">
            <label>启动参数</label
            ><ZInput
              :model-value="stringifyBrowserArgs(browserProfileForm.args)"
              @update:model-value="
                (value) => (browserProfileForm.args = parseBrowserArgs(String(value)))
              "
              placeholder="--incognito {url}"
            />
            <p class="hint">使用 {url} 作为网址占位符，不填写时自动追加到末尾</p>
          </div>
          <div class="browser-command-preview">
            <code>{{ browserCommandPreview(browserProfileForm) }}</code
            ><ZButton size="small" :loading="testingBrowserProfile" @click="testBrowserProfile"
              >测试打开</ZButton
            >
          </div>
          <footer class="editor-footer">
            <ZButton @click="cancelBrowserProfile">取消</ZButton
            ><ZButton type="primary" @click="saveBrowserProfile">保存</ZButton>
          </footer>
        </div>
      </div>
    </section>

    <section v-else-if="showEditor" class="editor-view">
      <header class="editor-header">
        <button class="icon-button" title="返回" @click="closeEditor">
          <ArrowLeft :size="17" />
        </button>
        <div>
          <h1>{{ isEditing ? '编辑入口' : '添加入口' }}</h1>
          <p>
            {{ isWebpage ? '输入关键字直接打开网页' : '把搜索词填入 URL 模板' }}
          </p>
        </div>
      </header>

      <div class="editor-content">
        <div class="form-field">
          <label>类型</label>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: formData.type === 'webpage' }"
              @click="formData.type = 'webpage'"
            >
              <Globe :size="15" />
              网页
            </button>
            <button
              type="button"
              :class="{ active: formData.type === 'search' }"
              @click="formData.type = 'search'"
            >
              <Search :size="15" />
              搜索
            </button>
          </div>
        </div>

        <div v-if="!isEditing && !isWebpage" class="form-field">
          <label>快捷添加</label>
          <div class="preset-list">
            <ZButton
              v-for="preset in searchPresets"
              :key="preset.name"
              size="small"
              :loading="quickSavingPreset === preset.name"
              :disabled="Boolean(quickSavingPreset)"
              @click="quickAddSearchPreset(preset)"
            >
              <template #icon>
                <Plus :size="14" />
              </template>
              {{ preset.name }}
            </ZButton>
          </div>
        </div>

        <div class="form-grid">
          <div class="form-field">
            <label>名称</label>
            <ZInput
              v-model="formData.name"
              clearable
              :placeholder="isWebpage ? '例如：ZTools 官网' : '例如：Google'"
            />
          </div>
          <div v-if="isWebpage" class="form-field">
            <label>匹配关键字</label>
            <ZInput v-model="formData.keyword" clearable placeholder="例如：官网" />
          </div>
        </div>

        <div class="form-field">
          <label>{{ isWebpage ? '网页 URL' : '搜索 URL 模板' }}</label>
          <ZInput
            v-model="formData.url"
            clearable
            :placeholder="
              isWebpage ? 'https://www.example.com' : 'https://www.google.com/search?q={q}'
            "
          />
          <p class="hint">
            {{ isWebpage ? '支持 http/https，未写协议会自动补全' : '使用 {q} 作为搜索词占位符' }}
          </p>
        </div>

        <div class="form-grid">
          <div class="form-field">
            <label>分组</label>
            <select v-model="formData.group" class="native-select">
              <option :value="null">默认</option>
              <option v-for="group in groups" :key="group" :value="group">
                {{ group }}
              </option>
            </select>
          </div>
          <div class="form-field browser-select-field">
            <label>打开方式</label>
            <div class="browser-select-row">
              <select v-model="formData.browserId" class="native-select">
                <option :value="null">系统默认浏览器打开</option>
                <option
                  v-for="profile in visibleBrowserProfiles"
                  :key="profile.id"
                  :value="profile.id"
                >
                  {{ profile.name }}
                </option>
              </select>
              <ZButton size="small" @click="openBrowserManager">管理浏览器</ZButton>
            </div>
            <p v-if="formData.browserId && !selectedBrowserProfile" class="hint warning-hint">
              未找到对应浏览器配置，已降级为系统默认浏览器
            </p>
          </div>
        </div>

        <div class="form-field">
          <label>图标</label>
          <div class="icon-editor">
            <div class="icon-preview">
              <img v-if="formData.icon" :src="formData.icon" alt="" />
              <Globe v-else :size="24" />
            </div>
            <ZButton
              size="small"
              :loading="fetchingIcon"
              :disabled="!formData.url"
              @click="fetchFavicon"
            >
              <template #icon>
                <Download :size="14" />
              </template>
              自动获取
            </ZButton>
            <ZButton size="small" @click="pickIconFile">
              <template #icon>
                <Upload :size="14" />
              </template>
              上传
            </ZButton>
            <input
              ref="iconFileInput"
              type="file"
              accept="image/*"
              class="file-input"
              @change="handleIconFileChange"
            />
          </div>
        </div>

        <label class="switch-row">
          <span>启用</span>
          <ZSwitch v-model="formData.enabled" size="medium" />
        </label>
      </div>

      <footer class="editor-footer">
        <ZButton @click="closeEditor">取消</ZButton>
        <ZButton type="primary" :loading="saving" @click="saveEngine">
          <template #icon>
            <Check :size="15" />
          </template>
          保存
        </ZButton>
      </footer>
    </section>
  </main>
</template>
