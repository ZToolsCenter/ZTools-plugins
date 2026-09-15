import type { LaunchResult } from '../types'

export type OpenPath = (
  fullPath: string,
) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string }

export async function launchPaths(paths: string[], openPath: OpenPath): Promise<LaunchResult> {
  const settled = await Promise.all(
    paths.map(async (path) => {
      try {
        const res = await Promise.resolve(openPath(path))
        if (!res?.success) return { path, ok: false as const, error: res?.error || 'open failed' }
        return { path, ok: true as const, error: '' }
      } catch (e: any) {
        return { path, ok: false as const, error: String(e?.message ?? e) }
      }
    }),
  )
  const errors = settled.filter((s) => !s.ok).map((s) => ({ path: s.path, error: s.error }))
  return {
    success: settled.filter((s) => s.ok).length,
    failed: errors.length,
    errors,
  }
}

export async function launchGroupApps(
  paths: string[],
  openPath: OpenPath = (p) => {
    // @ts-expect-error host
    return ztools.shellOpenPath(p)
  },
): Promise<LaunchResult> {
  return launchPaths(paths, openPath)
}
