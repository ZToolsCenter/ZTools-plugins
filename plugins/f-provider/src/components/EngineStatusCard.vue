<script setup lang="ts">
import { ZButton } from 'ztools-ui'
import { useNativeEngine } from '../composables/useNativeEngine'

/**
 * native 引擎状态卡片：把 checking/missing/downloading/extracting/error/ready
 * 六个态集中渲染，给「引擎管理」与「识别测试」共用。
 *
 * 内部自己持有一份 useNativeEngine（与父组件实例独立，通过 props 控制），用于显示；
 * 下载/删除等动作通过事件上抛，由父组件决定是否联动刷新其它状态。
 */
const props = withDefaults(
  defineProps<{
    /** 是否允许在就绪态展示「重新下载 / 删除」操作 */
    showActions?: boolean
  }>(),
  { showActions: true }
)

const emit = defineEmits<{
  (e: 'downloaded'): void
  (e: 'removed'): void
}>()

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

checkNative()

async function handleDownload() {
  const ok = await downloadNative()
  if (ok) emit('downloaded')
}

function handleRemove() {
  removeNative()
  emit('removed')
}

defineExpose({ nativeReady, isBusy, downloadNative, checkNative })
</script>

<template>
  <div class="engine-card">
    <!-- 检查中 -->
    <template v-if="nativeState === 'checking'">
      <div class="status-icon checking">⟳</div>
      <div class="status-text">正在检查 OCR 引擎…</div>
    </template>

    <!-- 待下载 -->
    <template v-else-if="nativeState === 'missing'">
      <div class="status-icon">⬇</div>
      <div class="card-desc">
        需要下载微信 OCR 引擎（约 80MB，含微信内置 OCR 模型）才能进行识别。
        <span v-if="nativeVersion">（版本 {{ nativeVersion }}）</span>
      </div>
      <div v-if="nativeMissing.length" class="card-missing">
        缺失：{{ nativeMissing.join('、') }}
      </div>
      <ZButton type="primary" @click="handleDownload">下载 OCR 引擎</ZButton>
      <div class="card-hint">下载完成后将自动解压并启用</div>
    </template>

    <!-- 下载中 -->
    <template v-else-if="nativeState === 'downloading'">
      <div class="status-text">下载中… {{ downloadPercent }}%</div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: downloadPercent + '%' }"></div>
      </div>
      <div class="progress-text">
        {{ formatBytes(downloadLoaded)
        }}<span v-if="downloadTotal"> / {{ formatBytes(downloadTotal) }}</span>
      </div>
    </template>

    <!-- 解压中 -->
    <template v-else-if="nativeState === 'extracting'">
      <div class="status-text">解压中…</div>
      <div class="progress-bar">
        <div class="progress-fill progress-indeterminate"></div>
      </div>
      <div class="progress-text">正在安装 OCR 引擎，请稍候</div>
    </template>

    <!-- 错误 -->
    <template v-else-if="nativeState === 'error'">
      <div class="error-title">下载失败</div>
      <div class="error-detail">{{ nativeError }}</div>
      <ZButton type="primary" @click="handleDownload">重试</ZButton>
    </template>

    <!-- 就绪 -->
    <template v-else>
      <div class="ready-row">
        <div class="ready-dot"></div>
        <div class="status-text">OCR 引擎已就绪，可进行识别</div>
      </div>
      <div v-if="showActions" class="ready-actions">
        <ZButton size="small" :disabled="isBusy" @click="handleDownload">重新下载</ZButton>
        <ZButton size="small" :disabled="isBusy" @click="handleRemove">删除引擎</ZButton>
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
