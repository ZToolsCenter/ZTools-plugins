// ZTools ccToggle - sessions/adapters.ts
// 各 agent 的会话适配器：封装文件枚举/元数据解析/消息解析差异

import utils = require('../../utils');
import * as sqlite from '../../core/sqlite';
import { ContentBlock, Message, Session, SessionAdapter } from './types';
import {
  PARSE_CONCURRENCY,
  cachedEnum,
  estimateMessageCount,
  extractContentBlocks,
  extractOpenCodeOutputText,
  mergeMessages,
  ocTs,
  parsePage,
  readHeadAndTail
} from './shared';

const fs = utils.fs;
const path = utils.path;

// ════════════════════════════════════════════════
// Claude / Claude Desktop（共享元数据解析与枚举）
// ════════════════════════════════════════════════

async function parseClaudeMeta(filePath: string, projectName: string): Promise<Session> {
  const r = await readHeadAndTail(filePath);
  const headLines = r.head;
  const tailLines = r.tail;

  const sessionId = path.basename(filePath, '.jsonl');
  let title = '';
  let firstTs = '';
  let lastTs = '';
  let tokenUsage = 0;
  let lastModel = '';
  let projectPath = '';

  // 解析头部行
  for (let i = 0; i < headLines.length; i++) {
    const line = headLines[i];
    if (!line || line[0] !== '{') continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (!d || typeof d !== 'object') continue;

    if (d.type === 'summary' && d.summary) title = d.summary;
    if (!projectPath && d.cwd) projectPath = d.cwd;

    if (d.type === 'assistant' || d.type === 'human' || d.type === 'user') {
      if (d.timestamp) {
        if (!firstTs) firstTs = d.timestamp;
        lastTs = d.timestamp;
      }
      if (!title && d.type === 'user' && d.message && d.message.content) {
        let c = typeof d.message.content === 'string' ? d.message.content : '';
        if (c.length > 60) c = c.substring(0, 60) + '...';
        if (c) title = c;
      }
      if (d.type === 'assistant' && d.message && d.message.usage) {
        const u = d.message.usage;
        tokenUsage += (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
        if (d.message.model && d.message.model !== '<synthetic>') lastModel = d.message.model;
      }
    }
  }

  // 解析尾部行（补充 lastTs、tokenUsage）
  for (let j = 0; j < tailLines.length; j++) {
    const line2 = tailLines[j];
    if (!line2 || line2[0] !== '{') continue;
    let d2: Record<string, any>;
    try {
      d2 = JSON.parse(line2);
    } catch (e) {
      continue;
    }
    if (!d2 || typeof d2 !== 'object') continue;
    if (d2.type === 'assistant' || d2.type === 'human' || d2.type === 'user') {
      if (d2.timestamp) lastTs = d2.timestamp;
      if (d2.type === 'assistant' && d2.message && d2.message.usage) {
        const u2 = d2.message.usage;
        tokenUsage += (Number(u2.input_tokens) || 0) + (Number(u2.output_tokens) || 0);
        if (d2.message.model && d2.message.model !== '<synthetic>') lastModel = d2.message.model;
      }
    }
  }

  // 用文件大小估算消息数
  const messageCount = estimateMessageCount(headLines, tailLines, r.size);

  if (!title) title = sessionId.substring(0, 12) + '...';
  if (!projectPath) projectPath = (projectName || '').replace(/-/g, '/');

  return {
    id: 'claude_' + sessionId,
    app: 'claude',
    sessionId,
    title,
    projectPath,
    messageCount,
    tokenUsage,
    model: lastModel,
    createdAt: firstTs || '',
    updatedAt: lastTs || '',
    filePath
  };
}

// Claude 文件枚举（不解析内容）
async function enumClaudeFiles(
  projectsDir: string
): Promise<Array<{ path: string; mtime: number; project: string }>> {
  const allFiles: Array<{ path: string; mtime: number; project: string }> = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  } catch (e) {
    return allFiles;
  }

  const dirs = entries.filter(e => e.isDirectory());
  const perDir = await utils.mapLimit(dirs, PARSE_CONCURRENCY, async function (ent) {
    const projectPath = path.join(projectsDir, ent.name);
    let files: string[];
    try {
      files = await fs.promises.readdir(projectPath);
    } catch (e) {
      return [];
    }
    const jsonl = files.filter(f => /\.jsonl$/i.test(f));
    const stats = await utils.mapLimit(jsonl, PARSE_CONCURRENCY, async function (fname) {
      const filePath = path.join(projectPath, fname);
      try {
        const st = await fs.promises.stat(filePath);
        return { path: filePath, mtime: st.mtimeMs, project: ent.name };
      } catch (e) {
        return null;
      }
    });
    return stats.filter(Boolean);
  });

  for (const list of perDir) {
    if (list) allFiles.push(...list);
  }
  allFiles.sort((a, b) => b.mtime - a.mtime);
  return allFiles;
}

function parseClaudeMessages(lines: string[]): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line[0] !== '{') continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (!d || typeof d !== 'object') continue;
    if (d.type === 'human' || d.type === 'user') {
      const raw = d.message ? d.message.content : d.content;
      const blocks = extractContentBlocks(raw);
      if (blocks.length > 0)
        messages.push({ role: 'user', contentBlocks: blocks, timestamp: d.timestamp || '' });
    } else if (d.type === 'assistant') {
      const araw = d.message ? d.message.content : d.content;
      const ablocks = extractContentBlocks(araw);
      if (ablocks.length > 0)
        messages.push({ role: 'assistant', contentBlocks: ablocks, timestamp: d.timestamp || '' });
    }
  }
  return messages;
}

export class ClaudeSessionAdapter implements SessionAdapter {
  id = 'claude';
  label = 'Claude';

  private async _enum(home: string) {
    const projectsDir =
      utils.getAgentSessionPath('claude') || path.join(home, '.claude', 'projects');
    return cachedEnum('claude', () => enumClaudeFiles(projectsDir));
  }

  async scan(
    home: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<{ sessions: Session[]; totalFiles: number }> {
    opts = opts || {};
    const offset = opts.offset || 0;
    const limit = opts.limit != null ? opts.limit : 20;
    const allFiles = await this._enum(home);
    const sessions = await parsePage(allFiles, offset, limit, f =>
      parseClaudeMeta(f.path, f.project)
    );
    return { sessions, totalFiles: allFiles.length };
  }

  async count(home: string): Promise<number> {
    return (await this._enum(home)).length;
  }

  parseMessages(lines: string[]): Message[] {
    return parseClaudeMessages(lines);
  }

  async loadDetail(_target: string): Promise<Message[] | null> {
    return null;
  }
}

// ─────────── Claude Desktop ───────────

// 递归枚举 Claude-3p 新版本目录结构
// 路径: {agentId}/{profileId}/local_{uuid}/.claude/projects/{project}/{session}.jsonl
async function enumClaude3pFiles(
  baseDir: string
): Promise<Array<{ path: string; mtime: number; project: string }>> {
  const allFiles: Array<{ path: string; mtime: number; project: string }> = [];

  async function findSessionFiles(dir: string, depth: number): Promise<void> {
    if (depth > 6) return; // 限制递归深度
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const fullPath = path.join(dir, ent.name);
      if (ent.name === 'projects') {
        allFiles.push(...(await enumClaudeFiles(fullPath)));
      } else {
        await findSessionFiles(fullPath, depth + 1);
      }
    }
  }

  await findSessionFiles(baseDir, 0);
  allFiles.sort((a, b) => b.mtime - a.mtime);
  return allFiles;
}

// Claude Desktop 会话文件枚举
// 路径优先级：
// 1. 用户自定义路径
// 2. LOCALAPPDATA/Claude-3p/local-agent-mode-sessions (Windows 新版本)
// 3. LOCALAPPDATA/Claude/projects (Windows 旧版本)
// 4. ~/.claude-desktop/projects (Linux/macOS fallback)
async function enumClaudeDesktopFiles(
  home: string
): Promise<Array<{ path: string; mtime: number; project: string }>> {
  const customPath = utils.getAgentSessionPath('claude-desktop');
  if (customPath) {
    try {
      const entries = await fs.promises.readdir(customPath, { withFileTypes: true });
      if (entries.length > 0) return await enumClaudeFiles(customPath);
    } catch (e) {
      /* ignore */
    }
  }

  let localAppData: string;
  try {
    localAppData = process.env.LOCALAPPDATA || '';
  } catch (e) {
    localAppData = '';
  }

  if (localAppData) {
    const claude3pSessionsDir = path.join(localAppData, 'Claude-3p', 'local-agent-mode-sessions');
    try {
      await fs.promises.access(claude3pSessionsDir);
      return await enumClaude3pFiles(claude3pSessionsDir);
    } catch (e) {
      /* ignore */
    }
  }

  if (localAppData) {
    const claudeProjectsDir = path.join(localAppData, 'Claude', 'projects');
    try {
      const entries = await fs.promises.readdir(claudeProjectsDir, { withFileTypes: true });
      if (entries.length > 0) return await enumClaudeFiles(claudeProjectsDir);
    } catch (e) {
      /* ignore */
    }
  }

  const fallbackDir = path.join(home, '.claude-desktop', 'projects');
  try {
    const entries = await fs.promises.readdir(fallbackDir, { withFileTypes: true });
    if (entries.length > 0) return await enumClaudeFiles(fallbackDir);
  } catch (e) {
    /* ignore */
  }

  return [];
}

export class ClaudeDesktopSessionAdapter implements SessionAdapter {
  id = 'claude-desktop';
  label = 'Claude Desktop';

  private async _enum(home: string) {
    return cachedEnum('claude-desktop', () => enumClaudeDesktopFiles(home));
  }

  async scan(
    home: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<{ sessions: Session[]; totalFiles: number }> {
    opts = opts || {};
    const offset = opts.offset || 0;
    const limit = opts.limit != null ? opts.limit : 20;
    const allFiles = await this._enum(home);
    const sessions = await parsePage(allFiles, offset, limit, async function (f) {
      const meta = await parseClaudeMeta(f.path, f.project);
      if (!meta) return null;
      meta.id = 'claude-desktop_' + meta.sessionId;
      meta.app = 'claude-desktop';
      return meta;
    });
    return { sessions, totalFiles: allFiles.length };
  }

  async count(home: string): Promise<number> {
    return (await this._enum(home)).length;
  }

  parseMessages(lines: string[]): Message[] {
    return parseClaudeMessages(lines);
  }

  async loadDetail(_target: string): Promise<Message[] | null> {
    return null;
  }
}

// ════════════════════════════════════════════════
// Codex
// ════════════════════════════════════════════════

async function parseCodexMeta(filePath: string): Promise<Session> {
  const r = await readHeadAndTail(filePath);
  const headLines = r.head;
  const tailLines = r.tail;

  const sessionId = path.basename(filePath, '.jsonl');
  let title = '';
  let firstTs = '';
  let lastTs = '';
  let tokenUsage = 0;
  let lastModel = '';
  let projectPath = '';

  for (let i = 0; i < headLines.length; i++) {
    const line = headLines[i];
    if (!line || line[0] !== '{') continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (!d || typeof d !== 'object') continue;

    if (d.type === 'session_meta' && d.payload) {
      if (d.payload.cwd) projectPath = d.payload.cwd;
      if (d.payload.model_provider) lastModel = d.payload.model_provider;
    }
    if (d.type === 'event_msg' && d.payload) {
      if (d.payload.type === 'user_message' && d.payload.message) {
        if (!title) {
          let t: string = d.payload.message;
          if (t.length > 60) t = t.substring(0, 60) + '...';
          title = t;
        }
      } else if (
        d.payload.type === 'token_count' &&
        d.payload.info &&
        d.payload.info.last_token_usage
      ) {
        const u = d.payload.info.last_token_usage;
        tokenUsage += (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
      }
    }
    if (d.type === 'response_item' && d.payload && d.payload.model) lastModel = d.payload.model;
    if (d.timestamp) {
      if (!firstTs) firstTs = d.timestamp;
      lastTs = d.timestamp;
    }
  }

  for (let j = 0; j < tailLines.length; j++) {
    const line2 = tailLines[j];
    if (!line2 || line2[0] !== '{') continue;
    let d2: Record<string, any>;
    try {
      d2 = JSON.parse(line2);
    } catch (e) {
      continue;
    }
    if (!d2 || typeof d2 !== 'object') continue;
    if (d2.type === 'event_msg' && d2.payload) {
      if (
        d2.payload.type === 'token_count' &&
        d2.payload.info &&
        d2.payload.info.last_token_usage
      ) {
        const u2 = d2.payload.info.last_token_usage;
        tokenUsage += (Number(u2.input_tokens) || 0) + (Number(u2.output_tokens) || 0);
      }
    }
    if (d2.type === 'response_item' && d2.payload && d2.payload.model) lastModel = d2.payload.model;
    if (d2.timestamp) lastTs = d2.timestamp;
  }

  const messageCount = estimateMessageCount(headLines, tailLines, r.size);
  if (!title) title = sessionId.substring(0, 12) + '...';

  return {
    id: 'codex_' + sessionId,
    app: 'codex',
    sessionId,
    title,
    projectPath,
    messageCount,
    tokenUsage,
    model: lastModel,
    createdAt: firstTs || '',
    updatedAt: lastTs || '',
    filePath
  };
}

// 枚举 codex 会话文件：目录名 YYYY/MM/DD 天然有序，无需 stat
async function enumCodexFiles(home: string): Promise<string[]> {
  const sessionsDir = utils.getAgentSessionPath('codex') || path.join(home, '.codex', 'sessions');
  const out: string[] = [];
  let years: import('fs').Dirent[];
  try {
    years = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
  } catch (e) {
    return out;
  }

  const yearNames = years
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse();
  for (let yi = 0; yi < yearNames.length; yi++) {
    const yearDir = path.join(sessionsDir, yearNames[yi]);
    let months: import('fs').Dirent[];
    try {
      months = await fs.promises.readdir(yearDir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    const monthNames = months
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse();

    for (let mi = 0; mi < monthNames.length; mi++) {
      const monthDir = path.join(yearDir, monthNames[mi]);
      let days: import('fs').Dirent[];
      try {
        days = await fs.promises.readdir(monthDir, { withFileTypes: true });
      } catch (e) {
        continue;
      }
      const dayNames = days
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();

      for (let di = 0; di < dayNames.length; di++) {
        const dayDir = path.join(monthDir, dayNames[di]);
        let files: string[];
        try {
          files = await fs.promises.readdir(dayDir);
        } catch (e) {
          continue;
        }
        const jsonlFiles = files
          .filter(f => /\.jsonl$/i.test(f))
          .sort()
          .reverse();
        for (let fi = 0; fi < jsonlFiles.length; fi++) {
          out.push(path.join(dayDir, jsonlFiles[fi]));
        }
      }
    }
  }
  return out;
}

function parseCodexMessages(lines: string[]): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line[0] !== '{') continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (!d || d.type !== 'event_msg' || !d.payload) continue;
    if (d.payload.type === 'user_message' && d.payload.message) {
      messages.push({
        role: 'user',
        contentBlocks: [{ type: 'text', text: d.payload.message }],
        timestamp: d.timestamp || ''
      });
    } else if (d.payload.type === 'agent_message' && d.payload.message) {
      messages.push({
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: d.payload.message }],
        timestamp: d.timestamp || ''
      });
    }
  }
  return messages;
}

export class CodexSessionAdapter implements SessionAdapter {
  id = 'codex';
  label = 'Codex';

  private async _enum(home: string) {
    return cachedEnum('codex', () => enumCodexFiles(home));
  }

  async scan(
    home: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<{ sessions: Session[]; totalFiles: number }> {
    opts = opts || {};
    const offset = opts.offset || 0;
    const limit = opts.limit != null ? opts.limit : 20;
    const allFiles = await this._enum(home);
    const sessions = await parsePage(allFiles, offset, limit, fp => parseCodexMeta(fp));
    return { sessions, totalFiles: allFiles.length };
  }

  async count(home: string): Promise<number> {
    return (await this._enum(home)).length;
  }

  parseMessages(lines: string[]): Message[] {
    return parseCodexMessages(lines);
  }

  async loadDetail(_target: string): Promise<Message[] | null> {
    return null;
  }
}

// ════════════════════════════════════════════════
// OpenClaw
// ════════════════════════════════════════════════

async function parseOpenClawMeta(filePath: string, agentId: string): Promise<Session> {
  const r = await readHeadAndTail(filePath);
  const headLines = r.head;
  const tailLines = r.tail;

  let sessionId = path.basename(filePath, '.jsonl');
  let title = '';
  let firstTs = '';
  let lastTs = '';
  let tokenUsage = 0;
  let lastModel = '';
  let projectPath = '';

  function parseOpenClawLines(lines: string[]): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line[0] !== '{') continue;
      let d: Record<string, any>;
      try {
        d = JSON.parse(line);
      } catch (e) {
        continue;
      }
      if (!d || typeof d !== 'object') continue;

      if (d.type === 'session') {
        if (d.id) sessionId = d.id;
        if (d.cwd) projectPath = d.cwd;
        if (d.timestamp) {
          if (!firstTs) firstTs = d.timestamp;
          lastTs = d.timestamp;
        }
      }
      if (d.type === 'message' && d.message) {
        const role: string = d.message.role || '';
        if (role === 'user' || role === 'assistant') {
          if (!title && role === 'user') {
            let c = '';
            if (typeof d.message.content === 'string') c = d.message.content;
            else if (Array.isArray(d.message.content)) {
              for (let k = 0; k < d.message.content.length; k++) {
                if (d.message.content[k].type === 'text') {
                  c = d.message.content[k].text;
                  break;
                }
              }
            }
            if (c) {
              title = c.substring(0, 60);
              if (c.length > 60) title += '...';
            }
          }
          if (d.message.usage) {
            const u = d.message.usage;
            tokenUsage +=
              (Number(u.input) || 0) + (Number(u.output) || 0) + (Number(u.totalTokens) || 0);
          }
          if (d.message.model) lastModel = d.message.model;
        }
        if (d.timestamp) {
          if (!firstTs) firstTs = d.timestamp;
          lastTs = d.timestamp;
        }
      }
      if (d.timestamp && d.type !== 'session' && d.type !== 'message') {
        if (!firstTs) firstTs = d.timestamp;
        lastTs = d.timestamp;
      }
    }
  }

  parseOpenClawLines(headLines);
  parseOpenClawLines(tailLines);

  const messageCount = estimateMessageCount(headLines, tailLines, r.size);
  if (!title) title = sessionId.substring(0, 12) + '...';
  if (!projectPath && agentId) projectPath = agentId;

  return {
    id: 'openclaw_' + sessionId,
    app: 'openclaw',
    sessionId,
    title,
    projectPath,
    messageCount,
    tokenUsage,
    model: lastModel,
    createdAt: firstTs || '',
    updatedAt: lastTs || '',
    filePath
  };
}

async function enumOpenClawFiles(
  home: string
): Promise<Array<{ path: string; mtime: number; agent: string }>> {
  const agentsDir = utils.getAgentSessionPath('openclaw') || path.join(home, '.openclaw', 'agents');
  const allFiles: Array<{ path: string; mtime: number; agent: string }> = [];
  let agentEntries: import('fs').Dirent[];
  try {
    agentEntries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
  } catch (e) {
    return allFiles;
  }

  const dirs = agentEntries.filter(e => e.isDirectory());
  const perAgent = await utils.mapLimit(dirs, PARSE_CONCURRENCY, async function (agentEnt) {
    const sessDir = path.join(agentsDir, agentEnt.name, 'sessions');
    let files: string[];
    try {
      files = await fs.promises.readdir(sessDir);
    } catch (e) {
      return [];
    }
    const jsonl = files.filter(f => /\.jsonl$/i.test(f));
    const stats = await utils.mapLimit(jsonl, PARSE_CONCURRENCY, async function (fname) {
      const filePath = path.join(sessDir, fname);
      try {
        const st = await fs.promises.stat(filePath);
        return { path: filePath, mtime: st.mtimeMs, agent: agentEnt.name };
      } catch (e) {
        return null;
      }
    });
    return stats.filter(Boolean);
  });

  for (const list of perAgent) {
    if (list) allFiles.push(...list);
  }
  allFiles.sort((a, b) => b.mtime - a.mtime);
  return allFiles;
}

function parseOpenClawMessages(lines: string[]): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line[0] !== '{') continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (!d || d.type !== 'message' || !d.message) continue;
    const role: string = d.message.role || '';
    if (role !== 'user' && role !== 'assistant') continue;
    const blocks = extractContentBlocks(d.message.content);
    if (blocks.length > 0)
      messages.push({ role, contentBlocks: blocks, timestamp: d.timestamp || '' });
  }
  return messages;
}

export class OpenClawSessionAdapter implements SessionAdapter {
  id = 'openclaw';
  label = 'OpenClaw';

  private async _enum(home: string) {
    return cachedEnum('openclaw', () => enumOpenClawFiles(home));
  }

  async scan(
    home: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<{ sessions: Session[]; totalFiles: number }> {
    opts = opts || {};
    const offset = opts.offset || 0;
    const limit = opts.limit != null ? opts.limit : 20;
    const allFiles = await this._enum(home);
    const sessions = await parsePage(allFiles, offset, limit, f =>
      parseOpenClawMeta(f.path, f.agent)
    );
    return { sessions, totalFiles: allFiles.length };
  }

  async count(home: string): Promise<number> {
    return (await this._enum(home)).length;
  }

  parseMessages(lines: string[]): Message[] {
    return parseOpenClawMessages(lines);
  }

  async loadDetail(_target: string): Promise<Message[] | null> {
    return null;
  }
}

// ════════════════════════════════════════════════
// OpenCode（SQLite）
// ════════════════════════════════════════════════

const OPENCODE_SCHEMA = [
  'id',
  'project_id',
  'workspace_id',
  'parent_id',
  'slug',
  'directory',
  'path',
  'title',
  'version',
  'share_url',
  'summary_additions',
  'summary_deletions',
  'summary_files',
  'summary_diffs',
  'metadata',
  'cost',
  'tokens_input',
  'tokens_output',
  'tokens_reasoning',
  'tokens_cache_read',
  'tokens_cache_write',
  'revert',
  'permission',
  'agent',
  'model',
  'time_created',
  'time_updated',
  'time_compacting',
  'time_archived'
];

async function readOpenCodeAll(_home: string): Promise<Session[]> {
  const dbPath = utils.getOpenCodeDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const rows = await sqlite.readSqliteTableAsync(dbPath, 'session', OPENCODE_SCHEMA);
  const msgCols = ['id', 'session_id', 'time_created', 'time_updated', 'data'];
  const msgs = await sqlite.readSqliteTableAsync(dbPath, 'message', msgCols);
  const msgCount: Record<string, number> = {};
  for (const m of msgs) {
    const sid = String(m.session_id || '');
    msgCount[sid] = (msgCount[sid] || 0) + 1;
  }
  const out: Session[] = [];
  for (const r of rows) {
    const sessionId = String(r.id || '');
    let model = 'unknown';
    try {
      const parsed = JSON.parse(String(r.model || '{}'));
      model = parsed.id || parsed.model || 'unknown';
    } catch (e) {
      model = 'unknown';
    }
    const tokenUsage = (Number(r.tokens_input) || 0) + (Number(r.tokens_output) || 0);
    out.push({
      id: 'opencode_' + sessionId,
      app: 'opencode',
      sessionId,
      title: String(r.title || sessionId.substring(0, 12) + '...'),
      projectPath: String(r.directory || ''),
      messageCount: msgCount[sessionId] || 0,
      tokenUsage,
      model,
      createdAt: ocTs(r.time_created),
      updatedAt: ocTs(r.time_updated) || ocTs(r.time_created),
      filePath: 'opencode://' + sessionId
    });
  }
  return out;
}

async function loadOpenCodeDetail(sessionId: string): Promise<Message[]> {
  const dbPath = utils.getOpenCodeDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const msgCols = ['id', 'session_id', 'time_created', 'time_updated', 'data'];
  const partCols = ['id', 'message_id', 'session_id', 'time_created', 'time_updated', 'data'];
  const allMsgs = await sqlite.readSqliteTableAsync(dbPath, 'message', msgCols);
  const allParts = await sqlite.readSqliteTableAsync(dbPath, 'part', partCols);
  const msgs = allMsgs.filter(m => String(m.session_id) === sessionId);
  const parts = allParts.filter(p => String(p.session_id) === sessionId);
  const partsByMsg: Record<string, any[]> = {};
  for (const p of parts) {
    const mid = String(p.message_id || '');
    (partsByMsg[mid] || (partsByMsg[mid] = [])).push(p);
  }
  const out: Message[] = [];
  for (const m of msgs) {
    let role = '';
    let ts = '';
    let diffs: any[] = [];
    let msgError = '';
    try {
      const d = JSON.parse(String(m.data || '{}'));
      role = d.role || '';
      ts = d.time && d.time.created ? new Date(d.time.created).toISOString() : '';
      if (Array.isArray(d.summary && d.summary.diffs) && d.summary.diffs.length)
        diffs = d.summary.diffs;
      if (d.error) {
        msgError =
          typeof d.error === 'string'
            ? d.error
            : String(
                (d.error && ((d.error.data && d.error.data.message) || d.error.message)) ||
                  d.error.name ||
                  ''
              );
      }
    } catch (e) {}
    if (role !== 'user' && role !== 'assistant') continue;
    const blocks: ContentBlock[] = [];
    // 修改文件的 diff 摘要（存在 user 消息的 summary.diffs）
    if (diffs.length) {
      blocks.push({
        type: 'patch',
        input: {
          files: diffs.map(df => df.file),
          patches: diffs.map(df => ({
            file: df.file,
            patch: df.patch,
            additions: df.additions,
            deletions: df.deletions
          }))
        }
      });
    }
    if (msgError) blocks.push({ type: 'tool_result', text: '⚠️ ' + msgError });
    for (const p of partsByMsg[String(m.id)] || []) {
      try {
        const pd = JSON.parse(String(p.data || '{}'));
        if (pd.type === 'text' && pd.text) {
          blocks.push({ type: 'text', text: String(pd.text) });
        } else if (pd.type === 'tool' && pd.tool) {
          const st = pd.state || {};
          const input = pd.input || st.input || {};
          blocks.push({ type: 'tool_use', name: pd.tool || 'unknown', input });
          const resultText = extractOpenCodeOutputText(st.output);
          if (resultText) {
            blocks.push({ type: 'tool_result', text: resultText });
          } else if (st.status === 'error' && st.error) {
            blocks.push({ type: 'tool_result', text: '❌ ' + String(st.error) });
          }
        } else if (pd.type === 'patch' && pd.files && pd.files.length) {
          blocks.push({ type: 'patch', input: { files: pd.files } });
        } else if (pd.type === 'file' && pd.filename) {
          blocks.push({ type: 'file', name: pd.filename, text: pd.url || '' });
        } else if (pd.type === 'reasoning' && pd.text) {
          blocks.push({ type: 'thinking', text: String(pd.text) });
        }
      } catch (e) {}
    }
    out.push({ role, contentBlocks: blocks, timestamp: ts });
  }
  return mergeMessages(out);
}

export class OpenCodeSessionAdapter implements SessionAdapter {
  id = 'opencode';
  label = 'OpenCode';

  async scan(
    home: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<{ sessions: Session[]; totalFiles: number }> {
    opts = opts || {};
    const offset = opts.offset || 0;
    const limit = opts.limit != null ? opts.limit : 20;
    const all = await readOpenCodeAll(home);
    all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const slice = limit <= 0 ? all.slice(offset) : all.slice(offset, offset + limit);
    return { sessions: slice, totalFiles: all.length };
  }

  async count(home: string): Promise<number> {
    return (await readOpenCodeAll(home)).length;
  }

  parseMessages(_lines: string[]): Message[] {
    return [];
  }

  async loadDetail(sessionId: string): Promise<Message[]> {
    return loadOpenCodeDetail(sessionId);
  }
}

// ─────────── 注册表 ───────────

export const SESSION_ADAPTERS: Record<string, SessionAdapter> = {
  claude: new ClaudeSessionAdapter(),
  'claude-desktop': new ClaudeDesktopSessionAdapter(),
  codex: new CodexSessionAdapter(),
  openclaw: new OpenClawSessionAdapter(),
  opencode: new OpenCodeSessionAdapter()
};

export function getSessionAdapter(app: string): SessionAdapter | null {
  return SESSION_ADAPTERS[app] || null;
}
