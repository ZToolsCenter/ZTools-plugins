import React from 'react';
import { ArrowRight, CalendarMinus, Check, Pencil, Trash2, Undo2 } from 'lucide-react';
import './BottomLegend.css';

interface BottomLegendProps {
  onShowShortcuts: () => void;
  /** 拖拽中时扇形的实际语义，用来提示「取消完成 / 移除当天」这类变体 */
  dragHint?: {
    complete: 'complete' | 'undo';
    remove: 'delete' | 'unschedule';
  };
}

export function BottomLegend({ onShowShortcuts, dragHint }: BottomLegendProps) {
  const completeIsUndo = dragHint?.complete === 'undo';
  const removeIsUnschedule = dragHint?.remove === 'unschedule';

  return (
    <div className="bottom-legend">
      <div className="legend-item">
        <span className={`legend-icon complete ${completeIsUndo ? 'undo' : ''}`}>
          {completeIsUndo
            ? <Undo2 size={10} strokeWidth={2.5} />
            : <Check size={10} strokeWidth={2.5} />}
        </span>
        <span>{completeIsUndo ? '右上 取消完成' : '右上 完成'}</span>
      </div>
      <div className="legend-item">
        <span className={`legend-icon delete ${removeIsUnschedule ? 'unschedule' : ''}`}>
          {removeIsUnschedule
            ? <CalendarMinus size={10} strokeWidth={2.5} />
            : <Trash2 size={10} strokeWidth={2.5} />}
        </span>
        <span>{removeIsUnschedule ? '右下 移除当天' : '右下 删除'}</span>
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
