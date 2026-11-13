import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const files = {}, manifest = JSON.parse(readFileSync('dist/plugin.json', 'utf8'));
const html = readFileSync(`dist/${manifest.main}`, 'utf8');
const assetReferences = new Set([...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g)].map(match => match[1]));
// HTML references only the entry chunk. Vite's manifest also describes lazy and shared chunks.
const buildManifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
for (const chunk of Object.values(buildManifest)) {
  for (const file of [chunk.file, ...(chunk.css || []), ...(chunk.assets || [])]) if (file) assetReferences.add(file);
}
function collect(folder, prefix = '') {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (relative === '.vite') continue;
    if (relative.startsWith('assets/') && !entry.isDirectory() && !assetReferences.has(relative)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed: ${relative}`);
    if (entry.isDirectory()) collect(join(folder, entry.name), relative + '/');
    else files[relative] = new Uint8Array(readFileSync(join(folder, entry.name)));
  }
}
collect('dist');
if (manifest.development) throw new Error('Production manifest contains development settings');
for (const entry of [manifest.main, manifest.preload, manifest.logo]) if (!files[entry]) throw new Error(`Missing ${entry}`);
for (const entry of assetReferences) if (!files[entry]) throw new Error(`Missing build asset: ${entry}`);
mkdirSync('release', { recursive: true });
const filename = `程序坞-${manifest.version}-windows.zip`;
const zip = zipSync(files, { level: 9 });
writeFileSync(`release/${filename}`, zip);
const hash = createHash('sha256').update(zip).digest('hex');
writeFileSync(`release/${filename}.sha256`, `${hash}  ${filename}\n`);
writeFileSync('release/files.sha256.json', JSON.stringify(Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, createHash('sha256').update(bytes).digest('hex')])), null, 2));
console.log(JSON.stringify({ filename, bytes: zip.length, files: Object.keys(files).length, sha256: hash }, null, 2));
