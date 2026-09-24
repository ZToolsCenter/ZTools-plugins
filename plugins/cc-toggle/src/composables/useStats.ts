import { reactive, ref } from 'vue';
import { APP_TYPES, APP_LABELS, getSkillNest } from './shared';
import type { DailyUsage, UsageBucket } from '../types/ztools-cctoggle';

// 用量统计的应用列表（含 opencode，但 opencode 不参与供应商切换）
export const STATS_APP_TYPES = [...APP_TYPES, 'opencode'] as string[];

interface StatsFilter {
  appType: string;
  days: number;
}

interface ModelStats {
  model: string;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  total: number;
}

interface StatsData {
  totals: UsageBucket;
  daily: DailyUsage[];
  models: ModelStats[];
}

const filter = reactive<StatsFilter>({ appType: 'all', days: 7 });

const EMPTY_TOTALS: UsageBucket = {
  requests: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreate: 0,
  total: 0
};

// 上次扫描返回的全部原始按天记录
const rawDaily = ref<DailyUsage[]>([]);

const stats = ref<StatsData>({
  totals: { ...EMPTY_TOTALS },
  daily: [],
  models: []
});

const refreshing = ref(false);
const initialLoading = ref(true);

// 本地日期 YYYY-MM-DD
function _dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

// 依据当前 filter，从 rawDaily 聚合出展示用 stats
function applyFilter(): void {
  let minDay: string | null = null;
  if (filter.days && filter.days > 0) {
    const d = new Date();
    d.setDate(d.getDate() - (filter.days - 1));
    minDay = _dayKey(d);
  }
  const totals = { ...EMPTY_TOTALS };
  const models: Record<string, UsageBucket> = {};
  const daily: DailyUsage[] = [];
  for (const rec of rawDaily.value) {
    if (filter.appType !== 'all' && rec.appType !== filter.appType) continue;
    if (minDay && rec.day < minDay) continue;
    daily.push({
      day: rec.day,
      appType: rec.appType,
      requests: rec.requests || 0,
      input: rec.input || 0,
      output: rec.output || 0,
      cacheRead: rec.cacheRead || 0,
      cacheCreate: rec.cacheCreate || 0,
      total: rec.total || 0,
      models: rec.models || {}
    });
    totals.requests += rec.requests || 0;
    totals.input += rec.input || 0;
    totals.output += rec.output || 0;
    totals.cacheRead += rec.cacheRead || 0;
    totals.cacheCreate += rec.cacheCreate || 0;
    totals.total += rec.total || 0;
    for (const mid of Object.keys(rec.models || {})) {
      const b = rec.models[mid];
      const agg = models[mid] || {
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreate: 0,
        total: 0
      };
      agg.requests += b.requests || 0;
      agg.input += b.input || 0;
      agg.output += b.output || 0;
      agg.cacheRead += b.cacheRead || 0;
      agg.cacheCreate += b.cacheCreate || 0;
      agg.total += b.total || 0;
      models[mid] = agg;
    }
  }
  daily.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const modelList = Object.keys(models)
    .map(mid => ({ model: mid, ...models[mid] }))
    .sort((a, b) => b.total - a.total);
  stats.value = { totals, daily, models: modelList };
}

// 扫描本地 CLI 日志，返回 { error? } 由调用方提示
async function refresh(): Promise<{ error?: string }> {
  if (refreshing.value) return {};
  refreshing.value = true;
  try {
    const api = getSkillNest();
    const r = (await api.scanUsageLogs()) || { daily: [] };
    if (r.error) {
      return { error: '扫描出错：' + r.error };
    }
    rawDaily.value = r.daily || [];
    applyFilter();
    return {};
  } catch (e: any) {
    return { error: '扫描失败：' + (e?.message || String(e)) };
  } finally {
    refreshing.value = false;
    initialLoading.value = false;
  }
}

function setAppType(t: string): void {
  filter.appType = t;
  applyFilter();
}
function setDays(d: number): void {
  filter.days = d;
  applyFilter();
}

async function clearStats(appType?: string) {
  const r = getSkillNest().clearStats(appType || 'all') || { success: false };
  if (r.success) {
    await refresh();
  }
  return r;
}

function cacheHitRate(t?: UsageBucket): number {
  const tot = t || stats.value.totals;
  const denom = (tot.input || 0) + (tot.cacheRead || 0);
  if (!denom) return 0;
  return Math.min(1, (tot.cacheRead || 0) / denom);
}

export function useStats() {
  return {
    APP_TYPES: STATS_APP_TYPES,
    APP_LABELS,
    filter,
    stats,
    rawDaily,
    refreshing,
    initialLoading,
    refresh,
    setAppType,
    setDays,
    clearStats,
    cacheHitRate
  };
}
