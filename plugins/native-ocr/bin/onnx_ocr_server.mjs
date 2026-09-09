// ONNX OCR persistent server for the native-ocr ZTools plugin.
// Runs under Electron's bundled Node via ELECTRON_RUN_AS_NODE=1 (no system
// Node required). Must live inside the ONNX runtime directory so that ESM
// imports resolve against its flat node_modules/.
//
// Protocol (newline-delimited JSON over stdin/stdout, same as the other
// plugin servers):
//   <- {"id": 1, "imagePath": "/path/img.png"}
//   -> {"event": "ready"}
//   -> {"id": 1, "ok": true, "width": W, "height": H, "items": [
//        {"text": str, "box": [[x,y]x4]} ]}
//   -> {"id": 1, "ok": false, "error": "..."}
//   -> {"event": "fatal", "error": "..."}
// Boxes are pixel coordinates in the source image, top-left origin.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { InferenceSession } from 'onnxruntime-node';
import BaseOcr, { registerBackend } from '@gutenye/ocr-common';
import { splitIntoLineImages } from '@gutenye/ocr-common/splitIntoLineImages';
// Detection/Recognition 未从包根导出（exports 限制），走运行时扁平 node_modules 的相对路径
import { Detection, Recognition } from './node_modules/@gutenye/ocr-common/build/models/index.js';
import { planTableSplits } from './onnx_table_split.mjs';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const IDLE_TIMEOUT = 15 * 60;

class FileUtils {
  static async read(filePath) {
    return fs.readFile(filePath, 'utf8');
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

  static decode(buf, filePath) {
    const lower = String(filePath || '').toLowerCase();
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
    const buf = await fs.readFile(filePath);
    return ImageRaw.decode(buf, filePath);
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

const MODELS = {
  detectionPath: path.join(RUNTIME_DIR, 'assets', 'ch_PP-OCRv4_det_infer.onnx'),
  recognitionPath: path.join(RUNTIME_DIR, 'assets', 'ch_PP-OCRv4_rec_infer.onnx'),
  dictionaryPath: path.join(RUNTIME_DIR, 'assets', 'ppocr_keys_v1.txt'),
};

// 绕过 Recognition.run 内部 afAfRec 的同行合并（它会把同一中线的多个单元格
// 合并成一个横跨整行的宽框，导致下游表格列聚类退化为 1 列），改为逐张
// line image 独立解码：直接复用 Recognition 的 imageToInput/runModel/decodeText，
// 文本对齐到 det 输出的原始单元格 box。
async function recognizeSingle(recognition, lineImage) {
  const image = await lineImage.image.resize({ height: 48 });
  const modelData = recognition.imageToInput(image, {});
  const output = await recognition.runModel({ modelData, onnxOptions: {} });
  const lines = (recognition.decodeText(output) || []).filter(Boolean);
  const best = lines.sort((a, b) => (b.mean || 0) - (a.mean || 0))[0];
  return best && best.mean >= 0.5 ? String(best.text || '') : '';
}

async function main() {
  for (const file of Object.values(MODELS)) {
    await fs.access(file);
  }
  const ocr = await BaseOcr.create({ models: MODELS });
  // det / rec 分离实例：用于"表格宽行切列后重识别"管线
  const detection = await Detection.create({ models: MODELS });
  const recognition = await Recognition.create({ models: MODELS });

  const timer = setTimeout(() => process.exit(0), IDLE_TIMEOUT * 1000);
  timer.unref?.();

  process.stdout.write(JSON.stringify({ event: 'ready' }) + '\n');

  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk.toString('utf8');
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch (_) {
        continue;
      }
      const response = { id: request.id };
      try {
        const imagePath = String(request.imagePath || '');
        if (!imagePath) throw new Error('imagePath is required');
        const source = await ImageRaw.open(imagePath);
        let detected;
        try {
          // 表格增强管线：det → 宽行切列 → rec（失败时回退整管线）
          const lineImages = await detection.run(imagePath);
          const plan = planTableSplits(lineImages, {
            sourceWidth: source.width,
            sourceHeight: source.height,
            makeImage: (args) => new ImageRaw(args)
          });
          const cells = [];
          for (let index = 0; index < plan.images.length; index += 1) {
            cells.push({
              text: await recognizeSingle(recognition, plan.images[index]),
              box: plan.boxes[index] || plan.images[index].box || null
            });
          }
          if (!cells.length) throw new Error('no cells detected');
          detected = cells;
        } catch (splitError) {
          detected = await ocr.detect(imagePath);
        }
        response.ok = true;
        response.width = source.width;
        response.height = source.height;
        response.items = detected.map((line) => ({
          text: String(line.text || ''),
          box: line.box || null,
        }));
      } catch (error) {
        response.ok = false;
        response.error = error && error.message ? error.message : String(error);
      }
      process.stdout.write(JSON.stringify(response) + '\n');
      timer.refresh?.();
    }
  }
  process.exit(0);
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    event: 'fatal',
    error: error && error.message ? error.message : String(error),
  }) + '\n');
  process.exit(1);
});
