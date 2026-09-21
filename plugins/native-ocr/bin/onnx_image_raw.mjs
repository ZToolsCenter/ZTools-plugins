// 图像解码（PNG / JPEG / BMP；WebP 等不支持格式显式报错）。
// 从 onnx_formula_server.mjs 抽取为独立模块，供公式引擎与 MFD 引擎共用，
// 避免在 onnx_formula_server.mjs 顶层调用 main()，从而可被 import。
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

export class ImageRaw {
  constructor({ data, width, height }) {
    // data: RGBA Uint8ClampedArray，length = width*height*4
    this.data = data;
    this.width = width;
    this.height = height;
  }

  static decode(buf, filePath) {
    const lower = String(filePath || '').toLowerCase();
    const isPng = lower.endsWith('.png')
      || (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47);
    const isJpeg = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      || (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff);
    const isBmp = lower.endsWith('.bmp') || (buf[0] === 0x42 && buf[1] === 0x4d);
    if (isPng) {
      const d = PNG.sync.read(buf);
      return new ImageRaw({ data: new Uint8Array(d.data), width: d.width, height: d.height });
    }
    if (isBmp) return ImageRaw.decodeBmp(buf);
    if (isJpeg) {
      const d = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
      return new ImageRaw({ data: new Uint8Array(d.data), width: d.width, height: d.height });
    }
    throw new Error('unsupported image format (only PNG/JPEG/BMP supported)');
  }

  // 手写 BMP 解码（24/32 bpp，兼容底向上/顶向下），返回 RGBA。
  static decodeBmp(buf) {
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

  static async open(filePath) {
    const buf = await readFileSync(filePath);
    return ImageRaw.decode(buf, filePath);
  }
}

// 供 MFD/公式引擎之外的调用方做 BMP 探测时复用。
export function isBmp(buf) {
  return buf[0] === 0x42 && buf[1] === 0x4d;
}
