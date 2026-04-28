<template>
  <div class="unlock-backdrop">
    <div class="unlock-card">
      <div class="lock-icon">&#x1F512;</div>

      <template v-if="isFirstTime">
        <h2 class="title">设置主密码</h2>
        <p class="subtitle">此密码用于加密您的 MFA 密钥</p>

        <input
          v-model="password"
          type="password"
          class="input"
          placeholder="输入密码"
          @keyup.enter="confirmInputRef?.focus()"
        />
        <input
          ref="confirmInputRef"
          v-model="confirmPassword"
          type="password"
          class="input"
          placeholder="确认密码"
          @keyup.enter="handleSetup"
        />

        <p v-if="error" class="error">{{ error }}</p>

        <button
          class="btn"
          :disabled="loading"
          @click="handleSetup"
        >
          {{ loading ? '处理中...' : '设置密码' }}
        </button>
      </template>

      <template v-else>
        <h2 class="title">解锁</h2>
        <p class="subtitle">输入主密码以访问您的账户</p>

        <input
          v-model="password"
          type="password"
          class="input"
          placeholder="输入密码"
          @keyup.enter="handleUnlock"
        />

        <label class="remember-row">
          <input type="checkbox" v-model="rememberPassword" class="checkbox" />
          <span>记住密码（自动解锁）</span>
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button
          class="btn"
          :disabled="loading"
          @click="handleUnlock"
        >
          {{ loading ? '验证中...' : '解锁' }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useCrypto } from '@/composables/useCrypto'
import { useAutoUnlock } from '@/composables/useAutoUnlock'

const props = defineProps<{
  isFirstTime: boolean
}>()

const emit = defineEmits<{
  unlocked: []
}>()

const { setupPassword, unlock } = useCrypto()
const autoUnlock = useAutoUnlock()

const confirmInputRef = ref<HTMLInputElement | null>(null)
const password = ref('')
const confirmPassword = ref('')
const rememberPassword = ref(false)
const error = ref('')
const loading = ref(false)

async function handleSetup() {
  error.value = ''

  if (password.value.length < 4) {
    error.value = '密码长度不能少于 4 个字符'
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  try {
    await setupPassword(password.value)
    emit('unlocked')
  } catch (e) {
    error.value = '设置密码失败，请重试'
  } finally {
    loading.value = false
  }
}

async function handleUnlock() {
  error.value = ''

  if (password.value.length < 4) {
    error.value = '密码长度不能少于 4 个字符'
    return
  }

  loading.value = true
  try {
    const success = await unlock(password.value)
    if (success) {
      if (rememberPassword.value) {
        await autoUnlock.save(password.value)
      }
      emit('unlocked')
    } else {
      error.value = '密码错误'
    }
  } catch (e) {
    error.value = '解锁失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.unlock-backdrop {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-primary);
}

.unlock-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 340px;
  padding: 32px 28px;
  border-radius: 16px;
  background: var(--bg-card);
}

.lock-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.subtitle {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-secondary);
}

.input {
  width: 100%;
  padding: 10px 14px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.input:focus {
  border-color: var(--accent);
}

.remember-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.checkbox {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}

.error {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--danger);
  text-align: center;
}

.btn {
  width: 100%;
  padding: 10px 0;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #1e1e2e;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn:hover:not(:disabled) {
  opacity: 0.9;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
