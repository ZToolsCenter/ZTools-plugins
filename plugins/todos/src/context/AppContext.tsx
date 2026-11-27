import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { AppState, AppAction, StorageData, TaskColorMode, Workspace } from '../types';
import { appReducer, initialState } from '../reducers/appReducer';
import { loadData, saveData, loadWorkspaceConfigs } from '../utils/storageUtils';
import { generateMockData, isDevMode } from '../utils/mockData';

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// 色条取色方式单独用一个带默认值的 context：任务卡片可以脱离 Provider 单独渲染（测试便利），
// 默认值取 'random'，与默认设置一致。
const TaskColorModeContext = createContext<TaskColorMode>('random');

export function useTaskColorMode(): TaskColorMode {
  return useContext(TaskColorModeContext);
}

// 开发模式使用独立的存储 key，避免模拟数据覆盖真实待办。
const DATA_STORAGE_KEY = isDevMode ? 'todos-data-dev' : undefined;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState, (init) => {
    // 开发模式下加载模拟数据
    if (isDevMode) {
      const mockData = generateMockData();
      const savedData = loadData(DATA_STORAGE_KEY);
      return {
        ...init,
        workspaces: mockData,
        currentWorkspace: 'work' as Workspace,
        workspaceConfigs: savedData?.workspaceConfigs ?? loadWorkspaceConfigs(),
        viewMode: 'week' as const,
        layoutMode: savedData?.layoutMode ?? init.layoutMode,
        taskViewMode: savedData?.taskViewMode ?? init.taskViewMode,
        taskColorMode: savedData?.taskColorMode ?? init.taskColorMode,
        currentDate: init.currentDate,
      };
    }

    // 从 ZTools dbStorage 加载初始数据（旧版本会自动迁移）
    const savedData = loadData(DATA_STORAGE_KEY);
    if (savedData) {
      return { ...init, ...savedData };
    }
    return init;
  });

  // 只持久化稳定字段（含布局偏好），搜索、选中、拖拽等瞬时 UI 状态不触发写入。
  const persistable = useMemo<StorageData>(() => ({
    version: '1.0.0',
    workspaces: state.workspaces,
    currentWorkspace: state.currentWorkspace,
    workspaceConfigs: state.workspaceConfigs,
    viewMode: state.viewMode,
    layoutMode: state.layoutMode,
    taskViewMode: state.taskViewMode,
    taskColorMode: state.taskColorMode,
    currentDate: state.currentDate,
  }), [
    state.workspaces,
    state.currentWorkspace,
    state.workspaceConfigs,
    state.viewMode,
    state.layoutMode,
    state.taskViewMode,
    state.taskColorMode,
    state.currentDate,
  ]);

  // 使用防抖写入 ZTools dbStorage（不可用时回退 localStorage）
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback((data: StorageData) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (DATA_STORAGE_KEY) {
        saveData(data, DATA_STORAGE_KEY);
      } else {
        saveData(data);
      }
    }, 500);
  }, []);

  useEffect(() => {
    debouncedSave(persistable);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [persistable, debouncedSave]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <TaskColorModeContext.Provider value={state.taskColorMode}>
        {children}
      </TaskColorModeContext.Provider>
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
