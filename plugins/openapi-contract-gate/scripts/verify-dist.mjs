import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWithinDistSizeLimit, directoryBytes } from './dist-size.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

for (const file of ['plugin.json', 'main/index.html', 'preload/index.cjs', 'core/contract.js', 'logo.svg', 'preload/node_modules/yaml/package.json']) {
  await access(path.join(dist, file));
}

const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json')));
if (manifest.development) throw new Error('development leaked');
if (manifest.main !== 'main/index.html' || manifest.preload !== 'preload/index.cjs' || manifest.logo !== 'logo.svg') {
  throw new Error('dist manifest does not use self-contained release entries');
}

const declared = Object.keys(manifest.tools || {}).sort();
if (JSON.stringify(declared) !== JSON.stringify(['compare_approved_files', 'compare_inline'])) {
  throw new Error('dist MCP tool declarations are incomplete');
}
const preload = await readFile(path.join(dist, manifest.preload), 'utf8');
for (const name of declared) {
  if (!preload.includes(`'${name}'`)) throw new Error(`dist preload does not register ${name}`);
}

const bytes = await directoryBytes(dist);
assertWithinDistSizeLimit(bytes);
console.log(`openapi-contract-gate dist verified: ${bytes} bytes (14.5 MB safety limit)`);
