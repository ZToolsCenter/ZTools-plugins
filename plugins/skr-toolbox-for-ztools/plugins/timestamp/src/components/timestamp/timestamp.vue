<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  launchParam: {
    type: Object,
    required: true
  }
})

// 数字补零函数
const pad = (n: number) => String(n).padStart(2, '0')

// 格式化日期为 YYYY-MM-DD HH:mm:ss
const formatDateTime = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const inputValue = ref(props.launchParam.payload || new Date().getTime().toString())

watch(() => props.launchParam.payload, (payload) => {
  if (payload) {
    inputValue.value = payload
  }
})

// 其它时区面板显示状态
const showOtherTimezones = ref(false)

// 复制到剪贴板
const copyToClipboard = (text: string) => {
  if (text === '-') return
  try {
    window.ztools.copyText(text)
    // 复制成功后退出插件
    window.ztools.outPlugin(true)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 解析输入为 Date 对象（日期字符串使用本地时区）
const parsedDate = computed(() => {
  if (!inputValue.value) return null
  const trimmed = inputValue.value.trim()
  // 如果是纯数字，视为毫秒时间戳
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed)
    return new Date(num < 1e12 ? num * 1000 : num)
  }
  // 尝试解析为本地时间日期字符串
  // 支持 YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DDTHH:mm:ss 格式
  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}):(\d{1,2}))?/)
  if (match) {
    const [, year, month, day, hour = 0, minute = 0, second = 0] = match
    // 使用本地时间组件创建 Date
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }
  // 其他格式尝试直接解析（浏览器行为不一致，但作为兜底）
  const date = new Date(trimmed)
  return isNaN(date.getTime()) ? null : date
})

// 格式化本地时间
const localTimeFull = computed(() => {
  if (!parsedDate.value) return '-'
  return formatDateTime(parsedDate.value)
})

// 格式化本地日期
const localTimeDate = computed(() => {
  if (!parsedDate.value) return '-'
  return `${parsedDate.value.getFullYear()}-${pad(parsedDate.value.getMonth() + 1)}-${pad(parsedDate.value.getDate())}`
})

// 时间戳(秒)
const timestampSeconds = computed(() => {
  if (!parsedDate.value) return '-'
  return String(Math.floor(parsedDate.value.getTime() / 1000))
})

// 时间戳(毫秒)
const timestampMilliseconds = computed(() => {
  if (!parsedDate.value) return '-'
  return String(parsedDate.value.getTime())
})

// UTC 时间
const utcTime = computed(() => {
  if (!parsedDate.value) return '-'
  return parsedDate.value.toISOString().replace('T', ' ').substring(0, 19)
})

// 根据偏移量计算时区时间
const getTimezoneTime = (offsetMinutes: number) => {
  if (!parsedDate.value) return '-'
  // 获取 UTC 时间组件
  const utcYear = parsedDate.value.getUTCFullYear()
  const utcMonth = parsedDate.value.getUTCMonth()
  const utcDate = parsedDate.value.getUTCDate()
  const utcHours = parsedDate.value.getUTCHours()
  const utcMinutes = parsedDate.value.getUTCMinutes()
  const utcSeconds = parsedDate.value.getUTCSeconds()

  // 创建 UTC 时间并应用偏移
  const utcMs = Date.UTC(utcYear, utcMonth, utcDate, utcHours, utcMinutes, utcSeconds)
  const timezoneMs = utcMs + offsetMinutes * 60 * 1000
  const timezoneDate = new Date(timezoneMs)

  // 手动格式化，避免使用本地时区
  return `${timezoneDate.getUTCFullYear()}-${pad(timezoneDate.getUTCMonth() + 1)}-${pad(timezoneDate.getUTCDate())} ${pad(timezoneDate.getUTCHours())}:${pad(timezoneDate.getUTCMinutes())}:${pad(timezoneDate.getUTCSeconds())}`
}

// 时区数组
const timezones = [
  { offset: -720, name: 'UTC-12:00 贝克岛时间(BIT)' },
  { offset: -660, name: 'UTC-11:00 萨摩亚标准时间(SST)、纽埃时间(NUT)' },
  { offset: -600, name: 'UTC-10:00 夏威夷-阿留申标准时间(HST)、塔希提时间(TAHT)' },
  { offset: -570, name: 'UTC-9:30 马克萨斯群岛时间(MART)' },
  { offset: -540, name: 'UTC-9:00 阿拉斯加标准时间(AKST)、甘比尔群岛时间(GIT)' },
  { offset: -480, name: 'UTC-8:00 太平洋标准时间(PST)' },
  { offset: -420, name: 'UTC-7:00 山地标准时间(MST)' },
  { offset: -360, name: 'UTC-6:00 北美中部标准时间(CST)' },
  { offset: -300, name: 'UTC-5:00 北美东部标准时间(EST)' },
  { offset: -240, name: 'UTC-4:00 大西洋标准时间(AST)' },
  { offset: -210, name: 'UTC-3:30 纽芬兰标准时间(NST)' },
  { offset: -180, name: 'UTC-3:00 阿根廷时间(ART)、巴西利亚时间(BRT)' },
  { offset: -120, name: 'UTC-2:00 南乔治亚时间(GST)' },
  { offset: -60, name: 'UTC-1:00 亚速尔时间(AZOT)、佛得角时间(CVT)' },
  { offset: 0, name: 'UTC±0:00 格林威治标准时间(GMT)、世界标准时间(WET)、祖鲁时间(Z)' },
  { offset: 60, name: 'UTC+1:00 欧洲中部时间(CET)、西非时间(WAT)' },
  { offset: 120, name: 'UTC+2:00 欧洲东部时间(EET)、中部非洲时间(CAT)、以色列标准时间(IST)' },
  { offset: 180, name: 'UTC+3:00 莫斯科时间(MSK)、东非时间(EAT)、阿拉伯标准时间(AST)' },
  { offset: 210, name: 'UTC+3:30 伊朗标准时间(IRST)' },
  { offset: 240, name: 'UTC+4:00 海湾标准时间(GST)、萨马拉时间(SAMT)' },
  { offset: 270, name: 'UTC+4:30 阿富汗时间(AFT)' },
  { offset: 300, name: 'UTC+5:00 巴基斯坦标准时间(PKT)、叶卡捷琳堡时间(YEKT)' },
  { offset: 330, name: 'UTC+5:30 印度标准时间(IST)' },
  { offset: 345, name: 'UTC+5:45 尼泊尔时间(NPT)' },
  { offset: 360, name: 'UTC+6:00 孟加拉时间(BDT)、不丹时间(BTT)、鄂木斯克时间(OMST)' },
  { offset: 390, name: 'UTC+6:30 缅甸时间(MMT)、科科斯群岛时间(CCT)' },
  { offset: 420, name: 'UTC+7:00 中南半岛时间(ICT)、克拉斯诺亚尔斯克时间(KRAT)' },
  { offset: 480, name: 'UTC+8:00 中国标准时间(CST)、新加坡时间(SGT)、澳大利亚西部标准时间(AWST)、香港时间(HKT)、菲律宾时间(PHT)' },
  { offset: 525, name: 'UTC+8:45 澳大利亚中西部标准时间(ACWST)' },
  { offset: 540, name: 'UTC+9:00 日本标准时间(JST)、韩国标准时间(KST)、雅库茨克时间(YAKT)' },
  { offset: 570, name: 'UTC+9:30 澳大利亚中部标准时间(ACST)' },
  { offset: 600, name: 'UTC+10:00 澳大利亚东部标准时间(AEST)、符拉迪沃斯托克（海参崴）时间(VLAT)' },
  { offset: 630, name: 'UTC+10:30 豪勋爵岛标准时间(LHST)' },
  { offset: 660, name: 'UTC+11:00 所罗门群岛时间(SBT)、马加丹时间(MAGT)' },
  { offset: 720, name: 'UTC+12:00 新西兰标准时间(NZST)、斐济时间(FJT)、堪察加时间(PETT)' },
  { offset: 765, name: 'UTC+12:45 查塔姆标准时间(CHAST)' },
  { offset: 780, name: 'UTC+13:00 汤加时间(TOT)、菲尼克斯群岛时间(PHOT)' },
  { offset: 840, name: 'UTC+14:00 莱恩群岛时间(LINT)' }
]

// 快捷键复制
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
const modKey = isMac ? 'metaKey' : 'ctrlKey'

const handleKeyboard = (e: KeyboardEvent) => {
  if (!e[modKey]) return
  const num = parseInt(e.key)
  if (isNaN(num) || num < 1 || num > 5) return

  const values = [
    localTimeFull.value,
    localTimeDate.value,
    timestampSeconds.value,
    timestampMilliseconds.value,
    utcTime.value
  ]
  copyToClipboard(values[num - 1])
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyboard)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboard)
})
</script>

<template>
  <div class="bg-gray-50">
    <div class="bg-white">
      <!-- Header -->
      <div class="p-4 border-b bg-gray-50">
        <input
          type="text"
          class="w-full px-3 py-2 text-xl font-medium text-gray-800 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="请输入时间戳或时间..."
          v-model="inputValue"
        />
      </div>

      <!-- Time conversion results -->
      <div class="divide-y">
        <!-- Local time with dynamic timezone -->
        <div class="flex items-center justify-between p-4 hover:bg-gray-50">
          <div class="flex-1">
            <span class="text-gray-600 text-sm">本地时间</span>
            <div class="text-lg font-mono text-gray-900">{{ localTimeFull }}</div>
          </div>
          <button
            class="copy-btn px-3 py-2 text-xs border border-gray-300 rounded hover:bg-blue-500 hover:text-white transition-colors cursor-pointer"
            :data-copy="localTimeFull"
            @click="copyToClipboard(localTimeFull)"
          >
            复制 (⌘ + 1)
          </button>
        </div>

        <!-- Local time date with dynamic timezone -->
        <div class="flex items-center justify-between p-4 hover:bg-gray-50">
          <div class="flex-1">
            <span class="text-gray-600 text-sm">本地时间(日期)</span>
            <div class="text-lg font-mono text-gray-900">{{ localTimeDate }}</div>
          </div>
          <button
            class="copy-btn px-3 py-2 text-xs border border-gray-300 rounded hover:bg-blue-500 hover:text-white transition-colors cursor-pointer"
            :data-copy="localTimeDate"
            @click="copyToClipboard(localTimeDate)"
          >
            复制 (⌘ + 2)
          </button>
        </div>

        <!-- 时间戳(秒) -->
        <div class="flex items-center justify-between p-4 hover:bg-gray-50">
          <div class="flex-1">
            <span class="text-gray-600 text-sm">时间戳(秒)</span>
            <div class="text-lg font-mono text-gray-900">{{ timestampSeconds }}</div>
          </div>
          <button
            class="copy-btn px-3 py-2 text-xs border border-gray-300 rounded hover:bg-blue-500 hover:text-white transition-colors cursor-pointer"
            :data-copy="timestampSeconds"
            @click="copyToClipboard(timestampSeconds)"
          >
            复制 (⌘ + 3)
          </button>
        </div>

        <!-- 时间戳(毫秒) -->
        <div class="flex items-center justify-between p-4 hover:bg-gray-50">
          <div class="flex-1">
            <span class="text-gray-600 text-sm">时间戳(毫秒)</span>
            <div class="text-lg font-mono text-gray-900">{{ timestampMilliseconds }}</div>
          </div>
          <button
            class="copy-btn px-3 py-2 text-xs border border-gray-300 rounded hover:bg-blue-500 hover:text-white transition-colors cursor-pointer"
            :data-copy="timestampMilliseconds"
            @click="copyToClipboard(timestampMilliseconds)"
          >
            复制 (⌘ + 4)
          </button>
        </div>

        <!-- 标准时间(UTC) -->
        <div class="flex items-center justify-between p-4 hover:bg-gray-50">
          <div class="flex-1">
            <span class="text-gray-600 text-sm">标准时间(UTC)</span>
            <div class="text-lg font-mono text-gray-900">{{ utcTime }}</div>
          </div>
          <button
            class="copy-btn px-3 py-2 text-xs border border-gray-300 rounded hover:bg-blue-500 hover:text-white transition-colors cursor-pointer"
            :data-copy="utcTime"
            @click="copyToClipboard(utcTime)"
          >
            复制 (⌘ + 5)
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-4 border-t bg-gray-50 text-right">
        <button
          class="inline-flex items-center text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
          @click="showOtherTimezones = !showOtherTimezones"
        >
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            ></path>
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            ></path>
          </svg>
          其它时区
        </button>
      </div>

      <!-- 其它时区 -->
      <div :class="showOtherTimezones ? 'border-t' : 'hidden border-t'">
        <div
          v-for="tz in timezones"
          :key="tz.offset"
          class="flex items-center justify-between p-4 hover:bg-gray-50 border-b"
        >
          <div class="flex-1">
            <span class="text-gray-600 text-sm">{{ tz.name }}</span>
            <div class="text-lg font-mono text-gray-900">{{ getTimezoneTime(tz.offset) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
