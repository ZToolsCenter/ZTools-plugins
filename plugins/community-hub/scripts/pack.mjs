import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asar = process.argv[2] ? await import(pathToFileURL(path.resolve(process.argv[2])).href) : await import('@electron/asar');
const config = JSON.parse(await fs.readFile(path.join(root, 'plugin.json'), 'utf8'));
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-community-hub-pack-'));
try {
const staging = path.join(temporaryRoot, 'source');
await fs.mkdir(staging);
const files = ['plugin.json', 'index.html', 'reader.css', 'reader.js', 'reader-core.js', 'preload.js', 'transport.cjs', 'layout.js', 'avatars.js', 'media.js', 'enhancements.css', 'logo.png', 'logo.svg', 'README.md', 'CHANGELOG.md'];
for (const file of files) await fs.copyFile(path.join(root, file), path.join(staging, file));
await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
const archive = path.join(temporaryRoot, 'community-hub.asar');
await asar.createPackage(staging, archive);
const archiveBytes = await fs.readFile(archive);
const compressed = brotliCompressSync(archiveBytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
if (!archiveBytes.equals(brotliDecompressSync(compressed))) throw new Error('压缩包校验失败。');
for (const file of files) if (!asar.extractFile(archive, file).equals(await fs.readFile(path.join(root, file)))) throw new Error('文件校验失败：' + file);
const output = path.join(root, `outputs/community-hub-v${config.version}.zpx`);
await fs.writeFile(output, compressed);
console.log(JSON.stringify({ output, files: files.length, size: compressed.length, sha256: createHash('sha256').update(compressed).digest('hex') }, null, 2));
} finally {
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('ztools-community-hub-pack-')) throw new Error('临时目录路径校验失败。');
  await fs.rm(resolved, { recursive: true, force: true });
}
