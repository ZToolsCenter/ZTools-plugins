import type { PasteItem } from "@pasteboard-pro/core";

export interface SearchableClipboardStore {
  search(
    query: string,
    limit: number,
  ): Promise<Readonly<{ items: PasteItem[]; total: number }>>;
}

export type SearchHistoryToolResult = Readonly<{
  items: Array<Record<string, unknown>>;
  total: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedSearchInput(input: unknown): Readonly<{
  query: string;
  limit: number;
}> {
  const record = isRecord(input) ? input : {};
  const query = typeof record.query === "string" ? record.query.trim() : "";
  const parsedLimit = Number(record.limit ?? 20);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(100, Math.floor(parsedLimit)))
    : 20;
  return { query, limit };
}

function toolItem(item: PasteItem): Record<string, unknown> {
  const text = item.payload.text ?? item.ocrText;
  return {
    id: item.id,
    kind: item.kind,
    ...(item.title === undefined ? {} : { title: item.title.slice(0, 160) }),
    copiedAt: item.copiedAt,
    ...(item.sourceApp?.name === undefined
      ? {}
      : { sourceApp: item.sourceApp.name.slice(0, 80) }),
    ...(text === undefined
      ? {}
      : {
          preview: text.slice(0, 500),
          truncated: text.length > 500,
        }),
    ...(item.payload.filePaths === undefined
      ? {}
      : {
          files: item.payload.filePaths.slice(0, 20).map((path) =>
            path.split(/[\\/]/u).pop() ?? path,
          ),
          truncated: item.payload.filePaths.length > 20,
        }),
  };
}

export function createSearchHistoryHandler(
  store: SearchableClipboardStore,
): (input?: unknown) => Promise<SearchHistoryToolResult> {
  return async (input) => {
    const { query, limit } = normalizedSearchInput(input);
    const result = await store.search(query, limit);
    return { items: result.items.map(toolItem), total: result.total };
  };
}
