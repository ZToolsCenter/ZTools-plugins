# tiga

ZTools 插件：定时提醒提肛运动。Vue 3 + Vite + TypeScript + Element Plus。

## 命令

- `npm run dev` — Vite 开发服务器，地址 `localhost:5173`
- `npm run build` — `vue-tsc && vite build`（先类型检查再打包）

无 lint、format 或 test 命令。

## 两个执行上下文

这是最重要的架构事实：

1. **Vue 渲染层**（`src/`）— 标准 Vue 3 应用，挂载在 `index.html`，运行在浏览器/WebView 中。
2. **Node.js preload 层**（`public/preload/services.js`）— CommonJS（`require()`），运行在 ZTools 主进程中。负责定时器、通知和存储。`public/preload/package.json` 设置了 `"type": "commonjs"`。

两者通过 `window.services`（preload 暴露）和 `window.ztools`（ZTools 宿主 API）通信。

## 关键文件

- `public/plugin.json` — ZTools 插件清单，定义 features、commands、preload 路径和开发 URL。
- `public/preload/services.js` — 定时器管理、工作时段判断、桌面通知、存储（生产用 `ztools.dbStorage`，开发用文件存储）。
- `public/exercise-guide.html` — 独立的原生 JS 弹窗（**不是** Vue 组件），在 `notify+popup` 模式下通过 `BrowserWindow` 加载。
- `src/types.ts` — 所有 TypeScript 接口、默认配置、存储键名、工具函数。
- `src/App.vue` — 标签页路由（统计/设置/教程），包含开发模式下 `window.services` 和 `window.ztools` 的 mock 降级。
- `src/env.d.ts` — `window.services` 和 `Services` 接口的全局类型声明。

## 开发模式

`npm run dev` 时无 ZTools API 可用。`App.vue` 中的 mock：
- `window.services` — 用 `localStorage` 降级
- `window.ztools` — 用 console.log 占位

preload 服务（`services.js`）在开发模式下**不会加载**。运动弹窗降级为 Vue `ExerciseGuide` 组件（模态覆盖层），而非真实 `BrowserWindow`。

## 构建

- `vite.config.js` 设置 `base: './'` 以使用相对路径（ZTools 插件加载必需）。
- `tsconfig.json` 中 `"strict": false`，`"noImplicitAny": false`。
- TypeScript 类型来自 `@ztools-center/ztools-api-types`。

## 存储

两个存储键：`tiga_config` 和 `tiga_stats`。
- 生产环境：`window.ztools.dbStorage.getItem/setItem`
- 开发降级（preload）：基于文件的 JSON，存储在 `userData` 路径
- 开发降级（渲染层）：`localStorage`
