import { lstat, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import path from 'node:path'

const DEFAULT_ZIP_LIMIT_BYTES = 15 * 1024 * 1024
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  return value >>> 0
})

export function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function safeEntryName(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
    throw new Error('ZIP entry 名称包含空值、NUL 或反斜杠')
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error(`ZIP entry 不能是绝对路径：${value}`)
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`ZIP entry 包含不安全路径段：${value}`)
  for (const part of parts) {
    if (/[<>:"|?*\u0000-\u001f]/.test(part) || /[ .]$/.test(part)) throw new Error(`ZIP entry 包含 Windows 歧义路径段：${value}`)
    if (Buffer.byteLength(part, 'utf8') > 255) throw new Error(`ZIP entry 路径段过长：${value}`)
    const deviceStem = part.split('.')[0].replace(/[ .]+$/g, '')
    if (WINDOWS_RESERVED_NAME.test(deviceStem)) throw new Error(`ZIP entry 使用 Windows 保留名称：${value}`)
  }
  if (Buffer.byteLength(value, 'utf8') > 0xffff) throw new Error('ZIP entry 名称过长')
  return value
}

export function portableEntryKey(value) {
  return safeEntryName(value).split('/').map((part) => part.normalize('NFC').toLowerCase()).join('/')
}

function dosTime(date) {
  return ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31)
}

function dosDate(date) {
  return (((Math.max(1980, date.getFullYear()) - 1980) & 127) << 9)
    | (((date.getMonth() + 1) & 15) << 5)
    | (date.getDate() & 31)
}

export async function createZip(files, base, output) {
  const local = []
  const central = []
  const names = new Set()
  const portableNames = new Set()
  let offset = 0
  for (const file of [...files].sort()) {
    const relative = path.relative(base, file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`ZIP 输入越过基准目录：${file}`)
    const fileInfo = await lstat(file)
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error(`ZIP 输入不是安全普通文件：${relative}`)
    const info = await stat(file)
    const raw = await readFile(file)
    const compressed = deflateRawSync(raw, { level: 9 })
    const entryName = safeEntryName(relative.split(path.sep).join('/'))
    if (names.has(entryName)) throw new Error(`ZIP entry 重复：${entryName}`)
    names.add(entryName)
    const portableName = portableEntryKey(entryName)
    if (portableNames.has(portableName)) throw new Error(`ZIP entry 存在跨平台名称碰撞：${entryName}`)
    portableNames.add(portableName)
    const name = Buffer.from(entryName)
    const checksum = crc32(raw)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(dosTime(info.mtime), 10)
    localHeader.writeUInt16LE(dosDate(info.mtime), 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(raw.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    local.push(localHeader, name, compressed)

    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x0800, 8)
    record.writeUInt16LE(8, 10)
    record.writeUInt16LE(dosTime(info.mtime), 12)
    record.writeUInt16LE(dosDate(info.mtime), 14)
    record.writeUInt32LE(checksum, 16)
    record.writeUInt32LE(compressed.length, 20)
    record.writeUInt32LE(raw.length, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    offset += localHeader.length + name.length + compressed.length
  }
  const centralSize = central.reduce((sum, value) => sum + value.length, 0)
  const count = central.length / 2
  if (count > 0xffff) throw new Error('ZIP 文件数量超过 ZIP32 上限')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  const archive = Buffer.concat([...local, ...central, end])
  await writeFile(output, archive)
  return archive.length
}

export function inspectZip(buffer, options = {}) {
  const limitBytes = Number.isInteger(options.limitBytes) && options.limitBytes > 0 ? options.limitBytes : DEFAULT_ZIP_LIMIT_BYTES
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length >= limitBytes) throw new Error(`ZIP 大小必须严格小于 ${limitBytes} bytes`)
  const entries = []
  const localNames = new Set()
  const localPortableNames = new Set()
  let expandedBytes = 0
  let offset = 0
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > buffer.length) throw new Error('ZIP local header 截断')
    const localOffset = offset
    const flags = buffer.readUInt16LE(offset + 6)
    const method = buffer.readUInt16LE(offset + 8)
    const expectedCrc = buffer.readUInt32LE(offset + 14)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const rawSize = buffer.readUInt32LE(offset + 22)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) throw new Error('ZIP entry 数据截断')
    const name = safeEntryName(buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'))
    if (localNames.has(name)) throw new Error(`ZIP local entry 重复：${name}`)
    localNames.add(name)
    const portableName = portableEntryKey(name)
    if (localPortableNames.has(portableName)) throw new Error(`ZIP local entry 存在跨平台名称碰撞：${name}`)
    localPortableNames.add(portableName)
    if (flags !== 0x0800 || ![0, 8].includes(method)) throw new Error(`ZIP local entry flags/method 不受支持：${name}`)
    if (rawSize >= limitBytes - expandedBytes) throw new Error(`ZIP 解压后体积必须严格小于 ${limitBytes} bytes`)
    const payload = buffer.subarray(dataStart, dataEnd)
    const raw = method === 8 ? inflateRawSync(payload, { maxOutputLength: Math.max(1, rawSize + 1) }) : method === 0 ? payload : null
    if (!raw || raw.length !== rawSize || crc32(raw) !== expectedCrc) throw new Error(`ZIP entry 校验失败：${name}`)
    expandedBytes += raw.length
    entries.push({ name, size: rawSize, method, crc: expectedCrc, sha256: sha256(raw), compressedSize, localOffset })
    offset = dataEnd
  }
  const centralOffset = offset
  const centralEntries = []
  const centralNames = new Set()
  const centralPortableNames = new Set()
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x02014b50) {
    if (offset + 46 > buffer.length) throw new Error('ZIP central record 截断')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const checksum = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const rawSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength
    if (recordEnd > buffer.length) throw new Error('ZIP central record 数据截断')
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = safeEntryName(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    if (centralNames.has(name)) throw new Error(`ZIP central entry 重复：${name}`)
    centralNames.add(name)
    const portableName = portableEntryKey(name)
    if (centralPortableNames.has(portableName)) throw new Error(`ZIP central entry 存在跨平台名称碰撞：${name}`)
    centralPortableNames.add(portableName)
    centralEntries.push({ name, size: rawSize, method, crc: checksum, compressedSize, localOffset, flags })
    offset = recordEnd
  }
  const centralSize = offset - centralOffset
  if (!entries.length || offset + 22 > buffer.length || buffer.readUInt32LE(offset) !== 0x06054b50) {
    throw new Error('ZIP central directory 缺失')
  }
  const disk = buffer.readUInt16LE(offset + 4)
  const centralDisk = buffer.readUInt16LE(offset + 6)
  const diskCount = buffer.readUInt16LE(offset + 8)
  const totalCount = buffer.readUInt16LE(offset + 10)
  const declaredCentralSize = buffer.readUInt32LE(offset + 12)
  const declaredCentralOffset = buffer.readUInt32LE(offset + 16)
  const commentLength = buffer.readUInt16LE(offset + 20)
  if (disk !== 0 || centralDisk !== 0 || diskCount !== entries.length || totalCount !== entries.length) {
    throw new Error('ZIP entry 数量或磁盘字段不一致')
  }
  if (declaredCentralSize !== centralSize || declaredCentralOffset !== centralOffset) {
    throw new Error('ZIP central directory 偏移或长度不一致')
  }
  if (offset + 22 + commentLength !== buffer.length) throw new Error('ZIP 末尾包含未声明数据')
  if (centralEntries.length !== entries.length || centralEntries.some((entry, index) => {
    const local = entries[index]
    return entry.name !== local.name
      || entry.size !== local.size
      || entry.method !== local.method
      || entry.crc !== local.crc
      || entry.compressedSize !== local.compressedSize
      || entry.localOffset !== local.localOffset
      || entry.flags !== 0x0800
  })) {
    throw new Error('ZIP local 与 central entry 列表不一致')
  }
  return entries
}
