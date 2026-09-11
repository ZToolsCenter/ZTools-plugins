/** 插件主窗口高度（像素）；与 preload pluginSetting / gooseAgent 对齐 */

export const WINDOW_HEIGHT_MIN = 480;
export const WINDOW_HEIGHT_MAX = 1200;
export const WINDOW_HEIGHT_DEFAULT = 800;

/** 将任意输入规范到 [MIN, MAX] 整数；非法则 DEFAULT */
export function clampWindowHeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return WINDOW_HEIGHT_DEFAULT;
  }
  const n = Math.round(value);
  if (n < WINDOW_HEIGHT_MIN) return WINDOW_HEIGHT_MIN;
  if (n > WINDOW_HEIGHT_MAX) return WINDOW_HEIGHT_MAX;
  return n;
}

/** 当前环境是否可调窗口高度（uTools preload 注入 setWindowHeight） */
export function canSetWindowHeight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.gooseAgent?.setWindowHeight === "function"
  );
}

/**
 * 将高度应用到宿主窗口。API 不存在时静默跳过。
 * 返回实际应用的高度（经 clamp）；无法应用时返回 null。
 */
export function applyWindowHeight(height: number): number | null {
  if (!canSetWindowHeight()) return null;
  const h = clampWindowHeight(height);
  try {
    const applied = window.gooseAgent!.setWindowHeight!(h);
    return typeof applied === "number" && Number.isFinite(applied)
      ? clampWindowHeight(applied)
      : h;
  } catch {
    return null;
  }
}
