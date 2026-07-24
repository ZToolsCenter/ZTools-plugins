import { render, screen, act, waitFor } from '@testing-library/react';
import { AppProvider, useAppContext } from './AppContext';
import { AppState } from '../types';
import { loadData, saveData } from '../utils/storageUtils';

// Mock storageUtils
jest.mock('../utils/storageUtils', () => ({
  loadData: jest.fn(),
  saveData: jest.fn(),
}));

const mockedLoadData = loadData as jest.Mock;
const mockedSaveData = saveData as jest.Mock;

// Helper component that uses the context
function TestComponent() {
  const { state, dispatch } = useAppContext();
  return (
    <div>
      <span data-testid="currentWorkspace">{state.currentWorkspace}</span>
      <span data-testid="viewMode">{state.viewMode}</span>
      <button
        data-testid="switchWorkspace"
        onClick={() => dispatch({ type: 'SWITCH_WORKSPACE', payload: { workspace: 'life' } })}
      >
        Switch
      </button>
    </div>
  );
}

describe('AppContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should provide initial state when no saved data', () => {
    mockedLoadData.mockReturnValue(null);
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    expect(screen.getByTestId('currentWorkspace')).toHaveTextContent('work');
    expect(screen.getByTestId('viewMode')).toHaveTextContent('week');
  });

  it('should load saved data from localStorage', () => {
    const savedData: Partial<AppState> = {
      currentWorkspace: 'study',
      viewMode: 'month',
      currentDate: '2024-01-01',
    };
    mockedLoadData.mockReturnValue(savedData);
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    expect(screen.getByTestId('currentWorkspace')).toHaveTextContent('study');
    expect(screen.getByTestId('viewMode')).toHaveTextContent('month');
  });

  it('should throw error when useAppContext used outside provider', () => {
    // Suppress console.error for this test
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestComponent />)).toThrow(
      'useAppContext must be used within an AppProvider'
    );
    spy.mockRestore();
  });

  it('should update state via dispatch', () => {
    mockedLoadData.mockReturnValue(null);
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    expect(screen.getByTestId('currentWorkspace')).toHaveTextContent('work');
    act(() => {
      screen.getByTestId('switchWorkspace').click();
    });
    expect(screen.getByTestId('currentWorkspace')).toHaveTextContent('life');
  });

  it('should debounce save to localStorage', async () => {
    mockedLoadData.mockReturnValue(null);
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    // Trigger state change
    act(() => {
      screen.getByTestId('switchWorkspace').click();
    });
    // Not saved yet
    expect(mockedSaveData).not.toHaveBeenCalled();
    // Advance timers by 500ms
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(mockedSaveData).toHaveBeenCalledTimes(1);
    expect(mockedSaveData).toHaveBeenCalledWith(
      expect.objectContaining({ currentWorkspace: 'life' })
    );
  });

  it('should not save if state unchanged after debounce', () => {
    mockedLoadData.mockReturnValue(null);
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    // Clear initial debounce call from mount
    act(() => {
      jest.advanceTimersByTime(500);
    });
    mockedSaveData.mockClear();
    // No state change, wait debounce
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(mockedSaveData).not.toHaveBeenCalled();
  });

  it('should cancel previous debounce on rapid changes', () => {
    mockedLoadData.mockReturnValue(null);
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    // First change
    act(() => {
      screen.getByTestId('switchWorkspace').click();
    });
    // Wait 300ms (less than debounce)
    act(() => {
      jest.advanceTimersByTime(300);
    });
    // Second change (should reset debounce)
    act(() => {
      screen.getByTestId('switchWorkspace').click(); // now 'study' maybe? Actually dispatch same type again
    });
    // Wait another 300ms (total 600ms but reset at 300)
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(mockedSaveData).not.toHaveBeenCalled();
    // Now wait remaining 200ms to hit 500ms after second change
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(mockedSaveData).toHaveBeenCalledTimes(1);
  });
});