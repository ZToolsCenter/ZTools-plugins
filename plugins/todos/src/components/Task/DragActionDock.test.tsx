import React, { ReactNode, useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { DragActionDock } from './DragActionDock';
import { AppProvider, useAppContext } from '../../context/AppContext';
import { Task } from '../../types';
import { clearDragStartPoint, rememberDragStart } from '../../utils/dragUtils';

jest.mock('../../utils/storageUtils', () => ({
  loadData: jest.fn(() => null),
  saveData: jest.fn(),
  loadWorkspaceConfigs: jest.fn(() => [
    { id: 'work', name: '工作', colorScheme: 'teal', order: 0 },
  ]),
  saveWorkspaceConfigs: jest.fn(),
}));

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: '写周报',
    priority: 'medium',
    dates: [],
    status: 'todo',
    createdAt: '2026-11-24',
    updatedAt: '2026-11-24',
    ...overrides,
  };
}

function DraggingTask({ task, children }: { task: Task; children: ReactNode }) {
  const { dispatch } = useAppContext();

  useEffect(() => {
    dispatch({ type: 'ADD_TASK', payload: { workspace: 'work', task } });
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId: task.id, dropTarget: null } });
  }, [dispatch, task]);

  return <>{children}</>;
}

function renderWithDraggedTask(task: Task) {
  return render(
    <AppProvider>
      <DraggingTask task={task}>
        <DragActionDock />
      </DraggingTask>
    </AppProvider>
  );
}

function movePointer(clientX: number, clientY: number) {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
  });
}

describe('DragActionDock', () => {
  const originalElementFromPoint = (document as any).elementFromPoint;

  beforeEach(() => {
    clearDragStartPoint();
    (document as any).elementFromPoint = jest.fn(() => null);
  });

  afterEach(() => {
    (document as any).elementFromPoint = originalElementFromPoint;
  });

  it('does not render when no task is being dragged', () => {
    render(
      <AppProvider>
        <DragActionDock />
      </AppProvider>
    );

    expect(screen.queryByTestId('drag-action-dock')).not.toBeInTheDocument();
  });

  it('opens centered on the drag start point', async () => {
    rememberDragStart({ clientX: 300, clientY: 300 });
    renderWithDraggedTask(createTask());

    const dock = await screen.findByTestId('drag-action-dock');
    const complete = screen.getByTestId('drag-action-complete');
    const remove = screen.getByTestId('drag-action-delete');

    expect(dock).toHaveStyle({ left: '204px', top: '204px', width: '192px', height: '192px' });
    expect(complete.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(complete).toHaveAttribute('data-drag-target', 'complete');
    expect(remove).toHaveAttribute('data-drag-target', 'delete');
  });

  it('renders both sector icons while dragging', async () => {
    renderWithDraggedTask(createTask());

    expect(await screen.findByTestId('drag-action-dock')).toBeInTheDocument();
    expect(screen.getByTestId('drag-action-complete-label').querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('drag-action-delete-label').querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('drag-action-complete-label').textContent).toBe('');
    expect(screen.getByTestId('drag-action-delete-label').textContent).toBe('');
  });

  it('highlights the sector under the pointer', async () => {
    renderWithDraggedTask(createTask());
    const completeTarget = await screen.findByTestId('drag-action-complete');
    const deleteTarget = screen.getByTestId('drag-action-delete');

    (document as any).elementFromPoint = jest.fn(() => completeTarget);
    movePointer(150, 120);

    expect(completeTarget).toHaveClass('is-hovered');
    expect(screen.getByTestId('drag-action-complete-label')).toHaveClass('is-hovered');

    (document as any).elementFromPoint = jest.fn(() => deleteTarget);
    movePointer(150, 190);

    expect(completeTarget).not.toHaveClass('is-hovered');
    expect(deleteTarget).toHaveClass('is-hovered');
    expect(screen.getByTestId('drag-action-complete-label')).not.toHaveClass('is-hovered');
    expect(screen.getByTestId('drag-action-delete-label')).toHaveClass('is-hovered');

    (document as any).elementFromPoint = jest.fn(() => null);
    movePointer(20, 20);
    expect(deleteTarget).not.toHaveClass('is-hovered');
    expect(screen.getByTestId('drag-action-delete-label')).not.toHaveClass('is-hovered');
  });

  it('renders the ring for an already completed task', async () => {
    renderWithDraggedTask(createTask({ status: 'done' }));

    expect(await screen.findByTestId('drag-action-dock')).toBeInTheDocument();
  });
});
