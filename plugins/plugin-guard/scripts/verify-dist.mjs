import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistSize, directoryBytes } from './dist-size.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8'));
if (manifest.development) throw new Error('development leaked');
for (const file of [manifest.main, manifest.logo, manifest.preload, 'core/guard.mjs']) await access(path.join(dist, file));
if (!manifest.tools?.scan_approved) throw new Error('missing MCP tool scan_approved');
if (/node:|\.\.\/core\//.test(await readFile(path.join(dist, 'app.mjs'), 'utf8'))) throw new Error('renderer imports Node code');
if (await readFile(path.join(root, 'preload', 'index.cjs'), 'utf8') !== await readFile(path.join(dist, 'preload', 'index.cjs'), 'utf8')) throw new Error('dist preload is stale');
if (await readFile(path.join(root, 'src', 'core', 'guard.mjs'), 'utf8') !== await readFile(path.join(dist, 'core', 'guard.mjs'), 'utf8')) throw new Error('dist guard core is stale');

const distBytes = await directoryBytes(dist);
assertDistSize(distBytes);
console.log(`plugin-guard dist verified (${distBytes} bytes)`);
