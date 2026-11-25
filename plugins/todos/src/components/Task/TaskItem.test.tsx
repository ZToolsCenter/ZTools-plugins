import { render, screen, fireEvent } from '@testing-library/react';
import { TaskItem } from './TaskItem';
import { Task } from '../../types';

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Test Task',
  description: 'Test description',
  priority: 'medium',
  dates: ['2026-07-08'],
  status: 'todo',
  createdAt: '2026-07-01',
  updatedAt: '2026-07-01',
  ...overrides,
});

describe('TaskItem', () => {
  it('renders task title', () => {
    const task = createMockTask({ title: 'Buy groceries' });
    render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Buy groceries')).toBeInTheDocument();
  });

  it('renders task description when provided', () => {
    const task = createMockTask({ description: 'Milk and eggs' });
    render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Milk and eggs')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const task = createMockTask({ description: undefined });
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} />);
    expect(container.querySelector('.task-description')).toBeNull();
  });

  it('calls onComplete when checkbox is clicked', () => {
    const handleComplete = jest.fn();
    const task = createMockTask();
    render(<TaskItem task={task} onComplete={handleComplete} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(handleComplete).toHaveBeenCalledWith('1');
  });

  it('calls onDelete when delete button is clicked', () => {
    const handleDelete = jest.fn();
    const task = createMockTask();
    render(<TaskItem task={task} onComplete={() => {}} onDelete={handleDelete} />);
    fireEvent.click(screen.getByTitle('删除'));
    expect(handleDelete).toHaveBeenCalledWith('1');
  });

  it('marks checkbox as checked when task is done', () => {
    const task = createMockTask({ status: 'done' });
    render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('applies completed class when task is done', () => {
    const task = createMockTask({ status: 'done' });
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} />);
    expect(container.querySelector('.task-item')).toHaveClass('completed');
  });

  it('applies overdue class when isOverdue is true', () => {
    const task = createMockTask();
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} isOverdue />);
    expect(container.querySelector('.task-item')).toHaveClass('overdue');
  });

  it('applies today class when isToday is true', () => {
    const task = createMockTask();
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} isToday />);
    expect(container.querySelector('.task-item')).toHaveClass('today');
  });

  it('renders priority indicator with correct color', () => {
    const task = createMockTask({ priority: 'high' });
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} />);
    const indicator = container.querySelector('.priority-indicator');
    expect(indicator).toHaveStyle({ backgroundColor: '#EF4444' });
  });

  it('renders dates when showDates is true and task has dates', () => {
    const task = createMockTask({ dates: ['2026-07-08'] });
    render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} showDates />);
    expect(screen.getByText('7/8')).toBeInTheDocument();
  });

  it('does not render dates when showDates is false', () => {
    const task = createMockTask({ dates: ['2026-07-08'] });
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} showDates={false} />);
    expect(container.querySelector('.task-dates')).toBeNull();
  });

  it('does not render dates when task has no dates', () => {
    const task = createMockTask({ dates: [] });
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} showDates />);
    expect(container.querySelector('.task-dates')).toBeNull();
  });

  it('does not use native draggable', () => {
    const task = createMockTask();
    const { container } = render(<TaskItem task={task} onComplete={() => {}} onDelete={() => {}} />);
    const taskItem = container.querySelector('.task-item');
    expect(taskItem).not.toHaveAttribute('draggable');
  });
});
