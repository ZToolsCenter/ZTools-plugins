<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { Reminder, ReminderFormData, ReminderType } from '../../types/reminder'
import { REMINDER_TYPE_LABELS, createEmptyReminder } from '../../types/reminder'
import OnceForm from './form/OnceForm.vue'
import DailyForm from './form/DailyForm.vue'
import IntervalForm from './form/IntervalForm.vue'

const props = defineProps<{
  editReminder?: Reminder | null
}>()

const emit = defineEmits<{
  save: [data: ReminderFormData]
  cancel: []
}>()

const form = ref<ReminderFormData>(createEmptyReminder())
const onceFormRef = ref<InstanceType<typeof OnceForm> | null>(null)
const dailyFormRef = ref<InstanceType<typeof DailyForm> | null>(null)
const intervalFormRef = ref<InstanceType<typeof IntervalForm> | null>(null)

function onTypeChange(type: ReminderType) {
  form.value.type = type
}

function loadFromReminder(r: Reminder) {
  form.value = {
    title: r.title,
    content: r.content,
    type: r.type,
    schedules: (r.schedules || []).map(s => ({ ...s })),
    interval: r.interval,
    triggerAt: r.triggerAt,
    weekdays: r.weekdays ? [...r.weekdays] : [],
    triggerTime: r.triggerTime || '09:00'
  }
}

onMounted(() => {
  if (props.editReminder) {
    loadFromReminder(props.editReminder)
  }
})

watch(() => props.editReminder, (val) => {
  if (val) {
    loadFromReminder(val)
  } else {
    form.value = createEmptyReminder()
  }
})

function handleSubmit() {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入提醒标题')
    return
  }

  const submitData: ReminderFormData = {
    title: form.value.title,
    content: form.value.content,
    type: form.value.type,
    schedules: [],
    interval: form.value.interval
  }

  if (form.value.type === 'once') {
    if (!onceFormRef.value?.validate()) return
    const onceData = onceFormRef.value.getData()
    submitData.triggerAt = onceData.triggerAt
  } else if (form.value.type === 'daily') {
    if (!dailyFormRef.value?.validate()) return
    const dailyData = dailyFormRef.value.getData()
    submitData.weekdays = dailyData.weekdays
    submitData.triggerTime = dailyData.triggerTime
  } else {
    if (!intervalFormRef.value?.validate()) return
    const intervalData = intervalFormRef.value.getData()
    submitData.schedules = intervalData.schedules
    submitData.interval = intervalData.interval
  }

  emit('save', submitData)
}
</script>

<template>
  <div class="reminder-form">
    <div class="form-header">
      <h3>{{ editReminder ? '编辑提醒' : '新建提醒' }}</h3>
    </div>

    <div class="form-body">
      <!-- 类型切换 -->
      <div class="form-item">
        <el-radio-group v-model="form.type" @change="onTypeChange">
          <el-radio-button v-for="(label, key) in REMINDER_TYPE_LABELS" :key="key" :value="key">
            {{ label }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- 标题 + 内容（通用） -->
      <div class="form-item">
        <label>提醒标题</label>
        <el-input v-model="form.title" placeholder="输入提醒标题" maxlength="50" clearable />
      </div>

      <div class="form-item">
        <label>提醒内容</label>
        <el-input v-model="form.content" type="textarea" placeholder="输入提醒内容（可选）" :rows="2" maxlength="200" show-word-limit />
      </div>

      <!-- ===== once：定时提醒 ===== -->
      <OnceForm
        v-if="form.type === 'once'"
        ref="onceFormRef"
        :initial-date="editReminder?.triggerAt ? new Date(editReminder.triggerAt).toISOString().slice(0, 10) : undefined"
        :initial-time="editReminder?.triggerAt ? `${String(new Date(editReminder.triggerAt).getHours()).padStart(2, '0')}:${String(new Date(editReminder.triggerAt).getMinutes()).padStart(2, '0')}` : undefined"
      />

      <!-- ===== daily：每日提醒 ===== -->
      <DailyForm
        v-if="form.type === 'daily'"
        ref="dailyFormRef"
        :initial-weekdays="form.weekdays"
        :initial-time="form.triggerTime"
      />

      <!-- ===== interval：间隔提醒 ===== -->
      <IntervalForm
        v-if="form.type === 'interval'"
        ref="intervalFormRef"
        :initial-schedules="form.schedules"
        :initial-interval="form.interval"
      />
    </div>

    <div class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" @click="handleSubmit">保存</el-button>
    </div>
  </div>
</template>

<style scoped>
.reminder-form {
  padding: 16px;
}

.form-header h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
}

.form-item {
  margin-bottom: 14px;
}

.form-item label {
  display: block;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>

