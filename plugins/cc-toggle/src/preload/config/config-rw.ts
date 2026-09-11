// @ts-nocheck TODO: 逐步添加类型注解后移除
// ZTools ccToggle - config-rw.js
// 各 AI 工具配置文件读写

var utils = require('../utils');
var fs = utils.fs;
var path = utils.path;
var getHomeDir = utils.getHomeDir;
var getCodexAuthPath = utils.getCodexAuthPath;
var getCodexConfigPath = utils.getCodexConfigPath;
var getClaudeSettingsPath = utils.getClaudeSettingsPath;
var getGeminiEnvPath = utils.getGeminiEnvPath;
var getOpenClawConfigPath = utils.getOpenClawConfigPath;
var getClaudeJsonPath = utils.getClaudeJsonPath;
var getClaudeDesktopConfigPath = utils.getClaudeDesktopConfigPath;
var getClaudeDesktop3pConfigPath = utils.getClaudeDesktop3pConfigPath;
var getClaudeDesktopProfilePath = utils.getClaudeDesktopProfilePath;
var getClaudeDesktopMetaPath = utils.getClaudeDesktopMetaPath;
var ensureDir = utils.ensureDir;
var getCodexInstructions = utils.getCodexInstructions;
var getAgentConfigPath = utils.getAgentConfigPath;

// ——————————— Codex 配置读写 ———————————

function readCodexConfig() {
  try {
    const configDir = getAgentConfigPath('codex');
    const authPath = configDir ? path.join(configDir, 'auth.json') : getCodexAuthPath();
    const configPath = configDir ? path.join(configDir, 'config.toml') : getCodexConfigPath();
    let auth = {};
    let config = '';
    if (fs.existsSync(authPath)) {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    }
    if (fs.existsSync(configPath)) {
      config = fs.readFileSync(configPath, 'utf8');
    }
    return { auth, config };
  } catch (e) {
    return { auth: {}, config: '' };
  }
}

function writeCodexConfig(auth, configToml) {
  const configDir = getAgentConfigPath('codex');
  const authPath = configDir ? path.join(configDir, 'auth.json') : getCodexAuthPath();
  const configPath = configDir ? path.join(configDir, 'config.toml') : getCodexConfigPath();
  ensureDir(authPath);
  ensureDir(configPath);
  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');
  let existing = '';
  try {
    if (fs.existsSync(configPath)) existing = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    existing = '';
  }
  const merged = mergeCodexConfig(existing, configToml);
  fs.writeFileSync(configPath, merged, 'utf8');
  return true;
}

// 将插件生成的 provider 配置合并进现有 config.toml
// 只替换顶层 provider 相关键与本次写入声明的 [表] 段，其余内容原样保留
function mergeCodexConfig(existing, incoming) {
  if (!existing || !existing.trim()) return incoming;

  // header 为 null 的块表示文件开头的顶层键区。
  function parseBlocks(text) {
    const blocks = [];
    let cur = { header: null, tableName: null, lines: [] };
    text.split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
      if (m) {
        blocks.push(cur);
        cur = { header: line, tableName: m[1].trim(), lines: [] };
      } else {
        cur.lines.push(line);
      }
    });
    blocks.push(cur);
    return blocks;
  }
  // 顶层键名（形如 `key = ...`），用于识别本次写入声明的顶层键
  function topLevelKeys(topBlock) {
    const keys = {};
    (topBlock ? topBlock.lines : []).forEach(function (line) {
      const km = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
      if (km) keys[km[1]] = true;
    });
    return keys;
  }

  const oldBlocks = parseBlocks(existing);
  const newBlocks = parseBlocks(incoming);

  const newTop = newBlocks.find(function (b) {
    return b.header === null;
  }) || { lines: [] };
  const incomingKeys = topLevelKeys(newTop);
  const incomingTables = {};
  newBlocks.forEach(function (b) {
    if (b.header !== null && b.tableName) incomingTables[b.tableName] = true;
  });
  // 本次是否声明了 model_providers.* 表；若声明则清除旧的所有 provider 表，避免残留废弃项
  const incomingHasProvider = Object.keys(incomingTables).some(function (t) {
    return t.indexOf('model_providers.') === 0;
  });

  // 1) 合并顶层键区：保留旧文件里本次未声明的顶层键，覆盖本次声明的键
  const oldTop = oldBlocks.find(function (b) {
    return b.header === null;
  }) || { lines: [] };
  const mergedTopLines = [];
  oldTop.lines.forEach(function (line) {
    const km = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
    if (km && incomingKeys[km[1]]) return;
    mergedTopLines.push(line);
  });
  while (mergedTopLines.length && mergedTopLines[mergedTopLines.length - 1].trim() === '')
    mergedTopLines.pop();
  newTop.lines.forEach(function (line) {
    mergedTopLines.push(line);
  });

  // 2) 表段：本次声明的表用新内容替换；旧文件里其余表原样保留
  const outParts = [];
  const topText = mergedTopLines.join('\n').replace(/\n+$/, '');
  if (topText.trim()) outParts.push(topText);
  oldBlocks.forEach(function (b) {
    if (b.header === null) return;
    if (incomingTables[b.tableName]) return;
    if (incomingHasProvider && b.tableName && b.tableName.indexOf('model_providers.') === 0) return;
    outParts.push([b.header].concat(b.lines).join('\n').replace(/\n+$/, ''));
  });
  newBlocks.forEach(function (b) {
    if (b.header === null) return;
    outParts.push([b.header].concat(b.lines).join('\n').replace(/\n+$/, ''));
  });

  return outParts.join('\n\n') + '\n';
}

// ——————————— Claude 配置读写 ———————————

function readClaudeSettings() {
  try {
    const configDir = getAgentConfigPath('claude');
    const settingsPath = configDir
      ? path.join(configDir, 'settings.json')
      : getClaudeSettingsPath();
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    return {};
  } catch (e) {
    return {};
  }
}

function writeClaudeSettings(settings) {
  const configDir = getAgentConfigPath('claude');
  const settingsPath = configDir ? path.join(configDir, 'settings.json') : getClaudeSettingsPath();
  ensureDir(settingsPath);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return true;
}

// ——————————— Claude Desktop 配置读写 ———————————

function readClaudeDesktopConfig() {
  try {
    var p = getClaudeDesktopConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    /* JSON 损坏时回退默认 */
  }
  return {};
}

function writeClaudeDesktopConfig(config) {
  var p = getClaudeDesktopConfigPath();
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
  return true;
}

function switchProviderClaudeDesktop(provider) {
  if (!provider) return { success: false, error: 'provider not found' };

  // 检查代理是否在运行（多种检测方式）
  var proxyPort = 0;
  var proxyToken = '';
  try {
    var proxy = require('../proxy/proxy');
    var rt = proxy.getProxyStatus('claude-desktop');
    if (rt && rt.running) {
      proxyPort = rt.port || 8788;
      var groupId = rt.groupId;
      if (groupId) {
        var g = proxy.getRouteGroup('claude-desktop', groupId);
        if (g) proxyToken = g.authToken || '';
      }
    }
    // fallback：从 proxyRuntime 获取
    if (!proxyPort && proxy.proxyRuntime && proxy.proxyRuntime['claude-desktop']) {
      var prt = proxy.proxyRuntime['claude-desktop'];
      if (prt.running) {
        proxyPort = prt.port || 8788;
        var gid = prt.groupId;
        if (gid) {
          var pg = proxy.getRouteGroup('claude-desktop', gid);
          if (pg) proxyToken = pg.authToken || '';
        }
      }
    }
    // fallback：遍历所有路由组获取 token
    if (proxyPort && !proxyToken) {
      var groups = proxy.listRouteGroups('claude-desktop');
      for (var i = 0; i < groups.length; i++) {
        var gg = proxy.getRouteGroup('claude-desktop', groups[i].id);
        if (gg && gg.authToken) {
          proxyToken = gg.authToken;
          break;
        }
      }
    }
  } catch (e) {
    /* ignore */
  }

  var baseUrl, apiKey;
  if (proxyPort && proxyToken) {
    // 代理模式：profile 指向本地代理
    baseUrl = 'http://127.0.0.1:' + proxyPort;
    apiKey = proxyToken;
  } else {
    // 直连模式：profile 指向 API
    var envSrc = (provider.settingsConfig && provider.settingsConfig.env) || {};
    baseUrl = envSrc.ANTHROPIC_BASE_URL || provider.baseUrl || '';
    apiKey = provider.apiKey || envSrc.ANTHROPIC_AUTH_TOKEN || envSrc.ANTHROPIC_API_KEY || '';
    if (!baseUrl) return { success: false, error: 'missing ANTHROPIC_BASE_URL' };
    if (!apiKey) return { success: false, error: 'missing API key' };
  }

  // 1. 设置 deploymentMode: "3p" 到两个配置文件
  _writeDeploymentMode(getClaudeDesktopConfigPath(), '3p');
  _writeDeploymentMode(getClaudeDesktop3pConfigPath(), '3p');

  // 1.5 更新 claude_desktop_config.json 中的 apiProviders 指向代理
  // 确保探测请求也走代理路径
  var mainConfigPath = getClaudeDesktopConfigPath();
  var mainConfig = {};
  try {
    if (fs.existsSync(mainConfigPath))
      mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
  } catch (e) {
    mainConfig = {};
  }
  mainConfig.apiProviders = {
    'custom-provider': {
      apiBase: baseUrl,
      apiKey: apiKey
    }
  };
  try {
    fs.writeFileSync(mainConfigPath, JSON.stringify(mainConfig, null, 2), 'utf8');
  } catch (e) {}

  // 2. 写入 profile 文件
  // inferenceModels 必须使用 Anthropic 官方模型名，模型映射由网关处理
  var profile = {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: apiKey,
    inferenceGatewayAuthScheme: 'bearer',
    inferenceModels: [
      { name: 'claude-sonnet-5', supports1m: true },
      { name: 'claude-opus-4-8', supports1m: true },
      { name: 'claude-haiku-4-5', supports1m: true }
    ],
    disableDeploymentModeChooser: true,
    coworkEgressAllowedHosts: ['*']
  };

  var profilePath = getClaudeDesktopProfilePath();
  ensureDir(profilePath);
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');

  // 3. 写入 meta 文件
  var PROFILE_ID = '00000000-0000-4000-8000-000000157210';
  var metaPath = getClaudeDesktopMetaPath();
  var meta = {};
  try {
    if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (e) {
    meta = {};
  }

  // 移除旧条目，添加新条目
  var entries = (meta.entries || []).filter(function (e) {
    return e.id !== PROFILE_ID;
  });
  entries.push({ id: PROFILE_ID, name: 'CC Toggle' });
  meta.entries = entries;
  meta.appliedId = PROFILE_ID;

  ensureDir(metaPath);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  return { success: true, mode: proxyPort ? 'proxy' : 'direct', port: proxyPort };
}

// 写入 deploymentMode 到指定配置文件
function _writeDeploymentMode(configPath, mode) {
  var config = {};
  try {
    if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    config = {};
  }
  if (typeof config !== 'object' || config === null) config = {};
  config.deploymentMode = mode;
  ensureDir(configPath);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// 恢复 Claude Desktop 官方配置（1p 模式）
function restoreOfficialClaudeDesktop() {
  var PROFILE_ID = '00000000-0000-4000-8000-000000157210';

  // 1. 设置 deploymentMode: "1p"
  _writeDeploymentMode(getClaudeDesktopConfigPath(), '1p');
  _writeDeploymentMode(getClaudeDesktop3pConfigPath(), '1p');

  // 2. 删除 profile 文件
  var profilePath = getClaudeDesktopProfilePath();
  try {
    if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);
  } catch (e) {
    /* ignore */
  }

  // 3. 清除 meta 文件中的 appliedId
  var metaPath = getClaudeDesktopMetaPath();
  try {
    if (fs.existsSync(metaPath)) {
      var meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.appliedId === PROFILE_ID) delete meta.appliedId;
      meta.entries = (meta.entries || []).filter(function (e) {
        return e.id !== PROFILE_ID;
      });
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    }
  } catch (e) {
    /* ignore */
  }

  return true;
}

// ——————————— Claude Onboarding 跳过 ———————————

function readClaudeOnboarding() {
  try {
    var p = getClaudeJsonPath();
    if (fs.existsSync(p)) {
      var config = JSON.parse(fs.readFileSync(p, 'utf8'));
      return !!config.hasCompletedOnboarding;
    }
  } catch (e) {}
  return false;
}

function setClaudeOnboarding(skip) {
  var p = getClaudeJsonPath();
  var config = {};
  try {
    if (fs.existsSync(p)) config = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    config = {};
  }

  if (skip) {
    config.hasCompletedOnboarding = true;
  } else {
    delete config.hasCompletedOnboarding;
  }

  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
  return true;
}

// ——————————— Gemini 配置读写 ———————————

function readGeminiEnv() {
  try {
    const configDir = getAgentConfigPath('gemini');
    const envPath = configDir ? path.join(configDir, '.env') : getGeminiEnvPath();
    if (fs.existsSync(envPath)) {
      return fs.readFileSync(envPath, 'utf8');
    }
    return '';
  } catch (e) {
    return '';
  }
}

function writeGeminiEnv(envContent) {
  const configDir = getAgentConfigPath('gemini');
  const envPath = configDir ? path.join(configDir, '.env') : getGeminiEnvPath();
  ensureDir(envPath);
  fs.writeFileSync(envPath, envContent, 'utf8');
  return true;
}

// ——————————— OpenClaw 配置读写 ———————————

function readOpenClawConfig() {
  try {
    const configDir = getAgentConfigPath('openclaw');
    const p = configDir ? path.join(configDir, 'openclaw.json') : getOpenClawConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    /* JSON5/损坏时回退默认 */
  }
  return { models: { mode: 'merge', providers: {} } };
}

function writeOpenClawConfig(config) {
  const configDir = getAgentConfigPath('openclaw');
  const p = configDir ? path.join(configDir, 'openclaw.json') : getOpenClawConfigPath();
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
  return true;
}

// ——————————— OpenCode 配置读写 ———————————

function readOpenCodeConfig() {
  try {
    const p = utils.getOpenCodeConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    /* JSON 损坏时回退默认 */
  }
  return {};
}

function writeOpenCodeConfig(config) {
  const p = utils.getOpenCodeConfigPath();
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
  return true;
}

// OpenCode 切换：opencode.json 的 provider / model 字段
// 采用叠加式：写入该供应商到 config.provider，并设置 model
function switchProviderOpenCode(provider) {
  if (!provider) return { success: false, error: 'provider not found' };
  const config = readOpenCodeConfig();
  const key =
    (provider.name || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom';
  const baseUrl = provider.baseUrl || '';
  const apiKey = provider.apiKey || '';
  const model = provider.model || '';

  const sc = provider.settingsConfig || {};
  const providerConfig = {
    npm: '@ai-sdk/openai-compatible',
    name: provider.name || key,
    options: {
      baseURL: baseUrl || undefined,
      apiKey: apiKey || undefined
    }
  };
  if (sc.options && typeof sc.options === 'object') {
    Object.assign(providerConfig.options, sc.options);
  }
  const models = {};
  if (provider.models && provider.models.length) {
    provider.models.forEach(function (m) {
      models[m] = { name: m };
    });
  }
  if (model) models[model] = { name: model };
  if (Object.keys(models).length) providerConfig.models = models;
  config.provider = config.provider || {};
  config.provider[key] = providerConfig;
  if (model) config.model = key + '/' + model;

  writeOpenCodeConfig(config);
  return { success: true, mode: 'direct' };
}

// ——————————— 综合读取 ———————————

function getCurrentConfigs() {
  return {
    codex: readCodexConfig(),
    claude: readClaudeSettings(),
    openclaw: readOpenClawConfig(),
    gemini: readGeminiEnv(),
    opencode: readOpenCodeConfig()
  };
}

// ——————————— 供应商切换逻辑 ———————————

function switchProviderCodex(provider) {
  // 构建 auth.json
  const auth = Object.assign({}, provider.authData || {});
  if (provider.apiKey) {
    if (Object.keys(auth).length === 0) {
      if (provider.configType === 'gemini') auth.GEMINI_API_KEY = provider.apiKey;
      else auth.OPENAI_API_KEY = provider.apiKey;
    } else {
      const primary = auth.OPENAI_API_KEY !== undefined ? 'OPENAI_API_KEY' : Object.keys(auth)[0];
      auth[primary] = provider.apiKey;
    }
  }

  const hasCatalog = Array.isArray(provider.modelCatalog) && provider.modelCatalog.length;
  // 只要有 model 就写出 model_catalog_json（绝对路径），避免代理模式下
  // modelCatalog 丢失导致 hasCatalog 为 false、merge 把旧的(相对)值残留。
  const emitCatalog = hasCatalog || !!provider.model;
  const catalogFileName = 'ztoolscctoggle-model-catalog.json';
  // model_catalog_json 在 Codex 中被解析为 AbsolutePathBuf，必须是绝对路径，
  // 否则报 "AbsolutePathBuf deserialized without a base path"。
  const catalogPath = path.join(getHomeDir(), '.codex', catalogFileName);

  // 构建 config.toml
  let configToml = provider.extraConfig || '';
  if (!configToml) {
    // provider 块名使用供应商名（与 UI 预览 slugifyName 保持一致），清洗为合法 TOML 键名。
    // 代理模式不再强制 "custom"：同一份 config 的 model_provider 与 [model_providers.X] 保持一致即可，
    // 切换供应商时 mergeCodexConfig 会清掉旧的 model_providers.* 表，不会残留。
    const cleanName = (provider.name || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/^_+|_+$/g, '') || 'custom';
    const displayName = provider.name || cleanName;
    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    const model = provider.model || 'gpt-4o';
    const apiFormat = provider.apiFormat || '';
    const wireApi = provider.wireApi || (apiFormat === 'openai_chat' ? 'chat' : 'responses');
    const effort = provider.reasoningEffort || 'high';
    const lines = [
      'model_provider = "' + cleanName + '"',
      'model = "' + model + '"',
      'model_reasoning_effort = "' + effort + '"',
      'disable_response_storage = true'
    ];
    // 有多模型目录时写入引用，Codex 的 /model 菜单据此展示可选模型
    // 用正斜杠避免 TOML 基础字符串把 Windows 反斜杠当成转义符
    if (emitCatalog) lines.push('model_catalog_json = "' + catalogPath.replace(/\\/g, '/') + '"');
    var needsAuth = !!provider.apiKey || !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl);
    lines.push(
      '',
      '[model_providers.' + cleanName + ']',
      'name = "' + displayName + '"',
      'base_url = "' + baseUrl + '"',
      'wire_api = "' + wireApi + '"',
      'requires_openai_auth = ' + (needsAuth ? 'true' : 'false')
    );
    // 代理模式下添加 experimental_bearer_token 配置
    if (provider.apiKey && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl)) {
      lines.push('experimental_bearer_token = "PROXY_MANAGED"');
    }
    configToml = lines.join('\n');
  }

  if (emitCatalog) {
    try {
      // 将前端精简字段(model/displayName/contextWindow)映射为 Codex 模型目录真实格式(下划线命名)，
      // 并补齐 Codex 期望的字段默认值；前端若已填同名字段则以其为准。
      // 无 modelCatalog 时退化为单模型目录，确保 model_catalog_json 指向有效文件。
      const rawCatalog =
        hasCatalog && Array.isArray(provider.modelCatalog)
          ? provider.modelCatalog
          : provider.model
            ? [{ model: provider.model, displayName: provider.name || provider.model }]
            : [];
      const catalogModels = rawCatalog.map(function (m) {
        const slug = m.slug || m.model || '';
        const displayName = m.display_name || m.displayName || slug;
        const ctx = Number(m.context_window || m.contextWindow) || 128000;
        const instr = getCodexInstructions();
        return {
          slug: slug,
          display_name: displayName,
          description: m.description || displayName,
          context_window: ctx,
          max_context_window: Number(m.max_context_window) || ctx,
          input_modalities: ['text'],
          default_reasoning_level: provider.reasoningEffort || 'medium',
          base_instructions: instr.base_instructions,
          instructions_variables: instr.instructions_variables,
          supported_reasoning_levels: [
            { effort: 'low', description: 'Fast responses with lighter reasoning' },
            {
              effort: 'medium',
              description: 'Balances speed and reasoning depth for everyday tasks'
            },
            { effort: 'high', description: 'Greater reasoning depth for complex problems' }
          ],
          supports_parallel_tool_calls: true,
          supports_search_tool: true,
          supports_reasoning_summaries: true,
          apply_patch_tool_type: 'freeform',
          shell_type: 'shell_command',
          supported_in_api: true,
          priority: 1000,
          visibility: 'list',
          // 补齐 Codex 期望的其余字段默认值（此版本几乎全部必填）
          additional_speed_tiers: [],
          availability_nux: null,
          // 以下三项为用户偏好：优先用 provider 上的设置，未设置时回退默认
          default_reasoning_summary: provider.reasoningSummary || 'none',
          default_verbosity: provider.verbosity || 'low',
          effective_context_window_percent: 95,
          experimental_supported_tools: [],
          model_messages: {
            instructions_template: instr.instructions_template || instr.base_instructions,
            instructions_variables: instr.instructions_variables
          },
          service_tiers: [],
          support_verbosity: true,
          supports_image_detail_original: true,
          truncation_policy: { limit: 10000, mode: 'tokens' },
          upgrade: null,
          web_search_tool_type: provider.webSearch === false ? 'none' : 'text_and_image'
        };
      });
      const catalogJson = JSON.stringify({ models: catalogModels }, null, 2);
      ensureDir(catalogPath);
      fs.writeFileSync(catalogPath, catalogJson, 'utf8');
    } catch (e) {
      /* ignore */
    }
  }

  writeCodexConfig(auth, configToml);
  return true;
}

// 优先使用预设 settingsConfig，其次回退旧字段
function switchProviderClaude(provider) {
  if (!provider) return { success: false, error: 'provider not found' };
  let settings = {};
  if (provider.settingsConfig && Object.keys(provider.settingsConfig).length) {
    settings = JSON.parse(JSON.stringify(provider.settingsConfig));
  }
  settings.env = settings.env || {};

  // 兼容旧字段
  if (provider.model) settings.env.ANTHROPIC_MODEL = provider.model;
  // 写入 apiKey 到指定认证字段（默认 ANTHROPIC_AUTH_TOKEN）；未提供 apiKey 时不写，避免污染为 undefined
  if (provider.apiKey) {
    const field =
      provider.authField ||
      (settings.env.ANTHROPIC_API_KEY !== undefined ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN');
    settings.env[field] = provider.apiKey;
  }
  // 合并 extraConfig（JSON）
  try {
    const extra = JSON.parse(provider.extraConfig);
    Object.assign(settings, extra);
  } catch (e) {
    /* ignore */
  }

  writeClaudeSettings(settings);
  return true;
}

function switchProviderGemini(provider) {
  // 收集 env
  const env = Object.assign({}, (provider.settingsConfig && provider.settingsConfig.env) || {});
  if (provider.baseUrl) env.GOOGLE_GEMINI_BASE_URL = provider.baseUrl;
  if (provider.model) env.GEMINI_MODEL = provider.model;
  if (provider.apiKey) env.GEMINI_API_KEY = provider.apiKey;
  // 序列化 KEY=VALUE
  const lines = Object.keys(env).map(function (k) {
    return k + '=' + (env[k] == null ? '' : env[k]);
  });
  writeGeminiEnv(lines.join('\n') + '\n');
  return true;
}

function _ocSlug(name) {
  return (
    (name || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom'
  );
}

function _ocRebaseRef(ref, key) {
  const i = (ref || '').indexOf('/');
  return i === -1 ? key + '/' + ref : key + ref.slice(i);
}

// OpenClaw 会持久化会话级模型记忆（agents/<agent>/sessions/sessions.json），
// 新 TUI 会话继承它并优先于 openclaw.json 的 agents.defaults.model.primary。
// 切换供应商时同步更新这些记忆，让新会话真正跟随插件切换，无需手动 /model。
function syncOpenClawSessionModel(providerKey, modelId) {
  try {
    const configDir = getAgentConfigPath('openclaw');
    const openclawDir = configDir || path.join(getHomeDir(), '.openclaw');
    const agentsDir = path.join(openclawDir, 'agents');
    if (!fs.existsSync(agentsDir)) return;
    const agentNames = fs.readdirSync(agentsDir).filter(function (n) {
      return fs.existsSync(path.join(agentsDir, n, 'sessions', 'sessions.json'));
    });
    agentNames.forEach(function (agent) {
      const p = path.join(agentsDir, agent, 'sessions', 'sessions.json');
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        let changed = false;
        Object.keys(data).forEach(function (key) {
          const entry = data[key];
          if (entry && typeof entry === 'object' && entry.model !== undefined) {
            entry.modelProvider = providerKey;
            entry.model = modelId;
            changed = true;
          }
        });
        if (changed) fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        /* 单个 agent 会话文件损坏时跳过 */
      }
    });
  } catch (e) {
    /* 会话记忆同步为尽力而为，失败不影响切换 */
  }
}

function switchProviderOpenclaw(provider) {
  // OpenClaw 纯叠加式：所有供应商共存于 models.providers；切换时写入该供应商并设为默认
  const config = readOpenClawConfig();
  config.models = config.models || { mode: 'merge', providers: {} };
  config.models.providers = config.models.providers || {};

  const key = _ocSlug(provider.name);
  const sc = provider.settingsConfig || {};
  const pc = {};
  if (provider.baseUrl || sc.baseUrl) pc.baseUrl = provider.baseUrl || sc.baseUrl;
  pc.apiKey = provider.apiKey || sc.apiKey || '';
  pc.api = provider.apiProtocol || sc.api || 'openai-completions';
  if (Array.isArray(sc.models) && sc.models.length) pc.models = sc.models;
  if (sc.headers && Object.keys(sc.headers).length) pc.headers = sc.headers;
  config.models.providers[key] = pc;

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  let primaryModelId = '';
  if (
    provider.suggestedDefaults &&
    provider.suggestedDefaults.model &&
    provider.suggestedDefaults.model.primary
  ) {
    primaryModelId =
      String(provider.suggestedDefaults.model.primary || '')
        .split('/')
        .pop() || '';
    config.agents.defaults.model = {
      primary: _ocRebaseRef(provider.suggestedDefaults.model.primary, key),
      fallbacks: (provider.suggestedDefaults.model.fallbacks || []).map(function (r) {
        return _ocRebaseRef(r, key);
      })
    };
    if (provider.suggestedDefaults.modelCatalog) {
      const cat = {};
      Object.keys(provider.suggestedDefaults.modelCatalog).forEach(function (r) {
        cat[_ocRebaseRef(r, key)] = provider.suggestedDefaults.modelCatalog[r];
      });
      config.agents.defaults.models = Object.assign({}, config.agents.defaults.models, cat);
    }
  } else {
    const ids = (pc.models || []).map(function (m) {
      return m.id;
    });
    if (ids.length) {
      primaryModelId = ids[0];
      config.agents.defaults.model = {
        primary: key + '/' + ids[0],
        fallbacks: ids.slice(1).map(function (id) {
          return key + '/' + id;
        })
      };
    }
  }

  writeOpenClawConfig(config);
  if (primaryModelId) syncOpenClawSessionModel(key, primaryModelId);
  return true;
}

export {
  readCodexConfig,
  writeCodexConfig,
  mergeCodexConfig,
  readClaudeSettings,
  writeClaudeSettings,
  readGeminiEnv,
  writeGeminiEnv,
  readOpenClawConfig,
  writeOpenClawConfig,
  readOpenCodeConfig,
  writeOpenCodeConfig,
  readClaudeDesktopConfig,
  writeClaudeDesktopConfig,
  readClaudeOnboarding,
  setClaudeOnboarding,
  getCurrentConfigs,
  switchProviderCodex,
  switchProviderClaude,
  switchProviderGemini,
  switchProviderOpenclaw,
  switchProviderOpenCode,
  switchProviderClaudeDesktop,
  restoreOfficialClaudeDesktop
};
