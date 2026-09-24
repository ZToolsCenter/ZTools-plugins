import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const deflateRaw = promisify(zlib.deflateRaw);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const maxBytes = 15_000_000;
const estimationLimit = 14_500_000;

async function filesIn(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

let estimatedZipBytes = 22;
for (const filePath of await filesIn(dist)) {
  const relativePath = path.relative(dist, filePath).split(path.sep).join("/");
  const content = await fs.readFile(filePath);
  const compressed = await deflateRaw(content, { level: 9 });
  estimatedZipBytes += compressed.byteLength + 76 + Buffer.byteLength(relativePath) * 2;
}

if (estimatedZipBytes > estimationLimit) {
  throw new Error(
    `Estimated plugin ZIP is ${(estimatedZipBytes / 1_000_000).toFixed(2)}MB, exceeding the 14.5MB safety budget for EdgeOne's 15MB limit`
  );
}

console.log(JSON.stringify({ ok: true, estimatedZipBytes, estimationLimit, maxBytes }, null, 2));
