'use strict';

/**
 * zip-reader.js —— 零第三方依赖的 ZIP 只读访问层（A 层 · 数据保真）
 *
 * 为什么自研而不引入 yauzl / adm-zip / jszip：
 * 1. ZTools 发布链路会忽略 node_modules，且要求 preload 与第三方模块源码可读不混淆，
 *    零依赖实现可以彻底规避这两条约束，同时把插件体积压到最小。
 * 2. SAZ 场景只需要"读"：中央目录 + stored/deflate 条目，不需要写、不需要补丁。
 * 3. 关键是 entry 级按需读取：索引阶段只取每个条目前若干字节的明文头部，
 *    绝不把整包读进内存（实测最大单样本未压缩 360MB、单条目 33.6MB）。
 *
 * 支持的 ZIP 特性：
 * - 常规 EOCD 与 Zip64 EOCD（EOCD64 + locator）
 * - 压缩方法 0（stored）与 8（deflate raw）
 * - data descriptor（bit 3）：大小一律以中央目录为准
 * - UTF-8 文件名标志（bit 11），否则按 CP437→latin1 兜底
 * - 加密条目（bit 0）：识别并标记，不尝试解密
 */

const fs = require('node:fs');
const zlib = require('node:zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;

const MAX_EOCD_WINDOW = 0xffff + 22; // comment 最长 65535，加上 EOCD 固定 22 字节
const DEFAULT_CHUNK = 64 * 1024;

/** ZIP 层错误，带可读 code 便于上层分类展示。 */
class ZipError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

/** 从 fd 的 position 处精确读取 len 字节；返回实际读到的切片（短读时更短）。 */
function readAt(fd, len, position) {
  const want = Math.max(0, len);
  const buf = Buffer.allocUnsafe(want);
  let got = 0;
  while (got < want) {
    const n = fs.readSync(fd, buf, got, want - got, position + got);
    if (n <= 0) break;
    got += n;
  }
  return got === want ? buf : buf.slice(0, got);
}

/**
 * 在缓冲区中从后向前查找 4 字节签名（小端）。
 * @returns {number} 命中位置，未命中返回 -1
 */
function findSignatureBackwards(buf, signature) {
  for (let i = buf.length - 4; i >= 0; i--) {
    if (buf.readUInt32LE(i) === signature) return i;
  }
  return -1;
}

/** CP437 非 ASCII 范围到 unicode 的最小映射表（仅用于兜底显示，不参与逻辑判断）。 */
const CP437_TAIL =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥ƒáíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌' +
  '█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ² ';

/** 按 ZIP 规范解码条目名：UTF-8 标志位置起则直接用 UTF-8。 */
function decodeName(raw, isUtf8) {
  if (isUtf8) return raw.toString('utf8');
  // 非 UTF-8：ASCII 原样，其余按 CP437 表映射；映射不到时退化为 latin1
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b < 0x80) out += String.fromCharCode(b);
    else {
      const idx = b - 0x80;
      out += idx < CP437_TAIL.length ? CP437_TAIL[idx] : String.fromCharCode(b);
    }
  }
  return out;
}

/** 解析条目的 Zip64 扩展字段，返回被 0xFFFFFFFF 占位替换的真实大小/偏移。 */
function parseZip64Extra(extra, entry) {
  const res = { uncompressedSize: null, compressedSize: null, localHeaderOffset: null };
  let off = 0;
  while (off + 4 <= extra.length) {
    const id = extra.readUInt16LE(off);
    const size = extra.readUInt16LE(off + 2);
    const body = off + 4;
    if (size > extra.length - 4 - off) break;
    if (id === 0x0001) {
      let p = body;
      // 字段按固定顺序出现，且仅写入"原字段溢出"的那些
      if (entry.uncompressedSize === 0xffffffff && p + 8 <= body + size) {
        res.uncompressedSize = Number(extra.readBigUInt64LE(p)); p += 8;
      }
      if (entry.compressedSize === 0xffffffff && p + 8 <= body + size) {
        res.compressedSize = Number(extra.readBigUInt64LE(p)); p += 8;
      }
      if (entry.localHeaderOffset === 0xffffffff && p + 8 <= body + size) {
        res.localHeaderOffset = Number(extra.readBigUInt64LE(p)); p += 8;
      }
      break;
    }
    off = body + size;
  }
  return res;
}

class ZipReader {
  /**
   * @param {string} filePath ZIP/SAZ 文件绝对路径
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = null;
    this.fileSize = 0;
    /** @type {Array<{name:string,index:number,method:number,flags:number,compressedSize:number,uncompressedSize:number,localHeaderOffset:number,dataStart:number,crc32:number}>} */
    this.entries = [];
    this.encryptedCount = 0;
  }

  /** 打开并解析中央目录。必须在读取任何条目前调用。 */
  open() {
    this.fd = fs.openSync(this.filePath, 'r');
    const st = fs.fstatSync(this.fd);
    this.fileSize = st.size;
    if (this.fileSize < 22) throw new ZipError('EIO', '文件过小，不是有效的 ZIP/SAZ 归档');
    this._readCentralDirectory();
    return this;
  }

  close() {
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (e) { /* 已关闭则忽略 */ }
      this.fd = null;
    }
  }

  /** 定位 EOCD（含 Zip64 桥接），随后顺序解析全部中央目录项。 */
  _readCentralDirectory() {
    const tailLen = Math.min(MAX_EOCD_WINDOW, this.fileSize);
    const tail = readAt(this.fd, tailLen, this.fileSize - tailLen);
    const eocdRel = findSignatureBackwards(tail, SIG_EOCD);
    if (eocdRel < 0) throw new ZipError('EEOCD', '未找到 EOCD，归档可能已截断');

    const eocdPos = this.fileSize - tailLen + eocdRel;
    let cdCount = tail.readUInt16LE(eocdRel + 10);
    let cdSize = tail.readUInt32LE(eocdRel + 12);
    let cdOffset = tail.readUInt32LE(eocdRel + 16);

    // Zip64：任一字段哨兵值即需读 EOCD64
    if (cdCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locRel = findSignatureBackwards(tail.subarray(0, eocdRel), SIG_EOCD64_LOC);
      if (locRel >= 0) {
        const locPos = this.fileSize - tailLen + locRel;
        const loc = readAt(this.fd, 20, locPos);
        const eocd64Pos = Number(loc.readBigUInt64LE(8));
        const e64 = readAt(this.fd, 56, eocd64Pos);
        if (e64.length >= 56 && e64.readUInt32LE(0) === SIG_EOCD64) {
          cdCount = Number(e64.readBigUInt64LE(32));
          cdSize = Number(e64.readBigUInt64LE(40));
          cdOffset = Number(e64.readBigUInt64LE(48));
        }
      }
    }

    if (cdOffset + cdSize > this.fileSize) throw new ZipError('ECD', '中央目录越界，归档损坏');

    const cd = readAt(this.fd, cdSize, cdOffset);
    let p = 0;
    let index = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === SIG_CENTRAL) {
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc32 = cd.readUInt32LE(p + 16);
      let compressedSize = cd.readUInt32LE(p + 20);
      let uncompressedSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localHeaderOffset = cd.readUInt32LE(p + 42);

      const nameRaw = cd.subarray(p + 46, p + 46 + nameLen);
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      const z64v = parseZip64Extra(extra, { uncompressedSize, compressedSize, localHeaderOffset });
      if (z64v.uncompressedSize !== null) uncompressedSize = z64v.uncompressedSize;
      if (z64v.compressedSize !== null) compressedSize = z64v.compressedSize;
      if (z64v.localHeaderOffset !== null) localHeaderOffset = z64v.localHeaderOffset;

      if (flags & 0x0001) this.encryptedCount++;

      this.entries.push({
        index,
        name: decodeName(nameRaw, (flags & 0x0800) !== 0),
        method,
        flags,
        crc32,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        dataStart: -1, // 首次访问时由本地头解析确定
      });

      p += 46 + nameLen + extraLen + commentLen;
      index++;
    }
  }

  /** 按名称、下标或已取到的条目对象取条目（允许直接透传对象，方便上层循环复用）。 */
  entry(key) {
    if (key && typeof key === 'object' && typeof key.index === 'number') return key;
    if (typeof key === 'number') {
      const e = this.entries[key];
      if (!e) throw new ZipError('ENOENT', '条目下标不存在: ' + key);
      return e;
    }
    const e = this.entries.find((x) => x.name === key);
    if (!e) throw new ZipError('ENOENT', '条目不存在: ' + key);
    return e;
  }

  /**
   * 解析本地文件头，确定数据的真实起始偏移。
   * 本地头的 nameLen/extraLen 可能与中央目录不同，必须就地读取。
   */
  _resolveDataStart(entry) {
    if (entry.dataStart >= 0) return entry.dataStart;
    const head = readAt(this.fd, 30, entry.localHeaderOffset);
    if (head.length < 30 || head.readUInt32LE(0) !== SIG_LOCAL) {
      throw new ZipError('ELOCAL', '本地文件头损坏: ' + entry.name);
    }
    const nameLen = head.readUInt16LE(26);
    const extraLen = head.readUInt16LE(28);
    entry.dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
    return entry.dataStart;
  }

  /** 读取条目的压缩原始字节（不解压）。 */
  readRaw(entryKey) {
    const e = this.entry(entryKey);
    const start = this._resolveDataStart(e);
    return readAt(this.fd, e.compressedSize, start);
  }

  /**
   * 完整读取条目并解压为 Buffer。
   * method 0 直接返回原字节；method 8 走 inflateRaw；其余方法标记不支持。
   */
  readEntry(entryKey) {
    const e = this.entry(entryKey);
    if (e.method === 0) return this.readRaw(e);
    if (e.method === 8) {
      const raw = this.readRaw(e);
      try {
        return zlib.inflateRawSync(raw);
      } catch (err) {
        // 有些抓包工具写出的 deflate 流尾部不完整，用 Z_SYNC_FLUSH 尽力取回可解码前缀
        try {
          return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
        } catch (err2) {
          throw new ZipError('EINFLATE', 'deflate 解压失败: ' + e.name + ' (' + err.message + ')');
        }
      }
    }
    throw new ZipError('EMETHOD', '不支持的压缩方法 ' + e.method + ': ' + e.name);
  }

  /**
   * 只取条目明文的**前缀**（索引阶段核心优化）。
   *
   * 策略：先读 probeCompressedBytes 压缩字节，尝试以 Z_SYNC_FLUSH 流式解码；
   * 拿到足够明文就返回，不足再读满整个条目。对最大 33.6MB 的条目可避免整块读入。
   *
   * @param {string|number} entryKey
   * @param {number} maxPlainBytes 需要的明文字节上限
   * @param {number} probeCompressedBytes 首次尝试读取的压缩字节数
   * @returns {{buffer:Buffer, plainFull:boolean, compressedFull:boolean}}
   */
  readEntryPrefix(entryKey, maxPlainBytes, probeCompressedBytes = 64 * 1024) {
    const e = this.entry(entryKey);
    const start = this._resolveDataStart(e);

    if (e.method === 0) {
      const take = Math.min(maxPlainBytes, e.compressedSize);
      const buf = readAt(this.fd, take, start);
      return { buffer: buf, plainFull: e.uncompressedSize <= maxPlainBytes, compressedFull: true };
    }

    if (e.method !== 8) {
      throw new ZipError('EMETHOD', '不支持的压缩方法 ' + e.method + ': ' + e.name);
    }

    // 第一步：读探测块，尝试部分解压
    const probeSize = Math.min(Math.max(probeCompressedBytes, 4096), e.compressedSize);
    const probe = readAt(this.fd, probeSize, start);
    let plain = null;
    try {
      plain = zlib.inflateRawSync(probe, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch (err) {
      plain = null;
    }
    if (plain && plain.length >= maxPlainBytes) {
      return { buffer: plain.subarray(0, maxPlainBytes), plainFull: false, compressedFull: false };
    }

    // 第二步：探测块不够（或解不出来）→ 读全量再解
    const all = probeSize === e.compressedSize
      ? probe
      : readAt(this.fd, e.compressedSize, start);
    let full = null;
    try {
      full = zlib.inflateRawSync(all);
    } catch (err) {
      try {
        full = zlib.inflateRawSync(all, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      } catch (err2) {
        throw new ZipError('EINFLATE', 'deflate 解压失败: ' + e.name);
      }
    }
    const out = full.length > maxPlainBytes ? full.subarray(0, maxPlainBytes) : full;
    return { buffer: out, plainFull: full.length <= maxPlainBytes, compressedFull: true };
  }

  /**
   * 分块顺序读取条目解压流（批量导出用），回调返回 false 可提前中止。
   * 采用"逐块 inflate"避免一次性持有整块明文。
   */
  walkEntryChunks(entryKey, chunkSize, onChunk) {
    const e = this.entry(entryKey);
    if (e.method === 0) {
      const start = this._resolveDataStart(e);
      let pos = start;
      let remain = e.compressedSize;
      while (remain > 0) {
        const n = Math.min(chunkSize || DEFAULT_CHUNK, remain);
        const buf = readAt(this.fd, n, pos);
        if (buf.length === 0) break;
        pos += buf.length;
        remain -= buf.length;
        if (onChunk(buf) === false) return;
      }
      return;
    }
    // deflate：一次性解压后按块交付（Node 无同步流式 inflate 的公开 API）。
    // 调用方对超大条目应配合 maxBytes 限制使用。
    const whole = this.readEntry(e);
    const step = chunkSize || DEFAULT_CHUNK;
    for (let off = 0; off < whole.length; off += step) {
      if (onChunk(whole.subarray(off, Math.min(off + step, whole.length))) === false) return;
    }
  }

  /** 归档概要信息，供上层写入 manifest 与概览。 */
  info() {
    return {
      path: this.filePath,
      fileSize: this.fileSize,
      entryCount: this.entries.length,
      encryptedCount: this.encryptedCount,
    };
  }
}

module.exports = { ZipReader, ZipError, readAt };
