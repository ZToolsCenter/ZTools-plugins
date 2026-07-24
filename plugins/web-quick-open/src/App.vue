<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowLeft,
  Check,
  ChevronDown,
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

type NoticeType = 'success' | 'error' | 'info'
type SearchPreset = {
  name: string
  url: string
}

const FEATURE_PREFIX = 'quick-open-'
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
const showCreateMenu = ref(false)
let noticeTimer = 0

const formData = ref<WebSearchEngine>(createEmptyEngine())

const filteredEngines = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return engines.value

  return engines.value.filter((engine) => {
    return [engine.name, engine.url, engine.keyword || '', engine.type]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })
})

const isEditing = computed(() => Boolean(editingEngine.value))
const isWebpage = computed(() => formData.value.type === 'webpage')
const emptyText = computed(() => (query.value.trim() ? '没有匹配的网页快开' : '还没有网页快开'))
const existingSearchUrls = computed(
  () => new Set(engines.value.filter((engine) => engine.type === 'search').map((engine) => engine.url))
)

function createEmptyEngine(): WebSearchEngine {
  return {
    id: '',
    name: '',
    url: '',
    icon: '',
    enabled: true,
    type: 'webpage',
    keyword: ''
  }
}

function showNotice(type: NoticeType, text: string): void {
  notice.value = { type, text }
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = null
  }, 2400)
}

async function loadEngines(): Promise<void> {
  loading.value = true
  try {
    if (!window.webQuickOpen) {
      engines.value = []
      showNotice('info', '等待 ZTools 插件运行时')
      return
    }
    const result = await window.webQuickOpen.getAll()
    if (result.success && result.data) {
      engines.value = result.data
    } else {
      showNotice('error', result.error || '加载失败')
    }
  } catch (error) {
    console.error('[WebQuickOpen] load engines failed:', error)
    showNotice('error', '加载失败')
  } finally {
    loading.value = false
  }
}

function openAddEditor(): void {
  showCreateMenu.value = false
  editingEngine.value = null
  formData.value = createEmptyEngine()
  showEditor.value = true
}

function openEditEditor(engine: WebSearchEngine): void {
  editingEngine.value = engine
  formData.value = {
    ...engine,
    type: engine.type || 'search',
    keyword: engine.keyword || ''
  }
  showEditor.value = true
}

function closeEditor(): void {
  showEditor.value = false
  editingEngine.value = null
  formData.value = createEmptyEngine()
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
    console.error('[WebQuickOpen] toggle failed:', error)
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
    console.error('[WebQuickOpen] save failed:', error)
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
    console.error('[WebQuickOpen] quick add search preset failed:', error)
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
    console.error('[WebQuickOpen] delete failed:', error)
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
    console.error('[WebQuickOpen] fetch favicon failed:', error)
    showNotice('error', '获取图标失败')
  } finally {
    fetchingIcon.value = false
  }
}

function pickIconFile(): void {
  iconFileInput.value?.click()
}

function pickImportFile(): void {
  if (importing.value) return
  showCreateMenu.value = false
  importFileInput.value?.click()
}

function handleImportFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) return

  importing.value = true
  const reader = new FileReader()
  reader.onload = async () => {
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
          `已导入 ${result.importedCount} 条，跳过 ${result.skippedCount || 0} 条`
        )
        return
      }

      showNotice('info', '未导入新数据，可能已存在或格式无效')
    } catch (error) {
      console.error('[WebQuickOpen] import failed:', error)
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

function validateEngine(engine: WebSearchEngine): {
  success: true
  engine: WebSearchEngine
} | {
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
    keyword: engine.keyword?.trim() || ''
  }

  if (!nextEngine.name || !nextEngine.url) {
    return { success: false, error: '请填写名称和 URL' }
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

function getLaunchPayload(param: LaunchParam): string {
  return (
    param.payload ||
    param.inputState?.pastedText ||
    param.inputState?.searchQuery ||
    ''
  ).trim()
}

async function handlePluginEnter(param: LaunchParam): Promise<void> {
  const code = param?.code || ''
  if (!code.startsWith(FEATURE_PREFIX)) return

  try {
    const result = await window.webQuickOpen.getAll()
    const engine = result.data?.find((item) => `${FEATURE_PREFIX}${item.id}` === code)
    if (!engine) {
      window.ztools.showNotification?.('未找到网页快开配置')
      window.webQuickOpen.outPlugin()
      return
    }

    if (engine.type === 'search') {
      const payload = getLaunchPayload(param)
      if (!payload) {
        window.ztools.showNotification?.('缺少搜索关键词')
        window.webQuickOpen.outPlugin()
        return
      }
      window.webQuickOpen.openExternal(engine.url.replace('{q}', encodeURIComponent(payload)))
    } else {
      window.webQuickOpen.openExternal(engine.url)
    }

    window.webQuickOpen.hideMainWindow()
    window.webQuickOpen.outPlugin()
  } catch (error) {
    console.error('[WebQuickOpen] launch failed:', error)
    window.ztools.showNotification?.('网页快开启动失败')
    window.webQuickOpen.outPlugin()
  }
}

function openPreview(engine: WebSearchEngine): void {
  if (engine.type === 'search') {
    window.webQuickOpen.openExternal(engine.url.replace('{q}', encodeURIComponent('ztools')))
  } else {
    window.webQuickOpen.openExternal(engine.url)
  }
}

function handleDocumentClick(): void {
  showCreateMenu.value = false
}

onMounted(() => {
  loadEngines()
  document.addEventListener('click', handleDocumentClick)
  window.ztools?.onPluginEnter?.((param) => {
    void handlePluginEnter(param)
  })
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <main class="app-shell">
    <Transition name="notice">
      <div v-if="notice" class="notice" :class="`notice-${notice.type}`">
        {{ notice.text }}
      </div>
    </Transition>

    <section v-if="!showEditor" class="manager-view">
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
          <div class="split-create-group" @click.stop>
            <button class="split-create-main" type="button" @click="openAddEditor">
              <Plus :size="15" />
              <span>添加</span>
            </button>
            <button
              class="split-create-arrow"
              :class="{ active: showCreateMenu }"
              type="button"
              title="更多添加操作"
              @click.stop="showCreateMenu = !showCreateMenu"
            >
              <ChevronDown :size="15" />
            </button>
            <Transition name="dropdown">
              <div v-if="showCreateMenu" class="create-dropdown" @click.stop>
                <button class="create-dropdown-item" :disabled="importing" @click="pickImportFile">
                  <Download :size="15" />
                  <span>{{ importing ? '导入中...' : '导入旧数据' }}</span>
                </button>
              </div>
            </Transition>
          </div>
          <input
            ref="importFileInput"
            type="file"
            accept=".json,application/json"
            class="file-input"
            @change="handleImportFileChange"
          />
        </div>
      </div>

      <div class="content-area">
        <div v-if="loading" class="state-panel">加载中...</div>
        <div v-else-if="filteredEngines.length === 0" class="state-panel">
          <Search :size="26" />
          <span>{{ emptyText }}</span>
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
    </section>

    <section v-else class="editor-view">
      <header class="editor-header">
        <button class="icon-button" title="返回" @click="closeEditor">
          <ArrowLeft :size="17" />
        </button>
        <div>
          <h1>{{ isEditing ? '编辑入口' : '添加入口' }}</h1>
          <p>{{ isWebpage ? '输入关键字直接打开网页' : '把搜索词填入 URL 模板' }}</p>
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

        <div class="form-field">
          <label>图标</label>
          <div class="icon-editor">
            <div class="icon-preview">
              <img v-if="formData.icon" :src="formData.icon" alt="" />
              <Globe v-else :size="24" />
            </div>
            <ZButton size="small" :loading="fetchingIcon" :disabled="!formData.url" @click="fetchFavicon">
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
