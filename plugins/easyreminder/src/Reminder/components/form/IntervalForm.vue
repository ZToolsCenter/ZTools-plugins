<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { DaySchedule } from '../../../types/reminder'
import { WEEKDAY_LABELS } from '../../../types/reminder'

const props = defineProps<{
  initialSchedules?: DaySchedule[]
  initialInterval?: number
}>()

const emit = defineEmits<{
  update: [data: { schedules: DaySchedule[]; interval: number }]
}>()

const weekdays = ref<number[]>([])
const unifiedTime = ref(true)
const unifiedRanges = ref<Array<{ startTime: string; endTime: string }>>([
  { startTime: '09:00', endTime: '18:00' }
])
const interval = ref(60)
const customInterval = ref<number | undefined>(undefined)

const presetIntervals = [
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
  { value: 180, label: '3 小时' },
]
const presetValues = presetIntervals.map(p => p.value)

function initDefaults() {
  if (props.initialSchedules && props.initialSchedules.length > 0) {
    // 从现有数据初始化
    const days = [...new Set(props.initialSchedules.map(s => s.weekday))]
    weekdays.value = days
    
    // 检查是否统一时间
    const allSame = days.length > 0 && days.every(day => {
      const a = props.initialSchedules!.filter(s => s.weekday === day)
      const b = props.initialSchedules!.filter(s => s.weekday === days[0])
      if (a.length !== b.length) return false
      return a.every((x, i) => x.startTime === b[i].startTime && x.endTime === b[i].endTime)
    })
    
    unifiedTime.value = allSame
    if (allSame && days.length > 0) {
      unifiedRanges.value = props.initialSchedules!
        .filter(s => s.weekday === days[0])
        .map(s => ({ startTime: s.startTime, endTime: s.endTime }))
    }
  } else {
    weekdays.value = []
    unifiedTime.value = true
    unifiedRanges.value = [{ startTime: '09:00', endTime: '18:00' }]
  }
  
  if (props.initialInterval) {
    const isPreset = presetValues.includes(props.initialInterval)
    interval.value = isPreset ? props.initialInterval : 0
    customInterval.value = isPreset ? undefined : props.initialInterval
  } else {
    interval.value = 60
    customInterval.value = undefined
  }
}

function toggleWeekday(day: number) {
  const index = weekdays.value.indexOf(day)
  if (index > -1) {
    weekdays.value.splice(index, 1)
  } else {
    weekdays.value.push(day)
  }
  weekdays.value.sort()
}

function addUnifiedRange() {
  unifiedRanges.value.push({ startTime: '09:00', endTime: '18:00' })
}

function removeUnifiedRange(index: number) {
  if (unifiedRanges.value.length > 1) {
    unifiedRanges.value.splice(index, 1)
  }
}

function buildSchedules(): DaySchedule[] {
  const schedules: DaySchedule[] = []

  for (const day of weekdays.value) {
    for (const range of unifiedRanges.value) {
      schedules.push({
        weekday: day,
        startTime: range.startTime,
        endTime: range.endTime
      })
    }
  }

  return schedules
}

function validate(): boolean {
  if (weekdays.value.length === 0) {
    ElMessage.warning('请选择至少一个星期')
    return false
  }
  
  const finalInterval = interval.value === 0 ? customInterval.value : interval.value
  if (!finalInterval || finalInterval < 1) {
    ElMessage.warning('请输入有效的自定义间隔')
    return false
  }
  
  return true
}

function getData() {
  return {
    schedules: buildSchedules(),
    interval: interval.value === 0 ? customInterval.value! : interval.value
  }
}

onMounted(() => {
  initDefaults()
})

watch(() => [props.initialSchedules, props.initialInterval], () => {
  initDefaults()
})

defineExpose({
  validate,
  getData
})
</script>

<template>
  <div class="form-item">
    <label>提醒星期</label>
    <div class="weekday-selector">
      <button
        v-for="(label, index) in WEEKDAY_LABELS"
        :key="index"
        :class="['weekday-btn', { active: weekdays.includes(index) }]"
        @click="toggleWeekday(index)"
      >
        {{ label }}
      </button>
    </div>
  </div>

  <div class="form-item" v-if="weekdays.length > 0">
    <div class="time-header">
      <label>提醒时间段</label>
      <el-switch v-model="unifiedTime" active-text="统一时间" size="small" />
    </div>

    <div class="unified-ranges">
      <div v-for="(range, i) in unifiedRanges" :key="i" class="range-row">
        <el-input v-model="range.startTime" type="time" size="small" />
        <span class="range-sep">-</span>
        <el-input v-model="range.endTime" type="time" size="small" />
        <el-button 
          v-if="unifiedRanges.length > 1" 
          size="small" 
          circle 
          plain 
          type="danger" 
          @click="removeUnifiedRange(i)"
        >
          ×
        </el-button>
      </div>
      <el-button size="small" plain @click="addUnifiedRange">+ 添加时间段</el-button>
    </div>
  </div>

  <div class="form-item">
    <label>提醒间隔</label>
    <div class="interval-row">
      <el-select v-model.number="interval" @change="customInterval = undefined" style="flex: 1">
        <el-option v-for="p in presetIntervals" :key="p.value" :value="p.value" :label="p.label" />
        <el-option :value="0" label="自定义…" />
      </el-select>
      <el-input-number 
        v-if="interval === 0" 
        v-model="customInterval" 
        :min="1" 
        :max="1440" 
        placeholder="分钟数" 
        controls-position="right" 
        style="flex: 1" 
      />
    </div>
  </div>
</template>

<style scoped>
.form-item {
  margin-bottom: 14px;
}

.form-item label {
  display: block;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.weekday-selector {
  display: flex;
  gap: 6px;
}

.weekday-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.weekday-btn:hover {
  border-color: var(--el-color-primary);
}

.weekday-btn.active {
  background: var(--el-color-primary);
  color: #fff;
  border-color: var(--el-color-primary);
}

.time-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.time-header label {
  margin-bottom: 0;
}

.interval-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.unified-ranges {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.range-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.range-sep {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
</style>
