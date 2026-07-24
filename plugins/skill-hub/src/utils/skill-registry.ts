import type { SkillIdentity, SkillSourceLocation, SkillScanResult } from '../types'

const STORAGE_KEY = 'sh_skill_registry'


export function loadRegistry(): Map<string, SkillIdentity> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const entries: SkillIdentity[] = JSON.parse(raw)
    return new Map(entries.map(e => [e.canonicalId, e]))
  } catch {
    return new Map()
  }
}

export function saveRegistry(registry: Map<string, SkillIdentity>): void {
  const entries = Array.from(registry.values())
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function getOrCreateIdentity(
  registry: Map<string, SkillIdentity>,
  canonicalId: string,
  scanResult: SkillScanResult,
  source: SkillSourceLocation
): SkillIdentity {
  const existing = registry.get(canonicalId)
  if (existing) {
    const alreadyHasSource = existing.sources.some(
      s => s.type === source.type && s.location === source.location
    )
    if (!alreadyHasSource) {
      existing.sources.push(source)
    }
    existing.updatedAt = new Date().toISOString()
    return existing
  }

  const identity: SkillIdentity = {
    canonicalId,
    name: scanResult.manifest.name || scanResult.name,
    description: scanResult.manifest.description,
    author: scanResult.manifest.author,
    tags: scanResult.manifest.tags || [],
    format: scanResult.manifest.format as any,
    contentHash: '',
    sources: [source],
    primarySource: source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  registry.set(canonicalId, identity)
  return identity
}

export function findIdentityByScanResult(
  registry: Map<string, SkillIdentity>,
  scanResult: SkillScanResult
): SkillIdentity | undefined {
  for (const identity of registry.values()) {
    if (
      identity.name.toLowerCase() === (scanResult.manifest.name || scanResult.name).toLowerCase()
    ) {
      return identity
    }
  }
  return undefined
}

export function registerSkillFromStore(
  registry: Map<string, SkillIdentity>,
  canonicalId: string,
  scanResult: SkillScanResult,
  sourceType: SkillSourceLocation['type'],
  location: string
): SkillIdentity {
  const source: SkillSourceLocation = {
    type: sourceType,
    location,
    installedAt: new Date().toISOString(),
  }
  const existing = registry.get(canonicalId)
  if (existing) {
    existing.sources = [source]
    existing.primarySource = source
    existing.updatedAt = new Date().toISOString()
    saveRegistry(registry)
    return existing
  }
  const identity: SkillIdentity = {
    canonicalId,
    name: scanResult.manifest.name || scanResult.name,
    description: scanResult.manifest.description,
    author: scanResult.manifest.author,
    tags: scanResult.manifest.tags || [],
    format: scanResult.manifest.format as any,
    contentHash: '',
    sources: [source],
    primarySource: source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  registry.set(canonicalId, identity)
  saveRegistry(registry)
  return identity
}


export function registerSkillFromProject(
  registry: Map<string, SkillIdentity>,
  scanResult: SkillScanResult,
  projectId: string
): SkillIdentity {
  const existing = findIdentityByScanResult(registry, scanResult)
  if (existing) {
    const source: SkillSourceLocation = {
      type: 'local-dir',
      location: scanResult.dir,
      projectId,
      installedAt: new Date().toISOString(),
    }
    const alreadyHasSource = existing.sources.some(
      s => s.type === 'local-dir' && s.projectId === projectId && s.location === scanResult.dir
    )
    if (!alreadyHasSource) {
      existing.sources.push(source)
    }
    existing.updatedAt = new Date().toISOString()
    saveRegistry(registry)
    return existing
  }

  const canonicalId = `project:${projectId}/${scanResult.manifest?.name || scanResult.name}`
  const source: SkillSourceLocation = {
    type: 'local-dir',
    location: scanResult.dir,
    projectId,
    installedAt: new Date().toISOString(),
  }
  const identity = getOrCreateIdentity(registry, canonicalId, scanResult, source)
  saveRegistry(registry)
  return identity
}

export function removeFromRegistry(registry: Map<string, SkillIdentity>, skillName: string): void {
  const lowerName = skillName.toLowerCase()
  for (const [key, identity] of registry) {
    if (identity.name.toLowerCase() === lowerName) {
      registry.delete(key)
    }
  }
  saveRegistry(registry)
}

export function getSourceLabel(source: SkillSourceLocation): string {
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
