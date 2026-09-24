// ZTools ccToggle - stats/adapters.ts
// 各 agent 的用量统计适配器：封装日志/数据源扫描差异

import * as utils from '../../utils';
import * as sqlite from '../../core/sqlite';
import { DailyRecord, UsageAdapter, dayFromTs, emptyBucket } from './types';

const fs = utils.fs;
const path = utils.path;
const getHomeDir = utils.getHomeDir;

// ─────────── 共享工具 ───────────

async function listJsonl(dir: string, out?: string[]): Promise<string[]> {
  out = out || [];
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    const fullPath = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await listJsonl(fullPath, out);
    } else if (ent.isFile() && /\.jsonl$/i.test(ent.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

// 通用累加：往 acc 写入一条按天记录
export function addUsage(
  acc: Record<string, DailyRecord>,
  appType: string,
  day: string,
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheCreate: number
): void {
  const dayKey = appType + '_' + day;
  const d =
    acc[dayKey] ||
    (acc[dayKey] = {
      appType: appType,
      day: day,
      requests: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreate: 0,
      total: 0,
      models: {}
    });
  const b = d.models[model] || (d.models[model] = emptyBucket());
  b.requests += 1;
  b.input += input;
  b.output += output;
  b.cacheRead += cacheRead;
  b.cacheCreate += cacheCreate;
  b.total += input + output + cacheRead + cacheCreate;
  d.requests += 1;
  d.input += input;
  d.output += output;
  d.cacheRead += cacheRead;
  d.cacheCreate += cacheCreate;
  d.total += input + output + cacheRead + cacheCreate;
}

// ─────────── Claude（~/.claude/projects 的 assistant 消息）───────────

export class ClaudeUsageAdapter implements UsageAdapter {
  id = 'claude';
  label = 'Claude';

  async scan(clearedMs: number, acc: Record<string, DailyRecord>): Promise<void> {
    const home = getHomeDir();
    const dir = utils.getAgentSessionPath('claude') || path.join(home, '.claude', 'projects');
    const list = await listJsonl(dir);
    for (let i = 0; i < list.length; i++) {
      await this._parseFile(list[i], clearedMs, acc);
    }
  }

  private async _parseFile(
    file: string,
    clearedMs: number,
    acc: Record<string, DailyRecord>
  ): Promise<void> {
    let text: string;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (e) {
      return;
    }
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch (e) {
        continue;
      }
      if (!d || typeof d !== 'object') continue;

      if (d.type !== 'assistant' || !d.message) continue;
      const mu = d.message.usage;
      if (!mu) continue;
      if (clearedMs && d.timestamp && new Date(d.timestamp).getTime() <= clearedMs) continue;
      const day = dayFromTs(d.timestamp);
      if (!day) continue;
      const cIn = Number(mu.input_tokens) || 0;
      const cOut = Number(mu.output_tokens) || 0;
      const cRead = Number(mu.cache_read_input_tokens) || 0;
      const cCreate = Number(mu.cache_creation_input_tokens) || 0;
      if (!cIn && !cOut && !cRead && !cCreate) continue;
      addUsage(acc, 'claude', day, d.message.model || 'unknown', cIn, cOut, cRead, cCreate);
    }
  }
}

// ─────────── Codex（~/.codex/sessions 的 event_msg token_count）───────────

export class CodexUsageAdapter implements UsageAdapter {
  id = 'codex';
  label = 'Codex';

  async scan(clearedMs: number, acc: Record<string, DailyRecord>): Promise<void> {
    const home = getHomeDir();
    const dir = utils.getAgentSessionPath('codex') || path.join(home, '.codex', 'sessions');
    const list = await listJsonl(dir);
    for (let i = 0; i < list.length; i++) {
      await this._parseFile(list[i], clearedMs, acc);
    }
  }

  private async _parseFile(
    file: string,
    clearedMs: number,
    acc: Record<string, DailyRecord>
  ): Promise<void> {
    let text: string;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (e) {
      return;
    }
    const lines = text.split(/\r?\n/);
    let codexModel = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch (e) {
        continue;
      }
      if (!d || typeof d !== 'object') continue;

      if (d.type === 'turn_context' && d.payload && d.payload.model) {
        codexModel = d.payload.model;
        continue;
      }
      if (d.type !== 'event_msg' || !d.payload || d.payload.type !== 'token_count') continue;
      const info = d.payload.info;
      const last = info && info.last_token_usage;
      if (!last) continue;
      if (clearedMs && d.timestamp && new Date(d.timestamp).getTime() <= clearedMs) continue;
      const day2 = dayFromTs(d.timestamp);
      if (!day2) continue;
      const totalIn = Number(last.input_tokens) || 0;
      const cachedIn = Number(last.cached_input_tokens) || 0;
      const freshIn = Math.max(0, totalIn - cachedIn);
      const out = Number(last.output_tokens) || 0;
      const cacheCreate = Number(last.cache_write_input_tokens) || 0;
      if (!totalIn && !out && !cacheCreate) continue;
      addUsage(acc, 'codex', day2, codexModel || 'unknown', freshIn, out, cachedIn, cacheCreate);
    }
  }
}

// ─────────── OpenCode（SQLite session 表）───────────

export class OpenCodeUsageAdapter implements UsageAdapter {
  id = 'opencode';
  label = 'OpenCode';

  async scan(clearedMs: number, acc: Record<string, DailyRecord>): Promise<void> {
    const dbPath = utils.getOpenCodeDbPath();
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const schema = [
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
    const sessions = await sqlite.readSqliteTableAsync(dbPath, 'session', schema);
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const totalIn = Number(s.tokens_input) || 0;
      const totalOut = Number(s.tokens_output) || 0;
      const cRead = Number(s.tokens_cache_read) || 0;
      const cCreate = Number(s.tokens_cache_write) || 0;
      if (!totalIn && !totalOut && !cRead && !cCreate) continue;
      let ts = Number(s.time_updated) || Number(s.time_created) || 0;
      if (clearedMs && ts && ts <= clearedMs) continue;
      if (!ts) continue;
      const day = dayFromTs(new Date(ts).toISOString());
      if (!day) continue;
      let model = 'unknown';
      try {
        const m = JSON.parse(String(s.model || '{}'));
        model = m.id || m.model || 'unknown';
      } catch (e) {
        model = 'unknown';
      }
      const freshIn = Math.max(0, totalIn - cRead);
      addUsage(acc, 'opencode', day, model, freshIn, totalOut, cRead, cCreate);
    }
  }
}

// ─────────── 注册表 ───────────

export const USAGE_ADAPTERS: Record<string, UsageAdapter> = {
  claude: new ClaudeUsageAdapter(),
  codex: new CodexUsageAdapter(),
  opencode: new OpenCodeUsageAdapter()
};

/** 有真实扫描实现的 agent（含无扫描的占位仅用于 clearedAt/clearStats） */
export const SCAN_APPS: string[] = Object.keys(USAGE_ADAPTERS);
