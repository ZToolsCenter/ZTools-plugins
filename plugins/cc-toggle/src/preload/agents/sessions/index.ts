// ZTools ccToggle - sessions/index.ts
// 会话管理：读取各 AI 应用的本地会话数据
// 纯编排：枚举/解析差异在各 agent 适配器（./adapters）

import utils = require('../../utils');
import { SESSION_ADAPTERS, getSessionAdapter } from './adapters';
import { _enumCache, mergeMessages } from './shared';
import { ClearAllResult, DeleteResult, Message, ScanOptions, ScanResult, Session } from './types';

const fs = utils.fs;
const getHomeDir = utils.getHomeDir;

interface ScanCacheEntry {
  sessions: Session[];
}

interface ScanCache {
  data: Record<string, ScanCacheEntry> | null;
  timestamp: number;
  readonly TTL: number;
}

interface ScanFunction {
  (
    home: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<{ sessions: Session[]; totalFiles: number }>;
}

interface CountFunction {
  (home: string): Promise<number>;
}

// --- 扫描缓存 ---
const _scanCache: ScanCache = {
  data: null,
  timestamp: 0,
  TTL: 30000
};
let _sessionCache: Record<string, Message[]> = {};

const SCAN_APPS: string[] = Object.keys(SESSION_ADAPTERS);

export class SessionManager {
  // ============================================================
  // 内部辅助方法
  // ============================================================

  private static _clearScanCache(): void {
    _scanCache.data = null;
    _scanCache.timestamp = 0;
    for (const k of Object.keys(_enumCache)) delete _enumCache[k];
  }

  // ============================================================
  // 排序函数
  // ============================================================

  private static _sortSessions(sessions: Session[], sort: string): Session[] {
    let sorted = sessions.slice();
    switch (sort) {
      case 'today': {
        const today = new Date().toISOString().substring(0, 10);
        sorted = sorted.filter(s => (s.updatedAt || '').substring(0, 10) === today);
        sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        break;
      }
      case 'time-asc':
        sorted.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
        break;
      case 'name-asc':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'name-desc':
        sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        break;
      case 'time-desc':
      case 'all':
      default:
        sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        break;
    }
    return sorted;
  }

  // 主入口：扫描会话
  static async scanSessions(app: string, opts?: ScanOptions): Promise<ScanResult> {
    opts = opts || {};
    const offset = opts.offset || 0;
    const limit = opts.limit != null ? opts.limit : 20;
    const search = (opts.search || '').toLowerCase();
    const sort = opts.sort || 'time-desc';

    try {
      const home = getHomeDir();
      const now = Date.now();
      const cacheKey = app || 'all';

      // 无搜索时可用缓存
      const cached = _scanCache.data && _scanCache.data[cacheKey];
      const useCache = !search && cached && now - _scanCache.timestamp < _scanCache.TTL;

      if (useCache) {
        const sorted = SessionManager._sortSessions(cached!.sessions, sort);
        const total = sorted.length;
        const page = limit > 0 ? sorted.slice(offset, offset + limit) : [];
        return { sessions: page, total };
      }

      const adapter = app ? getSessionAdapter(app) : null;

      // 只要总数（Tab 计数）：枚举文件即可，不解析任何内容
      if (limit <= 0 && !search) {
        let total = 0;
        if (adapter) {
          total = await adapter.count(home);
        } else {
          const counts = await Promise.all(SCAN_APPS.map(k => SessionManager._countFn(k)(home)));
          total = counts.reduce((a, b) => a + b, 0);
        }
        return { sessions: [], total };
      }

      // 快路径：单 app + 无搜索 + 时间倒序
      // 文件枚举天然按 mtime/日期目录倒序，只需解析当前页
      if (!search && (sort === 'time-desc' || sort === 'all') && adapter) {
        const r = await adapter.scan(home, { offset, limit });
        return { sessions: SessionManager._sortSessions(r.sessions, sort), total: r.totalFiles };
      }

      // 慢路径：搜索 / 按名排序 / 今日过滤 / 跨 app 聚合，需要全量元数据
      let all: Session[] = [];
      if (adapter) {
        const r = await adapter.scan(home, { offset: 0, limit: Infinity });
        all = r.sessions;
      } else {
        const results = await Promise.all(
          SCAN_APPS.map(k => SessionManager._scanFn(k)(home, { offset: 0, limit: Infinity }))
        );
        for (let i = 0; i < results.length; i++) {
          all = all.concat(results[i].sessions);
        }
      }

      // 缓存（无搜索时）
      if (!search) {
        if (!_scanCache.data) _scanCache.data = {};
        _scanCache.data[cacheKey] = { sessions: all };
        _scanCache.timestamp = now;
      }

      // 搜索过滤
      if (search) {
        all = all.filter(
          s =>
            (s.title || '').toLowerCase().indexOf(search) >= 0 ||
            (s.projectPath || '').toLowerCase().indexOf(search) >= 0 ||
            (s.model || '').toLowerCase().indexOf(search) >= 0
        );
      }

      // 排序 + 分页
      all = SessionManager._sortSessions(all, sort);
      const total = all.length;
      const page = all.slice(offset, offset + limit);
      return { sessions: page, total };
    } catch (e: any) {
      return { sessions: [], total: 0, error: String(e && e.message ? e.message : e) };
    }
  }

  private static _scanFn(app: string): ScanFunction {
    return (home: string, opts?: { offset?: number; limit?: number }) => {
      const a = getSessionAdapter(app);
      if (!a) return Promise.resolve({ sessions: [], totalFiles: 0 });
      return a.scan(home, opts);
    };
  }

  private static _countFn(app: string): CountFunction {
    return (home: string) => {
      const a = getSessionAdapter(app);
      if (!a) return Promise.resolve(0);
      return a.count(home);
    };
  }

  // ============================================================
  // 加载会话详情（含完整消息历史）
  // ============================================================

  // 从文件路径推断应用类型
  private static _detectApp(filePath: string): string {
    if (filePath.indexOf('opencode://') >= 0) return 'opencode';
    if (filePath.indexOf('.codex') >= 0) return 'codex';
    if (filePath.indexOf('.openclaw') >= 0 || filePath.indexOf('openclaw') >= 0) return 'openclaw';
    if (filePath.indexOf('claude-desktop') >= 0) return 'claude-desktop';
    return 'claude';
  }

  static async loadSessionDetail(filePath: string): Promise<Message[] | null> {
    if (!filePath) return null;
    if (_sessionCache[filePath]) return _sessionCache[filePath];

    // OpenCode 会话：filePath 为 opencode://sessionId
    if (filePath.indexOf('opencode://') === 0) {
      const sessionId = filePath.slice('opencode://'.length);
      const adapter = getSessionAdapter('opencode');
      const messages = adapter ? await adapter.loadDetail(sessionId) : [];
      _sessionCache[filePath] = messages || [];
      return _sessionCache[filePath];
    }

    let text: string;
    try {
      text = await fs.promises.readFile(filePath, 'utf8');
    } catch (e) {
      return null;
    }

    const lines = text.split(/\r?\n/);

    let app = SessionManager._detectApp(filePath);
    // Claude 路径可能是 OpenClaw 格式
    if (app === 'claude') {
      const firstLine = lines[0] || '';
      if (firstLine.indexOf('"type":"session"') >= 0 && firstLine.indexOf('"version":3') >= 0)
        app = 'openclaw';
    }

    const adapter = getSessionAdapter(app);
    const claude = getSessionAdapter('claude');
    const parser = adapter ? adapter.parseMessages.bind(adapter) : null;
    const parse =
      parser ||
      (claude
        ? claude.parseMessages.bind(claude)
        : function () {
            return [];
          });
    const messages = mergeMessages(parse(lines));

    _sessionCache[filePath] = messages;
    return messages;
  }

  static deleteSession(filePath: string): DeleteResult {
    try {
      if (filePath.indexOf('opencode://') === 0) {
        return { success: false, error: 'OpenCode 会话存储于数据库，暂不支持删除' };
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        delete _sessionCache[filePath];
        SessionManager._clearScanCache();
        return { success: true };
      }
      return { success: false, error: 'file not found' };
    } catch (e: any) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  }

  static clearAllSessions(filePaths: string[]): ClearAllResult {
    if (!Array.isArray(filePaths)) return { success: false, count: 0, errors: ['invalid input'] };
    let successCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < filePaths.length; i++) {
      try {
        if (filePaths[i].indexOf('opencode://') === 0) {
          errors.push('OpenCode 会话存储于数据库，暂不支持删除');
          continue;
        }
        if (fs.existsSync(filePaths[i])) {
          fs.unlinkSync(filePaths[i]);
          delete _sessionCache[filePaths[i]];
          successCount++;
        }
      } catch (e: any) {
        errors.push(String(e && e.message ? e.message : e));
      }
    }
    SessionManager._clearScanCache();
    return { success: successCount > 0, count: successCount, errors };
  }

  static clearSessionCache(): void {
    SessionManager._clearScanCache();
    _sessionCache = {};
  }
}
