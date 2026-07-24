# Design: Click Calendar Task → Scroll & Highlight in Task Pool

## Goal

When a user clicks a task in the CalendarView (left panel), the TaskPool (right panel) automatically scrolls to and highlights the corresponding task. Clicking the same task again deselects it.

## Architecture

### State Changes

**`AppState.selectedTaskId`** — already exists in `types/index.ts` but is dead state. Wire it up:

- Add `SET_SELECTED_TASK` action to `AppAction` union type
- Add reducer case: toggle off if same ID, otherwise set new ID
- Clear on `DELETE_TASK` (already handled)

### DOM Markers

Add `data-task-id={task.id}` to root elements of:
- `TaskChip` (`src/components/Calendar/Calendar.css` — used in WeekView/MonthView)
- `TaskBlock` (`src/components/Task/TaskBlock.tsx`)
- `TaskItem` (`src/components/Task/TaskItem.tsx`)

### Calendar Click Handler

In `DayRow` and `DayCell`, add `onClick` to each task component:
- Dispatch `SET_SELECTED_TASK` with `task.id`
- If `state.selectedTaskId === task.id`, dispatch with `null` (toggle off)

### TaskPool Scroll Logic

In `TaskPool.tsx`, add `useEffect` watching `state.selectedTaskId`:
1. If `null`, do nothing
2. Find which group the task belongs to (overdue/today/week/unscheduled)
3. Expand that group if collapsed
4. After DOM update, `document.querySelector([data-task-id="..."])` to find element
5. Call `element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })`

### CSS

Add `.task-item.selected` style for visual highlight (distinct from `.highlighted` which is hover-based).

## Files to Modify

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `SET_SELECTED_TASK` to `AppAction` |
| `src/reducers/appReducer.ts` | Add reducer case |
| `src/components/Task/TaskItem.tsx` | Add `data-task-id` attribute |
| `src/components/Task/TaskBlock.tsx` | Add `data-task-id` attribute |
| `src/components/Task/TaskChip.tsx` | Add `data-task-id` attribute |
| `src/components/Calendar/DayRow.tsx` | Add click handler to dispatch `SET_SELECTED_TASK` |
| `src/components/Calendar/DayCell.tsx` | Add click handler to dispatch `SET_SELECTED_TASK` |
| `src/components/Task/TaskPool.tsx` | Add `useEffect` for scroll-to-selected |
| `src/components/Task/Task.css` | Add `.task-item.selected` style |
