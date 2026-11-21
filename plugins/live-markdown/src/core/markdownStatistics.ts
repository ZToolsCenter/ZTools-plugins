import { WordCountStats } from "../types/typora";

export function computeWordCountStats(markdown: string): WordCountStats {
  const text = String(markdown ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return {
      words: 0,
      charsNoSpaces: 0,
      charsWithSpaces: 0,
      cjkChars: 0,
      lines: 0,
      paragraphs: 0,
      readingMinutes: 0
    };
  }

  const lines = text.split("\n").length;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;

  const charsWithSpaces = text.replace(/\n/g, "").length;
  const charsNoSpaces = text.replace(/\s+/g, "").length;

  const cjkMatches = text.match(
    /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]/g
  );
  const cjkChars = cjkMatches ? cjkMatches.length : 0;

  const nonCjkText = text.replace(
    /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]/g,
    " "
  );
  const latinWords = nonCjkText
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;

  const words = cjkChars + latinWords;
  const readingMinutes = Math.max(1, Math.ceil(words / 300));

  return {
    words,
    charsNoSpaces,
    charsWithSpaces,
    cjkChars,
    lines,
    paragraphs,
    readingMinutes
  };
}
