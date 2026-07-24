import React, { useState, useMemo } from 'react';
import { useCalendar } from '../../hooks/useCalendar';
import { useTasks } from '../../hooks/useTasks';
import { useAppContext } from '../../context/AppContext';
import { DayCell } from './DayCell';
import { isToday } from '../../utils/dateUtils';
import { COLOR_SCHEMES } from '../../constants/colorSchemes';

interface MonthViewProps {
  hoveredTaskId?: string | null;
  onHoverTask?: (taskId: string | null) => void;
  onSelectTask?: (taskId: string) => void;
  onDateClick?: (date: string) => void;
}

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function MonthView({ hoveredTaskId, onHoverTask, onSelectTask, onDateClick }: MonthViewProps) {
  const { state, dispatch } = useAppContext();
  const { getCurrentMonth } = useCalendar();
  const { getCurrentTasks, completeTask, deleteTask, addDateToTask, removeDateFromTask } = useTasks();

  const accentColor = useMemo(() => {
    const config = state.workspaceConfigs.find(c => c.id === state.currentWorkspace);
    const scheme = config ? COLOR_SCHEMES.find(s => s.id === config.colorScheme) : undefined;
    const primary = scheme?.primary || '#0F766E';
    return { primary, border: hexToRgba(primary, 0.3) };
  }, [state.currentWorkspace, state.workspaceConfigs]);

  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const monthDays = getCurrentMonth();
  const tasks = getCurrentTasks();

  const handleDrop = (date: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      addDateToTask(taskId, date);
    }
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId: null, dropTarget: null } });
  };

  const handleDragOver = (date: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId: state.draggedTaskId, dropTarget: date } });
  };

  const handleDragLeave = (date: string, e: React.DragEvent) => {
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId: state.draggedTaskId, dropTarget: null } });
  };

  const handleDragStart = (taskId: string) => {
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId, dropTarget: null } });
  };

  const handleDragEnd = () => {
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId: null, dropTarget: null } });
  };

  const handleRemoveDate = (taskId: string, date: string) => {
    removeDateFromTask(taskId, date);
  };

  const handleMouseEnter = (date: string) => {
    setHoveredDate(date);
  };

  const handleMouseLeave = () => {
    setHoveredDate(null);
  };

  const getWeekStart = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(d);
    weekStart.setDate(diff);
    return weekStart.toISOString().split('T')[0];
  };

  const isSameWeek = (date1: string, date2: string) => {
    return getWeekStart(date1) === getWeekStart(date2);
  };

  return (
    <div className="month-view">
      <div className="month-header">
        {['一', '二', '三', '四', '五', '六', '日'].map(day => (
          <div key={day} className="header-cell">周{day}</div>
        ))}
      </div>
      <div className="month-grid">
        {monthDays.map(({ date, isCurrentMonth }) => {
          const dayTasks = tasks.filter(t => t.dates.includes(date) && t.status !== 'done');
          const isHoveredWeek = hoveredDate ? isSameWeek(date, hoveredDate) : false;
          return (
            <DayCell
              key={date}
              date={date}
              tasks={dayTasks}
              isToday={isToday(date)}
              accentColor={accentColor}
              isCurrentMonth={isCurrentMonth}
              dropTarget={state.dropTargetDate}
              hoveredTaskId={hoveredTaskId}
              selectedTaskId={state.selectedTaskId}
              isHoveredWeek={isHoveredWeek}
              onHoverTask={onHoverTask}
              onSelectTask={onSelectTask}
              onComplete={completeTask}
              onDelete={deleteTask}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onRemoveDate={handleRemoveDate}
              onDragOver={(e) => handleDragOver(date, e)}
              onDragLeave={(e) => handleDragLeave(date, e)}
              onDrop={(e) => handleDrop(date, e)}
              onClick={() => onDateClick?.(date)}
              onMouseEnter={() => handleMouseEnter(date)}
              onMouseLeave={handleMouseLeave}
            />
          );
        })}
      </div>
    </div>
  );
}
