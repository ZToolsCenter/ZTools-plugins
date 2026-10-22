import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFileDragGrantStore } = require('../preload/file-drag-grants.js');

test('PDF output drag grants expire', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-office-drag-expiry-'));
  const output = path.join(root, 'generated.pdf');
  fs.writeFileSync(output, 'pdf');
  let currentTime = 100;
  const grants = createFileDragGrantStore({
    fs,
    path,
    now: () => currentTime,
    ttlMs: 50,
    requiredExtension: '.pdf'
  });

  try {
    grants.grant(output);
    currentTime = 151;
    assert.throws(() => grants.consume(output), /刚刚由插件生成/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
