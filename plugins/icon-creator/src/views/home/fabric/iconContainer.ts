/**
 * ICO / ICNS 容器格式的纯二进制打包实现。
 * 输入是各尺寸的 PNG 原始字节（ICO 直接嵌入 PNG 帧，ICNS 以 PNG 数据作为 chunk 负载），
 * 输出为完整的容器文件字节。不依赖浏览器 API，可在 Node 中做构造-解析回读验证。
 */

/** 容器打包所需的单个尺寸帧：size 为像素边长（正方形），png 为该尺寸 PNG 的原始字节。 */
export interface IconContainerFrame {
  size: number
  png: Uint8Array
}

/** ICO 单帧尺寸上限：ICONDIRENTRY 用 1 字节存边长（0 表示 256），无法表达更大尺寸。 */
export const ICO_MAX_SIZE = 256

/** ICNS chunk 负载尺寸上限：再往上应使用 ic10（1024，512@2x）等视网膜类型。 */
export const ICNS_MAX_SIZE = 512

/**
 * ICNS 的 OSType → 尺寸映射，选用 PNG 负载类型并与 macOS iconutil 的
 * iconset 命名习惯一致：16→icp4、32→icp5、64→ic12（32@2x）、
 * 128→ic07、256→ic08、512→ic09。
 */
const ICNS_CHUNK_TYPES: Record<number, string> = {
  16: 'icp4',
  32: 'icp5',
  64: 'ic12',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09'
}

/** 写入大端无符号 16 位整数。 */
function writeUint16(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 8) & 0xff
  target[offset + 1] = value & 0xff
}

/** 写入大端无符号 32 位整数。 */
function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

/** 把 OSType（4 字符 ASCII）编码为 4 个字节。 */
function writeOsType(target: Uint8Array, offset: number, type: string) {
  for (let i = 0; i < 4; i++) {
    target[offset + i] = type.charCodeAt(i) & 0xff
  }
}

/**
 * 构造 ICO 文件字节。
 * 布局：6 字节 ICONDIR（reserved=0、type=1、count）+ 每帧 16 字节 ICONDIRENTRY
 * （width/height 各 1 字节，256 记为 0；colorCount=0；reserved=0；planes=1；
 * bitCount=32；bytesInRes；imageOffset），随后按序追加各帧 PNG 原始字节。
 */
export function buildIcoFile(frames: IconContainerFrame[]): Uint8Array {
  const totalBytes = frames.reduce((sum, frame) => sum + frame.png.length, 0)
  const result = new Uint8Array(6 + frames.length * 16 + totalBytes)
  writeUint16(result, 0, 0)
  writeUint16(result, 2, 1)
  writeUint16(result, 4, frames.length)

  let dataOffset = 6 + frames.length * 16
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16
    result[entry] = frame.size % 256 === 0 ? 0 : frame.size
    result[entry + 1] = result[entry]
    result[entry + 2] = 0
    result[entry + 3] = 0
    writeUint16(result, entry + 4, 1)
    writeUint16(result, entry + 6, 32)
    writeUint32(result, entry + 8, frame.png.length)
    writeUint32(result, entry + 12, dataOffset)
    result.set(frame.png, dataOffset)
    dataOffset += frame.png.length
  })
  return result
}

/**
 * 构造 ICNS 文件字节。
 * 布局：8 字节文件头（'icns' magic + 文件总长度）+ 若干 chunk；
 * 每个 chunk 为 8 字节头（4 字符 OSType + chunk 总长度，含头）+ PNG 负载。
 * 尺寸必须能映射到 ICNS_CHUNK_TYPES，否则抛错。
 */
export function buildIcnsFile(frames: IconContainerFrame[]): Uint8Array {
  const unmapped = frames.find((frame) => !ICNS_CHUNK_TYPES[frame.size])
  if (unmapped) {
    throw new Error(`ICNS 不支持 ${unmapped.size}px 帧，可用尺寸: ${Object.keys(ICNS_CHUNK_TYPES).map(Number).join(', ')}`)
  }
  const chunksSize = frames.reduce((sum, frame) => sum + 8 + frame.png.length, 0)
  const result = new Uint8Array(8 + chunksSize)
  writeOsType(result, 0, 'icns')
  writeUint32(result, 4, result.length)

  let offset = 8
  frames.forEach((frame) => {
    const chunkType = ICNS_CHUNK_TYPES[frame.size]
    writeOsType(result, offset, chunkType)
    writeUint32(result, offset + 4, 8 + frame.png.length)
    result.set(frame.png, offset + 8)
    offset += 8 + frame.png.length
  })
  return result
}

/** 解析 ICO 文件头与目录项，供构造结果的回读验证使用。 */
export function parseIcoFile(bytes: Uint8Array): Array<{ width: number; height: number; bytesInRes: number; imageOffset: number; planes: number; bitCount: number }> {
  const count = (bytes[4] << 8) | bytes[5]
  const entries = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    entries.push({
      width: bytes[entry] === 0 ? 256 : bytes[entry],
      height: bytes[entry + 1] === 0 ? 256 : bytes[entry + 1],
      planes: (bytes[entry + 4] << 8) | bytes[entry + 5],
      bitCount: (bytes[entry + 6] << 8) | bytes[entry + 7],
      bytesInRes:
        bytes[entry + 8] * 0x1000000 + bytes[entry + 9] * 0x10000 + bytes[entry + 10] * 0x100 + bytes[entry + 11],
      imageOffset:
        bytes[entry + 12] * 0x1000000 + bytes[entry + 13] * 0x10000 + bytes[entry + 14] * 0x100 + bytes[entry + 15]
    })
  }
  return entries
}

/** 解析 ICNS 文件头与 chunk 列表，供构造结果的回读验证使用。 */
export function parseIcnsFile(bytes: Uint8Array): Array<{ type: string; length: number }> {
  const chunks = []
  let offset = 8
  while (offset < bytes.length) {
    const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    const length =
      bytes[offset + 4] * 0x1000000 + bytes[offset + 5] * 0x10000 + bytes[offset + 6] * 0x100 + bytes[offset + 7]
    chunks.push({ type, length })
    offset += length
  }
  return chunks
}
