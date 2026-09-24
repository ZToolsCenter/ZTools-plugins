<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">工作日推算</h5>
      <hr />

      <div class="form-group inline-form">
        <input
          type="text"
          class="form-control date-item"
          v-model="baseStr"
          placeholder="2026-08-11"
        />
        <a class="text-success" @click="baseStr = today()">设置为今天</a>
      </div>

      <div class="form-group inline-form">
        <select class="form-control date-item" v-model.number="dir">
          <option :value="1">往后</option>
          <option :value="-1">往前</option>
        </select>
        <input
          type="number"
          min="1"
          class="form-control day-item date-item"
          v-model.number="amount"
        />
        <span>个工作日</span>
      </div>

      <div class="form-group inline-form">
        <button type="button" class="btn btn-outline-success" @click="showResult = true">
          是（计算）
        </button>
        <label class="keep-label">
          <input type="checkbox" class="keep-item" v-model="keep" /> 保持输入到下次
        </label>
      </div>

      <div v-if="showResult && result" class="alert alert-success">
        <div>{{ result.date }}&nbsp;&nbsp;{{ result.week }}</div>
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
      <div v-else-if="showResult" class="alert alert-success">
        请输入正确的日期（如 2026-08-11），推算天数不能小于1
      </div>

      <div class="alert alert-info">
        <b class="alert-heading">工具说明</b>
        <p>
          本工具可计算某个日期经历数个工作日之后的日期，计算过程会减去周末、法定假日并补充上假期周末调休上班日。
          节假日及调休补班数据支持 2024-2026 年（内置官方放假安排）。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatDate, parseDateInput, WEEK_FULL_CN } from '../utils/date'
import { addWorkdaysCn, specialDaysInRange } from '../utils/holidays'
import { useKeepInput } from '../utils/keepInput'

const props = defineProps<{ payload?: string }>()

const today = () => formatDate(new Date())

const baseStr = ref(today())
const dir = ref<1 | -1>(1)
const amount = ref(30)
const showResult = ref(false)

const result = computed(() => {
  const base = parseDateInput(baseStr.value)
  if (!base || typeof amount.value !== 'number' || amount.value < 1 || amount.value > 100000) {
    return null
  }
  const d = addWorkdaysCn(base, dir.value * amount.value)
  // 展示推算区间内经过的节假日与调休补班
  const [a, b] = dir.value >= 0 ? [base, d] : [d, base]
  const { holidays, makeup } = specialDaysInRange(a, b)
  return { date: formatDate(d), week: WEEK_FULL_CN[d.getDay()], holidays, makeup }
})

const keep = useKeepInput('calc_work', { baseStr, dir, amount })

// 关键字入口带入的日期作为基准日期
watch(
  () => props.payload,
  (val) => {
    if (val && parseDateInput(val)) {
      baseStr.value = val.slice(0, 10)
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
