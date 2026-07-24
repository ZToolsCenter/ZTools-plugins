// 历史汇率区间接口 - 多渠道统一封装

import { getAdapter, getLatest, type TimeSeriesResult } from './exchangeApi'

export type { TimeSeriesResult }

export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

export async function getTimeSeries(
  from: string,
  to: string,
  startDate: string,
  endDate: string
): Promise<TimeSeriesResult> {
  const adp = getAdapter()
  if (!adp.timeSeries) {
    throw new Error('当前数据源不支持历史汇率')
  }
  return adp.timeSeries(from, to, startDate, endDate)
}

export async function getTimeSeriesSafe(
  from: string,
  to: string,
  startDate: string,
  endDate: string
): Promise<TimeSeriesResult> {
  try {
    return await getTimeSeries(from, to, startDate, endDate)
  } catch (e) {
    // 退化为单点 latest
    const latest = await getLatest(from, [to])
    return {
      amount: 1,
      base: from,
      startDate,
      endDate,
      points: [{ date: latest.date, rates: latest.rates }],
    }
  }
}

export interface SeriesStats {
  min: number
  max: number
  avg: number
  latest: number
  changePct: number
}

export function calcStats(
  points: { date: string; rates: Record<string, number> }[],
  target: string
): SeriesStats | null {
  if (!points.length) return null
  const values = points
    .map((p) => p.rates[target])
    .filter((v): v is number => typeof v === 'number')
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const sum = values.reduce((a, b) => a + b, 0)
  const avg = sum / values.length
  const latest = values[values.length - 1]
  const first = values[0]
  const changePct = first ? (latest - first) / first : 0
  return { min, max, avg, latest, changePct }
}

/** 判断当前数据源是否支持历史汇率 */
export function supportsHistory(): boolean {
  try {
    const adp = getAdapter()
    return !!adp.timeSeries
  } catch {
    return false
  }
}
