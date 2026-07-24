<script setup>
import { ref, computed, onMounted } from 'vue'
import { useConfig } from '@/composables/useConfig'

const props = defineProps({
  entry: { type: Object, default: null }
})

const { snapshot, isComplete } = useConfig()
const emit = defineEmits(['need-config'])

// reading | uploading | finalizing | done | error
const phase = ref('reading')
const errorPhase = ref(null) // which phase the error happened in
const errorMessage = ref(null)
const sourceLabel = ref('')
const remotePath = ref('')

const isCopyOnly = computed(() => props.entry?.code === 'copy-screenshot-path')
const isImgEntry = (e) =>
  e?.type === 'img' || (typeof e?.payload === 'string' && e.payload.startsWith('data:image'))

const steps = computed(() => [
  { key: 'reading', label: '读取截图' },
  { key: 'uploading', label: '上传到远端' },
  { key: 'finalizing', label: isCopyOnly.value ? '复制路径' : '粘贴路径' }
])

const ORDER = ['reading', 'uploading', 'finalizing']

function stepStatus(key) {
  if (phase.value === 'error') {
    const errIdx = ORDER.indexOf(errorPhase.value || 'reading')
    const idx = ORDER.indexOf(key)
    if (idx < errIdx) return 'done'
    if (idx === errIdx) return 'error'
    return 'pending'
  }
  if (phase.value === 'done') return 'done'
  const cur = ORDER.indexOf(phase.value)
  const idx = ORDER.indexOf(key)
  if (idx < cur) return 'done'
  if (idx === cur) return 'active'
  return 'pending'
}

const heroPhase = computed(() => {
  if (phase.value === 'error') return 'error'
  if (phase.value === 'done') return 'done'
  return 'active'
})

const title = computed(() => {
  if (phase.value === 'error') return '失败'
  if (phase.value === 'done') return isCopyOnly.value ? '远端路径已复制' : '远端路径已粘贴'
  if (phase.value === 'reading') return '读取截图…'
  if (phase.value === 'uploading') return '上传到远端…'
  if (phase.value === 'finalizing') return isCopyOnly.value ? '写入剪贴板…' : '粘贴到上一个窗口…'
  return '准备中…'
})

const subtitle = computed(() => {
  if (phase.value === 'error') return '可重试，或检查 SSH 配置'
  if (phase.value === 'done')
    return isCopyOnly.value ? '路径已写入剪贴板，可手动粘贴使用' : '远端路径已贴到上一个焦点窗口'
  return isCopyOnly.value ? '完成后只复制路径，不自动粘贴' : '完成后会自动粘贴远端路径'
})

function shortPath(p, max = 56) {
  if (!p || p.length <= max) return p
  const head = Math.floor((max - 1) / 2)
  const tail = max - 1 - head
  return p.slice(0, head) + '…' + p.slice(p.length - tail)
}

async function findLatestImagePath() {
  const cb = window.ztools?.clipboard
  if (!cb) throw new Error('window.ztools.clipboard 不可用')
  const { items = [] } = await cb.getHistory(1, 20)
  const img = items.find((it) => it.type === 'image' && it.imagePath)
  if (!img) throw new Error('剪贴板历史里没有图片，请先截图或把图片粘到 ZTools 搜索框')
  return img.imagePath
}

async function run() {
  errorMessage.value = null
  errorPhase.value = null
  sourceLabel.value = ''
  remotePath.value = ''

  try {
    if (!isComplete()) {
      emit('need-config')
      return
    }
    if (!window.sshShot) throw new Error('preload 未加载')

    const cfg = snapshot()
    let r

    if (isImgEntry(props.entry)) {
      sourceLabel.value = '搜索框粘贴的图片'
      phase.value = 'uploading'
      errorPhase.value = 'uploading'
      r = await window.sshShot.uploadDataUrl(cfg, props.entry.payload)
    } else {
      phase.value = 'reading'
      errorPhase.value = 'reading'
      const local = await findLatestImagePath()
      sourceLabel.value = local
      phase.value = 'uploading'
      errorPhase.value = 'uploading'
      r = await window.sshShot.uploadFile(cfg, local)
    }

    remotePath.value = r.remotePath
    phase.value = 'finalizing'
    errorPhase.value = 'finalizing'
    await window.ztools.clipboard.writeContent(
      { type: 'text', content: r.remotePath },
      !isCopyOnly.value
    )

    phase.value = 'done'
    setTimeout(() => window.ztools?.outPlugin?.(), 1200)
  } catch (e) {
    phase.value = 'error'
    errorMessage.value = e?.message || String(e)
  }
}

onMounted(run)

function retry() {
  phase.value = 'reading'
  run()
}
function openConfig() { emit('need-config') }
async function copyAgain() {
  if (!remotePath.value) return
  await window.ztools.clipboard.writeContent({ type: 'text', content: remotePath.value }, false)
}
</script>

<template>
  <div class="run-card">
    <header class="hero">
      <div class="hero-icon" :data-phase="heroPhase">
        <!-- upload cloud (active / default) -->
        <svg v-if="heroPhase === 'active'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 16l-4-4-4 4" />
          <path d="M12 12v9" />
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
        </svg>
        <!-- check (done) -->
        <svg v-else-if="heroPhase === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <!-- alert (error) -->
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div class="hero-text">
        <h2>{{ title }}</h2>
        <p>{{ subtitle }}</p>
      </div>
    </header>

    <ol class="steps">
      <li v-for="s in steps" :key="s.key" :class="['step', stepStatus(s.key)]">
        <span class="dot">
          <svg v-if="stepStatus(s.key) === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="dot-icon">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span v-else-if="stepStatus(s.key) === 'active'" class="spinner" />
          <svg v-else-if="stepStatus(s.key) === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="dot-icon">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
          <span v-else class="dot-num">{{ ORDER.indexOf(s.key) + 1 }}</span>
        </span>
        <span class="step-label">{{ s.label }}</span>
      </li>
    </ol>

    <div class="details" v-if="sourceLabel || remotePath">
      <div class="detail-row" v-if="sourceLabel">
        <span class="detail-key">来源</span>
        <code class="detail-val" :title="sourceLabel">{{ shortPath(sourceLabel) }}</code>
      </div>
      <div class="detail-row" v-if="remotePath">
        <span class="detail-key">远端</span>
        <code class="detail-val" :title="remotePath">{{ shortPath(remotePath) }}</code>
        <button
          v-if="phase === 'done'"
          class="ghost"
          @click="copyAgain"
          title="再次写入剪贴板"
        >复制</button>
      </div>
    </div>

    <div class="error-box" v-if="phase === 'error'">
      <p class="error-msg">{{ errorMessage }}</p>
      <div class="actions">
        <button class="primary" @click="retry">重试</button>
        <button @click="openConfig">打开配置</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.run-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px 22px 20px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
}

/* ---------- Hero ---------- */
.hero {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 20px;
}
.hero-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: white;
  background: var(--accent);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.25);
  transition: background 0.25s, box-shadow 0.25s;
}
.hero-icon[data-phase='done'] {
  background: var(--ok);
  box-shadow: 0 6px 16px rgba(22, 163, 74, 0.25);
}
.hero-icon[data-phase='error'] {
  background: var(--danger);
  box-shadow: 0 6px 16px rgba(220, 38, 38, 0.25);
}
.hero-icon[data-phase='active'] svg { animation: float 2.4s ease-in-out infinite; }
.hero-icon svg { width: 22px; height: 22px; }
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2px); }
}
.hero-text h2 {
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 600;
}
.hero-text p {
  margin: 0;
  color: var(--muted);
  font-size: 12.5px;
}

/* ---------- Steps ---------- */
.steps {
  list-style: none;
  margin: 0 4px 18px;
  padding: 0;
  display: flex;
  align-items: flex-start;
}
.step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
  text-align: center;
}
.step:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 13px;
  left: calc(50% + 14px);
  right: calc(-50% + 14px);
  height: 2px;
  background: var(--border);
  border-radius: 2px;
  transition: background 0.25s;
}
.step.done:not(:last-child)::after { background: var(--ok); }
.step.active:not(:last-child)::after {
  background: linear-gradient(to right, var(--ok) 0%, var(--accent) 50%, var(--border) 50%);
  background-size: 200% 100%;
  animation: stripe 1.2s linear infinite;
}
@keyframes stripe {
  from { background-position: 100% 0; }
  to   { background-position: 0 0; }
}

.dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--field-bg);
  border: 1.5px solid var(--border);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  z-index: 1;
  transition: background 0.25s, border-color 0.25s, color 0.25s;
}
.step.active .dot {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
}
.step.done .dot {
  background: var(--ok);
  border-color: var(--ok);
  color: white;
}
.step.error .dot {
  background: var(--danger);
  border-color: var(--danger);
  color: white;
}
.dot-icon { width: 14px; height: 14px; }

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.step-label {
  font-size: 12px;
  color: var(--muted);
  transition: color 0.25s;
}
.step.active .step-label,
.step.done .step-label,
.step.error .step-label { color: var(--fg); }

/* ---------- Details ---------- */
.details {
  border-top: 1px dashed var(--border);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.detail-key {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--muted);
  width: 32px;
  letter-spacing: 0.5px;
}
.detail-val {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  background: var(--field-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ghost {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--border);
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
}

/* ---------- Error ---------- */
.error-box {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.25);
}
.error-msg {
  margin: 0 0 10px;
  color: var(--danger);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}
.actions { display: flex; gap: 8px; }
</style>
