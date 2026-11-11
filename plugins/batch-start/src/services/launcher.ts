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

export type LaunchOutcome = {
  path: string
  ok: boolean
  error: string
  kind: LaunchTarget['kind']
}

/** After redirect, host needs a beat before outPlugin or it aborts the target plugin mid-assembly. */
export const ZTOOLS_REDIRECT_SETTLE_MS = 2000

export function countSuccessfulZtoolsLaunches(outcomes: LaunchOutcome[]): number {
  return outcomes.filter((o) => o.ok && o.kind === 'ztools').length
}

async function launchOne(
  target: LaunchTarget,
  deps: { openPath: OpenPath; redirect?: RedirectFn },
): Promise<LaunchOutcome> {
  try {
    if (target.kind === 'ztools') {
      const cmd = target.launchCmd?.trim()
      if (!cmd) {
        return {
          path: target.key,
          ok: false,
          error: 'command has no divertible text',
          kind: 'ztools',
        }
      }
      const redirect = deps.redirect
      if (!redirect) {
        return { path: target.key, ok: false, error: 'redirect API unavailable', kind: 'ztools' }
      }
      const title = target.pluginTitle?.trim()
      const label: string | [string, string] = title ? [title, cmd] : cmd
      const ok = redirect(label)
      if (!ok) {
        return { path: target.key, ok: false, error: 'redirect failed', kind: 'ztools' }
      }
      return { path: target.key, ok: true, error: '', kind: 'ztools' }
    }

    const fullPath = target.path
    if (!fullPath) {
      return { path: target.key, ok: false, error: 'missing path', kind: 'path' }
    }
    const res = await Promise.resolve(deps.openPath(fullPath))
    if (!res?.success) {
      return { path: target.key, ok: false, error: res?.error || 'open failed', kind: 'path' }
    }
    return { path: target.key, ok: true, error: '', kind: 'path' }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { path: target.key, ok: false, error: message, kind: target.kind }
  }
}

export async function launchTargets(
  targets: LaunchTarget[],
  deps: {
    openPath: OpenPath
    redirect?: RedirectFn
  },
): Promise<LaunchResult & { outcomes: LaunchOutcome[] }> {
  // Paths can run in parallel; ZTools redirects must be sequential — each redirect
  // becomes the host "current" plugin view and would otherwise race.
  const pathTargets = targets.filter((t) => t.kind === 'path')
  const ztoolsTargets = targets.filter((t) => t.kind === 'ztools')

  const pathOutcomes = await Promise.all(pathTargets.map((t) => launchOne(t, deps)))
  const ztoolsOutcomes: LaunchOutcome[] = []
  for (const target of ztoolsTargets) {
    ztoolsOutcomes.push(await launchOne(target, deps))
  }

  const outcomes = [...pathOutcomes, ...ztoolsOutcomes]
  const errors = outcomes.filter((s) => !s.ok).map((s) => ({ path: s.path, error: s.error }))
  return {
    success: outcomes.filter((s) => s.ok).length,
    failed: errors.length,
    errors,
    outcomes,
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
