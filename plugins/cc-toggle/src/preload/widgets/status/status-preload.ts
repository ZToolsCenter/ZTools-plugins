// ZTools ccToggle - widgets/status-preload.ts
// 「当前供应商余额」小组件的 preload：独立窗口运行，不走主入口
// 只读展示当前激活 Agent 的供应商与余额，不支持切换
// 直接 require manager 读取数据（不走 IPC）；设置仅会话级内存态，不持久化
// 置顶通过 sendToParent 通知主窗口应用 win.setAlwaysOnTop

const { ProviderStore } = require('../../providers/provider-db.js');
const { BalanceManager } = require('../../providers/balance.js');
const { onWidgetEvent } = require('../widget-bus.js');
const { WidgetEvent } = require('../widget-events.js');

const CONFIG_DEFAULTS = {
  showBalance: true,
  showModel: true,
  showRemark: true,
  opacity: 1,
  theme: 'dark',
  alwaysOnTop: false
};

const APPS = [
  { appType: 'codex', label: 'Codex' },
  { appType: 'claude', label: 'Claude' },
  { appType: 'claude-desktop', label: 'Claude Desktop' },
  { appType: 'openclaw', label: 'OpenClaw' },
  { appType: 'gemini', label: 'Gemini' },
  { appType: 'opencode', label: 'OpenCode' }
];

const subscribers: Array<(state: any) => void> = [];
let config: any = Object.assign({}, CONFIG_DEFAULTS);
// providerId -> { status:'ok'|'err', balance?, currency?, error?, low? }
// 只保留当前激活供应商的缓存，切换/更新时清理旧条目，避免无上限累积
const balanceCache: Record<string, any> = {};

function pruneBalanceCache(keepId: string | null): void {
  Object.keys(balanceCache).forEach(function (k) {
    if (k !== keepId) delete balanceCache[k];
  });
}

function currencySymbol(currency?: string): string {
  const c = String(currency || '').toUpperCase();
  if (c.indexOf('USD') >= 0) return '$';
  if (c.indexOf('CNY') >= 0) return '¥';
  return c ? c + ' ' : '';
}

function isLowBalance(result: any, provider: any): boolean {
  if (!result || result.balance == null) return false;
  const th = Number(provider && provider.balance && provider.balance.lowThreshold) || 5;
  return result.balance < th;
}

function refreshBalance(appType: string, providerId: string, provider: any): void {
  BalanceManager.queryBalance(appType, providerId)
    .then(function (result: any) {
      if (result && result.success && result.balance != null) {
        balanceCache[providerId] = {
          status: 'ok',
          balance: result.balance,
          currency: result.currency,
          low: isLowBalance(result, provider),
          queriedAt: result.queriedAt
        };
      } else {
        balanceCache[providerId] = {
          status: 'err',
          error: result && result.error ? result.error : '查询失败'
        };
      }
      emitUpdate();
    })
    .catch(function () {
      balanceCache[providerId] = { status: 'err', error: '查询失败' };
      emitUpdate();
    });
}

function balanceStatus(appType: string, providerId: string, provider: any): any {
  if (!config.showBalance) return { status: 'hidden', text: '' };
  if (!provider || !provider.balance || !provider.balance.enabled)
    return { status: 'none', text: '未配置' };
  const entry = balanceCache[providerId];
  if (entry) {
    if (entry.status === 'ok') {
      return {
        status: 'ok',
        text: currencySymbol(entry.currency) + formatNum(entry.balance),
        low: entry.low,
        queriedAt: entry.queriedAt
      };
    }
    return { status: 'err', text: '—', error: entry.error };
  }
  refreshBalance(appType, providerId, provider);
  return { status: 'loading', text: '…' };
}

function formatNum(n: number): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

// 当前激活 Agent：优先取 getLastActiveApp，无则取第一个有当前供应商的 Agent
function activeAppType(): string {
  try {
    const last = ProviderStore.getLastActiveApp && ProviderStore.getLastActiveApp();
    if (
      last &&
      APPS.some(function (a) {
        return a.appType === last;
      })
    )
      return last;
  } catch (e) {}
  for (let i = 0; i < APPS.length; i++) {
    try {
      if (ProviderStore.getCurrentProviderId(APPS[i].appType)) return APPS[i].appType;
    } catch (e) {}
  }
  return 'codex';
}

function buildState(): any {
  const appType = activeAppType();
  const meta =
    APPS.find(function (a) {
      return a.appType === appType;
    }) || APPS[0];
  let providerId: string | null = null;
  let provider: any = null;
  try {
    providerId = ProviderStore.getCurrentProviderId(appType);
    provider = providerId ? ProviderStore.getProvider(appType, providerId) : null;
  } catch (e) {}
  pruneBalanceCache(providerId);
  return {
    appType: appType,
    label: meta.label,
    icon: '../assets/images/agents/' + appType + '.png',
    providerId: providerId,
    providerName: provider ? provider.name : '未激活',
    model: provider && config.showModel ? provider.model || '' : '',
    remark: provider && config.showRemark ? provider.remark || '' : '',
    balance: balanceStatus(appType, providerId, provider),
    config: config
  };
}

function emitUpdate(): void {
  const state = buildState();
  subscribers.forEach(function (cb) {
    try {
      cb(state);
    } catch (e) {}
  });
}

function getConfig(): any {
  return config;
}

function setConfig(partial: any): any {
  config = Object.assign({}, config, partial || {});
  // 置顶需要主进程应用 win.setAlwaysOnTop：单向通知主窗口
  if (partial && partial.alwaysOnTop !== undefined) {
    try {
      ztools.sendToParent('cctoggle-widget-always-on-top', { value: !!partial.alwaysOnTop });
    } catch (e) {}
  }
  try {
    emitUpdate();
  } catch (e) {}
  return config;
}

// 刷新间隔取自当前供应商余额配置的 refreshIntervalSec（未配置时默认 60s）
function refreshIntervalMs(): number {
  try {
    const appType = activeAppType();
    const providerId = ProviderStore.getCurrentProviderId(appType);
    if (providerId) {
      const provider = ProviderStore.getProvider(appType, providerId);
      const sec = Number(provider && provider.balance && provider.balance.refreshIntervalSec) || 60;
      return Math.max(30, sec) * 1000;
    }
  } catch (e) {}
  return 60000;
}

// 递归 setTimeout，供应商/配置变化后自动跟随新间隔
// 事件（BALANCE_REFRESHED/PROVIDER_UPDATED）已同步且缓存新鲜时跳过本次自请求，
// 避免与主窗口重复查询；缓存变旧后才兜底刷新
function schedule(): void {
  setTimeout(function () {
    try {
      const appType = activeAppType();
      const providerId = ProviderStore.getCurrentProviderId(appType);
      if (providerId) {
        const provider = ProviderStore.getProvider(appType, providerId);
        if (provider && provider.balance && provider.balance.enabled) {
          const entry = balanceCache[providerId];
          const freshMs = 30 * 1000;
          if (!entry || !entry.queriedAt || Date.now() - entry.queriedAt > freshMs) {
            refreshBalance(appType, providerId, provider);
          }
        }
      }
    } catch (e) {}
    schedule();
  }, refreshIntervalMs());
}
schedule();

// 主窗口广播同步：供应商切换 → 立即重渲染（重读当前供应商 + 新余额）
onWidgetEvent(WidgetEvent.PROVIDER_SWITCHED, function () {
  emitUpdate();
});

// 主窗口广播同步：供应商更新（如开启计费）→ 立即重渲染并刷新余额
onWidgetEvent(WidgetEvent.PROVIDER_UPDATED, function () {
  emitUpdate();
});

// 主窗口余额刷新 → 从共享缓存同步该供应商余额后重渲染（避免重复网络请求）
onWidgetEvent(WidgetEvent.BALANCE_REFRESHED, function (data: any) {
  try {
    const providerId = data && data.providerId;
    if (!providerId) return;
    const entry = BalanceManager.getBalanceCache()[providerId];
    if (entry && entry.result && entry.result.success && entry.result.balance != null) {
      let provider = null;
      try {
        provider = ProviderStore.getProvider(data.appType, providerId);
      } catch (e) {}
      balanceCache[providerId] = {
        status: 'ok',
        balance: entry.result.balance,
        currency: entry.result.currency,
        low: isLowBalance(entry.result, provider),
        queriedAt: entry.result.queriedAt
      };
    }
  } catch (e) {}
  emitUpdate();
});

(window as any).__cctoggleWidget = {
  getState: buildState,
  getConfig: getConfig,
  setConfig: setConfig,
  subscribe: function (cb: any) {
    subscribers.push(cb);
  },
  close: function () {
    try {
      window.close();
    } catch (e) {}
  }
};
