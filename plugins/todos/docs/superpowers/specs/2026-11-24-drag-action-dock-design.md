# 拖拽操作区设计（完成 / 删除）

日期：2026-11-24

> 后续实现已改为 Pointer Events 自定义拖拽，见 `2026-11-24-pointer-task-drag-design.md`。本文保留操作区的视觉与交互设计。

## 背景与问题

当前“完成 / 删除”依赖右键拖拽：在 `TaskItem`、`TaskBlock`、`TaskChip` 中监听 `mousedown` 且判断 `e.button === 2`，横向拖过 40px 阈值后触发。

问题：

- 笔记本触控板的“两指按压”会被系统识别为右键单击或滚动，不会保持右键按下状态，手势在到达阈值前就结束。
- 同一套约 200 行手势逻辑在三个组件中重复实现，维护成本高。
- 左键拖拽本身在触控板上可用（现有“拖到日历分配日期”已经验证），但没有用于完成 / 删除。

## 目标

- 用左键拖拽提供触控板可靠的完成 / 删除入口。
- 不破坏现有“拖到日历分配日期”的交互。
- 保持界面平时简洁，不增加常驻按钮。
- 操作目标足够大，拖拽过程中有明确反馈。

## 非目标

- 本次不移除右键滑动手势，鼠标用户仍可使用；待新方式稳定后再决定是否清理三份重复逻辑。
- 不新增独立的“归档”数据状态。现有模型只有 `todo / done`，完成区映射为 `done`。
- 不增加删除撤销 / 二次确认。删除仍是明确的一次性操作。

## 方案选择

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 右键单击菜单 | 两指点按后弹出完成 / 删除菜单 | 可靠，但多一步选择 |
| B. 悬停操作按钮 | 任务行 hover 时显示 ✓ / ✕ | 直观，但打破无按钮风格 |
| C. 左键滑动 + 拖拽手柄 | 卡片主体左滑操作，日期拖拽移到手柄 | 手感好，但需要重做拖拽体系，改动最大 |
| D. 光标旁拖拽操作区 | 拖拽任务时在光标右上 / 右下展开“完成 / 删除”两个投放区 | **采用**：复用已有的左键拖拽，和日历区域分开，目标大，平时不占界面 |

用户明确选择：操作区在拖拽时浮现，并且放在右侧，因为左侧要留给日历日期编排。

## 交互设计

### 出现与消失

- 仅当 `state.draggedTaskId` 非空（正在拖拽任务）时显示。
- 拖拽结束（放下或取消）后立即消失。
- 出现时从拖拽起点放大并淡入，约 140ms。

### 布局

在**拖拽开始时的鼠标位置**向右上 / 右下展开两个独立操作区，展开后位置固定：

```
        ┌──────────┐
        │ ✓  完成   │
        └──────────┘
   ● 拖拽起点
        ┌──────────┐
        │ 🗑  删除  │
        └──────────┘
```

- 完成区在光标右上方，删除区在光标右下方，光标落在两者之间的空隙里。
- 每个操作区是高 44px 的胶囊，图标 + 文案横向排列，宽约 120px。
- 容器本身 `pointer-events: none`，仅两个操作区接收事件，避免挡住其他区域。
- 靠近窗口边缘时整体平移：顶部放不下就一起放到光标下方，底部放不下就一起放到光标上方，始终保持“上完成后删除”的顺序。
- 水平方向做边界收拢，但不翻转左右关系。

### 为什么展开后不继续跟随

如果图标始终和鼠标保持固定距离，鼠标永远追不上图标，也就无法“拖到图标上松手”。因此采用“从光标位置展开、随后固定”的方式：既让图标出现在鼠标附近，又保留可靠的投放目标。

### 拖拽反馈

- 任务进入“完成”区：整行放大、绿色高亮、文案变为“松手完成”。
- 任务进入“删除”区：整行放大、红色高亮、文案变为“松手删除”。
- 离开投放区：恢复默认样式。
- 拖到其他任何位置松手：不执行操作，操作区消失。

### 完成语义

- 未完成任务拖到“完成”区：`status` 变为 `done`，进入“已完成任务”分组。
- 已完成任务拖到“完成”区：文案显示“取消完成”，`status` 变回 `todo`。
- 删除区：从当前工作空间移除任务。

### 旧手势与提示

- 右键滑动保留，但不再是底部图例的主推操作。
- 底部图例改为：
  - 右上 ✓ 完成
  - 右下 🗑 删除
  - 双击编辑
  - 拖拽分配日期
- 操作指引面板同步更新；可保留一行“鼠标右键左右滑动（备用）”。

## 技术设计

### 新组件

`src/components/Task/DragActionDock.tsx` + `DragActionDock.css`

- 从 `useAppContext` 读取 `state.draggedTaskId`、当前工作空间与任务列表。
- 从 `useTasks` 获取 `completeTask`、`deleteTask`。
- `draggedTaskId` 为空或找不到任务时返回 `null`。
- 拖拽源在 `dragstart` 时通过 `rememberDragStart(e)` 记录 `clientX/clientY`；操作区首次挂载时读取该坐标，计算展开位置，之后不再跟随鼠标。
- 用一个以 `draggedTaskId` 为 key 的子组件承载位置状态，保证每次新拖拽都从新的光标位置展开。
- 每个投放区：
  - `onDragOver`：`preventDefault()`，设置 `dropEffect = 'move'`，记录当前 hover 区域。
  - `onDragLeave`：`relatedTarget` 不在当前区域内时清除 hover。
  - `onDrop`：`preventDefault()`、`stopPropagation()`，优先使用 `state.draggedTaskId`，兜底读取 `dataTransfer.getData('text/plain')`，执行操作并清空拖拽状态。
- 组件挂载在 `TodoApp` 中、`BottomLegend` 之前，使用 `position: fixed` 覆盖层。
- 拖拽时使用紧凑的拖拽影像（`src/utils/dragUtils.ts` 的 `setTaskDragImage`），避免整张宽卡片遮住操作区。
- 拖拽期间在 `document` 上监听 `dragover`（capture 阶段 `preventDefault`），让整个文档成为合法放置区域；否则在空白处松手时，Chromium/Electron 会把 `dragend` 推迟到下一次鼠标移动，操作区就会“粘”在屏幕上。
- 同时在 `document` 上监听 `drop` / `dragend` 兜底清理拖拽状态，即使某个拖拽源漏传 `onDragEnd` 也能立即退出拖拽模式。
- 释放兜底：`dragend` / `pointerup` / `mouseup` 都会读取释放坐标，优先使用当前高亮区域，其次用 `document.elementFromPoint` 命中操作区；命中则执行对应动作。这样即使原生 `drop` 被触控板延迟，松手时也能立即执行。
- Escape 通过 `cancelledRef` 取消，避免取消拖拽时误触发动作。
- 悬停态只改变颜色 / 边框 / 阴影，不做缩放，避免拖拽过程中改变按钮几何尺寸导致命中不稳定。

### 周视图拖拽状态修复

`WeekView` 目前没有把 `onDragStart / onDragEnd` 传给 `DayRow`，导致从周视图日历拖动任务时 `draggedTaskId` 不会写入。本次补上：

- `onDragStart` → `SET_DRAG_STATE { taskId, dropTarget: null }`
- `onDragEnd` → `SET_DRAG_STATE { taskId: null, dropTarget: null }`

同时给任务池的“已完成”分组补上同样的回调，保证拖动已完成任务时操作区也能出现。

### 样式

- 复用 `variables.css` 中的 `--paper`、`--color-border`、`--color-success`、`--color-danger`、`--shadow-md`。
- 新增类名：`drag-action-dock`、`drag-action-target`、`drag-action-target.complete`、`drag-action-target.delete`、`drag-action-target__icon`、`drag-action-target__label`、`is-hovered`。
- 胶囊圆角、独立阴影；出现时从拖拽起点做一次 140ms 的放大淡入。
- 遵循 `prefers-reduced-motion`，减少动画。

### 测试

新增 `src/components/Task/DragActionDock.test.tsx`：

- 未拖拽时不渲染。
- 拖拽时在记录的鼠标起点附近展开，完成区在删除区之前（上方）。
- 拖拽时渲染完成 / 删除两个投放区。
- 拖到完成区调用完成回调并清空拖拽状态。
- 拖到删除区调用删除回调并清空拖拽状态。
- hover 状态类正确切换。
- 已完成任务显示“取消完成”。

更新：

- `BottomLegend.test.tsx`：断言新文案。
- `KeyboardShortcutPanel.test.tsx`：断言新的手势说明。
- 如需要，补充 `WeekView` 的拖拽状态传递测试。

注意：当前仓库测试基线有 6 个失败套件 / 47 个失败用例，均为既有陈旧测试（缺少 Provider、旧 UI 文案等），本次不扩大修复范围，只保证新增测试通过、既有通过用例不回归。

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/components/Task/DragActionDock.tsx` | 新增光标旁拖拽操作区 |
| `src/components/Task/DragActionDock.css` | 新增胶囊样式与动画 |
| `src/components/TodoApp.tsx` | 挂载操作区 |
| `src/components/Calendar/WeekView.tsx` | 补齐拖拽开始 / 结束状态 |
| `src/utils/dragUtils.ts` | 记录拖拽起点、生成紧凑拖拽影像 |
| `src/components/BottomLegend.tsx` | 更新操作提示 |
| `src/components/BottomLegend.css` | 调整图标样式类 |
| `src/components/KeyboardShortcutPanel.tsx` | 更新手势说明 |
| 对应测试文件 | 新增 / 更新测试 |
| `CHANGELOG.md` | 记录本次交互改进 |

## 风险与取舍

- **误删**：拖拽本身是明确动作，删除区有红色高亮和“松手删除”提示；暂不引入确认弹窗。后续可加撤销提示。
- **拖拽图像遮挡**：已用紧凑的拖拽影像代替整张任务卡片，操作区不会被宽卡片遮住。
- **完成 / 取消完成复用同一区域**：通过拖拽任务状态动态改变文案，避免增加第三个区域。
- **旧代码保留**：右键滑动逻辑本次不动，避免同时改两套交互导致回归。

## 验收标准

- 触控板左键拖动任务到光标右上的“完成”区，松手后任务进入已完成。
- 拖到光标右下的“删除”区，松手后被删除。
- 每次拖拽都从当前光标位置展开，展开后图标不再移动。
- 拖到日历日期，仍然正常分配日期。
- 在空白处松手时，操作区立即消失，不需要再移动鼠标。
- 拖到按钮上松手时，即使原生 `drop` 被延迟，也按释放坐标立即执行完成 / 删除。
- 未拖拽时光标旁不出现任何常驻按钮。
- 从任务池、周视图、月视图拖动任务时，操作区都能出现。
- 靠近窗口顶部 / 底部 / 右侧时，操作区不会跑出可视区域，且保持“上完成、下删除”的顺序。
- 底部图例和操作指引文案与新交互一致。
- `npm run build` 通过；新增测试通过，既有通过用例不回归。
