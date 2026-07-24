// 账户操作：登录、注册、密码、用户名、头像

import { ref, type Ref } from 'vue'
import {
  login,
  register,
  updateMyPassword,
  updateMyUsername,
  uploadMyAvatar,
} from '../../../../api/auth'
import type { AuthUser, LoginRequest, RegisterRequest, UpdatePasswordRequest, UpdateUsernameRequest } from '../../../../types/auth'
import {
  saveShopApiRuntimeConfig,
  normalizeShopApiBaseUrl,
} from '../../../../config/runtimeConfig'
import { getErrorMessage } from '../shared'
import {
  validateLoginPayload,
  validatePassword,
  validateRegisterPayload,
  validateUsername,
  validateAvatarFile,
} from '../shared'

export function useAccountActions(options: {
  authToken: Ref<string>
  currentUser: Ref<AuthUser | null>
  selectedPluginName: Ref<string | null>
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  activeNav: Ref<'store' | 'installed' | 'notifications' | 'upload' | 'account' | 'settings'>
  onReloadMarket: () => Promise<void>
  onReloadSelectedPluginDetail: () => Promise<void>
}) {
  const isLoggingIn = ref(false)
  const isRegistering = ref(false)
  const isUpdatingUsername = ref(false)
  const isUpdatingPassword = ref(false)
  const isUploadingAvatar = ref(false)

  /**
   * 检查用户是否已登录，未登录则导航到账户标签
   */
  function requireShopLogin(actionLabel: string): boolean {
    if (options.authToken.value && options.currentUser.value) {
      return true
    }

    options.activeNav.value = 'account'
    options.notifyError(`请先登录后再${actionLabel}`)
    return false
  }

  /**
   * 处理用户登录
   */
  function handleLogin(payload: LoginRequest): Promise<void> {
    try {
      validateLoginPayload(payload)
    } catch (error) {
      options.notifyError(getErrorMessage(error, '登录参数不合法'))
      return Promise.resolve()
    }

    isLoggingIn.value = true

    return login(payload)
      .then((response) => {
        // 保存登录结果
        saveShopApiRuntimeConfig({
          token: response.token,
          currentUser: response.user,
        })
        options.notifySuccess(`欢迎回来，${response.user.username}`)
      })
      .catch((error) => {
        options.notifyError(getErrorMessage(error, '登录失败'))
      })
      .finally(() => {
        isLoggingIn.value = false
      })
  }

  /**
   * 处理用户注册
   */
  async function handleRegister(payload: RegisterRequest): Promise<void> {
    try {
      validateRegisterPayload(payload)
    } catch (error) {
      options.notifyError(getErrorMessage(error, '注册参数不合法'))
      return
    }

    isRegistering.value = true

    try {
      const response = await register(payload)
      saveShopApiRuntimeConfig({
        token: response.token,
        currentUser: response.user,
      })
      options.notifySuccess(`注册成功，欢迎 ${response.user.username}`)
    } catch (error) {
      options.notifyError(getErrorMessage(error, '注册失败'))
    } finally {
      isRegistering.value = false
    }
  }

  /**
   * 处理用户名更新
   */
  async function handleUpdateUsername(payload: UpdateUsernameRequest): Promise<void> {
    try {
      validateUsername(payload.username)
    } catch (error) {
      options.notifyError(getErrorMessage(error, '用户名不合法'))
      return
    }

    isUpdatingUsername.value = true

    try {
      const response = await updateMyUsername({ username: payload.username.trim() })
      saveShopApiRuntimeConfig({ currentUser: response.user })
      options.notifySuccess('用户名已更新')
    } catch (error) {
      options.notifyError(getErrorMessage(error, '修改用户名失败'))
    } finally {
      isUpdatingUsername.value = false
    }
  }

  /**
   * 处理密码更新
   */
  async function handleUpdatePassword(payload: UpdatePasswordRequest): Promise<void> {
    try {
      validatePassword(payload.newPassword)
    } catch (error) {
      options.notifyError(getErrorMessage(error, '密码不合法'))
      return
    }

    const requestPayload: UpdatePasswordRequest = {
      newPassword: payload.newPassword,
    }

    // 如果提供了当前密码，则包含在请求中
    if (payload.currentPassword) {
      requestPayload.currentPassword = payload.currentPassword
    }

    isUpdatingPassword.value = true

    try {
      const response = await updateMyPassword(requestPayload)
      options.notifySuccess(response.message || '密码已更新')
    } catch (error) {
      options.notifyError(getErrorMessage(error, '修改密码失败'))
    } finally {
      isUpdatingPassword.value = false
    }
  }

  /**
   * 处理头像上传
   */
  async function handleUploadAvatar(file: File): Promise<void> {
    try {
      validateAvatarFile(file)
    } catch (error) {
      options.notifyError(getErrorMessage(error, '头像文件不合法'))
      return
    }

    isUploadingAvatar.value = true

    try {
      const response = await uploadMyAvatar(file)
      saveShopApiRuntimeConfig({ currentUser: response.user })
      options.notifySuccess('头像已更新')
    } catch (error) {
      options.notifyError(getErrorMessage(error, '上传头像失败'))
    } finally {
      isUploadingAvatar.value = false
    }
  }

  /**
   * 处理 API 基础 URL 保存
   */
  async function handleSaveBaseUrl(baseUrl: string): Promise<void> {
    try {
      const normalizedBaseUrl = normalizeShopApiBaseUrl(baseUrl)
      saveShopApiRuntimeConfig({ baseUrl: normalizedBaseUrl })
      await options.onReloadMarket()

      if (options.selectedPluginName) {
        await options.onReloadSelectedPluginDetail()
      }

      options.notifySuccess(`已保存 API 地址：${normalizedBaseUrl}`)
    } catch (error) {
      options.notifyError(getErrorMessage(error, '保存 API 地址失败'))
    }
  }

  return {
    isLoggingIn,
    isRegistering,
    isUpdatingUsername,
    isUpdatingPassword,
    isUploadingAvatar,
    requireShopLogin,
    handleLogin,
    handleRegister,
    handleUpdateUsername,
    handleUpdatePassword,
    handleUploadAvatar,
    handleSaveBaseUrl,
  }
}
