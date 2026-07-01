<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ZInput, ZSelect, ZButton, ZSwitch, ZTabs, ZTabPane, useToast } from 'ztools-ui'

/**
 * 翻译子页（实用翻译器）：单选 provider，原文/译文左右并排。
 * - 收到 initialText（regex 入口带进来的选中文本）时自动预填并触发一次翻译。
 * - 顶部「自动翻译」开关：开启后原文变化（停止输入）1s 自动重新翻译。
 * - 直接调 window.services.translateXxx（不经宿主 provider 调度），
 *   必须以 .call(window.services, ...) 形式调用，保证方法内 this 指向 services。
 * - 目标语言为 auto 时不传 to，复用 preload._resolveDefaultTargetLang
 *   按文本内容推断（中→英 / 其余→中）。
 */

const props = defineProps<{
  /** 进入时预填的待翻译文本（regex 入口）。 */
  initialText?: string
}>()

const { success } = useToast()

// 公共语言列表（与 preload TRANSLATE_LANG_MAP 的 key 对齐）。
const langOptions = [
  { label: '自动检测', value: 'auto' },
  { label: '中文（简体）', value: 'zh-CN' },
  { label: '中文（繁體）', value: 'zh-TW' },
  { label: '英语', value: 'en' },
  { label: '日语', value: 'ja' },
  { label: '韩语', value: 'ko' },
  { label: '法语', value: 'fr' },
  { label: '西班牙语', value: 'es' },
  { label: '俄语', value: 'ru' },
  { label: '德语', value: 'de' },
  { label: '意大利语', value: 'it' },
  { label: '泰语', value: 'th' },
  { label: '越南语', value: 'vi' },
  { label: '阿拉伯语', value: 'ar' }
]

type ProviderName = 'baidu' | 'google' | 'youdao' | 'microsoft'

const providerLabels: Record<ProviderName, string> = {
  baidu: '百度翻译',
  google: '谷歌翻译',
  youdao: '有道翻译',
  microsoft: '微软翻译'
}

// 各 provider 对应的 services 方法名。
const providerFnNames: Record<
  ProviderName,
  'translateBaidu' | 'translateGoogle' | 'translateYoudao' | 'translateMicrosoft'
> = {
  baidu: 'translateBaidu',
  google: 'translateGoogle',
  youdao: 'translateYoudao',
  microsoft: 'translateMicrosoft'
}

// 读取各 provider 配置状态，用于在 provider 选择器旁标注「已配置 / 免授权」。
const providerConfigured = ref<Record<ProviderName, boolean>>({
  baidu: false,
  google: true,
  youdao: false,
  microsoft: true
})
function refreshProviderStatus() {
  try {
    const b = window.services.getTranslateSettings('baidu')
    const y = window.services.getTranslateSettings('youdao')
    providerConfigured.value = {
      baidu: !!(b.appID && b.appKey),
      google: true,
      youdao: !!(y.appKey && y.appSecret),
      microsoft: true
    }
  } catch (_) {
    /* preload 缺失等异常：保持默认值，不阻塞 */
  }
}

// provider 列表（用于顶部 segment 切换）。未配置凭据的禁用（百度/有道）。
const providerList = computed(() =>
  (Object.keys(providerLabels) as ProviderName[]).map((p) => ({
    name: p,
    label: providerLabels[p],
    disabled: !providerConfigured.value[p]
  }))
)

// 默认选「已配置」的第一个，偏好顺序：microsoft > google > baidu > youdao
function pickDefaultProvider(): ProviderName {
  const order: ProviderName[] = ['microsoft', 'google', 'baidu', 'youdao']
  return order.find((p) => providerConfigured.value[p]) || 'microsoft'
}

const provider = ref<ProviderName>('microsoft')
const sourceLang = ref('auto')
const targetLang = ref('auto') // auto = 走 preload 自动推断（中→英 / 其余→中）
const sourceText = ref('') // 左侧原文（可编辑）
const autoTranslate = ref(true) // 自动翻译开关，默认开启

const result = ref<{ loading: boolean; text: string; error: string; ms: number }>({
  loading: false,
  text: '',
  error: '',
  ms: 0
})

const hasInput = computed(() => sourceText.value.trim().length > 0)

// 源/目标语言互换（auto 不参与互换，保持自动检测语义）
function swapLang() {
  if (sourceLang.value === 'auto' || targetLang.value === 'auto') {
    success('自动检测模式不支持互换')
    return
  }
  const tmp = sourceLang.value
  sourceLang.value = targetLang.value
  targetLang.value = tmp
  // 互换后已有译文搬到原文侧，原原文拿到译文侧，重新翻译
  if (result.value.text) {
    // 抑制由赋值引发的自动翻译（同 tick 内 watch 只批处理一次），避免与下方 run 重复
    suppressAuto = true
    sourceText.value = result.value.text
    run()
  }
}

// 执行翻译。to 传 undefined 时走 preload 自动推断目标语言。
async function run() {
  // 取消挂起的自动翻译定时器，避免显式 run 后又被 debounce 触发一次
  if (autoTimer) {
    clearTimeout(autoTimer)
    autoTimer = null
  }
  if (!hasInput.value) {
    result.value = { loading: false, text: '', error: '', ms: 0 }
    return
  }
  const fnName = providerFnNames[provider.value]
  result.value = { loading: true, text: '', error: '', ms: 0 }
  const t0 = performance.now()
  try {
    const out = await (
      (window.services[fnName] as unknown) as
        (this: typeof window.services, t: string, f?: string, to?: string) => Promise<{ text: string }>
    ).call(
      window.services,
      sourceText.value,
      sourceLang.value,
      targetLang.value === 'auto' ? undefined : targetLang.value
    )
    result.value = {
      loading: false,
      text: out.text,
      error: '',
      ms: Math.round(performance.now() - t0)
    }
  } catch (e: any) {
    result.value = {
      loading: false,
      text: '',
      error: e?.message ? String(e.message) : String(e),
      ms: Math.round(performance.now() - t0)
    }
  }
}

// ─── 自动翻译：原文变化 1s 后重新翻译 ──────────────────────────────
// 自动翻译开关关闭时，仅手动点「翻译」触发；开启时，sourceText / 语言变化
// 都会重置 1s 定时器，停止输入后触发翻译。切 provider 不走 debounce，立即翻译。
let autoTimer: ReturnType<typeof setTimeout> | null = null
// 抑制由程序化赋值（如 initialText 预填）引发的下一次自动翻译，
// 避免「立即 run + 1s 后又 run」的双重翻译。
let suppressAuto = false
function scheduleAuto() {
  if (autoTimer) {
    clearTimeout(autoTimer)
    autoTimer = null
  }
  if (!autoTranslate.value) return
  autoTimer = setTimeout(() => {
    autoTimer = null
    run()
  }, 1000)
}

// 自动翻译开启时，原文或语言变化触发 debounce
watch([sourceText, sourceLang, targetLang], () => {
  if (suppressAuto) {
    suppressAuto = false
    // 清掉可能已存在的旧定时器，避免历史输入触发
    if (autoTimer) {
      clearTimeout(autoTimer)
      autoTimer = null
    }
    return
  }
  if (autoTranslate.value) scheduleAuto()
})

// 切换 provider：立即翻译（不 debounce），让用户即时看到效果
watch(provider, () => {
  if (hasInput.value) run()
})

// 切换自动翻译开关：从关到开时，若已有原文立即补一次
watch(autoTranslate, (on) => {
  if (on && hasInput.value) scheduleAuto()
})

// 进入时收到 initialText：预填 + 立即翻译一次（suppress 一次自动翻译避免重复）
watch(
  () => props.initialText,
  (text) => {
    if (!text) return
    suppressAuto = true
    sourceText.value = text
    run()
  },
  { immediate: true }
)

onMounted(() => {
  refreshProviderStatus()
  provider.value = pickDefaultProvider()
})

onUnmounted(() => {
  if (autoTimer) {
    clearTimeout(autoTimer)
    autoTimer = null
  }
})
</script>

<template>
  <div class="tr-wrap">
    <!-- 顶部控制栏：第一行 = 源/目标语言 + 自动翻译开关（同一行） -->
    <div class="tr-bar">
      <div class="tr-lang">
        <ZSelect v-model="sourceLang" :options="langOptions" size="small" />
        <button
          type="button"
          class="tr-swap"
          title="语言互换"
          aria-label="语言互换"
          @click="swapLang"
        >
          ⇄
        </button>
        <ZSelect v-model="targetLang" :options="langOptions" size="small" />
        <div class="tr-auto">
          <span class="tr-auto-label">自动翻译</span>
          <ZSwitch v-model="autoTranslate" size="small" />
        </div>
      </div>
    </div>

    <!-- 第二行：翻译渠道（segment 切换） -->
    <ZTabs
      v-model:value="provider"
      type="segment"
      size="small"
      :pane-wrapper-style="{ display: 'none' }"
      class="tr-providers"
    >
      <ZTabPane
        v-for="p in providerList"
        :key="p.name"
        :name="p.name"
        :tab="p.label"
        :disabled="p.disabled"
      />
    </ZTabs>

    <!-- 原文 / 译文 左右结构 -->
    <div class="tr-cols">
      <!-- 左：原文（可编辑） -->
      <div class="tr-col">
        <div class="tr-col-head">
          <span class="tr-col-title">原文</span>
          <span class="tr-col-meta">{{ sourceText.length }} 字</span>
        </div>
        <textarea
          v-model="sourceText"
          class="tr-textarea"
          placeholder="输入要翻译的文本…"
          :maxlength="2000"
          spellcheck="false"
        ></textarea>
      </div>

      <!-- 右：译文 -->
      <div class="tr-col">
        <div class="tr-col-head">
          <span class="tr-col-title">
            译文
            <span v-if="result.ms > 0 && !result.loading" class="tr-col-ms">{{ result.ms }} ms</span>
          </span>
        </div>
        <div class="tr-output">
          <div v-if="result.error" class="tr-output-error">{{ result.error }}</div>
          <div v-else-if="result.text" class="tr-output-text">{{ result.text }}</div>
          <div v-else-if="result.loading" class="tr-output-empty">翻译中…</div>
          <div v-else class="tr-output-empty">
            {{ hasInput ? '点击「翻译」' : '输入文本后自动翻译' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作：自动翻译开启时不展示「翻译」按钮（仅手动模式下出现） -->
    <div v-if="!autoTranslate" class="tr-actions">
      <ZButton
        type="primary"
        :disabled="!hasInput || result.loading"
        :loading="result.loading"
        @click="run"
      >
        {{ result.loading ? '翻译中…' : '翻译' }}
      </ZButton>
    </div>
  </div>
</template>

<style scoped>
.tr-wrap {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  height: 100%;
}

/* ── 顶部控制栏 ── */
.tr-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.tr-lang {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.tr-auto {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.tr-auto-label {
  font-size: 12px;
  color: var(--text-secondary, #999);
  white-space: nowrap;
}

/* 翻译渠道 segment：让 4 个选项均匀撑满宽度 */
.tr-providers {
  width: 100%;
}

/* 语言互换按钮 */
.tr-swap {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #666);
  font-size: 15px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}
.tr-swap:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
  color: var(--primary-color, #1976d2);
  border-color: color-mix(in srgb, var(--primary-color, #1976d2), transparent 50%);
}

/* ── 左右两列 ── */
.tr-cols {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  min-height: 260px;
}
.tr-col {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 10px;
  overflow: hidden;
  background: var(--card-bg, transparent);
}
.tr-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e5e6eb);
  background: var(--hover-bg, rgba(0, 0, 0, 0.02));
}
.tr-col-title {
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tr-col-ms {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary, #999);
}
.tr-col-meta {
  font-size: 11px;
  color: var(--text-secondary, #999);
}

/* 左侧原文 textarea：铺满列高，等宽布局 */
.tr-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 12px 14px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.7;
  color: inherit;
  background: transparent;
  box-sizing: border-box;
  word-break: break-all;
}

/* 右侧译文输出区 */
.tr-output {
  flex: 1;
  padding: 12px 14px;
  overflow-y: auto;
  box-sizing: border-box;
}
.tr-output-text {
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
.tr-output-error {
  font-size: 13px;
  color: #e53935;
  white-space: pre-wrap;
  word-break: break-all;
}
.tr-output-empty {
  font-size: 13px;
  color: var(--text-secondary, #999);
}

/* ── 底部操作 ── */
.tr-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
