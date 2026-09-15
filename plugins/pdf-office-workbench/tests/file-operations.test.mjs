import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument } = require('../preload/node_modules/pdf-lib');

async function makePdf(filePath, pageCount) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([240, 160]);
    page.drawText(`page ${index + 1}`);
  }
  await fs.writeFile(filePath, await document.save());
}

test('preload services merge, split and rename real PDF files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-office-workbench-'));
  const previousWindow = globalThis.window;
  globalThis.window = { ztools: {} };
  try {
    require('../preload/services.js');
    const serviceModule = globalThis.window.services;
    const first = path.join(root, 'first.pdf');
    const second = path.join(root, 'second.pdf');
    await makePdf(first, 2);
    await makePdf(second, 1);

    const firstInfo = await serviceModule.readPdfInfo(first);
    assert.equal(firstInfo.pages, 2);

    const merged = await serviceModule.mergePdfs([first, second], path.join(root, 'merged.pdf'));
    assert.equal(merged.pages, 3);
    assert.equal((await serviceModule.readPdfInfo(merged.path)).pages, 3);

    const split = await serviceModule.splitPdf(merged.path, '1-2,3', root);
    assert.deepEqual(split.map(item => item.pages), [2, 1]);
    assert.equal((await serviceModule.readPdfInfo(split[0].path)).pages, 2);

    const renamed = await serviceModule.renameFiles([split[0].path, split[1].path], 'invoice-{index}');
    assert.deepEqual(renamed.map(item => item.name), ['invoice-1.pdf', 'invoice-2.pdf']);
    assert.equal((await serviceModule.readPdfInfo(renamed[1].path)).pages, 1);
  } finally {
    globalThis.window = previousWindow;
    await fs.rm(root, { recursive: true, force: true });
  }
});
