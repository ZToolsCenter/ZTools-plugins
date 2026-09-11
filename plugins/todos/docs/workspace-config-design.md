# 动态工作空间配置设计文档

## 概述

将现有的固定工作空间（工作、生活、学习）改为可编辑的动态组，每个组可以设置名称和配色方案。

## 需求

1. 用户可以重命名、删除、新建组
2. 每个组可以设置名称和配色方案
3. 最多支持5个组
4. 使用ztools的dbStorage存储配置
5. 提供7种预设配色方案
6. 组的图标显示为彩色方块
7. 通过Header中的设置按钮进入编辑界面

## 数据结构

### WorkspaceConfig

```typescript
interface WorkspaceConfig {
  id: string;           // 唯一标识
  name: string;         // 组名称
  colorScheme: string;  // 配色方案ID
  order: number;        // 显示顺序
}
```

### ColorScheme

```typescript
interface ColorScheme {
  id: string;
  name: string;
  primary: string;      // 主色
  secondary: string;    // 辅色
  light: string;        // 浅色
  dark: string;         // 深色
}
```

### AppState 扩展

```typescript
interface AppState {
  // ... 现有字段
  workspaceConfigs: WorkspaceConfig[];
}
```

## 预设配色方案

| ID | 名称 | 主色 | 辅色 | 浅色 | 深色 |
|----|------|------|------|------|------|
| teal | 青绿 | #0F766E | #14B8A6 | #6EE7B7 | #0D9488 |
| blue | 海洋蓝 | #0284C7 | #38BDF8 | #7DD3FC | #0369A1 |
| purple | 薰衣草紫 | #7C3AED | #A78BFA | #C4B5FD | #6D28D9 |
| green | 森林绿 | #16A34A | #4ADE80 | #86EFAC | #15803D |
| red | 暖阳红 | #DC2626 | #F87171 | #FCA5A5 | #B91C1C |
| orange | 落日橙 | #EA580C | #FB923C | #FDBA74 | #C2410C |
| pink | 玫瑰粉 | #DB2777 | #F472B6 | #F9A8D4 | #BE185D |

## 默认配置

```typescript
const defaultConfigs: WorkspaceConfig[] = [
  { id: 'work', name: '工作', colorScheme: 'teal', order: 0 },
  { id: 'life', name: '生活', colorScheme: 'orange', order: 1 },
  { id: 'study', name: '学习', colorScheme: 'purple', order: 2 }
];
```

## 组件设计

### WorkspaceSwitcher 修改

- 动态渲染组标签
- 每个标签显示彩色方块
- 支持添加新组按钮

### WorkspaceSettings 组件

- 弹出面板用于编辑组
- 支持添加、删除、重命名、修改颜色
- 显示预设配色方案供选择

### 设置按钮

- Header右侧添加设置图标按钮
- 点击打开WorkspaceSettings面板

## 存储方案

使用 `ztools.dbStorage` 存储配置：

```typescript
// 保存配置
ztools.dbStorage.setItem('workspace-configs', configs);

// 读取配置
const configs = ztools.dbStorage.getItem<WorkspaceConfig[]>('workspace-configs');
```

## 状态管理

### Actions

```typescript
type AppAction =
  // ... 现有actions
  | { type: 'UPDATE_WORKSPACE_CONFIGS'; payload: { configs: WorkspaceConfig[] } }
  | { type: 'ADD_WORKSPACE'; payload: { config: WorkspaceConfig } }
  | { type: 'REMOVE_WORKSPACE'; payload: { id: string } }
  | { type: 'UPDATE_WORKSPACE'; payload: { id: string; updates: Partial<WorkspaceConfig> } };
```

### Reducer 处理

```typescript
case 'UPDATE_WORKSPACE_CONFIGS':
  return { ...state, workspaceConfigs: action.payload.configs };

case 'ADD_WORKSPACE':
  return {
    ...state,
    workspaceConfigs: [...state.workspaceConfigs, action.payload.config]
  };

case 'REMOVE_WORKSPACE':
  return {
    ...state,
    workspaceConfigs: state.workspaceConfigs.filter(c => c.id !== action.payload.id)
  };

case 'UPDATE_WORKSPACE':
  return {
    ...state,
    workspaceConfigs: state.workspaceConfigs.map(c =>
      c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
    )
  };
```

## 实现步骤

1. 定义新的类型（WorkspaceConfig, ColorScheme）
2. 扩展AppState类型
3. 更新appReducer支持新的actions
4. 修改WorkspaceSwitcher组件支持动态渲染
5. 创建WorkspaceSettings组件
6. 在Header中添加设置按钮
7. 实现配置存储逻辑
8. 添加深色主题支持

## 测试用例

1. 默认配置显示正确
2. 添加新组功能正常
3. 删除组功能正常
4. 重命名组功能正常
5. 修改配色方案功能正常
6. 配置持久化存储正常
7. 深色主题下显示正常
