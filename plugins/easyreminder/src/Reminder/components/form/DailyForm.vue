<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { WEEKDAY_LABELS } from '../../../types/reminder'

const props = defineProps<{
  initialWeekdays?: number[]
  initialTime?: string
}>()

const emit = defineEmits<{
  update: [data: { weekdays: number[]; time: string }]
}>()

const weekdays = ref<number[]>([])
const dailyTime = ref('09:00')

function initDefaults() {
  weekdays.value = props.initialWeekdays ? [...props.initialWeekdays] : []
  dailyTime.value = props.initialTime || '09:00'
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

function validate(): boolean {
  if (weekdays.value.length === 0) {
    ElMessage.warning('请选择至少一个星期')
    return false
  }
  return true
}

function getData() {
  return {
    weekdays: [...weekdays.value],
    triggerTime: dailyTime.value
  }
}

onMounted(() => {
  initDefaults()
})

watch(() => [props.initialWeekdays, props.initialTime], () => {
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
  <div class="form-item">
    <label>提醒时间</label>
    <el-input v-model="dailyTime" type="time" />
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
</style>
