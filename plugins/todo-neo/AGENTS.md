# AGENTS.md

这个项目是 ztools 待办插件，框架是 Vue 3 + Vite + TypeScript。

## 基本约定

- 新增 UI 逻辑时优先沿用现有组件和 composable 的拆分方式。
- README 主要写使用说明，不写偏内部实现的开发细节。
- 组件私有样式尽量写在对应 `.vue` 文件的 scoped style 里。
- 交互改动后尽量用浏览器确认一次。
- 修改数据排序时，要区分“展示过滤后的任务”和“完整分组任务”；持久化重排应基于完整任务列表。
- 日期输入按本地年月日解析，不要用 `new Date('YYYY-MM-DD')` 或 `toISOString().slice(0, 10)` 做回显。

## 代码结构

```text
.
├── public/
│   ├── plugin.json              # ztools 插件配置
│   ├── logo.png                  # 插件图标
│   └── preload/
│       ├── services.js           # ztools tool 注册和 preload 服务
│       └── package.json          # preload 依赖声明
├── src/
│   ├── App.vue                   # 根组件，根据 route 渲染主界面或子窗口
│   ├── main.ts                   # Vue 入口
│   ├── main.css                  # 全局样式和主题变量
│   ├── featureFlags.ts           # 功能开关
│   ├── types.ts                  # 业务类型
│   ├── utils/
│   │   └── inputAttrs.ts         # 输入框通用属性
│   ├── assets/
│   │   └── icons/                # 本地图标资源
│   ├── components/
│   │   ├── MainTodo.vue          # 主界面组合
│   │   ├── TodoSidebar.vue       # 左侧分组栏
│   │   ├── WorkspaceHeader.vue   # 当前分组标题和工具按钮
│   │   ├── TaskList.vue          # 待办列表、编辑和新建输入
│   │   ├── TaskSearchPicker.vue  # `/` 搜索面板
│   │   ├── SettingsDrawer.vue    # 设置抽屉
│   │   ├── TaskDetailDrawer.vue  # 任务详情抽屉
│   │   ├── GlobalContextMenu.vue # 统一右键菜单
│   │   ├── ConfirmDialog.vue     # 删除确认弹窗
│   │   ├── BaseDrawer.vue        # 抽屉基础组件
│   │   └── SvgIcon.vue           # SVG 图标组件
│   └── composables/
│       ├── useTodoStore.ts       # 组合入口，向组件暴露统一 store
│       ├── useTodoTasks.ts       # 任务创建、编辑、删除、完成
│       ├── useTodoGroups.ts      # 分组创建、编辑、删除
│       ├── useTodoDrag.ts        # 拖拽排序和跨分组移动
│       ├── useTodoKeyboard.ts    # Vim/方向键快捷键
│       ├── useTaskSearch.ts      # 搜索状态和跳转逻辑
│       ├── useTodoContextMenu.ts # 右键菜单状态
│       ├── useTodoWindows.ts     # 子窗口相关入口
│       ├── useTomatoTimer.ts     # 计时相关状态
│       ├── todoPersistence.ts    # ztools/localStorage 读写适配
│       ├── todoFormatters.ts     # 日期和计时格式化
│       └── todoConstants.ts      # 默认配置、存储 key、常量
├── package.json                  # npm 脚本和依赖
├── vite.config.js                # Vite 配置
└── tsconfig.json                 # TypeScript 配置
```

## 验证

常规检查：

```bash
npm run build
```

如果改了 preload：

```bash
node --check public/preload/services.js
```

## Git

- 提交信息保持简短明确，参考现有提交风格。
- 不要回退用户或其他 agent 的未提交改动。
