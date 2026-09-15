/**
 * 持久化 AI 面板宽度（320–560px）
 */
import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "goose-note-ai-panel-width";
/** 用户拖拽与持久化的合法区间（展示宽度可能因父级极窄而低于 MIN） */
export const PANEL_WIDTH_MIN = 320;
export const PANEL_WIDTH_MAX = 560;
const MIN_WIDTH = PANEL_WIDTH_MIN;
const MAX_WIDTH = PANEL_WIDTH_MAX;
const DEFAULT_WIDTH = 360;

function clamp(v: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v));
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!isNaN(n)) return clamp(n);
    }
  } catch {}
  return DEFAULT_WIDTH;
}

export function usePanelWidth() {
  const [width, setWidth] = useState<number>(readStoredWidth);

  const setAndPersist = useCallback((w: number) => {
    const clamped = clamp(w);
    setWidth(clamped);
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {}
  }, []);

  // Drag handle logic
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = startX.current - ev.clientX;
        setWidth(clamp(startWidth.current + delta));
      };
      const onMouseUp = (ev: MouseEvent) => {
        isDragging.current = false;
        const delta = startX.current - ev.clientX;
        setAndPersist(startWidth.current + delta);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [width, setAndPersist],
  );

  return { width, setWidth: setAndPersist, onDragHandleMouseDown: onMouseDown };
}
