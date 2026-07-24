import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  fetchRealtimeGoldPrice,
  fetchCurrentGoldUSD,
  fetchLegacyHistoricalData,
  extractGoldSnapshot,
  getDailySnapshots,
  appendHourlySnapshot,
  appendDailySnapshot,
  updateMonthlySnapshot,
  getIntradayData,
  getMonthlySnapshots,
  filterMonthData,
  getRecentDailyData,
  buildYearlyData,
  getAvailableMonths,
  getAvailableYears,
  getMonthlyPricesForYear,
  getYearlyStats,
  getYearlyComparison,
  getRecentMonthlyData,
  getMonthAvgFromCsv,
  clearCache,
  type GoldPriceSnapshot,
  type HistoricalPrice,
  type HourlySnapshot,
  type MonthlySnapshot,
  type LegacyHistoricalData,
  type StorePrice,
  type BankPrice,
  type RecyclePrice,
} from './services/goldApi';
import PriceCard from './components/PriceCard';
import FluctuationChart from './components/FluctuationChart';
import BrandTable from './components/BrandTable';
import './index.css';

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 分钟自动刷新

const isZTools = typeof window !== 'undefined' && Boolean((window as any).ztools);

type TabKey = 'today' | 'intraday' | 'month' | 'year';

const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'today',    label: '今日金价', icon: '💰' },
  { key: 'intraday', label: '日内波动', icon: '📈' },
  { key: 'month',    label: '月度走势', icon: '📅' },
  { key: 'year',     label: '年度走势', icon: '📆' },
];

export default function GoldPrice() {
  const [activeTab, setActiveTab]     = useState<TabKey>('today');
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdate, setLastUpdate]   = useState('');

  // 核心数据
  const [snapshot, setSnapshot]       = useState<GoldPriceSnapshot | null>(null);
  const [spotUSD, setSpotUSD]         = useState<number | null>(null);
  const [stores, setStores]           = useState<StorePrice[]>([]);
  const [banks, setBanks]             = useState<BankPrice[]>([]);
  const [recycle, setRecycle]         = useState<RecyclePrice[]>([]);
  const [historical, setHistorical]   = useState<HistoricalPrice[]>([]);

  // 遗留历史数据 (datasets/gold-prices)
  const [legacyData, setLegacyData]   = useState<LegacyHistoricalData | null>(null);

  // 月份/年份选择
  const now = new Date();
  const [selectedYear, setSelectedYear]   = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear2, setSelectedYear2] = useState(now.getFullYear());

  // 本地月度快照 (从 storage 读取，传给 buildYearlyData 以消除 useMemo 副作用)
  const [localMonthly, setLocalMonthly] = useState<MonthlySnapshot[]>([]);

  // 用于取消上一次未完成的请求并作为并发锁
  const abortRef = useRef<AbortController | null>(null);

  // 可用选项 (基于 monthly CSV + 本地每日快照)
  const monthlyLegacy = legacyData?.monthly ?? [];
  const availableYears = useMemo(
    () => getAvailableYears(monthlyLegacy, historical),
    [monthlyLegacy, historical],
  );
  const availableMonths = useMemo(
    () => getAvailableMonths(monthlyLegacy, historical, selectedYear),
    [monthlyLegacy, historical, selectedYear],
  );

  // 自动修正选中月份
  useEffect(() => {
    if (availableMonths.length > 0 && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  // ====== 加载数据 ======
  const loadData = useCallback(async (forceRefresh = false) => {
    // 如果上一次加载还没完成，取消它
    if (abortRef.current) {
      abortRef.current.abort();
    }

    // 创建新的 AbortController
    const controller = new AbortController();
    abortRef.current = controller;

    if (forceRefresh) clearCache();
    setError(null);

    try {
      // 并行请求: Tmini(RMB) + 实时USD + 遗留月/年历史（每个独立容错）
      const [tminiData, usdSpot, legacy] = await Promise.all([
        fetchRealtimeGoldPrice().catch((err) => {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          console.error('获取RMB金价失败:', err);
          return null;
        }),
        fetchCurrentGoldUSD().catch((err) => {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          console.error('获取USD金价失败:', err);
          return null;
        }),
        fetchLegacyHistoricalData().catch((err) => {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          console.error('获取遗留历史数据失败:', err);
          return null;
        }),
      ]);

      // 如果请求被取消，静默退出
      if (controller.signal.aborted) return;

      if (!tminiData && !usdSpot) {
        throw new Error('金价数据获取失败，请检查网络连接');
      }

      // 实时 RMB 数据
      if (tminiData) {
        const snap = extractGoldSnapshot(tminiData);
        setSnapshot(snap);
        setStores(tminiData.stores || []);
        setBanks(tminiData.banks  || []);
        setRecycle(tminiData.recycle || []);
      }

      // 实时 USD 数据
      if (usdSpot) {
        setSpotUSD(usdSpot.price);

        // 追加本地快照（用USD价格，内部已做去重和频率控制）
        const usdPrice = usdSpot.price;
        appendHourlySnapshot(usdPrice);
        appendDailySnapshot(usdPrice);
        updateMonthlySnapshot(usdPrice);
      }

      // 遗留月/年历史
      if (legacy) {
        setLegacyData(legacy);
      }

      // 本地每日快照 (不再依赖外部API)
      const daily = getDailySnapshots();
      setHistorical(daily);

      // 本地月度快照 (从 storage 读取，供 buildYearlyData 使用，消除 useMemo 副作用)
      setLocalMonthly(getMonthlySnapshots());

      setLastUpdate(new Date().toLocaleTimeString('zh-CN'));
      setLoading(false);

      console.log(
        `[金价] USD ${usdSpot ? `$${usdSpot.price.toFixed(2)}` : 'N/A'} | ` +
        `本地日快照 ${daily.length} 条 (${daily[0]?.date ?? 'N/A'}~${daily[daily.length - 1]?.date ?? 'N/A'}) | ` +
        `遗留 ${legacy?.monthly.length ?? 0} 月 / ${legacy?.annual.length ?? 0} 年`
      );
    } catch (err) {
      // AbortError 是正常的取消，不报错
      if (err instanceof DOMException && err.name === 'AbortError') return;

      const msg = err instanceof Error ? err.message : '加载失败';
      console.error('[金价]', msg);
      setError(msg);
      setLoading(false);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  // 首次加载
  useEffect(() => { loadData(); }, [loadData]);

  // 5分钟自动刷新
  useEffect(() => {
    const t = setInterval(() => loadData(), REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [loadData]);

  // ZTools 高度
  useEffect(() => {
    if (isZTools) (window as any).ztools.setExpendHeight?.(620);
  }, []);

  // 组件卸载时取消所有在途请求
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ====== 派生数据 ======

  /** 日内：近24小时小时快照 */
  const intradayData: HourlySnapshot[] = useMemo(
    () => getIntradayData(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastUpdate], // 每次刷新重算
  );

  /** 月度：近30天每日数据，CSV月均价兜底 */
  const last30Days = useMemo(() => {
    const daily = getRecentDailyData(historical, 30);
    if (daily.length >= 2) return daily;
    // 本地日快照不足，用 monthly CSV 最近30个月兜底
    return getRecentMonthlyData(monthlyLegacy, 30);
  }, [historical, monthlyLegacy]);

  /** 月度面板：选中月每日走势，CSV月均价兜底 */
  const monthData = useMemo(() => {
    const daily = filterMonthData(historical, selectedYear, selectedMonth);
    if (daily.length > 0) return daily;
    // 本地无日快照，用 monthly CSV 该月均价兜底
    const csvPrice = getMonthAvgFromCsv(monthlyLegacy, selectedYear, selectedMonth);
    return csvPrice !== null
      ? [{ date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`, price: csvPrice }]
      : [];
  }, [historical, monthlyLegacy, selectedYear, selectedMonth]);

  /** 年度：指定年份12个月数据 (monthly CSV + 本地快照) */
  const yearData: MonthlySnapshot[] = useMemo(
    () => buildYearlyData(selectedYear2, monthlyLegacy, historical, localMonthly),
    [monthlyLegacy, historical, selectedYear2, localMonthly],
  );

  /** 历年对比 (最近10年) */
  const yearlyCompare = useMemo(
    () => legacyData ? getYearlyComparison(legacyData.annual, 10) : [],
    [legacyData],
  );

  // ====== 面板渲染 ======

  const renderTodayPanel = () => (
    <div className="gold-today-panel">
      {snapshot && <PriceCard snapshot={snapshot} spotUSD={spotUSD} />}
      {stores.length > 0 && (
        <div className="gold-section">
          <h3 className="gold-section-title">品牌金店饰品</h3>
          <BrandTable
            columns={['品牌', '产品', '售价']}
            data={stores.map(s => [s.brand, s.product || '黄金饰品', s.formatted || `${s.price}${s.unit}`])}
          />
        </div>
      )}
      {banks.length > 0 && (
        <div className="gold-section">
          <h3 className="gold-section-title">银行投资金条</h3>
          <BrandTable
            columns={['银行', '产品', '售价', '报价时间']}
            data={banks.map(b => [b.bank, b.product, b.formatted || `${b.price}${b.unit}`, b.time || '--'])}
          />
        </div>
      )}
      {recycle.length > 0 && (
        <div className="gold-section">
          <h3 className="gold-section-title">黄金回收参考价</h3>
          <BrandTable
            columns={['品种', '纯度', '回收价']}
            data={recycle.slice(0, 8).map(r => [r.type, r.purity, r.formatted || `${r.price}${r.unit}`])}
          />
        </div>
      )}
    </div>
  );

  const renderIntradayPanel = () => {
    // 日内图数据: 优先用小时快照，没有则用 snapshot OHLC 构造简单4点
    const chartData = intradayData.length >= 2
      ? intradayData.map(x => ({
          time: x.time.slice(11, 16), // HH:MM
          price: x.price,
        }))
      : snapshot
        ? [
            { time: '开盘', price: snapshot.openPrice },
            { time: '最低', price: snapshot.lowPrice },
            { time: '最高', price: snapshot.highPrice },
            { time: '当前', price: snapshot.currentPrice },
          ].filter(x => x.price > 0)
        : [];

    const hasHourly = intradayData.length >= 2;

    return (
      <div className="gold-chart-panel">
        {/* OHLC 概览卡片 */}
        {snapshot && (
          <div className="gold-ohlc">
            <div className="gold-ohlc-title">
              当日 OHLC
              {snapshot.unit && <span className="gold-ohlc-unit">单位: {snapshot.unit}</span>}
            </div>
            <div className="gold-ohlc-grid">
              {[
                { label: '开盘', value: snapshot.openPrice,   cls: '' },
                { label: '最高', value: snapshot.highPrice,   cls: 'up' },
                { label: '最低', value: snapshot.lowPrice,    cls: 'down' },
                { label: '现价', value: snapshot.currentPrice, cls: snapshot.changeAmount >= 0 ? 'up' : 'down' },
              ].map(item => (
                <div className="gold-ohlc-item" key={item.label}>
                  <span className="gold-ohlc-label">{item.label}</span>
                  <span className={`gold-ohlc-value ${item.cls}`}>
                    {item.value > 0 ? item.value.toFixed(2) : '--'}
                  </span>
                </div>
              ))}
            </div>
            {/* 价格区间条 */}
            {snapshot.highPrice > snapshot.lowPrice && (
              <div className="gold-range-wrap">
                <span className="gold-range-bound">{snapshot.lowPrice.toFixed(2)}</span>
                <div className="gold-range-track">
                  <div
                    className="gold-range-fill"
                    style={{
                      width: `${((snapshot.currentPrice - snapshot.lowPrice) / (snapshot.highPrice - snapshot.lowPrice)) * 100}%`,
                    }}
                  />
                </div>
                <span className="gold-range-bound">{snapshot.highPrice.toFixed(2)}</span>
              </div>
            )}
            <div className="gold-ohlc-meta">
              <span>波动幅度 <b>{(snapshot.highPrice - snapshot.lowPrice).toFixed(2)}</b></span>
              <span>波动率 <b>{(((snapshot.highPrice - snapshot.lowPrice) / (snapshot.lowPrice || 1)) * 100).toFixed(2)}%</b></span>
            </div>
          </div>
        )}

        {/* 24小时价格走势图 */}
        {chartData.length >= 2 && (
          <div className="gold-chart-section">
            <h3 className="gold-section-title">
              {hasHourly ? '近24小时价格走势' : '当日价格区间'}
              <span className="gold-chart-subtitle">USD/盎司</span>
            </h3>
            {!hasHourly && (
              <p className="gold-hint">⏳ 数据累积中，每小时记录一个价格点，明天可看完整24小时曲线</p>
            )}
            <div className="gold-chart-container">
              <FluctuationChart
                data={chartData}
                dataKey="price"
                xKey="time"
                color="#d97706"
                unit="USD/oz"
                height={220}
              />
            </div>
          </div>
        )}

        {chartData.length < 2 && !snapshot && (
          <p className="gold-no-data">暂无日内数据，请稍后刷新</p>
        )}
      </div>
    );
  };

  const renderMonthPanel = () => {
    // 近30天 vs 当月数据: 用近30天作主图
    const displayData = last30Days.length > 0 ? last30Days : monthData;

    return (
      <div className="gold-chart-panel">
        <div className="gold-chart-section">
          <h3 className="gold-section-title">
            近30天价格走势
            <span className="gold-chart-subtitle">USD/盎司</span>
          </h3>
          {displayData.length > 0 ? (
            <div className="gold-chart-container">
              <FluctuationChart
                data={displayData}
                dataKey="price"
                xKey="date"
                color="#b45309"
                unit="USD/oz"
                height={240}
              />
            </div>
          ) : (
            <p className="gold-no-data">⏳ 数据累积中，每日记录一个价格点</p>
          )}
        </div>

        {/* 统计卡片 */}
        {displayData.length > 0 && (() => {
          const prices = displayData.map(d => d.price);
          const high = Math.max(...prices);
          const low  = Math.min(...prices);
          return (
            <div className="gold-stats">
              {[
                { label: '30日最高', value: high, cls: 'up' },
                { label: '30日最低', value: low,  cls: 'down' },
                { label: '30日均价', value: prices.reduce((a, b) => a + b, 0) / prices.length, cls: '' },
                { label: '最大波动', value: high - low, cls: '' },
              ].map(item => (
                <div className="gold-stat-item" key={item.label}>
                  <span className="gold-stat-label">{item.label}</span>
                  <span className={`gold-stat-value ${item.cls}`}>${item.value.toFixed(0)}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* 指定月份明细 */}
        <div className="gold-chart-section">
          <h3 className="gold-section-title">
            查看指定月份日线
            <div className="gold-period-selector">
              <select className="gold-select" value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
                {availableYears.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select className="gold-select" value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}>
                {availableMonths.map(m => <option key={m} value={m}>{monthNames[m - 1]}</option>)}
              </select>
            </div>
          </h3>
          {monthData.length > 0 ? (
            <div className="gold-chart-container">
              <FluctuationChart
                data={monthData}
                dataKey="price"
                xKey="date"
                color="#78716c"
                unit="USD/oz"
                height={200}
              />
            </div>
          ) : (
            <p className="gold-no-data">该月暂无日线数据</p>
          )}
        </div>
      </div>
    );
  };

  const renderYearPanel = () => {
    // 优先用 buildYearlyData，没有则提示
    const displayData = yearData;

    return (
      <div className="gold-chart-panel">
        <div className="gold-chart-section">
          <h3 className="gold-section-title">
            年度月线走势
            <span className="gold-chart-subtitle">USD/盎司 (月均)</span>
            <div className="gold-period-selector">
              <select className="gold-select" value={selectedYear2} onChange={e => setSelectedYear2(Number(e.target.value))}>
                {availableYears.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
          </h3>
          {displayData.length > 0 ? (
            <div className="gold-chart-container">
              <FluctuationChart
                data={displayData}
                dataKey="avgPrice"
                xKey="month"
                color="#b45309"
                unit="USD/oz"
                height={240}
                isMonthly
              />
            </div>
          ) : (
            <p className="gold-no-data">
              {selectedYear2 >= new Date().getFullYear()
                ? '⏳ 数据累积中，每月记录一次均价'
                : '该年度暂无数据'}
            </p>
          )}
        </div>

        {/* 年度统计 */}
        {displayData.length > 0 && (() => {
          const highs = displayData.map(d => d.highPrice);
          const lows  = displayData.map(d => d.lowPrice);
          const avgs  = displayData.map(d => d.avgPrice);
          return (
            <div className="gold-stats">
              {[
                { label: '年内最高', value: Math.max(...highs), cls: 'up' },
                { label: '年内最低', value: Math.min(...lows),  cls: 'down' },
                { label: '年均价格', value: avgs.reduce((a, b) => a + b, 0) / avgs.length, cls: '' },
                { label: '年度波幅', value: Math.max(...highs) - Math.min(...lows), cls: '' },
              ].map(item => (
                <div className="gold-stat-item" key={item.label}>
                  <span className="gold-stat-label">{item.label}</span>
                  <span className={`gold-stat-value ${item.cls}`}>${item.value.toFixed(0)}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/*
          历年均价对比
        */}
        {yearlyCompare.length > 1 && (
          <div className="gold-chart-section">
            <h3 className="gold-section-title">
              历年均价对比 (最近{yearlyCompare.length}年)
              <span className="gold-chart-subtitle">USD/盎司</span>
            </h3>
            <div className="gold-yearly-compare">
              {yearlyCompare.map(item => {
                const maxPrice = Math.max(...yearlyCompare.map(i => i.price));
                const pct = (item.price / maxPrice) * 100;
                return (
                  <div className="gold-yearly-row" key={item.year}>
                    <span className="gold-yearly-year">{item.year}</span>
                    <div className="gold-yearly-bar-wrap">
                      <div
                        className="gold-yearly-bar"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="gold-yearly-value">${item.price.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderContent = () => {
    if (loading && !snapshot) {
      return (
        <div className="gold-loading">
          <div className="gold-spinner" />
          <p>加载金价数据...</p>
        </div>
      );
    }
    switch (activeTab) {
      case 'today':    return renderTodayPanel();
      case 'intraday': return renderIntradayPanel();
      case 'month':    return renderMonthPanel();
      case 'year':     return renderYearPanel();
      default: return null;
    }
  };

  return (
    <div className="gold-price-container">
      {/* 顶栏 */}
      <div className="gold-header">
        <div className="gold-header-left">
          <h2 className="gold-title">每日金价</h2>
          {lastUpdate && (
            <span className="gold-update-time">
              更新于 {lastUpdate}
              <span className="gold-live-dot" />
            </span>
          )}
        </div>
        <button
          className="gold-refresh-btn"
          onClick={() => { setLoading(true); loadData(true); }}
          disabled={loading}
          title="强制刷新"
        >
          {loading ? '⏳' : '🔄'} 刷新
        </button>
      </div>

      {error && (
        <div className={`gold-error ${error.includes('缓存') ? 'gold-warning' : ''}`}>
          ⚠️ {error}
        </div>
      )}

      {/* Tab 导航 */}
      <div className="gold-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`gold-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="gold-tab-icon">{tab.icon}</span>
            <span className="gold-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="gold-content">
        {renderContent()}
      </div>

      {/* 底栏 */}
      <div className="gold-footer">
        <span>5分钟自动刷新</span>
      </div>
    </div>
  );
}
