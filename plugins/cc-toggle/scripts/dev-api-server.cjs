// 开发 API 服务器 - 让浏览器前端访问真实文件系统数据
// 用法: node scripts/dev-api-server.cjs
//
// 原理：注入 mock ztools 对象，直接复用编译好的 preload 模块

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 4456;
const DB_FILE = path.join(__dirname, '..', '.dev-db.json');
const PRELOAD_DIR = path.join(__dirname, '..', 'public', 'preload');

// ─────────── 简单数据库 (JSON文件，模拟 ztools.db) ───────────

let db = {};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    db = {};
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {}
}

// ─────────── Mock ztools 对象 ───────────

global.ztools = {
  getPath: name => {
    if (name === 'home') return os.homedir();
    if (name === 'appData')
      return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return '';
  },
  db: {
    allDocs: prefix =>
      Object.keys(db)
        .filter(k => k.startsWith(prefix))
        .map(k => ({ _id: k, ...db[k] })),
    get: key => db[key] || null,
    put: doc => {
      db[doc._id] = doc;
      saveDb();
    },
    remove: key => {
      delete db[key];
      saveDb();
    }
  },
  dbStorage: {
    getItem: key => db[key] || null,
    setItem: (key, value) => {
      db[key] = value;
      saveDb();
    },
    removeItem: key => {
      delete db[key];
      saveDb();
    }
  },
  dbCryptoStorage: {
    getItem: key => db['_crypto_' + key] || null,
    setItem: (key, value) => {
      db['_crypto_' + key] = value;
      saveDb();
    },
    removeItem: key => {
      delete db['_crypto_' + key];
      saveDb();
    }
  }
};

// ─────────── 加载 preload 模块 ───────────

loadDb();

// 需要先加载 utils（其他模块依赖它）
const utils = require(path.join(PRELOAD_DIR, 'utils'));
const configRw = require(path.join(PRELOAD_DIR, 'config', 'config-rw'));
const { ProviderStore } = require(path.join(PRELOAD_DIR, 'providers', 'provider-db'));
const { ProfileStore } = require(path.join(PRELOAD_DIR, 'providers', 'profile-db'));
const { SessionManager } = require(path.join(PRELOAD_DIR, 'agents', 'sessions'));
const { StatsCollector } = require(path.join(PRELOAD_DIR, 'agents', 'stats'));
const { PromptManager } = require(path.join(PRELOAD_DIR, 'agents', 'prompts'));
const { BalanceManager } = require(path.join(PRELOAD_DIR, 'providers', 'balance'));
const { SkillManager } = require(path.join(PRELOAD_DIR, 'agents', 'skills'));

// 启动时标记当前供应商
try {
  ['codex', 'claude', 'claude-desktop', 'gemini'].forEach(appType => {
    ProviderStore.markCurrent(appType, ProviderStore.getCurrentProviderId(appType));
  });
} catch (e) {}

// ─────────── HTTP 请求处理 ───────────

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  sendJson(res, { error });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    // ─── 路径 ───
    if (pathname === '/api/paths') {
      return sendJson(res, {
        home: utils.getHomeDir(),
        codexAuth: utils.getCodexAuthPath(),
        codexConfig: utils.getCodexConfigPath(),
        claudeSettings: utils.getClaudeSettingsPath(),
        claudeDesktopConfig: utils.getClaudeDesktopConfigPath(),
        openclawConfig: utils.getOpenClawConfigPath(),
        geminiEnv: utils.getGeminiEnvPath(),
        opencodeConfig: utils.getOpenCodeConfigPath()
      });
    }

    // ─── 配置读取 ───
    if (pathname === '/api/configs') return sendJson(res, configRw.getCurrentConfigs());
    if (pathname === '/api/config/codex') return sendJson(res, configRw.readCodexConfig());
    if (pathname === '/api/config/claude') return sendJson(res, configRw.readClaudeSettings());
    if (pathname === '/api/config/gemini') return sendJson(res, configRw.readGeminiEnv());
    if (pathname === '/api/config/openclaw') return sendJson(res, configRw.readOpenClawConfig());
    if (pathname === '/api/config/opencode') return sendJson(res, configRw.readOpenCodeConfig());
    if (pathname === '/api/config/claude-desktop')
      return sendJson(res, configRw.readClaudeDesktopConfig());

    // ─── 供应商 ───
    if (pathname === '/api/providers' && req.method === 'GET') {
      const appType = url.searchParams.get('appType');
      if (!appType) return sendError(res, 'appType required');
      return sendJson(res, ProviderStore.listProviders(appType));
    }

    if (pathname === '/api/provider' && req.method === 'GET') {
      const appType = url.searchParams.get('appType');
      const id = url.searchParams.get('id');
      if (!appType || !id) return sendError(res, 'appType and id required');
      return sendJson(res, ProviderStore.getProvider(appType, id));
    }

    if (pathname === '/api/provider' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = ProviderStore.saveProvider(body.appType, body.data);
      return sendJson(res, { success: true, id: result.id, changed: result.changed });
    }

    if (pathname === '/api/provider-delete' && req.method === 'POST') {
      const body = await parseBody(req);
      ProviderStore.deleteProvider(body.appType, body.id);
      return sendJson(res, { success: true });
    }

    if (pathname === '/api/provider-sort' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.appType || !Array.isArray(body.orderedIds)) {
        return sendError(res, 'appType and orderedIds required');
      }
      const ok = ProviderStore.sortProviders(body.appType, body.orderedIds);
      return sendJson(res, { success: ok });
    }

    if (pathname === '/api/provider/current') {
      const appType = url.searchParams.get('appType');
      if (!appType) return sendError(res, 'appType required');
      return sendJson(res, { id: ProviderStore.getCurrentProviderId(appType) });
    }

    // 仅标记当前供应商（不写真实 CLI 配置，供测试造数）
    if (pathname === '/api/provider/mark-current' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.appType || !body.id) return sendError(res, 'appType and id required');
      try {
        ProviderStore.markCurrent(body.appType, body.id);
        return sendJson(res, { success: true });
      } catch (e) {
        return sendJson(res, { success: false, error: String(e && e.message ? e.message : e) });
      }
    }

    // ─── Profile 管理 ───
    if (pathname === '/api/profiles' && req.method === 'GET') {
      return sendJson(res, ProfileStore.listProfiles());
    }

    if (pathname === '/api/profile' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return sendError(res, 'id required');
      return sendJson(res, ProfileStore.getProfile(id));
    }

    if (pathname === '/api/profile' && req.method === 'POST') {
      const body = await parseBody(req);
      const id = ProfileStore.saveProfile(body);
      return sendJson(res, { success: true, id });
    }

    if (pathname === '/api/profile-delete' && req.method === 'POST') {
      const body = await parseBody(req);
      ProfileStore.deleteProfile(body.id);
      return sendJson(res, { success: true });
    }

    if (pathname === '/api/profile-activate' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, ProfileStore.activateProfile(body.id));
    }

    if (pathname === '/api/profile-deactivate' && req.method === 'POST') {
      ProfileStore.deactivateProfile();
      return sendJson(res, { success: true });
    }

    if (pathname === '/api/profile/active' && req.method === 'GET') {
      return sendJson(res, { id: ProfileStore.getActiveProfileId() });
    }

    // ─── 会话管理 ───
    if (pathname === '/api/sessions') {
      const app = url.searchParams.get('app') || 'claude';
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const search = url.searchParams.get('search') || '';
      const sort = url.searchParams.get('sort') || 'time-desc';
      const result = await SessionManager.scanSessions(app, { offset, limit, search, sort });
      return sendJson(res, result);
    }

    if (pathname === '/api/session/detail') {
      const filePath = url.searchParams.get('filePath');
      if (!filePath) return sendError(res, 'filePath required');
      const detail = await SessionManager.loadSessionDetail(filePath);
      return sendJson(res, detail);
    }

    if (pathname === '/api/session-delete' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, SessionManager.deleteSession(body.filePath));
    }

    // ─── 统计 ───
    if (pathname === '/api/stats') {
      const result = await StatsCollector.scanUsageLogs();
      return sendJson(res, result);
    }

    if (pathname === '/api/stats/clear' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, StatsCollector.clearStats(body.appType));
    }

    // ─── 提示词管理 ───
    if (pathname === '/api/prompts' && req.method === 'GET') {
      return sendJson(res, PromptManager.listPrompts());
    }

    if (pathname === '/api/prompts' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, PromptManager.savePrompt(body));
    }

    if (pathname === '/api/prompts/delete' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, PromptManager.deletePrompt(body.id));
    }

    if (pathname === '/api/prompts/duplicate' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, PromptManager.duplicatePrompt(body.id));
    }

    if (pathname === '/api/prompts/original' && req.method === 'GET') {
      const agent = url.searchParams.get('agent') || '';
      return sendJson(res, PromptManager.readOriginalPrompt(agent));
    }

    if (pathname === '/api/prompts/original-all' && req.method === 'GET') {
      return sendJson(res, PromptManager.readAllOriginalPrompts());
    }

    if (pathname === '/api/prompts/openclaw-files' && req.method === 'GET') {
      return sendJson(res, PromptManager.getOpenClawPromptFiles());
    }

    if (pathname === '/api/prompts/openclaw-files/read' && req.method === 'GET') {
      return sendJson(res, PromptManager.readOpenClawPromptFiles());
    }

    if (pathname === '/api/prompts/backup-original' && req.method === 'POST') {
      return sendJson(res, PromptManager.backupOriginalPrompts());
    }

    if (pathname === '/api/prompts/backup-selected' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, PromptManager.backupSelectedPrompts(body.selections));
    }

    if (pathname === '/api/prompts/backups' && req.method === 'GET') {
      return sendJson(res, PromptManager.getBackups());
    }

    if (pathname === '/api/prompts/restore' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(res, PromptManager.restoreOriginalPrompt(body.agent, body.fileName));
    }

    if (pathname === '/api/prompts/restore-all' && req.method === 'POST') {
      return sendJson(res, PromptManager.restoreAllOriginalPrompts());
    }

    if (pathname === '/api/prompts/apply' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(
        res,
        PromptManager.applyPromptToAgent(body.promptId, body.agent, body.fileName)
      );
    }

    if (pathname === '/api/prompts/toggle' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJson(
        res,
        PromptManager.togglePromptAgent(body.promptId, body.agent, body.fileName)
      );
    }

    // ─── 余额查询 ───
    if (pathname === '/api/balance/cache' && req.method === 'GET') {
      return sendJson(res, BalanceManager.getBalanceCache());
    }

    if (pathname === '/api/balance/cache-delete' && req.method === 'POST') {
      const body = await parseBody(req);
      BalanceManager.clearProviderCache(body.providerId);
      return sendJson(res, { success: true });
    }

    if (pathname === '/api/balance/query' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await BalanceManager.queryBalance(body.appType, body.providerId);
      return sendJson(res, result);
    }

    if (pathname === '/api/balance/query-all' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await BalanceManager.queryAllBalances(body.appType);
      return sendJson(res, result);
    }

    // ─── 余额告警状态（持久化在项目文档 balanceNotify 字段） ───
    if (pathname === '/api/balance/notify' && req.method === 'GET') {
      const profileId = url.searchParams.get('profileId') || 'default';
      return sendJson(res, BalanceManager.getBalanceNotifyState(profileId));
    }

    if (pathname === '/api/balance/notify-set' && req.method === 'POST') {
      const body = await parseBody(req);
      BalanceManager.setBalanceNotified(body.profileId, body.scopeKey, body.balance);
      return sendJson(res, { success: true });
    }

    if (pathname === '/api/balance/notify-clear' && req.method === 'POST') {
      const body = await parseBody(req);
      BalanceManager.clearBalanceNotified(body.profileId, body.scopeKey);
      return sendJson(res, { success: true });
    }

    // ─── Skills 搜索 ───
    if (pathname === '/api/skills/search') {
      const q = url.searchParams.get('q') || '';
      const source = url.searchParams.get('source') || 'skillsh';
      const result = await SkillManager.searchSkills(q, source);
      return sendJson(res, result);
    }

    sendError(res, 'Not found: ' + pathname);
  } catch (e) {
    sendError(res, e.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  🚀 Dev API Server running at http://localhost:${PORT}\n`);
  console.log('  Using compiled preload modules from public/preload/\n');
});
