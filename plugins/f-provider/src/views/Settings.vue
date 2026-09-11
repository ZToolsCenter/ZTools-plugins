<script setup lang="ts">
import { onMounted, ref, reactive, computed } from 'vue'
import { ZInput, ZSelect, ZButton, ZTag, ZModal, useToast } from 'ztools-ui'
import { useNativeEngine } from '../composables/useNativeEngine'
import { useLatexEngine } from '../composables/useLatexEngine'
import ProviderLogo from '../components/ProviderLogo.vue'
import wechatLogo from '../assets/wechat.png'

/**
 * 设置主页（合并原「引擎管理」+「翻译设置」）：统一卡片网格。
 *  - 每张卡片只展示基础信息（头像 / 名称 / 状态 / 简述），尺寸一致，一排 3 张。
 *  - 引擎卡：状态标签 + 进度/错误内联；操作（下载/重下/删除）集中在卡片底部。
 *  - 翻译服务卡（百度/谷歌/有道/微软）：基础信息 + 「配置」按钮，点击弹出 Modal 改凭据。
 *
 * 凭据敏感字段（百度/有道）走 dbCryptoStorage，非敏感（微软 requestMode）走 dbStorage
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
  nativeVersion,
  nativeMissing,
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

// ─── LaTeX 公式识别引擎 ────────────────────────────────────────────────
// 与 OCR 引擎完全独立的下载/状态机：复用 useLatexEngine（结构与 useNativeEngine 一致）。
// 由于两个 composable 都导出 downloadPercent / downloadLoaded / downloadTotal /
// isBusy / formatBytes，这里对 LaTeX 的同名状态做别名解构，避免与 OCR 冲突。
const {
  latexState,
  downloadPercent: latexPercent,
  downloadLoaded: latexLoaded,
  downloadTotal: latexTotal,
  latexError,
  latexVersion,
  latexMissing,
  latexReady,
  isBusy: latexBusy,
  checkLatex,
  downloadLatex,
  removeLatex,
  formatBytes: latexFormatBytes
} = useLatexEngine()

// LaTeX 状态映射为 ZTag 类型与文案（与 engineTag 同构）
function latexTag(): {
  type: 'success' | 'primary' | 'warning' | 'danger' | 'info'
  text: string
} {
  switch (latexState.value) {
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

async function handleLatexDownload(): Promise<void> {
  const ok = await downloadLatex()
  if (!ok && latexError.value) error(latexError.value)
}

function handleLatexRemove(): void {
  removeLatex()
}

// ─── 翻译设置 ────────────────────────────────────────────────────────
const baidu = ref({ appID: '', appKey: '' })
const youdao = ref({ appKey: '', appSecret: '' })
const microsoft = ref<{ requestMode: 'edge' | 'signature' }>({ requestMode: 'edge' })

// AI 翻译 / AI OCR：复用宿主已配置的 AI 模型，此处仅存模型选择与 prompt 模板（不存密钥）。
const aiTranslation = ref({ model: '', systemPrompt: '' })
const aiOcr = ref({ model: '', systemPrompt: '' })
const aiLatexOcr = ref({ model: '', systemPrompt: '' })
// 图床设置（ai-ocr / ai-latex-ocr 共用）：默认开启，关闭则 AI 识图回退 base64 直传。
const imageHost = ref<ImageHostSettings>({ enabled: true, type: 'img-scdn' })
// 宿主已配置的 AI 模型列表（ztools.allAiModels()），用于模型下拉。
const aiModels = ref<{ id: string; label: string }[]>([])
// 模型下拉选项：未配置模型时只给一个禁用占位，避免误选空值。
const aiModelOptions = computed(() => {
  if (!aiModels.value.length) return [{ label: '尚未配置 AI 模型', value: '', disabled: true }]
  return [{ label: '使用 ZTools 默认模型', value: '' }, ...aiModels.value.map((m) => ({ label: m.label, value: m.id }))]
})

const requestModeOptions = [
  { label: 'Signature（X-MT-Signature，推荐）', value: 'signature' },
  { label: 'Edge Token（Authorization Bearer，兜底）', value: 'edge' }
]

// 图床类型下拉：后续新增图床在此加一项 + ImageHostType 联合类型扩一项。
const imageHostTypeOptions = [
  { label: 'img.scdn.io', value: 'img-scdn' }
]

async function loadSettings(): Promise<void> {
  try {
    const b = window.services.getTranslateSettings('baidu')
    baidu.value = { appID: b.appID || '', appKey: b.appKey || '' }
    const y = window.services.getTranslateSettings('youdao')
    youdao.value = { appKey: y.appKey || '', appSecret: y.appSecret || '' }
    const m = window.services.getTranslateSettings('microsoft')
    microsoft.value = {
      requestMode: (m.requestMode as 'edge' | 'signature') || 'edge'
    }
    // AI 翻译 / AI OCR 配置回填
    const at = window.services.getTranslateSettings('ai-translation')
    aiTranslation.value = { model: at.model || '', systemPrompt: at.systemPrompt || '' }
    const ao = window.services.getOcrSettings('ai-ocr')
    aiOcr.value = { model: ao.model || '', systemPrompt: ao.systemPrompt || '' }
    const alo = window.services.getOcrSettings('ai-latex-ocr')
    aiLatexOcr.value = { model: alo.model || '', systemPrompt: alo.systemPrompt || '' }
    // 图床配置回填（enabled 默认 true：旧数据无该 key 时兜底为开启）
    const ih = window.services.getImageHostSettings()
    imageHost.value = {
      enabled: ih.enabled !== false,
      type: (ih.type as ImageHostType) || 'img-scdn'
    }
    // 拉取宿主已配置的 AI 模型列表，用于模型下拉
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

// 逐卡保存的 loading 态
const saving = ref(false)

async function saveProvider(
  p:
    | 'baidu'
    | 'youdao'
    | 'microsoft'
    | 'ai-translation'
    | 'ai-ocr'
    | 'ai-latex-ocr'
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
    else if (p === 'ai-latex-ocr')
      window.services.setOcrSettings('ai-latex-ocr', { ...aiLatexOcr.value })
    else if (p === 'image-host')
      window.services.setImageHostSettings({ ...imageHost.value })
    success('已保存')
    closeModal()
  } catch (e: any) {
    error(e?.message ? String(e.message) : '保存失败')
  } finally {
    saving.value = false
  }
}

// ─── Provider 元数据 ─────────────────────────────────────────────────
type ProviderKey =
  | 'baidu'
  | 'google'
  | 'youdao'
  | 'microsoft'
  | 'ai-translation'
  | 'ai-ocr'
  | 'ai-latex-ocr'
  | 'image-host'

interface ProviderMeta {
  key: ProviderKey
  name: string
  desc: string
  docsUrl?: string
}

const providers: ProviderMeta[] = [
  {
    key: 'baidu',
    name: '百度翻译',
    desc: '通用文本翻译，需配置 AppID 与 AppKey。',
    docsUrl: 'https://fanyi-api.baidu.com/'
  },
  {
    key: 'google',
    name: '谷歌翻译',
    desc: '官方免费接口，免授权开箱即用，国内需系统代理。'
  },
  {
    key: 'youdao',
    name: '有道翻译',
    desc: '有道智云，需配置 AppKey 与 AppSecret。',
    docsUrl: 'https://ai.youdao.com/'
  },
  {
    key: 'microsoft',
    name: '微软翻译',
    desc: '免授权，可选 Signature 或 Edge Token 鉴权方案。'
  },
  {
    key: 'ai-translation',
    name: 'AI 翻译',
    desc: '基于大语言模型翻译，复用 ZTools 已配置的 AI 模型，无需密钥。'
  },
  {
    key: 'ai-ocr',
    name: 'AI 识图',
    desc: '基于视觉模型识别图片文字，需选择支持视觉的模型。'
  },
  {
    key: 'ai-latex-ocr',
    name: 'AI 公式识别',
    desc: '基于视觉模型识别数学公式为 LaTeX，需选择支持视觉的模型。'
  },
  {
    key: 'image-host',
    name: '图床',
    desc: 'AI 识图/公式识别的图片来源：先上传图床再发 AI（省 token、防截断），默认开启，失败自动回退直传。',
    docsUrl: 'https://img.scdn.io/api_docs.php'
  }
]

// 各 provider 是否已配置（用于状态标签）
const configured = computed(
  () =>
    ({
      baidu: !!(baidu.value.appID && baidu.value.appKey),
      google: true,
      youdao: !!(youdao.value.appKey && youdao.value.appSecret),
      microsoft: true,
      'ai-translation': true, // 模型可留空走宿主默认，始终视为可用
      'ai-ocr': !!aiOcr.value.model,
      'ai-latex-ocr': !!aiLatexOcr.value.model,
      'image-host': imageHost.value.enabled
    }) as Record<ProviderKey, boolean>
)

function providerStatus(
  p: ProviderMeta
): { type: 'success' | 'warning'; text: string } {
  if (p.key === 'google' || p.key === 'microsoft' || p.key === 'ai-translation')
    return { type: 'success', text: '已安装' }
  if (p.key === 'image-host')
    return imageHost.value.enabled
      ? { type: 'success', text: '已启用' }
      : { type: 'warning', text: '已停用' }
  return configured.value[p.key]
    ? { type: 'success', text: '已安装' }
    : { type: 'warning', text: '待配置' }
}

// ─── 弹窗 ────────────────────────────────────────────────────────────
const modalVisible = ref(false)
const activeProvider = ref<ProviderMeta | null>(null)

function openConfig(p: ProviderMeta): void {
  activeProvider.value = p
  modalVisible.value = true
}

function closeModal(): void {
  modalVisible.value = false
}

onMounted(() => {
  checkNative()
  checkLatex()
  loadSettings()
})
</script>

<template>
  <div class="settings">
    <!-- 页头 -->
    <header class="page-head">
      <div>
        <h2 class="page-title">设置</h2>
      </div>
    </header>

    <!-- 卡片网格：引擎 + 翻译服务，统一尺寸，一排 3 张 -->
    <div class="card-grid">
      <!-- OCR 引擎卡 -->
      <section class="card">
        <header class="card-head">
          <div class="card-avatar" :class="['s-' + nativeState]">
            <img class="ocr-logo" :src="wechatLogo" alt="微信 OCR" draggable="false" />
            <span v-if="nativeState === 'checking'" class="avatar-spin"></span>
          </div>
          <div class="card-title">
            <span class="title-name">OCR 引擎</span>
            <ZTag :type="engineTag().type" size="small">{{ engineTag().text }}</ZTag>
          </div>
        </header>

        <div class="card-body">
          <p class="card-desc">
            微信内置 OCR 引擎，约 80MB，首次使用需下载。
          </p>

          <!-- 进度 / 错误 / 缺失 / 就绪：内联在卡片体内，保证卡片尺寸稳定 -->
          <div v-if="nativeState === 'downloading'" class="inline-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: downloadPercent + '%' }"></div>
            </div>
            <div class="progress-meta">
              <span>{{ downloadPercent }}%</span>
              <span>{{ formatBytes(downloadLoaded)
              }}<template v-if="downloadTotal"> / {{ formatBytes(downloadTotal) }}</template></span>
            </div>
          </div>
          <div v-else-if="nativeState === 'extracting'" class="inline-progress">
            <div class="progress-bar">
              <div class="progress-fill progress-indeterminate"></div>
            </div>
            <div class="progress-meta"><span>正在安装，请稍候</span></div>
          </div>
          <div v-else-if="nativeState === 'error'" class="inline-error">
            下载失败：{{ nativeError }}
          </div>
        </div>

        <footer class="card-foot">
          <span></span>
          <span class="foot-actions">
            <template v-if="nativeState === 'missing'">
              <ZButton type="primary" size="small" :disabled="isBusy" @click="handleDownload">
                下载
              </ZButton>
            </template>
            <template v-else-if="nativeState === 'error'">
              <ZButton type="primary" size="small" :disabled="isBusy" @click="handleDownload">
                重试
              </ZButton>
            </template>
            <template v-else-if="nativeReady">
              <ZButton size="small" :disabled="isBusy" @click="handleDownload">重新下载</ZButton>
              <ZButton size="small" :disabled="isBusy" @click="handleRemove">删除</ZButton>
            </template>
            <template v-else>
              <ZButton size="small" disabled>{{ engineTag().text }}…</ZButton>
            </template>
          </span>
        </footer>
      </section>

      <!-- LaTeX 公式识别引擎卡 -->
      <section class="card">
        <header class="card-head">
          <div class="card-avatar" :class="['s-' + latexState]">
            <svg
              class="latex-logo"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M5 4h3l2 4-1.5 1.5C9.5 12 11 13.5 13 14.5l1.5-1.5 4 2v3a1 1 0 0 1-1 1c-5 0-12-7-12-12a1 1 0 0 1 1-1Z"
              />
            </svg>
            <span v-if="latexState === 'checking'" class="avatar-spin"></span>
          </div>
          <div class="card-title">
            <span class="title-name">公式识别</span>
            <ZTag :type="latexTag().type" size="small">{{ latexTag().text }}</ZTag>
          </div>
        </header>

        <div class="card-body">
          <p class="card-desc">
            本地 ONNX 神经网络引擎，离线识别数学公式为 LaTeX，首次使用需下载。
          </p>

          <!-- 进度 / 错误：内联在卡片体内，与 OCR 卡保持一致 -->
          <div v-if="latexState === 'downloading'" class="inline-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: latexPercent + '%' }"></div>
            </div>
            <div class="progress-meta">
              <span>{{ latexPercent }}%</span>
              <span>{{ latexFormatBytes(latexLoaded)
              }}<template v-if="latexTotal"> / {{ latexFormatBytes(latexTotal) }}</template></span>
            </div>
          </div>
          <div v-else-if="latexState === 'extracting'" class="inline-progress">
            <div class="progress-bar">
              <div class="progress-fill progress-indeterminate"></div>
            </div>
            <div class="progress-meta"><span>正在安装，请稍候</span></div>
          </div>
          <div v-else-if="latexState === 'error'" class="inline-error">
            下载失败：{{ latexError }}
          </div>
        </div>

        <footer class="card-foot">
          <span></span>
          <span class="foot-actions">
            <template v-if="latexState === 'missing'">
              <ZButton type="primary" size="small" :disabled="latexBusy" @click="handleLatexDownload">
                下载
              </ZButton>
            </template>
            <template v-else-if="latexState === 'error'">
              <ZButton type="primary" size="small" :disabled="latexBusy" @click="handleLatexDownload">
                重试
              </ZButton>
            </template>
            <template v-else-if="latexReady">
              <ZButton size="small" :disabled="latexBusy" @click="handleLatexDownload">重新下载</ZButton>
              <ZButton size="small" :disabled="latexBusy" @click="handleLatexRemove">删除</ZButton>
            </template>
            <template v-else>
              <ZButton size="small" disabled>{{ latexTag().text }}…</ZButton>
            </template>
          </span>
        </footer>
      </section>

      <!-- 翻译服务卡 -->
      <section
        v-for="p in providers"
        :key="p.key"
        class="card"
      >
        <header class="card-head">
          <div class="card-avatar">
            <ProviderLogo :name="p.key" />
          </div>
          <div class="card-title">
            <span class="title-name">{{ p.name }}</span>
            <ZTag :type="providerStatus(p).type" size="small">
              {{ providerStatus(p).text }}
            </ZTag>
          </div>
        </header>

        <div class="card-body">
          <p class="card-desc">{{ p.desc }}</p>
          <div v-if="p.key === 'baidu' && configured.baidu" class="inline-ready">凭据已配置</div>
          <div v-else-if="p.key === 'youdao' && configured.youdao" class="inline-ready">凭据已配置</div>
          <div v-else-if="p.key === 'google'" class="inline-hint">免授权开箱即用</div>
          <div v-else-if="p.key === 'microsoft'" class="inline-hint">
            当前：{{ microsoft.requestMode === 'signature' ? 'Signature' : 'Edge Token' }}
          </div>
        </div>

        <footer class="card-foot">
          <a
            v-if="p.docsUrl"
            class="docs-link"
            :href="p.docsUrl"
            target="_blank"
            rel="noopener"
          >
            申请凭据 ↗
          </a>
          <span v-else></span>
          <ZButton size="small" @click="openConfig(p)">配置</ZButton>
        </footer>
      </section>
    </div>

    <!-- 配置弹窗 -->
    <ZModal v-model:show="modalVisible" preset="card" :to="false">
      <template v-if="activeProvider">
        <header class="modal-head" data-modal-drag-handle>
          <div class="card-avatar sm">
            <ProviderLogo :name="activeProvider.key" />
          </div>
          <h3 class="modal-title">{{ activeProvider.name }} · 配置</h3>
        </header>

        <div class="modal-body">
          <!-- 百度 -->
          <template v-if="activeProvider.key === 'baidu'">
            <div class="field">
              <label>AppID</label>
              <ZInput v-model="baidu.appID" type="password" placeholder="百度翻译 AppID" clearable />
            </div>
            <div class="field">
              <label>AppKey</label>
              <ZInput v-model="baidu.appKey" type="password" placeholder="百度翻译 AppKey / 密钥" clearable />
            </div>
            <p class="field-hint">
              申请地址：
              <a href="https://fanyi-api.baidu.com/" target="_blank" rel="noopener">https://fanyi-api.baidu.com/</a>
            </p>
          </template>

          <!-- 有道 -->
          <template v-else-if="activeProvider.key === 'youdao'">
            <div class="field">
              <label>AppKey</label>
              <ZInput v-model="youdao.appKey" type="password" placeholder="有道智云 AppKey" clearable />
            </div>
            <div class="field">
              <label>AppSecret</label>
              <ZInput v-model="youdao.appSecret" type="password" placeholder="有道智云 AppSecret" clearable />
            </div>
            <p class="field-hint">
              申请地址：
              <a href="https://ai.youdao.com/" target="_blank" rel="noopener">https://ai.youdao.com/</a>
            </p>
          </template>

          <!-- 微软 -->
          <template v-else-if="activeProvider.key === 'microsoft'">
            <div class="field">
              <label>鉴权方案</label>
              <ZSelect
                v-model="microsoft.requestMode"
                :options="requestModeOptions"
                placeholder="选择鉴权方案"
              />
            </div>
            <p class="field-hint">
              Signature：MSTranslatorAndroidApp + HMACSHA256 生成 X-MT-Signature，走 cognitive 端点（推荐，不依赖浏览器 UA）。
            </p>
            <p class="field-hint">
              Edge Token：调用 edge.microsoft.com 取 Bearer，走 api-edge 端点（兜底，会按 Chrome UA 风控）。
            </p>
            <p class="field-hint">两种方案均无需用户提供密钥。</p>
          </template>

          <!-- 谷歌 -->
          <template v-else-if="activeProvider.key === 'google'">
            <p class="field-hint">
              使用 Google 官方免费接口 <code>translate.googleapis.com</code>，无需凭据。
            </p>
            <p class="field-hint">
              该域名为 Google 官方地址，国内网络通常无法直连，需走系统代理；如不可用可改用其他 provider。
            </p>
          </template>

          <!-- AI 翻译（走宿主 ztools.ai，复用宿主已配置的 AI 模型） -->
          <template v-else-if="activeProvider.key === 'ai-translation'">
            <div class="field">
              <label>模型</label>
              <ZSelect
                v-model="aiTranslation.model"
                :options="aiModelOptions"
                placeholder="选择模型（留空走 ZTools 默认）"
              />
            </div>
            <div class="field">
              <label>系统提示词（支持 {from}/{to} 占位替换）</label>
              <textarea
                v-model="aiTranslation.systemPrompt"
                class="ai-textarea"
                rows="4"
                placeholder="如：你是一个专业翻译。将用户输入翻译成 {to}，只输出译文，不要解释。"
              ></textarea>
            </div>
            <p class="field-hint">无需密钥：复用 ZTools「AI 模型」中已配置的模型与 API Key。</p>
          </template>

          <!-- AI 识图（走宿主 ztools.ai，需支持视觉的模型） -->
          <template v-else-if="activeProvider.key === 'ai-ocr'">
            <div class="field">
              <label>模型（须选支持视觉的模型）</label>
              <ZSelect
                v-model="aiOcr.model"
                :options="aiModelOptions"
                placeholder="选择支持视觉的模型"
              />
            </div>
            <div class="field">
              <label>系统提示词</label>
              <textarea
                v-model="aiOcr.systemPrompt"
                class="ai-textarea"
                rows="4"
                placeholder="如：识别图片中的所有文字，按原文逐行输出，只输出文字。"
              ></textarea>
            </div>
            <p class="field-hint">纯文本模型无法识图，请选择如 GPT-4o 等支持视觉输入的模型。</p>
          </template>

          <!-- AI 公式识别（走宿主 ztools.ai，需支持视觉的模型） -->
          <template v-else-if="activeProvider.key === 'ai-latex-ocr'">
            <div class="field">
              <label>模型（须选支持视觉的模型）</label>
              <ZSelect
                v-model="aiLatexOcr.model"
                :options="aiModelOptions"
                placeholder="选择支持视觉的模型"
              />
            </div>
            <div class="field">
              <label>系统提示词</label>
              <textarea
                v-model="aiLatexOcr.systemPrompt"
                class="ai-textarea"
                rows="4"
                placeholder="如：识别图片中的数学公式并输出对应的 LaTeX 源码，只输出 LaTeX 代码。"
              ></textarea>
            </div>
            <p class="field-hint">提示词应要求只输出 LaTeX 源码、不加 $ 包裹；AI 误加的围栏会被自动剔除。</p>
          </template>

          <!-- 图床（ai-ocr / ai-latex-ocr 共用的图片上传通道） -->
          <template v-else-if="activeProvider.key === 'image-host'">
            <div class="field">
              <label class="switch-field">
                <input type="checkbox" v-model="imageHost.enabled" />
                <span>启用图床上传</span>
              </label>
              <p class="field-hint">关闭后 AI 识图改用 base64 直传 vision 模型（大图易超 token / 触发截断）。</p>
            </div>
            <div class="field" v-if="imageHost.enabled">
              <label>图床类型</label>
              <ZSelect
                v-model="imageHost.type"
                :options="imageHostTypeOptions"
                placeholder="选择图床"
              />
              <p class="field-hint">当前 img.scdn.io 走 Cloudflare R2 存储（storage_destination=r2），免鉴权。上传失败或被限流（429）时自动回退 base64 直传。</p>
            </div>
          </template>
        </div>

        <footer class="modal-foot">
          <ZButton size="small" @click="closeModal">取消</ZButton>
          <ZButton
            v-if="activeProvider.key !== 'google'"
            type="primary"
            size="small"
            :loading="saving"
            @click="saveProvider(activeProvider.key as 'baidu' | 'youdao' | 'microsoft' | 'ai-translation' | 'ai-ocr' | 'ai-latex-ocr' | 'image-host')"
          >
            保存
          </ZButton>
        </footer>
      </template>
    </ZModal>
  </div>
</template>

<style scoped>
.settings {
  padding: 24px 28px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-sizing: border-box;
}

/* ── 页头 ── */
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

code {
  background: var(--hover-bg, rgba(0, 0, 0, 0.06));
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}

/* ── 卡片网格：一排 3 张，统一尺寸 ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  min-height: 168px;
  box-sizing: border-box;
  border: 1px solid var(--border-color, #e5e6eb);
  border-radius: 14px;
  background: var(--card-bg, transparent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}

.card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--primary-color, #1976d2), transparent 50%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

/* ── 卡片头部 ── */
.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-avatar {
  position: relative;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.card-avatar.s-missing,
.card-avatar.s-error {
  background: color-mix(in srgb, #e53935, transparent 90%);
}

.card-avatar.s-ready {
  background: color-mix(in srgb, #4caf50, transparent 90%);
}

.card-avatar.sm {
  width: 32px;
  height: 32px;
}

.ocr-logo {
  width: 26px;
  height: 26px;
  object-fit: contain;
  border-radius: 6px;
}

.latex-logo {
  width: 24px;
  height: 24px;
  color: var(--text-secondary, #666);
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.title-name {
  font-size: 14px;
  font-weight: 600;
}

.avatar-spin {
  position: absolute;
  inset: -3px;
  border-radius: 12px;
  border: 2px solid color-mix(in srgb, var(--primary-color, #1976d2), transparent 70%);
  border-top-color: var(--primary-color, #1976d2);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── 卡片正文 ── */
.card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-secondary, #666);
  line-height: 1.6;
}

.inline-ready {
  font-size: 12px;
  color: #4caf50;
}

.inline-hint {
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.inline-error {
  font-size: 12px;
  color: #e53935;
  word-break: break-all;
}

.inline-version {
  font-size: 11px;
  color: var(--text-secondary, #999);
}

/* 进度条 */
.progress-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--border-color, #e5e6eb);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary-color, #1976d2);
  border-radius: 4px;
  transition: width 0.2s ease;
}

.progress-indeterminate {
  width: 40%;
  animation: progress-slide 1.2s ease-in-out infinite;
}

@keyframes progress-slide {
  0% {
    margin-left: -40%;
  }
  100% {
    margin-left: 100%;
  }
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.inline-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── 卡片底部 ── */
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.foot-actions {
  display: flex;
  gap: 8px;
}

.docs-link {
  font-size: 12px;
  color: var(--primary-color, #1976d2);
  text-decoration: none;
}

.docs-link:hover {
  text-decoration: underline;
}

/* ── 弹窗 ── */
.modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border-color, #e5e6eb);
  cursor: move;
}

.modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.modal-body {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 18px;
  border-top: 1px solid var(--border-color, #e5e6eb);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.field-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #999);
  line-height: 1.6;
}

.field-hint a {
  color: var(--primary-color, #1976d2);
}

/* AI provider 配置弹窗的多行 prompt 输入框 */
.ai-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary, #333);
  background: var(--bg-input, #fff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  resize: vertical;
  outline: none;
}
.ai-textarea:focus {
  border-color: var(--primary-color, #1976d2);
}

/* ZModal 默认无宽度约束，这里限制弹窗宽度 */
:deep(.zt-modal) {
  width: 420px;
  max-width: calc(100vw - 48px);
}
</style>
