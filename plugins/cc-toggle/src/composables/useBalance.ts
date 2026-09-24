import { ref, watch } from 'vue';
import { getSkillNest } from './shared';
import { useProviders } from './useProviders';
import { leadingDebounce } from '../utils/debounce';
import type { BalanceResult } from '../types/ztools-cctoggle';

export interface BalanceView {
  result?: BalanceResult;
  loading: boolean;
  failed?: string;
  configKey?: string;
}

const REFRESH_CACHE_MS = 10 * 60 * 1000; // 切换当前供应商时，缓存超过 10 分钟补查一次
const DEFAULT_INTERVAL_SEC = 600;
const DEFAULT_THRESHOLD = 5;
const REFRESH_DEBOUNCE_MS = 2000; // 手动刷新防抖窗口

const views = ref<Record<string, BalanceView>>({});

let _appSeq = 0;
let _timer: number | null = null;
let _timerStoppedByBalance = false; // 当前激活供应商余额 ≤ 0 导致定时器暂停
let _lastCurrentId = ''; // 最近一次协调时的当前供应商 id
let _stopWatcher: (() => void) | null = null; // providers 监听器（init 创建，dispose 释放）
const _seqMap: Record<string, number> = {};
const _refreshThrottles: Record<string, any> = {}; // 每供应商手动刷新防抖器

function safeGetCache(): Record<string, any> {
  try {
    const api = getSkillNest();
    if (api && typeof api.getBalanceCache === 'function') return api.getBalanceCache() || {};
  } catch (e) {
    /* ignore */
  }
  return {};
}

function getThreshold(p: any): number {
  const t = p?.balance?.lowThreshold;
  return t != null && t !== '' ? Number(t) : DEFAULT_THRESHOLD;
}

/** 参与自动刷新的供应商（enabled 且未关闭自动查询） */
function autoProviders(list: any[]): any[] {
  return list.filter((p: any) => p?.balance?.enabled && p.balance.autoRefresh !== false);
}

/** 余额查询相关配置的签名（变化时缓存结果视为过期） */
function balanceConfigKey(cfg: any): string {
  return [
    cfg?.enabled,
    cfg?.path,
    cfg?.balancePath,
    cfg?.usedPath,
    cfg?.balanceTransform,
    cfg?.currency
  ].join('|');
}

/**
 * 供应商集合变化统一协调入口。覆盖所有场景：
 * 挂载 / 切 Tab / 切项目 / 增删改 / 切换当前供应商
 */
function reconcile(): void {
  _appSeq++;
  const appType = useProviders().activeTab();
  const list = useProviders().providers.value;
  const cache = safeGetCache();
  const next: Record<string, BalanceView> = {};
  const toQuery: string[] = [];
  let currentId = '';

  list.forEach((p: any) => {
    if (p?.isCurrent) currentId = p.id;
    if (!p?.balance?.enabled) return;
    const key = balanceConfigKey(p.balance);
    const prev = views.value[p.id];
    if (prev && prev.configKey === key) {
      // 配置未变：保留已有结果
      next[p.id] = prev;
    } else if (prev) {
      // 余额配置变化：失效结果 + 清理缓存 + 重新查询
      clearBackendCache(p.id);
      prev.result = undefined;
      prev.failed = undefined;
      prev.loading = false;
      prev.configKey = key;
      next[p.id] = prev;
      toQuery.push(p.id);
    } else {
      // 新供应商：有缓存先展示，无缓存待查询
      const c = cache[p.id];
      next[p.id] = { result: c?.result, loading: false, failed: '', configKey: key };
      if (!c?.result) toQuery.push(p.id);
    }
  });
  views.value = next;

  // 切换当前供应商：无缓存或缓存超过 10 分钟自动补查一次
  if (currentId && currentId !== _lastCurrentId) {
    _lastCurrentId = currentId;
    const c = cache[currentId];
    if (views.value[currentId] && (!c || Date.now() - c.queriedAt > REFRESH_CACHE_MS)) {
      toQuery.push(currentId);
    }
  } else if (!currentId) {
    _lastCurrentId = '';
  }

  // 定时器：当前激活供应商余额 ≤ 0 暂停，否则按当前供应商间隔启动
  _timerStoppedByBalance = false;
  const cur = list.find((x: any) => x.isCurrent);
  const curBalance = cur?.id ? next[cur.id]?.result?.balance : null;
  if (curBalance != null && curBalance <= 0) {
    _timerStoppedByBalance = true;
    stopTimer();
  } else {
    startTimer(appType);
  }

  // 按需补查：单个走 refreshOne（精准、不打扰其他卡片）；批量走 refreshAll（串行 + 30s 防抖）
  const q = [...new Set(toQuery)];
  if (q.length === 1) {
    refreshOne(appType, q[0]);
  } else if (q.length > 1) {
    refreshAll(appType, _appSeq);
  }
}

function clearBackendCache(providerId: string): void {
  try {
    const api = getSkillNest();
    if (api && typeof api.clearBalanceCache === 'function') api.clearBalanceCache(providerId);
  } catch (e) {
    /* ignore */
  }
}

/** 页面挂载时启用：监听供应商集合变化并执行首次协调 */
function init(): void {
  if (_stopWatcher) {
    _stopWatcher();
    _stopWatcher = null;
  }
  _stopWatcher = watch(
    () => useProviders().providers.value,
    () => reconcile()
  );
  reconcile();
}

/** 页面卸载时停用：清理定时器与监听器 */
function dispose(): void {
  stopTimer();
  if (_stopWatcher) {
    _stopWatcher();
    _stopWatcher = null;
  }
  _stopWatcher = null;
}

/** 批量自动刷新（仅自动查询供应商，30s 防抖由后端保证） */
async function refreshAll(appType: string, mySeq: number): Promise<void> {
  const list = useProviders().providers.value;
  const targets: string[] = [];
  autoProviders(list).forEach((p: any) => {
    if (views.value[p.id]) {
      views.value[p.id].loading = true;
      targets.push(p.id);
    }
  });
  try {
    const results = (await getSkillNest().queryAllBalances(appType)) || {};
    if (mySeq !== _appSeq) return;
    Object.keys(results).forEach(pid => {
      const view = views.value[pid];
      if (!view) return;
      const r = results[pid];
      view.loading = false;
      if (r.success) {
        view.result = r;
        view.failed = undefined;
      } else {
        view.failed = r.error || '查询失败';
      }
      checkThreshold(appType, pid, r);
      syncTimerAfterQuery(appType, pid);
    });
    targets.forEach(pid => {
      if (views.value[pid]) views.value[pid].loading = false;
    });
  } catch (e: any) {
    if (mySeq !== _appSeq) return;
    targets.forEach(pid => {
      if (views.value[pid]) {
        views.value[pid].loading = false;
        views.value[pid].failed = '查询失败';
      }
    });
  }
}

/** 手动刷新单个供应商（带防抖：首次立即执行，窗口内忽略；竞态控制保证只显示最新结果） */
function refreshOne(appType: string, providerId: string): Promise<BalanceResult | undefined> {
  let th = _refreshThrottles[providerId];
  if (!th) {
    th = leadingDebounce((app: string, pid: string) => doRefreshOne(app, pid), REFRESH_DEBOUNCE_MS);
    _refreshThrottles[providerId] = th;
  }
  return th(appType, providerId);
}

async function doRefreshOne(
  appType: string,
  providerId: string
): Promise<BalanceResult | undefined> {
  const seq = (_seqMap[providerId] || 0) + 1;
  _seqMap[providerId] = seq;
  const view = views.value[providerId];
  if (view) {
    view.loading = true;
    view.failed = undefined;
  }
  try {
    const r = await getSkillNest().queryBalance(appType, providerId);
    if (_seqMap[providerId] !== seq) return r;
    const v = views.value[providerId];
    if (v) {
      v.loading = false;
      if (r.success) {
        v.result = r;
        v.failed = undefined;
      } else v.failed = r.error || '查询失败';
    }
    checkThreshold(appType, providerId, r);
    syncTimerAfterQuery(appType, providerId);
    return r;
  } catch (e: any) {
    if (_seqMap[providerId] !== seq) return undefined;
    const v = views.value[providerId];
    if (v) {
      v.loading = false;
      v.failed = String(e?.message || e);
    }
    return undefined;
  }
}

/**
 * 定时器自动启停：
 * - 当前激活供应商余额 ≤ 0（耗尽/欠费）→ 停止定时自动刷新
 * - 手动刷新发现余额 > 0 → 恢复定时自动刷新
 */
function syncTimerAfterQuery(appType: string, providerId: string): void {
  const p = useProviders().providers.value.find((x: any) => x.id === providerId);
  if (!p || !p.isCurrent) return;
  const balance = views.value[providerId]?.result?.balance;
  if (balance == null) return;
  if (balance <= 0) {
    _timerStoppedByBalance = true;
    stopTimer();
  } else if (_timerStoppedByBalance) {
    _timerStoppedByBalance = false;
    startTimer(appType);
  }
}

function startTimer(appType: string): void {
  stopTimer();
  // 定时器仅服务当前激活供应商：未激活卡片不参与定时刷新（靠进入/切换时补查 + 手动刷新）
  const list = useProviders().providers.value;
  const current = list.find((p: any) => p.isCurrent);
  if (!current?.balance?.enabled || current.balance.autoRefresh === false) return;
  // 未配置/无效值回退默认 600；显式 0 表示不定时
  const raw: any = current.balance.refreshIntervalSec;
  const sec = raw == null || raw === '' ? DEFAULT_INTERVAL_SEC : Number(raw);
  if (!isFinite(sec)) return;
  if (sec <= 0) return;
  _timer = window.setInterval(() => {
    refreshCurrent(appType);
  }, sec * 1000);
}

/** 定时器触发：仅静默刷新当前激活供应商 */
function refreshCurrent(appType: string): void {
  const current = useProviders().providers.value.find((p: any) => p.isCurrent);
  if (current?.id) refreshOne(appType, current.id);
}

function stopTimer(): void {
  if (_timer != null) {
    clearInterval(_timer);
    _timer = null;
  }
}

function thresholdFor(p: any): number {
  return getThreshold(p);
}

function notifyLowBalance(p: any, r: BalanceResult, threshold: number): void {
  const amount = formatBalance(r.balance, r.currency);
  const threshText = formatBalance(threshold, r.currency || 'CNY');
  const text = `[余额不足提醒] 供应商「${p.name}」余额 ${amount}，低于阈值 ${threshText}，请及时充值`;
  try {
    const u = (window as any).ztools;
    if (u && typeof u.showNotification === 'function') u.showNotification(text);
  } catch (e) {
    /* ignore */
  }
}

function checkThreshold(appType: string, providerId: string, r: BalanceResult): void {
  if (!r.success || r.balance == null) return;
  const p = useProviders().providers.value.find((x: any) => x.id === providerId);
  if (!p || !p.isCurrent) return;
  const threshold = getThreshold(p);
  const profileId = activeProfileId();
  const scopeKey = notifyScopeKey(appType, providerId);
  const api = getSkillNest();

  // 已告警标记持久化在项目(profile)文档的 balanceNotify 里（跨页面会话），项目级去重
  let notified = false;
  try {
    const state = api.getBalanceNotifyState(profileId);
    notified = !!state[scopeKey];
  } catch (e) {
    /* ignore */
  }

  if (r.balance < threshold) {
    // 低余额：本项目内从未告警才通知一次；余额回升清除标记后，再次跌破可重新提醒
    if (!notified) {
      try {
        api.setBalanceNotified(profileId, scopeKey, r.balance);
      } catch (e) {
        /* ignore */
      }
      notifyLowBalance(p, r, threshold);
    }
  } else if (notified) {
    try {
      api.clearBalanceNotified(profileId, scopeKey);
    } catch (e) {
      /* ignore */
    }
  }
  void appType;
}

/** 当前激活项目 ID（无激活项目回退 default） */
function activeProfileId(): string {
  try {
    const api = getSkillNest();
    return (api && api.getActiveProfileId ? api.getActiveProfileId() : null) || 'default';
  } catch (e) {
    return 'default';
  }
}

/** 告警状态作用域：项目维度下按 appType+providerId 区分（同一供应商在不同项目独立去重） */
function notifyScopeKey(appType: string, providerId: string): string {
  return appType + '_' + providerId;
}

/** 金额格式化：$2.35 / ¥16.9 / ¥0 */
export function formatBalance(value: number | null | undefined, currency?: string): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const num = Math.round(Number(value) * 100) / 100;
  const str = String(num).indexOf('.') === -1 ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
  const sym = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
  return sym + str;
}

export function useBalance() {
  return {
    views,
    init,
    dispose,
    refreshOne,
    thresholdFor
  };
}
