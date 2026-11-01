const MAX_RTF_TEXT_BYTES_V2 = 10 * 1024 * 1024;

const CODE_PAGE_LABELS_V2 = new Map<number, string>([
  [1250, "windows-1250"],
  [1251, "windows-1251"],
  [1252, "windows-1252"],
  [1253, "windows-1253"],
  [1254, "windows-1254"],
  [1255, "windows-1255"],
  [1256, "windows-1256"],
  [1257, "windows-1257"],
  [1258, "windows-1258"],
  [874, "windows-874"],
  [932, "shift_jis"],
  [936, "gbk"],
  [949, "euc-kr"],
  [950, "big5"],
  [10000, "macintosh"],
  [65001, "utf-8"],
]);

const FONT_CHARSET_CODE_PAGES_V2 = new Map<number, number>([
  [0, 1252],
  [77, 10000],
  [128, 932],
  [129, 949],
  [130, 1361],
  [134, 936],
  [136, 950],
  [161, 1253],
  [162, 1254],
  [163, 1258],
  [177, 1255],
  [178, 1256],
  [186, 1257],
  [204, 1251],
  [222, 874],
  [238, 1250],
]);

export function rtfCodePageForCharsetV2(charset: number): number | undefined {
  if (!Number.isInteger(charset) || charset < 0 || charset > 255 || charset === 1) {
    return undefined;
  }
  return FONT_CHARSET_CODE_PAGES_V2.get(charset);
}

function containsUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (index + 1 >= text.length || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function decodeRtfBytesV2(
  bytes: Uint8Array,
  codePage: number,
): string | undefined {
  if (
    !(bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(codePage) ||
    bytes.byteLength > MAX_RTF_TEXT_BYTES_V2
  ) return undefined;

  const label = CODE_PAGE_LABELS_V2.get(codePage);
  if (label === undefined) return undefined;

  let decoded: string;
  try {
    decoded = new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }

  if (
    decoded.includes("\u0000") ||
    decoded.includes("\ufffd") ||
    containsUnpairedSurrogate(decoded)
  ) return undefined;
  return decoded;
}
