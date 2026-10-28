import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('source-manifest.json', 'utf8'));
const actualFiles = [];
async function verify(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    assert(!entry.isSymbolicLink(), 'Unexpected link: ' + name);
    if (entry.isDirectory()) await verify(directory + '/' + entry.name, name + '/');
    else {
      assert(entry.isFile(), 'Unexpected file type: ' + name);
      const bytes = await readFile(directory + '/' + entry.name);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name], 'Payload changed: ' + name);
      actualFiles.push(name);
    }
  }
}
await verify('payload');
assert.deepEqual(actualFiles.sort(), Object.keys(manifest.files).sort(), 'Payload file list changed');
await mkdir('dist');
for (const name of await readdir('payload')) await cp('payload/' + name, 'dist/' + name, { recursive: true, force: false, errorOnExist: true });
console.log('Verified Askills payload copied to dist. Native Rust source is in source/src-tauri.');
