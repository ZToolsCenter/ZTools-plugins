import { useEffect, useState, type CSSProperties } from "react";
import { formatLoaderElapsed } from "../beautifulUiMap";

export type LoaderVariant = "Drive" | "Dots" | "Orbit";

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
  LoaderVariant,
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  Drive: { delays: CHEVRON, dur: 650, round: false },
  Dots: { delays: CHEVRON, dur: 650, round: true },
  Orbit: { delays: ORBIT, dur: 950, round: false },
};

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
  label = "处理中",
  variant = "Drive",
  elapsedMs,
  compact = false,
  showElapsed = true,
}: {
  label?: string;
  variant?: LoaderVariant;
  /** 受控耗时；不传则从挂载起自走 */
  elapsedMs?: number;
  compact?: boolean;
  showElapsed?: boolean;
}) {
  const [tickMs, setTickMs] = useState(0);
  const controlled = typeof elapsedMs === "number";

  useEffect(() => {
    if (controlled) return;
    const started = Date.now();
    const t = setInterval(() => setTickMs(Date.now() - started), 100);
    return () => clearInterval(t);
  }, [controlled]);

  const elapsed = formatLoaderElapsed(controlled ? elapsedMs : tickMs);
  const pattern = PATTERNS[variant] ?? PATTERNS.Drive;

  return (
    <div
      role="status"
      className={compact ? "bui-loader bui-loader--compact" : "bui-loader"}
    >
      <LoaderGrid {...pattern} />
      {label ? <span className="bui-loader-label">{label}</span> : null}
      {showElapsed && !compact ? (
        <span className="bui-loader-elapsed">{elapsed}</span>
      ) : null}
    </div>
  );
}
