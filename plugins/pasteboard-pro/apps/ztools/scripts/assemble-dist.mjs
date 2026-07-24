import assert from "node:assert/strict";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const buildRoot = path.join(appRoot, "dist");
const helperPath = path.join(
  appRoot,
  "native",
  "vision-helper",
  "dist",
  "pasteboard-vision",
);
const outputRoot = path.resolve(appRoot, "../../dist/ztools");

async function filesRecursively(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(root, relative)));
    else files.push(relative);
  }
  return files;
}

export async function verifyAssembledPackage(root) {
  const manifest = JSON.parse(
    await readFile(path.join(root, "plugin.json"), "utf8"),
  );
  for (const relative of [
    manifest.main,
    manifest.preload,
    manifest.logo,
    "package.json",
    "pasteboard-vision",
  ]) {
    assert.equal(typeof relative, "string");
    assert.equal((await stat(path.join(root, relative))).isFile(), true);
  }

  const helper = await stat(path.join(root, "pasteboard-vision"));
  assert.notEqual(helper.mode & 0o111, 0, "Vision helper must be executable");

  const files = await filesRecursively(root);
  const forbidden = files.filter(
    (file) =>
      file.endsWith(".map") ||
      file.includes(`${path.sep}node_modules${path.sep}`) ||
      /(?:\.sqlite|\.db|credentials|secrets?\.json)$/iu.test(file),
  );
  assert.deepEqual(forbidden, []);
  return { files: files.sort(), manifest };
}

export async function assemblePackage() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await cp(buildRoot, outputRoot, { recursive: true });
  await cp(helperPath, path.join(outputRoot, "pasteboard-vision"));
  return verifyAssembledPackage(outputRoot);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const verifyOnly = process.argv.includes("--verify-only");
  const result = verifyOnly
    ? await verifyAssembledPackage(outputRoot)
    : await assemblePackage();
  console.log(`PasteboardPro ZTools package verified (${result.files.length} files)`);
}
