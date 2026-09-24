// ZTools ccToggle - stats/index.ts
// 用量统计（无缓存：每次直接扫描本地 CLI 会话日志）
// 纯编排：扫描差异在各 agent 适配器（./adapters）

import { USAGE_ADAPTERS, SCAN_APPS } from './adapters';
import { DailyRecord } from './types';

const CLEARED_KEY = 'cctoggle_stat_clearedAt';
const ALL_APP_TYPES = ['codex', 'claude', 'claude-desktop', 'openclaw', 'gemini', 'opencode'];

export class StatsCollector {
  static _getClearedAt(): Record<string, number> {
    const doc = ztools.db.get(CLEARED_KEY) || {};
    const result: Record<string, number> = {};
    for (let i = 0; i < ALL_APP_TYPES.length; i++) {
      const t = ALL_APP_TYPES[i];
      result[t] = Number(doc[t]) || 0;
    }
    return result;
  }

  static async scanUsageLogs(): Promise<{ daily: DailyRecord[]; error?: string }> {
    try {
      const cleared = StatsCollector._getClearedAt();
      const acc: Record<string, DailyRecord> = {};
      for (let i = 0; i < SCAN_APPS.length; i++) {
        const app = SCAN_APPS[i];
        const adapter = USAGE_ADAPTERS[app];
        if (!adapter) continue;
        await adapter.scan(cleared[app] || 0, acc);
      }
      const daily = Object.keys(acc).map(function (k) {
        return acc[k];
      });
      return { daily: daily };
    } catch (e) {
      return { daily: [], error: String(e && e.message ? e.message : e) };
    }
  }

  static clearStats(appType?: string): { success: boolean; error?: string } {
    const doc = ztools.db.get(CLEARED_KEY) || { _id: CLEARED_KEY };
    const now = Date.now();
    if (!appType || appType === 'all') {
      for (let i = 0; i < ALL_APP_TYPES.length; i++) doc[ALL_APP_TYPES[i]] = now;
    } else doc[appType] = now;
    try {
      ztools.db.put(doc);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  }
}
