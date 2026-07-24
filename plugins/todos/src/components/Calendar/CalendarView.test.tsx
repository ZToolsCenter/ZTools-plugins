import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { CalendarView } from './CalendarView';
import { AppProvider } from '../../context/AppContext';
import { loadData } from '../../utils/storageUtils';

jest.mock('../../utils/storageUtils', () => ({
  loadData: jest.fn(),
  saveData: jest.fn(),
}));

const mockedLoadData = loadData as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

describe('CalendarView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadData.mockReturnValue(null);
  });

  it('renders calendar nav', () => {
    const { container } = render(<CalendarView />, { wrapper });
    expect(screen.getAllByText('今天').length).toBeGreaterThan(0);
    expect(container.querySelector('.lucide-chevron-left')).toBeInTheDocument();
    expect(container.querySelector('.lucide-chevron-right')).toBeInTheDocument();
  });

  it('renders with calendar-view class', () => {
    const { container } = render(<CalendarView />, { wrapper });
    expect(container.querySelector('.calendar-view')).toBeInTheDocument();
  });

  it('renders week view by default', () => {
    const { container } = render(<CalendarView />, { wrapper });
    expect(container.querySelector('.week-view')).toBeInTheDocument();
  });
});
