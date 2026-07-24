import React, { useRef, useEffect } from 'react';
import { Task } from '../../types';
import { getTaskColor } from '../../utils/colorUtils';

interface TaskChipProps {
  task: Task;
  isHighlighted?: boolean;
  onHover?: (taskId: string | null) => void;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
  onRemove?: (taskId: string) => void;
  onComplete?: (taskId: string) => void;
  onSelect?: (taskId: string) => void;
}

export const TaskChip = React.memo(function TaskChip({
  task,
  isHighlighted,
  onHover,
  onDragStart,
  onDragEnd,
  onRemove,
  onComplete,
  onSelect
}: TaskChipProps) {
  const taskColor = getTaskColor(task.id);
  const chipRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ onComplete, onRemove });
  callbacksRef.current = { onComplete, onRemove };

  useEffect(() => {
    const chip = chipRef.current;
    if (!chip) return;

    let active = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2 || active) return;
      e.preventDefault();
      e.stopPropagation();
      active = true;

      const rect = chip.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const threshold = 40;

      const clone = chip.cloneNode(true) as HTMLDivElement;
      const bar = clone.querySelector('.priority-bar') as HTMLElement;
      const rootStyle = window.getComputedStyle(document.documentElement);
      const paperColor = rootStyle.getPropertyValue('--paper').trim();
      const chipBorderColor = rootStyle.getPropertyValue('--color-border-light').trim();
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
        borderColor: chipBorderColor,
        willChange: 'transform',
      });
      document.body.appendChild(clone);
      chip.style.opacity = '0.3';

      const actionLabel = document.createElement('div');
      actionLabel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;pointer-events:none;font-size:16px;font-weight:700;padding:12px 32px;white-space:nowrap;border-radius:10px;opacity:0;';
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
          clone.style.borderColor = chipBorderColor;
          if (bar) bar.style.background = taskColor;
        } else {
          clone.style.background = paperColor;
          clone.style.borderColor = chipBorderColor;
          clone.style.opacity = '1';
          clone.style.transform = `translate(${dx}px,${dy}px)`;
          if (bar) bar.style.background = taskColor;
        }

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
        const { onComplete, onRemove } = callbacksRef.current;

        if (dx > threshold && lastTrend !== 'left' && onComplete) onComplete(task.id);
        else if (dx < -threshold && lastTrend !== 'right' && onRemove) onRemove(task.id);

        clone.remove();
        actionLabel.remove();
        chip.style.opacity = '';
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
          chip.style.opacity = '';
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
        chip.style.opacity = '';
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

    chip.addEventListener('mousedown', onMouseDown);
    const onContextMenu = (e: Event) => { if (active) e.preventDefault(); };
    chip.addEventListener('contextmenu', onContextMenu);
    return () => {
      chip.removeEventListener('mousedown', onMouseDown);
      chip.removeEventListener('contextmenu', onContextMenu);
    };
  }, [task.id]);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(task.id);
  };

  return (
    <div
      ref={chipRef}
      data-task-id={task.id}
      className={`task-chip ${task.status === 'done' ? 'done' : ''} ${isHighlighted ? 'highlighted' : ''}`}
      style={{ '--task-color': taskColor } as React.CSSProperties}
      onClick={(e) => { if (e.button === 0) onSelect?.(task.id); }}
      onMouseEnter={() => onHover?.(task.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div
        className="chip-drag-area"
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
      >
        <span className="priority-bar"></span>
        <span className="chip-title">{task.title}</span>
      </div>
    </div>
  );
});
