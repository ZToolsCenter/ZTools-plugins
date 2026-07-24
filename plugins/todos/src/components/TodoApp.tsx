import React, { useState, useCallback } from 'react';
import { AppProvider } from '../context/AppContext';
import { Header } from './Header';
import { CalendarView } from './Calendar/CalendarView';
import { TaskPool } from './Task/TaskPool';
import { WorkspaceGradient } from './WorkspaceGradient';
import { DevRefreshButton } from './DevRefreshButton';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAppContext } from '../context/AppContext';

function TodoAppContent() {
  const { state, dispatch } = useAppContext();
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  const handleHoverTask = useCallback((taskId: string | null) => {
    setHoveredTaskId(taskId);
  }, []);

  const handleSelectTask = useCallback((taskId: string) => {
    dispatch({ type: 'SET_SELECTED_TASK', payload: { taskId } });
  }, [dispatch]);

  useKeyboardShortcuts({
    onSearch: () => {
      const searchInput = document.querySelector('.search-input input') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
      }
    },
    onToggleView: () => {
      const newMode = state.viewMode === 'week' ? 'month' : 'week';
      dispatch({ type: 'SET_VIEW_MODE', payload: { viewMode: newMode } });
    },
    onEscape: () => {
      dispatch({ type: 'SET_SEARCH_QUERY', payload: { query: '' } });
    }
  });

  return (
    <div className="todo-app">
      <Header />
      <div className={`todo-content ${state.layoutMode === 'pool-only' ? 'pool-only' : ''}`}>
        {state.layoutMode === 'split' && (
          <CalendarView hoveredTaskId={hoveredTaskId} onHoverTask={handleHoverTask} onSelectTask={handleSelectTask} />
        )}
        <TaskPool hoveredTaskId={hoveredTaskId} onHoverTask={handleHoverTask} />
        <WorkspaceGradient />
      </div>
      <DevRefreshButton />
    </div>
  );
}

export default function TodoApp() {
  return (
    <AppProvider>
      <TodoAppContent />
    </AppProvider>
  );
}
