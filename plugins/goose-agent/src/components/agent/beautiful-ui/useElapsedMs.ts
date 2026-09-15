import { useEffect, useRef, useState } from "react";

export function useElapsedMs(opts: {
  elapsedMs?: number;
  startedAt?: number;
  active?: boolean;
}): number {
  const { elapsedMs, startedAt, active = true } = opts;
  const [now, setNow] = useState(() => Date.now());
  const mountRef = useRef(Date.now());
  const frozenRef = useRef<number | null>(null);

  useEffect(() => {
    if (elapsedMs != null || !active) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [elapsedMs, active]);

  if (elapsedMs != null) return Math.max(0, elapsedMs);
  const start = startedAt ?? mountRef.current;
  if (!active) {
    if (frozenRef.current == null) {
      frozenRef.current = Math.max(0, now - start);
    }
    return frozenRef.current;
  }
  frozenRef.current = null;
  return Math.max(0, now - start);
}
