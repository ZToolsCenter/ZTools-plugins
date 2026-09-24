/**
 * local-search-neo 统一轻量日志工具
 */
const PREFIX = "[local-search-neo]";

function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    import.meta.env.DEV ||
    (window as unknown as { __LOCAL_SEARCH_DEBUG__?: boolean }).__LOCAL_SEARCH_DEBUG__,
  );
}

export const logger = {
  debug(...args: unknown[]): void {
    if (isDebugEnabled()) {
      console.debug(PREFIX, ...args);
    }
  },

  info(...args: unknown[]): void {
    console.info(PREFIX, ...args);
  },

  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },

  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },

  /**
   * 性能打点（仅在开发/调试模式下输出）
   */
  perf(label: string, durationMs: number, extra?: Record<string, unknown>): void {
    if (!isDebugEnabled()) return;

    if (extra) {
      console.debug(
        `%c${PREFIX} [Perf] ${label}: ${durationMs.toFixed(2)}ms`,
        "color: #409EFF; font-weight: bold;",
        extra,
      );
    } else {
      console.debug(
        `%c${PREFIX} [Perf] ${label}: ${durationMs.toFixed(2)}ms`,
        "color: #409EFF; font-weight: bold;",
      );
    }
  },
};
