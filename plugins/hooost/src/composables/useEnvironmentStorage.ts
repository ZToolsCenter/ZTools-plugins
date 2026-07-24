import type { EnvironmentStore, Environment } from '@/types/hosts'
import { buildGroupEndMarker, buildGroupHeader } from '../lib/hosts'

const STORAGE_KEYS = {
  STORE: 'hooost:environment:store',
}

const INITIAL_ENVIRONMENTS = [
  { id: 'env-default-dev', name: '开发配置' },
  { id: 'env-default-test', name: '测试配置' },
  { id: 'env-default-prod', name: '生产配置' },
] as const

type EnvironmentStoreLike = {
  initialized?: unknown
  activeEnvironmentIds?: unknown[]
  environments?: unknown[]
}

type StoredEnvironment = Partial<Environment> & {
  id?: unknown
  name?: unknown
  type?: unknown
  enabled?: unknown
  editMode?: unknown
  header?: unknown
  endMarker?: unknown
  lines?: unknown
  updatedAt?: unknown
}

function createPublicEnvironment(): Environment {
  return {
    id: 'env-public',
    name: 'hosts 文件',
    type: 'public',
    enabled: true,
    editMode: 'source',
    header: '#-------- 公共配置 --------',
    endMarker: '',
    lines: [],
    updatedAt: new Date().toISOString(),
  }
}

function createInitialEnvironment(id: string, name: string): Environment {
  const now = new Date().toISOString()
  return {
    id,
    name,
    type: 'custom',
    enabled: false,
    editMode: 'source',
    header: buildGroupHeader(name),
    endMarker: buildGroupEndMarker(name),
    lines: [],
    updatedAt: now,
  }
}

function createEmptyStore(): EnvironmentStore {
  return {
    initialized: false,
    activeEnvironmentIds: ['env-public'],
    environments: [createPublicEnvironment()],
  }
}

export function createCustomEnvironmentId(): string {
  return `env-custom-${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`
}

function normalizeCustomEnvironment(env: StoredEnvironment): Environment {
  const normalizedName =
    typeof env.name === 'string' && env.name.trim() ? env.name.trim() : '新配置'

  return {
    id: typeof env.id === 'string' && env.id ? env.id : createCustomEnvironmentId(),
    name: normalizedName,
    type: 'custom',
    enabled: false,
    editMode: 'source',
    header:
      typeof env.header === 'string' && env.header.trim()
        ? env.header
        : buildGroupHeader(normalizedName),
    endMarker:
      typeof env.endMarker === 'string' && env.endMarker.trim()
        ? env.endMarker
        : buildGroupEndMarker(normalizedName),
    lines: Array.isArray(env.lines) ? env.lines : [],
    updatedAt:
      typeof env.updatedAt === 'string' && env.updatedAt ? env.updatedAt : new Date().toISOString(),
  }
}

function isEnvironmentStoreLike(value: unknown): value is EnvironmentStoreLike {
  if (!value || typeof value !== 'object') return false
  const store = value as EnvironmentStoreLike
  return Array.isArray(store.activeEnvironmentIds) && Array.isArray(store.environments)
}

function ensureInitialEnvironments(
  store: EnvironmentStore,
  initialized: boolean
): EnvironmentStore {
  if (initialized) {
    return {
      ...store,
      initialized: true,
    }
  }

  const environments = [...store.environments]
  for (const preset of INITIAL_ENVIRONMENTS) {
    const presetHeader = buildGroupHeader(preset.name)
    const exists = environments.some(
      (env) => env.type === 'custom' && (env.name === preset.name || env.header === presetHeader)
    )
    if (!exists) {
      environments.push(createInitialEnvironment(preset.id, preset.name))
    }
  }

  return {
    ...store,
    initialized: true,
    environments,
  }
}

export function normalizeStore(storeLike: EnvironmentStoreLike): EnvironmentStore {
  const baseStore = isEnvironmentStoreLike(storeLike) ? storeLike : createEmptyStore()
  const publicDefaults = createPublicEnvironment()
  const existingPublic = baseStore.environments.find(
    (env) => env && typeof env === 'object' && (env as StoredEnvironment).type === 'public'
  ) as StoredEnvironment | undefined

  const publicEnvironment: Environment = {
    ...publicDefaults,
    ...existingPublic,
    id: 'env-public',
    name: 'hosts 文件',
    type: 'public',
    enabled: true,
    editMode: 'source',
    header: publicDefaults.header,
    endMarker: '',
    lines: Array.isArray(existingPublic?.lines) ? existingPublic.lines : publicDefaults.lines,
    updatedAt:
      typeof existingPublic?.updatedAt === 'string' && existingPublic.updatedAt
        ? existingPublic.updatedAt
        : publicDefaults.updatedAt,
  }

  const customEnvironments = baseStore.environments
    .filter(
      (env): env is StoredEnvironment =>
        !!env && typeof env === 'object' && (env as StoredEnvironment).type !== 'public'
    )
    .map(normalizeCustomEnvironment)

  const seededStore = ensureInitialEnvironments(
    {
      initialized: baseStore.initialized === true,
      activeEnvironmentIds: Array.isArray(baseStore.activeEnvironmentIds)
        ? baseStore.activeEnvironmentIds.filter((id): id is string => typeof id === 'string')
        : ['env-public'],
      environments: [publicEnvironment, ...customEnvironments],
    },
    baseStore.initialized === true
  )

  const validIds = new Set(seededStore.environments.map((env) => env.id))
  const activeEnvironmentIds = Array.from(
    new Set([
      'env-public',
      ...seededStore.activeEnvironmentIds.filter((id) => id !== 'env-public' && validIds.has(id)),
    ])
  )

  const normalizedEnvironments = seededStore.environments.map((env) =>
    env.type === 'public'
      ? { ...env, enabled: true }
      : { ...env, enabled: activeEnvironmentIds.includes(env.id) }
  )

  const publicEnvironmentEntry =
    normalizedEnvironments.find((env) => env.type === 'public') ?? publicEnvironment
  const environments = [
    publicEnvironmentEntry,
    ...normalizedEnvironments.filter((env) => env.type !== 'public'),
  ]

  return {
    initialized: true,
    activeEnvironmentIds,
    environments,
  }
}

export function useEnvironmentStorage() {
  const saveStore = (store: EnvironmentStore) => {
    const normalized = normalizeStore(store)
    window.ztools.dbStorage.setItem(STORAGE_KEYS.STORE, JSON.parse(JSON.stringify(normalized)))
  }

  const loadStore = (): EnvironmentStore => {
    const stored = window.ztools.dbStorage.getItem<EnvironmentStoreLike>(STORAGE_KEYS.STORE)
    const normalized = normalizeStore(isEnvironmentStoreLike(stored) ? stored : createEmptyStore())
    const serializedNormalized = JSON.stringify(normalized)

    if (!isEnvironmentStoreLike(stored) || JSON.stringify(stored) !== serializedNormalized) {
      window.ztools.dbStorage.setItem(STORAGE_KEYS.STORE, JSON.parse(serializedNormalized))
    }

    return normalized
  }

  return { loadStore, saveStore }
}
