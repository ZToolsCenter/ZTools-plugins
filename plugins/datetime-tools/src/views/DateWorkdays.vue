<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">工作天数计算</h5>
      <hr />

      <div class="form-group inline-form">
        <span class="item-name">开始</span>
        <input
          type="text"
          class="form-control date-item"
          v-model="startStr"
          placeholder="2026-08-01"
        />
        <a class="text-success" @click="startStr = today()">设置为今天</a>
      </div>

      <div class="form-group inline-form">
        <span class="item-name">结束</span>
        <input
          type="text"
          class="form-control date-item"
          v-model="endStr"
          placeholder="2026-08-31"
        />
        <a class="text-success" @click="endStr = today()">设置为今天</a>
      </div>

      <div class="form-group inline-form">
        <button type="button" class="btn btn-outline-success" @click="showResult = true">
          天数（计算）
        </button>
        <div class="btn-group">
          <button type="button" class="btn btn-outline-info" @click="setMonth(0)">本月</button>
          <button type="button" class="btn btn-outline-info" @click="setMonth(1)">下月</button>
          <button type="button" class="btn btn-outline-info" @click="setMonth(-1)">上月</button>
        </div>
        <label class="keep-label">
          <input type="checkbox" class="keep-item" v-model="keep" /> 保持输入到下次
        </label>
      </div>

      <div v-if="showResult && result" class="alert alert-success">
        <div>
          <b>{{ result.workdays }}</b> 个工作日 （总计 <b>{{ result.total }}</b> 天）
        </div>
        <ul v-if="result.holidays.length" class="output-group">
          <li class="output-group-item">节日放假：{{ result.holidays.length }}天</li>
          <li v-for="(item, i) in result.holidays" :key="i" class="output-group-item">
            {{ item.date }}&nbsp;&nbsp;{{ item.week_name }}&nbsp;&nbsp;({{ item.explain }})
          </li>
        </ul>
        <ul v-if="result.makeup.length" class="output-group">
          <li class="output-group-item">调休补班：{{ result.makeup.length }}天</li>
          <li v-for="(item, i) in result.makeup" :key="i" class="output-group-item">
            {{ item.date }}&nbsp;&nbsp;{{ item.week_name }}&nbsp;&nbsp;({{ item.explain }})
          </li>
        </ul>
      </div>
      <div v-else-if="showResult" class="alert alert-success">请输入正确的日期（如 2026-08-01）</div>

      <div class="alert alert-info">
        <b class="alert-heading">工具说明</b>
        <p>
          本工具可计算某时间段内的工作天数，计算过程会减去周末、法定假日并补充上假期周末调休上班日。
          节假日及调休补班数据支持 2024-2026 年（内置官方放假安排）。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { daysInMonth, formatDate, pad, parseDateInput } from '../utils/date'
import { specialDaysInRange, workdayStatsCn } from '../utils/holidays'
import { useKeepInput } from '../utils/keepInput'

const props = defineProps<{ payload?: string }>()

const today = () => formatDate(new Date())

const startStr = ref(today())
const endStr = ref(today())
const showResult = ref(false)

// 快捷选择本月 / 下月 / 上月的起止日期
const setMonth = (offset: number) => {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  startStr.value = formatDate(first)
  endStr.value = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(
    daysInMonth(first.getFullYear(), first.getMonth())
  )}`
  showResult.value = true
}

const result = computed(() => {
  const a = parseDateInput(startStr.value)
  const b = parseDateInput(endStr.value)
  if (!a || !b) return null
  const [lo, hi] = a.getTime() <= b.getTime() ? [a, b] : [b, a]
  const { total, workdays } = workdayStatsCn(lo, hi)
  const { holidays, makeup } = specialDaysInRange(lo, hi)
  return { total, workdays, holidays, makeup }
})

const keep = useKeepInput('work_days', { startStr, endStr })

// 关键字入口带入的日期作为开始日期
watch(
  () => props.payload,
  (val) => {
    if (val && parseDateInput(val)) {
      startStr.value = val.slice(0, 10)
      showResult.value = true
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.date-item {
  margin-right: 6px;
}
</style>
