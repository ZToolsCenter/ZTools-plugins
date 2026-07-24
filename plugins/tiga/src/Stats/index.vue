<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { StatsData, Config, STORAGE_KEYS, calculateStreak, getTodayDate } from '../types'

const props = defineProps<{
  enterAction: any
  config: Config
}>()

const emit = defineEmits<{
  (e: 'update:config', config: Config): void
}>()

const stats = ref<StatsData>({ records: [] })

// 防御性获取记录数组（兼容存储损坏或旧版本数据格式不完整）
const records = computed(() => stats.value.records || [])

// 今日完成次数
const todayCount = computed(() => {
  const today = getTodayDate()
  const record = records.value.find(r => r.date === today)
  return record?.count || 0
})

// 今日完成时间
const todayTimes = computed(() => {
  const today = getTodayDate()
  const record = records.value.find(r => r.date === today)
  return record?.times || []
})

// 连续打卡天数
const streakDays = computed(() => {
  return calculateStreak(records.value)
})

// 总打卡天数（有记录的天数）
const totalDays = computed(() => {
  return records.value.filter(r => r.count > 0).length
})

// 总完成次数
const totalCount = computed(() => {
  return records.value.reduce((sum, r) => sum + r.count, 0)
})

// 历史记录（按日期降序）
const sortedRecords = computed(() => {
  return [...records.value].sort((a, b) => b.date.localeCompare(a.date))
})

// 运行状态
const enabled = computed(() => props.config.enabled)

// 切换运行状态
const toggleEnabled = (val: boolean) => {
  const newConfig = JSON.parse(JSON.stringify(props.config))
  newConfig.enabled = val
  window.services.setItem(STORAGE_KEYS.config, newConfig)
  emit('update:config', newConfig)

  if (newConfig.enabled) {
    window.services.startTimer(newConfig.interval)
  } else {
    window.services.stopTimer()
  }
}

// 加载统计数据
const loadStats = () => {
  const savedStats = window.services.getItem(STORAGE_KEYS.stats)
  if (savedStats && Array.isArray(savedStats.records)) {
    stats.value = savedStats
  }
}

onMounted(() => {
  loadStats()
})
</script>

<template>
  <div class="stats">
    <h1>提肛助手 - 统计</h1>

    <!-- 运行状态 -->
    <div class="status-bar">
      <div class="status-info">
        <span class="status-icon">{{ enabled ? '🟢' : '🔴' }}</span>
        <span class="status-text">{{ enabled ? '运行中' : '已暂停' }}</span>
      </div>
      <el-switch
        :model-value="enabled"
        @change="toggleEnabled"
        active-text="开启"
        inactive-text="暂停"
      />
    </div>

    <div class="stats-grid">
      <!-- 今日统计 -->
      <el-card class="stats-card">
        <template #header>
          <span>📈 今日统计</span>
        </template>
        <div class="stat-item">
          <span class="stat-label">今日完成</span>
          <el-tag type="primary" size="large">{{ todayCount }} 次</el-tag>
        </div>
        <!-- 今日完成时间列表 -->
        <div v-if="todayTimes.length > 0" class="today-times">
          <div v-for="(time, index) in todayTimes" :key="index" class="time-item">
            <span class="time-index">第 {{ index + 1 }} 次</span>
            <span class="time-value">{{ time }}</span>
          </div>
        </div>
      </el-card>

      <!-- 打卡统计 -->
      <el-card class="stats-card">
        <template #header>
          <span>🔥 打卡统计</span>
        </template>
        <div class="stat-item">
          <span class="stat-label">连续打卡</span>
          <el-tag type="success" size="large">{{ streakDays }} 天</el-tag>
        </div>
        <div class="stat-item">
          <span class="stat-label">总打卡天数</span>
          <el-tag type="warning" size="large">{{ totalDays }} 天</el-tag>
        </div>
        <div class="stat-item">
          <span class="stat-label">总完成次数</span>
          <el-tag type="info" size="large">{{ totalCount }} 次</el-tag>
        </div>
      </el-card>

      <!-- 历史记录 -->
      <el-card class="stats-card full-width">
        <template #header>
          <span>📋 历史记录</span>
        </template>
        <el-empty v-if="sortedRecords.length === 0" description="暂无记录，开始你的第一次提肛吧！" />
        <el-table v-else :data="sortedRecords" style="width: 100%" max-height="200">
          <el-table-column prop="date" label="日期" />
          <el-table-column prop="count" label="完成次数">
            <template #default="{ row }">
              <el-tag type="primary">{{ row.count }} 次</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间点">
            <template #default="{ row }">
              <span class="times-text">{{ (row.times || []).join('、') }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 提示 -->
    <p class="footer-note">打卡记录长期保留，可到设置页清除</p>
  </div>
</template>

<style scoped>
.stats {
  padding: 20px;
  max-width: 800px;
}

.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-icon {
  font-size: 20px;
}

.status-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

h1 {
  margin-bottom: 20px;
  font-size: 18px;
}

.stats-card {
  /* grid gap handles spacing */
}

.stats-card.full-width {
  grid-column: span 2;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  font-size: 14px;
}

.stat-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.today-times {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.time-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}

.time-index {
  color: var(--el-text-color-secondary);
}

.time-value {
  font-weight: 500;
  color: var(--el-color-primary);
}

.times-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.footer-note {
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 16px;
}
</style>