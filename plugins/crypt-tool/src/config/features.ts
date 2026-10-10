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

/**
 * 全量同步 features（仅用于首次加载）
 */
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

/**
 * 增量同步：只处理发生变化的模块
 */
export function syncFeatureDiff(
  modules: AlgorithmModule[],
  prevEnabled: Record<string, boolean>,
  nextEnabled: Record<string, boolean>
): void {
  for (const m of modules) {
    const id = m.meta.id
    const wasEnabled = prevEnabled[id]
    const nowEnabled = nextEnabled[id]
    if (wasEnabled === nowEnabled) continue  // 无变化，跳过
    try {
      if (nowEnabled) {
        window.ztools.setFeature(buildFeature(m.meta))
      } else {
        window.ztools.removeFeature(`alg:${m.meta.id}`)
      }
    } catch {
      // host feature API unavailable — non-fatal
    }
  }
}
