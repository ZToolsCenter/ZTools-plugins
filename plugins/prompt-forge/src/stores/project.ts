import { ref, computed } from 'vue'
import type { Project, ProjectGroup } from '../types'
import { loadProjects, saveProjects } from '../utils/storage'
import { generateId } from '../utils/index'

const items = ref<Project[]>([])
let _initPromise: Promise<void> | null = null

const GROUPS: ProjectGroup[] = ['开发', '学习', '写作', '研究', '其他']

export function useProjectStore() {
  async function init() {
    if (_initPromise) return _initPromise
    _initPromise = (async () => {
      items.value = await loadProjects()
    })()
    return _initPromise
  }

  async function ensureReady() { await init() }

  const groupedProjects = computed(() => {
    const map: Record<ProjectGroup, Project[]> = {
      '开发': [], '学习': [], '写作': [], '研究': [], '其他': [],
    }
    for (const p of items.value) (map[p.group] || map['其他']).push(p)
    return map
  })

  function addProject(name: string, group: ProjectGroup, description?: string) {
    const now = Date.now()
    const project: Project = { id: generateId(), name, group, description, createdAt: now, updatedAt: now }
    items.value.push(project)
    saveProjects(items.value)
    return project
  }

  function removeProject(id: string) {
    items.value = items.value.filter(p => p.id !== id)
    saveProjects(items.value)
  }

  function updateProject(id: string, patch: Partial<Project>) {
    const idx = items.value.findIndex(p => p.id === id)
    if (idx !== -1) {
      items.value[idx] = { ...items.value[idx], ...patch, updatedAt: Date.now() }
      saveProjects(items.value)
    }
  }

  return { items, groupedProjects, init, ensureReady, addProject, removeProject, updateProject, GROUPS }
}
