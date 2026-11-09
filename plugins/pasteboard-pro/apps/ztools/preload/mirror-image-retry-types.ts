/** Counts only metadata, never source payload or file paths. */
export type MirrorImageRetrySummary = Readonly<{
  pending: number;
  failed: number;
  total: number;
  capacity: number;
}>;
