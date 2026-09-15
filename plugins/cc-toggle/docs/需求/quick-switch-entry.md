# 快速切换入口（Quick Switch Entry）

> 创建日期：2026-08-08
> 状态：待评审

## 概述

在 ZTools 搜索框内直接切换到某个 Agent（Codex / Claude / Claude Desktop / OpenClaw / Gemini）。输入 `cc {Agent名}` 匹配到对应动态命令，回车后打开插件主界面并停留在该 Agent 页签，无需手动点顶栏 tab。

---

## 背景

现状切换 Agent 需要：唤起插件 → 打开主界面 → 点击顶栏 Agent tab。高频操作路径较长，且中断用户当前的终端/编辑器上下文。

ZTools 提供「动态命令（setFeature）」能力：为每个 Agent 注册一条搜索命令，输入 `cc {名称}` 即出结果，选中即打开对应 Agent 页签，路径最短、原生搜索体验。

---

## 核心概念

| 概念       | 说明                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 快捷命令   | 为每个 Agent 注册一条 ZTools 动态命令，选择即打开对应 Agent 页签               |
| Agent      | 插件顶栏的可切换 CLI 工具：codex / claude / claude-desktop / openclaw / gemini |
| 命令 Code  | `ccs_switch_{appType}`（注意前缀避开旧 `switch_` 清理逻辑）                    |
| 命令关键词 | 触发该命令的搜索词：`cc {Agent显示名}`，如 `cc Codex` / `cc Claude Desktop`    |
| 特征同步   | 插件进入时全量重注册/清理动态命令                                              |
| 切入流程   | 选中命令 → `setActiveTab(appType)` → 打开主界面并切到该 Agent tab → 通知       |

---

## 数据结构

### 快捷命令注册

```ts
interface QuickSwitchFeature {
  code: string // `ccs_switch_{appType}`，如 ccs_switch_claude-desktop
  explain: string // 如「打开 CCToggle 并切换到 Claude Desktop」
  cmds: string[] // 搜索关键词，如 ['cc Claude Desktop']
  icon?: string // 复用 logo
}
```

---

## 功能需求

### 1. 动态命令切入（主入口）

#### 1.1 命令注册规则

- 遍历全部 Agent（codex / claude / claude-desktop / openclaw / gemini），每个注册一条命令：
  - `code`: `ccs_switch_{appType}`
  - `cmds`: `['cc {Agent显示名}']`
- Agent 数量固定（5 个），无需处理名称冲突。

#### 1.2 命令执行

`setup.ts` 的 `onPluginEnter` 保留 `code.startsWith("switch_")` 旧分支（兼容旧数据），并新增 `ccs_switch_` 前缀识别：

```
code = ccs_switch_{appType}
  → 解析 appType
  → useProviders().setActiveTab(appType)（切 tab + 加载该 Agent 供应商列表）
  → ztools.showNotification(`已切换到 ${Agent显示名}`)
  → 不退出插件，停留在主界面对应 Agent 页签
```

#### 1.3 特征同步时机

| 时机                   | 动作                             |
| ---------------------- | -------------------------------- |
| 插件每次进入（主命令） | 全量重注册（先清旧再注册，幂等） |
| 设置页开关/前缀变更    | 保存配置后全量重建或清理         |

> 统一收敛到一个 `useQuickSwitch` composable：内部维护 `reconcile()`（先清已注册的 `ccs_switch_*` 命令，再按全部 Agent 全量注册），页面无需关心细节。**副作用仅作用于 ZTools 环境**，浏览器模式自动跳过。

### 2. 匹配与结果反馈

- 匹配维度：Agent 显示名（如 `Codex` / `Claude Desktop`），ZTools 原生子串匹配、忽略大小写
- 切入成功：打开主界面 + 切到对应 Agent tab + 系统通知，**不退出插件**
- 配置关闭：不注册任何动态命令

### 3. 配置项

| 配置         | 默认 | 位置                                   |
| ------------ | ---- | -------------------------------------- |
| 快捷命令开关 | 开   | 设置页「通用配置」新增「快速切换」分组 |
| 命令前缀     | `cc` | 同上                                   |

> 配置存 `ztools.dbStorage`（key: `cctoggle_quick_switch`），浏览器模式回退默认值。

---

## API 设计

### 新增 composable

```
src/composables/useQuickSwitch.ts
```

内部逻辑：

- `reconcile()`：清理 `ccs_switch_*` 动态命令 → 按全部 Agent 重新注册
- 提供 `registerFor(appType)` / `unregisterFor(appType)` 供开关/前缀变更后增量调用
- `buildCmds(appType)`：生成命令关键词数组
- 切入逻辑复用 `useProviders().setActiveTab`

### Preload

- **无新增 API**。仅复用现有前端 `setActiveTab` / `loadProviders`。
- 命令注册/清理用 ZTools 原生 `ztools.setFeature` / `removeFeature`（前端可直接调用，不走 preload）。

> 不修改 `preload.ts` / `ztools-cctoggle.d.ts` / `browser-adapter.ts` / `dev-api-server.cjs`（本期无 preload API 变更）。

---

## UI 交互

### 动态命令（ZTools 搜索框）

```
输入：cc claude desktop
┌────────────────────────────────────────┐
│ 🛠  cc Claude Desktop              ⌨   │  ← 动态命令命中
│    打开 CCToggle 并切换到 Claude Desktop│
├────────────────────────────────────────┤
│ 🛠  cctoggle                        ↵  │  ← 主命令命中
│    一键切换供应商，管理多套 API 配置        │
└────────────────────────────────────────┘
选择第一项 → 打开插件并切到 Claude Desktop 页签
```

### 系统通知

```
已切换到 Claude Desktop
```

---

## 边界情况

| 场景                        | 处理                                                     |
| --------------------------- | -------------------------------------------------------- |
| Agent 显示名含空格/特殊字符 | 命令关键词原样保留，ZTools 按子串匹配，不影响            |
| 浏览器开发模式              | `ztools` 不存在，`useQuickSwitch` 直接跳过，不影响页面   |
| 多次进入插件                | 先清后注册，幂等，无重复命令                             |
| 命令冲突（其它插件同名）    | 复用 logo + explain 明确来源；不做强制排他               |
| 插件退出                    | 动态命令是全局注册，需保留（供下次搜索直切）             |
| 旧 `switch_*` 命令残留      | `setup.ts` 加载时兜底清理，不影响新命令                  |
| 代理运行中切 Agent          | 与顶栏 tab 切换行为一致（`setActiveTab` 会先停当前代理） |

---

## 非目标（本期不做）

1. 不做全局热键（ZTools 本身无热键注册能力）
2. 不做搜索历史 / 最近使用排序
3. 不把动态命令逻辑下沉到 preload（前端直接调 ZTools API 足够）
4. 不做命令关键词模糊匹配算法（依赖 ZTools 原生子串匹配）
5. 不做按 Agent 直达功能页（`cc balance`、`cc stats`）

---

## 未来扩展

- 按 Agent 直达功能页（`cc balance`、`cc stats`）
- 命令 explain 中附加当前状态（如「(已激活)」）
- 同时切换 Agent 与该项目激活的供应商

---

## 验收标准

1. 输入 `cc Codex` 出现对应动态命令，选择后打开插件主界面并切到 Codex 页签、弹出通知
2. 输入 `cc Claude Desktop` 可切到 Claude Desktop 页签（含空格的显示名可匹配）
3. `cc` 单独输入仍打开主界面默认页签
4. 浏览器开发模式下页面正常，不报错、不注册任何命令
5. 设置页开关关闭后，动态命令不再注册；重新开启后恢复
6. 修改命令前缀（如改为 `qs`）后，`qs Codex` 可匹配新命令，`cc Codex` 不再命中
