# DevTools Layout Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group DevTools into top-level tabs and show a secondary tool switcher for the active group.

**Architecture:** Keep all tool execution in `src/DevTools/tools.js` unchanged. Add lightweight group metadata in `src/DevTools/index.jsx`, derive the active group from `activeToolId`, and reuse the existing `handleSelectTool` reset behavior for all group and tool switches.

**Tech Stack:** React 19, Vite, plain CSS, existing uTools preload integration.

---

## File Structure

- Modify: `src/DevTools/index.jsx`
  - Add `TOOL_GROUPS` metadata.
  - Add active-group derivation.
  - Replace top navigation with group tabs.
  - Add secondary tool switcher inside `<main>`.
- Modify: `src/DevTools/index.css`
  - Keep dark topbar visual language.
  - Add compact secondary switcher styles.
  - Preserve mobile horizontal scrolling without overlap.
- Verify: `npm run build`
  - Confirm Vite production build succeeds and `dist` is regenerated.

## Tasks

### Task 1: Add Group Metadata and Navigation Rendering

**Files:**
- Modify: `src/DevTools/index.jsx`

- [ ] **Step 1: Add group metadata after `DEFAULT_TOOL_ID`**

```js
const TOOL_GROUPS = [
  { id: 'conversion', name: '常用转换', defaultToolId: 'json', toolIds: ['json', 'base64', 'url', 'union-decode', 'qrcode', 'uuid'] },
  { id: 'productivity', name: '效率工具', defaultToolId: 'crontab', toolIds: ['crontab', 'variable-naming'] },
  { id: 'other', name: '其他工具', defaultToolId: 'time', toolIds: ['time', 'calc', 'calendar'] }
]
```

- [ ] **Step 2: Derive `activeGroup` and `activeGroupTools` inside `DevTools`**

```js
const activeGroup = useMemo(() => {
  return TOOL_GROUPS.find((group) => group.toolIds.includes(activeToolId)) ?? TOOL_GROUPS[0]
}, [activeToolId])
const activeGroupTools = useMemo(() => {
  return activeGroup.toolIds.map((toolId) => getToolById(toolId)).filter(Boolean)
}, [activeGroup])
```

- [ ] **Step 3: Add `handleSelectGroup` after `handleSelectTool`**

```js
const handleSelectGroup = (group) => {
  if (group.toolIds.includes(activeToolId)) return
  handleSelectTool(group.defaultToolId)
}
```

- [ ] **Step 4: Replace top navigation with top-level group tabs**

```jsx
<nav className='dt__nav' aria-label='工具分组'>
  {TOOL_GROUPS.map((group) => (
    <button
      key={group.id}
      type='button'
      className={group.id === activeGroup.id ? 'is-active' : ''}
      onClick={() => handleSelectGroup(group)}
    >
      {group.name}
    </button>
  ))}
</nav>
```

- [ ] **Step 5: Add the secondary tool switcher as the first child of `<main>`**

```jsx
<nav className='dt__tool-switcher' aria-label={`${activeGroup.name}工具`}>
  {activeGroupTools.map((tool) => (
    <button
      key={tool.id}
      type='button'
      className={tool.id === activeToolId ? 'is-active' : ''}
      onClick={() => handleSelectTool(tool.id)}
    >
      <span>{tool.name}</span>
      <small>{tool.description}</small>
    </button>
  ))}
</nav>
```

- [ ] **Step 6: Run build after JSX changes**

Run: `npm run build`
Expected: Vite reports a successful production build.

### Task 2: Add Secondary Switcher Styles

**Files:**
- Modify: `src/DevTools/index.css`

- [ ] **Step 1: Add styles after the `.dt__main` block**

```css
.dt__tool-switcher {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
  flex-shrink: 0;
}

.dt__tool-switcher::-webkit-scrollbar {
  display: none;
}

.dt__tool-switcher button {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 112px;
  max-width: 180px;
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s, background 0.14s, color 0.14s;
}

.dt__tool-switcher button:hover {
  border-color: #c4c4c8;
  background: #fafafa;
}

.dt__tool-switcher button.is-active {
  border-color: var(--accent);
  background: #eef2ff;
  color: var(--accent);
}

.dt__tool-switcher span {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}

.dt__tool-switcher small {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Add mobile constraints inside the existing media query**

```css
.dt__tool-switcher button {
  min-width: 104px;
  padding: 8px 10px;
}

.dt__tool-switcher small {
  display: none;
}
```

- [ ] **Step 3: Run build after CSS changes**

Run: `npm run build`
Expected: Vite reports a successful production build.

### Task 3: Verify Group Behavior

**Files:**
- Verify: `src/DevTools/index.jsx`
- Verify: `src/DevTools/index.css`

- [ ] **Step 1: Check rendered group labels exist in source**

Run: `npm run build`
Expected: build succeeds with no StandardJS or Vite errors.

- [ ] **Step 2: Manual UI verification**

Open the Vite app or uTools plugin and verify:

```text
常用转换 -> JSON, Base64, URL, 返回值解压, 二维码, UUID
效率工具 -> Crontab, 变量命名
其他工具 -> 时间戳, 计算器, 日历
```

- [ ] **Step 3: Special tool checks**

Verify these visible behaviors still work:

```text
JSON shows editor plus preview and keeps the JSON footer.
二维码 keeps 生成二维码 and 解析图片 inner tabs.
Crontab shows examples when there is no parsed result.
变量命名 keeps App ID, 密钥, 保存配置, and 生成变量名 controls.
```

## Self-Review

Spec coverage: the plan implements top-level tabs, secondary tool switching, requested group membership, default tools, existing special-tool preservation, and production build verification.

Placeholder scan: the plan contains concrete paths, code blocks, commands, and expected outcomes.

Type consistency: group fields are consistently named `id`, `name`, `defaultToolId`, and `toolIds`; JSX uses existing `getToolById`, `activeToolId`, and `handleSelectTool` contracts.
