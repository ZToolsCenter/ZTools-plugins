import type {
  PasteStackDirection,
  PasteStackState,
} from "@pasteboard-pro/core";

import type { ZToolsDocumentDatabase } from "./clipboard-store";

export const defaultPasteStackState: PasteStackState = {
  direction: "forward",
  itemIds: [],
};

const PASTE_STACK_DOCUMENT_ID = "pasteboard-pro:paste-stack";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDatabaseStatus(error: unknown, status: number): boolean {
  return isRecord(error) && (error.status === status || error.statusCode === status);
}

function isDirection(value: unknown): value is PasteStackDirection {
  return value === "forward" || value === "reverse";
}

export function normalizePasteStackState(value: unknown): PasteStackState {
  if (!isRecord(value) || !isDirection(value.direction) || !Array.isArray(value.itemIds)) {
    return structuredClone(defaultPasteStackState);
  }
  return {
    direction: value.direction,
    itemIds: [...new Set(value.itemIds.filter(
      (itemId): itemId is string => typeof itemId === "string" && itemId.length > 0,
    ))],
  };
}

function parseDocument(value: unknown): PasteStackState | undefined {
  if (
    !isRecord(value) ||
    value.type !== "pasteboard-pro-paste-stack" ||
    !isRecord(value.state)
  ) return undefined;
  return normalizePasteStackState(value.state);
}

export class ZToolsPasteStackStore {
  constructor(private readonly database: ZToolsDocumentDatabase) {}

  async get(): Promise<PasteStackState> {
    try {
      return (
        parseDocument(await this.database.get(PASTE_STACK_DOCUMENT_ID)) ??
        structuredClone(defaultPasteStackState)
      );
    } catch (error) {
      if (isDatabaseStatus(error, 404)) {
        return structuredClone(defaultPasteStackState);
      }
      throw error;
    }
  }

  async put(state: PasteStackState): Promise<PasteStackState> {
    const normalized = normalizePasteStackState(state);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(PASTE_STACK_DOCUMENT_ID);
      } catch (error) {
        if (!isDatabaseStatus(error, 404)) throw error;
      }
      const revision =
        isRecord(current) && typeof current._rev === "string"
          ? current._rev
          : undefined;
      try {
        await this.database.put({
          _id: PASTE_STACK_DOCUMENT_ID,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-paste-stack",
          state: structuredClone(normalized),
        });
        return normalized;
      } catch (error) {
        if (!isDatabaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
    return normalized;
  }
}
