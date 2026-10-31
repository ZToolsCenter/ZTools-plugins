<script setup lang="ts">
import { nextTick, onUnmounted, ref } from 'vue'

const props = defineProps<{ cfg: Record<string, string> }>()
const emit = defineEmits<{ (e: 'height', h: number): void }>()

interface Card {
  key: number
  entry: NoticeEntry
  expires: number
  remaining: number
  hovered: boolean
  expanded: boolean
}

const cards = ref<Card[]>([])
const stack = ref<HTMLElement | null>(null)
const pending: NoticeEntry[] = []
let cardSeq = 0

function maxCards() {
  return Math.max(1, Number(props.cfg.listMax) || 6)
}

function rgba(hex: string, alpha: string | number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 'rgba(24,26,32,' + alpha + ')'
  const n = parseInt(m[1], 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')'
}

function textColor() {
  if (props.cfg.listText) return props.cfg.listText
  const m = /^#?([0-9a-f]{6})$/i.exec(props.cfg.listBg || '')
  if (!m) return '#eef1f6'
  const n = parseInt(m[1], 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#1a1c22' : '#eef1f6'
}

function hhmm(ms: number) {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function reportHeight() {
  nextTick(() => {
    emit('height', stack.value ? stack.value.offsetHeight : 0)
  })
}

function addCard(entry: NoticeEntry) {
  const stay = Number(props.cfg.stayMs || 4000)
  cards.value.unshift({ key: ++cardSeq, entry, expires: Date.now() + stay, remaining: stay, hovered: false, expanded: false })
  reportHeight()
}

function push(entry: NoticeEntry) {
  if (!entry.modes.includes('list')) return
  // 超出上限的排队等位，不丢弃
  if (cards.value.length < maxCards()) addCard(entry)
  else pending.push(entry)
}

function removeCard(card: Card) {
  cards.value = cards.value.filter((c) => c.key !== card.key)
  reportHeight()
}

function hover(card: Card, on: boolean) {
  if (on) {
    card.remaining = Math.max(card.expires - Date.now(), 0)
    card.hovered = true
  } else {
    card.hovered = false
    card.expires = Date.now() + card.remaining
  }
}

function toggle(card: Card) {
  card.expanded = !card.expanded
  reportHeight()
}

const timer = setInterval(() => {
  if (!cards.value.length && !pending.length) return
  const now = Date.now()
  const before = cards.value.length
  cards.value = cards.value.filter((c) => c.hovered || now < c.expires)
  while (pending.length && cards.value.length < maxCards()) addCard(pending.shift() as NoticeEntry)
  if (cards.value.length !== before) reportHeight()
}, 200)

onUnmounted(() => clearInterval(timer))

defineExpose({ push })
</script>

<template>
  <div ref="stack" class="stack">
    <div
      v-for="c in cards"
      :key="c.key"
      class="card"
      :style="{ background: rgba(cfg.listBg, cfg.listOpacity || 0.92), color: textColor() }"
      @mouseenter="hover(c, true)"
      @mouseleave="hover(c, false)"
    >
      <div class="head">
        <span class="dot" :style="{ background: c.entry.color }"></span>
        <span v-if="cfg.showApp !== '0'" class="who">{{ c.entry.name }}</span>
        <span v-if="cfg.showTime === '1'" class="time">{{ hhmm(c.entry.at) }}</span>
        <span class="close" title="关闭" @click.stop="removeCard(c)">×</span>
      </div>
      <div class="title" @click="toggle(c)">{{ c.entry.title }}</div>
      <div v-if="c.expanded && c.entry.body" class="body">{{ c.entry.body }}</div>
    </div>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px;
  font: 13px/1.5 system-ui, 'Microsoft YaHei', sans-serif;
}
.card {
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.who {
  opacity: 0.8;
}
.time {
  opacity: 0.55;
  font-size: 11px;
}
.close {
  margin-left: auto;
  padding: 0 4px;
  cursor: pointer;
  opacity: 0.55;
}
.close:hover {
  opacity: 1;
}
.title {
  margin-top: 6px;
  font-weight: 600;
  cursor: pointer;
  word-break: break-all;
}
.body {
  margin-top: 6px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  opacity: 0.85;
}
</style>
