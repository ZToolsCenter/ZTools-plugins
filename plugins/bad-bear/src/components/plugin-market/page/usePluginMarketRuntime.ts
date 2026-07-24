// 运行时编排层 - 组合运行时配置、GitHub 流程和账户操作

import { type Ref } from 'vue'
import type { ActiveNav } from './shared'
import { saveShopApiRuntimeConfig } from '../../../config/runtimeConfig'
import { useShopRuntimeConfig } from './runtime/useShopRuntimeConfig'
import { useGithubDeviceFlow } from './runtime/useGithubDeviceFlow'
import { useAccountActions } from './runtime/useAccountActions'

export function usePluginMarketRuntime(options: {
  activeNav: Ref<ActiveNav>
  selectedPluginName: Ref<string | null>
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  onAuthChanged: () => Promise<void>
  onReloadMarket: () => Promise<void>
  onReloadSelectedPluginDetail: () => Promise<void>
}) {
  // GitHub 流程和账户操作需要共享认证状态管理
  let onLoginSuccessHook: ((token: string, user: import('../../../types/auth').AuthUser) => void) | null = null
  let onGithubBindingRefreshHook: (() => Promise<void>) | null = null

  // 运行时配置和认证状态
  const runtimeConfig = useShopRuntimeConfig({
    notifyError: options.notifyError,
    notifySuccess: options.notifySuccess,
    onAuthChanged: options.onAuthChanged,
    onGithubBindingRefresh: async () => {
      await onGithubBindingRefreshHook?.()
    },
    onGithubBindingReset: () => {
      githubFlow.resetGithubBindingState()
    },
    onDeviceFlowReset: () => {
      githubFlow.resetGithubDeviceFlowState()
    },
  })

  // GitHub 设备流程逻辑
  const githubFlow = useGithubDeviceFlow({
    authToken: runtimeConfig.authToken,
    currentUser: runtimeConfig.currentUser,
    notifyError: options.notifyError,
    notifySuccess: options.notifySuccess,
    onLoginSuccess: (token, user) => {
      // 保存登录结果
      saveShopApiRuntimeConfig({ token, currentUser: user })
      onLoginSuccessHook?.(token, user)
    },
  })

  // 账户操作（登录、注册、个人资料更新）
  const accountActions = useAccountActions({
    authToken: runtimeConfig.authToken,
    currentUser: runtimeConfig.currentUser,
    selectedPluginName: options.selectedPluginName,
    notifyError: options.notifyError,
    notifySuccess: options.notifySuccess,
    activeNav: options.activeNav,
    onReloadMarket: options.onReloadMarket,
    onReloadSelectedPluginDetail: options.onReloadSelectedPluginDetail,
  })

  // 设置 GitHub 绑定刷新的钩子
  onGithubBindingRefreshHook = async () => {
    await githubFlow.refreshGithubBindingStatus()
  }

  // 设置登录成功钩子
  onLoginSuccessHook = async () => {
    await githubFlow.refreshGithubBindingStatus({ silent: true })
  }

  return {
    ...runtimeConfig,
    ...githubFlow,
    ...accountActions,
    // 转发 GitHub 绑定（带登录检查）
    handleGithubBind: async () => {
      await githubFlow.handleGithubBind(accountActions.requireShopLogin)
    },
  }
}
