import React from 'react';
import { Task } from '../../types';
import { TaskChip } from '../Task/TaskChip';

interface DayCellProps {
  date: string;
  tasks: Task[];
  isToday: boolean;
  accentColor?: { primary: string; border: string };
  isCurrentMonth: boolean;
  isHoveredWeek?: boolean;
  dropTarget?: string | null;
  hoveredTaskId?: string | null;
  selectedTaskId?: string | null;
  onHoverTask?: (taskId: string | null) => void;
  onSelectTask?: (taskId: string) => void;
  onComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
  onRemoveDate?: (taskId: string, date: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const MAX_VISIBLE_TASKS = 2;

export function DayCell({ date, tasks, isToday, accentColor, isCurrentMonth, isHoveredWeek, dropTarget, hoveredTaskId, selectedTaskId, onHoverTask, onSelectTask, onComplete, onDelete, onDragStart, onDragEnd, onRemoveDate, onDragOver, onDragLeave, onDrop, onClick, onMouseEnter, onMouseLeave }: DayCellProps) {
  const dateObj = new Date(date);
  const dayNum = dateObj.getDate();
  const visibleTasks = tasks.slice(0, MAX_VISIBLE_TASKS);
  const hiddenTaskCount = tasks.length - visibleTasks.length;

  const handleRemove = (taskId: string) => {
    onRemoveDate?.(taskId, date);
  };

  return (
    <div
      className={`day-cell ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'other-month' : ''} ${dropTarget === date ? 'drag-over' : ''} ${isHoveredWeek ? 'hovered-week' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-date={date}
      style={isToday && accentColor ? {
        '--accent': accentColor.primary,
        '--accent-border': accentColor.border,
      } as React.CSSProperties : undefined}
    >
      <div className="cell-header">
        <span className={`cell-date ${isToday ? 'today' : ''}`}>{dayNum}</span>
      </div>
      <div className="cell-tasks">
        {visibleTasks.map(task => (
          <TaskChip
            key={task.id}
            task={task}
            isHighlighted={hoveredTaskId === task.id}
            onHover={onHoverTask}
            onSelect={onSelectTask}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onRemove={handleRemove}
            onComplete={onComplete}
          />
        ))}
        {hiddenTaskCount > 0 && (
          <span className="cell-more" title={`还有 ${hiddenTaskCount} 项任务`}>
            +{hiddenTaskCount}
          </span>
        )}
      </div>
    </div>
  );
}
