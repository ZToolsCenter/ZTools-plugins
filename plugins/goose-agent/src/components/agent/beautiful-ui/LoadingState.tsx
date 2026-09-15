/**
 * Pixel-grid loader + shimmer label + tabular elapsed.
 * Adapted from Beautiful UI (MIT © 2026 Shane Levine). No Surfer / video.
 */
import type { CSSProperties } from "react";
import { formatLoaderElapsed } from "../beautifulUiMap";
import { useElapsedMs } from "./useElapsedMs";

const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<
  "Drive" | "Dots" | "Orbit",
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  Drive: { delays: CHEVRON, dur: 650, round: false },
  Dots: { delays: CHEVRON, dur: 650, round: true },
  Orbit: { delays: ORBIT, dur: 950, round: false },
};

export type LoadingVariant = "Drive" | "Dots" | "Orbit";

export interface LoadingStateProps {
  label?: string;
  variant?: LoadingVariant;
  /** 受控耗时；省略则从 startedAt / 挂载起跳。 */
  elapsedMs?: number;
  startedAt?: number;
  active?: boolean;
  showElapsed?: boolean;
  size?: "sm" | "md";
  className?: string;
}

function LoaderGrid({
  delays,
  dur,
  round,
}: {
  delays: (number | null)[];
  dur: number;
  round: boolean;
}) {
  return (
    <span aria-hidden className="bui-loader-grid">
      {delays.map((delay, index) => (
        <span
          key={index}
          className={[
            "bui-loader-cell",
            round ? "bui-loader-cell--round" : "",
            delay === null ? "" : "bui-loader-cell--on",
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            delay === null
              ? { opacity: 0.07 }
              : ({
                  "--bui-pixel-dur": `${dur}ms`,
                  "--bui-pixel-delay": `${delay}ms`,
                } as CSSProperties)
          }
        />
      ))}
    </span>
  );
}

export function LoadingState({
  label,
  variant = "Drive",
  elapsedMs,
  startedAt,
  active = true,
  showElapsed = true,
  size = "md",
  className,
}: LoadingStateProps) {
  const ms = useElapsedMs({ elapsedMs, startedAt, active });
  const pattern = PATTERNS[variant] ?? PATTERNS.Drive;

  return (
    <div
      role="status"
      className={["bui", "bui-loader", size === "sm" ? "bui-loader--sm" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <LoaderGrid delays={pattern.delays} dur={pattern.dur} round={pattern.round} />
      {label ? (
        <span className="bui-loader-label bui-shimmer-label">{label}</span>
      ) : null}
      {showElapsed ? (
        <span className="bui-loader-elapsed">{formatLoaderElapsed(ms)}</span>
      ) : null}
    </div>
  );
}
