import { ref } from 'vue'
import { storage } from '../utils/storage'
import type { RegisteredProject, SkillScanResult } from '../types'

const registeredProjects = ref<RegisteredProject[]>(storage.getRegisteredProjects())
const selectedProject = ref<RegisteredProject | null>(null)
const selectedProjectSkill = ref<SkillScanResult | null>(null)

const savedState = storage.getPageState('project-skills')
if (savedState?.projectId) {
  const found = registeredProjects.value.find((p) => p.id === savedState.projectId)
  if (found) {
    selectedProject.value = found
    selectedProjectSkill.value = found.skills?.[0] || null
  }
}

export function useProjectState() {
  function persistSelectedProject() {
    if (selectedProject.value) {
      storage.savePageState('project-skills', { projectId: selectedProject.value.id })
    }
  }

  return {
    registeredProjects,
    selectedProject,
    selectedProjectSkill,
    persistSelectedProject,
  }
}
