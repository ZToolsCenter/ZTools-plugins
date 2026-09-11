<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface TimezoneDefinition {
  id: string
  offsetMinutes: number
  label: string
}

interface UtcFormatDefinition {
  id: string
  label: string
  fractionDigits: 3 | 9
}

interface TimestampResult {
  id: string
  label: string
  value: string
}

const LOCAL_OFFSET_MINUTES = 8 * 60
const LOCAL_TIME_LABEL = 'UTC+8 中国标准时间(本地时间)'
const SELECTED_TIMEZONES_KEY = 'timestamp.selected-timezones'
const DATE_PATTERN = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:[.,](\d{1,9}))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/

const TIMEZONES: TimezoneDefinition[] = [
  { id: 'utc-minus-11', offsetMinutes: -11 * 60, label: 'UTC-11 中途岛标准时间' },
  { id: 'utc-minus-10', offsetMinutes: -10 * 60, label: 'UTC-10 夏威夷-阿留申标准时间' },
  { id: 'utc-minus-9-30', offsetMinutes: -(9 * 60 + 30), label: 'UTC-9:30 马克萨斯群岛标准时间' },
  { id: 'utc-minus-9', offsetMinutes: -9 * 60, label: 'UTC-9 阿拉斯加标准时间' },
  { id: 'utc-minus-8', offsetMinutes: -8 * 60, label: 'UTC-8 太平洋标准时间' },
  { id: 'utc-minus-7', offsetMinutes: -7 * 60, label: 'UTC-7 北美山区标准时间' },
  { id: 'utc-minus-6', offsetMinutes: -6 * 60, label: 'UTC-6 北美中部标准时间' },
  { id: 'utc-minus-5', offsetMinutes: -5 * 60, label: 'UTC-5 北美东部标准时间' },
  { id: 'utc-minus-4', offsetMinutes: -4 * 60, label: 'UTC-4 大西洋标准时间' },
  { id: 'utc-minus-3-30', offsetMinutes: -(3 * 60 + 30), label: 'UTC-3:30 纽芬兰岛标准时间' },
  { id: 'utc-minus-3', offsetMinutes: -3 * 60, label: 'UTC-3 南美标准时间' },
  { id: 'utc-minus-2', offsetMinutes: -2 * 60, label: 'UTC-2 巴西时间' },
  { id: 'utc-minus-1', offsetMinutes: -1 * 60, label: 'UTC-1 佛得角标准时间' },
  { id: 'utc-plus-1', offsetMinutes: 1 * 60, label: 'UTC+1 欧洲中部时区' },
  { id: 'utc-plus-2', offsetMinutes: 2 * 60, label: 'UTC+2 欧洲东部时区' },
  { id: 'utc-plus-3', offsetMinutes: 3 * 60, label: 'UTC+3 莫斯科标准时间' },
  { id: 'utc-plus-3-30', offsetMinutes: 3 * 60 + 30, label: 'UTC+3:30 伊朗标准时间' },
  { id: 'utc-plus-4', offsetMinutes: 4 * 60, label: 'UTC+4 海湾标准时间' },
  { id: 'utc-plus-4-30', offsetMinutes: 4 * 60 + 30, label: 'UTC+4:30 阿富汗标准时间' },
  { id: 'utc-plus-5', offsetMinutes: 5 * 60, label: 'UTC+5 巴基斯坦标准时间' },
  { id: 'utc-plus-5-30', offsetMinutes: 5 * 60 + 30, label: 'UTC+5:30 印度标准时间' },
  { id: 'utc-plus-5-45', offsetMinutes: 5 * 60 + 45, label: 'UTC+5:45 尼泊尔标准时间' },
  { id: 'utc-plus-6', offsetMinutes: 6 * 60, label: 'UTC+6 孟加拉国标准时间' },
  { id: 'utc-plus-6-30', offsetMinutes: 6 * 60 + 30, label: 'UTC+6:30 缅甸标准时间' },
  { id: 'utc-plus-7', offsetMinutes: 7 * 60, label: 'UTC+7 科布多标准时间' },
  { id: 'utc-plus-8', offsetMinutes: 8 * 60, label: 'UTC+8 中国标准时间' },
  { id: 'utc-plus-9', offsetMinutes: 9 * 60, label: 'UTC+9 日本标准时间' },
  { id: 'utc-plus-9-30', offsetMinutes: 9 * 60 + 30, label: 'UTC+9:30 澳大利亚中部标准时间' },
  { id: 'utc-plus-10', offsetMinutes: 10 * 60, label: 'UTC+10 澳大利亚东部标准时间' },
  { id: 'utc-plus-11', offsetMinutes: 11 * 60, label: 'UTC+11 瓦努阿图标准时间' },
  { id: 'utc-plus-12', offsetMinutes: 12 * 60, label: 'UTC+12 太平洋标准时间B' },
  { id: 'utc-plus-12-45', offsetMinutes: 12 * 60 + 45, label: 'UTC+12:45 查塔姆群岛标准时间' },
  { id: 'utc-plus-13', offsetMinutes: 13 * 60, label: 'UTC+13 太平洋标准时间C' },
  { id: 'utc-plus-14', offsetMinutes: 14 * 60, label: 'UTC+14 太平洋标准时间D' }
]

const UTC_FORMATS: UtcFormatDefinition[] = [
  {
    id: 'utc-iso-milliseconds',
    label: '标准时间(UTC), ISO 8601(毫秒)',
    fractionDigits: 3
  },
  {
    id: 'utc-iso-nanoseconds',
    label: '标准时间(UTC), ISO 8601(纳秒)',
    fractionDigits: 9
  }
]

const inputElement = ref<HTMLInputElement | null>(null)
const inputValue = ref(String(Date.now()))
const selectedTimezones = ref<string[]>(loadSelectedTimezones())
const isTimezonePanelOpen = ref(false)
const isDetachedWindow = ref(false)

const parsedTimestamp = computed(() => parseTimeInput(inputValue.value))
const displayedResults = computed<TimestampResult[]>(() => {
  const timestamp = parsedTimestamp.value
  const commonResults: TimestampResult[] = [
    {
      id: 'local-time',
      label: LOCAL_TIME_LABEL,
      value: timestamp === null ? '' : formatWithOffset(timestamp, LOCAL_OFFSET_MINUTES)
    },
    {
      id: 'local-date',
      label: `${LOCAL_TIME_LABEL}, 日期`,
      value: timestamp === null ? '' : formatDateOnly(timestamp, LOCAL_OFFSET_MINUTES)
    },
    {
      id: 'seconds',
      label: '时间戳(秒)',
      value: timestamp === null ? '' : String(Math.floor(timestamp / 1000))
    },
    {
      id: 'milliseconds',
      label: '时间戳(毫秒)',
      value: timestamp === null ? '' : String(timestamp)
    },
    {
      id: 'utc',
      label: '标准时间(UTC)',
      value: timestamp === null ? '' : formatWithOffset(timestamp, 0)
    }
  ]

  return commonResults.concat(
    TIMEZONES.filter((timezone) => selectedTimezones.value.includes(timezone.id)).map((timezone) => ({
      id: timezone.id,
      label: timezone.label,
      value: timestamp === null ? '' : formatWithOffset(timestamp, timezone.offsetMinutes)
    })),
    UTC_FORMATS.filter((format) => selectedTimezones.value.includes(format.id)).map((format) => ({
      id: format.id,
      label: format.label,
      value: timestamp === null ? '' : formatIsoUtc(timestamp, format.fractionDigits)
    }))
  )
})

/** 过滤并校验已保存的时区和 UTC 格式选项。 */
function normalizeSelectedTimezones(value: unknown): string[] {
  let values = value
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values)
    } catch (_error) {
      return []
    }
  }

  if (!Array.isArray(values)) return []

  return values.filter((item): item is string =>
    TIMEZONES.some((timezone) => timezone.id === item) ||
    UTC_FORMATS.some((format) => format.id === item)
  )
}

/** 读取用户上次勾选的时区，zTools 中使用插件数据存储。 */
function loadSelectedTimezones(): string[] {
  const ztoolsApi = getZToolsApi()
  if (ztoolsApi) {
    try {
      if (typeof ztoolsApi.dbStorage?.getItem !== 'function') return []
      return normalizeSelectedTimezones(
        ztoolsApi.dbStorage.getItem(SELECTED_TIMEZONES_KEY)
      )
    } catch (_error) {
      return []
    }
  }

  try {
    const saved = window.localStorage.getItem(SELECTED_TIMEZONES_KEY)
    return saved ? normalizeSelectedTimezones(JSON.parse(saved)) : []
  } catch (_error) {
    return []
  }
}

/** 保存用户勾选的时区，供下次打开插件继续使用。 */
function saveSelectedTimezones(): void {
  const ztoolsApi = getZToolsApi()
  if (ztoolsApi) {
    try {
      if (typeof ztoolsApi.dbStorage?.setItem === 'function') {
        ztoolsApi.dbStorage.setItem(SELECTED_TIMEZONES_KEY, selectedTimezones.value)
      }
    } catch (_error) {
      // zTools 数据存储不可用时不影响转换功能。
    }
    return
  }

  try {
    window.localStorage.setItem(
      SELECTED_TIMEZONES_KEY,
      JSON.stringify(selectedTimezones.value)
    )
  } catch (_error) {
    // 浏览器禁用本地存储时不影响转换功能。
  }
}

/** 将常见的中文日期写法转换成可统一解析的形式。 */
function normalizeDateText(value: string): string {
  return value
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, ' ')
    .replace(/[时時]/g, ':')
    .replace(/分/g, ':')
    .replace(/秒/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 创建本地时区中的日期，并拒绝 JavaScript 自动进位的无效日期。 */
function createLocalTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
): number | null {
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(hour, minute, second, millisecond)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second ||
    date.getMilliseconds() !== millisecond
  ) {
    return null
  }

  return date.getTime()
}

/** 创建指定固定偏移量中的日期，支持 ISO 字符串中的时区。 */
function createOffsetTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  offsetMinutes: number
): number | null {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, millisecond)

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    return null
  }

  return date.getTime() - offsetMinutes * 60 * 1000
}

/** 将日期字符串中的时区部分转换成分钟偏移量。 */
function parseOffsetMinutes(value: string): number | null {
  if (value === 'Z') return 0

  const match = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(value)
  if (!match) return null

  const hours = Number(match[2])
  const minutes = Number(match[3] ?? 0)
  if (minutes > 59) return null

  const offsetMinutes = hours * 60 + minutes
  if (offsetMinutes > 14 * 60) return null

  return match[1] === '+' ? offsetMinutes : -offsetMinutes
}

/** 解析标准日期格式，并在解析前校验日期各字段。 */
function parseDateParts(parts: RegExpExecArray): number | null {
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const hour = Number(parts[4] ?? 0)
  const minute = Number(parts[5] ?? 0)
  const second = Number(parts[6] ?? 0)
  const millisecondText = parts[7] ?? ''
  const millisecond = Number(millisecondText.slice(0, 3).padEnd(3, '0') || 0)

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null
  }

  const timezone = parts[8]
  if (timezone) {
    const offsetMinutes = parseOffsetMinutes(timezone)
    return offsetMinutes === null
      ? null
      : createOffsetTimestamp(
          year,
          month,
          day,
          hour,
          minute,
          second,
          millisecond,
          offsetMinutes
        )
  }

  return createLocalTimestamp(year, month, day, hour, minute, second, millisecond)
}

/** 解析 YYYYMMDD 或 YYYYMMDDHHmmss 形式的紧凑日期。 */
function parseCompactDate(value: string): number | null | undefined {
  if (!/^\d{8}$|^\d{14}$/.test(value)) return undefined

  const year = Number(value.slice(0, 4))
  if (year < 1000 || year > 2999) return null

  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const hour = value.length === 14 ? Number(value.slice(8, 10)) : 0
  const minute = value.length === 14 ? Number(value.slice(10, 12)) : 0
  const second = value.length === 14 ? Number(value.slice(12, 14)) : 0

  return createLocalTimestamp(year, month, day, hour, minute, second, 0)
}

/** 将纯数字输入识别为秒级或毫秒级 Unix 时间戳。 */
function parseNumericTimestamp(value: string): number | null | undefined {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return undefined

  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return null

  const milliseconds = Math.abs(numericValue) < 100_000_000_000
    ? numericValue * 1000
    : numericValue
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) return null

  return Math.trunc(milliseconds)
}

/** 识别时间戳、日期字符串和常见中文日期写法。 */
function parseTimeInput(value: string): number | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) return null

  const compactTimestamp = parseCompactDate(trimmedValue)
  if (compactTimestamp !== undefined) return compactTimestamp

  const numericTimestamp = parseNumericTimestamp(trimmedValue)
  if (numericTimestamp !== undefined) return numericTimestamp

  const normalizedValue = normalizeDateText(trimmedValue)
  const dateParts = DATE_PATTERN.exec(normalizedValue)
  if (dateParts) return parseDateParts(dateParts)

  const parsedValue = Date.parse(trimmedValue)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

/** 用固定 UTC 偏移量格式化日期时间。 */
function formatWithOffset(timestamp: number, offsetMinutes: number): string {
  const date = new Date(timestamp + offsetMinutes * 60 * 1000)
  if (Number.isNaN(date.getTime())) return ''

  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  const second = String(date.getUTCSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

/** 用固定 UTC 偏移量格式化日期部分。 */
function formatDateOnly(timestamp: number, offsetMinutes: number): string {
  return formatWithOffset(timestamp, offsetMinutes).slice(0, 10)
}

/** 格式化带毫秒或纳秒位数的 UTC ISO 8601 字符串。 */
function formatIsoUtc(timestamp: number, fractionDigits: 3 | 9): string {
  const date = new Date(timestamp)
  const base = formatWithOffset(timestamp, 0).replace(' ', 'T')
  if (!base || Number.isNaN(date.getTime())) return ''

  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0')
  const fraction = fractionDigits === 9 ? `${milliseconds}000000` : milliseconds
  return `${base}.${fraction}Z`
}

/** 获取当前 zTools API，浏览器预览模式下允许不存在该对象。 */
function getZToolsApi(): typeof window.ztools | null {
  try {
    return typeof window.ztools === 'undefined' ? null : window.ztools
  } catch (_error) {
    return null
  }
}

/** 判断当前窗口是否为 zTools 自动分离出的独立窗口。 */
function checkDetachedWindow(): boolean {
  const ztoolsApi = getZToolsApi()
  if (!ztoolsApi || isDetachedWindow.value) return isDetachedWindow.value

  try {
    return typeof ztoolsApi.getWindowType === 'function' && ztoolsApi.getWindowType() === 'detach'
  } catch (_error) {
    return isDetachedWindow.value
  }
}

/** 复制结果，并按主窗口或独立窗口的状态决定是否关闭窗口。 */
async function copyResult(result: TimestampResult): Promise<void> {
  if (!result.value) return

  const ztoolsApi = getZToolsApi()
  let copied = false

  if (ztoolsApi) {
    try {
      copied = ztoolsApi.copyText(result.value)
    } catch (_error) {
      copied = false
    }
  }

  if (!copied && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(result.value)
      copied = true
    } catch (_error) {
      copied = false
    }
  }

  if (!copied || !ztoolsApi || checkDetachedWindow()) return

  try {
    ztoolsApi.hideMainWindow()
  } catch (_error) {
    // 窗口已经关闭时无需再次处理。
  }
}

/** 响应 Alt+数字快捷键复制对应行的值。 */
function handleKeydown(event: KeyboardEvent): void {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

  const key = event.code.match(/^Digit([1-9])$/)?.[1] ?? event.key.match(/^[1-9]$/)?.[0]
  if (!key) return

  const result = displayedResults.value[Number(key) - 1]
  if (!result?.value) return

  event.preventDefault()
  void copyResult(result)
}

/** 打开或关闭时区选择侧栏。 */
function toggleTimezonePanel(): void {
  isTimezonePanelOpen.value = !isTimezonePanelOpen.value
}

/** 关闭时区选择侧栏并保留主界面的输入状态。 */
function closeTimezonePanel(): void {
  isTimezonePanelOpen.value = false
}

/** 在插件重新进入时填入当前时间戳并将焦点交给输入框。 */
function resetInputAndFocus(): void {
  inputValue.value = String(Date.now())
  isTimezonePanelOpen.value = false
  void nextTick(() => {
    inputElement.value?.focus()
  })
}

watch(selectedTimezones, saveSelectedTimezones, { deep: true })

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  inputElement.value?.focus()

  const ztoolsApi = getZToolsApi()
  if (!ztoolsApi) return

  isDetachedWindow.value = checkDetachedWindow()
  ztoolsApi.onPluginEnter(resetInputAndFocus)
  if (typeof ztoolsApi.onPluginDetach === 'function') {
    ztoolsApi.onPluginDetach(() => {
      isDetachedWindow.value = true
    })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="timestamp-app">
    <main class="app-content">
      <input
        ref="inputElement"
        v-model="inputValue"
        class="timestamp-input"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="时间输入"
      />

      <section class="result-list" aria-label="时间转换结果">
        <div
          v-for="(result, index) in displayedResults"
          :key="result.id"
          class="result-row"
          :class="{ 'is-empty': !result.value }"
        >
          <span class="result-label">{{ result.label }}</span>
          <span class="result-value">{{ result.value }}</span>
          <div v-if="result.value" class="row-actions">
            <span v-if="index < 9" class="shortcut">Alt+{{ index + 1 }}</span>
            <button
              class="copy-button"
              type="button"
              :aria-label="`复制${result.label}`"
              :title="`复制${result.label}`"
              @click.stop="copyResult(result)"
            >
              <span class="copy-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </section>
    </main>

    <button
      class="timezone-toggle"
      type="button"
      :aria-expanded="isTimezonePanelOpen"
      aria-controls="timezone-panel"
      @click="toggleTimezonePanel"
    >
      <span class="settings-icon" aria-hidden="true">⚙</span>
      <span>其他时区</span>
    </button>

    <template v-if="isTimezonePanelOpen">
      <button
        class="panel-backdrop"
        type="button"
        aria-label="关闭其他时区"
        @click="closeTimezonePanel"
      ></button>
      <aside id="timezone-panel" class="timezone-panel" aria-label="其他时区">
        <label
          v-for="timezone in TIMEZONES"
          :key="timezone.id"
          class="timezone-option"
        >
          <input
            v-model="selectedTimezones"
            type="checkbox"
            :value="timezone.id"
          />
          <span>{{ timezone.label }}</span>
        </label>
        <label
          v-for="format in UTC_FORMATS"
          :key="format.id"
          class="timezone-option"
        >
          <input
            v-model="selectedTimezones"
            type="checkbox"
            :value="format.id"
          />
          <span>{{ format.label }}</span>
        </label>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.timestamp-app {
  --app-background: #303233;
  --input-background: #3b3b3b;
  --row-background: #3d3d3d;
  --row-shadow: rgba(0, 0, 0, 0.2);
  --primary-text: #f4f4f4;
  --secondary-text: #9a9a9a;
  --accent: #8ac9f6;
  --panel-background: #4a4a4a;
  --panel-hover: #555555;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100%;
  overflow: hidden;
  background: var(--app-background);
  color: var(--primary-text);
}

.app-content {
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 9px 20px 54px;
  scrollbar-color: #6f6f6f transparent;
  scrollbar-width: thin;
}

.app-content::-webkit-scrollbar,
.timezone-panel::-webkit-scrollbar {
  width: 8px;
}

.app-content::-webkit-scrollbar-track,
.timezone-panel::-webkit-scrollbar-track {
  background: transparent;
}

.app-content::-webkit-scrollbar-thumb,
.timezone-panel::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: #707070;
}

.timestamp-input {
  display: block;
  width: 100%;
  height: 59px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 0;
  border-bottom: 1px solid #aaaaaa;
  border-radius: 2px 2px 0 0;
  outline: none;
  background: var(--input-background);
  color: var(--primary-text);
  font-size: 17px;
  font-weight: 600;
  line-height: 59px;
}

.timestamp-input:focus {
  border-bottom-color: #d5d5d5;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 9px;
}

.result-row {
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr) auto;
  align-items: center;
  min-height: 49px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 3px;
  background: var(--row-background);
  box-shadow: 0 2px 4px var(--row-shadow);
}

.result-label,
.result-value,
.shortcut {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-label {
  min-width: 0;
  color: var(--secondary-text);
  font-size: 14px;
  line-height: 20px;
}

.result-value {
  min-width: 0;
  margin-left: 12px;
  color: var(--primary-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.result-row.is-empty .result-label {
  color: #777777;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 59px;
  margin-left: 10px;
}

.shortcut {
  color: var(--accent);
  font-size: 12px;
  line-height: 20px;
}

.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 32px;
  flex: 0 0 25px;
  margin-left: 7px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.copy-button:hover {
  background: rgba(138, 201, 246, 0.12);
}

.copy-button:focus-visible,
.timezone-toggle:focus-visible,
.panel-backdrop:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.copy-icon {
  position: relative;
  display: block;
  width: 12px;
  height: 14px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 1px;
}

.copy-icon::before {
  position: absolute;
  top: -5px;
  left: -5px;
  width: 10px;
  height: 12px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 1px;
  content: '';
}

.timezone-toggle {
  position: absolute;
  right: 20px;
  bottom: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  height: 29px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 13px;
  line-height: 20px;
}

.settings-icon {
  margin-right: 8px;
  color: var(--accent);
  font-size: 17px;
  line-height: 1;
}

.panel-backdrop {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.58);
  cursor: default;
}

.timezone-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  width: 304px;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 0 0 12px;
  background: var(--panel-background);
  box-shadow: -3px 0 6px rgba(0, 0, 0, 0.15);
  scrollbar-color: #777777 transparent;
  scrollbar-width: thin;
}

.timezone-option {
  display: flex;
  align-items: center;
  min-height: 39px;
  box-sizing: border-box;
  padding: 0 12px 0 20px;
  color: var(--primary-text);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  user-select: none;
}

.timezone-option:hover {
  background: var(--panel-hover);
}

.timezone-option input {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  margin: 0 12px 0 0;
  border: 2px solid #c0c0c0;
  border-radius: 2px;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.timezone-option input:checked {
  position: relative;
  border-color: var(--accent);
  background: var(--accent);
}

.timezone-option input:checked::after {
  position: absolute;
  top: 0;
  left: 3px;
  width: 5px;
  height: 9px;
  border: solid #31566e;
  border-width: 0 2px 2px 0;
  content: '';
  transform: rotate(45deg);
}

.timezone-option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-color-scheme: light) {
  .timestamp-app {
    --app-background: #f2f3f5;
    --input-background: #ffffff;
    --row-background: #ffffff;
    --row-shadow: rgba(40, 50, 60, 0.12);
    --primary-text: #202124;
    --secondary-text: #687078;
    --accent: #1976b8;
    --panel-background: #ffffff;
    --panel-hover: #edf4f9;
  }

  .timestamp-input {
    border-bottom-color: #9da4aa;
  }

  .result-row.is-empty .result-label {
    color: #9da4aa;
  }

  .panel-backdrop {
    background: rgba(25, 30, 35, 0.36);
  }

  .timezone-option input:checked::after {
    border-color: #ffffff;
  }
}

@media (max-width: 560px) {
  .app-content {
    padding-right: 12px;
    padding-left: 12px;
  }

  .result-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'label actions'
      'value value';
    min-height: 64px;
    padding-top: 5px;
    padding-bottom: 5px;
  }

  .result-label {
    grid-area: label;
  }

  .result-value {
    grid-area: value;
    margin-left: 0;
  }

  .row-actions {
    grid-area: actions;
    margin-left: 8px;
  }

  .timezone-toggle {
    right: 12px;
  }

  .timezone-panel {
    width: min(304px, calc(100% - 8px));
  }
}
</style>
