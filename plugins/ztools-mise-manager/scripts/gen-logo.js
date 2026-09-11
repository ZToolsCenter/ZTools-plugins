// 生成插件 logo.png（512x512，深色渐变背景 + 青色 "m" 图形）
// 用法: node scripts/gen-logo.js
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 512;

// ---- PNG 编码 ----
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 绘图 ----
const px = Buffer.alloc(SIZE * SIZE * 4);
function blend(x, y, r, g, b, a) {
  const i = (y * SIZE + x) * 4;
  const sa = a / 255;
  const da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / oa);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
  px[i + 3] = Math.round(oa * 255);
}
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// 1. 背景渐变（对角）
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * SIZE);
    const r = Math.round(26 + (58 - 26) * t);
    const g = Math.round(28 + (46 - 28) * t);
    const b = Math.round(52 + (95 - 52) * t);
    blend(x, y, r, g, b, 255);
  }
}

// 2. 中心圆角方块
const BOX = 380, BOX0 = (SIZE - BOX) / 2, RADIUS = 84;
for (let y = BOX0; y < BOX0 + BOX; y++) {
  for (let x = BOX0; x < BOX0 + BOX; x++) {
    const cx = Math.max(BOX0 + RADIUS, Math.min(BOX0 + BOX - RADIUS, x));
    const cy = Math.max(BOX0 + RADIUS, Math.min(BOX0 + BOX - RADIUS, y));
    if (dist(x, y, cx, cy) <= RADIUS + 0.5) {
      blend(x, y, 43, 47, 74, 255);
    }
  }
}

// 3. 青色 "m"（三竖条 + 两个顶拱）
const C = [79, 214, 190]; // #4FD6BE
const BAR_Y0 = 250, BAR_Y1 = 335, BAR_W = 44;
const bars = [
  { x0: 128, x1: 128 + BAR_W, cx: 128 + BAR_W / 2, cy: 250 },
  { x0: 234, x1: 234 + BAR_W, cx: 234 + BAR_W / 2, cy: 250 },
  { x0: 340, x1: 340 + BAR_W, cx: 340 + BAR_W / 2, cy: 250 },
];
const ARC_R = 56;
const arcLeft = { cx: bars[0].cx, cy: BAR_Y0 - ARC_R + 12 };
const arcRight = { cx: bars[2].cx, cy: BAR_Y0 - ARC_R + 12 };

function inM(x, y) {
  // 竖条
  for (const b of bars) {
    if (x >= b.x0 && x <= b.x1 && y >= BAR_Y0 && y <= BAR_Y1) return true;
  }
  // 顶拱（左拱连接 bar0-bar1，右拱连接 bar1-bar2）
  for (const a of [arcLeft, arcRight]) {
    if (y >= a.cy - ARC_R && y <= a.cy && dist(x, y, a.cx, a.cy) <= ARC_R) return true;
  }
  return false;
}
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inM(x, y)) blend(x, y, C[0], C[1], C[2], 255);
  }
}

const out = path.join(__dirname, "..", "public", "logo.png");
fs.writeFileSync(out, encodePNG(SIZE, SIZE, px));
console.log("logo.png written:", out, fs.statSync(out).size, "bytes");
