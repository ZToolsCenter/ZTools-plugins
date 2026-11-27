import { render, screen, fireEvent } from '@testing-library/react';
import { ReactNode } from 'react';
import { WeekView } from './WeekView';
import { AppProvider } from '../../context/AppContext';
import { useAppContext } from '../../context/AppContext';
import { loadData } from '../../utils/storageUtils';
import { formatDate, getWeekStart } from '../../utils/dateUtils';
import { DEFAULT_WORKSPACE_CONFIGS } from '../../constants/colorSchemes';

jest.mock('../../utils/storageUtils', () => ({
  loadData: jest.fn(),
  saveData: jest.fn(),
  loadWorkspaceConfigs: jest.fn(() => [
    { id: 'work', name: '工作', colorScheme: 'teal', order: 0 },
    { id: 'life', name: '生活', colorScheme: 'orange', order: 1 },
    { id: 'study', name: '学习', colorScheme: 'purple', order: 2 },
  ]),
  saveWorkspaceConfigs: jest.fn(),
}));

const mockedLoadData = loadData as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

function StateInspector() {
  const { state } = useAppContext();
  return (
    <div>
      <span data-testid="draggedTaskId">{state.draggedTaskId ?? 'null'}</span>
      <span data-testid="dropTargetDate">{state.dropTargetDate ?? 'null'}</span>
    </div>
  );
}

function CreateAndSelectGroup() {
  const { state, dispatch } = useAppContext();
  return (
    <button
      data-testid="create-group"
      onClick={() => {
        dispatch({
          type: 'UPDATE_WORKSPACE_CONFIGS',
          payload: {
            configs: [
              ...state.workspaceConfigs,
              { id: 'workspace-new', name: '新组', colorScheme: 'teal', order: 3 }
            ]
          }
        });
        dispatch({ type: 'SWITCH_WORKSPACE', payload: { workspace: 'workspace-new' } });
      }}
    >
      新建分组
    </button>
  );
}

describe('WeekView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadData.mockReturnValue(null);
  });

  it('schedules subtasks on their own dates like normal tasks', () => {
    const today = formatDate(getWeekStart(new Date()));
    mockedLoadData.mockReturnValue({
      version: '1.0.0',
      workspaces: {
        work: [
          { id: 'parent-1', title: '主任务', priority: 'medium', dates: [today], status: 'todo', createdAt: today, updatedAt: today },
          { id: 'sub-1', title: '子任务', priority: 'medium', dates: [today], status: 'todo', createdAt: today, updatedAt: today, parentId: 'parent-1' },
        ],
        life: [],
        study: [],
      },
      currentWorkspace: 'work',
      workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
      viewMode: 'week',
      layoutMode: 'split',
      taskViewMode: 'tag',
      taskColorMode: 'random',
      currentDate: today,
    });

    const { container } = render(<WeekView />, { wrapper });
    const row = container.querySelector(`.day-row[data-date="${today}"]`)!;
    const titles = Array.from(row.querySelectorAll('.chip-title')).map(el => el.textContent);

    expect(titles).toEqual(['主任务', '子任务']);
  });

  it('keeps completed tasks in the day row and puts them last', () => {
    const today = formatDate(getWeekStart(new Date()));
    mockedLoadData.mockReturnValue({
      version: '1.0.0',
      workspaces: {
        work: [
          { id: 'done-1', title: '做完的', priority: 'medium', dates: [today], status: 'done', createdAt: today, updatedAt: today },
          { id: 'todo-1', title: '没做完的', priority: 'medium', dates: [today], status: 'todo', createdAt: today, updatedAt: today },
        ],
        life: [],
        study: [],
      },
      currentWorkspace: 'work',
      workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
      viewMode: 'week',
      layoutMode: 'split',
      taskViewMode: 'tag',
      taskColorMode: 'random',
      currentDate: today,
    });

    const { container } = render(<WeekView />, { wrapper });
    const row = container.querySelector(`.day-row[data-date="${today}"]`)!;
    const titles = Array.from(row.querySelectorAll('.chip-title')).map(el => el.textContent);

    expect(titles).toEqual(['没做完的', '做完的']);
    expect(row.querySelector('.task-chip.done')).toBeInTheDocument();
  });

  it('renders 7 day rows', () => {
    const { container } = render(<WeekView />, { wrapper });
    const dayRows = container.querySelectorAll('.day-row');
    expect(dayRows).toHaveLength(7);
  });

  it('renders today class for today', () => {
    const { container } = render(<WeekView />, { wrapper });
    const todayRow = container.querySelector('.day-row.today');
    expect(todayRow).toBeInTheDocument();
  });

  it('renders day names', () => {
    render(<WeekView />, { wrapper });
    expect(screen.getByText('周一')).toBeInTheDocument();
  });

  it('does not crash after creating and selecting a new group', () => {
    render(
      <AppProvider>
        <CreateAndSelectGroup />
        <WeekView />
      </AppProvider>
    );
    fireEvent.click(screen.getByTestId('create-group'));
    expect(document.querySelectorAll('.day-row')).toHaveLength(7);
  });

  it('sets drag state on dragover', () => {
    render(
      <AppProvider>
        <StateInspector />
        <WeekView />
      </AppProvider>
    );
    const firstDayRow = document.querySelector('.day-row')!;
    const date = firstDayRow.getAttribute('data-date')!;
    const dragEvent = new Event('dragover', { bubbles: true });
    Object.defineProperty(dragEvent, 'dataTransfer', {
      value: { dropEffect: '' },
    });
    fireEvent(firstDayRow, dragEvent);
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent(date);
  });

  it('clears drop target on dragleave', () => {
    render(
      <AppProvider>
        <StateInspector />
        <WeekView />
      </AppProvider>
    );
    const firstDayRow = document.querySelector('.day-row')!;
    const date = firstDayRow.getAttribute('data-date')!;
    const dragEvent = new Event('dragover', { bubbles: true });
    Object.defineProperty(dragEvent, 'dataTransfer', {
      value: { dropEffect: '' },
    });
    fireEvent(firstDayRow, dragEvent);
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent(date);
    fireEvent.dragLeave(firstDayRow);
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent('null');
  });

  it('clears drag state after drop', () => {
    render(
      <AppProvider>
        <StateInspector />
        <WeekView />
      </AppProvider>
    );
    const firstDayRow = document.querySelector('.day-row')!;
    const dragEvent = new Event('dragover', { bubbles: true });
    Object.defineProperty(dragEvent, 'dataTransfer', {
      value: { dropEffect: '' },
    });
    fireEvent(firstDayRow, dragEvent);
    const dropEvent = new Event('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { getData: () => '', dropEffect: '' },
    });
    fireEvent(firstDayRow, dropEvent);
    expect(screen.getByTestId('draggedTaskId')).toHaveTextContent('null');
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent('null');
  });
});
