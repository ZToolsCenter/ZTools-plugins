'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

let jpegCodecsPromise;
let oxipngPromise;

/**
 * 把 Buffer 或 TypedArray 精确转换为独立 ArrayBuffer。
 */
function toArrayBuffer(value) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

/**
 * 加载并显式初始化 JPEG WebAssembly 编解码器。
 */
async function loadJpegCodecs() {
  if (!jpegCodecsPromise) {
    jpegCodecsPromise = (async () => {
      const [decoder, encoder, decoderWasm, encoderWasm] = await Promise.all([
        import('@jsquash/jpeg/decode.js'),
        import('@jsquash/jpeg/encode.js'),
        fsp.readFile(require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')),
        fsp.readFile(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))
      ]);
      decoder.init(await WebAssembly.compile(decoderWasm));
      encoder.init(await WebAssembly.compile(encoderWasm));
      return { decode: decoder.default, encode: encoder.default };
    })();
  }
  return jpegCodecsPromise;
}

/**
 * 加载并显式初始化 OxiPNG WebAssembly 优化器。
 */
async function loadOxipng() {
  if (!oxipngPromise) {
    oxipngPromise = (async () => {
      const module = await import('@jsquash/oxipng/optimise.js');
      const wasm = await fsp.readFile(require.resolve('@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm'));
      await module.init(await WebAssembly.compile(wasm));
      return module.default;
    })();
  }
  return oxipngPromise;
}

/**
 * 使用 MozJPEG WebAssembly 重新编码 JPEG。
 * 质量 85 在肉眼上几乎无损（含文字与锐利边缘），仍有可观的压缩收益。
 */
async function compressJpeg(buffer) {
  const { decode, encode } = await loadJpegCodecs();
  const image = await decode(toArrayBuffer(buffer));
  const output = await encode(image, {
    quality: 85,
    chroma_quality: 85,
    progressive: true,
    optimize_coding: true,
    trellis_multipass: false
  });
  return Buffer.from(output);
}

/**
 * 使用 OxiPNG WebAssembly 无损优化 PNG。
 */
async function compressPng(buffer) {
  const optimise = await loadOxipng();
  const output = await optimise(toArrayBuffer(buffer), {
    level: 3,
    interlace: false,
    optimiseAlpha: true
  });
  return Buffer.from(output);
}

/**
 * 清除画布中指定矩形区域。
 */
function clearRect(canvas, canvasWidth, dims) {
  for (let y = 0; y < dims.height; y++) {
    const rowStart = ((dims.top + y) * canvasWidth + dims.left) * 4;
    canvas.fill(0, rowStart, rowStart + dims.width * 4);
  }
}

/**
 * 把 GIF 帧补丁合成到完整 RGBA 画布。
 */
function applyGifPatch(canvas, canvasWidth, frame) {
  const { dims, patch } = frame;
  for (let y = 0; y < dims.height; y++) {
    for (let x = 0; x < dims.width; x++) {
      const sourceOffset = (y * dims.width + x) * 4;
      if (patch[sourceOffset + 3] === 0) continue;
      const targetOffset = ((dims.top + y) * canvasWidth + dims.left + x) * 4;
      canvas.set(patch.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
}

/**
 * 读取 GIF 的循环次数；缺少 Netscape 扩展时按无限循环处理。
 */
function getGifRepeatCount(parsed) {
  const applicationFrame = parsed.frames.find(frame => frame.application && frame.application.id === 'NETSCAPE2.0');
  const blocks = applicationFrame && applicationFrame.application && applicationFrame.application.blocks;
  if (!blocks || blocks.length < 3 || blocks[0] !== 1) return 0;
  return blocks[1] | (blocks[2] << 8);
}

/**
 * 用纯 JavaScript 解码并重新编码 GIF，保留动画帧与时序。
 */
async function compressGif(buffer) {
  const { parseGIF, decompressFrames } = require('gifuct-js');
  const { GIFEncoder, quantize, applyPalette } = require('gifenc');
  const parsed = parseGIF(toArrayBuffer(buffer));
  const frames = decompressFrames(parsed, true);
  if (frames.length === 0) throw new Error('GIF 中没有可用帧');

  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const canvas = new Uint8ClampedArray(width * height * 4);
  const repeat = getGifRepeatCount(parsed);
  const encoder = GIFEncoder();
  let previousFrame = null;
  let savedCanvas = null;

  for (let i = 0; i < frames.length; i++) {
    if (previousFrame) {
      if (previousFrame.disposalType === 2) {
        clearRect(canvas, width, previousFrame.dims);
      } else if (previousFrame.disposalType === 3 && savedCanvas) {
        canvas.set(savedCanvas);
      }
    }

    const frame = frames[i];
    if (frame.disposalType === 3) savedCanvas = canvas.slice();
    applyGifPatch(canvas, width, frame);

    const palette = quantize(canvas, 256, {
      format: 'rgba4444',
      oneBitAlpha: true,
      clearAlpha: true
    });
    const indexed = applyPalette(canvas, palette, 'rgba4444');
    const transparentIndex = palette.findIndex(color => color[3] === 0);
    encoder.writeFrame(indexed, width, height, {
      palette,
      delay: frame.delay || 0,
      repeat,
      dispose: 1,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0
    });
    previousFrame = frame;
  }

  encoder.finish();
  return Buffer.from(encoder.bytes());
}

/**
 * 使用 SVGO 优化 SVG。
 */
async function compressSvg(buffer) {
  const { optimize } = require('svgo');
  const result = optimize(buffer.toString('utf8'), {
    multipass: true,
    plugins: [{
      name: 'preset-default',
      params: { overrides: { removeViewBox: false } }
    }]
  });
  return result && result.data ? Buffer.from(result.data, 'utf8') : buffer;
}

/**
 * 按文件扩展名选择压缩器。
 */
async function compressByName(name, buffer) {
  switch (path.extname(name).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return compressJpeg(buffer);
    case '.png':
      return compressPng(buffer);
    case '.gif':
      return compressGif(buffer);
    case '.svg':
      return compressSvg(buffer);
    default:
      return buffer;
  }
}

module.exports = {
  compressByName,
  compressGif,
  compressJpeg,
  compressPng,
  compressSvg
};
