<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  initialDate?: string
  initialTime?: string
}>()

const emit = defineEmits<{
  update: [data: { date: string; time: string }]
}>()

const onceDate = ref('')
const onceTime = ref('09:00')

function initDefaults() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  onceDate.value = props.initialDate || tomorrow.toISOString().slice(0, 10)
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
  if (triggerAt <= Date.now()) {
    ElMessage.warning('提醒时间必须在当前时间之后')
    return false
  }
  
  return true
}

function getData() {
  return {
    date: onceDate.value,
    time: onceTime.value,
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
