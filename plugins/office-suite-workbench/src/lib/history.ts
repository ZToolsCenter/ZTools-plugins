export interface HistoryItem {
  id: string;
  label: string;
  command: string;
  ok: boolean;
  at: string;
}

function isHistoryItem(value: unknown): value is HistoryItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.label === "string"
    && typeof item.command === "string"
    && typeof item.ok === "boolean"
    && typeof item.at === "string"
    && Number.isFinite(Date.parse(item.at));
}

export function parseStoredHistory(value: string | null): HistoryItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryItem).slice(0, 12);
  } catch {
    return [];
  }
}
