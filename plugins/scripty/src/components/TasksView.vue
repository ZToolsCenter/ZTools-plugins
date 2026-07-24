<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SchedulePreview, ScriptSummary, TaskDraft, TaskSummary } from '../types/api'
import type { ScriptLanguage } from '../types/domain'

const props = defineProps<{
  requestConfirmation: (options: {
    title: string
    message: string
    type: 'danger'
    confirmText: string
    cancelText: string
  }) => Promise<boolean>
}>()

const emit = defineEmits<{
  (event: 'feedback', type: 'success' | 'error', message: string): void
}>()

const search = ref('')
const enabledFilter = ref<string>('all')
const readinessFilter = ref<string>('all')
const tasks = ref<TaskSummary[]>([])
const scripts = ref<ScriptSummary[]>([])
const loading = ref(false)
const saving = ref(false)
const changingTaskIds = ref(new Set<string>())
const startingTaskIds = ref(new Set<string>())
const drawerVisible = ref(false)
const editingTaskId = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const argsText = ref('')
const timeoutSeconds = ref<number | string>('')
const form = ref<TaskDraft>(createEmptyDraft())
type ScheduleMode = 'manual' | 'preset' | 'custom'
const scheduleMode = ref<ScheduleMode>('manual')
const selectedSchedulePreset = ref('0 * * * *')
const schedulePreview = ref<SchedulePreview | null>(null)
const schedulePreviewLoading = ref(false)
const schedulePreviewError = ref('')
let schedulePreviewTimer: ReturnType<typeof setTimeout> | null = null
let schedulePreviewRequest = 0

const schedulePresets = [
  { label: '每 5 分钟', value: '*/5 * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '工作日 09:00', value: '0 9 * * 1-5' },
  { label: '每周一 09:00', value: '0 9 * * 1' }
]
const scheduleModeOptions: Array<{ label: string; value: ScheduleMode }> = [
  { label: '仅手动', value: 'manual' },
  { label: '周期预设', value: 'preset' },
  { label: '自定义 Cron', value: 'custom' }
]
const scheduleTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short'
})

const enabledOptions = [
  { label: '全部状态', value: 'all' },
  { label: '已启用', value: 'enabled' },
  { label: '已禁用', value: 'disabled' }
]
const readinessOptions = [
  { label: '全部可用性', value: 'all' },
  { label: '可运行', value: 'ready' },
  { label: '脚本缺失', value: 'script_missing' },
  { label: '解释器不可用', value: 'interpreter_unavailable' },
  { label: 'Cron 无效', value: 'invalid_cron' },
  { label: '工作目录无效', value: 'invalid_working_directory' }
]
const readinessLabels: Record<TaskSummary['readiness'], string> = {
  ready: '可运行',
  script_missing: '脚本缺失',
  interpreter_unavailable: '解释器不可用',
  invalid_cron: 'Cron 无效',
  invalid_working_directory: '工作目录无效'
}
const readinessGuidance: Record<Exclude<TaskSummary['readiness'], 'ready'>, { message: string; action: string }> = {
  script_missing: { message: '托管源码文件不存在，请重新创建脚本或为任务选择其他脚本。', action: '选择脚本' },
  interpreter_unavailable: { message: '未找到该语言的解释器，请确认已安装并可从终端调用。', action: '重新检测' },
  invalid_cron: { message: 'Cron 不是有效的五段表达式，请修改计划。', action: '修改 Cron' },
  invalid_working_directory: { message: '工作目录不存在或不是目录，请修改或留空。', action: '修改目录' }
}
const defaultExecutables: Record<ScriptLanguage, string> = {
  javascript: 'node',
  python: 'python',
  powershell: 'powershell',
  shell: 'sh'
}
/** Extensions Scripty can execute; mirrors the preload RUNNABLE_SCRIPT_EXTENSIONS allowlist. */
const RUNNABLE_SCRIPT_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'py', 'ps1', 'sh'])
/** True when a script's path ends in a runnable extension, so it can back a task. */
function isRunnableScript(script: ScriptSummary): boolean {
  const ext = script.relativePath.split('.').pop()?.toLocaleLowerCase() ?? ''
  return script.relativePath.includes('.') && RUNNABLE_SCRIPT_EXTENSIONS.has(ext)
}
// 新建脚本已放开扩展名限制,任务下拉只展示扩展名受支持(可执行)的脚本。
const runnableScripts = computed(() => scripts.value.filter(isRunnableScript))
const scriptOptions = computed(() => runnableScripts.value.map(script => ({ label: script.name, value: script.id })))
const filteredTasks = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return tasks.value.filter((task) => {
    if (keyword && !`${task.name} ${task.note} ${task.scriptName}`.toLocaleLowerCase().includes(keyword)) return false
    if (enabledFilter.value === 'enabled' && !task.enabled) return false
    if (enabledFilter.value === 'disabled' && task.enabled) return false
    if (readinessFilter.value !== 'all' && task.readiness !== readinessFilter.value) return false
    return true
  })
})

/** Clears pending schedule work and invalidates previews that may resolve after the form changes. */
function resetSchedulePreview() {
  if (schedulePreviewTimer !== null) clearTimeout(schedulePreviewTimer)
  schedulePreviewTimer = null
  schedulePreviewRequest += 1
  schedulePreview.value = null
  schedulePreviewLoading.value = false
  schedulePreviewError.value = ''
}

/** Returns the known preset matching a persisted expression, if one exists. */
function findSchedulePreset(cron: string | null) {
  return schedulePresets.find(preset => preset.value === cron) ?? null
}

/** Calls preload for five future instants and ignores responses made stale by later form changes. */
async function requestSchedulePreview(cron: string) {
  const api = window.scripty?.tasks
  if (!api || !drawerVisible.value || scheduleMode.value === 'manual') return
  const normalized = cron.trim()
  if (!normalized) {
    schedulePreview.value = null
    schedulePreviewLoading.value = false
    schedulePreviewError.value = '请输入有效的五段 Cron 表达式'
    return
  }
  const request = ++schedulePreviewRequest
  schedulePreviewLoading.value = true
  schedulePreview.value = null
  schedulePreviewError.value = ''
  const result = await api.previewSchedule(normalized)
  if (request !== schedulePreviewRequest || !drawerVisible.value || form.value.cron?.trim() !== normalized) return
  schedulePreviewLoading.value = false
  if (result.ok === false) {
    schedulePreviewError.value = result.error.message
    return
  }
  schedulePreview.value = result.data
}

/** Debounces custom Cron parsing while immediately clearing stale results and errors. */
function scheduleCustomPreview() {
  if (scheduleMode.value !== 'custom') return
  if (schedulePreviewTimer !== null) clearTimeout(schedulePreviewTimer)
  schedulePreviewTimer = null
  schedulePreviewRequest += 1
  schedulePreview.value = null
  schedulePreviewLoading.value = false
  schedulePreviewError.value = ''
  delete fieldErrors.value.cron
  const cron = form.value.cron?.trim() ?? ''
  if (!cron) {
    schedulePreviewError.value = '请输入有效的五段 Cron 表达式'
    return
  }
  schedulePreviewTimer = setTimeout(() => {
    schedulePreviewTimer = null
    requestSchedulePreview(cron)
  }, 300)
}

/** Restores manual, preset, or custom UI state from one draft without persisting UI-only fields. */
function hydrateScheduleState(cron: string | null) {
  resetSchedulePreview()
  const preset = findSchedulePreset(cron)
  if (!cron) {
    scheduleMode.value = 'manual'
    return
  }
  if (preset) {
    scheduleMode.value = 'preset'
    selectedSchedulePreset.value = preset.value
  } else {
    scheduleMode.value = 'custom'
  }
  requestSchedulePreview(cron)
}

/** Applies a schedule mode while preserving only valid Cron domain values in the task draft. */
function changeScheduleMode(mode: string | number | boolean) {
  if (!['manual', 'preset', 'custom'].includes(String(mode))) return
  resetSchedulePreview()
  scheduleMode.value = String(mode) as ScheduleMode
  delete fieldErrors.value.cron
  if (scheduleMode.value === 'manual') {
    form.value.cron = null
  } else if (scheduleMode.value === 'preset') {
    form.value.cron = selectedSchedulePreset.value
    requestSchedulePreview(selectedSchedulePreset.value)
  } else {
    form.value.cron = ''
    schedulePreviewError.value = '请输入有效的五段 Cron 表达式'
  }
}

/** Writes a selected preset into the canonical Cron field and previews it immediately. */
function selectSchedulePreset(value: string | number | Array<string | number> | null) {
  if (typeof value !== 'string' || !findSchedulePreset(value)) return
  selectedSchedulePreset.value = value
  form.value.cron = value
  resetSchedulePreview()
  requestSchedulePreview(value)
}

/** Formats an ISO schedule instant for display in the current device locale and time zone. */
function formatScheduleTime(iso: string) {
  return scheduleTimeFormatter.format(new Date(iso))
}

/** Closes the task drawer and prevents its pending preview from updating later forms. */
function closeTaskDrawer() {
  resetSchedulePreview()
  drawerVisible.value = false
}

/** Cleans up preview work when the drawer closes through its own close or overlay controls. */
function handleDrawerVisibility(visible: boolean) {
  if (!visible) resetSchedulePreview()
}

/** Creates an isolated task draft with safe defaults; callers may then hydrate it for editing. */
function createEmptyDraft(): TaskDraft {
  return {
    name: '',
    note: '',
    scriptId: '',
    interpreter: { kind: 'javascript', executable: 'node' },
    args: [],
    workingDirectory: null,
    cron: null,
    timeoutMs: null,
    enabled: false,
    concurrency: { policy: 'forbid', limit: 1 }
  }
}

/** Refreshes task and script summaries so interpreter readiness is recalculated by preload. */
async function loadData() {
  if (!window.scripty?.tasks) return
  loading.value = true
  const [taskResult, scriptResult] = await Promise.all([
    window.scripty.tasks.list(),
    window.scripty.scripts?.list()
  ])
  loading.value = false
  if (taskResult.ok === true) tasks.value = taskResult.data
  else emit('feedback', 'error', taskResult.error.message)
  if (scriptResult?.ok === true) scripts.value = scriptResult.data
  else if (scriptResult?.ok === false) emit('feedback', 'error', scriptResult.error.message)
}

/** Opens a blank creation form and preselects the first managed script when one exists. */
function openCreateDrawer() {
  editingTaskId.value = null
  fieldErrors.value = {}
  form.value = createEmptyDraft()
  argsText.value = ''
  timeoutSeconds.value = ''
  hydrateScheduleState(null)
  if (runnableScripts.value[0]) selectScript(runnableScripts.value[0].id)
  drawerVisible.value = true
}

/** Opens the edit form from a complete task summary without altering persisted data until save. */
function openEditDrawer(task: TaskSummary) {
  editingTaskId.value = task.id
  fieldErrors.value = {}
  form.value = {
    name: task.name,
    note: task.note,
    scriptId: task.scriptId,
    interpreter: { ...task.interpreter },
    args: task.args.slice(),
    workingDirectory: task.workingDirectory,
    cron: task.cron,
    timeoutMs: task.timeoutMs,
    enabled: task.enabled,
    concurrency: { ...task.concurrency }
  }
  argsText.value = task.args.join('\n')
  timeoutSeconds.value = task.timeoutMs === null ? '' : task.timeoutMs / 1000
  drawerVisible.value = true
  hydrateScheduleState(task.cron)
}

/** Updates the selected script and aligns the default interpreter kind and executable with its language. */
function selectScript(scriptId: string | number | Array<string | number> | null) {
  if (typeof scriptId !== 'string') return
  const script = scripts.value.find(item => item.id === scriptId)
  form.value.scriptId = scriptId
  if (script) {
    form.value.interpreter.kind = script.language
    form.value.interpreter.executable = defaultExecutables[script.language]
  }
}

/** Splits one argument per line, preserving spaces inside each argument and dropping only empty lines. */
function parseArguments() {
  return argsText.value.split(/\r?\n/).filter(argument => argument.length > 0)
}

/** Converts optional text form fields into the null representation required by the domain model. */
function normalizeDraft(): TaskDraft {
  const seconds = timeoutSeconds.value === '' ? null : Number(timeoutSeconds.value)
  return {
    ...form.value,
    args: parseArguments(),
    timeoutMs: seconds === null ? null : seconds * 1000,
    name: form.value.name.trim(),
    note: form.value.note.trim(),
    interpreter: { ...form.value.interpreter, executable: form.value.interpreter.executable.trim() },
    cron: form.value.cron?.trim() || null,
    workingDirectory: form.value.workingDirectory?.trim() || null
  }
}

/** Creates or updates the current task and refreshes the list only after preload confirms persistence. */
async function saveTask() {
  if (!window.scripty?.tasks || saving.value) return
  saving.value = true
  fieldErrors.value = {}
  const draft = normalizeDraft()
  const validation = await window.scripty.tasks.validate(draft)
  if (validation.ok === false) {
    saving.value = false
    fieldErrors.value = validation.error.fieldErrors ?? {}
    emit('feedback', 'error', validation.error.message)
    return
  }
  if (!validation.data.valid) {
    saving.value = false
    emit('feedback', 'error', `任务当前不可运行：${readinessLabels[validation.data.readiness]}`)
    return
  }
  const result = editingTaskId.value
    ? await window.scripty.tasks.update(editingTaskId.value, draft)
    : await window.scripty.tasks.create(draft)
  saving.value = false
  if (result.ok === false) {
    fieldErrors.value = result.error.fieldErrors ?? {}
    emit('feedback', 'error', result.error.message)
    return
  }
  closeTaskDrawer()
  await loadData()
  emit('feedback', 'success', editingTaskId.value ? '任务已更新' : '任务已创建')
}

/** Duplicates a task as a disabled copy so the new record cannot begin scheduling unexpectedly. */
async function duplicateTask(task: TaskSummary) {
  if (!window.scripty?.tasks) return
  const result = await window.scripty.tasks.duplicate(task.id)
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  await loadData()
  emit('feedback', 'success', `已复制“${task.name}”并保持禁用`)
}

/** Requires explicit confirmation before permanently removing a task configuration. */
async function removeTask(task: TaskSummary) {
  if (!window.scripty?.tasks) return
  const accepted = await props.requestConfirmation({
    title: '删除任务',
    message: `确定删除“${task.name}”？此操作不会删除托管脚本。`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!accepted) return
  const result = await window.scripty.tasks.remove(task.id)
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  await loadData()
  emit('feedback', 'success', `已删除“${task.name}”`)
}

/** Persists an enable-state change and retains the prior row when preload rejects it. */
async function changeEnabled(task: TaskSummary, enabled: boolean) {
  if (!window.scripty?.tasks || changingTaskIds.value.has(task.id)) return
  changingTaskIds.value = new Set(changingTaskIds.value).add(task.id)
  const result = await window.scripty.tasks.setEnabled(task.id, enabled)
  const nextChangingIds = new Set(changingTaskIds.value)
  nextChangingIds.delete(task.id)
  changingTaskIds.value = nextChangingIds
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  const index = tasks.value.findIndex(item => item.id === task.id)
  if (index >= 0) tasks.value.splice(index, 1, result.data)
  emit('feedback', 'success', enabled ? `已启用“${task.name}”` : `已禁用“${task.name}”`)
}

/** Starts a ready task by ID; execution details remain entirely inside preload. */
async function runTask(task: TaskSummary) {
  const api = window.scripty?.runs
  if (!api || startingTaskIds.value.has(task.id)) return
  startingTaskIds.value = new Set(startingTaskIds.value).add(task.id)
  const result = await api.start(task.id)
  const next = new Set(startingTaskIds.value)
  next.delete(task.id)
  startingTaskIds.value = next
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  emit('feedback', 'success', `已启动“${task.name}”`)
}

/** Rechecks auto-discovered interpreter readiness; other issues open the relevant task editor field. */
async function resolveTaskIssue(task: TaskSummary) {
  if (task.readiness === 'interpreter_unavailable') {
    await loadData()
    return
  }
  openEditDrawer(task)
  const selectorByReadiness: Partial<Record<TaskSummary['readiness'], string>> = {
    script_missing: '[role="combobox"]',
    invalid_cron: '[data-schedule-custom] input, [data-schedule-group] input',
    invalid_working_directory: 'input[placeholder="留空时使用托管脚本目录"]'
  }
  requestAnimationFrame(() => {
    const selector = selectorByReadiness[task.readiness]
    if (selector) document.querySelector<HTMLElement>(`.task-form ${selector}`)?.focus()
  })
}

/** Maps readiness to the ztools-ui semantic color used by each task row. */
function getReadinessTagType(readiness: TaskSummary['readiness']) {
  return readiness === 'ready' ? 'success' : 'warning'
}

onMounted(loadData)
onBeforeUnmount(resetSchedulePreview)
watch(
  () => form.value.cron,
  () => scheduleCustomPreview()
)
</script>

<template>
  <section class="tasks-view" aria-labelledby="tasks-heading">
    <ZDrawer v-model:show="drawerVisible" placement="right" width="440" trap-focus auto-focus @update:show="handleDrawerVisibility">
      <ZDrawerContent :title="editingTaskId ? '编辑任务' : '创建任务'" closable>
        <form id="task-form" class="task-form" @submit.prevent="saveTask">
          <label>
            <span>任务名称</span>
            <ZInput v-model="form.name" placeholder="例如：每日备份" :status="fieldErrors.name ? 'error' : undefined" :message="fieldErrors.name" />
          </label>
          <label>
            <span>托管脚本</span>
            <ZSelect
              :model-value="form.scriptId"
              :options="scriptOptions"
              placeholder="选择脚本"
              :status="fieldErrors.scriptId ? 'error' : undefined"
              :message="fieldErrors.scriptId"
              @update:model-value="selectScript"
            />
          </label>
          <label>
            <span>参数（每行一项，空格不会被拆分）</span>
            <ZInput v-model="argsText" type="textarea" placeholder="--output&#10;包含 空格 的参数" :status="fieldErrors.args ? 'error' : undefined" :message="fieldErrors.args" />
          </label>
          <label>
            <span>工作目录（可选）</span>
            <ZInput v-model="form.workingDirectory" placeholder="留空时使用托管脚本目录" :status="fieldErrors.workingDirectory ? 'error' : undefined" :message="fieldErrors.workingDirectory" />
          </label>
          <label>
            <span>超时秒数（可选，1 - 86400）</span>
            <ZInput v-model="timeoutSeconds" type="number" placeholder="使用全局默认超时" :status="fieldErrors.timeoutMs ? 'error' : undefined" :message="fieldErrors.timeoutMs" />
          </label>
          <fieldset class="schedule-field" data-schedule-group>
            <legend>运行周期</legend>
            <div class="schedule-modes">
              <ZRadio
                v-for="option in scheduleModeOptions"
                :key="option.value"
                :model-value="scheduleMode"
                :value="option.value"
                name="schedule-mode"
                @update:model-value="changeScheduleMode"
              >
                {{ option.label }}
              </ZRadio>
            </div>
            <label v-if="scheduleMode === 'preset'">
              <span>常用周期</span>
              <ZSelect
                :model-value="selectedSchedulePreset"
                :options="schedulePresets"
                aria-label="常用周期"
                @update:model-value="selectSchedulePreset"
              />
            </label>
            <label v-else-if="scheduleMode === 'custom'" data-schedule-custom>
              <span>Cron（五段）</span>
              <ZInput
                v-model="form.cron"
                placeholder="0 2 * * *"
                :status="fieldErrors.cron || schedulePreviewError ? 'error' : undefined"
                :message="fieldErrors.cron || schedulePreviewError"
              />
            </label>
            <div v-if="scheduleMode !== 'manual'" class="schedule-preview" aria-live="polite">
              <p v-if="schedulePreviewLoading" role="status">正在计算下次运行时间…</p>
              <p v-else-if="schedulePreviewError" class="schedule-preview__error" role="alert">{{ schedulePreviewError }}</p>
              <template v-else-if="schedulePreview">
                <div class="schedule-preview__heading">
                  <strong>下次运行时间</strong>
                  <ZTag type="info" size="small">本机时区</ZTag>
                </div>
                <ol>
                  <li v-for="instant in schedulePreview.nextRuns" :key="instant">
                    <time :datetime="instant">{{ formatScheduleTime(instant) }}</time>
                  </li>
                </ol>
              </template>
            </div>
          </fieldset>
          <label>
            <span>备注</span>
            <ZInput v-model="form.note" type="textarea" maxlength="500" show-word-limit />
          </label>
          <div class="task-form__switch">
            <span>创建或保存后启用调度</span>
            <ZSwitch v-model="form.enabled" />
          </div>
        </form>
        <template #footer>
          <div class="drawer-actions">
            <ZButton type="default" @click="closeTaskDrawer">取消</ZButton>
            <ZButton type="primary" :loading="saving" :disabled="scripts.length === 0" @click="saveTask">保存任务</ZButton>
          </div>
        </template>
      </ZDrawerContent>
    </ZDrawer>

    <div class="view-toolbar">
      <div class="section-heading">
        <div>
          <h2 id="tasks-heading">任务库</h2>
        </div>
        <div class="section-heading__actions">
          <ZButton type="primary" :disabled="scripts.length === 0" @click="openCreateDrawer">创建任务</ZButton>
        </div>
      </div>

      <div class="task-filters" aria-label="任务筛选">
        <ZInput v-model="search" type="search" placeholder="搜索任务、脚本" clearable />
        <ZSelect v-model="enabledFilter" :options="enabledOptions" aria-label="启用状态" />
        <ZSelect v-model="readinessFilter" :options="readinessOptions" aria-label="可运行状态" />
      </div>
    </div>

    <div class="view-body">
    <p v-if="scripts.length === 0 && !loading" class="task-message" role="status">请先创建托管脚本，再创建任务。</p>
    <p v-else-if="loading" class="task-message" role="status">正在加载任务…</p>
    <div v-else-if="tasks.length === 0" class="empty-state" aria-live="polite">
      <div class="empty-state__mark" aria-hidden="true">T</div>
      <h3>还没有任务</h3>
      <p>创建任务后，可在这里搜索、筛选并控制是否参与 Cron 调度。</p>
    </div>
    <div v-else-if="filteredTasks.length === 0" class="empty-state empty-state--compact" aria-live="polite">
      <h3>没有匹配的任务</h3>
      <p>尝试清空搜索内容或调整筛选条件。</p>
    </div>

    <ul v-else class="task-list">
      <li v-for="task in filteredTasks" :key="task.id" class="task-row">
        <div class="task-row__header">
          <div class="task-row__title">
            <strong>{{ task.name }}</strong>
          </div>
          <div class="task-row__actions">
            <ZButton type="primary" size="small" :loading="startingTaskIds.has(task.id)" :disabled="task.readiness !== 'ready'" @click="runTask(task)">运行</ZButton>
            <ZButton type="text" size="small" @click="openEditDrawer(task)">编辑</ZButton>
            <ZButton type="text" size="small" @click="duplicateTask(task)">复制</ZButton>
            <ZButton type="danger" size="small" @click="removeTask(task)">删除</ZButton>
          </div>
        </div>
        <p class="task-row__desc" :title="task.note ? `${task.scriptName} · ${task.note}` : task.scriptName">{{ task.scriptName }}<template v-if="task.note"> · {{ task.note }}</template></p>
        <div v-if="task.readiness !== 'ready'" class="task-issue" role="alert">
          <span>{{ readinessGuidance[task.readiness].message }}</span>
          <ZButton type="text" size="small" @click="resolveTaskIssue(task)">
            {{ readinessGuidance[task.readiness].action }}
          </ZButton>
        </div>
        <div class="task-row__footer">
          <span class="task-row__schedule">{{ task.cron ?? '仅手动运行' }}</span>
          <div class="task-row__toggle">
            <span>{{ task.enabled ? '已启用' : '已禁用' }}</span>
            <ZSwitch :model-value="task.enabled" :disabled="changingTaskIds.has(task.id)" size="small" :aria-label="`${task.enabled ? '禁用' : '启用'}任务 ${task.name}`" @update:model-value="(enabled) => changeEnabled(task, enabled)" />
          </div>
        </div>
      </li>
    </ul>
    </div>
  </section>
</template>

<style scoped lang="scss">
.tasks-view {
  padding-top: 0;
}

.task-issue {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--warning-color);
  font-size: 13px;
}

.task-filters {
  display: grid;
  grid-template-columns: auto 150px 150px;
  gap: 12px;
  margin-bottom: 20px;
}

.task-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--card-bg);
  width: 100%;
  overflow: hidden;
}

.task-row__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.task-row__title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.task-row__title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.task-row__desc {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.task-row__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.task-row__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.task-row__schedule,
.task-row__toggle > span {
  color: var(--text-secondary);
  font-size: 12px;
}

.empty-state--compact {
  min-height: 260px;
}

/* ----- schedule field ----- */
.schedule-field {
  display: grid;
  min-width: 0;
  gap: 12px;
  margin: 0;
  padding: 0;
  border: 0;
}

.schedule-field legend {
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.schedule-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.schedule-preview {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 13px;
}

.schedule-preview p {
  margin: 0;
}

.schedule-preview__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-color);
}

.schedule-preview ol {
  display: grid;
  gap: 5px;
  margin: 10px 0 0;
  padding-left: 22px;
}

.schedule-preview time {
  overflow-wrap: anywhere;
}

.schedule-preview__error {
  color: var(--error-color);
}

@media (max-width: 760px) {
  .task-filters {
    grid-template-columns: 1fr;
  }
}
</style>
