// Shop API 运行时配置和认证状态管理

import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { getCurrentUser } from '../../../../api/auth'
import {
  buildShopApiAssetUrl,
  clearShopApiAuth,
  loadShopApiRuntimeConfig,
  saveShopApiRuntimeConfig,
  subscribeShopApiRuntimeConfig,
} from '../../../../config/runtimeConfig'
import type { AuthUser } from '../../../../types/auth'
import type { ShopApiRuntimeConfig } from '../../../../types/runtimeConfig'
import type { GitHubBindingState } from '../../../../types/auth'
import { getErrorMessage } from '../shared'

export function useShopRuntimeConfig(options: {
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  onAuthChanged: () => Promise<void>
  onGithubBindingRefresh: () => Promise<void>
  onGithubBindingReset: () => void
  onDeviceFlowReset: () => void
}) {
  const shopApiBaseUrl = ref('http://localhost:3000')
  const authToken = ref('')
  const currentUser = ref<AuthUser | null>(null)
  const runtimeConfigLoaded = ref(false)
  const isRestoringSession = ref(false)

  // 计算当前用户头像的完整 URL
  const currentUserAvatarUrl = computed(() =>
    buildShopApiAssetUrl(currentUser.value?.avatarUrl, shopApiBaseUrl.value),
  )

  let unsubscribeRuntimeConfig: (() => void) | null = null

  /**
   * 应用来自持久化存储的运行时配置状态
   * 处理认证状态变更并触发副作用
   */
  function applyRuntimeConfigState(config: ShopApiRuntimeConfig): void {
    const previousToken = authToken.value
    const previousUserId = currentUser.value?.id || null

    shopApiBaseUrl.value = config.baseUrl
    authToken.value = config.token
    currentUser.value = config.currentUser ? { ...config.currentUser } : null

    const nextUserId = currentUser.value?.id || null
    const authChanged = previousToken !== authToken.value || previousUserId !== nextUserId

    // 如果没有认证，重置 GitHub 相关状态
    if (!authToken.value || !currentUser.value) {
      options.onGithubBindingReset()
      options.onDeviceFlowReset()
    } else if (authChanged) {
      // 认证变更时刷新 GitHub 绑定状态
      void options.onGithubBindingRefresh()
    }

    // 认证变更时触发回调
    if (authChanged) {
      void options.onAuthChanged()
    }
  }

  /**
   * 从 API 获取当前用户并更新持久化存储
   */
  async function refreshCurrentUser(params: { silent?: boolean } = {}): Promise<void> {
    if (!authToken.value) {
      return
    }

    try {
      const response = await getCurrentUser()
      saveShopApiRuntimeConfig({ currentUser: response.user })
      await options.onGithubBindingRefresh()
    } catch (error) {
      if (!params.silent) {
        options.notifyError(getErrorMessage(error, '获取当前用户失败'))
      }
    }
  }

  /**
   * 清除认证并重置所有认证相关状态
   */
  function handleLogout(): void {
    options.onGithubBindingReset()
    options.onDeviceFlowReset()
    clearShopApiAuth()
  }

  onMounted(() => {
    // 订阅运行时配置变更
    unsubscribeRuntimeConfig = subscribeShopApiRuntimeConfig(applyRuntimeConfigState)
    const runtimeConfig = loadShopApiRuntimeConfig()
    runtimeConfigLoaded.value = true

    let shouldRestoreSession = !!runtimeConfig.token

    if (typeof window !== 'undefined') {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const githubToken = hashParams.get('github_token')?.trim() || ''
      const githubError = new URLSearchParams(window.location.search).get('githubError')?.trim() || ''

      if (githubToken) {
        saveShopApiRuntimeConfig({ token: githubToken, currentUser: null })
        shouldRestoreSession = true
        options.notifySuccess('GitHub 登录成功，正在恢复账号信息')
      } else if (githubError) {
        options.notifyError(`GitHub 登录失败：${githubError}`)
      }

      if (githubToken || githubError) {
        const nextUrl = `${window.location.pathname}${window.location.search.replace(/([?&])githubError=[^&]*&?/, '$1').replace(/[?&]$/, '')}`
        window.history.replaceState(null, '', nextUrl)
      }
    }

    // 如果有令牌，恢复会话
    if (shouldRestoreSession) {
      isRestoringSession.value = true
      void refreshCurrentUser({ silent: true }).finally(() => {
        isRestoringSession.value = false
      })
    }
  })

  onUnmounted(() => {
    options.onDeviceFlowReset()
    unsubscribeRuntimeConfig?.()
  })

  return {
    shopApiBaseUrl,
    authToken,
    currentUser,
    runtimeConfigLoaded,
    isRestoringSession,
    currentUserAvatarUrl,
    refreshCurrentUser,
    handleLogout,
  }
}
