// 认证和用户输入验证辅助函数

import type { LoginRequest, RegisterRequest } from '../../../types/auth'

// 账号格式：3-50 位字母、数字、下划线或连字符
export const ACCOUNT_PATTERN = /^[A-Za-z0-9_-]{3,50}$/
export const USERNAME_MIN_LENGTH = 2
export const USERNAME_MAX_LENGTH = 50
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 72
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024
export const ALLOWED_AVATAR_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

/**
 * 验证用户名是否符合长度要求
 * @throws Error 如果用户名太短或太长
 */
export function validateUsername(username: string): void {
  const trimmed = username.trim()
  if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
    throw new Error(`用户名长度需为 ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} 个字符`)
  }
}

/**
 * 验证密码是否符合长度要求
 * @throws Error 如果密码太短或太长
 */
export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`密码长度需为 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 个字符`)
  }
}

/**
 * 验证完整的注册载荷
 * 检查账号格式、用户名长度和密码长度
 * @throws Error 如果任何验证失败
 */
export function validateRegisterPayload(payload: RegisterRequest): void {
  if (!ACCOUNT_PATTERN.test(payload.account)) {
    throw new Error('账号需为 3-50 位字母、数字、下划线或连字符')
  }

  validateUsername(payload.username)
  validatePassword(payload.password)

  if (!payload.captchaCode.trim()) {
    throw new Error('请输入验证码')
  }
}

/**
 * 验证登录载荷
 * 检查账号和密码是否非空
 * @throws Error 如果任何验证失败
 */
export function validateLoginPayload(payload: LoginRequest): void {
  if (!payload.account.trim()) {
    throw new Error('请输入账号')
  }

  if (!payload.password) {
    throw new Error('请输入密码')
  }

  if (!payload.captchaCode.trim()) {
    throw new Error('请输入验证码')
  }
}

/**
 * 验证上传的头像文件
 * 检查文件类型和大小约束
 * @throws Error 如果文件类型不允许或文件过大
 */
export function validateAvatarFile(file: File): void {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error('头像仅支持 jpeg/png/gif/webp 格式')
  }

  if (file.size > MAX_AVATAR_SIZE) {
    throw new Error('头像大小不能超过 5MB')
  }
}
