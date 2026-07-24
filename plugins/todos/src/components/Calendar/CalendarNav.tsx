import React from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, LayoutList } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';

interface CalendarNavProps {
  currentDate: string;
  viewMode: 'week' | 'month';
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function CalendarNav({ currentDate, viewMode, onPrev, onNext, onToday }: CalendarNavProps) {
  const { state, dispatch } = useAppContext();
  const date = new Date(currentDate);
  let monthText = '';
  let yearText = '';

  if (viewMode === 'week') {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay() + 1);
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    monthText = monthNames[weekStart.getMonth()];
    yearText = String(weekStart.getFullYear());
  } else {
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    monthText = monthNames[date.getMonth()];
    yearText = String(date.getFullYear());
  }

  const handleTaskViewToggle = () => {
    const newMode = state.taskViewMode === 'tag' ? 'block' : 'tag';
    dispatch({ type: 'SET_TASK_VIEW_MODE', payload: { taskViewMode: newMode } });
  };

  return (
    <div className="cal-nav">
      <div className="cal-nav-left">
        <span className="cal-month">{monthText}</span>
        <span className="cal-year">{yearText}</span>
      </div>
      <div className="cal-nav-right">
        {viewMode === 'week' && (
          <button 
            className={`task-view-toggle ${state.taskViewMode}`}
            onClick={handleTaskViewToggle}
            title={state.taskViewMode === 'tag' ? '切换到详细视图' : '切换到紧凑视图'}
          >
            {state.taskViewMode === 'tag' ? (
              <LayoutList size={16} />
            ) : (
              <LayoutGrid size={16} />
            )}
          </button>
        )}
        <button className="nav-btn" onClick={onPrev} title="上一周">
          <ChevronLeft size={18} />
        </button>
        <button className="today-btn" onClick={onToday}>今天</button>
        <button className="nav-btn" onClick={onNext} title="下一周">
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
