import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWithinDistSizeLimit, directoryBytes } from './dist-size.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

for (const file of ['plugin.json', 'main/index.html', 'preload/index.cjs', 'core/server.cjs', 'logo.svg']) {
  await access(path.join(dist, file));
}

const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json')));
if (manifest.development) throw new Error('development leaked');
if (manifest.main !== 'main/index.html' || manifest.preload !== 'preload/index.cjs' || manifest.logo !== 'logo.svg') {
  throw new Error('dist manifest does not use self-contained release entries');
}

const expected = ['hmac', 'preview_payload'];
if (JSON.stringify(Object.keys(manifest.tools || {}).sort()) !== JSON.stringify(expected)) {
  throw new Error('MCP tool declarations are missing or unexpected');
}
for (const name of expected) {
  const schema = manifest.tools[name]?.inputSchema;
  if (!schema || schema.type !== 'object' || schema.additionalProperties !== false) {
    throw new Error(`MCP tool ${name} is not strict`);
  }
}

const source = await readFile(path.join(root, 'src', 'preload', 'index.cjs'), 'utf8');
const built = await readFile(path.join(dist, 'preload', 'index.cjs'), 'utf8');
if (source !== built) throw new Error('dist preload is stale');

const bytes = await directoryBytes(dist);
assertWithinDistSizeLimit(bytes);
console.log(`webhook-lab dist verified: ${bytes} bytes (14.5 MB safety limit)`);
