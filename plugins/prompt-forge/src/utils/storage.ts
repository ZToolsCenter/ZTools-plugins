import type { PromptItem, Project, HistoryEntry } from '../types'

/** 获取 KV 存储实例 */
function getKv() {
  const preload = window.kvStorage
  if (preload) return preload
  const ds = window.ztools?.dbStorage
  if (ds) return {
    get: (key: string) => ds.getItem('pf:' + key),
    set: (key: string, value: any) => ds.setItem('pf:' + key, value),
    remove: (key: string) => ds.removeItem('pf:' + key),
  }
  return null
}

// ====== Prompts ======

const PROMPTS_KEY = 'prompts'
const PROJECTS_KEY = 'projects'
const SETTINGS_KEY = 'settings'
const HISTORY_KEY = 'history'

export async function loadPrompts(): Promise<PromptItem[]> {
  const kv = getKv()
  if (!kv) return seedPrompts()
  try {
    const raw = kv.get(PROMPTS_KEY)
    if (Array.isArray(raw) && raw.length > 0) return raw
    const defaults = seedPrompts()
    kv.set(PROMPTS_KEY, defaults)
    return defaults
  } catch (e) { console.error('[storage] loadPrompts failed:', e); return seedPrompts() }
}

export async function savePrompts(items: PromptItem[]): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { kv.set(PROMPTS_KEY, JSON.parse(JSON.stringify(items))) }
  catch (e) { console.error('[storage] savePrompts failed:', e) }
}

// ====== Projects ======

export async function loadProjects(): Promise<Project[]> {
  const kv = getKv()
  if (!kv) return []
  try { return kv.get(PROJECTS_KEY) || [] }
  catch (e) { console.error('[storage] loadProjects failed:', e); return [] }
}

export async function saveProjects(items: Project[]): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { kv.set(PROJECTS_KEY, JSON.parse(JSON.stringify(items))) }
  catch (e) { console.error('[storage] saveProjects failed:', e) }
}

// ====== History ======

export async function loadHistory(): Promise<HistoryEntry[]> {
  const kv = getKv()
  if (!kv) return []
  try { return kv.get(HISTORY_KEY) || [] }
  catch (e) { console.error('[storage] loadHistory failed:', e); return [] }
}

export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { kv.set(HISTORY_KEY, JSON.parse(JSON.stringify(entries))) }
  catch (e) { console.error('[storage] saveHistory failed:', e) }
}

// ====== Settings ======

export async function getSettings(): Promise<Record<string, any> | null> {
  const kv = getKv()
  if (!kv) return null
  try { return kv.get(SETTINGS_KEY) }
  catch (e) { console.error('[storage] getSettings failed:', e); return null }
}

export async function setSettings(settings: Record<string, any>): Promise<void> {
  const kv = getKv()
  if (!kv) return
  try { kv.set(SETTINGS_KEY, settings) }
  catch (e) { console.error('[storage] setSettings failed:', e) }
}

// ====== Seed ======

function seedPrompts(): PromptItem[] {
  const now = Date.now()
  return [
    {
      id: 'welcome', title: '👋 欢迎使用 PromptForge',
      type: 'prompt', tags: ['教程'], favorite: true,
      content: `欢迎使用 PromptForge！

这是一款 AI 工作流增强插件：

1. 搜索关键词快速调用提示词
2. ↑↓ 选择条目，Enter 确认
3. 无变量的提示词直接复制
4. 有变量的进入填写模式

支持：快速保存、向导新建、组合拼接、版本管理。`,
      variables: [], usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'tutorial-vars', title: '🧩 教程：使用变量',
      type: 'prompt', tags: ['教程', '变量'], favorite: true,
      content: `请你扮演一名 {{role=资深前端工程师}}，针对以下 {{topic}} 给出 3 条具体可执行的建议，回答语言为 {{language=中文}}。

背景：
{{context}}

要求：每条建议先给结论，再用一句话说明理由。`,
      variables: [
        { name: 'role', required: false, defaultValue: '资深前端工程师' },
        { name: 'topic', required: true },
        { name: 'language', required: false, defaultValue: '中文' },
        { name: 'context', required: true },
      ],
      usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'frag-style', title: '✂️ 片段：输出风格',
      type: 'snippet', tags: ['片段', '风格'], favorite: false,
      content: '请保持输出简洁、结构化：先用一句话给结论，再用要点列表展开，避免空泛的客套。',
      variables: [], usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'frag-markdown', title: '✂️ 片段：Markdown 输出',
      type: 'snippet', tags: ['片段', '格式'], favorite: false,
      content: '请使用 Markdown 输出，代码片段用 ``` 包裹并标注语言；如果包含表格，使用 GFM 表格语法。',
      variables: [], usageCount: 0, version: 1, snapshots: [],
      createdAt: now, updatedAt: now,
    },
  ]
}
