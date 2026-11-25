import React, { useCallback, useEffect, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { DragPoint, getDragStartPoint } from '../../utils/dragUtils';
import './DragActionDock.css';

type DropTarget = 'complete' | 'delete';

const OUTER_RADIUS = 96;
const CENTER_RADIUS = 30;
const SIZE = OUTER_RADIUS * 2;
const CENTER = OUTER_RADIUS;
const LABEL_RADIUS = (OUTER_RADIUS + CENTER_RADIUS) / 2;
const SECTOR_ANGLE = 72;
const COMPLETE_ANGLE = -SECTOR_ANGLE / 2;
const DELETE_ANGLE = SECTOR_ANGLE / 2;

function polar(radius: number, angleDeg: number) {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angle),
    y: CENTER + radius * Math.sin(angle),
  };
}

function pieSlicePath(startAngle: number, endAngle: number) {
  const outerStart = polar(OUTER_RADIUS, startAngle);
  const outerEnd = polar(OUTER_RADIUS, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;

  return [
    `M ${CENTER} ${CENTER}`,
    `L ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    'Z',
  ].join(' ');
}

const COMPLETE_PATH = pieSlicePath(-SECTOR_ANGLE, 0);
const DELETE_PATH = pieSlicePath(0, SECTOR_ANGLE);
const COMPLETE_LABEL = polar(LABEL_RADIUS, COMPLETE_ANGLE);
const DELETE_LABEL = polar(LABEL_RADIUS, DELETE_ANGLE);

function getInitialPoint(taskId: string): DragPoint {
  const remembered = getDragStartPoint();
  if (remembered) {
    return remembered;
  }

  const source = document.querySelector(`[data-task-id="${taskId}"]`);
  if (source) {
    const rect = source.getBoundingClientRect();
    return { x: rect.right, y: rect.top + rect.height / 2 };
  }

  return { x: window.innerWidth - 220, y: window.innerHeight / 2 };
}

export function DragActionDock() {
  const { state } = useAppContext();

  if (!state.draggedTaskId) {
    return null;
  }

  return <DragActionDockContent key={state.draggedTaskId} />;
}

function DragActionDockContent() {
  const { state } = useAppContext();
  const taskId = state.draggedTaskId as string;
  const draggedTask = (state.workspaces[state.currentWorkspace] || [])
    .find(task => task.id === taskId);
  const [hovered, setHovered] = useState<DropTarget | null>(null);
  const [position] = useState(() => {
    const point = getInitialPoint(taskId);
    return { left: point.x - OUTER_RADIUS, top: point.y - OUTER_RADIUS };
  });

  const updateHover = useCallback((x: number, y: number) => {
    if (typeof document.elementFromPoint !== 'function') {
      return;
    }

    const element = document.elementFromPoint(x, y) as Element | null;
    const targetEl = element?.closest('[data-drag-target]');
    const target = targetEl?.getAttribute('data-drag-target') as DropTarget | null;
    setHovered(prev => (prev === target ? prev : target));
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      updateHover(event.clientX, event.clientY);
    };

    document.addEventListener('pointermove', handlePointerMove, true);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove, true);
    };
  }, [updateHover]);

  if (!draggedTask) {
    return null;
  }

  return (
    <div
      className="drag-action-ring"
      data-testid="drag-action-dock"
      role="region"
      aria-label="任务拖拽操作区"
      style={{ left: position.left, top: position.top, width: SIZE, height: SIZE }}
    >
      <svg
        className="drag-action-ring__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <defs>
          <radialGradient
            id="drag-complete-gradient"
            gradientUnits="userSpaceOnUse"
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS}
          >
            <stop offset="0%" stopColor="#4F8F72" stopOpacity="0" />
            <stop offset="55%" stopColor="#4F8F72" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#4F8F72" stopOpacity="0.38" />
          </radialGradient>
          <radialGradient
            id="drag-complete-gradient-hover"
            gradientUnits="userSpaceOnUse"
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS}
          >
            <stop offset="0%" stopColor="#16A34A" stopOpacity="0.02" />
            <stop offset="55%" stopColor="#16A34A" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#16A34A" stopOpacity="0.78" />
          </radialGradient>
          <radialGradient
            id="drag-delete-gradient"
            gradientUnits="userSpaceOnUse"
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS}
          >
            <stop offset="0%" stopColor="#B06A6A" stopOpacity="0" />
            <stop offset="55%" stopColor="#B06A6A" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#B06A6A" stopOpacity="0.34" />
          </radialGradient>
          <radialGradient
            id="drag-delete-gradient-hover"
            gradientUnits="userSpaceOnUse"
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS}
          >
            <stop offset="0%" stopColor="#DC2626" stopOpacity="0.02" />
            <stop offset="55%" stopColor="#DC2626" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#DC2626" stopOpacity="0.68" />
          </radialGradient>
        </defs>

        <path
          className={`drag-action-ring__sector complete ${hovered === 'complete' ? 'is-hovered' : ''}`}
          data-testid="drag-action-complete"
          data-drag-target="complete"
          d={COMPLETE_PATH}
        />
        <path
          className={`drag-action-ring__sector delete ${hovered === 'delete' ? 'is-hovered' : ''}`}
          data-testid="drag-action-delete"
          data-drag-target="delete"
          d={DELETE_PATH}
        />
        <circle
          className="drag-action-ring__dead-zone"
          cx={CENTER}
          cy={CENTER}
          r={CENTER_RADIUS}
        />
      </svg>

      <div
        className={`drag-action-ring__label complete ${hovered === 'complete' ? 'is-hovered' : ''}`}
        data-testid="drag-action-complete-label"
        style={{ left: COMPLETE_LABEL.x, top: COMPLETE_LABEL.y }}
      >
        <Check size={18} strokeWidth={2.5} />
      </div>

      <div
        className={`drag-action-ring__label delete ${hovered === 'delete' ? 'is-hovered' : ''}`}
        data-testid="drag-action-delete-label"
        style={{ left: DELETE_LABEL.x, top: DELETE_LABEL.y }}
      >
        <Trash2 size={18} strokeWidth={2.5} />
      </div>
    </div>
  );
}
