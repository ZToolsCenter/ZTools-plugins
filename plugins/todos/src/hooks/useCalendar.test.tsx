import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { useCalendar } from './useCalendar';
import { AppProvider } from '../context/AppContext';
import { loadData } from '../utils/storageUtils';
import { formatDate } from '../utils/dateUtils';

jest.mock('../utils/storageUtils', () => ({
  loadData: jest.fn(),
  saveData: jest.fn(),
}));

const mockedLoadData = loadData as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

describe('useCalendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    const fixedDate = new Date('2024-01-15T10:00:00');
    jest.setSystemTime(fixedDate);
    // Provide saved data so the provider uses our fixed date as currentDate
    mockedLoadData.mockReturnValue({
      currentDate: '2024-01-15',
      viewMode: 'week',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should navigate to previous week in week mode', () => {
    const { result } = renderHook(() => useCalendar(), { wrapper });

    act(() => {
      result.current.navigatePrev();
    });

    expect(result.current.currentDate).toBe('2024-01-08');
  });

  it('should navigate to next week in week mode', () => {
    const { result } = renderHook(() => useCalendar(), { wrapper });

    act(() => {
      result.current.navigateNext();
    });

    expect(result.current.currentDate).toBe('2024-01-22');
  });

  it('should go to today', () => {
    const { result } = renderHook(() => useCalendar(), { wrapper });

    act(() => {
      result.current.navigatePrev();
      result.current.navigatePrev();
    });

    act(() => {
      result.current.goToToday();
    });

    expect(result.current.currentDate).toBe('2024-01-15');
  });

  it('should get current week dates', () => {
    const { result } = renderHook(() => useCalendar(), { wrapper });

    const week = result.current.getCurrentWeek();
    expect(week).toHaveLength(7);
    // Monday 2024-01-15 should be in the week
    expect(week).toContain('2024-01-15');
  });

  it('should get current month dates', () => {
    const { result } = renderHook(() => useCalendar(), { wrapper });

    const month = result.current.getCurrentMonth();
    expect(month).toHaveLength(42); // 6 rows × 7 days

    // Should contain current month days
    const currentMonthDays = month.filter(d => d.isCurrentMonth);
    expect(currentMonthDays.length).toBeGreaterThan(0);
  });

  it('should return current date and view mode', () => {
    const { result } = renderHook(() => useCalendar(), { wrapper });

    expect(result.current.currentDate).toBe('2024-01-15');
    expect(result.current.viewMode).toBe('week');
  });
});
