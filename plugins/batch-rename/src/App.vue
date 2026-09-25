<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  appendFiles, applyBatchResults, clearFiles, createSession, extractFilePaths,
  removeFile, replaceTask, type ActiveModule, type LaunchParam, type RenameSession, type SortMode
} from './core/session'
import { createPreview, type PreviewItem } from './core/preview'
import { sortFiles } from './core/sort'
import { applyManualPaste } from './core/manual'
import { buildSmartMessages, parseSmartNames, SMART_BATCH_SIZE, SMART_FILE_LIMIT } from './core/smart'
import ReplacePanel from './components/ReplacePanel.vue'
import NumberPanel from './components/NumberPanel.vue'
import InsertPanel from './components/InsertPanel.vue'
import ManualPanel from './components/ManualPanel.vue'
import FileList from './components/FileList.vue'
import ActionBar from './components/ActionBar.vue'
import SmartPanel from './components/SmartPanel.vue'
import ModuleIcon from './components/ModuleIcon.vue'
import logoUrl from '../logo.png'

const session = ref<RenameSession>(createSession())
const resultView = ref<Map<string, RenameOutcome> | null>(null)
const rawPreview = computed<PreviewItem[]>(() => {
  if (!resultView.value) return createPreview(session.value)
  return sortFiles(session.value.files, session.value.sortMode).map((file) => {
    const result = resultView.value?.get(file.id)
    const errorMessage = result?.status === 'error' ? result.error || '执行失败' : undefined
    const targetName = result?.status === 'error' ? result.targetName : file.currentName
    return { ...file, targetName, status: result?.status === 'success' ? 'success' : result?.status === 'error' ? 'error' : 'unchanged', errorMessage }
  })
})
const checked = ref(new Map<string, RenameOutcome>())
const preview = computed<PreviewItem[]>(() => rawPreview.value.map((item) => {
  const result = checked.value.get(item.id)
  return item.status === 'error' || !result || result.targetName !== item.targetName ? item : {
    ...item,
    status: result.status === 'error' ? 'error' : item.status,
    errorMessage: result.error || item.errorMessage
  }
}))
const search = ref('')
const smartPrompt = ref('')
const smartModel = ref('')
type AvailableModel = ZToolsAiModel & { value?: string; providerLabel?: string }
const smartModels = ref<{ value: string; label: string; providerLabel?: string }[]>([])
const modelsLoading = ref(false)
const generating = ref(false)
const visiblePreview = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return term ? preview.value.filter((item) =>
    `${item.currentName} ${item.targetName} ${item.directory}`.toLocaleLowerCase().includes(term)) : preview.value
})
const counts = computed(() => ({
  ready: preview.value.filter((item) => item.status === 'ready').length,
  error: preview.value.filter((item) => item.status === 'error').length,
  unchanged: preview.value.filter((item) => item.status === 'unchanged').length
}))
const sortedFiles = computed(() => sortFiles(session.value.files, session.value.sortMode))
const busy = ref(false)
const loading = ref(false)
const metadataLoading = ref(0)
const toast = ref<{ text: string; tone: 'success' | 'warning' | 'error' } | null>(null)
const canUndo = ref(false)
const platform = window.renameService.platform
const metadataRequested = new Set<string>()
let taskVersion = 0
let previewVersion = 0
let pendingEnter: LaunchParam | null = null
let previewTimer: ReturnType<typeof setTimeout> | undefined
let pendingValidation: { version: number; items: PreviewItem[] } | null = null
let validationRunning = false
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(text: string, tone: 'success' | 'warning' | 'error' = 'success') {
  toast.value = { text, tone }
  if (toastTimer) clearTimeout(toastTimer)
  if (tone === 'success') toastTimer = setTimeout(() => { toast.value = null }, 4000)
}

function updateSession(patch: Partial<RenameSession>) {
  if (busy.value) return
  resultView.value = null
  session.value = { ...session.value, ...patch,
    smartNames: patch.files || patch.sortMode ? {} : patch.smartNames ?? session.value.smartNames }
}

async function loadSmartModels() {
  modelsLoading.value = true
  try {
    const models = await window.ztools.allAiModels() as AvailableModel[]
    smartModels.value = models.map((item) => ({
      value: item.value || item.id, label: item.label, providerLabel: item.providerLabel
    })).filter((item) => item.value && item.label)
    if (!smartModels.value.some((item) => item.value === smartModel.value)) smartModel.value = smartModels.value[0]?.value || ''
    if (!smartModels.value.length) showToast('ZTools 中没有可用的 AI 模型，请先在 ZTools 设置中配置', 'warning')
  } catch (error) {
    smartModels.value = []
    smartModel.value = ''
    showToast(`读取 ZTools 模型失败：${String(error)}`, 'error')
  } finally { modelsLoading.value = false }
}

async function generateSmartPreview() {
  if (busy.value || loading.value || !smartPrompt.value.trim() || !smartModel.value || !session.value.files.length) return
  const files = sortedFiles.value
  if (files.length > SMART_FILE_LIMIT) {
    showToast(`智能重命名每次最多处理 ${SMART_FILE_LIMIT} 个文件，请减少列表数量`, 'warning')
    return
  }
  busy.value = true
  generating.value = true
  resultView.value = null
  updateSmartNames({})
  const names: Record<string, string> = {}
  try {
    for (let index = 0; index < files.length; index += SMART_BATCH_SIZE) {
      const batch = files.slice(index, index + SMART_BATCH_SIZE)
      const response = await window.ztools.ai({ model: smartModel.value, messages: buildSmartMessages(batch, smartPrompt.value) })
      Object.assign(names, parseSmartNames(response.content, batch))
    }
    updateSmartNames(names)
    showToast(`已生成 ${files.length} 个文件的预览，请检查后执行`)
  } catch (error) {
    showToast(`生成预览失败：${String(error)}`, 'error')
  } finally {
    generating.value = false
    finishOperation()
  }
}

function updateSmartNames(names: Record<string, string>) {
  session.value = { ...session.value, smartNames: names }
}

function summarize(result: RenameBatchResult, action: string) {
  const successful = result.results.filter((item) => item.status === 'success').length
  const failed = result.results.filter((item) => item.status === 'error').length
  const warning = result.results.find((item) => item.status === 'success' && item.error)?.error
  if (action === '执行成功' && !failed) return `执行成功：共 ${successful} 个${warning ? `；${warning}` : ''}`
  return `${action}：成功 ${successful} 个，失败 ${failed} 个${warning ? `；${warning}` : ''}`
}

function startNewTask() {
  ++taskVersion
  window.renameService.resetTask()
  session.value = createSession()
  checked.value = new Map()
  resultView.value = null
  search.value = ''
  smartPrompt.value = ''
  metadataRequested.clear()
  canUndo.value = false
  toast.value = null
}

async function handleEnter(param: LaunchParam) {
  const paths = extractFilePaths(param, platform)
  if (paths === null) return
  if (busy.value) { pendingEnter = param; return }
  startNewTask()
  const version = taskVersion
  if (!paths.length) { showToast('未收到有效的文件路径', 'warning'); return }
  loading.value = true
  try {
    const infos = await window.renameService.readFileInfos(paths)
    if (version === taskVersion) session.value = replaceTask(infos, platform)
  } catch (error) {
    if (version === taskVersion) showToast(`读取文件失败：${String(error)}`, 'error')
  } finally {
    if (version === taskVersion) loading.value = false
  }
}

async function addPaths(paths: string[]) {
  if (!paths.length) return
  const version = taskVersion
  loading.value = true
  try {
    const infos = await window.renameService.readFileInfos(paths)
    if (version === taskVersion) {
      resultView.value = null
      const previousCount = session.value.files.length
      session.value = appendFiles(session.value, infos, platform)
      const added = session.value.files.length - previousCount
      showToast(added ? `已添加 ${added} 个文件` : '没有新增文件', added ? 'success' : 'warning')
    }
  } catch (error) {
    if (version === taskVersion) showToast(`添加文件失败：${String(error)}`, 'error')
  } finally {
    if (version === taskVersion) loading.value = false
  }
}

function selectFiles() {
  const paths = window.ztools.showOpenDialog({ title: '添加文件', properties: ['openFile', 'multiSelections'] })
  if (paths?.length) void addPaths(paths)
}

async function selectFolder() {
  const selected = window.ztools.showOpenDialog({ title: '读取文件夹', properties: ['openDirectory'] })
  if (!selected?.length) return
  const version = taskVersion
  loading.value = true
  try {
    const scanned = await window.renameService.scanDirectory(selected[0])
    if (version !== taskVersion) return
    await addPaths(scanned.paths)
    if (!scanned.paths.length && !scanned.errors.length) showToast('扫描完成，未发现文件', 'warning')
    if (scanned.errors.length) showToast(`扫描完成，${scanned.errors.length} 处未读取：${scanned.errors[0].message}`, 'warning')
  } catch (error) {
    if (version === taskVersion) showToast(`读取文件夹失败：${String(error)}`, 'error')
  } finally {
    if (version === taskVersion) loading.value = false
  }
}

function clear() {
  if (busy.value) return
  ++taskVersion
  window.renameService.resetTask()
  session.value = { ...clearFiles(session.value), manualNames: {} }
  metadataRequested.clear()
  checked.value = new Map()
  resultView.value = null
  search.value = ''
  canUndo.value = false
  loading.value = false
  showToast('已清空文件列表', 'success')
}

function remove(id: string) {
  if (busy.value) return
  resultView.value = null
  session.value = removeFile(session.value, id)
}

function editManualName(id: string, name: string) {
  updateSession({ manualNames: { ...session.value.manualNames, [id]: name } })
}

function pasteManual(text: string) {
  const result = applyManualPaste(sortedFiles.value, session.value.manualNames, text)
  updateSession({ manualNames: result.names })
  if (result.ignoredCount) showToast(`已忽略 ${result.ignoredCount} 行多余内容`, 'warning')
}

function setModule(activeModule: ActiveModule) {
  toast.value = null
  updateSession({ activeModule })
  if (activeModule === 'smart') void loadSmartModels()
}

watch([smartPrompt, smartModel], () => {
  if (Object.keys(session.value.smartNames).length) updateSmartNames({})
}, { flush: 'sync' })

async function loadMetadata(kind: 'dimensions' | 'capturedAt', version: number) {
  const files = session.value.files.filter((file) => {
    const key = `${file.id}:${kind}`
    if (metadataRequested.has(key)) return false
    metadataRequested.add(key)
    return true
  })
  if (!files.length) return
  metadataLoading.value += 1
  try {
    for (let index = 0; index < files.length; index += 16) {
      const batch = files.slice(index, index + 16)
      const results = await Promise.all(batch.map((file) => window.renameService.readMetadata(file.sourcePath, kind)
        .catch((error) => ({ error: String(error) }))))
      if (version !== taskVersion) return
      const byId = new Map(batch.map((file, offset) => [file.id, results[offset]]))
      updateSession({ files: session.value.files.map((file) => {
        const result = byId.get(file.id)
        return result ? { ...file, metadata: { ...file.metadata, ...result } } : file
      }) })
    }
  } finally {
    metadataLoading.value -= 1
  }
}

watch(() => [session.value.activeModule, session.value.insertRule.kind, session.value.insertRule.info, session.value.files], () => {
  if (resultView.value) return
  const rule = session.value.insertRule
  if (session.value.activeModule !== 'insert' || rule.kind !== 'info') return
  if (rule.info !== 'dimensions' && rule.info !== 'captured') return
  void loadMetadata(rule.info === 'dimensions' ? 'dimensions' : 'capturedAt', taskVersion)
})

async function processValidation() {
  if (validationRunning) return
  validationRunning = true
  try {
    while (pendingValidation) {
      const { version, items } = pendingValidation
      pendingValidation = null
      try {
        const result = await window.renameService.validatePlan(items.map((item) => ({
          id: item.id, sourcePath: item.sourcePath, targetName: item.targetName
        })))
        if (version === previewVersion) checked.value = new Map(result.map((item) => [item.id, item]))
      } catch (error) {
        if (version === previewVersion) showToast(`预检失败：${String(error)}`, 'error')
      }
    }
  } finally { validationRunning = false }
}

watch(rawPreview, (items) => {
  const version = ++previewVersion
  checked.value = new Map()
  if (previewTimer) clearTimeout(previewTimer)
  if (!items.length || resultView.value ||
    (session.value.activeModule === 'smart' && !Object.keys(session.value.smartNames).length)) return
  previewTimer = setTimeout(() => {
    pendingValidation = { version, items }
    void processValidation()
  }, 180)
})

async function execute() {
  if (busy.value || loading.value || metadataLoading.value || !counts.value.ready) return
  busy.value = true
  const localErrors = rawPreview.value.filter((item) => item.status === 'error')
  try {
    const intents = rawPreview.value.filter((item) => item.status !== 'error').map((item) => ({
      id: item.id, sourcePath: item.sourcePath, targetName: item.targetName
    }))
    const result = await window.renameService.executePlan(intents)
    result.results.push(...localErrors.map((item) => ({
      id: item.id, sourcePath: item.sourcePath, targetName: item.targetName,
      targetPath: '', actualPath: item.sourcePath, status: 'error' as const,
      error: item.errorMessage || '预览错误'
    })))
    session.value = { ...applyBatchResults(session.value, result.results, platform), smartNames: {} }
    resultView.value = new Map(result.results.map((item) => [item.id, item]))
    search.value = ''
    metadataRequested.clear()
    canUndo.value = result.canUndo
    const successful = result.results.filter((item) => item.status === 'success').length
    const failed = result.results.filter((item) => item.status === 'error').length
    showToast(summarize(result, successful && !failed ? '执行成功' : '重命名完成'),
      failed ? successful ? 'warning' : 'error' : 'success')
  } catch (error) { showToast(`执行失败：${String(error)}`, 'error') }
  finally { finishOperation() }
}

async function undo() {
  if (busy.value || loading.value || metadataLoading.value || !canUndo.value) return
  busy.value = true
  try {
    const result = await window.renameService.undo()
    session.value = { ...applyBatchResults(session.value, result.results, platform), smartNames: {} }
    resultView.value = new Map(result.results.map((item) => [item.id, item]))
    search.value = ''
    metadataRequested.clear()
    canUndo.value = result.canUndo
    showToast(summarize(result, '撤销完成'), result.results.some((item) => item.status === 'error') ? 'warning' : 'success')
  } catch (error) { showToast(`撤销失败：${String(error)}`, 'error') }
  finally { finishOperation() }
}

function finishOperation() {
  busy.value = false
  if (pendingEnter) {
    const param = pendingEnter
    pendingEnter = null
    void handleEnter(param)
  }
}

onMounted(() => window.ztools.onPluginEnter(handleEnter))
</script>

<template>
  <main class="app-shell">
    <header class="window-header">
      <div class="window-brand">
        <img class="brand-icon" :src="logoUrl" alt="">
        <strong>文件智能重命名</strong>
      </div>
      <label class="window-search">
        <span aria-hidden="true">⌕</span>
        <input v-model="search" type="search" aria-label="筛选文件列表" placeholder="搜索或过滤当前文件...">
      </label>
    </header>
    <nav class="module-tabs" aria-label="重命名功能">
      <button v-for="item in ([['replace', '查找替换'], ['number', '自动编号'], ['smart', '智能重命名'], ['insert', '插入内容'], ['manual', '手动编辑']] as const)"
        :key="item[0]" type="button" :class="{ active: session.activeModule === item[0] }"
        :aria-current="session.activeModule === item[0] ? 'page' : undefined"
        :disabled="busy" @click="setModule(item[0])"><ModuleIcon :module="item[0]" />{{ item[1] }}</button>
    </nav>
    <fieldset class="rule-panel" :disabled="busy">
      <ReplacePanel v-if="session.activeModule === 'replace'" :model-value="session.replaceRules" @update:model-value="updateSession({ replaceRules: $event })" />
      <SmartPanel v-else-if="session.activeModule === 'smart'" v-model:prompt="smartPrompt" v-model:model="smartModel"
        :models="smartModels" :loading-models="modelsLoading" :generating="generating"
        :can-generate="!busy && !loading && !!smartPrompt.trim() && !!smartModel && !!session.files.length"
        @generate="generateSmartPreview" @refresh-models="loadSmartModels" />
      <NumberPanel v-else-if="session.activeModule === 'number'" :model-value="session.numberRule" @update:model-value="updateSession({ numberRule: $event })" />
      <InsertPanel v-else-if="session.activeModule === 'insert'" :model-value="session.insertRule" @update:model-value="updateSession({ insertRule: $event })" />
      <ManualPanel v-else />
    </fieldset>
    <p v-if="search" class="filter-notice">显示 {{ visiblePreview.length }} / 共 {{ preview.length }} 个文件；执行范围为全部文件</p>
    <FileList :items="visiblePreview" :loading="loading || metadataLoading > 0" :busy="busy"
      :empty-message="search && session.files.length ? '没有匹配的文件，请调整搜索条件' : '列表为空，请从底部操作栏添加文件'"
      :manual="session.activeModule === 'manual'"
      @remove="remove" @edit="editManualName" @paste="pasteManual"
      @show-error="showToast($event, 'error')" />
    <ActionBar :count="session.files.length" :ready="counts.ready" :error="counts.error" :unchanged="counts.unchanged"
      :sort-mode="session.sortMode" :can-undo="canUndo" :can-execute="counts.ready > 0"
      :busy="busy || loading || metadataLoading > 0" @select-files="selectFiles" @select-folder="selectFolder"
      @clear="clear" @sort="updateSession({ sortMode: $event as SortMode })"
      @execute="execute" @undo="undo" />
    <div v-if="toast" class="toast-alert" :class="`is-${toast.tone}`" role="status" aria-live="polite">
      <span class="toast-icon" aria-hidden="true">{{ toast.tone === 'success' ? '✓' : toast.tone === 'warning' ? '!' : '×' }}</span>
      <span>{{ toast.text }}</span>
      <button type="button" aria-label="关闭提示" @click="toast = null">×</button>
    </div>
  </main>
</template>
