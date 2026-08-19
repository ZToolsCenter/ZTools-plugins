export const QUICKNOTE_DOUBLE_SHIFT_INTERVAL_MS = 400;

export type QuickNoteCollectVariant = "copper" | "chip" | "shelf";

export function getQuickNoteCollectVariant(
  search: string,
): QuickNoteCollectVariant | null {
  const value = new URLSearchParams(search).get("collectVariant");
  return value === "copper" || value === "chip" || value === "shelf"
    ? value
    : null;
}

export interface QuickNoteCollectKeyEvent {
  key: string;
  code?: string;
  repeat: boolean;
  isComposing: boolean;
}

export interface DoubleShiftDetectorState {
  lastShiftAt: number | null;
}

export interface DoubleShiftDetectorResult {
  state: DoubleShiftDetectorState;
  triggered: boolean;
}

export const EMPTY_DOUBLE_SHIFT_STATE: DoubleShiftDetectorState = {
  lastShiftAt: null,
};

/**
 * 双 Shift 的无副作用状态机。
 *
 * 监听方只需传入 keydown：任何非 Shift、按键重复或输入法合成事件都会
 * 清除上一击，避免把编辑操作误判成连续 Shift。触发后也立即复位，因此
 * 三次 Shift 只会触发一次。
 */
export function detectQuickNoteDoubleShift(
  state: DoubleShiftDetectorState,
  event: QuickNoteCollectKeyEvent,
  now: number,
  intervalMs = QUICKNOTE_DOUBLE_SHIFT_INTERVAL_MS,
): DoubleShiftDetectorResult {
  const isShift = event.key === "Shift" || event.code?.startsWith("Shift");
  if (!isShift || event.repeat || event.isComposing) {
    return { state: EMPTY_DOUBLE_SHIFT_STATE, triggered: false };
  }

  const elapsed =
    state.lastShiftAt === null ? Number.POSITIVE_INFINITY : now - state.lastShiftAt;
  if (elapsed >= 0 && elapsed <= intervalMs) {
    return { state: EMPTY_DOUBLE_SHIFT_STATE, triggered: true };
  }

  return { state: { lastShiftAt: now }, triggered: false };
}
