<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">世界时间转换器</h5>
      <hr />

      <div class="form-group inline-form">
        <span class="item-name">初始时间</span>
        <input
          type="text"
          class="form-control date-item wide"
          v-model="dtInput"
          placeholder="2026-08-11 15:30:00"
        />
        <a class="text-success" @click="setNow">设置为当前时间</a>
      </div>

      <div class="form-group inline-form">
        <span class="item-name">初始时区</span>
        <select class="form-control tz-select" v-model="srcTz">
          <option v-for="c in CITIES" :key="c.tz" :value="c.tz">{{ c.name }}（{{ c.tz }}）</option>
        </select>
      </div>

      <div class="form-group inline-form">
        <span class="item-name">转换时区</span>
        <div class="tz-dropdown">
          <div class="form-control tz-display" @click.stop="open = !open">
            <template v-if="selected.size">
              <span class="tz-tag">{{ firstSelectedName }}</span>
              <span class="tz-tag" v-if="selected.size > 1">+ {{ selected.size - 1 }}</span>
            </template>
            <span v-else class="tz-placeholder">请选择</span>
            <span :class="{ 'tz-caret': true, open }">▾</span>
          </div>
          <div v-show="open" class="tz-panel" @click.stop>
            <div
              v-for="c in CITIES"
              :key="c.tz"
              :class="{ 'tz-option': true, selected: selected.has(c.tz) }"
              @click="toggleCity(c.tz)"
            >
              <span>{{ c.name }}</span>
              <span class="tz-code">{{ c.tz }}<i v-if="selected.has(c.tz)" class="tz-tick">✓</i></span>
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-outline-info" @click="selectAll">全选</button>
        <button type="button" class="btn btn-outline-info" @click="selectNone">全不选</button>
        <button type="button" class="btn btn-outline-info" @click="selectInvert">反选</button>
      </div>

      <div class="form-group inline-form">
        <button type="button" class="btn btn-outline-success" @click="convert">立即转换</button>
      </div>

      <table v-if="rows" class="table table-striped my-table">
        <thead>
          <tr>
            <th>洲</th>
            <th>国家/城市</th>
            <th>当地时间</th>
            <th>所在时区</th>
            <th>UTC偏移量</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.tz">
            <td>{{ row.continent }}</td>
            <td>{{ row.name }}</td>
            <td>{{ row.time }}</td>
            <td>{{ row.tz }}</td>
            <td>{{ row.offset }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="converted" class="alert alert-success">
        请输入正确的时间（如 2026-08-11 15:30:00），并至少选择一个转换时区
      </div>

      <div class="alert alert-info">
        <b class="alert-heading">工具说明</b>
        <p>本工具将初始时区的时间换算为所选城市的当地时间，基于系统时区数据库，自动处理夏令时。</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { formatDateTime, formatInTz, parseDateInput, tzOffsetMs, wallTimeToUtc } from '../utils/date'

const props = defineProps<{ payload?: string }>()

// 城市与大洲分组对齐原插件
const CITIES: { continent: string; name: string; tz: string }[] = [
  { continent: 'UTC', name: '世界标准时间', tz: 'UTC' },
  { continent: '亚洲', name: '中国/上海', tz: 'Asia/Shanghai' },
  { continent: '亚洲', name: '日本/东京', tz: 'Asia/Tokyo' },
  { continent: '亚洲', name: '韩国/首尔', tz: 'Asia/Seoul' },
  { continent: '亚洲', name: '新加坡', tz: 'Asia/Singapore' },
  { continent: '亚洲', name: '泰国/曼谷', tz: 'Asia/Bangkok' },
  { continent: '亚洲', name: '尼泊尔/加德满都', tz: 'Asia/Kathmandu' },
  { continent: '亚洲', name: '孟加拉/达卡', tz: 'Asia/Dhaka' },
  { continent: '亚洲', name: '印度/加尔各答', tz: 'Asia/Kolkata' },
  { continent: '亚洲', name: '斯里兰卡/科伦坡', tz: 'Asia/Colombo' },
  { continent: '亚洲', name: '巴基斯坦/卡拉奇', tz: 'Asia/Karachi' },
  { continent: '亚洲', name: '阿富汗/喀布尔', tz: 'Asia/Kabul' },
  { continent: '亚洲', name: '阿联酋/迪拜', tz: 'Asia/Dubai' },
  { continent: '亚洲', name: '伊拉克/巴格达', tz: 'Asia/Baghdad' },
  { continent: '非洲', name: '肯尼亚/内罗毕', tz: 'Africa/Nairobi' },
  { continent: '非洲', name: '埃及/开罗', tz: 'Africa/Cairo' },
  { continent: '非洲', name: '尼日利亚/拉各斯', tz: 'Africa/Lagos' },
  { continent: '欧洲', name: '俄罗斯/莫斯科', tz: 'Europe/Moscow' },
  { continent: '欧洲', name: '土耳其/伊斯坦布尔', tz: 'Europe/Istanbul' },
  { continent: '欧洲', name: '罗马尼亚/布加勒斯特', tz: 'Europe/Bucharest' },
  { continent: '欧洲', name: '法国/巴黎', tz: 'Europe/Paris' },
  { continent: '欧洲', name: '德国/柏林', tz: 'Europe/Berlin' },
  { continent: '欧洲', name: '英国/伦敦', tz: 'Europe/London' },
  { continent: '欧洲', name: '荷兰/阿姆斯特丹', tz: 'Europe/Amsterdam' },
  { continent: '欧洲', name: '爱尔兰/都柏林', tz: 'Europe/Dublin' },
  { continent: '美洲', name: '美国/纽约', tz: 'America/New_York' },
  { continent: '美洲', name: '美国/芝加哥', tz: 'America/Chicago' },
  { continent: '美洲', name: '美国/盐湖城', tz: 'America/Boise' },
  { continent: '美洲', name: '美国/洛杉矶', tz: 'America/Los_Angeles' },
  { continent: '美洲', name: '加拿大/温哥华', tz: 'America/Vancouver' },
  { continent: '美洲', name: '加拿大/温尼伯', tz: 'America/Winnipeg' },
  { continent: '美洲', name: '加拿大/多伦多', tz: 'America/Toronto' },
  { continent: '美洲', name: '巴西/圣保罗', tz: 'America/Sao_Paulo' },
  { continent: '美洲', name: '秘鲁/利马', tz: 'America/Lima' },
  { continent: '美洲', name: '墨西哥/墨西哥城', tz: 'America/Mexico_City' },
  { continent: '大洋洲', name: '新西兰/奥克兰', tz: 'Pacific/Auckland' },
  { continent: '大洋洲', name: '澳大利亚/悉尼', tz: 'Australia/Sydney' }
]

const dtInput = ref(formatDateTime(new Date()))
const srcTz = ref('Asia/Shanghai')
const selected = reactive(new Set<string>(CITIES.map((c) => c.tz)))
const converted = ref(false)
const rows = ref<{ continent: string; name: string; time: string; tz: string; offset: string }[] | null>(null)

const setNow = () => {
  dtInput.value = formatDateTime(new Date())
}

// 转换时区下拉多选（对齐原插件 el-select 外观）
const open = ref(false)
const firstSelectedName = computed(() => {
  const first = CITIES.find((c) => selected.has(c.tz))
  return first ? first.name : ''
})
const closePanel = () => (open.value = false)
onMounted(() => document.addEventListener('click', closePanel))
onUnmounted(() => document.removeEventListener('click', closePanel))

const toggleCity = (tz: string) => {
  if (selected.has(tz)) selected.delete(tz)
  else selected.add(tz)
}
const selectAll = () => CITIES.forEach((c) => selected.add(c.tz))
const selectNone = () => selected.clear()
const selectInvert = () => CITIES.forEach((c) => toggleCity(c.tz))

// "+08:00" 形式的偏移量（对齐原插件表格）
const offsetLabel = (ms: number) => {
  const sign = ms >= 0 ? '+' : '-'
  const abs = Math.abs(ms)
  const h = String(Math.floor(abs / 3600000)).padStart(2, '0')
  const m = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0')
  return `${sign}${h}:${m}`
}

const convert = () => {
  converted.value = true
  const parsed = parseDateInput(dtInput.value)
  if (!parsed || selected.size === 0) {
    rows.value = null
    return
  }
  const wallUtcMs = Date.UTC(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    parsed.getHours(),
    parsed.getMinutes(),
    parsed.getSeconds()
  )
  const instant = wallTimeToUtc(wallUtcMs, srcTz.value)
  rows.value = CITIES.filter((c) => selected.has(c.tz)).map((c) => ({
    continent: c.continent,
    name: c.name,
    time: formatInTz(instant, c.tz),
    tz: c.tz,
    offset: offsetLabel(tzOffsetMs(c.tz, instant))
  }))
}

// 关键字入口带入的日期，直接转换
watch(
  () => props.payload,
  (val) => {
    if (!val) return
    const d = parseDateInput(val)
    if (d) {
      dtInput.value = formatDateTime(d)
      convert()
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

.tz-select {
  min-width: 240px;
}

.tz-dropdown {
  position: relative;
  display: inline-block;
  vertical-align: middle;
  margin-right: 6px;
}

.tz-display {
  width: 240px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  overflow: hidden;
}

.tz-tag {
  background-color: #f4f4f5;
  border: 1px solid #e9e9eb;
  color: #909399;
  font-size: 12px;
  line-height: 20px;
  padding: 0 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.tz-placeholder {
  color: #c0c4cc;
}

.tz-caret {
  margin-left: auto;
  color: #c0c4cc;
  transition: transform 0.2s;
}

.tz-caret.open {
  transform: rotate(180deg);
}

.tz-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 280px;
  max-height: 230px;
  overflow-y: auto;
  background-color: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  z-index: 20;
  padding: 4px 0;
}

.tz-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  cursor: pointer;
  white-space: nowrap;
}

.tz-option:hover {
  background-color: #f5f7fa;
}

.tz-option.selected {
  color: var(--blue);
  font-weight: 600;
}

.tz-code {
  color: #8492a6;
  font-size: 13px;
}

.tz-tick {
  font-style: normal;
  color: var(--blue);
  margin-left: 6px;
  font-weight: 700;
}

.my-table {
  font-variant-numeric: tabular-nums;
}

@media (prefers-color-scheme: dark) {
  .tz-panel {
    background-color: #3a3d40;
    border-color: #555;
  }

  .tz-option:hover {
    background-color: #46494d;
  }

  .tz-tag {
    background-color: #46494d;
    border-color: #555;
    color: #c0c4cc;
  }
}
</style>
