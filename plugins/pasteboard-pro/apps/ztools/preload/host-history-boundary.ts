import type {
  HistoryClearBoundary,
  HostClipboardApi,
  HostCursor,
} from "./clipboard-store-types";
import { compareCursor, hostCursor } from "./clipboard-host-normalization";
import {
  historyClearIdentity,
  MAX_HISTORY_CLEAR_IDENTITIES,
} from "./history-clear-identity";

export type HistoryClearSourceErrorCode =
  | "history-clear-source-unavailable"
  | "history-clear-source-invalid"
  | "history-clear-source-over-limit";

const FIXED_ERROR_MESSAGE = "Cannot confirm clipboard history clear boundary";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 1_000;
const MAX_PAGE_SIZE = 500;
const MAX_PAGES = 1_000;
const MAX_CURSOR_ID_LENGTH = 4_096;

export class HistoryClearSourceError extends Error {
  readonly code: HistoryClearSourceErrorCode;

  constructor(code: HistoryClearSourceErrorCode) {
    super(FIXED_ERROR_MESSAGE);
    this.name = "HistoryClearSourceError";
    this.code = code;
  }
}

type ReadOptions = Readonly<{ pageSize: number; maxPages: number }>;
type ValidatedPage = Readonly<{
  items: readonly unknown[];
  length: number;
  total: number;
}>;
type HostHistoryBoundaryScan = Readonly<{
  through?: HostCursor;
  clearedIdentities?: readonly string[];
}>;

function fail(code: HistoryClearSourceErrorCode): never {
  throw new HistoryClearSourceError(code);
}

function optionValue(
  options: object,
  key: "pageSize" | "maxPages",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (descriptor === undefined) return undefined;
  if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    fail("history-clear-source-invalid");
  }
  return descriptor.value;
}

function positiveBoundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const resolved = value === undefined ? fallback : value;
  if (
    typeof resolved !== "number" ||
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > maximum
  ) {
    fail("history-clear-source-invalid");
  }
  return resolved;
}

function readOptions(options: unknown): ReadOptions {
  if (options === undefined) {
    return { pageSize: DEFAULT_PAGE_SIZE, maxPages: DEFAULT_MAX_PAGES };
  }

  try {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      fail("history-clear-source-invalid");
    }

    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("history-clear-source-invalid");
    }

    const keys = Reflect.ownKeys(options);
    if (keys.some((key) => key !== "pageSize" && key !== "maxPages")) {
      fail("history-clear-source-invalid");
    }

    const pageSize = optionValue(options, "pageSize");
    const maxPages = optionValue(options, "maxPages");
    return {
      pageSize: positiveBoundedInteger(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      maxPages: positiveBoundedInteger(maxPages, DEFAULT_MAX_PAGES, MAX_PAGES),
    };
  } catch {
    fail("history-clear-source-invalid");
  }
}

function validatePage(value: unknown, pageSize: number): ValidatedPage {
  let items: unknown;
  let total: unknown;
  let length: number;
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      fail("history-clear-source-invalid");
    }
    const result = value as Record<string, unknown>;
    items = result.items;
    total = result.total;
    if (!Array.isArray(items)) {
      fail("history-clear-source-invalid");
    }
    length = items.length;
  } catch {
    fail("history-clear-source-invalid");
  }

  if (
    !Number.isSafeInteger(total) ||
    (total as number) < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > pageSize ||
    length > (total as number)
  ) {
    fail("history-clear-source-invalid");
  }
  if (length > 0 && total === 0) {
    fail("history-clear-source-invalid");
  }
  return { items: items as readonly unknown[], length, total: total as number };
}

function cloneCursor(cursor: HostCursor | undefined): HostCursor | undefined {
  return cursor === undefined
    ? undefined
    : { id: cursor.id, timestamp: cursor.timestamp };
}

/**
 * Reads a bounded, read-only cursor boundary from the host's clipboard history.
 * It retains only item IDs and timestamps and makes no claim that a changing
 * host history remains stable across pagination calls.
 */
async function scanHostHistoryBoundary(
  host: HostClipboardApi,
  options: { pageSize?: number; maxPages?: number } | undefined,
  collectClearIdentities: boolean,
): Promise<HostHistoryBoundaryScan> {
  // Resolve and copy option values before the first await so later caller edits
  // cannot alter the page budget during this read.
  const { pageSize, maxPages } = readOptions(options);
  const budget = pageSize * maxPages;

  let getHistory: HostClipboardApi["getHistory"];
  try {
    getHistory = host.getHistory;
  } catch {
    fail("history-clear-source-unavailable");
  }
  if (typeof getHistory !== "function") {
    fail("history-clear-source-unavailable");
  }

  let loaded = 0;
  let newest: HostCursor | undefined;
  const clearedIdentities = collectClearIdentities ? new Set<string>() : undefined;
  for (let page = 1; page <= maxPages; page += 1) {
    let response: unknown;
    try {
      response = await Reflect.apply(getHistory, host, [page, pageSize]);
    } catch {
      fail("history-clear-source-unavailable");
    }

    const result = validatePage(response, pageSize);
    if (result.total > budget) {
      fail("history-clear-source-over-limit");
    }
    if (result.length > budget - loaded) {
      fail("history-clear-source-over-limit");
    }

    for (let index = 0; index < result.length; index += 1) {
      let cursor: HostCursor | undefined;
      try {
        cursor = hostCursor(result.items[index]);
      } catch {
        fail("history-clear-source-invalid");
      }
      if (cursor === undefined || cursor.id.length > MAX_CURSOR_ID_LENGTH) {
        fail("history-clear-source-invalid");
      }

      const ownedCursor = { id: cursor.id, timestamp: cursor.timestamp };
      if (clearedIdentities !== undefined) {
        clearedIdentities.add(historyClearIdentity(ownedCursor));
        if (clearedIdentities.size > MAX_HISTORY_CLEAR_IDENTITIES) {
          fail("history-clear-source-over-limit");
        }
      }
      if (newest === undefined || compareCursor(ownedCursor, newest) > 0) {
        newest = ownedCursor;
      }
    }

    loaded += result.length;
    if (result.length === 0) {
      if (loaded < result.total) {
        fail("history-clear-source-invalid");
      }
      return scanResult(newest, clearedIdentities);
    }
    if (loaded >= result.total) {
      return scanResult(newest, clearedIdentities);
    }
    if (page === maxPages) {
      fail("history-clear-source-over-limit");
    }
  }

  // The bounded loop always returns or throws on its final page.
  fail("history-clear-source-over-limit");
}

function scanResult(
  through: HostCursor | undefined,
  clearedIdentities: ReadonlySet<string> | undefined,
): HostHistoryBoundaryScan {
  if (through === undefined) return {};
  const ownedThrough = cloneCursor(through);
  if (ownedThrough === undefined) fail("history-clear-source-invalid");
  if (clearedIdentities === undefined) return { through: ownedThrough };
  if (!clearedIdentities.has(historyClearIdentity(ownedThrough))) {
    fail("history-clear-source-invalid");
  }
  return {
    through: ownedThrough,
    clearedIdentities: [...clearedIdentities].sort(),
  };
}

export async function readHostHistoryClearBoundary(
  host: HostClipboardApi,
  options?: { pageSize?: number; maxPages?: number },
): Promise<HistoryClearBoundary | undefined> {
  const boundary = await scanHostHistoryBoundary(host, options, true);
  if (boundary.through === undefined) return undefined;
  if (boundary.clearedIdentities === undefined) fail("history-clear-source-invalid");
  const through = cloneCursor(boundary.through);
  if (through === undefined) fail("history-clear-source-invalid");
  return {
    through,
    clearedIdentities: [...boundary.clearedIdentities],
  };
}

export async function readHostHistoryBoundary(
  host: HostClipboardApi,
  options?: { pageSize?: number; maxPages?: number },
): Promise<HostCursor | undefined> {
  const boundary = await scanHostHistoryBoundary(host, options, false);
  return cloneCursor(boundary.through);
}
