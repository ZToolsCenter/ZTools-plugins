// 防抖工具：首次立即执行，窗口期内忽略重复调用（leading debounce）
// 适合「刷新」这类需要即时响应、又怕连点刷多次请求的场景

type Fn = (...args: any[]) => any;

export interface LeadingDebounced<T extends Fn> {
  (...args: Parameters<T>): ReturnType<T> | undefined;
  cancel: () => void;
}

export function leadingDebounce<T extends Fn>(fn: T, wait: number): LeadingDebounced<T> {
  let last = 0;
  const wrapped = function (this: any, ...args: any[]): any {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      return fn.apply(this, args);
    }
    return undefined;
  };
  wrapped.cancel = () => {
    last = 0;
  };
  return wrapped as LeadingDebounced<T>;
}
