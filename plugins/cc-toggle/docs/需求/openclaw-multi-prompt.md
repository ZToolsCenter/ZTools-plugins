# OpenClaw 多文件提示词管理方案

> 创建日期：2026-08-07
> 状态：待评审
> 涉及模块：`prompts.ts`、`utils.ts`、`cleanup.ts`、`PromptCard.vue`、`PromptEditor.vue`、`PromptPreview.vue`、`PromptsPage.vue`

---

## 1. 背景与动机

当前提示词管理的模型是「一段 `content` → 一个文件」：每个 Agent 映射到一个固定提示词文件，一个 `Prompt` 只有单个 `content` 字段，切换提示词时整体覆盖该文件。

OpenClaw 的提示词体系是**多文件结构**，各文件职责不同：

| 文件           | 用途                                               |
| -------------- | -------------------------------------------------- |
| `AGENTS.md`    | 总体行为准则（如"先自己想办法"、"私事保密"等红线） |
| `SOUL.md`      | 性格调性（如"有观点、不端着、别演"）               |
| `IDENTITY.md`  | 身份人设（叫小夏，奶黄+浅棕配色，捧着热饮看书）    |
| `USER.md`      | 用户笔记                                           |
| `TOOLS.md`     | 本地环境备注（设备名、SSH 别名）                   |
| `HEARTBEAT.md` | 心跳检查清单（空则不触发定时任务）                 |
| `MEMORY.md`    | 长期记忆，仅一对一聊天时加载                       |

**现有问题**：

1. `getOpenClawAgentsMdPath()` 只映射到 `workspace/AGENTS.md`（`utils.ts`），只能管理 1 个文件，其余 6 个文件完全无法通过本插件管理
2. `Prompt.content` 单字段模型无法表达多文件结构
3. `MEMORY.md` 是运行时动态积累的记忆，若被当作提示词覆盖会丢失长期记忆
4. 备份/恢复（`backups`）只按 Agent 粒度存单份内容，无法按文件恢复

---

## 2. 方案选型

### 方案 A：弱区分（推荐）

`Prompt` 增加 `fileName` 字段，只对 OpenClaw 生效；其他 Agent 写各自固定默认文件（`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`）。

### 方案 B：强隔离

OpenClaw 提示词与其他 Agent 分开管理，绑定 openclaw 的 prompt 不显示在其他 Agent 的 chip 上，相当于两套独立体系。

### 结论

**采用方案 A**，理由：

| 维度          | A 弱区分                                  | B 强隔离                     |
| ------------- | ----------------------------------------- | ---------------------------- |
| 冲突处理      | `fileName` 只作用于 openclaw，边界清晰    | 完全隔离，无冲突             |
| 跨 Agent 复用 | 保留（通用内容可同时挂 Codex + OpenClaw） | 丢失                         |
| 改动量        | 加 1 个字段 + 编辑器下拉                  | 拆两套体系，改列表/筛选/备份 |
| 人设包兼容    | `files` 字典天然 openclaw 独占，无混绑    | 与 A 一致                    |

---

## 3. 数据模型

### 3.1 `Prompt` 增加 `fileName`

```ts
interface Prompt {
  id: string
  name: string
  description: string
  content: string
  fileName?: string | null // 新增：目标文件名（仅 openclaw 可选）
  agents: string[]
  variables: string[]
  tags: string[]
  isTemplate: boolean
  templateId: string | null
  createdAt: string
  updatedAt: string
}
```

- 其他 Agent 的 `fileName` 恒为默认文件（`claude`→`CLAUDE.md`，`codex`→`AGENTS.md`，`gemini`→`GEMINI.md`），不入库或入库也忽略
- OpenClaw 的 `fileName` 从预定义清单中选择，默认 `AGENTS.md`

### 3.2 可选进阶：整套人设包

```ts
interface Prompt {
  // ...上述字段
  files?: Record<string, string> // fileName → content，人设包模式使用
}
```

- 人设包 = 一个 prompt 携带 6 个文件的内容，切换时一次写入全部文件
- `MEMORY.md` 不进入 `files`（见 §4.3）
- 单文件 prompt 与人设包并存，互不影响

---

## 4. OpenClaw 文件处理规则

### 4.1 提示词文件清单

`utils.ts` 新增：

```ts
const OPENCLAW_PROMPT_FILES = [
  { file: "AGENTS.md",    label: "总体行为准则 · 红线" },
  { file: "SOUL.md",      label: "性格调性" },
  { file: "IDENTITY.md",  label: "身份人设" },
  { file: "USER.md",      label: "用户笔记" },
  { file: "TOOLS.md",     label: "环境备注" },
  { file: "HEARTBEAT.md", label: "心跳清单" },
]

function getOpenClawPromptPath(fileName: string): string | null {
  const workspace = getOpenClawWorkspaceDir()
  if (!workspace) return null
  return path.join(workspace, fileName)
}

function getOpenClawPromptFiles(): string[] { ... }  // 返回文件名清单
```

### 4.2 `MEMORY.md` 特殊处理

| 操作             | 行为                                    |
| ---------------- | --------------------------------------- |
| 应用/切换 prompt | **跳过**，不覆盖、不写入                |
| 备份             | **排除**，不在备份范围                  |
| 恢复             | **排除**，不参与恢复                    |
| 展示             | 只读查看，UI 标注「记忆文件不参与切换」 |

理由：`MEMORY.md` 是对话积累的长期记忆，不属于"提示词配置"，一旦被切换覆盖会丢失全部学习成果。

### 4.3 文件定位

`_getAgentPromptPath` 改造为按文件定位：

```ts
private static _getAgentPromptPath(agent: string, fileName?: string): string | null {
  switch (agent) {
    case "claude":   return utils.getClaudeMdPath()
    case "codex":    return utils.getCodexAgentsMdPath()
    case "gemini":   return utils.getGeminiMdPath()
    case "openclaw": return fileName ? utils.getOpenClawPromptPath(fileName)
                                     : utils.getOpenClawAgentsMdPath()
    default: return null
  }
}
```

---

## 5. 备份与恢复

### 5.1 数据模型统一为文件粒度

```ts
interface BackupsMap {
  [agent: string]: {
    [fileName: string]: BackupEntry // { content, backedUpAt }
  }
}
```

| Agent    | 备份结构                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| codex    | `{ AGENTS.md: {...} }`                                                                                           |
| claude   | `{ CLAUDE.md: {...} }`                                                                                           |
| gemini   | `{ GEMINI.md: {...} }`                                                                                           |
| openclaw | `{ AGENTS.md: {...}, SOUL.md: {...}, IDENTITY.md: {...}, USER.md: {...}, TOOLS.md: {...}, HEARTBEAT.md: {...} }` |

### 5.2 备份

- 只备份 6 个提示词文件，`MEMORY.md` 不在备份范围
- 备份弹窗：openclaw 行可展开按文件勾选，默认全选 6 个，另提供「一键备份整个 OpenClaw」
- `backupSelectedPrompts` 接收 `{ agent, files?: string[] }` 粒度参数

### 5.3 恢复

- 恢复抽屉：openclaw 展开成 6 行，每行独立「恢复」按钮 + 备份状态
- `MEMORY.md` 一行固定显示「不参与恢复」
- 「恢复全部」= 所有 Agent 的所有文件
- `togglePromptAgent` 取消关联时的"还原备份"逻辑，按 `fileName` 精确比对当前内容再还原

### 5.4 迁移

`cleanup.ts` 新增迁移：旧格式 `{ openclaw: { content, backedUpAt } }` → 新格式 `{ openclaw: { "AGENTS.md": { content, backedUpAt } } }`，其余 Agent 结构保持不变。

---

## 6. API 设计

### 6.1 修改

```ts
// applyPromptToAgent 增加 fileName 参数
applyPromptToAgent(promptId: string, agent: string, fileName?: string): ResultWithPrompt

// backupSelectedPrompts 支持按文件粒度
backupSelectedPrompts(selections: { agent: string, files?: string[] }[]): BackupResult

// togglePromptAgent 透传 fileName
togglePromptAgent(promptId: string, agent: string, fileName?: string): ToggleResult
```

### 6.2 新增

```ts
readOpenClawPromptFiles(): { [fileName: string]: string }   // 6 文件 + MEMORY.md 只读内容
getOpenClawPromptFiles(): string[]                          // 预定义文件清单（供前端下拉）
```

### 6.3 保持不动

- `readAllOriginalPrompts()` 签名不变（返回各 Agent 默认文件内容）
- `Prompt` 已有字段全部兼容

> ⚠️ 按 API 同步规则：新增/修改 preload 方法时，需同步更新 `preload.ts`、`ztools-cctoggle.d.ts`、`browser-adapter.ts`，真实数据类还需更新 `dev-api-server.cjs`。

---

## 7. UI 改动

### 7.1 PromptCard.vue（列表卡片）

- OpenClaw chip 从「点一下应用」改为「点击弹 `n-dropdown` 选文件」
- chip 标签显示目标文件（如 `SOUL.md`），而非固定 `OpenClaw`
- 下拉选项 = 6 个提示词文件（带中文说明）+ `MEMORY.md`（disabled + tooltip「记忆文件，不参与切换」）+ 「整套人设包」入口
- 选中后调 `applyPromptToAgent(promptId, 'openclaw', fileName)`
- 卡片上以 `file-badge` 显示当前 `fileName`；其他 Agent 保持单 chip 固定写默认文件

### 7.2 PromptEditor.vue（编辑抽屉）

- 「描述」下方新增「目标文件」下拉，**仅当 agents 含 openclaw 时显示**，选项带说明
- `MEMORY.md` 用 disabled option，下方浅灰提示「记忆文件只读，不会随切换被覆盖」
- 新增「整套人设包」`n-switch`：
  - 关闭（默认）：单个 textarea，保存 `content` + `fileName`
  - 开启：内容区换成 `n-tabs`，每个文件一个 tab 一个 textarea，保存 `files` 字典
- 当同时勾选 openclaw 和其他 Agent 时，下拉下方提示「目标文件仅对 OpenClaw 生效，其他 Agent 写入各自默认文件」

### 7.3 PromptPreview.vue（预览弹窗）

- 「关联 Agent」下方显示 `fileName`
- 人设包模式改用 `n-tabs` 按文件切换预览

### 7.4 PromptsPage.vue（备份/恢复）

- 恢复抽屉：openclaw 展开为按文件粒度的行（原型见附图）
- 备份弹窗：openclaw 可展开勾选具体文件，`MEMORY.md` 禁用
- 「恢复全部」覆盖所有 Agent 所有文件

---

## 8. 边界情况

1. **多 Agent 混绑**：prompt 同时挂 openclaw + codex 时，`fileName` 只影响 openclaw，codex 写固定 `AGENTS.md`，Editor 中有提示
2. **OpenClaw 工作区不存在**：`getOpenClawPromptPath` 返回 null，应用时报「OpenClaw workspace not found」（沿用现有逻辑 `prompts.ts:314`）
3. **未选择 fileName**：openclaw 应用时默认 `AGENTS.md`
4. **人设包部分文件缺失**：`files` 里没列的文件保持现状不写入
5. **旧备份无新结构**：迁移前按旧格式读，迁移后按新格式读
6. **MEMORY.md 意外写入**：`_writePromptFile` 对 `openclaw` + `MEMORY.md` 直接拒绝写入

---

## 9. 实施顺序

| 阶段 | 内容                                        | 涉及文件                                                                         |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| 1    | 后端：`fileName` 字段、文件清单、按文件读写 | `utils.ts`、`prompts.ts`、`cleanup.ts`                                           |
| 2    | 后端：备份/恢复按文件粒度 + 数据迁移        | `prompts.ts`、`cleanup.ts`                                                       |
| 3    | API 同步（3 文件规则 + dev-api-server）     | `preload.ts`、`ztools-cctoggle.d.ts`、`browser-adapter.ts`、`dev-api-server.cjs` |
| 4    | 前端：Editor 文件选择器 + 人设包开关        | `PromptEditor.vue`                                                               |
| 5    | 前端：卡片下拉 + badge                      | `PromptCard.vue`、`PromptPreview.vue`                                            |
| 6    | 前端：备份/恢复按文件展开                   | `PromptsPage.vue`                                                                |

## 10. 验证方式

- `pnpm tsc:preload` 编译通过
- 浏览器模式 `pnpm dev:browser` 验证 UI 交互
- ZTools 环境手动验证：新建 OpenClaw 提示词选 SOUL.md → 应用到卡片 chip → 检查 `workspace/SOUL.md` 内容
- 验证 MEMORY.md 全程不被触碰
- 旧格式备份迁移后恢复正确
