import { render, screen, fireEvent } from '@testing-library/react';
import { ReactNode } from 'react';
import { MonthView } from './MonthView';
import { AppProvider } from '../../context/AppContext';
import { useAppContext } from '../../context/AppContext';
import { loadData } from '../../utils/storageUtils';

jest.mock('../../utils/storageUtils', () => ({
  loadData: jest.fn(),
  saveData: jest.fn(),
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

describe('MonthView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadData.mockReturnValue(null);
  });

  it('renders month header with week days', () => {
    render(<MonthView />, { wrapper });
    expect(screen.getByText('周一')).toBeInTheDocument();
    expect(screen.getByText('周二')).toBeInTheDocument();
    expect(screen.getByText('周三')).toBeInTheDocument();
    expect(screen.getByText('周四')).toBeInTheDocument();
    expect(screen.getByText('周五')).toBeInTheDocument();
    expect(screen.getByText('周六')).toBeInTheDocument();
    expect(screen.getByText('周日')).toBeInTheDocument();
  });

  it('renders day cells', () => {
    const { container } = render(<MonthView />, { wrapper });
    const dayCells = container.querySelectorAll('.day-cell');
    expect(dayCells.length).toBeGreaterThan(0);
  });

  it('renders month grid', () => {
    const { container } = render(<MonthView />, { wrapper });
    expect(container.querySelector('.month-grid')).toBeInTheDocument();
  });

  it('renders month header', () => {
    const { container } = render(<MonthView />, { wrapper });
    expect(container.querySelector('.month-header')).toBeInTheDocument();
  });

  it('sets drag state on dragover', () => {
    render(
      <AppProvider>
        <StateInspector />
        <MonthView />
      </AppProvider>
    );
    const firstDayCell = document.querySelector('.day-cell')!;
    const date = firstDayCell.getAttribute('data-date')!;
    const dragEvent = new Event('dragover', { bubbles: true });
    Object.defineProperty(dragEvent, 'dataTransfer', {
      value: { dropEffect: '' },
    });
    fireEvent(firstDayCell, dragEvent);
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent(date);
  });

  it('clears drop target on dragleave', () => {
    render(
      <AppProvider>
        <StateInspector />
        <MonthView />
      </AppProvider>
    );
    const firstDayCell = document.querySelector('.day-cell')!;
    const date = firstDayCell.getAttribute('data-date')!;
    const dragEvent = new Event('dragover', { bubbles: true });
    Object.defineProperty(dragEvent, 'dataTransfer', {
      value: { dropEffect: '' },
    });
    fireEvent(firstDayCell, dragEvent);
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent(date);
    fireEvent.dragLeave(firstDayCell);
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent('null');
  });

  it('clears drag state after drop', () => {
    render(
      <AppProvider>
        <StateInspector />
        <MonthView />
      </AppProvider>
    );
    const firstDayCell = document.querySelector('.day-cell')!;
    const dragEvent = new Event('dragover', { bubbles: true });
    Object.defineProperty(dragEvent, 'dataTransfer', {
      value: { dropEffect: '' },
    });
    fireEvent(firstDayCell, dragEvent);
    const dropEvent = new Event('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { getData: () => '', dropEffect: '' },
    });
    fireEvent(firstDayCell, dropEvent);
    expect(screen.getByTestId('draggedTaskId')).toHaveTextContent('null');
    expect(screen.getByTestId('dropTargetDate')).toHaveTextContent('null');
  });
});
