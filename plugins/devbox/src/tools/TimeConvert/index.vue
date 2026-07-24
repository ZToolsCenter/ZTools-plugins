<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null

// Input conversion
const inputTime = ref('')
const parseError = ref('')

// Timezone offset in hours (default: local)
const timezoneOffset = ref(-new Date().getTimezoneOffset() / 60)
const timezoneOptions = [
  { label: '本地时间', value: -new Date().getTimezoneOffset() / 60 },
  { label: 'UTC+0 (伦敦)', value: 0 },
  { label: 'UTC+8 (北京/上海)', value: 8 },
  { label: 'UTC+9 (东京)', value: 9 },
  { label: 'UTC-5 (纽约)', value: -5 },
  { label: 'UTC-8 (洛杉矶)', value: -8 },
  { label: 'UTC+1 (巴黎)', value: 1 },
  { label: 'UTC+5:30 (印度)', value: 5.5 },
  { label: 'UTC+10 (悉尼)', value: 10 },
]

// Parse input to Date
const parsedDate = computed(() => {
  if (!inputTime.value.trim()) {
    parseError.value = ''
    return null
  }
  const raw = inputTime.value.trim()

  // Try Unix timestamp (seconds or milliseconds)
  if (/^\d{10}$|^\d{13}$/.test(raw)) {
    const num = Number(raw)
    const ms = raw.length === 10 ? num * 1000 : num
    const d = new Date(ms)
    if (!isNaN(d.getTime())) {
      parseError.value = ''
      return d
    }
  }

  // Try ISO 8601 or common date formats
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    parseError.value = ''
    return d
  }

  parseError.value = '无法识别的时间格式'
  return null
})

// The date to display (either now or parsed)
const displayDate = computed(() => parsedDate.value || now.value)
const isInputMode = computed(() => !!parsedDate.value)

// Format helpers
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(d: Date, offsetHours: number): Date {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000
  return new Date(utcMs + offsetHours * 3600000)
}

function getTimezoneStr(offset: number): string {
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const hours = Math.floor(abs)
  const minutes = (abs - hours) * 60
  return minutes > 0
    ? `${sign}${pad2(hours)}:${pad2(minutes)}`
    : `${sign}${pad2(hours)}:00`
}

const tzStr = computed(() => getTimezoneStr(timezoneOffset.value))
const localD = computed(() => formatDate(displayDate.value, timezoneOffset.value))

// Always-current time string (independent of input)
const nowStr = computed(() => {
  const d = formatDate(now.value, timezoneOffset.value)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
})

// Format outputs
const formats = computed(() => {
  const d = displayDate.value
  const ld = localD.value
  const year = ld.getFullYear()
  const month = pad2(ld.getMonth() + 1)
  const day = pad2(ld.getDate())
  const hour = pad2(ld.getHours())
  const minute = pad2(ld.getMinutes())
  const second = pad2(ld.getSeconds())
  const ms = String(ld.getMilliseconds()).padStart(3, '0')

  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const weekDay = weekDays[ld.getDay()]

  const utcYear = d.getUTCFullYear()
  const utcMonth = pad2(d.getUTCMonth() + 1)
  const utcDay = pad2(d.getUTCDate())
  const utcHour = pad2(d.getUTCHours())
  const utcMinute = pad2(d.getUTCMinutes())
  const utcSecond = pad2(d.getUTCSeconds())

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const unixSec = Math.floor(d.getTime() / 1000)
  const unixMs = d.getTime()

  return [
    {
      label: '格式化时间',
      value: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
      desc: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      label: '带毫秒',
      value: `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`,
      desc: 'YYYY-MM-DD HH:mm:ss.SSS',
    },
    {
      label: '星期',
      value: `${year}年${ld.getMonth() + 1}月${ld.getDate()}日 星期${weekDay}`,
      desc: '中文日期格式',
    },
    {
      label: 'ISO 8601',
      value: `${year}-${month}-${day}T${hour}:${minute}:${second}${tzStr.value}`,
      desc: '带时区的 ISO 格式',
    },
    {
      label: 'UTC',
      value: `${utcYear}-${utcMonth}-${utcDay}T${utcHour}:${utcMinute}:${utcSecond}Z`,
      desc: 'UTC 标准格式',
    },
    {
      label: 'RFC 2822',
      value: `${days[ld.getDay()]}, ${day} ${months[ld.getMonth()]} ${year} ${hour}:${minute}:${second} ${tzStr.value}`,
      desc: 'RFC 2822 邮件日期格式',
    },
    {
      label: 'Unix 时间戳 (秒)',
      value: String(unixSec),
      desc: '10 位秒级时间戳',
    },
    {
      label: 'Unix 时间戳 (毫秒)',
      value: String(unixMs),
      desc: '13 位毫秒级时间戳',
    },
    {
      label: '相对时间',
      value: getRelativeTime(d),
      desc: '人类可读的相对时间',
    },
    {
      label: '路径格式',
      value: `${year}/${month}/${day}`,
      desc: 'YYYY/MM/DD',
    },
    {
      label: '紧凑格式',
      value: `${year}${month}${day}${hour}${minute}${second}`,
      desc: 'YYYYMMDDHHmmss',
    },
  ]
})

function getRelativeTime(d: Date): string {
  const diff = now.value.getTime() - d.getTime()
  const absDiff = Math.abs(diff)
  const suffix = diff >= 0 ? '前' : '后'

  if (absDiff < 60000) return diff >= 0 ? '刚刚' : '片刻后'
  if (absDiff < 3600000) return `${Math.floor(absDiff / 60000)} 分钟${suffix}`
  if (absDiff < 86400000) return `${Math.floor(absDiff / 3600000)} 小时${suffix}`
  if (absDiff < 2592000000) return `${Math.floor(absDiff / 86400000)} 天${suffix}`
  if (absDiff < 31536000000) return `${Math.floor(absDiff / 2592000000)} 个月${suffix}`
  return `${Math.floor(absDiff / 31536000000)} 年${suffix}`
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function copyAll() {
  const text = formats.value.map(f => `${f.label}: ${f.value}`).join('\n')
  copyText(text)
}

function setToNow() {
  inputTime.value = ''
  parseError.value = ''
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="time-convert">
    <div class="header-row">
      <h2>时间转换</h2>
      <span class="live-clock" @click="copyText(nowStr)">{{ nowStr }}</span>
    </div>
    <p class="desc">输入时间戳或日期字符串进行格式转换，点击任意行复制</p>

    <!-- Input area -->
    <div class="input-area">
      <el-input
        v-model="inputTime"
        placeholder="输入时间戳或日期字符串进行转换"
        clearable
        size="small"
        @clear="parseError = ''"
      >
        <template #prepend>
          <el-select v-model="timezoneOffset" size="small" style="width: 130px" placeholder="时区">
            <el-option
              v-for="opt in timezoneOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </template>
        <template #append>
          <el-button @click="setToNow" :disabled="!isInputMode" size="small">回到当前</el-button>
        </template>
      </el-input>
      <div v-if="parseError" class="error-msg">{{ parseError }}</div>
    </div>

    <!-- Format results -->
    <div class="format-list">
      <div
        v-for="fmt in formats"
        :key="fmt.label"
        class="format-item"
        @click="copyText(fmt.value)"
        :title="fmt.desc"
      >
        <span class="format-label">{{ fmt.label }}</span>
        <span class="format-value">{{ fmt.value }}</span>
      </div>
    </div>

    <!-- Copy all -->
    <div class="actions">
      <el-button size="small" @click="copyAll">复制全部格式</el-button>
    </div>
  </div>
</template>

<style scoped>
.time-convert {
  padding: 8px 12px;
  max-width: 520px;
  margin: 0 auto;
  font-size: 12px;
}

h2 {
  margin: 0 0 2px;
  font-size: 18px;
  font-weight: 600;
}

.desc {
  color: #909399;
  margin: 0 0 10px;
  font-size: 12px;
}

.header-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 2px;
}

.live-clock {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 16px;
  font-weight: 600;
  color: #e6a23c;
  cursor: pointer;
  transition: opacity 0.15s;
}

.live-clock:hover {
  opacity: 0.7;
}

.input-area {
  margin-bottom: 8px;
}

.error-msg {
  color: #f56c6c;
  font-size: 11px;
  margin-top: 2px;
}

.format-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}

.format-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  gap: 12px;
}

.format-item:hover {
  background: var(--bg-hover, #f5f7ff);
  border-color: #667eea;
}

.format-label {
  font-weight: 500;
  font-size: 12px;
  color: var(--text-primary, #333);
  white-space: nowrap;
}

.format-value {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  color: var(--text-primary, #333);
  text-align: right;
  word-break: break-all;
  min-width: 0;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

@media (prefers-color-scheme: dark) {
  h2 {
    color: #e0e0e0;
  }

  .desc {
    color: #8a8a8a;
  }

  .format-item {
    background: #2c2c2c;
    border-color: #444;
  }

  .format-item:hover {
    background: #363640;
    border-color: #667eea;
  }

  .format-label {
    color: #ddd;
  }

  .format-value {
    color: #ddd;
  }
}
</style>
