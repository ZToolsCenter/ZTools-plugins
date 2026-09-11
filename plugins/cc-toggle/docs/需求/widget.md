# 桌面小组件（Desktop Widgets）

> 创建日期：2026-08-13
> 状态：待评审

## 概述

在桌面以置顶小窗形式**只读**展示当前激活供应商的余额等关键信息，无需打开 ZTools 主界面即可一眼看到余额。采用可扩展的多小组件架构，后续可低成本新增更多小组件。

---

## 背景

核心痛点：用户想确认「我现在用的是哪个供应商、余额还剩多少」时，必须唤起 ZTools → 打开插件才能看到。作为高频信息，应该"一眼可见"。

ZTools 没有正式的「桌面小组件」插件类型，但提供 `ztools.createBrowserWindow` API（项目 proxy-daemon 已在用）——可创建无边框、透明、置顶的小窗，且**每个窗口可有独立 preload（具备 Node.js 能力）**，完全能满足小组件场景。

---

## 核心概念

| 概念             | 说明                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| 小组件（Widget） | 一个通过 `createBrowserWindow` 创建的置顶小窗：`widget-{id}.html` + 页面逻辑 + `widget-{id}-preload` |
| WidgetManager    | preload 模块，统一管理各小组件的创建/关闭/位置记忆，向主界面暴露 `openWidget/closeWidget` API        |
| 直接 require     | 小组件 preload 直接 `require` 现有 manager 类读取/操作数据，**不走 IPC**                             |
| 数据一致性       | 全部数据落 `ztools.dbStorage` / 配置文件，进程间天然一致                                             |
| 窗口通信         | 主窗 ↔ 小组件若需通信：`win.webContents.send` / `ztools.sendToParent`（本项目暂不需要）              |

---

## 技术方案

### 为什么「直接 require」而非 IPC

1. **数据层全在 db / 文件系统**：余额缓存（`cctoggle_balance_cache` → `dbStorage`）、供应商（`dbStorage`）、激活方案（`dbStorage`）均落库，任何进程 require 同一批 manager 读到同一份数据，无状态分叉。
2. **manager 全为静态类、无进程内主状态**：不存在「只有主窗口才有的运行时状态」，IPC 的单一数据源优势用不上。
3. **避开 IPC 序列化坑**：IPC 跨进程传对象会报 "An object could not be cloned"（项目已有 `toPlain` 规避先例），直接 require 彻底绕开。
4. **多小组件并行安全**：每个小组件独立 require，互不干扰。

> **例外**：若未来某小组件需要依赖「主窗口进程内才存在的运行时状态」（如内存缓存、长连接），才改走 IPC 将小组件退化为主窗口薄视图。

### 窗口创建参数

```js
const win = ztools.createBrowserWindow('widget-status.html', {
  width: 260,
  height: 190,
  frame: false, // 无边框
  transparent: true, // 透明圆角
  backgroundColor: '#00000000', // 透明背景，避免四角露白
  thickFrame: false, // 无厚边框（Windows 透明窗口黑角）
  hasShadow: false, // 无系统阴影（Windows 透明窗口黑角）
  roundedCorners: false, // 无系统圆角边框（避免黑角）
  alwaysOnTop: false, // 默认不置顶（顶栏 📌 可切换）
  skipTaskbar: true, // 不进任务栏
  resizable: true, // 可拖动调整大小（尺寸随位置一起持久化）
  minWidth: 220,
  minHeight: 140,
  webPreferences: { preload: 'widget-status-preload.js' }
})
```

---

## 数据结构

**无持久化配置键**。小组件设置（显示余额/模型名/备注、透明度、主题、置顶）均为**会话级内存态**，存于小组件窗口 preload 内存，重开回默认。

- **置顶应用**：小组件 📌 切换后，通过 `ztools.sendToParent('cctoggle-widget-always-on-top', { value })` 单向通知主窗口，主窗口 preload 用 `ipcRenderer.on` 接收并调用 `WidgetManager.setAlwaysOnTop` 应用 `win.setAlwaysOnTop`
- **余额刷新间隔**不单独配置，跟随当前供应商余额配置（`provider.balance.refreshIntervalSec`，默认 60s），供应商变化后自动跟随

---

## 事件总线（公共能力）

主窗口 ↔ 小组件**实时同步**的通用机制（主→子推送），后续新增实时需求只需"注册通道 + 订阅"：

| 文件                                     | 角色                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/preload/widgets/widget-events.ts`   | 通道常量注册表（`PROVIDER_SWITCHED` / `PROVIDER_UPDATED` / `BALANCE_REFRESHED`），新增事件在此登记 |
| `src/preload/widgets/widget-bus.ts`      | 小组件侧订阅器 `onWidgetEvent(channel, cb)`，内部 `ipcRenderer.on` 分发                            |
| `WidgetManager.broadcast(channel, data)` | 主窗口侧发布：遍历存活小组件窗口 `win.webContents.send`                                            |

**接线**：

- `preload.ts` 包装 `switchProvider` → 成功后 `broadcast(PROVIDER_SWITCHED)`；包装 `saveProvider` → 成功后 `broadcast(PROVIDER_UPDATED)`；包装 `queryBalance` → 成功后 `broadcast(BALANCE_REFRESHED)`
- `status-preload.ts` 订阅：`PROVIDER_SWITCHED` / `PROVIDER_UPDATED` → 立即 `emitUpdate()`（供应商切换 / 开启计费后即时重渲染）；`BALANCE_REFRESHED` → 从共享缓存同步该供应商余额后重渲染

> 数据读取仍走"直接 require 共享存储"，事件只做即时通知，轮询兜底；子→主仍用 `sendToParent`。

---

## 功能需求

### 1. WidgetManager（preload 模块）

文件：`src/preload/widgets/widget-manager.ts`

- `static open(id: string): void` —— 已打开则聚焦，否则 `createBrowserWindow` 创建并还原上次位置
- `static close(id: string): void` —— 关闭并持久化状态
- `static toggle(id: string): void`
- `static isOpen(id: string): boolean`
- `static getStates(): Record<string, WidgetWindowState>`
- `static getConfig(id: string): WidgetConfig`
- `static setConfig(id: string, cfg: Partial<WidgetConfig>): void`

### 2. 首个小组件：当前供应商余额（widget-status）

文件：`src/preload/widgets/status/status-preload.ts` + `src/preload/widgets/status/status.html`

- **只读展示**：单行展示**当前激活 Agent** 的供应商名与余额，**不支持切换 Agent / 供应商**
- **当前 Agent 判定**：优先 `ProviderStore.getLastActiveApp()`，无则取第一个有当前供应商的 Agent
- **展示**：Agent 图标 + 名称 + 供应商名 + 余额（按 `showBalance` 开关）；按 `showModel` / `showRemark` 决定是否附带模型名 / 备注
- **刷新**：按当前供应商余额配置的 `refreshIntervalSec`（递归 setTimeout，默认 60s）调 `BalanceManager.queryBalance` / 读 `ProviderStore.getCurrentProviderId`
- **低余额**：低于阈值标红
- **外观**：窗口透明度按 `opacity`，主题按 `theme` 应用
- **置顶**：默认不置顶（`alwaysOnTop: false`），右上角悬浮 📌 按钮切换；切换后由 WidgetManager 轮询应用 `win.setAlwaysOnTop`

#### 2.1 小组件设置（hover 齿轮）

- 鼠标 hover 小组件时，**右上角浮现 📌/⚙/× 悬浮按钮**（无 header，默认隐藏）
- 点击齿轮弹出设置面板（小组件内部浮层，非主窗口）：
  - **显示内容**：余额 / 模型名 / 备注 三个开关
  - **透明度**：滑杆
  - **主题**：跟随系统 / 浅色 / 深色
- 设置即时生效（**会话级内存态，不持久化**，重开回默认）

#### 2.2 与主界面的一致性

- 小组件为**只读**，不提供切换；供应商/余额由主界面操作后，小组件在下一个刷新周期自动同步（数据同一份 db / 配置文件，无需 IPC）

#### 2.3 未配置余额的降级展示

`queryBalance` 对未启用/未配置余额的供应商返回 `{ success: false, error: "未启用余额查询" }`，小组件按三种状态降级展示（`showBalance` 为开时）：

| 状态              | 展示                            | 依据                                                      |
| ----------------- | ------------------------------- | --------------------------------------------------------- |
| 已配置 + 查询成功 | 金额（如 `¥12.34`）             | `result.success === true`                                 |
| 未配置余额        | 灰色「未配置」占位              | `provider.balance` 缺失或 `enabled === false`，不发起请求 |
| 已配置 + 查询失败 | `—` + hover 显示 `result.error` | 超时 / 认证失败 / HTTP 错误等                             |

- **未配置余额时不发起网络请求**，避免无意义轮询（判断逻辑复用 `queryBalance` 前段校验：`!cfg || !cfg.enabled`）
- 当前 Agent 未激活或未配置余额时，展示「未激活」/「未配置」占位，不占多余空间

### 3. 功能入口：英雄卡按钮

- `ProviderListPage` 的**英雄卡**（当前激活供应商大卡片，`.hero-card`）右上角放置小组件图标按钮
- 点击 toggle 打开/关闭小组件（`openWidget` / `closeWidget`）
- 按钮高亮表示小组件当前已打开
- 小组件窗口右上角另有 × 关闭按钮（与齿轮并列，hover 时显示）

### 4. API 暴露（遵循 API 同步规则）

| 文件                             | 内容                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/preload/preload.ts`         | 暴露 `openWidget/closeWidget/toggleWidget/getWidgetStates/listWidgets`；`ipcRenderer.on('cctoggle-widget-always-on-top')` 应用置顶 |
| `src/types/ztools-cctoggle.d.ts` | 新增对应类型声明                                                                                                                   |
| `src/utils/browser-adapter.ts`   | 浏览器模式空实现/提示                                                                                                              |

---

## 构建与目录结构

### 目录划分

```
src/preload/widgets/              # 🪟 小组件（独立窗口，不走主入口）
├── widget-manager.ts             # WidgetManager：窗口生命周期 + 置顶应用 + 事件广播
├── widget-bus.ts                 # 小组件侧事件订阅器（onWidgetEvent）
├── widget-events.ts              # 事件通道常量注册表
├── assets/                       # 小组件公共资源（preload 复制到 public/preload/widgets/assets/）
│   ├── widget-common.css         # 公共样式（主题变量/基础 reset/悬浮工具条/置顶双态按钮），所有小组件 html 复用
│   └── images/agents/            # Agent 图标（小组件运行时引用）
└── status/                       # 小组件：当前供应商余额
    ├── status.html               # 窗口页面（build-preload 复制到 public/preload/widgets/status/）
    └── status-preload.ts         # 小组件 preload（直接 require manager，不走 IPC）
```

> 小组件按 **每小组件一子目录** 组织：`widgets/{id}/` 内含 `{id}.html` + `{id}-preload.ts`；公共部分（`widget-manager.ts`、`widget-bus.ts`、`widget-events.ts`、`assets/`）放 `widgets/` 根目录，由 build-preload 复制到 `public/preload/widgets/`。
> 小组件页面统一在 `<head>` 用 `<link rel="stylesheet" href="../assets/widget-common.css">` 引入公共样式（主题变量、`.w-tools` 悬浮工具条、`.w-icobtn` 图标按钮、`.w-icobtn--pin` 置顶双态按钮），**不要在各自 html 里重复定义**。
> Agent 图标统一放 `assets/images/agents/`，小组件 preload 返回 `../assets/images/agents/{appType}.png`（相对页面目录），页面 `img.src = state.icon` 直接引用。
> 页面 html 与 proxy-daemon.html 同惯例：放 `src/preload/widgets/`，由 `build-preload.cjs` 复制到 `public/preload/widgets/`，`createBrowserWindow` 相对路径 `preload/widgets/status/status.html`。
> 未来新增小组件（如余额总览）：在 `src/preload/widgets/` 下加一个目录，含 `{id}.html`（复用 ../assets/widget-common.css）+ `{id}-preload.ts`，并在 WidgetManager 注册。

### 构建改动

| 位置                        | 改动                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/build-preload.cjs` | assets 复制 `widgets/status/status.html` 与 `widgets/assets/widget-common.css`；dirAssets 复制 `widgets/assets/images/agents/` → `public/preload/widgets/` |
| `tsconfig.preload.json`     | 无需改动（`src/preload/**/*.ts` 已包含 widget preload 编译，子目录自动随 `rootDir` 输出）                                                                  |
| `package.json`              | 无需新增依赖（复用 `ztools.createBrowserWindow`）                                                                                                          |

### 与 proxy-daemon 的关系

`proxy-daemon.ts` 已是「独立窗口 + 独立 preload」的现成范例，小组件沿用同一模式（standalone 函数式，不走 `preload.ts` 主入口），不引入 IPC。

---

## 兼容性注意

- ZTools 基于 Electron，小组件代码避免使用过新语法。
- `createBrowserWindow` 的 `preload` 为相对路径，与小组件 html 同目录（均在 `public/preload/`）。
- 小组件窗口**独立于主窗口进程**，不要读取主窗口的 `window.ztoolsCctoggle`；需要数据一律在小组件 preload 里直接 require。

---

## 自动化测试

> 基建：`@playwright/test` + `playwright.config.ts`（`pnpm test:e2e`），浏览器模式 `dev:browser` 下跑；约定见 `references/browser-testing.md`。

### 文件组织

- 测试文件放 `test/widgets/`，命名 `widget.spec.ts`
- `test/` 目录现有子文件夹（mcp/providers/proxy/settings/skills/stats）为空，新建 `widgets/` 与之并列

### 覆盖范围（分三层）

**1. WidgetManager API（浏览器模式 mock）**

- `openWidget/closeWidget/toggleWidget/getWidgetStates` 状态往返一致
- 重复 `openWidget` 不重复创建（`isOpen` 幂等）

**2. 英雄卡入口（E2E，`ProviderListPage`）**

- 英雄卡右上角小组件按钮存在
- 点击后调用对应 API，按钮高亮状态与 `getWidgetStates` 返回一致
- 再次点击关闭，高亮消失

**3. 小组件页面 UI（E2E，直接访问 `/preload/widgets/status/status.html`）**

- 每个 Agent 一行渲染当前供应商名
- 未配置余额的供应商显示「未配置」占位，且不发起网络请求（mock `queryBalance` 未启用）
- hover 右上角浮现齿轮与 ×，齿轮点击弹出设置面板
- 设置面板修改「显示余额/模型名/备注、透明度、主题」后，页面状态即时更新

### 边界说明

- **真实置顶窗口无法自动化验证**：`createBrowserWindow` 仅存在于 ZTools 环境，Playwright 无法创建/断言真实桌面小窗 → 由「窗口行为」类用例（置顶、透明、位置还原、不重复创建）进入**ZTools 手工回归清单**（见下方），自动化覆盖其窗口逻辑层（WidgetManager API + 页面 UI + 配置持久化）。
- 浏览器模式小组件页面通过 Vite 多入口在 `dev` 下可访问，测试无需 ZTools。
- 避免触发真实 CLI 配置切换（防止污染 `~/.codex/config.toml` 等），切换行为用例用 mock 返回值断言 UI 反馈。

### ZTools 手工回归清单（自动化无法覆盖项）

- [ ] 小组件窗口置顶、透明、无边框、不进任务栏
- [ ] 拖动后关闭再打开，位置还原
- [ ] 窗口内点击切换供应商真实生效
- [ ] 多小组件并存互不干扰

---

## 验收标准

1. `ProviderListPage` 英雄卡右上角的小组件按钮可打开/关闭小组件，按钮高亮状态与实际一致。
2. 小组件展示当前激活 Agent 的供应商与余额（**只读，无切换功能**），位置/尺寸可拖动调整（不持久化，重开回默认）；四角无白色残留。
3. 小组件默认不置顶，顶栏 📌 按钮可切换置顶并持久化。
4. 小组件可按设置开关显示/隐藏余额、模型名、备注；透明度、主题设置即时生效（会话级，重开回默认）；余额刷新间隔跟随供应商配置。
5. hover 小组件右上角浮现 📌/⚙/× 按钮，⚙ 可打开设置面板（含 ← 返回），× 可关闭小组件。
6. 主界面切换供应商后，小组件在下一刷新周期自动同步展示。
7. 未配置余额时显示灰色「未配置」且不发起请求；查询失败显示 `—` 并可悬停查看原因。
8. 关闭小组件后再打开不重复创建窗口。
9. 浏览器开发模式（`dev:browser`）下相关 API 不报错（空实现或 mock）。
10. `pnpm test:e2e` 通过 `test/widgets/widget.spec.ts`：覆盖 WidgetManager API 往返、英雄卡按钮高亮一致性、小组件页面 UI（当前供应商/余额渲染 / 未配置占位 / hover 齿轮 / 设置持久化）。
11. 真实置顶窗口行为（置顶/透明/位置还原/拖拽/调整大小）列入 ZTools 手工回归清单并完成验证。
