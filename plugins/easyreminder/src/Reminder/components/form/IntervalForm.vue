<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { DaySchedule, AlignMode } from '../../../types/reminder'
import { WEEKDAY_LABELS } from '../../../types/reminder'

const props = defineProps<{
  initialSchedules?: DaySchedule[]
  initialInterval?: number
  initialAlign?: AlignMode
}>()

const emit = defineEmits<{
  update: [data: { schedules: DaySchedule[]; interval: number; align: AlignMode }]
}>()

const weekdays = ref<number[]>([])
const unifiedTime = ref(true)
const unifiedRanges = ref<Array<{ startTime: string; endTime: string }>>([
  { startTime: '09:00', endTime: '18:00' }
])
// 分星期时间段（统一时间关闭时生效）：weekday -> 该星期的时段列表
const dayRangesMap = ref<Record<number, Array<{ startTime: string; endTime: string }>>>({})
const interval = ref(60)
const customInterval = ref<number | undefined>(undefined)
const align = ref<AlignMode>('start')

const alignOptions: Array<{ value: AlignMode; label: string }> = [
  { value: 'start', label: '按开始时间对齐' },
  { value: 'create', label: '按创建时间起算' }
]

const UNIFIED_TIME_TIP = '开启后，所有选中的星期使用相同的时间段；关闭后可分别为每个星期设置不同的提醒时间段'

const sortedWeekdays = computed(() => [...weekdays.value].sort((a, b) => a - b))

// 某星期实际生效的时段列表：统一模式用统一列表，分星期模式用各自列表（缺失时回退统一列表）
function rangesOf(day: number): Array<{ startTime: string; endTime: string }> {
  if (unifiedTime.value) return unifiedRanges.value
  return dayRangesMap.value[day] || unifiedRanges.value
}

function copyRanges(ranges: Array<{ startTime: string; endTime: string }>) {
  return ranges.map(r => ({ startTime: r.startTime, endTime: r.endTime }))
}

function onUnifiedChange(enabled: boolean | string | number) {
  if (!enabled) {
    // 切到分星期模式：把统一列表复制给每个已选星期
    const map: Record<number, Array<{ startTime: string; endTime: string }>> = {}
    for (const day of weekdays.value) map[day] = copyRanges(unifiedRanges.value)
    dayRangesMap.value = map
  }
}

function addDayRange(day: number) {
  const list = dayRangesMap.value[day]
  if (list) list.push({ startTime: '09:00', endTime: '18:00' })
}

function removeDayRange(day: number, index: number) {
  const list = dayRangesMap.value[day]
  if (list && list.length > 1) list.splice(index, 1)
}

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

    // 按星期分组，供分星期模式编辑
    const map: Record<number, Array<{ startTime: string; endTime: string }>> = {}
    for (const s of props.initialSchedules) {
      if (!map[s.weekday]) map[s.weekday] = []
      map[s.weekday].push({ startTime: s.startTime, endTime: s.endTime })
    }
    dayRangesMap.value = map
  } else {
    weekdays.value = []
    unifiedTime.value = true
    unifiedRanges.value = [{ startTime: '09:00', endTime: '18:00' }]
    dayRangesMap.value = {}
  }
  
  if (props.initialInterval) {
    const isPreset = presetValues.includes(props.initialInterval)
    interval.value = isPreset ? props.initialInterval : 0
    customInterval.value = isPreset ? undefined : props.initialInterval
  } else {
    interval.value = 60
    customInterval.value = undefined
  }

  align.value = props.initialAlign === 'create' ? 'create' : 'start'
}

function toggleWeekday(day: number) {
  const index = weekdays.value.indexOf(day)
  if (index > -1) {
    weekdays.value.splice(index, 1)
    delete dayRangesMap.value[day]
  } else {
    weekdays.value.push(day)
    // 分星期模式下新增的星期，用统一列表初始化
    if (!unifiedTime.value) dayRangesMap.value[day] = copyRanges(unifiedRanges.value)
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
    for (const range of rangesOf(day)) {
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

  for (const day of weekdays.value) {
    for (const range of rangesOf(day)) {
      if (!range.startTime || !range.endTime) {
        ElMessage.warning('请填写完整的提醒时间段')
        return false
      }
    }
  }

  return true
}

function getData() {
  return {
    schedules: buildSchedules(),
    interval: interval.value === 0 ? customInterval.value! : interval.value,
    align: align.value
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
      <label class="time-label">
        提醒时间段
        <el-tooltip :content="UNIFIED_TIME_TIP" placement="top" effect="dark">
          <span class="tip-badge">?</span>
        </el-tooltip>
      </label>
      <el-switch v-model="unifiedTime" @change="onUnifiedChange" active-text="统一时间" size="small" />
    </div>

    <!-- 统一时间：所有星期共用同一组时段 -->
    <div class="unified-ranges" v-if="unifiedTime">
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

    <!-- 分星期设置：每个星期各自一组时段 -->
    <div class="day-ranges" v-else>
      <div v-for="day in sortedWeekdays" :key="day" class="day-range-block">
        <div class="day-range-label">周{{ WEEKDAY_LABELS[day] }}</div>
        <div class="day-range-body">
          <div v-for="(range, i) in rangesOf(day)" :key="i" class="range-row">
            <el-input v-model="range.startTime" type="time" size="small" />
            <span class="range-sep">-</span>
            <el-input v-model="range.endTime" type="time" size="small" />
            <el-button
              v-if="rangesOf(day).length > 1"
              size="small"
              circle
              plain
              type="danger"
              @click="removeDayRange(day, i)"
            >
              ×
            </el-button>
          </div>
          <el-button size="small" plain @click="addDayRange(day)">+ 添加</el-button>
        </div>
      </div>
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

  <div class="form-item">
    <label>触发对齐</label>
    <el-radio-group v-model="align">
      <el-radio-button v-for="opt in alignOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </el-radio-button>
    </el-radio-group>
    <div class="form-tip">
      <template v-if="align === 'start'">
        触发点 = 开始时间 + N × 间隔，与创建时刻无关。例：09:00–18:00 每小时 → 9:00、10:00、11:00…准点触发；错过一次（如电脑睡眠）不影响后续准点
      </template>
      <template v-else>
        从创建时刻起每隔一个间隔触发。例：10:30 创建、每小时 → 11:30、12:30…
      </template>
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

.time-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tip-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
  font-size: 10px;
  cursor: help;
  user-select: none;
}

.day-ranges {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.day-range-block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.day-range-label {
  flex-shrink: 0;
  width: 36px;
  line-height: 24px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.day-range-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.interval-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.form-tip {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-top: 6px;
  line-height: 1.5;
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
