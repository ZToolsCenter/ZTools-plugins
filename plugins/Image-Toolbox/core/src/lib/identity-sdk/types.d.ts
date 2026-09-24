/**
 * Teaven Identity SDK 类型定义
 */
/** HTTP 方法类型 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** 请求适配器输入 */
export interface RequestAdapterInput {
    url: string;
    method: HttpMethod;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
}
/** 请求适配器响应 */
export interface RequestAdapterResponse {
    status: number;
    headers: Record<string, string>;
    body: unknown;
}
/** 请求适配器函数类型 */
export type RequestAdapter = (input: RequestAdapterInput) => Promise<RequestAdapterResponse>;
/** Token 存储接口 */
export interface TokenStorage {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
}
/** 客户端配置选项 */
export interface TeavenIdentityClientOptions {
    /** API 基础 URL */
    baseUrl: string;
    /** 客户端 ID */
    clientId: string;
    /** Token 存储实现 */
    storage?: TokenStorage;
    /** 自定义请求适配器 */
    requestAdapter?: RequestAdapter;
    /** Token 存储前缀 */
    storagePrefix?: string;
    /** 请求超时时间（毫秒），默认 30000 */
    timeout?: number;
    /** access token 过期前自动刷新的阈值（秒），默认 60 秒前刷新 */
    refreshThreshold?: number;
}
/** 后端统一响应封装 */
export interface ApiResponse<T = unknown> {
    code: string;
    message: string;
    data: T | null;
    timestamp: number;
}
/** Token 响应（后端 ok() 内的 data） */
export interface TokenResponse {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt?: number;
    refreshTokenExpiresAt?: number;
    sessionId?: string;
    clientId?: string | null;
    roles?: string[];
}
/** 密码登录请求体 */
export interface PasswordLoginPayload {
    account: string;
    password: string;
}
/** uTools 登录请求体 */
export interface UToolsLoginPayload {
    accessToken: string;
}
/** 注册请求体 */
export interface RegisterPayload {
    email: string;
    code: string;
    purpose: "register";
}
/** 第三方登录请求体（通用 provider + payload 模式） */
export interface ProviderLoginPayload {
    provider: string;
    payload: Record<string, unknown>;
}
/** Magic Link 验证响应 */
export interface MagicLinkVerifyResponse {
    accessToken: string;
    refreshToken: string;
    userId: string;
}
/** OAuth 授权 URL 响应 */
export interface OAuthRedirectResponse {
    provider: string;
    state: string;
    redirectUrl: string;
}
/** OAuth 回调响应 */
export interface OAuthCallbackResponse {
    accessToken: string;
    refreshToken: string;
    userId: string;
}
/** 用户信息 */
export interface UserInfo {
    id: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    status?: string;
    roles?: string[];
    [key: string]: unknown;
}
/** 更新用户信息请求体 */
export interface UpdateUserInfoPayload {
    displayName?: string;
    avatarUrl?: string;
    email?: string;
}
/** API 错误响应 */
export interface ApiError {
    code: string;
    message: string;
    data?: unknown;
    timestamp?: number;
}
