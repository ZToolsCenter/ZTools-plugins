/**
 * AI 动效时间与粘滞：最短展示，避免淡入未完就消失。
 * 视觉原语已迁到 notebook-ai/beautiful-ui（CSS keyframes + React state）。
 */
import { useEffect, useRef, useState } from "react";

export const BEAM_MIN_ACTIVE_MS = 2200;
export const ORB_PHASE_HOLD_MS = 600;
export const ORB_VISIBLE_MIN_MS = 1400;
export const THINKING_PLACEHOLDER_MIN_MS = 1600;

/**
 * 真值立即生效；假值要等到「自上次变真起至少 minMs」才落下。
 */
export function useMinHoldActive(active: boolean, minMs: number): boolean {
  const [held, setHeld] = useState(active);
  const activatedAtRef = useRef<number | null>(active ? Date.now() : null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (active) {
      activatedAtRef.current = Date.now();
      setHeld(true);
      return;
    }

    if (activatedAtRef.current == null) {
      setHeld(false);
      return;
    }

    const elapsed = Date.now() - activatedAtRef.current;
    const remain = minMs - elapsed;
    if (remain <= 0) {
      setHeld(false);
      activatedAtRef.current = null;
      return;
    }

    timerRef.current = setTimeout(() => {
      setHeld(false);
      activatedAtRef.current = null;
      timerRef.current = null;
    }, remain);

    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, minMs]);

  return held;
}
