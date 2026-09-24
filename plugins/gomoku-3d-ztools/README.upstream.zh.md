<div align="center">

# ⚫⚪ Gomoku 3D · 五子棋 3D

**一款带 AI 对手、棋局回放与棋谱导出的 3D 五子棋——基于 React、Three.js 与 TypeScript 构建。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646cff.svg)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-169-black.svg)](https://threejs.org/)

🎮 **在线体验：** <https://crper.github.io/gomoku-3d/>

[English](./README.md) · [简体中文](./README.zh.md)

</div>

---

## ✨ 功能特性

- **15×15 五子棋**，落子在可交互的 3D 棋盘交叉点上。
- **AI 对手四档难度**——简单 / 中等 / 困难 / **大师**（深度受限的 alpha-beta negamax 搜索）。
- **双视图模式**——2D 平面锁视角（清爽下棋）与 3D 自由轨道视角，切换有平滑相机补间。
- **丰富动效**——落子弹跳 + 尘埃波纹、悬停呼吸预览、最后一手脉冲、胜利连线流光跳动、AI 思考微光；全部尊重 `prefers-reduced-motion` 降级。
- **Web Audio 合成音效**——落子 / 悬停 / 悔棋 / 胜负 / 成就提示，可静音；**无音频文件、零音频依赖**。
- **战绩与成就**持久化到 `localStorage`（胜/负/和、连胜、速胜、击败困难等）。
- **悔棋**一整回合（你的一手 + AI 的应手）。
- **棋局回放**——逐步前进 / 后退、跳转任意手、播放-暂停（0.5×–4× 调速）、可拖动进度条；只读观察模式，不影响实时对局。
- **棋谱导出**——把已结束或进行中的对局导出为 **SGF**（围棋/五子棋/连珠软件通用格式）、**JSON** 或人类可读的 **TXT**，文件名可自定义。
- **全面响应式**——桌面侧栏布局 + 移动端底部操作条，无重叠、无溢出。
- **键盘快捷键**与无障碍支持（ARIA 标签、`aria-live` 当前手信息、焦点管理的对话框）。

## 🧱 技术栈

| 层 | 选型 |
| --- | --- |
| UI 框架 | [React 18](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/)（strict 严格模式） |
| 构建工具 | [Vite 5](https://vitejs.dev/) |
| 3D 渲染 | [Three.js](https://threejs.org/)，经 [`@react-three/fiber`](https://github.com/pmndrs/react-three-fiber) + [`@react-three/drei`](https://github.com/pmndrs/drei) |
| 样式 | [Tailwind CSS](https://tailwindcss.com/) + 手写 shadcn/ui 风格组件 |
| 音频 | Web Audio API（合成，无资源文件、无音频依赖） |
| 状态 | React Hooks——无外部状态库 |

## 🚀 快速开始

### 前置要求

- Node.js **≥ 18**（开发环境为 22）
- npm

### 安装与运行

```bash
git clone https://github.com/crper/gomoku-3d.git
cd gomoku-3d
npm install
npm run dev          # http://localhost:5173
```

### 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 类型检查（`tsc -b`）+ 生产构建到 `dist/` |
| `npm run preview` | 本地预览生产构建 |
| `npm run typecheck` | 运行 `tsc --noEmit` |

## 🧪 测试

`scripts/` 下的测试是纯 TypeScript，用 [esbuild](https://esbuild.github.io/) 打包后由 Node 运行（不依赖测试框架）：

```bash
# 引擎 + AI 逻辑（20 项）
./node_modules/.bin/esbuild scripts/engine.test.ts --bundle --platform=node --format=esm --outfile=/tmp/e.mjs && node /tmp/e.mjs

# AI 强度矩阵
./node_modules/.bin/esbuild scripts/strength.test.ts --bundle --platform=node --format=esm --outfile=/tmp/s.mjs && node /tmp/s.mjs

# 回放与导出（SGF/JSON/TXT）— 37 项
./node_modules/.bin/esbuild scripts/replay.test.ts --bundle --platform=node --format=esm --outfile=/tmp/r.mjs && node /tmp/r.mjs

# 50 局自对弈模拟（无卡死、无非法落子）
./node_modules/.bin/esbuild scripts/sim.ts --bundle --platform=node --format=esm --outfile=/tmp/sim.mjs && node /tmp/sim.mjs
```

## 🎯 玩法

- 黑棋先行。点击任意交叉点落子。
- 横、竖、斜任意方向连成 **五子** 即胜。
- 通过侧栏（桌面）或底栏（移动端）切换难度、先手、2D/3D 视图，以及悔棋、静音、回放、导出。

### 回放键盘快捷键

| 键 | 动作 |
| --- | --- |
| `←` / `→` | 上一手 / 下一手 |
| `空格` | 播放 / 暂停 |
| `Home` / `End` | 首手 / 末手 |
| `Esc` | 退出回放 |

## 📁 项目结构

```
src/
├── App.tsx                  # 布局、状态接线、回放/导出集成
├── main.tsx                 # 入口
├── components/
│   ├── GameBoard.tsx        # 3D 棋盘（R3F）+ 棋子/棋盘全部动效
│   ├── ReplayPanel.tsx      # 回放传输控件
│   ├── ExportDialog.tsx     # SGF/JSON/TXT 导出对话框
│   └── ui/                  # 手写 shadcn/ui 风格基础组件
├── hooks/
│   ├── useGomoku.ts         # 对局状态、AI 调度、战绩、音效
│   ├── useReplay.ts         # 只读回放状态机
│   └── useViewMode.ts       # 2D/3D 视图持久化
└── lib/
    ├── gomoku/
    │   ├── types.ts         # 棋盘、着法、玩家、胜判定
    │   ├── engine.ts        # 不可变对局状态 + 状态转换
    │   ├── ai.ts            # 启发式 + alpha-beta 搜索
    │   ├── replay.ts        # 着法推导与"第 k 手盘面"
    │   ├── export.ts        # SGF/JSON/TXT 序列化 + 下载
    │   └── stats.ts         # 战绩与成就模型
    ├── audio/sfx.ts         # Web Audio 合成音效
    └── achievementIcons.ts
```

## 📦 部署

仓库内置 GitHub Actions 工作流（`.github/workflows/deploy.yml`），每次推送到 `main` 会自动构建并把 `dist/` 部署到 **GitHub Pages**。Vite 的 base 路径由 `GITHUB_REPOSITORY` 动态推导，因此任意仓库名都能正确解析资源。

## 📄 许可证

[MIT](./LICENSE) © [crper](https://github.com/crper)

<div align="center">

用 ⚛️ React · 🧊 Three.js · 💛 TypeScript 打造

</div>
