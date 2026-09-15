/**
 * 生成插件 Logo（256x256 PNG），零第三方依赖
 * 图案：深蓝渐变圆角背景 + 白色 ">" 与高亮 "_" 终端提示符（点阵绘制）
 */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const RADIUS = 52;
const pixels = new Uint8Array(SIZE * SIZE * 4);

function setPx(x, y, r, g, b, a) {
  const i = (y * SIZE + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

// 1. 圆角渐变背景 #1E3A5F -> #0D172A
const from = [30, 58, 95];
const to = [13, 23, 42];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const cx = Math.min(Math.max(x, RADIUS), SIZE - 1 - RADIUS);
    const cy = Math.min(Math.max(y, RADIUS), SIZE - 1 - RADIUS);
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy > RADIUS * RADIUS) continue;
    const t = (x + y) / (2 * SIZE);
    setPx(
      x,
      y,
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
      255
    );
  }
}

// 2. 点阵字模 ">_"（scale=11）
const glyph = {
  ">": ["#....", ".#...", "..#..", "...#.", "..#..", ".#...", "#...."],
  _: ["......", "......", "######"],
};

function drawGlyph(ch, ox, oy, scale, color) {
  glyph[ch].forEach((row, ry) => {
    row.split("").forEach((c, rx) => {
      if (c !== "#") return;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const x = ox + rx * scale + sx;
          const y = oy + ry * scale + sy;
          if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
          setPx(x, y, color[0], color[1], color[2], 255);
        }
      }
    });
  });
}

drawGlyph(">", 70, 92, 11, [255, 255, 255]); // 55x77, y 92..169
drawGlyph("_", 138, 136, 11, [124, 197, 255]); // 66x33, 底边对齐 169

// 3. PNG 编码
function crc32(buf) {
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32.table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "logo.png");
fs.writeFileSync(outPath, png);
console.log("logo.png 已生成:", SIZE + "x" + SIZE, "->", outPath);
