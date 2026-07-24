# Todos - TodoList 工具设计文档

## 概述

一个 ZTools 插件形式的 TodoList 工具，核心特点是**快捷的友好交互**，支持多工作空间、智能日期绑定、逾期任务复活等功能。

## 设计原则

1. **UI友善**：清晰的视觉层次，直观的操作反馈
2. **交互快捷**：拖拽操作、键盘快捷键、智能日期处理
3. **灵活性**：一个任务可绑定多个日期，工作空间完全隔离

## 技术栈

- React 18 + TypeScript
- Vite 构建
- Context API + useReducer 状态管理
- localStorage 本地存储

---

## 1. 数据模型

### Task（任务）

```typescript
interface Task {
  id: string;                              // 唯一标识
  title: string;                           // 任务名称
  description?: string;                    // 可选备注
  priority: 'high' | 'medium' | 'low';    // 优先级
  tags?: string[];                         // 可选标签
  dates: string[];                         // 绑定的日期列表 YYYY-MM-DD
  status: 'todo' | 'done' | 'overdue';    // 状态
  createdAt: string;                       // 创建时间
  updatedAt: string;                       // 更新时间
}
```

### 状态判断逻辑

- **todo**：任务未完成，且所有绑定日期都未过期
- **done**：任务已完成
- **overdue**：任务未完成，且至少有一个绑定日期已过期

### 逾期任务处理

- 逾期任务重新安排时，只需将任务绑定到新的日期
- 旧的日期保留在 `dates` 数组中，作为历史记录
- 系统自动根据当前日期判断状态

### Workspace（工作空间）

```typescript
type Workspace = 'work' | 'life' | 'study';
```

### AppState（应用状态）

```typescript
interface AppState {
  workspaces: Record<Workspace, Task[]>;   // 三个工作空间的任务
  currentWorkspace: Workspace;             // 当前工作空间
  viewMode: 'week' | 'month';             // 视图模式
  currentDate: string;                     // 当前查看的日期
}
```

---

## 2. 组件架构

### 组件树

```
App
├── AppProvider (Context)
│   ├── Header
│   │   ├── ViewModeToggle (周/月切换)
│   │   └── WorkspaceSwitcher (工作空间切换)
│   ├── CalendarView
│   │   ├── CalendarNav (日期导航)
│   │   ├── WeekView (默认，垂直列表)
│   │   │   └── DayRow × 7
│   │   │       └── TaskItem × N
│   │   └── MonthView (网格)
│   │       └── DayCell × 28-42
│   │           └── TaskItem × N
│   └── TaskPool (右侧待办池)
│       ├── SearchInput (搜索框)
│       ├── TaskGroup × N
│       │   └── TaskItem × N
│       └── FixedInput (底部固定输入框)
└── TaskItem (可复用组件，支持拖拽)
```

### 组件职责

| 组件 | 职责 |
|------|------|
| `AppProvider` | 状态管理，提供 Context |
| `Header` | 顶部栏，包含视图切换和工作空间切换 |
| `ViewModeToggle` | 切换周视图/月视图 |
| `WorkspaceSwitcher` | 右上角色块切换，切换工作/生活/学习 |
| `CalendarView` | 根据 viewMode 渲染 WeekView 或 MonthView |
| `CalendarNav` | 日期导航，支持前进/后退/跳转今天 |
| `WeekView` | 周视图，7天垂直排列 |
| `MonthView` | 月视图，传统日历网格 |
| `DayRow` | 周视图中的单日行 |
| `DayCell` | 月视图中的单日单元格 |
| `TaskPool` | 右侧待办池，显示所有相关任务 |
| `TaskGroup` | 任务分组，支持折叠/展开 |
| `TaskItem` | 单个任务，支持拖拽、点击编辑 |
| `SearchInput` | 搜索框，全文检索任务 |
| `FixedInput` | 底部固定输入框，新增任务 |

---

## 3. 交互设计

### 核心交互流程

#### 1. 新增任务

```
在底部固定输入框输入任务名称
→ 可选：换行添加备注
→ Ctrl+Enter 提交
→ 任务出现在待办池"未安排任务"分组
```

#### 2. 分配任务到日期

```
方式A：拖拽
  从 TaskPool 拖拽任务到 CalendarView 的某一天
  → 任务绑定到该日期
  → 显示成功提示

方式B：自动
  新增任务时可直接在输入框中设置日期
```

#### 3. 任务绑定多个日期

```
拖拽任务到另一天
  → 任务同时出现在多天
  → 日期自动合并显示（如 1/15-17）
```

#### 4. 逾期任务处理

```
当当前日期超过任务绑定的日期时
  → 任务状态自动变为 overdue
  → 视觉上显示为红色背景

复活操作：
  拖拽逾期任务到新的日期
  → 任务绑定新日期
  → 旧日期保留在 dates 数组中
  → 状态恢复为 todo（如果新日期未过期）
```

#### 5. 完成任务

```
点击任务的完成按钮
  → 任务状态变为 done
  → 视觉上显示为删除线/灰色
  → 移动到"已完成任务"分组
```

#### 6. 工作空间切换

```
点击右上角色块按钮
  → 下拉选择工作/生活/学习
  → 整个视图切换到对应工作空间的任务
  → 主题色随之变化（蓝/绿/紫）
```

### 快捷键设计

| 快捷键 | 功能 |
|--------|------|
| `W` | 切换到周视图 |
| `M` | 切换到月视图 |
| `1` | 切换到工作空间 |
| `2` | 切换到生活空间 |
| `3` | 切换到学习空间 |
| `Ctrl+Enter` | 提交新任务 |
| `←` / `→` | 日期导航前/后 |
| `T` | 跳转到今天 |

### 拖拽交互

- 拖拽时：任务半透明 + 阴影 + 轻微旋转
- 目标区域：高亮显示 + "释放以添加任务"提示
- 释放时：显示"✓ 已添加"成功提示
- 鼠标样式：pointer（可点击状态）

---

## 4. 视觉设计

### 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│  Todos  [周] [月]              [工作 ▼]                      │
├────────────────────────────────────┬────────────────────────┤
│  ◀  2024年1月15-21日  ▶     [今天]  │  待办池          6项   │
├────────────────────────────────────┤  🔍 搜索任务...        │
│                                    ├────────────────────────┤
│         CalendarView               │  ▼ 逾期任务      (1)   │
│                                    │  ┌──────────────────┐  │
│  ┌─────────────────────────────┐   │  │ ☐ 提交项目报告  │  │
│  │ 周一  1月15日     [今天]    │   │  │   [1/18]        │  │
│  │  ☐ 任务A (高)              │   │  └──────────────────┘  │
│  │  ☐ 任务B (中)              │   │  ▼ 今天的任务      (2) │
│  ├─────────────────────────────┤   │  ┌──────────────────┐  │
│  │ 周二  1月16日               │   │  │ ☐ 完成设计文档  │  │
│  │  ☐ 任务C (低)              │   │  │   [1/15-16]     │  │
│  ├─────────────────────────────┤   │  └──────────────────┘  │
│  │ ...                         │   │  ...                   │
│  └─────────────────────────────┘   │                        │
│                                    │  ┌──────────────────┐  │
│                                    │  │ 输入任务名称...  │  │
│                                    │  │ Ctrl+Enter 提交  │  │
│                                    │  └──────────────────┘  │
└────────────────────────────────────┴────────────────────────┘
```

### 工作空间视觉区分

| 工作空间 | 主题色 | 色值 |
|----------|--------|------|
| 工作 | 蓝色 | `#3B82F6` |
| 生活 | 绿色 | `#10B981` |
| 学习 | 紫色 | `#8B5CF6` |

切换工作空间时：
- 顶部栏按钮背景色变化
- 视图高亮色变化
- 任务优先级指示器使用对应主题色

### 任务状态视觉样式

| 状态 | 样式 |
|------|------|
| 待办 | 正常显示，左侧有优先级颜色条 |
| 完成 | 删除线 + 灰色背景，移到"已完成"分组 |
| 逾期 | 红色背景 + 红色日期tag |

### 优先级视觉样式

| 优先级 | 颜色 |
|--------|------|
| 高 | 红色 `#EF4444` |
| 中 | 橙色 `#F59E0B` |
| 低 | 绿色 `#10B981` |

### 日期显示

- **智能格式化**：连续日期显示为时间段（如 `1/15-17`）
- **Tag样式**：日期使用小标签显示
- **颜色区分**：逾期日期为红色tag，今天日期为主题色tag

### 响应式设计

- **桌面**：左侧日历 70%，右侧待办池 320px
- **平板**：左侧日历 60%，右侧待办池 280px
- **手机**：全屏切换视图，底部导航栏

---

## 5. 任务池设计

### 分组逻辑

任务池按以下顺序分组显示：

1. **逾期任务** - 未完成 + 日期已过，红色标识
2. **今天的任务** - 已安排 + 今天日期，主题色标识
3. **本周任务** - 已安排 + 当前周内
4. **未安排任务** - 无日期绑定，按优先级排序
5. **已完成任务** - 默认折叠，显示数量

### 搜索功能

- 全文检索：搜索任务名称、备注、日期
- 实时过滤：输入即搜索
- 搜索框位于任务池顶部

### 新增任务

- 底部固定输入框（textarea）
- 支持多行输入（任务名称 + 备注）
- Ctrl+Enter 提交
- 自动调整高度

---

## 6. 数据持久化

### 存储方案

使用 `localStorage` 存储，JSON 序列化。

### 数据结构

```typescript
interface StorageData {
  version: string;                    // 数据格式版本
  workspaces: {
    work: Task[];
    life: Task[];
    study: Task[];
  };
  currentWorkspace: Workspace;
  viewMode: 'week' | 'month';
  currentDate: string;                // YYYY-MM-DD
}
```

### 存储键

```
todos-data    // 主数据存储
```

### 自动保存策略

- **防抖保存**：状态变更后 500ms 自动保存
- **关键操作立即保存**：新增/删除任务、完成任务、切换工作空间

### 数据迁移

```typescript
const CURRENT_VERSION = '1.0.0';

function migrateData(data: any): StorageData {
  if (!data.version) {
    return migrateFromV0(data);
  }
  return data;
}
```

---

## 7. 状态管理

### 状态结构

```typescript
interface AppState {
  // 数据
  workspaces: Record<Workspace, Task[]>;
  currentWorkspace: Workspace;
  
  // UI状态
  viewMode: 'week' | 'month';
  currentDate: string;
  searchQuery: string;
  selectedTaskId: string | null;
  
  // 拖拽状态
  draggedTaskId: string | null;
  dropTargetDate: string | null;
}
```

### Actions

```typescript
type AppAction =
  | { type: 'ADD_TASK'; payload: { workspace: Workspace; task: Task } }
  | { type: 'UPDATE_TASK'; payload: { taskId: string; updates: Partial<Task> } }
  | { type: 'DELETE_TASK'; payload: { taskId: string } }
  | { type: 'COMPLETE_TASK'; payload: { taskId: string } }
  | { type: 'ADD_DATE_TO_TASK'; payload: { taskId: string; date: string } }
  | { type: 'REMOVE_DATE_FROM_TASK'; payload: { taskId: string; date: string } }
  | { type: 'SWITCH_WORKSPACE'; payload: { workspace: Workspace } }
  | { type: 'SET_VIEW_MODE'; payload: { viewMode: 'week' | 'month' } }
  | { type: 'SET_CURRENT_DATE'; payload: { date: string } }
  | { type: 'SET_SEARCH_QUERY'; payload: { query: string } }
  | { type: 'SET_DRAG_STATE'; payload: { taskId: string | null; dropTarget: string | null } }
  | { type: 'LOAD_DATA'; payload: { data: StorageData } };
```

### 自定义 Hooks

```typescript
// useTasks.ts - 任务操作
export function useTasks() {
  const { state, dispatch } = useContext(AppContext);
  
  const addTask = (title: string, description?: string) => { ... };
  const completeTask = (taskId: string) => { ... };
  const deleteTask = (taskId: string) => { ... };
  
  return { addTask, completeTask, deleteTask };
}

// useCalendar.ts - 日历操作
export function useCalendar() {
  const { state, dispatch } = useContext(AppContext);
  
  const navigate = (direction: 'prev' | 'next') => { ... };
  const goToToday = () => { ... };
  
  return { navigate, goToToday };
}
```

---

## 8. 错误处理

### 错误类型

```typescript
type AppError = 
  | { type: 'STORAGE_ERROR'; message: string }
  | { type: 'TASK_NOT_FOUND'; taskId: string }
  | { type: 'INVALID_DATE'; date: string }
  | { type: 'MAX_TASKS_EXCEEDED'; limit: number };
```

### 处理策略

| 错误类型 | 处理方式 |
|----------|----------|
| 存储错误 | 显示提示，继续使用内存状态 |
| 任务未找到 | 静默忽略，从UI移除 |
| 无效日期 | 自动修正为最近有效日期 |
| 任务数量超限 | 显示提示，阻止新增 |

### 边界情况

1. **空状态**：任务池为空时显示引导提示
2. **数据损坏**：启动时验证数据结构，损坏时重置
3. **并发操作**：使用防抖避免快速重复操作

---

## 9. 测试策略

### 测试层次

| 层次 | 覆盖范围 | 工具 |
|------|----------|------|
| 单元测试 | 工具函数、Reducer | Jest |
| 组件测试 | React组件交互 | React Testing Library |

### 关键测试用例

1. **数据模型测试**：任务创建、状态判断、日期格式化
2. **Reducer测试**：所有actions的正确处理
3. **组件测试**：点击、拖拽、搜索、过滤
4. **持久化测试**：数据保存、加载、迁移

### 覆盖率目标

- 工具函数：90%
- Reducer：85%
- 组件：70%
- 整体：80%

---

## 10. 文件结构

```
src/
├── components/
│   ├── Calendar/
│   │   ├── CalendarView.tsx
│   │   ├── WeekView.tsx
│   │   ├── MonthView.tsx
│   │   ├── DayRow.tsx
│   │   └── DayCell.tsx
│   ├── Task/
│   │   ├── TaskItem.tsx
│   │   ├── TaskPool.tsx
│   │   └── TaskGroup.tsx
│   ├── Header/
│   │   ├── Header.tsx
│   │   ├── ViewToggle.tsx
│   │   └── WorkspaceSwitcher.tsx
│   └── Common/
│       ├── SearchInput.tsx
│       └── EmptyState.tsx
├── context/
│   └── AppContext.tsx
├── hooks/
│   ├── useTasks.ts
│   ├── useCalendar.ts
│   └── useLocalStorage.ts
├── reducers/
│   └── appReducer.ts
├── utils/
│   ├── dateUtils.ts
│   ├── taskUtils.ts
│   └── storageUtils.ts
├── types/
│   └── index.ts
├── styles/
│   ├── variables.css
│   └── global.css
├── App.tsx
└── main.tsx
```

---

## 附录：视觉预览

详细的视觉预览请查看 `docs/preview/visual-design-v2.html`。

### 预览文件说明

- **周视图**：7天垂直布局，每天显示任务列表
- **月视图**：传统日历网格
- **工作空间切换**：右上角下拉菜单，支持工作/生活/学习切换
- **任务池**：右侧待办池，按分组显示，支持拖拽
- **搜索功能**：顶部搜索框，全文检索
- **新增任务**：底部固定textarea输入框

### 交互演示

- 点击按钮切换视图/工作空间
- 输入框添加任务
- hover任务在日历中高亮
- 拖拽任务到日期

---

## 设计决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 状态管理 | Context + useReducer | 平衡复杂度和可维护性，不需要额外依赖 |
| 存储方案 | localStorage | 简单，不需要云端同步 |
| 日期绑定 | 一个任务多个日期 | 灵活，支持重复任务场景 |
| 工作空间 | 完全隔离 | 避免混乱，每个空间独立管理 |
| 逾期处理 | 保留历史日期 | 有历史意义，便于追溯 |
