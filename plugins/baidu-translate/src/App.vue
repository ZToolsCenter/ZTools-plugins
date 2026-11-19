<template>
  <div class="app">
    <!-- 顶栏：标题 + 设置入口 -->
    <header class="topbar">
      <img class="topbar-logo" :src="logo" alt="" />
      <h1 class="topbar-title">百度翻译</h1>
      <span class="topbar-spacer"></span>
      <span v-if="!creds" class="badge badge-warn">未配置密钥</span>
      <span v-else class="badge badge-ok">已配置</span>
      <button class="icon-btn" :title="view === 'main' ? '设置' : '返回翻译'" @click="toggleView">
        <span v-if="view === 'main'">⚙</span>
        <span v-else>✕</span>
      </button>
    </header>

    <!-- 设置页 -->
    <SettingsPanel v-if="view === 'settings'" :creds="creds" @saved="onSaved" @cleared="onCleared" />

    <!-- 翻译主页：上语言栏，下左右分栏（左输入 / 右结果） -->
    <main v-else class="main">
      <!-- 顶部：语言方向栏（通栏） -->
      <div class="lang-bar">
        <select v-model="from" class="lang-select" aria-label="源语言">
          <option v-for="l in langs" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
        <button
          class="icon-btn swap-btn"
          title="交换语言"
          :disabled="from === 'auto' || to === 'smart'"
          @click="swap"
        >
          ⇄
        </button>
        <select v-model="to" class="lang-select" aria-label="目标语言">
          <option v-for="l in toOptions" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
      </div>

      <div class="panes">
        <!-- 左栏：原文 -->
        <section class="pane pane-input">
          <div class="input-box">
          <textarea
            ref="inputRef"
            v-model="input"
            class="input-area"
            :placeholder="placeholder"
            @keydown.enter="onEnter"
            @compositionstart="composing = true"
            @compositionend="composing = false"
          ></textarea>
          <div class="input-foot">
            <span class="hint">自动翻译 · Enter 立即 · Shift+Enter 换行</span>
            <span :class="['byte-count', overLimit ? 'over' : '']">
              {{ input.length }} 字 / {{ inputBytes }} 字节
            </span>
          </div>
        </div>

        <div class="input-actions">
          <button class="primary-btn" :disabled="!canTranslate" @click="translate">
            {{ loading ? '翻译中…' : '翻 译' }}
          </button>
          <button class="ghost-btn" :disabled="!input.trim()" title="清空" @click="clearInput">清空</button>
        </div>
      </section>

      <!-- 右栏：译文 -->
      <section class="pane pane-result">
        <div v-if="errorMsg" class="error-card">{{ errorMsg }}</div>

        <div v-else-if="loading && !result" class="empty-tip">翻译中…</div>

        <div v-else-if="result" class="result-card">
          <div class="result-head">
            <span class="detect">
              {{ langName(result.from) || '检测语言' }} → {{ langName(result.to) || toName }}
            </span>
            <span class="head-actions">
              <button class="mini-btn" title="复制全部译文" @click="copyResult">⧉ 复制全部</button>
            </span>
          </div>

          <!-- 词典卡片：单词/词组查询且有词典数据时 -->
          <div v-if="dictView" class="dict">
            <div class="dict-word-row">
              <span class="dict-word">{{ dictView.word || result.items[0].src }}</span>
              <span v-for="t in dictView.tags" :key="t" class="dict-tag">{{ t }}</span>
            </div>
            <div v-if="dictView.phEn || dictView.phAm || dictView.phOther" class="dict-phon">
              <span v-if="dictView.phEn">英 /{{ dictView.phEn }}/</span>
              <span v-if="dictView.phAm">美 /{{ dictView.phAm }}/</span>
              <span v-if="!dictView.phEn && !dictView.phAm">{{ dictView.phOther }}</span>
            </div>

            <div v-if="dictView.parts.length || dictView.means.length" class="dict-section">
              <p v-for="(p, i) in dictView.parts" :key="'p' + i" class="dict-line">
                <span v-if="p.part" class="dict-pos">{{ p.part }}</span>{{ p.means.join('；') }}
              </p>
              <p v-if="!dictView.parts.length" class="dict-line">{{ dictView.means.join('；') }}</p>
            </div>

            <div v-if="dictView.exchanges.length" class="dict-section">
              <div class="dict-exch">
                <span v-for="e in dictView.exchanges" :key="e.name" class="dict-exch-item">
                  <span class="exch-name">{{ e.name }}</span>{{ e.values.join('、') }}
                </span>
              </div>
            </div>

            <div v-if="dictView.enDefs.length" class="dict-section">
              <p class="dict-sec-title">英英释义</p>
              <div v-for="(d, i) in dictView.enDefs" :key="'e' + i" class="en-def">
                <p class="en-def-sense"><span v-if="d.pos" class="dict-pos">{{ d.pos }}</span>{{ d.senses.join('；') }}</p>
                <p v-if="d.examples.length" class="en-def-example">{{ d.examples[0] }}</p>
                <p v-if="d.similar.length" class="en-def-similar">近义词：{{ d.similar.join('、') }}</p>
              </div>
            </div>
          </div>

          <!-- 普通段落卡片：句子或多段翻译 -->
          <div v-else class="segments">
            <div v-for="(it, i) in result.items" :key="i" class="segment">
              <p v-if="it.src" class="seg-src">{{ it.src }}</p>
              <p class="seg-dst">{{ it.dst }}</p>
              <button class="seg-copy" title="复制这条译文" @click="copyText(it.dst)">复制</button>
            </div>
          </div>
        </div>

        <div v-else class="empty-tip">
          <p class="empty-main">在左侧输入文本，自动出译文</p>
        </div>

        <!-- 最近翻译 -->
        <div v-if="history.length" class="history">
          <div class="hist-head">
            <span>最近翻译</span>
            <button class="mini-btn" @click="clearHistory">清空</button>
          </div>
          <ul class="hist-list">
            <li v-for="h in history" :key="h.id" class="hist-item" @click="loadHistory(h)">
              <span class="hist-text">{{ h.text }}</span>
              <span class="hist-meta">
                {{ langName(h.result.from) || '?' }} → {{ langName(h.result.to) || '?' }} · {{ timeOf(h.time) }}
              </span>
            </li>
          </ul>
        </div>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * 百度翻译插件主视图：左右分栏（左原文 / 右译文）。
 * - 智能方向：默认目标语言为"智能"——中文→英文，英文/日/韩等外文→中文；
 * - 输入自动翻译（600ms 防抖，IME 组合期不触发）；
 * - 结果按段显示原文/译文对照，支持逐段与整体复制；
 * - 最近 50 条历史，点击回看重翻。
 *
 * @author yhx
 */
import { computed, onMounted, ref, watch } from 'vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { api, historyStore } from './api'
import {
  LANGS,
  buildDictInfo,
  dictScore,
  errMsgOf,
  isEnglishWord,
  langName,
  lemmaCandidates,
  pickSmartTarget,
  utf8Bytes
} from './baidu'
import type { DictInfo } from './baidu'
import type { CredsInfo, HistoryItem, TranslateResult } from './types'

import logoUrl from './assets/logo.png'
const logo = logoUrl

const view = ref<'main' | 'settings'>('main')
const creds = ref<CredsInfo | null>(null)

const input = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const from = ref('auto')
/** 'smart' = 智能方向（按输入内容自动选中/英文目标） */
const to = ref('smart')
const loading = ref(false)
const result = ref<TranslateResult | null>(null)
const errorMsg = ref('')
const maxBytes = ref(6000)
/** 中文输入法组合期：组合中的回车是选词，不能触发翻译 */
const composing = ref(false)
const history = ref<HistoryItem[]>([])

const langs = LANGS
/** 目标语言：智能 + 全部具体语言（不含 auto） */
const toOptions = [{ code: 'smart', name: '智能（中→英 / 外→中）' }, ...LANGS.filter((l) => l.code !== 'auto')]
const toName = computed(() =>
  to.value === 'smart' ? '智能' : LANGS.find((l) => l.code === to.value)?.name || to.value
)

const inputBytes = computed(() => utf8Bytes(input.value))
const overLimit = computed(() => inputBytes.value > maxBytes.value)

/**
 * 词典视图：仅当结果是"单条"且带词典数据时显示（单词/词组查询）。
 * 句子或多段翻译退回普通段落卡片。
 */
const dictView = computed<DictInfo | null>(() => {
  const items = result.value?.items
  if (!items || items.length !== 1) return null
  return buildDictInfo(items[0].dict)
})

/** 防止慢请求回写旧结果：每次翻译自增，回写前比对 */
let queryToken = 0
const canTranslate = computed(
  () => !!input.value.trim() && !overLimit.value && !loading.value && !!creds.value
)
const placeholder = computed(() =>
  creds.value ? '输入要翻译的文本…' : '请先在设置中填写百度翻译密钥'
)

onMounted(() => {
  creds.value = api.loadCreds()
  maxBytes.value = api.maxQueryBytes()
  history.value = historyStore.load()
  // 宿主进插件事件：在 ZTools 主输入框输入文本后回车，把词带进输入框并直接翻译
  try {
    const zt = (window as unknown as Record<string, any>).ztools
    if (typeof zt?.onPluginEnter === 'function') {
      zt.onPluginEnter((payload: unknown) => {
        const word =
          typeof payload === 'string'
            ? payload
            : typeof (payload as Record<string, unknown>)?.payload === 'string'
              ? (payload as Record<string, string>).payload
              : ''
        if (word) {
          input.value = word
          void translate()
        }
      })
    }
  } catch { /* 无宿主属正常 */ }
  inputRef.value?.focus()
})

/** 输入即自动翻译：600ms 防抖；清空输入时同步清掉结果与错误 */
let debTimer: ReturnType<typeof setTimeout> | undefined
watch(input, (v) => {
  if (debTimer) clearTimeout(debTimer)
  if (!v.trim()) {
    result.value = null
    errorMsg.value = ''
    return
  }
  debTimer = setTimeout(() => {
    if (!composing.value) void translate()
  }, 600)
})

async function translate() {
  // 手动触发前先清掉防抖定时器，避免翻完又被旧定时器翻一次
  if (debTimer) clearTimeout(debTimer)
  const q = input.value.trim()
  if (loading.value) return
  if (!q || overLimit.value) return
  if (!creds.value) {
    // 未配置密钥：不强行跳设置页（自动翻译下会反复打扰），提示语已指路 ⚙
    errorMsg.value = errMsgOf('NO_CONFIG')
    result.value = null
    return
  }
  // 智能方向：按输入内容现算目标语言
  const targetTo = to.value === 'smart' ? pickSmartTarget(q) : to.value

  loading.value = true
  errorMsg.value = ''
  const token = ++queryToken
  try {
    const res = await api.translate(q, from.value, targetTo)
    if (token !== queryToken) return
    if (res.ok) {
      result.value = res
      saveHistory(q, res)
      // 变形词词典补全：claims 这类词按原词形收录的词典往往很薄，查原形择优合并
      void enrichDict(q, from.value, targetTo, token)
    } else {
      result.value = null
      errorMsg.value = errMsgOf(res.code, res.msg)
    }
  } catch {
    result.value = null
    errorMsg.value = errMsgOf('NETWORK')
  } finally {
    loading.value = false
  }
}

/**
 * 词典补全：变形词（claims 等）按原词形收录的词典往往很薄，
 * 查原形词典择优合并。只补 dict 数据，不动译文 dst，过程静默。
 */
async function enrichDict(word: string, fromLang: string, toLang: string, token: number) {
  if (!isEnglishWord(word)) return
  if (token !== queryToken) return

  const first = result.value?.items?.[0]
  if (!first) return
  let bestRaw: unknown = first.dict
  let bestScore = dictScore(buildDictInfo(first.dict))
  if (bestScore >= 4) return

  for (const lemma of lemmaCandidates(word)) {
    if (token !== queryToken) return
    try {
      const r = await api.translate(lemma, fromLang, toLang)
      if (token !== queryToken) return
      if (r.ok && r.items?.length === 1 && r.items[0].dict) {
        const score = dictScore(buildDictInfo(r.items[0].dict))
        if (score > bestScore) {
          bestScore = score
          bestRaw = r.items[0].dict
        }
      }
      if (bestScore >= 4) break
    } catch {
      continue
    }
  }

  if (token !== queryToken) return
  if (bestRaw && result.value?.items?.length === 1 && result.value.items[0].src === word) {
    result.value = {
      ...result.value,
      items: [{ ...result.value.items[0], dict: bestRaw }]
    }
  }
}

/** Enter 立即翻译；输入法组合期的回车是选词，放行不拦截 */
function onEnter(e: KeyboardEvent) {
  if (e.isComposing || composing.value || e.shiftKey) return
  e.preventDefault()
  void translate()
}

function clearInput() {
  input.value = ''
  result.value = null
  errorMsg.value = ''
  inputRef.value?.focus()
}

function toggleView() {
  view.value = view.value === 'main' ? 'settings' : 'main'
}

function swap() {
  if (from.value === 'auto' || to.value === 'smart') return
  const f = from.value
  from.value = to.value
  to.value = f
  // 已有结果时顺带把原文/译文互换，符合"交换方向"的直觉
  if (result.value?.items?.length) {
    const src = result.value.items.map((i) => i.src || i.dst).join('\n')
    const dst = result.value.items.map((i) => i.dst).join('\n')
    input.value = dst
    result.value = { ...result.value, items: src.split('\n').map((s) => ({ src: '', dst: s })) }
    errorMsg.value = ''
  }
}

/* ---------------- 复制 ---------------- */

async function copyText(text: string) {
  const ok = await (api as unknown as { copy(t: string): Promise<boolean> }).copy(text)
  ;(api as unknown as { toast(m: string): void }).toast(ok ? '已复制' : '复制失败')
}

async function copyResult() {
  if (!result.value?.items?.length) return
  await copyText(result.value.items.map((i) => i.dst).join('\n'))
}

/* ---------------- 历史记录 ---------------- */

function saveHistory(text: string, res: TranslateResult) {
  const item: HistoryItem = {
    id: 'h' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    time: Date.now(),
    text,
    result: res
  }
  // 连续同文去重：相同原文提到最前
  history.value = [item, ...history.value.filter((h) => h.text !== text)].slice(0, 50)
  historyStore.save(history.value)
}

/** 点历史：回填原文，方向交给智能判定，让自动翻译重跑一遍 */
function loadHistory(h: HistoryItem) {
  from.value = 'auto'
  if (to.value === 'smart') {
    input.value = h.text // 触发 watch 自动翻译
  } else {
    // 手动指定方向时直接回放当时的结果，不再请求
    input.value = h.text
    result.value = h.result
    errorMsg.value = ''
  }
}

function clearHistory() {
  history.value = []
  historyStore.clear()
}

function timeOf(t: number): string {
  const d = new Date(t)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}-${d.getDate()} ${hm}`
}

/* ---------------- 设置回调 ---------------- */

function onSaved(info: CredsInfo) {
  creds.value = info
  view.value = 'main'
  inputRef.value?.focus()
}

function onCleared() {
  creds.value = null
  result.value = null
}
</script>
