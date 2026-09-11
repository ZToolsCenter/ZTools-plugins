<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">英文日期格式转换</h5>
      <hr />

      <div class="form-group inline-form">
        <input
          type="text"
          class="form-control date-item"
          v-model="dateStr"
          placeholder="2026-08-11"
        />
        <a class="text-success" @click="dateStr = today()">设置为今天</a>
      </div>

      <div class="form-group inline-form">
        <button type="button" class="btn btn-outline-success" @click="showResult = true">
          转换格式
        </button>
        <label class="keep-label">
          <input type="checkbox" class="keep-item" v-model="keep" /> 保持输入到下次
        </label>
      </div>

      <template v-if="showResult && tables">
        <table v-for="tbl in tables" :key="tbl.caption" class="table table-striped">
          <caption>
            {{ tbl.caption }}
            <small class="float-right">点击日期可复制</small>
          </caption>
          <colgroup>
            <col width="30%" />
            <col width="30%" />
            <col width="40%" />
          </colgroup>
          <thead>
            <tr>
              <th>日期</th>
              <th>大写</th>
              <th>格式说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tbl.rows" :key="row.desc">
              <td class="cursor-pointer" @click="copy(row.text)">{{ row.text }}</td>
              <td class="cursor-pointer" @click="copy(row.text.toUpperCase())">
                {{ row.text.toUpperCase() }}
              </td>
              <td>{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <div v-else-if="showResult" class="alert alert-success">请输入正确的日期（如 2026-08-11）</div>

      <div class="alert alert-info">
        <b class="alert-heading">工具说明</b>
        <p>英文日期格式分英式和美式，美式日期格式：Month Date,Year，英式日期格式：Date,Month,Year。</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatDate, parseDateInput } from '../utils/date'
import { useKeepInput } from '../utils/keepInput'
import { copyText } from '../utils/toast'

const props = defineProps<{ payload?: string }>()

const today = () => formatDate(new Date())

const dateStr = ref(today())
const showResult = ref(false)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

// 11 → 11th，21 → 21st，22 → 22nd ……
const ordinal = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

const tables = computed(() => {
  const d = parseDateInput(dateStr.value)
  if (!d) return null
  const y = d.getFullYear()
  const day = d.getDate()
  const month = MONTHS[d.getMonth()]
  const monthAbbr = `${month.slice(0, 3)}.`
  return [
    {
      caption: '美式',
      rows: [
        { text: `${month} ${day}, ${y}`, desc: '[月 日,年] (常用)' },
        { text: `${month} ${ordinal(day)}, ${y}`, desc: '[月 序数日,年]' },
        { text: `${monthAbbr} ${day}, ${y}`, desc: '[简写月 日,年]' },
        { text: `${monthAbbr} ${ordinal(day)}, ${y}`, desc: '[简写月 序数日, 年]' }
      ]
    },
    {
      caption: '英式',
      rows: [
        { text: `${day}, ${month}, ${y}`, desc: '[日, 月, 年]' },
        { text: `${ordinal(day)}, ${month}, ${y}`, desc: '[序数日, 月, 年] (常用)' },
        { text: `${day}, ${monthAbbr}, ${y}`, desc: '[日, 简写月, 年]' },
        { text: `${ordinal(day)}, ${monthAbbr}, ${y}`, desc: '[序数日, 简写月, 年]' }
      ]
    }
  ]
})

const copy = (text: string) => copyText(text)

const keep = useKeepInput('format', { dateStr })

// 关键字入口带入的日期
watch(
  () => props.payload,
  (val) => {
    if (val && parseDateInput(val)) {
      dateStr.value = val.slice(0, 10)
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
