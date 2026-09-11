<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">推算日期</h5>
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
        <input type="number" min="0" class="form-control day-item date-item" v-model.number="amount" />
        <select class="form-control" v-model="unit">
          <option value="day">天</option>
          <option value="week">周</option>
          <option value="month">月</option>
        </select>
      </div>

      <div class="form-group inline-form">
        <button type="button" class="btn btn-outline-success" @click="showResult = true">
          是（计算）
        </button>
        <label class="keep-label">
          <input type="checkbox" class="keep-item" v-model="keep" /> 保持输入到下次
        </label>
      </div>

      <div v-if="showResult && resultText" class="alert alert-success">
        <span>{{ resultText.date }}</span>&nbsp;&nbsp;<span>{{ resultText.week }}</span>
      </div>
      <div v-else-if="showResult" class="alert alert-success">请输入正确的日期（如 2026-08-11）</div>

      <div class="alert alert-info">
        <b class="alert-heading">工具说明</b>
        <p>本工具用于计算某个日期在一定时间单位之前或之后的日期。可用于推算纪念日、保质期等~</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  addDays,
  addMonthsClamped,
  formatDate,
  parseDateInput,
  WEEK_FULL_CN
} from '../utils/date'
import { useKeepInput } from '../utils/keepInput'

const props = defineProps<{ payload?: string }>()

const today = () => formatDate(new Date())

const baseStr = ref(today())
const dir = ref<1 | -1>(1)
const amount = ref(30)
const unit = ref<'day' | 'week' | 'month'>('day')
const showResult = ref(false)

const resultText = computed(() => {
  const base = parseDateInput(baseStr.value)
  if (!base || typeof amount.value !== 'number' || amount.value < 0) return null
  const n = dir.value * amount.value
  let d: Date
  switch (unit.value) {
    case 'day':
      d = addDays(base, n)
      break
    case 'week':
      d = addDays(base, n * 7)
      break
    case 'month':
      d = addMonthsClamped(base, n)
      break
  }
  return { date: formatDate(d), week: WEEK_FULL_CN[d.getDay()] }
})

const keep = useKeepInput('calc', { baseStr, dir, amount, unit })

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
