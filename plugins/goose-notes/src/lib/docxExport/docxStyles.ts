import { TextRun, UnderlineType } from "docx";

export interface InlineItem {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
  highlight?: boolean;
  color?: string;
}

export function extractInlineItems(content: unknown): InlineItem[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  if (!Array.isArray(content)) return [];

  const items: InlineItem[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      items.push({ text: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;

    const text = item.text || "";
    const styles = item.styles || {};
    const marks = item.marks || [];

    const inline: InlineItem = { text };

    if (styles.bold) inline.bold = true;
    if (styles.italic) inline.italic = true;
    if (styles.strike) inline.strike = true;
    if (styles.code) inline.code = true;
    if (styles.color) inline.color = styles.color;
    if (styles.backgroundColor) inline.highlight = true;

    for (const mark of marks) {
      if (!mark || typeof mark !== "object") continue;
      switch (mark.type) {
        case "bold":
          inline.bold = true;
          break;
        case "italic":
          inline.italic = true;
          break;
        case "strike":
          inline.strike = true;
          break;
        case "code":
          inline.code = true;
          break;
        case "textStyle":
          if (mark.attrs?.color) inline.color = mark.attrs.color;
          break;
        case "highlight":
          inline.highlight = true;
          break;
        case "link":
          if (mark.attrs?.href) inline.link = mark.attrs.href;
          break;
      }
    }

    if (item.type === "link" && item.href) {
      inline.link = item.href;
    }

    items.push(inline);
  }
  return items;
}

export function inlineToTextRuns(items: InlineItem[]): TextRun[] {
  return items.map((item) => {
    const runConfig: Record<string, unknown> = {
      text: item.text,
    };

    if (item.bold) runConfig.bold = true;
    if (item.italic) runConfig.italics = true;
    if (item.strike) runConfig.strike = true;
    if (item.code) {
      runConfig.font = "Courier New";
      runConfig.shading = {
        fill: "F2F3F5",
      };
    }
    if (item.link) {
      runConfig.style = "Hyperlink";
    }
    if (item.color) {
      runConfig.color = item.color.replace("#", "");
    }

    return new TextRun(runConfig);
  });
}

// Re-export UnderlineType so consumers can access it from this module if needed
export { UnderlineType };
