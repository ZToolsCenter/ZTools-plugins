<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { LANGUAGES, LANGUAGE_NAMES } from './languages'

const MAX_TEXT_LENGTH = 4000
const COMMAND_TEXTS = new Set(['快翻译', 'Google 翻译'])

const inputText = ref('')
const translatedText = ref('')
const sourceLanguage = ref('auto')
const targetLanguage = ref('en')
const detectedLanguage = ref('')
const isTranslating = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const isLoggedIn = ref(false)
const showSettings = ref(false)
const selectedTargetBeforeSettings = ref('en')
const translateTimer = ref(null)
const requestSequence = ref(0)
const isSpeaking = ref(false)
const speechSequence = ref(0)
const speechTarget = ref('')
const speechStatus = ref('')
let activeAudio = null

const sourceLanguageName = computed(() => {
  if (sourceLanguage.value === 'auto') {
    return detectedLanguage.value ? `检测到：${LANGUAGE_NAMES[detectedLanguage.value] || detectedLanguage.value}` : '自动检测'
  }
  return LANGUAGE_NAMES[sourceLanguage.value] || sourceLanguage.value
})

const targetLanguageName = computed(() => LANGUAGE_NAMES[targetLanguage.value] || targetLanguage.value)
const inputCount = computed(() => inputText.value.length)
const isInputTooLong = computed(() => inputCount.value > MAX_TEXT_LENGTH)
const canTranslate = computed(() => Boolean(inputText.value.trim()) && !isInputTooLong.value && !isTranslating.value)
const hasResult = computed(() => Boolean(translatedText.value))
const bridge = computed(() => window.quickTranslate || null)

/**
 * 从 ZTools 启动参数中提取可翻译文本。
 * @param {{payload?: unknown, type?: string}} param 插件启动参数。
 * @returns {string} 可用的文本内容，没有文本时返回空字符串。
 */
function getEntryText(param) {
  const payload = typeof param?.payload === 'string' ? param.payload.trim() : ''
  if (!payload || COMMAND_TEXTS.has(payload)) return ''
  return payload.slice(0, MAX_TEXT_LENGTH)
}

/**
 * 根据文本内容给出更适合的默认目标语言。
 * @param {string} text 输入文本。
 * @returns {string} 翻译服务使用的目标语言代码。
 */
function inferTargetLanguage(text) {
  // 中文、日文或韩文文本默认翻译为英语，其他语言默认翻译为简体中文。
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(text) ? 'en' : 'zh-CN'
}

/**
 * 在页面顶部显示一条短暂的操作提示。
 * @param {string} message 要展示的提示内容。
 * @returns {void} 无返回值。
 */
function showNotice(message) {
  noticeMessage.value = message
  window.setTimeout(() => {
    noticeMessage.value = ''
  }, 2400)
}

/**
 * 将异常转换为适合用户阅读的错误文本。
 * @param {unknown} error 翻译或本地操作产生的异常。
 * @returns {string} 用户可理解的错误文本。
 */
function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  return '翻译失败，请检查网络后重试'
}

/**
 * 读取本地配置并恢复页面状态。
 * @returns {void} 无返回值。
 */
function loadConfig() {
  // 开发服务器没有 preload 时保留可用的空状态，便于单独预览界面。
  if (!bridge.value) return
  try {
    const config = bridge.value.getConfig()
    isLoggedIn.value = Boolean(config?.isLoggedIn)
    if (config?.targetLanguage) targetLanguage.value = config.targetLanguage
  } catch (error) {
    console.warn('读取翻译配置失败:', error)
  }
}

/**
 * 执行当前输入的翻译请求。
 * @returns {Promise<void>} 翻译完成后结束的 Promise。
 */
async function runTranslation() {
  const text = inputText.value.trim()
  const sequence = ++requestSequence.value
  errorMessage.value = ''
  if (!text) {
    translatedText.value = ''
    detectedLanguage.value = ''
    isTranslating.value = false
    return
  }
  if (isInputTooLong.value) {
    errorMessage.value = `内容过长，最多支持 ${MAX_TEXT_LENGTH} 个字符`
    return
  }
  if (!bridge.value) {
    errorMessage.value = '请在 ZTools 中打开插件后使用翻译功能'
    return
  }

  // 请求开始后锁定按钮状态，旧请求返回时通过序列号丢弃过期结果。
  isTranslating.value = true
  try {
    const result = await bridge.value.translate({
      text,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value,
    })
    if (sequence !== requestSequence.value) return
    translatedText.value = result.text || ''
    detectedLanguage.value = result.detectedSourceLanguage || ''
    isLoggedIn.value = true
  } catch (error) {
    if (sequence === requestSequence.value) {
      translatedText.value = ''
      errorMessage.value = getErrorMessage(error)
      if (errorMessage.value.includes('登录')) isLoggedIn.value = false
    }
  } finally {
    if (sequence === requestSequence.value) isTranslating.value = false
  }
}

/**
 * 安排一次带防抖的翻译请求。
 * @returns {void} 无返回值。
 */
function scheduleTranslation() {
  // 输入变化时取消上一轮请求，减少重复计费和过期结果闪回。
  if (translateTimer.value) window.clearTimeout(translateTimer.value)
  translateTimer.value = window.setTimeout(() => {
    runTranslation()
  }, 450)
}

/**
 * 处理输入框文本变化。
 * @param {string} value 最新输入文本。
 * @returns {void} 无返回值。
 */
function handleInput(value) {
  inputText.value = value.slice(0, MAX_TEXT_LENGTH)
  if (sourceLanguage.value === 'auto' && !detectedLanguage.value) {
    targetLanguage.value = inferTargetLanguage(inputText.value)
  }
  scheduleTranslation()
}

/**
 * 清空输入和翻译结果。
 * @returns {void} 无返回值。
 */
function clearInput() {
  // 清理未完成的防抖任务和当前请求状态，保证下一次输入从干净状态开始。
  if (translateTimer.value) window.clearTimeout(translateTimer.value)
  stopCurrentAudio()
  requestSequence.value += 1
  inputText.value = ''
  translatedText.value = ''
  detectedLanguage.value = ''
  errorMessage.value = ''
  isTranslating.value = false
}

/**
 * 响应源语言选择变化。
 * @returns {void} 无返回值。
 */
function handleSourceChange() {
  detectedLanguage.value = ''
  scheduleTranslation()
}

/**
 * 响应目标语言选择变化。
 * @returns {void} 无返回值。
 */
function handleTargetChange() {
  scheduleTranslation()
}

/**
 * 交换输入语言、目标语言和文本内容。
 * @returns {void} 无返回值。
 */
function swapLanguages() {
  if (sourceLanguage.value === 'auto') {
    sourceLanguage.value = detectedLanguage.value || inferTargetLanguage(inputText.value)
  }
  const oldSource = sourceLanguage.value
  sourceLanguage.value = targetLanguage.value
  targetLanguage.value = oldSource
  const oldInput = inputText.value
  inputText.value = translatedText.value
  translatedText.value = oldInput
  detectedLanguage.value = ''
  scheduleTranslation()
}

/**
 * 停止当前正在播放的 WaveNet 音频。
 * @returns {void} 无返回值。
 */
function stopCurrentAudio() {
  // 先让旧请求失效，再释放音频对象，避免旧音频抢占新朗读。
  speechSequence.value += 1
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.removeAttribute('src')
    activeAudio.load()
  }
  activeAudio = null
  isSpeaking.value = false
  speechTarget.value = ''
  speechStatus.value = ''
}

/**
 * 处理 WaveNet 音频自然播放结束。
 * @returns {void} 无返回值。
 */
function handleAudioEnded() {
  activeAudio = null
  isSpeaking.value = false
  speechTarget.value = ''
  speechStatus.value = ''
}

/**
 * 处理 WaveNet 音频播放失败。
 * @param {Event} event 音频元素产生的错误事件。
 * @returns {void} 无返回值。
 */
function handleAudioError(event) {
  console.warn('WaveNet 音频播放失败:', event)
  activeAudio = null
  isSpeaking.value = false
  speechStatus.value = 'WaveNet 音频播放失败，请检查系统音频输出'
}

/**
 * 调用 Google Cloud Text-to-Speech WaveNet 播放指定文本。
 * @param {string} text 要朗读的文本。
 * @param {string} language 朗读使用的语言代码。
 * @param {'source'|'result'} target 触发朗读的面板位置。
 * @returns {Promise<void>} 音频开始播放或失败后结束的 Promise。
 */
async function speakText(text, language, target) {
  if (!text || !bridge.value?.synthesizeSpeech) {
    speechTarget.value = target
    speechStatus.value = '当前无法使用 Google WaveNet 语音'
    return
  }

  // 新朗读开始前终止旧音频和旧请求，保持同一时间只有一段语音。
  stopCurrentAudio()
  const requestId = speechSequence.value
  isSpeaking.value = true
  errorMessage.value = ''
  speechTarget.value = target
  speechStatus.value = '正在生成 WaveNet 语音…'

  try {
    const result = await bridge.value.synthesizeSpeech({ text, language })
    if (requestId !== speechSequence.value) return
    const audio = new Audio(`data:${result.mimeType};base64,${result.audioContent}`)
    activeAudio = audio
    audio.addEventListener('ended', handleAudioEnded, { once: true })
    audio.addEventListener('error', handleAudioError, { once: true })
    await audio.play()
    if (requestId === speechSequence.value) speechStatus.value = '正在播放 WaveNet 语音…'
  } catch (error) {
    if (requestId !== speechSequence.value) return
    activeAudio = null
    isSpeaking.value = false
    speechStatus.value = getErrorMessage(error)
  }
}

/**
 * 执行译文操作并显示结果提示。
 * @param {'copy'|'copy-hide'|'paste'} action 要执行的动作。
 * @returns {Promise<void>} 操作完成后结束的 Promise。
 */
async function performAction(action) {
  if (!hasResult.value || !bridge.value) return
  try {
    await bridge.value.performResultAction(translatedText.value, action)
    showNotice(action === 'paste' ? '已复制并输入' : action === 'copy-hide' ? '已复制并隐藏' : '已复制')
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  }
}

/**
 * 打开 WaveNet 语音设置弹窗。
 * @returns {void} 无返回值。
 */
function openSettings() {
  selectedTargetBeforeSettings.value = targetLanguage.value
  showSettings.value = true
}

/**
 * 关闭 WaveNet 语音设置弹窗。
 * @returns {void} 无返回值。
 */
function closeSettings() {
  showSettings.value = false
  targetLanguage.value = selectedTargetBeforeSettings.value
}

/**
 * 保存默认目标语言。
 * @returns {Promise<void>} 保存完成后结束的 Promise。
 */
async function saveSettings() {
  if (!bridge.value) {
    errorMessage.value = '请在 ZTools 中打开插件后保存配置'
    return
  }
  try {
    const config = bridge.value.saveConfig({
      targetLanguage: targetLanguage.value,
    })
    isLoggedIn.value = Boolean(config?.isLoggedIn)
    showSettings.value = false
    errorMessage.value = ''
    showNotice('默认目标语言已保存')
    if (inputText.value.trim()) scheduleTranslation()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  }
}

/**
 * 处理来自 ZTools 的插件进入事件。
 * @param {{detail?: {payload?: unknown}}} event 自定义进入事件。
 * @returns {void} 无返回值。
 */
function handlePluginEnter(event) {
  const text = getEntryText(event.detail || {})
  if (!text) return
  inputText.value = text
  targetLanguage.value = inferTargetLanguage(text)
  nextTick(() => scheduleTranslation())
}

/**
 * 初始化插件页面和入口事件监听。
 * @returns {void} 无返回值。
 */
function initialize() {
  loadConfig()
  window.addEventListener('quick-translate-enter', handlePluginEnter)
  if (window.__quickTranslateEntry) {
    handlePluginEnter({ detail: window.__quickTranslateEntry })
    delete window.__quickTranslateEntry
  }
}

/**
 * 释放插件页面创建的定时器和事件监听。
 * @returns {void} 无返回值。
 */
function dispose() {
  if (translateTimer.value) window.clearTimeout(translateTimer.value)
  window.removeEventListener('quick-translate-enter', handlePluginEnter)
  stopCurrentAudio()
}

watch(inputText, () => {
  if (inputText.value.trim()) return
  translatedText.value = ''
  detectedLanguage.value = ''
})

onMounted(initialize)
onUnmounted(dispose)
</script>

<template>
  <main class="translate-app">
    <section class="text-panel text-panel--source">
      <textarea
        :value="inputText"
        maxlength="4000"
        autofocus
        placeholder="输入或粘贴要翻译的文字"
        aria-label="待翻译文本"
        @input="handleInput($event.target.value)"
        @keydown.meta.enter.prevent="runTranslation"
        @keydown.ctrl.enter.prevent="runTranslation"
      ></textarea>
      <div class="panel-footer">
        <button v-if="inputText" class="round-button" :class="{ 'round-button--speaking': isSpeaking && speechTarget === 'source' }" type="button" aria-label="朗读原文" title="WaveNet 朗读原文" :disabled="isSpeaking" @click="speakText(inputText, sourceLanguage === 'auto' ? detectedLanguage || 'zh-CN' : sourceLanguage, 'source')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l4 3V7l-4 3H4Zm11.5-2.5a6 6 0 0 1 0 9M18.5 5a10 10 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div class="source-meta">
          <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
          <span v-else-if="speechTarget === 'source' && speechStatus" class="speech-status">{{ speechStatus }}</span>
          <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
          <span v-else>支持中英文、日文等多种语言</span>
          <span class="char-count" :class="{ 'char-count--danger': isInputTooLong }">{{ inputCount }}/{{ MAX_TEXT_LENGTH }}</span>
        </div>
        <button v-if="inputText" class="round-button" type="button" aria-label="清空原文" title="清空" @click="clearInput">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
    </section>

    <header class="app-header">
      <div class="provider-tabs" role="tablist" aria-label="翻译服务">
        <button class="provider-tab provider-tab--active" type="button" role="tab" aria-selected="true">
          <span class="google-mark" aria-hidden="true">G</span>
          <span>Google 翻译</span>
        </button>
      </div>
      <section class="language-bar" aria-label="语言选择">
        <label class="language-detection">
          <span class="detection-icon" aria-hidden="true">✦</span>
          <span class="sr-only">源语言</span>
          <select v-model="sourceLanguage" aria-label="源语言" @change="handleSourceChange">
            <option v-for="language in LANGUAGES" :key="language.code" :value="language.code">{{ language.name }}</option>
          </select>
          <span v-if="sourceLanguage === 'auto' && detectedLanguage" class="detected-hint">{{ sourceLanguageName }}</span>
          <svg class="select-chevron select-chevron--source" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </label>
        <button class="swap-button" type="button" aria-label="交换语言" title="交换语言" @click="swapLanguages">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-2.5-2.5M17 17H6l2.5 2.5M18 7l-2.5 2.5M6 17l2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <label class="language-select-wrap">
          <span class="sr-only">目标语言</span>
          <select v-model="targetLanguage" aria-label="目标语言" @change="handleTargetChange">
            <option v-for="language in LANGUAGES.filter(item => item.code !== 'auto')" :key="language.code" :value="language.code">{{ language.name }}</option>
          </select>
          <svg class="select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </label>
      </section>
      <button class="icon-button header-settings" type="button" aria-label="打开设置" title="设置" @click="openSettings">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm8.2 3.4c0-.5-.1-1-.2-1.4l1.7-1.3-1.8-3.1-2 .8a8 8 0 0 0-2.4-1.4L15.2 3h-3.6l-.3 2.2c-.9.3-1.7.8-2.4 1.4l-2-.8-1.8 3.1 1.7 1.3c-.1.5-.2.9-.2 1.4s.1 1 .2 1.4l-1.7 1.3 1.8 3.1 2-.8c.7.6 1.5 1.1 2.4 1.4l.3 2.2h3.6l.3-2.2c.9-.3 1.7-.8 2.4-1.4l2 .8 1.8-3.1-1.7-1.3c.1-.4.2-.9.2-1.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      </button>
    </header>

    <section class="text-panel text-panel--result" aria-live="polite">
      <div v-if="isTranslating" class="result-state result-state--loading">
        <span class="spinner" aria-hidden="true"></span>
        <span>正在翻译…</span>
      </div>
      <div v-else-if="!hasResult" class="result-state">
        <span v-if="!isLoggedIn">请先登录 ZTools 账号</span>
        <span v-else>译文会显示在这里</span>
      </div>
      <p v-else class="result-text">{{ translatedText }}</p>
      <div class="result-actions">
        <button class="round-button" :class="{ 'round-button--speaking': isSpeaking && speechTarget === 'result' }" type="button" aria-label="朗读译文" title="WaveNet 朗读译文" :disabled="!hasResult || isSpeaking" @click="speakText(translatedText, targetLanguage, 'result')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l4 3V7l-4 3H4Zm11.5-2.5a6 6 0 0 1 0 9M18.5 5a10 10 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <span v-if="speechTarget === 'result' && speechStatus" class="speech-status speech-status--result">{{ speechStatus }}</span>
        <div class="action-buttons">
          <button type="button" :disabled="!hasResult" @click="performAction('copy')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V5.8A1.8 1.8 0 0 0 14.2 4H5.8A1.8 1.8 0 0 0 4 5.8v8.4A1.8 1.8 0 0 0 5.8 16H8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
            仅复制
          </button>
          <button type="button" :disabled="!hasResult" @click="performAction('copy-hide')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16h14V8l-4-4H5Zm9 0v4h4M9 12h6M9 16h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            复制并隐藏
          </button>
          <button class="action-button--primary" type="button" :disabled="!hasResult" @click="performAction('paste')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L19 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            复制并输入
          </button>
        </div>
      </div>
    </section>

    <div v-if="showSettings" class="modal-backdrop" @click.self="closeSettings">
      <section class="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="settings-card__header">
          <div>
            <p class="eyebrow">QUICK TRANSLATE</p>
            <h2 id="settings-title">翻译设置</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭设置" @click="closeSettings">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="default-language">默认目标语言</label>
          <select id="default-language" v-model="targetLanguage" class="settings-input settings-input--select">
            <option v-for="language in LANGUAGES.filter(item => item.code !== 'auto')" :key="language.code" :value="language.code">{{ language.name }}</option>
          </select>
        </div>
        <div class="settings-card__actions">
          <span class="settings-actions-spacer"></span>
          <button class="secondary-button" type="button" @click="closeSettings">取消</button>
          <button class="primary-button" type="button" @click="saveSettings">保存</button>
        </div>
      </section>
    </div>
  </main>
</template>
