import type { TaskSummary } from './types/api'

export const TASK_LIBRARY_FEATURE = 'scripty'
export const RUN_TASK_FEATURE = 'scripty-run-task'
export const RUNNING_TASKS_FEATURE = 'scripty-running'

export type PluginSection = 'tasks' | 'history'

export interface PluginTaskCandidate {
  title?: string
  text: string
}

/** Maps every host feature to an existing application section and safely defaults unknown entries to the task library. */
export function resolvePluginSection(code: unknown): PluginSection {
  return code === RUNNING_TASKS_FEATURE ? 'history' : 'tasks'
}

/** Accepts only host text payloads as search input so files, objects, and other payload types cannot become execution data. */
export function normalizeMainPushQuery(payload: unknown): string {
  return typeof payload === 'string' ? payload.trim().toLocaleLowerCase() : ''
}

/** Creates display-only host candidates for runnable persisted tasks, preserving stable IDs to distinguish duplicate names. */
export function buildRunnableTaskCandidates(
  tasks: TaskSummary[],
  payload: unknown = ''
): PluginTaskCandidate[] {
  const query = normalizeMainPushQuery(payload)
  return tasks
    .filter((task) => task.readiness === 'ready')
    .filter((task) => {
      if (!query) return true
      return `${task.name} ${task.scriptName} ${task.note}`.toLocaleLowerCase().includes(query)
    })
    .map((task) => ({
      title: task.name,
      text: `${task.scriptName} · ${task.id}`
    }))
}

/** Resolves a host selection against a fresh task snapshot; stale, altered, ambiguous, or non-runnable selections are rejected. */
export function resolveSelectedTask(
  tasks: TaskSummary[],
  option: PluginTaskCandidate | null | undefined
): TaskSummary | null {
  if (!option || typeof option.text !== 'string') return null
  const matches = tasks.filter((task) => {
    if (task.readiness !== 'ready') return false
    const candidate = buildRunnableTaskCandidates([task])[0]
    return candidate?.title === option.title && candidate.text === option.text
  })
  return matches.length === 1 ? matches[0] : null
}
