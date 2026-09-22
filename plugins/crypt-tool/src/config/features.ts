import type { AlgorithmMeta, AlgorithmModule } from '../registry/types'

export interface FeatureInput {
  code: string
  explain: string
  icon: string
  cmds: string[]
}

export function buildFeature(meta: AlgorithmMeta): FeatureInput {
  return {
    code: `alg:${meta.id}`,
    explain: meta.title,
    icon: 'logo.svg',
    cmds: [...meta.cmds]
  }
}

export function syncFeatures(
  modules: AlgorithmModule[],
  enabled: Record<string, boolean>
): void {
  for (const m of modules) {
    try {
      if (enabled[m.meta.id]) {
        window.ztools.setFeature(buildFeature(m.meta))
      } else {
        window.ztools.removeFeature(`alg:${m.meta.id}`)
      }
    } catch {
      // host feature API unavailable — non-fatal
    }
  }
}
