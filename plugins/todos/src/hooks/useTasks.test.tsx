import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { useTasks } from './useTasks';
import { AppProvider } from '../context/AppContext';
import { loadData } from '../utils/storageUtils';

jest.mock('../utils/storageUtils', () => ({
  loadData: jest.fn(),
  saveData: jest.fn(),
}));

const mockedLoadData = loadData as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

describe('useTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadData.mockReturnValue(null);
  });

  it('should add a task to current workspace', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task', 'Description');
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Test Task');
    expect(tasks[0].description).toBe('Description');
  });

  it('should add a task without description', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task');
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks[0].title).toBe('Test Task');
    expect(tasks[0].description).toBeUndefined();
  });

  it('should complete a task', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task');
    });

    const taskId = result.current.getCurrentTasks()[0].id;

    act(() => {
      result.current.completeTask(taskId);
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks[0].status).toBe('done');
  });

  it('should delete a task', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task');
    });

    const taskId = result.current.getCurrentTasks()[0].id;

    act(() => {
      result.current.deleteTask(taskId);
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks).toHaveLength(0);
  });

  it('should update a task', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task');
    });

    const taskId = result.current.getCurrentTasks()[0].id;

    act(() => {
      result.current.updateTask(taskId, { title: 'Updated Task', priority: 'high' });
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks[0].title).toBe('Updated Task');
    expect(tasks[0].priority).toBe('high');
  });

  it('should add date to task', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task');
    });

    const taskId = result.current.getCurrentTasks()[0].id;

    act(() => {
      result.current.addDateToTask(taskId, '2024-01-15');
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks[0].dates).toContain('2024-01-15');
  });

  it('should remove date from task', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task');
    });

    const taskId = result.current.getCurrentTasks()[0].id;

    act(() => {
      result.current.addDateToTask(taskId, '2024-01-15');
    });

    act(() => {
      result.current.removeDateFromTask(taskId, '2024-01-15');
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks[0].dates).not.toContain('2024-01-15');
  });

  it('should get current tasks', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Task 1');
      result.current.addTask('Task 2');
    });

    const tasks = result.current.getCurrentTasks();
    expect(tasks).toHaveLength(2);
  });

  it('should get task status by id', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    act(() => {
      result.current.addTask('Test Task');
    });

    const taskId = result.current.getCurrentTasks()[0].id;
    const status = result.current.getTaskStatusById(taskId);
    expect(status).toBe('todo');
  });

  it('should return null for non-existent task status', () => {
    const { result } = renderHook(() => useTasks(), { wrapper });

    const status = result.current.getTaskStatusById('non-existent-id');
    expect(status).toBeNull();
  });
});
