// ZTools ccToggle - sqlite.ts
// 只读 SQLite 解析器（纯 JS，无第三方依赖）
// 用于读取 opencode 等将数据存在 SQLite 的 Agent 的会话/用量数据。
// 支持主数据库文件 + WAL（write-ahead log）叠加读取。

const fs = require('fs');
const path = require('path');

// ─────────── varint / 记录解析 ───────────

interface VarintResult {
  value: number;
  next: number;
}

function _readVarint(buf: Buffer, pos: number): VarintResult {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const b = buf[pos++];
    if (b & 0x80) result = (result << 7) | (b & 0x7f);
    else return { value: (result << 7) | b, next: pos };
  }
  const b = buf[pos++];
  return { value: (result << 8) | b, next: pos };
}

// 解析一条记录（payload Buffer）为值数组
function _parseRecord(payload: Buffer): any[] {
  const hdr = _readVarint(payload, 0);
  const headerSize = hdr.value;
  const types: number[] = [];
  let p = hdr.next;
  const serialEnd = headerSize; // headerSize 包含 size varint 本身
  while (p < serialEnd) {
    const v = _readVarint(payload, p);
    types.push(v.value);
    p = v.next;
  }
  let body = headerSize;
  const values: any[] = [];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (t === 0) values.push(null);
    else if (t === 1) {
      values.push(payload.readInt8(body));
      body += 1;
    } else if (t === 2) {
      values.push(payload.readInt16BE(body));
      body += 2;
    } else if (t === 3) {
      values.push(payload.readIntBE(body, 3));
      body += 3;
    } else if (t === 4) {
      values.push(payload.readInt32BE(body));
      body += 4;
    } else if (t === 5) {
      values.push(payload.readIntBE(body, 6));
      body += 6;
    } else if (t === 6) {
      values.push(Number(payload.readBigInt64BE(body)));
      body += 8;
    } else if (t === 7) {
      values.push(payload.readDoubleBE(body));
      body += 8;
    } else if (t === 8) {
      values.push(0);
    } else if (t === 9) {
      values.push(1);
    } else if (t >= 12 && t % 2 === 0) {
      const n = (t - 12) / 2;
      values.push(payload.slice(body, body + n));
      body += n;
    } else if (t >= 13 && t % 2 === 1) {
      const n = (t - 13) / 2;
      values.push(payload.toString('utf8', body, body + n));
      body += n;
    } else values.push(null);
  }
  return values;
}

class _SqliteDB {
  dbPath: string;
  pageSize: number;
  reserved: number;
  usable: number;
  maxLocal: number;
  overflowUsable: number;
  _pages: Record<number, Buffer> = {};

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const header = Buffer.alloc(100);
    const fd = fs.openSync(dbPath, 'r');
    try {
      fs.readSync(fd, header, 0, 100, 0);
    } finally {
      fs.closeSync(fd);
    }
    const ps = header.readUInt16BE(16);
    this.pageSize = ps === 1 ? 65536 : ps;
    this.reserved = header[20];
    this.usable = this.pageSize - this.reserved;
    this.maxLocal = this.usable - 35;
    this.overflowUsable = this.usable - 4;
  }

  _readPageRaw(n: number): Buffer {
    const off = (n - 1) * this.pageSize;
    const buf = Buffer.alloc(this.pageSize);
    const fd = fs.openSync(this.dbPath, 'r');
    try {
      fs.readSync(fd, buf, 0, this.pageSize, off);
    } finally {
      fs.closeSync(fd);
    }
    return buf;
  }

  readPage(n: number): Buffer {
    const overlay = this._pages[n];
    return overlay || this._readPageRaw(n);
  }

  readPayload(page: Buffer, localStart: number, totalLen: number, regionEnd?: number): Buffer {
    const maxLocal = this.maxLocal;
    // local 数据区域边界：本 cell 到下一个 cell 起始地址（或页面末尾）
    const end = regionEnd != null ? regionEnd : page.length;
    let localLen = Math.min(totalLen, maxLocal);
    let op = 0;
    let dataEnd: number;
    if (totalLen > maxLocal) {
      // 溢出：local 数据后紧跟 4 字节溢出指针；local 区域受剩余空间约束
      const maxFit = end - localStart - 4;
      if (localLen > maxFit) localLen = Math.max(0, maxFit);
      op = page.readUInt32BE(localStart + localLen);
      dataEnd = localStart + localLen;
    } else {
      // 未溢出：整段记录都在 local 区域，无溢出指针
      if (localLen > end - localStart) localLen = Math.max(0, end - localStart);
      dataEnd = localStart + localLen;
    }
    const chunks = [page.slice(localStart, dataEnd)];
    while (op) {
      const opBuf = this.readPage(op);
      const next = opBuf.readUInt32BE(0);
      chunks.push(opBuf.slice(4, 4 + this.overflowUsable));
      op = next;
    }
    const assembled = Buffer.concat(chunks);
    // 最后一片 overflow 页通常只存剩余数据，多于 totalLen 的部分是页内填充，需截断
    return totalLen > 0 ? assembled.slice(0, totalLen) : assembled;
  }

  // 遍历表 b-tree，回调每条记录
  walkTable(rootPage: number, cb: (values: any[], rowid: number) => void): void {
    const stack = [rootPage];
    while (stack.length) {
      const pn = stack.pop()!;
      const page = this.readPage(pn);
      const ho = pn === 1 ? 100 : 0;
      const type = page[ho];
      const numCells = page.readUInt16BE(ho + 3);
      if (type === 5) {
        const rightPtr = page.readUInt32BE(ho + 8);
        if (rightPtr) stack.push(rightPtr);
        for (let i = 0; i < numCells; i++) {
          const cp = page.readUInt16BE(ho + 12 + i * 2);
          stack.push(page.readUInt32BE(cp));
        }
      } else if (type === 13) {
        // 收集本页全部 cell 指针，按地址升序，用于计算 local 区域边界
        const cellPtrs: number[] = [];
        for (let i = 0; i < numCells; i++) cellPtrs.push(page.readUInt16BE(ho + 8 + i * 2));
        cellPtrs.sort((a, b) => a - b);
        for (let i = 0; i < numCells; i++) {
          const cp = page.readUInt16BE(ho + 8 + i * 2);
          const pl = _readVarint(page, ho + cp);
          const rv = _readVarint(page, pl.next);
          // local 区域结束于下一个 cell 的起始地址（最后一个 cell 到页面末尾）
          let regionEnd = page.length;
          for (let j = 0; j < cellPtrs.length; j++) {
            if (cellPtrs[j] > cp) {
              regionEnd = cellPtrs[j];
              break;
            }
          }
          const payload = this.readPayload(page, rv.next, pl.value, regionEnd);
          cb(_parseRecord(payload), rv.value);
        }
      }
    }
  }

  // 读取 sqlite_master，返回 {name, rootpage} 列表
  readMaster(): Array<{ name: string; rootpage: number }> {
    const tables: Array<{ name: string; rootpage: number }> = [];
    this.walkTable(1, values => {
      const name = Buffer.isBuffer(values[1]) ? values[1].toString('utf8') : values[1];
      const rootpage = Number(values[3]);
      if (name && rootpage) tables.push({ name, rootpage });
    });
    return tables;
  }

  // 读取指定表的全部记录（不解析 schema 列名，返回原始值数组）
  readTable(tableName: string): any[][] {
    const master = this.readMaster();
    let root = 0;
    for (const t of master) {
      if (t.name === tableName) {
        root = t.rootpage;
        break;
      }
    }
    if (!root) return [];
    const rows: any[][] = [];
    this.walkTable(root, values => rows.push(values));
    return rows;
  }

  // 加载 WAL 文件叠加层
  // WAL 帧布局（每帧 24 + pageSize 字节）：
  //   0..4   页号
  //   4..8   commit 标记（提交帧为提交后库大小，非 0）
  //   8..16  校验和
  //   16..16+pageSize 页数据
  //   16+pageSize..24+pageSize  salt1 / salt2（各 4 字节）
  loadWal(walPath: string): void {
    if (!fs.existsSync(walPath)) return;
    const walSize = fs.statSync(walPath).size;
    if (walSize < 32) return;
    const header = Buffer.alloc(32);
    const fd = fs.openSync(walPath, 'r');
    try {
      fs.readSync(fd, header, 0, 32, 0);
    } catch (e) {
      return;
    }
    try {
      const magic = header.readUInt32BE(0);
      if (magic !== 0x377f0682 && magic !== 0x377f0683) return;
      const pageSize = header.readUInt32BE(4);
      if (pageSize < 512 || pageSize > 65536) return;
      const salt1 = header.readUInt32BE(12);
      const salt2 = header.readUInt32BE(16);
      const frameSize = 24 + pageSize;
      const numFrames = Math.floor((walSize - 32) / frameSize);
      const frameBuf = Buffer.alloc(frameSize);
      for (let i = 0; i < numFrames; i++) {
        fs.readSync(fd, frameBuf, 0, frameSize, 32 + i * frameSize);
        const pgno = frameBuf.readUInt32BE(0);
        const fSalt1 = frameBuf.readUInt32BE(16 + pageSize);
        const fSalt2 = frameBuf.readUInt32BE(20 + pageSize);
        if (fSalt1 !== salt1 || fSalt2 !== salt2) continue;
        this._pages[pgno] = Buffer.from(frameBuf.slice(16, 16 + pageSize));
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

// ─────────── 异步版本（不阻塞主线程） ───────────

// 与 _SqliteDB 逻辑一致，但文件读取使用 fs.promises
class _SqliteDBAsync {
  dbPath: string;
  pageSize: number;
  reserved: number;
  usable: number;
  maxLocal: number;
  overflowUsable: number;
  _pages: Record<number, Buffer> = {};
  _fh: import('fs').promises.FileHandle | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  static async open(dbPath: string): Promise<_SqliteDBAsync> {
    const db = new _SqliteDBAsync(dbPath);
    const header = Buffer.alloc(100);
    const fh = await fs.promises.open(dbPath, 'r');
    try {
      await fh.read(header, 0, 100, 0);
    } catch (e) {
      await fh.close();
      throw e;
    }
    db._fh = fh;
    const ps = header.readUInt16BE(16);
    db.pageSize = ps === 1 ? 65536 : ps;
    db.reserved = header[20];
    db.usable = db.pageSize - db.reserved;
    db.maxLocal = db.usable - 35;
    db.overflowUsable = db.usable - 4;
    return db;
  }

  async close(): Promise<void> {
    if (this._fh) {
      try {
        await this._fh.close();
      } catch (e) {
        /* ignore */
      }
      this._fh = null;
    }
  }

  async _readPageRaw(n: number): Promise<Buffer> {
    const off = (n - 1) * this.pageSize;
    const buf = Buffer.alloc(this.pageSize);
    if (!this._fh) return buf;
    try {
      await this._fh.read(buf, 0, this.pageSize, off);
    } catch (e) {
      /* ignore */
    }
    return buf;
  }

  async readPage(n: number): Promise<Buffer> {
    const overlay = this._pages[n];
    return overlay || this._readPageRaw(n);
  }

  async readPayload(
    page: Buffer,
    localStart: number,
    totalLen: number,
    regionEnd?: number
  ): Promise<Buffer> {
    const maxLocal = this.maxLocal;
    const end = regionEnd != null ? regionEnd : page.length;
    let localLen = Math.min(totalLen, maxLocal);
    let op = 0;
    let dataEnd: number;
    if (totalLen > maxLocal) {
      const maxFit = end - localStart - 4;
      if (localLen > maxFit) localLen = Math.max(0, maxFit);
      op = page.readUInt32BE(localStart + localLen);
      dataEnd = localStart + localLen;
    } else {
      if (localLen > end - localStart) localLen = Math.max(0, end - localStart);
      dataEnd = localStart + localLen;
    }
    const chunks = [page.slice(localStart, dataEnd)];
    while (op) {
      const opBuf = await this.readPage(op);
      const next = opBuf.readUInt32BE(0);
      chunks.push(opBuf.slice(4, 4 + this.overflowUsable));
      op = next;
    }
    const assembled = Buffer.concat(chunks);
    return totalLen > 0 ? assembled.slice(0, totalLen) : assembled;
  }

  async walkTable(rootPage: number, cb: (values: any[], rowid: number) => void): Promise<void> {
    const stack = [rootPage];
    while (stack.length) {
      const pn = stack.pop()!;
      const page = await this.readPage(pn);
      const ho = pn === 1 ? 100 : 0;
      const type = page[ho];
      const numCells = page.readUInt16BE(ho + 3);
      if (type === 5) {
        const rightPtr = page.readUInt32BE(ho + 8);
        if (rightPtr) stack.push(rightPtr);
        for (let i = 0; i < numCells; i++) {
          const cp = page.readUInt16BE(ho + 12 + i * 2);
          stack.push(page.readUInt32BE(cp));
        }
      } else if (type === 13) {
        const cellPtrs: number[] = [];
        for (let i = 0; i < numCells; i++) cellPtrs.push(page.readUInt16BE(ho + 8 + i * 2));
        cellPtrs.sort((a, b) => a - b);
        for (let i = 0; i < numCells; i++) {
          const cp = page.readUInt16BE(ho + 8 + i * 2);
          const pl = _readVarint(page, ho + cp);
          const rv = _readVarint(page, pl.next);
          let regionEnd = page.length;
          for (let j = 0; j < cellPtrs.length; j++) {
            if (cellPtrs[j] > cp) {
              regionEnd = cellPtrs[j];
              break;
            }
          }
          const payload = await this.readPayload(page, rv.next, pl.value, regionEnd);
          cb(_parseRecord(payload), rv.value);
        }
      }
    }
  }

  async readMaster(): Promise<Array<{ name: string; rootpage: number }>> {
    const tables: Array<{ name: string; rootpage: number }> = [];
    await this.walkTable(1, values => {
      const name = Buffer.isBuffer(values[1]) ? values[1].toString('utf8') : values[1];
      const rootpage = Number(values[3]);
      if (name && rootpage) tables.push({ name, rootpage });
    });
    return tables;
  }

  async readTable(tableName: string): Promise<any[][]> {
    const master = await this.readMaster();
    let root = 0;
    for (const t of master) {
      if (t.name === tableName) {
        root = t.rootpage;
        break;
      }
    }
    if (!root) return [];
    const rows: any[][] = [];
    await this.walkTable(root, values => rows.push(values));
    return rows;
  }

  async loadWal(walPath: string): Promise<void> {
    let stat;
    try {
      stat = await fs.promises.stat(walPath);
    } catch (e) {
      return;
    }
    const walSize = stat.size;
    if (walSize < 32) return;
    const header = Buffer.alloc(32);
    let fd: import('fs').promises.FileHandle | null = null;
    try {
      fd = await fs.promises.open(walPath, 'r');
      await fd.read(header, 0, 32, 0);
    } catch (e) {
      if (fd) await fd.close();
      return;
    }
    try {
      const magic = header.readUInt32BE(0);
      if (magic !== 0x377f0682 && magic !== 0x377f0683) return;
      const pageSize = header.readUInt32BE(4);
      if (pageSize < 512 || pageSize > 65536) return;
      const salt1 = header.readUInt32BE(12);
      const salt2 = header.readUInt32BE(16);
      const frameSize = 24 + pageSize;
      const numFrames = Math.floor((walSize - 32) / frameSize);
      const frameBuf = Buffer.alloc(frameSize);
      for (let i = 0; i < numFrames; i++) {
        await fd!.read(frameBuf, 0, frameSize, 32 + i * frameSize);
        const pgno = frameBuf.readUInt32BE(0);
        const fSalt1 = frameBuf.readUInt32BE(16 + pageSize);
        const fSalt2 = frameBuf.readUInt32BE(20 + pageSize);
        if (fSalt1 !== salt1 || fSalt2 !== salt2) continue;
        this._pages[pgno] = Buffer.from(frameBuf.slice(16, 16 + pageSize));
      }
    } finally {
      if (fd) await fd.close();
    }
  }
}

// ─────────── 对外 API ───────────

// 读取 SQLite 数据库某张表的全部行，返回对象数组
// columns 为该表的列名数组（与建表语句列序一致）
export function readSqliteTable(
  dbPath: string,
  table: string,
  columns: string[]
): Array<Record<string, any>> {
  try {
    if (!fs.existsSync(dbPath)) return [];
    const db = new _SqliteDB(dbPath);
    const walPath = dbPath + '-wal';
    try {
      db.loadWal(walPath);
    } catch (e) {
      /* ignore */
    }
    const rows = db.readTable(table);
    const result: Array<Record<string, any>> = [];
    for (const values of rows) {
      const rec: Record<string, any> = {};
      for (let i = 0; i < columns.length; i++) {
        let v = values[i];
        if (Buffer.isBuffer(v)) v = v.toString('utf8');
        rec[columns[i]] = v;
      }
      result.push(rec);
    }
    return result;
  } catch (e) {
    return [];
  }
}

// 异步读取 SQLite 表（不阻塞主线程）
export async function readSqliteTableAsync(
  dbPath: string,
  table: string,
  columns: string[]
): Promise<Array<Record<string, any>>> {
  try {
    if (!fs.existsSync(dbPath)) return [];
    const db = await _SqliteDBAsync.open(dbPath);
    try {
      const walPath = dbPath + '-wal';
      try {
        await db.loadWal(walPath);
      } catch (e) {
        /* ignore */
      }
      const rows = await db.readTable(table);
      const result: Array<Record<string, any>> = [];
      for (const values of rows) {
        const rec: Record<string, any> = {};
        for (let i = 0; i < columns.length; i++) {
          let v = values[i];
          if (Buffer.isBuffer(v)) v = v.toString('utf8');
          rec[columns[i]] = v;
        }
        result.push(rec);
      }
      return result;
    } finally {
      await db.close();
    }
  } catch (e) {
    return [];
  }
}

// 便捷：读取单个值（如某表某字段的最大值）
export function readSqliteScalar(dbPath: string, table: string, column: string): any {
  const rows = readSqliteTable(dbPath, table, [column]);
  return rows.length ? rows[0][column] : null;
}

export { fs, path };
