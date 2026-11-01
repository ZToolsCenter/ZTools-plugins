import { deflateSync } from "node:zlib";

export type SyntheticBackdropShape = "portrait" | "wide";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Uint8Array): Buffer {
  const type = Buffer.from(name, "ascii");
  const body = Buffer.concat([type, Buffer.from(data)]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.byteLength, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([header, body, checksum]);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function pixel(x: number, y: number, width: number, height: number): [number, number, number] {
  const horizontal = x / width;
  const vertical = y / height;
  const diagonal = (x + y * 0.37) % 137;
  const fineGrid = Math.floor(x / 38) % 2 === Math.floor(y / 42) % 2;
  const glow = Math.max(0, 1 - Math.hypot((horizontal - 0.72) * 2.4, (vertical - 0.28) * 1.9));

  let red = 26 + horizontal * 64 + vertical * 30;
  let green = 33 + horizontal * 20 + vertical * 48;
  let blue = 67 + (1 - horizontal) * 70 + vertical * 32;

  if (diagonal < 24) {
    red += 104;
    green += 50;
    blue += 22;
  }
  if (fineGrid) {
    red += 16;
    green += 21;
    blue += 29;
  }
  red += glow * 82;
  green += glow * 38;
  blue -= glow * 24;

  const ringRadius = Math.hypot((horizontal - 0.24) * 1.05, (vertical - 0.62) * 0.78);
  if (Math.abs(ringRadius - 0.18) < 0.018) {
    red = 62;
    green = 225;
    blue = 205;
  }
  if (ringRadius < 0.13) {
    red += 62;
    green -= 4;
    blue += 54;
  }

  return [clamp(red), clamp(green), clamp(blue)];
}

function png(width: number, height: number): Buffer {
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    scanlines[offset++] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y, width, height);
      scanlines[offset++] = red;
      scanlines[offset++] = green;
      scanlines[offset++] = blue;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function syntheticBackdropDataUrl(shape: SyntheticBackdropShape): string {
  const dimensions = shape === "portrait" ? [720, 1200] : [1600, 600];
  const [width, height] = dimensions;
  return `data:image/png;base64,${png(width!, height!).toString("base64")}`;
}
