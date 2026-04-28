<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <h2>修改主密码</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div class="form">
        <label class="form-label">当前密码</label>
        <input
          v-model="oldPassword"
          type="password"
          class="form-input"
          placeholder="输入当前主密码"
          @keyup.enter="focusNew"
        />

        <label class="form-label">新密码</label>
        <input
          ref="newInput"
          v-model="newPassword"
          type="password"
          class="form-input"
          placeholder="输入新密码（至少 6 位）"
          @keyup.enter="focusConfirm"
        />

        <label class="form-label">确认新密码</label>
        <input
          ref="confirmInput"
          v-model="confirmPassword"
          type="password"
          class="form-input"
          placeholder="再次输入新密码"
          @keyup.enter="handleSubmit"
        />

        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-if="success" class="form-success">{{ success }}</p>

        <div class="form-actions">
          <button class="btn btn-secondary" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="busy" @click="handleSubmit">
            {{ busy ? '处理中...' : '确认修改' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useCrypto } from '@/composables/useCrypto'
import { useAccounts } from '@/composables/useAccounts'
import { useAutoUnlock } from '@/composables/useAutoUnlock'

const emit = defineEmits<{ close: [] }>()

const crypto = useCrypto()
const accountStore = useAccounts()
const autoUnlockHelper = useAutoUnlock()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const success = ref('')
const busy = ref(false)

const newInput = ref<HTMLInputElement | null>(null)
const confirmInput = ref<HTMLInputElement | null>(null)

function focusNew() { newInput.value?.focus() }
function focusConfirm() { confirmInput.value?.focus() }

async function handleSubmit() {
  error.value = ''
  success.value = ''

  if (!oldPassword.value) {
    error.value = '请输入当前密码'
    return
  }
  if (newPassword.value.length < 6) {
    error.value = '新密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  if (oldPassword.value === newPassword.value) {
    error.value = '新密码不能与当前密码相同'
    return
  }

  busy.value = true
  try {
    const ok = await crypto.changePassword(
      oldPassword.value,
      newPassword.value,
      (newEncryptFn) => accountStore.reEncryptAll(newEncryptFn),
    )
    if (ok) {
      autoUnlockHelper.clear()
      success.value = '密码修改成功'
      setTimeout(() => emit('close'), 1200)
    } else {
      error.value = '当前密码错误'
    }
  } catch {
    error.value = '修改失败，请重试'
  } finally {
    busy.value = false
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
  max-width: 400px;
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

.form { display: flex; flex-direction: column; gap: 10px; }
.form-label { font-size: 13px; color: var(--text-secondary); margin: 0; }
.form-error { font-size: 12px; color: var(--danger); margin: 0; }
.form-success { font-size: 12px; color: var(--success); margin: 0; }

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

.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }

.btn { padding: 9px 20px; border: none; border-radius: var(--radius); font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s, opacity 0.2s; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--bg-card); color: var(--text-primary); }
.btn-secondary:hover { background: var(--bg-card-hover); }
.btn-primary { background: var(--accent); color: var(--bg-primary); }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
</style>
