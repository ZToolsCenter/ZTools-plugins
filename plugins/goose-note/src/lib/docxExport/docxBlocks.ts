import {
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImageRun,
  AlignmentType,
  convertInchesToTwip,
} from "docx";
import { resolveCalloutIcon } from "@/components/editor/blocks/callout/calloutIcons";
import { extractInlineItems, inlineToTextRuns } from "./docxStyles";
import { resolveImageToBuffer } from "./docxImages";

export async function processBlockChildren(
  blocks: any[],
  depth: number = 0,
  imageMap: Map<string, string>,
): Promise<(Paragraph | Table)[]> {
  const result: (Paragraph | Table)[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    const inlineItems = extractInlineItems(block.content);
    const textRuns = inlineToTextRuns(inlineItems);

    switch (block.type) {
      case "heading": {
        const level = block.props?.level || 1;
        const headingMap: Record<number, any> = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
        };
        result.push(
          new Paragraph({
            heading: headingMap[level] || HeadingLevel.HEADING_1,
            children: textRuns,
            spacing: { before: 240, after: 120 },
          }),
        );
        break;
      }

      case "bulletListItem": {
        result.push(
          new Paragraph({
            children: textRuns,
            bullet: {
              level: depth,
            },
            spacing: { before: 60, after: 60 },
            indent: { left: convertInchesToTwip(0.25 * (depth + 1)) },
          }),
        );
        break;
      }

      case "numberedListItem": {
        result.push(
          new Paragraph({
            children: textRuns,
            numbering: {
              reference: "numbered-list",
              level: depth,
            },
            spacing: { before: 60, after: 60 },
            indent: { left: convertInchesToTwip(0.25 * (depth + 1)) },
          }),
        );
        break;
      }

      case "checkListItem": {
        const checked = block.props?.checked ? "☑ " : "☐ ";
        result.push(
          new Paragraph({
            children: [
              new TextRun({ text: checked, font: "Segoe UI Symbol" }),
              ...textRuns,
            ],
            spacing: { before: 60, after: 60 },
            indent: { left: convertInchesToTwip(0.25 * (depth + 1)) },
          }),
        );
        break;
      }

      case "codeBlock": {
        const codeText = block.content || "";
        const codeStr = typeof codeText === "string"
          ? codeText
          : Array.isArray(codeText)
            ? codeText.map((c: any) => (typeof c === "string" ? c : c?.text || "")).join("")
            : "";
        result.push(
          new Paragraph({
            children: [
              new TextRun({
                text: codeStr,
                font: "Courier New",
                size: 18,
              }),
            ],
            shading: {
              fill: "F5F5F5",
            },
            spacing: { before: 120, after: 120 },
            indent: { left: convertInchesToTwip(0.25) },
          }),
        );
        break;
      }

      case "quote": {
        result.push(
          new Paragraph({
            children: textRuns.map((run) => {
              const config = (run as any).options || {};
              return new TextRun({
                ...config,
                italics: true,
                color: "666666",
              });
            }),
            spacing: { before: 120, after: 120 },
            indent: { left: convertInchesToTwip(0.4) },
            border: {
              left: {
                color: "CCCCCC",
                space: 8,
                style: BorderStyle.SINGLE,
                size: 12,
              },
            },
          }),
        );
        break;
      }

      case "paragraph": {
        if (textRuns.length > 0) {
          result.push(
            new Paragraph({
              children: textRuns,
              spacing: { before: 60, after: 60 },
            }),
          );
        }
        break;
      }

      case "image":
      case "imageResize": {
        const src = block.props?.url || block.props?.src || "";
        if (src) {
          const imageResult = await resolveImageToBuffer(src, imageMap);
          if (imageResult) {
            result.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageResult.buffer.buffer.slice(
                      imageResult.buffer.byteOffset,
                      imageResult.buffer.byteOffset + imageResult.buffer.byteLength,
                    ) as ArrayBuffer,
                    transformation: {
                      width: 400,
                      height: 300,
                    },
                    type: imageResult.type as any,
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 120 },
              }),
            );
          }
        }
        break;
      }

      case "table": {
        const tableResult = blockToTable(block);
        if (tableResult) result.push(tableResult);
        break;
      }

      case "divider": {
        result.push(
          new Paragraph({
            border: {
              bottom: {
                color: "CCCCCC",
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            spacing: { before: 120, after: 120 },
          }),
        );
        break;
      }

      case "callout": {
        const emoji = resolveCalloutIcon(block.props?.icon || block.props?.emoji);
        result.push(
          new Paragraph({
            children: [
              new TextRun({ text: emoji + " " }),
              ...textRuns,
            ],
            shading: {
              fill: "FFF8E1",
            },
            spacing: { before: 120, after: 120 },
            indent: { left: convertInchesToTwip(0.15) },
          }),
        );
        break;
      }

      default: {
        if (textRuns.length > 0) {
          result.push(
            new Paragraph({
              children: textRuns,
              spacing: { before: 60, after: 60 },
            }),
          );
        }
      }
    }

    // Process nested children
    if (block.children?.length) {
      const childrenResult = await processBlockChildren(block.children, depth + 1, imageMap);
      result.push(...childrenResult);
    }
  }

  return result;
}

export function blockToTable(block: any): Table | null {
  const rows = block.content?.rows || [];
  if (!rows.length) return null;

  const tableRows: TableRow[] = [];

  for (const row of rows) {
    const cells = row.cells || [];
    const tableCells: TableCell[] = cells.map((cell: any) => {
      const cellText = typeof cell === "string" ? cell : extractCellText(cell);
      return new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: cellText })],
          }),
        ],
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
        },
      });
    });

    tableRows.push(
      new TableRow({
        children: tableCells,
      }),
    );
  }

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

export function extractCellText(cell: any): string {
  if (typeof cell === "string") return cell;
  if (Array.isArray(cell)) {
    return cell.map((c: any) => {
      if (typeof c === "string") return c;
      if (c?.text) return c.text;
      return "";
    }).join("");
  }
  if (cell?.text) return cell.text;
  if (cell?.content) {
    if (typeof cell.content === "string") return cell.content;
    if (Array.isArray(cell.content)) {
      return cell.content.map((c: any) => {
        if (typeof c === "string") return c;
        if (c?.text) return c.text;
        return "";
      }).join("");
    }
  }
  return "";
}
