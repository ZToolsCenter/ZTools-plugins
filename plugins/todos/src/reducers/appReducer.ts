import { AppState, AppAction, Task } from '../types';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

export const initialState: AppState = {
  workspaces: {
    work: [],
    life: [],
    study: []
  },
  currentWorkspace: 'work',
  workspaceConfigs: DEFAULT_WORKSPACE_CONFIGS,
  viewMode: 'week',
  taskViewMode: 'tag',
  layoutMode: 'split',
  taskColorMode: 'random',
  currentDate: new Date().toISOString().split('T')[0],
  searchQuery: '',
  selectedTaskId: null,
  draggedTaskId: null,
  dropTargetDate: null,
  dragSourceDate: null
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_TASK': {
      const { workspace, task } = action.payload;
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [workspace]: [task, ...(state.workspaces[workspace] || [])]
        }
      };
    }
    
    case 'ADD_SUBTASK': {
      const { workspace, task } = action.payload;
      // 子任务追加到末尾，保持用户输入顺序
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [workspace]: [...(state.workspaces[workspace] || []), task]
        }
      };
    }
    
    case 'UPDATE_TASK': {
      const { taskId, updates } = action.payload;
      const updatedWorkspaces = { ...state.workspaces };
      
      for (const workspaceKey of Object.keys(updatedWorkspaces) as Array<keyof typeof updatedWorkspaces>) {
        updatedWorkspaces[workspaceKey] = updatedWorkspaces[workspaceKey].map(task =>
          task.id === taskId ? { ...task, ...updates } : task
        );
      }
      
      return {
        ...state,
        workspaces: updatedWorkspaces
      };
    }
    
    case 'DELETE_TASK': {
      const { taskId } = action.payload;
      const updatedWorkspaces = { ...state.workspaces };
      
      for (const workspaceKey of Object.keys(updatedWorkspaces) as Array<keyof typeof updatedWorkspaces>) {
        // 删除主任务时把它的子任务一起删掉
        updatedWorkspaces[workspaceKey] = updatedWorkspaces[workspaceKey].filter(
          task => task.id !== taskId && task.parentId !== taskId
        );
      }
      
      return {
        ...state,
        workspaces: updatedWorkspaces,
        selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId
      };
    }
    
    case 'COMPLETE_TASK': {
      const { taskId } = action.payload;
      const updatedWorkspaces = { ...state.workspaces };
      
      for (const workspaceKey of Object.keys(updatedWorkspaces) as Array<keyof typeof updatedWorkspaces>) {
        const tasks = updatedWorkspaces[workspaceKey];
        const target = tasks.find(task => task.id === taskId);
        if (!target) {
          continue;
        }

        const nextStatus: Task['status'] = target.status === 'done' ? 'todo' : 'done';

        // 主任务完成 / 取消完成时，子任务跟随同一状态
        updatedWorkspaces[workspaceKey] = tasks.map(task =>
          task.id === taskId || task.parentId === taskId
            ? { ...task, status: nextStatus }
            : task
        );
      }
      
      return {
        ...state,
        workspaces: updatedWorkspaces
      };
    }
    
    case 'ADD_DATE_TO_TASK': {
      const { taskId, date } = action.payload;
      const updatedWorkspaces = { ...state.workspaces };
      
      for (const workspaceKey of Object.keys(updatedWorkspaces) as Array<keyof typeof updatedWorkspaces>) {
        updatedWorkspaces[workspaceKey] = updatedWorkspaces[workspaceKey].map(task =>
          task.id === taskId && !task.dates.includes(date)
            ? { ...task, dates: [...task.dates, date] }
            : task
        );
      }
      
      return {
        ...state,
        workspaces: updatedWorkspaces
      };
    }
    
    case 'REMOVE_DATE_FROM_TASK': {
      const { taskId, date } = action.payload;
      const updatedWorkspaces = { ...state.workspaces };
      
      for (const workspaceKey of Object.keys(updatedWorkspaces) as Array<keyof typeof updatedWorkspaces>) {
        updatedWorkspaces[workspaceKey] = updatedWorkspaces[workspaceKey].map(task =>
          task.id === taskId
            ? { ...task, dates: task.dates.filter(d => d !== date) }
            : task
        );
      }
      
      return {
        ...state,
        workspaces: updatedWorkspaces
      };
    }
    
    case 'SWITCH_WORKSPACE':
      return {
        ...state,
        currentWorkspace: action.payload.workspace
      };
    
    case 'SET_VIEW_MODE':
      return {
        ...state,
        viewMode: action.payload.viewMode
      };
    
    case 'SET_TASK_VIEW_MODE':
      return {
        ...state,
        taskViewMode: action.payload.taskViewMode
      };
    
    case 'SET_CURRENT_DATE':
      return {
        ...state,
        currentDate: action.payload.date
      };
    
    case 'SET_SEARCH_QUERY':
      return {
        ...state,
        searchQuery: action.payload.query
      };
    
    case 'SET_DRAG_STATE':
      return {
        ...state,
        draggedTaskId: action.payload.taskId,
        dropTargetDate: action.payload.dropTarget,
        dragSourceDate: action.payload.sourceDate ?? null
      };
    
    case 'LOAD_DATA':
      return {
        ...state,
        ...action.payload.data
      };
    
    case 'UPDATE_WORKSPACE_CONFIGS': {
      const configs = action.payload.configs;
      const reconciledWorkspaces: Record<string, Task[]> = {};
      for (const config of configs) {
        reconciledWorkspaces[config.id] = state.workspaces[config.id] || [];
      }
      return {
        ...state,
        workspaceConfigs: configs,
        workspaces: reconciledWorkspaces,
        currentWorkspace: configs.some(c => c.id === state.currentWorkspace)
          ? state.currentWorkspace
          : configs[0]?.id || 'work'
      };
    }
    
    case 'ADD_WORKSPACE':
      return {
        ...state,
        workspaceConfigs: [...state.workspaceConfigs, action.payload.config],
        workspaces: {
          ...state.workspaces,
          [action.payload.config.id]: []
        }
      };
    
    case 'REMOVE_WORKSPACE': {
      const { [action.payload.id]: _, ...remainingWorkspaces } = state.workspaces;
      return {
        ...state,
        workspaceConfigs: state.workspaceConfigs.filter(c => c.id !== action.payload.id),
        workspaces: remainingWorkspaces,
        currentWorkspace: state.currentWorkspace === action.payload.id
          ? state.workspaceConfigs[0]?.id || 'work'
          : state.currentWorkspace
      };
    }
    
    case 'UPDATE_WORKSPACE':
      return {
        ...state,
        workspaceConfigs: state.workspaceConfigs.map(c =>
          c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
        )
      };
    
    case 'SET_SELECTED_TASK':
      return {
        ...state,
        selectedTaskId: action.payload.taskId === state.selectedTaskId ? null : action.payload.taskId
      };
    
    case 'SET_LAYOUT_MODE':
      return {
        ...state,
        layoutMode: action.payload.layoutMode
      };

    case 'SET_TASK_COLOR_MODE':
      return {
        ...state,
        taskColorMode: action.payload.taskColorMode
      };
    
    default:
      return state;
  }
}
