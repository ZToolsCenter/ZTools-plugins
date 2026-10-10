# Crypt Tool 设计文档

- **日期**：2026-09-22
- **状态**：已批准（需求方书面确认 “go”）
- **路径**：Architectural（新子系统/可扩展架构）

## 1. 背景与目标

在现有 Ztools 插件脚手架（React 19 + Vite + TypeScript）上，构建面向开发者的加解密工具插件。

### 1.1 需求方确认的约束

1. 高颜值、现代布局；视觉方向经 mockup 确认为「展开式分类侧栏 + 深色输入表面」（非毛玻璃搜索式 Spotlight）。
2. 加密算法可配置启用/关闭；每个算法独立界面；可逆算法提供解密。
3. Ztools 插件；主窗口宽度默认约为屏幕 40%，UI 需适配窄面板。
4. 扩展一种算法的方式须优雅（单点注册，不改外壳）。
5. 主体页面不设置背景颜色，跟随宿主默认；仅控件使用轻量表面。
6. 每个算法界面含算法简要教学；多字段算法对算法主体及每个字段的意义做简要说明。
7. 交互：先选算法（侧栏），再进入该算法的交互界面。
8. 配置持久化使用 Ztools 官方配置 API（`ztools.dbStorage`）。
9. 算法实现以 Node.js `crypto` 为主。

### 1.2 成功标准

- 用户可在设置中启停算法，侧栏与直达指令立即一致。
- 每个首批算法可独立完成其核心变换，并带教学与字段说明。
- 新增算法只需：新目录 + registry 一行 + preload 一行 + 类型一行。
- `npm run build`（含 `tsc`）通过；核心算法有已知向量测试。

### 1.3 范围（首批）

**包含**：侧栏壳、设置启停、动态直达指令、9 个代表算法、Node crypto 实现、教学文案（随代码交付）。

**代表算法（每类 1–3 个）**：

| 分类 | 算法 |
|------|------|
| 编码转换 | Base64、Hex、URL |
| 哈希摘要 | MD5、SHA-256 |
| 对称加密 | AES |
| 非对称加密 | RSA |
| 消息认证 | HMAC-SHA256 |
| 口令派生 | PBKDF2 |

**不包含（后续批次）**：文件加解密、ChaCha20/Argon2/bcrypt 等铺量、算法排序自定义、多语言。

## 2. 架构方案（已选定）

**选定：方案 1 — 注册表 + 共享组件组合。**

否决的备选：

- **纯 Schema 表单渲染**：复杂算法（RSA 密钥对、AES 模式联动）适配成本高，不作为主路径。
- **沿用脚手架散路由**：侧栏/设置/启停无法复用，`App.tsx` 与 `plugin.json` 随算法膨胀，与可扩展目标冲突。

### 2.1 分层与依赖方向

```
shell → registry → algorithms → shared
config（横切：dbStorage + 动态 Feature）
preload（独立：Node crypto）
```

```
src/
  shell/                 # 侧栏分类导航 + 主区路由 + 设置页
  registry/              # 算法注册表（唯一扩展点）、分类定义、类型
  algorithms/<id>/       # meta.ts + ui.tsx（+ 文案）
  shared/                # Field、TeachCard、Actions、CopyButton 等
  config/                # dbStorage 读写 + setFeature/removeFeature 同步
  App.tsx                # 进入事件 → shell 路由
public/
  plugin.json            # 静态：主入口 crypt（及必要静态项）
  preload/services.js    # window.services.crypt.*
```

### 2.2 边界规则

1. `algorithms/*` 不互相 import，不 import `shell`。
2. 业务计算不进 React；渲染层只调 `window.services.crypt.*()`。
3. `shell` 只遍历 registry 并按启用集过滤来画侧栏与设置列表。
4. `config` 是唯一读写 `dbStorage` 与 `setFeature`/`removeFeature` 的模块。

### 2.3 入口双轨

| 入口 | 实现 |
|------|------|
| 主入口 | 静态 feature `code: "crypt"` → 侧栏总览 |
| 设置 | **仅**主界面内页（侧栏底部 ⚙）；不注册静态 `settings` feature |
| 算法直达 | 动态 feature：`code: "alg:<id>"`，启动时按启用集同步 |

现有示例 feature（`hello`/`read`/`write`）及对应组件在实施中移除，避免指令污染。

## 3. 数据流

### 3.1 启动 / 进入

```
App 挂载
  → config.load()           // dbStorage.getItem('crypt-tool:settings')
  → 无配置则使用默认启用集（首批 defaultEnabled 全部为 true）
  → config.syncFeatures()   // 启用 → setFeature；禁用 → removeFeature
  → shell 订阅 onPluginEnter
       code === 'crypt'      → 侧栏 + 选中首个启用算法（首批不持久化「上次算法」）
       code === 'alg:<id>'   → 定位该算法
       带文本 payload        → 预填该算法主输入字段（明文/输入）
```

### 3.2 一次计算（加密/解密/哈希/编码）

```
用户编辑字段 → 组件本地 state（不自动执行）
点击主操作
  → 必填校验（失败：行内错误，不调 preload）
  → window.services.crypt.<ns>.<op>(payload)
  → { ok:true, data } → 写入输出区；复制用 ztools.copyText
  → { ok:false, error } → ztools.showToast + 行内/输出区错误，输入保留
```

- 哈希类：仅「计算」；编码类：编码/解码在同一界面。
- 可逆算法：主操作 + 次操作（解密）+ 复制（+ 可选互换输入输出）。

### 3.3 启停算法

```
设置 toggle <id>
  → config.setEnabled(id, false)
  → dbStorage 写回
  → removeFeature('alg:<id>')
  → registry 状态更新 → 侧栏移除该项
  → 若当前停留该算法 → 跳至首个启用算法
  → 直达进入且已禁用 → 「已禁用」空态 + 打开设置
```

### 3.4 状态归属

| 状态 | 位置 |
|------|------|
| 启用集、输出编码等偏好 | `config` + dbStorage（跨会话） |
| 当前算法、表单值 | shell / 算法组件（会话内） |
| Feature 注册与否 | 仅由 config 同步 ZTools，不反向读取 |

## 4. Registry 契约与扩展

### 4.1 类型（概念签名）

```ts
type CategoryId =
  | 'encoding' | 'hash' | 'symmetric'
  | 'asymmetric' | 'hmac' | 'kdf'

interface AlgorithmMeta {
  id: string                 // 'aes'；feature code 为 'alg:aes'
  category: CategoryId
  label: string              // 'AES'
  title: string              // 'AES 对称加密'
  reversible: boolean
  cmds: string[]             // 直达指令名
  defaultEnabled: boolean
  teach: { summary: string } // 算法简要（中文）
}

interface AlgorithmModule {
  meta: AlgorithmMeta
  Component: React.FC<AlgorithmProps>
}
```

- 分类 id、中文名与顺序：`registry/categories.ts` 单一来源（编码转换、哈希摘要、对称加密、非对称加密、消息认证、口令派生）。
- `registry/algorithms.ts`：模块数组 + `getByCategory` / `getEnabled` / `getById`。

### 4.2 字段与教学

`shared/Field` 通用 props（不理解加密语义）：

- `label`、`hint`（如「16/24/32 字节」）、`help`（字段意义说明）、`type`：`text | secret | textarea | select`、`value` / `onChange`、错误态。

`teach.summary` 与各字段 `help` 由该算法 `ui.tsx` 撰写（中文，随代码交付）。

### 4.3 新增算法清单

| 步骤 | 变更 |
|------|------|
| 1 | 新增 `src/algorithms/<id>/{meta,ui,index}` |
| 2 | `registry/algorithms.ts` 数组追加一项 |
| 3 | `preload/services.js` 追加 `crypt.<id>.*` |
| 4 | `env.d.ts` 的 `Services` 补类型 |

**不修改**：侧栏、设置页、App 路由结构、`plugin.json`、`config`。

### 4.4 Preload 计算接口

- 统一信封：`{ ok: true, data: string }` | `{ ok: false, error: string }`（error 为可读中文）。
- 命名空间按算法：`services.crypt.aes.encrypt` / `aes.decrypt`、`sha256.digest`、`base64.encode` / `base64.decode` 等。
- 实现主体：Node.js `crypto`（及内置 `Buffer` 做编码）；渲染层不引入加密库。

## 5. UI 设计（已确认）

### 5.1 布局

```
┌────────────┬─────────────────────────────┐
│ 编码转换     │ [title]            [分类徽章] │
│   Base64   │ ┌ 教学卡（summary）────────┐ │
│   Hex      │ └─────────────────────────┘ │
│   URL      │ 字段网格（Field + help）      │
│ 哈希摘要     │ [主操作] [次操作] [复制] …     │
│   …        │ 输出区                       │
│ 对称加密     │                             │
│   AES ●    │                             │
│ …          │                             │
│ ⚙ 设置      │                             │
└────────────┴─────────────────────────────┘
```

- 视觉基线：确认稿 `layout-sidebar-v2`（展开式分类侧栏 A；输入/textarea/select 背景约 `rgba(0,0,0,.28)`；教学卡左侧蓝色强调线；主按钮渐变、次按钮深色幽灵）。
- 页面根容器不设置 background；滚动条与文字颜色跟随宿主/CSS 变量（`--text-color` 等，若可用）。
- 约 40% 屏宽：侧栏约 180–220px；过挤时用 CSS 将侧栏降级为窄轨/折叠，不改组件结构。
- 深浅色：不硬编码大片表面色；输入等表面使用相对透明黑/白或宿主变量，保证浅色与深色宿主下可读（实施时在两种主题下目测验收）。

### 5.2 设置页

- 同壳切换主区：按分类分组的算法开关 +「恢复默认」。
- 切换即时 `config.setEnabled` 并同步动态 feature。

### 5.3 空态与反馈

| 场景 | 表现 |
|------|------|
| 直达但已禁用 | 「该算法已禁用」+「打开设置」 |
| 全部禁用后进主入口 | 「没有启用的算法」+「打开设置」 |
| 必填校验失败 | 字段下红字，不调用 preload |
| preload `ok:false` | Toast + 错误展示，输入保留 |

## 6. 配置与动态 Feature

- 存储：`ztools.dbStorage`，键：`crypt-tool:settings`。
- 值形状（概念）：

```json
{
  "enabled": { "base64": true, "aes": true, "rsa": false },
  "prefs": { "defaultOutputEncoding": "base64" }
}
```

- 未知算法 id 忽略；缺省用 `defaultEnabled`。
- 动态 Feature：`ztools.setFeature({ code, explain, icon, cmds })` / `ztools.removeFeature(code)`；`explain` 用算法 `title`，`icon` 沿用 `logo.png`。
- 同步时机：App 启动 load 之后；每次 `setEnabled` 之后。

## 7. 错误处理

1. 业务失败一律信封 `{ ok:false, error }`，不向渲染层抛裸异常。
2. preload 内未捕获异常 → 包装为 `{ ok:false }`。
3. `copyText`、配置写失败 → `ztools.showToast`，流程不中断。

## 8. 测试策略

| 层 | 方式 |
|----|------|
| `services.crypt.*` | 单元测试：已知向量（Base64/Hex/URL 往返、SHA-256/MD5 标准摘要、AES 固定 Key/IV、HMAC、PBKDF2、RSA 加解密往返） |
| registry / config | 纯函数：启用过滤、默认集、feature 同步目标集合 |
| 构建 | `npm run build`（`tsc && vite build`）必须通过 |
| 手动冒烟 | 每算法一轮计算；启停后侧栏与直达一致；直达禁用空态；浅/深主题 |

测试运行器（`node:test` 或 vitest）在实施计划中锁定；本 spec 不绑定版本。

## 9. 非目标与后续批次

- 不在首批实现文件流加解密、算法市场、用户自定义算法脚本。
- 铺量算法在 registry + preload 模式下按批次追加，不改架构。

## 10. 验收清单

- [ ] 主入口进入可见分类侧栏，仅显示已启用算法。
- [ ] 每个首批算法界面含简要教学与逐字段说明；可逆算法有解密。
- [ ] 设置启停后：侧栏立即变化；对应 `alg:*` 指令从 Ztools 消失/恢复。
- [ ] 直达指令进入选中正确算法；对已禁用算法显示空态。
- [ ] 页面根无自定义背景色；输入为深色表面；约 40% 宽下布局可用。
- [ ] 新增算法按 §4.3 清单即可完成，无需改 shell/config/plugin.json。
- [ ] 单元测试与 `npm run build` 通过。
