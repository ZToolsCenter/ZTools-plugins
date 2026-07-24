# 提肛助手插件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现提肛助手 Ztools 插件，支持定时提醒、运动引导、统计打卡、教程指南。

**Architecture:** Vue 3 组件化架构，preload 层提供 Node.js 服务（定时器、存储、通知），Vue 层通过 IPC 事件与 preload 层通信。设置页面为主入口，统计、教程为独立页面，运动引导为弹窗组件。

**Tech Stack:** Vue 3 + TypeScript + Vite + Ztools API

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/types.ts` | 类型定义（Config、StatsData、文案等） |
| `public/preload/services.js` | Node.js 服务层（定时器、存储、通知） |
| `public/plugin.json` | 插件配置（features 入口定义） |
| `src/App.vue` | 路由入口（监听 IPC 事件、组件切换） |
| `src/Settings/index.vue` | 设置页面（配置项 UI + 存储） |
| `src/Stats/index.vue` | 统计页面（今日完成、打卡、历史） |
| `src/ExerciseGuide/index.vue` | 运动引导弹窗（倒计时 + 进度） |
| `src/Tutorial/index.vue` | 教程页面（渲染 markdown） |
| `src/assets/tutorial.md` | 教程内容 |

---

## Task 1: 类型定义

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// src/types.ts

// 配置数据
export interface Config {
  // 提醒设置
  interval: number              // 提醒间隔（分钟），默认 30
  workTimeMode: 'single' | 'multi' | 'weekly'  // 工作时段模式
  workTime: WorkTimeConfig
  
  // 提醒与计数
  reminderMode: 'notify' | 'notify+popup'  // 仅通知 / 通知+弹窗
  countMode: 'auto' | 'manual'             // 自动计数 / 手动计数
  
  // 运动参数
  exercise: {
    contractSeconds: number    // 收缩时长（秒）
    relaxSeconds: number       // 放松时长（秒）
    repeatCount: number        // 重复次数
  }
  
  // 文案风格
  style: 'random' | 'normal' | 'funny'
  
  // 运行状态
  enabled: boolean             // 开关启停
}

// 工作时段配置
export interface WorkTimeConfig {
  single: { start: string; end: string }
  multi: Array<{ start: string; end: string }>
  weekly: Record<number, { start: string; end: string } | null>
}

// 统计数据
export interface StatsData {
  records: Array<{
    date: string      // YYYY-MM-DD
    count: number     // 当日完成次数
  }>
}

// 通知文案
export interface NotificationText {
  title: string
  body: string
}

// 默认配置
export const DEFAULT_CONFIG: Config = {
  interval: 30,
  workTimeMode: 'single',
  workTime: {
    single: { start: '09:00', end: '18:00' },
    multi: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    weekly: {
      0: null,  // 周日
      1: { start: '09:00', end: '18:00' },
      2: { start: '09:00', end: '18:00' },
      3: { start: '09:00', end: '18:00' },
      4: { start: '09:00', end: '18:00' },
      5: { start: '09:00', end: '18:00' },
      6: null,  // 周六
    }
  },
  reminderMode: 'notify+popup',
  countMode: 'manual',
  exercise: {
    contractSeconds: 5,
    relaxSeconds: 5,
    repeatCount: 10
  },
  style: 'random',
  enabled: true
}

// 存储键名
export const STORAGE_KEYS = {
  config: 'tiga_config',
  stats: 'tiga_stats'
}

// 正经文案
export const NORMAL_TEXT: NotificationText = {
  title: '提肛提醒',
  body: '久坐伤身，该做提肛运动了，关爱您的盆底健康。'
}

// 搞怪文案池
export const FUNNY_TEXTS: NotificationText[] = [
  { title: '盆底肌呼叫中心', body: '您的盆底肌已欠费停机，请立即充值（提肛）恢复服务！' },
  { title: '提肛小助手', body: '别坐了别坐了，屁股要废了！起来动一动，提肛保健康！' },
  { title: '健康警报', body: '警告：您的臀部已连续静止太久，建议立即启动提肛程序！' },
  { title: '提肛时间到', body: '收缩、放松，让盆底肌跳起健康的舞蹈！' },
  { title: '盆底健康守护', body: '提肛一分钟，健康一整天！现在就开始吧～' },
  { title: '久坐预警', body: '您的屁股正在酝酿抗议，请立即安抚（提肛）！' },
  { title: '提肛大使', body: '来自未来的你发来消息：感谢现在坚持提肛的我！' },
  { title: '健康投递', body: '叮咚！您的盆底健康快递已送达，请签收（提肛）！' },
  { title: '提肛站', body: '下一站：提肛站。请各位乘客做好准备，收缩放松！' },
  { title: '盆底健身房', body: '您有一张免费的盆底健身券，有效期：现在！' }
]

// 获取随机文案
export function getRandomText(style: Config['style']): NotificationText {
  if (style === 'normal') {
    return NORMAL_TEXT
  }
  
  const allTexts = [NORMAL_TEXT, ...FUNNY_TEXTS]
  
  if (style === 'funny') {
    const index = Math.floor(Math.random() * FUNNY_TEXTS.length)
    return FUNNY_TEXTS[index]
  }
  
  // random: 从全部文案中随机
  const index = Math.floor(Math.random() * allTexts.length)
  return allTexts[index]
}

// 计算连续打卡天数
export function calculateStreak(records: StatsData['records']): number {
  if (!records.length) return 0
  
  const today = new Date().toISOString().split('T')[0]
  let streak = 0
  let checkDate = new Date(today)
  
  // 按日期降序排序
  const sortedRecords = [...records].sort((a, b) => b.date.localeCompare(a.date))
  
  for (let i = 0; i < 365; i++) {  // 最多检查一年
    const dateStr = checkDate.toISOString().split('T')[0]
    const record = sortedRecords.find(r => r.date === dateStr)
    
    if (record && record.count > 0) {
      streak++
    } else if (record && record.count === 0) {
      break  // 有记录但 count=0，中断
    }
    // 无记录的日期跳过（不算中断）
    
    checkDate.setDate(checkDate.getDate() - 1)
  }
  
  return streak
}

// 获取今日日期字符串
export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add type definitions and utility functions"
```

---

## Task 2: preload 服务层

**Files:**
- Modify: `public/preload/services.js`

- [ ] **Step 1: 扩展 preload 服务层**

```javascript
// public/preload/services.js
const fs = require('node:fs')
const path = require('node:path')

// 存储文件路径
const getStoragePath = (key) => {
  const userDataPath = window.ztools.getPath('userData')
  return path.join(userDataPath, `tiga_${key}.json`)
}

// 桌面通知点击回调存储
let notificationClickCallback = null

window.services = {
  // ===== 定时器管理 =====
  timerId: null,
  
  startTimer(intervalMinutes) {
    if (this.timerId) {
      clearInterval(this.timerId)
    }
    this.timerId = setInterval(() => {
      this._onTimerTick()
    }, intervalMinutes * 60 * 1000)
  },
  
  stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
  },
  
  _onTimerTick() {
    // 通知 Vue 层定时器触发
    window.ztools.ipcSend('tiga_timer_tick')
  },
  
  // ===== 工作时段判断 =====
  isInWorkTime(workTimeConfig, workTimeMode) {
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`
    const currentDay = now.getDay()  // 0-6, 0=周日
    
    const isInRange = (start, end) => {
      return currentTimeStr >= start && currentTimeStr <= end
    }
    
    if (workTimeMode === 'single') {
      return isInRange(workTimeConfig.single.start, workTimeConfig.single.end)
    }
    
    if (workTimeMode === 'multi') {
      return workTimeConfig.multi.some(period => 
        isInRange(period.start, period.end)
      )
    }
    
    if (workTimeMode === 'weekly') {
      const dayConfig = workTimeConfig.weekly[currentDay]
      if (!dayConfig) return false  // 该天未配置或为 null
      return isInRange(dayConfig.start, dayConfig.end)
    }
    
    return false
  },
  
  // ===== 桌面通知 =====
  sendNotification(title, body) {
    const notification = new Notification(title, {
      body: body,
      requireInteraction: true  // 保持通知不自动消失
    })
    
    notification.onclick = () => {
      // 通知 Vue 层通知被点击
      window.ztools.ipcSend('tiga_notification_clicked')
      notification.close()
      window.ztools.showMainWindow()
    }
  },
  
  // ===== 存储 API =====
  getItem(key) {
    const filePath = getStoragePath(key)
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
        return JSON.parse(content)
      }
    } catch (e) {
      console.error('Failed to read storage:', e)
    }
    return null
  },
  
  setItem(key, value) {
    const filePath = getStoragePath(key)
    try {
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { encoding: 'utf-8' })
    } catch (e) {
      console.error('Failed to write storage:', e)
    }
  },
  
  removeItem(key) {
    const filePath = getStoragePath(key)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (e) {
      console.error('Failed to remove storage:', e)
    }
  },
  
  // ===== 初始化 =====
  init() {
    // 读取配置，如果存在则启动定时器
    const config = this.getItem('tiga_config')
    if (config && config.enabled) {
      this.startTimer(config.interval)
    }
  }
}

// 初始化
window.services.init()
```

- [ ] **Step 2: Commit**

```bash
git add public/preload/services.js
git commit -m "feat: extend preload services with timer, notification and storage"
```

---

## Task 3: plugin.json 配置

**Files:**
- Modify: `public/plugin.json`

- [ ] **Step 1: 更新 plugin.json**

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "tiga",
  "title": "提肛助手",
  "description": "定时提醒提肛运动，关爱久坐族盆底健康",
  "author": "咖啡八杯",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "settings",
      "explain": "提肛助手设置",
      "icon": "logo.png",
      "cmds": ["提肛", "提肛助手", "提肛设置"]
    },
    {
      "code": "stats",
      "explain": "查看提肛统计",
      "icon": "logo.png",
      "cmds": ["提肛统计"]
    },
    {
      "code": "tutorial",
      "explain": "提肛运动教程",
      "icon": "logo.png",
      "cmds": ["提肛教程"]
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add public/plugin.json
git commit -m "feat: update plugin.json with tiga features"
```

---

## Task 4: App.vue 路由入口

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 更新 App.vue 路由**

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import Settings from './Settings/index.vue'
import Stats from './Stats/index.vue'
import Tutorial from './Tutorial/index.vue'
import ExerciseGuide from './ExerciseGuide/index.vue'
import { Config, DEFAULT_CONFIG, STORAGE_KEYS } from './types'

const route = ref('')
const enterAction = ref<any>({})
const showExerciseGuide = ref(false)
const config = ref<Config>(DEFAULT_CONFIG)

// 加载配置
const loadConfig = async () => {
  const savedConfig = await window.services.getItem(STORAGE_KEYS.config)
  if (savedConfig) {
    config.value = { ...DEFAULT_CONFIG, ...savedConfig }
  }
}

// 监听定时器触发
const handleTimerTick = async () => {
  // 检查是否启用
  if (!config.value.enabled) return
  
  // 检查是否在工作时段
  const inWorkTime = window.services.isInWorkTime(config.value.workTime, config.value.workTimeMode)
  if (!inWorkTime) return
  
  // 发送通知
  const { getRandomText } = await import('./types')
  const text = getRandomText(config.value.style)
  window.services.sendNotification(text.title, text.body)
  
  // 自动计数模式：直接增加计数
  if (config.value.countMode === 'auto') {
    addCount()
  }
}

// 监听通知点击
const handleNotificationClick = () => {
  // 弹窗模式：显示运动引导
  if (config.value.reminderMode === 'notify+popup') {
    showExerciseGuide.value = true
    window.ztools.showMainWindow()
  }
}

// 增加计数
const addCount = async () => {
  const { getTodayDate, STORAGE_KEYS } = await import('./types')
  const today = getTodayDate()
  const stats = await window.services.getItem(STORAGE_KEYS.stats) || { records: [] }
  
  const todayRecord = stats.records.find(r => r.date === today)
  if (todayRecord) {
    todayRecord.count++
  } else {
    stats.records.push({ date: today, count: 1 })
  }
  
  await window.services.setItem(STORAGE_KEYS.stats, stats)
}

// 运动完成回调
const handleExerciseComplete = async () => {
  showExerciseGuide.value = false
  await addCount()
}

// 运动跳过回调
const handleExerciseSkip = () => {
  showExerciseGuide.value = false
}

onMounted(async () => {
  await loadConfig()
  
  // 监听插件进入
  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
  })
  
  // 监听插件退出
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
  
  // 监听定时器事件
  window.ztools.ipcOn('tiga_timer_tick', handleTimerTick)
  
  // 监听通知点击事件
  window.ztools.ipcOn('tiga_notification_clicked', handleNotificationClick)
})

onUnmounted(() => {
  window.ztools.ipcOff('tiga_timer_tick', handleTimerTick)
  window.ztools.ipcOff('tiga_notification_clicked', handleNotificationClick)
})
</script>

<template>
  <Settings v-if="route === 'settings'" :enter-action="enterAction" :config="config" />
  <Stats v-if="route === 'stats'" :enter-action="enterAction" />
  <Tutorial v-if="route === 'tutorial'" :enter-action="enterAction" />
  <ExerciseGuide 
    v-if="showExerciseGuide" 
    :exercise="config.exercise"
    @complete="handleExerciseComplete"
    @skip="handleExerciseSkip"
  />
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/App.vue
git commit -m "feat: update App.vue with routing and IPC event handling"
```

---

## Task 5: Settings 设置页面

**Files:**
- Create: `src/Settings/index.vue`

- [ ] **Step 1: 创建 Settings 页面**

```vue
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { Config, DEFAULT_CONFIG, STORAGE_KEYS } from '../types'

const props = defineProps<{
  enterAction: any
  config: Config
}>()

const emit = defineEmits<{
  (e: 'update:config', config: Config): void
}>()

// 本地配置状态
const localConfig = ref<Config>({ ...props.config })

// 时段配置状态
const multiTimeSlots = ref<Array<{ start: string; end: string }>>([])
const weeklyConfig = ref<Record<number, { start: string; end: string } | null>>({
  0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null
})

const weekDays = [
  { key: 1, label: '周一' },
  { key: 2, label: '周二' },
  { key: 3, label: '周三' },
  { key: 4, label: '周四' },
  { key: 5, label: '周五' },
  { key: 6, label: '周六' },
  { key: 0, label: '周日' },
]

// 保存配置
const saveConfig = async () => {
  // 同步时段配置
  if (localConfig.value.workTimeMode === 'multi') {
    localConfig.value.workTime.multi = multiTimeSlots.value
  } else if (localConfig.value.workTimeMode === 'weekly') {
    localConfig.value.workTime.weekly = weeklyConfig.value
  }
  
  await window.services.setItem(STORAGE_KEYS.config, localConfig.value)
  emit('update:config', localConfig.value)
  
  // 更新定时器
  if (localConfig.value.enabled) {
    window.services.startTimer(localConfig.value.interval)
  } else {
    window.services.stopTimer()
  }
  
  window.ztools.showTip('设置已保存')
}

// 添加时段
const addTimeSlot = () => {
  multiTimeSlots.value.push({ start: '09:00', end: '12:00' })
}

// 删除时段
const removeTimeSlot = (index: number) => {
  multiTimeSlots.value.splice(index, 1)
}

// 清除历史数据确认
const showClearConfirm = ref(false)
const clearHistory = async () => {
  await window.services.removeItem(STORAGE_KEYS.stats)
  showClearConfirm.value = false
  window.ztools.showTip('历史数据已清除')
}

// 初始化时段配置
onMounted(() => {
  if (localConfig.value.workTimeMode === 'multi') {
    multiTimeSlots.value = [...localConfig.value.workTime.multi]
  } else if (localConfig.value.workTimeMode === 'weekly') {
    weeklyConfig.value = { ...localConfig.value.workTime.weekly }
  }
})

// 监听配置变化
watch(localConfig, (newConfig) => {
  if (newConfig.workTimeMode === 'multi' && multiTimeSlots.value.length === 0) {
    multiTimeSlots.value = [{ start: '09:00', end: '12:00' }]
  }
}, { deep: true })
</script>

<template>
  <div class="settings">
    <h1>提肛助手 - 设置</h1>
    
    <!-- 提醒间隔 -->
    <section class="setting-section">
      <h3>⏱ 提醒间隔</h3>
      <div class="setting-row">
        <input 
          type="number" 
          v-model.number="localConfig.interval" 
          min="1" 
          max="120"
        />
        <span>分钟</span>
      </div>
    </section>
    
    <!-- 工作时段 -->
    <section class="setting-section">
      <h3>📅 工作时段</h3>
      <div class="setting-row">
        <select v-model="localConfig.workTimeMode">
          <option value="single">固定时段</option>
          <option value="multi">多时段</option>
          <option value="weekly">周几+时段</option>
        </select>
      </div>
      
      <!-- 固定时段 -->
      <div v-if="localConfig.workTimeMode === 'single'" class="time-range">
        <input type="time" v-model="localConfig.workTime.single.start" />
        <span>至</span>
        <input type="time" v-model="localConfig.workTime.single.end" />
      </div>
      
      <!-- 多时段 -->
      <div v-if="localConfig.workTimeMode === 'multi'" class="multi-time">
        <div v-for="(slot, index) in multiTimeSlots" :key="index" class="time-slot">
          <input type="time" v-model="slot.start" />
          <span>至</span>
          <input type="time" v-model="slot.end" />
          <button @click="removeTimeSlot(index)" class="remove-btn">删除</button>
        </div>
        <button @click="addTimeSlot" class="add-btn">+ 添加时段</button>
      </div>
      
      <!-- 周几时段 -->
      <div v-if="localConfig.workTimeMode === 'weekly'" class="weekly-time">
        <div v-for="day in weekDays" :key="day.key" class="day-config">
          <label>
            <input 
              type="checkbox" 
              :checked="weeklyConfig[day.key] !== null"
              @change="weeklyConfig[day.key] = $event.target.checked ? { start: '09:00', end: '18:00' } : null"
            />
            {{ day.label }}
          </label>
          <div v-if="weeklyConfig[day.key]" class="time-range">
            <input type="time" v-model="weeklyConfig[day.key].start" />
            <span>至</span>
            <input type="time" v-model="weeklyConfig[day.key].end" />
          </div>
        </div>
      </div>
    </section>
    
    <!-- 提醒方式 -->
    <section class="setting-section">
      <h3>🔔 提醒方式</h3>
      <div class="radio-group">
        <label>
          <input type="radio" v-model="localConfig.reminderMode" value="notify" />
          仅桌面通知
        </label>
        <label>
          <input type="radio" v-model="localConfig.reminderMode" value="notify+popup" />
          桌面通知 + 弹窗
        </label>
      </div>
    </section>
    
    <!-- 计数方式 -->
    <section class="setting-section">
      <h3>📊 计数方式</h3>
      <div class="radio-group">
        <label>
          <input type="radio" v-model="localConfig.countMode" value="auto" />
          自动计数（提醒即计数）
        </label>
        <label>
          <input type="radio" v-model="localConfig.countMode" value="manual" />
          手动计数（需确认完成）
        </label>
      </div>
    </section>
    
    <!-- 运动参数 -->
    <section class="setting-section">
      <h3>🎯 运动参数</h3>
      <div class="setting-row">
        <label>收缩时长:</label>
        <input type="number" v-model.number="localConfig.exercise.contractSeconds" min="1" max="30" />
        <span>秒</span>
      </div>
      <div class="setting-row">
        <label>放松时长:</label>
        <input type="number" v-model.number="localConfig.exercise.relaxSeconds" min="1" max="30" />
        <span>秒</span>
      </div>
      <div class="setting-row">
        <label>重复次数:</label>
        <input type="number" v-model.number="localConfig.exercise.repeatCount" min="1" max="30" />
        <span>次</span>
      </div>
    </section>
    
    <!-- 文案风格 -->
    <section class="setting-section">
      <h3>✨ 文案风格</h3>
      <div class="setting-row">
        <select v-model="localConfig.style">
          <option value="random">随机</option>
          <option value="normal">正经</option>
          <option value="funny">搞怪</option>
        </select>
      </div>
    </section>
    
    <!-- 运行状态 -->
    <section class="setting-section">
      <h3>⚡ 运行状态</h3>
      <div class="toggle-group">
        <label>
          <input type="radio" v-model="localConfig.enabled" :value="true" />
          已开启
        </label>
        <label>
          <input type="radio" v-model="localConfig.enabled" :value="false" />
          已暂停
        </label>
      </div>
    </section>
    
    <!-- 清除历史 -->
    <section class="setting-section">
      <h3>🗑 清除历史数据</h3>
      <button @click="showClearConfirm = true" class="clear-btn">清除所有记录</button>
    </section>
    
    <!-- 保存按钮 -->
    <button @click="saveConfig" class="save-btn">保存设置</button>
    
    <!-- 清除确认弹窗 -->
    <div v-if="showClearConfirm" class="confirm-dialog">
      <div class="dialog-content">
        <p>确定要清除所有历史数据吗？此操作不可恢复。</p>
        <div class="dialog-buttons">
          <button @click="clearHistory">确定清除</button>
          <button @click="showClearConfirm = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 20px;
  max-width: 400px;
}

h1 {
  margin-bottom: 20px;
  font-size: 18px;
}

.setting-section {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.setting-section h3 {
  margin-bottom: 10px;
  font-size: 14px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.setting-row input[type="number"],
.setting-row input[type="time"],
.setting-row select {
  padding: 4px 8px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--bg-color, #fff);
  color: var(--text-color, #333);
}

.time-range {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.multi-time .time-slot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.remove-btn {
  padding: 2px 8px;
  background: #ff6b6b;
  color: white;
  font-size: 12px;
}

.add-btn {
  padding: 4px 12px;
  background: #4caf50;
  color: white;
}

.weekly-time .day-config {
  margin-bottom: 10px;
}

.weekly-time .day-config label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.radio-group,
.toggle-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-group label,
.toggle-group label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clear-btn {
  padding: 6px 12px;
  background: #ff6b6b;
  color: white;
}

.save-btn {
  width: 100%;
  padding: 10px;
  margin-top: 20px;
}

.confirm-dialog {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
}

.dialog-content {
  background: var(--bg-color, #fff);
  padding: 20px;
  border-radius: 8px;
  max-width: 300px;
}

.dialog-buttons {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 15px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/Settings/index.vue
git commit -m "feat: create Settings page with all configuration options"
```

---

## Task 6: Stats 统计页面

**Files:**
- Create: `src/Stats/index.vue`

- [ ] **Step 1: 创建 Stats 页面**

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { StatsData, STORAGE_KEYS, calculateStreak, getTodayDate } from '../types'

const props = defineProps<{
  enterAction: any
}>()

const stats = ref<StatsData>({ records: [] })

// 今日完成次数
const todayCount = computed(() => {
  const today = getTodayDate()
  const record = stats.value.records.find(r => r.date === today)
  return record?.count || 0
})

// 连续打卡天数
const streakDays = computed(() => {
  return calculateStreak(stats.value.records)
})

// 历史记录（按日期降序）
const sortedRecords = computed(() => {
  return [...stats.value.records].sort((a, b) => b.date.localeCompare(a.date))
})

// 加载统计数据
const loadStats = async () => {
  const savedStats = await window.services.getItem(STORAGE_KEYS.stats)
  if (savedStats) {
    stats.value = savedStats
  }
}

onMounted(async () => {
  await loadStats()
})
</script>

<template>
  <div class="stats">
    <h1>提肛助手 - 统计</h1>
    
    <!-- 今日统计 -->
    <section class="stats-section">
      <h3>📈 今日统计</h3>
      <div class="stat-card">
        <div class="stat-item">
          <span class="stat-label">今日完成</span>
          <span class="stat-value">{{ todayCount }} 次</span>
        </div>
      </div>
    </section>
    
    <!-- 连续打卡 -->
    <section class="stats-section">
      <h3>🔥 连续打卡</h3>
      <div class="stat-card">
        <div class="stat-item">
          <span class="stat-label">已连续打卡</span>
          <span class="stat-value">{{ streakDays }} 天</span>
        </div>
        <p class="stat-note">只要当天有完成就算打卡</p>
      </div>
    </section>
    
    <!-- 历史记录 -->
    <section class="stats-section">
      <h3>📋 历史记录</h3>
      <div class="history-list">
        <div v-if="sortedRecords.length === 0" class="empty-tip">
          暂无记录，开始你的第一次提肛吧！
        </div>
        <div v-for="record in sortedRecords" :key="record.date" class="history-item">
          <span class="history-date">{{ record.date }}</span>
          <span class="history-count">完成 {{ record.count }} 次</span>
        </div>
      </div>
    </section>
    
    <!-- 提示 -->
    <p class="footer-note">打卡记录长期保留，可到设置页清除</p>
  </div>
</template>

<style scoped>
.stats {
  padding: 20px;
  max-width: 400px;
}

h1 {
  margin-bottom: 20px;
  font-size: 18px;
}

.stats-section {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.stats-section h3 {
  margin-bottom: 10px;
  font-size: 14px;
}

.stat-card {
  background: var(--bg-color, #fff);
  padding: 15px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #ddd);
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  font-size: 14px;
  color: var(--text-color, #666);
}

.stat-value {
  font-size: 18px;
  font-weight: bold;
  color: var(--blue, #58a4f6);
}

.stat-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-color, #999);
}

.history-list {
  max-height: 200px;
  overflow-y: auto;
}

.empty-tip {
  text-align: center;
  color: var(--text-color, #999);
  padding: 20px;
}

.history-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.history-date {
  color: var(--text-color, #666);
}

.history-count {
  color: var(--blue, #58a4f6);
}

.footer-note {
  text-align: center;
  font-size: 12px;
  color: var(--text-color, #999);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/Stats/index.vue
git commit -m "feat: create Stats page with today count and streak display"
```

---

## Task 7: ExerciseGuide 运动引导弹窗

**Files:**
- Create: `src/ExerciseGuide/index.vue`

- [ ] **Step 1: 创建 ExerciseGuide 弹窗**

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  exercise: {
    contractSeconds: number
    relaxSeconds: number
    repeatCount: number
  }
}>()

const emit = defineEmits<{
  (e: 'complete'): void
  (e: 'skip'): void
}>()

// 运动状态
const phase = ref<'contract' | 'relax' | 'done'>('contract')
const currentRound = ref(1)
const secondsLeft = ref(props.exercise.contractSeconds)
const isRunning = ref(true)

// 进度百分比
const progress = computed(() => {
  const totalSeconds = phase.value === 'contract' 
    ? props.exercise.contractSeconds 
    : props.exercise.relaxSeconds
  return ((totalSeconds - secondsLeft.value) / totalSeconds) * 100
})

// 阶段文字
const phaseText = computed(() => {
  if (phase.value === 'contract') return '收缩中...'
  if (phase.value === 'relax') return '放松中...'
  return '运动已完成！'
})

// 倒计时
let timer: number | null = null

const tick = () => {
  if (!isRunning.value) return
  
  secondsLeft.value--
  
  if (secondsLeft.value <= 0) {
    // 当前阶段结束
    if (phase.value === 'contract') {
      // 切换到放松阶段
      phase.value = 'relax'
      secondsLeft.value = props.exercise.relaxSeconds
    } else if (phase.value === 'relax') {
      // 放松阶段结束，检查是否还有下一轮
      if (currentRound.value < props.exercise.repeatCount) {
        currentRound.value++
        phase.value = 'contract'
        secondsLeft.value = props.exercise.contractSeconds
      } else {
        // 全部完成
        phase.value = 'done'
        isRunning.value = false
        if (timer) clearInterval(timer)
      }
    }
  }
}

onMounted(() => {
  timer = window.setInterval(tick, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// 手动完成
const handleComplete = () => {
  emit('complete')
}

// 跳过
const handleSkip = () => {
  emit('skip')
}
</script>

<template>
  <div class="exercise-guide">
    <div class="guide-content">
      <!-- 阶段标题 -->
      <h2 class="phase-title">{{ phaseText }}</h2>
      
      <!-- 倒计时显示（运动中） -->
      <div v-if="phase !== 'done'" class="countdown">
        <div class="seconds-display">
          <span class="seconds-number">{{ secondsLeft }}</span>
          <span class="seconds-unit">秒</span>
        </div>
        
        <!-- 进度条 -->
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }"></div>
        </div>
        
        <!-- 进度信息 -->
        <p class="round-info">第 {{ currentRound }} / {{ exercise.repeatCount }} 次</p>
      </div>
      
      <!-- 完成按钮（运动结束后） -->
      <div v-if="phase === 'done'" class="done-buttons">
        <button @click="handleComplete" class="complete-btn">已完成</button>
        <button @click="handleSkip" class="skip-btn">跳过</button>
      </div>
      
      <!-- 提示（运动中） -->
      <p v-if="phase !== 'done'" class="hint">
        请按照节奏收缩和放松盆底肌
      </p>
    </div>
  </div>
</template>

<style scoped>
.exercise-guide {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.guide-content {
  background: var(--bg-color, #fff);
  padding: 30px 40px;
  border-radius: 16px;
  text-align: center;
  max-width: 300px;
}

.phase-title {
  font-size: 20px;
  margin-bottom: 20px;
  color: var(--text-color, #333);
}

.countdown {
  margin-bottom: 20px;
}

.seconds-display {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 4px;
}

.seconds-number {
  font-size: 48px;
  font-weight: bold;
  color: var(--blue, #58a4f6);
}

.seconds-unit {
  font-size: 16px;
  color: var(--text-color, #666);
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: var(--border-color, #ddd);
  border-radius: 4px;
  margin: 15px 0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--blue, #58a4f6);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.round-info {
  font-size: 14px;
  color: var(--text-color, #666);
}

.done-buttons {
  display: flex;
  justify-content: center;
  gap: 15px;
  margin-top: 20px;
}

.complete-btn {
  padding: 10px 30px;
  background: #4caf50;
  color: white;
  font-size: 16px;
}

.skip-btn {
  padding: 10px 30px;
  background: #999;
  color: white;
  font-size: 16px;
}

.hint {
  font-size: 12px;
  color: var(--text-color, #999);
  margin-top: 15px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/ExerciseGuide/index.vue
git commit -m "feat: create ExerciseGuide popup with countdown and progress"
```

---

## Task 8: Tutorial 教程页面

**Files:**
- Create: `src/Tutorial/index.vue`
- Create: `src/assets/tutorial.md`

- [ ] **Step 1: 创建教程 markdown 内容**

```markdown
# 提肛运动指南

## 什么是提肛运动？

提肛运动是一种锻炼盆底肌的简单运动，通过有意识地收缩和放松肛门括约肌及相关肌肉群，增强盆底肌肉力量，改善盆底功能。

盆底肌像一张"吊网"，支撑着膀胱、子宫、直肠等器官。久坐、怀孕、 aging 等因素会导致盆底肌松弛，引发尿失禁、便秘等问题。

## 正确姿势

### 基本要点

1. **姿势选择**：坐姿、站姿、躺姿均可，初学者建议坐姿或躺姿
2. **身体放松**：保持全身放松，避免用力过猛
3. **呼吸自然**：不要憋气，保持正常呼吸节奏

### 动作步骤

1. 吸气时收缩肛门和会阴部肌肉（像憋尿的感觉）
2. 保持收缩 3-5 秒
3. 呼气时缓慢放松肌肉
4. 休息 3-5 秒后重复

## 呼吸配合

正确的呼吸配合能增强锻炼效果：

- **收缩时**：吸气或屏息均可，找到适合自己的方式
- **放松时**：呼气，感受肌肉完全放松

建议初学者：收缩时吸气，放松时呼气，节奏自然。

## 注意事项

### 常见错误

- ❌ 收缩时憋气太久
- ❌ 用力过猛、过快
- ❌ 收缩腹部或臀部肌肉（应只收缩盆底肌）
- ❌ 练习过于频繁（建议间隔 2-3 小时）

### 建议

- ✅ 循序渐进，从短时间开始
- ✅ 每天练习 3-4 次，每次 10-15 个循环
- ✅ 坚持 3 个月以上才能看到明显效果
- ✅ 如有不适，请咨询医生

## 盆底肌健康小贴士

1. 避免长时间久坐，每小时起身活动
2. 保持健康体重，减轻盆底压力
3. 多喝水，预防便秘
4. 定期进行提肛运动，养成习惯

---

💪 坚持提肛，守护盆底健康！
```

- [ ] **Step 2: 创建 Tutorial 页面**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import tutorialContent from '../assets/tutorial.md?raw'

const props = defineProps<{
  enterAction: any
}>()

const content = ref(tutorialContent)

// 简单 markdown 渲染
const renderedContent = ref('')

const renderMarkdown = (md: string) => {
  let html = md
  
  // 标题
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')
  
  // 列表
  html = html.replace(/^\- ✅ (.*$)/gm, '<li class="good">$1</li>')
  html = html.replace(/^\- ❌ (.*$)/gm, '<li class="bad">$1</li>')
  html = html.replace(/^\- (.*$)/gm, '<li>$1</li>')
  html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul>$&</ul>')
  
  // 数字列表
  html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ol>$&</ol>')
  
  // 分割线
  html = html.replace(/^---$/gm, '<hr>')
  
  // 强调
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  
  // 段落
  html = html.replace(/^(?!<[hulol]|<hr|<li|<\/)(.*$)/gm, '<p>$1</p>')
  
  return html
}

onMounted(() => {
  renderedContent.value = renderMarkdown(content.value)
})
</script>

<template>
  <div class="tutorial">
    <h1>提肛助手 - 教程</h1>
    <div class="tutorial-content" v-html="renderedContent"></div>
  </div>
</template>

<style scoped>
.tutorial {
  padding: 20px;
  max-width: 500px;
  overflow-y: auto;
}

.tutorial h1 {
  margin-bottom: 20px;
  font-size: 18px;
}

.tutorial-content {
  line-height: 1.8;
}

.tutorial-content h1 {
  font-size: 16px;
  margin-top: 20px;
  margin-bottom: 10px;
}

.tutorial-content h2 {
  font-size: 14px;
  margin-top: 15px;
  margin-bottom: 8px;
  color: var(--blue, #58a4f6);
}

.tutorial-content h3 {
  font-size: 13px;
  margin-top: 10px;
  margin-bottom: 5px;
}

.tutorial-content p {
  margin-bottom: 10px;
}

.tutorial-content ul,
.tutorial-content ol {
  margin-bottom: 10px;
  padding-left: 20px;
}

.tutorial-content li {
  margin-bottom: 5px;
}

.tutorial-content li.good {
  color: #4caf50;
}

.tutorial-content li.bad {
  color: #f44336;
}

.tutorial-content hr {
  border: none;
  border-top: 1px solid var(--border-color, #ddd);
  margin: 15px 0;
}

.tutorial-content strong {
  color: var(--blue, #58a4f6);
}
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/Tutorial/index.vue src/assets/tutorial.md
git commit -m "feat: create Tutorial page with markdown content"
```

---

## Task 9: 清理旧文件

**Files:**
- Delete: `src/Hello/index.vue`
- Delete: `src/Read/index.vue`
- Delete: `src/Write/index.vue`
- Modify: `README.md` (更新文档)

- [ ] **Step 1: 删除旧的示例组件**

```bash
rm -rf src/Hello src/Read src/Write
```

- [ ] **Step 2: 更新 README.md**

```markdown
# tiga

> 定时提醒提肛运动，关爱久坐族盆底健康

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件。

## ✨ 功能特性

- **定时提醒** - 可自定义提醒间隔（默认 30 分钟）及工作时段
- **桌面通知** - 到点发送桌面通知，支持多种文案风格
- **运动引导** - 弹窗展示收缩/放松倒计时过程，引导用户完成运动
- **教程指南** - 图文并茂的提肛姿势指南与呼吸配合教程
- **统计打卡** - 每日完成次数统计与连续打卡记录

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

## 📖 使用说明

- 输入 `提肛` 或 `提肛助手` 进入设置页面
- 输入 `提肛统计` 查看完成记录
- 输入 `提肛教程` 学习正确姿势

## 📄 开源协议

MIT License
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old example components and update README"
```

---

## Task 10: 构建测试

**Files:**
- None (验证构建)

- [ ] **Step 1: 运行构建**

```bash
npm run build
```

Expected: 构建成功，输出到 `dist/` 目录

- [ ] **Step 2: 检查构建产物**

```bash
ls dist/
```

Expected: 包含 `index.html`、JS、CSS 等文件

---

## Spec Coverage Check

| Spec Requirement | Task Coverage |
|-----------------|---------------|
| 定时提醒间隔配置 | Task 1 (types), Task 5 (Settings) |
| 工作时段配置 | Task 1 (types), Task 5 (Settings), Task 2 (isInWorkTime) |
| 桌面通知 | Task 2 (sendNotification) |
| 文案风格切换 | Task 1 (getRandomText), Task 5 (Settings) |
| 运动引导弹窗 | Task 7 (ExerciseGuide) |
| 运动参数配置 | Task 1 (types), Task 5 (Settings) |
| 统计展示 | Task 6 (Stats) |
| 连续打卡计算 | Task 1 (calculateStreak), Task 6 (Stats) |
| 教程页面 | Task 8 (Tutorial) |
| 开关启停 | Task 5 (Settings), Task 2 (startTimer/stopTimer) |
| 清除历史 | Task 5 (Settings) |
| IPC 事件通信 | Task 2 (ipcSend), Task 4 (App.vue ipcOn) |

✅ All requirements covered.

---

## Placeholder Check

- ✅ No "TBD" or "TODO" placeholders
- ✅ All code blocks contain complete implementation
- ✅ All file paths are exact
- ✅ No references to undefined types/functions

---

## Type Consistency Check

- ✅ `Config` interface used consistently in Task 1, 4, 5
- ✅ `StatsData` interface used consistently in Task 1, 6
- ✅ `STORAGE_KEYS` used consistently in Task 1, 2, 4, 5, 6
- ✅ `getRandomText` defined in Task 1, used in Task 4
- ✅ `calculateStreak` defined in Task 1, used in Task 6
- ✅ `getTodayDate` defined in Task 1, used in Task 4, 6

---

Plan complete and saved to `docs/superpowers/plans/2026-06-10-tiga-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?