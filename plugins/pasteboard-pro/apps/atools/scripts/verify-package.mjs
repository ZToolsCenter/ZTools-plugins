import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));

async function files(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) output.push(...await files(directory, relative));
    else output.push(relative);
  }
  return output;
}

const manifest = JSON.parse(await readFile(path.join(root, "plugin.json"), "utf8"));
for (const relative of [manifest.main, manifest.logo, "package.json"]) {
  assert.equal((await stat(path.join(root, relative))).isFile(), true);
}
const output = await files(root);
assert.deepEqual(output.filter((file) => file.endsWith(".map") || file.includes("node_modules")), []);
console.log(`PasteboardPro ATools package verified (${output.length} files)`);
