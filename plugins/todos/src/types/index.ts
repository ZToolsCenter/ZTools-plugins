// 工作空间类型
export type Workspace = string;

// 工作空间配置
export interface WorkspaceConfig {
  id: string;
  name: string;
  colorScheme: string;
  order: number;
}

// 配色方案
export interface ColorScheme {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  light: string;
  dark: string;
}

// 任务优先级
export type Priority = 'high' | 'medium' | 'low';

// 任务状态
export type TaskStatus = 'todo' | 'done' | 'overdue';

// 任务接口
export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  tags?: string[];
  dates: string[];  // YYYY-MM-DD 格式
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

// 应用状态
export interface AppState {
  workspaces: Record<Workspace, Task[]>;
  currentWorkspace: Workspace;
  workspaceConfigs: WorkspaceConfig[];
  viewMode: 'week' | 'month';
  taskViewMode: 'tag' | 'block';
  layoutMode: 'split' | 'pool-only';
  currentDate: string;
  searchQuery: string;
  selectedTaskId: string | null;
  draggedTaskId: string | null;
  dropTargetDate: string | null;
}

// 应用 Actions
export type AppAction =
  | { type: 'ADD_TASK'; payload: { workspace: Workspace; task: Task } }
  | { type: 'UPDATE_TASK'; payload: { taskId: string; updates: Partial<Task> } }
  | { type: 'DELETE_TASK'; payload: { taskId: string } }
  | { type: 'COMPLETE_TASK'; payload: { taskId: string } }
  | { type: 'ADD_DATE_TO_TASK'; payload: { taskId: string; date: string } }
  | { type: 'REMOVE_DATE_FROM_TASK'; payload: { taskId: string; date: string } }
  | { type: 'SWITCH_WORKSPACE'; payload: { workspace: Workspace } }
  | { type: 'SET_VIEW_MODE'; payload: { viewMode: 'week' | 'month' } }
  | { type: 'SET_TASK_VIEW_MODE'; payload: { taskViewMode: 'tag' | 'block' } }
  | { type: 'SET_CURRENT_DATE'; payload: { date: string } }
  | { type: 'SET_SEARCH_QUERY'; payload: { query: string } }
  | { type: 'SET_DRAG_STATE'; payload: { taskId: string | null; dropTarget: string | null } }
  | { type: 'LOAD_DATA'; payload: { data: Partial<AppState> } }
  | { type: 'UPDATE_WORKSPACE_CONFIGS'; payload: { configs: WorkspaceConfig[] } }
  | { type: 'ADD_WORKSPACE'; payload: { config: WorkspaceConfig } }
  | { type: 'REMOVE_WORKSPACE'; payload: { id: string } }
  | { type: 'UPDATE_WORKSPACE'; payload: { id: string; updates: Partial<WorkspaceConfig> } }
  | { type: 'SET_SELECTED_TASK'; payload: { taskId: string | null } }
  | { type: 'SET_LAYOUT_MODE'; payload: { layoutMode: 'split' | 'pool-only' } };

// 存储数据结构
export interface StorageData {
  version: string;
  workspaces: Record<Workspace, Task[]>;
  currentWorkspace: Workspace;
  workspaceConfigs: WorkspaceConfig[];
  viewMode: 'week' | 'month';
  currentDate: string;
}
