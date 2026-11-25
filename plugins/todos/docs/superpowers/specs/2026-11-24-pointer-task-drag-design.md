# Pointer Events 自定义任务拖拽设计

日期：2026-11-24

## 背景

现有任务拖拽基于原生 HTML5 Drag and Drop（`draggable` + `dragstart` + `dragover` + `drop`）。

在部分笔记本触控板 + Electron/Chromium 环境下，松手时浏览器不会立即派发 `drop` / `dragend` / `pointerup` / `mouseup`，而是等下一次鼠标移动才补发。此前已经尝试：

- 让整个 `document` 成为合法放置区域
- 在 `drop` / `dragend` / `pointerup` / `mouseup` 时按释放坐标兜底
- 按钮点击兜底

仍然无法解决，说明问题出在原生拖拽的事件投递本身。

## 目标

- 松手瞬间立即执行完成 / 删除 / 分配日期，不依赖浏览器补发事件。
- 保留“拖到光标右上完成、右下删除”的操作区。
- 保留“拖到日历分配日期”。
- 保留点击选中、双击编辑、右键滑动等现有交互。

## 非目标

- 不改变任务数据结构。
- 不移除右键滑动备用操作。
- 不新增常驻完成任务 / 删除按钮。

## 方案

用 **Pointer Events** 实现一套轻量自定义拖拽，替换任务的原生 HTML5 拖拽。

原生拖拽不再启动，因此不会出现 `drop` 被延迟的问题；`pointerup` 在松手时直接触发，动作立即执行。

### 拖拽生命周期

1. `pointerdown`（左键）落在任务卡片的 `[data-task-id]` 上：
   - 忽略输入框、按钮、可编辑区域
   - 记录任务 id、按下坐标、源元素
2. `pointermove` 超过 6px 阈值：
   - 进入拖拽模式，写入 `SET_DRAG_STATE`
   - 记录拖拽起点（用于操作区定位）
   - 创建跟随指针的紧凑预览
   - 源卡片降低透明度
3. 拖拽过程中：
   - 更新预览位置
   - 用 `document.elementFromPoint` 命中日历 `[data-date]` 或操作区 `[data-drag-target]`
   - 命中日历日期时更新 `dropTarget` 高亮
   - 指针靠近滚动容器上下边缘时自动滚动
4. `pointerup`：
   - 命中 `[data-drag-target="complete"]` → 完成 / 取消完成
   - 命中 `[data-drag-target="delete"]` → 删除
   - 命中 `[data-date]` → 给任务添加该日期
   - 其他位置 → 取消，无操作
   - 清理预览、拖拽状态、监听器
5. `pointercancel` / `Escape` / 窗口失焦：取消拖拽，不执行动作

### 点击与双击

- 移动距离小于阈值时不算拖拽，点击 / 双击编辑保持原样。
- 真正发生过拖拽后，用一次捕获阶段的 `click` 拦截，避免松手后误选中任务。

### 操作区

`DragActionDock` 改为纯视觉组件：

- 继续根据 `draggedTaskId` 显示，以拖拽起点为圆心定位。
- 监听 `pointermove`，用 `elementFromPoint` 命中的 `[data-drag-target]` 更新 hover 状态。
- 两个 SVG 扇形 path 增加 `data-drag-target="complete" | "delete"`，供拖拽控制器命中。
- 移除原生 `dragover` / `drop` / `click` / `pointerup` 执行逻辑；动作统一由拖拽控制器负责，避免重复执行。

#### 双扇形形态

- 外半径 96px，以拖拽起点为圆心。
- 右上 72° 扇形 = 完成，右下 72° = 删除；两块沿水平半径贴合，组成整圆 40%（144°）的饼形区域。
- 扇形从圆心一直填充到外弧，不再保留内圈空洞。
- 颜色使用纯色 + 从圆心向外的透明度渐变：中心完全透明，越靠外颜色越实；不使用纸色底板，任务内容能透出来。
- 扇形使用 SVG path 绘制，既是视觉形状也是精确命中区域。
- 圆心保留一个半径 30px 的透明死区，避免拖拽起点立刻命中某个扇形；死区不影响渐变外观。
- 只保留图标，用 HTML 覆盖在扇形中心（36° 方向），并设置 `pointer-events: none`，让指针命中 SVG path。
- 未选中时使用低饱和的灰绿 / 灰红，避免抢眼；悬停时切回高饱和绿 / 红。
- 悬停只切换扇形渐变和图标背景，不改变扇形几何尺寸。

### 日历

- 保留现有 `[data-date]` 标记和 `drag-over` 高亮样式。
- 原生 `onDragOver` / `onDrop` 可以先保留作为测试兼容，但生产路径由拖拽控制器处理。
- 控制器在 `pointerup` 时调用 `addDateToTask(taskId, date)`。

### 自动滚动

拖拽期间用 `requestAnimationFrame` 检查指针位置：

- 找到指针下的 `.task-pool-content` / `.week-view` / `.month-grid` 滚动容器
- 指针距容器上下边缘小于 40px 时，小幅滚动
- 拖拽结束后停止

## 技术改动

### 新增

`src/components/Task/TaskDragController.tsx` + `.css`

- 挂载在 `TodoApp` 中。
- 通过 `document` 事件委托监听 `[data-task-id]`。
- 使用 `useAppContext` / `useTasks` 读取任务和执行动作。
- 负责预览、命中、自动滚动、点击拦截。

### 修改

- `TaskItem` / `TaskChip` / `TaskBlock`：移除 `draggable` 和原生 `onDragStart` / `onDragEnd`；保留 `data-task-id`。
- `DragActionDock`：改为视觉组件，增加 `data-drag-target`，移除动作执行逻辑。
- `TodoApp`：挂载拖拽控制器。
- `Task.css` / `TaskDragController.css`：拖拽预览、源卡片半透明、滚动光标等样式。
- `DragActionDock.test.tsx`：改为测试显示、位置、hover；动作执行测试迁到控制器。
- 其他涉及原生拖拽的测试按需调整；保留现有通过用例。

## 风险与取舍

- **自动滚动**：自定义实现不如原生顺滑，先做基础版。
- **点击/双击**：阈值 + 拖拽后拦截 click，需要覆盖测试。
- **触摸屏**：Pointer Events 同样可用，但触屏滚动与拖拽的区分本次不做重点优化。
- **测试环境**：jsdom 对 `elementFromPoint` / PointerEvent 支持有限，测试中需要 mock 或使用浏览器验证。
- **回退**：如果某个平台 Pointer Events 异常，原生右键滑动仍可作为备用操作。

## 实现结果

- 新增 `TaskDragController`，挂在 `TodoApp` 中，统一处理任务拖拽。
- `TaskItem` / `TaskChip` / `TaskBlock` 已移除原生 `draggable` 和原生拖拽回调。
- `DragActionDock` 已改为纯视觉组件：以拖拽起点为圆心展开整圆 40% 的双扇形饼图（右上完成 / 右下删除，各 72°，中心向外径向渐变），通过 SVG path 的 `data-drag-target` 暴露两个投放区。
- 浏览器验证通过：
  - 拖到右上完成按钮，任务变为已完成
  - 拖到右下删除按钮，任务被删除
  - 拖到日历日期，任务获得该日期
  - 从日历任务芯片拖到另一天，日期正确更新
  - 拖拽时日历日期高亮、操作区 hover、跟随预览均正常
- 新增 `TaskDragController` 测试，覆盖阈值、完成、删除、日期、取消和 Escape。

## 验收标准

- 触控板拖到右上“完成”/ 右下“删除”按钮上松手，立即执行，不需要再移动鼠标。
- 拖到日历日期松手，立即分配日期。
- 拖拽结束后操作区立即消失。
- 单击选中、双击编辑、右键滑动仍然正常。
- 拖拽时靠近任务池 / 日历上下边缘可以自动滚动。
- `npm run build` 通过；新增测试通过，既有通过用例不回归。
