// 实时汇率接口 - 多渠道适配层
//
// 重要：OXR / 聚合 / 极速 / 阿里云 / 华为云 的免费层 base 固定为某种货币，
// 当用户请求的 from 不是固定 base 时，需要通过 USD/CNY 中转：
//   - OXR: base 固定 USD → 拉 USD->target 和 USD->from，再除算
//   - 国内 (base CNY): 拉 CNY->from 和 CNY->to，再除算

import { getProvider, loadConfig, type ProviderMeta } from './providers'

export interface LatestResult {
  base: string
  date: string
  rates: Record<string, number>
}

export interface TimeSeriesResult {
  amount: number
  base: string
  startDate: string
  endDate: string
  points: { date: string; rates: Record<string, number> }[]
}

// ─── 中转换算工具 ─────────────────────────────────────
// 已知 base->X 和 base->Y，求 X->Y = (base->Y) / (base->X)
function crossRate(baseRates: Record<string, number>, from: string, to: string): number | null {
  if (from === to) return 1
  // base 通常是固定货币（USD 或 CNY）
  const rTo = baseRates[to]
  const rFrom = baseRates[from]
  if (typeof rTo !== 'number' || typeof rFrom !== 'number') return null
  if (rFrom === 0) return null
  return rTo / rFrom
}

// ─── Open Exchange Rates ───────────────────────────────
// 免费层 base 固定为 USD，返回的 rates 都是 USD->X
interface OpenExchangeLatest {
  base: string
  date: string
  rates: Record<string, number>
}

async function openexchangerate_fetch(key: string, base: string, symbols?: string[]): Promise<Record<string, number>> {
  const params = new URLSearchParams({ app_id: key })
  if (base) params.set('base', base)
  if (symbols && symbols.length) params.set('symbols', symbols.join(','))
  const res = await fetch(`https://openexchangerates.org/api/latest.json?${params}`)
  if (!res.ok) throw new Error(`OpenExchange HTTP ${res.status}`)
  const j: OpenExchangeLatest = await res.json()
  return j.rates || {}
}

async function openexchangerate_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const meta = getProvider('openexchangerate')!
  const fixedBase = meta.fixedBase || 'USD'
  // 需要的货币：from + 所有 to
  const needed = Array.from(new Set([from, ...(to || [])])).filter((c) => c !== fixedBase)
  const rates = await openexchangerate_fetch(key, fixedBase, needed)
  // 加上 fixedBase 自身
  rates[fixedBase] = 1
  // 中转：from -> targets
  const result: Record<string, number> = {}
  const targets = to && to.length ? to : Object.keys(rates)
  for (const t of targets) {
    if (t === from) {
      result[t] = 1
    } else {
      const r = crossRate(rates, from, t)
      if (r !== null) result[t] = r
    }
  }
  const date = new Date().toISOString().slice(0, 10)
  return { base: from, date, rates: result }
}

async function openexchangerate_series(
  key: string,
  from: string,
  to: string,
  startDate: string,
  endDate: string
): Promise<TimeSeriesResult> {
  const meta = getProvider('openexchangerate')!
  const fixedBase = meta.fixedBase || 'USD'
  const s = new Date(startDate)
  const e = new Date(endDate)
  const dates: string[] = []
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10))
  }

  const promises = dates.map(async (date) => {
    const params = new URLSearchParams({ app_id: key, base: fixedBase, symbols: `${from},${to}` })
    try {
      const res = await fetch(`https://openexchangerates.org/api/historical/${date}.json?${params}`)
      if (!res.ok) return null
      const j: OpenExchangeLatest = await res.json()
      const r = crossRate(j.rates, from, to)
      return r !== null ? { date, rates: { [to]: r } } : null
    } catch {
      return null
    }
  })

  const results = await Promise.all(promises)
  const points: TimeSeriesResult['points'] = results
    .filter((p): p is { date: string; rates: Record<string, number> } => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!points.length) throw new Error('OXR 历史数据为空')
  return { amount: 1, base: from, startDate, endDate, points }
}

// ─── ExchangeRate.host ─────────────────────────────────
interface ERHResponse {
  success: boolean
  error?: { code: number; info: string }
  base?: string
  date?: string
  rates?: Record<string, number> | Record<string, Record<string, number>>
}

async function exchangeratehost_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const params: Record<string, string> = { access_key: key, source: from }
  if (to && to.length) params.currencies = to.join(',')
  const res = await fetch('https://api.exchangerate.host/live?' + new URLSearchParams(params))
  if (!res.ok) throw new Error(`ERH HTTP ${res.status}`)
  const j: ERHResponse = await res.json()
  if (!j.success) throw new Error(j.error?.info || 'ERH 接口错误')
  const raw = j.rates || {}
  const flat: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith(from) && k.length === 6) {
      flat[k.slice(3)] = v as number
    }
  }
  return { base: j.base || from, date: j.date || new Date().toISOString().slice(0, 10), rates: flat }
}

async function exchangeratehost_series(
  key: string,
  from: string,
  to: string,
  startDate: string,
  endDate: string
): Promise<TimeSeriesResult> {
  const params = new URLSearchParams({
    access_key: key,
    source: from,
    currencies: to,
    start_date: startDate,
    end_date: endDate,
  })
  const res = await fetch(`https://api.exchangerate.host/timeframe?${params}`)
  if (!res.ok) throw new Error(`ERH 历史 HTTP ${res.status}`)
  const j: ERHResponse = await res.json()
  if (!j.success) throw new Error(j.error?.info || 'ERH 历史接口错误')
  const raw = j.rates as Record<string, Record<string, number>>
  const points = Object.keys(raw)
    .sort()
    .map((date) => {
      const pair = raw[date]
      const code = `${from}${to}`
      const v = pair[code]
      return { date, rates: typeof v === 'number' ? { [to]: v } : {} }
    })
    .filter((p) => Object.keys(p.rates).length)
  if (!points.length) throw new Error('ERH 历史为空')
  return { amount: 1, base: from, startDate, endDate, points }
}

// ─── Fixer.io ──────────────────────────────────────────
interface FixerResponse {
  success: boolean
  error?: { code: number; info: string }
  base: string
  date: string
  rates: Record<string, number> | Record<string, Record<string, number>>
  start_date?: string
  end_date?: string
}

async function fixer_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const params: Record<string, string> = { access_key: key, base: from }
  if (to && to.length) params.symbols = to.join(',')
  const res = await fetch('https://data.fixer.io/api/latest?' + new URLSearchParams(params))
  if (!res.ok) throw new Error(`Fixer HTTP ${res.status}`)
  const j: FixerResponse = await res.json()
  if (!j.success) throw new Error(j.error?.info || 'Fixer 接口错误')
  return { base: j.base, date: j.date, rates: j.rates as Record<string, number> }
}

async function fixer_series(
  key: string,
  from: string,
  to: string,
  startDate: string,
  endDate: string
): Promise<TimeSeriesResult> {
  const params = new URLSearchParams({
    access_key: key,
    base: from,
    symbols: to,
    start_date: startDate,
    end_date: endDate,
  })
  const res = await fetch(`https://data.fixer.io/api/timeframe?${params}`)
  if (!res.ok) throw new Error(`Fixer 历史 HTTP ${res.status}`)
  const j: FixerResponse = await res.json()
  if (!j.success) throw new Error(j.error?.info || 'Fixer 历史接口错误')
  const raw = j.rates as Record<string, Record<string, number>>
  const points = Object.keys(raw)
    .sort()
    .map((date) => ({ date, rates: raw[date] }))
    .filter((p) => Object.keys(p.rates).length)
  if (!points.length) throw new Error('Fixer 历史为空')
  return { amount: 1, base: from, startDate, endDate, points }
}

// ─── CurrencyAPI ───────────────────────────────────────
interface CAPILatest {
  meta?: { last_updated_at?: string }
  data?: Record<string, { code: string; value: number }>
}

interface CAPIRange {
  meta?: { last_updated_at?: string }
  data?: Record<string, Record<string, { code: string; value: number }>>
}

async function currencyapi_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const params: Record<string, string> = { apikey: key, base_currency: from }
  if (to && to.length) params.currencies = to.join(',')
  const res = await fetch('https://api.currencyapi.com/v3/latest?' + new URLSearchParams(params))
  if (!res.ok) throw new Error(`CurrencyAPI HTTP ${res.status}`)
  const j: CAPILatest = await res.json()
  const rates: Record<string, number> = {}
  if (j.data) {
    for (const [code, info] of Object.entries(j.data)) {
      rates[code] = info.value
    }
  }
  const date = j.meta?.last_updated_at ? j.meta.last_updated_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
  return { base: from, date, rates }
}

async function currencyapi_series(
  key: string,
  from: string,
  to: string,
  startDate: string,
  endDate: string
): Promise<TimeSeriesResult> {
  const params = new URLSearchParams({
    apikey: key,
    base_currency: from,
    currencies: to,
    datetime_start: `${startDate}T00:00:00Z`,
    datetime_end: `${endDate}T23:59:59Z`,
    accuracy: 'day',
  })
  const res = await fetch(`https://api.currencyapi.com/v3/range?${params}`)
  if (!res.ok) throw new Error(`CurrencyAPI 历史 HTTP ${res.status}`)
  const j: CAPIRange = await res.json()
  const raw = j.data || {}
  const points = Object.keys(raw)
    .sort()
    .map((dt) => {
      const day = dt.slice(0, 10)
      const inner = raw[dt]
      const v = inner?.[to]?.value
      return { date: day, rates: typeof v === 'number' ? { [to]: v } : {} }
    })
    .filter((p) => Object.keys(p.rates).length)
  if (!points.length) throw new Error('CurrencyAPI 历史为空')
  return { amount: 1, base: from, startDate, endDate, points }
}

// ─── 聚合数据 (base 固定 CNY) ──────────────────────────
// 接口: http://op.juhe.cn/onebank/exchange/query
// 返回 CNY 兑各货币的汇率
interface JuheResponse {
  resultcode: string
  reason: string
  result?: {
    list: Array<{ currency: string; name: string; fBuyPrice: string; fSellPrice: string; mBuyPrice: string; mSellPrice: string }>
  }
}

async function juhe_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const meta = getProvider('juhe')!
  const fixedBase = meta.fixedBase || 'CNY'
  const res = await fetch(`http://op.juhe.cn/onebank/exchange/query?key=${key}`)
  if (!res.ok) throw new Error(`聚合数据 HTTP ${res.status}`)
  const j: JuheResponse = await res.json()
  if (j.resultcode !== '200') throw new Error(j.reason || '聚合接口错误')
  const list = j.result?.list || []
  // 构造 fixedBase(CNY) -> X 的中间汇率，用现钞买入价 fBuyPrice
  const baseRates: Record<string, number> = {}
  baseRates[fixedBase] = 1
  for (const item of list) {
    // item.currency 形如 "美元 USD"
    const match = item.currency.match(/([A-Z]{3})/)
    if (match) {
      const code = match[1]
      const v = parseFloat(item.fBuyPrice)
      if (isFinite(v) && v > 0) {
        // 100 外币 = v 元人民币 → 1 外币 = v/100 CNY
        // 但 fixedBase 是 CNY，需要 CNY->X = 100/v
        baseRates[code] = 100 / v
      }
    }
  }
  // 中转到目标
  const result: Record<string, number> = {}
  const targets = to && to.length ? to : Object.keys(baseRates)
  for (const t of targets) {
    if (t === from) {
      result[t] = 1
    } else {
      const r = crossRate(baseRates, from, t)
      if (r !== null) result[t] = r
    }
  }
  return { base: from, date: new Date().toISOString().slice(0, 10), rates: result }
}

// ─── 极速数据 (base 固定 CNY) ──────────────────────────
// 接口: https://api.jisuapi.com/exchange/currency?appkey=KEY&currency=CNY
interface JisuResponse {
  status: string
  msg?: string
  result?: Array<{ currency: string; name: string; rate: string }>
}

async function jisu_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const meta = getProvider('jisu')!
  const fixedBase = meta.fixedBase || 'CNY'
  const res = await fetch(`https://api.jisuapi.com/exchange/currency?appkey=${key}&currency=${fixedBase}`)
  if (!res.ok) throw new Error(`极速数据 HTTP ${res.status}`)
  const j: JisuResponse = await res.json()
  if (j.status !== '0') throw new Error(j.msg || '极速接口错误')
  const list = j.result || []
  const baseRates: Record<string, number> = {}
  baseRates[fixedBase] = 1
  for (const item of list) {
    const code = item.currency
    const v = parseFloat(item.rate)
    if (isFinite(v) && v > 0) baseRates[code] = v
  }
  const result: Record<string, number> = {}
  const targets = to && to.length ? to : Object.keys(baseRates)
  for (const t of targets) {
    if (t === from) {
      result[t] = 1
    } else {
      const r = crossRate(baseRates, from, t)
      if (r !== null) result[t] = r
    }
  }
  return { base: from, date: new Date().toISOString().slice(0, 10), rates: result }
}

// ─── 阿里云市场 (base 固定 CNY) ────────────────────────
// 接口示例: https://exchange.market.alicloudapi.com/exchangeRate
// Header: Authorization:APPCODE <appcode>
interface AliyunResponse {
  showapi_res_code?: number
  showapi_res_error?: string
  showapi_res_body?: {
    list?: Array<{ name: string; code: string; rate: string }>
  }
}

async function aliyun_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const meta = getProvider('aliyun')!
  const fixedBase = meta.fixedBase || 'CNY'
  const res = await fetch('https://exchange.market.alicloudapi.com/exchangeRate', {
    headers: { Authorization: `APPCODE ${key}` },
  })
  if (!res.ok) throw new Error(`阿里云 HTTP ${res.status}`)
  const j: AliyunResponse = await res.json()
  if (j.showapi_res_code !== 0) throw new Error(j.showapi_res_error || '阿里云接口错误')
  const list = j.showapi_res_body?.list || []
  const baseRates: Record<string, number> = {}
  baseRates[fixedBase] = 1
  for (const item of list) {
    const v = parseFloat(item.rate)
    if (isFinite(v) && v > 0) baseRates[item.code] = v
  }
  const result: Record<string, number> = {}
  const targets = to && to.length ? to : Object.keys(baseRates)
  for (const t of targets) {
    if (t === from) {
      result[t] = 1
    } else {
      const r = crossRate(baseRates, from, t)
      if (r !== null) result[t] = r
    }
  }
  return { base: from, date: new Date().toISOString().slice(0, 10), rates: result }
}

// ─── 华为云市场 (base 固定 CNY) ────────────────────────
// 通用模板，与阿里云类似
async function huaweicloud_latest(key: string, from: string, to?: string[]): Promise<LatestResult> {
  const meta = getProvider('huaweicloud')!
  const fixedBase = meta.fixedBase || 'CNY'
  const res = await fetch('https://exchange.market.api.huaweicloud.com/v1/rate', {
    headers: { 'X-Auth-Token': key },
  })
  if (!res.ok) throw new Error(`华为云 HTTP ${res.status}`)
  const j = await res.json()
  const list: Array<{ code: string; rate: string }> = j.list || j.rates || []
  const baseRates: Record<string, number> = {}
  baseRates[fixedBase] = 1
  for (const item of list) {
    const v = parseFloat(item.rate)
    if (isFinite(v) && v > 0) baseRates[item.code] = v
  }
  const result: Record<string, number> = {}
  const targets = to && to.length ? to : Object.keys(baseRates)
  for (const t of targets) {
    if (t === from) {
      result[t] = 1
    } else {
      const r = crossRate(baseRates, from, t)
      if (r !== null) result[t] = r
    }
  }
  return { base: from, date: new Date().toISOString().slice(0, 10), rates: result }
}

// ─── 统一适配层 ────────────────────────────────────────

export interface ProviderAdapter {
  latest(from: string, to?: string[]): Promise<LatestResult>
  timeSeries?(from: string, to: string, startDate: string, endDate: string): Promise<TimeSeriesResult>
}

export function getAdapter(providerId?: string, apiKey?: string): ProviderAdapter {
  const cfg = loadConfig()
  const id = providerId || cfg.active
  const key = apiKey || cfg.keys[id]
  const meta: ProviderMeta | undefined = getProvider(id)
  if (!key || !key.trim()) {
    throw new Error(`未配置 ${meta?.name || id} 的 API Key`)
  }
  switch (id) {
    case 'openexchangerate':
      return {
        latest: (f, t) => openexchangerate_latest(key, f, t),
        timeSeries: (f, t, s, e) => openexchangerate_series(key, f, t, s, e),
      }
    case 'exchangeratehost':
      return {
        latest: (f, t) => exchangeratehost_latest(key, f, t),
        timeSeries: (f, t, s, e) => exchangeratehost_series(key, f, t, s, e),
      }
    case 'fixer':
      return {
        latest: (f, t) => fixer_latest(key, f, t),
        timeSeries: (f, t, s, e) => fixer_series(key, f, t, s, e),
      }
    case 'currencyapi':
      return {
        latest: (f, t) => currencyapi_latest(key, f, t),
        timeSeries: (f, t, s, e) => currencyapi_series(key, f, t, s, e),
      }
    case 'juhe':
      return { latest: (f, t) => juhe_latest(key, f, t) }
    case 'jisu':
      return { latest: (f, t) => jisu_latest(key, f, t) }
    case 'aliyun':
      return { latest: (f, t) => aliyun_latest(key, f, t) }
    case 'huaweicloud':
      return { latest: (f, t) => huaweicloud_latest(key, f, t) }
    default:
      throw new Error(`未知数据源: ${id}`)
  }
}

export async function getLatest(from: string, to?: string[]): Promise<LatestResult> {
  const adp = getAdapter()
  return adp.latest(from, to)
}

export async function testConnection(providerId: string, apiKey: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const adp = getAdapter(providerId, apiKey)
    const r = await adp.latest('USD', ['CNY'])
    if (r.rates && typeof r.rates['CNY'] === 'number') {
      return { ok: true, msg: `连接成功，1 USD = ${r.rates['CNY'].toFixed(4)} CNY` }
    }
    return { ok: false, msg: '接口返回但未找到 CNY 汇率，请检查 Key 或货币支持范围' }
  } catch (e: any) {
    return { ok: false, msg: e?.message || '连接失败' }
  }
}
