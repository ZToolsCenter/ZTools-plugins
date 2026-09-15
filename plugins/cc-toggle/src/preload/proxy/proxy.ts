// ZTools ccToggle - proxy.ts
// 路由组、代理启停、接管/还原、端口管理

import * as utils from '../utils';
import * as configRw from '../config/config-rw';
import { ProviderStore } from '../providers/provider-db';

const generateId = utils.generateId;

// ============ 类型定义 ============

interface RouteHealth {
  intervalMs: number;
  timeoutMs: number;
  path: string;
}

interface RouteBreaker {
  failThreshold: number;
  cooldownMs: number;
  halfOpenProbe?: number;
}

interface RouteMember {
  providerId: string;
  weight: number;
  priority: number;
}

interface RouteGroup {
  id?: string;
  appType?: string;
  name?: string;
  listenPort?: number;
  strategy?: string;
  members?: RouteMember[];
  health?: RouteHealth;
  breaker?: RouteBreaker;
  timeoutMs?: number;
  authToken?: string;
  updatedAt?: string;
  createdAt?: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  modelCatalog?: any[];
  maxTokens?: number;
  customUserAgent?: string;
  headersOverride?: string;
  bodyOverride?: string;
  apiFormat?: string;
  authField?: string;
  impersonateClaudeCode?: boolean;
  settingsConfig?: { env?: Record<string, string> };
}

interface ResolvedMember {
  providerId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  priority: number;
  weight: number;
  appType: string;
  apiFormat: string;
  model: string;
  maxOutputTokens: number | string;
  customUserAgent: string;
  headersOverride: string;
  bodyOverride: string;
  authField: string;
  impersonateClaudeCode: boolean;
  desktopModelMap: Record<string, string> | null;
}

interface RuntimeMember {
  id: string;
  name: string;
  state: string;
  fails: number;
  openUntil: number;
  latency: number;
  up: boolean;
}

interface ProxyRuntimeEntry {
  running: boolean;
  port: number;
  groupId: string;
  members: RuntimeMember[];
  startedAt?: number;
  activeConn?: number;
  reqTotal?: number;
  reqSuccess?: number;
  reqFail?: number;
  lastMemberId?: string | null;
}

interface ProxyResult {
  success: boolean;
  error?: string;
  port?: number;
  groupId?: string;
  running?: boolean;
  baseUrl?: string;
}

interface ProxyStatus {
  running: boolean;
  port?: number;
  groupId?: string;
  startedAt?: number;
  activeConn?: number;
  reqTotal?: number;
  reqSuccess?: number;
  reqFail?: number;
  lastMemberId?: string | null;
  members?: RuntimeMember[];
}

interface BackupEntry {
  previousProviderId: string;
  at: string;
}

// ============ 模块级常量与变量 ============

const ROUTE_PREFIX = 'cctoggle_route_';
const BACKUP_KEY = 'cctoggle_route_backup';
const DEFAULT_PROXY_PORT = 8788;
const PORT_KEY = 'cctoggle_route_port';

const daemonWins: Record<string, any> = {};
const proxyRuntime: Record<string, any> = {};

// ============ ProxyManager 类 ============

export class ProxyManager {
  // —— 访问器：暴露模块级变量 ——

  static get proxyRuntimeRef(): Record<string, any> {
    return proxyRuntime;
  }

  static get daemonWinsRef(): Record<string, any> {
    return daemonWins;
  }

  // —— 私有辅助方法 ——

  static _routeKey(appType: string, id: string): string {
    return ROUTE_PREFIX + appType + '_' + id;
  }

  static _genProxyToken(): string {
    return 'utct-' + generateId() + generateId() + Math.random().toString(36).slice(2, 10);
  }

  static _ensureRouteToken(appType: string, group: RouteGroup): string {
    if (group.authToken) return group.authToken;
    group.authToken = ProxyManager._genProxyToken();
    group.appType = group.appType || appType;
    ProxyManager.saveRouteGroup(group);
    return group.authToken;
  }

  static _resolveMembers(appType: string, group: RouteGroup): ResolvedMember[] {
    return (group.members || [])
      .map(function (m) {
        const p: ProviderInfo | null = ProviderStore.getProvider(appType, m.providerId);
        if (!p) return null;
        // Claude Desktop 模型名映射：claude-sonnet-5 → 实际模型名
        let desktopModelMap: Record<string, string> | null = null;
        if (appType === 'claude-desktop') {
          const env = (p.settingsConfig && p.settingsConfig.env) || {};
          desktopModelMap = {
            'claude-sonnet-5': env.ANTHROPIC_DEFAULT_SONNET_MODEL || p.model || '',
            'claude-opus-4-8': env.ANTHROPIC_DEFAULT_OPUS_MODEL || p.model || '',
            'claude-haiku-4-5': env.ANTHROPIC_DEFAULT_HAIKU_MODEL || p.model || '',
            'claude-fable-5':
              env.ANTHROPIC_DEFAULT_FABLE_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || p.model || ''
          };
        }
        return {
          providerId: p.id,
          name: p.name,
          baseUrl: p.baseUrl || '',
          apiKey: p.apiKey || '',
          priority: m.priority || 1,
          weight: m.weight || 1,
          appType: appType,
          apiFormat: p.apiFormat || '',
          model: p.model || '',
          maxOutputTokens: p.maxTokens || '',
          customUserAgent: p.customUserAgent || '',
          headersOverride: p.headersOverride || '',
          bodyOverride: p.bodyOverride || '',
          authField: p.authField || 'ANTHROPIC_AUTH_TOKEN',
          impersonateClaudeCode: p.impersonateClaudeCode || false,
          desktopModelMap: desktopModelMap
        };
      })
      .filter(Boolean) as ResolvedMember[];
  }

  static _fallbackMembers(appType: string, groupId: string): RuntimeMember[] {
    if (!groupId) return [];
    try {
      const g = ProxyManager.getRouteGroup(appType, groupId);
      if (!g) return [];
      return ProxyManager._resolveMembers(appType, g).map(function (m) {
        return {
          id: m.providerId,
          name: m.name,
          state: 'unknown',
          fails: 0,
          openUntil: 0,
          latency: 0,
          up: true
        };
      });
    } catch (e) {
      return [];
    }
  }

  static _backupCurrent(appType: string): void {
    const cur = ProviderStore.getCurrentProviderId(appType);
    const doc: any = ztools.db.get(BACKUP_KEY) || { _id: BACKUP_KEY };
    doc[appType] = { previousProviderId: cur, at: new Date().toISOString() };
    ztools.db.put(doc);
  }

  static _readBackup(appType: string): BackupEntry | null {
    const doc = ztools.db.get(BACKUP_KEY);
    return doc && doc[appType] ? doc[appType] : null;
  }

  // —— 路由组 CRUD ——

  static listRouteGroups(appType: string): RouteGroup[] {
    try {
      const docs = ztools.db.allDocs(ROUTE_PREFIX + appType + '_') || [];
      return docs.map(function (d: any) {
        return Object.assign({}, d, { id: d._id.replace(ROUTE_PREFIX + appType + '_', '') });
      });
    } catch (e) {
      return [];
    }
  }

  static getRouteGroup(appType: string, id: string): RouteGroup | null {
    try {
      const doc = ztools.db.get(ProxyManager._routeKey(appType, id));
      if (!doc) return null;
      return Object.assign({}, doc, { id: id });
    } catch (e) {
      return null;
    }
  }

  static saveRouteGroup(group: RouteGroup): string {
    const appType = group.appType!;
    const id = group.id || generateId();
    const key = ProxyManager._routeKey(appType, id);
    const existing = ztools.db.get(key);
    const doc = {
      _id: key,
      _rev: existing ? existing._rev : undefined,
      name: group.name || '未命名路由组',
      listenPort: group.listenPort || 8788,
      strategy: group.strategy || 'failover',
      members: (group.members || []).map(function (m) {
        return { providerId: m.providerId, weight: m.weight || 1, priority: m.priority || 1 };
      }),
      health: Object.assign(
        { intervalMs: 30000, timeoutMs: 5000, path: '/models' },
        group.health || {}
      ),
      breaker: Object.assign(
        { failThreshold: 3, cooldownMs: 60000, halfOpenProbe: 1 },
        group.breaker || {}
      ),
      timeoutMs: group.timeoutMs || 30000,
      authToken: group.authToken || (existing && existing.authToken) || '',
      updatedAt: new Date().toISOString(),
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    ztools.db.put(doc);
    return id;
  }

  static deleteRouteGroup(appType: string, id: string): boolean {
    try {
      ProxyManager.stopProxy(appType); // 若在跑先停
      ztools.db.remove(ProxyManager._routeKey(appType, id));
      return true;
    } catch (e) {
      return false;
    }
  }

  // —— 代理启停 ——

  static startProxy(appType: string, groupId: string): ProxyResult {
    const group = ProxyManager.getRouteGroup(appType, groupId);
    if (!group) return { success: false, error: 'group not found' };
    const members = ProxyManager._resolveMembers(appType, group);
    if (members.length === 0) return { success: false, error: 'no members' };
    const token = ProxyManager._ensureRouteToken(appType, group);
    // codex 代理模式下禁用 auth 验证（codex 使用 experimental_bearer_token 不会发送标准 auth header）
    const authToken = appType === 'codex' ? '' : token;
    try {
      const win = ztools.createBrowserWindow(
        'preload/proxy/proxy-daemon.html',
        {
          show: false,
          webPreferences: { preload: 'preload/proxy/proxy-daemon.js', zoomFactor: 1 }
        },
        function () {
          try {
            win.webContents.send('cfg', { group: group, members: members, authToken: authToken });
          } catch (e) {}
        }
      );
      daemonWins[appType] = win;
      proxyRuntime[appType] = {
        running: true,
        port: group.listenPort,
        groupId: groupId,
        // 先用配置成员占位，不依赖首次 proxy-stat 事件，面板随开随显
        members: members.map(function (m) {
          return {
            id: m.providerId,
            name: m.name,
            state: 'closed',
            fails: 0,
            openUntil: 0,
            latency: 0,
            up: true
          };
        })
      };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static stopProxy(appType: string): ProxyResult {
    const win = daemonWins[appType];
    if (win) {
      try {
        win.webContents.send('stop');
      } catch (e) {}
      try {
        win.destroy();
      } catch (e) {}
      delete daemonWins[appType];
    }
    if (proxyRuntime[appType]) proxyRuntime[appType].running = false;
    if (proxyRuntime._active === appType) delete proxyRuntime._active;
    return { success: true };
  }

  static getProxyStatus(appType: string): ProxyStatus {
    const rt = proxyRuntime[appType] || {};
    if (!proxyRuntime[appType]) return { running: false };
    let members: RuntimeMember[] = rt.members || [];
    if (rt.running && members.length === 0 && rt.groupId) {
      members = ProxyManager._fallbackMembers(appType, rt.groupId);
    }
    return {
      running: !!rt.running,
      port: rt.port,
      groupId: rt.groupId,
      startedAt: rt.startedAt || 0,
      activeConn: rt.activeConn || 0,
      reqTotal: rt.reqTotal || 0,
      reqSuccess: rt.reqSuccess || 0,
      reqFail: rt.reqFail || 0,
      lastMemberId: rt.lastMemberId || null,
      members: members
    };
  }

  // 主窗调用一次即可注册全局回调；daemon → 主窗事件透传到 window
  static onProxyEvent(cb: (channel: string, data: any) => void): void {
    if (typeof cb !== 'function') return;
    try {
      const { ipcRenderer } = require('electron');

      // 处理事件的通用函数
      function handleEvent(channel: string, data: any) {
        try {
          if (channel === 'proxy-stat' && data) {
            Object.keys(proxyRuntime).forEach(function (app) {
              const rt = proxyRuntime[app];
              if (rt && rt.port === data.port) {
                rt.running = !!data.running;
                rt.members = data.members || [];
                rt.startedAt = data.startedAt || 0;
                rt.activeConn = data.activeConn || 0;
                rt.reqTotal = data.reqTotal || 0;
                rt.reqSuccess = data.reqSuccess || 0;
                rt.reqFail = data.reqFail || 0;
                rt.lastMemberId = data.lastMemberId || null;
              }
            });
          } else if (channel === 'proxy-usage' && data) {
            // 统计改为扫描本地 CLI 日志（见 scanUsageLogs），代理事件不再写库，避免双写与关面板丢数据
          }
        } catch (e) {}
        try {
          cb(channel, data);
        } catch (e) {}
      }

      // 监听 parent-message 事件（ztools.sendToParent）
      ipcRenderer.removeAllListeners('parent-message');
      ipcRenderer.on('parent-message', function (_event: any, ...args: any[]) {
        const [channel, data] = args;
        handleEvent(channel, data);
      });

      // 监听 ipcRenderer.send 发送的事件
      ipcRenderer.removeAllListeners('proxy-stat');
      ipcRenderer.on('proxy-stat', function (_event: any, data: any) {
        handleEvent('proxy-stat', data);
      });
    } catch (e) {}
  }

  // —— 接管 / 还原 ——

  static takeoverApp(appType: string, listenPort?: number): ProxyResult {
    try {
      ProxyManager._backupCurrent(appType);
      const baseUrl = 'http://127.0.0.1:' + (listenPort || 8788);
      // 客户端配置里写入代理令牌作为 key；daemon 校验后再换成真实上游 key 转发
      let proxyToken = 'sk-ztoolscctoggle-proxy';
      try {
        const rt0 = proxyRuntime[appType];
        const g0 =
          rt0 && rt0.groupId
            ? ProxyManager.getRouteGroup(appType, rt0.groupId)
            : ProxyManager.ensureDefaultGroup(appType);
        if (g0) proxyToken = ProxyManager._ensureRouteToken(appType, g0);
      } catch (e) {
        /* 回退到占位符 */
      }
      let proxyModel = '';
      let proxyProviderName = '';
      const proxyCatalog: any[] = [];
      const proxyCatalogSeen: Record<string, boolean> = {};
      try {
        const rt = proxyRuntime[appType];
        const g =
          rt && rt.groupId
            ? ProxyManager.getRouteGroup(appType, rt.groupId)
            : ProxyManager.ensureDefaultGroup(appType);
        (g && g.members ? g.members : []).forEach(function (mem) {
          const prov: ProviderInfo | null = ProviderStore.getProvider(appType, mem.providerId);
          if (!prov) return;
          if (!proxyProviderName && prov.name) proxyProviderName = prov.name;
          if (!proxyModel && prov.model) proxyModel = prov.model;
          (Array.isArray(prov.modelCatalog) ? prov.modelCatalog : []).forEach(function (m: any) {
            const slug = m.slug || m.model || '';
            if (!slug || proxyCatalogSeen[slug]) return;
            proxyCatalogSeen[slug] = true;
            proxyCatalog.push(m);
          });
          if (
            prov.model &&
            !proxyCatalogSeen[prov.model] &&
            (!prov.modelCatalog || prov.modelCatalog.length === 0)
          ) {
            proxyCatalogSeen[prov.model] = true;
            proxyCatalog.push({ model: prov.model, displayName: prov.name || prov.model });
          }
        });
      } catch (e) {
        /* ignore */
      }
      // 用一个虚拟 provider 走原版 switch 逻辑写入配置
      // 用供应商名作为 provider 名称（中文等非 ASCII 字符只作展示，键名由后端清洗）
      const providerName = proxyProviderName || proxyModel || 'ztoolscctoggle-proxy';
      const fake = {
        id: '__proxy__',
        appType: appType,
        name: providerName,
        baseUrl: appType === 'codex' ? baseUrl + '/v1' : baseUrl,
        apiKey: proxyToken, // 代理令牌；daemon 校验后再用真实成员 key 转发
        model: proxyModel || 'gpt-4o',
        modelCatalog: proxyCatalog, // 用户可自行 override
        configType:
          appType === 'claude'
            ? 'anthropic'
            : appType === 'gemini'
              ? 'gemini'
              : appType === 'openclaw'
                ? 'openclaw'
                : 'openai',
        extraConfig: ''
      };
      if (appType === 'codex') configRw.switchProviderCodex(fake);
      else if (appType === 'claude') configRw.switchProviderClaude(fake);
      else if (appType === 'claude-desktop') configRw.switchProviderClaudeDesktop(fake);
      else if (appType === 'openclaw') configRw.switchProviderOpenclaw(fake);
      else if (appType === 'gemini') configRw.switchProviderGemini(fake);
      return { success: true, baseUrl: baseUrl };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static restoreApp(appType: string): ProxyResult {
    const bk = ProxyManager._readBackup(appType);
    if (!bk || !bk.previousProviderId) return { success: false, error: 'no backup' };
    const r = ProviderStore.switchProvider(appType, bk.previousProviderId);
    return r;
  }

  // —— 端口管理 ——

  static getProxyPort(appType: string): number {
    try {
      const doc = ztools.db.get(PORT_KEY);
      const p = doc && doc[appType];
      return Number(p) || DEFAULT_PROXY_PORT;
    } catch (e) {
      return DEFAULT_PROXY_PORT;
    }
  }

  static setProxyPort(appType: string, port: number): ProxyResult {
    const p = Number(port);
    if (!p || p < 1024 || p > 65535) return { success: false, error: 'port must be 1024-65535' };
    // 运行中不允许改
    if (proxyRuntime._active === appType) {
      return { success: false, error: 'proxy is running' };
    }
    const doc = ztools.db.get(PORT_KEY) || { _id: PORT_KEY };
    doc[appType] = p;
    // 同步更新该 App 的首个路由组
    const groups = ProxyManager.listRouteGroups(appType);
    if (groups[0]) {
      const g = ProxyManager.getRouteGroup(appType, groups[0].id!);
      if (g) {
        g.listenPort = p;
        ProxyManager.saveRouteGroup(g);
      }
    }
    return { success: true, port: p };
  }

  // 保证存在一个可用路由组：没有则用当前 App 下全部供应商自动生成
  static ensureDefaultGroup(appType: string): RouteGroup | null {
    const groups = ProxyManager.listRouteGroups(appType);
    const all = ProviderStore.listProviders(appType);
    if (groups.length) {
      const g = groups[0];
      g.appType = appType;
      if (!all.length) {
        ProxyManager.deleteRouteGroup(appType, g.id!);
        return null;
      }
      const wantPort = ProxyManager.getProxyPort(appType);
      if (g.listenPort !== wantPort) {
        g.listenPort = wantPort;
      }
      const allIds: Record<string, boolean> = {};
      all.forEach(function (p: any) {
        allIds[p.id] = true;
      });
      g.members = (g.members || []).filter(function (m) {
        return allIds[m.providerId];
      });
      const have: Record<string, boolean> = {};
      g.members.forEach(function (m) {
        have[m.providerId] = true;
      });
      all.forEach(function (p: any) {
        if (!have[p.id]) {
          g.members!.push({ providerId: p.id, priority: g.members!.length + 1, weight: 1 });
        }
      });
      ProxyManager.saveRouteGroup(g);
      return ProxyManager.getRouteGroup(appType, g.id!);
    }
    if (!all.length) return null;
    const id = ProxyManager.saveRouteGroup({
      appType: appType,
      name: '默认路由（自动）',
      strategy: 'failover',
      members: all.map(function (p: any, i: number) {
        return { providerId: p.id, priority: i + 1, weight: 1 };
      }),
      health: {
        intervalMs: 30000,
        timeoutMs: 5000,
        path: appType === 'claude' || appType === 'codex' ? '/v1/models' : '/models'
      },
      breaker: { failThreshold: 3, cooldownMs: 60000 },
      timeoutMs: 30000
    });
    return ProxyManager.getRouteGroup(appType, id);
  }

  // 快捷开关：启动 appType 的 默认路由组（第一个）
  static toggleProxyQuick(appType: string): ProxyResult {
    // 点击当前已开启的 App = 关闭
    if (proxyRuntime._active === appType) {
      ProxyManager.stopProxy(appType);
      ProxyManager.restoreApp(appType);
      return { success: true, running: false };
    }
    // 全局只允许一个 daemon：切换到别的 App 前先关旧的
    if (proxyRuntime._active) {
      ProxyManager.stopProxy(proxyRuntime._active);
      ProxyManager.restoreApp(proxyRuntime._active);
    }
    const g = ProxyManager.ensureDefaultGroup(appType);
    if (!g) return { success: false, error: 'no providers' };
    const s = ProxyManager.startProxy(appType, g.id!);
    if (!s.success) return s;
    const port = g.listenPort || ProxyManager.getProxyPort(appType);
    ProxyManager.takeoverApp(appType, port);
    proxyRuntime._active = appType;
    return { success: true, running: true, port: port, groupId: g.id };
  }
}

export { proxyRuntime, daemonWins };
