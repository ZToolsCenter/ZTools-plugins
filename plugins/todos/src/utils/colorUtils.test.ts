import { Task } from '../types';
import { getPriorityLabel, getRandomTaskColor, getStatusTaskColor, getTaskColor } from './colorUtils';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: '写周报',
    priority: 'medium',
    dates: [],
    status: 'todo',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('getRandomTaskColor', () => {
  it('should keep the same color for the same task id', () => {
    expect(getRandomTaskColor('task-1')).toBe(getRandomTaskColor('task-1'));
  });

  it('should spread different task ids across the palette', () => {
    const ids = Array.from({ length: 30 }, (_, index) => `task-${index}`);
    const colors = new Set(ids.map(id => getRandomTaskColor(id)));

    expect(colors.size).toBeGreaterThan(6);
  });

  it('should return a hex color', () => {
    expect(getRandomTaskColor('task-42')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('getStatusTaskColor', () => {
  it('should use the accent color for unfinished tasks', () => {
    expect(getStatusTaskColor(createTask({ dates: ['2999-01-01'] }))).toBe('#0F766E');
  });

  it('should use the danger color for overdue tasks', () => {
    expect(getStatusTaskColor(createTask({ dates: ['2000-01-01'] }))).toBe('#DC2626');
  });

  it('should mute completed tasks', () => {
    expect(getStatusTaskColor(createTask({ status: 'done' }))).toBe('#A8A29E');
  });
});

describe('getTaskColor', () => {
  it('should default to the per-task palette', () => {
    const task = createTask();
    expect(getTaskColor(task)).toBe(getRandomTaskColor(task.id));
  });

  it('should switch to status colors when asked', () => {
    const done = createTask({ status: 'done' });
    expect(getTaskColor(done, 'status')).toBe('#A8A29E');
    expect(getTaskColor(done, 'random')).toBe(getRandomTaskColor(done.id));
  });
});

describe('getPriorityLabel', () => {
  it('should map priorities to labels', () => {
    expect(getPriorityLabel('high')).toBe('高');
    expect(getPriorityLabel('medium')).toBe('中');
    expect(getPriorityLabel('low')).toBe('低');
  });
});
