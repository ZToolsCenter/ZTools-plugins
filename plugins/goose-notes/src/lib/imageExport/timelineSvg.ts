/**
 * Mermaid timeline 自绘：竖轴 + 日期 + 右侧折行卡片。
 * Mermaid 自带时间轴会写死黑线和彩虹盒，且长文本溢出。
 */

import {
  MERMAID_FONT,
  stripMermaidInitDirectives,
  type MermaidThemeMode,
} from "./mermaidTheme";

export type TimelineItem = {
  section: string;
  period: string;
  events: string[];
};

export type TimelineModel = {
  title: string;
  items: TimelineItem[];
};

const WIDTH = 560;
const PAD_X = 24;
const PAD_Y = 22;
const TITLE_SIZE = 15;
const SECTION_SIZE = 11;
const DATE_SIZE = 12;
const BODY_SIZE = 13;
const LINE_HEIGHT = 20;
const CARD_PAD_X = 14;
const CARD_PAD_Y = 12;
const CARD_RX = 10;
const DOT_R = 4.5;
const DATE_AXIS = 14;
const AXIS_CARD = 20;
const ITEM_GAP = 16;
const SECTION_HEAD = 22;
const DATE_COL_MAX = 108;
const DATE_COL_MIN = 64;

type Palette = {
  text: string;
  muted: string;
  card: string;
  border: string;
  axis: string;
  accent: string;
};

function palette(mode: MermaidThemeMode): Palette {
  if (mode === "dark") {
    return {
      text: "#faf9f5",
      muted: "#c2c0b6",
      card: "#3a3a38",
      border: "#4a4a47",
      axis: "#5c5b57",
      accent: "#818cf8",
    };
  }
  return {
    text: "#141413",
    muted: "#5c5b57",
    card: "#f7f6f2",
    border: "#e7e5e0",
    axis: "#d4d2ca",
    accent: "#4f46e5",
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function charWidth(ch: string, fontSize: number): number {
  return /[\u0020-\u007e]/.test(ch) ? fontSize * 0.58 : fontSize;
}

function measure(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch, fontSize);
  return width;
}

export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [""];
  if (measure(trimmed, fontSize) <= maxWidth) return [trimmed];

  const lines: string[] = [];
  let rest = trimmed;
  while (rest.length > 0) {
    if (measure(rest, fontSize) <= maxWidth) {
      lines.push(rest);
      break;
    }
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measure(rest.slice(0, mid), fontSize) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    let cut = Math.max(1, lo);
    const slice = rest.slice(0, cut);
    const breakAt = Math.max(
      slice.lastIndexOf(" "),
      slice.lastIndexOf("，"),
      slice.lastIndexOf("、"),
      slice.lastIndexOf("："),
      slice.lastIndexOf("（"),
      slice.lastIndexOf("/"),
      slice.lastIndexOf(";"),
      slice.lastIndexOf(","),
    );
    if (breakAt >= Math.floor(cut * 0.4)) cut = breakAt + 1;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return lines;
}

function isNoiseLine(line: string): boolean {
  return (
    line.length === 0 ||
    line.startsWith("%%") ||
    line.startsWith("#") ||
    /^(accTitle|accDescr)\b/i.test(line)
  );
}

export function isMermaidTimeline(source: string): boolean {
  const text = stripMermaidInitDirectives(source);
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (isNoiseLine(line)) continue;
    return /^timeline\b/i.test(line);
  }
  return false;
}

export function parseMermaidTimeline(source: string): TimelineModel | null {
  const text = stripMermaidInitDirectives(source).replace(/\r\n/g, "\n");
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (isNoiseLine(line)) continue;
    lines.push(line);
  }
  if (lines.length === 0 || !/^timeline\b/i.test(lines[0])) return null;

  let title = "";
  let section = "";
  const items: TimelineItem[] = [];

  for (const line of lines.slice(1)) {
    const titleMatch = line.match(/^title\s+(.*)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    const sectionMatch = line.match(/^section\s+(.*)$/i);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    if (/^:\s*/.test(line)) {
      const event = line.replace(/^:\s*/, "").trim();
      if (event && items.length > 0) items[items.length - 1].events.push(event);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      items.push({ section, period: line, events: [] });
      continue;
    }
    const period = line.slice(0, colon).trim();
    const events = line
      .slice(colon + 1)
      .split(/\s+:\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    items.push({ section, period, events });
  }

  if (items.length === 0) return null;
  return { title, items };
}

function tspans(
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
): string {
  return lines
    .map((line, index) => {
      const y = firstBaseline + index * lineHeight;
      return `<tspan x="${x}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");
}

type Row = {
  sectionLabel: string;
  periodLines: string[];
  eventLines: string[][];
  cardH: number;
  top: number;
  cardTop: number;
};

export function renderTimelineSvg(
  model: TimelineModel,
  mode: MermaidThemeMode,
): string {
  const colors = palette(mode);
  const dateCol = Math.min(
    DATE_COL_MAX,
    Math.max(
      DATE_COL_MIN,
      ...model.items.map((item) => measure(item.period, DATE_SIZE)),
    ),
  );
  const axisX = PAD_X + dateCol + DATE_AXIS;
  const cardX = axisX + AXIS_CARD;
  const cardW = WIDTH - PAD_X - cardX;
  const textW = Math.max(80, cardW - CARD_PAD_X * 2);

  const rows: Row[] = [];
  let y = PAD_Y;
  if (model.title) y += TITLE_SIZE + 16;

  let lastSection = "";
  for (const item of model.items) {
    const showSection = Boolean(item.section && item.section !== lastSection);
    if (showSection) lastSection = item.section;
    const periodLines = wrapText(item.period, dateCol, DATE_SIZE);
    const sourceEvents = item.events.length > 0 ? item.events : ["—"];
    const eventLines = sourceEvents.map((event) =>
      wrapText(event, textW, BODY_SIZE),
    );
    const textH =
      eventLines.reduce((sum, lines) => sum + lines.length * LINE_HEIGHT, 0) +
      Math.max(0, eventLines.length - 1) * 6;
    const cardH = CARD_PAD_Y * 2 + textH;
    const top = y;
    const cardTop = showSection ? top + SECTION_HEAD : top;
    rows.push({
      sectionLabel: showSection ? item.section : "",
      periodLines,
      eventLines,
      cardH,
      top,
      cardTop,
    });
    y = cardTop + cardH + ITEM_GAP;
  }

  const height = y - ITEM_GAP + PAD_Y;
  const firstDot = rows[0].cardTop + rows[0].cardH / 2;
  const lastRow = rows[rows.length - 1];
  const lastDot = lastRow.cardTop + lastRow.cardH / 2;
  const label = escapeXml(model.title || "时间线");

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
  ];

  if (model.title) {
    parts.push(
      `<text x="${PAD_X}" y="${PAD_Y + TITLE_SIZE}" font-family='${MERMAID_FONT}' font-size="${TITLE_SIZE}" font-weight="600" fill="${colors.text}">${escapeXml(model.title)}</text>`,
    );
  }

  parts.push(
    `<line x1="${axisX}" y1="${firstDot}" x2="${axisX}" y2="${lastDot}" stroke="${colors.axis}" stroke-width="1.5" stroke-linecap="round"/>`,
  );

  for (const row of rows) {
    if (row.sectionLabel) {
      parts.push(
        `<text x="${cardX}" y="${row.top + SECTION_SIZE}" font-family='${MERMAID_FONT}' font-size="${SECTION_SIZE}" font-weight="600" fill="${colors.muted}">${escapeXml(row.sectionLabel)}</text>`,
      );
    }
    const cy = row.cardTop + row.cardH / 2;
    const dateBaseline = row.cardTop + CARD_PAD_Y + DATE_SIZE;
    parts.push(
      `<text text-anchor="end" font-family='${MERMAID_FONT}' font-size="${DATE_SIZE}" font-weight="500" fill="${colors.muted}">${tspans(row.periodLines, axisX - DATE_AXIS, dateBaseline, 16)}</text>`,
      `<line x1="${axisX}" y1="${cy}" x2="${cardX}" y2="${cy}" stroke="${colors.axis}" stroke-width="1"/>`,
      `<circle cx="${axisX}" cy="${cy}" r="${DOT_R}" fill="${colors.card}" stroke="${colors.accent}" stroke-width="2"/>`,
      `<rect x="${cardX}" y="${row.cardTop}" width="${cardW}" height="${row.cardH}" rx="${CARD_RX}" ry="${CARD_RX}" fill="${colors.card}" stroke="${colors.border}" stroke-width="1"/>`,
    );

    let textY = row.cardTop + CARD_PAD_Y + BODY_SIZE;
    for (const [index, lines] of row.eventLines.entries()) {
      if (index > 0) textY += 6;
      parts.push(
        `<text font-family='${MERMAID_FONT}' font-size="${BODY_SIZE}" fill="${colors.text}">${tspans(lines, cardX + CARD_PAD_X, textY, LINE_HEIGHT)}</text>`,
      );
      textY += lines.length * LINE_HEIGHT;
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

export function tryRenderMermaidTimeline(
  source: string,
  mode: MermaidThemeMode,
): string | null {
  if (!isMermaidTimeline(source)) return null;
  const model = parseMermaidTimeline(source);
  if (!model) return null;
  return renderTimelineSvg(model, mode);
}
