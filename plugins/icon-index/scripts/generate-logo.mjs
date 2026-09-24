import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const size = 256
const pixels = Buffer.alloc(size * size * 4)

const colors = {
  background: [20, 49, 47, 255],
  tile: [180, 225, 204, 255],
  tileAlt: [244, 119, 96, 255],
  lens: [250, 251, 247, 255]
}

function blendPixel(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return
  const offset = (y * size + x) * 4
  const sourceAlpha = (color[3] / 255) * Math.min(1, alpha)
  const targetAlpha = pixels[offset + 3] / 255
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
  if (outputAlpha === 0) return

  for (let channel = 0; channel < 3; channel += 1) {
    pixels[offset + channel] = Math.round(
      (color[channel] * sourceAlpha + pixels[offset + channel] * targetAlpha * (1 - sourceAlpha)) /
        outputAlpha
    )
  }
  pixels[offset + 3] = Math.round(outputAlpha * 255)
}

function roundedRect(x, y, width, height, radius, color) {
  for (let py = Math.floor(y - 1); py <= Math.ceil(y + height + 1); py += 1) {
    for (let px = Math.floor(x - 1); px <= Math.ceil(x + width + 1); px += 1) {
      const qx = Math.max(x + radius - (px + 0.5), 0, px + 0.5 - (x + width - radius))
      const qy = Math.max(y + radius - (py + 0.5), 0, py + 0.5 - (y + height - radius))
      const distance = Math.hypot(qx, qy) - radius
      blendPixel(px, py, color, Math.max(0, Math.min(1, 0.5 - distance)))
    }
  }
}

function ring(cx, cy, radius, thickness, color) {
  for (let y = cy - radius - 2; y <= cy + radius + 2; y += 1) {
    for (let x = cx - radius - 2; x <= cx + radius + 2; x += 1) {
      const distance = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius) - thickness / 2
      blendPixel(x, y, color, Math.max(0, Math.min(1, 0.5 - distance)))
    }
  }
}

roundedRect(8, 8, 240, 240, 52, colors.background)
roundedRect(47, 48, 53, 53, 12, colors.tile)
roundedRect(112, 48, 53, 53, 12, colors.tileAlt)
roundedRect(47, 113, 53, 53, 12, colors.tileAlt)
roundedRect(112, 113, 53, 53, 12, colors.tile)
ring(157, 157, 47, 17, colors.lens)

for (let step = 0; step < 58; step += 1) {
  const x = 187 + step * 0.72
  const y = 187 + step * 0.72
  roundedRect(x - 8, y - 8, 16, 16, 8, colors.lens)
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  typeBuffer.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return result
}

const scanlines = Buffer.alloc((size * 4 + 1) * size)
for (let y = 0; y < size; y += 1) {
  const rowOffset = y * (size * 4 + 1)
  scanlines[rowOffset] = 0
  pixels.copy(scanlines, rowOffset + 1, y * size * 4, (y + 1) * size * 4)
}

const header = Buffer.alloc(13)
header.writeUInt32BE(size, 0)
header.writeUInt32BE(size, 4)
header[8] = 8
header[9] = 6

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
writeFileSync(fileURLToPath(new URL('../public/logo.png', `file:///${scriptDirectory.replace(/\\/g, '/')}`)), png)
