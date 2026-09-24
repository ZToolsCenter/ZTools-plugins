/**
 * Teaven Identity SDK 主客户端
 */
import { TeavenIdentityError } from "./errors.js";
import { defaultRequestAdapter } from "./http.js";
import { MemoryTokenStorage } from "./storage.js";
/** 内部标记：正在刷新 token，避免并发刷新 */
const REFRESHING_SYMBOL = Symbol("refreshing");
/**
 * Teaven Identity 客户端
 */
export class TeavenIdentityClient {
    baseUrl;
    clientId;
    storage;
    requestAdapter;
    storagePrefix;
    timeout;
    refreshThreshold;
    accessToken = null;
    refreshToken = null;
    refreshPromise = null;
    constructor(options) {
        if (!options.baseUrl) {
            throw new TeavenIdentityError("INVALID_CONFIG", "baseUrl is required", 0);
        }
        if (!options.clientId) {
            throw new TeavenIdentityError("INVALID_CONFIG", "clientId is required", 0);
        }
        this.baseUrl = options.baseUrl.replace(/\/$/, "");
        this.clientId = options.clientId;
        this.storage = options.storage ?? new MemoryTokenStorage();
        this.requestAdapter = options.requestAdapter ?? defaultRequestAdapter;
        this.storagePrefix = options.storagePrefix ?? "teaven_identity_";
        this.timeout = options.timeout ?? 30_000;
        this.refreshThreshold = options.refreshThreshold ?? 60;
    }
    /** 获取存储键名 */
    getStorageKey(key) {
        return `${this.storagePrefix}${key}`;
    }
    /** 初始化，从存储中加载 token */
    async init() {
        this.accessToken = await this.storage.getItem(this.getStorageKey("access_token"));
        this.refreshToken = await this.storage.getItem(this.getStorageKey("refresh_token"));
    }
    /** 获取当前 access token */
    getAccessToken() {
        return this.accessToken;
    }
    /** 获取当前用户信息（兼容 fetchProfile 别名） */
    async fetchProfile() {
        if (!this.accessToken)
            return null;
        try {
            return await this.getUserInfo();
        }
        catch {
            return null;
        }
    }
    /** 检查是否已登录（token 存在且未过期） */
    isLoggedIn() {
        return this.accessToken !== null;
    }
    /** 检查是否已认证 — 异步检查 token 有效性（含过期时间） */
    async isAuthenticated() {
        if (!this.accessToken)
            return false;
        // 如果存储中有过期时间，检查是否过期
        const expiresAtStr = await this.storage.getItem(this.getStorageKey("access_token_expires_at"));
        if (expiresAtStr) {
            const expiresAt = Number(expiresAtStr);
            if (!Number.isNaN(expiresAt) && expiresAt <= Date.now() + 5000) {
                return false;
            }
        }
        return true;
    }
    /** 获取当前 refresh token */
    getRefreshToken() {
        return this.refreshToken;
    }
    /** 保存 token */
    async saveTokens(token) {
        this.accessToken = token.accessToken;
        await this.storage.setItem(this.getStorageKey("access_token"), token.accessToken);
        if (token.refreshToken) {
            this.refreshToken = token.refreshToken;
            await this.storage.setItem(this.getStorageKey("refresh_token"), token.refreshToken);
        }
        // 保存过期时间等信息（如果后端返回了）
        if (token.accessTokenExpiresAt) {
            await this.storage.setItem(this.getStorageKey("access_token_expires_at"), String(token.accessTokenExpiresAt));
        }
        if (token.refreshTokenExpiresAt) {
            await this.storage.setItem(this.getStorageKey("refresh_token_expires_at"), String(token.refreshTokenExpiresAt));
        }
        if (token.sessionId) {
            await this.storage.setItem(this.getStorageKey("session_id"), token.sessionId);
        }
    }
    /** 清除 token */
    async clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        await this.storage.removeItem(this.getStorageKey("access_token"));
        await this.storage.removeItem(this.getStorageKey("refresh_token"));
        await this.storage.removeItem(this.getStorageKey("access_token_expires_at"));
        await this.storage.removeItem(this.getStorageKey("refresh_token_expires_at"));
        await this.storage.removeItem(this.getStorageKey("session_id"));
    }
    /**
     * 从后端 ApiResponse 包装中提取 data 字段。
     * 后端所有响应格式为 { code, message, data, timestamp }。
     */
    unwrapResponse(body, status) {
        const res = body;
        // 成功响应
        if (res && typeof res.code === "string") {
            if (res.code === "OK") {
                return res.data;
            }
            // 非 OK 的业务错误
            throw new TeavenIdentityError(res.code, res.message ?? "Request failed", res.data);
        }
        // 非标准响应（可能适配器已做处理），直接返回
        return body;
    }
    /**
     * 发送认证请求。
     *
     * @param path API 路径（不含 baseUrl，以 / 开头）
     * @param method HTTP 方法
     * @param body 请求体
     * @param skipAuthRefresh 是否跳过自动 token 刷新（内部使用，避免无限循环）
     */
    async request(path, method = "GET", body, skipAuthRefresh = false) {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const headers = {
            "Content-Type": "application/json",
            "X-Client-Id": this.clientId,
        };
        if (this.accessToken) {
            headers["Authorization"] = `Bearer ${this.accessToken}`;
        }
        const input = {
            url,
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        };
        let response;
        try {
            response = await this.requestAdapter(input);
        }
        catch (err) {
            clearTimeout(timeoutId);
            if (err instanceof Error && err.name === "AbortError") {
                throw new TeavenIdentityError("REQUEST_TIMEOUT", `Request timed out after ${this.timeout}ms`, 0);
            }
            throw new TeavenIdentityError("NETWORK_ERROR", err instanceof Error ? err.message : "Network error", 0);
        }
        clearTimeout(timeoutId);
        // 如果收到 401 且有 refresh token，自动刷新后重试
        if (response.status === 401 && !skipAuthRefresh && this.refreshToken) {
            try {
                await this.ensureFreshToken();
                // 重试请求
                return this.request(path, method, body, true);
            }
            catch {
                // 刷新失败，清除 token 并抛出原始 401 错误
                await this.clearTokens();
                throw new TeavenIdentityError("TOKEN_EXPIRED", "Token expired and refresh failed", 401);
            }
        }
        if (response.status >= 400) {
            const errorRes = response.body;
            throw new TeavenIdentityError(errorRes?.code ?? "UNKNOWN_ERROR", errorRes?.message ?? `Request failed with status ${response.status}`, errorRes?.data);
        }
        return this.unwrapResponse(response.body, response.status);
    }
    /**
     * 确保在并发场景下只刷新一次 token。
     * 如果有多个请求同时 401，它们会共享同一个 refresh promise。
     */
    async ensureFreshToken() {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = this.doRefreshToken().finally(() => {
            this.refreshPromise = null;
        });
        return this.refreshPromise;
    }
    /** 实际执行 token 刷新 */
    async doRefreshToken() {
        if (!this.refreshToken) {
            throw new TeavenIdentityError("NO_REFRESH_TOKEN", "No refresh token available", 401);
        }
        // 刷新 token 请求不需要认证头
        const url = `${this.baseUrl}/auth/refresh`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await this.requestAdapter({
                url,
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Client-Id": this.clientId },
                body: JSON.stringify({ refreshToken: this.refreshToken }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (response.status >= 400) {
                const errorRes = response.body;
                throw new TeavenIdentityError(errorRes?.code ?? "REFRESH_FAILED", errorRes?.message ?? "Token refresh failed", response.status);
            }
            const tokenData = this.unwrapResponse(response.body, response.status);
            await this.saveTokens(tokenData);
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    // ==================== 认证方法 ====================
    /** 刷新 access token（公开方法） */
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new TeavenIdentityError("NO_REFRESH_TOKEN", "No refresh token available", 401);
        }
        await this.doRefreshToken();
    }
    /** 退出登录 */
    async logout() {
        try {
            if (this.refreshToken) {
                await this.request("/auth/logout", "POST", {
                    refreshToken: this.refreshToken,
                });
            }
        }
        finally {
            await this.clearTokens();
        }
    }
    // ==================== Magic Link 登录 ====================
    /** 请求 magic link 登录邮件 */
    async requestMagicLink(email) {
        const data = await this.request("/auth/magic-link", "POST", { email });
        return data?.sent ?? true;
    }
    /**
     * 验证 magic link token，登录成功后保存 token。
     * 这是浏览器跳转到 /auth/magic-link/verify?token=xxx 后，
     * 前端可以通过 SDK 调用此方法完成登录。
     */
    async verifyMagicLink(token) {
        // GET 请求需要通过 query param 传递 token
        const result = await this.request(`/auth/magic-link/verify?token=${encodeURIComponent(token)}`, "GET");
        await this.saveTokens({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
        });
        return this.getUserInfo();
    }
    // ==================== OAuth 登录 ====================
    /** 获取 OAuth 授权 URL */
    async getOAuthRedirectUrl(provider) {
        return this.request(`/auth/oauth/${encodeURIComponent(provider)}`, "GET");
    }
    /**
     * 处理 OAuth 回调。
     * 浏览器从 OAuth provider 重定向回来后，前端提取 code 和 state 调用此方法。
     */
    async handleOAuthCallback(provider, code, state) {
        const result = await this.request(`/auth/oauth/${encodeURIComponent(provider)}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, "GET");
        await this.saveTokens({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
        });
        return this.getUserInfo();
    }
    // ==================== 密码登录 / 注册 ====================
    /** 密码登录 */
    async loginWithPassword(account, password) {
        const token = await this.request("/auth/password-login", "POST", { account, password });
        await this.saveTokens(token);
        return this.getUserInfo();
    }
    /** uTools 一键登录 */
    async loginWithUTools(accessToken) {
        const token = await this.request("/auth/enter", "POST", { provider: "utools", payload: { accessKey: accessToken } });
        await this.saveTokens(token);
        return this.getUserInfo();
    }
    /** 邮箱注册 */
    async register(email, code) {
        const token = await this.request("/auth/enter", "POST", { provider: "email", payload: { email, code, purpose: "register" } });
        await this.saveTokens(token);
        return this.getUserInfo();
    }
    // ==================== 用户方法 ====================
    /** 获取当前用户信息 */
    async getUserInfo() {
        return this.request("/me", "GET");
    }
    /** 更新当前用户信息（后端使用 PATCH） */
    async updateUserInfo(data) {
        return this.request("/me", "PATCH", data);
    }
}
