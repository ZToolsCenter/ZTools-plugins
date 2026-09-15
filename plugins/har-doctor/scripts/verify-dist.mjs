import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistSize, directoryBytes } from './dist-size.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

for (const file of ['plugin.json', 'main/index.html', 'preload/index.cjs', 'core/analyze.js', 'logo.svg']) await access(path.join(dist, file));
const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8'));
if (manifest.development || manifest.main !== 'main/index.html') throw new Error('Invalid dist manifest');
for (const tool of ['analyze_inline', 'analyze_approved_files']) if (!manifest.tools?.[tool]) throw new Error(`missing MCP tool ${tool}`);
if (await readFile(path.join(root, 'src', 'preload', 'index.cjs'), 'utf8') !== await readFile(path.join(dist, 'preload', 'index.cjs'), 'utf8')) throw new Error('dist preload is stale');
if (await readFile(path.join(root, 'src', 'core', 'analyze.js'), 'utf8') !== await readFile(path.join(dist, 'core', 'analyze.js'), 'utf8')) throw new Error('dist analyze core is stale');

const distBytes = await directoryBytes(dist);
assertDistSize(distBytes);
console.log(`har-doctor dist verified (${distBytes} bytes)`);
