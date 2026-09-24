# 底部常驻迷你图例设计

## 背景

项目使用多种拖拽操作和隐藏手势（右键滑动、双击编辑、拖拽分配日期等），但极少的按钮导致操作不直观。需要在保持少按钮风格的前提下，提供常驻的操作提示。

## 目标

在界面底部添加一个常驻迷你图例栏，用极小的视觉占用展示核心操作提示，让用户无需猜测即可发现隐藏功能。

## 设计方案

### 1. BottomLegend 组件

常驻底部栏，高度 `28px`，位于任务池输入框下方。

**布局：**
```
┌─────────────────────────────────────────────────────────────┐
│ 🖱→ 右键滑动完成/删除  ✏ 双击编辑  ↗ 拖拽分配日期  ⌨ ?  │
└─────────────────────────────────────────────────────────────┘
```

**样式：**
- 背景：`var(--color-bg)` 或透明
- 字号：`9px`，颜色：`var(--clay)`
- 图标：lucide-react 小图标（`Pointer`, `Pencil`, `ArrowUpRight`, `Keyboard`）
- 间距：各项之间 `var(--sp-4)` 均匀分布
- 仅在 `pool-only` 或 `split` 布局下显示

**右键滑动提示增强：**
- 用小箭头图标 + 颜色色块表示方向
- 绿色小方块 → 右滑 = 完成
- 红色小方块 → 左滑 = 删除

### 2. KeyboardShortcutPanel 组件

点击 `?` 或按 `?` 键时弹出的快捷键面板。

**快捷键列表：**
| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + E` | 切换周/月视图 |
| `Ctrl/Cmd + F` | 聚焦搜索框 |
| `Escape` | 清空搜索 |
| `Ctrl/Cmd + Enter` | 提交新任务 |

**手势说明：**
| 手势 | 功能 |
|------|------|
| 右键右滑 | 完成任务 |
| 右键左滑 | 删除任务 |
| 双击标题 | 编辑标题 |
| 双击描述 | 编辑描述 |
| 拖拽到日历 | 分配日期 |

**样式：**
- 居中弹出的 modal overlay
- 半透明背景遮罩
- 点击遮罩或按 Escape 关闭
- 两列布局：左列键盘快捷键，右列手势操作
- 小字号，简洁排版

### 3. 快捷键注册

在 `useKeyboardShortcuts.ts` 中新增：
- `?` 键：切换快捷键面板显示状态

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/components/BottomLegend.tsx` | 新增底部图例组件 |
| `src/components/BottomLegend.css` | 新增样式 |
| `src/components/KeyboardShortcutPanel.tsx` | 新增快捷键面板组件 |
| `src/components/KeyboardShortcutPanel.css` | 新增样式 |
| `src/hooks/useKeyboardShortcuts.ts` | 注册 `?` 快捷键 |
| `src/components/TodoApp.tsx` | 嵌入 BottomLegend 和 KeyboardShortcutPanel |
| `src/styles/global.css` | 新增底部栏相关样式变量 |

## 测试计划

- 底栏在所有布局模式下正确显示
- `?` 快捷键正确触发面板
- 面板可通过 Escape 和点击遮罩关闭
- 各图标和文字正确渲染
