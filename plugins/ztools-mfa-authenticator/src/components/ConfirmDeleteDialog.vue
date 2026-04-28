<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <h2>{{ mode === 'all' ? '清空所有账户' : '删除选中账户' }}</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div class="form">
        <div class="warning-box">
          <span class="warning-icon">⚠️</span>
          <div>
            <p class="warning-text" v-if="mode === 'all'">
              即将删除全部 <strong>{{ count }}</strong> 条账户，此操作不可撤销！
            </p>
            <p class="warning-text" v-else>
              即将删除 <strong>{{ count }}</strong> 条账户，此操作不可撤销！
            </p>
          </div>
        </div>

        <div v-if="accountNames.length" class="preview-list">
          <div v-for="(name, i) in accountNames.slice(0, 10)" :key="i" class="preview-item">
            {{ name }}
          </div>
          <p v-if="accountNames.length > 10" class="preview-more">
            ...还有 {{ accountNames.length - 10 }} 条
          </p>
        </div>

        <p class="step-hint">请输入主密码以确认操作</p>
        <input
          v-model="password"
          type="password"
          class="form-input"
          placeholder="主密码"
          @keyup.enter="handleConfirm"
        />
        <p v-if="error" class="form-error">{{ error }}</p>

        <div class="form-actions">
          <button class="btn btn-secondary" @click="emit('close')">取消</button>
          <button class="btn btn-danger" :disabled="!password || verifying" @click="handleConfirm">
            {{ verifying ? '验证中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useCrypto } from '@/composables/useCrypto'

defineProps<{
  mode: 'batch' | 'all'
  count: number
  accountNames: string[]
}>()

const emit = defineEmits<{ confirm: []; close: [] }>()

const crypto = useCrypto()
const password = ref('')
const error = ref('')
const verifying = ref(false)

async function handleConfirm() {
  error.value = ''
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  verifying.value = true
  try {
    const ok = await crypto.unlock(password.value)
    if (ok) {
      emit('confirm')
    } else {
      error.value = '密码错误'
    }
  } catch {
    error.value = '验证失败'
  } finally {
    verifying.value = false
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

.dialog-header h2 { font-size: 18px; font-weight: 700; color: var(--danger); }
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

.warning-box {
  display: flex;
  gap: 10px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
}
.warning-icon { font-size: 20px; flex-shrink: 0; }
.warning-text { font-size: 14px; color: var(--text-primary); margin: 0; line-height: 1.5; }
.warning-text strong { color: var(--danger); }

.preview-list {
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.preview-item {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 4px 10px;
  background: var(--bg-card);
  border-radius: var(--radius);
}
.preview-more { font-size: 12px; color: var(--text-secondary); text-align: center; margin: 4px 0 0; }

.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

.btn { padding: 9px 20px; border: none; border-radius: var(--radius); font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s, opacity 0.2s; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--bg-card); color: var(--text-primary); }
.btn-secondary:hover { background: var(--bg-card-hover); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover:not(:disabled) { filter: brightness(0.85); }
</style>
