import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, convertInchesToTwip } from "docx";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import { processBlockChildren } from "./docxBlocks";

export * from "./docxStyles";
export * from "./docxImages";
export * from "./docxBlocks";

async function buildDocxDocument(page: Page): Promise<Document> {
  const title = extractTitleFromContent(page.content);
  const content = page.content as BlockNoteContent;
  const imageMap = new Map<string, string>();

  const paragraphs = await processBlockChildren(content, 0, imageMap);

  const titleParagraph = new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: title || "无标题", bold: true, size: 36 })],
    spacing: { after: 240 },
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children: [titleParagraph, ...paragraphs],
      },
    ],
  });
}

export async function generateDocxBuffer(page: Page): Promise<ArrayBuffer> {
  const doc = await buildDocxDocument(page);
  const buffer = await Packer.toBuffer(doc);
  // Convert Node Buffer to ArrayBuffer
  return (buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer);
}

export async function exportToWord(page: Page) {
  const doc = await buildDocxDocument(page);
  const blob = await Packer.toBlob(doc);
  const title = extractTitleFromContent(page.content);
  const filename = `${sanitizeFileName(title || "untitled")}.docx`;
  await downloadBlob(blob, filename);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "untitled";
}

async function downloadBlob(blob: Blob, filename: string) {
  const { saveBlobAndReveal } = await import("../export");
  await saveBlobAndReveal(blob, filename);
}
