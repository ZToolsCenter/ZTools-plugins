// 快速切换入口（Quick Switch Entry）
// 为每个 Agent（Codex/Claude/Claude Desktop/OpenClaw/Gemini）注册 ZTools 动态命令，
// 在搜索框输入 `cc {Agent名}` 直接打开插件并切到对应 Agent 页签

import { ref } from 'vue';
import { APP_LABELS, APP_TYPES } from './shared';
import { useProviders } from './useProviders';
import type { AppType } from '../types/ztools-cctoggle';

const STORAGE_KEY = 'cctoggle_quick_switch';
const FEATURE_PREFIX = 'ccs_switch_';
const DEFAULT_CONFIG = { enabled: true, prefix: 'cc' };

export interface QuickSwitchConfig {
  enabled: boolean;
  prefix: string;
}

const config = ref<QuickSwitchConfig>({ ...DEFAULT_CONFIG });

function isZtoolsEnv(): boolean {
  return typeof ztools !== 'undefined' && typeof ztools.setFeature === 'function';
}

function loadConfig(): QuickSwitchConfig {
  const fallback = { ...DEFAULT_CONFIG };
  try {
    const raw = ztools?.dbStorage?.getItem(STORAGE_KEY);
    if (raw && typeof raw === 'object') return { ...fallback, ...raw };
  } catch (e) {
    /* ignore */
  }
  return fallback;
}

function persistConfig(cfg: QuickSwitchConfig): void {
  try {
    ztools?.dbStorage?.setItem(STORAGE_KEY, cfg);
  } catch (e) {
    /* ignore */
  }
}

function getPrefix(): string {
  return loadConfig().prefix || DEFAULT_CONFIG.prefix;
}

function isEnabled(): boolean {
  return loadConfig().enabled !== false;
}

function featureCode(appType: AppType): string {
  return `${FEATURE_PREFIX}${appType}`;
}

function parseCode(code: string): AppType | null {
  if (!code.startsWith(FEATURE_PREFIX)) return null;
  const appType = code.slice(FEATURE_PREFIX.length) as AppType;
  return APP_TYPES.includes(appType) ? appType : null;
}

/** 生成命令关键词数组：如 ['cc Codex'] */
function buildCmds(appType: AppType): string[] {
  return [`${getPrefix()} ${APP_LABELS[appType] || appType}`];
}

function setFeature(appType: AppType): void {
  try {
    ztools.setFeature({
      code: featureCode(appType),
      explain: `打开 CCToggle 并切换到 ${APP_LABELS[appType] || appType}`,
      cmds: buildCmds(appType)
    });
  } catch (e) {
    console.warn('[cctoggle] useQuickSwitch setFeature failed', featureCode(appType), e);
  }
}

function removeFeatureByCode(code: string): void {
  try {
    ztools.removeFeature(code);
  } catch (e) {
    console.warn('[cctoggle] useQuickSwitch removeFeature failed', code, e);
  }
}

/** 清理全部 ccs_switch_* 动态命令 */
function cleanupAll(): void {
  if (!isZtoolsEnv()) return;
  try {
    const features = ztools.getFeatures?.() || [];
    for (const f of features) {
      const code = f?.code;
      if (typeof code === 'string' && code.startsWith(FEATURE_PREFIX)) {
        removeFeatureByCode(code);
      }
    }
  } catch (e) {
    console.warn('[cctoggle] useQuickSwitch cleanup failed', e);
  }
}

/** 为单个 Agent 注册命令 */
function registerFor(appType: AppType): void {
  if (!isZtoolsEnv() || !isEnabled()) return;
  setFeature(appType);
}

/** 移除单个 Agent 的命令 */
function unregisterFor(appType: AppType): void {
  if (!isZtoolsEnv()) return;
  removeFeatureByCode(featureCode(appType));
}

/** 全量重建：先清已注册的 ccs_switch_* 命令，再按全部 Agent 重新注册（幂等） */
function reconcile(): void {
  if (!isZtoolsEnv()) return;
  cleanupAll();
  if (!isEnabled()) return;
  APP_TYPES.forEach(appType => registerFor(appType));
}

/** 执行切换：解析 code → 切到对应 Agent 页签并打开插件主界面（不退出） */
function executeSwitch(code: string): boolean {
  const appType = parseCode(code);
  if (!appType) return false;
  try {
    useProviders().setActiveTab(appType);
    ztools.showNotification(`已切换到 ${APP_LABELS[appType] || appType}`);
  } catch (e) {
    console.warn('[cctoggle] useQuickSwitch executeSwitch failed', code, e);
  }
  return true;
}

/** 载入配置到响应式状态（浏览器模式回退默认值） */
function loadQuickSwitchConfig(): void {
  config.value = loadConfig();
}

/** 保存配置并立即应用：启用则全量重建命令，禁用则清理全部命令 */
function saveQuickSwitchConfig(cfg: QuickSwitchConfig): void {
  config.value = { ...cfg };
  persistConfig(cfg);
  if (!isZtoolsEnv()) return;
  if (cfg.enabled) reconcile();
  else cleanupAll();
}

export function useQuickSwitch() {
  return {
    config,
    getPrefix,
    isEnabled,
    loadQuickSwitchConfig,
    saveQuickSwitchConfig,
    reconcile,
    registerFor,
    unregisterFor,
    buildCmds,
    executeSwitch
  };
}
