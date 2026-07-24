import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts';

interface FluctuationChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  dataKey: string;
  xKey: string;
  color: string;
  unit: string;
  height: number;
  isMonthly?: boolean;
}

export default function FluctuationChart({
  data,
  dataKey,
  xKey,
  color,
  unit,
  height,
  isMonthly = false,
}: FluctuationChartProps) {
  // 计算均值作为参考线
  const avgValue = useMemo(() => {
    if (data.length === 0) return 0;
    const sum = data.reduce((acc, d) => acc + (Number(d[dataKey]) || 0), 0);
    return sum / data.length;
  }, [data, dataKey]);

  // 格式化 X 轴标签
  const formatXLabel = (value: string) => {
    if (isMonthly) {
      // 月度显示 "1月" "2月" 等
      const parts = value.split('-');
      if (parts.length >= 2) {
        return `${parseInt(parts[1], 10)}月`;
      }
      return value;
    }
    // 日度显示 "MM-DD"
    const parts = value.split('-');
    if (parts.length >= 3) {
      return `${parts[1]}-${parts[2]}`;
    }
    return value;
  };

  // 自定义 Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const displayLabel = isMonthly
      ? (() => {
          const parts = label.split('-');
          return parts.length >= 2 ? `${parts[0]}年${parseInt(parts[1], 10)}月` : label;
        })()
      : label;

    return (
      <div className="gold-chart-tooltip">
        <p className="gold-tooltip-label">{displayLabel}</p>
        <p className="gold-tooltip-value" style={{ color }}>
          {unit}: {Number(payload[0].value).toFixed(2)}
        </p>
      </div>
    );
  };

  // 计算价格范围
  const prices = data.map((d) => Number(d[dataKey]) || 0);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 100;
  const padding = (maxPrice - minPrice) * 0.1 || 10;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
        <XAxis
          dataKey={xKey}
          tickFormatter={formatXLabel}
          tick={{ fontSize: 11, fill: '#999' }}
          axisLine={{ stroke: '#e8e8e8' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[minPrice - padding, maxPrice + padding]}
          tick={{ fontSize: 11, fill: '#999' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => v.toFixed(0)}
          width={50}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine
          y={avgValue}
          stroke="#999"
          strokeDasharray="5 5"
          strokeWidth={1}
          label={{
            value: `均值 ${avgValue.toFixed(0)}`,
            position: 'right',
            fontSize: 11,
            fill: '#999',
          }}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill="url(#goldGradient)"
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}