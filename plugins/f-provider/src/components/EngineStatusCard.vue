<script setup lang="ts">
import { computed, ref } from 'vue'
import { ZButton, ZPopover } from 'ztools-ui'
import { useNativeEngine } from '../composables/useNativeEngine'
import { useLatexEngine } from '../composables/useLatexEngine'

/**
 * 引擎状态卡片:把 checking/missing/downloading/extracting/error/ready
 * 六个态集中渲染,给「引擎管理」与「识别测试」共用。
 *
 * 通过 engineKind 切换「微信 OCR 引擎」与「LaTeX 公式引擎」两套独立的服务调用,
 * 两引擎落盘与状态完全隔离,互不干扰。
 *
 * useNativeEngine/useLatexEngine 已是模块级单例:卡片与父组件(及所有调用方)
 * 共享同一份进度 ref 与进行中下载 Promise。切换 tab 卸载组件不会丢失下载进度,
 * 重新挂载仍读到同一份状态;下载进行中时 check 会被跳过,不会被文件存在性检查覆盖。
 * 下载/删除等动作通过事件上抛,由父组件决定是否联动刷新其它状态。
 */
const props = withDefaults(
  defineProps<{
    /** 是否允许在就绪态展示「重新下载 / 删除」操作 */
    showActions?: boolean
    /** 引擎类型：wechat 微信 OCR 引擎 / latex LaTeX 公式引擎 */
    engineKind?: 'wechat' | 'latex'
  }>(),
  { showActions: true, engineKind: 'wechat' }
)

const emit = defineEmits<{
  (e: 'downloaded'): void
  (e: 'removed'): void
}>()

// 微信 OCR 引擎
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
  cancelNative,
  removeNative,
  formatBytes
} = useNativeEngine()

// LaTeX 公式引擎
const {
  latexState,
  downloadPercent: latexDownloadPercent,
  downloadLoaded: latexDownloadLoaded,
  downloadTotal: latexDownloadTotal,
  latexError,
  latexVersion,
  latexMissing,
  latexReady,
  isBusy: latexIsBusy,
  checkLatex,
  downloadLatex,
  cancelLatex,
  removeLatex,
  formatBytes: latexFormatBytes
} = useLatexEngine()

// 按引擎类型统一的状态视图（模板只感知 state/version/... 等统一字段）
const state = computed(() => (props.engineKind === 'latex' ? latexState.value : nativeState.value))
const version = computed(() => (props.engineKind === 'latex' ? latexVersion.value : nativeVersion.value))
const missing = computed(() => (props.engineKind === 'latex' ? latexMissing.value : nativeMissing.value))
const error = computed(() => (props.engineKind === 'latex' ? latexError.value : nativeError.value))
const ready = computed(() => (props.engineKind === 'latex' ? latexReady.value : nativeReady.value))
const busy = computed(() => (props.engineKind === 'latex' ? latexIsBusy.value : isBusy.value))
const percent = computed(() =>
  props.engineKind === 'latex' ? latexDownloadPercent.value : downloadPercent.value
)
const loaded = computed(() =>
  props.engineKind === 'latex' ? latexDownloadLoaded.value : downloadLoaded.value
)
const total = computed(() =>
  props.engineKind === 'latex' ? latexDownloadTotal.value : downloadTotal.value
)
const bytes = computed(() =>
  props.engineKind === 'latex' ? latexFormatBytes : formatBytes
)

// 引擎显示文案
const engineLabel = computed(() => (props.engineKind === 'latex' ? '公式识别' : 'OCR'))
const engineDesc = computed(() =>
  props.engineKind === 'latex'
    ? '需要下载公式识别引擎（约 180MB，含 ONNX 神经网络模型）才能识别数学公式。'
    : '需要下载微信 OCR 引擎（约 80MB，含微信内置 OCR 模型）才能进行识别。'
)

if (props.engineKind === 'latex') {
  checkLatex()
} else {
  checkNative()
}

// 加速镜像列表（从 preload 读取，用于「下载」按钮 hover 下拉展示加速点）。
const proxyHosts = ref<string[]>([])
try {
  proxyHosts.value = window.services.ghProxyHosts()
} catch (_) {}

async function handleDownload(hostIndex?: number) {
  const ok =
    props.engineKind === 'latex'
      ? await downloadLatex(hostIndex)
      : await downloadNative(hostIndex)
  if (ok) emit('downloaded')
}

function handleCancel() {
  if (props.engineKind === 'latex') cancelLatex()
  else cancelNative()
}

function handleRemove() {
  if (props.engineKind === 'latex') removeLatex()
  else removeNative()
  emit('removed')
}

defineExpose({
  nativeReady,
  latexReady,
  isBusy,
  latexIsBusy,
  downloadNative,
  downloadLatex,
  checkNative,
  checkLatex
})
</script>

<template>
  <div class="engine-card">
    <!-- 检查中 -->
    <template v-if="state === 'checking'">
      <div class="status-icon checking">⟳</div>
      <div class="status-text">正在检查{{ engineLabel }}引擎…</div>
    </template>

    <!-- 待下载 -->
    <template v-else-if="state === 'missing'">
      <div class="status-icon">⬇</div>
      <div class="card-desc">
        {{ engineDesc }}
        <span v-if="version">（版本 {{ version }}）</span>
      </div>
      <div v-if="missing.length" class="card-missing">
        缺失：{{ missing.join('、') }}
      </div>
      <ZPopover trigger="hover" placement="bottom" :keep-alive-on-hover="true">
        <template #trigger>
          <ZButton type="primary" @click="handleDownload()">下载{{ engineLabel }}引擎</ZButton>
        </template>
        <div class="host-menu">
          <div class="host-item" @click="handleDownload()">自动竞速</div>
          <div
            v-for="(_, i) in proxyHosts"
            :key="i"
            class="host-item"
            @click="handleDownload(i)"
          >
            加速点{{ i + 1 }}
          </div>
          <div class="host-item" @click="handleDownload(-1)">直连 GitHub</div>
        </div>
      </ZPopover>
      <div class="card-hint">下载完成后将自动解压并启用</div>
    </template>

    <!-- 下载中 -->
    <template v-else-if="state === 'downloading'">
      <div class="status-text">下载中… {{ percent }}%</div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: percent + '%' }"></div>
      </div>
      <div class="progress-text">
        {{ bytes(loaded) }}<span v-if="total"> / {{ bytes(total) }}</span>
      </div>
      <ZButton size="small" @click="handleCancel">取消</ZButton>
    </template>

    <!-- 解压中 -->
    <template v-else-if="state === 'extracting'">
      <div class="status-text">解压中…</div>
      <div class="progress-bar">
        <div class="progress-fill progress-indeterminate"></div>
      </div>
      <div class="progress-text">正在安装{{ engineLabel }}引擎，请稍候</div>
    </template>

    <!-- 错误 -->
    <template v-else-if="state === 'error'">
      <div class="error-title">下载失败</div>
      <div class="error-detail">{{ error }}</div>
      <ZPopover trigger="hover" placement="bottom" :keep-alive-on-hover="true">
        <template #trigger>
          <ZButton type="primary" @click="handleDownload()">重试</ZButton>
        </template>
        <div class="host-menu">
          <div class="host-item" @click="handleDownload()">自动竞速</div>
          <div
            v-for="(_, i) in proxyHosts"
            :key="i"
            class="host-item"
            @click="handleDownload(i)"
          >
            加速点{{ i + 1 }}
          </div>
          <div class="host-item" @click="handleDownload(-1)">直连 GitHub</div>
        </div>
      </ZPopover>
    </template>

    <!-- 就绪 -->
    <template v-else>
      <div class="ready-row">
        <div class="ready-dot"></div>
        <div class="status-text">{{ engineLabel }}引擎已就绪，可进行识别</div>
      </div>
      <div v-if="showActions" class="ready-actions">
        <ZPopover trigger="hover" placement="bottom" :keep-alive-on-hover="true" :show="busy ? false : undefined">
          <template #trigger>
            <ZButton size="small" :disabled="busy" @click="handleDownload()">重新下载</ZButton>
          </template>
          <div class="host-menu">
            <div class="host-item" @click="handleDownload()">自动竞速</div>
            <div
              v-for="(_, i) in proxyHosts"
              :key="i"
              class="host-item"
              @click="handleDownload(i)"
            >
              加速点{{ i + 1 }}
            </div>
            <div class="host-item" @click="handleDownload(-1)">直连 GitHub</div>
          </div>
        </ZPopover>
        <ZButton size="small" :disabled="busy" @click="handleRemove">删除引擎</ZButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.engine-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 28px 20px;
  text-align: center;
  border-radius: 12px;
  border: 1px solid var(--border-color, #e5e6eb);
  background: var(--card-bg, transparent);
}

.status-icon {
  font-size: 40px;
  color: var(--primary-color, #1976d2);
  line-height: 1;
}

.status-icon.checking {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.card-desc {
  font-size: 13px;
  color: var(--text-secondary, #666);
  max-width: 360px;
  line-height: 1.6;
}

.card-missing {
  font-size: 12px;
  color: var(--text-secondary, #999);
  word-break: break-all;
}

.card-hint {
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.status-text {
  font-size: 14px;
  font-weight: 500;
}

.error-title {
  color: #e53935;
  font-weight: bold;
  font-size: 14px;
}

.error-detail {
  font-size: 13px;
  color: #e53935;
  max-width: 360px;
  word-break: break-all;
}

/* ── 加速点选择菜单（ZPopover content，teleport 到 body）── */
.host-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.host-item {
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  text-align: center;
  border-radius: 6px;
  color: var(--text-color, inherit);
  transition: background 0.12s;
}

.host-item:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

.ready-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ready-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4caf50;
}

.ready-actions {
  display: flex;
  gap: 8px;
}

/* ── 进度条 ── */
.progress-bar {
  width: 100%;
  max-width: 360px;
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

.progress-text {
  font-size: 12px;
  color: var(--text-secondary, #999);
}
</style>
