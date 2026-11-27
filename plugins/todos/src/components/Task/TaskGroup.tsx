import React from 'react';
import { Task } from '../../types';
import { TaskNode } from './TaskNode';

interface TaskGroupProps {
  title: string;
  tasks: Task[];
  subtasksByParent?: Map<string, Task[]>;
  onComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  showDates?: boolean;
  hoveredTaskId?: string | null;
  selectedTaskId?: string | null;
  onHoverTask?: (taskId: string | null) => void;
  onSelectTask?: (taskId: string) => void;
}

export function TaskGroup({
  title,
  tasks,
  subtasksByParent,
  onComplete,
  onDelete,
  onDragStart,
  onDragEnd,
  collapsed = false,
  onToggleCollapse,
  showDates = true,
  hoveredTaskId,
  selectedTaskId,
  onHoverTask,
  onSelectTask
}: TaskGroupProps) {
  if (tasks.length === 0) {
    return null;
  }

  // Determine group type for styling
  const getGroupClass = () => {
    if (title === '逾期任务') return 'overdue-group';
    if (title === '今天的任务') return 'today-group';
    if (title === '本周任务') return 'week-group';
    if (title === '未安排任务') return 'unscheduled-group';
    if (title === '已完成任务') return 'completed-group';
    return '';
  };

  const groupClass = getGroupClass();

  return (
    <div className={`task-group ${collapsed ? 'collapsed' : ''} ${groupClass}`}>
      <div
        className="task-group-header"
        onClick={onToggleCollapse}
      >
        <span className="task-group-title">
          <span className="arrow">{collapsed ? '▶' : '▼'}</span>
          {title}
        </span>
        <span className="task-group-count">{tasks.length}</span>
      </div>
      {!collapsed && (
        <div className="task-group-list">
          {tasks.map(task => (
            <TaskNode
              key={task.id}
              task={task}
              subtasks={subtasksByParent?.get(task.id) ?? []}
              onComplete={onComplete}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              showDates={showDates}
              hoveredTaskId={hoveredTaskId}
              selectedTaskId={selectedTaskId}
              onHoverTask={onHoverTask}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}