const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const codec = require('../codec.js');

test('native picker uses host dialog, reads selected image and preserves cancellation', async () => {
  const imagePath = path.join(__dirname, '..', 'logo.png');
  let paths = [imagePath];
  let readCalls = 0;
  let oversized = false;
  const context = {
    Uint8Array,
    window: { ztools: { showOpenDialog(options) {
      assert.equal(options.properties.join(','), 'openFile');
      assert.ok(options.filters[0].extensions.includes('jpeg'));
      return paths;
    } } },
    require(name) {
      if (name === './codec.js') return codec;
      if (name === 'node:fs/promises') return {
        async stat(file) { return oversized ? { isFile: () => true, size: codec.MAX_BYTES + 1 } : fs.stat(file); },
        async readFile(file) { readCalls++; return fs.readFile(file); }
      };
      return require(name);
    }
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '..', 'preload.js'), 'utf8'), context);
  const open = context.window.base64Native.openImage;
  const selected = await open();
  assert.equal(selected.canceled, false);
  assert.equal(selected.name, 'logo.png');
  assert.deepEqual(Buffer.from(selected.bytes), await fs.readFile(imagePath));
  for (paths of [[], undefined]) assert.equal((await open()).canceled, true);
  assert.equal(readCalls, 1);
  paths = [imagePath];
  oversized = true;
  await assert.rejects(open, /20 MB/);
  assert.equal(readCalls, 1, 'oversized images must be rejected before reading');
  oversized = false;
  paths = [path.join(__dirname, '..', 'package.json')];
  await assert.rejects(open, /无法识别/);
  paths = [path.join(__dirname, 'missing-image.png')];
  await assert.rejects(open, /ENOENT/);
});

test('native save preserves bytes, cancellation and write failures', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'base64-test-'));
  try {
    const target = path.join(directory, 'saved.png');
    let selectedPath = target;
    let calls = 0;
    const context = {
      window: { ztools: { showSaveDialog(options) { calls++; assert.equal(options.filters[0].extensions[0], 'png'); return selectedPath; } } },
      require(name) { return name === './codec.js' ? codec : require(name); }
    };
    vm.runInNewContext(await fs.readFile(path.join(__dirname, '..', 'preload.js'), 'utf8'), context);
    const bytes = await fs.readFile(path.join(__dirname, '..', 'logo.png'));
    const save = context.window.base64Native.saveImage;
    assert.equal((await save(bytes.toString('base64'))).canceled, false);
    assert.deepEqual(await fs.readFile(target), bytes);
    selectedPath = undefined;
    assert.equal((await save(bytes.toString('base64'))).canceled, true);
    await assert.rejects(() => save(codec.encodeText('hello')), /图片/);
    assert.equal(calls, 2);
    selectedPath = path.join(directory, 'missing', 'fail.png');
    await assert.rejects(() => save(bytes.toString('base64')), /ENOENT/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
