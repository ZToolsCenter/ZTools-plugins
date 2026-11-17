import type { TableAlign } from "../types/typora";

function isEscapedPipe(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

/** Splits a GFM table row; pipes escaped with an odd backslash count stay in their cell. */
export function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "|" && !isEscapedPipe(trimmed, index)) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|") && !isEscapedPipe(trimmed, trimmed.length - 1)) cells.pop();
  return cells;
}

/** Removes Markdown's escaped-pipe marker for display while leaving source cells untouched. */
export function decodeTableCellPipes(cell: string): string {
  let decoded = "";
  for (let index = 0; index < cell.length; index += 1) {
    if (cell[index] === "\\" && cell[index + 1] === "|" && isEscapedPipe(cell, index + 1)) {
      decoded += "|";
      index += 1;
    } else {
      decoded += cell[index];
    }
  }
  return decoded;
}

export function isMarkdownTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !trimmed.includes("-")) return false;
  const cells = splitMarkdownTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

export function parseMarkdownTableAlignments(line: string, count: number): TableAlign[] {
  const cells = splitMarkdownTableRow(line);
  return Array.from({ length: count }, (_, index) => {
    const cell = (cells[index] || "---").trim();
    const startsColon = cell.startsWith(":");
    const endsColon = cell.endsWith(":");
    if (startsColon && endsColon) return "center";
    if (endsColon) return "right";
    if (startsColon) return "left";
    return null;
  });
}

export function prettifyMarkdownTable(
  headers: string[],
  alignments: TableAlign[],
  rows: string[][]
): string {
  const colCount = Math.max(
    headers.length,
    ...rows.map((r) => r.length),
    1
  );

  const normalizedHeaders = Array.from({ length: colCount }, (_, idx) =>
    String(headers[idx] ?? "").trim()
  );
  const normalizedRows = rows.map((row) =>
    Array.from({ length: colCount }, (_, idx) => String(row[idx] ?? "").trim())
  );
  const normalizedAligns = Array.from(
    { length: colCount },
    (_, idx) => alignments[idx] ?? null
  );

  const widths = Array.from({ length: colCount }, (_, colIdx) => {
    const cellLengths = [
      normalizedHeaders[colIdx].length,
      ...normalizedRows.map((row) => row[colIdx].length),
      3
    ];
    return Math.max(...cellLengths);
  });

  const formatRow = (cells: string[]) =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i], " ")).join(" | ")} |`;

  const delimiterCells = normalizedAligns.map((align, i) => {
    const width = Math.max(widths[i], 3);
    if (align === "center") {
      return `:${"-".repeat(Math.max(width - 2, 1))}:`;
    }
    if (align === "right") {
      return `${"-".repeat(Math.max(width - 1, 2))}:`;
    }
    if (align === "left") {
      return `:${"-".repeat(Math.max(width - 1, 2))}`;
    }
    return "-".repeat(width);
  });

  const lines = [
    formatRow(normalizedHeaders),
    `| ${delimiterCells.join(" | ")} |`,
    ...normalizedRows.map(formatRow)
  ];
  return lines.join("\n");
}

export function createEmptyTableBlock(cols = 3, rows = 2): string {
  const safeCols = Math.max(1, Math.min(12, cols));
  const safeRows = Math.max(1, Math.min(30, rows));
  const headers = Array.from({ length: safeCols }, (_, idx) => `列 ${idx + 1}`);
  const alignments: TableAlign[] = Array.from({ length: safeCols }, () => "left");
  const bodyRows = Array.from({ length: safeRows }, () =>
    Array.from({ length: safeCols }, () => "内容")
  );
  return prettifyMarkdownTable(headers, alignments, bodyRows);
}
