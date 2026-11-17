import type { ArtifactField, ArtifactSpec } from "./artifactSpec";
import {
  addIssue,
  collectMatches,
  contentSegmentEnd,
  field,
  listSegmentEnd,
  parseSeparatedValues,
  quotedValue,
  trimRange,
  type MatchSpan
} from "./artifactInstructionEvidence";

export interface ParsedStructuredFields {
  columns?: ArtifactField<string>[];
  rows?: ArtifactField<string>[][];
  equation?: ArtifactField<string>;
  display?: boolean;
  items?: ArtifactField<string>[];
  ordered?: boolean;
  count?: ArtifactField<number>;
  graph?: Extract<ArtifactSpec, { kind: "mermaid" }>["graph"];
  graphDirection?: ArtifactField<"LR" | "TD">;
}

const CHINESE_NUMBERS = new Map([["零", 0], ["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10]]);
const ENGLISH_NUMBERS = new Map([["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10]]);
const COLUMN_ROLE_BOUNDARY = /^(?:列出|列举|展示|说明|行数据|数据行|list\b|rows?\b|保留|保持|保护|确保|必须|不得|不能|不可|禁止|避免|需要|并(?:且)?(?:保留|保持|确保)?|且(?:需|要|应)?|(?:金额|价格|单位|商品|数量|数值|数据|原文)(?:与|和|及)?(?:保留|保持|保护|确保|相同|同一|一致)|preserve\b|keep(?:ing)?\b|retain\b|ensure\b|must(?:\s+not)?\b|should\b|cannot\b|avoid\b|never\b|do\s+not\b|while\b|with\b|(?:the\s+)?same\s+(?:amounts?|values?|units?)\b)/iu;

function declaredTableWidth(masked: string, issues: string[]): number | undefined {
  const count = "(?:\\d{1,2}|零|一|二|两|三|四|五|六|七|八|九|十|one|two|three|four|five|six|seven|eight|nine|ten)";
  const patterns = [
    new RegExp(`(?<width>${count})\\s*列\\s*(?:Markdown\\s*)?表格`, "giu"),
    new RegExp(`(?<width>${count})[-\\s]+columns?\\s+(?:Markdown\\s+)?tables?`, "giu"),
    new RegExp(`\\btable\\s+with\\s+(?<width>${count})\\s+columns?\\b`, "giu")
  ];
  const widths = patterns.flatMap(pattern => [...masked.matchAll(pattern)].map(match => {
    const raw = match.groups?.width?.toLocaleLowerCase();
    return raw === undefined ? undefined : (/^\d+$/u.test(raw) ? Number(raw) : CHINESE_NUMBERS.get(raw) ?? ENGLISH_NUMBERS.get(raw));
  })).filter((value): value is number => value !== undefined);
  const unique = [...new Set(widths)];
  if (unique.length > 1) {
    addIssue(issues, "conflicting_table_columns");
    return undefined;
  }
  return unique[0];
}

function columnListBoundary(source: string, from: number, to: number, declaredWidth?: number): number | undefined {
  for (let index = from; index < to; index += 1) {
    const quoted = quotedValue(source, index, to);
    if (quoted) { index = quoted.to - 1; continue; }
    if (source[index] !== "," && source[index] !== "，") continue;
    let next = index + 1;
    while (next < to && /\s/u.test(source[next])) next += 1;
    if (!COLUMN_ROLE_BOUNDARY.test(source.slice(next, to))) continue;
    if (declaredWidth !== undefined && parseSeparatedValues(source, from, index, /[,，、|;]/u).length !== declaredWidth) continue;
    return index;
  }
  return undefined;
}

function markerMatches(source: string, pattern: RegExp): MatchSpan[] {
  return collectMatches(source, pattern, "");
}

function extractTable(source: string, masked: string, issues: string[]): Pick<ParsedStructuredFields, "columns" | "rows"> {
  const columnMarker = /(?:列名|表头|\bheaders?\b|\bcolumns?\b)(?:\s*(?:必须\s*)?(?:为|是|[:：=]))?/giu;
  const columnMatches = [...masked.matchAll(columnMarker)];
  if (columnMatches.length > 1) {
    addIssue(issues, "conflicting_table_columns");
    return {};
  }
  const columnMatch = columnMatches[0];
  const declaredWidth = declaredTableWidth(masked, issues);
  if (issues.length) return {};
  let columns: MatchSpan[] | undefined;
  if (columnMatch) {
    let from = (columnMatch.index ?? 0) + columnMatch[0].length;
    while (from < source.length && /\s/u.test(source[from])) from += 1;
    const end = listSegmentEnd(source, from);
    const explicitEnd = source.slice(from, end).search(/[;；\n]/u);
    let to = explicitEnd < 0 ? end : from + explicitEnd;
    const nextSection = columnListBoundary(source, from, to, declaredWidth);
    if (nextSection !== undefined) to = nextSection;
    columns = parseSeparatedValues(source, from, to, /[,，、|;]/u);
    if (!columns.length) addIssue(issues, "incomplete_table_columns");
    else if (declaredWidth !== undefined && columns.length !== declaredWidth) {
      addIssue(issues, "table_column_count_mismatch");
      return {};
    }
  }

  const rowMarker = /(?:行数据|数据行|\brows?\b|\bdata\s+rows?\b)(?:\s*(?:为|是|[:：=]))?/giu;
  const rowMatches = [...masked.matchAll(rowMarker)];
  if (rowMatches.length > 1) {
    addIssue(issues, "ambiguous_table_rows");
    return { ...(columns ? { columns: asFields(source, columns) } : {}) };
  }
  const rowMatch = rowMatches[0];
  if (!rowMatch) return { ...(columns ? { columns: asFields(source, columns) } : {}) };
  const requiredWidth = columns?.length;
  if (!requiredWidth) {
    addIssue(issues, "incomplete_table_columns");
    return {};
  }

  let start = (rowMatch.index ?? 0) + rowMatch[0].length;
  while (start < source.length && /\s/u.test(source[start])) start += 1;
  const end = contentSegmentEnd(source, start, listSegmentEnd(source, start));
  const rowSegments: Array<[number, number]> = [];
  let segmentStart = start;
  for (let index = start; index <= end; index += 1) {
    if (index === end || /[,，、;]/u.test(source[index])) {
      const [from, to] = trimRange(source, segmentStart, index);
      if (from < to) rowSegments.push([from, to]);
      segmentStart = index + 1;
    }
  }

  const rows: ArtifactField<string>[][] = [];
  for (const [from, to] of rowSegments) {
    const cells = parseSeparatedValues(source, from, to, /→|->|=>/u);
    if (cells.length !== requiredWidth) {
      addIssue(issues, "incomplete_table_rows");
      return { ...(columns ? { columns: asFields(source, columns) } : {}) };
    }
    rows.push(cells.map(cell => field(source, cell.from, cell.to, cell.value)));
  }
  if (!rows.length) addIssue(issues, "incomplete_table_rows");
  return { ...(columns ? { columns: asFields(source, columns) } : {}), ...(rows.length ? { rows } : {}) };
}

function asFields(source: string, values: MatchSpan[]): ArtifactField<string>[] {
  return values.map(item => field(source, item.from, item.to, item.value));
}

function extractGraphDirection(source: string, masked: string, issues: string[]): ArtifactField<"LR" | "TD"> | undefined {
  const matches = [...masked.matchAll(/\b(?:mermaid\s+)?(?:graph|flowchart)\s+(TD|LR)\b/giu)];
  const directions = [...new Set(matches.map(match => match[1].toUpperCase() as "LR" | "TD"))];
  if (directions.length > 1) {
    addIssue(issues, "conflicting_mermaid_directions");
    return undefined;
  }
  const direction = directions[0];
  if (!direction) return undefined;
  return {
    value: direction,
    evidence: matches.map(match => {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      return { from, to, raw: source.slice(from, to) };
    })
  };
}

function extractMath(source: string, masked: string): Pick<ParsedStructuredFields, "equation" | "display"> {
  const display = /显示公式|显示数学|display\s+(?:math|equation|formula)|\$\$/iu.test(masked);
  const markers = [
    ...markerMatches(masked, /(?:公式|equation|formula)\s*(?:为|是|[:：=])/giu),
    ...markerMatches(masked, /(?:表达|表示)\s*[^:：。！？\n]{0,32}[:：]/giu),
    ...markerMatches(masked, /(?:明确)?(?:写出|给出|输出)\s+/giu),
    ...markerMatches(masked, /(?:明确)?(?:写出|给出|输出)\s*(?:(?:一个|该|此)\s*)?(?:显示\s*)?(?:公式|表达式)\s*(?:为|是|[:：=])?\s*/giu)
  ].sort((left, right) => left.from - right.from || right.to - left.to);
  const marker = markers.at(-1);
  if (!marker) return { display };
  let start = marker.to;
  while (start < source.length && /\s/u.test(source[start])) start += 1;
  const quoted = quotedValue(source, start, source.length);
  if (quoted) return { equation: field(source, quoted.from, quoted.to, quoted.value), display };
  const end = contentSegmentEnd(source, start, listSegmentEnd(source, start));
  const value = source.slice(start, end).trimEnd();
  const valueEnd = start + value.length;
  if (start >= valueEnd || (/\p{L}{8,}/u.test(value) && !/[=+\-*/^_\\{}()[\]$]/u.test(value))) return { display };
  return { equation: field(source, start, valueEnd, value), display };
}

function chineseNumber(value: string): number | undefined {
  if (/^\d+$/u.test(value)) return Number(value);
  return CHINESE_NUMBERS.get(value);
}

function extractList(source: string, masked: string, issues: string[]): Pick<ParsedStructuredFields, "items" | "count" | "ordered"> {
  const marker = /(?:有序|无序|项目|图标)?清单|列表|\bbullet\s+list\b|\bordered\s+list\b|\bunordered\s+list\b/giu;
  const list = [...masked.matchAll(marker)].at(-1);
  const ordered = /有序(?:清单|列表)|ordered\s+list|numbered\s+list/iu.test(masked);
  const countPattern = /([0-9]+|[零一二三四五六七八九十])\s*(?:个|项|条)?(?=[^。！？;；\n]{0,20}(?:状态|图标|项目)?(?:清单|列表|items?\b|entries\b))/giu;
  const countMatch = [...masked.matchAll(countPattern)].at(-1);
  const count = countMatch
    ? field(source, countMatch.index ?? 0, (countMatch.index ?? 0) + countMatch[1].length, chineseNumber(countMatch[1])!)
    : undefined;
  if (!list) return { ...(count ? { count } : {}), ordered };
  const markerTo = (list.index ?? 0) + list[0].length;
  const delimiter = /^\s*(?:[:：]|(?:内容|项目|条目)?\s*(?:为|是|包括|如下))\s*/iu.exec(masked.slice(markerTo));
  if (!delimiter) return { ...(count ? { count } : {}), ordered };
  const start = markerTo + delimiter[0].length;
  const end = contentSegmentEnd(source, start, listSegmentEnd(source, start));
  const items = parseSeparatedValues(source, start, end, /[,，、;；]/u);
  if (!items.length) addIssue(issues, "incomplete_list_items");
  if (count && items.length && count.value !== items.length) addIssue(issues, "list_item_count_mismatch");
  return {
    ...(items.length ? { items: asFields(source, items) } : {}),
    ...(count ? { count } : {}),
    ordered
  };
}

function extractMermaid(source: string, masked: string): ParsedStructuredFields["graph"] {
  const markers = [
    ...markerMatches(masked, /按顺序表示/giu),
    ...markerMatches(masked, /(?:流程|节点关系)(?:为|是|[:：])/giu),
    ...markerMatches(masked, /\b(?:mermaid\s+)?(?:flowchart|diagram)\s*[:：]/giu)
  ].sort((left, right) => left.from - right.from);
  const marker = markers.at(-1);
  const artifactMarker = marker ? undefined : [...masked.matchAll(/\bmermaid\b(?:\s*(?:flowchart|diagram))?|流程图|架构图/giu)].at(-1);
  if (!marker && !artifactMarker) return undefined;
  let start = marker
    ? marker.to
    : (artifactMarker?.index ?? 0) + artifactMarker![0].length;
  while (start < source.length && /\s/u.test(source[start])) start += 1;
  const end = listSegmentEnd(source, start);
  let chainEnd = end;
  const comma = /[,，]/u.exec(source.slice(start, end));
  if (comma) chainEnd = start + comma.index;
  const separators = [...source.slice(start, chainEnd).matchAll(/(?:→|->|=>)/gu)];
  if (!separators.length) return undefined;
  const nodes: ArtifactField<string>[] = [];
  let cursor = start;
  for (const separator of separators) {
    const arrowFrom = start + (separator.index ?? 0);
    const [from, to] = trimRange(source, cursor, arrowFrom);
    if (from >= to) return undefined;
    nodes.push(field(source, from, to, source.slice(from, to)));
    cursor = arrowFrom + separator[0].length;
  }
  const [lastFrom, lastTo] = trimRange(source, cursor, chainEnd);
  if (lastFrom >= lastTo) return undefined;
  nodes.push(field(source, lastFrom, lastTo, source.slice(lastFrom, lastTo)));
  // A directly stated arrow sequence already fixes a left-to-right chain.
  // This is a display layout for a complete graph, not a grounded direction field.
  const direction = extractGraphDirection(source, masked, [])?.value ?? "LR";
  return { direction, nodes, edges: nodes.slice(1).map((_, index) => ({ from: index, to: index + 1 })) };
}

export function parseStructuredArtifactFields(
  source: string,
  masked: string,
  kind: ArtifactSpec["kind"],
  issues: string[]
): ParsedStructuredFields {
  if (kind === "table") return extractTable(source, masked, issues);
  if (kind === "math") return extractMath(source, masked);
  if (kind === "list") return extractList(source, masked, issues);
  if (kind === "mermaid") return {
    graph: extractMermaid(source, masked),
    graphDirection: extractGraphDirection(source, masked, issues)
  };
  return {};
}
