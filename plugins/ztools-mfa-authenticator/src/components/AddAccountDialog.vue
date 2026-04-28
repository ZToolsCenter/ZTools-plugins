<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <h2>添加账户</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: activeTab === 'manual' }"
          @click="activeTab = 'manual'"
        >
          手动输入
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'uri' }"
          @click="activeTab = 'uri'"
        >
          URI 导入
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'qr' }"
          @click="activeTab = 'qr'"
        >
          扫码导入
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'batch' }"
          @click="activeTab = 'batch'"
        >
          批量导入
        </button>
      </div>

      <!-- Manual Tab -->
      <form v-if="activeTab === 'manual'" class="form" @submit.prevent="handleManualSave">
        <div class="form-group">
          <label class="form-label">协议类型</label>
          <div class="type-toggle">
            <button
              type="button"
              class="type-btn"
              :class="{ active: manual.type === 'totp' }"
              @click="manual.type = 'totp'"
            >TOTP</button>
            <button
              type="button"
              class="type-btn"
              :class="{ active: manual.type === 'hotp' }"
              @click="manual.type = 'hotp'"
            >HOTP</button>
            <button
              type="button"
              class="type-btn"
              :class="{ active: manual.type === 'steam' }"
              @click="manual.type = 'steam'"
            >STEAM</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">发行方 <span class="required">*</span></label>
          <input
            v-model="manual.issuer"
            class="form-input"
            type="text"
            placeholder="网站或应用名称，如 GitHub、阿里云"
            required
          />
          <Transition name="hint-fade">
            <p v-if="smartFillHint" class="smart-fill-hint">{{ smartFillHint }}</p>
          </Transition>
        </div>

        <div class="form-group">
          <label class="form-label">账户标签 <span class="required">*</span></label>
          <input
            v-model="manual.label"
            class="form-input"
            type="text"
            placeholder="例如: user@example.com"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label">密钥 <span class="required">*</span></label>
          <input
            v-model="manual.secret"
            class="form-input"
            type="text"
            placeholder="Base32 密钥"
            required
          />
          <p v-if="secretError" class="form-error">{{ secretError }}</p>
        </div>

        <div v-if="manual.type !== 'steam'" class="form-row">
          <div class="form-group">
            <label class="form-label">算法</label>
            <select v-model="manual.algorithm" class="form-input">
              <option value="SHA1">SHA1 (默认，绝大多数网站)</option>
              <option value="SHA256">SHA256</option>
              <option value="SHA512">SHA512</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">位数</label>
            <select v-model.number="manual.digits" class="form-input">
              <option :value="6">6</option>
              <option :value="8">8</option>
            </select>
          </div>

          <div v-if="manual.type === 'totp'" class="form-group">
            <label class="form-label">周期 (秒)</label>
            <input
              v-model.number="manual.period"
              class="form-input"
              type="number"
              min="10"
              max="120"
            />
          </div>

          <div v-else class="form-group">
            <label class="form-label">初始计数器</label>
            <input
              v-model.number="manual.counter"
              class="form-input"
              type="number"
              min="0"
            />
          </div>
        </div>

        <p v-if="manual.type === 'steam'" class="form-hint">Steam 令牌使用固定参数：SHA1 / 5 位 / 30 秒</p>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="emit('close')">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>

      <!-- Batch Tab -->
      <div v-else-if="activeTab === 'batch'" class="form">
        <div class="form-group">
          <label class="form-label">批量文本导入</label>
          <p class="form-hint">每行一条，支持以下格式：</p>
          <p class="form-hint mono">发行方:账户:密钥</p>
          <p class="form-hint mono">发行方:账户:密钥:算法:位数:周期</p>
          <p class="form-hint mono">otpauth://totp/... 或 otpauth://hotp/...</p>
          <textarea
            v-model="batchInput"
            class="form-input form-textarea"
            placeholder="Google:user@gmail.com:JBSWY3DPEHPK3PXP
GitHub:octocat:NBSWY3DP
otpauth://totp/AWS:admin?secret=BASE32SECRET&issuer=AWS
otpauth://hotp/Service:user?secret=BASE32SECRET&counter=0"
            rows="6"
          />
        </div>

        <div v-if="batchParsed.length > 0" class="batch-preview">
          <h4 class="preview-title">解析结果 ({{ batchParsed.length }} 条)</h4>
          <div
            v-for="(item, i) in batchParsed"
            :key="i"
            class="batch-item"
            :class="{ 'batch-error': item.error }"
          >
            <span v-if="item.error" class="batch-line-error">第 {{ i + 1 }} 行: {{ item.error }}</span>
            <span v-else class="batch-line-ok">{{ item.data!.issuer }} — {{ item.data!.label }}</span>
          </div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="emit('close')">取消</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="batchValidCount === 0"
            @click="handleBatchSave"
          >
            导入 ({{ batchValidCount }})
          </button>
        </div>
      </div>

      <!-- URI Tab -->
      <div v-else-if="activeTab === 'uri'" class="form">
        <div class="form-group">
          <label class="form-label">OTPAuth URI</label>
          <textarea
            v-model="uriInput"
            class="form-input form-textarea"
            placeholder="otpauth://totp/Issuer:user@example.com?secret=BASE32SECRET&issuer=Issuer&#10;otpauth://hotp/Issuer:user@example.com?secret=BASE32SECRET&counter=0"
            rows="3"
          />
        </div>

        <div v-if="uriError" class="uri-error">{{ uriError }}</div>

        <div v-if="uriParsed" class="uri-preview">
          <h4 class="preview-title">解析结果</h4>
          <div class="preview-row">
            <span class="preview-label">类型:</span>
            <span>{{ (uriParsed.type || 'totp').toUpperCase() }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">发行方:</span>
            <span>{{ uriParsed.issuer }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">标签:</span>
            <span>{{ uriParsed.label }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">算法:</span>
            <span>{{ uriParsed.algorithm || 'SHA1' }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">位数:</span>
            <span>{{ uriParsed.digits || 6 }}</span>
          </div>
          <div v-if="uriParsed.type === 'hotp'" class="preview-row">
            <span class="preview-label">计数器:</span>
            <span>{{ uriParsed.counter ?? 0 }}</span>
          </div>
          <div v-else class="preview-row">
            <span class="preview-label">周期:</span>
            <span>{{ uriParsed.period || 30 }}s</span>
          </div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="emit('close')">取消</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!uriParsed"
            @click="handleUriSave"
          >
            导入
          </button>
        </div>
      </div>

      <!-- QR Tab -->
      <div v-else-if="activeTab === 'qr'" class="form">
        <div v-if="!qrParsed && !qrError && !qrDecoding" class="drop-zone" @click="qrFileInput?.click()">
          <input ref="qrFileInput" type="file" accept="image/*" hidden @change="onQrFileSelected" />
          <span class="drop-icon">&#128247;</span>
          <span class="drop-text">选择二维码图片</span>
          <span class="drop-hint">支持截图、照片等图片文件</span>
        </div>

        <p v-if="qrDecoding" class="step-hint">识别中...</p>

        <div v-if="qrError" class="uri-error">{{ qrError }}</div>

        <div v-if="qrParsed" class="uri-preview">
          <h4 class="preview-title">识别结果</h4>
          <div class="preview-row">
            <span class="preview-label">类型:</span>
            <span>{{ (qrParsed.type || 'totp').toUpperCase() }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">发行方:</span>
            <span>{{ qrParsed.issuer }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">标签:</span>
            <span>{{ qrParsed.label }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">算法:</span>
            <span>{{ qrParsed.algorithm || 'SHA1' }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">位数:</span>
            <span>{{ qrParsed.digits || 6 }}</span>
          </div>
          <div v-if="qrParsed.type === 'hotp'" class="preview-row">
            <span class="preview-label">计数器:</span>
            <span>{{ qrParsed.counter ?? 0 }}</span>
          </div>
          <div v-else class="preview-row">
            <span class="preview-label">周期:</span>
            <span>{{ qrParsed.period || 30 }}s</span>
          </div>
        </div>

        <div class="form-actions">
          <button v-if="qrError || qrParsed" type="button" class="btn btn-secondary" @click="resetQr">重选图片</button>
          <button type="button" class="btn btn-secondary" @click="emit('close')">取消</button>
          <button v-if="qrParsed" type="button" class="btn btn-primary" @click="handleQrSave">导入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import type { AccountInput } from '@/types'
import { parseOtpauthUri } from '@/utils/otpauth-uri'
import { decodeQrFromFile } from '@/utils/qr-decode'
import { getIssuerPreset } from '@/utils/issuerPresets'

const emit = defineEmits<{
  save: [input: AccountInput]
  saveBatch: [inputs: AccountInput[]]
  close: []
}>()

const activeTab = ref<'manual' | 'uri' | 'qr' | 'batch'>('manual')

// Manual form state
const manual = reactive({
  issuer: '',
  label: '',
  secret: '',
  algorithm: 'SHA1' as 'SHA1' | 'SHA256' | 'SHA512',
  digits: 6 as 6 | 8,
  period: 30,
  type: 'totp' as 'totp' | 'hotp' | 'steam',
  counter: 0,
})

const smartFillHint = ref('')
let smartFillTimer: ReturnType<typeof setTimeout> | null = null

watch(() => manual.issuer, (val) => {
  const preset = getIssuerPreset(val)
  if (!preset) return
  manual.algorithm = preset.algorithm
  manual.digits = preset.digits as 6 | 8
  manual.period = preset.period
  if (preset.type === 'steam') {
    manual.type = 'steam'
  }
  smartFillHint.value = `已按 ${val.trim()} 规范自动填充`
  if (smartFillTimer) clearTimeout(smartFillTimer)
  smartFillTimer = setTimeout(() => { smartFillHint.value = '' }, 2000)
})

const base32Regex = /^[A-Z2-7]+=*$/i

const secretError = computed(() => {
  if (!manual.secret) return ''
  const cleaned = manual.secret.replace(/\s/g, '')
  if (!base32Regex.test(cleaned)) {
    return '密钥必须为有效的 Base32 格式 (A-Z, 2-7)'
  }
  return ''
})

function handleManualSave() {
  if (secretError.value) return
  const cleaned = manual.secret.replace(/\s/g, '')
  if (!cleaned) return
  if (manual.type === 'steam') {
    emit('save', {
      issuer: manual.issuer.trim(),
      label: manual.label.trim(),
      secret: cleaned,
      algorithm: 'SHA1',
      digits: 5,
      period: 30,
      type: 'steam',
    })
  } else {
    emit('save', {
      issuer: manual.issuer.trim(),
      label: manual.label.trim(),
      secret: cleaned,
      algorithm: manual.algorithm,
      digits: manual.digits,
      period: manual.type === 'totp' ? manual.period : undefined,
      type: manual.type,
      counter: manual.type === 'hotp' ? manual.counter : undefined,
    })
  }
}

// URI form state
const uriInput = ref('')
const uriError = ref('')
const uriParsed = ref<AccountInput | null>(null)

watch(uriInput, (val) => {
  uriError.value = ''
  uriParsed.value = null
  if (!val.trim()) return
  try {
    const result = parseOtpauthUri(val.trim())
    if (result) {
      uriParsed.value = result
    } else {
      uriError.value = 'URI 解析失败，请检查格式是否正确'
    }
  } catch (e: any) {
    uriError.value = e.message || 'URI 解析失败'
  }
})

function handleUriSave() {
  if (!uriParsed.value) return
  emit('save', uriParsed.value)
}

// Batch form state
const batchInput = ref('')

interface BatchLine {
  data: AccountInput | null
  error: string
}

const batchParsed = computed<BatchLine[]>(() => {
  if (!batchInput.value.trim()) return []
  const lines = batchInput.value.trim().split('\n').filter((l) => l.trim())
  return lines.map((line) => parseBatchLine(line.trim()))
})

const batchValidCount = computed(() => batchParsed.value.filter((b) => b.data).length)

function parseBatchLine(line: string): BatchLine {
  if (line.startsWith('otpauth://')) {
    const parsed = parseOtpauthUri(line)
    if (parsed) return { data: parsed, error: '' }
    return { data: null, error: '无效的 otpauth URI' }
  }

  const parts = line.split(':')
  if (parts.length < 3) {
    return { data: null, error: '格式错误，至少需要 发行方:账户:密钥' }
  }

  const [issuer, label, secret, algorithm, digits, period] = parts
  const cleanSecret = secret.replace(/\s/g, '')

  if (!base32Regex.test(cleanSecret)) {
    return { data: null, error: '密钥不是有效的 Base32' }
  }

  const algo = algorithm?.toUpperCase()
  const validAlgo = ['SHA1', 'SHA256', 'SHA512'].includes(algo!) ? algo as 'SHA1' | 'SHA256' | 'SHA512' : 'SHA1'
  const dig = digits ? (parseInt(digits) === 8 ? 8 : 6) as 6 | 8 : 6
  const per = period ? parseInt(period) || 30 : 30

  return {
    data: {
      issuer: issuer.trim(),
      label: label.trim(),
      secret: cleanSecret,
      algorithm: validAlgo,
      digits: dig,
      period: per,
    },
    error: '',
  }
}

function handleBatchSave() {
  const valid = batchParsed.value
    .filter((b) => b.data)
    .map((b) => b.data!)
  if (valid.length > 0) {
    emit('saveBatch', valid)
  }
}

// QR form state
const qrFileInput = ref<HTMLInputElement | null>(null)
const qrParsed = ref<AccountInput | null>(null)
const qrError = ref('')
const qrDecoding = ref(false)

async function onQrFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  qrError.value = ''
  qrParsed.value = null
  qrDecoding.value = true
  try {
    const text = await decodeQrFromFile(file)
    const result = parseOtpauthUri(text)
    if (result) {
      qrParsed.value = result
    } else {
      qrError.value = '识别到内容但非有效的 otpauth URI：' + text.slice(0, 80)
    }
  } catch (err: any) {
    qrError.value = err.message || '识别失败'
  } finally {
    qrDecoding.value = false
  }
}

function resetQr() {
  qrParsed.value = null
  qrError.value = ''
  if (qrFileInput.value) qrFileInput.value.value = ''
}

function handleQrSave() {
  if (qrParsed.value) emit('save', qrParsed.value)
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.dialog-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 460px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.dialog-header h2 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s ease;
}

.close-btn:hover {
  color: var(--text-primary);
}

.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}

.tab {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease;
}

.tab:hover {
  color: var(--text-primary);
}

.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.type-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.type-btn {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.type-btn.active {
  background: var(--accent);
  color: var(--bg-primary);
}

.type-btn:not(.active):hover {
  background: var(--bg-card-hover);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.required {
  color: var(--danger);
}

.form-input {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s ease;
}

.form-input:focus {
  border-color: var(--accent);
}

.form-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.6;
}

.form-textarea {
  resize: vertical;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-row .form-group {
  flex: 1;
}

.form-error {
  font-size: 12px;
  color: var(--danger);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.btn {
  padding: 9px 20px;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, opacity 0.2s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: var(--bg-primary);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-card-hover);
}

.smart-fill-hint {
  font-size: 12px;
  color: var(--success);
  margin: 0;
}

.hint-fade-enter-active { transition: opacity 0.3s; }
.hint-fade-leave-active { transition: opacity 0.5s; }
.hint-fade-enter-from,
.hint-fade-leave-to { opacity: 0; }

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color 0.2s;
}
.drop-zone:hover { border-color: var(--accent); }
.drop-icon { font-size: 32px; }
.drop-text { font-size: 14px; color: var(--text-primary); font-weight: 500; }
.drop-hint { font-size: 12px; color: var(--text-secondary); }

.step-hint { font-size: 14px; color: var(--text-secondary); margin: 0; text-align: center; }

.uri-error {
  font-size: 13px;
  color: var(--danger);
  padding: 8px 12px;
  background: rgba(243, 139, 168, 0.1);
  border-radius: var(--radius);
}

.uri-preview {
  background: var(--bg-card);
  border-radius: var(--radius);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 4px;
}

.preview-row {
  display: flex;
  align-items: center;
  font-size: 13px;
  gap: 8px;
  color: var(--text-primary);
}

.preview-label {
  color: var(--text-secondary);
  min-width: 50px;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}

.form-hint.mono {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  color: var(--accent);
  opacity: 0.7;
}

.batch-preview {
  background: var(--bg-card);
  border-radius: var(--radius);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
}

.batch-item {
  font-size: 13px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}

.batch-item:last-child {
  border-bottom: none;
}

.batch-line-ok {
  color: var(--success);
}

.batch-line-error {
  color: var(--danger);
}

.batch-error {
  opacity: 0.8;
}
</style>
