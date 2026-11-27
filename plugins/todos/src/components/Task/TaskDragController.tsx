import React, { useEffect, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useTasks } from '../../hooks/useTasks';
import { rememberDragStart } from '../../utils/dragUtils';
import './TaskDragController.css';

const DRAG_THRESHOLD = 6;
const SCROLL_EDGE = 40;
const SCROLL_STEP = 10;
const PREVIEW_OFFSET = 12;

interface DragSession {
  taskId: string;
  sourceEl: HTMLElement;
  /** 从日历的哪一天拖出；为 null 表示来自待办池 */
  sourceDate: string | null;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  started: boolean;
  previewEl: HTMLDivElement | null;
  rafId: number | null;
  lastDropDate: string | null;
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(handle: number) {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle);
  } else {
    window.clearTimeout(handle);
  }
}

function getSourceTitle(sourceEl: HTMLElement): string {
  const titleEl = sourceEl.querySelector('.task-title, .chip-title, .block-title');
  return titleEl?.textContent?.trim() || sourceEl.textContent?.trim() || '任务';
}

export function TaskDragController() {
  const { dispatch } = useAppContext();
  const { completeTask, deleteTask, addDateToTask, removeDateFromTask } = useTasks();
  const actionsRef = useRef({ completeTask, deleteTask, addDateToTask, removeDateFromTask });
  const sessionRef = useRef<DragSession | null>(null);

  actionsRef.current = { completeTask, deleteTask, addDateToTask, removeDateFromTask };

  useEffect(() => {
    const updatePreview = (session: DragSession, x: number, y: number) => {
      if (!session.previewEl) {
        return;
      }
      // 预览放在光标左上方，避开右侧的扇形操作区。
      session.previewEl.style.left = `${x - PREVIEW_OFFSET}px`;
      session.previewEl.style.top = `${y - PREVIEW_OFFSET}px`;
    };

    const updateDropTarget = (session: DragSession, x: number, y: number) => {
      const element = document.elementFromPoint(x, y) as HTMLElement | null;
      const dateEl = element?.closest('[data-date]') as HTMLElement | null;
      const date = dateEl?.getAttribute('data-date') || null;

      // 指针进入完成 / 删除按钮时隐藏跟随预览，避免遮住按钮本身。
      if (session.previewEl) {
        const dockTarget = element?.closest('[data-drag-target]');
        session.previewEl.style.opacity = dockTarget ? '0' : '0.95';
      }

      if (date !== session.lastDropDate) {
        session.lastDropDate = date;
        dispatch({
          type: 'SET_DRAG_STATE',
          // 拖拽过程中要一直带着来源日期，否则经过日期格子时会被清空。
          payload: { taskId: session.taskId, dropTarget: date, sourceDate: session.sourceDate },
        });
      }
    };

    const autoScroll = () => {
      const session = sessionRef.current;
      if (!session?.started) {
        return;
      }

      const element = document.elementFromPoint(session.lastX, session.lastY) as HTMLElement | null;
      const container = element?.closest(
        '.task-pool-content, .week-view, .month-grid'
      ) as HTMLElement | null;

      if (container) {
        const rect = container.getBoundingClientRect();
        if (session.lastY < rect.top + SCROLL_EDGE) {
          container.scrollTop -= SCROLL_STEP;
        } else if (session.lastY > rect.bottom - SCROLL_EDGE) {
          container.scrollTop += SCROLL_STEP;
        }
      }

      session.rafId = requestFrame(autoScroll);
    };

    const suppressNextClick = () => {
      const preventClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
      };
      document.addEventListener('click', preventClick, true);
      window.setTimeout(() => {
        document.removeEventListener('click', preventClick, true);
      }, 0);
    };

    const cleanupSession = (options: { clearState?: boolean; suppressClick?: boolean } = {}) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }

      if (session.rafId !== null) {
        cancelFrame(session.rafId);
      }

      try {
        session.sourceEl.releasePointerCapture(session.pointerId);
      } catch {
        // 元素可能已经被重新渲染，忽略即可。
      }

      session.previewEl?.remove();
      session.sourceEl.classList.remove('task-drag-source');
      document.body.classList.remove('task-dragging');

      if (options.clearState && session.started) {
        dispatch({ type: 'SET_DRAG_STATE', payload: { taskId: null, dropTarget: null } });
      }

      sessionRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleCancel);
      document.removeEventListener('keydown', handleKeyDown);

      if (options.suppressClick) {
        suppressNextClick();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }

      session.lastX = event.clientX;
      session.lastY = event.clientY;

      if (!session.started) {
        const dx = event.clientX - session.startX;
        const dy = event.clientY - session.startY;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
          return;
        }

        session.started = true;
        try {
          session.sourceEl.setPointerCapture(session.pointerId);
        } catch {
          // 某些环境不支持 pointer capture，不影响主流程。
        }
        rememberDragStart({ clientX: session.startX, clientY: session.startY });
        dispatch({
          type: 'SET_DRAG_STATE',
          payload: { taskId: session.taskId, dropTarget: null, sourceDate: session.sourceDate },
        });

        const preview = document.createElement('div');
        preview.className = 'task-drag-preview';
        preview.textContent = getSourceTitle(session.sourceEl);
        document.body.appendChild(preview);
        session.previewEl = preview;
        session.sourceEl.classList.add('task-drag-source');
        document.body.classList.add('task-dragging');
        session.rafId = requestFrame(autoScroll);
      }

      event.preventDefault();
      updatePreview(session, event.clientX, event.clientY);
      updateDropTarget(session, event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }

      if (!session.started) {
        cleanupSession();
        return;
      }

      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const dockTarget = element?.closest('[data-drag-target]') as HTMLElement | null;

      if (dockTarget) {
        const action = dockTarget.getAttribute('data-drag-target');
        if (action === 'complete') {
          actionsRef.current.completeTask(session.taskId);
        } else if (action === 'delete') {
          // 从日历拖出的任务只移除当天安排；从待办池拖出的才是整条删除。
          if (session.sourceDate) {
            actionsRef.current.removeDateFromTask(session.taskId, session.sourceDate);
          } else {
            actionsRef.current.deleteTask(session.taskId);
          }
        }
      } else {
        const dateEl = element?.closest('[data-date]') as HTMLElement | null;
        const date = dateEl?.getAttribute('data-date');
        if (date) {
          actionsRef.current.addDateToTask(session.taskId, date);
        }
      }

      cleanupSession({ clearState: true, suppressClick: true });
    };

    const handlePointerCancel = () => {
      cleanupSession({ clearState: true });
    };

    const handleCancel = () => {
      cleanupSession({ clearState: true });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cleanupSession({ clearState: true });
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false) {
        return;
      }

      if (sessionRef.current) {
        cleanupSession({ clearState: true });
      }

      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest('input, textarea, button, select, option, [contenteditable="true"]')) {
        return;
      }

      if (target.closest('.drag-action-dock')) {
        return;
      }

      const taskEl = target.closest('[data-task-id]') as HTMLElement | null;
      const taskId = taskEl?.getAttribute('data-task-id');
      if (!taskEl || !taskId) {
        return;
      }

      // 日历里的任务卡片都放在 [data-date] 单元格内，借此区分拖拽来源。
      const sourceDate = taskEl.closest('[data-date]')?.getAttribute('data-date') || null;

      sessionRef.current = {
        taskId,
        sourceEl: taskEl,
        sourceDate,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        started: false,
        previewEl: null,
        rafId: null,
        lastDropDate: null,
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
      window.addEventListener('blur', handleCancel);
      document.addEventListener('keydown', handleKeyDown);
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      cleanupSession({ clearState: true });
    };
  }, [dispatch]);

  return null;
}
