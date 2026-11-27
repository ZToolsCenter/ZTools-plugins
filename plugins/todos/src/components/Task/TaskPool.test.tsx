import { useEffect } from 'react';
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

function SearchQuerySetter({ query }: { query: string }) {
  const { dispatch } = useAppContext();

  useEffect(() => {
    dispatch({ type: 'SET_SEARCH_QUERY', payload: { query } });
  }, [dispatch, query]);

  return null;
}

const makeTask = (id: string, title: string, dates: string[], overrides: Partial<Task> = {}): Task => ({
  id,
  title,
  priority: 'medium',
  dates,
  status: 'todo',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides
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

  describe('Ctrl+Enter', () => {
    const getComposer = () => screen.getByPlaceholderText(/输入任务名称/) as HTMLTextAreaElement;

    it('focuses the composer when it is not focused', () => {
      renderWithProvider(<TaskPool />);
      const composer = getComposer();
      expect(document.activeElement).not.toBe(composer);

      fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });

      expect(document.activeElement).toBe(composer);
    });

    it('does not steal focus while the settings dialog is open', () => {
      renderWithProvider(
        <>
          <div className="workspace-settings-overlay" />
          <TaskPool />
        </>
      );

      fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });

      expect(document.activeElement).not.toBe(getComposer());
    });

    it('submits the task when the composer is already focused', () => {
      renderWithProvider(<TaskPool />);
      const composer = getComposer();

      fireEvent.change(composer, { target: { value: '写日报' } });
      composer.focus();
      fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });

      expect(screen.getByText('写日报')).toBeInTheDocument();
      expect(composer.value).toBe('');
    });
  });

  describe('grouping completed tasks', () => {
    it('puts a completed task without dates into 已完成 instead of 未安排', () => {
      seedStorage([makeTask('done-1', '已完成无日期', [], { status: 'done' })]);

      renderWithProvider(<TaskPool />);

      expect(screen.getByText('已完成任务')).toBeInTheDocument();
      expect(screen.queryByText('未安排任务')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^未安排/)).not.toBeInTheDocument();
    });

    it('keeps a completed task out of the 今天 group', () => {
      seedStorage([makeTask('done-2', '今天完成的', [formatDate(new Date())], { status: 'done' })]);

      renderWithProvider(<TaskPool />);

      expect(screen.getByText('已完成任务')).toBeInTheDocument();
      expect(screen.queryByText('今天的任务')).not.toBeInTheDocument();
    });

    it('still groups pending tasks without dates under 未安排', () => {
      seedStorage([makeTask('todo-1', '未安排待办', [])]);

      renderWithProvider(<TaskPool />);

      expect(screen.getByText('未安排任务')).toBeInTheDocument();
      expect(screen.queryByText('已完成任务')).not.toBeInTheDocument();
    });
  });

  describe('nested tasks', () => {
    const seedNested = () => seedStorage([
      makeTask('p1', '主任务', []),
      { ...makeTask('s1', '子任务 A', []), parentId: 'p1' as const },
      { ...makeTask('s2', '子任务 B', []), parentId: 'p1' as const, status: 'done' as const },
    ]);

    it('renders subtasks under their parent instead of as separate groups', () => {
      seedNested();
      renderWithProvider(<TaskPool />);

      expect(screen.getByText('主任务')).toBeInTheDocument();
      expect(screen.getByText('子任务 A')).toBeInTheDocument();
      expect(screen.getByText('子任务 B')).toBeInTheDocument();

      // 未安排分组只统计主任务，子任务不会单独成组
      const unscheduledGroup = screen.getByText('未安排任务').closest('.task-group');
      expect(unscheduledGroup?.querySelector('.task-group-count')).toHaveTextContent('1');
      expect(screen.queryByText('已完成任务')).not.toBeInTheDocument();
    });

    it('shows subtask progress on the parent', () => {
      seedNested();
      renderWithProvider(<TaskPool />);

      expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('adds a subtask from the parent row', () => {
      seedStorage([makeTask('p1', '主任务', [])]);
      renderWithProvider(<TaskPool />);

      fireEvent.click(document.querySelector('.subtask-add-icon')!);

      const input = screen.getByPlaceholderText(/子任务名称/);
      fireEvent.change(input, { target: { value: '拆出来的子任务' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(screen.getByText('拆出来的子任务')).toBeInTheDocument();
    });

    it('does not render a subtask row just by hovering a task without subtasks', () => {
      seedStorage([makeTask('p1', '主任务', [])]);
      renderWithProvider(<TaskPool />);

      fireEvent.mouseEnter(document.querySelector('.task-node')!);

      // 只有悬浮图标，不会因为 hover 撑出一行、导致列表跳动
      expect(document.querySelector('.subtask-list')).toBeNull();
      expect(document.querySelector('.subtask-add-icon')).not.toBeNull();
    });

    it('collapses and expands subtasks', () => {
      seedNested();
      renderWithProvider(<TaskPool />);

      expect(screen.getByText('子任务 A')).toBeInTheDocument();
      expect(document.querySelector('.subtask-toggle')).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(document.querySelector('.subtask-toggle')!);

      expect(screen.queryByText('子任务 A')).not.toBeInTheDocument();
      expect(document.querySelector('.subtask-toggle')).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(document.querySelector('.subtask-toggle')!);

      expect(screen.getByText('子任务 A')).toBeInTheDocument();
    });

    it('shows the add icon for a task without subtasks and the toggle for a task with subtasks', () => {
      seedStorage([
        makeTask('p1', '主任务', []),
        { ...makeTask('s1', '子任务 A', []), parentId: 'p1' as const },
        makeTask('p2', '普通任务', []),
      ]);
      renderWithProvider(<TaskPool />);

      const nodes = Array.from(document.querySelectorAll('.task-node'));
      const withSubtasks = nodes.find(node => node.textContent?.includes('主任务'))!;
      const withoutSubtasks = nodes.find(node => node.textContent?.includes('普通任务'))!;

      expect(withSubtasks.querySelector('.subtask-toggle')).not.toBeNull();
      expect(withSubtasks.querySelector('.subtask-add-icon')).toBeNull();

      expect(withoutSubtasks.querySelector('.subtask-add-icon')).not.toBeNull();
      expect(withoutSubtasks.querySelector('.subtask-toggle')).toBeNull();
    });

    it('offers the add button at the end of the expanded list', () => {
      seedNested();
      renderWithProvider(<TaskPool />);

      fireEvent.click(document.querySelector('.subtask-toggle')!);
      expect(document.querySelector('.subtask-add')).toBeNull();

      fireEvent.click(document.querySelector('.subtask-toggle')!);
      const addButton = document.querySelector('.subtask-add')!;
      expect(addButton).not.toBeNull();
      expect(addButton).toHaveTextContent('子任务');

      fireEvent.click(addButton);
      expect(document.querySelector('.subtask-input')).not.toBeNull();
    });

    it('renders a subtask as a regular task row', () => {
      seedNested();
      renderWithProvider(<TaskPool />);

      const row = document
        .querySelector('.subtask-list .task-item[data-task-id="s1"]');
      expect(row).not.toBeNull();
      expect(row?.querySelector('.task-title')).toHaveTextContent('子任务 A');
    });

    it('lets a subtask jump to its own deadline when clicked', () => {
      const deadline = '2026-02-20';
      seedStorage([
        makeTask('p1', '主任务', []),
        { ...makeTask('s1', '子任务 A', ['2026-01-16', deadline]), parentId: 'p1' as const },
      ]);

      render(
        <AppProvider>
          <CurrentDateProbe />
          <TaskPool />
        </AppProvider>
      );

      fireEvent.click(screen.getByText('子任务 A'));
      expect(screen.getByTestId('currentDate')).toHaveTextContent(deadline);
    });
    it('shows the parent when only a subtask matches the search', () => {
      seedNested();
      render(
        <AppProvider>
          <SearchQuerySetter query="子任务 B" />
          <TaskPool />
        </AppProvider>
      );

      expect(screen.getByText('主任务')).toBeInTheDocument();
      expect(screen.getByText('子任务 B')).toBeInTheDocument();
    });
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
