import React from 'react';
import { useCalendar } from '../../hooks/useCalendar';
import { useAppContext } from '../../context/AppContext';
import { CalendarNav } from './CalendarNav';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import './Calendar.css';

interface CalendarViewProps {
  hoveredTaskId?: string | null;
  onHoverTask?: (taskId: string | null) => void;
  onSelectTask?: (taskId: string) => void;
}

export function CalendarView({ hoveredTaskId, onHoverTask, onSelectTask }: CalendarViewProps) {
  const { state, dispatch } = useAppContext();
  const { navigatePrev, navigateNext, goToToday, currentDate, viewMode } = useCalendar();

  const handleViewModeChange = (mode: 'week' | 'month') => {
    dispatch({ type: 'SET_VIEW_MODE', payload: { viewMode: mode } });
  };

  const handleDateClick = (date: string) => {
    dispatch({ type: 'SET_CURRENT_DATE', payload: { date } });
    dispatch({ type: 'SET_VIEW_MODE', payload: { viewMode: 'week' } });
  };

  return (
    <div className="calendar-view">
      <CalendarNav
        currentDate={currentDate}
        viewMode={viewMode}
        onPrev={navigatePrev}
        onNext={navigateNext}
        onToday={goToToday}
      />

      {viewMode === 'week' ? (
        <WeekView hoveredTaskId={hoveredTaskId} onHoverTask={onHoverTask} onSelectTask={onSelectTask} />
      ) : (
        <MonthView
          hoveredTaskId={hoveredTaskId}
          onHoverTask={onHoverTask}
          onSelectTask={onSelectTask}
          onDateClick={handleDateClick}
        />
      )}
    </div>
  );
}
