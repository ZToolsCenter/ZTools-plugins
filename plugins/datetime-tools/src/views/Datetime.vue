<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">时间戳转换</h5>
      <hr />

      <div class="form-group inline-form">
        <span class="item-name">现在：</span>
        <a class="calc-item text-success" @click="copyNow">{{ nowTs }}</a>
        <span class="ml-16">
          控制：
          <a class="text-danger" @click="paused = !paused">{{ paused ? '▶ 开始' : '■ 停止' }}</a>
        </span>
      </div>

      <div class="form-group inline-form">
        <span class="item-name">时间戳：</span>
        <input type="number" class="form-control date-item" v-model="tsInput" />
        <button type="button" class="btn btn-outline-success" @click="convertTs">转换 ›</button>
        <input type="text" class="form-control date-item wide" readonly :value="tsResult" />
        <span>北京时间</span>
      </div>

      <div class="form-group inline-form">
        <span class="item-name">北京时间：</span>
        <input
          type="text"
          class="form-control date-item wide"
          v-model="dtInput"
          placeholder="2026-08-11 15:30:00"
        />
        <button type="button" class="btn btn-outline-success" @click="convertDt">转换 ›</button>
        <input type="text" class="form-control date-item" readonly :value="dtResult" />
      </div>

      <div class="form-group inline-form">
        <label class="milli-label no-ml">
          <input type="checkbox" class="keep-item" v-model="isMilli" /> 毫秒
        </label>
        <label class="keep-label">
          <input type="checkbox" class="keep-item" v-model="keep" /> 保持输入到下次
        </label>
      </div>

      <div class="alert alert-info">
        <b class="alert-heading">简介</b>
        <p>
          时间戳，是从1970年1月1日（UTC/GMT的午夜）开始所经过的秒数（不考虑闰秒），用于表示一个时间点。
          然而，这种格式对于人类阅读并不友好，因此需要转换成可读的日期和时间格式。
          这个工具能够将时间戳快速转换为人类可读的日期时间格式，同时也支持反向转换，即将日期时间转换为时间戳。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatDateTime, formatInTz, pad, parseDateInput, wallTimeToUtc } from '../utils/date'
import { useKeepInput } from '../utils/keepInput'
import { copyText } from '../utils/toast'

const props = defineProps<{ payload?: string }>()

const BJ_TZ = 'Asia/Shanghai'

// —— 现在：实时时间戳（可停止/复制） ——
const nowMs = ref(Date.now())
const paused = ref(false)
let timer: number | undefined

onMounted(() => {
  timer = window.setInterval(() => {
    if (!paused.value) nowMs.value = Date.now()
  }, 200)
})
onUnmounted(() => window.clearInterval(timer))

const isMilli = ref(false)

// 勾选毫秒后"现在"显示为「秒 毫秒尾数」（对齐原插件），复制时为完整毫秒值
const nowTs = computed(() => {
  const sec = Math.floor(nowMs.value / 1000)
  return isMilli.value ? `${sec} ${pad(nowMs.value % 1000, 3)}` : String(sec)
})

const copyNow = () =>
  copyText(isMilli.value ? String(nowMs.value) : String(Math.floor(nowMs.value / 1000)))

// 切换毫秒时把时间戳输入框的值同步换算（秒 ↔ 毫秒）
watch(isMilli, (on) => {
  const v = String(tsInput.value).trim()
  if (/^\d+$/.test(v)) {
    tsInput.value = on ? String(+v * 1000) : String(Math.floor(+v / 1000))
  }
  if (tsResult.value) convertTs()
  if (dtResult.value) convertDt()
})

// —— 时间戳 → 北京时间（默认填入当前时间戳） ——
const tsInput = ref(String(Math.floor(Date.now() / 1000)))
const tsResult = ref('')

const convertTs = () => {
  const s = String(tsInput.value).trim()
  if (!/^\d+$/.test(s)) {
    tsResult.value = ''
    return
  }
  const ms = isMilli.value ? +s : +s * 1000
  const d = new Date(ms)
  tsResult.value = Number.isNaN(d.getTime()) ? '' : formatInTz(d, BJ_TZ)
}

// —— 北京时间 → 时间戳（默认填入当前时间） ——
const dtInput = ref(formatDateTime(new Date()))
const dtResult = ref('')

const convertDt = () => {
  const parsed = parseDateInput(dtInput.value)
  if (!parsed) {
    dtResult.value = ''
    return
  }
  // 输入按北京时间墙上时间解释
  const wallUtcMs = Date.UTC(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    parsed.getHours(),
    parsed.getMinutes(),
    parsed.getSeconds()
  )
  const instant = wallTimeToUtc(wallUtcMs, BJ_TZ)
  dtResult.value = isMilli.value
    ? String(instant.getTime())
    : String(Math.floor(instant.getTime() / 1000))
}

const keep = useKeepInput('timestamp', { tsInput, dtInput, isMilli })

// 关键字入口带入的时间戳或日期
watch(
  () => props.payload,
  (val) => {
    if (!val) return
    if (/^\d{13}$/.test(val)) {
      isMilli.value = true
      tsInput.value = val
      convertTs()
    } else if (/^\d{10}$/.test(val)) {
      isMilli.value = false
      tsInput.value = val
      convertTs()
    } else if (parseDateInput(val)) {
      dtInput.value = val
      convertDt()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.date-item {
  margin-right: 6px;
}

.date-item.wide {
  width: 200px;
}

.btn {
  margin-right: 6px;
}

.ml-16 {
  margin-left: 16px;
}

.no-ml {
  margin-left: 0;
}
</style>
