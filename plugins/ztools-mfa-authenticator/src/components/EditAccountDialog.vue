<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <h2>编辑账户</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <form class="form" @submit.prevent="handleSave">
        <div class="form-group">
          <label class="form-label">发行方</label>
          <input
            v-model="form.issuer"
            class="form-input"
            type="text"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label">账户标签</label>
          <input
            v-model="form.label"
            class="form-input"
            type="text"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label">密钥</label>
          <div class="secret-input-wrapper">
            <input
              v-model="form.secret"
              class="form-input secret-input"
              :type="secretVisible ? 'text' : 'password'"
              required
            />
            <button
              type="button"
              class="secret-toggle"
              @click="handleToggleSecret"
              :title="secretVisible ? '隐藏密钥' : '显示密钥'"
            >
              {{ secretVisible ? '&#128064;' : '&#128065;' }}
            </button>
          </div>
          <div v-if="showVerifyInput" class="verify-inline">
            <input
              v-model="verifyPasswordInput"
              type="password"
              class="form-input"
              placeholder="输入主密码以查看密钥"
              @keyup.enter="doVerifySecret"
            />
            <div class="verify-actions">
              <button type="button" class="btn btn-sm btn-secondary" @click="showVerifyInput = false">取消</button>
              <button type="button" class="btn btn-sm btn-primary" :disabled="verifyingSecret" @click="doVerifySecret">
                {{ verifyingSecret ? '验证中...' : '验证' }}
              </button>
            </div>
            <p v-if="verifyError" class="form-error">{{ verifyError }}</p>
          </div>
          <p v-if="secretError" class="form-error">{{ secretError }}</p>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">类型</label>
            <input class="form-input" :value="account.type === 'steam' ? 'STEAM' : account.type === 'hotp' ? 'HOTP' : 'TOTP'" readonly />
          </div>

          <template v-if="account.type !== 'steam'">
            <div class="form-group">
              <label class="form-label">算法</label>
              <select v-model="form.algorithm" class="form-input">
                <option value="SHA1">SHA1</option>
                <option value="SHA256">SHA256</option>
                <option value="SHA512">SHA512</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">位数</label>
              <select v-model.number="form.digits" class="form-input">
                <option :value="6">6</option>
                <option :value="8">8</option>
              </select>
            </div>
          </template>
        </div>

        <p v-if="account.type === 'steam'" class="form-hint">Steam 令牌使用固定参数：SHA1 / 5 位 / 30 秒</p>

        <div v-if="account.type !== 'steam'" class="form-row">
          <div v-if="account.type !== 'hotp'" class="form-group">
            <label class="form-label">周期 (秒)</label>
            <input v-model.number="form.period" class="form-input" type="number" min="10" max="120" />
          </div>
          <div v-else class="form-group">
            <label class="form-label">当前计数器</label>
            <input v-model.number="form.counter" class="form-input" type="number" min="0" />
          </div>
        </div>

        <div class="form-actions">
          <div class="delete-area">
            <button
              v-if="!confirmingDelete"
              type="button"
              class="btn btn-danger-outline"
              @click="confirmingDelete = true"
            >
              删除账户
            </button>
            <template v-else>
              <span class="confirm-text">确认删除？</span>
              <button
                type="button"
                class="btn btn-danger"
                @click="handleDelete"
              >
                确认
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                @click="confirmingDelete = false"
              >
                取消
              </button>
            </template>
          </div>
          <div class="save-area">
            <button type="button" class="btn btn-secondary" @click="emit('close')">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useCrypto } from '@/composables/useCrypto'
import type { Account } from '@/types'

const props = defineProps<{
  account: Account
}>()

const emit = defineEmits<{
  save: [payload: { id: string; changes: Partial<Account> }]
  delete: [id: string]
  close: []
}>()

const crypto = useCrypto()

const form = reactive({
  issuer: props.account.issuer,
  label: props.account.label,
  secret: props.account.secret,
  algorithm: props.account.algorithm,
  digits: props.account.digits as 6 | 8,
  period: props.account.period,
  counter: props.account.counter ?? 0,
})

const secretVisible = ref(false)
const secretVerified = ref(false)
const showVerifyInput = ref(false)
const verifyPasswordInput = ref('')
const verifyError = ref('')
const verifyingSecret = ref(false)
const confirmingDelete = ref(false)

function handleToggleSecret() {
  if (secretVisible.value) {
    secretVisible.value = false
    return
  }
  if (secretVerified.value) {
    secretVisible.value = true
    return
  }
  showVerifyInput.value = true
  verifyError.value = ''
  verifyPasswordInput.value = ''
}

async function doVerifySecret() {
  verifyError.value = ''
  if (!verifyPasswordInput.value) {
    verifyError.value = '请输入密码'
    return
  }
  verifyingSecret.value = true
  try {
    const ok = await crypto.verifyPassword(verifyPasswordInput.value)
    if (ok) {
      secretVerified.value = true
      secretVisible.value = true
      showVerifyInput.value = false
    } else {
      verifyError.value = '密码错误'
    }
  } catch {
    verifyError.value = '验证失败'
  } finally {
    verifyingSecret.value = false
  }
}

const base32Regex = /^[A-Z2-7]+=*$/i

const secretError = computed(() => {
  if (!form.secret) return ''
  const cleaned = form.secret.replace(/\s/g, '')
  if (!base32Regex.test(cleaned)) {
    return '密钥必须为有效的 Base32 格式 (A-Z, 2-7)'
  }
  return ''
})

function handleSave() {
  if (secretError.value) return
  const changes: Partial<Account> = {
    issuer: form.issuer.trim(),
    label: form.label.trim(),
    secret: form.secret.replace(/\s/g, ''),
  }
  if (props.account.type === 'steam') {
    changes.algorithm = 'SHA1'
    changes.digits = 5
    changes.period = 30
  } else {
    changes.algorithm = form.algorithm
    changes.digits = form.digits
    changes.period = form.period
    if (props.account.type === 'hotp') {
      changes.counter = form.counter
    }
  }
  emit('save', { id: props.account.id, changes })
}

function handleDelete() {
  emit('delete', props.account.id)
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

.form-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.secret-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.secret-input {
  width: 100%;
  padding-right: 40px;
}

.secret-toggle {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  line-height: 1;
  color: var(--text-secondary);
  transition: color 0.15s ease;
}

.secret-toggle:hover {
  color: var(--text-primary);
}

.verify-inline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.verify-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 12px;
}

.delete-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.confirm-text {
  font-size: 13px;
  color: var(--danger);
  font-weight: 500;
}

.save-area {
  display: flex;
  gap: 10px;
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

.btn-sm {
  padding: 6px 14px;
  font-size: 13px;
}

.btn-primary {
  background: var(--accent);
  color: var(--bg-primary);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-card-hover);
}

.btn-danger {
  background: var(--danger);
  color: var(--bg-primary);
}

.btn-danger:hover {
  background: var(--danger);
  filter: brightness(0.85);
}

.btn-danger-outline {
  background: none;
  border: 1px solid var(--danger);
  color: var(--danger);
}

.btn-danger-outline:hover {
  background: rgba(243, 139, 168, 0.1);
}
</style>
