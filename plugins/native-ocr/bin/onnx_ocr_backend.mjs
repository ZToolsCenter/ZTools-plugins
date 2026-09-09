// ONNX OCR backend for the native-ocr ZTools plugin.
// Loaded via dynamic import() from preload.js. Lives in the plugin runtime
// directory next to a flat node_modules/ (see preload ONNX_RUNTIME_MANIFEST).
//
// Zero native deps besides onnxruntime-node (prebuilt N-API binary):
//   - images decoded with pngjs / jpeg-js (pure JS)
//   - resize implemented here (bilinear), replacing sharp
//   - @gutenye/ocr-common provides detection/recognition + opencv-js (WASM)

import fs from 'node:fs/promises';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { InferenceSession } from 'onnxruntime-node';
import BaseOcr, { registerBackend } from '@gutenye/ocr-common';
import { splitIntoLineImages } from '@gutenye/ocr-common/splitIntoLineImages';

class FileUtils {
  static async read(path) {
    return fs.readFile(path, 'utf8');
  }
}

class ImageRaw {
  data;
  width;
  height;
  constructor({ data, width, height }) {
    this.data = data;
    this.width = width;
    this.height = height;
  }

  static decode(buf, path) {
    const lower = String(path || '').toLowerCase();
    if (lower.endsWith('.png') || (buf[0] === 0x89 && buf[1] === 0x50)) {
      const decoded = PNG.sync.read(buf);
      return new ImageRaw({ data: new Uint8Array(decoded.data), width: decoded.width, height: decoded.height });
    }
    if (lower.endsWith('.bmp')) {
      return ImageRaw.decodeBmp(buf);
    }
    const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return new ImageRaw({ data: new Uint8Array(decoded.data), width: decoded.width, height: decoded.height });
  }

  static decodeBmp(buf) {
    // Uncompressed 24/32-bit BMP only (screenshots are png; bmp is a fallback).
    if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('not a bmp file');
    const dataOffset = buf.readUInt32LE(10);
    const width = buf.readInt32LE(18);
    const heightSigned = buf.readInt32LE(22);
    const bpp = buf.readUInt16LE(28);
    if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported bmp bpp: ${bpp}`);
    const bottomUp = heightSigned > 0;
    const height = Math.abs(heightSigned);
    const bytesPerPx = bpp / 8;
    const rowSize = Math.ceil((width * bytesPerPx) / 4) * 4;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const srcY = bottomUp ? height - 1 - y : y;
      for (let x = 0; x < width; x += 1) {
        const si = dataOffset + srcY * rowSize + x * bytesPerPx;
        const di = (y * width + x) * 4;
        data[di] = buf[si + 2];
        data[di + 1] = buf[si + 1];
        data[di + 2] = buf[si];
        data[di + 3] = 255;
      }
    }
    return new ImageRaw({ data, width, height });
  }

  static async open(path) {
    const buf = await fs.readFile(path);
    return ImageRaw.decode(buf, path);
  }

  async resize({ width, height }) {
    if (!width) width = Math.max(1, Math.round((this.width * height) / this.height));
    if (!height) height = Math.max(1, Math.round((this.height * width) / this.width));
    const src = this.data;
    const dst = new Uint8Array(width * height * 4);
    const sx = this.width / width;
    const sy = this.height / height;
    for (let y = 0; y < height; y += 1) {
      const fy = Math.min(this.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(this.height - 1, y0 + 1);
      const wy = fy - y0;
      for (let x = 0; x < width; x += 1) {
        const fx = Math.min(this.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(this.width - 1, x0 + 1);
        const wx = fx - x0;
        const di = (y * width + x) * 4;
        for (let c = 0; c < 4; c += 1) {
          const p00 = src[(y0 * this.width + x0) * 4 + c];
          const p01 = src[(y0 * this.width + x1) * 4 + c];
          const p10 = src[(y1 * this.width + x0) * 4 + c];
          const p11 = src[(y1 * this.width + x1) * 4 + c];
          dst[di + c] = (p00 * (1 - wx) + p01 * wx) * (1 - wy)
            + (p10 * (1 - wx) + p11 * wx) * wy;
        }
      }
    }
    return new ImageRaw({ data: dst, width, height });
  }
}

registerBackend({
  FileUtils,
  ImageRaw,
  InferenceSession,
  splitIntoLineImages,
  defaultModels: undefined,
});

let ocrInstance = null;
let ocrModels = null;

export async function ensureOcr(models) {
  const signature = JSON.stringify(models);
  if (ocrInstance && ocrModels === signature) {
    return ocrInstance;
  }
  ocrInstance = await BaseOcr.create({ models });
  ocrModels = signature;
  return ocrInstance;
}

export async function detectText(models, imagePath) {
  const ocr = await ensureOcr(models);
  const lines = await ocr.detect(imagePath);
  const source = await ImageRaw.open(imagePath);
  return {
    width: source.width,
    height: source.height,
    lines: lines.map((line) => ({
      text: String(line.text || ''),
      box: line.box || null,
    })),
  };
}
