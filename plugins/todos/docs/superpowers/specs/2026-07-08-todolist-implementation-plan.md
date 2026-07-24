# Todos - TodoList 实现计划

## 概述

基于设计文档 `docs/superpowers/specs/2026-07-08-todolist-design.md`，创建详细的实现计划。

## 技术栈

- React 18 + TypeScript
- Vite 构建
- Context API + useReducer
- localStorage
- Jest + React Testing Library

---

## 阶段1：基础架构搭建

### 任务1.1：项目初始化
**预计时间**：30分钟

- [ ] 更新 `package.json`，添加测试依赖
- [ ] 配置 Jest 和 React Testing Library
- [ ] 创建基础目录结构
- [ ] 更新 `tsconfig.json` 路径别名

### 任务1.2：类型定义
**预计时间**：20分钟

- [ ] 创建 `src/types/index.ts`
- [ ] 定义 `Task`、`Workspace`、`AppState`、`AppAction` 类型

### 任务1.3：工具函数
**预计时间**：40分钟

- [ ] 创建 `src/utils/dateUtils.ts`
  - `formatDate(date: string): string`
  - `formatWeekRange(startDate: string): string`
  - `isOverdue(date: string): boolean`
  - `isToday(date: string): boolean`
  - `getWeekStart(date: Date): Date`
  - `generateId(): string`

- [ ] 创建 `src/utils/taskUtils.ts`
  - `createTask(title: string, description?: string): Task`
  - `getTaskStatus(task: Task): 'todo' | 'done' | 'overdue'`
  - `formatTaskDates(dates: string[]): string`
  - `sortTasksByPriority(tasks: Task[]): Task[]`

- [ ] 创建 `src/utils/storageUtils.ts`
  - `loadData(): StorageData | null`
  - `saveData(data: StorageData): void`
  - `migrateData(data: any): StorageData`

---

## 阶段2：状态管理

### 任务2.1：Reducer实现
**预计时间**：60分钟

- [ ] 创建 `src/reducers/appReducer.ts`
- [ ] 实现所有 Actions：
  - `ADD_TASK`
  - `UPDATE_TASK`
  - `DELETE_TASK`
  - `COMPLETE_TASK`
  - `ADD_DATE_TO_TASK`
  - `REMOVE_DATE_FROM_TASK`
  - `SWITCH_WORKSPACE`
  - `SET_VIEW_MODE`
  - `SET_CURRENT_DATE`
  - `SET_SEARCH_QUERY`
  - `SET_DRAG_STATE`
  - `LOAD_DATA`

### 任务2.2：Context Provider
**预计时间**：30分钟

- [ ] 创建 `src/context/AppContext.tsx`
- [ ] 实现 `AppProvider` 组件
- [ ] 集成自动保存逻辑（防抖500ms）

### 任务2.3：自定义Hooks
**预计时间**：40分钟

- [ ] 创建 `src/hooks/useTasks.ts`
  - `addTask(title, description?)`
  - `completeTask(taskId)`
  - `deleteTask(taskId)`

- [ ] 创建 `src/hooks/useCalendar.ts`
  - `navigate(direction)`
  - `goToToday()`
  - `getCurrentWeek()`
  - `getCurrentMonth()`

- [ ] 创建 `src/hooks/useLocalStorage.ts`
  - 封装 localStorage 操作

---

## 阶段3：组件开发

### 任务3.1：通用组件
**预计时间**：30分钟

- [ ] 创建 `src/components/Common/SearchInput.tsx`
- [ ] 创建 `src/components/Common/EmptyState.tsx`

### 任务3.2：Header组件
**预计时间**：40分钟

- [ ] 创建 `src/components/Header/Header.tsx`
- [ ] 创建 `src/components/Header/ViewToggle.tsx`
- [ ] 创建 `src/components/Header/WorkspaceSwitcher.tsx`

### 任务3.3：Task组件
**预计时间**：60分钟

- [ ] 创建 `src/components/Task/TaskItem.tsx`
  - 显示任务标题、优先级、日期
  - 支持点击完成
  - 支持拖拽

- [ ] 创建 `src/components/Task/TaskGroup.tsx`
  - 分组标题和计数
  - 折叠/展开功能

- [ ] 创建 `src/components/Task/TaskPool.tsx`
  - 搜索框
  - 分组列表
  - 底部固定输入框

### 任务3.4：Calendar组件
**预计时间**：80分钟

- [ ] 创建 `src/components/Calendar/CalendarView.tsx`
  - 根据 viewMode 切换 WeekView/MonthView

- [ ] 创建 `src/components/Calendar/CalendarNav.tsx`
  - 日期导航
  - 今天按钮

- [ ] 创建 `src/components/Calendar/WeekView.tsx`
  - 7天垂直布局
  - 每天显示任务列表

- [ ] 创建 `src/components/Calendar/MonthView.tsx`
  - 传统日历网格
  - 每个单元格显示任务

- [ ] 创建 `src/components/Calendar/DayRow.tsx`
  - 周视图中的单日行

- [ ] 创建 `src/components/Calendar/DayCell.tsx`
  - 月视图中的单日单元格

---

## 阶段4：交互功能

### 任务4.1：拖拽功能
**预计时间**：50分钟

- [ ] 实现 HTML5 Drag and Drop API
- [ ] 从 TaskPool 拖拽到 CalendarView
- [ ] 拖拽视觉反馈（阴影、高亮）
- [ ] 释放时添加日期绑定

### 任务4.2：搜索功能
**预计时间**：20分钟

- [ ] 实现全文检索逻辑
- [ ] 搜索任务名称、备注、日期
- [ ] 实时过滤显示

### 任务4.3：快捷键
**预计时间**：20分钟

- [ ] 实现键盘快捷键监听
- [ ] W/M 切换视图
- [ ] 1/2/3 切换工作空间
- [ ] ←/→ 日期导航
- [ ] T 跳转今天
- [ ] Ctrl+Enter 提交任务

---

## 阶段5：样式开发

### 任务5.1：基础样式
**预计时间**：30分钟

- [ ] 创建 `src/styles/variables.css`（CSS变量）
- [ ] 创建 `src/styles/global.css`（全局样式）
- [ ] 定义工作空间主题色

### 任务5.2：组件样式
**预计时间**：60分钟

- [ ] Header 样式
- [ ] CalendarView 样式（周视图、月视图）
- [ ] TaskPool 样式（分组、任务项）
- [ ] 拖拽交互样式
- [ ] 响应式样式

### 任务5.3：动画效果
**预计时间**：20分钟

- [ ] 拖拽动画
- [ ] 高亮效果
- [ ] 过渡动画

---

## 阶段6：测试

### 任务6.1：单元测试
**预计时间**：60分钟

- [ ] 工具函数测试（dateUtils, taskUtils, storageUtils）
- [ ] Reducer 测试（所有 actions）
- [ ] 边界情况测试

### 任务6.2：组件测试
**预计时间**：60分钟

- [ ] TaskItem 测试
- [ ] TaskPool 测试
- [ ] CalendarView 测试
- [ ] 拖拽交互测试

---

## 阶段7：集成与优化

### 任务7.1：集成测试
**预计时间**：30分钟

- [ ] 完整用户流程测试
- [ ] 数据持久化测试
- [ ] 跨浏览器兼容性

### 任务7.2：性能优化
**预计时间**：20分钟

- [ ] React.memo 优化
- [ ] useMemo/useCallback 优化
- [ ] 虚拟列表（如果任务量大）

### 任务7.3：Bug修复
**预计时间**：30分钟

- [ ] 修复发现的问题
- [ ] 优化用户体验

---

## 实现顺序建议

### 第一批（核心功能）
1. 阶段1：基础架构搭建
2. 阶段2：状态管理
3. 阶段3.1-3.2：通用组件和Header
4. 阶段3.3：Task组件（基础）
5. 阶段3.4：Calendar组件（基础）
6. 阶段5.1-5.2：基础和组件样式

### 第二批（交互功能）
7. 阶段4.1：拖拽功能
8. 阶段4.2：搜索功能
9. 阶段4.3：快捷键
10. 阶段5.3：动画效果

### 第三批（测试与优化）
11. 阶段6：测试
12. 阶段7：集成与优化

---

## 预计总时间

| 阶段 | 预计时间 |
|------|----------|
| 阶段1：基础架构 | 90分钟 |
| 阶段2：状态管理 | 130分钟 |
| 阶段3：组件开发 | 210分钟 |
| 阶段4：交互功能 | 90分钟 |
| 阶段5：样式开发 | 110分钟 |
| 阶段6：测试 | 120分钟 |
| 阶段7：集成优化 | 80分钟 |
| **总计** | **约13小时** |

---

## 验证检查点

### 检查点1：基础功能完成
- [ ] 可以新增任务
- [ ] 可以切换工作空间
- [ ] 可以切换周/月视图
- [ ] 数据保存到 localStorage

### 检查点2：交互功能完成
- [ ] 拖拽任务到日期
- [ ] 搜索任务
- [ ] 键盘快捷键工作
- [ ] hover高亮效果

### 检查点3：视觉效果完成
- [ ] 布局符合设计
- [ ] 颜色主题正确
- [ ] 动画流畅
- [ ] 响应式正常

### 检查点4：测试通过
- [ ] 单元测试通过
- [ ] 组件测试通过
- [ ] 覆盖率达标

---

## 注意事项

1. **遵循现有代码风格**：查看 `src/Hello/`、`src/Read/`、`src/Write/` 的代码风格
2. **使用 CSS 变量**：ZTools 提供了主题变量支持
3. **保持轻量级**：不引入额外 UI 库
4. **渐进式开发**：先实现核心功能，再添加交互和动画
5. **测试驱动**：关键功能先写测试

---

## 相关文件

- 设计文档：`docs/superpowers/specs/2026-07-08-todolist-design.md`
- 视觉预览：`docs/preview/visual-design-v2.html`
- 插件配置：`public/plugin.json`
- 项目依赖：`package.json`
