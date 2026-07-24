/**
 * 金价数据服务层 v5
 *
 * 数据源:
 *   - api.gold-api.com      : 实时金价 USD (免费, 无需Key)
 *   - Tmini API             : 实时金价 RMB + 品牌/银行/回收价 (国内)
 *   - datasets/gold-prices  : 月度/年度均价 CSV (2000年起, 6h缓存)
 *
 * 本地快照机制 (累积真实使用数据):
 *   - hourlySnapshots   : 每小时一条, 最多保留 48 条 → 日内24h走势
 *   - dailySnapshots    : 每天一条, 最多保留 400 条 → 近30天/月度走势
 *   - monthlySnapshots  : 每月一条, 最多保留 60 条  → 年度12月走势
 *
 * 缓存 TTL:
 *   - 实时金价 : 5 分钟
 *   - 历史 CSV : 6 小时 (源每日更新)
 */

// ---- 类型定义 ----

export interface MetalPrice {
  name: string;
  sell_price: string;
  today_price: string;
  high_price: string;
  low_price: string;
  unit: string;
  updated: string;
  updated_at: number;
}

export interface StorePrice {
  brand: string;
  product: string;
  price: string;
  unit: string;
  formatted: string;
  updated: string;
  updated_at: number;
}

export interface BankPrice {
  bank: string;
  product: string;
  price: string;
  unit: string;
  formatted: string;
  time: string;
  updated: string;
  updated_at: number;
}

export interface RecyclePrice {
  type: string;
  price: string;
  unit: string;
  formatted: string;
  purity: string;
  updated: string;
  updated_at: number;
}

export interface TminiResponse {
  date: string;
  metals: MetalPrice[];
  stores: StorePrice[];
  banks: BankPrice[];
  recycle: RecyclePrice[];
}

/** 历史每日价格点 (USD/盎司) */
export interface HistoricalPrice {
  date: string;   // YYYY-MM-DD
  price: number;
  source?: string;
}

/** datasets/gold-prices 月度均价记录 */
export interface MonthlyGoldRecord {
  date: string;   // YYYY-MM
  price: number;  // 月均价 USD
}

/** datasets/gold-prices 年度均价记录 */
export interface AnnualGoldRecord {
  year: number;
  price: number;  // 年均价 USD
}

/** 遗留历史数据 (datasets/gold-prices CSV解析结果) */
export interface LegacyHistoricalData {
  monthly: MonthlyGoldRecord[];  // 1833起月均价, 过滤到2000+
  annual: AnnualGoldRecord[];    // 1833起年均价, 过滤到2000+
}

/** 小时级价格快照 (日内波动用) */
export interface HourlySnapshot {
  time: string;   // YYYY-MM-DDTHH:00
  price: number;
}

/** 月度价格快照 (年度波动用) */
export interface MonthlySnapshot {
  month: string;     // YYYY-MM
  avgPrice: number;
  highPrice: number;
  lowPrice: number;
  count?: number;    // 该月累计记录次数，用于正确计算运行均值
}

/** 实时金价快照 */
export interface GoldPriceSnapshot {
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  changeAmount: number;
  changePercent: number;
  name: string;
  unit: string;
  updatedAt: string;
  date: string;
}

// ---- 缓存 Key ----
const KEY_TMINI       = 'gpc_tmini_v5';
const KEY_REALTIME    = 'gpc_realtime_v5';
const KEY_LEGACY      = 'gpc_legacy_v5';        // datasets/gold-prices CSV
const KEY_HOURLY      = 'gpc_hourly_v5';         // 小时快照
const KEY_DAILY       = 'gpc_daily_v5';           // 每日快照
const KEY_MONTHLY     = 'gpc_monthly_v5';         // 月度快照

const TTL_REALTIME   = 5 * 60 * 1000;             // 5 分钟
const TTL_LEGACY     = 6 * 60 * 60 * 1000;        // 6 小时

// 历史数据起始年份
const LEGACY_START_YEAR = 2000;

// ---- API 端点 ----
const TMINI_API       = 'https://tmini.net/api/gold-price?type=json';
const GOLD_API_SPOT   = 'https://api.gold-api.com/price/XAU';

// datasets/gold-prices monthly & annual CSV (raw GitHub)
const DATASETS_MONTHLY_URL = 'https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv';
const DATASETS_ANNUAL_URL  = 'https://raw.githubusercontent.com/datasets/gold-prices/main/data/annual.csv';

// ---- 内存缓存 (非 ZTools 环境) ----
const mem = new Map<string, unknown>();

const isZTools = typeof window !== 'undefined' && Boolean((window as any).ztools);

function db() {
  return (window as any).ztools?.dbStorage;
}

// ---- 通用缓存工具 ----

function isCacheValid(key: string, ttl: number): boolean {
  try {
    if (isZTools) {
      const ts = db()?.getItem(`${key}_ts`);
      return ts ? Date.now() - Number(ts) < ttl : false;
    }
    const ts = mem.get(`${key}_ts`) as number;
    return ts ? Date.now() - ts < ttl : false;
  } catch { return false; }
}

function setCache(key: string, value: unknown): void {
  try {
    if (isZTools) {
      db()?.setItem(key, JSON.stringify(value));
      db()?.setItem(`${key}_ts`, Date.now());
    } else {
      mem.set(key, value);
      mem.set(`${key}_ts`, Date.now());
    }
  } catch { /* ignore */ }
}

function getCache<T>(key: string): T | null {
  try {
    if (isZTools) {
      const raw = db()?.getItem(key);
      return raw ? JSON.parse(raw) as T : null;
    }
    return (mem.get(key) as T) ?? null;
  } catch { return null; }
}

/** 直接持久化（不依赖TTL，用于快照数组的长期存储）*/
function persist(key: string, value: unknown): void {
  try {
    if (isZTools) {
      db()?.setItem(key, JSON.stringify(value));
    } else {
      mem.set(key, value);
    }
  } catch (e) {
    console.warn(`[金价] persist 失败 (${key}):`, e);
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    if (isZTools) {
      const raw = db()?.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as T;
      // 校验数据为数组（快照数据都应是数组）
      if (Array.isArray(parsed)) return parsed;
      console.warn(`[金价] load 数据异常 (${key}), 已重置`);
      return fallback;
    }
    const val = mem.get(key);
    return (Array.isArray(val) ? val : fallback) as T;
  } catch (e) {
    console.warn(`[金价] load 失败 (${key}), 已重置:`, e);
    return fallback;
  }
}

// ---- 写入频率控制 ----

/** 同一条 key 的最小写入间隔 (ms)，防止短时间高频写入 */
const MIN_PERSIST_INTERVAL = 60_000; // 1 分钟

const _lastPersistTime: Record<string, number> = {};

/** 检查是否距离上次 persist 已超过最小间隔 */
function shouldPersist(key: string): boolean {
  const last = _lastPersistTime[key] || 0;
  return Date.now() - last >= MIN_PERSIST_INTERVAL;
}

/** 带频率控制的 persist */
function persistThrottled(key: string, value: unknown): void {
  _lastPersistTime[key] = Date.now();
  persist(key, value);
}

// ---- CSV 解析 ----

/** 解析 monthly.csv: Date,Price */
function parseMonthlyCsv(csv: string): MonthlyGoldRecord[] {
  const lines = csv.trim().split('\n');
  const records: MonthlyGoldRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length >= 2) {
      const date = row[0].trim();
      const price = parseFloat(row[1].trim());
      if (date && !isNaN(price)) {
        records.push({ date, price });
      }
    }
  }
  return records
    .filter(r => {
      const y = parseInt(r.date.substring(0, 4), 10);
      return !isNaN(y) && y >= LEGACY_START_YEAR;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 解析 annual.csv: Date,Price */
function parseAnnualCsv(csv: string): AnnualGoldRecord[] {
  const lines = csv.trim().split('\n');
  const records: AnnualGoldRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length >= 2) {
      const year = parseInt(row[0].trim(), 10);
      const price = parseFloat(row[1].trim());
      if (!isNaN(year) && !isNaN(price)) {
        records.push({ year, price });
      }
    }
  }
  return records
    .filter(r => r.year >= LEGACY_START_YEAR)
    .sort((a, b) => a.year - b.year);
}

/** 从 datasets/gold-prices 获取月度+年度历史数据 (6h缓存) */
export async function fetchLegacyHistoricalData(): Promise<LegacyHistoricalData> {
  if (isCacheValid(KEY_LEGACY, TTL_LEGACY)) {
    const c = getCache<LegacyHistoricalData>(KEY_LEGACY);
    if (c && c.monthly.length > 0) return c;
  }

  const [monthlyResp, annualResp] = await Promise.all([
    fetch(DATASETS_MONTHLY_URL),
    fetch(DATASETS_ANNUAL_URL),
  ]);

  const [monthlyCsv, annualCsv] = await Promise.all([
    monthlyResp.ok ? monthlyResp.text() : Promise.reject(new Error(`monthly.csv ${monthlyResp.status}`)),
    annualResp.ok ? annualResp.text() : Promise.reject(new Error(`annual.csv ${annualResp.status}`)),
  ]);

  const data: LegacyHistoricalData = {
    monthly: parseMonthlyCsv(monthlyCsv),
    annual: parseAnnualCsv(annualCsv),
  };

  setCache(KEY_LEGACY, data);
  console.log(`[金价] 遗留历史: ${data.monthly.length}个月 (${data.monthly[0]?.date ?? 'N/A'}~${data.monthly[data.monthly.length - 1]?.date ?? 'N/A'}), ${data.annual.length}年`);
  return data;
}

/** 获取实时金价 USD (gold-api.com, 免费无key) */
export async function fetchCurrentGoldUSD(): Promise<{ price: number; updatedAt: string }> {
  if (isCacheValid(KEY_REALTIME, TTL_REALTIME)) {
    const c = getCache<{ price: number; updatedAt: string }>(KEY_REALTIME);
    if (c) return c;
  }
  const resp = await fetch(GOLD_API_SPOT);
  if (!resp.ok) throw new Error(`金价API失败: ${resp.status}`);
  const data = await resp.json();
  const result = { price: Number(data.price), updatedAt: data.updatedAt ?? new Date().toISOString() };
  setCache(KEY_REALTIME, result);
  return result;
}

/** 获取 Tmini 实时数据 (RMB + 品牌/银行/回收) */
export async function fetchRealtimeGoldPrice(): Promise<TminiResponse> {
  if (isCacheValid(KEY_TMINI, TTL_REALTIME)) {
    const c = getCache<TminiResponse>(KEY_TMINI);
    if (c) return c;
  }
  const resp = await fetch(TMINI_API);
  if (!resp.ok) throw new Error(`Tmini失败: ${resp.status}`);
  const data: TminiResponse = await resp.json();
  setCache(KEY_TMINI, data);
  return data;
}

// ---- 快照管理 ----

/** 追加小时快照 (日内波动用) — 每小时调用一次 */
export function appendHourlySnapshot(price: number): void {
  const now = new Date();
  const hour = `${now.toISOString().slice(0, 13)}:00`;

  // 频率控制: 同一小时内不需要每 5 分钟写一次
  if (!shouldPersist(KEY_HOURLY)) return;

  const list = load<HourlySnapshot[]>(KEY_HOURLY, []);
  const idx = list.findIndex(x => x.time === hour);
  if (idx >= 0) {
    // 同一小时价格没变化，不写
    if (list[idx].price === price) return;
    list[idx].price = price;
  } else {
    list.push({ time: hour, price });
  }
  const trimmed = list.slice(-48);
  persistThrottled(KEY_HOURLY, trimmed);
}

/** 追加每日快照 (月度/年度波动用) — 每天调用一次 */
export function appendDailySnapshot(price: number): void {
  const today = new Date().toISOString().slice(0, 10);

  // 频率控制: 同一天不需要每 5 分钟写一次
  if (!shouldPersist(KEY_DAILY)) return;

  const list = load<HistoricalPrice[]>(KEY_DAILY, []);
  const idx = list.findIndex(x => x.date === today);
  if (idx >= 0) {
    // 同日价格没变化，不写
    if (list[idx].price === price) return;
    list[idx].price = price;
  } else {
    list.push({ date: today, price, source: 'local-daily' });
  }
  const trimmed = list.slice(-400);
  persistThrottled(KEY_DAILY, trimmed);
}

/** 更新月度快照 — 每次加载时刷新当月数据 */
export function updateMonthlySnapshot(price: number): void {
  const now = new Date();
  const month = now.toISOString().slice(0, 7); // YYYY-MM

  // 频率控制: 同一个月不需要每 5 分钟写一次
  if (!shouldPersist(KEY_MONTHLY)) return;

  const list = load<MonthlySnapshot[]>(KEY_MONTHLY, []);
  const idx = list.findIndex(x => x.month === month);

  if (idx >= 0) {
    const snap = list[idx];
    const oldHigh = snap.highPrice;
    const oldLow  = snap.lowPrice;
    const newHigh = Math.max(snap.highPrice, price);
    const newLow  = Math.min(snap.lowPrice, price);
    // count 上限防护: 超过 10000 截断，防止无限增长
    const count = Math.min(snap.count || 1, 10_000);
    const newAvg = (snap.avgPrice * count + price) / (count + 1);
    // 高低价和均价都没变化，跳过
    if (newHigh === oldHigh && newLow === oldLow && newAvg === snap.avgPrice) return;
    snap.highPrice = newHigh;
    snap.lowPrice  = newLow;
    snap.avgPrice  = newAvg;
    snap.count     = count + 1;
  } else {
    list.push({ month, avgPrice: price, highPrice: price, lowPrice: price, count: 1 });
  }
  const trimmed = list.slice(-60);
  persistThrottled(KEY_MONTHLY, trimmed);
}

// ---- 读取快照 ----

/** 获取近24小时价格点（日内波动） */
export function getIntradayData(): HourlySnapshot[] {
  const list = load<HourlySnapshot[]>(KEY_HOURLY, []);
  // 只取近24小时
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 13);
  return list
    .filter(x => x.time.slice(0, 13) >= cutoff)
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** 读取本地每日快照 (不再依赖FreeGoldAPI) */
export function getDailySnapshots(): HistoricalPrice[] {
  return load<HistoricalPrice[]>(KEY_DAILY, [])
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 获取月度快照 (年度波动用) */
export function getMonthlySnapshots(): MonthlySnapshot[] {
  return load<MonthlySnapshot[]>(KEY_MONTHLY, []);
}

// ---- 数据处理工具 ----

/** 从 Tmini 数据提取金价快照 */
export function extractGoldSnapshot(data: TminiResponse): GoldPriceSnapshot | null {
  if (!data || !Array.isArray(data.metals)) return null;
  let metal = data.metals.find(m => m.name === '今日金价' || m.name === '黄金价格');
  if (!metal) metal = data.metals.find(m => m.name.includes('伦敦金') || m.name.includes('现货'));
  if (!metal && data.metals.length > 0) metal = data.metals[0];
  if (!metal) return null;

  const cur  = parseFloat(metal.sell_price)  || 0;
  const open = parseFloat(metal.today_price) || 0;
  const high = parseFloat(metal.high_price)  || 0;
  const low  = parseFloat(metal.low_price)   || 0;
  const change = cur - open;

  return {
    currentPrice: cur,
    openPrice: open,
    highPrice: high,
    lowPrice: low,
    changeAmount: change,
    changePercent: open !== 0 ? (change / open) * 100 : 0,
    name: metal.name,
    unit: metal.unit,
    updatedAt: metal.updated,
    date: data.date,
  };
}

/** 筛选指定月份的日线数据 */
export function filterMonthData(data: HistoricalPrice[], year: number, month: number) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return data
    .filter(d => d && d.date && d.date.startsWith(prefix))
    .map(d => ({ date: d.date, price: d.price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 获取最近N天的日线数据 */
export function getRecentDailyData(data: HistoricalPrice[], days: number) {
  const validData = data.filter(d => d && d.date);
  const sorted = [...validData].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.slice(-days).map(d => ({ date: d.date, price: d.price }));
}

/**
 * 构建年度月线数据:
 *   1. 优先用 localMonthly (本月度高/低更精确, 由调用方预先读取)
 *   2. 从 monthly CSV 月均价补充历史月份
 *   3. 降级: 从 historicalData (本地每日快照) 聚合
 */
export function buildYearlyData(
  year: number,
  monthlyData: MonthlyGoldRecord[],
  dailyData: HistoricalPrice[],
  localMonthly: MonthlySnapshot[] = [],
): MonthlySnapshot[] {
  const result: MonthlySnapshot[] = [];

  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    // 先找本地快照 (有 high/low)
    const localSnap = localMonthly.find(x => x.month === month);
    if (localSnap) {
      result.push(localSnap);
      continue;
    }
    // 从 monthly CSV 获取月均价
    const csvRecord = monthlyData.find(x => x.date === month);
    if (csvRecord) {
      result.push({
        month,
        avgPrice: csvRecord.price,
        highPrice: csvRecord.price,
        lowPrice: csvRecord.price,
      });
      continue;
    }
    // 降级: 从本地每日快照聚合
    const prefix = `${month}-`;
    const monthPrices = dailyData
      .filter(d => d && d.date && d.date.startsWith(prefix))
      .map(d => d.price);
    if (monthPrices.length > 0) {
      result.push({
        month,
        avgPrice: monthPrices.reduce((a, b) => a + b, 0) / monthPrices.length,
        highPrice: Math.max(...monthPrices),
        lowPrice: Math.min(...monthPrices),
      });
    }
  }
  return result;
}

/** 获取可用年份列表 (monthly CSV + 本地快照) */
export function getAvailableYears(
  monthlyData: MonthlyGoldRecord[],
  dailyData: HistoricalPrice[],
): number[] {
  const years = new Set<number>();
  // 从 monthly CSV
  for (const item of monthlyData) {
    if (item && item.date) {
      const y = parseInt(item.date.substring(0, 4), 10);
      if (!isNaN(y)) years.add(y);
    }
  }
  // 从本地每日快照
  for (const item of dailyData) {
    if (item && item.date) {
      const y = parseInt(item.date.substring(0, 4), 10);
      if (!isNaN(y)) years.add(y);
    }
  }
  // 保证今年始终存在
  years.add(new Date().getFullYear());
  return Array.from(years).sort((a, b) => b - a);
}

/** 获取指定年份的可用月份 */
export function getAvailableMonths(
  monthlyData: MonthlyGoldRecord[],
  dailyData: HistoricalPrice[],
  year: number,
): number[] {
  const months = new Set<number>();
  const prefix = `${year}-`;
  // 从 monthly CSV
  for (const item of monthlyData) {
    if (item && item.date && item.date.startsWith(prefix)) {
      months.add(parseInt(item.date.substring(5, 7), 10));
    }
  }
  // 从本地每日快照
  for (const item of dailyData) {
    if (item && item.date && item.date.startsWith(prefix)) {
      months.add(parseInt(item.date.substring(5, 7), 10));
    }
  }
  if (months.size === 0) months.add(new Date().getMonth() + 1);
  return Array.from(months).sort((a, b) => b - a);
}

// ---- 遗留数据处理工具 ----

/** 提取指定年份的月均价列表 (用于年度走势图) */
export function getMonthlyPricesForYear(
  monthlyData: MonthlyGoldRecord[],
  year: number,
): { month: string; price: number }[] {
  const prefix = `${year}-`;
  return monthlyData
    .filter(r => r.date.startsWith(prefix))
    .map(r => ({ month: r.date, price: r.price }));
}

/** 计算年度统计 (从 monthly CSV) */
export function getYearlyStats(monthlyData: MonthlyGoldRecord[], year: number) {
  const prices = monthlyData
    .filter(r => r.date.startsWith(`${year}-`))
    .map(r => r.price);
  if (prices.length === 0) return null;
  return {
    year,
    avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
    highPrice: Math.max(...prices),
    lowPrice: Math.min(...prices),
    months: prices.length,
  };
}

/** 最近N年对比 (年表均值) */
export function getYearlyComparison(annualData: AnnualGoldRecord[], n: number) {
  return annualData.slice(-n);
}

/** 从 monthly CSV 获取最近N个月的均价 (用于日线数据不足时兜底) */
export function getRecentMonthlyData(
  monthlyData: MonthlyGoldRecord[],
  months: number,
): { date: string; price: number }[] {
  return monthlyData
    .slice(-months)
    .map(r => ({ date: r.date, price: r.price }));
}

/** 从 monthly CSV 获取指定月份的均价 */
export function getMonthAvgFromCsv(
  monthlyData: MonthlyGoldRecord[],
  year: number,
  month: number,
): number | null {
  const target = `${year}-${String(month).padStart(2, '0')}`;
  const record = monthlyData.find(r => r.date === target);
  return record ? record.price : null;
}

// ---- 清除缓存 ----
export function clearCache(): void {
  const keys = [KEY_TMINI, KEY_REALTIME, KEY_LEGACY];
  if (isZTools) {
    for (const k of keys) {
      try { db()?.removeItem(k); db()?.removeItem(`${k}_ts`); } catch { /* */ }
    }
  } else {
    for (const k of keys) { mem.delete(k); mem.delete(`${k}_ts`); }
  }
}

/** 清除所有快照（调试用）*/
export function clearAllSnapshots(): void {
  const keys = [KEY_HOURLY, KEY_DAILY, KEY_MONTHLY];
  if (isZTools) {
    for (const k of keys) {
      try { db()?.removeItem(k); } catch { /* */ }
    }
  } else {
    for (const k of keys) mem.delete(k);
  }
  // 重置写入频率计时器
  for (const k of keys) delete _lastPersistTime[k];
}
