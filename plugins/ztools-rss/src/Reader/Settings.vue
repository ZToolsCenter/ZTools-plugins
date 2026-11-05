<script setup lang="ts">
import { ref, watch } from 'vue'
import { type GReaderConfig } from './types'
import { saveConfig, ensureAuthed, store } from './store'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const baseUrl = ref('')
const username = ref('')
const password = ref('')
const testing = ref(false)
const message = ref('')

watch(
  () => props.visible,
  (v) => {
    if (v) {
      baseUrl.value = store.config?.baseUrl || ''
      username.value = store.config?.username || ''
      password.value = store.config?.password || ''
      message.value = ''
    }
  }
)

const handleTest = async () => {
  if (!baseUrl.value || !username.value || !password.value) {
    message.value = '请填写完整'
    return
  }
  testing.value = true
  message.value = '正在连接…'
  saveConfig({
    baseUrl: baseUrl.value.trim(),
    username: username.value.trim(),
    password: password.value
  })
  const ok = await ensureAuthed()
  testing.value = false
  if (ok) {
    message.value = '连接成功'
    emit('close')
  } else {
    message.value = store.error || '连接失败'
  }
}
</script>

<template>
  <div v-if="visible" class="settings-mask" @click.self="emit('close')">
    <div class="settings-dialog">
      <div class="settings-header">
        <span>账号配置</span>
        <button class="icon-btn" @click="emit('close')">×</button>
      </div>
      <div class="settings-body">
        <label class="field">
          <span class="label">API 地址</span>
          <input
            v-model="baseUrl"
            type="text"
            placeholder="https://example.com/api/greader.php"
          />
          <small>指向 FreshRSS 的 <code>greader.php</code>，不带尾斜杠。</small>
        </label>
        <label class="field">
          <span class="label">用户名</span>
          <input v-model="username" type="text" placeholder="FreshRSS 用户名" />
        </label>
        <label class="field">
          <span class="label">API 密码</span>
          <input v-model="password" type="password" placeholder="FreshRSS 专用 API 密码" />
          <small>在 FreshRSS「账户管理」中设置的 API 密码，非登录密码。</small>
        </label>
        <div v-if="message" class="message" :class="{ ok: store.authed && message === '连接成功' }">
          {{ message }}
        </div>
      </div>
      <div class="settings-footer">
        <button class="btn ghost" :disabled="testing" @click="emit('close')">取消</button>
        <button class="btn primary" :disabled="testing" @click="handleTest">
          {{ testing ? '连接中…' : '保存并连接' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.settings-dialog {
  width: 440px;
  max-width: 92vw;
  background: var(--rss-panel);
  color: var(--rss-text);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  font-weight: 600;
  font-size: 15px;
  border-bottom: 1px solid var(--rss-border);
}
.settings-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 13px;
  color: var(--rss-text-soft);
}
.field input {
  padding: 8px 10px;
  border: 1px solid var(--rss-border);
  border-radius: 6px;
  background: var(--rss-input);
  color: var(--rss-text);
  font-size: 13px;
  outline: none;
}
.field input:focus {
  border-color: var(--rss-accent);
}
.field small {
  font-size: 11px;
  color: var(--rss-text-dim);
}
.field small code {
  background: var(--rss-input);
  padding: 1px 4px;
  border-radius: 3px;
}
.message {
  font-size: 12px;
  color: #e53935;
}
.message.ok {
  color: #43a047;
}
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--rss-border);
}
.icon-btn {
  background: none;
  border: none;
  color: var(--rss-text-soft);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}
</style>
