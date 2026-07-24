import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import { getLatest } from '../api/exchangeApi'
import {
  calcStats,
  daysAgo,
  getTimeSeriesSafe,
  isoDate,
  supportsHistory,
  type TimeSeriesResult,
} from '../api/historyApi'
import { getLastState, saveLastState } from '../api/storage'
import { getProvider, loadConfig } from '../api/providers'
import CurrencyPicker from './CurrencyPicker'
import SettingsPanel from './SettingsPanel'
import TrendChart from './TrendChart'

interface RateProps {
  enterAction: any
}

const DEFAULT_FROM = 'USD'
const DEFAULT_TO = 'CNY'

function formatNum(n: number, digits = 4): string {
  if (!isFinite(n)) return '-'
  const d = n >= 100 ? 2 : n >= 1 ? 4 : 6
  return n.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: Math.max(d, digits),
  })
}

export default function Rate({ enterAction }: RateProps) {
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const [amount, setAmount] = useState<string>('1')
  const [rate, setRate] = useState<number | null>(null)
  const [rateDate, setRateDate] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [series, setSeries] = useState<TimeSeriesResult | null>(null)
  const [seriesRange, setSeriesRange] = useState<7 | 30>(7)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesSupported, setSeriesSupported] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [providerId, setProviderId] = useState<string>(loadConfig().active)
  const [hasKey, setHasKey] = useState<boolean>(() => {
    const c = loadConfig()
    return !!(c.keys[c.active] && c.keys[c.active].trim())
  })

  const amountNum = useMemo(() => {
    const n = parseFloat(amount)
    return isFinite(n) && n > 0 ? n : 0
  }, [amount])

  const result = useMemo(() => (rate ? rate * amountNum : null), [rate, amountNum])

  // 刷新汇率 + 同步走势
  const refresh = useCallback(
    async (f: string, t: string, range: 7 | 30, withSeries: boolean) => {
      if (!hasKey) {
        setErr('请先在右上角设置中配置数据源 API Key')
        setRate(null)
        setSeries(null)
        return
      }
      if (f === t) {
        setRate(1)
        setRateDate(isoDate(new Date()))
        setErr('')
        if (withSeries) setSeries({ amount: 1, base: f, startDate: isoDate(daysAgo(range)), endDate: isoDate(new Date()), points: [{ date: isoDate(new Date()), rates: { [t]: 1 } }] })
        return
      }
      setLoading(true)
      if (withSeries) setSeriesLoading(true)
      setErr('')
      const end = isoDate(new Date())
      const start = isoDate(daysAgo(range))
      const tasks: Promise<any>[] = [getLatest(f, [t])]
      if (withSeries && supportsHistory()) {
        tasks.push(getTimeSeriesSafe(f, t, start, end))
      }
      const [data, seriesData] = await Promise.all(tasks)
      const r = data.rates[t]
      if (typeof r !== 'number') throw new Error('未返回目标货币汇率')
      setRate(r)
      setRateDate(data.date)
      if (withSeries && seriesData) setSeries(seriesData)
    },
    [hasKey]
  )

  const fetchRate = useCallback(
    async (f: string, t: string) => {
      try {
        await refresh(f, t, seriesRange, false)
      } catch (e: any) {
        setErr(e?.message || '获取汇率失败')
        setRate(null)
      } finally {
        setLoading(false)
      }
    },
    [hasKey, refresh, seriesRange]
  )

  const fetchSeries = useCallback(
    async (f: string, t: string, range: 7 | 30) => {
      if (!hasKey) {
        setSeries(null)
        return
      }
      setSeriesLoading(true)
      try {
        const end = isoDate(new Date())
        const start = isoDate(daysAgo(range))
        const s = await getTimeSeriesSafe(f, t, start, end)
        setSeries(s)
      } catch {
        setSeries(null)
      } finally {
        setSeriesLoading(false)
      }
    },
    [hasKey]
  )

  // 初始化（仅一次）- 用 ref 避免重复执行
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    setSeriesSupported(supportsHistory())
    const last = getLastState()
    const initFrom = last?.from || DEFAULT_FROM
    const initTo = last?.to || DEFAULT_TO
    const initAmount = last ? String(last.amount || 1) : '1'
    setFrom(initFrom)
    setTo(initTo)
    setAmount(initAmount)
    // 仅当有 Key 才拉取
    if (hasKey) {
      refresh(initFrom, initTo, seriesRange, true).catch((e: any) => {
        setErr(e?.message || '获取汇率失败')
        setRate(null)
      }).finally(() => {
        setLoading(false)
        setSeriesLoading(false)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切换货币时拉取
  const lastFromRef = useRef(from)
  const lastToRef = useRef(to)
  useEffect(() => {
    // 初始化时不触发（initRef 还是 false）
    if (!initRef.current) return
    if (from === lastFromRef.current && to === lastToRef.current) return
    lastFromRef.current = from
    lastToRef.current = to
    refresh(from, to, seriesRange, true).catch((e: any) => {
      setErr(e?.message || '获取汇率失败')
      setRate(null)
    }).finally(() => {
      setLoading(false)
      setSeriesLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, seriesRange])

  // 持久化保存上次状态（货币变化 + 金额变化）
  useEffect(() => {
    if (!initRef.current) return
    saveLastState({ from, to, amount: amountNum || 1 })
  }, [from, to, amountNum])

  // 切换时间范围 - 只刷走势
  useEffect(() => {
    if (!initRef.current) return
    fetchSeries(from, to, seriesRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesRange])

  const swap = () => {
    setFrom(to)
    setTo(from)
  }

  // 刷新按钮：同时拉汇率 + 走势
  const onRefresh = useCallback(() => {
    refresh(from, to, seriesRange, true).catch((e: any) => {
      setErr(e?.message || '获取汇率失败')
      setRate(null)
    }).finally(() => {
      setLoading(false)
      setSeriesLoading(false)
    })
  }, [from, to, seriesRange, refresh])

  const onSettingsSaved = useCallback(() => {
    const c = loadConfig()
    setProviderId(c.active)
    setSeriesSupported(supportsHistory())
    const hasK = !!(c.keys[c.active] && c.keys[c.active].trim())
    setHasKey(hasK)
    setShowSettings(false)
    // 延迟刷新：等弹窗关闭动画完成后再拉数据，避免 DOM 抖动
    if (hasK) {
      setTimeout(() => {
        refresh(from, to, seriesRange, true).catch((e: any) => {
          setErr(e?.message || '获取汇率失败')
          setRate(null)
        }).finally(() => {
          setLoading(false)
          setSeriesLoading(false)
        })
      }, 350)
    }
  }, [from, to, seriesRange, refresh])

  const onCloseSettings = useCallback(() => {
    setShowSettings(false)
  }, [])

  const stats = useMemo(() => {
    if (!series) return null
    return calcStats(series.points, to)
  }, [series, to])

  const provider = getProvider(providerId)

  // SVG 渐变定义（用于趋势图填充）
  const gradDefs = (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
        </linearGradient>
      </defs>
    </svg>
  )

  return (
    <div className="rate">
      {gradDefs}
      <div className="rate-inner">
        {/* 顶栏 */}
        <div className="rate-topbar">
          <div className="rate-topbar-brand">
            <div className="rate-topbar-logo">¥</div>
            <div className="rate-topbar-title">汇率换算</div>
          </div>
          <div className="rate-topbar-provider">
            {hasKey ? provider?.name : '未配置'} · {provider?.freeQuota}
          </div>
          <div className="rate-topbar-actions">
            <button
              className="rate-icon-btn"
              onClick={() => setShowSettings(true)}
              title="数据源设置"
              aria-label="数据源设置"
            >
              ⚙
            </button>
          </div>
        </div>

        {/* 未配置 Key 引导 */}
        {!hasKey && (
          <div className="rate-card rate-empty-cta">
            <div className="rate-empty-cta-icon">🔑</div>
            <div className="rate-empty-cta-title">配置数据源以开始使用</div>
            <div className="rate-empty-cta-desc">
              选择一个汇率数据服务商并填入 API Key，所有渠道均提供免费额度，注册即可获取。
            </div>
            <button
              className="rate-empty-cta-btn"
              onClick={() => setShowSettings(true)}
            >
              前往设置 →
            </button>
          </div>
        )}

        {/* 金额输入 */}
        <div className="rate-card rate-amount">
          <label>金额</label>
          <div className="rate-amount-input-wrap">
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="输入金额"
            />
            <span className="rate-amount-currency">{from}</span>
          </div>
          <div className="rate-amount-underline" />
        </div>

        {/* 货币选择行 */}
        <div className="rate-pair">
          <div className="rate-ccy rate-card">
            <CurrencyPicker value={from} onChange={setFrom} />
          </div>

          <button
            type="button"
            className="rate-swap"
            onClick={swap}
            title="交换货币"
            aria-label="交换货币"
          >
            ⇄
          </button>

          <div className="rate-ccy rate-card">
            <CurrencyPicker value={to} onChange={setTo} />
          </div>
        </div>

        {/* 结果展示 */}
        <div className="rate-card rate-result">
          <div className="rate-result-main">
            <span className="rate-result-amount">
              {result !== null ? formatNum(result) : '—'}
            </span>
            <span className="rate-result-ccy">{to}</span>
          </div>
          <div className="rate-result-sub">
            {rate !== null ? (
              <>
                1 {from} = {formatNum(rate)} {to}
                {rateDate && <span className="rate-date"> · {rateDate}</span>}
              </>
            ) : loading ? (
              '正在获取汇率…'
            ) : err ? (
              <span className="rate-error">{err}</span>
            ) : (
              '—'
            )}
          </div>
          <div className="rate-actions">
            <button
              className="rate-btn rate-btn-primary"
              onClick={onRefresh}
              disabled={loading || !hasKey}
            >
              {loading ? '刷新中…' : '刷新汇率'}
            </button>
          </div>
        </div>

        {/* 趋势图 */}
        {seriesSupported && (
          <div className="rate-card rate-trend">
            <div className="rate-trend-head">
              <span className="rate-trend-title">
                近 {seriesRange} 天 {from}/{to} 走势
              </span>
              <div className="rate-trend-tabs">
                <button
                  className={seriesRange === 7 ? 'active' : ''}
                  onClick={() => setSeriesRange(7)}
                >
                  7 天
                </button>
                <button
                  className={seriesRange === 30 ? 'active' : ''}
                  onClick={() => setSeriesRange(30)}
                >
                  30 天
                </button>
              </div>
            </div>

            {stats && (
              <div className="rate-stats">
                <div className="rate-stat">
                  <span className="lbl">最新</span>
                  <span className="val">{formatNum(stats.latest)}</span>
                </div>
                <div className="rate-stat">
                  <span className="lbl">区间最高</span>
                  <span className="val up">{formatNum(stats.max)}</span>
                </div>
                <div className="rate-stat">
                  <span className="lbl">区间最低</span>
                  <span className="val down">{formatNum(stats.min)}</span>
                </div>
                <div className="rate-stat">
                  <span className="lbl">区间均值</span>
                  <span className="val">{formatNum(stats.avg)}</span>
                </div>
                <div className="rate-stat">
                  <span className="lbl">区间涨跌</span>
                  <span className={`val ${stats.changePct >= 0 ? 'up' : 'down'}`}>
                    {stats.changePct >= 0 ? '+' : ''}
                    {(stats.changePct * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            <TrendChart series={series} target={to} loading={seriesLoading} />
          </div>
        )}

        <div className="rate-foot">
          数据来源：{provider?.name || '-'} · 仅供参考，不构成投资建议
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          onClose={onCloseSettings}
          onSaved={onSettingsSaved}
        />
      )}
    </div>
  )
}
