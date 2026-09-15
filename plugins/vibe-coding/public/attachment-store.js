const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const SUPPORTED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * 将输入字节转换为独立的 Buffer，避免调用方后续修改存储内容。
 * @param {unknown} value 图片二进制输入。
 * @returns {Buffer} 独立的图片字节。
 * @throws {Error} 输入不是可识别的字节序列时抛出。
 */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('图片数据不是有效的二进制内容');
}

/**
 * 根据图片文件头识别媒体类型。
 * @param {Buffer} bytes 图片字节。
 * @returns {string} 支持的 MIME 类型；无法识别时返回空字符串。
 */
function detectMediaType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

/**
 * 从已识别图片字节读取宽高，供像素上限和界面缩略图使用。
 * @param {Buffer} bytes 图片字节。
 * @param {string} mediaType 图片 MIME 类型。
 * @returns {{width: number, height: number}} 图片尺寸。
 * @throws {Error} 图片头损坏或格式不支持时抛出。
 */
function readDimensions(bytes, mediaType) {
  if (mediaType === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mediaType === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (mediaType === 'image/webp' && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') {
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  if (mediaType === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  throw new Error('图片尺寸无法识别或文件已损坏');
}

/**
 * 创建 ZVC 的内容寻址图片附件存储。
 * @param {string} rootDirectory ZVC 用户数据根目录。
 * @returns {{saveImage: Function, readImage: Function, getObjectPath: Function}} 图片附件存储接口。
 */
function createAttachmentStore(rootDirectory) {
  const objectsDirectory = path.join(rootDirectory, 'attachments', 'v1', 'objects');

  /**
   * 生成附件对象的绝对路径。
   * @param {string} attachmentId `sha256:<hex>` 格式的附件标识。
   * @returns {string} 附件对象路径。
   * @throws {Error} 附件标识格式非法时抛出。
   */
  function getObjectPath(attachmentId) {
    const id = String(attachmentId || '');
    const match = /^sha256:([a-f0-9]{64})$/.exec(id);
    if (!match) throw new Error('图片附件标识无效');
    return path.join(objectsDirectory, match[1].slice(0, 2), match[1]);
  }

  /**
   * 保存并返回图片的轻量引用。
   * @param {{bytes: unknown, mediaType?: string, name?: string}} input 图片字节和可选元数据。
   * @returns {{attachmentId: string, mediaType: string, bytes: number, width: number, height: number, name: string}} 可持久化的图片引用。
   * @throws {Error} 图片格式、大小、尺寸或写入失败时抛出。
   */
  function saveImage(input = {}) {
    // 先复制和限制字节，拒绝超限数据进入哈希和磁盘写入。
    const bytes = toBuffer(input.bytes);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片大小必须在 1 字节到 5 MB 之间');
    const detected = detectMediaType(bytes);
    const requested = String(input.mediaType || '').toLowerCase();
    if (!detected || !SUPPORTED_MEDIA_TYPES.has(detected) || (requested && requested !== detected)) throw new Error('图片格式不受支持或 MIME 类型不匹配');
    const dimensions = readDimensions(bytes, detected);
    if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw new Error('图片尺寸超过 4000 万像素限制');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const attachmentId = `sha256:${digest}`;
    const objectPath = getObjectPath(attachmentId);
    // 内容寻址对象只写入一次，重复图片复用同一个文件。
    fs.mkdirSync(path.dirname(objectPath), { recursive: true });
    if (!fs.existsSync(objectPath)) fs.writeFileSync(objectPath, bytes, { flag: 'wx' });
    return {
      attachmentId,
      mediaType: detected,
      bytes: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      name: String(input.name || 'image').slice(0, 160),
    };
  }

  /**
   * 读取附件对象并返回模型或界面需要的字节。
   * @param {string} attachmentId 附件标识。
   * @returns {{bytes: Buffer, mediaType: string}} 附件字节和媒体类型。
   * @throws {Error} 附件不存在或内容校验失败时抛出。
   */
  function readImage(attachmentId) {
    const objectPath = getObjectPath(attachmentId);
    if (!fs.existsSync(objectPath)) throw new Error('图片附件不存在');
    const bytes = fs.readFileSync(objectPath);
    const mediaType = detectMediaType(bytes);
    if (!mediaType) throw new Error('图片附件已损坏');
    return { bytes, mediaType };
  }

  return { saveImage, readImage, getObjectPath };
}

module.exports = { createAttachmentStore, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, SUPPORTED_MEDIA_TYPES };
