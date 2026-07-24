import React from 'react';
import type { GoldPriceSnapshot } from '../services/goldApi';

interface PriceCardProps {
  snapshot: GoldPriceSnapshot;
  spotUSD?: number | null;
}

export default function PriceCard({ snapshot, spotUSD }: PriceCardProps) {
  const isUp = snapshot.changeAmount >= 0;
  const currencySymbol = snapshot.unit === '元/克' ? '¥' : '$';

  return (
    <div className="gold-price-card">
      <div className="gold-price-main">
        <div className="gold-price-header-row">
          <span className="gold-price-name">{snapshot.name}</span>
          <span className={`gold-price-trend ${isUp ? 'up' : 'down'}`}>
            {isUp ? '▲' : '▼'} {isUp ? '涨' : '跌'}
          </span>
        </div>
        <div className="gold-price-current">
          <span className="gold-price-symbol">{currencySymbol}</span>
          <span className="gold-price-value">{snapshot.currentPrice.toFixed(2)}</span>
          <span className="gold-price-unit">/{snapshot.unit.replace('元/', '')}</span>
        </div>
        {spotUSD != null && (
          <div className="gold-usd-row">
            ≈ $ {spotUSD.toFixed(2)} USD/盎司
          </div>
        )}
        <div className={`gold-price-change ${isUp ? 'up' : 'down'}`}>
          <span className="gold-change-amount">
            {isUp ? '+' : ''}{snapshot.changeAmount.toFixed(2)}
          </span>
          <span className="gold-change-percent">
            {isUp ? '+' : ''}{snapshot.changePercent.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="gold-price-details">
        <div className="gold-detail-item">
          <span className="gold-detail-label">今日开盘</span>
          <span className="gold-detail-value">{currencySymbol}{snapshot.openPrice.toFixed(2)}</span>
        </div>
        <div className="gold-detail-item">
          <span className="gold-detail-label">今日最高</span>
          <span className="gold-detail-value highlight-high">{currencySymbol}{snapshot.highPrice.toFixed(2)}</span>
        </div>
        <div className="gold-detail-item">
          <span className="gold-detail-label">今日最低</span>
          <span className="gold-detail-value highlight-low">{currencySymbol}{snapshot.lowPrice.toFixed(2)}</span>
        </div>
        <div className="gold-detail-item">
          <span className="gold-detail-label">更新时间</span>
          <span className="gold-detail-value">{snapshot.updatedAt}</span>
        </div>
      </div>
    </div>
  );
}
