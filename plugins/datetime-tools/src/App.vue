<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import Datetime from './views/Datetime.vue'
import DateDiff from './views/DateDiff.vue'
import DateCalc from './views/DateCalc.vue'
import DateWeekday from './views/DateWeekday.vue'
import DateWorkdays from './views/DateWorkdays.vue'
import StopWatch from './views/StopWatch.vue'
import DateFormat from './views/DateFormat.vue'
import DateTimezone from './views/DateTimezone.vue'

// 标签顺序与文案对齐原插件
const TABS = [
  { code: 'datetime', label: '时间戳转换' },
  { code: 'dateDiff', label: '计算日期差' },
  { code: 'dateCalc', label: '推算日期' },
  { code: 'dateWeekday', label: '推算工作日' },
  { code: 'dateWorkdays', label: '工作天数' },
  { code: 'dateFormat', label: '日期格式' },
  { code: 'dateTimezone', label: '世界时间' },
  { code: 'stopWatch', label: '在线秒表' }
] as const

type TabCode = (typeof TABS)[number]['code']

const active = ref<TabCode>('datetime')

// 各功能入口通过关键字/正则匹配带入的文本（时间戳或日期）
const payloads = reactive<Record<TabCode, string>>({
  datetime: '',
  dateDiff: '',
  dateCalc: '',
  dateWeekday: '',
  dateWorkdays: '',
  stopWatch: '',
  dateFormat: '',
  dateTimezone: ''
})

onMounted(() => {
  // 普通浏览器预览时无 ztools 环境，直接跳过
  if (typeof window.ztools === 'undefined') return
  window.ztools.onPluginEnter(({ code, payload }) => {
    window.ztools.setExpendHeight(560)
    if (TABS.some((t) => t.code === code)) {
      active.value = code as TabCode
      if (typeof payload === 'string' && payload.trim()) {
        payloads[code as TabCode] = payload.trim()
      }
    }
  })
})
</script>

<template>
  <div class="app">
    <nav class="side-tabs">
      <div
        v-for="tab in TABS"
        :key="tab.code"
        :class="{ 'tab-item': true, active: active === tab.code }"
        @click="active = tab.code"
      >
        {{ tab.label }}
      </div>
    </nav>
    <main class="content">
      <Datetime v-show="active === 'datetime'" :payload="payloads.datetime" />
      <DateDiff v-show="active === 'dateDiff'" :payload="payloads.dateDiff" />
      <DateCalc v-show="active === 'dateCalc'" :payload="payloads.dateCalc" />
      <DateWeekday v-show="active === 'dateWeekday'" :payload="payloads.dateWeekday" />
      <DateWorkdays v-show="active === 'dateWorkdays'" :payload="payloads.dateWorkdays" />
      <DateFormat v-show="active === 'dateFormat'" :payload="payloads.dateFormat" />
      <DateTimezone v-show="active === 'dateTimezone'" :payload="payloads.dateTimezone" />
      <StopWatch v-show="active === 'stopWatch'" :active="active === 'stopWatch'" />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  align-items: flex-start;
  height: 100vh;
  padding: 15px;
}

/* 左侧竖排标签，对齐原插件 el-tabs--left 外观 */
.side-tabs {
  flex-shrink: 0;
  margin-right: 12px;
}

.tab-item {
  height: 40px;
  line-height: 40px;
  padding: 0 20px;
  text-align: right;
  font-size: 14px;
  color: #303133;
  cursor: pointer;
  border-right: 2px solid #e4e7ed;
  white-space: nowrap;
  transition: color 0.2s;
}

.tab-item:hover {
  color: var(--blue);
}

.tab-item.active {
  color: var(--blue);
  border-right-color: var(--blue);
  font-weight: 500;
}

.content {
  flex: 1;
  min-width: 0;
  max-height: 100%;
  overflow-y: auto;
}

@media (prefers-color-scheme: dark) {
  .tab-item {
    color: #e4e7ed;
    border-right-color: #555;
  }

  .tab-item.active {
    color: var(--blue);
    border-right-color: var(--blue);
  }
}
</style>
