// ZTools ccToggle - stats/types.ts
// 用量统计模块共享类型与适配器接口

export interface UsageBucket {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  total: number;
}

export interface DailyRecord {
  appType: string;
  day: string;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  total: number;
  models: Record<string, UsageBucket>;
}

/** 单个 agent 的用量统计适配器：封装日志/数据源扫描差异 */
export interface UsageAdapter {
  id: string;
  label: string;
  /** 扫描该 agent 的会话数据，把按天记录累加到 acc */
  scan(clearedMs: number, acc: Record<string, DailyRecord>): Promise<void>;
}

export function statDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

export function emptyBucket(): UsageBucket {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
}

export function dayFromTs(ts: string): string {
  if (!ts) return '';
  try {
    return statDayKey(new Date(ts));
  } catch (e) {
    return '';
  }
}
