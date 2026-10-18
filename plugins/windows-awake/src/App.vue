<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AwakeConfig, AwakeStatus } from './awake-types'
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES, PRESETS, formatClock, formatDuration, formatTime } from './awake-format'

const INACTIVE_STATUS: AwakeStatus = {
  supported: true,
  active: false,
  pid: 0,
  startedAt: 0,
  endsAt: null,
  durationMinutes: 0,
  keepDisplay: true,
  remainingSeconds: null,
  elapsedSeconds: 0,
  flags: 0
}

const status = ref<AwakeStatus>({ ...INACTIVE_STATUS })
const durationMinutes = ref(30)
const keepDisplay = ref(true)
const customMinutes = ref(90)
const customDraft = ref('90')
const busy = ref(false)
const bridgeReady = ref(true)
const error = ref('')
const notice = ref('')
const now = ref(Date.now())

/** 用户主动停止时不再提示“自动结束”。 */
let stoppedByUser = false

const active = computed(() => status.value.active)
const isCustomDuration = computed(
  () => durationMinutes.value > 0 && !PRESETS.some((preset) => preset.value === durationMinutes.value)
)
const remainingSeconds = computed(() => {
  if (!active.value || status.value.endsAt === null) return null
  return Math.max(0, Math.round((status.value.endsAt - now.value) / 1000))
})
const countdownText = computed(() => {
  if (!active.value) return '未唤醒'
  const remaining = remainingSeconds.value
  return remaining === null ? '不限时' : formatClock(remaining)
})
const countdownLabel = computed(() => (active.value ? '剩余时间' : '当前状态'))
const strategyText = computed(() => {
  if (!active.value) return `计划：${planText.value}`
  return status.value.keepDisplay ? '系统与屏幕保持唤醒' : '仅保持系统唤醒，允许息屏'
})
const planText = computed(() =>
  durationMinutes.value === 0 ? '一直保持' : formatDuration(durationMinutes.value * 60)
)
const elapsedText = computed(() => {
  if (!status.value.startedAt) return '—'
  return formatDuration(Math.max(0, (now.value - status.value.startedAt) / 1000), true)
})
const startedText = computed(() => (status.value.startedAt ? formatTime(status.value.startedAt) : '—'))
const displayText = computed(() => {
  if (!status.value.startedAt) return keepDisplay.value ? '不允许息屏' : '允许息屏'
  return status.value.keepDisplay ? '不允许息屏' : '允许息屏'
})
const stateText = computed(() => {
  if (!bridgeReady.value) return '本地能力未加载'
  if (!status.value.supported) return '不支持当前系统'
  return active.value ? '保持唤醒中' : '未唤醒'
})
const actionText = computed(() => {
  if (busy.value) return '处理中…'
  return active.value ? '停止保持唤醒' : '开始保持唤醒'
})
const tipText = computed(() => {
  if (!bridgeReady.value) return '请在 ZTools 中打开插件，以启用本地唤醒能力'
  if (!status.value.supported) return '该插件依赖 Windows 的 SetThreadExecutionState 能力'
  if (active.value) return '可以关闭 ZTools 窗口，唤醒会在后台保持；退出 ZTools 会自动释放'
  return `点击开始后，Windows 在 ${planText.value}内不会自动睡眠`
})

/**
 * 判断本地桥接是否可用。
 * @returns 桥接对象，不可用时返回 undefined。
 */
function bridge() {
  return window.awakeBridge
}

/**
 * 把异常转换为可读文案。
 * @param cause 捕获到的异常。
 * @returns 错误提示。
 */
function describeError(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return '操作失败，请重试'
}

/**
 * 开始或停止保持唤醒。
 * @returns 无返回值。
 */
async function toggle(): Promise<void> {
  const api = bridge()
  if (!api || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (active.value) {
      stoppedByUser = true
      status.value = await api.stop()
      notice.value = '已停止保持唤醒，Windows 恢复自动睡眠策略'
    } else {
      status.value = await api.start({
        durationMinutes: durationMinutes.value,
        keepDisplay: keepDisplay.value
      })
    }
  } catch (cause) {
    error.value = describeError(cause)
    await refreshStatus()
  } finally {
    busy.value = false
  }
}

/**
 * 读取状态并同步界面。
 * @returns 无返回值。
 */
async function refreshStatus(): Promise<void> {
  const api = bridge()
  if (!api || busy.value) return
  try {
    const next = await api.getStatus()
    const endedByItself = active.value && !next.active && !stoppedByUser
    status.value = next
    if (endedByItself) {
      notice.value = '本次保持唤醒已结束，Windows 恢复自动睡眠策略'
      error.value = ''
    }
    stoppedByUser = false
  } catch (cause) {
    error.value = describeError(cause)
  }
}

/**
 * 应用读取到的配置。
 * @param config 持久化配置。
 * @returns 无返回值。
 */
function applyConfig(config: AwakeConfig): void {
  durationMinutes.value = config.durationMinutes
  keepDisplay.value = config.keepDisplay
  if (config.durationMinutes > 0 && !PRESETS.some((preset) => preset.value === config.durationMinutes)) {
    customMinutes.value = config.durationMinutes
    customDraft.value = String(config.durationMinutes)
  }
}

/**
 * 初始化：读取配置、同步状态并启动计时器。
 * @returns 无返回值。
 */
async function initialize(): Promise<void> {
  startTimers()
  now.value = Date.now()
  const api = bridge()
  bridgeReady.value = Boolean(api)
  if (!api) {
    error.value = '未检测到 ZTools 本地能力，请在 ZTools 中打开插件'
    return
  }
  error.value = ''
  try {
    applyConfig(await api.getConfig())
    await refreshStatus()
  } catch (cause) {
    error.value = describeError(cause)
  }
}

/**
 * 时长或息屏策略变化时，运行中立即下发新参数，未运行时只保存选择。
 * @param options 选项。
 * @param options.preserveRemaining 运行中调整时保留剩余时长。
 * @returns 无返回值。
 */
async function applySelection({ preserveRemaining = false } = {}): Promise<void> {
  const api = bridge()
  if (!api) return
  notice.value = ''
  error.value = ''
  try {
    if (active.value) {
      busy.value = true
      status.value = await api.start({
        durationMinutes: durationMinutes.value,
        keepDisplay: keepDisplay.value,
        preserveRemaining
      })
    } else {
      await api.saveConfig({ durationMinutes: durationMinutes.value, keepDisplay: keepDisplay.value })
    }
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    busy.value = false
  }
}

/**
 * 选择预设时长。
 * @param value 时长（分钟，0 表示一直保持）。
 * @returns 无返回值。
 */
async function selectPreset(value: number): Promise<void> {
  if (durationMinutes.value === value) return
  durationMinutes.value = value
  await applySelection()
}

/**
 * 把自定义输入规范到合法范围。
 * @returns 规范化后的分钟数。
 */
function clampCustom(): number {
  const parsed = Math.round(Number(customDraft.value))
  const value =
    Number.isFinite(parsed) && parsed >= MIN_DURATION_MINUTES
      ? Math.min(parsed, MAX_DURATION_MINUTES)
      : customMinutes.value
  customMinutes.value = value
  customDraft.value = String(value)
  return value
}

/**
 * 切换到自定义时长。
 * @returns 无返回值。
 */
async function selectCustom(): Promise<void> {
  const value = clampCustom()
  if (durationMinutes.value === value) return
  durationMinutes.value = value
  await applySelection()
}

/**
 * 提交自定义输入。
 * @returns 无返回值。
 */
async function commitCustom(): Promise<void> {
  const value = clampCustom()
  if (durationMinutes.value === value) return
  durationMinutes.value = value
  await applySelection()
}

/**
 * 设置息屏策略。
 * @param allowSleepDisplay true 表示允许息屏。
 * @returns 无返回值。
 */
async function selectDisplay(allowSleepDisplay: boolean): Promise<void> {
  const nextKeepDisplay = !allowSleepDisplay
  if (keepDisplay.value === nextKeepDisplay) return
  keepDisplay.value = nextKeepDisplay
  await applySelection({ preserveRemaining: true })
}

let clockTimer: ReturnType<typeof setInterval> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

/** 启动本地节拍与状态轮询。 */
function startTimers(): void {
  stopTimers()
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  pollTimer = setInterval(() => {
    void refreshStatus()
  }, 3000)
}

/** 释放本地节拍与状态轮询（不影响后台守护进程）。 */
function stopTimers(): void {
  if (clockTimer) clearInterval(clockTimer)
  if (pollTimer) clearInterval(pollTimer)
  clockTimer = undefined
  pollTimer = undefined
}

onMounted(() => {
  void initialize()
  window.ztools?.onPluginEnter(() => {
    void initialize()
  })
  window.ztools?.onPluginOut(() => {
    stopTimers()
  })
})

onBeforeUnmount(() => {
  stopTimers()
})
</script>

<template>
  <main class="awake">
    <header class="awake__header">
      <div class="awake__brand">
        <h1>Windows 唤醒控制</h1>
        <p>通过系统执行状态请求阻止 Windows 自动睡眠</p>
      </div>
      <span class="awake__pill" :class="{ 'is-on': active, 'is-off': !status.supported || !bridgeReady }">
        <i class="awake__dot" aria-hidden="true"></i>{{ stateText }}
      </span>
    </header>

    <section class="awake__card" :class="{ 'is-on': active }" aria-live="polite">
      <div class="awake__countdown">
        <span class="awake__countdown-label">{{ countdownLabel }}</span>
        <strong class="awake__countdown-value" data-testid="countdown">{{ countdownText }}</strong>
        <span class="awake__countdown-hint">{{ strategyText }}</span>
      </div>
      <dl class="awake__meta">
        <div><dt>开始时间</dt><dd>{{ startedText }}</dd></div>
        <div><dt>已保持</dt><dd>{{ elapsedText }}</dd></div>
        <div><dt>息屏策略</dt><dd>{{ displayText }}</dd></div>
      </dl>
    </section>

    <section class="awake__section">
      <h2 class="awake__title">唤醒时长<span>到时自动释放，不会修改系统电源计划</span></h2>
      <div class="awake__chips" role="radiogroup" aria-label="唤醒时长">
        <button
          v-for="preset in PRESETS"
          :key="preset.value"
          type="button"
          class="awake__chip"
          :class="{ 'is-active': durationMinutes === preset.value }"
          role="radio"
          :aria-checked="durationMinutes === preset.value"
          :data-testid="`preset-${preset.value}`"
          @click="selectPreset(preset.value)"
        >
          {{ preset.label }}
        </button>
        <button
          type="button"
          class="awake__chip"
          :class="{ 'is-active': isCustomDuration }"
          role="radio"
          :aria-checked="isCustomDuration"
          data-testid="preset-custom"
          @click="selectCustom"
        >
          自定义
        </button>
      </div>
      <label v-if="isCustomDuration" class="awake__custom">
        <input
          v-model="customDraft"
          type="number"
          :min="MIN_DURATION_MINUTES"
          :max="MAX_DURATION_MINUTES"
          step="1"
          inputmode="numeric"
          data-testid="custom-minutes"
          @change="commitCustom"
          @keyup.enter="commitCustom"
        />
        <span>分钟（{{ MIN_DURATION_MINUTES }} - {{ MAX_DURATION_MINUTES }}）</span>
      </label>
    </section>

    <section class="awake__section">
      <h2 class="awake__title">息屏策略<span>控制显示器是否可以自动关闭</span></h2>
      <div class="awake__choices" role="radiogroup" aria-label="息屏策略">
        <button
          type="button"
          class="awake__choice"
          :class="{ 'is-active': keepDisplay }"
          role="radio"
          :aria-checked="keepDisplay"
          data-testid="choice-no-screen-off"
          @click="selectDisplay(false)"
        >
          <strong>不允许息屏</strong>
          <span>屏幕保持常亮，系统也不会睡眠</span>
        </button>
        <button
          type="button"
          class="awake__choice"
          :class="{ 'is-active': !keepDisplay }"
          role="radio"
          :aria-checked="!keepDisplay"
          data-testid="choice-allow-screen-off"
          @click="selectDisplay(true)"
        >
          <strong>允许息屏</strong>
          <span>显示器可以自动关闭，系统保持唤醒</span>
        </button>
      </div>
    </section>

    <footer class="awake__footer">
      <button
        type="button"
        class="awake__action"
        :class="{ 'is-stop': active }"
        :disabled="busy || !status.supported || !bridgeReady"
        data-testid="toggle"
        @click="toggle"
      >
        {{ actionText }}
      </button>
      <p v-if="error" class="awake__message is-error" data-testid="error">{{ error }}</p>
      <p v-else-if="notice" class="awake__message is-notice" data-testid="notice">{{ notice }}</p>
      <p v-else class="awake__message">{{ tipText }}</p>
    </footer>
  </main>
</template>

<style scoped>
.awake {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
  padding: 18px 20px 22px;
  box-sizing: border-box;
  color: var(--awake-text);
}

.awake__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.awake__brand h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.awake__brand p {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--awake-text-weak);
}

.awake__pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--awake-border);
  background: var(--awake-surface-muted);
  font-size: 12.5px;
  color: var(--awake-text-weak);
  white-space: nowrap;
}

.awake__pill.is-on {
  border-color: var(--awake-success-border);
  background: var(--awake-success-soft);
  color: var(--awake-success);
}

.awake__pill.is-off {
  border-color: var(--awake-danger-border);
  background: var(--awake-danger-soft);
  color: var(--awake-danger);
}

.awake__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.awake__pill.is-on .awake__dot {
  animation: awake-pulse 1.8s ease-in-out infinite;
}

.awake__card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px 20px;
  align-items: center;
  padding: 16px 18px;
  border: 1px solid var(--awake-border);
  border-radius: var(--awake-radius);
  background: var(--awake-surface);
  box-shadow: var(--awake-shadow);
}

.awake__card.is-on {
  border-color: var(--awake-success-border);
}

.awake__countdown {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.awake__countdown-label,
.awake__countdown-hint {
  font-size: 12px;
  color: var(--awake-text-weak);
}

.awake__countdown-value {
  font-size: 34px;
  line-height: 40px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.awake__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  min-width: 148px;
}

.awake__meta > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}

.awake__meta dt {
  color: var(--awake-text-weak);
}

.awake__meta dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.awake__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.awake__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.awake__title span {
  font-size: 11.5px;
  font-weight: 400;
  color: var(--awake-text-weak);
}

.awake__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.awake__chip {
  padding: 7px 14px;
  border: 1px solid var(--awake-border);
  border-radius: 999px;
  background: var(--awake-surface);
  color: var(--awake-text);
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.awake__chip:hover {
  border-color: var(--awake-primary);
}

.awake__chip.is-active {
  border-color: var(--awake-primary);
  background: var(--awake-primary);
  color: #fff;
}

.awake__custom {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--awake-text-weak);
}

.awake__custom input {
  width: 104px;
  padding: 6px 10px;
  border: 1px solid var(--awake-border);
  border-radius: 8px;
  background: var(--awake-surface);
  color: var(--awake-text);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.awake__custom input:focus {
  outline: none;
  border-color: var(--awake-primary);
}

.awake__choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}

.awake__choice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border: 1px solid var(--awake-border);
  border-radius: var(--awake-radius);
  background: var(--awake-surface);
  color: var(--awake-text);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.awake__choice strong {
  font-size: 13.5px;
  font-weight: 600;
}

.awake__choice span {
  font-size: 11.5px;
  color: var(--awake-text-weak);
}

.awake__choice:hover {
  border-color: var(--awake-primary);
}

.awake__choice.is-active {
  border-color: var(--awake-primary);
  background: var(--awake-primary-soft);
}

.awake__choice.is-active span {
  color: var(--awake-text);
}

.awake__footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.awake__action {
  height: 44px;
  border: none;
  border-radius: var(--awake-radius);
  background: var(--awake-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}

.awake__action:hover:not(:disabled) {
  opacity: 0.9;
}

.awake__action.is-stop {
  background: var(--awake-danger-solid);
}

.awake__action:disabled {
  cursor: not-allowed;
  filter: grayscale(0.4);
  opacity: 0.75;
}

.awake__message {
  min-height: 18px;
  margin: 0;
  font-size: 12px;
  color: var(--awake-text-weak);
}

.awake__message.is-error {
  color: var(--awake-danger);
}

.awake__message.is-notice {
  color: var(--awake-success);
}

@keyframes awake-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 520px) {
  .awake__card {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .awake__pill.is-on .awake__dot {
    animation: none;
  }
}
</style>
