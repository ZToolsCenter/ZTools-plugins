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
  /** 子任务指向所属主任务的 id；为空表示主任务。仅支持两层，子任务不再有子任务 */
  parentId?: string | null;
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
  /** 拖拽来源日期：非空表示从日历的某一天拖出，删除只作用于当天安排 */
  dragSourceDate: string | null;
  /** 任务色条取色方式 */
  taskColorMode: TaskColorMode;
}

/** 任务色条取色方式：按完成状态（一眼看出没做完）/ 按任务随机配色（区分不同任务） */
export type TaskColorMode = 'status' | 'random';

// 应用 Actions
export type AppAction =
  | { type: 'ADD_TASK'; payload: { workspace: Workspace; task: Task } }
  | { type: 'ADD_SUBTASK'; payload: { workspace: Workspace; task: Task } }
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
  | { type: 'SET_DRAG_STATE'; payload: { taskId: string | null; dropTarget: string | null; sourceDate?: string | null } }
  | { type: 'LOAD_DATA'; payload: { data: Partial<AppState> } }
  | { type: 'UPDATE_WORKSPACE_CONFIGS'; payload: { configs: WorkspaceConfig[] } }
  | { type: 'ADD_WORKSPACE'; payload: { config: WorkspaceConfig } }
  | { type: 'REMOVE_WORKSPACE'; payload: { id: string } }
  | { type: 'UPDATE_WORKSPACE'; payload: { id: string; updates: Partial<WorkspaceConfig> } }
  | { type: 'SET_SELECTED_TASK'; payload: { taskId: string | null } }
  | { type: 'SET_LAYOUT_MODE'; payload: { layoutMode: 'split' | 'pool-only' } }
  | { type: 'SET_TASK_COLOR_MODE'; payload: { taskColorMode: TaskColorMode } };

// 存储数据结构
export interface StorageData {
  version: string;
  workspaces: Record<Workspace, Task[]>;
  currentWorkspace: Workspace;
  workspaceConfigs: WorkspaceConfig[];
  viewMode: 'week' | 'month';
  /** 布局模式：日历 + 待办（split）/ 仅待办池（pool-only），属于用户偏好，需要跨重启保留 */
  layoutMode: 'split' | 'pool-only';
  /** 日历内任务的展示密度：紧凑标签（tag）/ 详细（block） */
  taskViewMode: 'tag' | 'block';
  /** 任务色条取色方式，属于用户偏好，需要跨重启保留 */
  taskColorMode: TaskColorMode;
  currentDate: string;
}
