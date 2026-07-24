import React, { useCallback, useState } from 'react';
import { Settings } from 'lucide-react';
import { ViewToggle } from '../components/ViewToggle';
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher';
import { WorkspaceSettings } from '../components/WorkspaceSettings';
import { SearchInput } from '../components/Common/SearchInput';
import { useAppContext } from '../context/AppContext';
import './Header.css';

export function Header() {
  const { state, dispatch } = useAppContext();
  const { viewMode } = state;
  const [showSettings, setShowSettings] = useState(false);

  const handleToggleView = useCallback(() => {
    const newMode = viewMode === 'week' ? 'month' : 'week';
    dispatch({ type: 'SET_VIEW_MODE', payload: { viewMode: newMode } });
  }, [dispatch, viewMode]);

  const handleWorkspaceChange = useCallback((workspace: string) => {
    dispatch({ type: 'SWITCH_WORKSPACE', payload: { workspace } });
  }, [dispatch]);

  const handleUpdateConfigs = useCallback((configs) => {
    dispatch({ type: 'UPDATE_WORKSPACE_CONFIGS', payload: { configs } });
  }, [dispatch]);

  const handleChangeLayoutMode = useCallback((mode: 'split' | 'pool-only') => {
    dispatch({ type: 'SET_LAYOUT_MODE', payload: { layoutMode: mode } });
  }, [dispatch]);

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="logo">Todos</h1>
        <WorkspaceSwitcher
          configs={state.workspaceConfigs}
          currentWorkspace={state.currentWorkspace}
          onChange={handleWorkspaceChange}
        />
      </div>
      <div className="header-right">
        <SearchInput
          value={state.searchQuery}
          onChange={(query) => dispatch({ type: 'SET_SEARCH_QUERY', payload: { query } })}
          placeholder="搜索任务..."
          className="header-search"
        />
        <ViewToggle isExpanded={viewMode === 'month'} onToggle={handleToggleView} />
        <button
          className="settings-btn"
          onClick={() => setShowSettings(true)}
          title="工作空间设置"
        >
          <Settings size={18} />
        </button>
      </div>
      {showSettings && (
        <WorkspaceSettings
          configs={state.workspaceConfigs}
          onUpdate={handleUpdateConfigs}
          layoutMode={state.layoutMode}
          onChangeLayoutMode={handleChangeLayoutMode}
          onClose={() => setShowSettings(false)}
        />
      )}
    </header>
  );
}
