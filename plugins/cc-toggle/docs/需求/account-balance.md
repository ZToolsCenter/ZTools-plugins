# 账户余额显示（Account Balance）

> 创建日期：2026-08-07
> 状态：待评审

## 概述

在供应商卡片上显示该供应商的**账户余额**。余额查询接口由**用户在每个供应商上手动配置**（请求路径 + 取值规则），内置常见厂商模板供一键套用。余额不足时卡片变色告警，并通过 ZTools 系统通知提醒用户充值。

---

## 背景

用户使用多个第三方中转站（AiHubMix、DMXAPI、Kimi、DeepSeek 等）作为 API 供应商。各家余额接口**五花八门**：

- 中转站（OneAPI/NewAPI 系）多为 OpenAI 兼容 billing 接口
- DeepSeek 是专属 `/user/balance` 接口（返回 `balance_infos[]`）
- 硅基流动是 `/user/info`（返回 `data.userInfo.balanceUsd`）
- 有的厂商根本没有余额接口（如 Kimi 官方、Anthropic 官方）

**自动识别不可靠**：接口路径、字段名各家随时可能变，按 baseUrl 猜容易失效或误判，反而增加维护负担和用户困惑。因此改为**用户自己配置**：余额是你的账号，你最清楚该查哪个接口。

现有「费用看板」只能估算消耗，**无法回答"这家还剩多少钱"**。

---

## 核心概念

| 概念         | 说明                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| 余额查询配置 | 每个供应商独立配置：请求路径 + 余额取值路径 + 货币 + 阈值 + 自动查询/间隔/超时，未配置则不查询        |
| 请求路径     | `{baseUrl}` 之后的路径，如 `/user/balance`、`/v1/dashboard/billing/credit_grants`                     |
| 取值路径     | 从响应 JSON 中取余额的路径，如 `balance_infos[0].total_balance`                                       |
| 厂商模板     | 内置常见厂商的「请求路径 + 取值路径」预设，配置时一键填入，仍可手动改                                 |
| 余额缓存     | 查询结果落本地缓存（含时间戳），启动自动查询时先读缓存再刷新                                          |
| 低余额阈值   | 余额低于该值时卡片标红 + ZTools 系统通知（默认 5，按供应商配置）                                      |
| 查询策略     | 进入插件自动查询（仅当前激活 appType）+ 定时刷新 + 卡片手动刷新；同一供应商自动查询有最小间隔（防抖） |

**声明**：余额来自供应商接口实时数据，非估算；查询失败/未配置时明确展示失败态或隐藏，不伪装数据。

---

## 数据结构

### 余额查询结果

```ts
interface BalanceResult {
  success: boolean
  balance?: number // 余额（按配置的取值路径解析出的数值）
  used?: number // 已用额度（可选的第二取值路径，模板可带）
  currency?: string // 货币：USD / CNY（配置指定，或解析出的 currency 字段）
  queriedAt: number // 查询时间戳
  error?: string // 失败原因（成功时省略）
}
```

### 余额缓存条目

```ts
interface BalanceCacheEntry {
  providerId: string
  appType: string
  result: BalanceResult
  queriedAt: number
}
```

### 供应商余额配置（存 Provider 字段）

```ts
// 挂在 Provider 上，随供应商一起保存/导入导出
interface ProviderBalanceConfig {
  enabled: boolean // 该供应商是否查询余额，默认 false
  path: string // 请求路径，如 '/user/balance'、'/v1/dashboard/billing/credit_grants'
  balancePath: string // 余额取值路径，如 'balance_infos[0].total_balance'
  usedPath?: string // 已用取值路径（可选）
  balanceTransform?: string // 余额转换（模板带）：'divide:N' 除以 N、'subtract:path' 减去另一取值
  currency?: string // 'AUTO' | 'USD' | 'CNY'，默认 'AUTO'
  lowThreshold?: number // 低余额阈值，默认 5
  autoRefresh?: boolean // 是否参与自动查询/定时刷新，默认 true
  refreshIntervalSec?: number // 自动刷新间隔（秒），默认 600，0=不定时；页面定时节奏以当前激活供应商为准
  timeoutMs?: number // 请求超时，默认 8000
}
```

> 全部配置均为按供应商设置，无全局余额配置；未配置 `autoRefresh` 字段视为开启自动查询。

### 存储 Key

| Key                        | 存储             | 内容                                      |
| -------------------------- | ---------------- | ----------------------------------------- |
| Provider 的 `balance` 字段 | ztools.db        | ProviderBalanceConfig（随供应商导入导出） |
| `cctoggle_balance_cache`   | ztools.dbStorage | `Record<providerId, BalanceCacheEntry>`   |

---

## 功能需求

### 1. 余额查询引擎

#### 1.1 查询规则

- 只有 `provider.balance.enabled === true` 且配置了 `path` / `balancePath` 的供应商才发起查询
- 请求：`GET {baseUrl}{path}`，携带 `Authorization: Bearer {apiKey}`
- 响应解析：按 `balancePath` 点路径取值（支持 `data.balance`、`balance_infos[0].total_balance` 等），解析失败视为查询失败
- 未配置余额查询的供应商：**不发起任何请求，卡片不显示余额位**

#### 1.2 厂商模板（可选预设，非自动识别）

供应商编辑表单的「余额查询」区提供**模板下拉**，选中即自动填入 `path` + `balancePath`（可继续手动修改）。内置模板：

| 厂商                             | 请求路径                              | 余额取值路径                     | 货币 |
| -------------------------------- | ------------------------------------- | -------------------------------- | ---- |
| DeepSeek                         | `/user/balance`                       | `balance_infos[0].total_balance` | AUTO |
| OpenAI 兼容中转（credit_grants） | `/v1/dashboard/billing/credit_grants` | `total_available`                | USD  |
| OpenAI 兼容中转（/v1/balance）   | `/v1/balance`                         | `balance`                        | AUTO |
| OneAPI / NewAPI                  | `/api/user/self`                      | `quota`（除以 500000）           | USD  |
| 硅基流动 SiliconFlow             | `/user/info`                          | `data.userInfo.balanceUsd`       | USD  |
| OpenRouter                       | `/api/v1/auth/key`                    | `data.limit` − `data.usage`      | USD  |

> 模板只是「填好的默认值」，不做任何自动识别/匹配。用户套用后可自由修改；接口变了也只是改配置，不依赖插件升级。

#### 1.3 请求头

统一携带 `Authorization: Bearer {apiKey}`（复用供应商明文 apiKey，与 ConnectionTester 一致）。供应商无 apiKey 时不发起查询。

#### 1.4 实现位置

- 查询引擎 → preload 新增 `BalanceManager`（`src/preload/balance.ts`），需要发起网络请求、读取供应商 apiKey、落缓存，**必须走 preload**
- 缓存读取与配置读写 → BalanceManager 内实现

### 2. 供应商卡片余额显示

ProviderCard 底部新增**独立余额区块**：置于卡片主体内容下方一整行，Full 与 Compact 布局均显示，不占用按钮行空间。

余额区块展示状态：

| 状态           | 展示                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| 查询成功       | `$2.35`（跟随 currency，双币时可 `¥16.9`），颜色跟随阈值；余额下方小字可显示「已用 $1.2」（配置了 usedPath 时） |
| 低于阈值       | 余额文字红色 + 警示标记（⚠），区块边框红色                                                                      |
| 查询中         | 小号 loading（n-spin）占位                                                                                      |
| 查询失败       | `—` 灰显，tooltip 显示失败原因，可点重试                                                                        |
| 未配置余额查询 | 不渲染该区块（避免误导）                                                                                        |

区块内容布局：左侧「余额」标签 + 金额（+ 可选「已用」小字），右侧手动刷新图标按钮（tiny）。

#### Compact 卡片按钮收敛

余额区块加进来后，Compact（2 列网格，半屏宽）卡片会拥挤。为腾出空间，**Compact 布局按钮收敛**：

| 布局         | 按钮                      | 处理                                                  |
| ------------ | ------------------------- | ----------------------------------------------------- |
| Full（hero） | 切换 / 编辑 / 复制 / 删除 | 保持不变                                              |
| Compact      | 切换 / 编辑               | 直接展示                                              |
| Compact      | 复制 / 删除               | 收进「···」下拉菜单（n-dropdown），点击项执行对应操作 |

#### UI 示意（Compact）

```
┌──────────────────────────────┐
│ 名称 · 模型           [切换][编辑]···│
│ 备注                          │
│ ─────────────────────────────│
│ 余额  $2.35               [⟳] │
└──────────────────────────────┘
```

#### UI 示意（Full）

```
┌──────────────────────────────────────────────────────────────┐
│ 名称 [当前] [第三方] [openai]                   [切换][编辑][复制][删除] │
│ https://api.xxx.com/v1 · gpt-5.5                              │
│ ───────────────────────────────────────────────────────────── │
│ 余额    $2.35                                      [⟳]       │
└──────────────────────────────────────────────────────────────┘
```

- 余额正常：`$2.35`（暗色）
- 低余额：`$2.35` 红色 + ⚠，区块边框红色
- 查询失败：`—` 灰显，hover tooltip「查询失败：403 Forbidden」
- 未配置：无余额区块

### 3. 查询时机与缓存

| 时机                            | 行为                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 进入插件（启动）                | 对当前 appType 中「已配置余额查询」且 `autoRefresh` 未关闭的供应商，先渲染缓存值，再逐个静默刷新；并按当前激活供应商的 `refreshIntervalSec` 启动定时刷新 |
| 定时刷新                        | 每 `refreshIntervalSec` 秒（以当前激活供应商为准，0=不定时）**仅对当前激活供应商**静默刷新一次（沿用防抖）；未激活卡片不参与定时                         |
| 卡片手动刷新                    | 点击刷新图标立即查询该供应商，并更新缓存（不受 autoRefresh 与防抖限制）                                                                                  |
| 切换当前供应商（同 appType 内） | 若目标供应商已配置余额查询且无缓存或缓存超过 10 分钟，自动补查一次                                                                                       |
| 缓存写入                        | 每次查询成功后更新 `cctoggle_balance_cache`                                                                                                              |

**防抖规则**：同一供应商两次自动查询间隔 ≥ 30s；手动刷新采用首触发防抖（首次点击立即请求，2s 窗口内重复点击忽略），防止连点刷请求。

**余额耗尽自动暂停**：当前激活供应商余额 ≤ 0（耗尽/欠费）时停止定时自动刷新，避免空轮询；手动刷新发现余额 > 0（如充值后）自动恢复定时刷新。

#### 定时器生命周期与内存安全（必做）

- **集中协调**：`useBalance` 自监听 `providers` 集合变化，统一走 `reconcile()` 处理挂载 / 切 Tab / 切项目 / 增删改 / 切换当前供应商等所有场景（重建视图、启停定时器、按需补查），页面仅 `init()` / `dispose()`
- **切换 appType（Tab）/ 项目（Profile）时重置定时器**：集合整体变化 → `clearInterval` 旧定时器，按新上下文重启，且新供应商立即补查（旧视图作废）
- **插件退出/卸载时清理**：`dispose()` 中 `clearInterval` 并解除监听，避免定时器/监听器泄漏
- **查询 Promise 的竞态控制**：连续手动刷新用请求序号（sequence token）标记，仅最后一次请求的结果可写缓存/更新 UI，过期结果丢弃
- **不在 preload 常驻定时器**：定时刷新由前端 composable（useBalance）管理，preload 仅提供单次查询能力，随组件卸载自然清理

### 4. 低余额告警

- 阈值：每供应商 `lowThreshold`，默认 5
- 判定：`balance < lowThreshold` 视为低余额（查询失败/未配置不告警）
- 变色：余额区块文字红色 + ⚠，区块边框红色（`provider-card--low` 样式作用于卡片底部余额区块）
- ZTools 通知：**仅当前激活供应商**在以下时机触发一次 `ztools.showNotification`：
  - 启动自动查询后首次发现余额低于阈值
  - 手动刷新后余额从高于阈值变为低于阈值
- 通知去重：按**项目（profile）维度**去重，同一项目内同一供应商只通知一次；告警标记存于项目文档的 `balanceNotify` 字段（key `appType_providerId`），跨页面会话有效，不会因每次打开插件重复弹通知；已通知过的不重复（除非余额先回升再跌破）
- 本期不做：余额耗尽自动切换供应商、自动停用代理

### 5. 供应商配置入口（核心）

供应商编辑表单新增**「余额查询」面板**（全部按供应商配置，无全局余额设置）：

```
余额查询                     [启用 switch] 默认关
├── 模板          [下拉：DeepSeek / OpenAI中转(credit_grants) / ... / 自定义]
├── 请求路径      [input] 如 /user/balance
├── 余额取值路径  [input] 如 balance_infos[0].total_balance
├── 已用取值路径  [input] 可选
├── 自动查询      [switch] 默认开，关闭则该供应商仅手动刷新
├── 刷新间隔      [number] 分钟，默认 10，0=不定时
├── 请求超时      [number] ms，默认 8000
├── 货币          [AUTO / USD / CNY]
└── 低余额阈值    [number] 可选，默认 5
```

- 「启用」开关关闭时其余字段隐藏，卡片不显示余额
- 选模板只填请求/取值路径，其余字段保持用户已填值
- 配置随供应商保存（provider 字段），复制/导入供应商时一并带出

> 自动刷新行为：进入插件/切换时对**新增的**已配置供应商一次性补查（未激活卡片显示缓存或补查一次）；定时刷新仅作用于当前激活供应商（按它的间隔），间隔 0 表示不定时。未激活卡片靠手动刷新或切换后补查，不占用定时器。防抖（30s）仍然生效。

---

## API 设计

### Preload 新增（BalanceManager）

```ts
getBalanceCache(): Record<string, BalanceCacheEntry>
queryBalance(appType: string, providerId: string): Promise<BalanceResult>
queryAllBalances(appType?: string): Promise<Record<string, BalanceResult>>
```

> 缓存清理：删除供应商时由 ProviderStore 同步清理对应缓存条目（无独立 API）。

> 供应商的余额配置（path/balancePath/autoRefresh/interval/timeout 等）不新增独立 API，作为 Provider 字段随 `saveProvider` 一并保存。

> `queryAllBalances` 供启动自动查询批量调用，内部串行带最小间隔且跳过 `autoRefresh=false` 的供应商；单次 `queryBalance` 供卡片手动刷新。

> 按 API 同步规则，需同步更新 4 处：`preload.ts`、`ztools-cctoggle.d.ts`、`browser-adapter.ts`、`dev-api-server.cjs`。

### 前端新增

```
src/preload/balance.ts        # BalanceManager 查询引擎
src/composables/useBalance.ts # 缓存读写、阈值判定、去重通知逻辑
src/components/provider/BalanceCard.vue  # 余额区块（卡片底部一行 + 刷新按钮）
src/data/balance-templates.ts # 厂商模板常量（path + balancePath）
```

---

## UI 交互

### 供应商卡片（Full）

```
┌──────────────────────────────────────────────────────────────┐
│ 名称 [当前] [第三方] [openai]                   [切换][编辑][复制][删除] │
│ https://api.xxx.com/v1 · gpt-5.5                              │
│ ───────────────────────────────────────────────────────────── │
│ 余额    $2.35                                      [⟳]       │
└──────────────────────────────────────────────────────────────┘
```

### 供应商卡片（Compact，2 列网格）

```
┌──────────────────────────────┐
│ 名称 · 模型           [切换][编辑]···│
│ 备注                          │
│ ─────────────────────────────│
│ 余额  $2.35               [⟳] │
└──────────────────────────────┘
```

- 余额正常：`$2.35`（暗色）
- 低余额：`$2.35` 红色 + ⚠，区块边框红色
- 查询失败：`—` 灰显，hover tooltip「查询失败：403 Forbidden」
- 未配置：无余额区块

### ZTools 系统通知

```
[余额不足提醒] 供应商「DeepSeek」余额 ¥1.2，低于阈值 ¥5，请及时充值
```

---

## 边界情况

| 场景                                | 处理                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| 未启用余额查询                      | 卡片不显示余额位，不发请求                                 |
| 配置了 path 但 balancePath 解析不到 | 查询失败态，提示「取值路径解析失败」                       |
| 接口返回 401/403                    | 查询失败态，提示「认证失败，请检查 API Key」               |
| 余额为 0                            | 显示 `¥0`，红色告警 + 通知                                 |
| 负数余额（欠费）                    | 按低余额处理，显示 `-¥1.2`                                 |
| 厂商接口改版导致解析失败            | 查询失败态，用户改配置即可，无需升级插件                   |
| 删除供应商                          | 同时清理其缓存条目                                         |
| 复制供应商                          | 余额配置随字段复制，缓存不继承（新 id 重新查询）           |
| 网络超时                            | 按查询失败处理，显示超时原因                               |
| 供应商无 apiKey                     | 不发起查询                                                 |
| currency 为 CNY 但接口返回 USD      | 按配置展示，不做汇率换算（避免引入汇率源）                 |
| 缓存中有旧值但刷新失败              | 保留旧值显示 + 灰显「更新失败」tooltip                     |
| 模板选错厂商                        | 模板可覆盖手动改；改错导致查询失败，界面上有失败原因可排查 |
| 切换 Tab/appType                    | 重置定时器 + 立即补查目标 appType，旧定时器 clearInterval  |
| 切换当前供应商（同 appType）        | 无缓存或超 10 分钟则补查一次，定时器不受影响               |
| 插件退出/卸载                       | 清理全部定时器与进行中的查询，无残留                       |
| 连续快速手动刷新                    | 竞态控制，仅最后一次请求结果写缓存/UI，过期结果丢弃        |

---

## 非目标（本期不做）

1. 不做汇率换算（USD→CNY 需汇率源，本期仅按配置货币展示）
2. 不自动识别厂商余额接口（接口异构易变，改由用户配置，模板辅助）
3. 不接入各家官方账单 API（Anthropic/OpenAI 官方无公开余额接口）
4. 余额耗尽不自动切换供应商 / 不停用代理
5. 不做余额趋势曲线（归属统计页扩展）

---

## 未来扩展

- 余额趋势记录（每日快照，可在费用看板对比）
- 余额耗尽自动切换备用供应商（依赖路由组策略）
- 用户自建模板收藏（跨供应商复用配置）
- 系统级定时轮询告警（不依赖进入插件）

---

## 验收标准

1. 供应商启用余额查询并配置 DeepSeek 模板后，卡片正确显示 `/user/balance` 余额（CNY）
2. 未启用余额查询的供应商卡片不显示余额区块，且不发起任何请求
3. 余额取值路径解析失败时显示失败态 + 可排查原因，不伪装数据
4. 余额低于阈值时区块文字变红 + ⚠ 警示，当前激活供应商弹出 ZTools 通知且同会话只通知一次
5. 启动进入插件自动查询已配置供应商（`autoRefresh=false` 的除外）并复用缓存（同一供应商 30s 防抖内不重复请求）；卡片手动刷新立即生效
6. 余额配置随供应商保存、复制、导入导出一并生效
7. Compact 卡片复制/删除收进「···」下拉，切换/编辑直接展示，卡片不显拥挤
8. 浏览器开发模式（browser-adapter → dev-api-server）行为一致，可 mock 余额接口
9. 删除供应商后缓存随之清理
10. 切换 Tab/appType 后旧定时器被清理，新 appType 按间隔定时刷新且立即补查一次
11. 插件退出后无残留定时器（可验证组件卸载后无 setInterval 存活）
12. 连续快速点击刷新，最终展示与最后一次请求一致，无旧结果回写
