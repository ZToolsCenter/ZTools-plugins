/**
 * Skills 发现列表的内存缓存 epoch + 清理钩子。
 * clear 时 epoch +1，供 UI / list 依赖失效；并通知订阅者。
 */

type ClearListener = () => void;

let epoch = 0;
const listeners = new Set<ClearListener>();

/** 订阅缓存清理（可选；测试 / 列表刷新） */
export function onSkillsDiscoveryCacheClear(fn: ClearListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 清空发现缓存：epoch 自增，list 侧据此失效；并通知订阅者。
 */
export function clearSkillsDiscoveryCache(): void {
  epoch += 1;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** 当前缓存世代；每次 clear 后 +1 */
export function getSkillsDiscoveryCacheEpoch(): number {
  return epoch;
}
