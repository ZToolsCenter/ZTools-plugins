import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPlus, Square } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { isImeKeyboardEvent } from "@/hooks/useImeInput";
import {
  detectQuickNoteDoubleShift,
  EMPTY_DOUBLE_SHIFT_STATE,
  type DoubleShiftDetectorState,
  type QuickNoteCollectVariant,
} from "./quickNoteCollectDetector";

interface QuickNoteCollectPreviewProps {
  variant: QuickNoteCollectVariant;
}

/**
 * 采集交互的会话内原型。只维护 React state，不读取剪贴板、不写草稿或笔记。
 */
export function QuickNoteCollectPreview({
  variant,
}: QuickNoteCollectPreviewProps) {
  const detectorRef = useRef<DoubleShiftDetectorState>(
    EMPTY_DOUBLE_SHIFT_STATE,
  );
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState("还没有采集内容");

  const simulateCollect = useCallback(() => {
    setCount((previous) => {
      const next = previous + 1;
      setRecent(`模拟剪贴板片段 ${next}`);
      return next;
    });
    toast.success("已收集", {
      id: "quicknote-collect-preview",
      duration: 1200,
    });
  }, []);

  const stopCollecting = useCallback(() => {
    setEnabled(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isRenameInput =
        target instanceof Element &&
        target.closest(".quicknote-slot-name-input") !== null;
      if (isRenameInput) {
        detectorRef.current = EMPTY_DOUBLE_SHIFT_STATE;
        return;
      }

      const result = detectQuickNoteDoubleShift(
        detectorRef.current,
        {
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          isComposing: isImeKeyboardEvent(event),
        },
        performance.now(),
      );
      detectorRef.current = result.state;
      if (!result.triggered) return;

      // 只观察按键，不改变浏览器或编辑器的默认键盘行为。
      if (variant === "copper") {
        simulateCollect();
        return;
      }
      setEnabled((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [simulateCollect, variant]);

  if (variant === "copper" || !enabled) return null;

  if (variant === "chip") {
    return (
      <div
        className="quicknote-collect-chip"
        data-quicknote-collect-preview="chip"
        role="status"
        aria-label={`自动收集中，已收集 ${count} 条`}
      >
        <span className="quicknote-collect-pulse" aria-hidden="true" />
        <span className="quicknote-collect-chip-label">收集中</span>
        <span className="quicknote-collect-count" aria-label={`${count} 条`}>
          {count}
        </span>
        <button
          type="button"
          className="quicknote-collect-icon-btn"
          aria-label="模拟收集一条"
          title="模拟收集"
          onClick={simulateCollect}
        >
          <ClipboardPlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="quicknote-collect-icon-btn quicknote-collect-stop-btn"
          aria-label="停止自动收集"
          title="停止收集"
          onClick={stopCollecting}
        >
          <Square aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="quicknote-collect-shelf"
      data-quicknote-collect-preview="shelf"
      role="status"
      aria-label={`自动收集中，已收集 ${count} 条，最近：${recent}`}
    >
      <span className="quicknote-collect-pulse" aria-hidden="true" />
      <span className="quicknote-collect-shelf-state">收集中</span>
      <span className="quicknote-collect-shelf-recent" title={recent}>
        {recent}
      </span>
      <span className="quicknote-collect-count" aria-label={`${count} 条`}>
        {count}
      </span>
      <button
        type="button"
        className="quicknote-collect-simulate-btn"
        onClick={simulateCollect}
      >
        模拟收集
      </button>
      <button
        type="button"
        className="quicknote-collect-stop-text-btn"
        onClick={stopCollecting}
      >
        停止
      </button>
    </div>
  );
}
