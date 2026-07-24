<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ZButton, ZInput, ZModal, ZPopover } from 'ztools-ui'
import type {
  AuthUser,
  GitHubBindingState,
  GitHubDeviceFlowState,
  LoginRequest,
  RegisterRequest,
  UpdateUsernameRequest,
} from '../../types/auth'
import { getCaptcha } from '../../api/auth'

const props = withDefaults(
  defineProps<{
    currentUser: AuthUser | null
    avatarUrl?: string
    isRestoringSession?: boolean
    isLoggingIn?: boolean
    isRegistering?: boolean
    isUpdatingUsername?: boolean
    isUpdatingPassword?: boolean
    isUploadingAvatar?: boolean
    githubBinding?: GitHubBindingState
    githubDeviceFlow?: GitHubDeviceFlowState
    isGithubDeviceFlowBusy?: boolean
  }>(),
  {
    avatarUrl: '',
    isRestoringSession: false,
    isLoggingIn: false,
    isRegistering: false,
    isUpdatingUsername: false,
    isUpdatingPassword: false,
    isUploadingAvatar: false,
    githubBinding: () => ({
      loading: false,
      loaded: false,
      supported: true,
      bound: false,
      provider: null,
      login: null,
      errorMessage: '',
    }),
    githubDeviceFlow: () => ({
      purpose: null,
      phase: 'idle',
      deviceSessionId: '',
      userCode: '',
      verificationUri: '',
      verificationUriComplete: '',
      expiresAt: '',
      interval: 5,
      retryAfterSeconds: 5,
      errorMessage: '',
    }),
    isGithubDeviceFlowBusy: false,
  },
)

const emit = defineEmits<{
  (e: 'login', payload: LoginRequest): void
  (e: 'register', payload: RegisterRequest): void
  (e: 'logout'): void
  (e: 'update-username', payload: UpdateUsernameRequest): void
  (e: 'update-password', payload: { currentPassword?: string; newPassword: string }): void
  (e: 'upload-avatar', file: File): void
  (e: 'github-login'): void
  (e: 'github-bind'): void
  (e: 'github-open-verification'): void
  (e: 'github-cancel-device-flow'): void
}>()

type AuthMode = 'login' | 'register'

const authMode = ref<AuthMode>('login')
const loginAccount = ref('')
const loginPassword = ref('')
const registerAccount = ref('')
const registerUsername = ref('')
const registerPassword = ref('')
const usernameDraft = ref('')
const currentPasswordDraft = ref('')
const newPasswordDraft = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const isUsernameModalOpen = ref(false)
const isPasswordModalOpen = ref(false)
const isAvatarModalOpen = ref(false)
const captchaToken = ref('')
const captchaImage = ref('')
const captchaCode = ref('')
const isCaptchaLoading = ref(false)

const busy = computed(
  () =>
    props.isRestoringSession ||
    props.isLoggingIn ||
    props.isRegistering ||
    props.isUpdatingUsername ||
    props.isUpdatingPassword ||
    props.isUploadingAvatar ||
    props.isGithubDeviceFlowBusy,
)

const isGithubBindingPending = computed(
  () => props.githubBinding.loading || (props.isGithubDeviceFlowBusy && props.githubDeviceFlow.purpose === 'bind'),
)

const githubBindingActionTitle = computed(() => {
  if (props.githubBinding.loading) {
    return '正在获取 GitHub 绑定状态'
  }

  if (props.isGithubDeviceFlowBusy && props.githubDeviceFlow.purpose === 'bind') {
    return 'GitHub 绑定中...'
  }

  if (!props.githubBinding.supported) {
    return props.githubBinding.errorMessage || '当前环境不支持 GitHub 绑定'
  }

  if (props.githubBinding.bound) {
    return props.githubBinding.login ? `GitHub 已绑定：${props.githubBinding.login}` : 'GitHub 已绑定'
  }

  if (props.githubBinding.errorMessage) {
    return `${props.githubBinding.errorMessage}，点击重试绑定`
  }

  return '绑定 GitHub'
})

const githubBindingActionDisabled = computed(
  () => busy.value || isGithubBindingPending.value || !props.githubBinding.supported,
)

const githubFlowTitle = computed(() => {
  if (props.githubDeviceFlow.purpose === 'bind') {
    return 'GitHub 绑定'
  }

  return 'GitHub 登录 / 注册'
})

const githubFlowDescription = computed(() => {
  if (props.githubDeviceFlow.purpose === 'bind') {
    return '请在浏览器完成 GitHub 授权，授权成功后会自动绑定到当前账号。'
  }

  return '请在浏览器完成 GitHub 授权。首次 GitHub 登录会自动注册本地账号。'
})

const githubFlowStatusText = computed(() => {
  if (props.githubDeviceFlow.phase === 'starting') {
    return '正在向服务器申请设备码...'
  }

  if (props.githubDeviceFlow.phase === 'polling') {
    return '等待 GitHub 授权中，请在浏览器完成操作。'
  }

  if (props.githubDeviceFlow.phase === 'expired') {
    return '当前授权已过期，请重新发起。'
  }

  if (props.githubDeviceFlow.phase === 'error') {
    return props.githubDeviceFlow.errorMessage || 'GitHub 授权失败，请稍后重试。'
  }

  return ''
})

const githubVerificationUrl = computed(
  () => props.githubDeviceFlow.verificationUriComplete || props.githubDeviceFlow.verificationUri,
)

const githubVerificationExpiresText = computed(() => {
  if (!props.githubDeviceFlow.expiresAt) {
    return '-'
  }

  const expiresAt = new Date(props.githubDeviceFlow.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) {
    return '-'
  }

  return expiresAt.toLocaleString('zh-CN', {
    hour12: false,
  })
})

const joinedAtText = computed(() => {
  if (!props.currentUser?.createdAt) {
    return '-'
  }

  return new Date(props.currentUser.createdAt).toLocaleString('zh-CN', {
    hour12: false,
  })
})

const avatarFallbackText = computed(() => {
  const source = props.currentUser?.username || props.currentUser?.account || 'U'
  return source.slice(0, 1).toUpperCase()
})

watch(
  () => props.currentUser?.username,
  (value) => {
    usernameDraft.value = value || ''
  },
  { immediate: true },
)

watch(
  () => props.isUpdatingUsername,
  (value, previousValue) => {
    if (previousValue && !value) {
      isUsernameModalOpen.value = false
    }
  },
)

watch(
  () => props.isUpdatingPassword,
  (value, previousValue) => {
    if (previousValue && !value) {
      closePasswordModal()
    }
  },
)

watch(
  () => props.isUploadingAvatar,
  (value, previousValue) => {
    if (previousValue && !value) {
      isAvatarModalOpen.value = false
    }
  },
)

async function refreshCaptcha(): Promise<void> {
  isCaptchaLoading.value = true
  try {
    const res = await getCaptcha()
    captchaToken.value = res.captchaToken
    captchaImage.value = res.image
    captchaCode.value = ''
  } catch {
    // 验证码获取失败不阻塞，用户可点击刷新重试
  } finally {
    isCaptchaLoading.value = false
  }
}

// 切换到登录/注册 tab 时自动获取验证码
watch(authMode, (mode) => {
  if (!captchaToken.value) {
    void refreshCaptcha()
  }
}, { immediate: true })

// 登录失败后自动刷新验证码（验证码一旦提交即失效）
watch(() => props.isLoggingIn, (busy, wasBusy) => {
  if (wasBusy && !busy && !props.currentUser) {
    void refreshCaptcha()
  }
})

// 注册失败后自动刷新验证码
watch(() => props.isRegistering, (busy, wasBusy) => {
  if (wasBusy && !busy && !props.currentUser) {
    void refreshCaptcha()
  }
})

// 登录成功后清空验证码（已失效）
watch(() => props.currentUser, (user) => {
  if (user) {
    captchaToken.value = ''
    captchaImage.value = ''
    captchaCode.value = ''
  }
})

function submitLogin(): void {
  emit('login', {
    account: loginAccount.value.trim(),
    password: loginPassword.value,
    captchaToken: captchaToken.value,
    captchaCode: captchaCode.value.trim(),
  })
  // 提交后验证码即失效，立即清空 token 防止二次使用
  captchaToken.value = ''
  captchaImage.value = ''
}

function submitRegister(): void {
  emit('register', {
    account: registerAccount.value.trim(),
    username: registerUsername.value.trim(),
    password: registerPassword.value,
    captchaToken: captchaToken.value,
    captchaCode: captchaCode.value.trim(),
  })
  // 提交后验证码即失效，立即清空 token 防止二次使用
  captchaToken.value = ''
  captchaImage.value = ''
}

function submitUsernameUpdate(): void {
  emit('update-username', {
    username: usernameDraft.value.trim(),
  })
}

function resetPasswordDraft(): void {
  currentPasswordDraft.value = ''
  newPasswordDraft.value = ''
}

function submitPasswordUpdate(): void {
  emit('update-password', {
    currentPassword: currentPasswordDraft.value,
    newPassword: newPasswordDraft.value,
  })
}

function openUsernameModal(): void {
  usernameDraft.value = props.currentUser?.username || ''
  isUsernameModalOpen.value = true
}

function closeUsernameModal(): void {
  isUsernameModalOpen.value = false
}

function openPasswordModal(): void {
  resetPasswordDraft()
  isPasswordModalOpen.value = true
}

function closePasswordModal(): void {
  isPasswordModalOpen.value = false
  resetPasswordDraft()
}

function triggerAvatarSelect(): void {
  avatarInput.value?.click()
}

function openAvatarModal(): void {
  isAvatarModalOpen.value = true
}

function closeAvatarModal(): void {
  isAvatarModalOpen.value = false
}

function handleGithubDeviceFlowModalShowUpdate(value: boolean): void {
  if (!value) {
    emit('github-cancel-device-flow')
  }
}

function handleAvatarChange(event: Event): void {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]

  if (file) {
    emit('upload-avatar', file)
  }

  if (target) {
    target.value = ''
  }
}
</script>

<template>
  <div class="account-panel">
    <ZModal
      :show="githubDeviceFlow.phase !== 'idle'"
      to="body"
      :mask-closable="true"
      @update:show="handleGithubDeviceFlowModalShowUpdate"
    >
      <div class="dialog-card dialog-card--github">
        <div class="dialog-header">
          <div>
            <h3 class="dialog-title">{{ githubFlowTitle }}</h3>
            <p class="dialog-description">{{ githubFlowDescription }}</p>
          </div>
        </div>

        <div class="github-code-box">{{ githubDeviceFlow.userCode || '---- ----' }}</div>

        <div class="github-flow-meta">
          <div><span>授权地址</span><span>{{ githubVerificationUrl || '-' }}</span></div>
          <div><span>过期时间</span><span>{{ githubVerificationExpiresText }}</span></div>
        </div>

        <div class="github-flow-status">{{ githubFlowStatusText }}</div>

        <div class="action-row github-flow-actions">
          <ZButton type="primary" :disabled="!githubVerificationUrl" @click="emit('github-open-verification')">
            打开 GitHub 授权页
          </ZButton>
          <ZButton
            v-if="githubDeviceFlow.phase === 'error' || githubDeviceFlow.phase === 'expired'"
            :disabled="busy"
            @click="githubDeviceFlow.purpose === 'bind' ? emit('github-bind') : emit('github-login')"
          >
            重新发起
          </ZButton>
          <ZButton @click="emit('github-cancel-device-flow')">
            取消
          </ZButton>
        </div>
      </div>
    </ZModal>

    <template v-if="currentUser">
      <div class="panel-card profile-card">
        <div class="profile-header">
          <div class="profile-identity-row">
            <button class="profile-avatar-wrap" type="button" :disabled="busy" @click="openAvatarModal">
              <img v-if="avatarUrl" :src="avatarUrl" alt="头像" class="profile-avatar" />
              <div v-else class="profile-avatar profile-avatar--fallback">{{ avatarFallbackText }}</div>
            </button>

            <div class="profile-main">
              <div class="profile-name-row">
                <ZPopover trigger="hover" placement="top" show-arrow>
                  <template #trigger>
                    <span class="popover-trigger-inline">
                      <button
                        class="profile-name-btn"
                        type="button"
                        :disabled="busy"
                        aria-label="编辑用户名"
                        @click="openUsernameModal"
                      >
                        <span class="profile-name">{{ currentUser.username }}</span>
                      </button>
                    </span>
                  </template>
                  <span>点击修改用户名</span>
                </ZPopover>
                <span class="profile-badge">已登录</span>
                <ZPopover trigger="hover" placement="top" show-arrow>
                  <template #trigger>
                    <span class="popover-trigger-inline">
                      <button
                        class="profile-password-btn"
                        type="button"
                        :disabled="busy"
                        aria-label="修改密码"
                        @click="openPasswordModal"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><!-- Icon from Solar by 480 Design - https://creativecommons.org/licenses/by/4.0/ --><g fill="none" stroke="currentColor"><path stroke-width="1.5" d="M2 16c0-2.828 0-4.243.879-5.121C3.757 10 5.172 10 8 10h8c2.828 0 4.243 0 5.121.879C22 11.757 22 13.172 22 16s0 4.243-.879 5.121C20.243 22 18.828 22 16 22H8c-2.828 0-4.243 0-5.121-.879C2 20.243 2 18.828 2 16Z"/><path stroke-linecap="round" stroke-width="1.5" d="M6 10V8a6 6 0 0 1 11.811-1.5"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16h.009m3.982 0H12m3.991 0H16"/></g></svg>
                      </button>
                    </span>
                  </template>
                  <span>修改密码</span>
                </ZPopover>
                <ZPopover trigger="hover" placement="top" show-arrow>
                  <template #trigger>
                    <span class="popover-trigger-inline">
                      <button
                        class="profile-github-btn"
                        :class="{ 'profile-github-btn--bound': githubBinding.bound }"
                        type="button"
                        :disabled="githubBindingActionDisabled"
                        :aria-label="githubBindingActionTitle"
                        @click="emit('github-bind')"
                      >
                        <svg class="profile-github-icon" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.426 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.866-.013-1.7-2.782.605-3.369-1.344-3.369-1.344-.455-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.004.07 1.531 1.033 1.531 1.033.892 1.53 2.341 1.088 2.91.832.091-.647.349-1.088.635-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.026 2.748-1.026.546 1.378.202 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .269.18.58.688.481A10.019 10.019 0 0 0 22 12.017C22 6.484 17.523 2 12 2Z"
                          />
                        </svg>
                        <span v-if="isGithubBindingPending" class="profile-action-dot profile-action-dot--pending" aria-hidden="true"></span>
                        <span v-else-if="githubBinding.bound" class="profile-action-dot profile-action-dot--success" aria-hidden="true"></span>
                        <span
                          v-else-if="githubBinding.errorMessage"
                          class="profile-action-dot profile-action-dot--error"
                          aria-hidden="true"
                        ></span>
                      </button>
                    </span>
                  </template>
                  <span>{{ githubBindingActionTitle }}</span>
                </ZPopover>
              </div>
              <div class="profile-account">账号：{{ currentUser.account }}</div>
              <div class="profile-meta">注册时间：{{ joinedAtText }}</div>
              <div v-if="githubBinding.errorMessage && !githubBinding.bound" class="profile-github-hint">
                {{ githubBinding.errorMessage }}
              </div>
            </div>
          </div>

          <ZButton class="profile-logout-btn" :disabled="busy" @click="emit('logout')">
            退出登录
          </ZButton>
        </div>
      </div>

      <input
        ref="avatarInput"
        class="file-input"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        @change="handleAvatarChange"
      />

      <Teleport to="body">
        <div v-if="isUsernameModalOpen" class="dialog-mask" @click.self="closeUsernameModal">
          <div class="dialog-card card">
            <div class="dialog-header">
              <div>
                <h3 class="dialog-title">修改用户名</h3>
                <p class="dialog-description">输入新的显示名称后保存。</p>
              </div>
              <button class="dialog-close" type="button" :disabled="busy" @click="closeUsernameModal">×</button>
            </div>

            <label class="field-label" for="username-modal-input">用户名</label>
            <ZInput
              id="username-modal-input"
              v-model="usernameDraft"
              class="text-input"
              type="text"
              :maxlength="50"
              :disabled="busy"
              placeholder="输入新的显示名称"
            />

            <div class="action-row action-row--end">
              <ZButton :disabled="busy" @click="closeUsernameModal">取消</ZButton>
              <ZButton type="primary" :disabled="busy" :loading="isUpdatingUsername" @click="submitUsernameUpdate">
                保存用户名
              </ZButton>
            </div>
          </div>
        </div>
      </Teleport>

      <ZModal
        :show="isPasswordModalOpen"
        to="body"
        :mask-closable="true"
        @update:show="(value) => !value && closePasswordModal()"
      >
        <div class="dialog-card dialog-card--password">
          <div class="dialog-header">
            <div>
              <h3 class="dialog-title">修改密码</h3>
              <p class="dialog-description">
                若账号已设置密码，请填写当前密码<br />首次通过 GitHub 登录且尚未设置本地密码时可留空
              </p>
            </div>
            <button class="dialog-close" type="button" :disabled="busy" @click="closePasswordModal">×</button>
          </div>

          <label class="field-label" for="password-current-modal-input">原密码</label>
          <ZInput
            id="password-current-modal-input"
            v-model="currentPasswordDraft"
            class="text-input"
            type="password"
            :maxlength="72"
            :disabled="busy"
            placeholder="如已设置密码，请输入原密码"
          />

          <label class="field-label" for="password-new-modal-input">新密码</label>
          <ZInput
            id="password-new-modal-input"
            v-model="newPasswordDraft"
            class="text-input"
            type="password"
            :maxlength="72"
            :disabled="busy"
            placeholder="请输入新密码"
            @keydown.enter="submitPasswordUpdate"
          />

          <div class="action-row action-row--end">
            <ZButton :disabled="busy" @click="closePasswordModal">取消</ZButton>
            <ZButton type="primary" :disabled="busy" :loading="isUpdatingPassword" @click="submitPasswordUpdate">
              保存密码
            </ZButton>
          </div>
        </div>
      </ZModal>

      <Teleport to="body">
        <div v-if="isAvatarModalOpen" class="dialog-mask" @click.self="closeAvatarModal">
          <div class="dialog-card card">
            <div class="dialog-header">
              <div>
                <h3 class="dialog-title">上传头像</h3>
                <p class="dialog-description">选择 jpeg/png/gif/webp 文件，大小不超过 5MB。</p>
              </div>
              <button class="dialog-close" type="button" :disabled="busy" @click="closeAvatarModal">×</button>
            </div>

            <div class="dialog-avatar-preview">
              <img v-if="avatarUrl" :src="avatarUrl" alt="头像预览" class="profile-avatar" />
              <div v-else class="profile-avatar profile-avatar--fallback">{{ avatarFallbackText }}</div>
            </div>

            <div class="action-row action-row--end">
              <ZButton :disabled="busy" @click="closeAvatarModal">取消</ZButton>
              <ZButton type="primary" :disabled="busy" :loading="isUploadingAvatar" @click="triggerAvatarSelect">
                选择头像文件
              </ZButton>
            </div>
          </div>
        </div>
      </Teleport>
    </template>

    <template v-else>
      <div class="panel-card auth-card">
        <div class="auth-tabs" :style="{ '--auth-slider-index': authMode === 'login' ? '0' : '1' }">
          <div class="auth-tab-slider" aria-hidden="true"></div>
          <div
            class="auth-tab"
            :class="{ active: authMode === 'login' }"
            :disabled="busy"
            @click="authMode = 'login'"
          >
            登录
          </div>
          <div
            class="auth-tab"
            :class="{ active: authMode === 'register' }"
            :disabled="busy"
            @click="authMode = 'register'"
          >
            注册
          </div>
        </div>

        <div v-if="isRestoringSession" class="auth-status">正在恢复登录状态...</div>

        <template v-if="authMode === 'login'">
          <label class="field-label" for="login-account">账号</label>
          <ZInput
            id="login-account"
            v-model="loginAccount"
            class="text-input"
            type="text"
            :maxlength="50"
            :disabled="busy"
            placeholder="输入注册账号"
          />

          <label class="field-label" for="login-password">密码</label>
          <ZInput
            id="login-password"
            v-model="loginPassword"
            class="text-input"
            type="password"
            :maxlength="72"
            :disabled="busy"
            placeholder="输入密码"
            @keydown.enter="submitLogin"
          />

          <label class="field-label" for="login-captcha">验证码</label>
          <div class="captcha-row">
            <ZInput
              id="login-captcha"
              v-model="captchaCode"
              class="text-input captcha-input"
              type="text"
              :maxlength="10"
              :disabled="busy"
              placeholder="计算结果"
              @keydown.enter="submitLogin"
            />
            <ZPopover trigger="hover" placement="top" show-arrow>
              <template #trigger>
                <span class="popover-trigger-inline">
                  <button
                    class="captcha-image-btn"
                    type="button"
                    :disabled="isCaptchaLoading"
                    aria-label="点击刷新验证码"
                    @click="refreshCaptcha"
                  >
                    <img
                      v-if="captchaImage && !isCaptchaLoading"
                      :src="captchaImage"
                      alt="验证码"
                      class="captcha-image"
                    />
                    <span v-else class="captcha-placeholder">...</span>
                  </button>
                </span>
              </template>
              <span>点击刷新验证码</span>
            </ZPopover>
          </div>

          <div class="action-row action-row--end auth-login-actions">
            <ZButton
              class="github-login-btn"
              :disabled="busy"
              @click="emit('github-login')"
            >
              <svg class="github-login-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.426 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.866-.013-1.7-2.782.605-3.369-1.344-3.369-1.344-.455-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.004.07 1.531 1.033 1.531 1.033.892 1.53 2.341 1.088 2.91.832.091-.647.349-1.088.635-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.026 2.748-1.026.546 1.378.202 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .269.18.58.688.481A10.019 10.019 0 0 0 22 12.017C22 6.484 17.523 2 12 2Z"
                />
              </svg>
              <span>
                {{ isGithubDeviceFlowBusy && githubDeviceFlow.purpose === 'login' ? 'GitHub 登录中...' : 'GitHub 登录' }}
              </span>
            </ZButton>
            <ZButton type="primary" :disabled="busy" :loading="isLoggingIn" @click="submitLogin">
              立即登录
            </ZButton>
          </div>
        </template>

        <template v-else>
          <label class="field-label" for="register-account">账号</label>
          <ZInput
            id="register-account"
            v-model="registerAccount"
            class="text-input"
            type="text"
            :maxlength="50"
            :disabled="busy"
            placeholder="3-50 字符，仅字母/数字/_/-"
          />

          <label class="field-label" for="register-username">用户名</label>
          <ZInput
            id="register-username"
            v-model="registerUsername"
            class="text-input"
            type="text"
            :maxlength="50"
            :disabled="busy"
            placeholder="输入显示名称"
          />

          <label class="field-label" for="register-password">密码</label>
          <ZInput
            id="register-password"
            v-model="registerPassword"
            class="text-input"
            type="password"
            :maxlength="72"
            :disabled="busy"
            placeholder="8-72 字符"
            @keydown.enter="submitRegister"
          />

          <label class="field-label" for="register-captcha">验证码</label>
          <div class="captcha-row">
            <ZInput
              id="register-captcha"
              v-model="captchaCode"
              class="text-input captcha-input"
              type="text"
              :maxlength="10"
              :disabled="busy"
              placeholder="计算结果"
              @keydown.enter="submitRegister"
            />
            <ZPopover trigger="hover" placement="top" show-arrow>
              <template #trigger>
                <span class="popover-trigger-inline">
                  <button
                    class="captcha-image-btn"
                    type="button"
                    :disabled="isCaptchaLoading"
                    aria-label="点击刷新验证码"
                    @click="refreshCaptcha"
                  >
                    <img
                      v-if="captchaImage && !isCaptchaLoading"
                      :src="captchaImage"
                      alt="验证码"
                      class="captcha-image"
                    />
                    <span v-else class="captcha-placeholder">...</span>
                  </button>
                </span>
              </template>
              <span>点击刷新验证码</span>
            </ZPopover>
          </div>

          <div class="action-row action-row--end">
            <ZButton type="primary" :disabled="busy" :loading="isRegistering" @click="submitRegister">
              立即注册
            </ZButton>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.account-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.panel-card {
  padding: 18px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--card-bg);
  backdrop-filter: blur(40px) saturate(180%);
}
.panel-eyebrow {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 700;
}

.panel-description {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.popover-trigger-inline {
  display: inline-flex;
}

.profile-card,
.auth-card,
.section-card,
.github-flow-card,
.github-entry-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.auth-card {
  flex: 1;
}

.profile-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.profile-identity-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.profile-avatar-wrap {
  display: inline-flex;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.profile-avatar-wrap:disabled {
  cursor: not-allowed;
}

.profile-avatar-wrap:focus-visible,
.profile-name-btn:focus-visible,
.profile-password-btn:focus-visible,
.profile-github-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color, #3b82f6) 22%, transparent);
}

.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  object-fit: cover;
  background: var(--surface-elevated);
}

.profile-avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-size: 28px;
  font-weight: 700;
}

.profile-main {
  flex: 1;
  min-width: 0;
}

.profile-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.profile-name {
  margin: 0;
  font-size: 20px;
  color: inherit;
}

.profile-name-btn {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  transition: color 0.2s ease;
}

.profile-name-btn:hover:not(:disabled) {
  color: var(--primary-color);
}

.profile-name-btn:disabled {
  cursor: not-allowed;
}

.profile-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--primary-light-bg);
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 700;
}

.profile-password-btn,
.profile-github-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 2px solid var(--primary-color);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.profile-password-btn:hover:not(:disabled),
.profile-github-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.profile-password-btn:disabled,
.profile-github-btn:disabled {
  cursor: not-allowed;
}

.profile-password-icon,
.profile-github-icon {
  width: 16px;
  height: 16px;
}

.profile-github-btn--bound {
  color: var(--primary-color);
}

.profile-action-dot {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 7px;
  height: 7px;
  border: 2px solid var(--surface-color, var(--card-bg));
  border-radius: 999px;
}

.profile-action-dot--pending {
  background: var(--warning-color, #f59e0b);
}

.profile-action-dot--success {
  background: var(--success-color, #22c55e);
}

.profile-action-dot--error {
  background: var(--danger-color, #ef4444);
}

.profile-account,
.profile-meta,
.profile-github-hint,
.upload-description,
.auth-status,
.section-description {
  color: var(--text-secondary);
  font-size: 13px;
}

.profile-account {
  margin-top: 6px;
}

.profile-github-hint {
  margin-top: 6px;
  color: var(--danger-color);
}

.profile-logout-btn {
  width: 100%;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.auth-tabs {
  position: relative;
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(72px, 1fr));
  width: fit-content;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--primary-color, #3b82f6) 14%, var(--divider-color));
  border-radius: 999px;
  background: var(--surface-elevated);
  isolation: isolate;
}

.auth-tab-slider {
  position: absolute;
  top: 4px;
  left: 4px;
  width: calc(50% - 4px);
  height: calc(100% - 8px);
  border-radius: 999px;
  background: var(--primary-color, #3b82f6);
  transform: translateX(calc(var(--auth-slider-index, 0) * 100%));
  transition:
    transform 0.28s ease,
    background-color 0.2s ease;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--primary-color, #3b82f6) 24%, transparent);
  z-index: 0;
}

.auth-tab {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  padding: 8px 14px;
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  transition: color 0.2s ease;
  cursor: default;
}

.auth-tab.active {
  color: var(--text-on-primary);
}

.auth-tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color, #3b82f6) 22%, transparent);
}

.field-label {
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

.text-input {
  width: 100%;
  min-height: 40px;
  padding: 10px 12px;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--bg-color);
  color: var(--text-color);
  outline: none;
}

.text-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 18%, transparent);
}

.file-input {
  display: none;
}

.captcha-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.captcha-input {
  flex: 1;
  min-width: 0;
}

.captcha-image-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  min-width: 100px;
  padding: 0;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--surface-elevated);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.captcha-image-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
}

.captcha-image-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.captcha-image {
  height: 100%;
  width: auto;
  object-fit: contain;
}

.captcha-placeholder {
  color: var(--text-secondary);
  font-size: 13px;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-row--end {
  justify-content: flex-end;
}

.auth-login-actions {
  flex-wrap: wrap;
}

.github-login-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-color);
}

.github-login-btn:hover:not(:disabled) {
  background: var(--surface-elevated);
}

.github-login-icon {
  width: 16px;
  height: 16px;
}

.github-flow-card {
  border: 1px solid color-mix(in srgb, var(--primary-color, #3b82f6) 22%, var(--divider-color));
}

.github-flow-card--error {
  border-color: color-mix(in srgb, var(--danger-color, #ef4444) 32%, var(--divider-color));
}

.github-code-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  border: 1px dashed var(--divider-color);
  border-radius: 14px;
  background: var(--surface-elevated);
  color: var(--text-color);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.github-flow-meta {
  display: grid;
  gap: 8px;
}

.github-flow-meta > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.github-flow-meta > div span:last-child {
  color: var(--text-color);
  text-align: right;
  word-break: break-all;
}

.github-flow-status {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.github-flow-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.45);
}

.dialog-card {
  width: min(420px, 80%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--divider-color);
  border-radius: 16px;
  background: var(--surface-color, var(--card-bg));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
}

.dialog-card--github {
  width: min(480px, 88vw);
}

.dialog-card--password {
  width: min(420px, calc(100vw - 40px));
  box-sizing: border-box;
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dialog-title {
  margin: 0;
  font-size: 18px;
  color: var(--text-color);
}

.dialog-description {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.dialog-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 22px;
  line-height: 1;
}

.dialog-avatar-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 0;
}

@media (max-width: 900px) {
  .account-grid {
    grid-template-columns: 1fr;
  }

  .profile-identity-row {
    align-items: flex-start;
  }

  .github-flow-meta > div {
    align-items: flex-start;
    flex-direction: column;
  }

  .github-code-box {
    font-size: 22px;
  }
}
</style>
