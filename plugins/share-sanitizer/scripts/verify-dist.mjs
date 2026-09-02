import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistSize, directoryBytes } from './dist-size.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8'));
if (manifest.development) throw new Error('development leaked');
for (const file of [manifest.main, manifest.logo, manifest.preload, 'core/sanitize.mjs']) await access(path.join(dist, file));
for (const tool of ['detect_text', 'redact_text']) if (!manifest.tools?.[tool]) throw new Error(`missing MCP tool ${tool}`);
const app = await readFile(path.join(dist, 'app.mjs'), 'utf8');
if (app.includes('../core/')) throw new Error('dist UI import escaped package');
const sourcePreload = await readFile(path.join(root, 'preload', 'index.cjs'), 'utf8');
const distPreload = await readFile(path.join(dist, 'preload', 'index.cjs'), 'utf8');
if (sourcePreload !== distPreload) throw new Error('dist preload is stale');
const distBytes = await directoryBytes(dist);
assertDistSize(distBytes);
console.log(`share-sanitizer dist verified (${distBytes} bytes)`);
