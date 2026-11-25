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

function TaskHarness() {
  const { dispatch } = useAppContext();

  useEffect(() => {
    dispatch({ type: 'ADD_TASK', payload: { workspace: 'work', task } });
  }, [dispatch]);

  return (
    <>
      <div data-task-id={task.id} className="task-item">
        <span className="task-title">{task.title}</span>
      </div>
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
      <span data-testid="task-status">{current?.status ?? 'missing'}</span>
      <span data-testid="task-dates">{current?.dates.join(',') ?? ''}</span>
    </>
  );
}

function renderHarness() {
  return render(
    <AppProvider>
      <TaskHarness />
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

function startDrag(from: number, to: number) {
  const taskEl = document.querySelector('.task-item') as HTMLElement;
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
