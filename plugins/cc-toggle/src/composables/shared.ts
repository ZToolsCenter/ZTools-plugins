// Shared constants and utilities across composables

import type { ZtoolsCctoggle, AppType } from '../types/ztools-cctoggle';

export const APP_TYPES: AppType[] = ['codex', 'claude', 'claude-desktop', 'openclaw', 'gemini'];

export const APP_OPTIONS = [
  { value: 'claude' as const, label: 'Claude' },
  { value: 'claude-desktop' as const, label: 'Claude Desktop' },
  { value: 'codex' as const, label: 'Codex' },
  { value: 'openclaw' as const, label: 'OpenClaw' },
  { value: 'opencode' as const, label: 'OpenCode' }
];

export const APP_LABELS: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  'claude-desktop': 'Claude Desktop',
  openclaw: 'OpenClaw',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  all: '全部'
};

import codexIcon from '../assets/images/agents/codex.png';
import claudeIcon from '../assets/images/agents/claude.png';
import claudeDesktopIcon from '../assets/images/agents/claude-desktop.png';
import openclawIcon from '../assets/images/agents/openclaw.png';
import geminiIcon from '../assets/images/agents/gemini.png';
import opencodeIcon from '../assets/images/agents/opencode.png';

export const APP_ICONS: Record<string, string> = {
  codex: codexIcon,
  claude: claudeIcon,
  'claude-desktop': claudeDesktopIcon,
  openclaw: openclawIcon,
  gemini: geminiIcon,
  opencode: opencodeIcon
};

/** 安全访问 window.ztoolsCctoggle API，返回类型为 ZtoolsCctoggle */
export function getSkillNest(): ZtoolsCctoggle {
  return window.ztoolsCctoggle!;
}

/** 检查 preload API 是否可用 */
export function hasSkillNest(): boolean {
  return !!window.ztoolsCctoggle;
}

/**
 * 递归将 Vue 响应式/ref 代理对象转为纯对象
 * 避免 ZTools IPC "An object could not be cloned" 错误
 */
export function toPlain<T>(v: T): T {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(toPlain) as T;
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object)) o[k] = toPlain((v as Record<string, unknown>)[k]);
    return o as T;
  }
  return v;
}
