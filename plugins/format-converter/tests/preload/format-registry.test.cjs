"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { detectFormatByPath, normalizeFormat, sniffMagic, buildRoute, buildAllRoutes } = require("../../preload/format-registry.cjs");

const runtimes = [
  { id: "officecli", available: true }, { id: "browser", available: true }, { id: "libreoffice", available: false },
  { id: "sharp", available: true }, { id: "pdf", available: true }, { id: "ocr", available: true }
];

test("normalizes aliases and detects every declared input family", () => {
  assert.equal(normalizeFormat(".jpg"), "jpeg");
  assert.equal(normalizeFormat("TIF"), "tiff");
  assert.equal(normalizeFormat("htm"), "html");
  assert.equal(detectFormatByPath("/tmp/report.docx"), "docx");
  assert.equal(detectFormatByPath("/tmp/scan.gif"), "gif");
  assert.equal(detectFormatByPath("/tmp/legacy.bmp"), "bmp");
});

test("uses magic bytes to reject disguised binary content", () => {
  assert.equal(sniffMagic(Buffer.from("%PDF-1.7"), "pdf"), "pdf");
  assert.equal(sniffMagic(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), "png"), "png");
  assert.equal(sniffMagic(Buffer.from("MZ\0\0"), "txt"), "txt");
  assert.equal(sniffMagic(Buffer.from([0,0,0,0,0,0,0,0]), "txt"), null);
});

test("routes expose quality, dependencies, availability and multi-output", () => {
  const pdfImages = buildRoute("pdf", "png", "visual", runtimes);
  assert.equal(pdfImages.available, true);
  assert.equal(pdfImages.multiOutput, true);
  assert.deepEqual(pdfImages.engines, ["pdf"]);

  const officePdf = buildRoute("docx", "pdf", "visual", runtimes);
  assert.equal(officePdf.available, true);
  assert.equal(officePdf.quality, "visual");

  const missing = buildRoute("png", "txt", "editable", runtimes.map(item => item.id === "ocr" ? { ...item, available: false } : item));
  assert.equal(missing.available, false);
  assert.ok(buildAllRoutes(runtimes).length > 500);
});
