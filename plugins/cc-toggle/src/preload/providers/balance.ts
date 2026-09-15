// ZTools ccToggle - balance.ts
// 余额查询引擎：网络请求、缓存读写、自动查询防抖

interface BalanceResult {
  success: boolean;
  balance?: number;
  used?: number;
  currency?: string;
  queriedAt: number;
  error?: string;
}

interface BalanceCacheEntry {
  providerId: string;
  appType: string;
  result: BalanceResult;
  queriedAt: number;
}

interface ProviderBalanceConfig {
  enabled: boolean;
  path: string;
  balancePath: string;
  usedPath?: string;
  balanceTransform?: string;
  currency?: string;
  lowThreshold?: number;
  autoRefresh?: boolean;
  refreshIntervalSec?: number;
  timeoutMs?: number;
}

interface BalanceNotifyEntry {
  balance: number;
  at: number;
}

const CACHE_KEY = 'cctoggle_balance_cache';
const MIN_AUTO_INTERVAL_MS = 30 * 1000;

// 同一会话内自动查询的最小间隔记录（防抖），手动刷新不受限
const _lastAutoQuery: Record<string, number> = {};

function getByPath(obj: any, pathStr: string): any {
  if (obj == null) return undefined;
  const parts: string[] = [];
  String(pathStr || '')
    .split('.')
    .forEach(function (seg) {
      const m = seg.match(/^([^[]*)((\[\d+\])*)$/);
      if (!m) return;
      if (m[1]) parts.push(m[1]);
      if (m[2]) {
        const idxs = m[2].match(/\[(\d+)\]/g) || [];
        idxs.forEach(function (i) {
          parts.push(i.replace(/[\[\]]/g, ''));
        });
      }
    });
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function toNumber(v: any): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

// 模板支持的余额转换：divide:N（除以 N）、subtract:path（减去另一路径取值）
function applyTransform(value: number, data: any, transform: string): number | null {
  const t = String(transform || '').trim();
  if (t.indexOf('divide:') === 0) {
    const d = parseFloat(t.slice(7));
    if (!d || !isFinite(d)) return null;
    return value / d;
  }
  if (t.indexOf('subtract:') === 0) {
    const other = toNumber(getByPath(data, t.slice(9)));
    if (other === null) return null;
    return value - other;
  }
  return null;
}

function getCurrency(data: any): string | undefined {
  const candidates = [
    'currency',
    'data.currency',
    'data.userInfo.currency',
    'data.currency_type',
    'balance_currency',
    'data.balance_currency',
    'balance_infos[0].currency'
  ];
  for (const c of candidates) {
    const v = getByPath(data, c);
    if (typeof v === 'string' && v) {
      const up = v.toUpperCase();
      if (up.indexOf('USD') !== -1 || up.indexOf('DOLLAR') !== -1) return 'USD';
      if (up.indexOf('CNY') !== -1 || up.indexOf('RMB') !== -1 || up.indexOf('YUAN') !== -1)
        return 'CNY';
    }
  }
  return undefined;
}

export class BalanceManager {
  static getBalanceCache(): Record<string, BalanceCacheEntry> {
    try {
      const raw = ztools.dbStorage.getItem(CACHE_KEY);
      if (raw && typeof raw === 'object') return raw as Record<string, BalanceCacheEntry>;
    } catch (e) {}
    return {};
  }

  private static writeCache(entry: BalanceCacheEntry): void {
    try {
      const cache = BalanceManager.getBalanceCache();
      cache[entry.providerId] = entry;
      ztools.dbStorage.setItem(CACHE_KEY, cache);
    } catch (e) {}
  }

  /** 删除供应商时清理对应缓存条目 */
  static clearProviderCache(providerId: string): void {
    try {
      const cache = BalanceManager.getBalanceCache();
      if (cache[providerId]) {
        delete cache[providerId];
        ztools.dbStorage.setItem(CACHE_KEY, cache);
      }
    } catch (e) {}
  }

  /**
   * 低余额告警状态（持久化，跨页面会话去重）
   * 存于项目(profile)文档的 balanceNotify 字段：`${appType}_${providerId}` → { balance, at }
   */
  static getBalanceNotifyState(profileId: string): Record<string, BalanceNotifyEntry> {
    try {
      const { ProfileStore } = require('./profile-db');
      const profile = ProfileStore.getProfile(profileId);
      return (profile && profile.balanceNotify) || {};
    } catch (e) {
      return {};
    }
  }

  /** 记录某项目下供应商已触发过低余额告警 */
  static setBalanceNotified(profileId: string, scopeKey: string, balance: number): void {
    try {
      const { ProfileStore } = require('./profile-db');
      const profile = ProfileStore.getProfile(profileId);
      const notify = Object.assign({}, profile ? profile.balanceNotify : {});
      notify[scopeKey] = { balance: balance, at: Date.now() };
      ProfileStore.saveProfile({ id: profileId, balanceNotify: notify });
    } catch (e) {}
  }

  /** 清除某项目下供应商的告警标记（余额回升后调用，允许再次跌破时重新提醒） */
  static clearBalanceNotified(profileId: string, scopeKey: string): void {
    try {
      const { ProfileStore } = require('./profile-db');
      const profile = ProfileStore.getProfile(profileId);
      if (!profile || !profile.balanceNotify || !profile.balanceNotify[scopeKey]) return;
      const notify = Object.assign({}, profile.balanceNotify);
      delete notify[scopeKey];
      ProfileStore.saveProfile({ id: profileId, balanceNotify: notify });
    } catch (e) {}
  }

  /** 删除供应商时清理其所有项目下的告警标记 */
  static clearProviderNotify(providerId: string): void {
    try {
      const { ProfileStore } = require('./profile-db');
      const suffix = '_' + providerId;
      ProfileStore.listAllProfiles().forEach(function (profile) {
        const notify = profile.balanceNotify;
        if (!notify) return;
        let changed = false;
        const next: Record<string, BalanceNotifyEntry> = {};
        Object.keys(notify).forEach(function (scopeKey) {
          if (scopeKey.lastIndexOf(suffix) === scopeKey.length - suffix.length) {
            changed = true;
          } else {
            next[scopeKey] = notify[scopeKey];
          }
        });
        if (changed) ProfileStore.saveProfile({ id: profile.id, balanceNotify: next });
      });
    } catch (e) {}
  }

  /** 单次查询（卡片手动刷新不受防抖限制） */
  static queryBalance(appType: string, providerId: string): Promise<BalanceResult> {
    return new Promise(function (resolve) {
      let provider: any = null;
      try {
        const { ProviderStore } = require('./provider-db');
        provider = ProviderStore.getProvider(appType, providerId);
      } catch (e) {
        resolve({ success: false, queriedAt: Date.now(), error: '无法读取供应商配置' });
        return;
      }
      const cfg = provider && provider.balance;
      if (!provider || !cfg || !cfg.enabled) {
        resolve({ success: false, queriedAt: Date.now(), error: '未启用余额查询' });
        return;
      }
      if (!cfg.path || !cfg.balancePath) {
        resolve({ success: false, queriedAt: Date.now(), error: '余额查询配置不完整' });
        return;
      }
      if (!provider.apiKey) {
        resolve({ success: false, queriedAt: Date.now(), error: '供应商无 API Key，无法查询余额' });
        return;
      }
      const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
      if (!baseUrl) {
        resolve({ success: false, queriedAt: Date.now(), error: '供应商未配置 Base URL' });
        return;
      }
      const timeout = Number(cfg.timeoutMs) || 8000;
      const url = baseUrl + cfg.path;
      const controller = new AbortController();
      const timer = setTimeout(function () {
        controller.abort();
      }, timeout);

      fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + provider.apiKey, Accept: 'application/json' },
        signal: controller.signal
      })
        .then(function (resp) {
          if (resp.status === 401 || resp.status === 403) {
            throw new Error('认证失败，请检查 API Key（HTTP ' + resp.status + '）');
          }
          if (!resp.ok) {
            throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
          }
          return resp.json();
        })
        .then(function (data) {
          const parsed = BalanceManager.parseBalance(data, cfg);
          if (!parsed.ok) {
            throw new Error(parsed.error);
          }
          const result: BalanceResult = {
            success: true,
            balance: parsed.balance,
            queriedAt: Date.now(),
            currency: parsed.currency
          };
          if (parsed.used !== undefined) result.used = parsed.used;
          BalanceManager.writeCache({
            providerId: providerId,
            appType: appType,
            result: result,
            queriedAt: result.queriedAt
          });
          resolve(result);
        })
        .catch(function (e) {
          let msg = e && e.message ? e.message : String(e);
          if (e && e.name === 'AbortError') msg = '请求超时（' + timeout + 'ms）';
          resolve({ success: false, queriedAt: Date.now(), error: msg });
        })
        .finally(function () {
          clearTimeout(timer);
        });
    });
  }

  /** 批量自动查询：串行 + 30s 最小间隔防抖；跳过不满足条件的供应商 */
  static async queryAllBalances(appType?: string): Promise<Record<string, BalanceResult>> {
    let ProviderStore: any = null;
    try {
      ProviderStore = require('./provider-db').ProviderStore;
    } catch (e) {
      return {};
    }
    const apps = appType ? [appType] : ['codex', 'claude', 'claude-desktop', 'openclaw', 'gemini'];
    const results: Record<string, BalanceResult> = {};
    for (const app of apps) {
      let list: any[] = [];
      try {
        list = ProviderStore.listProviders(app);
      } catch (e) {
        list = [];
      }
      for (const p of list) {
        const cfg = p && p.balance;
        if (!cfg || !cfg.enabled || !cfg.path || !cfg.balancePath || !p.id) continue;
        // 该供应商关闭自动查询则不参与自动刷新（手动刷新不受影响）
        if (cfg.autoRefresh === false) continue;
        const now = Date.now();
        const last = _lastAutoQuery[p.id] || 0;
        if (now - last < MIN_AUTO_INTERVAL_MS) continue;
        _lastAutoQuery[p.id] = now;
        try {
          results[p.id] = await BalanceManager.queryBalance(app, p.id);
        } catch (e: any) {
          results[p.id] = {
            success: false,
            queriedAt: Date.now(),
            error: String((e && e.message) || e)
          };
        }
      }
    }
    return results;
  }

  private static parseBalance(
    data: any,
    cfg: ProviderBalanceConfig
  ): { ok: boolean; balance?: number; used?: number; currency?: string; error?: string } {
    const raw = getByPath(data, cfg.balancePath);
    if (raw === undefined || raw === null) {
      return { ok: false, error: '取值路径解析失败：' + cfg.balancePath };
    }
    let balance = toNumber(raw);
    if (balance === null) {
      return { ok: false, error: '取值路径结果不是数字：' + cfg.balancePath };
    }
    if (cfg.balanceTransform) {
      balance = applyTransform(balance, data, cfg.balanceTransform);
      if (balance === null) {
        return { ok: false, error: '余额转换失败（balanceTransform）' };
      }
    }
    let used: number | undefined;
    if (cfg.usedPath) {
      const usedNum = toNumber(getByPath(data, cfg.usedPath));
      if (usedNum !== null) used = usedNum;
    }
    let currency: string | undefined;
    if (cfg.currency && cfg.currency !== 'AUTO') {
      currency = cfg.currency;
    } else {
      currency = getCurrency(data);
    }
    return { ok: true, balance: balance, used: used, currency: currency };
  }
}
