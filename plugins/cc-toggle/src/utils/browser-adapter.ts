// 浏览器开发适配器
// 当不在 ZTools 环境时，通过 HTTP API 访问真实数据

// 开发模式下走 Vite proxy（同源），避免 CORS 问题
const API_BASE = '/api';

// 同步 XHR — 用于必须同步返回的 API（如 listProviders）
function fetchApiSync(path: string): any {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `${API_BASE}${path}`, false); // false = synchronous
  xhr.send();
  try {
    const result = JSON.parse(xhr.responseText);
    return result;
  } catch {
    return null;
  }
}

function postApiSync(path: string, body: any): any {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE}${path}`, false);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify(body));
  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return null;
  }
}

// 检测是否在 ZTools 环境
export function isZtoolsEnv(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).ztools !== 'undefined';
}

// ── 桌面小组件（浏览器模式模拟：打开状态为内存态）──

const _widgetOpen: Record<string, boolean> = {};

// 创建浏览器兼容的 ztoolsCctoggle API
export function createBrowserApi() {
  return {
    paths: {
      home: '',
      codexAuth: '',
      codexConfig: '',
      claudeSettings: '',
      claudeDesktopConfig: '',
      openclawConfig: '',
      geminiEnv: '',
      opencodeConfig: ''
    },

    // Agent 路径管理
    getConfigPaths() {
      try {
        return JSON.parse(localStorage.getItem('ccswitch_config_paths') || '{}');
      } catch {
        return {};
      }
    },
    setConfigPaths(paths: Record<string, string>) {
      localStorage.setItem('ccswitch_config_paths', JSON.stringify(paths));
    },
    getDefaultConfigDirs() {
      return {
        claude: '~/.claude',
        codex: '~/.codex',
        gemini: '~/.gemini',
        openclaw: '~/.openclaw',
        opencode: '~/.config/opencode'
      };
    },

    // 配置读取 (同步)
    getCurrentConfigs: () => fetchApiSync('/configs'),
    readCodexConfig: () => fetchApiSync('/config/codex'),
    readClaudeSettings: () => fetchApiSync('/config/claude'),
    readGeminiEnv: () => fetchApiSync('/config/gemini'),
    readOpenClawConfig: () => fetchApiSync('/config/openclaw'),
    readOpenCodeConfig: () => fetchApiSync('/config/opencode'),
    readClaudeDesktopConfig: () => fetchApiSync('/config/claude-desktop'),
    readClaudeOnboarding: () => false,
    setClaudeOnboarding: () => {},

    // Provider CRUD (同步调用，匹配原版 preload 行为)
    listProviders: (appType: string) => {
      const result = fetchApiSync(`/providers?appType=${appType}`);
      return Array.isArray(result) ? result : [];
    },
    getProvider: (appType: string, id: string) =>
      fetchApiSync(`/provider?appType=${appType}&id=${id}`),
    saveProvider: (appType: string, data: any) => postApiSync('/provider', { appType, data }),
    deleteProvider: (appType: string, id: string) =>
      postApiSync('/provider-delete', { appType, id }),
    sortProviders: (appType: string, orderedIds: string[]) =>
      postApiSync('/provider-sort', { appType, orderedIds })?.success === true,

    // Switch
    switchProvider: (_appType: string, _id: string) => {
      // 在浏览器模式下，切换操作需要通过 API 服务器完成
      // 这里返回成功，实际切换由服务器处理
      return { success: true, providerName: 'Browser Mode' };
    },
    getCurrentProviderId: (appType: string) =>
      fetchApiSync(`/provider/current?appType=${appType}`)?.id,
    reapplyCurrent: () => ({}),
    setLastActiveApp: (appType: string) => {
      // 写入当前激活 profile
      try {
        const activeId = window.ztoolsCctoggle?.getActiveProfileId?.();
        if (activeId) {
          const profile = window.ztoolsCctoggle?.getProfile?.(activeId);
          if (profile)
            window.ztoolsCctoggle?.saveProfile?.({ id: activeId, lastActiveApp: appType });
        }
      } catch (e) {}
      return true;
    },
    getLastActiveApp: () => {
      try {
        const activeId = window.ztoolsCctoggle?.getActiveProfileId?.();
        if (activeId) {
          const profile = window.ztoolsCctoggle?.getProfile?.(activeId);
          if (profile?.lastActiveApp) return profile.lastActiveApp;
        }
        // fallback 到 default profile
        const defaultProfile = window.ztoolsCctoggle?.getProfile?.('default');
        return defaultProfile?.lastActiveApp || '';
      } catch (e) {
        return '';
      }
    },

    // 统计
    clearStats: (appType?: string) => postApiSync('/stats/clear', { appType }),
    scanUsageLogs: async () => fetchApiSync('/stats'),

    // Import/Export
    exportAll: () => ({ codex: [], claude: [], gemini: [], exportTime: new Date().toISOString() }),
    importAll: () => 0,

    // Skills (简化版)
    getDefaultSkillDirs: () => ({}),
    getSkillStoragePaths: () => ({}),
    setSkillStoragePaths: () => {},
    listAllSkills: () => ({ nest: [] }),
    listSkillsInDir: () => [],
    getSkillRepos: () => [],
    addSkillRepo: () => ({ success: true }),
    removeSkillRepo: () => ({ success: true }),
    syncSkills: () => ({ success: true }),
    toggleSkillToAgent: () => ({ success: true }),
    searchSkills: async (query?: string, source?: string) => {
      const q = encodeURIComponent(query || '');
      const src = encodeURIComponent(source || 'skillsh');
      const res = await fetch(`${API_BASE}/skills/search?q=${q}&source=${src}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    installSkill: () => ({ success: true }),
    removeNestSkill: () => ({ success: true }),

    // SkillNest
    getNestDir: () => '',
    setNestDir: () => ({ success: true }),
    listNestSkills: () => [],
    getNestSkillMeta: () => ({}),
    deploySkill: () => ({ success: true }),
    undeploySkill: () => ({ success: true }),
    getDeployRegistry: () => ({}),
    listDeployments: () => ({}),

    // Project targets
    listProjectTargets: () => [],
    addProjectTarget: () => ({ success: true }),
    removeProjectTarget: () => ({ success: true }),

    // Utils
    generateId: () => Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
    getSyncMode: () => 'manual',
    setSyncMode: () => {},

    // Proxy / Router (浏览器模式下不可用)
    listRouteGroups: () => [],
    getRouteGroup: () => null,
    saveRouteGroup: () => '',
    deleteRouteGroup: () => false,
    startProxy: () => ({ success: false, error: 'Not available in browser mode' }),
    stopProxy: () => ({ success: false, error: 'Not available in browser mode' }),
    getProxyStatus: () => ({ running: false }),
    onProxyEvent: () => {},
    takeoverApp: () => ({ success: false, error: 'Not available in browser mode' }),
    restoreApp: () => ({ success: false, error: 'Not available in browser mode' }),
    toggleProxyQuick: () => ({ success: false, error: 'Not available in browser mode' }),
    getProxyPort: () => 0,
    setProxyPort: () => ({ success: false, error: 'Not available in browser mode' }),

    // MCP Server
    listMcpServers: () => [],
    getMcpServer: () => null,
    saveMcpServer: () => '',
    deleteMcpServer: () => {},
    toggleMcpServer: () => false,
    syncFromConfigFiles: () => {},

    // Session management
    scanSessions: async (
      app?: string,
      opts?: { offset?: number; limit?: number; search?: string; sort?: string }
    ) => {
      const params = new URLSearchParams();
      if (app) params.set('app', app);
      if (opts?.offset) params.set('offset', String(opts.offset));
      if (opts?.limit) params.set('limit', String(opts.limit));
      return fetchApiSync(`/sessions?${params}`);
    },
    loadSessionDetail: async (filePath: string) => {
      return fetchApiSync(`/session/detail?filePath=${encodeURIComponent(filePath)}`);
    },
    deleteSession: (filePath: string) => postApiSync('/session-delete', { filePath }),
    clearAllSessions: () => ({ success: true, count: 0, errors: [] }),
    clearSessionCache: () => {},

    // Prompt management
    listPrompts: () => {
      const result = fetchApiSync('/prompts');
      return Array.isArray(result) ? result : [];
    },
    getPrompt: (id: string) => {
      const prompts = fetchApiSync('/prompts');
      return (Array.isArray(prompts) ? prompts : []).find((p: any) => p.id === id) || null;
    },
    savePrompt: (data: any) => postApiSync('/prompts', data),
    deletePrompt: (id: string) => postApiSync('/prompts/delete', { id }),
    duplicatePrompt: (id: string) => postApiSync('/prompts/duplicate', { id }),
    exportPrompts: () => {
      const result = fetchApiSync('/prompts');
      return JSON.stringify(Array.isArray(result) ? result : [], null, 2);
    },
    importPrompts: () => ({ success: true, count: 0 }),
    readOriginalPrompt: (agent: string) => fetchApiSync(`/prompts/original?agent=${agent}`) || '',
    readAllOriginalPrompts: () => fetchApiSync('/prompts/original-all') || {},
    getOpenClawPromptFiles: () => {
      const result = fetchApiSync('/prompts/openclaw-files');
      return Array.isArray(result)
        ? result
        : ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md'];
    },
    readOpenClawPromptFiles: () => fetchApiSync('/prompts/openclaw-files/read') || {},
    backupOriginalPrompts: () => postApiSync('/prompts/backup-original', {}),
    backupSelectedPrompts: (selections: any) =>
      postApiSync('/prompts/backup-selected', { selections }),
    getBackups: () => fetchApiSync('/prompts/backups') || {},
    restoreOriginalPrompt: (agent: string, fileName?: string) =>
      postApiSync('/prompts/restore', { agent, fileName }),
    restoreAllOriginalPrompts: () => postApiSync('/prompts/restore-all', {}),
    applyPromptToAgent: (promptId: string, agent: string, fileName?: string) =>
      postApiSync('/prompts/apply', { promptId, agent, fileName }),
    togglePromptAgent: (promptId: string, agent: string, fileName?: string) =>
      postApiSync('/prompts/toggle', { promptId, agent, fileName }),

    // Profile 管理
    listProfiles: () => {
      const result = fetchApiSync('/profiles');
      return Array.isArray(result) ? result : [];
    },
    getProfile: (id: string) => fetchApiSync(`/profile?id=${id}`),
    saveProfile: (data: any) => postApiSync('/profile', data),
    deleteProfile: (id: string) => postApiSync('/profile-delete', { id }),
    activateProfile: (id: string) => postApiSync('/profile-activate', { id }),
    deactivateProfile: () => postApiSync('/profile-deactivate', {}),
    getActiveProfileId: () => fetchApiSync('/profile/active')?.id || null,

    // 余额查询
    getBalanceCache: () => fetchApiSync('/balance/cache') || {},
    clearBalanceCache: (providerId: string) => postApiSync('/balance/cache-delete', { providerId }),
    queryBalance: async (appType: string, providerId: string) =>
      postApiSync('/balance/query', { appType, providerId }),
    queryAllBalances: async (appType?: string) => postApiSync('/balance/query-all', { appType }),

    // 余额告警状态（持久化在项目文档 balanceNotify 字段）
    getBalanceNotifyState: (profileId: string) =>
      fetchApiSync(`/balance/notify?profileId=${encodeURIComponent(profileId)}`) || {},
    setBalanceNotified: (profileId: string, scopeKey: string, balance: number) =>
      postApiSync('/balance/notify-set', { profileId, scopeKey, balance }),
    clearBalanceNotified: (profileId: string, scopeKey: string) =>
      postApiSync('/balance/notify-clear', { profileId, scopeKey }),

    // 桌面小组件（浏览器模式：无真实窗口，打开状态为内存态）
    openWidget: (id: string) => {
      _widgetOpen[id] = true;
      return { success: true };
    },
    closeWidget: (id: string) => {
      _widgetOpen[id] = false;
      return { success: true };
    },
    toggleWidget: (id: string) => {
      if (_widgetOpen[id]) return window.ztoolsCctoggle?.closeWidget?.(id);
      return window.ztoolsCctoggle?.openWidget?.(id);
    },
    getWidgetStates: () =>
      Object.fromEntries(Object.keys(_widgetOpen).map(id => [id, { open: !!_widgetOpen[id] }])),
    listWidgets: () => [{ id: 'status', title: '当前供应商余额' }],

    // 文件保存（浏览器模式：触发下载）
    saveTextFile: (defaultName: string, content: string) => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      return { success: true };
    }
  };
}
