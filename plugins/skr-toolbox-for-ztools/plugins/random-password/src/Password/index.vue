<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  darkTheme,
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NConfigProvider,
  NInput,
  NInputNumber,
  NSlider,
  NSwitch,
  NTag,
  useOsTheme,
  type GlobalThemeOverrides
} from 'naive-ui'

interface PasswordSettings {
  length: number
  useUpper: boolean
  useLower: boolean
  useDigits: boolean
  useSymbols: boolean
  symbolChars: string
  excludeAmbiguous: boolean
  enableSystemTip: boolean
}

defineProps<{ enterAction: unknown }>()

const SETTINGS_KEY = 'random-password:settings'
const WEB_SETTINGS_KEY = 'random-password:settings:web'
const LENGTH_MIN = 8
const LENGTH_MAX = 64

const UPPERCASE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE_CHARS = 'abcdefghijklmnopqrstuvwxyz'
const DIGIT_CHARS = '0123456789'
const DEFAULT_SYMBOL_CHARS = '!@#$%^&'
const AMBIGUOUS_CHARS = new Set(['O', '0', 'I', 'l', '1'])

const defaultSettings: PasswordSettings = {
  length: 16,
  useUpper: true,
  useLower: true,
  useDigits: true,
  useSymbols: true,
  symbolChars: DEFAULT_SYMBOL_CHARS,
  excludeAmbiguous: true,
  enableSystemTip: true
}

const settings = reactive<PasswordSettings>({ ...defaultSettings })
const password = ref('')
const errorMessage = ref('')
const copyFeedbackMessage = ref('')
const copyFeedbackType = ref<'success' | 'warning' | 'error'>('success')
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

const osTheme = useOsTheme()

const activeTheme = computed(() => {
  return osTheme.value === 'dark' ? darkTheme : null
})

const themeOverrides = computed<GlobalThemeOverrides>(() => {
  const isDark = osTheme.value === 'dark'
  return {
    common: {
      primaryColor: isDark ? '#38bdf8' : '#0f766e',
      primaryColorHover: isDark ? '#67d7ff' : '#0d9488',
      primaryColorPressed: isDark ? '#22a4d8' : '#115e59',
      successColor: isDark ? '#34d399' : '#059669',
      warningColor: isDark ? '#f59e0b' : '#d97706',
      errorColor: isDark ? '#f87171' : '#dc2626',
      borderRadius: '8px',
      fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    },
    Card: {
      borderRadius: '10px'
    },
    Input: {
      borderRadius: '8px'
    },
    Button: {
      borderRadiusMedium: '8px'
    }
  }
})

const enabledTypeCount = computed(() => {
  return (
    Number(settings.useUpper) +
    Number(settings.useLower) +
    Number(settings.useDigits) +
    Number(settings.useSymbols)
  )
})

const canGenerate = computed(() => enabledTypeCount.value > 0)

const strength = computed(() => {
  const score = calculateStrengthScore(normalizeLength(settings.length), enabledTypeCount.value)
  if (score >= 5) {
    return { label: '强', tone: 'strong' as const }
  }
  if (score >= 3) {
    return { label: '中', tone: 'medium' as const }
  }
  return { label: '弱', tone: 'weak' as const }
})

const strengthTagType = computed<'error' | 'warning' | 'success'>(() => {
  if (strength.value.tone === 'strong') {
    return 'success'
  }
  if (strength.value.tone === 'medium') {
    return 'warning'
  }
  return 'error'
})

const lengthModel = computed<number>({
  get() {
    return settings.length
  },
  set(value) {
    settings.length = normalizeLength(value)
  }
})

onMounted(() => {
  loadSettings()
})

onBeforeUnmount(() => {
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer)
    copyFeedbackTimer = null
  }
})

watch(
  settings,
  () => {
    settings.length = normalizeLength(settings.length)
    persistSettings({ ...settings })
  },
  { deep: true }
)

function getZtoolsApi(): ZToolsApi | null {
  const api = (window as any).ztools
  if (!api || typeof api !== 'object') {
    return null
  }
  return api as ZToolsApi
}

function persistSettings(value: PasswordSettings): void {
  const ztoolsApi = getZtoolsApi()

  if (ztoolsApi && ztoolsApi.dbStorage && typeof ztoolsApi.dbStorage.setItem === 'function') {
    ztoolsApi.dbStorage.setItem(SETTINGS_KEY, value)
    return
  }

  try {
    localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(value))
  } catch {
    // ignore in preview mode when web storage is unavailable
  }
}

function normalizeLength(length: number): number {
  const parsed = Number(length)
  if (!Number.isFinite(parsed)) {
    return defaultSettings.length
  }
  return Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, Math.floor(parsed)))
}

function applyAmbiguousFilter(chars: string): string {
  if (!settings.excludeAmbiguous) {
    return chars
  }
  return [...chars].filter((char) => !AMBIGUOUS_CHARS.has(char)).join('')
}

function getEnabledGroups(): string[] {
  const groups: string[] = []

  if (settings.useUpper) {
    groups.push(applyAmbiguousFilter(UPPERCASE_CHARS))
  }
  if (settings.useLower) {
    groups.push(applyAmbiguousFilter(LOWERCASE_CHARS))
  }
  if (settings.useDigits) {
    groups.push(applyAmbiguousFilter(DIGIT_CHARS))
  }
  if (settings.useSymbols) {
    groups.push(applyAmbiguousFilter(settings.symbolChars))
  }

  return groups.filter((group) => group.length > 0)
}

function secureRandomInt(max: number): number {
  if (max <= 0) {
    throw new Error('secureRandomInt max must be greater than 0')
  }

  const array = new Uint32Array(1)
  const maxUint32 = 0x100000000
  const limit = maxUint32 - (maxUint32 % max)

  do {
    crypto.getRandomValues(array)
  } while (array[0] >= limit)

  return array[0] % max
}

function pickRandomChar(chars: string): string {
  return chars[secureRandomInt(chars.length)]
}

function shuffleChars(chars: string[]): void {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
}

function generatePassword(): void {
  errorMessage.value = ''
  copyFeedbackMessage.value = ''

  if (!canGenerate.value) {
    errorMessage.value = '请至少启用一种字符类型后再生成。'
    return
  }

  const groups = getEnabledGroups()
  if (groups.length === 0) {
    errorMessage.value = '当前规则没有可用字符，请调整字符类型或关闭排除易混淆。'
    return
  }

  const targetLength = normalizeLength(settings.length)
  settings.length = targetLength

  const output: string[] = []
  for (const group of groups) {
    output.push(pickRandomChar(group))
  }

  const mergedPool = groups.join('')
  while (output.length < targetLength) {
    output.push(pickRandomChar(mergedPool))
  }

  shuffleChars(output)
  password.value = output.join('')

  const copied = copyGeneratedPassword(password.value)
  if (copied) {
    setCopyFeedback('已复制到剪贴板。', 'success')
    showTip('密码已生成并复制到剪贴板。')
  } else {
    errorMessage.value = '密码已生成，但自动复制失败，请手动复制。'
    setCopyFeedback('自动复制失败，请点击“手动复制”。', 'warning')
    showTip('自动复制失败，请手动复制。')
  }
}

function copyGeneratedPassword(text: string): boolean {
  const ztoolsApi = getZtoolsApi()
  if (ztoolsApi && typeof ztoolsApi.copyText === 'function') {
    return ztoolsApi.copyText(text)
  }

  if (typeof document === 'undefined' || !document.body) {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  document.body.removeChild(textarea)
  return copied
}

function handleManualCopy(): void {
  if (!password.value) {
    setCopyFeedback('请先生成密码。', 'warning')
    return
  }

  const copied = copyGeneratedPassword(password.value)
  if (copied) {
    setCopyFeedback('已手动复制到剪贴板。', 'success')
    showTip('已复制到剪贴板。')
  } else {
    setCopyFeedback('手动复制失败，请检查系统剪贴板权限。', 'error')
  }
}

function setCopyFeedback(
  message: string,
  type: 'success' | 'warning' | 'error',
  timeout = 2200
): void {
  copyFeedbackMessage.value = message
  copyFeedbackType.value = type

  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer)
  }
  copyFeedbackTimer = setTimeout(() => {
    copyFeedbackMessage.value = ''
    copyFeedbackTimer = null
  }, timeout)
}

function loadSettings(): void {
  try {
    const ztoolsApi = getZtoolsApi()

    let stored: Partial<PasswordSettings> | null = null
    if (ztoolsApi && ztoolsApi.dbStorage && typeof ztoolsApi.dbStorage.getItem === 'function') {
      stored = ztoolsApi.dbStorage.getItem<Partial<PasswordSettings>>(SETTINGS_KEY)
    } else {
      const raw = localStorage.getItem(WEB_SETTINGS_KEY)
      stored = raw ? (JSON.parse(raw) as Partial<PasswordSettings>) : null
    }

    if (!stored || typeof stored !== 'object') {
      return
    }

    settings.length = normalizeLength(stored.length ?? defaultSettings.length)
    settings.useUpper = typeof stored.useUpper === 'boolean' ? stored.useUpper : defaultSettings.useUpper
    settings.useLower = typeof stored.useLower === 'boolean' ? stored.useLower : defaultSettings.useLower
    settings.useDigits = typeof stored.useDigits === 'boolean' ? stored.useDigits : defaultSettings.useDigits
    settings.useSymbols =
      typeof stored.useSymbols === 'boolean' ? stored.useSymbols : defaultSettings.useSymbols
    settings.symbolChars =
      typeof stored.symbolChars === 'string' ? stored.symbolChars : defaultSettings.symbolChars
    settings.excludeAmbiguous =
      typeof stored.excludeAmbiguous === 'boolean'
        ? stored.excludeAmbiguous
        : defaultSettings.excludeAmbiguous
    settings.enableSystemTip =
      typeof stored.enableSystemTip === 'boolean'
        ? stored.enableSystemTip
        : defaultSettings.enableSystemTip
  } catch {
    settings.length = defaultSettings.length
    settings.symbolChars = defaultSettings.symbolChars
    settings.enableSystemTip = defaultSettings.enableSystemTip
  }
}

function showTip(message: string): void {
  if (!settings.enableSystemTip) {
    return
  }

  const ztoolsApi = getZtoolsApi()
  const maybeShowTip = (ztoolsApi as any)?.showTip
  if (typeof maybeShowTip === 'function') {
    maybeShowTip(message)
    return
  }

  if (ztoolsApi && typeof ztoolsApi.showNotification === 'function') {
    ztoolsApi.showNotification(message)
    return
  }

  console.info(message)
}

function calculateStrengthScore(length: number, typeCount: number): number {
  let score = 0
  // Fixed thresholds for 弱/中/强 mapping.
  if (length >= 12) score += 1
  if (length >= 16) score += 1
  if (length >= 24) score += 1
  if (typeCount >= 2) score += 1
  if (typeCount >= 3) score += 1
  if (typeCount === 4) score += 1
  return score
}
</script>

<template>
  <n-config-provider :theme="activeTheme" :theme-overrides="themeOverrides">
    <div class="password-page">
      <div class="page-shell">
        <div class="main-grid">
          <n-card class="panel-card" title="规则设置" size="small" :bordered="false">
            <div class="row row-length-head">
              <span class="field-label">长度</span>
              <span class="length-value">{{ settings.length }}</span>
            </div>

            <div class="row row-length-ctrl">
              <n-slider v-model:value="lengthModel" :min="LENGTH_MIN" :max="LENGTH_MAX" :step="1" />
              <n-input-number
                v-model:value="lengthModel"
                :min="LENGTH_MIN"
                :max="LENGTH_MAX"
                :step="1"
                :show-button="false"
              />
            </div>

            <div class="row row-types">
              <label class="check-item"><n-checkbox v-model:checked="settings.useUpper" />大写</label>
              <label class="check-item"><n-checkbox v-model:checked="settings.useLower" />小写</label>
              <label class="check-item"><n-checkbox v-model:checked="settings.useDigits" />数字</label>
              <label class="check-item"><n-checkbox v-model:checked="settings.useSymbols" />符号</label>
            </div>

            <div class="row row-symbols">
              <span class="field-label">符号集</span>
              <n-input
                v-model:value="settings.symbolChars"
                class="symbol-input"
                :disabled="!settings.useSymbols"
                placeholder="!@#$%^&"
              />
            </div>

            <div class="row row-actions">
              <label class="check-item check-item-inline">
                <n-checkbox v-model:checked="settings.excludeAmbiguous" />
                排除易混淆（O/0/I/l/1）
              </label>
              <n-button class="generate-btn" type="primary" size="medium" :disabled="!canGenerate" @click="generatePassword">
                生成密码
              </n-button>
            </div>

            <div class="row row-system-tip">
              <span class="field-label">系统消息提示</span>
              <div class="tip-switch-wrap">
                <n-switch v-model:value="settings.enableSystemTip" size="small" />
                <span class="tip-switch-text">{{ settings.enableSystemTip ? '已开启' : '已关闭' }}</span>
              </div>
            </div>

            <n-alert v-if="!canGenerate" type="warning" :show-icon="false" class="status-alert">
              请至少启用一种字符类型后再生成。
            </n-alert>
          </n-card>

          <n-card class="panel-card" title="生成结果" size="small" :bordered="false">
            <div class="row result-top">
              <span class="field-label">强度</span>
              <div class="result-actions">
                <n-tag size="small" :type="strengthTagType" round>{{ strength.label }}</n-tag>
                <n-button class="manual-copy-btn" size="small" secondary type="primary" @click="handleManualCopy">
                  手动复制
                </n-button>
              </div>
            </div>

            <n-input
              type="textarea"
              :value="password"
              readonly
              :autosize="{ minRows: 3, maxRows: 4 }"
              placeholder="点击“生成密码”后结果显示在这里。"
            />

            <n-alert v-if="errorMessage" type="error" class="status-alert">
              {{ errorMessage }}
            </n-alert>
            <n-alert v-if="copyFeedbackMessage" :type="copyFeedbackType" class="status-alert" :show-icon="false">
              {{ copyFeedbackMessage }}
            </n-alert>
          </n-card>
        </div>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped>
.password-page {
  padding: 6px 8px;
  background: var(--rp-bg);
}

.page-shell {
  max-width: 1200px;
  margin: 0 auto;
}

.main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.panel-card {
  background: var(--rp-surface);
  border: 1px solid var(--rp-border);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);
}

:deep(.n-card-header) {
  padding-bottom: 4px;
}

:deep(.n-card__content) {
  padding-top: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row + .row {
  margin-top: 8px;
}

.field-label {
  color: var(--rp-text-muted);
  font-size: 12px;
  line-height: 1;
}

.row-length-head {
  justify-content: space-between;
}

.length-value {
  color: var(--rp-text);
  font-size: 16px;
  font-weight: 700;
}

.row-length-ctrl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px;
  gap: 8px;
}

.row-types {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.row-symbols {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 8px;
}

.symbol-input {
  width: 100%;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--rp-text);
  font-size: 13px;
  white-space: nowrap;
}

.row-actions {
  justify-content: space-between;
}

.row-system-tip {
  justify-content: space-between;
}

.check-item-inline {
  font-size: 12px;
}

.tip-switch-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tip-switch-text {
  color: var(--rp-text-soft);
  font-size: 12px;
  line-height: 1;
}

.generate-btn {
  min-width: 110px;
  height: 34px;
  font-weight: 700;
}

.result-top {
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 2px;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.manual-copy-btn {
  min-width: 78px;
  height: 28px;
  font-size: 12px;
}

.status-alert {
  margin-top: 8px;
}

:deep(.n-input textarea) {
  font-family: 'Consolas', 'SFMono-Regular', 'Menlo', monospace;
  font-size: 13px;
  line-height: 1.45;
}

@media (max-width: 1024px) {
  .main-grid {
    grid-template-columns: 1fr;
  }

  .row-types {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .password-page {
    padding: 6px;
  }

  .row-length-ctrl,
  .row-symbols,
  .row-types,
  .row-actions {
    grid-template-columns: 1fr;
    display: grid;
  }

  .check-item {
    white-space: normal;
  }
}
</style>
