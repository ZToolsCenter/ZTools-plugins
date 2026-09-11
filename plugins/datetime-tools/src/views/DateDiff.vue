<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">计算日期差</h5>
      <hr />

      <div class="form-group inline-form">
        <span class="item-name">日期</span>
        <input
          type="text"
          class="form-control date-item"
          v-model="startStr"
          :placeholder="withHms ? '2026-08-11 08:00:00' : '2026-08-11'"
        />
        <a class="text-success" @click="startStr = todayStr()">{{ setLinkText }}</a>
      </div>

      <div class="form-group inline-form">
        <span class="item-name">距离</span>
        <input
          type="text"
          class="form-control date-item"
          v-model="endStr"
          :placeholder="withHms ? '2027-01-01 00:00:00' : '2027-01-01'"
        />
        <a class="text-success" @click="endStr = todayStr()">{{ setLinkText }}</a>
      </div>

      <div class="form-group inline-form">
        <button type="button" class="btn btn-outline-success" @click="showResult = true">
          相差（计算）
        </button>
        <label class="hms-label">
          <input type="checkbox" class="keep-item" v-model="withHms" /> 时分秒
        </label>
        <label class="keep-label">
          <input type="checkbox" class="keep-item" v-model="keep" /> 保持输入到下次
        </label>
      </div>

      <div v-if="showResult && resultText" class="alert alert-success">{{ resultText }}</div>
      <div v-else-if="showResult" class="alert alert-success">请输入正确的日期（如 2026-08-11）</div>

      <div class="alert alert-info">
        <b class="alert-heading">工具说明</b>
        <p>本工具用于计算两个日期之间相隔的天数，开启“时分秒”后可计算出相隔的时分秒。</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { diffDays, formatDate, formatDateTime, parseDateInput } from '../utils/date'
import { useKeepInput } from '../utils/keepInput'

const props = defineProps<{ payload?: string }>()

const withHms = ref(false)
// 时分秒模式下"设置为当前时间"填入当前时刻，普通模式填入今天日期
const setLinkText = computed(() => (withHms.value ? '设置为当前时间' : '设置为今天'))
const todayStr = () => (withHms.value ? formatDateTime(new Date()) : formatDate(new Date()))

// 默认：两个日期均为今天
const startStr = ref(formatDate(new Date()))
const endStr = ref(formatDate(new Date()))
const showResult = ref(false)

// 勾选时分秒后输入框补上时间部分，取消勾选则去掉
watch(withHms, (on) => {
  const fix = (r: { value: string }) => {
    const v = r.value.trim()
    if (on && /^\d{4}-\d{2}-\d{2}$/.test(v)) r.value = `${v} 00:00:00`
    else if (!on && /^\d{4}-\d{2}-\d{2}[T\s]/.test(v)) r.value = v.slice(0, 10)
  }
  fix(startStr)
  fix(endStr)
})

const resultText = computed(() => {
  const a = parseDateInput(startStr.value)
  const b = parseDateInput(endStr.value)
  if (!a || !b) return ''
  if (!withHms.value) {
    return `${diffDays(a, b)}天`
  }
  const ms = b.getTime() - a.getTime()
  if (ms === 0) return '时间一致'
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  const parts: [number, string][] = [
    [Math.floor(abs / 86400000), '天'],
    [Math.floor((abs % 86400000) / 3600000), '小时'],
    [Math.floor((abs % 3600000) / 60000), '分钟'],
    [Math.floor((abs % 60000) / 1000), '秒']
  ]
  // 掐头去尾省略为 0 的单位（对齐原插件：1天 0小时 5分钟；0天0时0分1秒 → 1秒）
  let s = 0
  let e = parts.length - 1
  while (s < parts.length && parts[s][0] === 0) s++
  while (e >= 0 && parts[e][0] === 0) e--
  return sign + parts.slice(s, e + 1).map(([v, u]) => `${v}${u}`).join(' ')
})

const keep = useKeepInput('diff', { startStr, endStr, withHms })

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
