import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, BACKUP_VERSION, mergeBackup, parseBackup } from './backup'
import type { BackupPackage, BackupSource } from './backup'
import type { HistoryEntry, Project, PromptItem } from '../types'

function prompt(id: string, projectId?: string): PromptItem {
  return {
    id, title: id, content: id, type: 'prompt', tags: [], variables: [], favorite: false,
    usageCount: 0, version: 1, snapshots: [], projectId, createdAt: 1, updatedAt: 1,
  }
}

function project(id: string): Project {
  return { id, name: id, group: '开发', createdAt: 1, updatedAt: 1 }
}

function history(id: string): HistoryEntry {
  return { id, promptId: id, promptTitle: id, copiedContent: id, usedAt: 1 }
}

describe('备份导入校验', () => {
  it('拒绝当前版本无法理解的未来备份', () => {
    expect(parseBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION + 1,
      exportedAt: Date.now(),
      prompts: [],
      projects: [],
      settings: {},
      history: [],
    })).toBeNull()
  })

  it('丢弃字段不完整的项目和历史记录', () => {
    const parsed = parseBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      prompts: [],
      projects: [{ id: 'project-1', name: '缺少分组' }],
      settings: { theme: 'neon', closeAfterCopy: true, unexpected: 'value' },
      history: [{ id: 'history-1', promptId: 'prompt-1' }],
    })

    expect(parsed?.projects).toEqual([])
    expect(parsed?.history).toEqual([])
    expect(parsed?.settings).toEqual({ closeAfterCopy: true })
    expect(parsed?.skipped).toEqual({ prompts: 0, projects: 1, history: 1, settings: 2 })
  })
})

describe('备份合并', () => {
  it('跳过重复 ID，并把悬空项目提示词转为资产', () => {
    const existing: BackupSource = {
      prompts: [prompt('existing')],
      projects: [project('project-existing')],
      settings: { theme: 'light' },
      history: [history('history-existing')],
    }
    const incoming: BackupPackage = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: 1,
      prompts: [prompt('existing'), prompt('orphan', 'missing-project')],
      projects: [project('project-existing')],
      settings: { theme: 'dark' },
      history: [history('history-existing')],
    }

    const result = mergeBackup(incoming, existing)

    expect(result.prompts).toHaveLength(2)
    expect(result.prompts.find(item => item.id === 'orphan')?.projectId).toBeUndefined()
    expect(result.projects).toHaveLength(1)
    expect(result.history).toHaveLength(1)
    expect(result.settings.theme).toBe('dark')
    expect(result.counts).toEqual({ prompts: 1, projects: 0, history: 0 })
  })
})
