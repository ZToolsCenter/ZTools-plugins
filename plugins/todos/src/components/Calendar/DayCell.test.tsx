import { render, screen, fireEvent } from '@testing-library/react';
import { DayCell } from './DayCell';
import { Task } from '../../types';

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Test Task',
  priority: 'medium',
  dates: ['2026-07-08'],
  status: 'todo',
  createdAt: '2026-07-01',
  updatedAt: '2026-07-01',
  ...overrides,
});

describe('DayCell', () => {
  it('renders day number', () => {
    render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders today class on date when isToday is true', () => {
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={true}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    const cellDate = container.querySelector('.cell-date');
    expect(cellDate).toHaveClass('today');
  });

  it('applies today class on container when isToday is true', () => {
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={true}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(container.querySelector('.day-cell')).toHaveClass('today');
  });

  it('applies other-month class when not current month', () => {
    const { container } = render(
      <DayCell
        date="2026-06-30"
        tasks={[]}
        isToday={false}
        isCurrentMonth={false}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(container.querySelector('.day-cell')).toHaveClass('other-month');
  });

  it('renders up to 3 tasks', () => {
    const tasks = [
      createMockTask({ id: '1', title: 'Task 1', priority: 'high' }),
      createMockTask({ id: '2', title: 'Task 2', priority: 'medium' }),
      createMockTask({ id: '3', title: 'Task 3', priority: 'low' }),
      createMockTask({ id: '4', title: 'Task 4', priority: 'high' }),
    ];
    render(
      <DayCell
        date="2026-07-08"
        tasks={tasks}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
    expect(screen.getByText('Task 3')).toBeInTheDocument();
    expect(screen.queryByText('Task 4')).not.toBeInTheDocument();
  });

  it('shows more count when more than 3 tasks', () => {
    const tasks = [
      createMockTask({ id: '1', title: 'Task 1', priority: 'high' }),
      createMockTask({ id: '2', title: 'Task 2', priority: 'medium' }),
      createMockTask({ id: '3', title: 'Task 3', priority: 'low' }),
      createMockTask({ id: '4', title: 'Task 4', priority: 'high' }),
      createMockTask({ id: '5', title: 'Task 5', priority: 'medium' }),
    ];
    render(
      <DayCell
        date="2026-07-08"
        tasks={tasks}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('+2 更多')).toBeInTheDocument();
  });

  it('does not show more count when 3 or fewer tasks', () => {
    const tasks = [
      createMockTask({ id: '1', title: 'Task 1', priority: 'high' }),
      createMockTask({ id: '2', title: 'Task 2', priority: 'medium' }),
    ];
    render(
      <DayCell
        date="2026-07-08"
        tasks={tasks}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.queryByText(/更多/)).not.toBeInTheDocument();
  });

  it('applies priority class to cell tasks', () => {
    const tasks = [
      createMockTask({ id: '1', title: 'Task 1', priority: 'high' }),
    ];
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={tasks}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    const cellTask = container.querySelector('.cell-task');
    expect(cellTask).toHaveClass('high');
  });

  it('sets data-date attribute', () => {
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(container.querySelector('.day-cell')).toHaveAttribute('data-date', '2026-07-08');
  });

  it('calls onDragOver when dragging over', () => {
    const handleDragOver = jest.fn();
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
        onDragOver={handleDragOver}
      />
    );
    fireEvent.dragOver(container.querySelector('.day-cell')!);
    expect(handleDragOver).toHaveBeenCalledTimes(1);
  });

  it('calls onDrop when dropped on', () => {
    const handleDrop = jest.fn();
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
        onDrop={handleDrop}
      />
    );
    fireEvent.drop(container.querySelector('.day-cell')!);
    expect(handleDrop).toHaveBeenCalledTimes(1);
  });

  it('applies drag-over class when dropTarget matches date', () => {
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={false}
        isCurrentMonth={true}
        dropTarget="2026-07-08"
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(container.querySelector('.day-cell')).toHaveClass('drag-over');
  });

  it('does not apply drag-over class when dropTarget does not match date', () => {
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={false}
        isCurrentMonth={true}
        dropTarget="2026-07-09"
        onComplete={() => {}}
        onDelete={() => {}}
      />
    );
    expect(container.querySelector('.day-cell')).not.toHaveClass('drag-over');
  });

  it('calls onDragLeave when drag leaves', () => {
    const handleDragLeave = jest.fn();
    const { container } = render(
      <DayCell
        date="2026-07-08"
        tasks={[]}
        isToday={false}
        isCurrentMonth={true}
        onComplete={() => {}}
        onDelete={() => {}}
        onDragLeave={handleDragLeave}
      />
    );
    fireEvent.dragLeave(container.querySelector('.day-cell')!);
    expect(handleDragLeave).toHaveBeenCalledTimes(1);
  });
});
