<template>
  <div
    ref="codeGeneratorRef"
    class="code-generator"
    :class="{
      'code-generator--tabs-overflow': tabsOverflow,
      'code-generator--tabs-left': canScrollLeft,
      'code-generator--tabs-right': canScrollRight
    }"
  >
    <UiTabs v-model="activeLang" :tabs="languages" class="code-generator__tabs">
      <template #default>
        <div class="code-output">
          <pre class="code-highlight" v-html="highlightedCode"></pre>
        </div>
        <div class="code-actions">
          <UiButton variant="primary" size="sm" @click="copyCode">
            <svg v-if="!copied" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            {{ copied ? t('code.copied') : t('code.copy') }}
          </UiButton>
        </div>
      </template>
    </UiTabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { generateCode, type CodeLanguage } from '../utils/codeGenerator'
import { highlightCodeSync, langMap } from '../utils/codeHighlight'
import type { RequestState } from '../store/request'
import { useEnvironmentStore } from '../store/environments'
import { resolveVariables } from '../utils/variableResolver'
import { normalizeHttpUrl } from '../utils/urlNormalizer'
import UiTabs from './ui/UiTabs.vue'
import UiButton from './ui/UiButton.vue'

const { t } = useI18n()

const envStore = useEnvironmentStore()

const props = defineProps<{
  request: RequestState
}>()

const activeLang = ref<CodeLanguage>('curl')
const copied = ref(false)
const codeGeneratorRef = ref<HTMLElement | null>(null)
const tabsListRef = ref<HTMLElement | null>(null)
const tabsOverflow = ref(false)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

const isWsMethod = computed(() => props.request.method === 'WS')
const isTcpOrUdpMethod = computed(() => ['TCP', 'UDP'].includes(props.request.method))
const isSocketMethod = computed(() => isWsMethod.value || isTcpOrUdpMethod.value)

const languages = computed(() => {
  if (isWsMethod.value) {
    return [
      { key: 'curl' as CodeLanguage, label: t('code.curl') },
      { key: 'wget' as CodeLanguage, label: t('code.wget') },
      { key: 'powershell' as CodeLanguage, label: t('code.powershell') },
      { key: 'php' as CodeLanguage, label: t('code.php') },
      { key: 'ruby' as CodeLanguage, label: t('code.ruby') },
      { key: 'c' as CodeLanguage, label: t('code.c') },
      { key: 'cpp' as CodeLanguage, label: t('code.cpp') },
      { key: 'csharp' as CodeLanguage, label: t('code.csharp') },
      { key: 'kotlin' as CodeLanguage, label: t('code.kotlin') },
      { key: 'rust' as CodeLanguage, label: t('code.rust') },
      { key: 'javascript' as CodeLanguage, label: t('code.javascriptWs') },
      { key: 'typescriptFetch' as CodeLanguage, label: t('code.typescriptWs') },
      { key: 'python' as CodeLanguage, label: t('code.python') },
      { key: 'go' as CodeLanguage, label: t('code.go') },
      { key: 'javaOkHttp' as CodeLanguage, label: t('code.javaWs') }
    ]
  }

  if (isTcpOrUdpMethod.value) {
    return [
      { key: 'curl' as CodeLanguage, label: t('code.curl') },
      { key: 'wget' as CodeLanguage, label: t('code.wget') },
      { key: 'powershell' as CodeLanguage, label: t('code.powershell') },
      { key: 'php' as CodeLanguage, label: t('code.php') },
      { key: 'ruby' as CodeLanguage, label: t('code.ruby') },
      { key: 'c' as CodeLanguage, label: t('code.c') },
      { key: 'cpp' as CodeLanguage, label: t('code.cpp') },
      { key: 'csharp' as CodeLanguage, label: t('code.csharp') },
      { key: 'kotlin' as CodeLanguage, label: t('code.kotlin') },
      { key: 'rust' as CodeLanguage, label: t('code.rust') },
      { key: 'javascript' as CodeLanguage, label: t('code.javascriptNode') },
      { key: 'typescriptFetch' as CodeLanguage, label: t('code.typescriptNode') },
      { key: 'python' as CodeLanguage, label: t('code.python') },
      { key: 'go' as CodeLanguage, label: t('code.go') },
      { key: 'javaOkHttp' as CodeLanguage, label: t('code.javaSocket') }
    ]
  }

  return [
    { key: 'curl' as CodeLanguage, label: t('code.curl') },
    { key: 'wget' as CodeLanguage, label: t('code.wget') },
    { key: 'powershell' as CodeLanguage, label: t('code.powershell') },
    { key: 'php' as CodeLanguage, label: t('code.php') },
    { key: 'ruby' as CodeLanguage, label: t('code.ruby') },
    { key: 'c' as CodeLanguage, label: t('code.c') },
    { key: 'cpp' as CodeLanguage, label: t('code.cpp') },
    { key: 'csharp' as CodeLanguage, label: t('code.csharp') },
    { key: 'kotlin' as CodeLanguage, label: t('code.kotlin') },
    { key: 'rust' as CodeLanguage, label: t('code.rust') },
    { key: 'javascript' as CodeLanguage, label: t('code.javascript') },
    { key: 'javascriptAxios' as CodeLanguage, label: t('code.javascriptAxios') },
    { key: 'typescriptFetch' as CodeLanguage, label: t('code.typescriptFetch') },
    { key: 'python' as CodeLanguage, label: t('code.python') },
    { key: 'go' as CodeLanguage, label: t('code.go') },
    { key: 'javaOkHttp' as CodeLanguage, label: t('code.javaOkHttp') }
  ]
})

const generatedCode = computed(() => {
  const snapshot = JSON.parse(JSON.stringify(props.request)) as RequestState
  const variables = envStore.getVariables()
  if (isSocketMethod.value) {
    snapshot.url = resolveVariables(snapshot.url, variables)
  } else {
    const normalizedUrl = normalizeHttpUrl(snapshot.url, variables)
    snapshot.url = normalizedUrl.ok ? normalizedUrl.url : resolveVariables(snapshot.url, variables)
  }
  snapshot.params = snapshot.params.map((p) => ({
    ...p,
    key: resolveVariables(p.key, variables),
    value: resolveVariables(p.value, variables)
  }))
  snapshot.headers = snapshot.headers.map((h) => ({
    ...h,
    key: resolveVariables(h.key, variables),
    value: resolveVariables(h.value, variables)
  }))
  if (snapshot.body.raw) {
    snapshot.body.raw = resolveVariables(snapshot.body.raw, variables)
  }
  snapshot.body.formData = snapshot.body.formData.map((f) => ({
    ...f,
    key: resolveVariables(f.key, variables),
    value: resolveVariables(f.value, variables)
  }))
  if (snapshot.auth.token) snapshot.auth.token = resolveVariables(snapshot.auth.token, variables)
  if (snapshot.auth.username) snapshot.auth.username = resolveVariables(snapshot.auth.username, variables)
  if (snapshot.auth.password) snapshot.auth.password = resolveVariables(snapshot.auth.password, variables)
  if (snapshot.auth.apiKey) snapshot.auth.apiKey = resolveVariables(snapshot.auth.apiKey, variables)
  if (snapshot.auth.apiKeyHeader) snapshot.auth.apiKeyHeader = resolveVariables(snapshot.auth.apiKeyHeader, variables)
  return generateCode(snapshot, activeLang.value)
})

const highlightedCode = computed(() => {
  const langKey = isSocketMethod.value
    ? (props.request.method === 'WS' ? 'ws' : props.request.method.toLowerCase())
    : activeLang.value
  const code = generatedCode.value
  if (!code) return ''
  
  const lang = langMap[langKey] || 'plaintext'
  return highlightCodeSync(code, lang)
})

async function copyCode() {
  try {
    await navigator.clipboard.writeText(generatedCode.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = generatedCode.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}

function handleTabsWheel(event: WheelEvent) {
  const el = tabsListRef.value
  if (!el) return
  if (el.scrollWidth <= el.clientWidth) return

  const primarilyVertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
  if (!primarilyVertical) return

  event.preventDefault()
  el.scrollLeft += event.deltaY
  updateTabsScrollState()
}

function updateTabsScrollState() {
  const el = tabsListRef.value
  if (!el) {
    tabsOverflow.value = false
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }

  const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
  tabsOverflow.value = maxScrollLeft > 1
  canScrollLeft.value = tabsOverflow.value && el.scrollLeft > 1
  canScrollRight.value = tabsOverflow.value && el.scrollLeft < maxScrollLeft - 1
}

onMounted(async () => {
  await nextTick()
  tabsListRef.value = codeGeneratorRef.value?.querySelector('.ui-tabs__list') || null
  tabsListRef.value?.addEventListener('wheel', handleTabsWheel, { passive: false })
  tabsListRef.value?.addEventListener('scroll', updateTabsScrollState)
  window.addEventListener('resize', updateTabsScrollState)
  updateTabsScrollState()
})

onUnmounted(() => {
  tabsListRef.value?.removeEventListener('wheel', handleTabsWheel)
  tabsListRef.value?.removeEventListener('scroll', updateTabsScrollState)
  window.removeEventListener('resize', updateTabsScrollState)
})

watch(languages, (items) => {
  if (!items.some((item) => item.key === activeLang.value)) {
    activeLang.value = items[0]?.key || 'curl'
  }
}, { immediate: true })
</script>

<style scoped>
.code-generator {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.code-generator::before,
.code-generator::after {
  content: '';
  position: absolute;
  top: 0;
  width: 18px;
  height: 44px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.16s ease;
  z-index: 2;
}

.code-generator::before {
  left: 0;
  background: linear-gradient(to right, var(--bg-surface), rgba(0, 0, 0, 0));
}

.code-generator::after {
  right: 0;
  background: linear-gradient(to left, var(--bg-surface), rgba(0, 0, 0, 0));
}

.code-generator--tabs-overflow.code-generator--tabs-left::before {
  opacity: 1;
}

.code-generator--tabs-overflow.code-generator--tabs-right::after {
  opacity: 1;
}

.code-generator__tabs {
  flex: 1;
  min-height: 0;
}

.code-generator :deep(.ui-tabs) {
  height: 100%;
}

.code-generator :deep(.ui-tabs__list) {
  overflow-x: auto;
  overflow-y: hidden;
  flex-wrap: nowrap;
  scrollbar-width: none;
}

.code-generator :deep(.ui-tabs__list::-webkit-scrollbar) {
  display: none;
}

.code-generator :deep(.ui-tabs__tab) {
  flex: 0 0 auto;
  white-space: nowrap;
}

.code-generator :deep(.ui-tabs__content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 12px;
}

.code-output {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.code-output pre {
  margin: 0;
  padding: var(--space-md);
  background: var(--code-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.code-output pre .hljs-keyword,
.code-output pre .hljs-selector-tag,
.code-output pre .hljs-literal,
.code-output pre .hljs-section,
.code-output pre .hljs-link {
  color: var(--accent-primary);
}

.code-output pre .hljs-string,
.code-output pre .hljs-title,
.code-output pre .hljs-name,
.code-output pre .hljs-type,
.code-output pre .hljs-attribute,
.code-output pre .hljs-symbol,
.code-output pre .hljs-bullet,
.code-output pre .hljs-addition,
.code-output pre .hljs-variable,
.code-output pre .hljs-template-tag,
.code-output pre .hljs-template-variable {
  color: var(--success-color);
}

.code-output pre .hljs-comment,
.code-output pre .hljs-quote,
.code-output pre .hljs-deletion,
.code-output pre .hljs-meta {
  color: var(--text-muted);
}

.code-output pre .hljs-number,
.code-output pre .hljs-regexp,
.code-output pre .hljs-literal,
.code-output pre .hljs-built_in {
  color: var(--warning-color);
}

.code-output pre .hljs-attr,
.code-output pre .hljs-selector-class,
.code-output pre .hljs-selector-id,
.code-output pre .hljs-selector-pseudo {
  color: #a78bfa;
}

.code-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-surface);
}
</style>
