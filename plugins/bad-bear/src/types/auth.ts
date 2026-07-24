export interface AuthUser {
  id: string
  account: string
  username: string
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  token: string
  user: AuthUser
}

export interface CaptchaResponse {
  captchaToken: string
  image: string
}

export interface LoginRequest {
  account: string
  password: string
  captchaToken: string
  captchaCode: string
}

export interface RegisterRequest {
  account: string
  username: string
  password: string
  captchaToken: string
  captchaCode: string
}

export interface CurrentUserResponse {
  user: AuthUser
}

export interface UpdateUsernameRequest {
  username: string
}

export interface UpdatePasswordRequest {
  currentPassword?: string
  newPassword: string
}

export interface UpdatePasswordResponse {
  message: string
}

export interface GitHubDeviceStartResponse {
  deviceSessionId: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string | null
  expiresAt: string
  expiresIn: number
  interval: number
}

export interface GitHubDevicePollRequest {
  deviceSessionId: string
}

export interface GitHubDevicePollPendingResponse {
  status: 'pending'
  retryAfterSeconds: number
  expiresAt: string
}

export interface GitHubBindingStatus {
  bound: boolean
  provider?: string | null
  login?: string | null
}

export interface GitHubLoginDevicePollCompletedResponse {
  status: 'completed'
  token: string
  user: AuthUser
}

export interface GitHubBindDevicePollCompletedResponse {
  status: 'completed'
  binding: GitHubBindingStatus
}

export type GitHubLoginDevicePollResponse =
  | GitHubDevicePollPendingResponse
  | GitHubLoginDevicePollCompletedResponse

export type GitHubBindDevicePollResponse =
  | GitHubDevicePollPendingResponse
  | GitHubBindDevicePollCompletedResponse

export type GitHubDeviceFlowPurpose = 'login' | 'bind' | null
export type GitHubDeviceFlowPhase = 'idle' | 'starting' | 'polling' | 'completed' | 'expired' | 'error'

export interface GitHubBindingState {
  loading: boolean
  loaded: boolean
  supported: boolean
  bound: boolean
  provider: string | null
  login: string | null
  errorMessage: string
}

export interface GitHubDeviceFlowState {
  purpose: GitHubDeviceFlowPurpose
  phase: GitHubDeviceFlowPhase
  deviceSessionId: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresAt: string
  interval: number
  retryAfterSeconds: number
  errorMessage: string
}
