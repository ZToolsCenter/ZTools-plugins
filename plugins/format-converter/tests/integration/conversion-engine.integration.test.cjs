"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const ExcelJS = require("exceljs");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { createPathPolicy } = require("../../preload/path-policy.cjs");
const { createConversionEngine } = require("../../preload/conversion-engine.cjs");
const { probeRuntimes } = require("../../preload/runtime-probe.cjs");

const WORK_ROOT = path.join(__dirname, ".work");

async function createFixture() {
  await fs.rm(WORK_ROOT, { recursive: true, force: true });
  const inputs = path.join(WORK_ROOT, "inputs");
  const outputs = path.join(WORK_ROOT, "outputs");
  await fs.mkdir(inputs, { recursive: true });
  await fs.mkdir(outputs, { recursive: true });
  const textPath = path.join(inputs, "notes.txt");
  const imagePath = path.join(inputs, "sample.png");
  const pdfPath = path.join(inputs, "searchable.pdf");
  await fs.writeFile(textPath, "Name\tScore\nAlice\t98\nBob\t87\n", "utf8");
  await sharp({ create: { width: 96, height: 64, channels: 4, background: "#2f6bff" } }).png().toFile(imagePath);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([300, 200]);
  page.drawText("Format converter integration", { x: 24, y: 150, size: 18, font });
  await fs.writeFile(pdfPath, await pdf.save());
  return { inputs, outputs, textPath, imagePath, pdfPath };
}

async function convert(engine, policy, inputPath, outputRoot, target, profile = "visual", options = {}) {
  const outputDirectory = path.join(outputRoot, `${path.basename(inputPath)}-to-${target}-${profile}`);
  await fs.mkdir(outputDirectory, { recursive: true });
  const inputGrant = await policy.createInputGrant([inputPath]);
  const outputGrant = await policy.createOutputGrant(outputDirectory, false);
  const request = { inputGrantId: inputGrant.id, outputGrantId: outputGrant.id, target, profile, collision: "rename", options };
  const plan = engine.plan(request);
  assert.equal(plan.executable, true, `${inputPath} → ${target} should be executable`);
  const result = await engine.convertItem(plan.items[0], request, outputDirectory, { jobId: "integration", itemId: `${target}-${profile}` });
  assert.ok(result.outputs.length > 0);
  return result.outputs;
}

test("converts text, image, PDF and spreadsheet routes with real engines", async t => {
  const fixture = await createFixture();
  t.after(() => fs.rm(WORK_ROOT, { recursive: true, force: true }));
  const runtimes = await probeRuntimes();
  const policy = createPathPolicy();
  const engine = createConversionEngine({ pathPolicy: policy, runtimes });

  const [jsonPath] = await convert(engine, policy, fixture.textPath, fixture.outputs, "json", "extract");
  assert.match(await fs.readFile(jsonPath, "utf8"), /Alice/);

  const [textPng] = await convert(engine, policy, fixture.textPath, fixture.outputs, "png");
  assert.equal((await sharp(textPng).metadata()).format, "png");
  const [textPdf] = await convert(engine, policy, fixture.textPath, fixture.outputs, "pdf");
  assert.equal((await fs.readFile(textPdf)).subarray(0, 4).toString("ascii"), "%PDF");

  const [jpegPath] = await convert(engine, policy, fixture.imagePath, fixture.outputs, "jpeg");
  assert.equal((await sharp(jpegPath).metadata()).format, "jpeg");
  const [imagePdf] = await convert(engine, policy, fixture.imagePath, fixture.outputs, "pdf");
  assert.equal((await fs.readFile(imagePdf)).subarray(0, 4).toString("ascii"), "%PDF");

  const [pdfPng] = await convert(engine, policy, fixture.pdfPath, fixture.outputs, "png");
  assert.equal((await sharp(pdfPng).metadata()).format, "png");
  const [pdfText] = await convert(engine, policy, fixture.pdfPath, fixture.outputs, "txt", "extract");
  assert.match(await fs.readFile(pdfText, "utf8"), /Format converter integration/);

  const [xlsxPath] = await convert(engine, policy, fixture.textPath, fixture.outputs, "xlsx", "editable");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  assert.equal(workbook.worksheets[0].getCell("A2").value, "Alice\t98");

  const officecli = runtimes.find(runtime => runtime.id === "officecli" && runtime.available);
  if (!officecli) {
    t.diagnostic("OfficeCLI is unavailable; conditional DOCX/PPTX generation was skipped.");
    return;
  }
  const [docxPath] = await convert(engine, policy, fixture.textPath, fixture.outputs, "docx", "editable");
  const [pptxPath] = await convert(engine, policy, fixture.textPath, fixture.outputs, "pptx", "editable");
  assert.equal((await fs.readFile(docxPath)).subarray(0, 4).toString("hex"), "504b0304");
  assert.equal((await fs.readFile(pptxPath)).subarray(0, 4).toString("hex"), "504b0304");
});
