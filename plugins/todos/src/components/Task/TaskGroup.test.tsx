import { render, screen, fireEvent } from '@testing-library/react';
import { TaskGroup } from './TaskGroup';
import { Task } from '../../types';

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Test Task',
  priority: 'medium',
  dates: [],
  status: 'todo',
  createdAt: '2026-07-01',
  updatedAt: '2026-07-01',
  ...overrides,
});

describe('TaskGroup', () => {
  it('renders group title', () => {
    const tasks = [createMockTask()];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('renders task count', () => {
    const tasks = [createMockTask({ id: '1' }), createMockTask({ id: '2' })];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders all tasks in the list', () => {
    const tasks = [
      createMockTask({ id: '1', title: 'Task 1' }),
      createMockTask({ id: '2', title: 'Task 2' }),
    ];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
  });

  it('returns null when tasks array is empty', () => {
    const { container } = render(<TaskGroup title="Empty" tasks={[]} onComplete={() => {}} onDelete={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('hides tasks when collapsed', () => {
    const tasks = [createMockTask({ id: '1', title: 'Task 1' })];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} collapsed />);
    expect(screen.queryByText('Task 1')).not.toBeInTheDocument();
  });

  it('shows tasks when not collapsed', () => {
    const tasks = [createMockTask({ id: '1', title: 'Task 1' })];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} collapsed={false} />);
    expect(screen.getByText('Task 1')).toBeInTheDocument();
  });

  it('calls onToggleCollapse when header is clicked', () => {
    const onToggle = jest.fn();
    const tasks = [createMockTask({ id: '1', title: 'Task 1' })];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} onToggleCollapse={onToggle} />);
    
    fireEvent.click(screen.getByText('Today'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('applies collapsed class when collapsed', () => {
    const tasks = [createMockTask()];
    const { container } = render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} collapsed />);
    expect(container.querySelector('.task-group')).toHaveClass('collapsed');
  });

  it('shows arrow pointing right when collapsed', () => {
    const tasks = [createMockTask()];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} collapsed />);
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('shows arrow pointing down when expanded', () => {
    const tasks = [createMockTask()];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} collapsed={false} />);
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('passes onComplete to TaskItem', () => {
    const handleComplete = jest.fn();
    const tasks = [createMockTask({ id: '1' })];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={handleComplete} onDelete={() => {}} />);
    
    fireEvent.click(screen.getByRole('checkbox'));
    expect(handleComplete).toHaveBeenCalledWith('1');
  });

  it('passes onDelete to TaskItem', () => {
    const handleDelete = jest.fn();
    const tasks = [createMockTask({ id: '1' })];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={handleDelete} />);
    
    fireEvent.click(screen.getByTitle('删除'));
    expect(handleDelete).toHaveBeenCalledWith('1');
  });

  it('passes showDates to TaskItem', () => {
    const tasks = [createMockTask({ id: '1', dates: ['2026-07-08'] })];
    render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} showDates />);
    expect(screen.getByText('7/8')).toBeInTheDocument();
  });

  it('hides dates when showDates is false', () => {
    const tasks = [createMockTask({ id: '1', dates: ['2026-07-08'] })];
    const { container } = render(<TaskGroup title="Today" tasks={tasks} onComplete={() => {}} onDelete={() => {}} showDates={false} />);
    expect(container.querySelector('.task-dates')).toBeNull();
  });
});
