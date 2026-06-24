import type { InstallRecord, StoreSource, AppSettings, PlatformInfo, Skill, RegisteredProject, ModelConfig } from '../types'
import { BUILTIN_PROVIDERS } from '../data/ai-providers'

const PREFIX = 'sm_'

function dbSet(key: string, value: any): void {
  try {
    window.ztools.dbStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (e) {
    console.error(`[storage] dbSet failed for "${key}":`, e)
  }
}

function dbGet<T = any>(key: string): T | null {
  try {
    const raw = window.ztools.dbStorage.getItem(PREFIX + key)
    if (raw === null || raw === undefined) return null
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) as T } catch { return null }
    }
    return raw as T
  } catch (e) {
    console.error(`[storage] dbGet failed for "${key}":`, e)
    return null
  }
}

const KEYS = {
  INSTALLED_SKILLS: 'installed_skills',
  STORE_SOURCES: 'store_sources',
  PLATFORM_CONFIGS: 'platform_configs',
  PLATFORM_ORDER: 'platform_order',
  SETTINGS: 'settings',
  SCANNED_SKILLS: 'scanned_skills',
  CACHED_SKILLS: 'cached_skills',
  FAVORITE_IDS: 'favorite_ids',
  DOWNLOADED_IDS: 'downloaded_ids',
  REGISTERED_PROJECTS: 'registered_projects',
  TRANSLATIONS: 'translations',
}

export const storage = {
  // === Install Records ===
  getInstallRecords(): InstallRecord[] {
    return dbGet<InstallRecord[]>(KEYS.INSTALLED_SKILLS) || []
  },
  saveInstallRecord(record: InstallRecord): void {
    const records = this.getInstallRecords()
    const idx = records.findIndex(
      (r) => r.skillId === record.skillId && r.platformId === record.platformId && r.scope === record.scope
    )
    if (idx >= 0) records[idx] = record
    else records.push(record)
    dbSet(KEYS.INSTALLED_SKILLS, records)
  },
  removeInstallRecord(skillId: string, platformId: string, scope?: string): void {
    const records = this.getInstallRecords().filter(
      (r) => !(r.skillId === skillId && r.platformId === platformId && (scope === undefined || r.scope === scope))
    )
    dbSet(KEYS.INSTALLED_SKILLS, records)
  },
  removeAllForSkill(skillId: string): void {
    const records = this.getInstallRecords().filter((r) => r.skillId !== skillId)
    dbSet(KEYS.INSTALLED_SKILLS, records)
  },
  getInstalledForPlatform(platformId: string): InstallRecord[] {
    return this.getInstallRecords().filter((r) => r.platformId === platformId)
  },
  getInstalledForSkill(skillId: string): InstallRecord[] {
    return this.getInstallRecords().filter((r) => r.skillId === skillId)
  },
  isSkillInstalled(skillId: string, platformId: string): boolean {
    return this.getInstallRecords().some(
      (r) => r.skillId === skillId && r.platformId === platformId
    )
  },

  // === Store Sources ===
  getStoreSources(): StoreSource[] {
    return dbGet<StoreSource[]>(KEYS.STORE_SOURCES) || []
  },
  saveStoreSource(source: StoreSource): void {
    const sources = this.getStoreSources()
    const idx = sources.findIndex((s) => s.id === source.id)
    if (idx >= 0) sources[idx] = source
    else sources.push(source)
    dbSet(KEYS.STORE_SOURCES, sources)
  },
  removeStoreSource(id: string): void {
    const sources = this.getStoreSources().filter((s) => s.id !== id)
    dbSet(KEYS.STORE_SOURCES, sources)
  },

  // === Platform Configs ===
  getPlatformConfigs(): PlatformInfo[] {
    return dbGet<PlatformInfo[]>(KEYS.PLATFORM_CONFIGS) || []
  },
  savePlatformConfig(config: PlatformInfo): void {
    const configs = this.getPlatformConfigs()
    const idx = configs.findIndex((c) => c.id === config.id)
    if (idx >= 0) configs[idx] = config
    else configs.push(config)
    dbSet(KEYS.PLATFORM_CONFIGS, configs)
  },
  savePlatformConfigs(configs: PlatformInfo[]): void {
    dbSet(KEYS.PLATFORM_CONFIGS, configs)
  },

  // === Platform Order ===
  getPlatformOrder(): string[] {
    return dbGet<string[]>(KEYS.PLATFORM_ORDER) || []
  },
  savePlatformOrder(order: string[]): void {
    dbSet(KEYS.PLATFORM_ORDER, order)
  },

  // === Settings ===
  initBuiltinProviders(): ModelConfig[] {
    return BUILTIN_PROVIDERS.map(p => ({
      id: `builtin-${p.id}`,
      name: p.name,
      provider: p.id,
      baseUrl: p.defaultBaseUrl,
      apiPath: p.defaultApiPath,
      apiKeys: [],
      model: '',
      isDefault: false,
      isBuiltin: true,
      enabled: false,
      models: [],
    }))
  },

  getSettings(): AppSettings {
    const defaults: AppSettings = {
      defaultInstallMode: 'copy',
      githubToken: '',
      theme: 'auto',
      themeMode: 'auto',
      themeColor: 'blue',
      fontSize: 'medium',
      motionPreference: 'standard',
      compactMode: false,
      backgroundImage: '',
      backgroundImageEnabled: false,
      backgroundOpacity: 40,
      backgroundBlur: 14,
      aiModels: [],
      translationModelId: '',
    }
    let saved: Partial<AppSettings> | null = null
    try {
      saved = dbGet<Partial<AppSettings>>(KEYS.SETTINGS)
    } catch { /* ignore */ }
    const merged = { ...defaults, ...(saved || {}) }
    if (merged.backgroundImage && saved && (saved as any).backgroundImageEnabled === undefined) {
      merged.backgroundImageEnabled = true
    }
    // Initialize built-in providers if not present
    if (!Array.isArray(merged.aiModels) || merged.aiModels.length === 0) {
      merged.aiModels = this.initBuiltinProviders()
    } else {
      // Ensure built-in providers exist and have correct structure
      const existingIds = new Set(merged.aiModels.map(m => m.id))
      const builtinProviders = this.initBuiltinProviders()
      for (const bp of builtinProviders) {
        if (!existingIds.has(bp.id)) {
          merged.aiModels.push(bp)
        }
      }
      // Update existing built-in providers with latest presets
      for (const m of merged.aiModels) {
        if (m.isBuiltin) {
          const preset = BUILTIN_PROVIDERS.find(p => p.id === m.provider)
          if (preset) {
            m.name = preset.name
            m.baseUrl = preset.defaultBaseUrl
            m.apiPath = preset.defaultApiPath
          }
        }
      }
    }
    return merged
  },
  saveSettings(settings: Partial<AppSettings>): void {
    const current = this.getSettings()
    const merged = { ...current, ...settings }
    dbSet(KEYS.SETTINGS, merged)
  },

  // === Scanned Skills Cache ===
  getScannedSkills(): string[] {
    return dbGet<string[]>(KEYS.SCANNED_SKILLS) || []
  },
  setScannedSkills(paths: string[]): void {
    dbSet(KEYS.SCANNED_SKILLS, paths)
  },

  // === Cached Skills ===
  getCachedSkills(): Skill[] {
    const skills: Skill[] = dbGet<Skill[]>(KEYS.CACHED_SKILLS) || []
    for (const s of skills) {
      if (s.description) {
        if (s.description.startsWith('[') && s.description.endsWith(']')) {
          const inner = s.description.slice(1, -1).trim()
          s.description = inner
        }
        if (/^[\[\]{}()]+$/.test(s.description)) {
          s.description = ''
        }
        if (/^[>|][+-]?$/.test(s.description)) {
          s.description = ''
        }
      }
    }
    return skills
  },
  saveCachedSkills(skills: Skill[]): void {
    const existing = this.getCachedSkills()
    const map = new Map(existing.map((s) => [s.id, s]))
    for (const s of skills) {
      map.set(s.id, JSON.parse(JSON.stringify(s)))
    }
    dbSet(KEYS.CACHED_SKILLS, Array.from(map.values()))
  },

  // === Favorites ===
  getFavoriteIds(): string[] {
    return dbGet<string[]>(KEYS.FAVORITE_IDS) || []
  },
  toggleFavorite(id: string): void {
    const ids = this.getFavoriteIds()
    const idx = ids.indexOf(id)
    if (idx >= 0) ids.splice(idx, 1)
    else ids.push(id)
    dbSet(KEYS.FAVORITE_IDS, ids)
  },
  isFavorite(id: string): boolean {
    return this.getFavoriteIds().includes(id)
  },

  // === User Tags ===
  saveSkillUserTags(skillId: string, userTags: string[]): void {
    const skills = this.getCachedSkills()
    const skill = skills.find((s) => s.id === skillId)
    if (skill) {
      skill.userTags = userTags
      dbSet(KEYS.CACHED_SKILLS, skills)
    }
  },

  getSkillUserTags(skillId: string): string[] {
    const skills = this.getCachedSkills()
    const skill = skills.find((s) => s.id === skillId)
    return skill?.userTags || []
  },

  getAllUserTags(): string[] {
    const skills = this.getCachedSkills()
    const tagSet = new Set<string>()
    for (const s of skills) {
      if (s.userTags) s.userTags.forEach((t) => tagSet.add(t))
    }
    return Array.from(tagSet).sort()
  },

  // === Downloaded Skills ===
  getDownloadedIds(): string[] {
    return dbGet<string[]>(KEYS.DOWNLOADED_IDS) || []
  },
  addDownloadedId(id: string): void {
    const ids = this.getDownloadedIds()
    if (!ids.includes(id)) {
      ids.push(id)
      dbSet(KEYS.DOWNLOADED_IDS, ids)
    }
  },
  removeDownloadedId(id: string): void {
    const ids = this.getDownloadedIds().filter((i) => i !== id)
    dbSet(KEYS.DOWNLOADED_IDS, ids)
  },
  isDownloaded(id: string): boolean {
    return this.getDownloadedIds().includes(id)
  },
  cleanStaleCachedSkills(): void {
    const repoRoot = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo')
    const cached = this.getCachedSkills()
    const ids = this.getDownloadedIds()
    const aliveCached = cached.filter((s) => {
      const dir = window.services.pathJoin(repoRoot, s.id)
      return window.services.pathExists(dir)
    })
    const aliveIds = aliveCached.map((s) => s.id)
    const aliveIdSet = new Set(aliveIds)
    const aliveInstallRecords = this.getInstallRecords().filter((r) => aliveIdSet.has(r.skillId))
    if (aliveCached.length !== cached.length) dbSet(KEYS.CACHED_SKILLS, aliveCached)
    if (aliveIds.length !== ids.length) dbSet(KEYS.DOWNLOADED_IDS, aliveIds)
    if (aliveInstallRecords.length !== this.getInstallRecords().length) dbSet(KEYS.INSTALLED_SKILLS, aliveInstallRecords)
  },

  // === Registered Projects ===
  getRegisteredProjects(): RegisteredProject[] {
    return dbGet<RegisteredProject[]>(KEYS.REGISTERED_PROJECTS) || []
  },
  saveRegisteredProjects(projects: RegisteredProject[]): void {
    dbSet(KEYS.REGISTERED_PROJECTS, projects)
  },
  addRegisteredProject(project: RegisteredProject): void {
    const projects = this.getRegisteredProjects()
    projects.push(project)
    this.saveRegisteredProjects(projects)
  },
  removeRegisteredProject(id: string): void {
    const projects = this.getRegisteredProjects().filter((p) => p.id !== id)
    this.saveRegisteredProjects(projects)
  },
  updateRegisteredProject(id: string, patch: Partial<RegisteredProject>): void {
    const projects = this.getRegisteredProjects()
    const idx = projects.findIndex((p) => p.id === id)
    if (idx >= 0) {
      projects[idx] = { ...projects[idx], ...patch }
      this.saveRegisteredProjects(projects)
    }
  },

  // === Page State ===
  savePageState(pageId: string, state: Record<string, any>): void {
    const all = dbGet<Record<string, any>>('page_state') || {}
    all[pageId] = state
    dbSet('page_state', all)
  },
  getPageState(pageId: string): Record<string, any> | null {
    const all = dbGet<Record<string, any>>('page_state')
    return all?.[pageId] ?? null
  },

  // === Translation Cache ===
  _readTranslationCache(): Record<string, { sourceContent: string; translatedContent: string; mode: string }> {
    let cache: Record<string, any> = {}
    try { cache = dbGet<Record<string, any>>(KEYS.TRANSLATIONS) || {} } catch { /* ignore */ }
    return cache
  },
  _writeTranslationCache(cache: Record<string, any>): void {
    dbSet(KEYS.TRANSLATIONS, cache)
  },
  getTranslation(skillId: string): { sourceContent: string; translatedContent: string; mode: string } | null {
    const cache = this._readTranslationCache()
    return cache[skillId] || null
  },
  saveTranslation(skillId: string, data: { sourceContent: string; translatedContent: string; mode: string }): void {
    const cache = this._readTranslationCache()
    cache[skillId] = data
    this._writeTranslationCache(cache)
  },
  removeTranslation(skillId: string): void {
    const cache = this._readTranslationCache()
    delete cache[skillId]
    this._writeTranslationCache(cache)
  },
  clearTranslations(): void {
    this._writeTranslationCache({})
  },

  // === Description Translation Cache ===
  _readDescTranslationCache(): Record<string, string> {
    let cache: Record<string, string> = {}
    try { cache = dbGet<Record<string, string>>(KEYS.TRANSLATIONS + '_desc') || {} } catch { /* ignore */ }
    return cache
  },
  _writeDescTranslationCache(cache: Record<string, string>): void {
    dbSet(KEYS.TRANSLATIONS + '_desc', cache)
  },
  getTranslationDesc(skillId: string): string | null {
    const cache = this._readDescTranslationCache()
    return cache[skillId] || null
  },
  saveTranslationDesc(skillId: string, translatedDesc: string): void {
    const cache = this._readDescTranslationCache()
    cache[skillId] = translatedDesc
    this._writeDescTranslationCache(cache)
  },
  removeTranslationDesc(skillId: string): void {
    const cache = this._readDescTranslationCache()
    delete cache[skillId]
    this._writeDescTranslationCache(cache)
  },

  // === Remove Skill from All Caches ===
  removeSkillFromCache(skillId: string): void {
    const skills = this.getCachedSkills()
    const filtered = skills.filter((s) => s.id !== skillId)
    dbSet(KEYS.CACHED_SKILLS, filtered)

    const favorites = this.getFavoriteIds()
    const favFiltered = favorites.filter((id) => id !== skillId)
    dbSet(KEYS.FAVORITE_IDS, favFiltered)

    this.removeTranslation(skillId)
    this.removeTranslationDesc(skillId)
  },
}
