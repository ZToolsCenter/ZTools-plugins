import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Task } from '../../types';
import { TaskItem } from './TaskItem';
import { useTasks } from '../../hooks/useTasks';
import './Subtask.css';

interface TaskNodeProps {
  task: Task;
  subtasks: Task[];
  onComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
  showDates?: boolean;
  hoveredTaskId?: string | null;
  selectedTaskId?: string | null;
  onHoverTask?: (taskId: string | null) => void;
  onSelectTask?: (taskId: string) => void;
}

/**
 * 主任务 + 它的子任务。子任务本身是普通任务：
 * 用同一个 TaskItem 渲染，拖拽完成 / 删除、拖到日历排期、双击编辑、点击跳转都照旧。
 */
export function TaskNode({
  task,
  subtasks,
  onComplete,
  onDelete,
  showDates,
  hoveredTaskId,
  selectedTaskId,
  onHoverTask,
  onSelectTask,
}: TaskNodeProps) {
  const { addSubtask } = useTasks();
  const [isAdding, setIsAdding] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSubtasks = subtasks.length > 0;
  const doneCount = subtasks.filter(subtask => subtask.status === 'done').length;
  const showSubtaskList = isAdding || (hasSubtasks && !collapsed);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const commitAdd = () => {
    const title = value.trim();
    if (title) {
      addSubtask(task.id, title);
    }
    setValue('');
    inputRef.current?.focus();
  };

  return (
    <div className="task-node">
      <div className="task-parent">
        <TaskItem
          task={task}
          onComplete={onComplete}
          onDelete={onDelete}
          showDates={showDates}
          isHighlighted={hoveredTaskId === task.id}
          isSelected={selectedTaskId === task.id}
          onHover={onHoverTask}
          onSelect={onSelectTask}
          subtaskDone={hasSubtasks ? doneCount : undefined}
          subtaskTotal={hasSubtasks ? subtasks.length : undefined}
        />
        {/* 右侧两个入口二选一：没有子任务=添加，有子任务=展开/收起 */}
        <div className="task-parent-actions">
          {hasSubtasks ? (
            <button
              type="button"
              className={`subtask-toggle ${collapsed ? 'is-collapsed' : ''}`}
              title={collapsed ? '展开子任务' : '收起子任务'}
              aria-label={collapsed ? '展开子任务' : '收起子任务'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(previous => !previous)}
            >
              {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            !isAdding && (
              <button
                type="button"
                className="subtask-add-icon"
                title="添加子任务"
                aria-label="添加子任务"
                onClick={() => {
                  setCollapsed(false);
                  setIsAdding(true);
                }}
              >
                <Plus size={13} />
              </button>
            )
          )}
        </div>
      </div>

      {showSubtaskList && (
        <div className="subtask-list">
          {subtasks.map(subtask => (
            <TaskItem
              key={subtask.id}
              task={subtask}
              onComplete={onComplete}
              onDelete={onDelete}
              showDates={showDates}
              isHighlighted={hoveredTaskId === subtask.id}
              isSelected={selectedTaskId === subtask.id}
              onHover={onHoverTask}
              onSelect={onSelectTask}
            />
          ))}

          {isAdding ? (
            <input
              ref={inputRef}
              className="subtask-input"
              value={value}
              placeholder="子任务名称，回车添加，Esc 取消"
              onChange={event => setValue(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitAdd();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setValue('');
                  setIsAdding(false);
                }
              }}
              onBlur={() => {
                if (!value.trim()) {
                  setIsAdding(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="subtask-add"
              onClick={() => setIsAdding(true)}
            >
              <Plus size={12} /> 子任务
            </button>
          )}
        </div>
      )}
    </div>
  );
}
