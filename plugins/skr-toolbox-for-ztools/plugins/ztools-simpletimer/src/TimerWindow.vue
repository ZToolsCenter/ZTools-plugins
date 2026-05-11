<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type TimerMode = 'stopwatch' | 'countdown'

const mode = ref<TimerMode>(readInitialMode())
const isRunning = ref(false)
const isCollapsed = ref(false)
const isEditingCountdown = ref(false)
const enableSound = ref(true)
const enableNotification = ref(true)

const elapsedMs = ref(0)
const countdownMs = ref(5 * 60 * 1000)
const editHours = ref(0)
const editMinutes = ref(5)
const editSeconds = ref(0)
const customPresets = ref<number[]>([])
const selectedPreset = ref('')
const isPresetOpen = ref(false)
const viewportWidth = ref(200)
const viewportHeight = ref(139)

const audioRef = ref<HTMLAudioElement | null>(null)
let startedAt = 0
let intervalId: number | undefined
let ignoreFocusExpandUntil = 0
let resizeSaveTimer: number | undefined
let manualExpandTimer: number | undefined
let resizeState: {
  pointerId: number
  startX: number
  startY: number
  width: number
  height: number
  edge: ResizeEdge
} | null = null

const presetDbId = 'countdown_timer_presets'
const settingsDbId = 'countdown_timer_settings'
const legacySettingsDbId = 'countdown_time_settings'
const windowSizeDbId = 'timer_window_size'
const windowSizeVersion = 4
const baseWidth = 200
const baseHeight = 139
const designWidth = 250
const minWidth = 200
const maxWidth = 336
const defaultPresets = [15, 30, 45].map((minute) => minute * 60 * 1000)
const maxCustomPresets = 20
type ResizeEdge = 'right' | 'bottom' | 'corner'

const currentDisplayMs = computed(() => {
  if (mode.value === 'stopwatch') return elapsedMs.value
  return Math.max(0, countdownMs.value - elapsedMs.value)
})

const displayTime = computed(() => formatTime(currentDisplayMs.value))
const isCountdownLocked = computed(() => mode.value === 'countdown' && isRunning.value)
const isCountdownStartDisabled = computed(() => {
  return mode.value === 'countdown' && !isRunning.value && countdownMs.value - elapsedMs.value <= 0
})
const stageStyle = computed(() => ({
  '--timer-scale': String(getLayoutScale()),
  '--timer-width': `${Math.max(0, viewportWidth.value - 2)}px`,
  '--timer-height': `${Math.max(0, viewportHeight.value - 2)}px`
}))
const presetOptions = computed(() => {
  const defaults = new Set(defaultPresets)
  const custom = [...new Set(customPresets.value)]
    .filter((value) => value > 0 && !defaults.has(value))
    .sort((a, b) => a - b)

  return [
    ...defaultPresets.map((value) => ({ value, label: formatTime(value), custom: false })),
    ...custom.map((value) => ({ value, label: formatTime(value), custom: true }))
  ]
})
const selectedPresetLabel = computed(() => {
  const selected = Number.parseInt(selectedPreset.value, 10)
  return presetOptions.value.find((preset) => preset.value === selected)?.label ?? '自定义'
})
const isSelectedPresetCustom = computed(() => {
  const selected = Number.parseInt(selectedPreset.value, 10)
  return customPresets.value.includes(selected)
})

onMounted(() => {
  loadWindowSize()
  loadCustomPresets()
  loadCountdownSettings()
  syncEditInputs()

  if (mode.value === 'countdown') {
    elapsedMs.value = 0
  }

  window.addEventListener('focus', handleFocus)
  window.addEventListener('blur', handleBlur)
  window.addEventListener('pointermove', handleResizePointerMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
  window.addEventListener('pointerdown', handleWindowPointerDown)
})

onBeforeUnmount(() => {
  stopTicker()
  if (resizeSaveTimer !== undefined) window.clearTimeout(resizeSaveTimer)
  if (manualExpandTimer !== undefined) window.clearTimeout(manualExpandTimer)
  window.removeEventListener('focus', handleFocus)
  window.removeEventListener('blur', handleBlur)
  window.removeEventListener('pointermove', handleResizePointerMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  window.removeEventListener('pointerdown', handleWindowPointerDown)
})

watch(mode, () => {
  resetTimer()
  isEditingCountdown.value = false
  isCollapsed.value = false
})

function readInitialMode(): TimerMode {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'countdown' ? 'countdown' : 'stopwatch'
}

function formatTime(ms: number) {
  const safeMs = Math.max(0, ms)
  const totalSeconds = Math.floor(safeMs / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function getDbDoc<T extends Record<string, unknown>>(id: string) {
  try {
    const doc = window.ztools?.db?.get<T>(id)
    if (doc) return doc
  } catch {}

  try {
    const raw = window.localStorage?.getItem(id)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function putDbDoc(doc: { _id: string } & Record<string, unknown>) {
  let saved = false

  try {
    const existing = window.ztools?.db?.get(doc._id)
    if (existing) window.ztools.db.remove(existing)
    const result = window.ztools?.db?.put(doc)
    saved = !!result
    if (saved) return result
  } catch (error) {
    console.error('保存设置失败:', error)
  }

  try {
    window.localStorage?.setItem(doc._id, JSON.stringify(doc))
    saved = true
  } catch {}

  return saved ? { ok: true, id: doc._id, rev: '' } : null
}

function loadCustomPresets() {
  const doc = getDbDoc<{ custom?: unknown[] }>(presetDbId)
  customPresets.value = Array.isArray(doc?.custom)
    ? doc.custom.filter((value): value is number => typeof value === 'number' && value > 0)
    : []
}

function saveCustomPresets() {
  customPresets.value = customPresets.value
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-maxCustomPresets)

  putDbDoc({
    _id: presetDbId,
    custom: [...customPresets.value],
    timestamp: Date.now()
  })
}

function loadCountdownSettings() {
  const doc = getDbDoc<{ hours?: unknown; minutes?: unknown; seconds?: unknown }>(settingsDbId)
    ?? getDbDoc<{ hours?: unknown; minutes?: unknown; seconds?: unknown }>(legacySettingsDbId)

  if (!doc) return

  const hours = toInteger(doc.hours, 0)
  const minutes = toInteger(doc.minutes, 5)
  const seconds = toInteger(doc.seconds, 0)
  countdownMs.value = timePartsToMs(hours, minutes, seconds)
}

function saveCountdownSettings() {
  const parts = msToParts(countdownMs.value)
  putDbDoc({
    _id: settingsDbId,
    ...parts,
    timestamp: Date.now()
  })
}

function timePartsToMs(hours: number, minutes: number, seconds: number) {
  return Math.max(0, (hours * 3600 + minutes * 60 + seconds) * 1000)
}

function msToParts(ms: number) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60
  }
}

function toInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function normalizeEditInputs() {
  const totalMs = timePartsToMs(editHours.value, editMinutes.value, editSeconds.value)
  const parts = msToParts(totalMs)
  editHours.value = parts.hours
  editMinutes.value = parts.minutes
  editSeconds.value = parts.seconds
  return totalMs
}

function syncEditInputs() {
  const parts = msToParts(countdownMs.value)
  editHours.value = parts.hours
  editMinutes.value = parts.minutes
  editSeconds.value = parts.seconds
}

function openCountdownEditor() {
  if (mode.value !== 'countdown' || isRunning.value) return
  syncEditInputs()
  selectedPreset.value = ''
  isEditingCountdown.value = true

  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.countdown-input')
    input?.select()
  })
}

function confirmCountdownEditor() {
  countdownMs.value = normalizeEditInputs()
  elapsedMs.value = 0
  saveCountdownSettings()
  isPresetOpen.value = false
  isEditingCountdown.value = false
}

function cancelCountdownEditor() {
  syncEditInputs()
  selectedPreset.value = ''
  isPresetOpen.value = false
  isEditingCountdown.value = false
}

function applyPreset(ms: number) {
  const parts = msToParts(ms)
  editHours.value = parts.hours
  editMinutes.value = parts.minutes
  editSeconds.value = parts.seconds
}

function applySelectedPreset() {
  const ms = Number.parseInt(selectedPreset.value, 10)
  if (!Number.isFinite(ms) || ms <= 0) return
  applyPreset(ms)
  isPresetOpen.value = false
}

function selectPreset(value: string) {
  selectedPreset.value = value
  if (!value) {
    isPresetOpen.value = false
    return
  }

  applySelectedPreset()
}

function addPreset() {
  const ms = normalizeEditInputs()
  if (ms <= 0) return

  customPresets.value = [ms, ...customPresets.value.filter((value) => value !== ms)].slice(0, maxCustomPresets)
  selectedPreset.value = String(ms)
  saveCustomPresets()
}

function removePreset(ms: number) {
  customPresets.value = customPresets.value.filter((value) => value !== ms)
  selectedPreset.value = ''
  saveCustomPresets()
}

function removeSelectedPreset() {
  const ms = Number.parseInt(selectedPreset.value, 10)
  if (!customPresets.value.includes(ms)) return
  removePreset(ms)
}

function bumpSegment(segment: 'hours' | 'minutes' | 'seconds', delta: number) {
  const parts = {
    hours: editHours.value,
    minutes: editMinutes.value,
    seconds: editSeconds.value
  }

  parts[segment] += delta
  const normalized = msToParts(timePartsToMs(parts.hours, parts.minutes, parts.seconds))
  editHours.value = normalized.hours
  editMinutes.value = normalized.minutes
  editSeconds.value = normalized.seconds
}

function handleSegmentWheel(event: WheelEvent, segment: 'hours' | 'minutes' | 'seconds') {
  event.preventDefault()
  bumpSegment(segment, event.deltaY < 0 ? 1 : -1)
}

function handleSegmentKeydown(event: KeyboardEvent, segment: 'hours' | 'minutes' | 'seconds') {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  bumpSegment(segment, event.key === 'ArrowUp' ? 1 : -1)
}

function startTimer() {
  if (mode.value === 'countdown' && countdownMs.value <= 0) return
  if (isCountdownStartDisabled.value) return
  startedAt = Date.now() - elapsedMs.value
  isRunning.value = true
  isEditingCountdown.value = false
  isCollapsed.value = true
  tick()
  intervalId = window.setInterval(tick, 100)
}

function pauseTimer() {
  tick()
  stopTicker()
  isRunning.value = false
  isCollapsed.value = false
}

function toggleTimer() {
  if (isRunning.value) {
    pauseTimer()
    return
  }

  startTimer()
}

function resetTimer() {
  stopTicker()
  isRunning.value = false
  elapsedMs.value = 0
  isCollapsed.value = false
}

function stopTicker() {
  if (intervalId !== undefined) {
    window.clearInterval(intervalId)
    intervalId = undefined
  }
}

function tick() {
  elapsedMs.value = Date.now() - startedAt

  if (mode.value === 'countdown' && countdownMs.value - elapsedMs.value <= 0) {
    elapsedMs.value = countdownMs.value
    stopTicker()
    isRunning.value = false
    isCollapsed.value = false
    notifyCountdownDone()
  }
}

function notifyCountdownDone() {
  if (enableSound.value && audioRef.value) {
    audioRef.value.currentTime = 0
    audioRef.value.play().catch((error) => console.error('播放提示音失败:', error))
  }

  if (!enableNotification.value) return

  if (window.ztools?.showNotification) {
    window.ztools.showNotification('时间到了！', '倒计时结束')
    return
  }

  window.timerAPI?.showNotification('倒计时结束', '时间到了！')
}

function switchMode() {
  mode.value = mode.value === 'stopwatch' ? 'countdown' : 'stopwatch'
}

function closeWindow() {
  window.close()
}

function revealControlsTemporarily() {
  if (!isRunning.value) return

  isCollapsed.value = false
  if (manualExpandTimer !== undefined) window.clearTimeout(manualExpandTimer)
  manualExpandTimer = window.setTimeout(() => {
    if (isRunning.value) isCollapsed.value = true
  }, 2200)
}

function readSizeFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const width = Number.parseInt(params.get('w') ?? '', 10)
  const height = Number.parseInt(params.get('h') ?? '', 10)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return normalizeWindowSize(width, height)
}

function loadWindowSize() {
  const fromUrl = readSizeFromUrl()
  const size = fromUrl ?? { width: baseWidth, height: baseHeight }

  viewportWidth.value = size.width
  viewportHeight.value = size.height
}

function saveWindowSize() {
  const size = normalizeWindowSize(viewportWidth.value, viewportHeight.value)
  viewportWidth.value = size.width
  viewportHeight.value = size.height

  putDbDoc({
    _id: windowSizeDbId,
    version: windowSizeVersion,
    width: size.width,
    height: size.height,
    timestamp: Date.now()
  })
}

function handleWindowPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.preset-select')) {
    isPresetOpen.value = false
  }
}

function startResize(event: PointerEvent, edge: ResizeEdge) {
  event.preventDefault()
  event.stopPropagation()

  resizeState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    width: viewportWidth.value,
    height: viewportHeight.value,
    edge
  }

  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function handleResizePointerMove(event: PointerEvent) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return

  const deltaX = event.screenX - resizeState.startX
  const deltaY = event.screenY - resizeState.startY
  const aspectRatio = baseWidth / baseHeight
  const widthFromX = resizeState.width + deltaX
  const widthFromY = (resizeState.height + deltaY) * aspectRatio
  const nextWidth = clamp(
    resizeState.edge === 'bottom' ? widthFromY : resizeState.edge === 'right' ? widthFromX : Math.max(widthFromX, widthFromY),
    minWidth,
    maxWidth
  )
  const nextHeight = Math.round(nextWidth / aspectRatio)

  resizeCurrentWindow(Math.round(nextWidth), nextHeight)
}

function stopResize(event: PointerEvent) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return
  resizeState = null
  saveWindowSize()
}

function resizeCurrentWindow(width: number, height: number) {
  const size = normalizeWindowSize(width, height)
  viewportWidth.value = size.width
  viewportHeight.value = size.height

  try {
    window.ztools?.resizeWindow?.(size.width, size.height)
  } catch {}

  try {
    window.resizeTo(size.width, size.height)
  } catch {}
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeWindowSize(width: number, height?: number) {
  const aspectRatio = baseWidth / baseHeight
  const fallbackWidth = Number.isFinite(width) ? width : baseWidth
  const normalizedWidth = Math.round(clamp(fallbackWidth, minWidth, maxWidth))

  return {
    width: normalizedWidth,
    height: Math.round(normalizedWidth / aspectRatio)
  }
}

function getLayoutScale() {
  const scale = viewportWidth.value / designWidth
  return String(clamp(scale, 0.78, 1.62))
}

function handleFocus() {
  if (Date.now() < ignoreFocusExpandUntil) return
  if (isRunning.value) return
  isCollapsed.value = false
}

function handleBlur() {
  if (!isRunning.value) return
  ignoreFocusExpandUntil = Date.now() + 200
  isCollapsed.value = true
}
</script>

<template>
  <div class="timer-stage" :style="stageStyle">
    <main
      class="timer-window"
      :class="{
        collapsed: isCollapsed,
        editing: isEditingCountdown
      }"
      @click="revealControlsTemporarily"
      @dblclick="revealControlsTemporarily"
    >
    <header class="timer-titlebar">
      <button class="close-button" type="button" aria-label="关闭" @click="closeWindow">×</button>
    </header>

    <section class="timer-face" :class="{ 'timer-face-spacious': mode === 'stopwatch' }" aria-label="计时显示">
      <output class="timer-display">{{ displayTime }}</output>
      <div v-if="mode === 'countdown'" class="countdown-track" aria-hidden="true">
        <span :style="{ width: `${Math.min(100, Math.max(0, (elapsedMs / Math.max(countdownMs, 1)) * 100))}%` }"></span>
      </div>
    </section>

    <section class="timer-controls" aria-label="计时控制">
      <button class="timer-button primary" type="button" :disabled="isCountdownStartDisabled" @click.stop="toggleTimer">
        {{ isRunning ? '暂停' : elapsedMs > 0 ? '继续' : '开始' }}
      </button>
      <button class="timer-button" type="button" @click.stop="resetTimer">重置</button>
      <button class="timer-button" type="button" :disabled="isCountdownLocked" @click.stop="switchMode">
        {{ mode === 'stopwatch' ? '倒计时' : '正计时' }}
      </button>
    </section>

    <section v-if="mode === 'countdown'" class="timer-options" aria-label="倒计时选项">
      <label class="option-toggle">
        <input v-model="enableSound" type="checkbox" :disabled="isCountdownLocked" />
        提示音
      </label>
      <label class="option-toggle">
        <input v-model="enableNotification" type="checkbox" :disabled="isCountdownLocked" />
        通知
      </label>
      <button class="mini-button" type="button" :disabled="isCountdownLocked" @click.stop="openCountdownEditor">
        设置
      </button>
    </section>

    <section v-if="isEditingCountdown" class="countdown-editor" aria-label="倒计时时间设置">
      <div class="edit-inputs" aria-label="时分秒">
        <input
          v-model.number="editHours"
          class="countdown-input"
          type="number"
          min="0"
          inputmode="numeric"
          @keydown="handleSegmentKeydown($event, 'hours')"
          @wheel="handleSegmentWheel($event, 'hours')"
        />
        <span>:</span>
        <input
          v-model.number="editMinutes"
          type="number"
          min="0"
          inputmode="numeric"
          @keydown="handleSegmentKeydown($event, 'minutes')"
          @wheel="handleSegmentWheel($event, 'minutes')"
        />
        <span>:</span>
        <input
          v-model.number="editSeconds"
          type="number"
          min="0"
          inputmode="numeric"
          @keydown="handleSegmentKeydown($event, 'seconds')"
          @wheel="handleSegmentWheel($event, 'seconds')"
        />
      </div>

      <div class="preset-row">
        <span class="preset-label">预设</span>
        <div class="preset-select">
          <button class="preset-trigger" type="button" @click.stop="isPresetOpen = !isPresetOpen">
            <span>{{ selectedPresetLabel }}</span>
            <span class="preset-chevron" aria-hidden="true"></span>
          </button>
          <div v-if="isPresetOpen" class="preset-menu" :class="{ 'preset-menu-up': presetOptions.length > 2 }">
            <button type="button" :class="{ active: selectedPreset === '' }" @click="selectPreset('')">自定义</button>
            <button
              v-for="preset in presetOptions"
              :key="`${preset.custom ? 'custom' : 'default'}-${preset.value}`"
              type="button"
              :class="{ active: selectedPreset === String(preset.value) }"
              @click="selectPreset(String(preset.value))"
            >
              {{ preset.custom ? `${preset.label} *` : preset.label }}
            </button>
          </div>
        </div>
        <button
          class="delete-preset-button"
          type="button"
          title="删除选中的自定义预设"
          :disabled="!isSelectedPresetCustom"
          @click="removeSelectedPreset"
        >
          ×
        </button>
      </div>

      <div class="edit-actions">
        <button class="timer-button primary" type="button" @click.stop="confirmCountdownEditor">确定</button>
        <button class="timer-button" type="button" @click.stop="cancelCountdownEditor">取消</button>
        <button class="timer-button" type="button" @click.stop="addPreset">保存预设</button>
      </div>
    </section>

    <audio ref="audioRef" preload="auto">
      <source src="/cue.mp3" type="audio/mpeg" />
    </audio>
    <div class="resize-edge resize-edge-right" aria-hidden="true" @pointerdown="startResize($event, 'right')"></div>
    <div class="resize-edge resize-edge-bottom" aria-hidden="true" @pointerdown="startResize($event, 'bottom')"></div>
    <div class="resize-edge resize-edge-corner" aria-hidden="true" @pointerdown="startResize($event, 'corner')"></div>
    </main>
  </div>
</template>

<style scoped>
.timer-stage {
  width: var(--timer-width);
  height: var(--timer-height);
  display: grid;
  place-items: center;
  overflow: hidden;
  background: transparent;
}

.timer-window {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: 420px;
  max-height: 306px;
  min-height: 130px;
  padding: calc(12px * var(--timer-scale));
  overflow: hidden;
  color: #f6f7fb;
  background: linear-gradient(180deg, rgba(42, 44, 48, 0.96), rgba(27, 28, 31, 0.96));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: calc(12px * var(--timer-scale));
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.35);
  user-select: none;
  -webkit-app-region: drag;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: calc(8px * var(--timer-scale));
}

.timer-titlebar {
  width: 100%;
  height: calc(15px * var(--timer-scale));
  display: flex;
  align-items: center;
  justify-content: flex-end;
  -webkit-app-region: drag;
}

.close-button,
.timer-button,
.mini-button,
.delete-preset-button,
.preset-trigger,
.preset-menu,
input {
  -webkit-app-region: no-drag;
}

.close-button {
  width: calc(18px * var(--timer-scale));
  height: calc(18px * var(--timer-scale));
  padding: 0;
  color: rgba(246, 247, 251, 0.58);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  font-size: calc(15px * var(--timer-scale));
  line-height: calc(16px * var(--timer-scale));
}

.close-button:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.timer-face {
  width: 100%;
  box-sizing: border-box;
  padding: 0 calc(8px * var(--timer-scale));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(6px * var(--timer-scale));
}

.timer-face-spacious {
  margin-bottom: calc(7px * var(--timer-scale));
}

.timer-display {
  width: 100%;
  color: #fff;
  text-align: center;
  font-size: calc(36px * var(--timer-scale));
  font-weight: 700;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}

.countdown-track {
  width: calc(168px * var(--timer-scale));
  height: max(2px, calc(3px * var(--timer-scale)));
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
}

.countdown-track span {
  display: block;
  height: 100%;
  background: #5c9dff;
  border-radius: inherit;
}

.timer-controls,
.timer-options,
.edit-actions,
.preset-row {
  display: flex;
  align-items: center;
  justify-content: center;
}

.timer-controls,
.timer-options {
  width: 100%;
  gap: calc(8px * var(--timer-scale));
}

.timer-options {
  font-size: calc(11px * var(--timer-scale));
}

.option-toggle {
  display: inline-flex;
  align-items: center;
  gap: calc(4px * var(--timer-scale));
  height: calc(22px * var(--timer-scale));
  padding: 0 calc(8px * var(--timer-scale));
  color: rgba(246, 247, 251, 0.72);
  background: rgba(255, 255, 255, 0.045);
  border-radius: 999px;
  white-space: nowrap;
}

.option-toggle input {
  width: calc(12px * var(--timer-scale));
  height: calc(12px * var(--timer-scale));
  margin: 0;
  accent-color: #5c9dff;
}

.timer-button,
.mini-button,
.delete-preset-button {
  color: rgba(246, 247, 251, 0.88);
  background: rgba(255, 255, 255, 0.07);
  border: 0;
  border-radius: calc(7px * var(--timer-scale));
  cursor: pointer;
}

.timer-button {
  min-width: calc(56px * var(--timer-scale));
  height: calc(30px * var(--timer-scale));
  padding: 0 calc(12px * var(--timer-scale));
  font-size: calc(13px * var(--timer-scale));
  line-height: 1;
  white-space: nowrap;
}

.timer-button.primary {
  color: #fff;
  background: #3f82f7;
}

.mini-button {
  height: calc(22px * var(--timer-scale));
  padding: 0 calc(9px * var(--timer-scale));
  font-size: calc(11px * var(--timer-scale));
  border-radius: 999px;
  white-space: nowrap;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

button:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.12);
}

.timer-button.primary:not(:disabled):hover {
  background: #3174e6;
}

.countdown-editor {
  position: absolute;
  inset: calc(21px * var(--timer-scale)) calc(8px * var(--timer-scale)) calc(8px * var(--timer-scale));
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: calc(8px * var(--timer-scale));
  align-items: center;
  justify-content: space-evenly;
  padding: calc(10px * var(--timer-scale));
  background: rgba(22, 23, 26, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: calc(10px * var(--timer-scale));
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  -webkit-app-region: no-drag;
}

.edit-inputs {
  display: flex;
  align-items: center;
  gap: calc(5px * var(--timer-scale));
  color: rgba(246, 247, 251, 0.42);
}

.edit-inputs input {
  width: calc(44px * var(--timer-scale));
  height: calc(31px * var(--timer-scale));
  box-sizing: border-box;
  color: #fff;
  text-align: center;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: calc(7px * var(--timer-scale));
  font-size: calc(17px * var(--timer-scale));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
}

.edit-inputs input::-webkit-outer-spin-button,
.edit-inputs input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.preset-row {
  width: 100%;
  box-sizing: border-box;
  gap: calc(4px * var(--timer-scale));
  font-size: calc(11px * var(--timer-scale));
  position: relative;
}

.preset-label {
  flex: 0 0 auto;
  color: rgba(246, 247, 251, 0.58);
}

.preset-select {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.preset-trigger {
  width: 100%;
  height: calc(26px * var(--timer-scale));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(6px * var(--timer-scale));
  padding: 0 calc(8px * var(--timer-scale));
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: calc(7px * var(--timer-scale));
  font-size: calc(11px * var(--timer-scale));
  cursor: pointer;
}

.preset-trigger:hover {
  background: rgba(255, 255, 255, 0.11);
}

.preset-chevron {
  width: calc(7px * var(--timer-scale));
  height: calc(7px * var(--timer-scale));
  border-right: 1px solid rgba(246, 247, 251, 0.58);
  border-bottom: 1px solid rgba(246, 247, 251, 0.58);
  transform: translateY(calc(-2px * var(--timer-scale))) rotate(45deg);
}

.preset-menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + calc(4px * var(--timer-scale)));
  bottom: auto;
  z-index: 20;
  max-height: calc(60px * var(--timer-scale));
  overflow-y: auto;
  padding: calc(4px * var(--timer-scale));
  background: rgba(31, 33, 37, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: calc(8px * var(--timer-scale));
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.32);
}

.preset-menu-up {
  top: auto;
  bottom: calc(100% + calc(4px * var(--timer-scale)));
}

.preset-menu button {
  width: 100%;
  height: calc(25px * var(--timer-scale));
  min-height: calc(25px * var(--timer-scale));
  padding: 0 calc(7px * var(--timer-scale));
  color: rgba(246, 247, 251, 0.82);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: calc(5px * var(--timer-scale));
  font-size: calc(11px * var(--timer-scale));
  cursor: pointer;
}

.preset-menu button:hover,
.preset-menu button.active {
  color: #fff;
  background: rgba(92, 157, 255, 0.22);
}

.delete-preset-button {
  flex: 0 0 calc(26px * var(--timer-scale));
  width: calc(26px * var(--timer-scale));
  height: calc(26px * var(--timer-scale));
  padding: 0;
  font-size: calc(14px * var(--timer-scale));
  line-height: 1;
}

.edit-actions {
  width: 100%;
  gap: calc(6px * var(--timer-scale));
}

.edit-actions .timer-button {
  min-width: 0;
  flex: 1;
  height: calc(27px * var(--timer-scale));
  padding: 0 calc(6px * var(--timer-scale));
  font-size: calc(11px * var(--timer-scale));
}

.collapsed {
  -webkit-app-region: no-drag;
}

.collapsed > *:not(.timer-face):not(.timer-titlebar) {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.collapsed .timer-titlebar {
  position: absolute;
  inset: 0 0 auto;
  height: calc(16px * var(--timer-scale));
  visibility: visible;
  opacity: 0;
  pointer-events: auto;
}

.collapsed .close-button {
  display: none;
}

.collapsed .timer-face {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.collapsed .countdown-track {
  display: none;
}

.resize-edge {
  position: absolute;
  z-index: 30;
  -webkit-app-region: no-drag;
}

.resize-edge-right {
  top: 18px;
  right: 0;
  bottom: 12px;
  width: 8px;
  cursor: ew-resize;
}

.resize-edge-bottom {
  right: 18px;
  bottom: 0;
  left: 18px;
  height: 8px;
  cursor: ns-resize;
}

.resize-edge-corner {
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
}

audio {
  display: none;
}
</style>
