import type { PasteItem } from "./types";

export type PasteQuery = {
  text: string[];
  types: string[];
  apps: string[];
  devices: string[];
  dates: string[];
  pinboards: string[];
};

export type SearchPasteOptions = {
  now?: Date | string | number;
};

type QueryFilter = Exclude<keyof PasteQuery, "text">;

const FILTER_ALIASES: Readonly<Record<string, QueryFilter>> = {
  type: "types",
  app: "apps",
  from: "apps",
  device: "devices",
  date: "dates",
  pinboard: "pinboards",
  board: "pinboards",
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const EXACT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parsePasteQuery(input: string): PasteQuery {
  const query: PasteQuery = {
    text: [],
    types: [],
    apps: [],
    devices: [],
    dates: [],
    pinboards: [],
  };

  for (const token of tokenize(input)) {
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
      const text = stripWrappingQuotes(token).toLowerCase();
      if (text.length > 0) {
        query.text.push(text);
      }
      continue;
    }

    const separatorIndex = token.indexOf(":");
    const key = separatorIndex >= 0 ? token.slice(0, separatorIndex) : "";
    const target = FILTER_ALIASES[key.toLowerCase()];
    const rawValue =
      separatorIndex >= 0 ? token.slice(separatorIndex + 1) : "";
    const value = stripWrappingQuotes(rawValue);

    if (target !== undefined && value.length > 0) {
      query[target].push(value);
      continue;
    }

    const text = (
      separatorIndex >= 0
        ? `${key}:${stripWrappingQuotes(rawValue)}`
        : stripWrappingQuotes(token)
    ).toLowerCase();
    if (text.length > 0) {
      query.text.push(text);
    }
  }

  return query;
}

export function searchPasteItems(
  items: readonly PasteItem[],
  input: string,
  options: SearchPasteOptions = {},
): PasteItem[] {
  const query = parsePasteQuery(input);
  const matches: Array<{
    item: PasteItem;
    index: number;
    score: number;
  }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }

    const score = scoreItem(item, query.text);
    if (
      score === null ||
      !matchesAny(query.types, (value) =>
        equalsIgnoreCase(item.kind, value),
      ) ||
      !matchesAny(query.apps, (value) =>
        [item.sourceApp?.name, item.sourceApp?.bundleId].some((field) =>
          includesIgnoreCase(field, value),
        ),
      ) ||
      !matchesAny(query.devices, (value) =>
        includesIgnoreCase(item.sourceDeviceId, value),
      ) ||
      !matchesAny(query.pinboards, (value) =>
        equalsIgnoreCase(item.pinboardId, value),
      ) ||
      !matchesDate(item.copiedAt, query.dates, options)
    ) {
      continue;
    }

    matches.push({ item, index, score });
  }

  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.item.copiedAt) - Date.parse(left.item.copiedAt) ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;

  for (const character of input.trim()) {
    if (character === '"') {
      quoted = !quoted;
      token += character;
      continue;
    }

    if (/\s/.test(character) && !quoted) {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += character;
  }

  if (token.length > 0) {
    tokens.push(token);
  }

  return tokens;
}

function stripWrappingQuotes(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function matchesAny(
  filters: readonly string[],
  predicate: (filter: string) => boolean,
): boolean {
  return filters.length === 0 || filters.some(predicate);
}

function equalsIgnoreCase(
  field: string | undefined,
  expected: string,
): boolean {
  return field?.toLowerCase() === expected.toLowerCase();
}

function includesIgnoreCase(
  field: string | undefined,
  expected: string,
): boolean {
  return field?.toLowerCase().includes(expected.toLowerCase()) ?? false;
}

function matchesDate(
  copiedAt: string,
  filters: readonly string[],
  options: SearchPasteOptions,
): boolean {
  if (filters.length === 0) {
    return true;
  }

  const copiedAtMs = Date.parse(copiedAt);
  if (!Number.isFinite(copiedAtMs)) {
    return false;
  }

  let nowMs: number | undefined;
  const resolveNowMs = (): number => {
    nowMs ??=
      options.now === undefined ? Date.now() : new Date(options.now).getTime();
    return nowMs;
  };

  return filters.some((filter) => {
    const normalized = filter.toLowerCase();

    if (normalized === "today") {
      const currentMs = resolveNowMs();
      return (
        Number.isFinite(currentMs) &&
        toUtcDate(copiedAtMs) === toUtcDate(currentMs)
      );
    }

    if (normalized === "week") {
      const currentMs = resolveNowMs();
      return (
        Number.isFinite(currentMs) &&
        copiedAtMs >= currentMs - 7 * DAY_MS &&
        copiedAtMs <= currentMs
      );
    }

    if (normalized === "month") {
      const currentMs = resolveNowMs();
      return (
        Number.isFinite(currentMs) &&
        copiedAtMs >= currentMs - 30 * DAY_MS &&
        copiedAtMs <= currentMs
      );
    }

    return EXACT_DATE_PATTERN.test(filter) && toUtcDate(copiedAtMs) === filter;
  });
}

function toUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function scoreItem(item: PasteItem, terms: readonly string[]): number | null {
  let total = 0;

  for (const term of terms) {
    const score = highestFieldScore(item, term);
    if (score === 0) {
      return null;
    }
    total += score;
  }

  return total;
}

function highestFieldScore(item: PasteItem, term: string): number {
  const weightedFields: ReadonlyArray<readonly [number, readonly string[]]> = [
    [8, presentFields(item.title)],
    [6, presentFields(item.payload.text, item.payload.html)],
    [5, presentFields(item.ocrText)],
    [4, presentFields(item.sourceApp?.name, item.sourceApp?.bundleId)],
    [3, item.payload.filePaths ?? []],
    [2, presentFields(item.sourceDeviceId, item.payload.mediaType)],
  ];

  for (const [score, fields] of weightedFields) {
    if (fields.some((field) => includesIgnoreCase(field, term))) {
      return score;
    }
  }

  return 0;
}

function presentFields(...fields: Array<string | undefined>): string[] {
  return fields.filter((field): field is string => field !== undefined);
}
