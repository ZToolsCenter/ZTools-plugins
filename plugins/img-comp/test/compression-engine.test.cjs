'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compressByName } = require('../compression-engine');

/**
 * 构造带多余内容的 SVG 测试数据。
 */
function createSvg() {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><!--comment--><rect width="100" height="100" fill="#123456"/><circle cx="50" cy="50" r="20" fill="#ffffff"/></svg>');
}

test('SVG 压缩会保留 viewBox 并减小文件', async () => {
  const input = createSvg();
  const output = await compressByName('icon.svg', input);
  assert.ok(output.length < input.length);
  assert.match(output.toString('utf8'), /viewBox="0 0 100 100"/);
});

test('未知格式保持原始字节', async () => {
  const input = Buffer.from('raw-data');
  const output = await compressByName('note.txt', input);
  assert.strictEqual(output, input);
});

test('GIF 重新编码会保留动画帧和循环次数', async () => {
  const { GIFEncoder, quantize, applyPalette } = require('gifenc');
  const { parseGIF, decompressFrames } = require('gifuct-js');
  const encoder = GIFEncoder();
  for (let frameIndex = 0; frameIndex < 3; frameIndex++) {
    const rgba = new Uint8ClampedArray(32 * 24 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = frameIndex * 70;
      rgba[i + 1] = (i / 4) % 255;
      rgba[i + 2] = 180;
      rgba[i + 3] = 255;
    }
    const palette = quantize(rgba, 64);
    const indexed = applyPalette(rgba, palette);
    encoder.writeFrame(indexed, 32, 24, { palette, delay: 80, repeat: 0 });
  }
  encoder.finish();
  const output = await compressByName('animation.gif', Buffer.from(encoder.bytes()));
  const frames = decompressFrames(parseGIF(output), true);
  assert.equal(frames.length, 3);
  assert.equal(frames[0].delay, 80);
  assert.equal(parseGIF(output).frames[0].application.blocks[1] | (parseGIF(output).frames[0].application.blocks[2] << 8), 0);
});

test('JPEG 和 PNG 的 WASM 编解码器可初始化', async () => {
  const encoderModule = await import('@jsquash/jpeg/encode.js');
  const encoderWasm = await WebAssembly.compile(
    require('node:fs').readFileSync(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))
  );
  encoderModule.init(encoderWasm);
  const pixels = new Uint8ClampedArray(32 * 24 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i / 4) % 255;
    pixels[i + 1] = 120;
    pixels[i + 2] = 180;
    pixels[i + 3] = 255;
  }
  const jpeg = Buffer.from(await encoderModule.default({ data: pixels, width: 32, height: 24 }, { quality: 95 }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAAH0lEQVR4AWK0qdhygoECwESBXrDWUQMYRsMAsEERBgDLzgJIlzEaHwAAAABJRU5ErkJggg==', 'base64');
  const jpegOutput = await compressByName('photo.jpg', jpeg);
  const pngOutput = await compressByName('graphic.png', png);
  assert.equal(jpegOutput.subarray(0, 2).toString('hex'), 'ffd8');
  assert.equal(pngOutput.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
