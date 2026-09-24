import type {
  HistoryIndex,
  HistoryIndexEntry,
  HistoryTrigger,
  HistoryVersion,
} from "./types";

const HISTORY_TRIGGERS = new Set<HistoryTrigger>(["idle", "manual", "pre-op"]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeTrigger(value: unknown): HistoryTrigger {
  return typeof value === "string" && HISTORY_TRIGGERS.has(value as HistoryTrigger)
    ? (value as HistoryTrigger)
    : "idle";
}

function normalizeIndexEntry(value: unknown): HistoryIndexEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const versionId = stringValue(raw.versionId);
  const createdAt = finiteNumber(raw.createdAt, NaN);
  if (!versionId || !Number.isFinite(createdAt) || createdAt <= 0) return null;

  const label = stringValue(raw.label);
  return {
    versionId,
    createdAt,
    trigger: normalizeTrigger(raw.trigger),
    isMilestone: raw.isMilestone === true,
    ...(label ? { label } : {}),
    charCount: finiteNumber(raw.charCount),
    charDelta: finiteNumber(raw.charDelta),
    size: finiteNumber(raw.size),
  };
}

export function normalizeHistoryIndex(
  value: unknown,
  pageId: string,
): HistoryIndex {
  if (!value || typeof value !== "object") {
    return { pageId, versions: [], lastVersionCharCount: 0 };
  }

  const raw = value as Record<string, unknown>;
  const versions = Array.isArray(raw.versions)
    ? raw.versions.flatMap((entry) => {
        const normalized = normalizeIndexEntry(entry);
        return normalized ? [normalized] : [];
      })
    : [];

  return {
    pageId,
    versions,
    lastVersionCharCount: finiteNumber(raw.lastVersionCharCount),
  };
}

export function normalizeHistoryVersion(
  value: unknown,
  pageId: string,
  versionId: string,
): HistoryVersion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (stringValue(raw.versionId) !== versionId) return null;
  if (stringValue(raw.pageId) && raw.pageId !== pageId) return null;
  if (raw.content == null) return null;

  const label = stringValue(raw.label);
  const createdAt = finiteNumber(raw.createdAt, Date.now());
  return {
    versionId,
    pageId,
    workspaceId: stringValue(raw.workspaceId) ?? "",
    createdAt,
    trigger: normalizeTrigger(raw.trigger),
    isMilestone: raw.isMilestone === true,
    ...(label ? { label } : {}),
    charCount: finiteNumber(raw.charCount),
    charDelta: finiteNumber(raw.charDelta),
    size: finiteNumber(raw.size),
    content: raw.content as HistoryVersion["content"],
    ...(typeof raw.localFrontmatter === "string"
      ? { localFrontmatter: raw.localFrontmatter }
      : {}),
  };
}
