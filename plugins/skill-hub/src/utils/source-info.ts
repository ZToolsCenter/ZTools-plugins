import type { Skill } from '../types'
import type { SkillIdentity, SkillSourceLocation } from '../types'
import { STORE_ICONS, getStoreIconFromSource } from '../data/store-icons'
import { storage } from './storage'

export interface SourceInfo {
  label: string
  icon: string
  color: string
  bg: string
}

export function getSourceInfo(skill: Skill, registry?: Map<string, SkillIdentity>): SourceInfo {
  if (registry) {
    const identity = registry.get(skill.canonicalId || skill.id)
    if (identity && identity.sources.length > 1) {
      const labels = identity.sources.map(s => getSourceLabelFromLocation(s))
      const uniqueLabels = [...new Set(labels)]
      return { label: uniqueLabels.join(' · '), icon: 'multi', color: '#8b5cf6', bg: '#ede9fe' }
    }
  }
  if (skill.storeSourceId) {
    if (skill.storeSourceId === 'skills-sh') {
      return { label: 'skills.sh', icon: STORE_ICONS['skills-sh'], color: '#16a34a', bg: '#dcfce7' }
    }
    if (skill.storeSourceId === 'claude') {
      return { label: 'Claude Code', icon: STORE_ICONS.claude, color: '#c2785c', bg: '#fef3c7' }
    }
    if (skill.storeSourceId === 'codex') {
      return { label: 'Codex', icon: STORE_ICONS.codex, color: '#2563eb', bg: '#dbeafe' }
    }
    if (skill.storeSourceId.startsWith('agent:')) {
      return { label: '本地', icon: 'folder', color: '#8b5cf6', bg: '#ede9fe' }
    }
    const customStore = storage.getStoreSources().find(s => s.id === skill.storeSourceId)
    if (customStore) {
      return { label: customStore.name, icon: getStoreIconFromSource(customStore), color: '#16a34a', bg: '#dcfce7' }
    }
    return { label: '商店', icon: STORE_ICONS['skills-sh'], color: '#16a34a', bg: '#dcfce7' }
  }
  if (skill.source === 'skills-sh') {
    return { label: 'skills.sh', icon: STORE_ICONS['skills-sh'], color: '#16a34a', bg: '#dcfce7' }
  }
  if (skill.repo) {
    if (skill.repo === 'anthropics/skills') {
      return { label: 'Claude Code', icon: STORE_ICONS.claude, color: '#c2785c', bg: '#fef3c7' }
    }
    if (skill.repo === 'openai/skills') {
      return { label: 'Codex', icon: STORE_ICONS.codex, color: '#2563eb', bg: '#dbeafe' }
    }
    return { label: 'GitHub', icon: 'git', color: '#6b7280', bg: '#f3f4f6' }
  }
  if (skill.source === 'local') {
    return { label: '本地', icon: 'folder', color: '#8b5cf6', bg: '#ede9fe' }
  }
  return { label: '本地', icon: 'folder', color: '#8b5cf6', bg: '#ede9fe' }
}

function getSourceLabelFromLocation(source: SkillSourceLocation): string {
  switch (source.type) {
    case 'github':
      return 'GitHub'
    case 'skills-sh':
      return 'skills.sh'
    case 'local':
      return source.platformId ? `Agent (${source.platformId})` : 'Agent'
    case 'local-dir':
      return source.projectId ? `Project` : 'Local'
    case 'marketplace-json':
      return 'Marketplace'
    case 'git-repo':
      return 'Git Repo'
    case 'builtin':
      return 'Built-in'
    default:
      return source.type
  }
}
