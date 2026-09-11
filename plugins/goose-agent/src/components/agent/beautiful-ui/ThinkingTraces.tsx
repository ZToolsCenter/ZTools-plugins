/**
 * Expandable thinking trace. Adapted from Beautiful UI Thinking State
 * (MIT © 2026 Shane Levine). Receives mapped product steps — no demo copy.
 */
import { useLayoutEffect, useRef, useState } from "react";
import {
  mapStepsToThinkingTrace,
  type BuiThinkingStep,
} from "../beautifulUiMap";
import { useElapsedMs } from "./useElapsedMs";

export interface ThinkingTracesProps {
  steps?: BuiThinkingStep[];
  elapsedMs?: number;
  startedAt?: number;
  working?: boolean;
  defaultExpanded?: boolean;
}

export function ThinkingTraces({
  steps = [],
  elapsedMs,
  startedAt,
  working = true,
  defaultExpanded,
}: ThinkingTracesProps) {
  const ms = useElapsedMs({ elapsedMs, startedAt, active: working });
  const trace = mapStepsToThinkingTrace(steps, ms);
  const [manual, setManual] = useState<boolean | null>(null);
  const autoExpanded = defaultExpanded ?? (working && trace.rows.length > 0);
  const expanded = manual ?? autoExpanded;
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);

  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [expanded, trace.rows.length, working]);

  return (
    <div className="bui bui-think">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual((cur) => !(cur ?? autoExpanded))}
        className="bui-think__toggle"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          className={working ? "bui-think__star" : "bui-think__star--done"}
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className="contents">
          {working ? (
            <span className="bui-loader-label bui-shimmer-label">
              {trace.activeLabel}
            </span>
          ) : (
            <span className="bui-think__done">{trace.doneLabel}</span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={
            expanded
              ? "bui-think__chevron bui-think__chevron--open"
              : "bui-think__chevron"
          }
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div
        className={
          expanded ? "bui-think__panel bui-think__panel--open" : "bui-think__panel"
        }
      >
        <div className="bui-think__clip">
          <div className="bui-think__rows">
            <span
              aria-hidden
              className="bui-think__rail"
              style={{ height: lineHeight ? lineHeight - 2 : 0 }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {trace.rows.map((row, i) => {
                const last = i === trace.rows.length - 1;
                return (
                  <div
                    key={`${row.primary}-${i}`}
                    className="bui-think__row"
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    {last && working ? (
                      <span className="bui-think__spin" aria-hidden />
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-[var(--bui-ink-3)]"
                        aria-hidden
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                    <span
                      className={
                        trace.variant === "Reasoning"
                          ? "bui-think__primary bui-think__primary--prose"
                          : "bui-think__primary"
                      }
                    >
                      {row.primary}
                    </span>
                    {row.secondary ? (
                      <span
                        className={
                          row.mono
                            ? "bui-think__secondary bui-think__secondary--mono"
                            : "bui-think__secondary"
                        }
                      >
                        {row.secondary}
                      </span>
                    ) : null}
                    {row.add !== undefined ? (
                      <span className="bui-think__secondary bui-think__secondary--mono">
                        <span className="bui-diff-chip__add">+{row.add}</span>
                        {row.del !== undefined ? (
                          <>
                            {" "}
                            <span className="bui-diff-chip__del">−{row.del}</span>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
