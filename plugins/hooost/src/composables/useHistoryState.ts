export interface UseHistoryStateOptions {
  /**
   * 是否清理 state， 默认是 true 会进行清理
   */
  cleanState?: boolean
}

const defaultUseHistoryStateOptions: UseHistoryStateOptions = {
  cleanState: true,
}

/**
 * 获取 vue-router state 路由传参 <br/>
 * 注意：如果需要重复请传可选参数 `cleanState = false`
 * @param options 可选参数
 */
export function useHistoryState<T>(
  options: UseHistoryStateOptions = defaultUseHistoryStateOptions
): Partial<T> {
  const state = window.history.state as Partial<T>
  if (options.cleanState) {
    window.history.replaceState({}, '', window.location.href)
  }
  return state
}
