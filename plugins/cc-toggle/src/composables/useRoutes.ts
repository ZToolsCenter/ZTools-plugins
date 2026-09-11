import { reactive } from 'vue';
import { getSkillNest } from './shared';
import type { ProxyStatus, ProxyToggleResult, RouteGroup } from '../types/ztools-cctoggle';

interface ProxyRuntime {
  running: boolean;
  port: number;
  members: any[];
  startedAt: number;
  activeConn: number;
  reqTotal: number;
  reqSuccess: number;
  reqFail: number;
  lastMemberId: string | null;
}

function _emptyRt(): ProxyRuntime {
  return {
    running: false,
    port: 0,
    members: [],
    startedAt: 0,
    activeConn: 0,
    reqTotal: 0,
    reqSuccess: 0,
    reqFail: 0,
    lastMemberId: null
  };
}

const runtime = reactive<Record<string, ProxyRuntime>>({
  codex: _emptyRt(),
  claude: _emptyRt(),
  'claude-desktop': _emptyRt(),
  openclaw: _emptyRt(),
  gemini: _emptyRt()
});

let _wired = false;

function _wireEvents(): void {
  if (_wired) return;
  _wired = true;
  try {
    getSkillNest().onProxyEvent((channel: string, data: any) => {
      if (channel === 'proxy-stat' && data) {
        for (const app of Object.keys(runtime)) {
          if (runtime[app].port && runtime[app].port === data.port) {
            Object.assign(runtime[app], {
              running: !!data.running,
              members: data.members || [],
              startedAt: data.startedAt || 0,
              activeConn: data.activeConn || 0,
              reqTotal: data.reqTotal || 0,
              reqSuccess: data.reqSuccess || 0,
              reqFail: data.reqFail || 0,
              lastMemberId: data.lastMemberId || null
            });
          }
        }
      }
    });
  } catch (e) {
    /* ignore */
  }
}

function refreshStatus(appType: string): void {
  if (!appType || !runtime[appType]) return;
  _wireEvents();
  const s = getSkillNest().getProxyStatus(appType) || ({} as ProxyStatus);
  const rt = runtime[appType];
  Object.assign(rt, {
    running: !!(s as any).running,
    port: (s as any).port || 0,
    members: (s as any).members || [],
    startedAt: (s as any).startedAt || 0,
    activeConn: (s as any).activeConn || 0,
    reqTotal: (s as any).reqTotal || 0,
    reqSuccess: (s as any).reqSuccess || 0,
    reqFail: (s as any).reqFail || 0,
    lastMemberId: (s as any).lastMemberId || null
  });
}

function listGroups(appType: string): RouteGroup[] {
  return getSkillNest().listRouteGroups(appType) || [];
}

function saveGroup(g: Partial<RouteGroup>): string {
  return getSkillNest().saveRouteGroup(g);
}

function deleteGroup(appType: string, id: string): boolean {
  return getSkillNest().deleteRouteGroup(appType, id);
}

function startProxy(appType: string, groupId: string) {
  _wireEvents();
  const r = getSkillNest().startProxy(appType, groupId);
  refreshStatus(appType);
  return r;
}

function stopProxy(appType: string) {
  const r = getSkillNest().stopProxy(appType);
  refreshStatus(appType);
  return r;
}

function refreshAll(): void {
  Object.keys(runtime).forEach(a => refreshStatus(a));
}

function toggleQuick(appType: string): ProxyToggleResult {
  _wireEvents();
  const r = getSkillNest().toggleProxyQuick(appType);
  refreshAll();
  setTimeout(refreshAll, 300);
  return r;
}

function takeover(appType: string, port?: number): ProxyToggleResult {
  return getSkillNest().takeoverApp(appType, port);
}

function restore(appType: string) {
  return getSkillNest().restoreApp(appType);
}

function getProxyPort(appType: string): number {
  try {
    return getSkillNest().getProxyPort(appType) || 8788;
  } catch (e) {
    return 8788;
  }
}

function setProxyPort(appType: string, port: number) {
  return getSkillNest().setProxyPort(appType, port) || { success: false };
}

export function useRoutes() {
  return {
    runtime,
    listGroups,
    saveGroup,
    deleteGroup,
    startProxy,
    stopProxy,
    toggleQuick,
    takeover,
    restore,
    refreshStatus,
    getProxyPort,
    setProxyPort
  };
}
