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

  const handleChangeView = useCallback((mode: 'week' | 'month') => {
    dispatch({ type: 'SET_VIEW_MODE', payload: { viewMode: mode } });
  }, [dispatch]);

  const handleWorkspaceChange = useCallback((workspace: string) => {
    dispatch({ type: 'SWITCH_WORKSPACE', payload: { workspace } });
  }, [dispatch]);

  const handleUpdateConfigs = useCallback((configs) => {
    dispatch({ type: 'UPDATE_WORKSPACE_CONFIGS', payload: { configs } });
  }, [dispatch]);

  const handleChangeLayoutMode = useCallback((mode: 'split' | 'pool-only') => {
    dispatch({ type: 'SET_LAYOUT_MODE', payload: { layoutMode: mode } });
  }, [dispatch]);

  const handleChangeColorMode = useCallback((mode: 'status' | 'random') => {
    dispatch({ type: 'SET_TASK_COLOR_MODE', payload: { taskColorMode: mode } });
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
        {/* 仅待办池布局里没有日历，周 / 月切换没有意义 */}
        {state.layoutMode !== 'pool-only' && (
          <ViewToggle viewMode={viewMode} onChange={handleChangeView} />
        )}
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
          colorMode={state.taskColorMode}
          onChangeColorMode={handleChangeColorMode}
          onClose={() => setShowSettings(false)}
        />
      )}
    </header>
  );
}
