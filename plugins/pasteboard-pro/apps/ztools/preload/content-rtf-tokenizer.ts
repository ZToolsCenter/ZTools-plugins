export const MAX_RTF_PRIVACY_BYTES_V2 = 10 * 1024 * 1024;
export const MAX_RTF_GROUP_DEPTH_V2 = 128;
export const MAX_RTF_GROUPS_V2 = 20_000;
export const MAX_RTF_TOKENS_V2 = 200_000;

export type RtfTokenV2 =
  | Readonly<{ kind: "group-open" | "group-close" }>
  | Readonly<{ kind: "control"; word: string; parameter?: number }>
  | Readonly<{ kind: "symbol"; symbol: string }>
  | Readonly<{ kind: "text"; bytes: Uint8Array }>
  | Readonly<{ kind: "hex"; byte: number }>
  | Readonly<{ kind: "binary"; bytes: Uint8Array }>;

type ParsedControlWord = Readonly<{
  word: string;
  parameter?: number;
  parameterDigits: number;
  negative: boolean;
}>;

const MAX_CONTROL_WORD_BYTES = 32;
const MAX_PARAMETER_DIGITS = 10;
const FIXED_ERROR = "rtf-projection-unavailable";

function unavailable(): never {
  throw new Error(FIXED_ERROR);
}

function isLetter(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
}

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function hexValue(byte: number): number | undefined {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return undefined;
}

function parseControlWord(bytes: Uint8Array, start: number): {
  parsed: ParsedControlWord;
  next: number;
} {
  let cursor = start;
  let word = "";
  while (cursor < bytes.byteLength && isLetter(bytes[cursor] ?? -1)) {
    if (word.length === MAX_CONTROL_WORD_BYTES) unavailable();
    word += String.fromCharCode(bytes[cursor]!);
    cursor += 1;
  }
  if (word.length === 0) unavailable();

  let negative = false;
  if (bytes[cursor] === 0x2d && isDigit(bytes[cursor + 1] ?? -1)) {
    negative = true;
    cursor += 1;
  }

  let parameter: number | undefined;
  let parameterDigits = 0;
  if (isDigit(bytes[cursor] ?? -1)) {
    let magnitude = 0;
    const maxMagnitude = negative ? 2_147_483_648 : 2_147_483_647;
    while (isDigit(bytes[cursor] ?? -1)) {
      if (parameterDigits === MAX_PARAMETER_DIGITS) unavailable();
      const digit = bytes[cursor]! - 0x30;
      if (magnitude > Math.floor((maxMagnitude - digit) / 10)) unavailable();
      magnitude = magnitude * 10 + digit;
      parameterDigits += 1;
      cursor += 1;
    }
    parameter = negative ? -magnitude : magnitude;
  } else {
    negative = false;
  }

  if (bytes[cursor] === 0x20) cursor += 1;
  return {
    parsed: {
      word,
      ...(parameter === undefined ? {} : { parameter }),
      parameterDigits,
      negative,
    },
    next: cursor,
  };
}

function makeToken(kind: "group-open" | "group-close"): RtfTokenV2 {
  return Object.freeze({ kind });
}

function trailingWhitespace(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0b ||
    byte === 0x0c || byte === 0x0d || byte === 0x20;
}

/**
 * Tokenizes one bounded RTF 1 document. Text and binary tokens borrow slices
 * from the input; the caller must keep its owned bytes immutable during iteration.
 * No file, clipboard, decoder, renderer, or network APIs are used.
 */
export function* tokenizeRtfPrivacyV2(bytes: Uint8Array): Generator<RtfTokenV2> {
  try {
    if (!(bytes instanceof Uint8Array) ||
        bytes.byteLength < 7 ||
        bytes.byteLength > MAX_RTF_PRIVACY_BYTES_V2 ||
        bytes[0] !== 0x7b ||
        bytes[1] !== 0x5c) unavailable();

    const root = parseControlWord(bytes, 2);
    if (root.parsed.word !== "rtf" ||
        root.parsed.parameter !== 1 ||
        root.parsed.parameterDigits !== 1 ||
        root.parsed.negative) unavailable();

    let cursor = root.next;
    let depth = 1;
    let groups = 1;
    let tokens = 2;
    let rootClosed = false;

    yield makeToken("group-open");
    yield Object.freeze({ kind: "control", word: "rtf", parameter: 1 });

    while (cursor < bytes.byteLength) {
      const byte = bytes[cursor]!;
      if (rootClosed) {
        if (!trailingWhitespace(byte)) unavailable();
        cursor += 1;
        continue;
      }

      if (byte === 0x7b) {
        depth += 1;
        groups += 1;
        tokens += 1;
        if (depth > MAX_RTF_GROUP_DEPTH_V2 ||
            groups > MAX_RTF_GROUPS_V2 ||
            tokens > MAX_RTF_TOKENS_V2) unavailable();
        cursor += 1;
        yield makeToken("group-open");
        continue;
      }

      if (byte === 0x7d) {
        depth -= 1;
        tokens += 1;
        if (depth < 0 || tokens > MAX_RTF_TOKENS_V2) unavailable();
        cursor += 1;
        if (depth === 0) rootClosed = true;
        yield makeToken("group-close");
        continue;
      }

      if (byte === 0x0d || byte === 0x0a) {
        cursor += 1;
        continue;
      }

      if (byte === 0x00 ||
          (byte < 0x20 && byte !== 0x09) ||
          byte === 0x7f) unavailable();

      if (byte !== 0x5c) {
        const start = cursor;
        do {
          cursor += 1;
          if (cursor >= bytes.byteLength) break;
          const next = bytes[cursor]!;
          if (next === 0x7b || next === 0x7d || next === 0x5c ||
              next === 0x0d || next === 0x0a ||
              next === 0x00 ||
              (next < 0x20 && next !== 0x09) ||
              next === 0x7f) break;
        } while (true);
        tokens += 1;
        if (tokens > MAX_RTF_TOKENS_V2) unavailable();
        yield Object.freeze({ kind: "text", bytes: bytes.subarray(start, cursor) });
        continue;
      }

      cursor += 1;
      if (cursor >= bytes.byteLength) unavailable();
      const escaped = bytes[cursor]!;

      if (escaped === 0x27) {
        const high = hexValue(bytes[cursor + 1] ?? -1);
        const low = hexValue(bytes[cursor + 2] ?? -1);
        if (high === undefined || low === undefined) unavailable();
        cursor += 3;
        tokens += 1;
        if (tokens > MAX_RTF_TOKENS_V2) unavailable();
        yield Object.freeze({ kind: "hex", byte: high * 16 + low });
        continue;
      }

      if (isLetter(escaped)) {
        const result = parseControlWord(bytes, cursor);
        cursor = result.next;
        tokens += 1;
        if (tokens > MAX_RTF_TOKENS_V2) unavailable();
        yield Object.freeze({
          kind: "control",
          word: result.parsed.word,
          ...(result.parsed.parameter === undefined
            ? {}
            : { parameter: result.parsed.parameter }),
        });

        if (result.parsed.word === "bin") {
          const length = result.parsed.parameter;
          if (length === undefined ||
              result.parsed.negative ||
              length < 0 ||
              length > bytes.byteLength - cursor) unavailable();
          const binary = bytes.subarray(cursor, cursor + length);
          cursor += length;
          tokens += 1;
          if (tokens > MAX_RTF_TOKENS_V2) unavailable();
          yield Object.freeze({ kind: "binary", bytes: binary });
        }
        continue;
      }

      if (escaped === 0 || (escaped < 0x20 && escaped !== 0x09 && escaped !== 0x0d && escaped !== 0x0a)) unavailable();
      if (escaped === 0x0d || escaped === 0x0a) {
        cursor++;
        if (escaped === 0x0d && bytes[cursor] === 0x0a) cursor++;
        if (++tokens > MAX_RTF_TOKENS_V2) unavailable();
        yield Object.freeze({ kind: "symbol", symbol: "\n" });
        continue;
      }
      cursor += 1;
      tokens += 1;
      if (tokens > MAX_RTF_TOKENS_V2) unavailable();
      yield Object.freeze({
        kind: "symbol",
        symbol: String.fromCharCode(escaped),
      });
    }

    if (!rootClosed || depth !== 0) unavailable();
  } catch {
    unavailable();
  }
}
