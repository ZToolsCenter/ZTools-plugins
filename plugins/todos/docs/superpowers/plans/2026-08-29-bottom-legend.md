# Bottom Legend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent bottom legend bar and keyboard shortcut panel to guide users through hidden interactions.

**Architecture:** Two new components (`BottomLegend` + `KeyboardShortcutPanel`) embedded in `TodoApp`, with `?` keyboard shortcut registration.

**Tech Stack:** React, TypeScript, CSS (design tokens from `variables.css`), lucide-react icons.

## Global Constraints

- Use existing design tokens from `src/styles/variables.css` (no new colors/sizes)
- Follow existing component patterns (functional components, CSS modules or plain CSS)
- Icons from `lucide-react` (already a dependency)
- No new dependencies

---

### Task 1: KeyboardShortcutPanel Component

**Files:**
- Create: `src/components/KeyboardShortcutPanel.tsx`
- Create: `src/components/KeyboardShortcutPanel.css`

**Interfaces:**
- Consumes: `visible: boolean`, `onClose: () => void`
- Produces: `<KeyboardShortcutPanel visible={bool} onClose={fn} />`

- [ ] **Step 1: Create KeyboardShortcutPanel.css**

```css
.shortcut-panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 150ms var(--ease-out);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.shortcut-panel {
  background: var(--paper);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--sp-6);
  min-width: 420px;
  max-width: 520px;
  box-shadow: var(--shadow-lg);
}

.shortcut-panel h3 {
  font-family: var(--font-display);
  font-size: var(--font-size-lg);
  font-weight: 500;
  color: var(--ink);
  margin-bottom: var(--sp-4);
}

.shortcut-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-6);
}

.shortcut-section h4 {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--graphite);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--sp-3);
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-1) 0;
}

.shortcut-label {
  font-size: var(--font-size-sm);
  color: var(--ink);
}

.shortcut-keys {
  display: flex;
  gap: var(--sp-1);
}

.shortcut-key {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--graphite);
  background: var(--color-background-light);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  line-height: 1.4;
}

.gesture-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) 0;
}

.gesture-icon {
  width: 20px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  flex-shrink: 0;
}

.gesture-icon.complete {
  background: rgba(22, 163, 74, 0.15);
  color: var(--color-success);
}

.gesture-icon.delete {
  background: rgba(220, 38, 38, 0.15);
  color: var(--color-danger);
}

.gesture-icon.edit {
  background: var(--teal-muted);
  color: var(--teal);
}

.gesture-icon.drag {
  background: rgba(79, 70, 229, 0.15);
  color: var(--indigo);
}

.gesture-label {
  font-size: var(--font-size-sm);
  color: var(--ink);
}

.shortcut-panel-close {
  margin-top: var(--sp-4);
  text-align: right;
}

.shortcut-panel-close button {
  font-size: var(--font-size-xs);
  color: var(--clay);
  padding: var(--sp-1) var(--sp-2);
}

.shortcut-panel-close button:hover {
  color: var(--ink);
}
```

- [ ] **Step 2: Create KeyboardShortcutPanel.tsx**

```tsx
import React from 'react';
import { MousePointerClick, Pencil, ArrowRight, Keyboard } from 'lucide-react';
import './KeyboardShortcutPanel.css';

interface KeyboardShortcutPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function KeyboardShortcutPanel({ visible, onClose }: KeyboardShortcutPanelProps) {
  if (!visible) return null;

  return (
    <div className="shortcut-panel-overlay" onClick={onClose}>
      <div className="shortcut-panel" onClick={(e) => e.stopPropagation()}>
        <h3>操作指引</h3>
        <div className="shortcut-columns">
          <div className="shortcut-section">
            <h4>快捷键</h4>
            <div className="shortcut-item">
              <span className="shortcut-label">切换视图</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Ctrl</span>
                <span className="shortcut-key">E</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">搜索</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Ctrl</span>
                <span className="shortcut-key">F</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">清空搜索</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Esc</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">提交任务</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">Ctrl</span>
                <span className="shortcut-key">Enter</span>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-label">操作指引</span>
              <div className="shortcut-keys">
                <span className="shortcut-key">?</span>
              </div>
            </div>
          </div>
          <div className="shortcut-section">
            <h4>手势操作</h4>
            <div className="gesture-item">
              <div className="gesture-icon complete">
                <MousePointerClick size={12} />
              </div>
              <span className="gesture-label">右键右滑 → 完成</span>
            </div>
            <div className="gesture-item">
              <div className="gesture-icon delete">
                <MousePointerClick size={12} />
              </div>
              <span className="gesture-label">右键左滑 → 删除</span>
            </div>
            <div className="gesture-item">
              <div className="gesture-icon edit">
                <Pencil size={12} />
              </div>
              <span className="gesture-label">双击 → 编辑标题/描述</span>
            </div>
            <div className="gesture-item">
              <div className="gesture-icon drag">
                <ArrowRight size={12} />
              </div>
              <span className="gesture-label">拖拽 → 分配日期</span>
            </div>
          </div>
        </div>
        <div className="shortcut-panel-close">
          <button onClick={onClose}>关闭 (Esc)</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/KeyboardShortcutPanel.tsx src/components/KeyboardShortcutPanel.css
git commit -m "feat: add KeyboardShortcutPanel component"
```

---

### Task 2: BottomLegend Component

**Files:**
- Create: `src/components/BottomLegend.tsx`
- Create: `src/components/BottomLegend.css`

**Interfaces:**
- Consumes: `onShowShortcuts: () => void`
- Produces: `<BottomLegend onShowShortcuts={fn} />`

- [ ] **Step 1: Create BottomLegend.css**

```css
.bottom-legend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-5);
  height: 28px;
  padding: 0 var(--sp-4);
  border-top: 1px solid var(--color-border-light);
  background: var(--paper);
  flex-shrink: 0;
  user-select: none;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--clay);
  font-size: 9px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.legend-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.legend-icon.swipe-right {
  color: var(--color-success);
}

.legend-icon.swipe-left {
  color: var(--color-danger);
}

.legend-icon.edit {
  color: var(--teal);
}

.legend-icon.drag {
  color: var(--indigo);
}

.legend-shortcut-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--clay);
  font-size: 9px;
  letter-spacing: 0.02em;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: all var(--duration-fast) var(--ease-out);
}

.legend-shortcut-btn:hover {
  background: var(--color-hover-bg);
  color: var(--ink);
}

.legend-shortcut-btn .legend-key {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  background: var(--color-background-light);
  border: 1px solid var(--color-border-light);
  border-radius: 2px;
  padding: 0 3px;
  line-height: 1.4;
}
```

- [ ] **Step 2: Create BottomLegend.tsx**

```tsx
import React from 'react';
import { MousePointerClick, Pencil, ArrowRight, Keyboard } from 'lucide-react';
import './BottomLegend.css';

interface BottomLegendProps {
  onShowShortcuts: () => void;
}

export function BottomLegend({ onShowShortcuts }: BottomLegendProps) {
  return (
    <div className="bottom-legend">
      <div className="legend-item">
        <span className="legend-icon swipe-right">
          <MousePointerClick size={10} />
        </span>
        <span>右键右滑 完成</span>
      </div>
      <div className="legend-item">
        <span className="legend-icon swipe-left">
          <MousePointerClick size={10} />
        </span>
        <span>右键左滑 删除</span>
      </div>
      <div className="legend-item">
        <span className="legend-icon edit">
          <Pencil size={10} />
        </span>
        <span>双击编辑</span>
      </div>
      <div className="legend-item">
        <span className="legend-icon drag">
          <ArrowRight size={10} />
        </span>
        <span>拖拽分配日期</span>
      </div>
      <button className="legend-shortcut-btn" onClick={onShowShortcuts}>
        <span className="legend-key">?</span>
        <span>快捷键</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/BottomLegend.tsx src/components/BottomLegend.css
git commit -m "feat: add BottomLegend component"
```

---

### Task 3: Register `?` Shortcut and Integrate Components

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts` (add `onShowShortcuts` handler)
- Modify: `src/components/TodoApp.tsx` (add state + render components)

**Interfaces:**
- Consumes: `BottomLegend`, `KeyboardShortcutPanel`
- Produces: `?` shortcut triggers panel visibility toggle

- [ ] **Step 1: Update useKeyboardShortcuts.ts**

Add `onShowShortcuts` to the interface and handler:

```ts
import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onSave?: () => void;
  onDelete?: () => void;
  onSearch?: () => void;
  onToggleView?: () => void;
  onEscape?: () => void;
  onShowShortcuts?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl/Cmd + S: 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handlers.onSave?.();
    }

    // Ctrl/Cmd + D: 删除
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      handlers.onDelete?.();
    }

    // Ctrl/Cmd + F: 搜索
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      handlers.onSearch?.();
    }

    // Ctrl/Cmd + E: 切换视图
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      handlers.onToggleView?.();
    }

    // Escape: 取消/关闭
    if (e.key === 'Escape') {
      handlers.onEscape?.();
    }

    // ?: 显示操作指引
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Only trigger if not typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        handlers.onShowShortcuts?.();
      }
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

- [ ] **Step 2: Update TodoApp.tsx**

Add state management and render both components:

```tsx
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
```

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts src/components/TodoApp.tsx
git commit -m "feat: integrate BottomLegend and KeyboardShortcutPanel"
```

---

### Task 4: Add BottomLegend test

**Files:**
- Create: `src/components/BottomLegend.test.tsx`

- [ ] **Step 1: Create test file**

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomLegend } from './BottomLegend';

describe('BottomLegend', () => {
  it('renders all legend items', () => {
    render(<BottomLegend onShowShortcuts={() => {}} />);
    expect(screen.getByText('右键右滑 完成')).toBeInTheDocument();
    expect(screen.getByText('右键左滑 删除')).toBeInTheDocument();
    expect(screen.getByText('双击编辑')).toBeInTheDocument();
    expect(screen.getByText('拖拽分配日期')).toBeInTheDocument();
  });

  it('renders shortcut button', () => {
    render(<BottomLegend onShowShortcuts={() => {}} />);
    expect(screen.getByText('快捷键')).toBeInTheDocument();
  });

  it('calls onShowShortcuts when shortcut button is clicked', () => {
    const onShowShortcuts = jest.fn();
    render(<BottomLegend onShowShortcuts={onShowShortcuts} />);
    fireEvent.click(screen.getByText('快捷键'));
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx jest --testPathPattern="BottomLegend" --no-coverage`
Expected: All 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/components/BottomLegend.test.tsx
git commit -m "test: add BottomLegend tests"
```
