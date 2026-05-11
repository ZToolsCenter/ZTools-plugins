<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { TimezoneOption } from '@/types'
import { dateToTzParts, tzPartsToTimestamp } from '@/utils/timezone'

const props = defineProps<{
  modelValue: number | null
  timezone: TimezoneOption
  anchorEl: HTMLElement | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
  (e: 'close'): void
}>()

const now = new Date()
const tzNow = dateToTzParts(now, props.timezone)

// 日历状态
const viewYear = ref(tzNow.year)
const viewMonth = ref(tzNow.month)

// 选中状态（编辑中的临时值）
const selYear = ref(props.modelValue !== null ? dateToTzParts(new Date(props.modelValue), props.timezone).year : tzNow.year)
const selMonth = ref(props.modelValue !== null ? dateToTzParts(new Date(props.modelValue), props.timezone).month : tzNow.month)
const selDay = ref(props.modelValue !== null ? dateToTzParts(new Date(props.modelValue), props.timezone).day : tzNow.day)
const selHour = ref(props.modelValue !== null ? dateToTzParts(new Date(props.modelValue), props.timezone).hour : tzNow.hour)
const selMinute = ref(props.modelValue !== null ? dateToTzParts(new Date(props.modelValue), props.timezone).minute : tzNow.minute)
const selSecond = ref(props.modelValue !== null ? dateToTzParts(new Date(props.modelValue), props.timezone).second : tzNow.second)

if (props.modelValue !== null) {
  viewYear.value = selYear.value
  viewMonth.value = selMonth.value
}

// 弹窗定位
const popupStyle = ref<Record<string, string>>({})

function updatePosition() {
  if (!props.anchorEl) return
  const rect = props.anchorEl.getBoundingClientRect()
  const popupW = 470
  const popupH = 360

  let left = rect.left
  let top = rect.bottom + 6

  if (left + popupW > window.innerWidth - 10) {
    left = window.innerWidth - popupW - 10
  }
  if (left < 10) left = 10
  if (top + popupH > window.innerHeight - 10) {
    top = rect.top - popupH - 6
  }
  popupStyle.value = {
    left: `${left}px`,
    top: `${top}px`
  }
}

onMounted(() => {
  updatePosition()
  window.addEventListener('resize', updatePosition)
  nextTick(scrollTimeToSelected)
})

onUnmounted(() => {
  window.removeEventListener('resize', updatePosition)
})

// 今天的日期（基于时区）
const todayParts = computed(() => dateToTzParts(new Date(), props.timezone))

// 日历格子
const calendarDays = computed(() => {
  const y = viewYear.value
  const m = viewMonth.value
  const firstDay = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const daysInPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()

  const cells: { day: number; month: number; year: number; isOther: boolean }[] = []

  // 上月填充
  for (let i = firstDay - 1; i >= 0; i--) {
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    cells.push({ day: daysInPrev - i, month: pm, year: py, isOther: true })
  }

  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: m, year: y, isOther: false })
  }

  // 下月填充（补满 6 行 42 格）
  const remaining = 42 - cells.length
  for (let i = 1; i <= remaining; i++) {
    const nm = m === 12 ? 1 : m + 1
    const ny = m === 12 ? y + 1 : y
    cells.push({ day: i, month: nm, year: ny, isOther: true })
  }

  return cells
})

interface CalendarCell {
  day: number
  month: number
  year: number
  isOther: boolean
}

function isToday(cell: CalendarCell) {
  const t = todayParts.value
  return cell.day === t.day && cell.month === t.month && cell.year === t.year
}

function isSelected(cell: CalendarCell) {
  return cell.day === selDay.value && cell.month === selMonth.value && cell.year === selYear.value
}

function selectDay(cell: CalendarCell) {
  selYear.value = cell.year
  selMonth.value = cell.month
  selDay.value = cell.day
  if (cell.isOther) {
    viewYear.value = cell.year
    viewMonth.value = cell.month
  }
}

function prevYear() {
  viewYear.value--
}

function nextYear() {
  viewYear.value++
}

function prevMonth() {
  if (viewMonth.value === 1) {
    viewMonth.value = 12
    viewYear.value--
  } else {
    viewMonth.value--
  }
}

function nextMonth() {
  if (viewMonth.value === 12) {
    viewMonth.value = 1
    viewYear.value++
  } else {
    viewMonth.value++
  }
}

// 时间选择
const hourRef = ref<HTMLElement | null>(null)
const minuteRef = ref<HTMLElement | null>(null)
const secondRef = ref<HTMLElement | null>(null)

const hours = Array.from({ length: 24 }, (_, i) => i)
const minutes = Array.from({ length: 60 }, (_, i) => i)
const seconds = Array.from({ length: 60 }, (_, i) => i)

function padNum(n: number): string {
  return n.toString().padStart(2, '0')
}

function scrollTimeToSelected() {
  scrollColumnTo(hourRef.value, selHour.value)
  scrollColumnTo(minuteRef.value, selMinute.value)
  scrollColumnTo(secondRef.value, selSecond.value)
}

function scrollColumnTo(el: HTMLElement | null, index: number) {
  if (!el) return
  const itemH = 30
  const containerH = el.clientHeight
  const targetTop = index * itemH - (containerH / 2) + (itemH / 2)
  el.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
}

function selectHour(h: number) {
  selHour.value = h
  scrollColumnTo(hourRef.value, h)
}

function selectMinute(m: number) {
  selMinute.value = m
  scrollColumnTo(minuteRef.value, m)
}

function selectSecond(s: number) {
  selSecond.value = s
  scrollColumnTo(secondRef.value, s)
}

// 此刻按钮
function setNow() {
  const n = dateToTzParts(new Date(), props.timezone)
  selYear.value = n.year
  selMonth.value = n.month
  selDay.value = n.day
  selHour.value = n.hour
  selMinute.value = n.minute
  selSecond.value = n.second
  viewYear.value = n.year
  viewMonth.value = n.month
  nextTick(scrollTimeToSelected)
}

// 确定按钮
function confirm() {
  const ms = tzPartsToTimestamp(
    selYear.value, selMonth.value, selDay.value,
    selHour.value, selMinute.value, selSecond.value,
    props.timezone
  )
  emit('update:modelValue', ms)
  emit('close')
}

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('picker-overlay')) {
    emit('close')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// 时区变化时更新视图
watch(() => props.timezone, () => {
  const n = dateToTzParts(new Date(), props.timezone)
  if (props.modelValue === null) {
    selYear.value = n.year
    selMonth.value = n.month
    selDay.value = n.day
    viewYear.value = n.year
    viewMonth.value = n.month
  }
})

const weekdays = ['日', '一', '二', '三', '四', '五', '六']
</script>

<template>
  <div class="picker-overlay" @mousedown="onOverlayClick">
    <div class="picker-popup" :style="popupStyle">
      <div class="picker-body">
        <!-- 日历 -->
        <div class="calendar-side">
          <div class="cal-header">
            <button class="cal-nav-btn" @click="prevYear" title="上一年">«</button>
            <button class="cal-nav-btn" @click="prevMonth" title="上个月">‹</button>
            <span class="cal-title">{{ viewYear }}-{{ padNum(viewMonth) }}</span>
            <button class="cal-nav-btn" @click="nextMonth" title="下个月">›</button>
            <button class="cal-nav-btn" @click="nextYear" title="下一年">»</button>
          </div>

          <div class="cal-weekdays">
            <span v-for="w in weekdays" :key="w" class="cal-weekday">{{ w }}</span>
          </div>

          <div class="cal-grid">
            <button
              v-for="(cell, idx) in calendarDays"
              :key="idx"
              class="cal-day"
              :class="{
                'other-month': cell.isOther,
                'today': isToday(cell),
                'selected': isSelected(cell)
              }"
              @click="selectDay(cell)"
            >
              {{ cell.day }}
            </button>
          </div>
        </div>

        <!-- 时间选择 -->
        <div class="time-side">
          <div class="time-title">选择时间</div>
          <div class="time-columns">
            <div ref="hourRef" class="time-column">
              <button
                v-for="h in hours"
                :key="h"
                class="time-item"
                :class="{ selected: h === selHour }"
                @click="selectHour(h)"
              >
                {{ padNum(h) }}
              </button>
            </div>
            <div ref="minuteRef" class="time-column">
              <button
                v-for="m in minutes"
                :key="m"
                class="time-item"
                :class="{ selected: m === selMinute }"
                @click="selectMinute(m)"
              >
                {{ padNum(m) }}
              </button>
            </div>
            <div ref="secondRef" class="time-column">
              <button
                v-for="s in seconds"
                :key="s"
                class="time-item"
                :class="{ selected: s === selSecond }"
                @click="selectSecond(s)"
              >
                {{ padNum(s) }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="picker-footer">
        <button class="now-btn" @click="setNow">此刻</button>
        <button class="confirm-btn" @click="confirm">确定</button>
      </div>
    </div>
  </div>
</template>
