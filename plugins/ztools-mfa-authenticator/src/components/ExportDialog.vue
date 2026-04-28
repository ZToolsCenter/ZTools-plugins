<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <h2>导出账户</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <!-- Step 1: Verify master password -->
      <div v-if="step === 'verify'" class="form">
        <p class="step-hint">请输入主密码以验证身份</p>
        <input
          v-model="masterPassword"
          type="password"
          class="form-input"
          placeholder="主密码"
          @keyup.enter="verifyPassword"
        />
        <p v-if="verifyError" class="form-error">{{ verifyError }}</p>
        <div class="form-actions">
          <button class="btn btn-secondary" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="verifying" @click="verifyPassword">
            {{ verifying ? '验证中...' : '验证' }}
          </button>
        </div>
      </div>

      <!-- Step 2: Export options -->
      <div v-else class="form">
        <div class="form-group">
          <label class="form-label">文件格式</label>
          <div class="format-grid">
            <button
              v-for="f in formats"
              :key="f.value"
              class="format-btn"
              :class="{ active: format === f.value }"
              @click="format = f.value"
            >
              <span class="format-icon">{{ f.icon }}</span>
              <span class="format-name">{{ f.label }}</span>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="toggle-row">
            <input v-model="encrypted" type="checkbox" class="toggle-input" />
            <span class="toggle-label">加密导出</span>
          </label>
          <p class="form-hint">{{ encrypted ? '加密后仅本插件可导入，用于跨设备同步' : '明文导出，兼容其他平台导入' }}</p>
        </div>

        <template v-if="encrypted">
          <div class="form-group">
            <label class="form-label">导出密码</label>
            <input
              v-model="exportPassword"
              type="password"
              class="form-input"
              placeholder="设置导出密码"
            />
          </div>
          <div class="form-group">
            <label class="form-label">确认密码</label>
            <input
              v-model="exportPasswordConfirm"
              type="password"
              class="form-input"
              placeholder="再次输入密码"
              @keyup.enter="handleExport"
            />
          </div>
          <p v-if="passwordMismatch" class="form-error">两次密码不一致</p>
        </template>

        <p class="export-count">将导出 {{ accounts.length }} 条账户</p>

        <p v-if="exportError" class="form-error">{{ exportError }}</p>

        <div class="form-actions">
          <button class="btn btn-secondary" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="!canExport || exporting" @click="handleExport">
            {{ exporting ? '导出中...' : '导出文件' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Account } from '@/types'
import { useCrypto } from '@/composables/useCrypto'
import {
  serializeToTxt, serializeToCsv, serializeToJson, serializeToExcel,
  encryptExport, downloadFile,
} from '@/utils/file-io'

const props = defineProps<{ accounts: Account[] }>()
const emit = defineEmits<{ close: [] }>()

const crypto = useCrypto()

const step = ref<'verify' | 'options'>('verify')
const masterPassword = ref('')
const verifyError = ref('')
const verifying = ref(false)

type Format = 'txt' | 'csv' | 'json' | 'xlsx'
const format = ref<Format>('json')
const encrypted = ref(false)
const exportPassword = ref('')
const exportPasswordConfirm = ref('')
const exportError = ref('')
const exporting = ref(false)

const formats = [
  { value: 'json' as const, label: 'JSON', icon: '{}' },
  { value: 'csv' as const, label: 'CSV', icon: '📊' },
  { value: 'txt' as const, label: 'TXT', icon: '📄' },
  { value: 'xlsx' as const, label: 'Excel', icon: '📗' },
]

const passwordMismatch = computed(() =>
  encrypted.value && exportPassword.value && exportPasswordConfirm.value && exportPassword.value !== exportPasswordConfirm.value,
)

const canExport = computed(() => {
  if (encrypted.value) {
    return exportPassword.value.length >= 4 && exportPassword.value === exportPasswordConfirm.value
  }
  return true
})

async function verifyPassword() {
  verifyError.value = ''
  if (!masterPassword.value) {
    verifyError.value = '请输入密码'
    return
  }
  verifying.value = true
  try {
    const ok = await crypto.unlock(masterPassword.value)
    if (ok) {
      step.value = 'options'
    } else {
      verifyError.value = '密码错误'
    }
  } catch {
    verifyError.value = '验证失败'
  } finally {
    verifying.value = false
  }
}

async function handleExport() {
  exportError.value = ''
  exporting.value = true

  try {
    const inputs = props.accounts.map((a) => ({
      issuer: a.issuer, label: a.label, secret: a.secret,
      algorithm: a.algorithm, digits: a.digits, period: a.period,
      type: a.type, counter: a.counter,
    }))

    const date = new Date().toISOString().slice(0, 10)

    if (encrypted.value) {
      let content: string | Uint8Array
      if (format.value === 'xlsx') {
        content = serializeToExcel(inputs)
      } else if (format.value === 'csv') {
        content = serializeToCsv(inputs)
      } else if (format.value === 'txt') {
        content = serializeToTxt(inputs)
      } else {
        content = serializeToJson(inputs)
      }
      const encryptedContent = await encryptExport(content, exportPassword.value, format.value)
      downloadFile(encryptedContent, `mfa-export-${date}.mfa`)
    } else {
      if (format.value === 'xlsx') {
        downloadFile(serializeToExcel(inputs), `mfa-export-${date}.xlsx`)
      } else if (format.value === 'csv') {
        downloadFile(serializeToCsv(inputs), `mfa-export-${date}.csv`)
      } else if (format.value === 'txt') {
        downloadFile(serializeToTxt(inputs), `mfa-export-${date}.txt`)
      } else {
        downloadFile(serializeToJson(inputs), `mfa-export-${date}.json`)
      }
    }
    emit('close')
  } catch (e: any) {
    exportError.value = e.message || '导出失败'
  } finally {
    exporting.value = false
  }
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
  max-width: 440px;
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

.dialog-header h2 { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.close-btn { background: none; border: none; color: var(--text-secondary); font-size: 24px; cursor: pointer; padding: 0 4px; line-height: 1; }
.close-btn:hover { color: var(--text-primary); }

.form { display: flex; flex-direction: column; gap: 14px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
.form-hint { font-size: 12px; color: var(--text-secondary); margin: 0; }
.step-hint { font-size: 14px; color: var(--text-secondary); margin: 0; }
.form-error { font-size: 12px; color: var(--danger); margin: 0; }
.export-count { font-size: 12px; color: var(--text-secondary); margin: 0; text-align: right; }

.form-input {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text-primary);
  outline: none;
}
.form-input:focus { border-color: var(--accent); }

.format-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }

.format-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  background: var(--bg-card);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.format-btn:hover { border-color: var(--accent); color: var(--text-primary); }
.format-btn.active { border-color: var(--accent); background: rgba(137, 180, 250, 0.1); color: var(--accent); }
.format-icon { font-size: 18px; }
.format-name { font-size: 12px; font-weight: 600; }

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.toggle-input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
.toggle-label { font-size: 14px; color: var(--text-primary); font-weight: 500; }

.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

.btn { padding: 9px 20px; border: none; border-radius: var(--radius); font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s, opacity 0.2s; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--bg-primary); }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-secondary { background: var(--bg-card); color: var(--text-primary); }
.btn-secondary:hover { background: var(--bg-card-hover); }
</style>
