<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  initialDate?: string
  initialTime?: string
  // 编辑已有任务里的历史一次性规则时传原始时刻：时刻没改动就允许保留过去的值，
  // 否则整条任务都保存不了；一旦改成别的过去时刻仍然拦下
  originalTriggerAt?: number
}>()

const onceDate = ref('')
const onceTime = ref('09:00')

function initDefaults() {
  // 默认今天（本地时区，不能用 toISOString——那是 UTC，凌晨时段会错一天）
  const now = new Date()
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
  onceDate.value = props.initialDate || today
  onceTime.value = props.initialTime || '09:00'
}

function buildTriggerAt(): number {
  return new Date(`${onceDate.value}T${onceTime.value}:00`).getTime()
}

function validate(): boolean {
  if (!onceDate.value) {
    ElMessage.warning('请选择提醒日期')
    return false
  }
  
  const triggerAt = buildTriggerAt()
  // 时间输入允许被清空（原生 time input 可整段删掉），此时 buildTriggerAt 是 NaN：
  // 存下去会变成 triggerAt=0 的「永不触发」规则，必须拦下
  if (!Number.isFinite(triggerAt)) {
    ElMessage.warning('请填写有效的提醒时间')
    return false
  }
  if (triggerAt <= Date.now() && triggerAt !== props.originalTriggerAt) {
    ElMessage.warning('提醒时间必须在当前时间之后')
    return false
  }
  
  return true
}

function getData() {
  return {
    triggerAt: buildTriggerAt()
  }
}

onMounted(() => {
  initDefaults()
})

watch(() => [props.initialDate, props.initialTime], () => {
  initDefaults()
})

defineExpose({
  validate,
  getData
})
</script>

<template>
  <div class="form-item form-row">
    <div class="form-col">
      <label>提醒日期</label>
      <el-date-picker 
        v-model="onceDate" 
        type="date" 
        placeholder="选择日期" 
        value-format="YYYY-MM-DD" 
        style="width: 100%" 
      />
    </div>
    <div class="form-col">
      <label>提醒时间</label>
      <el-input v-model="onceTime" type="time" />
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

.form-row {
  display: flex;
  gap: 12px;
}

.form-col {
  flex: 1;
}
</style>
