import type { ArtifactField } from "./artifactSpec";
import { parseArtifactJsonPayload } from "./artifactJsonPayload";

const MAX_SOURCE_BYTES = 32_768;
const MAX_DEPTH = 32;
const MAX_NODES = 4_096;
const MAX_ROOT_FIELDS = 32;
const encoder = new TextEncoder();
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SEPARATORS = new Set([",", "，", "、", "和", "及", "&", ";", "；"]);
const NUMBER_WORDS = new Map([["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10]]);
const SOURCE_DERIVED_BARE_VALUE = /^(?:当前(?:文档|文章|文件|选区|段落|行|负责人|日期|用户|时间)?|原文|来源|文档(?:中|里的|内|负责人|数据)|(?:自动(?:生成|计算|获取|确定|选择|填充|提供|填写)?|随机(?:生成|抽取|选择)?|自行(?:拟定|填写|确定|生成|选择)?|由模型(?:生成|填写|提供)?|模型(?:生成|填写|推断|判断|确定|提供)?|根据|依据|按照|依照|从(?:当前|原文|文档|来源)|读取|提取|抽取|推导|推算|查询|获取)|(?:auto(?:matic(?:ally)?)?|random(?:ly)?|infer(?:red)?|derive|extract|fetch|retrieve|read|current(?:user|document|date|time|selection)?|source|document|model(?:generated)?)(?:[-_]|$))/iu;

function duplicateJsonObjectKey(source: string): boolean {
  const keysByObject: Array<Set<string>> = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (character === "{") { keysByObject.push(new Set()); index += 1; continue; }
    if (character === "}") { keysByObject.pop(); index += 1; continue; }
    if (character !== "\"") { index += 1; continue; }

    const start = index;
    let escaped = false;
    index += 1;
    while (index < source.length) {
      const next = source[index];
      index += 1;
      if (escaped) escaped = false;
      else if (next === "\\") escaped = true;
      else if (next === "\"") break;
    }
    const value: unknown = JSON.parse(source.slice(start, index));
    if (typeof value !== "string") continue;
    let colon = index;
    while (colon < source.length && /\s/u.test(source[colon])) colon += 1;
    if (source[colon] !== ":") continue;
    const keys = keysByObject.at(-1);
    if (!keys || keys.has(value)) return true;
    keys.add(value);
  }
  return false;
}

function assertSafeJsonObjectKeys(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (DANGEROUS_KEYS.has(key)) throw new Error("JSON literal has an unsafe object key.");
      pending.push(child);
    }
  }
}

/** Parses a bounded explicit JSON value without duplicate or prototype-sensitive object keys. */
export function parseExplicitJsonLiteral(source: string): unknown {
  const value = parseArtifactJsonPayload(source);
  if (duplicateJsonObjectKey(source)) throw new Error("JSON literal has duplicate object keys.");
  assertSafeJsonObjectKeys(value);
  return value;
}

interface Cursor {
  readonly source: string;
  readonly end: number;
  index: number;
  nodes: number;
}

interface ReadValue {
  readonly value: unknown;
  readonly end: number;
}

function skipWhitespace(source: string, index: number, end: number): number {
  while (index < end && /\s/u.test(source[index])) index += 1;
  return index;
}

function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

function readQuoted(source: string, start: number, end: number): ReadValue | undefined {
  const opening = source[start];
  const closing = opening === "“" ? "”" : opening === "‘" ? "’" : opening;
  if (!["\"", "'", "“", "‘"].includes(opening)) return undefined;

  let escaped = false;
  for (let index = start + 1; index < end; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character !== closing) continue;

    const raw = source.slice(start, index + 1);
    if (opening === "\"") {
      try {
        const value: unknown = JSON.parse(raw);
        return typeof value === "string" ? { value, end: index + 1 } : undefined;
      } catch { return undefined; }
    }
    const value = raw.slice(1, -1).replace(opening === "'" ? /\\([\\'])/gu : /\\([\\”’])/gu, "$1");
    return { value, end: index + 1 };
  }
  return undefined;
}

function readBareToken(source: string, start: number, end: number): ReadValue | undefined {
  const token = /^[\p{L}_$][\p{L}\p{N}_$.-]*/u.exec(source.slice(start, end));
  return token ? { value: token[0], end: start + token[0].length } : undefined;
}

function readKey(source: string, start: number, end: number): ReadValue | undefined {
  return readQuoted(source, start, end) ?? readBareToken(source, start, end);
}

function parseValue(cursor: Cursor, start: number, depth: number): ReadValue | undefined {
  if (depth > MAX_DEPTH || ++cursor.nodes > MAX_NODES) return undefined;
  const index = skipWhitespace(cursor.source, start, cursor.end);
  if (index >= cursor.end) return undefined;

  const quoted = readQuoted(cursor.source, index, cursor.end);
  if (quoted) return quoted;
  if (cursor.source[index] === "[") return parseArray(cursor, index, depth);
  if (cursor.source[index] === "{") return parseObject(cursor, index, depth);

  const tail = cursor.source.slice(index, cursor.end);
  const primitive = /^(?:true|false|null)(?![\p{L}\p{N}_$.-])/iu.exec(tail);
  if (primitive) {
    const raw = primitive[0].toLowerCase();
    return { value: raw === "true" ? true : raw === "false" ? false : null, end: index + primitive[0].length };
  }
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\p{L}\p{N}_$.-])/u.exec(tail);
  if (number) {
    const value = Number(number[0]);
    return Number.isFinite(value) ? { value, end: index + number[0].length } : undefined;
  }
  const bare = readBareToken(cursor.source, index, cursor.end);
  return bare && !SOURCE_DERIVED_BARE_VALUE.test(String(bare.value)) ? bare : undefined;
}

function parseArray(cursor: Cursor, start: number, depth: number): ReadValue | undefined {
  const values: unknown[] = [];
  let index = skipWhitespace(cursor.source, start + 1, cursor.end);
  if (cursor.source[index] === "]") return { value: values, end: index + 1 };

  while (index < cursor.end) {
    const item = parseValue(cursor, index, depth + 1);
    if (!item) return undefined;
    values.push(item.value);
    index = skipWhitespace(cursor.source, item.end, cursor.end);
    if (cursor.source[index] === "]") return { value: values, end: index + 1 };
    if (![",", "，", "、"].includes(cursor.source[index])) return undefined;
    index = skipWhitespace(cursor.source, index + 1, cursor.end);
    if (cursor.source[index] === "]") return undefined;
  }
  return undefined;
}

function parseObject(cursor: Cursor, start: number, depth: number): ReadValue | undefined {
  const object = Object.create(null) as Record<string, unknown>;
  let index = skipWhitespace(cursor.source, start + 1, cursor.end);
  if (cursor.source[index] === "}") return { value: object, end: index + 1 };

  while (index < cursor.end) {
    if (++cursor.nodes > MAX_NODES) return undefined;
    const keyField = readKey(cursor.source, index, cursor.end);
    if (!keyField || typeof keyField.value !== "string" || isDangerousKey(keyField.value) || Object.hasOwn(object, keyField.value)) return undefined;
    index = skipWhitespace(cursor.source, keyField.end, cursor.end);
    if (cursor.source[index] !== ":") return undefined;
    const value = parseValue(cursor, index + 1, depth + 1);
    if (!value) return undefined;
    object[keyField.value] = value.value;
    index = skipWhitespace(cursor.source, value.end, cursor.end);
    if (cursor.source[index] === "}") return { value: object, end: index + 1 };
    if (cursor.source[index] !== ",") return undefined;
    index = skipWhitespace(cursor.source, index + 1, cursor.end);
    if (cursor.source[index] === "}") return undefined;
  }
  return undefined;
}

function sentenceBoundary(source: string, start: number): number | undefined {
  let depth = 0;
  let quote = "";
  let escaped = false;
  const maximum = Math.min(source.length, start + MAX_SOURCE_BYTES);
  for (let index = start; index < maximum; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if (character === "“") { quote = "”"; continue; }
    if (character === "‘") { quote = "’"; continue; }
    if (character === "[" || character === "{") { depth += 1; continue; }
    if (character === "]" || character === "}") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && /[。！？\r\n]/u.test(character)) return index;
  }
  if (maximum < source.length) return undefined;
  return source.length;
}

function readPairConnector(source: string, start: number, end: number): number | undefined {
  const index = skipWhitespace(source, start, end);
  const connector = /^(?:为|是|=|:|is\b|equals\b)/iu.exec(source.slice(index, end));
  return connector ? index + connector[0].length : undefined;
}

function readListSeparator(source: string, start: number, end: number): number | undefined {
  const index = skipWhitespace(source, start, end);
  if (index >= end || !SEPARATORS.has(source[index])) return undefined;
  return index + 1;
}

function validClosedListSuffix(source: string, start: number, end: number, fieldCount: number): boolean {
  const tail = source.slice(start, end);
  const suffix = /^\s*(?:(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*(?:个|项)?\s*)?(?:字段|属性|键|fields?|keys?)?\s*[;；]?\s*$/iu.exec(tail);
  if (!suffix) return false;
  if (!suffix[1]) return true;
  const declared = /^\d+$/u.test(suffix[1]) ? Number(suffix[1]) : NUMBER_WORDS.get(suffix[1]);
  return declared === fieldCount;
}

/**
 * Reads a finite, explicitly closed list of JSON fields and literal values.
 * Dynamic or source-derived values and any text outside the closed list remain unresolved.
 */
export function parseExplicitJsonFieldPairs(source: string, masked: string): ArtifactField<unknown> | undefined {
  const markers = [...masked.matchAll(/(?:仅含|只含|仅包含|只包含|contain\s+only|only\s+contain)\s*/giu)];
  if (markers.length !== 1) return undefined;

  const marker = markers[0];
  const from = marker.index ?? 0;
  const start = from + marker[0].length;
  const end = sentenceBoundary(source, start);
  if (end === undefined || encoder.encode(source.slice(from, end)).byteLength > MAX_SOURCE_BYTES) return undefined;

  const cursor: Cursor = { source, end, index: start, nodes: 1 };
  const object = Object.create(null) as Record<string, unknown>;
  let fieldCount = 0;

  while (cursor.index < end) {
    cursor.index = skipWhitespace(source, cursor.index, end);
    if (++cursor.nodes > MAX_NODES) return undefined;
    const key = readKey(source, cursor.index, end);
    if (!key || typeof key.value !== "string" || isDangerousKey(key.value) || Object.hasOwn(object, key.value)) return undefined;
    const connectorEnd = readPairConnector(source, key.end, end);
    if (connectorEnd === undefined) return undefined;
    const value = parseValue(cursor, connectorEnd, 0);
    if (!value) return undefined;

    object[key.value] = value.value;
    fieldCount += 1;
    if (fieldCount > MAX_ROOT_FIELDS) return undefined;
    cursor.index = skipWhitespace(source, value.end, end);
    if (cursor.index >= end) break;
    const separatorEnd = readListSeparator(source, cursor.index, end);
    if (separatorEnd === undefined) break;
    cursor.index = separatorEnd;
    const next = skipWhitespace(source, cursor.index, end);
    if (next >= end) {
      if ([";", "；"].includes(source[separatorEnd - 1])) break;
      return undefined;
    }
  }

  if (fieldCount === 0 || !validClosedListSuffix(source, cursor.index, end, fieldCount)) return undefined;
  return { value: object, evidence: [{ from, to: end, raw: source.slice(from, end) }] };
}
