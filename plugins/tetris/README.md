# tetris-game

> 俄罗斯方块

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件。

## 功能特性

- **三种主题**：霓虹（Neon）、简洁（Modern）、复古（Retro），Canvas 实时渲染
- **自定义按键**：支持 WASD / 方向键 / 自定义键位绑定
- **游戏控制**：开始、暂停/继续，自动下落与按键加速
- **信息面板**：实时显示下一个方块、当前得分
- **响应式适配**：Canvas 尺寸根据窗口自动缩放

## 项目结构

```
.
├── public/
│   ├── logo.jpg               # 插件图标
│   ├── plugin.json            # 插件配置文件
│   └── preload/
│       └── package.json       # Preload 配置
├── src/
│   ├── main.ts                # 入口文件
│   ├── main.css               # 全局样式
│   ├── App.vue                # 根组件
│   ├── constants/
│   │   └── game.ts            # 游戏常量（方块形状、边界等）
│   ├── composables/
│   │   └── useStorage.ts      # ZTools dbStorage / localStorage 封装
│   └── TetrisGame/
│       ├── index.vue          # 游戏入口组件
│       ├── engine.ts          # 核心引擎（绘制、碰撞、消行）
│       ├── themes.ts          # 三种主题的 Canvas 绘制实现
│       ├── components/
│       │   ├── ScreenHome.vue       # 主菜单
│       │   ├── ScreenGame.vue       # 游戏画面
│       │   └── ScreenSettings.vue   # 设置页面
│       └── composables/
│           ├── useGameSession.ts    # 游戏会话生命周期
│           ├── useControls.ts       # 按键与控制模式
│           └── useTheme.ts          # 主题切换与持久化
├── index.html                 # HTML 模板
├── vite.config.js             # Vite 配置
├── tsconfig.json              # TypeScript 配置
└── package.json               # 项目依赖
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

## 构建与发布

### 1. 构建插件

```bash
npm run build
```

### 2. 测试构建产物

将 `dist/` 目录中的所有文件复制到 ZTools 插件目录进行测试。

### 3. 发布到插件市场

1. 确保 `plugin.json` 中的信息完整准确
2. 准备好插件截图和详细说明
3. 访问 ZTools 插件市场提交插件

## 相关资源

- [ZTools 官方文档](https://github.com/ZToolsCenter/ZTools)
- [ZTools API 文档](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
