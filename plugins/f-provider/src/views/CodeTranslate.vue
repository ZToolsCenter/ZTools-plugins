<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useToast } from 'ztools-ui'
import { toCandidates, isMostlyAscii, type CaseCandidate } from '../composables/useCaseConvert'

/**
 * 代码翻译子页（独立 feature code-translate 的全屏视图）。
 *
 * 流程：
 *   1. 进入时拿到 initialText（regex 入口选中的文本）。
 *   2. 文本基本是 ASCII（纯英文/代码）→ 跳过翻译，直接走命名风格转换；
 *      否则用 translation provider 翻译到英文（auto→en），失败时用原文兜底。
 *   3. 对译文（或原文）跑 toCandidates，得到 8 种风格候选。
 *   4. 纯键盘操作：↑/↓（或 Tab）切换、Enter 确认粘贴、Esc 取消。
 *
 * 直接调 window.services.translateXxx（不经宿主 provider 调度），
 * 必须以 .call(window.services, ...) 形式调用，保证方法内 this 指向 services
 * （与 Translate.vue / TranslateTest.vue 保持一致的调用约定）。
 */

const props = defineProps<{
  /** 进入时预填的待翻译文本（regex 入口）。 */
  initialText?: string
}>()

const { success, error: errorToast } = useToast()

type ProviderName = 'baidu' | 'google' | 'youdao' | 'microsoft'

const providerFnNames: Record<
  ProviderName,
  'translateBaidu' | 'translateGoogle' | 'translateYoudao' | 'translateMicrosoft'
> = {
  baidu: 'translateBaidu',
  google: 'translateGoogle',
  youdao: 'translateYoudao',
  microsoft: 'translateMicrosoft'
}

// provider 配置状态（用于选默认 provider 时跳过未配置凭据的百度/有道）。
const providerConfigured = ref<Record<ProviderName, boolean>>({
  baidu: false,
  google: true,
  youdao: false,
  microsoft: true
})
function refreshProviderStatus(): void {
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
// 偏好顺序与 Translate.vue 一致：microsoft > google > baidu > youdao
function pickDefaultProvider(): ProviderName {
  const order: ProviderName[] = ['microsoft', 'google', 'baidu', 'youdao']
  return order.find((p) => providerConfigured.value[p]) || 'microsoft'
}

// ─── 视图状态 ──────────────────────────────────────────────────────
const sourceText = ref('')
const translated = ref('') // provider 译文（兜底时 = sourceText）
const phase = ref<'idle' | 'translating' | 'done' | 'fallback'>('idle')
const errorMsg = ref('')
const candidates = ref<CaseCandidate[]>([])
const selectedIndex = ref(0)
const usedFallback = ref(false) // 是否走了「原文兜底」

// 列表项 DOM 引用，用于键盘切换时滚动到可视区
const itemRefs = ref<HTMLDivElement[]>([])

const hasCandidates = computed(() => candidates.value.length > 0)

/**
 * 执行核心流程：必要时翻译，再生成候选。
 * @param text 待处理文本
 */
async function run(text: string): Promise<void> {
  candidates.value = []
  selectedIndex.value = 0
  errorMsg.value = ''
  usedFallback.value = false

  const trimmed = (text || '').trim()
  if (!trimmed) {
    phase.value = 'idle'
    return
  }

  // 纯 ASCII：直接走风格转换，省一次请求。
  if (isMostlyAscii(trimmed)) {
    translated.value = trimmed
    phase.value = 'done'
    candidates.value = toCandidates(trimmed)
    return
  }

  // 含 CJK：翻译到英文
  phase.value = 'translating'
  const provider = pickDefaultProvider()
  const fnName = providerFnNames[provider]
  try {
    const out = await (
      (window.services[fnName] as unknown) as
        (this: typeof window.services, t: string, f?: string, to?: string) => Promise<{ text: string }>
    ).call(window.services, trimmed, 'auto', 'en')
    const en = (out.text || '').trim()
    translated.value = en
    if (!en) {
      // 译文为空：兜底用原文
      throw new Error('译文为空')
    }
    phase.value = 'done'
    candidates.value = toCandidates(en)
  } catch (e: any) {
    // 兜底：用原文做风格转换，保证列表非空
    errorMsg.value = e?.message ? String(e.message) : String(e)
    usedFallback.value = true
    translated.value = trimmed
    phase.value = 'fallback'
    candidates.value = toCandidates(trimmed)
  }
}

// ─── 键盘 / 确认 ───────────────────────────────────────────────────
function moveSelection(delta: number): void {
  if (!hasCandidates.value) return
  const len = candidates.value.length
  // 环形循环：越界回绕到另一端
  selectedIndex.value = (selectedIndex.value + delta + len) % len
  scrollSelectedIntoView()
}

/**
 * 确认当前选中项：隐藏主窗口后把结果粘贴回原光标位置，再退出插件。
 * hideMainWindowPasteText 失败时回退到复制 + Toast 提示。
 */
function confirmSelected(): void {
  const cur = candidates.value[selectedIndex.value]
  if (!cur) return
  try {
    window.ztools.hideMainWindowPasteText(cur.value)
    window.ztools.outPlugin()
  } catch (_) {
    // 粘贴失败兜底：复制到剪贴板
    try {
      window.ztools.copyText(cur.value)
      success('已复制，请手动粘贴')
    } catch (e2) {
      errorToast('粘贴失败且无法复制')
    }
    try {
      window.ztools.outPlugin()
    } catch (_) {
      /* ignore */
    }
  }
}

/** 取消：直接退出插件，不做任何动作。 */
function cancel(): void {
  try {
    window.ztools.outPlugin()
  } catch (_) {
    /* ignore */
  }
}

function scrollSelectedIntoView(): void {
  nextTick(() => {
    const el = itemRefs.value[selectedIndex.value]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  })
}

function onKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowDown':
    case 'Tab':
      e.preventDefault()
      moveSelection(e.shiftKey && e.key === 'Tab' ? -1 : 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      moveSelection(-1)
      break
    case 'Enter':
      e.preventDefault()
      confirmSelected()
      break
    case 'Escape':
      e.preventDefault()
      cancel()
      break
  }
}

// 进入时收到 initialText：触发流程
watch(
  () => props.initialText,
  (text) => {
    sourceText.value = (text || '').trim()
    run(sourceText.value)
  },
  { immediate: true }
)

onMounted(() => {
  refreshProviderStatus()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

function onItemClick(index: number): void {
  selectedIndex.value = index
  confirmSelected()
}
</script>

<template>
  <div class="ct-wrap" tabindex="-1">
    <!-- 顶部：原文 / 译文概览 -->
    <div class="ct-header">
      <div class="ct-text-line">
        <span class="ct-tag">原文</span>
        <span class="ct-text" :title="sourceText">{{ sourceText || '—' }}</span>
      </div>
      <div class="ct-text-line">
        <span class="ct-tag" :class="{ 'ct-tag-fallback': usedFallback }">
          {{ usedFallback ? '原文（翻译失败）' : '译文' }}
        </span>
        <span class="ct-text" :title="translated">{{ phase === 'translating' ? '翻译中…' : translated || '—' }}</span>
        <span v-if="usedFallback && errorMsg" class="ct-err" :title="errorMsg">⚠</span>
      </div>
    </div>

    <!-- 候选列表 -->
    <div class="ct-list">
      <div v-if="phase === 'translating' && !hasCandidates" class="ct-empty">翻译中…</div>
      <div v-else-if="!hasCandidates" class="ct-empty">无候选</div>
      <template v-else>
        <div
          v-for="(c, i) in candidates"
          :key="c.key"
          :ref="(el) => { if (el) itemRefs[i] = el as HTMLDivElement }"
          class="ct-item"
          :class="{ active: i === selectedIndex }"
          @click="onItemClick(i)"
          @mouseenter="selectedIndex = i"
        >
          <span class="ct-index">{{ i + 1 }}</span>
          <span class="ct-value" :title="c.value">{{ c.value }}</span>
          <span class="ct-style">{{ c.label }}</span>
        </div>
      </template>
    </div>

    <!-- 底部提示 -->
    <div class="ct-footer">
      <span class="ct-hint"><kbd>↑</kbd><kbd>↓</kbd> 切换</span>
      <span class="ct-hint"><kbd>Enter</kbd> 粘贴</span>
      <span class="ct-hint"><kbd>Esc</kbd> 取消</span>
    </div>
  </div>
</template>

<style scoped>
.ct-wrap {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  padding: 16px 20px;
  gap: 12px;
  outline: none;
}

/* ── 顶部概览 ── */
.ct-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 10px;
  background: var(--hover-bg, rgba(0, 0, 0, 0.02));
}
.ct-text-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ct-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #999);
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 4px;
  padding: 1px 6px;
}
.ct-tag-fallback {
  color: #e53935;
  border-color: color-mix(in srgb, #e53935, transparent 50%);
}
.ct-text {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ct-err {
  flex-shrink: 0;
  color: #e53935;
  font-size: 13px;
  cursor: help;
}

/* ── 候选列表 ── */
.ct-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}
.ct-empty {
  padding: 24px;
  text-align: center;
  font-size: 14px;
  color: var(--text-secondary, #999);
}
.ct-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  background: var(--card-bg, transparent);
}
.ct-item:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}
.ct-item.active {
  background: var(--primary-color, #1976d2);
  border-color: var(--primary-color, #1976d2);
  color: #fff;
}
.ct-index {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  background: var(--hover-bg, rgba(0, 0, 0, 0.06));
  color: var(--text-secondary, #999);
}
.ct-item.active .ct-index {
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
}
.ct-value {
  flex: 1;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ct-style {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary, #999);
  white-space: nowrap;
}
.ct-item.active .ct-style {
  color: rgba(255, 255, 255, 0.85);
}

/* ── 底部提示 ── */
.ct-footer {
  display: flex;
  align-items: center;
  gap: 18px;
  padding-top: 4px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}
.ct-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
kbd {
  display: inline-block;
  min-width: 18px;
  padding: 1px 5px;
  font-size: 11px;
  font-family: inherit;
  text-align: center;
  border: 1px solid var(--border-color, #e5e6eb);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--card-bg, transparent);
  color: inherit;
}
</style>
