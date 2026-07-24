import { useMemo } from 'react'
import type { TimeSeriesResult } from '../api/historyApi'

interface TrendChartProps {
  series: TimeSeriesResult | null
  target: string
  loading: boolean
}

const W = 600
const H = 180
const PAD = { top: 18, right: 14, bottom: 28, left: 44 }

/**
 * 纯 SVG 折线图 - 不引入第三方图表库，保持包体轻量
 */
export default function TrendChart({ series, target, loading }: TrendChartProps) {
  const { pathD, areaD, min, max, ticksY, xLabels, points } = useMemo(() => {
    if (!series || series.points.length === 0) {
      return {
        pathD: '',
        areaD: '',
        min: 0,
        max: 1,
        ticksY: [] as number[],
        xLabels: [] as { x: number; label: string }[],
        points: [] as { x: number; y: number; v: number; date: string }[],
      }
    }
    const pts = series.points
      .map((p) => ({ date: p.date, v: p.rates[target] }))
      .filter((x): x is { date: string; v: number } => typeof x.v === 'number')
    if (!pts.length) {
      return {
        pathD: '',
        areaD: '',
        min: 0,
        max: 1,
        ticksY: [] as number[],
        xLabels: [] as { x: number; label: string }[],
        points: [] as { x: number; y: number; v: number; date: string }[],
      }
    }
    let lo = Math.min(...pts.map((p) => p.v))
    let hi = Math.max(...pts.map((p) => p.v))
    if (lo === hi) {
      lo = lo - Math.abs(lo) * 0.01 - 0.0001
      hi = hi + Math.abs(hi) * 0.01 + 0.0001
    }
    // 留 6% padding
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad

    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const xScale = (i: number) => PAD.left + (innerW * i) / Math.max(1, pts.length - 1)
    const yScale = (v: number) =>
      PAD.top + innerH * (1 - (v - lo) / (hi - lo))

    const xy = pts.map((p, i) => ({
      x: xScale(i),
      y: yScale(p.v),
      v: p.v,
      date: p.date,
    }))

    const pathD = xy
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ')
    const areaD =
      `M${xy[0].x.toFixed(2)},${(PAD.top + innerH).toFixed(2)} ` +
      xy.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') +
      ` L${xy[xy.length - 1].x.toFixed(2)},${(PAD.top + innerH).toFixed(2)} Z`

    // Y 轴 4 个刻度
    const ticksY = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4)

    // X 轴：根据数据点数量动态生成标签索引，避免重叠
    const labelIdx =
      pts.length >= 3
        ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
        : pts.length === 2
        ? [0, 1]
        : [0]
    const xLabels = labelIdx.map((i) => ({
      x: xScale(i),
      label: pts[i]?.date.slice(5) ?? '',
    }))

    return { pathD, areaD, min: lo, max: hi, ticksY, xLabels, points: xy }
  }, [series, target])

  if (loading) {
    return (
      <div className="trend-loading" style={{ height: H }}>
        <span>加载中…</span>
      </div>
    )
  }
  if (!series || series.points.length === 0 || !pathD) {
    return (
      <div className="trend-empty" style={{ height: H }}>
        <span>暂无历史数据</span>
      </div>
    )
  }

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  return (
    <div className="trend-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="trend-svg"
        role="img"
        aria-label="汇率趋势折线图"
      >
        {/* Y 网格线 + 标签 */}
        {ticksY.map((t, i) => {
          const y = PAD.top + innerH * (1 - i / 4)
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                y1={y}
                x2={PAD.left + innerW}
                y2={y}
                className="trend-grid"
              />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" className="trend-axis">
                {t.toFixed(t >= 100 ? 2 : 4)}
              </text>
            </g>
          )
        })}

        {/* 区域填充 */}
        <path d={areaD} className="trend-area" />

        {/* 折线 */}
        <path d={pathD} className="trend-line" fill="none" />

        {/* 数据点 + 鼠标悬停 tooltip */}
        {points.map((p, i) => (
          <g key={i} className="trend-pt-group">
            <circle cx={p.x} cy={p.y} r={2.5} className="trend-pt" />
            <title>{`${p.date}: ${p.v}`}</title>
          </g>
        ))}

        {/* X 轴标签 */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={H - PAD.bottom + 16}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            className="trend-axis"
          >
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
