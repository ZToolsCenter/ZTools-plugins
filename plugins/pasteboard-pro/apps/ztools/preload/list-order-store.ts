import type { ZToolsDocumentDatabase } from "./clipboard-store";

export type ListOrders = Readonly<Record<string, readonly string[]>>;

const LIST_ORDER_ID = "pasteboard-pro:settings:list-orders";
const MAX_ORDERED_ITEMS = 10_000;
const MAX_SCOPES = 258;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDatabaseStatus(error: unknown, status: number): boolean {
  return (
    isRecord(error) &&
    (error.status === status || error.statusCode === status)
  );
}

function normalizedScope(value: string): string {
  const scope = value.trim();
  if (
    scope === "all" ||
    scope === "smart:text" ||
    scope === "smart:image" ||
    (scope.startsWith("pinboard:") && scope.length > 9 && scope.length <= 1_024)
  ) {
    return scope;
  }
  throw new TypeError("List order scope must be all, a smart group, or a custom pinboard");
}

function normalizedItemIds(values: readonly string[]): string[] {
  if (values.length > MAX_ORDERED_ITEMS) {
    throw new RangeError(`List order is limited to ${MAX_ORDERED_ITEMS} items`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
      throw new TypeError("List order item ids must be non-empty strings");
    }
    if (!seen.has(value)) {
      seen.add(value);
      ids.push(value);
    }
  }
  return ids;
}

function ordersFromDocument(value: unknown): Record<string, string[]> {
  if (!isRecord(value) || !isRecord(value.orders)) return {};
  const entries: Array<readonly [string, string[]]> = [];
  for (const [scope, ids] of Object.entries(value.orders).slice(0, MAX_SCOPES)) {
    if (!Array.isArray(ids)) continue;
    try {
      entries.push([normalizedScope(scope), normalizedItemIds(ids as string[])]);
    } catch {
      // Ignore malformed legacy or externally edited entries without losing valid scopes.
    }
  }
  return Object.fromEntries(entries);
}

export class ZToolsListOrderStore {
  constructor(private readonly database: ZToolsDocumentDatabase) {}

  async get(): Promise<Record<string, string[]>> {
    try {
      return ordersFromDocument(await this.database.get(LIST_ORDER_ID));
    } catch (error) {
      if (isDatabaseStatus(error, 404)) return {};
      throw error;
    }
  }

  async put(scopeInput: string, itemIdsInput: readonly string[]): Promise<Record<string, string[]>> {
    const scope = normalizedScope(scopeInput);
    const itemIds = normalizedItemIds(itemIdsInput);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(LIST_ORDER_ID);
      } catch (error) {
        if (!isDatabaseStatus(error, 404)) throw error;
      }
      const revision = isRecord(current) && typeof current._rev === "string"
        ? current._rev
        : undefined;
      const orders = ordersFromDocument(current);
      if (!(scope in orders) && Object.keys(orders).length >= MAX_SCOPES) {
        throw new RangeError(`List order is limited to ${MAX_SCOPES} scopes`);
      }
      orders[scope] = itemIds;
      try {
        await this.database.put({
          _id: LIST_ORDER_ID,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-list-orders",
          orders,
        });
        return structuredClone(orders);
      } catch (error) {
        if (!isDatabaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
    return {};
  }
}
