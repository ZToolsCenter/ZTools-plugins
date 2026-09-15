# 费用看板（Cost Dashboard）

> 创建日期：2026-08-05
> 状态：待评审

## 概述

在现有用量统计基础上增加**成本估算**能力：通过内置可编辑的模型单价表，将 token 用量折算为费用，提供费用趋势、模型成本排行、月度预算与超支提醒。

---

## 背景

现有 StatsPage 只展示 token 维度（输入/输出/缓存/请求数），用户无法回答两个核心问题：

1. **我这个月花了多少钱？** —— 重度用户同时使用多个 CLI + 多家供应商，费用黑盒
2. **哪个模型最烧钱？** —— token 量不等于成本（Opus 输出单价是 Haiku 的 15 倍）

数据来源约束：

- 用量来自本地会话日志（claude/codex jsonl），**日志本身不含费用字段**，只能按官方单价估算
- 第三方中转供应商的实际计费可能与官方价不同 → 支持价格倍率/自定义单价

---

## 核心概念

| 概念                  | 说明                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| 单价表（Price Table） | 模型 → 四维单价（input/output/cacheRead/cacheCreate），单位 USD/M tokens      |
| 匹配规则              | 日志中的模型名 → 单价条目：精确匹配 → 去日期后缀前缀匹配 → 未匹配归入"未配置" |
| 估算成本              | 各维度 token × 对应单价求和，标注"估算值"                                     |
| 月度预算              | 用户设定每月预算上限，进度展示 + 超阈值 banner 提醒                           |
| 价格倍率              | 全局 multiplier，适配中转站折扣/加价（默认 1.0）                              |

**明确标注**：所有金额均为按官方单价的估算值，不代表供应商实际账单。

---

## 数据结构

### 单价条目

```ts
interface ModelPrice {
  id: string // generateId()
  pattern: string // 匹配模式：模型名前缀，如 "claude-sonnet-4"
  label: string // 展示名，如 "Claude Sonnet 4.x"
  input: number // USD / M tokens
  output: number
  cacheRead: number // 默认 0
  cacheCreate: number // 默认 0
  builtin?: boolean // 内置条目（可编辑可删，重置时恢复）
}
```

### 预算配置

```ts
interface BudgetConfig {
  enabled: boolean
  monthly: number // 月度预算（USD）
  alertRatio: number // 提醒阈值，默认 0.8
  multiplier: number // 全局价格倍率，默认 1.0
  exchangeRate?: number // USD→CNY 汇率（可选，填了则双币显示）
}
```

### 存储 Key

| Key                | 存储             | 内容                                                    |
| ------------------ | ---------------- | ------------------------------------------------------- |
| `cctoggle_pricing` | ztools.db        | `{ prices: ModelPrice[] }` 用户单价表（空则用内置默认） |
| `cctoggle_budget`  | ztools.dbStorage | BudgetConfig                                            |

内置默认单价表放 `src/data/model-pricing.ts`（编译期常量，不落库），覆盖：

| 厂商      | 条目示例                                                      |
| --------- | ------------------------------------------------------------- |
| Anthropic | claude-opus-4 / claude-sonnet-4 / claude-haiku（含 cache 价） |
| OpenAI    | gpt-5 / gpt-5-codex / gpt-5-mini                              |
| Google    | gemini-2.5-pro / gemini-2.5-flash                             |
| 国内      | deepseek-chat / kimi-k2 / qwen3-coder / glm / doubao          |

> 具体数值以发布时各家官网价格为准；用户可随时修改，「恢复默认」一键重置。

---

## 功能需求

### 1. 成本估算引擎

#### 1.1 计算公式

```
cost(model, day) =
  input      × price.input      / 1e6 +
  output     × price.output     / 1e6 +
  cacheRead  × price.cacheRead  / 1e6 +
  cacheCreate× price.cacheCreate/ 1e6
最终费用 = cost × multiplier
```

#### 1.2 模型名匹配规则（按序）

1. 精确匹配 `pattern`
2. 去除日志模型名的日期后缀（`-20\d{6}`）后前缀匹配（最长 pattern 优先）
3. 均未命中 → 归入「未配置单价」桶：token 照常统计，费用记 0，UI 单独列出提示用户补价

#### 1.3 实现位置

- 单价表 CRUD → preload（新增 API）
- 成本计算 → 前端纯函数（`src/utils/cost.ts`），输入 `scanUsageLogs()` 结果 + 单价表，输出带 cost 字段的增强数据。**不走 preload，减少 API 同步面**

### 2. 单价表管理

| 功能     | 说明                                       |
| -------- | ------------------------------------------ |
| 内置默认 | 首次使用自动生效，无需配置                 |
| 编辑     | 修改四维单价                               |
| 新增     | 自定义 pattern 匹配未收录模型              |
| 删除     | 移除条目（含内置，删除后该模型归入未配置） |
| 恢复默认 | 整体重置为内置表                           |

### 3. 预算管理

- 设置月度预算（USD）与提醒阈值（默认 80%）
- 当月估算费用 ≥ 阈值：StatsPage 顶部显示 banner（本期不做系统通知）
- 当月费用 / 预算 → 进度条
- 未开启预算时隐藏进度与 banner

### 4. StatsPage UI 变更

**卡片区新增 3 张**（跟随现有 appType/天数过滤器）：

| 卡片     | 内容                                      |
| -------- | ----------------------------------------- |
| 估算费用 | 当前过滤范围总成本（主视觉，accent 样式） |
| 今日费用 | 当天估算                                  |
| 本月费用 | 当月估算 + 预算进度（开启预算时）         |

**面板区新增 2 个**：

- 费用趋势（日成本折线，与 Token 趋势并列）
- 模型成本排行（横向条形图，替代现有 token 排行的金额视角，两者都保留）

**面板区修改 1 个**：

- 模型分布列表每行追加该模型的估算费用列

**未配置单价提示**：存在未匹配模型时，面板下方显示折叠条，列出模型名 + 「去配置」跳转。

### 5. 单价设置入口

设置页新增 tab「单价 / 预算」：

```
设置
├── 通用配置
├── 路由 / 代理
├── Skill 存储
├── 单价 / 预算    ← 新增（单价表 CRUD + 预算配置）
└── 关于
```

StatsPage 未配置提示中的「去配置」直跳该页。

---

## API 设计

### Preload 新增（4 个）

```ts
getPricingTable(): ModelPrice[]                    // 空则返回内置默认
savePricingTable(prices: ModelPrice[]): void
resetPricingTable(): void                          // 清除用户覆盖，回到内置
getBudgetConfig(): BudgetConfig
saveBudgetConfig(cfg: BudgetConfig): void
```

> 按 API 同步规则，需同步更新 4 处：`preload.ts`、`ztools-cctoggle.d.ts`、`browser-adapter.ts`、`dev-api-server.cjs`。

### 前端新增

```
src/utils/cost.ts          # estimateCosts(daily, prices, cfg) 纯函数 + 匹配逻辑
src/data/model-pricing.ts  # 内置默认单价表
src/composables/useBudget.ts
src/views/settings/PricingSettings.vue
```

---

## UI 交互

### StatsPage 卡片区

```
┌────────────┬────────────┬────────────┬─────────── ... ───────────┐
│ 估算费用 $ │ 今日费用 $ │ 本月费用 $ │ Tokens │ 请求数 │ 缓存命中率 │
│   12.34    │   0.87     │  8.2/20 ▓▓ │         │        │          │
└────────────┴────────────┴────────────┴─────────── ... ───────────┘
```

### 预算 banner（≥80% 时）

```
⚠ 本月估算费用已达预算的 82%（$16.4 / $20）        [调整预算]
```

### 单价设置页

```
价格倍率 [ 1.0 ]    月度预算 [ 20 ] USD   提醒阈值 [ 80% ]

┌────────────────────────────────────────────────────┐
│ Claude Opus 4.x      claude-opus-4                  │
│ in $15  out $75  cacheRead $1.5  cacheWrite $18.75 │
│                                    [编辑] [删除]    │
├────────────────────────────────────────────────────┤
│ ...                                                 │
└────────────────────────────────────────────────────┘
[+ 新增单价]                            [恢复默认]
```

---

## 边界情况

| 场景                       | 处理                                               |
| -------------------------- | -------------------------------------------------- |
| 模型未匹配单价             | 费用记 0，token 照常统计，折叠条提示「去配置」     |
| 中转站实际计费 ≠ 官方价    | 全局倍率 multiplier 兜底；精细场景用户自建条目覆盖 |
| 用户删除内置条目后又想找回 | 「恢复默认」整体重置                               |
| 单价表为空                 | fallback 到内置默认，不报错                        |
| 汇率字段未填               | 只显示 USD                                         |
| 清除统计（现有功能）       | 费用随 token 一起被过滤，无额外逻辑                |
| multiplier = 0 或负数      | 表单校验拦截，限制 > 0                             |

---

## 非目标（本期不做）

1. 不接入供应商账单 API（各家接口异构，估算已覆盖主场景）
2. 不做按会话/按项目的成本归因（依赖会话扫描扩展）
3. 不做系统级通知推送（归属「事件通知」需求）
4. 不做单价表远程自动更新（归属预设更新机制需求，本期手动编辑 + 恢复默认）

---

## 未来扩展

- 会话级成本归因（SessionPage 每会话显示费用）
- 供应商账单 API 对账（估算 vs 实际）
- 单价表远程更新
- 预算超支系统通知 / 自动停用代理
