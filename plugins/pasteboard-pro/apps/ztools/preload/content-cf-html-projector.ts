import { decodeHTML } from "entities";
import { projectHtmlPrivacyV2, type HtmlPrivacyProjectionV2 } from "./content-html-projector";

const MAX_CF_HTML_BYTES = 8 * 1024 * 1024;
const MAX_CF_HTML_HEADER_BYTES = 4096;
const MAX_CF_HTML_HEADER_LINES = 128;
const MAX_HEADER_PROJECTION_VALUES = 512;
const START_MARKER = "<!--StartFragment-->";
const END_MARKER = "<!--EndFragment-->";
const START_MARKER_BYTES = new TextEncoder().encode(START_MARKER);
const END_MARKER_BYTES = new TextEncoder().encode(END_MARKER);
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

type CfHtmlHeaderFieldV2 = Readonly<{ name: string; value: string }>;
type ParsedOffset = Readonly<{ value: number; minusOne: boolean }>;
type HeaderParse = Readonly<{
  fields: readonly CfHtmlHeaderFieldV2[];
  headerBytes: number;
  complete: boolean;
}>;
type ValueProjection = Readonly<{ values: readonly string[]; complete: boolean }>;

export type CfHtmlPrivacyProjectionV2 = Readonly<{
  valid: boolean;
  hasContext: boolean;
  headerBytes: number;
  rawHeader: string;
  header: readonly CfHtmlHeaderFieldV2[];
  contextHtml: string;
  fragment: string;
  headerValueProjections: readonly string[];
  sourceUrlProjections: readonly string[];
  headerProjectionComplete: boolean;
  htmlProjection: HtmlPrivacyProjectionV2;
  textComplete: boolean;
  linksComplete: boolean;
}>;

function incompleteHtmlProjection(): HtmlPrivacyProjectionV2 {
  return {
    decodedSource: "",
    textComplete: false,
    textValues: [],
    linksComplete: false,
    linkValues: [],
  };
}

function asciiString(bytes: Uint8Array, start: number, end: number): string | undefined {
  if (start < 0 || end < start || end > bytes.length) return undefined;
  let result = "";
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index];
    if (byte === undefined || byte > 0x7f) return undefined;
    result += String.fromCharCode(byte);
  }
  return result;
}

function readLine(bytes: Uint8Array, start: number): Readonly<{
  line: string;
  next: number;
  terminated: boolean;
  ascii: boolean;
}> {
  const limit = Math.min(bytes.length, MAX_CF_HTML_HEADER_BYTES);
  let cursor = start;
  while (cursor < limit && bytes[cursor] !== 0x0d && bytes[cursor] !== 0x0a) cursor += 1;
  const line = asciiString(bytes, start, cursor);
  let next = cursor;
  const terminated = cursor < limit;
  if (terminated && bytes[cursor] === 0x0d && cursor + 1 < limit && bytes[cursor + 1] === 0x0a) {
    next += 2;
  } else if (terminated) {
    next += 1;
  }
  return { line: line ?? "", next, terminated, ascii: line !== undefined };
}

function parseHeaderField(line: string): CfHtmlHeaderFieldV2 | undefined {
  const colon = line.indexOf(":");
  if (colon < 0) return undefined;
  const name = line.slice(0, colon);
  if (!HEADER_NAME.test(name)) return undefined;
  const value = line.slice(colon + 1);
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code !== 0x09 && (code < 0x20 || code > 0x7e)) return undefined;
  }
  return { name, value };
}

function parseHeader(bytes: Uint8Array): HeaderParse {
  const fields: CfHtmlHeaderFieldV2[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  let lineCount = 0;
  let headerBytes = 0;
  while (true) {
    if (cursor > MAX_CF_HTML_HEADER_BYTES || lineCount > MAX_CF_HTML_HEADER_LINES) {
      return { fields, headerBytes, complete: false };
    }
    if (cursor === bytes.length || cursor === MAX_CF_HTML_HEADER_BYTES) {
      headerBytes = cursor;
      break;
    }
    const line = readLine(bytes, cursor);
    lineCount += 1;
    if (line.line.length === 0 && line.ascii) {
      if (fields.length === 0 || !line.terminated || lineCount > MAX_CF_HTML_HEADER_LINES) {
        return { fields, headerBytes: cursor, complete: false };
      }
      headerBytes = line.next;
      break;
    }
    if (!line.ascii) {
      if (fields.length === 0) return { fields, headerBytes: cursor, complete: false };
      headerBytes = cursor;
      break;
    }
    const field = parseHeaderField(line.line);
    if (field === undefined) {
      if (fields.length === 0) return { fields, headerBytes: cursor, complete: false };
      headerBytes = cursor;
      break;
    }
    if (!line.terminated || line.next > MAX_CF_HTML_HEADER_BYTES || fields.length >= MAX_CF_HTML_HEADER_LINES) {
      return { fields: [...fields, field], headerBytes: line.next, complete: false };
    }
    const normalizedName = field.name.toLowerCase();
    const duplicate = seen.has(normalizedName);
    seen.add(normalizedName);
    fields.push(field);
    if (duplicate || (fields.length === 1 && normalizedName !== "version") ||
        (fields.length > 1 && normalizedName === "version")) {
      return { fields, headerBytes: line.next, complete: false };
    }
    cursor = line.next;
    headerBytes = cursor;
  }

  const version = fields[0]?.value.trim();
  return {
    fields,
    headerBytes,
    complete: fields.length > 0 && (version === "0.9" || version === "1.0") &&
      headerBytes <= MAX_CF_HTML_HEADER_BYTES,
  };
}

function trimHorizontal(value: string): string {
  return value.replace(/^[ \t]+|[ \t]+$/g, "");
}

function parseOffset(fields: readonly CfHtmlHeaderFieldV2[], name: string, required = true): ParsedOffset | undefined {
  const field = fields.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (field === undefined) return required ? undefined : { value: 0, minusOne: false };
  const value = trimHorizontal(field.value);
  if (value === "-1") return { value: 0, minusOne: true };
  if (!/^[0-9]+$/.test(value)) return undefined;
  let parsed = 0;
  for (const digit of value) {
    parsed = parsed * 10 + digit.charCodeAt(0) - 0x30;
    if (!Number.isSafeInteger(parsed)) return undefined;
  }
  return { value: parsed, minusOne: false };
}

function countMarker(bytes: Uint8Array, begin: number, end: number, marker: Uint8Array): number {
  if (begin < 0 || end < begin || end > bytes.length || marker.length > end - begin) return 0;
  let count = 0;
  for (let offset = begin; offset <= end - marker.length; offset += 1) {
    let matches = true;
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[offset + index] !== marker[index]) {
        matches = false;
        break;
      }
    }
    if (matches) count += 1;
  }
  return count;
}

function markerAt(bytes: Uint8Array, offset: number, marker: Uint8Array): boolean {
  if (offset < 0 || offset > bytes.length || marker.length > bytes.length - offset) return false;
  for (let index = 0; index < marker.length; index += 1) {
    if (bytes[offset + index] !== marker[index]) return false;
  }
  return true;
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset > bytes.length || offset === bytes.length) return offset === bytes.length;
  const byte = bytes[offset];
  return byte !== undefined && (byte & 0xc0) !== 0x80;
}

function validUtf8Region(bytes: Uint8Array, start: number, end: number): boolean {
  if (start < 0 || end < start || end > bytes.length) return false;
  let cursor = start;
  while (cursor < end) {
    const first = bytes[cursor++];
    if (first === undefined) return false;
    if (first <= 0x7f) continue;
    let codePoint = 0;
    let continuationCount = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      continuationCount = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      continuationCount = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      continuationCount = 3;
    } else return false;
    if (continuationCount > end - cursor) return false;
    for (let index = 0; index < continuationCount; index += 1) {
      const next = bytes[cursor++];
      if (next === undefined || (next & 0xc0) !== 0x80) return false;
      if (index === 0 && first === 0xe0 && next < 0xa0) return false;
      if (index === 0 && first === 0xed && next >= 0xa0) return false;
      if (index === 0 && first === 0xf0 && next < 0x90) return false;
      if (index === 0 && first === 0xf4 && next > 0x8f) return false;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return false;
  }
  return true;
}

function utf8String(bytes: Uint8Array, start: number, end: number): string | undefined {
  if (!validUtf8Region(bytes, start, end)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end));
  } catch {
    return undefined;
  }
}

function isTailWhitespace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

function hasPercentEscape(value: string): boolean {
  for (let index = 0; index + 2 < value.length; index += 1) {
    if (value[index] === "%" && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) return true;
  }
  return false;
}

function decodePercentLayer(value: string): Readonly<{ value?: string; complete: boolean }> {
  if (!value.includes("%")) return { value, complete: true };
  if (!hasPercentEscape(value)) return { complete: false };
  try {
    return { value: decodeURIComponent(value), complete: true };
  } catch {
    return { complete: false };
  }
}

function projectHeaderValue(value: string): ValueProjection {
  const values: string[] = [value];
  const seen = new Set(values);
  let complete = true;
  let frontier = [value];
  for (let depth = 0; depth < 2; depth += 1) {
    const next: string[] = [];
    for (const candidate of frontier) {
      const entityValue = decodeHTML(candidate);
      if (entityValue !== candidate && !seen.has(entityValue)) {
        seen.add(entityValue);
        values.push(entityValue);
        next.push(entityValue);
      }
      const percent = decodePercentLayer(candidate);
      if (!percent.complete) complete = false;
      if (percent.value !== undefined && percent.value !== candidate && !seen.has(percent.value)) {
        seen.add(percent.value);
        values.push(percent.value);
        next.push(percent.value);
      }
      if (values.length > MAX_HEADER_PROJECTION_VALUES) {
        return { values: values.slice(0, MAX_HEADER_PROJECTION_VALUES), complete: false };
      }
    }
    frontier = next;
  }
  for (const candidate of frontier) {
    const stillEncoded = decodeHTML(candidate) !== candidate || hasPercentEscape(candidate);
    if (stillEncoded) complete = false;
  }
  return { values, complete };
}

function getField(fields: readonly CfHtmlHeaderFieldV2[], name: string): CfHtmlHeaderFieldV2 | undefined {
  return fields.find((field) => field.name.toLowerCase() === name.toLowerCase());
}

export function projectCfHtmlPrivacyV2(bytes: Uint8Array): CfHtmlPrivacyProjectionV2 {
  const parsedHeader = bytes.byteLength <= MAX_CF_HTML_BYTES ? parseHeader(bytes) : {
    fields: [] as readonly CfHtmlHeaderFieldV2[],
    headerBytes: 0,
    complete: false,
  };
  const headerBytes = parsedHeader.headerBytes;
  const rawHeader = new TextDecoder("utf-8").decode(bytes.subarray(0, headerBytes));
  const headerValueProjections: string[] = [];
  const sourceUrlProjections: string[] = [];
  let headerProjectionComplete = parsedHeader.complete;
  const rawHeaderProjection = projectHeaderValue(rawHeader);
  headerValueProjections.push(...rawHeaderProjection.values);
  headerProjectionComplete = headerProjectionComplete && rawHeaderProjection.complete;
  for (const field of parsedHeader.fields) {
    const projection = projectHeaderValue(field.value);
    headerValueProjections.push(...projection.values);
    headerProjectionComplete = headerProjectionComplete && projection.complete;
    if (field.name.toLowerCase() === "sourceurl") sourceUrlProjections.push(...projection.values);
  }

  const empty = (valid = false, hasContext = false, fragment = "", contextHtml = ""): CfHtmlPrivacyProjectionV2 => ({
    valid,
    hasContext,
    headerBytes,
    rawHeader,
    header: parsedHeader.fields,
    contextHtml,
    fragment,
    headerValueProjections,
    sourceUrlProjections,
    headerProjectionComplete,
    htmlProjection: incompleteHtmlProjection(),
    textComplete: false,
    linksComplete: false,
  });
  if (!parsedHeader.complete || bytes.byteLength === 0 || bytes.byteLength > MAX_CF_HTML_BYTES) return empty();

  const startHtml = parseOffset(parsedHeader.fields, "StartHTML");
  const endHtml = parseOffset(parsedHeader.fields, "EndHTML");
  const startFragment = parseOffset(parsedHeader.fields, "StartFragment");
  const endFragment = parseOffset(parsedHeader.fields, "EndFragment");
  const startSelection = parseOffset(parsedHeader.fields, "StartSelection", false);
  const endSelection = parseOffset(parsedHeader.fields, "EndSelection", false);
  if (startHtml === undefined || endHtml === undefined || startFragment === undefined ||
      endFragment === undefined || startSelection === undefined || endSelection === undefined) return empty();

  const hasContext = !startHtml.minusOne && !endHtml.minusOne;
  if (startHtml.minusOne !== endHtml.minusOne || startFragment.minusOne || endFragment.minusOne ||
      startFragment.value > endFragment.value) return empty();
  const hasStartSelection = getField(parsedHeader.fields, "StartSelection") !== undefined;
  const hasEndSelection = getField(parsedHeader.fields, "EndSelection") !== undefined;
  if (hasStartSelection !== hasEndSelection || (hasStartSelection &&
      (startSelection.minusOne || endSelection.minusOne || startSelection.value < startFragment.value ||
       startSelection.value > endSelection.value || endSelection.value > endFragment.value))) return empty(false, hasContext);

  let payloadEnd = 0;
  let hasMarkers = false;
  if (hasContext) {
    if (startHtml.value !== headerBytes || startHtml.value >= endHtml.value || endHtml.value > bytes.length ||
        startFragment.value < startHtml.value || endFragment.value > endHtml.value ||
        startFragment.value < START_MARKER_BYTES.length || endFragment.value > endHtml.value - END_MARKER_BYTES.length ||
        !markerAt(bytes, startFragment.value - START_MARKER_BYTES.length, START_MARKER_BYTES) ||
        !markerAt(bytes, endFragment.value, END_MARKER_BYTES) ||
        countMarker(bytes, startHtml.value, endHtml.value, START_MARKER_BYTES) !== 1 ||
        countMarker(bytes, startHtml.value, endHtml.value, END_MARKER_BYTES) !== 1) return empty(false, true);
    hasMarkers = true;
    payloadEnd = endHtml.value;
  } else {
    if (startFragment.value < headerBytes || endFragment.value > bytes.length) return empty(false, false);
    const startCount = countMarker(bytes, headerBytes, bytes.length, START_MARKER_BYTES);
    const endCount = countMarker(bytes, headerBytes, bytes.length, END_MARKER_BYTES);
    if (startCount !== 0 || endCount !== 0) {
      if (startCount !== 1 || endCount !== 1 || startFragment.value < START_MARKER_BYTES.length ||
          startFragment.value - START_MARKER_BYTES.length !== headerBytes ||
          !markerAt(bytes, startFragment.value - START_MARKER_BYTES.length, START_MARKER_BYTES) ||
          !markerAt(bytes, endFragment.value, END_MARKER_BYTES) ||
          endFragment.value > bytes.length - END_MARKER_BYTES.length) return empty(false, false);
      hasMarkers = true;
      payloadEnd = endFragment.value + END_MARKER_BYTES.length;
    } else {
      if (startFragment.value !== headerBytes) return empty(false, false);
      payloadEnd = endFragment.value;
    }
  }

  if (payloadEnd > bytes.length) return empty(false, hasContext);
  for (let index = payloadEnd; index < bytes.length; index += 1) {
    if (!isTailWhitespace(bytes[index] ?? -1)) return empty(false, hasContext);
  }
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) return empty(false, hasContext);
  }
  const htmlStart = hasContext ? startHtml.value : startFragment.value;
  const htmlEnd = hasContext ? endHtml.value : endFragment.value;
  const fragment = utf8String(bytes, startFragment.value, endFragment.value);
  const contextHtml = utf8String(bytes, htmlStart, htmlEnd);
  const whole = validUtf8Region(bytes, 0, bytes.length);
  const selectionValid = !hasStartSelection ||
    (isUtf8Boundary(bytes, startSelection.value) && isUtf8Boundary(bytes, endSelection.value) &&
      validUtf8Region(bytes, startSelection.value, endSelection.value));
  const boundariesValid = whole && asciiString(bytes, 0, headerBytes) !== undefined &&
    validUtf8Region(bytes, 0, headerBytes) && validUtf8Region(bytes, htmlStart, htmlEnd) &&
    validUtf8Region(bytes, startFragment.value, endFragment.value) && selectionValid;
  if (!boundariesValid || fragment === undefined || contextHtml === undefined) return empty(false, hasContext);

  const htmlByteLength = htmlEnd - htmlStart;
  const htmlProjection = projectHtmlPrivacyV2(contextHtml, htmlByteLength);
  const textComplete = headerProjectionComplete && htmlProjection.textComplete;
  const linksComplete = headerProjectionComplete && htmlProjection.linksComplete;
  return {
    valid: true,
    hasContext,
    headerBytes,
    rawHeader,
    header: parsedHeader.fields,
    contextHtml,
    fragment,
    headerValueProjections,
    sourceUrlProjections,
    headerProjectionComplete,
    htmlProjection,
    textComplete,
    linksComplete,
  };
}
