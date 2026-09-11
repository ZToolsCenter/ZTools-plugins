/**
 * Teaven Identity SDK 主客户端
 */
import type { TeavenIdentityClientOptions, OAuthRedirectResponse, UserInfo, UpdateUserInfoPayload } from "./types.js";
/**
 * Teaven Identity 客户端
 */
export declare class TeavenIdentityClient {
    private baseUrl;
    private clientId;
    private storage;
    private requestAdapter;
    private storagePrefix;
    private timeout;
    private refreshThreshold;
    private accessToken;
    private refreshToken;
    private refreshPromise;
    constructor(options: TeavenIdentityClientOptions);
    /** 获取存储键名 */
    private getStorageKey;
    /** 初始化，从存储中加载 token */
    init(): Promise<void>;
    /** 获取当前 access token */
    getAccessToken(): string | null;
    /** 获取当前用户信息（兼容 fetchProfile 别名） */
    fetchProfile(): Promise<UserInfo | null>;
    /** 检查是否已登录（token 存在且未过期） */
    isLoggedIn(): boolean;
    /** 检查是否已认证 — 异步检查 token 有效性（含过期时间） */
    isAuthenticated(): Promise<boolean>;
    /** 获取当前 refresh token */
    getRefreshToken(): string | null;
    /** 保存 token */
    private saveTokens;
    /** 清除 token */
    private clearTokens;
    /**
     * 从后端 ApiResponse 包装中提取 data 字段。
     * 后端所有响应格式为 { code, message, data, timestamp }。
     */
    private unwrapResponse;
    /**
     * 发送认证请求。
     *
     * @param path API 路径（不含 baseUrl，以 / 开头）
     * @param method HTTP 方法
     * @param body 请求体
     * @param skipAuthRefresh 是否跳过自动 token 刷新（内部使用，避免无限循环）
     */
    private request;
    /**
     * 确保在并发场景下只刷新一次 token。
     * 如果有多个请求同时 401，它们会共享同一个 refresh promise。
     */
    private ensureFreshToken;
    /** 实际执行 token 刷新 */
    private doRefreshToken;
    /** 刷新 access token（公开方法） */
    refreshAccessToken(): Promise<void>;
    /** 退出登录 */
    logout(): Promise<void>;
    /** 请求 magic link 登录邮件 */
    requestMagicLink(email: string): Promise<boolean>;
    /**
     * 验证 magic link token，登录成功后保存 token。
     * 这是浏览器跳转到 /auth/magic-link/verify?token=xxx 后，
     * 前端可以通过 SDK 调用此方法完成登录。
     */
    verifyMagicLink(token: string): Promise<UserInfo>;
    /** 获取 OAuth 授权 URL */
    getOAuthRedirectUrl(provider: string): Promise<OAuthRedirectResponse>;
    /**
     * 处理 OAuth 回调。
     * 浏览器从 OAuth provider 重定向回来后，前端提取 code 和 state 调用此方法。
     */
    handleOAuthCallback(provider: string, code: string, state: string): Promise<UserInfo>;
    /** 密码登录 */
    loginWithPassword(account: string, password: string): Promise<UserInfo>;
    /** uTools 一键登录 */
    loginWithUTools(accessToken: string): Promise<UserInfo>;
    /** 邮箱注册 */
    register(email: string, code: string): Promise<UserInfo>;
    /** 获取当前用户信息 */
    getUserInfo(): Promise<UserInfo>;
    /** 更新当前用户信息（后端使用 PATCH） */
    updateUserInfo(data: UpdateUserInfoPayload): Promise<UserInfo>;
}
