import { validateCodeBodySyntax } from "./codeBodySyntax";
import { recoverCodeHeadingEcho } from "./codeHeadingEcho";

const MAX_CODE_BYTES = 131_072;
interface NormalizedCode { body: string; warning?: string; syntax: "valid" | "unsupported"; }

export interface NormalizeCodePayloadOptions {
  readonly expectedHeading?: string;
}

function normalizeLineEndings(value: string): string { return value.replace(/\r\n?/gu, "\n"); }

export function hasNoOuterFence(value: string): boolean {
  const lines = value.trim().split("\n");
  const opening = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/u.exec(lines[0] ?? "");
  const closing = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u.exec(lines.at(-1) ?? "");
  return !(opening && closing && opening[1][0] === closing[1][0] && closing[1].length >= opening[1].length);
}

function unescapeHeading(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()<>#+\-.!|])/gu, "$1");
}

function matchingFenceBody(lines: readonly string[], language: string): string | undefined {
  const openAt = lines.findIndex(line => Boolean(line.trim()));
  if (openAt < 0) return undefined;
  const opening = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/u.exec(lines[openAt]);
  if (!opening || opening[2].trim().toLowerCase() !== language.trim().toLowerCase()) return undefined;
  const marker = opening[1];
  let closeAt = -1;
  for (let index = openAt + 1; index < lines.length; index += 1) {
    const close = /^[ \t]{0,3}(`+|~+)[ \t]*$/u.exec(lines[index]);
    if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
      closeAt = index;
      break;
    }
  }
  if (closeAt < 0 || lines.slice(closeAt + 1).some(line => line.trim())) return undefined;
  return lines.slice(openAt + 1, closeAt).join("\n").trim();
}

/** Recover only an exact duplicate body separated by the one explicitly requested Markdown title. */
function recoverDuplicatedCode(value: string, language: string, expectedHeading?: string): string | undefined {
  if (!expectedHeading || !["js", "javascript", "ts", "typescript"].includes(language.trim().toLowerCase())) return undefined;
  const lines = normalizeLineEndings(value).split("\n");
  const headings = lines.flatMap((line, index) => {
    const match = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    return match ? [{ index, text: unescapeHeading(match[1].trim()) }] : [];
  });
  if (headings.length !== 1 || headings[0].text !== expectedHeading.trim()) return undefined;
  const { index } = headings[0];
  const first = lines.slice(0, index).join("\n").trim();
  if (!first || validateCodeBodySyntax(first, language) !== "valid") return undefined;
  const fenced = matchingFenceBody(lines.slice(index + 1), language);
  if (!fenced || first !== fenced) return undefined;
  return first;
}

function emptyMatchingFence(lines: readonly string[], language: string): boolean {
  const nonempty = lines.flatMap((line, index) => line.trim() ? [{ line, index }] : []);
  if (nonempty.length < 2) return false;
  const opening = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/u.exec(nonempty[0].line);
  const closing = /^[ \t]{0,3}(`+|~+)[ \t]*$/u.exec(nonempty.at(-1)!.line);
  if (!opening || !closing || opening[2].trim().toLowerCase() !== language.trim().toLowerCase() ||
      opening[1][0] !== closing[1][0] || closing[1].length < opening[1].length) return false;
  return lines.slice(nonempty[0].index + 1, nonempty.at(-1)!.index).every(line => !line.trim());
}

/** Recovers only a valid body followed by its exact requested title and an empty duplicate fence. */
function recoverEmptyDuplicateShell(value: string, language: string, expectedHeading?: string): string | undefined {
  if (!expectedHeading || !["js", "javascript", "ts", "typescript"].includes(language.trim().toLowerCase())) return undefined;
  const lines = normalizeLineEndings(value).split("\n");
  const headings = lines.flatMap((line, index) => {
    const match = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    return match ? [{ index, text: unescapeHeading(match[1].trim()) }] : [];
  });
  if (headings.length !== 1 || headings[0].text !== expectedHeading.trim()) return undefined;
  const { index } = headings[0];
  const body = lines.slice(0, index).join("\n").trim();
  if (!body || validateCodeBodySyntax(body, language) !== "valid" || !emptyMatchingFence(lines.slice(index + 1), language)) return undefined;
  return body;
}

function normalizeHeadingEcho(body: string, language: string, allowMarkdownBody: boolean,
  expectedHeading?: string): { body: string; warning?: string } | undefined {
  if (allowMarkdownBody) return { body };
  const echo = recoverCodeHeadingEcho(body, language, expectedHeading);
  return { body: echo.body ?? body, ...(echo.body ? { warning: "已移除与明确标题关联的重复标题。" } : {}) };
}

function withWarnings(...warnings: Array<string | undefined>): string | undefined {
  const values = warnings.filter((value): value is string => Boolean(value));
  return values.length ? values.join(" ") : undefined;
}

function recoverRepeatedLanguageClosingFence(lines: readonly string[], opening: RegExpExecArray, language: string): string | undefined {
  if (!["js", "javascript", "ts", "typescript"].includes(language.trim().toLowerCase())) return undefined;
  if (opening[2].trim().toLowerCase() !== language.trim().toLowerCase() || lines.length < 3) return undefined;
  const closing = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)[ \t]*$/u.exec(lines.at(-1) ?? "");
  if (!closing || closing[1][0] !== opening[1][0] || closing[1].length < opening[1].length ||
      closing[2].trim().toLowerCase() !== language.trim().toLowerCase()) return undefined;
  const body = lines.slice(1, -1).join("\n");
  if (!body.trim() || lines.slice(1, -1).some(line => /^[ \t]{0,3}(?:`{3,}|~{3,})/u.test(line)) ||
      validateCodeBodySyntax(body, language) !== "valid") return undefined;
  return body;
}

export function normalizeCodePayload(
  value: string,
  language: string,
  allowMarkdownBody: boolean,
  options: NormalizeCodePayloadOptions = {}
): NormalizedCode | undefined {
  if (new TextEncoder().encode(value).byteLength > MAX_CODE_BYTES) return undefined;
  const duplicate = recoverDuplicatedCode(value, language, options.expectedHeading);
  if (duplicate) {
    const echo = normalizeHeadingEcho(duplicate, language, allowMarkdownBody, options.expectedHeading);
    return echo ? { body: echo.body,
      warning: withWarnings("已移除与明确标题关联的重复代码副本。", echo.warning), syntax: "valid" } : undefined;
  }
  const emptyShell = recoverEmptyDuplicateShell(value, language, options.expectedHeading);
  if (emptyShell) {
    const echo = normalizeHeadingEcho(emptyShell, language, allowMarkdownBody, options.expectedHeading);
    return echo ? { body: echo.body,
      warning: withWarnings("已移除标题后的空代码围栏；标题由程序按请求生成。", echo.warning), syntax: "valid" } : undefined;
  }

  const lines = normalizeLineEndings(value).split("\n");
  const opening = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/u.exec(lines[0] ?? "");
  let body: string;
  let warning: string | undefined;
  if (!opening) {
    if (!allowMarkdownBody && !hasNoOuterFence(normalizeLineEndings(value))) return undefined;
    body = normalizeLineEndings(value);
  } else {
    const marker = opening[1];
    const info = opening[2].trim();
    let closeAt = -1;
    for (let index = 1; index < lines.length; index += 1) {
      const close = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u.exec(lines[index]);
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) { closeAt = index; break; }
    }
    const trailing = closeAt >= 0 && lines.slice(closeAt + 1).some(line => line.trim());
    if (closeAt < 0 && !trailing && info.toLowerCase() === language.toLowerCase()) {
      const repaired = recoverRepeatedLanguageClosingFence(lines, opening, language);
      if (repaired) {
        const echo = normalizeHeadingEcho(repaired, language, allowMarkdownBody, options.expectedHeading);
        return echo ? { body: echo.body,
          warning: withWarnings("已修复重复语言标签的关闭围栏。", echo.warning), syntax: "valid" } : undefined;
      }
    }
    if (closeAt < 0 || trailing || info.toLowerCase() !== language.toLowerCase()) {
      if (!allowMarkdownBody) return undefined;
      body = normalizeLineEndings(value);
    } else {
      body = lines.slice(1, closeAt).join("\n");
      warning = `模型返回的匹配外层 ${language} 围栏已移除，程序重新渲染了代码围栏。`;
    }
  }

  const echo = normalizeHeadingEcho(body, language, allowMarkdownBody, options.expectedHeading);
  if (!echo) return undefined;
  body = echo.body;

  const validation = allowMarkdownBody ? "unsupported" : validateCodeBodySyntax(body, language);
  if (validation === "invalid") return undefined;
  return { body, ...(withWarnings(warning, echo.warning) ? { warning: withWarnings(warning, echo.warning) } : {}),
    syntax: validation === "valid" ? "valid" : "unsupported" };
}
