<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface RateBracket {
  rate: number
  label: string
  range: string
}

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

// 预扣率表二（国家税务总局公告 2018 年第 56 号），档位按应纳税所得额判定
const RATE_BRACKETS: RateBracket[] = [
  { rate: 0.2, label: '20%', range: '≤ 2 万' },
  { rate: 0.3, label: '30%', range: '2–5 万' },
  { rate: 0.4, label: '40%', range: '> 5 万' }
]

// 常用额度快捷填入，点击才写入，不作为默认值
const QUICK_AMOUNTS = [4000, 8000, 10000, 20000, 50000]

const view = ref<'forward' | 'reverse'>('forward')
const grossText = ref('')
const netText = ref('')
const result = ref<any>(null)
const errorMessage = ref('')
const focused = ref(false)

const sourceText = computed(() => (view.value === 'forward' ? grossText.value : netText.value))
const hasInput = computed(() => sourceText.value.length > 0)
const inputLabel = computed(() => (view.value === 'forward' ? '税前劳务报酬' : '税后到手金额'))
const primaryLabel = computed(() => (view.value === 'forward' ? '税后到手' : '税前金额'))
const primaryValue = computed(() => {
  if (!result.value) return 0
  return view.value === 'forward' ? result.value.net : result.value.gross
})
const highlightSub = computed(() => {
  if (!result.value) return ''
  return view.value === 'forward'
    ? `税前 ${formatMoney(result.value.gross)} 元`
    : `税后 ${formatMoney(result.value.net)} 元`
})
const currentRate = computed(() => (result.value ? Math.round(result.value.rate * 100) : 0))
const isLowBand = computed(() => !!result.value && result.value.gross <= 4000)
const basisHint = computed(() => {
  if (!result.value) return ''
  const gross = result.value.gross
  const base = result.value.incomeBase
  return gross > 4000
    ? `计税收入额 = 税前 ${formatMoney(gross)} 元 × 80% = ${formatMoney(base)} 元`
    : `计税收入额 = 税前 ${formatMoney(gross)} 元 − 800 元 = ${formatMoney(base)} 元`
})

const copyText = computed(() => {
  if (!result.value) return ''
  const { gross, net, tax, incomeBase, rate } = result.value
  return [
    '劳务报酬计算',
    `税前金额：${formatMoney(gross)} 元`,
    `税后金额：${formatMoney(net)} 元`,
    `预扣个税：${formatMoney(tax)} 元`,
    `计税收入额：${formatMoney(incomeBase)} 元`,
    `适用预扣率：${Math.round(rate * 100)}%`
  ].join('\n')
})

function formatMoney(value: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '--'
  return (Math.round(value * 100) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/** 只保留数字与一个小数点，小数最多两位。 */
function sanitize(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  if (dot === -1) return cleaned
  const head = cleaned.slice(0, dot + 1)
  const tail = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return head + tail
}

function run(mode: 'forward' | 'reverse', input: string) {
  errorMessage.value = ''
  if (!input.trim()) {
    result.value = null
    return
  }
  try {
    result.value =
      mode === 'forward'
        ? window.services.calculateForward(input)
        : window.services.calculateReverse(input)
  } catch (error: any) {
    result.value = null
    errorMessage.value = error?.message || '计算失败，请检查输入金额'
  }
}

function switchView(next: 'forward' | 'reverse') {
  if (view.value === next) return
  view.value = next
  // 两个方向的金额含义不同，切换时清空，避免把税前数当税后数继续算
  grossText.value = ''
  netText.value = ''
  result.value = null
  errorMessage.value = ''
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  const value = sanitize(target?.value ?? '')
  if (target && target.value !== value) target.value = value
  if (view.value === 'forward') grossText.value = value
  else netText.value = value
}

function fill(amount: number) {
  const text = String(amount)
  if (view.value === 'forward') grossText.value = text
  else netText.value = text
}

function clearInput() {
  grossText.value = ''
  netText.value = ''
  result.value = null
  errorMessage.value = ''
}

async function copyResult() {
  if (!copyText.value) return
  try {
    const ok = window.ztools.copyText(copyText.value)
    if (!ok) throw new Error('复制失败')
    window.ztools.showNotification('计算结果已复制到剪贴板')
  } catch (error: any) {
    try {
      await navigator.clipboard.writeText(copyText.value)
    } catch (innerError: any) {
      errorMessage.value = innerError?.message || error?.message || '复制失败'
    }
  }
}

watch(
  () => props.enterAction,
  (enterAction: any) => {
    const code = enterAction?.code
    if (code === 'forward-calc' || code === 'reverse-calc') {
      // 从正则指令进入：已带入金额，直接算
      const mode = code === 'forward-calc' ? 'forward' : 'reverse'
      const raw = typeof enterAction.payload === 'string' ? enterAction.payload : ''
      const parsed = raw ? window.services.parseAmount(raw) : null
      view.value = mode
      const text = parsed ? String(parsed.value) : ''
      if (mode === 'forward') grossText.value = text
      else netText.value = text
      run(mode, text)
      return
    }
    // 从图标/关键词进入：不预置任何数字，保持空白
    view.value = 'forward'
    grossText.value = ''
    netText.value = ''
    result.value = null
    errorMessage.value = ''
  },
  { immediate: true, deep: true }
)

watch(
  sourceText,
  (text) => {
    run(view.value, text)
  },
  { immediate: true }
)
</script>

<template>
  <div class="calculator" data-testid="calculator">
    <header class="header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">¥</div>
        <div class="title-block">
          <h1>劳务报酬计算器</h1>
          <p>按劳务报酬预扣率测算，支持双向换算</p>
        </div>
      </div>
      <button class="copy-btn" type="button" :disabled="!result" data-testid="copy-result" @click="copyResult">
        复制结果
      </button>
    </header>

    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ active: view === 'forward' }"
        :aria-selected="view === 'forward'"
        data-testid="tab-forward"
        @click="switchView('forward')"
      >
        税前 → 税后
      </button>
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ active: view === 'reverse' }"
        :aria-selected="view === 'reverse'"
        data-testid="tab-reverse"
        @click="switchView('reverse')"
      >
        税后 → 税前
      </button>
    </div>

    <div class="body-grid">
      <div class="left-col">
        <section class="input-panel">
          <div class="field-head">
            <span class="field-label">{{ inputLabel }}</span>
            <button v-if="hasInput" class="clear-btn" type="button" @click="clearInput">清空</button>
          </div>

          <div class="field-input-wrap" :class="{ focused }">
            <span class="currency" aria-hidden="true">¥</span>
            <input
              type="text"
              inputmode="decimal"
              class="field-input"
              :value="sourceText"
              placeholder="请输入金额"
              :data-testid="view === 'forward' ? 'gross-input' : 'net-input'"
              @input="handleInput"
              @focus="focused = true"
              @blur="focused = false"
            />
            <span class="unit">元</span>
          </div>

          <div class="quick-row">
            <span class="quick-label">常用</span>
            <button
              v-for="amount in QUICK_AMOUNTS"
              :key="amount"
              type="button"
              class="chip"
              :class="{ picked: sourceText === String(amount) }"
              @click="fill(amount)"
            >
              {{ amount >= 10000 ? `${amount / 10000}万` : amount }}
            </button>
          </div>

          <p v-if="errorMessage" class="error" data-testid="error">{{ errorMessage }}</p>
        </section>

        <section class="rule-card">
          <span class="rule-title">计税收入额</span>
          <div class="rule-items">
            <span class="rule-item" :class="{ on: result && isLowBand }">
              <b>≤ 4 千</b>
              <i>收入 − 800</i>
            </span>
            <span class="rule-item" :class="{ on: result && !isLowBand }">
              <b>&gt; 4 千</b>
              <i>收入 × 80%</i>
            </span>
          </div>
        </section>
      </div>

      <section class="result-panel" data-testid="result-panel">
        <template v-if="result">
          <div class="highlight">
            <span class="highlight-label">{{ primaryLabel }}</span>
            <div class="highlight-value">
              <span class="sign">¥</span>{{ formatMoney(primaryValue) }}
            </div>
            <span class="highlight-sub">{{ highlightSub }}</span>
          </div>

          <div class="metrics">
            <div class="metric">
              <span class="metric-label">预扣个税</span>
              <b class="metric-value">{{ formatMoney(result.tax) }}<em>元</em></b>
            </div>
            <div class="metric">
              <span class="metric-label">计税收入额</span>
              <b class="metric-value" data-testid="tax-basis">{{ formatMoney(result.incomeBase) }}<em>元</em></b>
            </div>
            <div class="metric">
              <span class="metric-label">适用预扣率</span>
              <b class="metric-value">{{ currentRate }}<em>%</em></b>
            </div>
          </div>

          <div class="rate-scale">
            <span
              v-for="bracket in RATE_BRACKETS"
              :key="bracket.rate"
              class="scale-item"
              :class="{ on: currentRate === Math.round(bracket.rate * 100) }"
            >
              <b>{{ bracket.label }}</b>
              <i>{{ bracket.range }}</i>
            </span>
          </div>

          <p class="hint">{{ basisHint }}</p>
        </template>

        <div v-else class="empty" data-testid="placeholder">
          <div class="empty-mark" aria-hidden="true">¥</div>
          <p>输入金额后自动计算</p>
          <span>也支持贴入「12000」或「8800 税后」这类文本，会自动识别金额</span>
        </div>
      </section>
    </div>

    <footer class="footer">
      依据国家税务总局公告 2018 年第 56 号预扣率表二：应纳税所得额不超过 2 万元预扣率 20%，2 万至 5 万元 30%（速算扣除 2000），超过 5 万元 40%（速算扣除 7000）。
    </footer>
  </div>
</template>

<style scoped>
.calculator {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 15px 12px;
  box-sizing: border-box;
  min-height: 100%;
}

/* ── 顶部 ───────────────────────────── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.brand-mark {
  flex-shrink: 0;
  width: 31px;
  height: 31px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 55%, #1d4ed8 100%);
  box-shadow: 0 5px 12px rgba(37, 99, 235, 0.26);
}

.title-block {
  min-width: 0;
}

.title-block h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--text-primary);
}

.title-block p {
  margin: 2px 0 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.copy-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-600);
  background: var(--brand-50);
  border: 1px solid var(--brand-100);
}

.copy-btn:hover:not(:disabled) {
  background: var(--brand-100);
  border-color: var(--brand-200);
}

.copy-btn:disabled {
  opacity: 0.45;
}

/* ── 分段切换 ───────────────────────── */
.tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-color);
}

.tab {
  padding: 6px 10px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.tab:hover:not(.active) {
  color: var(--text-primary);
}

.tab.active {
  background: var(--surface);
  color: var(--brand-600);
  box-shadow: var(--shadow-sm);
}

/* ── 主体栅格：宽窗口两栏 ───────────── */
.body-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
}

.left-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

@media (min-width: 660px) {
  .body-grid {
    grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr);
  }
}

/* ── 输入区 ─────────────────────────── */
.input-panel {
  padding: 11px 13px 10px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}

.field-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

.clear-btn {
  font-size: 10.5px;
  color: var(--text-tertiary);
  padding: 2px 6px;
  border-radius: 6px;
}

.clear-btn:hover {
  color: var(--brand-600);
  background: var(--brand-50);
}

.field-input-wrap {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--surface-muted);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
}

.field-input-wrap.focused {
  border-color: var(--brand-500);
  background: var(--surface);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}

.currency {
  font-size: 15px;
  font-weight: 700;
  color: var(--brand-600);
  line-height: 1;
}

.field-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 0;
  line-height: 1.3;
}

.field-input::placeholder {
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-tertiary);
}

.unit {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
}

.quick-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.quick-label {
  font-size: 10.5px;
  color: var(--text-tertiary);
  margin-right: 1px;
}

.chip {
  padding: 3px 7px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--surface-muted);
  border: 1px solid var(--border-color);
}

.chip:hover {
  color: var(--brand-600);
  border-color: var(--brand-200);
  background: var(--brand-50);
}

.chip.picked {
  color: var(--brand-600);
  background: var(--brand-50);
  border-color: var(--brand-200);
}

.error {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--danger);
}

/* ── 计税规则 ───────────────────────── */
.rule-card {
  padding: 9px 12px 10px;
  border-radius: 11px;
  background: var(--surface);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
  box-sizing: border-box;
}

.rule-title {
  display: block;
  margin-bottom: 6px;
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.rule-items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.rule-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 9px;
  border-radius: 7px;
  background: var(--surface-muted);
  border: 1px solid transparent;
  color: var(--text-tertiary);
}

.rule-item b {
  font-size: 11px;
  font-weight: 700;
}

.rule-item i {
  font-style: normal;
  font-size: 9.5px;
}

.rule-item.on {
  color: var(--brand-600);
  background: var(--brand-50);
  border-color: var(--brand-200);
}

/* ── 结果区 ─────────────────────────── */
.result-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
  box-sizing: border-box;
}

.highlight {
  position: relative;
  overflow: hidden;
  padding: 11px 14px 12px;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 52%, #4338ca 100%);
  box-shadow: 0 9px 20px rgba(37, 99, 235, 0.22);
}

.highlight::after {
  content: '';
  position: absolute;
  right: -26px;
  top: -34px;
  width: 104px;
  height: 104px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
}

.highlight-label {
  display: block;
  font-size: 11px;
  letter-spacing: 0.4px;
  opacity: 0.85;
}

.highlight-value {
  margin-top: 3px;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.4px;
  line-height: 1.15;
}

.highlight-value .sign {
  font-size: 16px;
  font-weight: 700;
  margin-right: 3px;
  opacity: 0.9;
}

.highlight-sub {
  display: block;
  margin-top: 4px;
  font-size: 10.5px;
  opacity: 0.82;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--surface-muted);
  border: 1px solid var(--border-color);
}

.metric-label {
  font-size: 10px;
  color: var(--text-tertiary);
}

.metric-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.25;
}

.metric-value em {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-left: 2px;
}

.rate-scale {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.scale-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 4px 3px;
  border-radius: 7px;
  background: var(--surface-muted);
  border: 1px solid transparent;
  color: var(--text-tertiary);
}

.scale-item b {
  font-size: 11px;
  font-weight: 700;
}

.scale-item i {
  font-style: normal;
  font-size: 9px;
}

.scale-item.on {
  color: var(--brand-600);
  background: var(--brand-50);
  border-color: var(--brand-200);
}

.hint {
  margin: 0;
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 1.55;
  color: var(--info-text);
  background: var(--info-bg);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 22px 12px;
  min-height: 168px;
  border-radius: 10px;
  border: 1px dashed var(--border-strong);
  background: var(--surface-muted);
  text-align: center;
}

.empty-mark {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: var(--brand-600);
  background: var(--brand-50);
  margin-bottom: 2px;
}

.empty p {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.empty span {
  font-size: 10px;
  line-height: 1.6;
  color: var(--text-tertiary);
  max-width: 280px;
}

.footer {
  padding: 0 2px;
  font-size: 9.5px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

@media (max-width: 380px) {
  .title-block p {
    display: none;
  }

  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .highlight-value {
    font-size: 23px;
  }
}
</style>
