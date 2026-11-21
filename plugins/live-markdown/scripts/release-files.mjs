import fs from "node:fs";
import path from "node:path";

export const MAX_PLUGIN_BYTES = 15_000_000;
export const SOFT_PLUGIN_BYTES = 10_000_000;

export function listFiles(root, relative = "") {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release contains a symbolic link: ${name}`);
      if (entry.isDirectory()) return listFiles(root, name);
      if (!entry.isFile()) throw new Error(`Unsupported release entry: ${name}`);
      return [name];
    });
}

export function assertSizeBudget(bytes, label) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PLUGIN_BYTES) {
    throw new Error(`${label} exceeds the 15,000,000-byte plugin limit (${bytes} bytes)`);
  }
}

export function inspectRelease(root) {
  const files = listFiles(root);
  let bytes = 0;
  for (const file of files) {
    const allowed = /^(?:index\.html|plugin\.json|logo\.svg|README\.md|CHANGELOG\.md|LICENSE|NOTICE|assets\/[^/]+\.(?:js|css|svg|woff2?)|preload\/(?:[\w.-]+\/)*[\w.-]+\.(?:cjs|json))$/;
    if (!allowed.test(file)) throw new Error(`Unexpected file in release: ${file}`);
    bytes += fs.statSync(path.join(root, file)).size;
  }
  assertSizeBudget(bytes, "Unpacked release");
  return { files, bytes, softBudgetExceeded: bytes > SOFT_PLUGIN_BYTES };
}

export function copyPreload(source, target) {
  for (const relative of listFiles(source)) {
    if (!/\.(?:cjs|json)$/.test(relative)) {
      throw new Error(`Preload packaging requires an explicit rule for: ${relative}`);
    }
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, relative), destination);
  }
}
