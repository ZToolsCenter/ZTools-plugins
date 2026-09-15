import { describe, expect, it } from "vitest";
import {
  OFFICE_ATTACHMENT_MAX_COUNT,
  OFFICE_ATTACHMENT_MAX_BYTES,
  OFFICE_PARSE_TEXT_MAX,
  formatOfficeAttachmentsForMessage,
  isOfficeFile,
  isOfficeFilename,
  isOfficeMime,
  parseOfficeFile,
  resolveOfficeMime,
  truncateOfficeParseText,
  type OfficeAttachment,
} from "../officeAttachments";

describe("officeAttachments helpers", () => {
  it("limits and mime helpers", () => {
    expect(OFFICE_ATTACHMENT_MAX_COUNT).toBe(3);
    expect(OFFICE_ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(isOfficeMime(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toBe(true);
    expect(isOfficeMime("image/png")).toBe(false);
    expect(isOfficeFilename("报告.docx")).toBe(true);
    expect(isOfficeFilename("a.png")).toBe(false);
    expect(resolveOfficeMime(new File([""], "x.pdf", { type: "" }))).toBe(
      "application/pdf",
    );
  });

  it("isOfficeFile uses name when type empty", () => {
    const f = new File([""], "sheet.xlsx", { type: "" });
    expect(isOfficeFile(f)).toBe(true);
    const img = new File([""], "a.png", { type: "image/png" });
    expect(isOfficeFile(img)).toBe(false);
  });

  it("formatOfficeAttachmentsForMessage injects parsed text", () => {
    const list: OfficeAttachment[] = [
      {
        id: "1",
        filename: "a.docx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        dataBase64: "AA",
        byteLength: 2,
        parsedText: "正文一行",
      },
      {
        id: "2",
        filename: "b.pdf",
        mediaType: "application/pdf",
        dataBase64: "BB",
        byteLength: 2,
        parseError: "损坏",
      },
    ];
    const text = formatOfficeAttachmentsForMessage(list);
    expect(text).toContain("【附件：a.docx】");
    expect(text).toContain("正文一行");
    expect(text).toContain("【附件：b.pdf】");
    expect(text).toContain("解析失败");
  });

  it("formatOfficeAttachmentsForMessage empty list", () => {
    expect(formatOfficeAttachmentsForMessage([])).toBe("");
  });

  it("truncateOfficeParseText keeps short and truncates long", () => {
    expect(truncateOfficeParseText("短")).toBe("短");
    const long = "字".repeat(OFFICE_PARSE_TEXT_MAX + 50);
    const out = truncateOfficeParseText(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("正文已截断");
    expect(out.startsWith("字".repeat(20))).toBe(true);
  });

  it("parseOfficeFile rejects oversize and non-office", async () => {
    const big = new File(
      [new Uint8Array(OFFICE_ATTACHMENT_MAX_BYTES + 1)],
      "huge.docx",
      {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    );
    await expect(parseOfficeFile(big)).rejects.toThrow(/超过|MB/);

    const img = new File([new Uint8Array([1, 2])], "a.png", {
      type: "image/png",
    });
    await expect(parseOfficeFile(img)).rejects.toThrow(/不支持/);
  });
});
