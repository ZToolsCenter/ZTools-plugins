<script setup lang="ts">
import { ref, computed } from 'vue'
import { ZInput, ZSelect, ZButton, useToast } from 'ztools-ui'

/**
 * 翻译测试子页：选源/目标语言 + 输入文本，分别调用四个 provider 并对比结果。
 * 直接调 window.services.translateXxx（不经宿主 provider 调度），
 * 便于在设置页内快速验证凭据 / 鉴权是否生效。
 */

const { success, error } = useToast()

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

const sourceLang = ref('auto')
const targetLang = ref('zh-CN')
const inputText = ref('')

type ProviderName = 'baidu' | 'google' | 'youdao' | 'microsoft'

interface RowResult {
  loading: boolean
  text: string
  error: string
  ms: number
}

const rows = ref<Record<ProviderName, RowResult>>({
  baidu: { loading: false, text: '', error: '', ms: 0 },
  google: { loading: false, text: '', error: '', ms: 0 },
  youdao: { loading: false, text: '', error: '', ms: 0 },
  microsoft: { loading: false, text: '', error: '', ms: 0 }
})

const providerLabels: Record<ProviderName, string> = {
  baidu: '百度翻译',
  google: '谷歌翻译',
  youdao: '有道翻译',
  microsoft: '微软翻译'
}

const hasInput = computed(() => inputText.value.trim().length > 0)

// 各 provider 对应的 services 方法名。注意必须以「方法调用」语法
// window.services.xxx(...) 来执行，保证方法体内的 this 指向 services
// （方法内部会用到 this.getTranslateSettings / this._mapLang 等）。
const providerFnNames: Record<ProviderName, 'translateBaidu' | 'translateGoogle' | 'translateYoudao' | 'translateMicrosoft'> = {
  baidu: 'translateBaidu',
  google: 'translateGoogle',
  youdao: 'translateYoudao',
  microsoft: 'translateMicrosoft'
}

async function runOne(p: ProviderName): Promise<void> {
  if (!hasInput.value) return
  const fnName = providerFnNames[p]
  rows.value[p] = { loading: true, text: '', error: '', ms: 0 }
  const t0 = performance.now()
  try {
    // 用 .call 显式绑定 this 为 window.services，避免解构丢失 this
  const out = await (
    (window.services[fnName] as any) as
      (this: typeof window.services, t: string, f?: string, to?: string) => Promise<{ text: string; detectedFrom?: string }>
  ).call(window.services, inputText.value, sourceLang.value, targetLang.value)
    rows.value[p] = {
      loading: false,
      text: out.text,
      error: '',
      ms: Math.round(performance.now() - t0)
    }
  } catch (e: any) {
    rows.value[p] = {
      loading: false,
      text: '',
      error: e?.message ? String(e.message) : String(e),
      ms: Math.round(performance.now() - t0)
    }
  }
}

async function runAll(): Promise<void> {
  if (!hasInput.value) {
    error('请输入待翻译文本')
    return
  }
  success('开始翻译…')
  await Promise.all([
    runOne('baidu'),
    runOne('google'),
    runOne('youdao'),
    runOne('microsoft')
  ])
}

function copy(text: string): void {
  if (!text) return
  window.ztools.copyText(text)
  success('已复制')
}
</script>

<template>
  <div class="tt-wrap">
    <!-- 语言选择 -->
    <div class="tt-lang">
      <div class="tt-field">
        <label>源语言</label>
        <ZSelect v-model="sourceLang" :options="langOptions" />
      </div>
      <div class="tt-field">
        <label>目标语言</label>
        <ZSelect v-model="targetLang" :options="langOptions" />
      </div>
    </div>

    <!-- 输入 -->
    <div class="tt-field">
      <label>待翻译文本</label>
      <ZInput
        v-model="inputText"
        type="textarea"
        placeholder="输入要翻译的文本…"
        :maxlength="2000"
      />
    </div>

    <div class="tt-actions">
      <ZButton type="primary" :disabled="!hasInput" @click="runAll">全部翻译</ZButton>
    </div>

    <!-- 结果区 -->
    <div class="tt-results">
      <div
        v-for="p in (['baidu','google','youdao','microsoft'] as ProviderName[])"
        :key="p"
        class="tt-row"
      >
        <div class="tt-row-head">
          <span class="tt-row-name">{{ providerLabels[p] }}</span>
          <span v-if="rows[p].ms > 0 && !rows[p].loading" class="tt-row-ms">{{ rows[p].ms }} ms</span>
          <span v-if="rows[p].loading" class="tt-row-loading">翻译中…</span>
          <ZButton
            v-if="rows[p].text"
            size="small"
            @click="copy(rows[p].text)"
          >复制</ZButton>
        </div>
        <div v-if="rows[p].error" class="tt-row-error">{{ rows[p].error }}</div>
        <div v-else-if="rows[p].text" class="tt-row-text">{{ rows[p].text }}</div>
        <div v-else class="tt-row-empty">未测试</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tt-wrap {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tt-lang {
  display: flex;
  gap: 16px;
}
.tt-lang .tt-field {
  flex: 1;
}
.tt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tt-field label {
  font-size: 12px;
  color: var(--text-secondary, #999);
}
.tt-actions {
  display: flex;
  justify-content: flex-end;
}
.tt-results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tt-row {
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 8px;
  padding: 12px 14px;
}
.tt-row-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.tt-row-name {
  font-size: 13px;
  font-weight: 600;
}
.tt-row-ms {
  font-size: 11px;
  color: var(--text-secondary, #999);
}
.tt-row-loading {
  font-size: 12px;
  color: var(--primary-color, #1976d2);
}
.tt-row-error {
  font-size: 13px;
  color: #e53935;
  white-space: pre-wrap;
  word-break: break-all;
}
.tt-row-text {
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tt-row-empty {
  font-size: 13px;
  color: var(--text-secondary, #999);
}
</style>
