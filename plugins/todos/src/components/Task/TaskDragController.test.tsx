import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TaskDragController } from './TaskDragController';
import { AppProvider, useAppContext } from '../../context/AppContext';
import { Task } from '../../types';

jest.mock('../../utils/storageUtils', () => ({
  loadData: jest.fn(() => null),
  saveData: jest.fn(),
  loadWorkspaceConfigs: jest.fn(() => [
    { id: 'work', name: '工作', colorScheme: 'teal', order: 0 },
  ]),
  saveWorkspaceConfigs: jest.fn(),
}));

const task: Task = {
  id: 'task-1',
  title: '写周报',
  priority: 'medium',
  dates: [],
  status: 'todo',
  createdAt: '2026-11-24',
  updatedAt: '2026-11-24',
};

// 同一条任务在两天都有安排，用来验证「从日历删除只移除当天」。
const scheduledTask: Task = {
  ...task,
  dates: ['2026-11-24', '2026-11-25'],
};

function TaskHarness({ task: taskProp = task, date }: { task?: Task; date?: string } = {}) {
  const { dispatch } = useAppContext();

  useEffect(() => {
    dispatch({ type: 'ADD_TASK', payload: { workspace: 'work', task: taskProp } });
  }, [dispatch, taskProp]);

  const item = (
    <div data-task-id={taskProp.id} className="task-item">
      <span className="task-title">{taskProp.title}</span>
    </div>
  );

  return (
    <>
      {date ? <div data-date={date} className="day-row">{item}</div> : item}
      <TaskDragController />
      <Inspector />
    </>
  );
}

function Inspector() {
  const { state } = useAppContext();
  const current = state.workspaces.work.find(item => item.id === task.id);

  return (
    <>
      <span data-testid="dragged-task">{state.draggedTaskId ?? 'null'}</span>
      <span data-testid="drag-source-date">{state.dragSourceDate ?? 'null'}</span>
      <span data-testid="task-status">{current?.status ?? 'missing'}</span>
      <span data-testid="task-dates">{current?.dates.join(',') ?? ''}</span>
    </>
  );
}

function renderHarness(options: { task?: Task; date?: string } = {}) {
  return render(
    <AppProvider>
      <TaskHarness {...options} />
    </AppProvider>
  );
}

type PointerInit = MouseEventInit & { pointerId?: number };

function dispatchPointer(type: string, target: EventTarget, init: PointerInit = {}) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    }));
  });
}

function startDrag(from: number, to: number, selector = '.task-item') {
  const taskEl = document.querySelector(selector) as HTMLElement;
  dispatchPointer('pointerdown', taskEl, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
  dispatchPointer('pointermove', window, { clientX: 20 + from, clientY: 20 + from, pointerId: 1 });
  dispatchPointer('pointermove', window, { clientX: 20 + to, clientY: 20 + to, pointerId: 1 });
}

function endDrag(target: HTMLElement | null) {
  const elementFromPoint = jest.fn(() => target);
  (document as any).elementFromPoint = elementFromPoint;
  dispatchPointer('pointerup', window, { button: 0, clientX: 200, clientY: 200, pointerId: 1 });
}

describe('TaskDragController', () => {
  const originalElementFromPoint = (document as any).elementFromPoint;

  beforeEach(() => {
    (document as any).elementFromPoint = jest.fn(() => null);
  });

  afterEach(() => {
    (document as any).elementFromPoint = originalElementFromPoint;
    document.body.querySelectorAll('.task-drag-preview').forEach(el => el.remove());
    document.body.classList.remove('task-dragging');
  });

  it('does not start a drag below the movement threshold', () => {
    renderHarness();

    const taskEl = document.querySelector('.task-item') as HTMLElement;
    dispatchPointer('pointerdown', taskEl, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    dispatchPointer('pointermove', window, { clientX: 24, clientY: 24, pointerId: 1 });
    dispatchPointer('pointerup', window, { button: 0, clientX: 24, clientY: 24, pointerId: 1 });

    expect(screen.getByTestId('dragged-task')).toHaveTextContent('null');
    expect(document.querySelector('.task-drag-preview')).toBeNull();
  });

  it('moves a task into the complete target on pointerup', async () => {
    const completeTarget = document.createElement('div');
    completeTarget.setAttribute('data-drag-target', 'complete');
    document.body.appendChild(completeTarget);

    renderHarness();
    startDrag(10, 40);

    await waitFor(() => {
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('task-1');
    });
    expect(document.querySelector('.task-drag-preview')).toBeTruthy();

    endDrag(completeTarget);

    await waitFor(() => {
      expect(screen.getByTestId('task-status')).toHaveTextContent('done');
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('null');
    });
    expect(document.querySelector('.task-drag-preview')).toBeNull();

    completeTarget.remove();
  });

  it('deletes a task when dropped on the delete target', async () => {
    const deleteTarget = document.createElement('div');
    deleteTarget.setAttribute('data-drag-target', 'delete');
    document.body.appendChild(deleteTarget);

    renderHarness();
    startDrag(10, 40);
    endDrag(deleteTarget);

    await waitFor(() => {
      expect(screen.getByTestId('task-status')).toHaveTextContent('missing');
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('null');
    });

    deleteTarget.remove();
  });

  it('deletes the whole task dropped from the pool even when it has dates', async () => {
    const deleteTarget = document.createElement('div');
    deleteTarget.setAttribute('data-drag-target', 'delete');
    document.body.appendChild(deleteTarget);

    renderHarness({ task: scheduledTask });
    startDrag(10, 40);
    endDrag(deleteTarget);

    await waitFor(() => {
      expect(screen.getByTestId('task-status')).toHaveTextContent('missing');
    });

    deleteTarget.remove();
  });

  it('removes only the dragged day when a calendar task is dropped on delete', async () => {
    const deleteTarget = document.createElement('div');
    deleteTarget.setAttribute('data-drag-target', 'delete');
    document.body.appendChild(deleteTarget);

    renderHarness({ task: scheduledTask, date: '2026-11-24' });
    startDrag(10, 40);
    await waitFor(() => {
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('task-1');
    });

    endDrag(deleteTarget);

    await waitFor(() => {
      expect(screen.getByTestId('task-dates')).toHaveTextContent('2026-11-25');
    });
    // 任务本身还在，只是不再排在这一天
    expect(screen.getByTestId('task-status')).toHaveTextContent('todo');
    expect(screen.getByTestId('task-dates')).not.toHaveTextContent('2026-11-24');

    deleteTarget.remove();
  });

  it('keeps the calendar source day while the pointer passes over date cells', async () => {
    const otherDate = document.createElement('div');
    otherDate.setAttribute('data-date', '2026-11-25');
    document.body.appendChild(otherDate);

    const deleteTarget = document.createElement('div');
    deleteTarget.setAttribute('data-drag-target', 'delete');
    document.body.appendChild(deleteTarget);

    renderHarness({ task: scheduledTask, date: '2026-11-24' });

    const chip = document.querySelector('[data-date="2026-11-24"] [data-task-id="task-1"]') as HTMLElement;
    (document as any).elementFromPoint = jest.fn(() => otherDate);
    dispatchPointer('pointerdown', chip, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    dispatchPointer('pointermove', window, { clientX: 30, clientY: 30, pointerId: 1 });
    dispatchPointer('pointermove', window, { clientX: 60, clientY: 60, pointerId: 1 });

    await waitFor(() => {
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('task-1');
    });
    // 经过别的日期格子后，来源日期仍要保留，否则操作区会误判为「删除任务」
    expect(screen.getByTestId('drag-source-date')).toHaveTextContent('2026-11-24');

    endDrag(deleteTarget);

    await waitFor(() => {
      expect(screen.getByTestId('task-dates')).toHaveTextContent('2026-11-25');
    });
    expect(screen.getByTestId('task-status')).toHaveTextContent('todo');

    otherDate.remove();
    deleteTarget.remove();
  });

  it('keeps a single-date task in the pool after deleting its calendar day', async () => {
    const deleteTarget = document.createElement('div');
    deleteTarget.setAttribute('data-drag-target', 'delete');
    document.body.appendChild(deleteTarget);

    renderHarness({ task: task, date: '2026-11-24' });
    startDrag(10, 40);
    endDrag(deleteTarget);

    await waitFor(() => {
      expect(screen.getByTestId('task-dates')).toHaveTextContent('');
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('null');
    });
    expect(screen.getByTestId('task-status')).toHaveTextContent('todo');

    deleteTarget.remove();
  });

  it('adds a date when dropped on a calendar cell', async () => {
    const dateTarget = document.createElement('div');
    dateTarget.setAttribute('data-date', '2026-11-24');
    document.body.appendChild(dateTarget);

    renderHarness();
    startDrag(10, 40);
    endDrag(dateTarget);

    await waitFor(() => {
      expect(screen.getByTestId('task-dates')).toHaveTextContent('2026-11-24');
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('null');
    });

    dateTarget.remove();
  });

  it('cancels without action when dropped outside any target', async () => {
    renderHarness();
    startDrag(10, 40);
    endDrag(null);

    await waitFor(() => {
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('null');
    });
    expect(screen.getByTestId('task-status')).toHaveTextContent('todo');
    expect(document.querySelector('.task-drag-preview')).toBeNull();
  });

  it('cancels with Escape', async () => {
    renderHarness();
    startDrag(10, 40);

    await waitFor(() => {
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('task-1');
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('dragged-task')).toHaveTextContent('null');
    });
    expect(screen.getByTestId('task-status')).toHaveTextContent('todo');
    expect(document.querySelector('.task-drag-preview')).toBeNull();
  });
});
