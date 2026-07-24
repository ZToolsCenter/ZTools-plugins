/*
 * 防抖函数
 * @param fn 事件触发后的回调函数
 * @param delay 延迟时间
 */
export function debounce(fn: (...args: any[]) => any, delay = 200): (...args: any[]) => void {
  let timeout: any;
  return function (...args: any[]) {
    clearTimeout(timeout);
    const ctx = this;
    timeout = setTimeout(function () {
      fn.apply(ctx, args);
    }, delay);
  };
}

/**
 * 系统初始化等待函数
 */
export function onSystemReady() {
  return new Promise((resolve: any) => {
    const { ztools } = window as any;
    if (ztools) {
      ztools.onPluginReady(() => resolve());
    } else {
      resolve();
    }
  });
}
