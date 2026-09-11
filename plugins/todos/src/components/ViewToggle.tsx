import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

interface ViewToggleProps {
  isExpanded: boolean;
  onToggle: () => void;
}

export function ViewToggle({ isExpanded, onToggle }: ViewToggleProps) {
  return (
    <div className="view-toggle">
      <button
        className="view-btn"
        onClick={onToggle}
        title={isExpanded ? '缩小' : '全屏'}
      >
        {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>
    </div>
  );
}
