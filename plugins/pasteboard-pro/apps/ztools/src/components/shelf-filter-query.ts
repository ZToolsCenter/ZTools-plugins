import { parsePasteQuery } from "@pasteboard-pro/core";

export type ShelfFilterKind = "types" | "apps" | "dates";

export type ShelfFilterOption = Readonly<{
  label: string;
  values: readonly string[];
  matchValues?: readonly string[];
}>;

export const SHELF_TYPE_FILTERS: readonly ShelfFilterOption[] = [
  { label: "文本", values: ["text", "rich_text", "html"] },
  { label: "图片", values: ["image"] },
  { label: "链接", values: ["url"] },
  { label: "文件", values: ["files", "pdf"] },
  { label: "颜色", values: ["color"] },
];

const FILTER_KEYS: Readonly<Record<ShelfFilterKind, ReadonlySet<string>>> = {
  types: new Set(["type"]),
  apps: new Set(["app", "from"]),
  dates: new Set(["date"]),
};

/**
 * Replaces only one family of supported query clauses. Free text and other
 * parsePasteQuery filters (device, pinboard) stay byte-for-byte intact.
 */
export function setShelfQueryFilters(
  query: string,
  kind: ShelfFilterKind,
  values: readonly string[],
): string {
  const keep = splitQueryTokens(query).filter((token) => {
    const separator = token.indexOf(":");
    if (separator <= 0 || token.startsWith('"')) return true;
    return !FILTER_KEYS[kind].has(token.slice(0, separator).toLowerCase());
  });
  const additions = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .map((value) => filterKey(kind) + ":" + quoteFilterValue(value));
  return [...keep, ...additions].join(" ").trim();
}

export function selectedShelfQueryFilters(
  query: string,
  kind: ShelfFilterKind,
): readonly string[] {
  return parsePasteQuery(query)[kind];
}

export function isShelfFilterSelected(
  query: string,
  kind: ShelfFilterKind,
  option: ShelfFilterOption,
): boolean {
  if (option.values.length === 0) {
    return selectedShelfQueryFilters(query, kind).length === 0;
  }

  const active = selectedShelfQueryFilters(query, kind);
  const candidates = option.matchValues ?? option.values;
  return active.some((value) =>
    candidates.some((candidate) => queryValueMatches(value, candidate)),
  );
}

export function toggleShelfQueryFilter(
  query: string,
  kind: ShelfFilterKind,
  option: ShelfFilterOption,
): string {
  if (option.values.length === 0) {
    return setShelfQueryFilters(query, kind, []);
  }

  const active = [...selectedShelfQueryFilters(query, kind)];
  const candidates = option.matchValues ?? option.values;
  const matching = active.filter((value) =>
    candidates.some((candidate) => queryValueMatches(value, candidate)),
  );

  if (matching.length > 0) {
    const remaining = active.filter((value) => !matching.includes(value));
    return setShelfQueryFilters(query, kind, remaining);
  }

  return setShelfQueryFilters(query, kind, [...active, ...option.values]);
}

export function resetShelfQueryFilters(query: string): string {
  return setShelfQueryFilters(
    setShelfQueryFilters(setShelfQueryFilters(query, "types", []), "apps", []),
    "dates",
    [],
  );
}

export function activeShelfFilterGroups(query: string): number {
  const parsed = parsePasteQuery(query);
  return Number(parsed.types.length > 0) +
    Number(parsed.apps.length > 0) +
    Number(parsed.dates.length > 0);
}

function filterKey(kind: ShelfFilterKind): "type" | "app" | "date" {
  if (kind === "types") return "type";
  if (kind === "apps") return "app";
  return "date";
}

function quoteFilterValue(value: string): string {
  return /\s/.test(value) ? '"' + value + '"' : value;
}

function queryValueMatches(queryValue: string, candidate: string): boolean {
  const query = queryValue.toLocaleLowerCase();
  const value = candidate.toLocaleLowerCase();
  return value.includes(query) || query.includes(value);
}

/** Preserve quoted phrases and filter values that contain spaces. */
function splitQueryTokens(query: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;

  for (const character of query.trim()) {
    if (character === '"') quoted = !quoted;
    if (/\s/.test(character) && !quoted) {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }

  if (token.length > 0) tokens.push(token);
  return tokens;
}
