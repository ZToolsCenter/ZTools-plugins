// @ts-nocheck TODO: 逐步添加类型注解后移除
// ZTools ccToggle - preload.ts
// 主入口：ZtoolsPreload 类，统一初始化和 API 暴露
import { ProviderStore } from './providers/provider-db';
import { ProxyManager } from './proxy/proxy';
import { McpManager } from './agents/mcp';
import { SessionManager } from './agents/sessions';
import { PromptManager } from './agents/prompts';
import { SkillManager } from './agents/skills';
import { StatsCollector } from './agents/stats';
import { DataMigration } from './core/cleanup';
import { ConnectionTester } from './core/test-connection';
import { ProfileStore } from './providers/profile-db';
import { BalanceManager } from './providers/balance';
import { WidgetManager } from './widgets/widget-manager';
import { WidgetEvent } from './widgets/widget-events';
import * as configRw from './config/config-rw';
import * as utils from './utils';
class ZtoolsPreload {
  constructor() {
    this.init();
  }

  private init(): void {
    // 1. 执行数据迁移
    try {
      DataMigration.migrateAgentPaths();
    } catch (e) {
      console.error('[Preload] Migration failed:', e);
    }

    // 2. 标记当前供应商
    try {
      ['codex', 'claude', 'claude-desktop', 'gemini'].forEach(function (appType) {
        ProviderStore.markCurrent(appType, ProviderStore.getCurrentProviderId(appType));
      });
    } catch (e) {
      // ignore startup errors
    }

    // 3. 小组件置顶通知：接收小组件窗口的 sendToParent，应用到对应窗口
    try {
      const { ipcRenderer } = require('electron');
      ipcRenderer.on('cctoggle-widget-always-on-top', function (_event: any, data: any) {
        WidgetManager.setAlwaysOnTop('status', !!(data && data.value));
      });
    } catch (e) {
      console.error('[Preload] widget ipc init failed:', e);
    }

    // 4. 暴露 API
    this.exposeApi();
  }

  private exposeApi(): void {
    window.ztoolsCctoggle = {
      // Paths
      paths: {
        home: utils.getHomeDir(),
        codexAuth: utils.getCodexAuthPath(),
        codexConfig: utils.getCodexConfigPath(),
        claudeSettings: utils.getClaudeSettingsPath(),
        claudeDesktopConfig: utils.getClaudeDesktopConfigPath(),
        openclawConfig: utils.getOpenClawConfigPath(),
        geminiEnv: utils.getGeminiEnvPath(),
        opencodeConfig: utils.getOpenCodeConfigPath()
      },

      // Agent 路径管理
      getConfigPaths: function () {
        return ztools.dbStorage.getItem('ccswitch_config_paths') || {};
      },
      setConfigPaths: function (paths) {
        ztools.dbStorage.setItem('ccswitch_config_paths', paths);
      },
      getDefaultConfigDirs: utils.getDefaultConfigDirs,

      // Config read
      getCurrentConfigs: configRw.getCurrentConfigs,
      readCodexConfig: configRw.readCodexConfig,
      readClaudeSettings: configRw.readClaudeSettings,
      readGeminiEnv: configRw.readGeminiEnv,
      readOpenClawConfig: configRw.readOpenClawConfig,
      readOpenCodeConfig: configRw.readOpenCodeConfig,
      readClaudeDesktopConfig: configRw.readClaudeDesktopConfig,
      readClaudeOnboarding: configRw.readClaudeOnboarding,
      setClaudeOnboarding: configRw.setClaudeOnboarding,

      // Provider CRUD
      listProviders: ProviderStore.listProviders,
      getProvider: ProviderStore.getProvider,
      saveProvider: function (appType: string, providerData: any) {
        const r = ProviderStore.saveProvider(appType, providerData);
        if (r && r.changed) {
          try {
            WidgetManager.broadcast(WidgetEvent.PROVIDER_UPDATED, {
              appType: appType,
              providerId: r.id
            });
          } catch (e) {}
        }
        return r;
      },
      deleteProvider: ProviderStore.deleteProvider,
      sortProviders: ProviderStore.sortProviders,

      // Switch
      switchProvider: function (appType: string, providerId: string) {
        const r = ProviderStore.switchProvider(appType, providerId);
        if (r && r.success) {
          try {
            WidgetManager.broadcast(WidgetEvent.PROVIDER_SWITCHED, {
              appType: appType,
              providerId: providerId
            });
          } catch (e) {}
        }
        return r;
      },
      getCurrentProviderId: ProviderStore.getCurrentProviderId,
      reapplyCurrent: ProviderStore.reapplyCurrent,
      setLastActiveApp: ProviderStore.setLastActiveApp,
      getLastActiveApp: ProviderStore.getLastActiveApp,

      // 统计
      clearStats: StatsCollector.clearStats,
      scanUsageLogs: StatsCollector.scanUsageLogs,

      // Import/Export
      exportAll: ProviderStore.exportAllProviders,
      importAll: ProviderStore.importProviders,

      // Skills management
      getDefaultSkillDirs: SkillManager.getDefaultSkillDirs,
      getSkillStoragePaths: SkillManager.getSkillStoragePaths,
      setSkillStoragePaths: SkillManager.setSkillStoragePaths,
      listAllSkills: SkillManager.listAllSkills,
      listSkillsInDir: SkillManager.listSkillsInDir,
      getSkillRepos: SkillManager.getSkillRepos,
      addSkillRepo: SkillManager.addSkillRepo,
      removeSkillRepo: SkillManager.removeSkillRepo,
      syncSkills: SkillManager.syncSkills,
      toggleSkillToAgent: SkillManager.toggleSkillToAgent,
      searchSkills: SkillManager.searchSkills,
      installSkill: SkillManager.installSkill,
      removeNestSkill: SkillManager.removeNestSkill,

      // CCToggle Skills
      getNestDir: SkillManager.getNestDir,
      setNestDir: SkillManager.setNestDir,
      listNestSkills: SkillManager.listNestSkills,
      getNestSkillMeta: SkillManager.getNestSkillMeta,
      deploySkill: SkillManager.deploySkill,
      undeploySkill: SkillManager.undeploySkill,
      getDeployRegistry: SkillManager.getDeployRegistry,
      listDeployments: SkillManager.listDeployments,

      // Project targets
      listProjectTargets: SkillManager.listProjectTargets,
      addProjectTarget: SkillManager.addProjectTarget,
      removeProjectTarget: SkillManager.removeProjectTarget,

      // Utils
      generateId: utils.generateId,
      getSyncMode: SkillManager.getSyncMode,
      setSyncMode: SkillManager.setSyncMode,

      // Proxy / Router
      listRouteGroups: ProxyManager.listRouteGroups,
      getRouteGroup: ProxyManager.getRouteGroup,
      saveRouteGroup: ProxyManager.saveRouteGroup,
      deleteRouteGroup: ProxyManager.deleteRouteGroup,
      startProxy: ProxyManager.startProxy,
      stopProxy: ProxyManager.stopProxy,
      getProxyStatus: ProxyManager.getProxyStatus,
      onProxyEvent: ProxyManager.onProxyEvent,
      takeoverApp: ProxyManager.takeoverApp,
      restoreApp: ProxyManager.restoreApp,
      toggleProxyQuick: ProxyManager.toggleProxyQuick,
      getProxyPort: ProxyManager.getProxyPort,
      setProxyPort: ProxyManager.setProxyPort,

      // MCP Server management
      listMcpServers: McpManager.listMcpServers,
      getMcpServer: McpManager.getMcpServer,
      saveMcpServer: McpManager.saveMcpServer,
      deleteMcpServer: McpManager.deleteMcpServer,
      toggleMcpServer: McpManager.toggleMcpServer,
      syncFromConfigFiles: McpManager.syncFromConfigFiles,

      // Session management
      scanSessions: SessionManager.scanSessions,
      loadSessionDetail: SessionManager.loadSessionDetail,
      deleteSession: SessionManager.deleteSession,
      clearAllSessions: SessionManager.clearAllSessions,
      clearSessionCache: SessionManager.clearSessionCache,

      // Prompt management
      listPrompts: PromptManager.listPrompts,
      getPrompt: PromptManager.getPrompt,
      savePrompt: PromptManager.savePrompt,
      deletePrompt: PromptManager.deletePrompt,
      duplicatePrompt: PromptManager.duplicatePrompt,
      exportPrompts: PromptManager.exportPrompts,
      importPrompts: PromptManager.importPrompts,
      readOriginalPrompt: PromptManager.readOriginalPrompt,
      readAllOriginalPrompts: PromptManager.readAllOriginalPrompts,
      getOpenClawPromptFiles: PromptManager.getOpenClawPromptFiles,
      readOpenClawPromptFiles: PromptManager.readOpenClawPromptFiles,
      backupOriginalPrompts: PromptManager.backupOriginalPrompts,
      backupSelectedPrompts: PromptManager.backupSelectedPrompts,
      getBackups: PromptManager.getBackups,
      restoreOriginalPrompt: PromptManager.restoreOriginalPrompt,
      restoreAllOriginalPrompts: PromptManager.restoreAllOriginalPrompts,
      applyPromptToAgent: PromptManager.applyPromptToAgent,
      togglePromptAgent: PromptManager.togglePromptAgent,

      // Test connection
      testConnection: ConnectionTester.testConnection,
      fetchAvailableModels: ConnectionTester.fetchAvailableModels,

      // 余额查询
      getBalanceCache: BalanceManager.getBalanceCache,
      clearBalanceCache: BalanceManager.clearProviderCache,
      queryBalance: function (appType: string, providerId: string) {
        return BalanceManager.queryBalance(appType, providerId).then(function (r: any) {
          if (r && r.success) {
            try {
              WidgetManager.broadcast(WidgetEvent.BALANCE_REFRESHED, {
                appType: appType,
                providerId: providerId
              });
            } catch (e) {}
          }
          return r;
        });
      },
      queryAllBalances: BalanceManager.queryAllBalances,

      // 余额告警状态（持久化去重）
      getBalanceNotifyState: BalanceManager.getBalanceNotifyState,
      setBalanceNotified: BalanceManager.setBalanceNotified,
      clearBalanceNotified: BalanceManager.clearBalanceNotified,

      // 桌面小组件
      openWidget: WidgetManager.open,
      closeWidget: WidgetManager.close,
      toggleWidget: WidgetManager.toggle,
      getWidgetStates: WidgetManager.getStates,
      listWidgets: WidgetManager.listWidgets,

      // Profile 管理
      listProfiles: ProfileStore.listProfiles,
      getProfile: ProfileStore.getProfile,
      saveProfile: ProfileStore.saveProfile,
      deleteProfile: ProfileStore.deleteProfile,
      activateProfile: ProfileStore.activateProfile,
      deactivateProfile: ProfileStore.deactivateProfile,
      getActiveProfileId: ProfileStore.getActiveProfileId,

      // 文件保存（preload 环境有 Node fs，前端渲染进程可能没有 require）
      saveTextFile: function (defaultName: string, content: string, filters?: any) {
        try {
          const fs = utils.fs;
          let savePath: string | undefined;
          try {
            savePath = ztools.showSaveDialog({
              defaultPath: defaultName,
              filters: filters || [{ name: 'File', extensions: ['txt'] }]
            });
          } catch (e) {
            savePath = '';
          }
          if (!savePath) return { success: false, canceled: true };
          fs.writeFileSync(savePath, content, 'utf8');
          return { success: true, path: savePath };
        } catch (e: any) {
          return { success: false, error: e && e.message ? e.message : String(e) };
        }
      }
    };
  }
}

// 启动
new ZtoolsPreload();
