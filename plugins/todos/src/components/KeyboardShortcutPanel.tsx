import React from 'react';
import { MousePointerClick, Pencil, ArrowRight } from 'lucide-react';
import './KeyboardShortcutPanel.css';

interface KeyboardShortcutPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function KeyboardShortcutPanel({ visible, onClose }: KeyboardShortcutPanelProps) {
  if (!visible) return null;

  return (
    <div className="shortcut-panel-overlay" data-testid="shortcut-panel-overlay" onClick={onClose}>
      <div className="shortcut-panel" onClick={(e) => e.stopPropagation()}>
        <h3>操作指引</h3>
        <div className="shortcut-columns">
          <div className="shortcut-section">
            <h4>快捷键</h4>
            <div className="shortcut-item">
              <span className="shortcut-label">切换视图</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Ctrl</span>
                <span className="shortcut-key">E</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">搜索</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Ctrl</span>
                <span className="shortcut-key">F</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">清空搜索</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Esc</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">提交任务</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Ctrl</span>
                <span className="shortcut-key">Enter</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">操作指引</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">?</span>
              </div>
            </div>
          </div>
          <div className="shortcut-section">
            <h4>手势操作</h4>
            <div className="gesture-item">
              <div className="gesture-icon complete">
                <MousePointerClick size={12} />
              </div>
              <span className="gesture-label">右键右滑 → 完成</span>
            </div>
            <div className="gesture-item">
              <div className="gesture-icon delete">
                <MousePointerClick size={12} />
              </div>
              <span className="gesture-label">右键左滑 → 删除</span>
            </div>
            <div className="gesture-item">
              <div className="gesture-icon edit">
                <Pencil size={12} />
              </div>
              <span className="gesture-label">双击 → 编辑标题/描述</span>
            </div>
            <div className="gesture-item">
              <div className="gesture-icon drag">
                <ArrowRight size={12} />
              </div>
              <span className="gesture-label">拖拽 → 分配日期</span>
            </div>
          </div>
        </div>
        <div className="shortcut-panel-close">
          <button onClick={onClose}>关闭 (Esc)</button>
        </div>
      </div>
    </div>
  );
}
