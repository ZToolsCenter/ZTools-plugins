import React from 'react';
import { MousePointerClick, Pencil, ArrowRight } from 'lucide-react';
import './BottomLegend.css';

interface BottomLegendProps {
  onShowShortcuts: () => void;
}

export function BottomLegend({ onShowShortcuts }: BottomLegendProps) {
  return (
    <div className="bottom-legend">
      <div className="legend-item">
        <span className="legend-icon swipe-right">
          <MousePointerClick size={10} />
        </span>
        <span>右键右滑 完成</span>
      </div>
      <div className="legend-item">
        <span className="legend-icon swipe-left">
          <MousePointerClick size={10} />
        </span>
        <span>右键左滑 删除</span>
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
