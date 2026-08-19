import { useEffect, useRef } from "react";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { extractPlainText } from "@/components/editor/utils/blocknote-content";
import { countWords } from "@/components/editor/utils/content-text-extractor";
import { recordHistorySnapshotDetailed } from "@/lib/history/snapshot";
import { useAiStatus } from "@/stores/useAiStatus";
import { useHistoryView } from "@/stores/useHistoryView";

/** 停笔后多久落一次（debounce）—— 自然写作节奏 */
const IDLE_MS = 15_000;
/** 心跳周期 —— 即使一直打字也强制落点 */
const HEARTBEAT_MS = 30_000;
/** 字数突变阈值 —— 大段粘贴/AI 输出立即落点 */
const CHAR_THRESHOLD = 200;

/**
 * 把内容压成"实质字符指纹"：抽出纯文本后去掉所有空白字符。
 * 只多了空格/空行/换行 → 指纹不变 → 跳过记录。
 */
function substantiveFingerprint(content: BlockNoteContent): string {
  return extractPlainText(content as any).replace(/\s+/g, "");
}

/**
 * 自动历史记录器，三条规则任一触发即落快照：
 *  1) 停笔 15s（debounce）
 *  2) 心跳 30s（持续写作也能拿到检查点）
 *  3) 字符差 ≥ 200（突变立即落点）
 *
 * 数据层保证自动快照至少间隔 5 分钟；限频期间始终保留最新 pending，
 * 到达可写时间后再合并落盘，不影响页面自身的实时保存。
 *
 * 跳过条件：
 *  - 内容为空（countWords === 0）
 *  - signature 与上次一致
 *  - **实质字符指纹与上次一致（只多了空格/空行/换行）** ← 新增
 *  - AI 流式输出中
 */
export function useHistoryRecorder(params: {
  pageId: string | null;
  workspaceId: string | null;
  content: BlockNoteContent | undefined;
  signature: string;
}) {
  const { pageId, workspaceId, content, signature } = params;

  const lastRecordedSigRef = useRef<string | null>(null);
  const lastRecordedFingerprintRef = useRef<string | null>(null);
  const lastRecordedCharRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const pendingRef = useRef<{
    content: BlockNoteContent;
    charCount: number;
    signature: string;
    fingerprint: string;
  } | null>(null);

  // 切页：清状态
  useEffect(() => {
    lastRecordedSigRef.current = null;
    lastRecordedFingerprintRef.current = null;
    lastRecordedCharRef.current = 0;
    recordingRef.current = false;
    pendingRef.current = null;
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, [pageId]);

  // 心跳：独立的 setInterval，不随 content 变化重建
  useEffect(() => {
    if (!pageId || !workspaceId) return;
    let cancelled = false;

    const tryFire = () => {
      if (recordingRef.current) return;
      const p = pendingRef.current;
      if (!p) return;
      if (p.signature === lastRecordedSigRef.current) return;
      if (p.charCount === 0) return; // 空白跳过
      // 实质内容未变（仅空白差异）→ 跳过
      if (
        lastRecordedFingerprintRef.current !== null &&
        p.fingerprint === lastRecordedFingerprintRef.current
      ) {
        // 也清掉 pending 和定时器，避免反复尝试
        pendingRef.current = null;
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        return;
      }
      if (useAiStatus.getState().phase === "streaming") return;

      const sig = p.signature;
      const fingerprint = p.fingerprint;
      const charCount = p.charCount;
      recordingRef.current = true;
      recordHistorySnapshotDetailed({
        pageId,
        workspaceId,
        content: p.content,
        trigger: "idle",
      })
        .then((result) => {
          if (cancelled) return;
          if (result.status === "rate-limited") {
            if (pendingRef.current) {
              if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
              idleTimerRef.current = setTimeout(
                tryFire,
                Math.max(0, result.retryAt - Date.now()),
              );
            }
            return;
          }

          if (pendingRef.current?.signature === sig) {
            pendingRef.current = null;
          }
          lastRecordedSigRef.current = sig;
          lastRecordedFingerprintRef.current = fingerprint;
          lastRecordedCharRef.current = charCount;

          if (result.status === "created" || result.status === "updated") {
            const view = useHistoryView.getState();
            if (view.active === pageId) {
              view.bumpRefresh();
            }
          }
        })
        .catch((err) =>
          console.error("[history] recordHistorySnapshot failed:", err),
        )
        .finally(() => {
          if (!cancelled) recordingRef.current = false;
        });
    };

    (heartbeatRef as any).fire = tryFire;

    heartbeatRef.current = setInterval(() => {
      tryFire();
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [pageId, workspaceId]);

  // 内容变化：更新 pending、重置 idle、检查突变
  useEffect(() => {
    if (!pageId || !workspaceId || !content) return;
    if (signature === lastRecordedSigRef.current) return;

    const charCount = countWords(content);
    const fingerprint = substantiveFingerprint(content);

    // 实质内容指纹相同（只是空白/换行变了）→ 不入 pending，不重置 idle
    if (
      lastRecordedFingerprintRef.current !== null &&
      fingerprint === lastRecordedFingerprintRef.current
    ) {
      return;
    }

    pendingRef.current = { content, charCount, signature, fingerprint };

    const fire = (heartbeatRef as any).fire as (() => void) | undefined;

    // 突变：立即落点（前提是已有基线）
    const charDelta = Math.abs(charCount - lastRecordedCharRef.current);
    if (charDelta >= CHAR_THRESHOLD && lastRecordedCharRef.current > 0) {
      fire?.();
      return;
    }

    // 否则重置 idle debounce
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      fire?.();
    }, IDLE_MS);

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [pageId, workspaceId, content, signature]);
}
