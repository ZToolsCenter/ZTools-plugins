import type { PromptItem, Project, HistoryEntry } from '../types'
import { normalizePromptItem } from './prompt'

/**
 * 备份 / 恢复模块。
 * 数据包格式（区别于旧版裸提示词数组）：
 * {
 *   format: 'promptforge-backup',
 *   version: 1,
 *   exportedAt: number,
 *   prompts: PromptItem[],   // 已排除内置种子数据
 *   projects: Project[],
 *   settings: Record<string, any>,
 *   history: HistoryEntry[],
 * }
 */

export const BACKUP_FORMAT = 'promptforge-backup'
export const BACKUP_VERSION = 1

/** 内置种子提示词 ID（非用户资产，备份时排除） */
export const SEED_PROMPT_IDS = new Set(['welcome', 'tutorial-vars', 'frag-style', 'frag-markdown'])

export interface BackupPackage {
  format: string
  version: number
  exportedAt: number
  prompts: PromptItem[]
  projects: Project[]
  settings: Record<string, any>
  history: HistoryEntry[]
}

export interface BackupSource {
  prompts: PromptItem[]
  projects: Project[]
  settings: Record<string, any>
  history: HistoryEntry[]
}

export interface MergeResult extends BackupSource {
  counts: { prompts: number; projects: number; history: number }
}

/** 组装备份数据包（排除种子数据） */
export function buildBackup(source: BackupSource): BackupPackage {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    prompts: source.prompts.filter(p => !SEED_PROMPT_IDS.has(p.id)),
    projects: source.projects,
    settings: source.settings,
    history: source.history,
  }
}

/** 解析导入内容，识别备份包或旧版裸数组（向后兼容） */
export function parseBackup(raw: unknown): BackupPackage | null {
  // 旧版格式：裸提示词数组
  if (Array.isArray(raw)) {
    return {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: Date.now(),
      prompts: raw.map(normalizePromptItem).filter((p): p is PromptItem => p !== null),
      projects: [],
      settings: {},
      history: [],
    }
  }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, any>
    if (obj.format === BACKUP_FORMAT) {
      return {
        format: obj.format,
        version: typeof obj.version === 'number' ? obj.version : 1,
        exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
        prompts: Array.isArray(obj.prompts)
          ? obj.prompts.map(normalizePromptItem).filter((p): p is PromptItem => p !== null)
          : [],
        projects: Array.isArray(obj.projects) ? obj.projects.filter(isProject) : [],
        settings: isRecord(obj.settings) ? obj.settings : {},
        history: Array.isArray(obj.history) ? obj.history.filter(isHistoryEntry) : [],
      }
    }
  }
  return null
}

/** 合并导入数据到现有数据（去重追加 + 关联完整性校验 + settings 逐字段合并） */
export function mergeBackup(pkg: BackupPackage, existing: BackupSource): MergeResult {
  // 1. 项目合并（相同 ID 跳过）
  const existingProjectIds = new Set(existing.projects.map(p => p.id))
  const newProjects = pkg.projects.filter(p => !existingProjectIds.has(p.id))
  const projects = [...existing.projects, ...newProjects]

  // 2. 提示词合并（相同 ID 跳过 + projectId 悬空校验）
  const validProjectIds = new Set(projects.map(p => p.id))
  const existingPromptIds = new Set(existing.prompts.map(p => p.id))
  const newPrompts = pkg.prompts
    .filter(p => !existingPromptIds.has(p.id))
    .map(p => {
      // projectId 指向不存在的项目 → 清空（转为资产），避免悬空引用
      if (p.projectId && !validProjectIds.has(p.projectId)) {
        const { projectId: _drop, ...rest } = p
        return rest as PromptItem
      }
      return p
    })
  const prompts = [...existing.prompts, ...newPrompts]

  // 3. settings 逐字段合并（导入字段覆盖现有同名字段）
  const settings = { ...existing.settings, ...pkg.settings }

  // 4. 历史记录合并（相同 ID 跳过）
  const existingHistoryIds = new Set(existing.history.map(h => h.id))
  const newHistory = pkg.history.filter(h => !existingHistoryIds.has(h.id))
  const history = [...existing.history, ...newHistory]

  return {
    prompts,
    projects,
    settings,
    history,
    counts: { prompts: newPrompts.length, projects: newProjects.length, history: newHistory.length },
  }
}

// ====== 类型守卫 ======

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProject(value: unknown): value is Project {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return isRecord(value) && typeof value.id === 'string' && typeof value.promptId === 'string'
}
