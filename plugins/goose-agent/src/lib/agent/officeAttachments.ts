/**
 * Composer Office 附件：MIME 分流、解析为文本注入 Turn。
 * 与 userImages 并列；图片仍走 vision ADR 0012。
 */

export const OFFICE_ATTACHMENT_MAX_COUNT = 3;
/** 单文件上限 8MB（解析前） */
export const OFFICE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
/** 注入模型的纯文本上限 */
export const OFFICE_PARSE_TEXT_MAX = 60_000;

export const OFFICE_ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/pdf",
] as const;

const EXT_MIME: Record<string, string> = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pdf": "application/pdf",
};

export type OfficeAttachment = {
  id: string;
  filename: string;
  mediaType: string;
  /** 原始 base64（无 data: 前缀） */
  dataBase64: string;
  byteLength: number;
  /** 解析后的纯文本；解析失败时为空 */
  parsedText?: string;
  parseError?: string;
};

export function isOfficeMime(mime: string | undefined | null): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  return (OFFICE_ALLOWED_MIME as readonly string[]).includes(lower);
}

export function isOfficeFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(EXT_MIME).some((ext) => lower.endsWith(ext));
}

export function resolveOfficeMime(file: File): string {
  if (file.type && isOfficeMime(file.type)) return file.type.split(";")[0]!.trim();
  const lower = file.name.toLowerCase();
  for (const [ext, mime] of Object.entries(EXT_MIME)) {
    if (lower.endsWith(ext)) return mime;
  }
  return file.type || "application/octet-stream";
}

export function isOfficeFile(file: File): boolean {
  return isOfficeMime(file.type) || isOfficeFilename(file.name);
}

function createId(): string {
  return `office-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 注入模型前截断过长解析正文（导出供测试） */
export function truncateOfficeParseText(
  text: string,
  max = OFFICE_PARSE_TEXT_MAX,
): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…（正文已截断）`;
}

/**
 * 读取 File → OfficeAttachment（含 parseOffice 文本）。
 */
export async function parseOfficeFile(file: File): Promise<OfficeAttachment> {
  if (file.size > OFFICE_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `「${file.name}」超过 ${Math.round(OFFICE_ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB 上限`,
    );
  }
  if (!isOfficeFile(file)) {
    throw new Error(`不支持的文件类型：${file.name}`);
  }

  const ab = await file.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const dataBase64 = uint8ToBase64(bytes);
  const mediaType = resolveOfficeMime(file);

  const base: OfficeAttachment = {
    id: createId(),
    filename: file.name || "document",
    mediaType,
    dataBase64,
    byteLength: bytes.byteLength,
  };

  try {
    const { parseOffice } = await import("officeparser");
    const slice = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const ast = await parseOffice(slice, {
      extractAttachments: false,
      ocr: false,
      includeRawContent: false,
    } as Parameters<typeof parseOffice>[1]);
    let text = "";
    if (ast && typeof (ast as { toText?: () => string }).toText === "function") {
      text = (ast as { toText: () => string }).toText() ?? "";
    } else if (typeof ast === "string") {
      text = ast;
    }
    return { ...base, parsedText: truncateOfficeParseText(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      parseError: msg,
      parsedText: undefined,
    };
  }
}

/**
 * 将 Office 附件拼成注入用户消息的文本块（模型可见）。
 */
export function formatOfficeAttachmentsForMessage(
  attachments: OfficeAttachment[],
): string {
  if (attachments.length === 0) return "";
  const blocks: string[] = [];
  for (const a of attachments) {
    if (a.parsedText?.trim()) {
      blocks.push(
        `【附件：${a.filename}】\n${a.parsedText.trim()}`,
      );
    } else {
      blocks.push(
        `【附件：${a.filename}】\n（解析失败${a.parseError ? `：${a.parseError}` : ""}，请改用 parseOffice 工具或重新上传）`,
      );
    }
  }
  return blocks.join("\n\n");
}
