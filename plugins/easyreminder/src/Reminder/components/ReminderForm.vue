<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { Reminder, ReminderFormData, ReminderGroup, ReminderType } from '../../types/reminder'
import { REMINDER_TYPE_LABELS, DAY_FILTER_LABELS, createEmptyReminder } from '../../types/reminder'
import { useReminders } from '../../composables/useReminders'
import OnceForm from './form/OnceForm.vue'
import DailyForm from './form/DailyForm.vue'
import IntervalForm from './form/IntervalForm.vue'

const props = defineProps<{
  editReminder?: Reminder | null
  groups?: ReminderGroup[]
}>()

const emit = defineEmits<{
  save: [data: ReminderFormData]
  cancel: []
}>()

const { addGroup } = useReminders()

const form = ref<ReminderFormData>(createEmptyReminder())
const onceFormRef = ref<InstanceType<typeof OnceForm> | null>(null)
const dailyFormRef = ref<InstanceType<typeof DailyForm> | null>(null)
const intervalFormRef = ref<InstanceType<typeof IntervalForm> | null>(null)

function onTypeChange(type: ReminderType) {
  form.value.type = type
}

const TYPE_DESCRIPTIONS: Record<ReminderType, string> = {
  interval: '在所选星期的时间段内，每隔固定间隔提醒一次，适合久坐、喝水等循环提醒',
  daily: '每天在固定时刻提醒一次，可指定星期几生效',
  once: '在指定的日期和时刻只提醒一次，触发后自动停用'
}

// once 编辑时的初始日期/时间：按本地时区取（toISOString 是 UTC，会把凌晨的提醒错算到前一天）
const onceInitialDate = computed(() => {
  const ts = props.editReminder?.triggerAt
  if (!ts) return undefined
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

const onceInitialTime = computed(() => {
  const ts = props.editReminder?.triggerAt
  if (!ts) return undefined
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

function loadFromReminder(r: Reminder) {
  form.value = {
    title: r.title,
    content: r.content,
    type: r.type,
    schedules: (r.schedules || []).map(s => ({ ...s })),
    interval: r.interval,
    align: r.align === 'start' ? 'start' : 'create',
    weekdays: r.weekdays ? [...r.weekdays] : [],
    triggerTime: r.triggerTime || '09:00',
    dayFilter: r.dayFilter || 'all',
    groupId: r.groupId || ''
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

// 下拉里直接输入的新组名会以文本为值，保存时换成真实分组 id
function resolveGroupId(value?: string): string | undefined {
  const v = (value || '').trim()
  if (!v) return undefined
  if ((props.groups || []).some(g => g.id === v)) return v
  if (typeof window.services?.addGroup !== 'function') return undefined
  const group = addGroup(v)
  return group ? group.id : undefined
}

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
    interval: form.value.interval,
    dayFilter: form.value.dayFilter || 'all',
    groupId: resolveGroupId(form.value.groupId)
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
    submitData.align = intervalData.align
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
        <div class="form-tip">{{ TYPE_DESCRIPTIONS[form.type] }}</div>
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

      <div class="form-item">
        <label>分组</label>
        <el-select
          v-model="form.groupId"
          filterable
          allow-create
          default-first-option
          placeholder="不分组，输入新组名可直接创建"
          style="width: 100%"
        >
          <el-option label="不分组" value="" />
          <el-option v-for="g in groups || []" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
      </div>

      <!-- 触发日过滤（once 为指定日期，不适用） -->
      <div class="form-item" v-if="form.type !== 'once'">
        <label>触发日</label>
        <el-radio-group v-model="form.dayFilter">
          <el-radio-button v-for="(label, key) in DAY_FILTER_LABELS" :key="key" :value="key">
            {{ label }}
          </el-radio-button>
        </el-radio-group>
        <div class="form-tip" v-if="form.dayFilter && form.dayFilter !== 'all'">
          按国家法定节假日安排（含调休）判断，与所选星期同时生效；想覆盖调休上班的周末，请把星期选全
        </div>
      </div>

      <!-- ===== once：定时提醒 ===== -->
      <OnceForm
        v-if="form.type === 'once'"
        ref="onceFormRef"
        :initial-date="onceInitialDate"
        :initial-time="onceInitialTime"
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
        :initial-align="form.align"
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

.form-tip {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-top: 6px;
  line-height: 1.5;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>

