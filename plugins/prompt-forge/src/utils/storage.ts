import type { PromptItem, Project, HistoryEntry } from '../types'

/** 获取 KV 存储实例 */
function getKv() {
  const preload = window.kvStorage
  if (preload) return preload
  const ds = window.ztools?.dbStorage
  const PREFIX = 'promptforge:'
  if (ds) return {
    get: (key: string) => ds.getItem(PREFIX + key),
    set: (key: string, value: any) => ds.setItem(PREFIX + key, value),
    remove: (key: string) => ds.removeItem(PREFIX + key),
  }
  return null
}

// ====== Prompts ======

const PROMPTS_KEY = 'prompts'
const PROJECTS_KEY = 'projects'
const SETTINGS_KEY = 'settings'
const HISTORY_KEY = 'history'

export interface StorageSnapshot {
  prompts: PromptItem[]
  projects: Project[]
  settings: Record<string, any>
  history: HistoryEntry[]
}

function cloneForStorage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function writeSnapshot(kv: NonNullable<ReturnType<typeof getKv>>, snapshot: StorageSnapshot) {
  await kv.set(PROMPTS_KEY, cloneForStorage(snapshot.prompts))
  await kv.set(PROJECTS_KEY, cloneForStorage(snapshot.projects))
  await kv.set(SETTINGS_KEY, cloneForStorage(snapshot.settings))
  await kv.set(HISTORY_KEY, cloneForStorage(snapshot.history))
}

async function restoreValue(kv: NonNullable<ReturnType<typeof getKv>>, key: string, value: unknown) {
  if (value === null || value === undefined) await kv.remove(key)
  else await kv.set(key, value)
}

/**
 * 用于导入和清空的整包替换：任一文档写入失败时回滚已写入的数据。
 * ZTools KV 没有跨文档事务，因此在此处集中控制写入顺序和回滚。
 */
export async function replaceStorageSnapshot(snapshot: StorageSnapshot): Promise<void> {
  const kv = getKv()
  if (!kv) throw new Error('本地存储不可用')

  const previous = {
    prompts: await kv.get(PROMPTS_KEY),
    projects: await kv.get(PROJECTS_KEY),
    settings: await kv.get(SETTINGS_KEY),
    history: await kv.get(HISTORY_KEY),
  }

  try {
    await writeSnapshot(kv, snapshot)
  } catch (error) {
    try {
      await restoreValue(kv, PROMPTS_KEY, previous.prompts)
      await restoreValue(kv, PROJECTS_KEY, previous.projects)
      await restoreValue(kv, SETTINGS_KEY, previous.settings)
      await restoreValue(kv, HISTORY_KEY, previous.history)
    } catch (rollbackError) {
      console.error('[storage] rollback after snapshot write failed:', rollbackError)
    }
    throw error
  }
}

export async function loadPrompts(): Promise<PromptItem[]> {
  const kv = getKv()
  if (!kv) return seedPrompts()
  try {
    const raw = await kv.get(PROMPTS_KEY)
    // 空数组表示用户主动清空了词库，不能在下次启动时重新写入种子数据。
    if (Array.isArray(raw)) return raw
    const defaults = seedPrompts()
    await kv.set(PROMPTS_KEY, defaults)
    return defaults
  } catch (e) {
    console.error('[storage] loadPrompts failed:', e)
    throw e
  }
}

export async function savePrompts(items: PromptItem[]): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { await kv.set(PROMPTS_KEY, cloneForStorage(items)) }
  catch (e) { console.error('[storage] savePrompts failed:', e); throw e }
}

// ====== Projects ======

export async function loadProjects(): Promise<Project[]> {
  const kv = getKv()
  if (!kv) return []
  try { return await kv.get(PROJECTS_KEY) || [] }
  catch (e) { console.error('[storage] loadProjects failed:', e); throw e }
}

export async function saveProjects(items: Project[]): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { await kv.set(PROJECTS_KEY, cloneForStorage(items)) }
  catch (e) { console.error('[storage] saveProjects failed:', e); throw e }
}

// ====== History ======

export async function loadHistory(): Promise<HistoryEntry[]> {
  const kv = getKv()
  if (!kv) return []
  try { return await kv.get(HISTORY_KEY) || [] }
  catch (e) { console.error('[storage] loadHistory failed:', e); throw e }
}

export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { await kv.set(HISTORY_KEY, cloneForStorage(entries)) }
  catch (e) { console.error('[storage] saveHistory failed:', e); throw e }
}

// ====== Settings ======

export async function getSettings(): Promise<Record<string, any> | null> {
  const kv = getKv()
  if (!kv) return null
  try { return await kv.get(SETTINGS_KEY) }
  catch (e) { console.error('[storage] getSettings failed:', e); throw e }
}

export async function setSettings(settings: Record<string, any>): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { await kv.set(SETTINGS_KEY, cloneForStorage(settings)) }
  catch (e) { console.error('[storage] setSettings failed:', e); throw e }
}

// ====== Seed ======

function seedPrompts(): PromptItem[] {
  const now = Date.now()
  return [
    {
      id: 'welcome', title: '🚀 快速上手 PromptForge',
      type: 'prompt', tags: ['指南', '入门'], favorite: true,
      content: `# PromptForge 快速上手

## 三个核心操作

**搜索调用**：在顶部搜索框输入关键词，↑↓ 选择，Enter 复制。有变量的提示词会先进入填写页，填完点"复制"即可。

**快速保存**：在任意应用复制一段文字，唤起 PromptForge 后选"保存提示词"，自动识别变量和标题。

**组合拼接**：把基础提示词和片段拼在一起，实时预览效果，一键复制。片段适合放风格约束、格式要求。

## 键盘快捷键

↑↓ 选择条目 | Enter 复制 | E 编辑 | Ctrl+N 新建 | / 聚焦搜索 | ? 快捷键面板 | Esc 返回

## 推荐工作流

1. 把常用提示词用"快速保存"积累起来
2. 给提示词加变量（用 {{变量名}} 标记），一次编写多次复用
3. 用"组合"把基础提示词和风格片段自由搭配
4. 用"版本"管理重要提示词的迭代历史`,
      variables: [], usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'tutorial-vars', title: '🧩 模板：角色 + 任务 + 要求',
      type: 'prompt', tags: ['模板', '变量', '常用'], favorite: true,
      content: `你是一位 {{role=资深前端工程师}}，请针对以下内容给出 3 条具体可执行的建议。

## 主题
{{topic}}

## 背景信息
{{context=（可补充相关代码、需求或约束）}}

## 输出要求
- 回答语言：{{language=中文}}
- 每条建议先给结论，再用一句话说明理由
- 如果涉及代码，给出关键片段即可，不必完整实现`,
      variables: [
        { name: 'role', required: false, defaultValue: '资深前端工程师' },
        { name: 'topic', required: true },
        { name: 'context', required: false, defaultValue: '（可补充相关代码、需求或约束）' },
        { name: 'language', required: false, defaultValue: '中文' },
      ],
      usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'template-review', title: '📝 模板：代码评审',
      type: 'prompt', tags: ['模板', '评审', '开发'], favorite: false,
      content: `你是一位经验丰富的 {{language=TypeScript}} 代码评审专家，请从以下维度评审代码：

## 待评审代码
{{code}}

## 评审维度
1. **正确性**：逻辑错误、边界条件、空值处理
2. **可维护性**：命名、结构、重复代码、复杂度
3. **性能**：不必要的计算、内存泄漏、大数据量问题
4. **安全性**：注入、越权、敏感信息泄露

## 输出格式
- 按严重程度排序：🔴 必须修复 → 🟡 建议优化 → 🟢 可以改进
- 每个问题给出：位置 → 问题描述 → 修改建议
- 最后给一段总体评价（2-3 句）`,
      variables: [
        { name: 'language', required: false, defaultValue: 'TypeScript' },
        { name: 'code', required: true },
      ],
      usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'frag-style', title: '✂️ 片段：简洁输出风格',
      type: 'snippet', tags: ['片段', '风格'], favorite: false,
      content: '请保持输出简洁、结构化：先用一句话给结论，再用要点列表展开，避免空泛的客套和重复。如果内容较长，用小标题分段。',
      variables: [], usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'frag-markdown', title: '✂️ 片段：Markdown 格式',
      type: 'snippet', tags: ['片段', '格式'], favorite: false,
      content: '请使用 Markdown 格式输出：代码用 ``` 包裹并标注语言，表格用 GFM 语法，重点内容用 **加粗**，避免使用 HTML 标签。',
      variables: [], usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'frag-constraints', title: '✂️ 片段：安全约束',
      type: 'snippet', tags: ['片段', '安全', '约束'], favorite: false,
      content: '请确保输出内容：不编造不存在的事实或 API；不确定的地方明确标注"待确认"；涉及安全建议时，优先给出防御性方案而非攻击性操作。',
      variables: [], usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
  ]
}
