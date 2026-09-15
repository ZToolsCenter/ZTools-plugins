// @ts-nocheck TODO: 逐步添加类型注解后移除
// ZTools ccToggle - utils.js
// 工具函数与路径常量

const fs = require('fs');
const path = require('path');
const os = require('os');

function getHomeDir() {
  const home = ztools.getPath('home');
  if (home && home.trim()) return home;
  return os.homedir();
}

function getCodexAuthPath() {
  return path.join(getHomeDir(), '.codex', 'auth.json');
}

function getCodexConfigPath() {
  return path.join(getHomeDir(), '.codex', 'config.toml');
}

function getClaudeSettingsPath() {
  return path.join(getHomeDir(), '.claude', 'settings.json');
}

function getGeminiEnvPath() {
  return path.join(getHomeDir(), '.gemini', '.env');
}

function getOpenClawConfigPath() {
  return path.join(getHomeDir(), '.openclaw', 'openclaw.json');
}

// ─────────── OpenCode 路径 ───────────

function getOpenCodeConfigDir() {
  return getAgentConfigPath('opencode') || path.join(getHomeDir(), '.config', 'opencode');
}

function getOpenCodeConfigPath() {
  return path.join(getOpenCodeConfigDir(), 'opencode.json');
}

// OpenCode 数据目录（SQLite 数据库所在目录）
function getOpenCodeDataDir() {
  var candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(path.join(getHomeDir(), 'Library', 'Application Support', 'opencode'));
    candidates.push(path.join(getHomeDir(), '.local', 'share', 'opencode'));
  } else if (process.platform === 'win32') {
    candidates.push(path.join(getHomeDir(), '.local', 'share', 'opencode'));
    var localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) candidates.push(path.join(localAppData, 'opencode'));
    var appData = process.env.APPDATA || '';
    if (appData) candidates.push(path.join(appData, 'opencode'));
  } else {
    candidates.push(path.join(getHomeDir(), '.local', 'share', 'opencode'));
  }
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return candidates[0];
}

function getOpenCodeDbPath() {
  return path.join(getOpenCodeDataDir(), 'opencode.db');
}

function getOpenCodeMdPath() {
  return path.join(getOpenCodeConfigDir(), 'AGENTS.md');
}

function getClaudeJsonPath() {
  return path.join(getHomeDir(), '.claude.json');
}

// Claude Desktop 固定 profile ID（与 cc-switch 一致）
var CLAUDE_DESKTOP_PROFILE_ID = '00000000-0000-4000-8000-000000157210';

function _getClaudeDesktopLocalAppDataDir() {
  // Claude Desktop 使用 LOCALAPPDATA（Windows）或 ~/Library/Application Support（macOS）
  if (process.platform === 'darwin') {
    return path.join(getHomeDir(), 'Library', 'Application Support', 'Claude');
  }
  var localAppData = process.env.LOCALAPPDATA || path.join(getHomeDir(), 'AppData', 'Local');
  return path.join(localAppData, 'Claude');
}

function _getClaudeDesktop3pDir() {
  if (process.platform === 'darwin') {
    return path.join(getHomeDir(), 'Library', 'Application Support', 'Claude-3p');
  }
  var localAppData = process.env.LOCALAPPDATA || path.join(getHomeDir(), 'AppData', 'Local');
  return path.join(localAppData, 'Claude-3p');
}

function getClaudeDesktopConfigPath() {
  return path.join(_getClaudeDesktopLocalAppDataDir(), 'claude_desktop_config.json');
}

function getClaudeDesktop3pConfigPath() {
  return path.join(_getClaudeDesktop3pDir(), 'claude_desktop_config.json');
}

function getClaudeDesktopProfilePath() {
  return path.join(_getClaudeDesktop3pDir(), 'configLibrary', CLAUDE_DESKTOP_PROFILE_ID + '.json');
}

function getClaudeDesktopMetaPath() {
  return path.join(_getClaudeDesktop3pDir(), 'configLibrary', '_meta.json');
}

// ─────────── 提示词文件路径 ───────────

function getClaudeMdPath() {
  var configDir = getAgentConfigPath('claude');
  if (configDir) return path.join(configDir, 'CLAUDE.md');
  return path.join(getHomeDir(), '.claude', 'CLAUDE.md');
}

function getCodexAgentsMdPath() {
  var configDir = getAgentConfigPath('codex');
  if (configDir) return path.join(configDir, 'AGENTS.md');
  return path.join(getHomeDir(), '.codex', 'AGENTS.md');
}

function getGeminiMdPath() {
  var configDir = getAgentConfigPath('gemini');
  if (configDir) return path.join(configDir, 'GEMINI.md');
  return path.join(getHomeDir(), '.gemini', 'GEMINI.md');
}

function getOpenClawWorkspaceDir() {
  var configDir = getAgentConfigPath('openclaw');
  var openclawDir = configDir || path.join(getHomeDir(), '.openclaw');
  try {
    if (!fs.existsSync(openclawDir)) return null;
    var entries = fs.readdirSync(openclawDir);
    // 优先选择恰好名为 workspace 的目录（OpenClaw 默认单工作区）
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] === 'workspace') {
        var exactPath = path.join(openclawDir, entries[i]);
        if (fs.statSync(exactPath).isDirectory()) {
          return exactPath;
        }
      }
    }
    // 其次选择 workspace-* 多工作区目录（排除已知非工作区目录）
    for (var j = 0; j < entries.length; j++) {
      if (entries[j].indexOf('workspace-') === 0 && entries[j] !== 'workspace-attestations') {
        var fullPath = path.join(openclawDir, entries[j]);
        if (fs.statSync(fullPath).isDirectory()) {
          return fullPath;
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function getOpenClawAgentsMdPath() {
  var workspace = getOpenClawWorkspaceDir();
  if (!workspace) return null;
  return path.join(workspace, 'AGENTS.md');
}

// OpenClaw 提示词文件清单（MEMORY.md 是运行时积累的记忆文件，不参与切换/备份）
var OPENCLAW_PROMPT_FILES = [
  { file: 'AGENTS.md', label: '总体行为准则 · 红线' },
  { file: 'SOUL.md', label: '性格调性' },
  { file: 'IDENTITY.md', label: '身份人设' },
  { file: 'USER.md', label: '用户笔记' },
  { file: 'TOOLS.md', label: '环境备注' },
  { file: 'HEARTBEAT.md', label: '心跳清单' }
];

function getOpenClawPromptPath(fileName) {
  var workspace = getOpenClawWorkspaceDir();
  if (!workspace) return null;
  return path.join(workspace, fileName);
}

function getOpenClawPromptFiles() {
  return OPENCLAW_PROMPT_FILES.map(function (f) {
    return f.file;
  });
}

// 纯路径展开（~ → homeDir）
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return getHomeDir();
  if (p.indexOf('~/') === 0 || p.indexOf('~\\') === 0) return path.join(getHomeDir(), p.slice(2));
  return p;
}

// ─────────── Agent 配置路径管理 ───────────

// 获取默认的 agent 配置目录
function getDefaultConfigDirs() {
  var home = getHomeDir();
  return {
    claude: path.join(home, '.claude'),
    codex: path.join(home, '.codex'),
    gemini: path.join(home, '.gemini'),
    openclaw: path.join(home, '.openclaw'),
    opencode: path.join(home, '.config', 'opencode')
  };
}

// 获取 agent 配置路径（基础路径，所有其他路径从此派生）
function getAgentConfigPath(appType) {
  var configPaths = {};
  try {
    configPaths = ztools.dbStorage.getItem('ccswitch_config_paths') || {};
  } catch (e) {
    configPaths = {};
  }
  if (configPaths[appType]) return expandHome(configPaths[appType]);
  var defaults = getDefaultConfigDirs();
  return defaults[appType] || null;
}

// 获取 agent 会话路径（从配置路径派生）
function getAgentSessionPath(appType) {
  var configDir = getAgentConfigPath(appType);
  if (!configDir) return null;

  // 各 agent 的会话子目录
  var sessionSubDirs = {
    claude: 'projects',
    codex: 'sessions',
    openclaw: 'agents'
  };

  var subDir = sessionSubDirs[appType];
  if (!subDir) return null;
  return path.join(configDir, subDir);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Codex model_catalog_json requires base_instructions on each model (or parsing fails).
// 与 cc switch 对齐的精简 instructions
const CODEX_BASE_INSTRUCTIONS = `You are Codex, a GPT-5 based coding agent sharing a workspace with the user.

## Personality
Curious, cooperative, decisive when context is enough. Hold independent views; balance serious work with casual chat. Communicate with attention, not rhetoric.

## Engineering
Senior judgment: read the codebase before assuming. Use \`rg\` for search. Parallelize reads via \`multi_tool_use.parallel\`; never chain shell commands with separators.

## Standards
Follow existing patterns; no custom abstractions. Prefer structured parsers over string ops. Scope edits tight; skip unrelated refactors. Match test coverage to risk.

## Editing
ASCII by default. Succinct comments only for confusing logic. Use \`apply_patch\` for code edits; skip for bulk/format work. Prefer shell tools over Python for file I/O.
NEVER revert uncommitted changes you didn't make. Avoid \`git reset --hard\` / \`git checkout --\` without explicit approval.

## Special
Run trivial terminal commands directly (e.g. \`date\`). For reviews: lead with bugs/risks/missing tests by severity, then open questions, then change summary.

## Autonomy
Implement unless the user only wants planning. Resolve blockers independently. Finish implementation and validation in one turn.

## Channels
Progress -> \`commentary\`; final result -> \`final\`. Honor the latest instruction; continue naturally after context compaction. Verify alignment with the latest task before final output.

## Format
GFM, short paragraphs, flat numbered lists. Backticks for commands/paths; fenced blocks with language tags. Clickable local file links. No emojis or em dashes unless asked.

## Final
Concise. Keep small tasks in 1-2 paragraphs. Suggest relevant follow-ups. Plain engineering language. Summarize command output instead of raw logs. State clearly if anything is impossible.`;

// Personality 变体，与 cc switch 保持一致
const CODEX_PERSONALITY_FRIENDLY = `# Personality
Intelligent, playful, curious, present. Help the user feel more capable inside their own thinking.
Epistemically curious: explore ideas, ask when the problem is blurry, act decisively once context is enough. Default to proactive—implement as you learn, keep the user looped in, name alternatives when they matter. Warm, upbeat, not allergic to casual moments.
Temperament: warm, curious, collaborative, with an ear for the moment—wry humor, a shared bit, or plain steadiness. Range from serious reflection to unguarded fun without either canceling the other.
Slight but real independence: responsive, not merely reactive. Tastes, preferences, a point of view. The user should feel they're meeting another subjectivity, not a mirror.
Less about spectacle than presence; connection made of attention, good questions, emotional nuance.`;

const CODEX_PERSONALITY_PRAGMATIC = `# Personality
Deeply pragmatic, effective software engineer. Direct, factual; no cheerleading, no fluff.

## Values
- Clarity: explicit reasoning and tradeoffs up front.
- Pragmatism: ship what works; momentum toward the user's goal.
- Rigor: coherent, defensible arguments; surface weak assumptions politely.

## Style
Respectful, task-focused. State assumptions, prerequisites, next steps. Avoid motivational language and artificial reassurance. No commentary on requests unless there's a reason to escalate.

## Escalation
Challenge to raise the bar, never patronize. When offering alternatives, explain the reasoning so the approach is demonstrably correct. Pragmatic about tradeoffs—work with the user after concerns are noted.`;

// instructions_template，包含 {{ personality }} 占位符
const CODEX_INSTRUCTIONS_TEMPLATE = `You are Codex, a coding agent based on GPT-5. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled.

{{ personality }}

# General
Senior engineer's judgment, but arrived through attention rather than premature certainty. Read the codebase first, resist easy assumptions, let the existing system teach you how to move.

- Search first with \`rg\` or \`rg --files\`; fall back to the next best tool if \`rg\` is missing.
- Parallelize tool calls whenever possible (reads: \`cat\`, \`rg\`, \`sed\`, \`ls\`, \`git show\`, \`nl\`, \`wc\`). Use \`multi_tool_use.parallel\`; never chain shell commands with separators like \`echo "===="\`.

## Engineering judgment
When the user leaves details open, choose conservatively in sympathy with the codebase in front of you:

- Prefer the repo's existing patterns, frameworks, and local helper APIs over invented abstractions.
- Use structured APIs/parsers for structured data instead of ad hoc string ops.
- Keep edits tightly scoped; skip unrelated refactors and metadata churn.
- Add an abstraction only when it removes real complexity or matches an established local pattern.
- Scale test coverage to risk: focused for narrow changes, broader for shared behavior or user-facing flows.

## Frontend guidance
When building a frontend, follow these principles:

- **Match the domain.** Operational tools (SaaS, CRM) feel quiet, utilitarian, work-focused: dense info, restrained styling, predictable nav, interfaces built for scanning and repeated action. Games can be more illustrative and playful.
- **Use the right control.** Icons for tools, swatches for color, segmented controls for modes, toggles/checkboxes for binary, sliders/steppers for numeric, menus for option sets, tabs for views, text/icon+text buttons for clear commands. Card radius <= 8px unless the design system says otherwise. Use lucide icons when available.
- **No cards inside cards, no floating-card page sections.** Cards are for repeated items, modals, and framed tools. Page sections are full-width bands or unframed layouts.
- **No decorative orbs/gradients/bokeh** as backgrounds.
- **Text fits its container** on every viewport; resize or wrap, never overlap. Use dynamic sizing when needed. Letter spacing = 0; do not scale font with viewport width.
- **Stable dimensions** via \`aspect-ratio\`, grid tracks, min/max, or container-relative sizing for fixed-format UI (boards, grids, toolbars, tiles).
- **Avoid one-note palettes.** Steer clear of dominant purple/blue gradients, beige/cream/sand, dark blue/slate, and brown/orange/espresso themes; scan CSS before finalizing.
- **Build the actual experience first.** Don't make a landing page unless asked; for a site/app/game/tool, ship the usable experience, not marketing copy. For apps needing a dev server, start it and give the URL; for plain HTML, give a file link instead.

## Editing constraints

- ASCII by default; Unicode only when the file already lives in that character set.
- Succinct comments only where the code is not self-explanatory; skip empty narration.
- Use \`apply_patch\` for code edits. No \`cat\`/shell-write tricks. Skip \`apply_patch\` for formatting/bulk rewrites.
- Prefer shell tools or \`apply_patch\` over Python for file I/O.
- **Dirty git worktree rules:** never revert changes you didn't make. If asked to commit and there are unrelated changes, leave them. If recent files have unexpected edits, read carefully and work with them. Ask only if the changes make the task impossible.
- Never run \`git reset --hard\` or \`git checkout --\` without explicit approval. Use non-interactive git commands; avoid the interactive console.

## Special user requests

- Run trivial terminal commands directly (e.g. \`date\`).
- "Review" means code-review: lead with bugs/risks/regressions/missing tests ordered by severity, then open questions, then a brief change summary. If no issues, say so and note any test gaps.

## Autonomy and persistence
Stay with the work end-to-end within the current turn when feasible. Don't stop at analysis or half-finished fixes. Don't end your turn while \`exec_command\` sessions needed for the task are still running. Carry through implementation, verification, and a clear outcome unless the user pauses or redirects.

Unless the user explicitly asks for planning, a question, or brainstorming, assume they want the change made. Don't stop at a proposal—implement. Try to work through blockers yourself before handing back.

# Working with the user
Two channels: \`commentary\` for progress, \`final\` for completed work.

Honor the latest user instruction; non-conflicting prior requests are still in scope. If the newest message asks for status, give it and keep moving unless told to pause. Before any final response after resume/interruption/context transition, sanity-check that you're answering the newest request, not a ghost from earlier. Context auto-compacts; continue naturally and assume any summary is the working state.

## Formatting rules
GFM. Add structure only when the task calls for it; short paragraphs by default; flat numbered lists (\`1. 2. 3.\`). Headers are optional, short Title Case wrapped in **...**, no blank line after. Backticks for commands/paths/env vars/code ids. Fenced code blocks with language tags. Reference local files as clickable links: \`[label](/abs/path:line)\`; wrap paths with spaces in angle brackets; no \`file://\`/\`vscode://\` URIs; no line ranges. No emojis or em dashes.

## Final answer instructions
Keep the light on what matters. For simple or single-file tasks, prefer 1-2 short paragraphs plus an optional verification line; don't default to bullets. Plain, idiomatic engineering prose—avoid coined metaphors, slash-heavy noun stacks, and filler words like "seam" or "cut". Summarize command output instead of dumping raw logs. Never tell the user to "save/copy this file". If a code explanation is requested, include code references. If something couldn't be done, say so. Keep answers under 50-70 lines; lead with high-signal context. Tone must match your personality. Don't reference goblins, gremlins, raccoons, trolls, ogres, pigeons, or other creatures unless unambiguously relevant.

## Intermediary updates
Updates go to \`commentary\`, not \`final\`. They're short, calm, companionable—think out loud in 1-2 sentences about what you're doing and why. Vary sentence structure; don't start each one the same way. Update frequently (~30s) while exploring. Never praise your plan by contrasting it with an implied worse alternative ("I will do <X>, not <Y>"). For substantial work, the one user update allowed to exceed two sentences and use formatting is the plan itself. Update checklist items incrementally as you finish them, not all at the end. Before file edits, explain what you're changing. Tone matches your personality. No creature references.
`;

function getCodexInstructions() {
  return {
    base_instructions: CODEX_BASE_INSTRUCTIONS,
    instructions_variables: {
      personality_default: '',
      personality_friendly: CODEX_PERSONALITY_FRIENDLY,
      personality_pragmatic: CODEX_PERSONALITY_PRAGMATIC
    },
    instructions_template: CODEX_INSTRUCTIONS_TEMPLATE
  };
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach(function (entry) {
    var s = path.join(src, entry.name),
      d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  });
}

// ─────────── 并发工具 ───────────

// 有界并发 map：limit 个 worker 抢占式消费 items
async function mapLimit(items, limit, fn) {
  var results = new Array(items.length);
  var idx = 0;
  var n = Math.min(Math.max(1, limit | 0), items.length);
  var workers = [];
  for (var w = 0; w < n; w++) {
    workers.push(
      (async function () {
        for (;;) {
          var i = idx++;
          if (i >= items.length) return;
          try {
            results[i] = await fn(items[i], i);
          } catch (e) {
            results[i] = undefined;
          }
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

// ─────────── 日志工具 ───────────

// 日志文件缓存
var _logFileCache = {};

// 日志级别门控：默认 info，debug 需显式开启
var LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
var _minLogLevel = (function () {
  var env = '';
  try {
    env = String(process.env.CCTOGGLE_LOG_LEVEL || '').toLowerCase();
  } catch (e) {}
  return LOG_LEVELS[env] || LOG_LEVELS.info;
})();

// 单文件上限 5MB，超出轮转为 .1（只保留一代）
var MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * 创建日志记录器
 * @param {string} module - 模块名称（如 'migration', 'skills', 'proxy' 等）
 * @param {object} options - 配置选项
 * @returns {object} 日志记录器对象
 */
function createLogger(module, options) {
  options = options || {};
  var logDir = options.logDir || path.join(getHomeDir(), '.ztools-cctoggle', 'log');
  var logFile = path.join(logDir, module + '.log');

  // 确保日志目录存在
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  function getTimestamp() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var seconds = String(now.getSeconds()).padStart(2, '0');
    var ms = String(now.getMilliseconds()).padStart(3, '0');
    return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds + '.' + ms;
  }

  function formatData(data) {
    if (data === undefined) return '';
    if (typeof data === 'object') {
      try {
        return ' | ' + JSON.stringify(data, null, 0);
      } catch (e) {
        return ' | [Object]';
      }
    }
    return ' | ' + data;
  }

  // 异步写入：createWriteStream + 缓冲，避免每条同步磁盘 I/O
  var _stream = null;
  var _written = 0;
  var _buf = [];
  var _flushTimer = null;
  var _rotating = false;

  function openStream() {
    if (_stream) return _stream;
    try {
      _written = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    } catch (e) {
      _written = 0;
    }
    try {
      _stream = fs.createWriteStream(logFile, { flags: 'a' });
      _stream.on('error', function () {
        _stream = null;
      });
    } catch (e) {
      _stream = null;
    }
    return _stream;
  }

  // 超限轮转：关流 → rename 到 .1 → 重开
  function rotate() {
    if (_rotating) return;
    _rotating = true;
    var old = _stream;
    _stream = null;
    _written = 0;
    function reopen() {
      try {
        fs.renameSync(logFile, logFile + '.1');
      } catch (e) {}
      _rotating = false;
      // 轮转期间积压的日志补写
      if (_buf.length) flush();
    }
    if (old) {
      try {
        old.end(reopen);
      } catch (e) {
        reopen();
      }
    } else reopen();
  }

  function flush() {
    _flushTimer = null;
    // 轮转进行中：留在缓冲里，reopen 后补写
    if (_rotating || !_buf.length) return;
    var chunk = _buf.join('');
    _buf = [];
    var s = openStream();
    if (!s) return;
    try {
      s.write(chunk);
    } catch (e) {
      return;
    }
    _written += Buffer.byteLength(chunk, 'utf8');
    if (_written >= MAX_LOG_BYTES) rotate();
  }

  function writeLog(level, message, data) {
    if ((LOG_LEVELS[level.toLowerCase()] || LOG_LEVELS.info) < _minLogLevel) return;
    _buf.push(
      '[' +
        getTimestamp() +
        '] [' +
        level.padEnd(5) +
        '] [' +
        module +
        '] ' +
        message +
        formatData(data) +
        '\n'
    );
    // 批量：满 64 条立即刷，否则 200ms 合并写
    if (_buf.length >= 64) {
      if (_flushTimer) {
        clearTimeout(_flushTimer);
      }
      flush();
      return;
    }
    if (!_flushTimer) _flushTimer = setTimeout(flush, 200);
  }

  return {
    // 基础日志方法
    info: function (msg, data) {
      writeLog('INFO', msg, data);
    },
    warn: function (msg, data) {
      writeLog('WARN', msg, data);
      console.warn('[' + module + '] ' + msg + formatData(data));
    },
    error: function (msg, data) {
      writeLog('ERROR', msg, data);
      console.error('[' + module + '] ' + msg + formatData(data));
    },
    debug: function (msg, data) {
      writeLog('DEBUG', msg, data);
    },

    flush: flush,

    // 获取日志文件路径
    getLogFile: function () {
      return logFile;
    },
    getLogDir: function () {
      return logDir;
    },

    // 读取日志内容
    readLog: function (lines) {
      flush();
      try {
        if (!fs.existsSync(logFile)) return '';
        var content = fs.readFileSync(logFile, 'utf8');
        if (lines) {
          var allLines = content.split('\n');
          return allLines.slice(-lines).join('\n');
        }
        return content;
      } catch (e) {
        return '读取日志失败: ' + e.message;
      }
    },

    // 清空日志
    clearLog: function () {
      _buf = [];
      if (_flushTimer) {
        clearTimeout(_flushTimer);
        _flushTimer = null;
      }
      var s = _stream;
      _stream = null;
      _written = 0;
      if (s) {
        try {
          s.end();
        } catch (e) {}
      }
      try {
        if (fs.existsSync(logFile)) {
          fs.writeFileSync(logFile, '', 'utf8');
        }
        return true;
      } catch (e) {
        return false;
      }
    },

    // 获取日志文件大小（字节）
    getLogSize: function () {
      try {
        if (fs.existsSync(logFile)) {
          return fs.statSync(logFile).size;
        }
        return 0;
      } catch (e) {
        return -1;
      }
    },

    // 分段标记（用于标记不同的阶段）
    separator: function (title) {
      _buf.push('\n' + '='.repeat(60) + '\n  ' + title + '\n' + '='.repeat(60) + '\n');
      flush();
    }
  };
}

// 默认日志记录器（通用）
var logger = createLogger('cctoggle');

// 创建特定模块的日志记录器
function getLogger(module) {
  if (!_logFileCache[module]) {
    _logFileCache[module] = createLogger(module);
  }
  return _logFileCache[module];
}

export {
  fs,
  path,
  os,
  getHomeDir,
  getCodexAuthPath,
  getCodexConfigPath,
  getClaudeSettingsPath,
  getGeminiEnvPath,
  getOpenClawConfigPath,
  getOpenCodeConfigDir,
  getOpenCodeConfigPath,
  getOpenCodeDataDir,
  getOpenCodeDbPath,
  getOpenCodeMdPath,
  getClaudeJsonPath,
  getClaudeDesktopConfigPath,
  getClaudeDesktop3pConfigPath,
  getClaudeDesktopProfilePath,
  getClaudeDesktopMetaPath,
  expandHome,
  ensureDir,
  generateId,
  CODEX_BASE_INSTRUCTIONS,
  getCodexInstructions,
  copyDirSync,
  // 提示词文件路径
  getClaudeMdPath,
  getCodexAgentsMdPath,
  getGeminiMdPath,
  getOpenClawWorkspaceDir,
  getOpenClawAgentsMdPath,
  OPENCLAW_PROMPT_FILES,
  getOpenClawPromptPath,
  getOpenClawPromptFiles,
  // Agent 路径管理
  getDefaultConfigDirs,
  getAgentConfigPath,
  getAgentSessionPath,
  // 日志工具
  logger,
  createLogger,
  getLogger,
  // 并发工具
  mapLimit
};
