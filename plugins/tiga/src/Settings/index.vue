<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { Config, DEFAULT_CONFIG, STORAGE_KEYS, NotificationText, NORMAL_TEXTS, FUNNY_TEXTS } from '../types'

const props = defineProps<{
  enterAction: any
  config: Config
}>()

const emit = defineEmits<{
  (e: 'update:config', config: Config): void
}>()

// 本地配置状态
const localConfig = ref<Config>({ ...props.config })

// 确保文案列表存在
if (!localConfig.value.normalTexts) {
  localConfig.value.normalTexts = [...NORMAL_TEXTS]
}
if (!localConfig.value.funnyTexts) {
  localConfig.value.funnyTexts = [...FUNNY_TEXTS]
}

// 文案添加对话框
const showAddTextDialog = ref(false)
const addingTextType = ref<'normal' | 'funny'>('normal')
const newText = ref<NotificationText>({ title: '', body: '' })

// 计算运动总时长（秒）
const exerciseTotalSeconds = computed(() => {
  const { contractSeconds, relaxSeconds, repeatCount } = localConfig.value.exercise
  return (contractSeconds + relaxSeconds) * repeatCount
})

// 运动总时长转换为分钟
const exerciseTotalMinutes = computed(() => {
  return exerciseTotalSeconds.value / 60
})

// 检查运动时长是否超过间隔时间
const isExerciseTooLong = computed(() => {
  return exerciseTotalMinutes.value > localConfig.value.interval
})

// 格式化时长显示
const formatDuration = (seconds: number) => {
  if (seconds < 60) {
    return `${seconds}秒`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (remainingSeconds === 0) {
    return `${minutes}分钟`
  }
  return `${minutes}分${remainingSeconds}秒`
}

// 时段配置状态
const multiTimeSlots = ref<Array<{ start: string; end: string }>>([])
const weeklySlots = ref<Array<{ start: string; end: string; days: number[] }>>([
  { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }
])

const weekDays = [
  { key: 1, label: '一' },
  { key: 2, label: '二' },
  { key: 3, label: '三' },
  { key: 4, label: '四' },
  { key: 5, label: '五' },
  { key: 6, label: '六' },
  { key: 0, label: '日' },
]

// 保存配置
const saveConfig = () => {
  // 同步时段配置
  if (localConfig.value.workTimeMode === 'multi') {
    localConfig.value.workTime.multi = multiTimeSlots.value
  } else if (localConfig.value.workTimeMode === 'weekly') {
    // 将 weeklySlots 转换为 weekly 格式
    const weekly: Record<number, { start: string; end: string } | null> = {
      0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null
    }
    for (const slot of weeklySlots.value) {
      for (const day of slot.days) {
        // 如果该天已有配置，取时间段的交集或第一个
        if (!weekly[day]) {
          weekly[day] = { start: slot.start, end: slot.end }
        }
      }
    }
    localConfig.value.workTime.weekly = weekly
  }

  // 使用 JSON 序列化确保对象可克隆
  const configToSave = JSON.parse(JSON.stringify(localConfig.value))
  window.services.setItem(STORAGE_KEYS.config, configToSave)
  emit('update:config', configToSave)

  // 更新定时器
  if (localConfig.value.enabled) {
    window.services.startTimer(localConfig.value.interval)
  } else {
    window.services.stopTimer()
  }

  ElMessage.success('设置已保存')
}

// 添加时段
const addTimeSlot = () => {
  multiTimeSlots.value.push({ start: '09:00', end: '12:00' })
}

// 删除时段
const removeTimeSlot = (index: number) => {
  multiTimeSlots.value.splice(index, 1)
}

// 清除历史数据
const clearHistory = () => {
  ElMessageBox.confirm('确定要清除所有历史数据吗？此操作不可恢复。', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    window.services.removeItem(STORAGE_KEYS.stats)
    ElMessage.success('历史数据已清除')
  }).catch(() => {})
}

// 恢复默认设置
const restoreDefaults = () => {
  ElMessageBox.confirm('确定要恢复默认设置吗？当前配置将被覆盖。', '恢复默认设置', {
    confirmButtonText: '确定恢复',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    localConfig.value = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    const configToSave = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    window.services.setItem(STORAGE_KEYS.config, configToSave)
    emit('update:config', configToSave)
    window.services.startTimer(configToSave.interval)
    ElMessage.success('已恢复默认设置')
  }).catch(() => {})
}

// 添加文案（根据当前风格）
const addText = () => {
  if (localConfig.value.style === 'normal') {
    addingTextType.value = 'normal'
  } else if (localConfig.value.style === 'funny') {
    addingTextType.value = 'funny'
  } else {
    // 随机模式，让用户选择添加到哪个分组
    ElMessageBox.confirm('添加到哪个分组？', '选择分组', {
      confirmButtonText: '正经',
      cancelButtonText: '搞怪',
      type: 'info',
    }).then(() => {
      addingTextType.value = 'normal'
      newText.value = { title: '', body: '' }
      showAddTextDialog.value = true
    }).catch(() => {
      addingTextType.value = 'funny'
      newText.value = { title: '', body: '' }
      showAddTextDialog.value = true
    })
    return
  }

  newText.value = { title: '', body: '' }
  showAddTextDialog.value = true
}

// 确认添加文案
const confirmAddText = () => {
  if (!newText.value.title.trim() || !newText.value.body.trim()) {
    ElMessage.warning('标题和内容不能为空')
    return
  }

  if (addingTextType.value === 'normal') {
    localConfig.value.normalTexts.push({ ...newText.value })
  } else {
    localConfig.value.funnyTexts.push({ ...newText.value })
  }

  showAddTextDialog.value = false
  ElMessage.success('文案已添加')
}

// 删除正经文案
const removeNormalText = (index: number) => {
  localConfig.value.normalTexts.splice(index, 1)
}

// 删除搞怪文案
const removeFunnyText = (index: number) => {
  localConfig.value.funnyTexts.splice(index, 1)
}

// 初始化时段配置
onMounted(() => {
  const workTime = localConfig.value.workTime
  if (localConfig.value.workTimeMode === 'multi') {
    // 防御性检查：兼容旧版本配置缺失 multi 字段
    multiTimeSlots.value = workTime && Array.isArray(workTime.multi)
      ? [...workTime.multi]
      : []
  } else if (localConfig.value.workTimeMode === 'weekly') {
    // 防御性检查：兼容从不包含 weekly 字段的旧版本升级
    const weekly = workTime && workTime.weekly ? workTime.weekly : {}
    // 从 weekly 配置恢复 weeklySlots
    const slots: Array<{ start: string; end: string; days: number[] }> = []
    const dayMap: Record<number, { start: string; end: string }> = {}
    for (const [day, config] of Object.entries(weekly)) {
      if (config) {
        dayMap[Number(day)] = config
      }
    }
    // 按时间段分组
    const slotMap: Record<string, number[]> = {}
    for (const [day, config] of Object.entries(dayMap)) {
      const key = `${config.start}-${config.end}`
      if (!slotMap[key]) slotMap[key] = []
      slotMap[key].push(Number(day))
    }
    for (const [key, days] of Object.entries(slotMap)) {
      const [start, end] = key.split('-')
      slots.push({ start, end, days })
    }
    if (slots.length > 0) {
      weeklySlots.value = slots
    }
  }
})

// 监听工作时段模式切换，自动填充默认时段
watch(() => localConfig.value.workTimeMode, (newMode) => {
  if (newMode === 'multi' && multiTimeSlots.value.length === 0) {
    multiTimeSlots.value = [{ start: '09:00', end: '12:00' }]
  }
  if (newMode === 'weekly' && weeklySlots.value.length === 0) {
    weeklySlots.value = [{ start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }]
  }
})

// 添加周几时段
const addWeeklySlot = () => {
  weeklySlots.value.push({ start: '09:00', end: '18:00', days: [] })
}

// 删除周几时段
const removeWeeklySlot = (index: number) => {
  weeklySlots.value.splice(index, 1)
}
</script>

<template>
  <div class="settings">
    <h1>提肛助手 - 设置</h1>

    <div class="settings-grid">
      <!-- 提醒间隔 -->
      <el-card class="setting-card">
      <template #header>
        <span>⏱ 提醒间隔</span>
      </template>
      <el-input-number v-model="localConfig.interval" :min="1" :max="120" />
      <span style="margin-left: 8px">分钟</span>
    </el-card>

    <!-- 工作时段 -->
    <el-card class="setting-card">
      <template #header>
        <span>📅 工作时段</span>
      </template>
      <el-select v-model="localConfig.workTimeMode" style="width: 100%">
        <el-option label="固定时段" value="single" />
        <el-option label="多时段" value="multi" />
        <el-option label="周几+时段" value="weekly" />
      </el-select>

      <!-- 固定时段 -->
      <div v-if="localConfig.workTimeMode === 'single'" class="time-range">
        <el-time-picker
          v-model="localConfig.workTime.single.start"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="开始时间"
        />
        <span style="margin: 0 8px">至</span>
        <el-time-picker
          v-model="localConfig.workTime.single.end"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="结束时间"
        />
      </div>

      <!-- 多时段 -->
      <div v-if="localConfig.workTimeMode === 'multi'" class="multi-time">
        <div v-for="(slot, index) in multiTimeSlots" :key="index" class="time-slot">
          <el-time-picker
            v-model="slot.start"
            format="HH:mm"
            value-format="HH:mm"
            placeholder="开始时间"
          />
          <span style="margin: 0 8px">至</span>
          <el-time-picker
            v-model="slot.end"
            format="HH:mm"
            value-format="HH:mm"
            placeholder="结束时间"
          />
          <el-button type="danger" size="small" @click="removeTimeSlot(index)">删除</el-button>
        </div>
        <el-button type="success" size="small" @click="addTimeSlot">+ 添加时段</el-button>
      </div>

      <!-- 周几时段 -->
      <div v-if="localConfig.workTimeMode === 'weekly'" class="weekly-time">
        <div v-for="(slot, index) in weeklySlots" :key="index" class="weekly-slot">
          <div class="slot-header">
            <span class="slot-label">时段 {{ index + 1 }}</span>
            <el-button type="danger" size="small" text @click="removeWeeklySlot(index)" :disabled="weeklySlots.length <= 1">删除</el-button>
          </div>
          <div class="slot-time">
            <el-time-picker
              v-model="slot.start"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="开始时间"
            />
            <span style="margin: 0 8px">至</span>
            <el-time-picker
              v-model="slot.end"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="结束时间"
            />
          </div>
          <div class="slot-days">
            <el-checkbox-group v-model="slot.days">
              <el-checkbox v-for="day in weekDays" :key="day.key" :value="day.key">
                周{{ day.label }}
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
        <el-button type="success" size="small" @click="addWeeklySlot">+ 添加时段</el-button>
      </div>
    </el-card>

    <!-- 提醒方式 -->
    <el-card class="setting-card">
      <template #header>
        <span>🔔 提醒方式</span>
      </template>
      <el-radio-group v-model="localConfig.reminderMode" class="vertical-radio">
        <el-radio value="notify">仅插件通知（直接弹窗）</el-radio>
        <el-radio value="notify+popup">桌面通知 + 弹窗</el-radio>
      </el-radio-group>
    </el-card>

    <!-- 计数方式 -->
    <el-card class="setting-card">
      <template #header>
        <span>📊 计数方式</span>
      </template>
      <el-radio-group v-model="localConfig.countMode">
        <el-radio value="auto">自动计数（提醒即计数）</el-radio>
        <el-radio value="manual">手动计数（需确认完成）</el-radio>
      </el-radio-group>
    </el-card>

    <!-- 运动参数 -->
    <el-card class="setting-card">
      <template #header>
        <span>🎯 运动参数</span>
      </template>
      <el-form label-width="80px" label-position="left">
        <el-form-item label="收缩时长">
          <el-input-number v-model="localConfig.exercise.contractSeconds" :min="1" :max="30" />
          <span style="margin-left: 8px">秒</span>
        </el-form-item>
        <el-form-item label="放松时长">
          <el-input-number v-model="localConfig.exercise.relaxSeconds" :min="1" :max="30" />
          <span style="margin-left: 8px">秒</span>
        </el-form-item>
        <el-form-item label="重复次数">
          <el-input-number v-model="localConfig.exercise.repeatCount" :min="1" :max="30" />
          <span style="margin-left: 8px">次</span>
        </el-form-item>
      </el-form>

      <!-- 显示运动总时长 -->
      <div class="exercise-summary">
        <span>运动总时长：</span>
        <strong :class="{ 'warning-text': isExerciseTooLong }">{{ formatDuration(exerciseTotalSeconds) }}</strong>
      </div>

      <!-- 警告提示 -->
      <el-alert
        v-if="isExerciseTooLong"
        type="warning"
        :closable="false"
        show-icon
        style="margin-top: 8px"
      >
        运动时长超过提醒间隔（{{ localConfig.interval }}分钟），可能导致下一轮提醒在运动进行时触发
      </el-alert>
    </el-card>

    <!-- 文案风格 -->
    <el-card class="setting-card">
      <template #header>
        <span>✨ 文案风格</span>
      </template>
      <el-select v-model="localConfig.style" style="width: 100%; margin-bottom: 12px">
        <el-option label="随机" value="random" />
        <el-option label="正经" value="normal" />
        <el-option label="搞怪" value="funny" />
      </el-select>

      <!-- 根据风格显示文案列表 -->
      <div class="text-section-compact">
        <div class="text-header-compact">
          <span class="text-label">{{ localConfig.style === 'normal' ? '正经' : localConfig.style === 'funny' ? '搞怪' : '全部' }}</span>
          <el-button type="primary" size="small" @click="addText">+ 添加</el-button>
        </div>

        <!-- 正经文案列表 -->
        <div v-if="localConfig.style === 'normal'" class="text-list-compact">
          <div v-for="(text, index) in localConfig.normalTexts" :key="'normal-' + index" class="text-item-compact">
            <el-tooltip :content="`${text.title} - ${text.body}`" placement="top" :show-after="300">
              <div class="text-preview-compact">{{ text.title }} - {{ text.body }}</div>
            </el-tooltip>
            <el-button type="danger" size="small" text @click="removeNormalText(index)">删除</el-button>
          </div>
        </div>

        <!-- 搞怪文案列表 -->
        <div v-if="localConfig.style === 'funny'" class="text-list-compact">
          <div v-for="(text, index) in localConfig.funnyTexts" :key="'funny-' + index" class="text-item-compact">
            <el-tooltip :content="`${text.title} - ${text.body}`" placement="top" :show-after="300">
              <div class="text-preview-compact">{{ text.title }} - {{ text.body }}</div>
            </el-tooltip>
            <el-button type="danger" size="small" text @click="removeFunnyText(index)">删除</el-button>
          </div>
        </div>

        <!-- 随机：显示所有文案 -->
        <div v-if="localConfig.style === 'random'" class="text-list-compact">
          <div v-for="(text, index) in localConfig.normalTexts" :key="'normal-' + index" class="text-item-compact">
            <el-tooltip :content="`${text.title} - ${text.body}`" placement="top" :show-after="300">
              <div class="text-preview-compact">{{ text.title }} - {{ text.body }}</div>
            </el-tooltip>
            <el-button type="danger" size="small" text @click="removeNormalText(index)">删除</el-button>
          </div>
          <div v-for="(text, index) in localConfig.funnyTexts" :key="'funny-' + index" class="text-item-compact">
            <el-tooltip :content="`${text.title} - ${text.body}`" placement="top" :show-after="300">
              <div class="text-preview-compact">{{ text.title }} - {{ text.body }}</div>
            </el-tooltip>
            <el-button type="danger" size="small" text @click="removeFunnyText(index)">删除</el-button>
          </div>
        </div>
      </div>

      <!-- 添加文案对话框 -->
      <el-dialog v-model="showAddTextDialog" title="添加文案" width="300px">
        <el-form label-width="60px">
          <el-form-item label="标题">
            <el-input v-model="newText.title" placeholder="通知标题" />
          </el-form-item>
          <el-form-item label="内容">
            <el-input v-model="newText.body" type="textarea" :rows="3" placeholder="通知内容" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showAddTextDialog = false">取消</el-button>
          <el-button type="primary" @click="confirmAddText">确定</el-button>
        </template>
      </el-dialog>
    </el-card>



    <!-- 清除历史 -->
    <el-card class="setting-card">
      <template #header>
        <span>🗑 清除历史数据</span>
      </template>
      <el-button type="danger" @click="clearHistory">清除所有记录</el-button>
    </el-card>

    <!-- 恢复默认 -->
    <el-card class="setting-card">
      <template #header>
        <span>🔄 恢复默认设置</span>
      </template>
      <el-button type="warning" @click="restoreDefaults">恢复默认设置</el-button>
      <p class="setting-hint">将所有设置重置为初始推荐值</p>
    </el-card>
    </div>

    <!-- 保存按钮 -->
    <el-button type="primary" size="large" style="width: 100%; margin-top: 20px" @click="saveConfig">
      保存设置
    </el-button>
  </div>
</template>

<style scoped>
.settings {
  padding: 20px;
  max-width: 800px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

h1 {
  margin-bottom: 20px;
  font-size: 18px;
}

.setting-card {
  /* grid gap handles spacing */
}

.time-range {
  display: flex;
  align-items: center;
  margin-top: 12px;
}

.multi-time .time-slot {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.weekly-time .day-config {
  margin-bottom: 12px;
}

.weekly-time .day-config .time-range {
  margin-top: 8px;
}

.weekly-slot {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.slot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.slot-label {
  font-size: 13px;
  font-weight: 500;
}

.slot-time {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.slot-days {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.exercise-summary {
  padding: 8px 0;
  color: #606266;
}

.warning-text {
  color: #e6a23c;
}

.setting-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.vertical-radio {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.vertical-radio .el-radio {
  margin-right: 0;
  margin-bottom: 8px;
  margin-left: 0;
}

.setting-card.full-width {
  grid-column: span 2;
}

.text-section-compact {
  margin-top: 8px;
}

.text-header-compact {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.text-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.text-list-compact {
  max-height: 150px;
  overflow-y: auto;
}

.text-item-compact {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  margin-bottom: 4px;
  background: var(--el-fill-color-light);
  border-radius: 3px;
}

.text-preview-compact {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-section {
  margin-top: 16px;
}

.text-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
}

.text-list {
  max-height: 200px;
  overflow-y: auto;
}

.text-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 8px;
  margin-bottom: 8px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.text-content {
  flex: 1;
  padding-right: 8px;
}

.text-title {
  font-weight: 500;
  margin-bottom: 4px;
}

.text-body {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.text-group-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 8px 0 4px;
}
</style>