import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true }).enable("table");

// Matches: | col1 | col2 | followed by | --- | --- | (markdown table pattern)
const TABLE_PATTERN = /\|.+\|[\r\n]+\|[\s:|-]+\|/;

export function containsMarkdownTable(text: string): boolean {
  return TABLE_PATTERN.test(text);
}

export function parseMarkdownToHtml(text: string): string {
  return md.render(text);
}

export function parseMarkdownTableToHtml(text: string): string | null {
  if (!containsMarkdownTable(text)) {
    return null;
  }
  return md.render(text);
}
