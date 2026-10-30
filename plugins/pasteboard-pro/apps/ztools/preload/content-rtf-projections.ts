export type RtfProjectionChannelV2 = "both" | "modern" | "legacy";
type Parts = { chunks: string[]; units: number };
type Stream = { role: string; parts: Parts[] };
export const MAX_RTF_PROJECTION_UNITS_V2 = 10 * 1024 * 1024;

/** Shared parts fork only when Unicode/fallback or hidden-text variants diverge. */
export class RtfPrivacyOutputV2 {
  private streams: Stream[] = [];
  private units = 0;

  createStream(role: string): number {
    if (this.streams.length >= 10_000) throw new Error("rtf-projection-unavailable");
    const parts: Parts = { chunks: [], units: 0 };
    return this.streams.push({ role, parts: [parts, parts, parts, parts] }) - 1;
  }

  append(stream: number, value: string, channel: RtfProjectionChannelV2, hidden: boolean): void {
    if (value.length === 0) return;
    const target = this.streams[stream];
    if (target === undefined) throw new Error("rtf-projection-unavailable");
    const selected = new Set<number>();
    if (channel !== "legacy") { selected.add(0); if (!hidden) selected.add(2); }
    if (channel !== "modern") { selected.add(1); if (!hidden) selected.add(3); }
    const groups = new Map<Parts, number[]>();
    target.parts.forEach((parts, index) => {
      const indices = groups.get(parts) ?? [];
      indices.push(index); groups.set(parts, indices);
    });
    let cost = 0;
    for (const [parts, indices] of groups) {
      const chosen = indices.filter((index) => selected.has(index));
      if (chosen.length > 0) cost += value.length + (chosen.length < indices.length ? parts.units : 0);
    }
    if (this.units + cost > MAX_RTF_PROJECTION_UNITS_V2) throw new Error("rtf-projection-unavailable");
    this.units += cost;
    for (const [parts, indices] of groups) {
      const chosen = indices.filter((index) => selected.has(index));
      if (chosen.length === 0) continue;
      const output = chosen.length === indices.length ? parts : { chunks: [...parts.chunks], units: parts.units };
      for (const index of chosen) target.parts[index] = output;
      output.chunks.push(value); output.units += value.length;
    }
  }

  snapshot(): readonly Readonly<{ role: string; values: readonly string[] }>[] {
    return this.streams.map((stream) => ({
      role: stream.role,
      values: [...new Set([...new Set(stream.parts)].map((parts) => parts.chunks.join("")))],
    }));
  }

  reserveProjection(value: string): boolean {
    if (this.units + value.length > MAX_RTF_PROJECTION_UNITS_V2) return false;
    this.units += value.length;
    return true;
  }
}
