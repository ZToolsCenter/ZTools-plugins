<script setup lang="ts">
import { onMounted, ref, reactive, computed } from 'vue'
import { ZInput, ZSelect, ZButton, ZTag, ZModal, useToast } from 'ztools-ui'
import { useNativeEngine } from '../composables/useNativeEngine'
import ProviderLogo from '../components/ProviderLogo.vue'
import wechatLogo from '../assets/wechat.png'

/**
 * 设置主页（合并原「引擎管理」+「翻译设置」）：统一卡片网格。
 *  - 每张卡片只展示基础信息（头像 / 名称 / 状态 / 简述），尺寸一致，一排 2 张。
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

// ─── 翻译设置 ────────────────────────────────────────────────────────
const baidu = ref({ appID: '', appKey: '' })
const youdao = ref({ appKey: '', appSecret: '' })
const microsoft = ref<{ requestMode: 'edge' | 'signature' }>({ requestMode: 'edge' })

const requestModeOptions = [
  { label: 'Signature（X-MT-Signature，推荐）', value: 'signature' },
  { label: 'Edge Token（Authorization Bearer，兜底）', value: 'edge' }
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
  } catch (e) {
    console.error('加载翻译设置失败', e)
  }
}

// 逐卡保存的 loading 态
const saving = ref(false)

async function saveProvider(p: 'baidu' | 'youdao' | 'microsoft'): Promise<void> {
  saving.value = true
  try {
    if (p === 'baidu') window.services.setTranslateSettings('baidu', { ...baidu.value })
    else if (p === 'youdao')
      window.services.setTranslateSettings('youdao', { ...youdao.value })
    else window.services.setTranslateSettings('microsoft', { ...microsoft.value })
    success('已保存')
    closeModal()
  } catch (e: any) {
    error(e?.message ? String(e.message) : '保存失败')
  } finally {
    saving.value = false
  }
}

// ─── Provider 元数据 ─────────────────────────────────────────────────
type ProviderKey = 'baidu' | 'google' | 'youdao' | 'microsoft'

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
    desc: '使用免费反代端点，免授权开箱即用。'
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
  }
]

// 各 provider 是否已配置（用于状态标签）
const configured = computed(
  () =>
    ({
      baidu: !!(baidu.value.appID && baidu.value.appKey),
      google: true,
      youdao: !!(youdao.value.appKey && youdao.value.appSecret),
      microsoft: true
    }) as Record<ProviderKey, boolean>
)

function providerStatus(
  p: ProviderMeta
): { type: 'success' | 'warning'; text: string } {
  if (p.key === 'google' || p.key === 'microsoft')
    return { type: 'success', text: '已安装' }
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

    <!-- 卡片网格：引擎 + 翻译服务，统一尺寸，一排 2 张 -->
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
          <template v-else>
            <p class="field-hint">
              使用 <code>googlet.deno.dev</code> 免费反代，无需凭据，开箱即用。
            </p>
            <p class="field-hint">
              如端点不可用，翻译测试会报错；可等待恢复或改用其他 provider。
            </p>
          </template>
        </div>

        <footer class="modal-foot">
          <ZButton size="small" @click="closeModal">取消</ZButton>
          <ZButton
            v-if="activeProvider.key !== 'google'"
            type="primary"
            size="small"
            :loading="saving"
            @click="saveProvider(activeProvider.key as 'baidu' | 'youdao' | 'microsoft')"
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

/* ── 卡片网格：一排 2 张，统一尺寸 ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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

/* ZModal 默认无宽度约束，这里限制弹窗宽度 */
:deep(.zt-modal) {
  width: 420px;
  max-width: calc(100vw - 48px);
}
</style>
