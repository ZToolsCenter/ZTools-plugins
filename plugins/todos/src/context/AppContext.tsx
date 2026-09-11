import { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from 'react';
import { AppState, AppAction, Workspace } from '../types';
import { appReducer, initialState } from '../reducers/appReducer';
import { loadData, saveData, loadWorkspaceConfigs, saveWorkspaceConfigs } from '../utils/storageUtils';
import { generateMockData, isDevMode } from '../utils/mockData';

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState, (init) => {
    // 开发模式下加载模拟数据
    if (isDevMode) {
      const mockData = generateMockData();
      return {
        ...init,
        workspaces: mockData,
        currentWorkspace: 'work' as Workspace,
        workspaceConfigs: loadWorkspaceConfigs(),
        viewMode: 'week' as const,
        currentDate: init.currentDate,
      };
    }

    // 从 localStorage 加载初始数据
    const savedData = loadData();
    if (savedData) {
      return { ...init, ...savedData };
    }
    return init;
  });

  // 使用防抖写入 localStorage
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const debouncedSave = useCallback((state: AppState) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      saveData({
        version: '1.0.0',
        workspaces: state.workspaces,
        currentWorkspace: state.currentWorkspace,
        workspaceConfigs: state.workspaceConfigs,
        viewMode: state.viewMode,
        currentDate: state.currentDate,
      });
    }, 500);
  }, []);

  useEffect(() => {
    debouncedSave(state);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [state, debouncedSave]);

  // 保存工作空间配置到ztools.dbStorage
  useEffect(() => {
    saveWorkspaceConfigs(state.workspaceConfigs);
  }, [state.workspaceConfigs]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
