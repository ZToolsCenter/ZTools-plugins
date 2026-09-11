import React, { useState, useCallback } from 'react';
import { AppProvider } from '../context/AppContext';
import { Header } from './Header';
import { CalendarView } from './Calendar/CalendarView';
import { TaskPool } from './Task/TaskPool';
import { WorkspaceGradient } from './WorkspaceGradient';
import { DevRefreshButton } from './DevRefreshButton';
import { BottomLegend } from './BottomLegend';
import { KeyboardShortcutPanel } from './KeyboardShortcutPanel';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAppContext } from '../context/AppContext';

function TodoAppContent() {
  const { state, dispatch } = useAppContext();
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleHoverTask = useCallback((taskId: string | null) => {
    setHoveredTaskId(taskId);
  }, []);

  const handleSelectTask = useCallback((taskId: string) => {
    dispatch({ type: 'SET_SELECTED_TASK', payload: { taskId } });
  }, [dispatch]);

  const toggleShortcuts = useCallback(() => {
    setShowShortcuts(prev => !prev);
  }, []);

  const closeShortcuts = useCallback(() => {
    setShowShortcuts(false);
  }, []);

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
      if (showShortcuts) {
        setShowShortcuts(false);
      } else {
        dispatch({ type: 'SET_SEARCH_QUERY', payload: { query: '' } });
      }
    },
    onShowShortcuts: toggleShortcuts
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
      <BottomLegend onShowShortcuts={toggleShortcuts} />
      <KeyboardShortcutPanel visible={showShortcuts} onClose={closeShortcuts} />
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
