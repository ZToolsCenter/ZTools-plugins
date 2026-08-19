/**
 * 零依赖 debounce，复刻 lodash.debounce 的 trailing + maxWait 语义。
 * - 每次调用重置 wait 计时器（trailing：等待静默 wait 毫秒后触发）。
 * - maxWait：自上次触发后的首次调用起最多等 maxWait 毫秒强制触发一次，
 *   该上限计时器不随后续调用重置（与 lodash 一致）。
 * - 触发时用最后一次的参数调用 fn，并清空两个计时器，进入下一周期。
 * 返回值可直接调用，并挂有 cancel()/flush()。
 */
type Debounced<F extends (...args: any[]) => void> = F & {
  cancel: () => void;
  flush: () => void;
};

export function createDebounce<F extends (...args: any[]) => void>(
  fn: F,
  wait: number,
  opts?: { maxWait?: number },
): Debounced<F> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<F> | null = null;
  const maxWait = opts?.maxWait;

  const clearTimers = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  };

  const invoke = () => {
    clearTimers();
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const debounced = ((...args: Parameters<F>) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(invoke, wait);
    // maxWait 计时器只在本周期首次调用时启动，不随后续调用重置
    if (maxWait != null && maxTimer == null) {
      maxTimer = setTimeout(invoke, maxWait);
    }
  }) as Debounced<F>;

  debounced.cancel = () => {
    clearTimers();
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer || maxTimer) invoke();
  };

  return debounced;
}
