<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, ref } from 'vue'

const props = defineProps<{ cfg: Record<string, string> }>()

const LANE_GAP = 24
const LANE_H = 48

interface Pill {
  key: number
  lane: number
  entry: NoticeEntry
  x: number
  w: number
  active: boolean
  el?: HTMLElement | null
}

const root = ref<HTMLElement | null>(null)
const pills = shallowRef<Pill[]>([])
let laneFreeAt: number[] = []
let pillSeq = 0
let lastTick = 0
let raf = 0

function rgba(hex: string, alpha: string | number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 'rgba(20,22,28,' + alpha + ')'
  const n = parseInt(m[1], 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')'
}

function textColor() {
  if (props.cfg.dmText) return props.cfg.dmText
  const m = /^#?([0-9a-f]{6})$/i.exec(props.cfg.dmBg || '')
  if (!m) return '#eef1f6'
  const n = parseInt(m[1], 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#1a1c22' : '#eef1f6'
}

function hhmm(ms: number) {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function lanes() {
  return Math.max(1, Number(props.cfg.dmLanes) || 3)
}

function push(entry: NoticeEntry) {
  if (!entry.modes.includes('danmaku')) return
  const ltr = props.cfg.dmDirection === 'ltr'
  const vw = root.value ? root.value.clientWidth : 800
  pills.value = pills.value.concat({
    key: ++pillSeq,
    lane: -1,
    entry,
    x: ltr ? -8 : vw + 8,
    w: 0,
    active: false,
    el: null
  })
}

function frame(now: number) {
  const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.1) : 0
  lastTick = now
  const speed = Math.max(20, Number(props.cfg.dmSpeed) || 140)
  const ltr = props.cfg.dmDirection === 'ltr'
  const vw = root.value ? root.value.clientWidth : 800
  const n = lanes()
  while (laneFreeAt.length < n) laneFreeAt.push(0)
  let removed = false
  for (const p of pills.value) {
    if (!p.active) {
      if (!p.el) p.el = document.querySelector('[data-pill="' + p.key + '"]') as HTMLElement | null
      if (p.el && p.w === 0) p.w = p.el.offsetWidth
      let lane = -1
      for (let i = 0; i < n; i++) {
        if (now >= laneFreeAt[i]) {
          lane = i
          break
        }
      }
      if (lane >= 0 && p.w > 0) {
        p.lane = lane
        p.active = true
        p.x = ltr ? -p.w - 8 : vw + 8
        laneFreeAt[lane] = now + ((p.w + LANE_GAP) / speed) * 1000
        if (p.el) {
          p.el.style.visibility = 'visible'
          p.el.style.transform = 'translate(' + p.x + 'px,' + (p.lane * LANE_H + 4) + 'px)'
        }
      }
    } else {
      p.x += (ltr ? 1 : -1) * speed * dt
      if (p.el) p.el.style.transform = 'translate(' + p.x + 'px,' + (p.lane * LANE_H + 4) + 'px)'
      if (ltr ? p.x > vw + 80 : p.x + p.w < -80) removed = true
    }
  }
  if (removed) pills.value = pills.value.filter((p) => (ltr ? p.x <= vw + 80 : p.x + p.w >= -80))
  raf = requestAnimationFrame(frame)
}

function borderStyle() {
  const b = props.cfg.dmBorder || 'none'
  if (b === 'none') return {}
  return { border: '1px ' + b + ' currentColor' }
}

onMounted(() => {
  raf = requestAnimationFrame(frame)
})
onUnmounted(() => cancelAnimationFrame(raf))

defineExpose({ push })
</script>

<template>
  <div ref="root" class="danmaku">
    <div
      v-for="p in pills"
      :key="p.key"
      :data-pill="p.key"
      class="pill"
      :class="{ merged: p.entry.merged }"
      :style="[
        {
          transform: 'translate(' + p.x + 'px,' + (p.lane * 48 + 4) + 'px)',
          visibility: p.active ? 'visible' : 'hidden',
          fontSize: (cfg.dmFontSize || 13) + 'px',
          background: rgba(cfg.dmBg, cfg.dmOpacity || 0.78),
          color: textColor()
        },
        borderStyle()
      ]"
    >
      <span v-if="cfg.dmEmoji" class="emoji">{{ cfg.dmEmoji }}</span>
      <span class="dot" :style="{ background: p.entry.color }"></span>
      <span v-if="cfg.showApp !== '0'" class="who">{{ p.entry.name }}</span>
      <span class="txt">{{ p.entry.title }}{{ p.entry.body ? ' · ' + p.entry.body : '' }}</span>
      <span v-if="cfg.showTime === '1'" class="time">{{ hhmm(p.entry.at) }}</span>
    </div>
  </div>
</template>

<style scoped>
.danmaku {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.pill {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px 0 12px;
  border-radius: 20px;
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
  line-height: 1.4;
  white-space: nowrap;
  max-width: calc(100% - 8px);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  will-change: transform;
}
.pill.merged {
  outline: 1px dashed currentColor;
  outline-offset: -3px;
}
.emoji {
  flex: none;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.who {
  opacity: 0.72;
}
.time {
  opacity: 0.55;
  font-size: 0.85em;
}
.txt {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
