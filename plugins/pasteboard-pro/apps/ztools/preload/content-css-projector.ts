const MAX_CSS_URL_VALUES = 20_000;
const HEX_DIGITS = "0123456789abcdefABCDEF";

type CssMetadataProjection = Readonly<{ text: string; comments: string; complete: boolean }>;
type CssUrlProjection = Readonly<{ values: readonly string[]; complete: boolean }>;
export type CssPrivacyProjectionV2 = CssMetadataProjection & Readonly<{
  textComplete: boolean;
  linksComplete: boolean;
  urlValues: readonly string[];
}>;

function isHexDigit(value: string | undefined): boolean {
  return value !== undefined && HEX_DIGITS.includes(value);
}

function decodeCssMetadata(value: string): CssMetadataProjection {
  const text: string[] = [];
  const comments: string[] = [];
  let complete = true;
  let index = 0;
  while (index < value.length) {
    if (value[index] === "/" && value[index + 1] === "*") {
      const end = value.indexOf("*/", index + 2);
      if (end === -1) {
        comments.push(value.slice(index + 2));
        complete = false;
        break;
      }
      comments.push(value.slice(index + 2, end));
      index = end + 2;
      continue;
    }
    if (value[index] !== "\\") {
      text.push(value[index]!);
      index += 1;
      continue;
    }

    index += 1;
    if (index >= value.length) {
      complete = false;
      break;
    }
    const next = value[index]!;
    if (next === "\n" || next === "\f") {
      index += 1;
      continue;
    }
    if (next === "\r") {
      index += value[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    let end = index;
    while (end < value.length && end - index < 6 && isHexDigit(value[end])) end += 1;
    if (end > index) {
      const codePoint = Number.parseInt(value.slice(index, end), 16);
      text.push(String.fromCodePoint(codePoint === 0 || codePoint > 0x10ffff ? 0xfffd : codePoint));
      index = end;
      if (value[index] === " " || value[index] === "\t" || value[index] === "\n" || value[index] === "\r" || value[index] === "\f") {
        if (value[index] === "\r" && value[index + 1] === "\n") index += 2;
        else index += 1;
      }
      continue;
    }
    text.push(next);
    index += 1;
  }
  return { text: text.join(""), comments: comments.join(""), complete };
}

function countMatches(value: string, pattern: RegExp): number {
  let count = 0;
  for (const _match of value.matchAll(pattern)) count += 1;
  return count;
}

function projectCssUrls(css: string): CssUrlProjection {
  const values: string[] = [];
  let complete = true;
  const urlStarts = countMatches(css, /url\s*\(/giu);
  let urlMatches = 0;
  for (const match of css.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/giu)) {
    urlMatches += 1;
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value.includes("(") || value.includes(")") || values.length >= MAX_CSS_URL_VALUES) complete = false;
    else values.push(value);
  }
  if (urlStarts !== urlMatches) complete = false;

  const importStarts = countMatches(css, /@import\b/giu);
  let quotedImports = 0;
  for (const match of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/giu)) {
    quotedImports += 1;
    const value = (match[1] ?? match[2] ?? "").trim();
    if (values.length >= MAX_CSS_URL_VALUES) complete = false;
    else values.push(value);
  }
  const urlImports = countMatches(css, /@import\s+url\s*\(/giu);
  if (importStarts !== quotedImports + urlImports) complete = false;
  return { values, complete };
}

/** Static CSS metadata projection only; it does not evaluate styles or load URLs. */
export function projectCssPrivacyV2(raw: string): CssPrivacyProjectionV2 {
  const css = decodeCssMetadata(raw);
  const urls = projectCssUrls(css.text);
  return {
    ...css,
    textComplete: !/\b(?:content|attr)\s*\(/iu.test(css.text) && !/\bcontent\s*:/iu.test(css.text) && !/@import\b/iu.test(css.text) && !/(?:\burl|(?:-webkit-)?image-set)\s*\(/iu.test(css.text),
    linksComplete: urls.complete && !raw.includes("\\") && !raw.includes("/*") &&
      !/\b(?:var|env|attr|expression)\s*\(/iu.test(css.text) && !/--[\w-]+\s*:/u.test(css.text) &&
      !/(?:-webkit-)?image-set\s*\(/iu.test(css.text),
    urlValues: urls.values,
  };
}
