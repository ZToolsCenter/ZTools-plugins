import React from 'react';

interface ViewToggleProps {
  viewMode: 'week' | 'month';
  onChange: (mode: 'week' | 'month') => void;
}

export function ViewToggle({ viewMode, onChange }: ViewToggleProps) {
  return (
    <div className="view-toggle" role="group" aria-label="日历视图">
      <button
        className={`view-btn ${viewMode === 'week' ? 'active' : ''}`}
        onClick={() => onChange('week')}
        aria-pressed={viewMode === 'week'}
        title="周视图"
      >
        周
      </button>
      <button
        className={`view-btn ${viewMode === 'month' ? 'active' : ''}`}
        onClick={() => onChange('month')}
        aria-pressed={viewMode === 'month'}
        title="月视图"
      >
        月
      </button>
    </div>
  );
}
