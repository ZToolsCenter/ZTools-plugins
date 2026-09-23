<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ReminderForm from './components/ReminderForm.vue'
import ReminderItem from './components/ReminderItem.vue'
import type { Reminder, ReminderFormData } from '../types/reminder'
import { useReminders } from '../composables/useReminders'
import { useLog } from '../composables/useLog'
import { useHoliday } from '../composables/useHoliday'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

const {
  sortedReminders,
  loadReminders,
  addReminder,
  updateReminder,
  deleteReminder,
  toggleReminder
} = useReminders()

// 调度器已在 preload 中运行，渲染进程只负责 UI
loadReminders()

const { logs, clearLogs, refresh: refreshLogs } = useLog()
const showLogs = ref(false)

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
  const text = logs.value.map(l => `[${l.time}] ${l.message}  ${JSON.stringify(l.detail)}`).join('\n')
  navigator.clipboard.writeText(text)
  ElMessage.success('日志已复制')
}

// ===== 节假日数据状态 =====
const { holidayStatus, refreshStatus, updateHolidayData } = useHoliday()
const holidayUpdating = ref(false)

onMounted(() => {
  refreshStatus()
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
        <button class="btn-add" @click="handleCreate">+ 新建</button>
      </div>

      <div v-if="sortedReminders.length === 0" class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <p>暂无提醒，点击"新建"创建</p>
      </div>

      <div v-else class="reminder-list">
        <ReminderItem
          v-for="r in sortedReminders"
          :key="r.id"
          :reminder="r"
          @toggle="handleToggle"
          @edit="handleEdit"
          @delete="handleDelete"
        />
      </div>
    </div>

<ReminderForm
      v-else
      :edit-reminder="editingReminder"
      @save="handleSave"
      @cancel="handleCancel"
    />

    <div class="holiday-bar" v-if="showHolidayBar">
      <span class="holiday-status">{{ holidayText }}</span>
      <button
        class="log-btn"
        v-if="holidayStatus && !holidayStatus.legacy"
        :disabled="holidayUpdating"
        @click="handleUpdateHoliday"
      >
        {{ holidayUpdating ? '更新中…' : '更新数据' }}
      </button>
    </div>

    <div class="log-section">
      <div class="log-bar">
        <label class="log-toggle">
          <input type="checkbox" v-model="showLogs" @change="showLogs && refreshLogs()" />
          <span class="toggle-track"></span>
          <span class="toggle-label">系统日志</span>
        </label>
        <span v-if="showLogs" class="log-count">{{ logs.length }}条</span>
      </div>
      <div v-if="showLogs" class="log-panel">
        <div class="log-toolbar">
          <button class="log-btn" @click="refreshLogs">刷新</button>
          <button class="log-btn" @click="clearLogs">清空</button>
          <button class="log-btn" @click="copyLogs">复制</button>
        </div>
        <div class="log-list">
          <div v-for="log in logs" :key="log.id" class="log-entry">
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

.log-section {
  margin-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.holiday-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
  padding: 8px 0;
}

.holiday-status {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.holiday-bar .log-btn {
  flex-shrink: 0;
}

.holiday-bar .log-btn:disabled {
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
