<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { ZInput, ZSelect, ZButton, ZTag, useToast } from 'ztools-ui'
import { useNativeEngine } from '../composables/useNativeEngine'
import { usePaddleEngine } from '../composables/usePaddleEngine'
import {
  loadBoardSettings,
  saveBoardSettings,
  defaultBoardSettings,
  type BoardSettings
} from '../composables/useBoardSettings'

/**
 * 设置主页：统一卡片网格一排 3 张。
 *  - 引擎卡：微信 OCR + Paddle 离线 OCR。
 *  - 翻译/AI/图床卡：基础信息 + 「配置」按钮，点击弹出 Modal。
 *
 * 凭据敏感字段（百度/有道）走 dbCryptoStorage，非敏感走 dbStorage
 * ——由 preload 的 setTranslateSettings 自动分流。
 */

const { success, error } = useToast()

// ─── OCR 引擎 ────────────────────────────────────────────────────────
const {
  nativeState,
  downloadPercent,
  downloadLoaded,
  downloadTotal,
  nativeError,
  nativeReady,
  isBusy,
  checkNative,
  downloadNative,
  removeNative,
  formatBytes
} = useNativeEngine()

// 状态映射为 ZTag 类型与文案
function engineTag(): {
  type: 'success' | 'primary' | 'warning' | 'danger' | 'info'
  text: string
} {
  switch (nativeState.value) {
    case 'ready':
      return { type: 'success', text: '已安装' }
    case 'downloading':
      return { type: 'primary', text: '下载中' }
    case 'extracting':
      return { type: 'primary', text: '安装中' }
    case 'missing':
      return { type: 'warning', text: '未安装' }
    case 'error':
      return { type: 'danger', text: '错误' }
    default:
      return { type: 'info', text: '检查中' }
  }
}

async function handleDownload(): Promise<void> {
  const ok = await downloadNative()
  if (!ok && nativeError.value) error(nativeError.value)
}

function handleRemove(): void {
  removeNative()
}


// ─── 翻译 / AI / 图床 / Paddle ────────────────────────────────────────
const baidu = ref({ appID: '', appKey: '' })
const youdao = ref({ appKey: '', appSecret: '' })
const microsoft = ref<{ requestMode: 'edge' | 'signature' }>({ requestMode: 'signature' })
const {
  paddleState,
  downloadPercent: paddlePercent,
  downloadLoaded: paddleLoaded,
  downloadTotal: paddleTotal,
  paddleError,
  paddleExe,
  paddleReady,
  isBusy: paddleBusy,
  checkPaddle,
  downloadPaddle,
  removePaddle,
  formatBytes: paddleFormatBytes
} = usePaddleEngine()

function paddleTag(): {
  type: 'success' | 'primary' | 'warning' | 'danger' | 'info'
  text: string
} {
  switch (paddleState.value) {
    case 'ready':
      return { type: 'success', text: '已安装' }
    case 'downloading':
      return { type: 'primary', text: '下载中' }
    case 'extracting':
      return { type: 'primary', text: '安装中' }
    case 'missing':
      return { type: 'warning', text: '未安装' }
    case 'error':
      return { type: 'danger', text: '错误' }
    default:
      return { type: 'info', text: '检查中' }
  }
}

async function handlePaddleDownload(): Promise<void> {
  const ok = await downloadPaddle()
  if (!ok && paddleError.value) error(paddleError.value)
}

function handlePaddleRemove(): void {
  removePaddle()
}

const aiTranslation = ref({ model: '', systemPrompt: '' })
const aiOcr = ref({ model: '', systemPrompt: '' })
const imageHost = ref<ImageHostSettings>({ enabled: true, type: 'img-scdn' })
const boardSettings = ref<BoardSettings>(defaultBoardSettings())
const aiModels = ref<{ id: string; label: string }[]>([])
const aiModelOptions = computed(() => {
  if (!aiModels.value.length) return [{ label: '尚未配置 AI 模型', value: '', disabled: true }]
  return [{ label: '使用 ZTools 默认模型', value: '' }, ...aiModels.value.map((m) => ({ label: m.label, value: m.id }))]
})

const requestModeOptions = [
  { label: 'Signature（X-MT-Signature，推荐）', value: 'signature' },
  { label: 'Edge Token（Authorization Bearer，兜底）', value: 'edge' }
]

const wheelZoomOptions = [
  { label: 'Ctrl / Cmd + 滚轮缩放', value: 'ctrl' },
  { label: '直接滚轮缩放', value: 'plain' }
]

const closeGestureOptions = [
  { label: '双击关闭', value: 'dblclick' },
  { label: '右键关闭', value: 'rightclick' },
  { label: '双击或右键都关闭', value: 'both' }
]

const copyActionOptions = [
  { label: '复制后保留贴图', value: 'copy' },
  { label: '复制并关闭贴图', value: 'copy-close' }
]

const saveActionOptions = [
  { label: '保存后保留贴图', value: 'save' },
  { label: '保存并关闭贴图', value: 'save-close' }
]
const imageHostTypeOptions = [{ label: 'img.scdn.io', value: 'img-scdn' }]

async function loadSettings(): Promise<void> {
  try {
    boardSettings.value = loadBoardSettings()
    const b = window.services.getTranslateSettings('baidu')
    baidu.value = { appID: b.appID || '', appKey: b.appKey || '' }
    const y = window.services.getTranslateSettings('youdao')
    youdao.value = { appKey: y.appKey || '', appSecret: y.appSecret || '' }
    const m = window.services.getTranslateSettings('microsoft')
    microsoft.value = {
      requestMode: (m.requestMode as 'edge' | 'signature') || 'signature'
    }
    
    const at = window.services.getTranslateSettings('ai-translation')
    aiTranslation.value = { model: at.model || '', systemPrompt: at.systemPrompt || '' }
    const ao = window.services.getOcrSettings('ai-ocr')
    aiOcr.value = { model: ao.model || '', systemPrompt: ao.systemPrompt || '' }
    const ih = window.services.getImageHostSettings()
    imageHost.value = {
      enabled: ih.enabled !== false,
      type: (ih.type as ImageHostType) || 'img-scdn'
    }
    try {
      const list = await window.ztools.allAiModels()
      aiModels.value = (list || []).map((m) => ({ id: m.id, label: m.label }))
    } catch (e) {
      console.error('加载宿主 AI 模型列表失败', e)
      aiModels.value = []
    }
  } catch (e) {
    console.error('加载翻译设置失败', e)
  }
}

const saving = ref(false)

function saveGeneralSettings(): void {
  saveBoardSettings({ ...boardSettings.value, buttons: { ...boardSettings.value.buttons } })
  success('通用设置已保存')
}

async function saveProvider(
  p:
    | 'baidu'
    | 'youdao'
    | 'microsoft'
    | 'ai-translation'
    | 'ai-ocr'
    | 'image-host'
): Promise<void> {
  saving.value = true
  try {
    if (p === 'baidu') window.services.setTranslateSettings('baidu', { ...baidu.value })
    else if (p === 'youdao')
      window.services.setTranslateSettings('youdao', { ...youdao.value })
    else if (p === 'microsoft')
      window.services.setTranslateSettings('microsoft', { ...microsoft.value })
    else if (p === 'ai-translation')
      window.services.setTranslateSettings('ai-translation', { ...aiTranslation.value })
    else if (p === 'ai-ocr') window.services.setOcrSettings('ai-ocr', { ...aiOcr.value })
    else if (p === 'image-host')
      window.services.setImageHostSettings({ ...imageHost.value })
    success('已保存')
  } catch (e: any) {
    error(e?.message ? String(e.message) : '保存失败')
  } finally {
    saving.value = false
  }
}

type NavGroup = 'general' | 'ocr' | 'translate' | 'extra'
type NavKey =
  | 'general'
  | 'wechat'
  | 'paddle'
  | 'ai-ocr'
  | 'microsoft'
  | 'google'
  | 'baidu'
  | 'youdao'
  | 'ai-translation'
  | 'image-host'

const navGroup = ref<NavGroup>('ocr')
const navKey = ref<NavKey>('wechat')
const catalog = ref(null as ReturnType<Services['engineCatalog']> | null)
const mirrorMode = ref<'auto' | 'direct'>('auto')

const navGroups: { group: NavGroup; label: string; items: { key: NavKey; label: string }[] }[] = [
  {
    group: 'general',
    label: '通用',
    items: [{ key: 'general', label: '通用设置' }]
  },
  {
    group: 'ocr',
    label: 'OCR',
    items: [
      { key: 'wechat', label: '微信 OCR' },
      { key: 'paddle', label: 'Paddle OCR' },
      { key: 'ai-ocr', label: 'AI 识图' }
    ]
  },
  {
    group: 'translate',
    label: '翻译',
    items: [
      { key: 'microsoft', label: '微软翻译' },
      { key: 'google', label: '谷歌翻译' },
      { key: 'baidu', label: '百度翻译' },
      { key: 'youdao', label: '有道翻译' },
      { key: 'ai-translation', label: 'AI 翻译' }
    ]
  },
  {
    group: 'extra',
    label: '附加',
    items: [{ key: 'image-host', label: '图床' }]
  }
]

function selectNav(group: NavGroup, key: NavKey): void {
  navGroup.value = group
  navKey.value = key
}

function tagOf(state: string): { type: 'success' | 'primary' | 'warning' | 'danger' | 'info'; text: string } {
  switch (state) {
    case 'ready':
      return { type: 'success', text: '已安装' }
    case 'downloading':
      return { type: 'primary', text: '下载中' }
    case 'extracting':
      return { type: 'primary', text: '安装中' }
    case 'missing':
      return { type: 'warning', text: '未安装' }
    case 'error':
      return { type: 'danger', text: '错误' }
    default:
      return { type: 'info', text: '检查中' }
  }
}

const engineHint = computed(() => {
  const c = catalog.value
  if (!c) return { dir: '', files: [] as string[], urls: [] as string[] }
  if (navKey.value === 'wechat')
    return { dir: c.native.dir, files: c.native.files, urls: c.native.url ? [c.native.url] : [] }
  if (navKey.value === 'paddle')
    return { dir: c.paddle.dir, files: c.paddle.files, urls: c.paddle.url ? [c.paddle.url] : [] }
  return { dir: '', files: [], urls: [] }
})

async function runEngineDownload(): Promise<void> {
  const hostIndex = mirrorMode.value === 'direct' ? -1 : undefined
  if (navKey.value === 'wechat') {
    const ok = await downloadNative(hostIndex)
    if (!ok && nativeError.value) error(nativeError.value)
  } else if (navKey.value === 'paddle') {
    const ok = await downloadPaddle(hostIndex)
    if (!ok && paddleError.value) error(paddleError.value)
  }
}

function runEngineRemove(): void {
  if (navKey.value === 'wechat') removeNative()
  else if (navKey.value === 'paddle') removePaddle()
}

function openEngineDir(kind: 'root' | 'native' | 'paddle' | 'cache' = 'native'): void {
  try {
    // 不存在时由 preload mkdir 后再打开
    const dir = window.services.openEngineDir?.(kind) || ''
    if (dir) success('已打开：' + dir)
  } catch (e: any) {
    error(e?.message ? String(e.message) : '无法打开目录')
  }
}

function copyUrl(url: string): void {
  try {
    window.ztools.copyText(url)
    success('已复制下载链接')
  } catch (_) {
    error('复制失败')
  }
}

onMounted(() => {
  checkNative()
  checkPaddle()
  loadSettings()
  try {
    catalog.value = window.services.engineCatalog?.() || null
  } catch (_) {
    catalog.value = null
  }
})
</script>

<template>
  <div class="settings">
    <aside class="nav">
      <div v-for="g in navGroups" :key="g.group" class="nav-block">
        <div class="nav-label">{{ g.label }}</div>
        <button
          v-for="item in g.items"
          :key="item.key"
          class="nav-item"
          :class="{ on: navKey === item.key }"
          @click="selectNav(g.group, item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </aside>

    <main class="detail">
      <template v-if="['wechat','paddle'].includes(navKey)">
        <header class="detail-head">
          <h2>
            {{ navKey === 'wechat' ? '微信 OCR' : 'Paddle OCR' }}
            <ZTag
              size="small"
              :type="tagOf(navKey === 'wechat' ? nativeState : paddleState).type"
            >
              {{ tagOf(navKey === 'wechat' ? nativeState : paddleState).text }}
            </ZTag>
          </h2>
          <p class="muted">
            {{
              navKey === 'wechat'
                ? '离线微信引擎。可下载，或自行把程序文件放入存放目录。'
                : '离线 PaddleOCR-json，无需凭证。请自行对照存放目录放置程序文件。'
            }}
          </p>
        </header>

        <section class="block">
          <h3>存放目录</h3>
          <p class="path">{{ engineHint.dir || '尚未读取' }}</p>
          <div class="row">
            <ZButton
              size="small"
              @click="openEngineDir(navKey === 'wechat' ? 'native' : 'paddle')"
            >
              打开目录
            </ZButton>
          </div>
          <p class="muted">请将下列文件放入该目录：</p>
          <ul class="files">
            <li v-for="f in engineHint.files" :key="f"><code>{{ f }}</code></li>
          </ul>
        </section>

        <section class="block">
          <h3>下载</h3>
          <label class="field-label">地址</label>
          <select v-model="mirrorMode" class="native-select">
            <option value="auto">自动（依次尝试国内镜像）</option>
            <option value="direct">仅官方直链</option>
          </select>
          <div v-for="u in engineHint.urls" :key="u" class="url-row">
            <code class="url">{{ u }}</code>
            <ZButton size="small" @click="copyUrl(u)">复制</ZButton>
          </div>
          <div
            v-if="
              (navKey === 'wechat' && nativeState === 'downloading') ||
              (navKey === 'paddle' && paddleState === 'downloading')
            "
            class="inline-progress"
          >
            <div class="progress-bar">
              <div
                class="progress-fill"
                :style="{
                  width:
                    (navKey === 'wechat' ? downloadPercent : paddlePercent) + '%'
                }"
              />
            </div>
            <p class="muted">
              {{ navKey === 'wechat' ? downloadPercent : paddlePercent }}%
            </p>
          </div>
          <p v-if="navKey === 'wechat' && nativeState === 'error'" class="err">{{ nativeError }}</p>
          <p v-if="navKey === 'paddle' && paddleState === 'error'" class="err">{{ paddleError }}</p>
                    <div class="row">
            <ZButton
              type="primary"
              size="small"
              :disabled="navKey === 'wechat' ? isBusy : paddleBusy"
              @click="runEngineDownload"
            >
              下载
            </ZButton>
            <ZButton
              size="small"
              :disabled="navKey === 'wechat' ? isBusy : paddleBusy"
              @click="runEngineRemove"
            >
              删除
            </ZButton>
          </div>
        </section>
      </template>

      <template v-else-if="navKey === 'general'">
        <header class="detail-head">
          <h2>通用设置</h2>
          <p class="muted">控制贴图下方的按钮、滚轮缩放、关闭手势和复制/保存后的行为。</p>
        </header>

        <section class="block">
          <h3>贴图下方展示按钮</h3>
          <div class="switch-grid">
            <label class="switch-field"><input v-model="boardSettings.buttons.ocr" type="checkbox" /><span>OCR</span></label>
            <label class="switch-field"><input v-model="boardSettings.buttons.translate" type="checkbox" /><span>翻译</span></label>
            <label class="switch-field"><input v-model="boardSettings.buttons.copy" type="checkbox" /><span>复制</span></label>
            <label class="switch-field"><input v-model="boardSettings.buttons.save" type="checkbox" /><span>保存</span></label>
            <label class="switch-field"><input v-model="boardSettings.buttons.doodle" type="checkbox" /><span>涂鸦</span></label>
            <label class="switch-field"><input v-model="boardSettings.buttons.settings" type="checkbox" /><span>设置</span></label>
            <label class="switch-field"><input v-model="boardSettings.buttons.close" type="checkbox" /><span>关闭</span></label>
          </div>
        </section>

        <section class="block">
          <h3>滚轮缩放</h3>
          <ZSelect v-model="boardSettings.wheelZoom" :options="wheelZoomOptions" placeholder="选择缩放方式" />
        </section>

        <section class="block">
          <h3>关闭手势</h3>
          <ZSelect v-model="boardSettings.closeGesture" :options="closeGestureOptions" placeholder="选择关闭方式" />
        </section>

        <section class="block">
          <h3>操作后行为</h3>
          <label class="field-label">复制</label>
          <ZSelect v-model="boardSettings.copyAction" :options="copyActionOptions" placeholder="选择复制行为" />
          <label class="field-label">保存</label>
          <ZSelect v-model="boardSettings.saveAction" :options="saveActionOptions" placeholder="选择保存行为" />
        </section>

        <ZButton type="primary" size="small" :loading="saving" @click="saveGeneralSettings">保存通用设置</ZButton>
      </template>
      <template v-else>
        <header class="detail-head">
          <h2>{{ navGroups.flatMap((g) => g.items).find((i) => i.key === navKey)?.label }}</h2>
        </header>

        <section v-if="navKey === 'microsoft'" class="block">
          <label class="field-label">鉴权方案</label>
          <ZSelect v-model="microsoft.requestMode" :options="requestModeOptions" placeholder="选择鉴权方案" />
          <p class="muted">免密钥。推荐 Signature。</p>
          <ZButton type="primary" size="small" :loading="saving" @click="saveProvider('microsoft')">保存</ZButton>
        </section>
        <section v-else-if="navKey === 'google'" class="block">
          <p class="muted">官方免费接口，无需凭据。国内通常需系统代理。</p>
        </section>
        <section v-else-if="navKey === 'baidu'" class="block">
          <label class="field-label">AppID</label>
          <ZInput v-model="baidu.appID" type="password" placeholder="百度翻译 AppID" clearable />
          <label class="field-label">AppKey</label>
          <ZInput v-model="baidu.appKey" type="password" placeholder="百度翻译 AppKey" clearable />
          <ZButton type="primary" size="small" :loading="saving" @click="saveProvider('baidu')">保存</ZButton>
        </section>
        <section v-else-if="navKey === 'youdao'" class="block">
          <label class="field-label">AppKey</label>
          <ZInput v-model="youdao.appKey" type="password" placeholder="有道 AppKey" clearable />
          <label class="field-label">AppSecret</label>
          <ZInput v-model="youdao.appSecret" type="password" placeholder="有道 AppSecret" clearable />
          <ZButton type="primary" size="small" :loading="saving" @click="saveProvider('youdao')">保存</ZButton>
        </section>
        <section v-else-if="navKey === 'ai-translation'" class="block">
          <label class="field-label">模型</label>
          <ZSelect v-model="aiTranslation.model" :options="aiModelOptions" placeholder="留空走 ZTools 默认" />
          <label class="field-label">系统提示词（{from}/{to}）</label>
          <textarea v-model="aiTranslation.systemPrompt" class="ai-textarea" rows="4" />
          <ZButton type="primary" size="small" :loading="saving" @click="saveProvider('ai-translation')">保存</ZButton>
        </section>
        <section v-else-if="navKey === 'ai-ocr'" class="block">
          <label class="field-label">视觉模型</label>
          <ZSelect v-model="aiOcr.model" :options="aiModelOptions" placeholder="选择支持视觉的模型" />
          <label class="field-label">系统提示词</label>
          <textarea v-model="aiOcr.systemPrompt" class="ai-textarea" rows="4" />
          <ZButton type="primary" size="small" :loading="saving" @click="saveProvider('ai-ocr')">保存</ZButton>
        </section>

        <section v-else-if="navKey === 'image-host'" class="block">
          <p class="muted">可选。仅 AI 识图用。不配则关闭，图片走 base64。</p>
          <label class="switch-field">
            <input v-model="imageHost.enabled" type="checkbox" />
            <span>启用图床上传</span>
          </label>
          <div v-if="imageHost.enabled">
            <label class="field-label">图床</label>
            <ZSelect v-model="imageHost.type" :options="imageHostTypeOptions" placeholder="选择图床" />
          </div>
          <ZButton type="primary" size="small" :loading="saving" @click="saveProvider('image-host')">保存</ZButton>
        </section>
      </template>

    </main>
  </div>
</template>

<style scoped>
.settings {
  height: 100%;
  overflow: hidden;
  display: flex;
  box-sizing: border-box;
}
.nav {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color, #e5e6eb);
  padding: 16px 10px;
  overflow-y: auto;
}
.nav-block {
  margin-bottom: 18px;
}
.nav-label {
  font-size: 11px;
  color: var(--text-secondary, #999);
  padding: 0 8px 6px;
}
.nav-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.nav-item:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}
.nav-item.on {
  background: var(--primary-color, #1976d2);
  color: #fff;
}
.detail {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 40px;
}
.detail-head h2 {
  margin: 0 0 6px;
  font-size: 18px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.muted {
  color: var(--text-secondary, #999);
  font-size: 12px;
  line-height: 1.6;
}
.block {
  margin: 18px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.block h3 {
  margin: 0;
  font-size: 13px;
}
.path,
.url {
  font-size: 12px;
  word-break: break-all;
}
.files {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.field-label {
  font-size: 12px;
  color: var(--text-secondary, #999);
}
.native-select,
.ai-textarea {
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
  padding: 6px 8px;
  font-size: 13px;
  color: var(--z-text-color, #303133);
  background: var(--z-bg-color, #fff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
}
.native-select option {
  background: #fff;
  color: #1f2329;
}
:global(html.dark) .native-select option,
:global(.dark) .native-select option {
  background: #2b2d31;
  color: #e8e8e8;
}
.url-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.err {
  color: #e53935;
  font-size: 12px;
}
.progress-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--border-color, #e5e6eb);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--primary-color, #1976d2);
}
.switch-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.switch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px 16px;
}

/* ZSelect 下拉菜单 teleport 到 body，用全局选择器保证深浅色下文字/背景高对比 */
:global(.select-menu) {
  background: #fff !important;
}
:global(.select-menu .select-item) {
  color: #1f2329 !important;
  background: transparent !important;
}
:global(.select-menu .select-item:hover) {
  background: #f0f2f5 !important;
}
:global(html.dark .select-menu) {
  background: #2b2d31 !important;
}
:global(html.dark .select-menu .select-item) {
  color: #e8e8e8 !important;
}
:global(html.dark .select-menu .select-item:hover) {
  background: #3a3d42 !important;
}
</style>
