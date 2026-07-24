// GitHub 设备流程（登录/绑定）状态管理和轮询逻辑

import { computed, ref, type Ref } from 'vue'
import {
  getGithubBindingStatus,
  pollGithubDeviceBind,
  pollGithubDeviceLogin,
  startGithubDeviceBind,
  startGithubDeviceLogin,
} from '../../../../api/auth'
import { HttpClientError } from '../../../../api/httpClient'
import type { GitHubBindingState, GitHubBindingStatus, GitHubDeviceFlowState } from '../../../../types/auth'
import type { GitHubDeviceStartResponse, AuthUser } from '../../../../types/auth'
import { getErrorMessage } from '../shared'

// 创建空的 GitHub 绑定状态
function createEmptyGithubBindingState(): GitHubBindingState {
  return {
    loading: false,
    loaded: false,
    supported: true,
    bound: false,
    provider: null,
    login: null,
    errorMessage: '',
  }
}

// 创建空的 GitHub 设备流程状态
function createEmptyGithubDeviceFlowState(): GitHubDeviceFlowState {
  return {
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
  }
}

// 将 API 响应转换为 GitHub 绑定状态
function toGithubBindingState(binding: GitHubBindingStatus): GitHubBindingState {
  return {
    loading: false,
    loaded: true,
    supported: true,
    bound: !!binding.bound,
    provider: binding.provider || null,
    login: binding.login || null,
    errorMessage: '',
  }
}

/**
 * 检查 GitHub 设备流程过期时间戳是否已过期
 */
function isExpiredAt(expiresAt: string): boolean {
  const expiresTime = new Date(expiresAt).getTime()
  return Number.isFinite(expiresTime) && Date.now() >= expiresTime
}

export function useGithubDeviceFlow(options: {
  authToken: Ref<string>
  currentUser: Ref<AuthUser | null>
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  onLoginSuccess: (token: string, user: AuthUser) => void
}) {
  const githubBinding = ref<GitHubBindingState>(createEmptyGithubBindingState())
  const githubDeviceFlow = ref<GitHubDeviceFlowState>(createEmptyGithubDeviceFlowState())
  // 设备流程是否正在进行中
  const isGithubDeviceFlowBusy = computed(
    () => githubDeviceFlow.value.phase === 'starting' || githubDeviceFlow.value.phase === 'polling',
  )

  let githubDeviceFlowTimer: number | null = null
  let githubDeviceFlowPolling = false

  /**
   * 清除 GitHub 设备流程轮询定时器
   */
  function clearGithubDeviceFlowTimer(): void {
    if (githubDeviceFlowTimer !== null) {
      window.clearTimeout(githubDeviceFlowTimer)
      githubDeviceFlowTimer = null
    }
  }

  /**
   * 重置 GitHub 绑定状态为空
   */
  function resetGithubBindingState(): void {
    githubBinding.value = createEmptyGithubBindingState()
  }

  /**
   * 重置 GitHub 设备流程状态为空闲
   */
  function resetGithubDeviceFlowState(): void {
    clearGithubDeviceFlowTimer()
    githubDeviceFlowPolling = false
    githubDeviceFlow.value = createEmptyGithubDeviceFlowState()
  }

  /**
   * 将设备流程设置为错误状态并显示消息
   */
  function setGithubDeviceFlowError(message: string): void {
    clearGithubDeviceFlowTimer()
    githubDeviceFlowPolling = false
    githubDeviceFlow.value = {
      ...githubDeviceFlow.value,
      phase: 'error',
      errorMessage: message,
    }
  }

  /**
   * 将设备流程设置为过期状态
   */
  function setGithubDeviceFlowExpired(): void {
    clearGithubDeviceFlowTimer()
    githubDeviceFlowPolling = false
    githubDeviceFlow.value = {
      ...githubDeviceFlow.value,
      phase: 'expired',
      errorMessage: 'GitHub 授权已过期，请重新发起',
    }
  }

  /**
   * 获取当前设备流程的验证 URL
   * 优先使用完整 URL（如果可用）
   */
  function getGithubVerificationUrl(): string {
    return githubDeviceFlow.value.verificationUriComplete || githubDeviceFlow.value.verificationUri
  }

  /**
   * 在外部浏览器中打开 GitHub 验证页面
   * 如果宿主不支持此操作，则显示错误消息
   */
  function openGithubVerificationPage(params: { notifyOnUnsupported?: boolean } = {}): void {
    const verificationUrl = getGithubVerificationUrl()
    if (!verificationUrl) {
      options.notifyError('未获取到 GitHub 授权地址')
      return
    }

    if (typeof window.ztools?.shellOpenExternal === 'function') {
      window.ztools.shellOpenExternal(verificationUrl)
      return
    }

    if (params.notifyOnUnsupported) {
      options.notifyError('当前环境不支持自动打开浏览器，请手动访问下方授权地址')
    }
  }

  /**
   * 将启动响应应用到设备流程状态
   */
  function applyGithubDeviceFlowStart(
    purpose: 'login' | 'bind',
    response: GitHubDeviceStartResponse,
  ): void {
    githubDeviceFlow.value = {
      purpose,
      phase: 'polling',
      deviceSessionId: response.deviceSessionId,
      userCode: response.userCode,
      verificationUri: response.verificationUri,
      verificationUriComplete: response.verificationUriComplete || response.verificationUri,
      expiresAt: response.expiresAt,
      interval: response.interval,
      retryAfterSeconds: response.interval,
      errorMessage: '',
    }
  }

  /**
   * 安排在指定延迟后进行下一次设备流程轮询
   */
  function scheduleGithubDeviceFlowPoll(delaySeconds: number): void {
    clearGithubDeviceFlowTimer()

    if (
      githubDeviceFlow.value.phase !== 'polling' ||
      !githubDeviceFlow.value.deviceSessionId ||
      !githubDeviceFlow.value.purpose
    ) {
      return
    }

    githubDeviceFlowTimer = window.setTimeout(() => {
      void pollActiveGithubDeviceFlow()
    }, Math.max(1, delaySeconds) * 1000)
  }

  /**
   * 轮询 GitHub 设备流程端点以检查完成状态
   * 处理登录和绑定流程，待处理状态时自动重试
   */
  async function pollActiveGithubDeviceFlow(): Promise<void> {
    if (githubDeviceFlowPolling) {
      return
    }

    const deviceFlowState = githubDeviceFlow.value
    if (
      deviceFlowState.phase !== 'polling' ||
      !deviceFlowState.deviceSessionId ||
      !deviceFlowState.purpose
    ) {
      return
    }

    // 检查是否已过期
    if (isExpiredAt(deviceFlowState.expiresAt)) {
      setGithubDeviceFlowExpired()
      return
    }

    githubDeviceFlowPolling = true

    try {
      // 处理登录流程
      if (deviceFlowState.purpose === 'login') {
        const response = await pollGithubDeviceLogin({
          deviceSessionId: deviceFlowState.deviceSessionId,
        })

        if (response.status === 'pending') {
          // 更新状态并继续轮询
          githubDeviceFlow.value = {
            ...githubDeviceFlow.value,
            phase: 'polling',
            retryAfterSeconds: response.retryAfterSeconds,
            expiresAt: response.expiresAt,
            errorMessage: '',
          }

          if (isExpiredAt(response.expiresAt)) {
            setGithubDeviceFlowExpired()
            return
          }

          scheduleGithubDeviceFlowPoll(response.retryAfterSeconds)
          return
        }

        // 登录成功
        options.onLoginSuccess(response.token, response.user)
        await refreshGithubBindingStatus({ silent: true })
        resetGithubDeviceFlowState()
        options.notifySuccess(`GitHub 登录成功，欢迎 ${response.user.username}`)
        return
      }

      // 处理绑定流程
      const response = await pollGithubDeviceBind({
        deviceSessionId: deviceFlowState.deviceSessionId,
      })

      if (response.status === 'pending') {
        githubDeviceFlow.value = {
          ...githubDeviceFlow.value,
          phase: 'polling',
          retryAfterSeconds: response.retryAfterSeconds,
          expiresAt: response.expiresAt,
          errorMessage: '',
        }

        if (isExpiredAt(response.expiresAt)) {
          setGithubDeviceFlowExpired()
          return
        }

        scheduleGithubDeviceFlowPoll(response.retryAfterSeconds)
        return
      }

      // 绑定成功
      githubBinding.value = toGithubBindingState(response.binding)
      resetGithubDeviceFlowState()
      options.notifySuccess('GitHub 已绑定')
    } catch (error) {
      setGithubDeviceFlowError(
        getErrorMessage(
          error,
          deviceFlowState.purpose === 'login' ? 'GitHub 登录失败' : 'GitHub 绑定失败',
        ),
      )
    } finally {
      githubDeviceFlowPolling = false
    }
  }

  /**
   * 刷新当前用户的 GitHub 绑定状态
   */
  async function refreshGithubBindingStatus(params: { silent?: boolean } = {}): Promise<void> {
    if (!options.authToken.value || !options.currentUser.value) {
      resetGithubBindingState()
      return
    }

    githubBinding.value = {
      ...githubBinding.value,
      loading: true,
      errorMessage: '',
    }

    try {
      const binding = await getGithubBindingStatus()
      githubBinding.value = toGithubBindingState(binding)
    } catch (error) {
      const message = getErrorMessage(error, '获取 GitHub 绑定状态失败')
      // 处理不支持绑定的错误
      if (error instanceof HttpClientError && (error.status === 403 || error.status === 404)) {
        githubBinding.value = {
          loading: false,
          loaded: true,
          supported: false,
          bound: false,
          provider: null,
          login: null,
          errorMessage: message,
        }
        if (!params.silent) {
          options.notifyError(message)
        }
        return
      }

      githubBinding.value = {
        ...githubBinding.value,
        loading: false,
        loaded: true,
        supported: true,
        bound: false,
        provider: null,
        login: null,
        errorMessage: message,
      }

      if (!params.silent) {
        options.notifyError(message)
      }
    }
  }

  /**
   * 启动 GitHub 设备流程（登录或绑定）
   */
  async function startGithubDeviceFlow(purpose: 'login' | 'bind'): Promise<void> {
    if (githubDeviceFlow.value.phase === 'starting' || githubDeviceFlow.value.phase === 'polling') {
      return
    }

    githubDeviceFlow.value = {
      ...createEmptyGithubDeviceFlowState(),
      purpose,
      phase: 'starting',
    }

    try {
      const response =
        purpose === 'login' ? await startGithubDeviceLogin() : await startGithubDeviceBind()
      applyGithubDeviceFlowStart(purpose, response)
      openGithubVerificationPage()
      scheduleGithubDeviceFlowPoll(response.interval)
    } catch (error) {
      const message = getErrorMessage(
        error,
        purpose === 'login' ? '发起 GitHub 登录失败' : '发起 GitHub 绑定失败',
      )

      // 处理不支持绑定的错误
      if (purpose === 'bind' && error instanceof HttpClientError && (error.status === 403 || error.status === 404)) {
        githubBinding.value = {
          loading: false,
          loaded: true,
          supported: false,
          bound: false,
          provider: null,
          login: null,
          errorMessage: message,
        }
      }

      setGithubDeviceFlowError(message)
      options.notifyError(message)
    }
  }

  /**
   * 处理 GitHub 登录流程启动
   */
  async function handleGithubLogin(): Promise<void> {
    await startGithubDeviceFlow('login')
  }

  /**
   * 处理 GitHub 绑定流程启动
   * 需要用户先登录
   */
  async function handleGithubBind(requireShopLogin: (actionLabel: string) => boolean): Promise<void> {
    if (!requireShopLogin('绑定 GitHub')) {
      return
    }

    if (githubBinding.value.bound) {
      options.notifySuccess(
        githubBinding.value.login ? `GitHub 已绑定：${githubBinding.value.login}` : 'GitHub 已绑定',
      )
      return
    }

    await startGithubDeviceFlow('bind')
  }

  /**
   * 取消活动的 GitHub 设备流程
   */
  function handleCancelGithubDeviceFlow(): void {
    resetGithubDeviceFlowState()
  }

  /**
   * 打开 GitHub 验证页面，如果不支持则显示用户错误
   */
  function handleOpenGithubVerificationPage(): void {
    openGithubVerificationPage({ notifyOnUnsupported: true })
  }

  return {
    githubBinding,
    githubDeviceFlow,
    isGithubDeviceFlowBusy,
    refreshGithubBindingStatus,
    resetGithubBindingState,
    resetGithubDeviceFlowState,
    handleGithubLogin,
    handleGithubBind,
    handleCancelGithubDeviceFlow,
    handleOpenGithubVerificationPage,
  }
}
