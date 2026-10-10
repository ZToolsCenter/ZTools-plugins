import type { PasteItem } from "@pasteboard-pro/core";

export type HistoryRequest = Readonly<{
  query?: string;
  pinboardId?: string;
  orderedIds?: readonly string[];
  cursor?: string;
  limit?: number;
}>;

export type HistoryPage = Readonly<{
  items: PasteItem[];
  total: number;
  nextCursor?: string;
  reset?: boolean;
}>;
