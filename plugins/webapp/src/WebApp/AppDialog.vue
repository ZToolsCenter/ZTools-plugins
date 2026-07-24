<script lang="ts" setup>
import { ref, watch } from 'vue'

interface AppConfig {
  id: string
  name: string
  url: string
  icon: string
  description: string
  defaultLoad: boolean
  createdAt: number
  basicAuth?: {
    username: string
    password: string
  }
}

const props = defineProps<{
  app: AppConfig | null
}>()

const emit = defineEmits<{
  (e: 'save', config: AppConfig): void
  (e: 'delete', id: string): void
  (e: 'close'): void
}>()

const formData = ref({
  name: '',
  url: 'https://',
  icon: '',
  description: '',
  defaultLoad: false,
  basicAuth: { username: '', password: '' }
})

const showBasicAuth = ref(false)
const showPassword = ref(false)

const errors = ref({
  name: '',
  url: ''
})

const isLoadingLogo = ref(false)

watch(() => props.app, (newApp) => {
  if (newApp) {
    // 密码在存储中是 base64 编码的，编辑时解码显示（支持 UTF-8）
    let decodedPassword = ''
    if (newApp.basicAuth?.password) {
      try {
        decodedPassword = new TextDecoder().decode(
          Uint8Array.from(atob(newApp.basicAuth.password), c => c.charCodeAt(0))
        )
      } catch {
        try {
          decodedPassword = atob(newApp.basicAuth.password)
        } catch {
          decodedPassword = newApp.basicAuth.password
        }
      }
    }
    formData.value = {
      name: newApp.name,
      url: newApp.url,
      icon: newApp.icon,
      description: newApp.description,
      defaultLoad: newApp.defaultLoad || false,
      basicAuth: newApp.basicAuth
        ? { username: newApp.basicAuth.username, password: decodedPassword }
        : { username: '', password: '' }
    }
    showBasicAuth.value = !!newApp.basicAuth?.username
  } else {
    resetForm()
  }
}, { immediate: true })

const resetForm = () => {
  formData.value = {
    name: '',
    url: 'https://',
    icon: '',
    description: '',
    defaultLoad: false,
    basicAuth: { username: '', password: '' }
  }
  errors.value = { name: '', url: '' }
  showBasicAuth.value = false
  showPassword.value = false
}

const validateForm = (): boolean => {
  let isValid = true
  errors.value = { name: '', url: '' }

  if (!formData.value.name.trim()) {
    errors.value.name = '请输入应用名称'
    isValid = false
  }

  if (!formData.value.url.trim() || formData.value.url === 'https://') {
    errors.value.url = '请输入有效的URL'
    isValid = false
  } else if (!isValidUrl(formData.value.url)) {
    errors.value.url = '请输入有效的URL格式'
    isValid = false
  }

  return isValid
}

// 允许的URL协议白名单
const ALLOWED_PROTOCOLS = ['http:', 'https:']

const isValidUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url)
    return ALLOWED_PROTOCOLS.includes(urlObj.protocol)
  } catch {
    return false
  }
}

// 获取域名
const getDomain = (url: string): string | null => {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return null
  }
}

// 检查图片是否可加载
const checkImage = (url: string, timeout = 5000): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image()
    const cleanup = () => {
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
    }
    const timer = setTimeout(() => {
      cleanup()
      img.src = ''
      resolve(false)
    }, timeout)

    img.onload = () => {
      cleanup()
      resolve(true)
    }
    img.onerror = () => {
      cleanup()
      resolve(false)
    }
    img.src = url
  })
}

// 自动获取logo
const fetchLogo = async () => {
  const url = formData.value.url.trim()
  if (!url || url === 'https://') {
    errors.value.url = '请先输入有效的URL'
    return
  }

  if (!isValidUrl(url)) {
    errors.value.url = '请输入有效的URL格式'
    return
  }

  const domain = getDomain(url)
  if (!domain) return

  isLoadingLogo.value = true
  errors.value.url = ''

  try {
    // 方案1：使用 favicon.im 服务
    const faviconImUrl = `https://favicon.im/${domain}`
    if (await checkImage(faviconImUrl)) {
      formData.value.icon = faviconImUrl
      isLoadingLogo.value = false
      return
    }

    // 方案2：直接访问网站 /favicon.ico（兜底）
    const faviconIcoUrl = `https://${domain}/favicon.ico`
    if (await checkImage(faviconIcoUrl)) {
      formData.value.icon = faviconIcoUrl
      isLoadingLogo.value = false
      return
    }

    // 都失败
    errors.value.url = '无法获取网站图标，请手动输入'
    isLoadingLogo.value = false
  } catch {
    errors.value.url = '获取图标失败，请手动输入'
    isLoadingLogo.value = false
  }
}

const generateId = (): string => {
  return crypto.randomUUID()
}

const handleSubmit = () => {
  if (!validateForm()) return

  // 处理 Basic Auth：密码使用 base64 编码存储
  let basicAuth: { username: string; password: string } | undefined
  if (showBasicAuth.value) {
    const username = formData.value.basicAuth.username.trim()
    const password = formData.value.basicAuth.password
    if (username) {
      basicAuth = {
        username,
        password: btoa(String.fromCharCode(...new TextEncoder().encode(password)))
      }
    }
  }

  const config: AppConfig = {
    id: props.app?.id || generateId(),
    name: formData.value.name.trim(),
    url: formData.value.url.trim(),
    icon: formData.value.icon.trim(),
    description: formData.value.description.trim(),
    defaultLoad: formData.value.defaultLoad,
    createdAt: props.app?.createdAt || Date.now(),
    ...(basicAuth ? { basicAuth } : {})
  }

  emit('save', config)
}

const handleDelete = () => {
  if (props.app && confirm(`确定要删除 "${props.app.name}" 吗？`)) {
    emit('delete', props.app.id)
  }
}

const handleClose = () => {
  emit('close')
}

const handleOverlayClick = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    handleClose()
  }
}
</script>

<template>
  <div class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog" role="dialog" aria-modal="true">
      <!-- Header -->
      <header class="dialog-header">
        <h2>{{ app ? '编辑应用' : '添加应用' }}</h2>
        <button class="dialog-close" @click="handleClose" aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>

      <!-- Form -->
      <form class="dialog-body" @submit.prevent="handleSubmit">
        <!-- 名称 -->
        <div class="field">
          <label class="field-label" for="name">名称</label>
          <input
            id="name"
            v-model="formData.name"
            type="text"
            class="field-input"
            :class="{ error: errors.name }"
            placeholder="GitHub"
          />
          <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
        </div>

        <!-- URL -->
        <div class="field">
          <label class="field-label" for="url">地址</label>
          <input
            id="url"
            v-model="formData.url"
            type="url"
            class="field-input"
            :class="{ error: errors.url }"
            placeholder="https://github.com"
          />
          <span v-if="errors.url" class="field-error">{{ errors.url }}</span>
        </div>

        <!-- 图标 -->
        <div class="field">
          <div class="field-label-row">
            <label class="field-label" for="icon">图标</label>
            <button
              type="button"
              class="fetch-btn"
              @click="fetchLogo"
              :disabled="isLoadingLogo"
            >
              <svg v-if="!isLoadingLogo" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                <polyline points="22 2 22 8 16 8"></polyline>
              </svg>
              <span v-else class="loading-spinner"></span>
              {{ isLoadingLogo ? '获取中...' : '自动获取' }}
            </button>
          </div>
          <input
            id="icon"
            v-model="formData.icon"
            type="url"
            class="field-input"
            placeholder="https://example.com/icon.png"
          />
          <span class="field-hint">可选，留空显示首字母</span>
          <div v-if="formData.icon" class="field-preview">
            <img :src="formData.icon" alt="预览" @error="formData.icon = ''" />
          </div>
        </div>

        <!-- 描述 -->
        <div class="field">
          <label class="field-label" for="desc">描述</label>
          <textarea
            id="desc"
            v-model="formData.description"
            class="field-input field-textarea"
            placeholder="可选"
            rows="3"
          ></textarea>
        </div>

        <!-- Basic Auth 认证信息 -->
        <div class="field">
          <label class="checkbox-label">
            <input
              type="checkbox"
              v-model="showBasicAuth"
              class="checkbox-input"
            />
            <span class="checkbox-mark">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
            <span class="checkbox-text">启用 Basic Auth 认证</span>
          </label>
          <span class="field-hint">适用于需要 HTTP Basic 认证的网页</span>
        </div>

        <template v-if="showBasicAuth">
          <!-- 用户名 -->
          <div class="field">
            <label class="field-label" for="auth-username">用户名</label>
            <input
              id="auth-username"
              v-model="formData.basicAuth.username"
              type="text"
              class="field-input"
              placeholder="请输入用户名"
            />
          </div>

          <!-- 密码 -->
          <div class="field">
            <label class="field-label" for="auth-password">密码</label>
            <div class="password-input-wrapper">
              <input
                id="auth-password"
                v-model="formData.basicAuth.password"
                :type="showPassword ? 'text' : 'password'"
                class="field-input password-input"
                placeholder="请输入密码"
              />
              <button
                type="button"
                class="password-toggle"
                @click="showPassword = !showPassword"
                :title="showPassword ? '隐藏密码' : '显示密码'"
              >
                <svg v-if="!showPassword" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              </button>
            </div>
          </div>
        </template>

        <!-- 默认加载 -->
        <div class="field">
          <label class="checkbox-label">
            <input
              type="checkbox"
              v-model="formData.defaultLoad"
              class="checkbox-input"
            />
            <span class="checkbox-mark">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
            <span class="checkbox-text">默认加载</span>
          </label>
          <span class="field-hint">勾选后打开插件时自动加载此应用</span>
        </div>
      </form>

      <!-- Footer -->
      <footer class="dialog-footer">
        <!-- 删除按钮（仅编辑模式显示） -->
        <button
          v-if="app"
          type="button"
          class="btn btn-danger"
          @click="handleDelete"
        >
          删除
        </button>

        <div class="footer-right">
          <button type="button" class="btn btn-secondary" @click="handleClose">取消</button>
          <button type="button" class="btn btn-primary" @click="handleSubmit">
            {{ app ? '保存' : '添加' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* ================================================
   DIALOG OVERLAY
   ================================================ */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: oklch(0 0 0 / 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: overlayIn 150ms var(--ease-out);
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ================================================
   DIALOG
   ================================================ */
.dialog {
  width: 420px;
  max-width: 92vw;
  max-height: 85vh;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  animation: dialogIn 200ms var(--ease-out);
}

@keyframes dialogIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ================================================
   DIALOG HEADER
   ================================================ */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xl) var(--space-xl) var(--space-lg);
}

.dialog-header h2 {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--color-text);
}

.dialog-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-out);
}

.dialog-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

/* ================================================
   DIALOG BODY
   ================================================ */
.dialog-body {
  padding: 0 var(--space-xl);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* ================================================
   FORM FIELD
   ================================================ */
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.field-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text-secondary);
}

.field-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.field-input {
  width: 100%;
  padding: var(--space-md) var(--space-md);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  transition: all var(--duration-fast) var(--ease-out);
  outline: none;
}

.field-input:focus {
  border-color: var(--color-gradient-end);
  box-shadow: 0 0 0 3px var(--color-accent-subtle);
}

.field-input.error {
  border-color: var(--color-danger);
}

.field-input::placeholder {
  color: var(--color-text-muted);
}

.field-textarea {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.field-error {
  font-size: var(--text-xs);
  color: var(--color-danger);
}

.field-hint {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.field-preview {
  display: flex;
  justify-content: center;
  padding-top: var(--space-sm);
}

.field-preview img {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  object-fit: cover;
  border: 1px solid var(--color-border);
}

/* ================================================
   PASSWORD INPUT
   ================================================ */
.password-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-input {
  padding-right: 40px;
}

.password-toggle {
  position: absolute;
  right: 8px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-out);
}

.password-toggle:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

/* ================================================
   FETCH BUTTON
   ================================================ */
.fetch-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.fetch-btn:hover:not(:disabled) {
  border-color: var(--color-gradient-end);
  color: var(--color-gradient-end);
  background: var(--color-accent-subtle);
}

.fetch-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ================================================
   CHECKBOX
   ================================================ */
.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
}

.checkbox-input {
  position: absolute;
  opacity: 0;
}

.checkbox-mark {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-out);
}

.checkbox-mark svg {
  opacity: 0;
  color: white;
}

.checkbox-input:checked + .checkbox-mark {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.checkbox-input:checked + .checkbox-mark svg {
  opacity: 1;
}

.checkbox-text {
  font-size: var(--text-sm);
  color: var(--color-text);
}

/* ================================================
   DIALOG FOOTER
   ================================================ */
.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-lg) var(--space-xl);
  border-top: 1px solid var(--color-border);
  margin-top: var(--space-lg);
}

.footer-right {
  display: flex;
  gap: var(--space-sm);
}

/* ================================================
   BUTTONS
   ================================================ */
.btn {
  padding: var(--space-md) var(--space-xl);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.btn:active {
  transform: scale(0.97);
}

.btn-secondary {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
}

.btn-secondary:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.btn-primary {
  background: var(--gradient-brand);
  color: white;
}

.btn-primary:hover {
  background: var(--gradient-brand);
  filter: brightness(1.1);
  box-shadow: 0 2px 8px var(--color-accent-subtle);
}

.btn-danger {
  background: var(--color-danger-subtle);
  color: var(--color-danger);
}

.btn-danger:hover {
  background: var(--color-danger);
  color: white;
}
</style>
