// @ts-nocheck TODO: 添加类型注解后移除
// Presets aggregator - merges provider metadata + per-app diffs
// Public API is unchanged: import { PRESETS } from "./presets"

import { PROVIDERS } from './providers';
import codexRaw from './presets-codex';
import claudeRaw from './presets-claude';
import claudeDesktopRaw from './presets-claude-desktop';
import openclawRaw from './presets-openclaw';
import geminiRaw from './presets-gemini';

const CODEX_DEFAULTS = {
  configType: 'openai',
  baseUrl: '',
  model: '',
  reasoningEffort: 'high',
  wireApi: 'responses',
  apiFormat: '',
  models: [],
  modelCatalog: [],
  endpointCandidates: [],
  config: '',
  authData: { OPENAI_API_KEY: '' }
};

const CLAUDE_DEFAULTS = {
  configType: 'anthropic',
  baseUrl: '',
  model: '',
  endpointCandidates: [],
  settingsConfig: { env: {} }
};

const OPENCLAW_DEFAULTS = {
  configType: 'openclaw',
  apiProtocol: 'openai-completions',
  baseUrl: '',
  model: '',
  models: [],
  endpointCandidates: [],
  settingsConfig: {},
  suggestedDefaults: null
};

const GEMINI_DEFAULTS = {
  configType: 'gemini',
  baseUrl: '',
  model: '',
  endpointCandidates: [],
  settingsConfig: { env: {} }
};

const CLAUDE_DESKTOP_DEFAULTS = {
  configType: 'anthropic',
  baseUrl: '',
  model: '',
  endpointCandidates: [],
  settingsConfig: { env: {} }
};

// Generate Codex `config` TOML from structured fields
function generateCodexConfig(p) {
  // provider 块名使用供应商名（configName 优先，回退到 provider 标识），并清洗为合法 TOML 键名
  const providerKey =
    (p.configName || p.provider || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/^_+|_+$/g, '') || 'custom';
  const lines = [`model_provider = "${providerKey}"`, `model = "${p.model || ''}"`];
  if (p.reviewModel) lines.push(`review_model = "${p.reviewModel}"`);
  if (!p.noReasoningEffort) {
    lines.push(`model_reasoning_effort = "${p.reasoningEffort || 'high'}"`);
  }
  lines.push(`disable_response_storage = true`);
  if (p.modelVerbosity) lines.push(`model_verbosity = "${p.modelVerbosity}"`);
  if (p.envKey) lines.push(`env_key = "${p.envKey}"`);
  if (p.queryParams) lines.push(`query_params = "${p.queryParams}"`);
  if (p.personality) lines.push(`personality = "${p.personality}"`);
  if (p.contextWindow) {
    lines.push(`model_context_window = ${p.contextWindow}`);
    lines.push(`model_auto_compact_token_limit = ${p.contextWindow}`);
  }
  lines.push('');
  lines.push(`[model_providers.${providerKey}]`);
  lines.push(`name = "${p.configName || p.provider}"`);
  lines.push(`base_url = "${p.baseUrl || ''}"`);
  lines.push(`wire_api = "${p.wireApi || 'responses'}"`);
  lines.push(`requires_openai_auth = true`);
  return lines.join('\n');
}

// Fields that are meta/generation params, not directly copied to output
const CODEX_META_KEYS = new Set([
  'provider',
  'configName',
  'reviewModel',
  'modelVerbosity',
  'envKey',
  'queryParams',
  'personality',
  'contextWindow',
  'noReasoningEffort'
]);

function mergeCodex(entry) {
  const meta = PROVIDERS[entry.provider] || {};
  const merged = { ...CODEX_DEFAULTS, ...meta };
  for (const [k, v] of Object.entries(entry)) {
    if (!CODEX_META_KEYS.has(k)) merged[k] = v;
  }
  // Generate config unless explicitly provided (or preset is a blank placeholder)
  if (merged.config === undefined || merged.config === '') {
    const hasContent = !!(entry.baseUrl || entry.model);
    if (hasContent) merged.config = generateCodexConfig(entry);
    else merged.config = '';
  }
  return merged;
}

function mergeSimple(entry, defaults) {
  const meta = PROVIDERS[entry.provider] || {};
  const merged = { ...defaults, ...meta };
  for (const [k, v] of Object.entries(entry)) {
    if (k !== 'provider') merged[k] = v;
  }
  return merged;
}

export const PRESETS = {
  codex: codexRaw.map(mergeCodex),
  claude: claudeRaw.map(e => mergeSimple(e, CLAUDE_DEFAULTS)),
  'claude-desktop': claudeDesktopRaw.map(e => mergeSimple(e, CLAUDE_DESKTOP_DEFAULTS)),
  openclaw: openclawRaw.map(e => mergeSimple(e, OPENCLAW_DEFAULTS)),
  gemini: geminiRaw.map(e => mergeSimple(e, GEMINI_DEFAULTS))
};

export default PRESETS;
