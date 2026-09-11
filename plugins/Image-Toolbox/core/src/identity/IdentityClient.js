/**
 * IdentityClient — 认证客户端适配层
 *
 * 基于 @moruteaven/identity-sdk (TeavenIdentityClient)，
 * 对外保持与旧 IdentityClient 兼容的接口，同时桥接业务后端 API。
 *
 * 登录方式：
 * - Magic Link（requestMagicLink + verifyMagicLink）
 * - uTools 一键登录（loginWithUTools）
 */

import { TeavenIdentityClient, createWebStorage } from './sdk/index.js';

const DEFAULT_IDENTITY_BASE = 'https://identity.moruteaven.com';
const DEFAULT_API_BASE = 'https://api.image-toolbox.moruteaven.com';
const DEFAULT_CLIENT_ID = 'image-toolbox';

// 旧版 localStorage token key，用于迁移
const LEGACY_TOKEN_KEY = 'image_toolbox_tokens';

// 简单的 Base64 编码/解码，用于降低 localStorage 中 token 的明文可见性
const _encode = (str) => {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return str; }
};
const _decode = (str) => {
  try { return decodeURIComponent(escape(atob(str))); } catch { return str; }
};

class IdentityClient {
  constructor(options = {}) {
    const identityBaseUrl = (options.identityBaseUrl || DEFAULT_IDENTITY_BASE).replace(/\/+$/, '');
    this._apiBaseUrl = (options.apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, '');
    this._clientId = options.clientId || DEFAULT_CLIENT_ID;

    // 创建 SDK 客户端实例
    this._sdk = new TeavenIdentityClient({
      baseUrl: identityBaseUrl,
      clientId: this._clientId,
      storage: createWebStorage(window.localStorage),
      storagePrefix: 'teaven_identity_',
    });

    // 初始化标记 — init() 需要异步调用
    this._initialized = false;
    this._initPromise = null;
  }

  /**
   * 初始化 SDK 客户端（从存储加载已有 token）。
   * 幂等调用，多次调用返回同一个 Promise。
   */
  init() {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        await this._migrateLegacyTokens();
        await this._sdk.init();
        this._initialized = true;
      })();
    }
    return this._initPromise;
  }

  /**
   * 迁移旧版 token 格式到 SDK 格式。
   * 旧格式：localStorage['image_toolbox_tokens'] = base64(JSON({accessToken, refreshToken, accessTokenExpiresAt}))
   * 新格式：localStorage['teaven_identity_access_token'] = token 等
   */
  async _migrateLegacyTokens() {
    try {
      const raw = window.localStorage.getItem(LEGACY_TOKEN_KEY);
      if (!raw) return;
      const decoded = _decode(raw);
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
        await this._sdk.saveTokens(parsed);
        window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      }
    } catch {}
  }

  // ═══════════════════════════════════════
  // 认证状态（兼容旧接口）
  // ═══════════════════════════════════════

  /**
   * 检查是否已认证（token 存在且未过期）。
   * 旧版是同步方法，SDK 版是异步方法。
   * 为了兼容同步调用场景，先检查 isLoggedIn()，异步场景调用 isAuthenticated()。
   */
  isAuthenticated() {
    // 同步快速检查：token 是否存在
    return this._sdk.isLoggedIn();
  }

  /** 异步检查 token 有效性（含过期时间） */
  async isAuthenticatedAsync() {
    await this.init();
    return this._sdk.isAuthenticated();
  }

  // ═══════════════════════════════════════
  // Magic Link 登录
  // ═══════════════════════════════════════

  /** 请求 Magic Link 登录邮件（旧名 requestEmailCode 的替代） */
  async requestMagicLink(email) {
    await this.init();
    return this._sdk.requestMagicLink(email);
  }

  /** 验证 Magic Link token，完成登录 */
  async verifyMagicLink(token) {
    await this.init();
    return this._sdk.verifyMagicLink(token);
  }

  // ═══════════════════════════════════════
  // uTools 登录
  // ═══════════════════════════════════════

  /** uTools 一键登录（旧接口需 deviceId，新 SDK 不需要） */
  async loginWithUTools(accessToken, _deviceId) {
    await this.init();
    return this._sdk.loginWithUTools(accessToken);
  }

  // ═══════════════════════════════════════
  // 密码登录 / 注册
  // ═══════════════════════════════════════

  /** 密码登录 */
  async loginWithPassword(account, password) {
    await this.init();
    return this._sdk.loginWithPassword(account, password);
  }

  /** 邮箱注册 */
  async register(email, code) {
    await this.init();
    return this._sdk.register(email, code);
  }

  // ═══════════════════════════════════════
  // Token 管理
  // ═══════════════════════════════════════

  /** 刷新 Token */
  async refresh() {
    await this.init();
    return this._sdk.refreshAccessToken();
  }

  /** 注销 */
  async logout() {
    await this.init();
    return this._sdk.logout();
  }

  // ═══════════════════════════════════════
  // 用户信息（业务后端 API）
  // ═══════════════════════════════════════

  /**
   * 获取当前用户信息。
   * SDK 调用的是 Identity 服务的 /me 接口。
   */
  async getUserInfo() {
    await this.init();
    return this._sdk.getUserInfo();
  }

  /** 兼容旧接口 getProfile() */
  async getProfile() {
    await this.init();
    const info = await this._sdk.fetchProfile();
    return this._resolveAvatarUrl(info);
  }

  /** 更新用户信息（兼容旧接口 updateProfile） */
  async updateProfile(patch) {
    await this.init();
    // 旧版 patch 字段名 nickname → 新版 displayName
    const payload = {};
    if (patch.nickname !== undefined) payload.displayName = patch.nickname;
    if (patch.avatarUrl !== undefined) payload.avatarUrl = patch.avatarUrl;
    if (patch.email !== undefined) payload.email = patch.email;
    const result = await this._sdk.updateUserInfo(payload);
    return this._resolveAvatarUrl(result);
  }

  /**
   * 上传头像文件（multipart/form-data）。
   * 这是业务后端 API，SDK 不直接提供，需自行实现。
   */
  async uploadAvatar(file) {
    await this.init();
    const url = new URL('/api/me/avatar', this._apiBaseUrl + '/');
    const formData = new FormData();
    formData.append('file', file);

    const headers = {};
    const accessToken = this._sdk.getAccessToken();
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: formData,
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    // 401 → 尝试刷新
    if (res.status === 401) {
      try {
        await this.refresh();
        const newToken = this._sdk.getAccessToken();
        if (newToken) headers['Authorization'] = `Bearer ${newToken}`;
        const retryRes = await fetch(url.toString(), { method: 'POST', headers, body: formData });
        const retryText = await retryRes.text();
        let retryData = null;
        if (retryText) {
          try { retryData = JSON.parse(retryText); } catch { retryData = retryText; }
        }
        if (retryData && typeof retryData.code === 'string' && retryData.code === 'OK') {
          return this._resolveAvatarUrl(retryData.data);
        }
        throw retryData || { code: 'HTTP_ERROR', message: `HTTP ${retryRes.status}` };
      } catch {
        await this._sdk.clearTokens?.();
        throw { code: 'UNAUTHORIZED', message: 'Token expired, please login again' };
      }
    }

    if (!res.ok) {
      throw data || { code: 'HTTP_ERROR', message: `HTTP ${res.status}`, status: res.status };
    }

    if (data && typeof data.code === 'string') {
      if (data.code !== 'OK') throw data;
      return this._resolveAvatarUrl(data.data);
    }
    return data;
  }

  // ═══════════════════════════════════════
  // 工具方法
  // ═══════════════════════════════════════

  /**
   * 将头像相对路径转为完整 URL。
   * SDK 返回的 UserInfo 中 avatarUrl 可能是相对路径。
   */
  _resolveAvatarUrl(profile) {
    if (!profile) return profile;
    // 兼容新旧字段名
    const result = {
      ...profile,
      nickname: profile.displayName || profile.nickname,
      avatar: profile.avatarUrl || profile.avatar,
    };
    if (result.avatar && result.avatar.startsWith('/api/avatars/')) {
      result.avatar = this._apiBaseUrl + result.avatar;
    }
    return result;
  }
}

export default IdentityClient;
