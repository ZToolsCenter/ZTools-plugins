import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWithinDistSizeLimit, directoryBytes } from './dist-size.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8'));
if (manifest.development) throw new Error('development leaked');
for (const file of [manifest.main, manifest.logo, manifest.preload, 'core/archive.mjs']) await access(path.join(dist, file));
const expectedTools = ['inspect_approved_zip', 'plan_approved_zip'];
if (JSON.stringify(Object.keys(manifest.tools || {}).sort()) !== JSON.stringify(expectedTools)) throw new Error('MCP tool declarations are missing or unexpected');
for (const name of expectedTools) {
  const schema = manifest.tools[name]?.inputSchema;
  if (!schema || schema.type !== 'object' || schema.additionalProperties !== false) throw new Error(`MCP tool ${name} is not strict`);
}
if ((await readFile(path.join(dist, 'app.mjs'), 'utf8')).includes('../core/')) throw new Error('dist UI import escaped package');
if (await readFile(path.join(root, 'preload', 'index.cjs'), 'utf8') !== await readFile(path.join(dist, 'preload', 'index.cjs'), 'utf8')) throw new Error('dist preload is stale');

const distBytes = await directoryBytes(dist);
assertWithinDistSizeLimit(distBytes);
console.log(`archive-workbench dist verified (${distBytes} bytes)`);
