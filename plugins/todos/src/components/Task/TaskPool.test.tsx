import { render, screen, fireEvent } from '@testing-library/react';
import { TaskPool } from './TaskPool';
import { AppProvider, useAppContext } from '../../context/AppContext';
import { getWeekStart, formatDate } from '../../utils/dateUtils';
import { DEFAULT_WORKSPACE_CONFIGS } from '../../constants/colorSchemes';
import { Task } from '../../types';

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

function CurrentDateProbe() {
  const { state } = useAppContext();
  return <span data-testid="currentDate">{state.currentDate}</span>;
}

const makeTask = (id: string, title: string, dates: string[]): Task => ({
  id,
  title,
  priority: 'medium',
  dates,
  status: 'todo',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
});

const seedStorage = (tasks: Task[], overrides: Record<string, unknown> = {}) => {
  localStorage.setItem('todos-data', JSON.stringify({
    version: '1.0.0',
    workspaces: { work: tasks, life: [], study: [] },
    currentWorkspace: 'work',
    workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
    viewMode: 'month',
    currentDate: '2026-01-15',
    ...overrides
  }));
};

describe('TaskPool', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders empty state when no tasks exist', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
    expect(screen.getByText('在下方输入框中添加新任务')).toBeInTheDocument();
  });

  it('renders pool header', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByText('待办池')).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByPlaceholderText('搜索任务...')).toBeInTheDocument();
  });

  it('renders textarea for adding tasks', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByPlaceholderText(/输入任务名称/)).toBeInTheDocument();
  });

  it('renders task count as zero initially', () => {
    renderWithProvider(<TaskPool />);
    expect(screen.getByText('0 项任务')).toBeInTheDocument();
  });

  it('renders empty state icon', () => {
    const { container } = renderWithProvider(<TaskPool />);
    expect(container.querySelector('.lucide-file-text')).toBeInTheDocument();
  });

  describe('clicking a task in month view', () => {
    const currentWeekDeadline = () => {
      const weekStart = getWeekStart(new Date());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return formatDate(weekEnd);
    };

    it('jumps to the latest scheduled date (deadline)', () => {
      const deadline = currentWeekDeadline();
      seedStorage([makeTask('t1', '有截止期的任务', [formatDate(new Date()), deadline])]);

      render(
        <AppProvider>
          <CurrentDateProbe />
          <TaskPool />
        </AppProvider>
      );

      expect(screen.getByTestId('currentDate')).toHaveTextContent('2026-01-15');
      fireEvent.click(screen.getByText('有截止期的任务'));
      expect(screen.getByTestId('currentDate')).toHaveTextContent(deadline);
    });

    it('does not jump when the task has no scheduled dates', () => {
      seedStorage([makeTask('t2', '无日期任务', [])]);

      render(
        <AppProvider>
          <CurrentDateProbe />
          <TaskPool />
        </AppProvider>
      );

      fireEvent.click(screen.getByText('无日期任务'));
      expect(screen.getByTestId('currentDate')).toHaveTextContent('2026-01-15');
    });

    it('jumps to the deadline in week view too', () => {
      const deadline = currentWeekDeadline();
      seedStorage(
        [makeTask('t3', '周视图任务', [formatDate(new Date()), deadline])],
        { viewMode: 'week' }
      );

      render(
        <AppProvider>
          <CurrentDateProbe />
          <TaskPool />
        </AppProvider>
      );

      expect(screen.getByTestId('currentDate')).toHaveTextContent('2026-01-15');
      fireEvent.click(screen.getByText('周视图任务'));
      expect(screen.getByTestId('currentDate')).toHaveTextContent(deadline);
    });
  });
});
