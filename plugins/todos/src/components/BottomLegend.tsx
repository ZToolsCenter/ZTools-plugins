import React from 'react';
import { ArrowRight, Check, Pencil, Trash2 } from 'lucide-react';
import './BottomLegend.css';

interface BottomLegendProps {
  onShowShortcuts: () => void;
}

export function BottomLegend({ onShowShortcuts }: BottomLegendProps) {
  return (
    <div className="bottom-legend">
      <div className="legend-item">
        <span className="legend-icon complete">
          <Check size={10} strokeWidth={2.5} />
        </span>
        <span>右上 完成</span>
      </div>
      <div className="legend-item">
        <span className="legend-icon delete">
          <Trash2 size={10} strokeWidth={2.5} />
        </span>
        <span>右下 删除</span>
      </div>
      <div className="legend-item">
        <span className="legend-icon edit">
          <Pencil size={10} />
        </span>
        <span>双击编辑</span>
      </div>
      <div className="legend-item">
        <span className="legend-icon drag">
          <ArrowRight size={10} />
        </span>
        <span>拖拽分配日期</span>
      </div>
      <button className="legend-shortcut-btn" onClick={onShowShortcuts}>
        <span className="legend-key">?</span>
        <span>快捷键</span>
      </button>
    </div>
  );
}
