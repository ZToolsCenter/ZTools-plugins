import type { LaunchResult } from '../types'
import { isZtoolsCommandPath } from './scanner/ztoolsPlugins'

export type OpenPath = (
  fullPath: string,
) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string }

export type RedirectFn = (
  label: string | [string, string],
  payload?: string,
) => boolean

export type LaunchTarget = {
  /** Used in error reporting */
  key: string
  kind: 'path' | 'ztools'
  path?: string
  pluginTitle?: string
  launchCmd?: string | null
}

export async function launchPaths(paths: string[], openPath: OpenPath): Promise<LaunchResult> {
  return launchTargets(
    paths.map((path) =>
      isZtoolsCommandPath(path)
        ? { key: path, kind: 'ztools' as const, launchCmd: null }
        : { key: path, kind: 'path' as const, path },
    ),
    { openPath },
  )
}

export async function launchTargets(
  targets: LaunchTarget[],
  deps: {
    openPath: OpenPath
    redirect?: RedirectFn
  },
): Promise<LaunchResult> {
  const settled = await Promise.all(
    targets.map(async (target) => {
      try {
        if (target.kind === 'ztools') {
          const cmd = target.launchCmd?.trim()
          if (!cmd) {
            return {
              path: target.key,
              ok: false as const,
              error: 'command has no divertible text',
            }
          }
          const redirect = deps.redirect
          if (!redirect) {
            return { path: target.key, ok: false as const, error: 'redirect API unavailable' }
          }
          const title = target.pluginTitle?.trim()
          const label: string | [string, string] = title ? [title, cmd] : cmd
          const ok = redirect(label)
          if (!ok) {
            return { path: target.key, ok: false as const, error: 'redirect failed' }
          }
          return { path: target.key, ok: true as const, error: '' }
        }

        const fullPath = target.path
        if (!fullPath) {
          return { path: target.key, ok: false as const, error: 'missing path' }
        }
        const res = await Promise.resolve(deps.openPath(fullPath))
        if (!res?.success) {
          return { path: target.key, ok: false as const, error: res?.error || 'open failed' }
        }
        return { path: target.key, ok: true as const, error: '' }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        return { path: target.key, ok: false as const, error: message }
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
  targets: LaunchTarget[] | string[],
  openPath: OpenPath = (p) => {
    // @ts-expect-error host
    return ztools.shellOpenPath(p)
  },
  redirect: RedirectFn = (label, payload) => {
    // @ts-expect-error host
    return ztools.redirect(label, payload)
  },
): Promise<LaunchResult> {
  const normalized: LaunchTarget[] = targets.map((t) => {
    if (typeof t === 'string') {
      return isZtoolsCommandPath(t)
        ? { key: t, kind: 'ztools', launchCmd: null }
        : { key: t, kind: 'path', path: t }
    }
    return t
  })
  return launchTargets(normalized, { openPath, redirect })
}
