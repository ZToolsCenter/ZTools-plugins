<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ReminderForm from './components/ReminderForm.vue'
import ReminderItem from './components/ReminderItem.vue'
import type { Reminder, ReminderFormData, ReminderGroup } from '../types/reminder'
import { useReminders } from '../composables/useReminders'
import { useLog } from '../composables/useLog'
import { useHoliday } from '../composables/useHoliday'
import { useScheduler } from '../composables/useScheduler'

const {
  sortedReminders,
  sortedGroups,
  hasGroupApi,
  loadReminders,
  addReminder,
  updateReminder,
  deleteReminder,
  toggleReminder,
  copyReminder,
  addGroup,
  setGroupEnabled,
  dissolveGroup,
  deleteGroup,
  assignGroup,
  setRemindersEnabled,
  deleteReminders,
  reorderGroups,
  updateReminderOrder
} = useReminders()

// 调度器已在 preload 中运行，渲染进程只负责 UI
loadReminders()

const { logs, clearLogs, refresh: refreshLogs } = useLog()
const showLogs = ref(false)

// ===== 调度状态（调度器跑在 preload 里，这里只读展示）=====
const { schedulerState, refresh: refreshSchedulerState } = useScheduler()

const AUTO_START_TIP =
  '调度器随插件 preload 一起启动。若重启电脑后没收到提醒，请在 ZTools 里打开本插件 → 右上角设置按钮 → 插件设置 → 勾选「跟随主程序同时启动运行」'

const schedulerText = computed(() => {
  const s = schedulerState.value
  if (!s) return ''
  if (!s.ready) return '调度器未就绪'
  return s.nextTriggerText ? `调度中 · 下次 ${s.nextTriggerText}` : '调度中 · 暂无待触发'
})

// ===== 状态分类 Tab =====
type TabKey = 'active' | 'disabled' | 'expired'
const activeTab = ref<TabKey>('active')

// once 类型已过触发时间即视为已过期；每 30s 刷新一次时间基准，让列表随时间自动归位
const nowTs = ref(Date.now())
let nowTimer: number | undefined

function isExpired(r: Reminder): boolean {
  return r.type === 'once' && r.triggerAt != null && r.triggerAt < nowTs.value
}

const activeReminders = computed(() => sortedReminders.value.filter(r => r.enabled && !isExpired(r)))
const disabledReminders = computed(() => sortedReminders.value.filter(r => !r.enabled && !isExpired(r)))
const expiredReminders = computed(() => sortedReminders.value.filter(isExpired))

const tabMeta: Array<{ key: TabKey; label: string; list: typeof activeReminders }> = [
  { key: 'active', label: '进行中', list: activeReminders },
  { key: 'disabled', label: '未启用', list: disabledReminders },
  { key: 'expired', label: '已过期', list: expiredReminders }
]

const currentList = computed(() => {
  const meta = tabMeta.find(t => t.key === activeTab.value)
  return meta ? meta.list.value : []
})

// ===== 分组折叠 =====
// 顶层只展示分组入口和未分组任务，点击分组在原地向下展开组内任务
const expandedGroupIds = ref<string[]>([])

function isExpanded(groupId: string): boolean {
  return expandedGroupIds.value.includes(groupId)
}

// 当前 Tab 内各分组及其任务
const tabGroups = computed(() => {
  const buckets = new Map<string, Reminder[]>()
  for (const r of currentList.value) {
    if (!r.groupId) continue
    if (!buckets.has(r.groupId)) buckets.set(r.groupId, [])
    buckets.get(r.groupId)!.push(r)
  }
  return sortedGroups.value
    .filter(g => buckets.has(g.id))
    .map(g => ({ group: g, tasks: buckets.get(g.id) || [] }))
})

// 未分组任务（分组已被删除的孤儿任务同样归到这里）
const ungroupedTasks = computed(() => {
  const groupIds = new Set(sortedGroups.value.map(g => g.id))
  return currentList.value.filter(r => !r.groupId || !groupIds.has(r.groupId))
})

function toggleGroup(group: ReminderGroup) {
  const index = expandedGroupIds.value.indexOf(group.id)
  if (index === -1) {
    expandedGroupIds.value.push(group.id)
    return
  }
  // 收起时把该组内已勾选的任务从选择中移除，避免操作到看不见的任务
  expandedGroupIds.value.splice(index, 1)
  const hiddenIds = new Set(currentList.value.filter(r => r.groupId === group.id).map(r => r.id))
  selectedIds.value = selectedIds.value.filter(id => !hiddenIds.has(id))
}

// ===== 多选与批量操作 =====
const selectedIds = ref<string[]>([])

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id)
}

function toggleSelect(id: string) {
  const index = selectedIds.value.indexOf(id)
  if (index === -1) selectedIds.value.push(id)
  else selectedIds.value.splice(index, 1)
}

function clearSelection() {
  selectedIds.value = []
}

const selectedReminders = computed(() => {
  const ids = new Set(selectedIds.value)
  return sortedReminders.value.filter(r => ids.has(r.id))
})

const hasGroupedSelected = computed(() => selectedReminders.value.some(r => !!r.groupId))

// 全选只覆盖当前可见的任务：未分组 + 已展开分组里的任务
const visibleTasks = computed(() => {
  const list: Reminder[] = [...ungroupedTasks.value]
  for (const item of tabGroups.value) {
    if (isExpanded(item.group.id)) list.push(...item.tasks)
  }
  return list
})

const allVisibleSelected = computed(
  () => visibleTasks.value.length > 0 && visibleTasks.value.every(r => selectedIds.value.includes(r.id))
)
const someVisibleSelected = computed(() => visibleTasks.value.some(r => selectedIds.value.includes(r.id)))

function toggleSelectAll() {
  const visible = new Set(visibleTasks.value.map(r => r.id))
  if (allVisibleSelected.value) {
    selectedIds.value = selectedIds.value.filter(id => !visible.has(id))
    return
  }
  const next = new Set(selectedIds.value)
  visible.forEach(id => next.add(id))
  selectedIds.value = [...next]
}

const groupDialogVisible = ref(false)
const groupDialogValue = ref('')

function openGroupDialog() {
  if (!requireGroupApi()) return
  groupDialogValue.value = ''
  groupDialogVisible.value = true
}

// 下拉里直接输入的新组名会以文本为值，这里换成真实分组 id
function confirmMoveToGroup() {
  const value = (groupDialogValue.value || '').trim()
  if (!value) {
    ElMessage.warning('请选择或输入分组')
    return
  }
  let group = sortedGroups.value.find(g => g.id === value)
  if (!group) group = addGroup(value) || undefined
  if (!group) {
    ElMessage.warning('分组创建失败，请重启 ZTools 后重试')
    return
  }
  assignGroup([...selectedIds.value], group.id)
  ElMessage.success(`已移入分组「${group.name}」`)
  groupDialogVisible.value = false
  clearSelection()
}

function handleBatchRemoveGroup() {
  if (!requireGroupApi()) return
  assignGroup([...selectedIds.value], '')
  ElMessage.success('已移出分组')
  clearSelection()
}

function handleBatchEnabled(enabled: boolean) {
  if (!requireGroupApi()) return
  setRemindersEnabled([...selectedIds.value], enabled)
  ElMessage.success(enabled ? '已启用所选提醒' : '已停用所选提醒')
  clearSelection()
}

async function handleBatchDelete() {
  if (!requireGroupApi()) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 条提醒？`, '批量删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    deleteReminders([...selectedIds.value])
    ElMessage.success('已删除所选提醒')
    clearSelection()
  } catch {}
}

function groupTaskCount(groupId: string): number {
  return sortedReminders.value.filter(r => r.groupId === groupId).length
}

function requireGroupApi(): boolean {
  if (hasGroupApi()) return true
  ElMessage.warning('分组、批量与拖拽操作需要新版 preload，请重启 ZTools 后重试')
  return false
}

// ===== 拖拽排序 =====
type DragKind = 'group' | 'task'
interface DragState {
  kind: DragKind
  id: string
}
interface DropTarget {
  kind: DragKind
  id: string
  position: 'before' | 'after' | 'into'
}

const dragState = ref<DragState | null>(null)
const dropTarget = ref<DropTarget | null>(null)

function clearDrag() {
  dragState.value = null
  dropTarget.value = null
}

function dropPosition(e: DragEvent): 'before' | 'after' {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return 'after'
  const rect = el.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function isDropOn(kind: DragKind, id: string, position?: DropTarget['position']): boolean {
  const t = dropTarget.value
  return !!t && t.kind === kind && t.id === id && (!position || t.position === position)
}

function onGroupDragStart(e: DragEvent, group: ReminderGroup) {
  if (!requireGroupApi()) return
  dragState.value = { kind: 'group', id: group.id }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', group.id)
  }
}

function onTaskDragStart(e: DragEvent, id: string) {
  if (!requireGroupApi()) return
  dragState.value = { kind: 'task', id }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    const row = (e.target as HTMLElement | null)?.closest('.reminder-item')
    if (row) e.dataTransfer.setDragImage(row, 24, 24)
  }
}

function onGroupDragOver(e: DragEvent, group: ReminderGroup) {
  const drag = dragState.value
  if (!drag) return
  if (drag.kind === 'group' && drag.id === group.id) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTarget.value = drag.kind === 'group'
    ? { kind: 'group', id: group.id, position: dropPosition(e) }
    : { kind: 'group', id: group.id, position: 'into' }
}

function onGroupDrop(e: DragEvent, group: ReminderGroup) {
  const drag = dragState.value
  if (!drag) return
  e.preventDefault()
  e.stopPropagation()

  if (drag.kind === 'group') {
    if (drag.id !== group.id) {
      const ids = sortedGroups.value.map(g => g.id)
      const from = ids.indexOf(drag.id)
      if (from !== -1) {
        ids.splice(from, 1)
        const to = ids.indexOf(group.id)
        if (to !== -1) {
          ids.splice(dropPosition(e) === 'before' ? to : to + 1, 0, drag.id)
          reorderGroups(ids)
        }
      }
    }
  } else {
    moveTaskToGroup(drag.id, group.id)
  }
  clearDrag()
}

function onTaskDragOver(e: DragEvent, target: Reminder) {
  if (dragState.value?.kind !== 'task') return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTarget.value = { kind: 'task', id: target.id, position: dropPosition(e) }
}

function onTaskDrop(e: DragEvent, target: Reminder) {
  const drag = dragState.value
  if (!drag || drag.kind !== 'task') return
  e.preventDefault()
  e.stopPropagation()
  if (drag.id !== target.id) moveTaskAround(drag.id, target, dropPosition(e))
  clearDrag()
}

function bucketOf(r: Reminder): string {
  return r.groupId || ''
}

// 同一分组（空串为未分组）内按当前显示顺序排列，可排除拖拽中的任务
function orderedBucket(bucketKey: string, excludeId?: string): Reminder[] {
  return sortedReminders.value.filter(r => bucketOf(r) === bucketKey && r.id !== excludeId)
}

// 任务排序值越大越靠前，写回时按新顺序整体重排
function applyBucketOrder(list: Reminder[], groupId: string | null) {
  const entries = list.map((r, i) => ({ id: r.id, groupId, order: list.length - i }))
  updateReminderOrder(entries)
}

function moveTaskAround(draggedId: string, target: Reminder, position: 'before' | 'after') {
  const dragged = sortedReminders.value.find(r => r.id === draggedId)
  if (!dragged) return
  const targetGroupId = target.groupId || null
  const list = orderedBucket(targetGroupId || '', draggedId)
  const index = list.findIndex(r => r.id === target.id)
  if (index === -1) return
  list.splice(position === 'before' ? index : index + 1, 0, { ...dragged, groupId: targetGroupId || undefined })
  applyBucketOrder(list, targetGroupId)
}

function moveTaskToGroup(draggedId: string, groupId: string) {
  const dragged = sortedReminders.value.find(r => r.id === draggedId)
  if (!dragged) return
  const list = orderedBucket(groupId, draggedId)
  list.push({ ...dragged, groupId })
  applyBucketOrder(list, groupId)
  if (!isExpanded(groupId)) expandedGroupIds.value.push(groupId)
}

function handleGroupStart(group: ReminderGroup) {
  if (!requireGroupApi()) return
  setGroupEnabled(group.id, true)
  ElMessage.success(`分组「${group.name}」已启动`)
}

function handleGroupStop(group: ReminderGroup) {
  if (!requireGroupApi()) return
  setGroupEnabled(group.id, false)
  ElMessage.success(`分组「${group.name}」已停止`)
}

async function handleGroupDissolve(group: ReminderGroup) {
  if (!requireGroupApi()) return
  try {
    await ElMessageBox.confirm(
      `解散分组「${group.name}」？组内任务会保留为未分组。`,
      '解散分组',
      { confirmButtonText: '解散', cancelButtonText: '取消', type: 'warning' }
    )
    dissolveGroup(group.id)
    ElMessage.success('分组已解散')
  } catch {}
}

async function handleGroupDelete(group: ReminderGroup) {
  if (!requireGroupApi()) return
  const count = groupTaskCount(group.id)
  try {
    await ElMessageBox.confirm(
      `删除分组「${group.name}」会同时删除组内 ${count} 条提醒，且无法恢复。`,
      '删除分组',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    deleteGroup(group.id)
    ElMessage.success('分组及组内提醒已删除')
  } catch {}
}

function handleCopy(reminder: Reminder) {
  if (copyReminder(reminder.id)) {
    ElMessage.success('已复制，可在列表中找到副本')
  }
}

const showForm = ref(false)
const editingReminder = ref<Reminder | null>(null)

function handleSave(formData: ReminderFormData) {
  if (editingReminder.value) {
    const success = updateReminder(editingReminder.value.id, formData)
    if (success) {
      ElMessage.success('提醒已更新')
    }
  } else {
    addReminder(formData)
    ElMessage.success('提醒已创建')
  }
  showForm.value = false
  editingReminder.value = null
}

function handleEdit(reminder: Reminder) {
  editingReminder.value = reminder
  showForm.value = true
}

function handleToggle(id: string) {
  toggleReminder(id)
}

async function handleDelete(id: string) {
  try {
    await ElMessageBox.confirm('确定删除该提醒？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    deleteReminder(id)
    ElMessage.success('已删除')
  } catch {}
}

function handleCancel() {
  showForm.value = false
  editingReminder.value = null
}

function handleCreate() {
  editingReminder.value = null
  showForm.value = true
}

function copyLogs() {
  const text = logs.value.map(l => `[${l.time}] ${l.message}`).join('\n')
  navigator.clipboard.writeText(text)
  ElMessage.success('日志已复制')
}

// ===== 节假日数据状态 =====
const { holidayStatus, refreshStatus, updateHolidayData } = useHoliday()
const holidayUpdating = ref(false)

onMounted(() => {
  refreshStatus()
  refreshSchedulerState()
  nowTimer = window.setInterval(() => {
    nowTs.value = Date.now()
    refreshSchedulerState()
  }, 30000)
})

onUnmounted(() => {
  if (nowTimer) window.clearInterval(nowTimer)
})

// 增删改后下次触发时间立即变化，跟着列表一起刷新
watch(sortedReminders, (list) => {
  refreshSchedulerState()
  const valid = new Set(list.map(r => r.id))
  if (selectedIds.value.some(id => !valid.has(id))) {
    selectedIds.value = selectedIds.value.filter(id => valid.has(id))
  }
})

// 切换状态分类时收起所有分组
watch(activeTab, () => {
  expandedGroupIds.value = []
  clearSelection()
})

// 分组被解散/删除后清理展开状态
watch(sortedGroups, (list) => {
  const valid = new Set(list.map(g => g.id))
  if (expandedGroupIds.value.some(id => !valid.has(id))) {
    expandedGroupIds.value = expandedGroupIds.value.filter(id => valid.has(id))
  }
})

const holidayText = computed(() => {
  const s = holidayStatus.value
  if (!s) return ''
  if (s.legacy) return '节假日过滤需重启 ZTools 后生效'
  if (!s.years.length) return '节假日数据未获取，工作日/节假日按自然周近似'
  const d = new Date(s.updatedAt)
  const dateStr = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `节假日数据：${s.years.join('、')}年 · ${dateStr}更新`
})

const showHolidayBar = computed(() => {
  const s = holidayStatus.value
  if (!s) return false
  // 旧 preload / 无数据 / 有任意提醒启用过滤 或 已有数据时展示
  return s.legacy || s.years.length > 0 || sortedReminders.value.some(r => r.dayFilter && r.dayFilter !== 'all')
})

async function handleUpdateHoliday() {
  if (holidayUpdating.value) return
  holidayUpdating.value = true
  const ok = await updateHolidayData()
  holidayUpdating.value = false
  if (ok) {
    ElMessage.success('节假日数据已更新')
  } else {
    const s = holidayStatus.value
    if (s && s.years.length) {
      ElMessage.info('当前已是最新数据')
    } else {
      ElMessage.error('更新失败，请检查网络')
    }
  }
}
</script>

<template>
  <div class="reminder-app">
    <div v-if="!showForm">
      <div class="app-header">
        <h2>定时提醒</h2>
        <div class="header-right">
          <template v-if="showHolidayBar">
            <span class="holiday-status">{{ holidayText }}</span>
            <button
              class="log-btn"
              v-if="holidayStatus && !holidayStatus.legacy"
              :disabled="holidayUpdating"
              @click="handleUpdateHoliday"
            >
              {{ holidayUpdating ? '更新中…' : '更新数据' }}
            </button>
          </template>
          <button class="btn-add" @click="handleCreate">+ 新建</button>
        </div>
      </div>

      <template v-if="sortedReminders.length > 0">
        <div class="batch-bar">
          <label class="select-all" :class="{ disabled: visibleTasks.length === 0 }">
            <input
              type="checkbox"
              :checked="allVisibleSelected"
              :indeterminate="someVisibleSelected && !allVisibleSelected"
              :disabled="visibleTasks.length === 0"
              @change="toggleSelectAll"
            />
            <span>全选</span>
          </label>
          <template v-if="selectedIds.length > 0">
            <span class="batch-count">已选 {{ selectedIds.length }} 项</span>
            <div class="batch-actions">
              <button class="batch-btn" @click="openGroupDialog">移入分组</button>
              <button v-if="hasGroupedSelected" class="batch-btn" @click="handleBatchRemoveGroup">移出分组</button>
              <button class="batch-btn" @click="handleBatchEnabled(true)">启用</button>
              <button class="batch-btn" @click="handleBatchEnabled(false)">停用</button>
              <button class="batch-btn batch-btn-danger" @click="handleBatchDelete">删除</button>
              <button class="batch-btn" @click="clearSelection">取消</button>
            </div>
          </template>
        </div>

        <div class="tab-bar">
          <button
            v-for="tab in tabMeta"
            :key="tab.key"
            :class="['tab-btn', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
            <span class="tab-count">{{ tab.list.value.length }}</span>
          </button>
        </div>

        <div v-if="currentList.length > 0" class="reminder-list">
          <template v-for="item in tabGroups" :key="item.group.id">
            <div
              class="group-row"
              :class="{
                'drop-before': isDropOn('group', item.group.id, 'before'),
                'drop-after': isDropOn('group', item.group.id, 'after'),
                'drop-into': isDropOn('group', item.group.id, 'into')
              }"
              @click="toggleGroup(item.group)"
              @dragover="onGroupDragOver($event, item.group)"
              @drop="onGroupDrop($event, item.group)"
            >
              <span
                class="group-drag-handle"
                draggable="true"
                title="拖拽调整分组顺序"
                @click.stop
                @dragstart="onGroupDragStart($event, item.group)"
                @dragend="clearDrag"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                  <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                  <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                </svg>
              </span>
              <div class="group-row-main">
                <svg class="group-folder" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="group-name">{{ item.group.name }}</span>
                <span class="group-count">{{ item.tasks.length }}</span>
              </div>
              <div class="group-actions" @click.stop>
                <button class="group-btn" @click="handleGroupStart(item.group)">启动</button>
                <button class="group-btn" @click="handleGroupStop(item.group)">停止</button>
                <button class="group-btn" @click="handleGroupDissolve(item.group)">解散</button>
                <button class="group-btn group-btn-danger" @click="handleGroupDelete(item.group)">删除</button>
              </div>
              <svg
                class="group-chevron"
                :class="{ expanded: isExpanded(item.group.id) }"
                viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
              >
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>

            <div v-if="isExpanded(item.group.id)" class="group-tasks">
              <div
                v-for="r in item.tasks"
                :key="r.id"
                class="task-drop"
                :class="{
                  'drop-before': isDropOn('task', r.id, 'before'),
                  'drop-after': isDropOn('task', r.id, 'after')
                }"
                @dragover="onTaskDragOver($event, r)"
                @drop="onTaskDrop($event, r)"
              >
                <ReminderItem
                  :reminder="r"
                  :selected="isSelected(r.id)"
                  draggable
                  @toggle="handleToggle"
                  @edit="handleEdit"
                  @copy="handleCopy"
                  @delete="handleDelete"
                  @select="toggleSelect"
                  @dragstart="onTaskDragStart"
                  @dragend="clearDrag"
                />
              </div>
            </div>
          </template>

          <div
            v-for="r in ungroupedTasks"
            :key="r.id"
            class="task-drop"
            :class="{
              'drop-before': isDropOn('task', r.id, 'before'),
              'drop-after': isDropOn('task', r.id, 'after')
            }"
            @dragover="onTaskDragOver($event, r)"
            @drop="onTaskDrop($event, r)"
          >
            <ReminderItem
              :reminder="r"
              :selected="isSelected(r.id)"
              draggable
              @toggle="handleToggle"
              @edit="handleEdit"
              @copy="handleCopy"
              @delete="handleDelete"
              @select="toggleSelect"
              @dragstart="onTaskDragStart"
              @dragend="clearDrag"
            />
          </div>
          <div v-if="tabGroups.length === 0 && ungroupedTasks.length === 0" class="tab-empty">该分类下暂无提醒</div>
        </div>
        <div v-else class="tab-empty">该分类下暂无提醒</div>
      </template>

      <div v-else class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <p>暂无提醒，点击"新建"创建</p>
      </div>
    </div>

<ReminderForm
      v-else
      :edit-reminder="editingReminder"
      :groups="sortedGroups"
      @save="handleSave"
      @cancel="handleCancel"
    />

    <el-dialog v-model="groupDialogVisible" title="移入分组" width="90%">
      <el-select
        v-model="groupDialogValue"
        filterable
        allow-create
        default-first-option
        placeholder="选择分组，或输入新组名"
        style="width: 100%"
      >
        <el-option v-for="g in sortedGroups" :key="g.id" :label="g.name" :value="g.id" />
      </el-select>
      <template #footer>
        <el-button @click="groupDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmMoveToGroup">确定</el-button>
      </template>
    </el-dialog>

    <div class="log-section">
      <div class="log-bar">
        <label class="log-toggle">
          <input type="checkbox" v-model="showLogs" @change="showLogs && refreshLogs()" />
          <span class="toggle-track"></span>
          <span class="toggle-label">系统日志</span>
        </label>
        <div class="log-bar-right">
          <span v-if="schedulerText" class="sched-state" :title="AUTO_START_TIP">{{ schedulerText }}</span>
          <span v-if="showLogs" class="log-count">{{ logs.length }}条</span>
        </div>
      </div>
      <div v-if="showLogs" class="log-panel">
        <div class="log-toolbar">
          <button class="log-btn" @click="refreshLogs">刷新</button>
          <button class="log-btn" @click="clearLogs">清空</button>
          <button class="log-btn" @click="copyLogs">复制</button>
        </div>
        <div class="log-list">
          <div v-for="log in logs" :key="log.time + '-' + log.id" class="log-entry">
            <span class="log-time">{{ log.time }}</span>
            <span class="log-msg">{{ log.message }}</span>
          </div>
          <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reminder-app {
  padding: 16px;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.app-header h2 {
  margin: 0;
  font-size: 18px;
  color: var(--el-text-color-primary);
}

.btn-add {
  padding: 6px 16px;
  border-radius: 6px;
  border: none;
  background: var(--el-color-primary);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.2s;
}

.btn-add:hover {
  opacity: 0.85;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  color: var(--el-text-color-secondary);
}

.empty-state p {
  margin-top: 12px;
  font-size: 14px;
}

.reminder-list {
  display: flex;
  flex-direction: column;
}

/* ===== 分组入口 / 组内视图 ===== */
.group-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);
  cursor: pointer;
  transition: all 0.2s;
}

.group-row:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.group-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-folder {
  color: var(--el-color-primary);
  flex-shrink: 0;
}

.group-chevron {
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
  transition: transform 0.2s;
}

.group-chevron.expanded {
  transform: rotate(90deg);
}

.group-tasks {
  padding-left: 14px;
}

.group-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.group-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.group-btn {
  padding: 2px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.group-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}

.group-btn-danger:hover {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.group-drag-handle {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--el-text-color-placeholder);
  cursor: grab;
}

.group-drag-handle:active {
  cursor: grabbing;
}

.group-row.drop-before {
  box-shadow: inset 0 2px 0 var(--el-color-primary);
}

.group-row.drop-after {
  box-shadow: inset 0 -2px 0 var(--el-color-primary);
}

.group-row.drop-into {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.task-drop {
  position: relative;
}

.task-drop.drop-before::before,
.task-drop.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--el-color-primary);
  border-radius: 1px;
}

.task-drop.drop-before::before {
  top: 0;
}

.task-drop.drop-after::after {
  bottom: 0;
}

/* ===== 批量操作条 ===== */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 3px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 8px;
  background: var(--el-color-primary-light-9);
}

.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}

.select-all.disabled {
  opacity: 0.5;
  cursor: default;
}

.select-all input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--el-color-primary);
  cursor: pointer;
}

.batch-count {
  font-size: 12px;
  color: var(--el-text-color-primary);
  flex-shrink: 0;
  white-space: nowrap;
}

.batch-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.batch-btn {
  padding: 2px 8px;
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 4px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: 11px;
  cursor: pointer;
}

.batch-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.batch-btn-danger {
  border-color: var(--el-color-danger-light-5);
  color: var(--el-color-danger);
}

.batch-btn-danger:hover {
  border-color: var(--el-color-danger);
  color: var(--el-color-danger);
}

.tab-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.tab-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-text-color-primary);
}

.tab-btn.active {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}

.tab-count {
  font-size: 11px;
  opacity: 0.75;
  margin-left: 2px;
}

.tab-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.log-section {
  margin-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.holiday-status {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right .log-btn {
  flex-shrink: 0;
}

.header-right .log-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.log-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.log-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.log-toggle input {
  display: none;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--el-fill-color);
  border-radius: 10px;
  position: relative;
  transition: background 0.2s;
}

.toggle-track::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  left: 2px;
  top: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.log-toggle input:checked + .toggle-track {
  background: var(--el-color-primary);
}

.log-toggle input:checked + .toggle-track::before {
  transform: translateX(16px);
}

.toggle-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.log-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sched-state {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-count {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.log-panel {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

.log-toolbar {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.log-btn {
  padding: 2px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: 11px;
  cursor: pointer;
}

.log-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.log-list {
  max-height: 300px;
  overflow-y: auto;
  padding: 4px 0;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.log-entry {
  padding: 3px 8px;
  display: flex;
  gap: 8px;
  line-height: 1.5;
}

.log-entry:hover {
  background: var(--el-fill-color-lighter);
}

.log-time {
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.log-msg {
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.log-empty {
  padding: 16px;
  text-align: center;
  color: var(--el-text-color-placeholder);
}
</style>
