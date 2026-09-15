/**
 * Office 工具：解析上传/工作区文档 + 生成修订版 docx/xlsx/pptx。
 * 非 WYSIWYG：解析文本给模型，再用库生成可下载二进制。
 * 大依赖（officeparser / docx / exceljs / pptxgenjs）均动态 import，避免进主包。
 */

import { isFsAvailable, writeFile } from "@/lib/fs";
import { assertCanWrite } from "../sandbox";
import type { AgentToolContext } from "./types";

const PARSE_TEXT_MAX = 80_000;
const FILENAME_SAFE = /[^a-zA-Z0-9._\-\u4e00-\u9fff]+/g;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}

function sanitizeFilename(name: string, ext: string): string {
  const base = name.replace(FILENAME_SAFE, "_").replace(/_+/g, "_").replace(/^\.+/, "");
  const trimmed = (base || "artifact").slice(0, 80);
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(`.${ext}`)) return trimmed;
  return `${trimmed}.${ext}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  return uint8ToBase64(new Uint8Array(buf));
}

async function maybeWriteWorkspace(
  ctx: AgentToolContext,
  relativePath: string | undefined,
  base64: string,
): Promise<{ savedPath?: string; saveError?: string }> {
  const pathInput = relativePath?.trim();
  if (!pathInput) return {};
  const resolved = assertCanWrite(ctx.permissionMode, ctx.workspaceRoot, pathInput);
  if (!resolved.ok) {
    return { saveError: resolved.message };
  }
  if (!isFsAvailable()) {
    return { saveError: "本机文件桥不可用，无法保存到工作区" };
  }
  const ok = await writeFile(resolved.absolutePath, base64, "base64");
  if (!ok) return { saveError: "写入工作区失败" };
  return { savedPath: resolved.absolutePath };
}

function decodeBase64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * 解析 Office 文档为纯文本（给模型）。
 * 输入：contentBase64（Composer 上传）或 path（工作区路径，需 FS）。
 */
export async function executeParseOffice(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const filename = asString(input.filename) || asString(input.name) || "document";
  const contentBase64 = asString(input.contentBase64) || asString(input.base64);
  const pathInput = asString(input.path);

  let bytes: Uint8Array | null = null;

  if (contentBase64) {
    try {
      bytes = decodeBase64ToUint8(contentBase64);
    } catch {
      return { ok: false, error: "contentBase64 无法解码" };
    }
  } else if (pathInput) {
    const { assertCanRead } = await import("../sandbox");
    const { readFileBase64 } = await import("@/lib/fs");
    const resolved = assertCanRead(ctx.permissionMode, ctx.workspaceRoot, pathInput);
    if (!resolved.ok) {
      return { ok: false, error: resolved.message, code: resolved.code };
    }
    if (!isFsAvailable()) {
      return {
        ok: false,
        error: "本机文件桥不可用，无法读取工作区文件",
      };
    }
    const b64 = await readFileBase64(resolved.absolutePath);
    if (!b64) {
      return { ok: false, error: "无法以二进制读取该文件（可能不存在）", path: resolved.absolutePath };
    }
    try {
      bytes = decodeBase64ToUint8(b64);
    } catch {
      return { ok: false, error: "工作区文件 base64 解码失败" };
    }
  } else {
    return {
      ok: false,
      error: "请提供 contentBase64（上传内容）或 path（工作区路径）",
    };
  }

  try {
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const { parseOffice } = await import("officeparser");
    const ast = await parseOffice(ab, {
      // 浏览器环境：跳过 OCR / 附件提取以减负
      extractAttachments: false,
      ocr: false,
      includeRawContent: false,
    } as never);

    let text = "";
    if (ast && typeof (ast as { toText?: () => string }).toText === "function") {
      text = (ast as { toText: () => string }).toText() ?? "";
    } else if (typeof ast === "string") {
      text = ast;
    } else {
      text = JSON.stringify(ast).slice(0, PARSE_TEXT_MAX);
    }

    const truncated = text.length > PARSE_TEXT_MAX;
    if (truncated) text = text.slice(0, PARSE_TEXT_MAX);

    return {
      ok: true,
      kind: "office-parse",
      filename,
      text,
      truncated,
      charCount: text.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Office 解析失败：${msg}`,
      filename,
    };
  }
}

type DocxBlock =
  | { type?: "heading"; level?: number; text: string }
  | { type?: "paragraph"; text: string }
  | { type?: "bullet"; text: string }
  | string;

/**
 * 生成 DOCX。入参 paragraphs 或 blocks。
 */
export async function executeWriteDocx(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const title = asString(input.title) || "文档";
  const filename = sanitizeFilename(
    asString(input.filename) || title || "document",
    "docx",
  );
  const savePath = asString(input.savePath) || asString(input.path) || undefined;

  const blocksRaw = Array.isArray(input.blocks)
    ? input.blocks
    : Array.isArray(input.paragraphs)
      ? input.paragraphs
      : [];

  if (blocksRaw.length === 0) {
    const body = asString(input.content) || asString(input.text);
    if (!body.trim()) {
      return { ok: false, error: "请提供 blocks / paragraphs / content" };
    }
    blocksRaw.push(...body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
  }

  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
  } = await import("docx");

  const children: InstanceType<typeof Paragraph>[] = [];
  for (const raw of blocksRaw as DocxBlock[]) {
    if (typeof raw === "string") {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: raw, size: 22 })],
          spacing: { after: 200 },
        }),
      );
      continue;
    }
    const rec = (raw ?? {}) as Record<string, unknown>;
    const text = asString(rec.text);
    const type = asString(rec.type, "paragraph");
    if (type === "heading") {
      const level = Number(rec.level) || 1;
      const heading =
        level <= 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      children.push(
        new Paragraph({
          heading,
          children: [new TextRun({ text, bold: true })],
          spacing: { after: 200 },
        }),
      );
    } else if (type === "bullet") {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text })],
          spacing: { after: 120 },
        }),
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text, size: 22 })],
          spacing: { after: 200 },
        }),
      );
    }
  }

  if (children.length === 0) {
    return { ok: false, error: "文档内容为空" };
  }

  try {
    const section = {
      properties: {},
      children,
    };
    const doc = new Document({
      title,
      sections: [section],
    });
    const buffer = await Packer.toBuffer(doc);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const contentBase64 = uint8ToBase64(bytes);
    const saved = await maybeWriteWorkspace(ctx, savePath, contentBase64);

    return {
      ok: true,
      kind: "office-docx",
      title,
      filename,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentBase64,
      byteLength: bytes.byteLength,
      ...saved,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `生成 DOCX 失败：${msg}` };
  }
}

type SheetSpec = {
  name?: string;
  rows?: unknown[][];
  columns?: string[];
};

/**
 * 生成 XLSX。sheets: [{ name, columns?, rows }]
 */
export async function executeWriteXlsx(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const title = asString(input.title) || "表格";
  const filename = sanitizeFilename(
    asString(input.filename) || title || "workbook",
    "xlsx",
  );
  const savePath = asString(input.savePath) || asString(input.path) || undefined;

  let sheets: SheetSpec[] = [];
  if (Array.isArray(input.sheets)) {
    sheets = input.sheets as SheetSpec[];
  } else if (Array.isArray(input.rows)) {
    sheets = [
      {
        name: asString(input.sheetName, "Sheet1"),
        columns: asStringArray(input.columns),
        rows: input.rows as unknown[][],
      },
    ];
  }

  if (sheets.length === 0) {
    return { ok: false, error: "请提供 sheets 或 rows" };
  }

  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "goose-agent";
    wb.title = title;

    for (const spec of sheets) {
      const name = (asString(spec.name) || "Sheet1").slice(0, 31);
      const ws = wb.addWorksheet(name);
      const columns = Array.isArray(spec.columns) ? asStringArray(spec.columns) : [];
      const rows = Array.isArray(spec.rows) ? spec.rows : [];
      if (columns.length > 0) {
        ws.addRow(columns);
        ws.getRow(1).font = { bold: true };
      }
      for (const row of rows) {
        if (Array.isArray(row)) {
          ws.addRow(
            row.map((cell) =>
              cell == null
                ? ""
                : typeof cell === "number" || typeof cell === "boolean"
                  ? cell
                  : String(cell),
            ),
          );
        }
      }
      // 粗略列宽
      const colCount = Math.max(
        columns.length,
        ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
        1,
      );
      for (let i = 1; i <= colCount; i++) {
        ws.getColumn(i).width = 14;
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const ab =
      buffer instanceof ArrayBuffer
        ? buffer
        : (buffer as { buffer: ArrayBuffer }).buffer
          ? (buffer as Uint8Array).buffer.slice(
              (buffer as Uint8Array).byteOffset,
              (buffer as Uint8Array).byteOffset + (buffer as Uint8Array).byteLength,
            )
          : new Uint8Array(buffer as ArrayLike<number>).buffer;
    const contentBase64 = arrayBufferToBase64(ab as ArrayBuffer);
    const byteLength = (ab as ArrayBuffer).byteLength;
    const saved = await maybeWriteWorkspace(ctx, savePath, contentBase64);

    return {
      ok: true,
      kind: "office-xlsx",
      title,
      filename,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentBase64,
      byteLength,
      ...saved,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `生成 XLSX 失败：${msg}` };
  }
}

type SlideSpec = {
  title?: string;
  body?: string;
  bullets?: string[];
  notes?: string;
};

/**
 * 生成 PPTX。slides: [{ title, body?, bullets? }]
 */
export async function executeWritePptx(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const title = asString(input.title) || "演示文稿";
  const filename = sanitizeFilename(
    asString(input.filename) || title || "presentation",
    "pptx",
  );
  const savePath = asString(input.savePath) || asString(input.path) || undefined;

  const slidesRaw = Array.isArray(input.slides) ? (input.slides as SlideSpec[]) : [];
  if (slidesRaw.length === 0) {
    return { ok: false, error: "请提供 slides 数组" };
  }

  try {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.author = "goose-agent";
    pptx.title = title;
    pptx.layout = "LAYOUT_WIDE";

    for (const slideSpec of slidesRaw) {
      const slide = pptx.addSlide();
      const sTitle = asString(slideSpec.title);
      const body = asString(slideSpec.body);
      const bullets = asStringArray(slideSpec.bullets);

      if (sTitle) {
        slide.addText(sTitle, {
          x: 0.5,
          y: 0.35,
          w: 12.3,
          h: 0.7,
          fontSize: 28,
          bold: true,
          color: "1A1A1A",
        });
      }

      let y = sTitle ? 1.2 : 0.5;
      if (body) {
        slide.addText(body, {
          x: 0.5,
          y,
          w: 12.3,
          h: 1.2,
          fontSize: 16,
          color: "333333",
          valign: "top",
        });
        y += 1.3;
      }
      if (bullets.length > 0) {
        slide.addText(
          bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
          {
            x: 0.5,
            y,
            w: 12.3,
            h: 5,
            fontSize: 16,
            color: "333333",
            valign: "top",
          },
        );
      }
      const notes = asString(slideSpec.notes);
      if (notes) {
        slide.addNotes(notes);
      }
    }

    const out = (await pptx.write({
      outputType: "arraybuffer",
    })) as ArrayBuffer;
    const contentBase64 = arrayBufferToBase64(out);
    const saved = await maybeWriteWorkspace(ctx, savePath, contentBase64);

    return {
      ok: true,
      kind: "office-pptx",
      title,
      filename,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      contentBase64,
      byteLength: out.byteLength,
      ...saved,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `生成 PPTX 失败：${msg}` };
  }
}
