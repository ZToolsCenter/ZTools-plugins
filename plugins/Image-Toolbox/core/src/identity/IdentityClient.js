/**
 * IdentityClient — 轻量认证客户端
 *
 * 负责：
 * - Token 存储 / 检查 / 刷新（与 Teaven Identity 交互）
 * - 用户档案获取 / 修改（与业务后端交互）
 *
 * 登录方式：
 * - 邮箱验证码（requestEmailCode + loginWithEmailCode）
 * - uTools signed-plugin（loginWithUTools）
 */

const DEFAULT_IDENTITY_BASE = 'https://identity.moruteaven.com';
const DEFAULT_API_BASE = 'https://api.image-toolbox.moruteaven.com';
const DEFAULT_CLIENT_ID = 'image-toolbox';
const TOKEN_KEY = 'image_toolbox_tokens';

// 简单的 Base64 编码/解码，用于降低 localStorage 中 token 的明文可见性
// 注意：这不是加密，仅做轻量混淆以防 XSS 直接读取明文 token
const _encode = (str) => {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return str; }
};
const _decode = (str) => {
  try { return decodeURIComponent(escape(atob(str))); } catch { return str; }
};

class IdentityClient {
  constructor(options = {}) {
    this.identityBaseUrl = (options.identityBaseUrl || DEFAULT_IDENTITY_BASE).replace(/\/+$/, '');
    this.apiBaseUrl = (options.apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, '');
    this.clientId = options.clientId || DEFAULT_CLIENT_ID;
    this.tokenKey = options.tokenKey || TOKEN_KEY;
  }

  // ═══════════════════════════════════════
  // Token 管理
  // ═══════════════════════════════════════

  _getStoredTokens() {
    try {
      const raw = localStorage.getItem(this.tokenKey);
      if (!raw) return null;
      const decoded = _decode(raw);
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
        return parsed;
      }
    } catch {}
    return null;
  }

  _setTokens(tokens) {
    const encoded = _encode(JSON.stringify(tokens));
    localStorage.setItem(this.tokenKey, encoded);
  }

  _clearTokens() {
    localStorage.removeItem(this.tokenKey);
  }

  isAuthenticated() {
    const tokens = this._getStoredTokens();
    return !!(tokens && tokens.accessToken && tokens.accessTokenExpiresAt > Date.now());
  }

  _getAuthHeader() {
    const tokens = this._getStoredTokens();
    if (!tokens?.accessToken) return null;
    return `Bearer ${tokens.accessToken}`;
  }

  // ═══════════════════════════════════════
  // Identity API（登录 / Token 刷新）
  // ═══════════════════════════════════════

  async _identityRequest(path, options = {}) {
    const url = new URL(path, this.identityBaseUrl + '/');
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    const headers = { Accept: 'application/json', ...options.headers };
    let body;
    if (options.body) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const res = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body,
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!res.ok) {
      throw { code: data?.code || 'HTTP_ERROR', message: data?.message || `HTTP ${res.status}`, status: res.status };
    }

    // 统一响应壳 { code, message, data, timestamp }
    if (data && typeof data.code === 'string') {
      if (data.code !== 'OK') {
        throw data;
      }
      return data.data;
    }
    return data;
  }

  /** 请求邮箱验证码 */
  requestEmailCode(email, purpose = 'login') {
    return this._identityRequest('/auth/email/redirect', {
      query: { email, purpose },
    });
  }

  /** 邮箱验证码登录 */
  async loginWithEmailCode(email, code, purpose = 'login') {
    const result = await this._identityRequest('/auth/login', {
      method: 'POST',
      body: {
        provider: 'email',
        payload: { email, code, purpose },
        clientId: this.clientId,
      },
    });
    this._setTokens(result);
    return result;
  }

  /** uTools signed-plugin 登录 */
  async loginWithUTools(accessToken, deviceId) {
    const result = await this._identityRequest('/auth/login', {
      method: 'POST',
      body: {
        provider: 'utools',
        payload: { accessToken },
        clientId: this.clientId,
        deviceId,
      },
    });
    this._setTokens(result);
    return result;
  }

  /** 刷新 Token */
  async refresh() {
    const tokens = this._getStoredTokens();
    if (!tokens?.refreshToken) {
      throw { code: 'REFRESH_TOKEN_MISSING', message: 'Refresh token is missing' };
    }

    try {
      const result = await this._identityRequest('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: tokens.refreshToken },
      });
      this._setTokens(result);
      return result;
    } catch (e) {
      this._clearTokens();
      throw e;
    }
  }

  /** 注销 */
  async logout() {
    try {
      await this._identityRequest('/auth/logout', {
        method: 'POST',
        headers: { Authorization: this._getAuthHeader() },
      });
    } catch {}
    this._clearTokens();
  }

  // ═══════════════════════════════════════
  // 业务后端 API（用户档案）
  // ═══════════════════════════════════════

  async _apiRequest(path, options = {}) {
    const url = new URL(path, this.apiBaseUrl + '/');
    const headers = { Accept: 'application/json' };
    let body;
    if (options.body) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const authHeader = this._getAuthHeader();
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const res = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body,
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
        // 重试一次
        const newAuth = this._getAuthHeader();
        if (newAuth) headers['Authorization'] = newAuth;
        const retryRes = await fetch(url.toString(), { method: options.method || 'GET', headers, body });
        const retryText = await retryRes.text();
        let retryData = null;
        if (retryText) {
          try { retryData = JSON.parse(retryText); } catch { retryData = retryText; }
        }
        if (retryData && typeof retryData.code === 'string' && retryData.code === 'OK') {
          return retryData.data;
        }
        throw retryData || { code: 'HTTP_ERROR', message: `HTTP ${retryRes.status}` };
      } catch {
        this._clearTokens();
        throw { code: 'UNAUTHORIZED', message: 'Token expired, please login again' };
      }
    }

    if (!res.ok) {
      throw data || { code: 'HTTP_ERROR', message: `HTTP ${res.status}`, status: res.status };
    }

    if (data && typeof data.code === 'string') {
      if (data.code !== 'OK') throw data;
      return data.data;
    }
    return data;
  }

  /** 将头像相对路径转为完整 URL */
  _resolveAvatarUrl(profile) {
    if (!profile) return profile;
    if (profile.avatar && profile.avatar.startsWith('/api/avatars/')) {
      return { ...profile, avatar: this.apiBaseUrl + profile.avatar };
    }
    return profile;
  }

  /** 获取用户档案（首次访问自动创建） */
  async getProfile() {
    const profile = await this._apiRequest('/api/me');
    return this._resolveAvatarUrl(profile);
  }

  /** 更新昵称 */
  updateProfile(patch) {
    return this._apiRequest('/api/me', { method: 'PATCH', body: patch });
  }

  /** 上传头像文件（multipart/form-data） */
  async uploadAvatar(file) {
    const url = new URL('/api/me/avatar', this.apiBaseUrl + '/');
    const formData = new FormData();
    formData.append('file', file);

    const headers = {};
    const authHeader = this._getAuthHeader();
    if (authHeader) {
      headers['Authorization'] = authHeader;
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
        const newAuth = this._getAuthHeader();
        if (newAuth) headers['Authorization'] = newAuth;
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
        this._clearTokens();
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
}

export default IdentityClient;
