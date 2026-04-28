<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <h2>导入账户</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div class="form">
        <!-- File picker -->
        <div v-if="!parsed.length && !parseError" class="drop-zone" @click="fileInput?.click()">
          <input
            ref="fileInput"
            type="file"
            accept=".txt,.csv,.json,.xlsx,.xls,.mfa"
            hidden
            @change="onFileSelected"
          />
          <span class="drop-icon">📂</span>
          <span class="drop-text">点击选择文件</span>
          <span class="drop-hint">支持 TXT、CSV、JSON、Excel、MFA(加密)</span>
        </div>

        <!-- Decrypt password -->
        <template v-if="needPassword">
          <p class="step-hint">该文件已加密，请输入导出密码</p>
          <input
            v-model="decryptPassword"
            type="password"
            class="form-input"
            placeholder="导出密码"
            @keyup.enter="doDecrypt"
          />
          <p v-if="decryptError" class="form-error">{{ decryptError }}</p>
          <div class="form-actions">
            <button class="btn btn-secondary" @click="reset">重选文件</button>
            <button class="btn btn-primary" :disabled="!decryptPassword || decrypting" @click="doDecrypt">
              {{ decrypting ? '解密中...' : '解密' }}
            </button>
          </div>
        </template>

        <!-- Parse error -->
        <template v-if="parseError && !needPassword">
          <p class="form-error">{{ parseError }}</p>
          <div class="form-actions">
            <button class="btn btn-secondary" @click="reset">重选文件</button>
          </div>
        </template>

        <!-- Preview -->
        <template v-if="parsed.length">
          <p class="step-hint">已解析 {{ parsed.length }} 条账户</p>
          <div class="preview-list">
            <div v-for="(a, i) in parsed.slice(0, 50)" :key="i" class="preview-item">
              <span class="preview-issuer">{{ a.issuer }}</span>
              <span class="preview-label">{{ a.label }}</span>
            </div>
            <p v-if="parsed.length > 50" class="preview-more">...还有 {{ parsed.length - 50 }} 条</p>
          </div>
          <div class="form-actions">
            <button class="btn btn-secondary" @click="reset">重选文件</button>
            <button class="btn btn-primary" :disabled="importing" @click="doImport">
              {{ importing ? '导入中...' : `导入 ${parsed.length} 条` }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { AccountInput } from '@/types'
import {
  detectEncrypted, detectFormat, parseByFormat,
  parseFromExcel, decryptImport, parseFromJson, parseFromCsv, parseFromTxt,
} from '@/utils/file-io'

const emit = defineEmits<{ close: []; saveBatch: [accounts: AccountInput[]] }>()

const fileInput = ref<HTMLInputElement | null>(null)
const parsed = ref<AccountInput[]>([])
const parseError = ref('')
const needPassword = ref(false)
const decryptPassword = ref('')
const decryptError = ref('')
const decrypting = ref(false)
const importing = ref(false)

let encryptedContent = ''

function reset() {
  parsed.value = []
  parseError.value = ''
  needPassword.value = false
  decryptPassword.value = ''
  decryptError.value = ''
  encryptedContent = ''
  if (fileInput.value) fileInput.value.value = ''
}

async function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  parseError.value = ''
  parsed.value = []

  try {
    const format = detectFormat(file.name)

    if (format === 'xlsx') {
      const buffer = await file.arrayBuffer()
      parsed.value = parseFromExcel(buffer)
      if (!parsed.value.length) parseError.value = '未找到有效账户数据'
      return
    }

    const text = await file.text()

    if (format === 'mfa' || detectEncrypted(text)) {
      encryptedContent = text
      needPassword.value = true
      return
    }

    parsed.value = parseByFormat(text, format)
    if (!parsed.value.length) parseError.value = '未找到有效账户数据'
  } catch (err: any) {
    parseError.value = err.message || '文件读取失败'
  }
}

async function doDecrypt() {
  decryptError.value = ''
  decrypting.value = true
  try {
    const result = await decryptImport(encryptedContent, decryptPassword.value)
    if (result.isBinary) {
      const binary = atob(result.content)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      parsed.value = parseFromExcel(bytes.buffer as ArrayBuffer)
    } else {
      parsed.value = parseByFormat(result.content, result.format)
    }
    needPassword.value = false
    if (!parsed.value.length) parseError.value = '解密成功但未找到有效账户数据'
  } catch {
    decryptError.value = '密码错误或文件损坏'
  } finally {
    decrypting.value = false
  }
}

function doImport() {
  importing.value = true
  emit('saveBatch', parsed.value)
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
.step-hint { font-size: 14px; color: var(--text-secondary); margin: 0; }
.form-error { font-size: 12px; color: var(--danger); margin: 0; }

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

.preview-list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-item {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-card);
  border-radius: var(--radius);
  font-size: 13px;
}
.preview-issuer { color: var(--text-primary); font-weight: 600; }
.preview-label { color: var(--text-secondary); }
.preview-more { font-size: 12px; color: var(--text-secondary); text-align: center; margin: 4px 0 0; }

.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

.btn { padding: 9px 20px; border: none; border-radius: var(--radius); font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s, opacity 0.2s; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--bg-primary); }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-secondary { background: var(--bg-card); color: var(--text-primary); }
.btn-secondary:hover { background: var(--bg-card-hover); }
</style>
