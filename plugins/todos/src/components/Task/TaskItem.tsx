import React, { useRef, useEffect, useState } from 'react';
import { Task } from '../../types';
import { formatTaskDates } from '../../utils/taskUtils';
import { getTaskColor } from '../../utils/colorUtils';
import { useTasks } from '../../hooks/useTasks';
import './Task.css';

interface TaskItemProps {
  task: Task;
  onComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
  showDates?: boolean;
  isOverdue?: boolean;
  isToday?: boolean;
  isHighlighted?: boolean;
  isSelected?: boolean;
  onHover?: (taskId: string | null) => void;
  onSelect?: (taskId: string) => void;
}

export const TaskItem = React.memo(function TaskItem({
  task,
  onComplete,
  onDelete,
  onDragStart,
  onDragEnd,
  showDates = true,
  isOverdue = false,
  isToday = false,
  isHighlighted,
  isSelected,
  onHover,
  onSelect
}: TaskItemProps) {
  const { updateTask } = useTasks();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDescValue, setEditDescValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLTextAreaElement>(null);
  const lastClickRef = useRef(0);
  const suppressSelectRef = useRef(false);
  const suppressDescSelectRef = useRef(false);

  const taskColor = getTaskColor(task.id);
  const itemRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ onComplete, onDelete });
  callbacksRef.current = { onComplete, onDelete };

  const handleTitleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(task.title);
    setIsEditing(true);
  };

  const handleTitleClick = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastClickRef.current < 400) {
      suppressSelectRef.current = true;
    }
    lastClickRef.current = now;
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask(task.id, { title: trimmed });
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleDescDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditDescValue(task.description || '');
    setIsEditingDesc(true);
  };

  const handleDescClick = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastClickRef.current < 400) {
      suppressDescSelectRef.current = true;
    }
    lastClickRef.current = now;
  };

  const commitDescEdit = () => {
    const trimmed = editDescValue.trim();
    if (trimmed !== (task.description || '')) {
      updateTask(task.id, { description: trimmed || undefined });
    }
    setIsEditingDesc(false);
  };

  const cancelDescEdit = () => {
    setIsEditingDesc(false);
  };

  const handleDescKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelDescEdit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitDescEdit();
    }
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (isEditingDesc && descInputRef.current) {
      descInputRef.current.focus();
      descInputRef.current.select();
    }
  }, [isEditingDesc]);

  useEffect(() => {
    const item = itemRef.current;
    if (!item) return;

    let active = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2 || active) return;
      e.preventDefault();
      e.stopPropagation();
      active = true;

      const rect = item.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const threshold = 40;

      const clone = item.cloneNode(true) as HTMLDivElement;
      const bar = clone.querySelector('.priority-indicator') as HTMLElement;
      const rootStyle = window.getComputedStyle(document.documentElement);
      const paperColor = rootStyle.getPropertyValue('--paper').trim();
      const borderLight = rootStyle.getPropertyValue('--color-border-light').trim();
      if (bar) bar.style.background = taskColor;
      Object.assign(clone.style, {
        position: 'fixed',
        left: rect.x + 'px',
        top: rect.y + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
        zIndex: '9999',
        pointerEvents: 'none',
        margin: '0',
        background: paperColor,
        borderColor: borderLight,
        willChange: 'transform',
      });
      document.body.appendChild(clone);
      item.style.opacity = '0.3';

      const actionLabel = document.createElement('div');
      actionLabel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;pointer-events:none;font-size:16px;font-weight:700;padding:12px 32px;white-space:nowrap;border-radius:10px;opacity:0;background:red;color:white;';
      document.body.appendChild(actionLabel);

      const cloneLabel = document.createElement('div');
      cloneLabel.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;letter-spacing:1px;pointer-events:none;';
      clone.appendChild(cloneLabel);

      let raf: number | null = null;
      let pendingDx = 0;
      let pendingDy = 0;
      let lastTrend: 'left' | 'right' | null = null;

      const flush = () => {
        raf = null;
        const dx = pendingDx;
        const dy = pendingDy;

        const committedRight = dx > threshold;
        const committedLeft = dx < -threshold;

        // Determine label
        let label = '';
        let labelColor = '';
        let labelBg = '';
        let labelBorder = '';

        if (committedRight) {
          if (lastTrend === 'left') {
            label = '↩ 取消完成';
            labelColor = '#f59e0b';
            labelBg = 'rgba(245,158,11,0.15)';
            labelBorder = '1px solid rgba(245,158,11,0.3)';
          } else {
            label = '✓ 完成';
            labelColor = '#10b981';
            labelBg = 'rgba(16,185,129,0.15)';
            labelBorder = '1px solid rgba(16,185,129,0.3)';
          }
        } else if (committedLeft) {
          if (lastTrend === 'right') {
            label = '↩ 取消删除';
            labelColor = '#f59e0b';
            labelBg = 'rgba(245,158,11,0.15)';
            labelBorder = '1px solid rgba(245,158,11,0.3)';
          } else {
            label = '✕ 删除';
            labelColor = '#e11d48';
            labelBg = 'rgba(225,29,72,0.15)';
            labelBorder = '1px solid rgba(225,29,72,0.3)';
          }
        }

        const showLabel = !!label;

        // Clone visual based on dx (smooth)
        if (dx > 2) {
          const p = Math.min(dx / threshold, 1);
          clone.style.background = `rgba(16,185,129,${0.05 + p * 0.35})`;
          clone.style.borderColor = `rgba(16,185,129,${0.15 + p * 0.5})`;
          clone.style.opacity = '1';
          clone.style.transform = `translate(${dx}px,${dy}px)`;
          if (bar) bar.style.background = '#10b981';
        } else if (dx < -2) {
          const p = Math.min(-dx / threshold, 1);
          clone.style.opacity = String(1 - p * 0.3);
          clone.style.transform = `translate(${dx}px,${dy}px) scale(${1 - p * 0.1})`;
          clone.style.borderColor = borderLight;
          if (bar) bar.style.background = taskColor;
        } else {
          clone.style.background = paperColor;
          clone.style.borderColor = borderLight;
          clone.style.opacity = '1';
          clone.style.transform = `translate(${dx}px,${dy}px)`;
          if (bar) bar.style.background = taskColor;
        }

        // Labels
        actionLabel.textContent = label;
        actionLabel.style.opacity = showLabel ? '1' : '0';
        actionLabel.style.color = labelColor;
        actionLabel.style.background = labelBg;
        actionLabel.style.border = labelBorder;

        cloneLabel.textContent = label;
        cloneLabel.style.color = labelColor;
        cloneLabel.style.opacity = showLabel ? '1' : '0';
      };

      const onMouseMove = (e: MouseEvent) => {
        const newDx = e.clientX - startX;
        const delta = newDx - pendingDx;
        if (Math.abs(delta) > 5) {
          lastTrend = delta > 0 ? 'right' : 'left';
        }
        pendingDx = newDx;
        pendingDy = e.clientY - startY;
        if (raf === null) {
          raf = requestAnimationFrame(flush);
        }
      };

      const onMouseUp = (e: MouseEvent) => {
        if (raf !== null) cancelAnimationFrame(raf);
        const dx = e.clientX - startX;
        const { onComplete, onDelete } = callbacksRef.current;

        // Only fire if past threshold AND not reversing
        if (dx > threshold && lastTrend !== 'left' && onComplete) onComplete(task.id);
        else if (dx < -threshold && lastTrend !== 'right' && onDelete) onDelete(task.id);

        clone.remove();
        actionLabel.remove();
        item.style.opacity = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('mousedown', onCancelMouseDown);
        document.removeEventListener('keydown', onKeyDown);
        active = false;
      };

      const onCancelMouseDown = (e: MouseEvent) => {
        if (e.button !== 2) {
          e.preventDefault();
          e.stopPropagation();
          if (raf !== null) cancelAnimationFrame(raf);
          clone.remove();
          actionLabel.remove();
          item.style.opacity = '';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.removeEventListener('mousedown', onCancelMouseDown);
          document.removeEventListener('keydown', onKeyDown);
          active = false;
        }
      };

      const onKeyDown = (e: KeyboardEvent) => {
        e.preventDefault();
        if (raf !== null) cancelAnimationFrame(raf);
        clone.remove();
        actionLabel.remove();
        item.style.opacity = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('mousedown', onCancelMouseDown);
        document.removeEventListener('keydown', onKeyDown);
        active = false;
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('mousedown', onCancelMouseDown);
      document.addEventListener('keydown', onKeyDown);
    };

    item.addEventListener('mousedown', onMouseDown);
    const onContextMenu = (e: Event) => { if (active) e.preventDefault(); };
    item.addEventListener('contextmenu', onContextMenu);
    return () => {
      item.removeEventListener('mousedown', onMouseDown);
      item.removeEventListener('contextmenu', onContextMenu);
    };
  }, [task.id]);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(task.id);
  };

  return (
    <div
      ref={itemRef}
      data-task-id={task.id}
      className={`task-item ${task.status === 'done' ? 'completed' : ''} ${isOverdue ? 'overdue' : ''} ${isToday ? 'today' : ''} ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (e.button !== 0) return;
        if (suppressSelectRef.current) {
          suppressSelectRef.current = false;
          return;
        }
        onSelect?.(task.id);
      }}
      onMouseEnter={() => onHover?.(task.id)}
      onMouseLeave={() => onHover?.(null)}
      style={{ '--task-color': taskColor } as React.CSSProperties}
    >
      <div
        className="priority-indicator"
        style={{ backgroundColor: taskColor }}
      />
      <div className="task-content">
        {isEditing ? (
          <input
            ref={inputRef}
            className="task-title-input"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleInputKeyDown}
          />
        ) : (
          <span className="task-title" onClick={handleTitleClick} onDoubleClick={handleTitleDoubleClick}>{task.title}</span>
        )}
        {isEditingDesc ? (
          <textarea
            ref={descInputRef}
            className="task-desc-input"
            value={editDescValue}
            onChange={e => setEditDescValue(e.target.value)}
            onBlur={commitDescEdit}
            onKeyDown={handleDescKeyDown}
            rows={2}
          />
        ) : (
          <span
            className={`task-description ${!task.description ? 'empty' : ''}`}
            onClick={handleDescClick}
            onDoubleClick={handleDescDoubleClick}
          >
            {task.description || '添加描述...'}
          </span>
        )}
        {showDates && task.dates.length > 0 && (
          <div className="task-dates">
            {formatTaskDates(task.dates)}
          </div>
        )}
      </div>
    </div>
  );
});
