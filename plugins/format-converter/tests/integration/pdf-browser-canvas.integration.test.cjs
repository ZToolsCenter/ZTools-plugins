"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const napiCanvas = require("@napi-rs/canvas");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const root = path.join(__dirname, ".work-browser-canvas");

test("renders PDF through the Chromium-compatible Canvas branch", async t => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  globalThis.DOMMatrix = napiCanvas.DOMMatrix;
  globalThis.ImageData = napiCanvas.ImageData;
  globalThis.Path2D = napiCanvas.Path2D;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      const backing = napiCanvas.createCanvas(1, 1);
      return {
        get width() { return backing.width; }, set width(value) { backing.width = value; },
        get height() { return backing.height; }, set height(value) { backing.height = value; },
        getContext: (...args) => backing.getContext(...args),
        toDataURL: (...args) => backing.toDataURL(...args)
      };
    }
  };
  const { renderPdfPages } = require("../../preload/pdf-converter.cjs");
  const source = path.join(root, "source.pdf");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([240, 160]).drawText("Browser canvas", { x: 20, y: 110, size: 18, font });
  await fs.writeFile(source, await document.save());
  const [output] = await renderPdfPages(source, path.join(root, "page"), "png", { dpi: 72, maxPdfBytes: 1024 * 1024 });
  const bytes = await fs.readFile(output);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
