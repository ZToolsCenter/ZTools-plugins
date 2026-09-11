# 后端代码面向对象重构评估与方案

> 创建日期：2026-08-04
> 状态：待评审

## 1. 背景与动机

当前 `src/preload/` 下 14 个后端文件全部采用**过程式/函数式**风格：模块级变量持有状态，纯函数操作数据，通过 `module.exports` 暴露 API。随着功能增长，这种模式暴露以下问题：

- **状态分散**：`proxy-daemon.ts` 有 12 个模块级变量（`group`, `members`, `server`, `healthTimer` 等），`sessions.ts` 有缓存状态，各模块的状态管理方式不一致
- **职责模糊**：`proxy-daemon.ts`（638行）同时承担 HTTP 服务、熔断器、负载均衡、SSE 解析、用量统计，全部混在一个文件的散落函数中
- **可测试性差**：函数依赖模块级闭包变量，无法独立 mock 或单测
- **类型缺失**：所有文件使用 `@ts-nocheck`，无类型注解

---

## 2. 现有模块清单

| 文件                 | 行数 | 职责                                                            |
| -------------------- | ---- | --------------------------------------------------------------- |
| `services.ts`        | 178  | 入口文件，组装所有模块到 `window.ztoolsCctoggle`                |
| `utils.ts`           | 667  | 基础工具：路径、ID 生成、日志、Codex 指令常量                   |
| `config-rw.ts`       | 633  | 5 种 Agent 的配置文件读写                                       |
| `provider-db.ts`     | 267  | 供应商 CRUD、切换、导入导出                                     |
| `sessions.ts`        | 894  | 会话扫描/解析（Claude, Codex, OpenClaw, Claude Desktop）        |
| `proxy.ts`           | 427  | 路由组 CRUD、代理启停、takeover/restore                         |
| `proxy-daemon.ts`    | 638  | HTTP 代理服务（隐藏 BrowserWindow），failover + 熔断            |
| `proxy-converter.ts` | 663  | 协议转换：Responses API ↔ Chat Completions ↔ Anthropic Messages |
| `mcp.ts`             | 492  | MCP 服务器配置管理                                              |
| `prompts.ts`         | 457  | Prompt CRUD、备份/恢复、应用到 Agent 配置                       |
| `skills.ts`          | 583  | Skill nest 管理、deploy/undeploy、项目目标                      |
| `stats.ts`           | 178  | 用量统计扫描                                                    |
| `cleanup.ts`         | 313  | 数据迁移（版本化）、MCP 映射清理                                |
| `test-connection.ts` | 235  | API 连接测试                                                    |

---

## 3. 模块改造评估

### 按收益排序，分为三个优先级：

### P0 — 高收益（状态复杂、逻辑内聚）

| 模块              | 行数 | 现状                           | 改造为 Class     | 理由                                                                       |
| ----------------- | ---- | ------------------------------ | ---------------- | -------------------------------------------------------------------------- |
| `proxy-daemon.ts` | 638  | 12 个模块级变量 + 20+ 散落函数 | `ProxyDaemon`    | 最大受益者：HTTP server 生命周期、熔断状态机、负载均衡策略天然适合封装为类 |
| `sessions.ts`     | 894  | 2 个缓存对象 + 大量解析函数    | `SessionScanner` | 扫描缓存 + 文件解析逻辑内聚，可封装为带缓存策略的扫描器                    |
| `provider-db.ts`  | 267  | CRUD + 切换逻辑                | `ProviderStore`  | 供应商数据的完整生命周期管理，天然领域对象                                 |

### P1 — 中等收益（逻辑聚合、减少文件间耦合）

| 模块           | 行数 | 改造为 Class                    | 理由                                                     |
| -------------- | ---- | ------------------------------- | -------------------------------------------------------- |
| `config-rw.ts` | 633  | `ConfigReader` / `ConfigWriter` | 5 种 agent 的配置读写逻辑相似，可用策略模式统一          |
| `proxy.ts`     | 427  | `ProxyManager`                  | 路由组 CRUD + 代理启停管理，状态（运行中的代理）需要封装 |
| `prompts.ts`   | 457  | `PromptManager`                 | Prompt CRUD + 备份/恢复 + 应用到 agent 的编排逻辑        |
| `skills.ts`    | 583  | `SkillManager`                  | Skill nest 管理 + 部署/取消部署 + 项目目标               |

### P2 — 低收益（工具性质、无状态或状态简单）

| 模块                 | 行数 | 建议                    | 理由                                            |
| -------------------- | ---- | ----------------------- | ----------------------------------------------- |
| `utils.ts`           | 667  | **保持函数式**          | 纯工具函数集合，无状态，强行 OOP 反而增加复杂度 |
| `mcp.ts`             | 492  | 可选 `McpStore`         | 逻辑相对简单，改造收益一般                      |
| `stats.ts`           | 178  | **保持函数式**          | 扫描逻辑简单，无复杂状态                        |
| `cleanup.ts`         | 313  | **保持函数式**          | 迁移脚本性质，一次执行，无需 OOP                |
| `test-connection.ts` | 235  | **保持函数式**          | 纯函数：发起请求、检查响应                      |
| `proxy-converter.ts` | 663  | **保持函数式**          | 纯数据转换，无状态                              |
| `services.ts`        | 178  | 改为 `ServiceContainer` | 作为组装入口，可改为依赖注入容器                |

---

## 4. 推荐的 Class 设计

### 4.1 `ProxyDaemon`（P0，最大改造）

```
class ProxyDaemon {
  // 状态封装
  private server: http.Server | null
  private members: MemberState[]
  private group: RouteGroupConfig
  private rrIdx: number
  private activeConn: number
  private stats: RequestStats

  // 生命周期
  constructor(config: RouteGroupConfig)
  start(): Promise<void>
  stop(): Promise<void>

  // 熔断器（内部策略）
  private noteSuccess(member: MemberState): void
  private noteFailure(member: MemberState): void
  private tickBreaker(): void
  private pickMember(): MemberState | null

  // 请求处理
  private handleRequest(req, res): Promise<void>
  private proxyToUpstream(req, res, member): Promise<void>

  // 用量统计
  private reportUsage(member: MemberState, usage: object): void
}
```

### 4.2 `SessionScanner`（P0）

```
class SessionScanner {
  private scanCache: { data: ScanResult | null; timestamp: number }
  private sessionCache: Map<string, SessionDetail>
  private readonly TTL: number
  private readonly CHUNK_SIZE: number

  scanSessions(appType: string, options?: ScanOptions): Promise<ScanResult>
  loadSessionDetail(filePath: string): Promise<SessionDetail>
  deleteSession(appType: string, filePath: string): boolean
  clearCache(): void

  private readHeadAndTail(filePath: string): Promise<HeadTailResult>
  private parseSessionMetadata(lines: string[]): SessionMeta
}
```

### 4.3 `ProviderStore`（P0）

```
class ProviderStore {
  private dbPrefix: string

  listProviders(appType: string): Provider[]
  getProvider(appType: string, id: string): Provider | null
  saveProvider(appType: string, data: ProviderData): string
  deleteProvider(appType: string, id: string): boolean
  switchProvider(appType: string, id: string): void
  exportAll(): ExportData
  import(data: ExportData): ImportResult
}
```

### 4.4 `ProxyManager`（P1）

```
class ProxyManager {
  private daemons: Map<string, ProxyDaemon>  // appType -> daemon
  private routeGroups: RouteGroupStore

  listRouteGroups(): RouteGroup[]
  saveRouteGroup(data: RouteGroupData): void
  startProxy(groupId: string): Promise<void>
  stopProxy(groupId: string): Promise<void>
  getStatus(): ProxyStatus
}
```

### 4.5 `PromptManager`（P1）

```
class PromptManager {
  listPrompts(): Prompt[]
  getPrompt(id: string): Prompt | null
  savePrompt(data: PromptData): string
  deletePrompt(id: string): boolean
  duplicatePrompt(id: string): string
  exportPrompts(ids?: string[]): ExportData
  importPrompts(data: ExportData): ImportResult
  applyPromptToAgent(promptId: string, agentType: string): void
  backupOriginal(agentType: string): void
  restoreOriginal(agentType: string): void
}
```

### 4.6 `SkillManager`（P1）

```
class SkillManager {
  private nestDir: string
  private deployRegistry: DeployRegistry

  listNestSkills(): Skill[]
  installSkill(source: string): Skill
  removeNestSkill(id: string): boolean
  deploySkill(skillId: string, agentType: string): void
  undeploySkill(skillId: string, agentType: string): void
  listDeployments(): Deployment[]
  syncSkills(): SyncResult
}
```

---

## 5. 实施方案

### 阶段一：基础设施（1-2 天）

1. 移除 `@ts-nocheck`，逐步添加类型注解
2. 定义核心接口/类型（扩展现有 `src/types/ztools-cctoggle.d.ts`）
3. 建立基类 `BaseStore`（封装 `ztools.db` 操作的通用 CRUD）

### 阶段二：P0 模块改造（3-5 天）

按依赖顺序：`ProviderStore` → `SessionScanner` → `ProxyDaemon`

- 每个模块改造后保持 `services.ts` 的对外 API 不变（向后兼容）
- 改造一个、测试一个，不批量改动

### 阶段三：P1 模块改造（3-4 天）

`ProxyManager` → `PromptManager` → `SkillManager` → `ConfigReader/Writer`

### 阶段四：入口重构（1 天）

`services.ts` 改为依赖注入容器，自动组装所有 Manager 实例

---

## 6. 代码规范

### 6.1 命名规范

| 类型      | 规范                        | 示例                                    |
| --------- | --------------------------- | --------------------------------------- |
| 类名      | PascalCase                  | `ProxyDaemon`, `SessionScanner`         |
| 方法/属性 | camelCase                   | `listProviders`, `scanCache`            |
| 私有成员  | TypeScript `private` 修饰符 | `private server: http.Server`           |
| 常量      | UPPER_SNAKE_CASE            | `DB_PREFIX`, `MAX_REQUEST_BYTES`        |
| 接口      | 名词或 `I` 前缀             | `Provider`, `RouteGroup`, `MemberState` |

### 6.2 类设计原则

- **单一职责**：每个类管理一个明确的领域（Provider 数据、Session 扫描、Proxy 运行时）
- **构造函数注入**：依赖通过构造函数传入，而非 `require()` 顶部引用（便于测试）
- **私有默认**：所有成员默认 `private`，仅暴露必要的 public API
- **无状态工具函数**：保留在 `utils.ts` 中作为纯函数，不强行包装为类

### 6.3 TypeScript 规范

- 启用 `strict: true`（至少在 `tsconfig.preload.json` 中逐步开启）
- 所有 public 方法必须有显式返回类型注解
- 使用 `interface` 定义数据结构，`class` 定义行为
- 逐步移除 `@ts-nocheck`，每个模块改造时同步完成

### 6.4 文件组织

- 一个文件一个主类（`proxy-daemon.ts` → `class ProxyDaemon`）
- 相关接口定义在同一文件顶部，或抽取到 `src/types/` 下按领域分文件
- `services.ts` 保持为唯一入口，负责实例化和组装

---

## 7. 风险与注意事项

1. **ZTools preload 环境限制**：preload 运行在 Electron renderer 的 preload 上下文，不是完整 Node.js 环境。确保 class 语法在目标 Electron 版本中受支持（ES2020 target 已覆盖）
2. **`proxy-daemon.ts` 运行在隐藏 BrowserWindow**：它有独立的 preload 入口，改造时需确保 IPC 通信接口（`ztools.sendToParent`）不变
3. **向后兼容**：`services.ts` 暴露到 `window.ztoolsCctoggle` 的 API 必须保持不变，前端 Vue 代码不应受影响
4. **渐进式迁移**：不要一次性重写所有模块，按 P0 → P1 → P2 顺序逐步改造

---

## 8. 验证方式

- 每个模块改造后，运行现有功能手动测试（ZTools 插件环境）
- 确保 `window.ztoolsCctoggle` 的所有方法签名不变
- TypeScript 编译通过（`npm run build:preload` 无报错）
