import { requestFormData, requestJson } from './httpClient'
import type {
  AuthResponse,
  CaptchaResponse,
  CurrentUserResponse,
  GitHubBindDevicePollResponse,
  GitHubBindingStatus,
  GitHubDevicePollRequest,
  GitHubDeviceStartResponse,
  GitHubLoginDevicePollResponse,
  LoginRequest,
  RegisterRequest,
  UpdatePasswordRequest,
  UpdatePasswordResponse,
  UpdateUsernameRequest,
} from '../types/auth'

export function register(payload: RegisterRequest): Promise<AuthResponse> {
  return requestJson<AuthResponse, RegisterRequest>({
    path: '/api/v1/auth/register',
    method: 'POST',
    body: payload,
  })
}

export function getCaptcha(bgColor?: string): Promise<CaptchaResponse> {
  const query = bgColor ? `?bgColor=${encodeURIComponent(bgColor)}` : ''
  return requestJson<CaptchaResponse>({
    path: `/api/v1/auth/captcha${query}`,
  })
}

export function login(payload: LoginRequest): Promise<AuthResponse> {
  return requestJson<AuthResponse, LoginRequest>({
    path: '/api/v1/auth/login',
    method: 'POST',
    body: payload,
  })
}

export function startGithubDeviceLogin(): Promise<GitHubDeviceStartResponse> {
  return requestJson<GitHubDeviceStartResponse>({
    path: '/api/v1/auth/github/device/start',
    method: 'POST',
  })
}

export function pollGithubDeviceLogin(
  payload: GitHubDevicePollRequest,
): Promise<GitHubLoginDevicePollResponse> {
  return requestJson<GitHubLoginDevicePollResponse, GitHubDevicePollRequest>({
    path: '/api/v1/auth/github/device/poll',
    method: 'POST',
    body: payload,
  })
}

export function startGithubDeviceBind(): Promise<GitHubDeviceStartResponse> {
  return requestJson<GitHubDeviceStartResponse>({
    path: '/api/v1/auth/github/bind/device/start',
    method: 'POST',
  })
}

export function pollGithubDeviceBind(
  payload: GitHubDevicePollRequest,
): Promise<GitHubBindDevicePollResponse> {
  return requestJson<GitHubBindDevicePollResponse, GitHubDevicePollRequest>({
    path: '/api/v1/auth/github/bind/device/poll',
    method: 'POST',
    body: payload,
  })
}

export function getGithubBindingStatus(): Promise<GitHubBindingStatus> {
  return requestJson<GitHubBindingStatus>({
    path: '/api/v1/auth/github/binding',
  })
}

export function getCurrentUser(): Promise<CurrentUserResponse> {
  return requestJson<CurrentUserResponse>({
    path: '/api/v1/auth/me',
  })
}

export function updateMyUsername(
  payload: UpdateUsernameRequest,
): Promise<CurrentUserResponse> {
  return requestJson<CurrentUserResponse, UpdateUsernameRequest>({
    path: '/api/v1/users/me/username',
    method: 'PATCH',
    body: payload,
  })
}

export function updateMyPassword(
  payload: UpdatePasswordRequest,
): Promise<UpdatePasswordResponse> {
  return requestJson<UpdatePasswordResponse, UpdatePasswordRequest>({
    path: '/api/v1/users/me/password',
    method: 'PATCH',
    body: payload,
  })
}

export function uploadMyAvatar(file: File): Promise<CurrentUserResponse> {
  const formData = new FormData()
  formData.append('avatar', file)

  return requestFormData<CurrentUserResponse>({
    path: '/api/v1/users/me/avatar',
    method: 'POST',
    body: formData,
  })
}
