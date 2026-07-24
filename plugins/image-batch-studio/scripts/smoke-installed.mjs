import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { open } from "lmdb";

const require = createRequire(import.meta.url);
const home = os.homedir();
const modernRoot = path.join(home, ".ztools");
const legacyRoot = path.join(home, "Library", "Application Support", "ZTools");
const modernLayout = await fs
  .access(path.join(modernRoot, "version.json"))
  .then(() => true)
  .catch(() => false);
const dataRoot = modernLayout ? modernRoot : legacyRoot;
const installedPlugin = path.join(dataRoot, "plugins", "image-batch-studio");
const dbPath = modernLayout
  ? path.join(dataRoot, "lmdb", "device")
  : path.join(dataRoot, "lmdb");
const processor = require(path.join(installedPlugin, "preload", "processor.js"));

function readInstalledPluginRecord() {
  const env = open({
    path: dbPath,
    mapSize: 2 * 1024 * 1024 * 1024,
    maxDbs: modernLayout ? 6 : 3,
    compression: false,
    encoding: "binary"
  });
  try {
    const mainDb = env.openDB({ name: "main", encoding: "string" });
    const raw = mainDb.get("ZTOOLS/plugins");
    const plugins = raw ? JSON.parse(raw).data : [];
    return Array.isArray(plugins)
      ? plugins.find((plugin) => plugin?.name === "image-batch-studio")
      : undefined;
  } finally {
    env.close();
  }
}

async function makeImage(filePath, width, height, color) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  })
    .png()
    .toFile(filePath);
}

async function makeHeif(filePath, width, height, color) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  })
    .heif({ quality: 80, compression: "av1" })
    .toFile(filePath);
}

async function makePdf(filePath, text) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 120]);
  page.drawText(text, { x: 24, y: 70, size: 18 });
  await fs.writeFile(filePath, await doc.save());
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ztools-image-batch-installed-"));
const out = path.join(dir, "out");
const first = path.join(dir, "first.png");
const second = path.join(dir, "second.png");
const heifInput = path.join(dir, "sample.heif");
await makeImage(first, 96, 64, "#1f766e");
await makeImage(second, 96, 64, "#d39a3d");
await makeHeif(heifInput, 80, 60, "#2b86c8");

const imageResults = await processor.processImages([first, second], {
  output: { directory: out, namingPattern: "{name}-ztools.{ext}", overwrite: false },
  format: { type: "webp", quality: 80 },
  resize: { mode: "exact", width: 48, height: 32, withoutEnlargement: true },
  watermark: {
    enabled: true,
    kind: "text",
    text: "Z",
    position: "center",
    opacity: 0.7,
    fontSize: 16,
    color: "#ffffff",
    margin: 8,
    rotation: 0
  }
});

if (imageResults.some((result) => !result.ok)) {
  throw new Error(`Image processing failed: ${JSON.stringify(imageResults)}`);
}

const joined = path.join(out, "joined.png");
const gif = path.join(out, "motion.gif");
const heifOutput = path.join(out, "converted.heif");
await processor.mergeImages([first, heifInput], joined, {
  layout: "horizontal",
  gap: 4,
  background: "#ffffff"
});
await processor.createGif([first, heifInput], gif, {
  width: 48,
  height: 32,
  delayMs: 100,
  loop: 0,
  background: "#ffffff"
});
const [heifResult] = await processor.processImages([heifInput], {
  output: { directory: out, namingPattern: "converted.{ext}", overwrite: true },
  format: { type: "heif", quality: 72 },
  resize: { mode: "exact", width: 40, height: 30, withoutEnlargement: true }
});
if (!heifResult.ok || heifResult.outputPath !== heifOutput) {
  throw new Error(`HEIF conversion failed: ${JSON.stringify(heifResult)}`);
}

const pdfA = path.join(dir, "a.pdf");
const pdfB = path.join(dir, "b.pdf");
const mergedPdf = path.join(out, "merged.pdf");
await makePdf(pdfA, "A");
await makePdf(pdfB, "B");
await processor.mergePdfs([pdfA, pdfB], mergedPdf);

const webpMeta = await sharp(imageResults[0].outputPath).metadata();
const joinedMeta = await sharp(joined).metadata();
const gifMeta = await sharp(gif, { animated: true }).metadata();
const heifMeta = await sharp(heifOutput).metadata();
const pdf = await PDFDocument.load(await fs.readFile(mergedPdf));

if (webpMeta.format !== "webp" || webpMeta.width !== 48 || webpMeta.height !== 32) {
  throw new Error(`Unexpected WebP metadata: ${JSON.stringify(webpMeta)}`);
}
if (joinedMeta.format !== "png" || joinedMeta.width !== 180 || joinedMeta.height !== 64) {
  throw new Error(`Unexpected joined image metadata: ${JSON.stringify(joinedMeta)}`);
}
if (gifMeta.format !== "gif" || gifMeta.pages !== 2) {
  throw new Error(`Unexpected GIF metadata: ${JSON.stringify(gifMeta)}`);
}
if (heifMeta.format !== "heif" || heifMeta.compression !== "av1" || heifMeta.width !== 40 || heifMeta.height !== 30) {
  throw new Error(`Unexpected HEIF metadata: ${JSON.stringify(heifMeta)}`);
}
if (pdf.getPageCount() !== 2) {
  throw new Error(`Unexpected PDF page count: ${pdf.getPageCount()}`);
}

const installedRecord = readInstalledPluginRecord();
if (!installedRecord) {
  throw new Error("Installed plugin record was not found in ZTools LMDB.");
}
if (!installedRecord.features?.some((feature) => feature.code === "image-batch")) {
  throw new Error(`Installed plugin record is missing image-batch feature: ${JSON.stringify(installedRecord)}`);
}

console.log(JSON.stringify({ ok: true, dir }, null, 2));
