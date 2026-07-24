# 动态工作空间配置实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将固定工作空间改为可编辑的动态组，每个组可设置名称和配色方案

**Architecture:** 扩展AppState类型，新增WorkspaceConfig和ColorScheme类型，修改WorkspaceSwitcher支持动态渲染，创建WorkspaceSettings组件用于编辑配置

**Tech Stack:** React, TypeScript, ztools.dbStorage

## Global Constraints

- 最多支持5个组
- 使用ztools.dbStorage存储配置
- 提供7种预设配色方案
- 组的图标显示为彩色方块
- 通过Header中的设置按钮进入编辑界面

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/types/index.ts` | 扩展类型定义 |
| `src/constants/colorSchemes.ts` | 预设配色方案常量 |
| `src/reducers/appReducer.ts` | 扩展Reducer支持新actions |
| `src/components/WorkspaceSwitcher.tsx` | 修改为动态渲染 |
| `src/components/WorkspaceSettings.tsx` | 新增编辑面板组件 |
| `src/components/Header.tsx` | 添加设置按钮 |
| `src/context/AppContext.tsx` | 扩展Context支持新状态 |

---

### Task 1: 定义类型和常量

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/constants/colorSchemes.ts`

**Interfaces:**
- Consumes: 无
- Produces: WorkspaceConfig, ColorScheme, COLOR_SCHEMES

- [ ] **Step 1: 扩展类型定义**

```typescript
// src/types/index.ts

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
  dates: string[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  workspace: Workspace;
}

// 应用状态
export interface AppState {
  workspaces: Record<Workspace, Task[]>;
  currentWorkspace: Workspace;
  workspaceConfigs: WorkspaceConfig[];
  viewMode: 'week' | 'month';
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
  | { type: 'SET_CURRENT_DATE'; payload: { date: string } }
  | { type: 'SET_SEARCH_QUERY'; payload: { query: string } }
  | { type: 'SET_DRAG_STATE'; payload: { taskId: string | null; dropTarget: string | null } }
  | { type: 'LOAD_DATA'; payload: { data: Partial<AppState> } }
  | { type: 'UPDATE_WORKSPACE_CONFIGS'; payload: { configs: WorkspaceConfig[] } }
  | { type: 'ADD_WORKSPACE'; payload: { config: WorkspaceConfig } }
  | { type: 'REMOVE_WORKSPACE'; payload: { id: string } }
  | { type: 'UPDATE_WORKSPACE'; payload: { id: string; updates: Partial<WorkspaceConfig> } };

// 存储数据结构
export interface StorageData {
  version: string;
  workspaces: Record<Workspace, Task[]>;
  currentWorkspace: Workspace;
  workspaceConfigs: WorkspaceConfig[];
  viewMode: 'week' | 'month';
  currentDate: string;
}
```

- [ ] **Step 2: 创建配色方案常量**

```typescript
// src/constants/colorSchemes.ts
import { ColorScheme } from '../types';

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'teal',
    name: '青绿',
    primary: '#0F766E',
    secondary: '#14B8A6',
    light: '#6EE7B7',
    dark: '#0D9488'
  },
  {
    id: 'blue',
    name: '海洋蓝',
    primary: '#0284C7',
    secondary: '#38BDF8',
    light: '#7DD3FC',
    dark: '#0369A1'
  },
  {
    id: 'purple',
    name: '薰衣草紫',
    primary: '#7C3AED',
    secondary: '#A78BFA',
    light: '#C4B5FD',
    dark: '#6D28D9'
  },
  {
    id: 'green',
    name: '森林绿',
    primary: '#16A34A',
    secondary: '#4ADE80',
    light: '#86EFAC',
    dark: '#15803D'
  },
  {
    id: 'red',
    name: '暖阳红',
    primary: '#DC2626',
    secondary: '#F87171',
    light: '#FCA5A5',
    dark: '#B91C1C'
  },
  {
    id: 'orange',
    name: '落日橙',
    primary: '#EA580C',
    secondary: '#FB923C',
    light: '#FDBA74',
    dark: '#C2410C'
  },
  {
    id: 'pink',
    name: '玫瑰粉',
    primary: '#DB2777',
    secondary: '#F472B6',
    light: '#F9A8D4',
    dark: '#BE185D'
  }
];

export const DEFAULT_WORKSPACE_CONFIGS = [
  { id: 'work', name: '工作', colorScheme: 'teal', order: 0 },
  { id: 'life', name: '生活', colorScheme: 'orange', order: 1 },
  { id: 'study', name: '学习', colorScheme: 'purple', order: 2 }
];
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交代码**

```bash
git add src/types/index.ts src/constants/colorSchemes.ts
git commit -m "feat: add workspace config types and color scheme constants"
```

---

### Task 2: 扩展Reducer

**Files:**
- Modify: `src/reducers/appReducer.ts`

**Interfaces:**
- Consumes: WorkspaceConfig, AppAction
- Produces: 处理新actions的reducer

- [ ] **Step 1: 扩展Reducer处理新actions**

```typescript
// src/reducers/appReducer.ts
// 在现有的 case 语句后添加

case 'UPDATE_WORKSPACE_CONFIGS':
  return {
    ...state,
    workspaceConfigs: action.payload.configs
  };

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
```

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 4: 提交代码**

```bash
git add src/reducers/appReducer.ts
git commit -m "feat: extend reducer with workspace config actions"
```

---

### Task 3: 修改WorkspaceSwitcher组件

**Files:**
- Modify: `src/components/WorkspaceSwitcher.tsx`
- Modify: `src/components/Header.css`

**Interfaces:**
- Consumes: WorkspaceConfig, COLOR_SCHEMES
- Produces: 动态渲染的工作空间切换器

- [ ] **Step 1: 修改WorkspaceSwitcher组件**

```typescript
// src/components/WorkspaceSwitcher.tsx
import React from 'react';
import { WorkspaceConfig } from '../types';
import { COLOR_SCHEMES } from '../constants/colorSchemes';

interface WorkspaceSwitcherProps {
  configs: WorkspaceConfig[];
  currentWorkspace: string;
  onChange: (workspace: string) => void;
}

export function WorkspaceSwitcher({ configs, currentWorkspace, onChange }: WorkspaceSwitcherProps) {
  const sortedConfigs = [...configs].sort((a, b) => a.order - b.order);

  const getColorForScheme = (schemeId: string) => {
    const scheme = COLOR_SCHEMES.find(s => s.id === schemeId);
    return scheme?.primary || '#0F766E';
  };

  return (
    <nav className="workspace-tabs">
      {sortedConfigs.map(config => (
        <button
          key={config.id}
          className={`ws-tab ${currentWorkspace === config.id ? 'active' : ''}`}
          data-ws={config.id}
          onClick={() => onChange(config.id)}
        >
          <span
            className="ws-square"
            style={{ backgroundColor: getColorForScheme(config.colorScheme) }}
          ></span>
          {config.name}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: 更新CSS样式**

```css
/* src/components/Header.css */
/* 替换 .ws-dot 相关样式 */

.ws-square {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-right: var(--sp-1);
  vertical-align: middle;
}
```

- [ ] **Step 3: 更新Header组件使用新WorkspaceSwitcher**

```typescript
// src/components/Header.tsx
import React, { useCallback } from 'react';
import { ViewToggle } from '../components/ViewToggle';
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher';
import { SearchInput } from '../components/Common/SearchInput';
import { useAppContext } from '../context/AppContext';
import './Header.css';

export function Header() {
  const { state, dispatch } = useAppContext();
  const { viewMode } = state;

  const handleToggleView = useCallback(() => {
    const newMode = viewMode === 'week' ? 'month' : 'week';
    dispatch({ type: 'SET_VIEW_MODE', payload: { viewMode: newMode } });
  }, [dispatch, viewMode]);

  const handleWorkspaceChange = useCallback((workspace: string) => {
    dispatch({ type: 'SWITCH_WORKSPACE', payload: { workspace } });
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
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 5: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 6: 提交代码**

```bash
git add src/components/WorkspaceSwitcher.tsx src/components/Header.tsx src/components/Header.css
git commit -m "feat: update WorkspaceSwitcher to render dynamic configs"
```

---

### Task 4: 创建WorkspaceSettings组件

**Files:**
- Create: `src/components/WorkspaceSettings.tsx`
- Create: `src/components/WorkspaceSettings.css`

**Interfaces:**
- Consumes: WorkspaceConfig, COLOR_SCHEMES
- Produces: WorkspaceSettings组件

- [ ] **Step 1: 创建WorkspaceSettings组件**

```typescript
// src/components/WorkspaceSettings.tsx
import React, { useState } from 'react';
import { WorkspaceConfig } from '../types';
import { COLOR_SCHEMES } from '../constants/colorSchemes';
import './WorkspaceSettings.css';

interface WorkspaceSettingsProps {
  configs: WorkspaceConfig[];
  onUpdate: (configs: WorkspaceConfig[]) => void;
  onClose: () => void;
}

export function WorkspaceSettings({ configs, onUpdate, onClose }: WorkspaceSettingsProps) {
  const [editingConfig, setEditingConfig] = useState<WorkspaceConfig | null>(null);
  const [newName, setNewName] = useState('');
  const [selectedScheme, setSelectedScheme] = useState('teal');

  const handleAdd = () => {
    if (configs.length >= 5) {
      alert('最多支持5个组');
      return;
    }
    const newConfig: WorkspaceConfig = {
      id: `workspace-${Date.now()}`,
      name: '新组',
      colorScheme: 'teal',
      order: configs.length
    };
    onUpdate([...configs, newConfig]);
  };

  const handleDelete = (id: string) => {
    if (configs.length <= 1) {
      alert('至少保留一个组');
      return;
    }
    onUpdate(configs.filter(c => c.id !== id));
  };

  const handleEdit = (config: WorkspaceConfig) => {
    setEditingConfig(config);
    setNewName(config.name);
    setSelectedScheme(config.colorScheme);
  };

  const handleSaveEdit = () => {
    if (!editingConfig) return;
    onUpdate(configs.map(c =>
      c.id === editingConfig.id
        ? { ...c, name: newName, colorScheme: selectedScheme }
        : c
    ));
    setEditingConfig(null);
  };

  const getSchemeColor = (schemeId: string) => {
    const scheme = COLOR_SCHEMES.find(s => s.id === schemeId);
    return scheme?.primary || '#0F766E';
  };

  return (
    <div className="workspace-settings-overlay" onClick={onClose}>
      <div className="workspace-settings" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>工作空间设置</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {editingConfig ? (
          <div className="edit-form">
            <h3>编辑组</h3>
            <div className="form-group">
              <label>名称</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="输入组名称"
              />
            </div>
            <div className="form-group">
              <label>配色方案</label>
              <div className="color-scheme-grid">
                {COLOR_SCHEMES.map(scheme => (
                  <button
                    key={scheme.id}
                    className={`scheme-option ${selectedScheme === scheme.id ? 'selected' : ''}`}
                    onClick={() => setSelectedScheme(scheme.id)}
                  >
                    <span className="scheme-color" style={{ backgroundColor: scheme.primary }}></span>
                    <span className="scheme-name">{scheme.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button className="cancel-btn" onClick={() => setEditingConfig(null)}>取消</button>
              <button className="save-btn" onClick={handleSaveEdit}>保存</button>
            </div>
          </div>
        ) : (
          <>
            <div className="workspace-list">
              {configs.map(config => (
                <div key={config.id} className="workspace-item">
                  <span className="workspace-color" style={{ backgroundColor: getSchemeColor(config.colorScheme) }}></span>
                  <span className="workspace-name">{config.name}</span>
                  <button className="edit-btn" onClick={() => handleEdit(config)}>编辑</button>
                  <button className="delete-btn" onClick={() => handleDelete(config.id)}>删除</button>
                </div>
              ))}
            </div>
            <button className="add-btn" onClick={handleAdd} disabled={configs.length >= 5}>
              + 添加新组
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建WorkspaceSettings样式**

```css
/* src/components/WorkspaceSettings.css */
.workspace-settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.workspace-settings {
  background: var(--paper);
  border-radius: 12px;
  padding: 24px;
  width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.settings-header h2 {
  margin: 0;
  font-size: 18px;
  color: var(--ink);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--graphite);
  cursor: pointer;
}

.close-btn:hover {
  color: var(--ink);
}

.workspace-list {
  margin-bottom: 16px;
}

.workspace-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 8px;
}

.workspace-color {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  margin-right: 12px;
}

.workspace-name {
  flex: 1;
  font-size: 14px;
}

.edit-btn,
.delete-btn {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  margin-left: 8px;
}

.edit-btn {
  background: var(--teal);
  color: white;
  border: none;
}

.delete-btn {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--graphite);
}

.delete-btn:hover {
  border-color: var(--rose);
  color: var(--rose);
}

.add-btn {
  width: 100%;
  padding: 12px;
  background: none;
  border: 2px dashed var(--color-border);
  border-radius: 8px;
  color: var(--graphite);
  font-size: 14px;
  cursor: pointer;
}

.add-btn:hover:not(:disabled) {
  border-color: var(--teal);
  color: var(--teal);
}

.add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.edit-form h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: var(--ink);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--graphite);
}

.form-group input {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.color-scheme-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.scheme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  border: 2px solid var(--color-border);
  border-radius: 8px;
  background: none;
  cursor: pointer;
}

.scheme-option:hover {
  border-color: var(--teal);
}

.scheme-option.selected {
  border-color: var(--teal);
  background: var(--color-background-light);
}

.scheme-color {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  margin-bottom: 4px;
}

.scheme-name {
  font-size: 12px;
  color: var(--graphite);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.cancel-btn,
.save-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
}

.cancel-btn {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--graphite);
}

.save-btn {
  background: var(--teal);
  border: none;
  color: white;
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交代码**

```bash
git add src/components/WorkspaceSettings.tsx src/components/WorkspaceSettings.css
git commit -m "feat: create WorkspaceSettings component"
```

---

### Task 5: 集成设置面板

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/context/AppContext.tsx`

**Interfaces:**
- Consumes: WorkspaceSettings组件
- Produces: 完整的设置功能

- [ ] **Step 1: 在Header中添加设置按钮**

```typescript
// src/components/Header.tsx
import React, { useCallback, useState } from 'react';
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
          ⚙️
        </button>
      </div>
      {showSettings && (
        <WorkspaceSettings
          configs={state.workspaceConfigs}
          onUpdate={handleUpdateConfigs}
          onClose={() => setShowSettings(false)}
        />
      )}
    </header>
  );
}
```

- [ ] **Step 2: 添加设置按钮样式**

```css
/* src/components/Header.css */
.settings-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-out);
}

.settings-btn:hover {
  background: var(--color-background-light);
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 5: 提交代码**

```bash
git add src/components/Header.tsx src/components/Header.css
git commit -m "feat: integrate WorkspaceSettings panel in Header"
```

---

### Task 6: 实现配置存储

**Files:**
- Modify: `src/context/AppContext.tsx`
- Modify: `src/utils/storageUtils.ts`

**Interfaces:**
- Consumes: ztools.dbStorage
- Produces: 配置持久化存储

- [ ] **Step 1: 更新storageUtils**

```typescript
// src/utils/storageUtils.ts
import { StorageData, WorkspaceConfig } from '../types';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

const STORAGE_KEY = 'todos-data';
const WORKSPACE_CONFIG_KEY = 'workspace-configs';

// 保存工作空间配置到ztools.dbStorage
export const saveWorkspaceConfigs = (configs: WorkspaceConfig[]): void => {
  try {
    if (window.ztools?.dbStorage) {
      window.ztools.dbStorage.setItem(WORKSPACE_CONFIG_KEY, JSON.stringify(configs));
    }
  } catch (error) {
    console.error('Failed to save workspace configs:', error);
  }
};

// 从ztools.dbStorage加载工作空间配置
export const loadWorkspaceConfigs = (): WorkspaceConfig[] => {
  try {
    if (window.ztools?.dbStorage) {
      const saved = window.ztools.dbStorage.getItem(WORKSPACE_CONFIG_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    }
  } catch (error) {
    console.error('Failed to load workspace configs:', error);
  }
  return DEFAULT_WORKSPACE_CONFIGS;
};

// ... 保持现有的其他函数不变
```

- [ ] **Step 2: 更新AppContext**

```typescript
// src/context/AppContext.tsx
import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { AppState, AppAction } from '../types';
import { appReducer } from '../reducers/appReducer';
import { loadData, saveData } from '../utils/storageUtils';
import { loadWorkspaceConfigs, saveWorkspaceConfigs } from '../utils/storageUtils';

const initialState: AppState = {
  workspaces: { work: [], life: [], study: [] },
  currentWorkspace: 'work',
  workspaceConfigs: loadWorkspaceConfigs(),
  viewMode: 'week',
  currentDate: new Date().toISOString().split('T')[0],
  searchQuery: '',
  selectedTaskId: null,
  draggedTaskId: null,
  dropTargetDate: null
};

// ... 保持现有的context代码

// 在useEffect中添加workspaceConfigs的保存
useEffect(() => {
  saveWorkspaceConfigs(state.workspaceConfigs);
}, [state.workspaceConfigs]);
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 5: 提交代码**

```bash
git add src/context/AppContext.tsx src/utils/storageUtils.ts
git commit -m "feat: implement workspace configs persistence with ztools.dbStorage"
```

---

### Task 7: 添加深色主题支持

**Files:**
- Modify: `src/styles/variables.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: window.ztools.isDarkColors
- Produces: 深色主题支持

- [ ] **Step 1: 添加深色主题变量**

```css
/* src/styles/variables.css */
:root {
  /* 保持现有的浅色主题变量不变 */
}

[data-theme="dark"] {
  --paper: #1C1917;
  --ink: #F7F5F0;
  --graphite: #A8A29E;
  --clay: #57534E;
  --color-background: var(--paper);
  --color-text: var(--ink);
  --color-text-secondary: var(--graphite);
  --color-border: rgba(168, 162, 158, 0.2);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 2: 添加主题初始化**

```typescript
// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles'

// 初始化主题
const initTheme = () => {
  const isDark = window.ztools?.isDarkColors() ?? false;
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
};

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 5: 提交代码**

```bash
git add src/styles/variables.css src/main.tsx
git commit -m "feat: add dark theme support"
```

---

### Task 8: 更新测试用例

**Files:**
- Modify: `src/components/WorkspaceSwitcher.test.tsx`
- Create: `src/components/WorkspaceSettings.test.tsx`

**Interfaces:**
- Consumes: WorkspaceConfig, COLOR_SCHEMES
- Produces: 完整的测试覆盖

- [ ] **Step 1: 更新WorkspaceSwitcher测试**

```typescript
// src/components/WorkspaceSwitcher.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

describe('WorkspaceSwitcher', () => {
  const mockOnChange = jest.fn();

  it('renders workspace buttons', () => {
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="work"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.getByText('生活')).toBeInTheDocument();
    expect(screen.getByText('学习')).toBeInTheDocument();
  });

  it('calls onChange when workspace is clicked', () => {
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="work"
        onChange={mockOnChange}
      />
    );

    fireEvent.click(screen.getByText('生活'));
    expect(mockOnChange).toHaveBeenCalledWith('life');
  });

  it('highlights current workspace', () => {
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="life"
        onChange={mockOnChange}
      />
    );

    const lifeTab = screen.getByText('生活').closest('.ws-tab');
    expect(lifeTab).toHaveClass('active');
  });

  it('displays colored squares for each workspace', () => {
    render(
      <WorkspaceSwitcher
        configs={DEFAULT_WORKSPACE_CONFIGS}
        currentWorkspace="work"
        onChange={mockOnChange}
      />
    );

    const squares = document.querySelectorAll('.ws-square');
    expect(squares.length).toBe(3);
  });
});
```

- [ ] **Step 2: 创建WorkspaceSettings测试**

```typescript
// src/components/WorkspaceSettings.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSettings } from './WorkspaceSettings';
import { DEFAULT_WORKSPACE_CONFIGS } from '../constants/colorSchemes';

describe('WorkspaceSettings', () => {
  const mockOnUpdate = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnUpdate.mockClear();
    mockOnClose.mockClear();
  });

  it('renders workspace list', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('工作空间设置')).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.getByText('生活')).toBeInTheDocument();
    expect(screen.getByText('学习')).toBeInTheDocument();
  });

  it('adds new workspace when add button is clicked', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
      />
    );

    fireEvent.click(screen.getByText('+ 添加新组'));
    expect(mockOnUpdate).toHaveBeenCalled();
  });

  it('deletes workspace when delete button is clicked', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
      />
    );

    const deleteButtons = screen.getAllByText('删除');
    fireEvent.click(deleteButtons[0]);
    expect(mockOnUpdate).toHaveBeenCalled();
  });

  it('closes when overlay is clicked', () => {
    render(
      <WorkspaceSettings
        configs={DEFAULT_WORKSPACE_CONFIGS}
        onUpdate={mockOnUpdate}
        onClose={mockOnClose}
      />
    );

    fireEvent.click(screen.getByText('工作空间设置').closest('.workspace-settings-overlay')!);
    expect(mockOnClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 4: 提交代码**

```bash
git add src/components/WorkspaceSwitcher.test.tsx src/components/WorkspaceSettings.test.tsx
git commit -m "test: add tests for workspace components"
```

---

## 完成检查

1. 所有类型定义正确
2. Reducer正确处理所有新actions
3. WorkspaceSwitcher动态渲染组标签
4. WorkspaceSettings支持添加、删除、编辑功能
5. 配置使用ztools.dbStorage持久化存储
6. 深色主题正常工作
7. 所有测试通过
8. 代码符合项目规范

## 下一步

实现完成后，建议进行以下验证：
1. 手动测试所有功能
2. 检查深色主题下的显示效果
3. 验证配置持久化存储
4. 运行完整的测试套件
