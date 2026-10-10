/**
 * xlsx.js —— 零依赖 XLSX 读写引擎（preload 专用，CommonJS）
 *
 * 只依赖 node:zlib 与 node:fs（均为 Node 内置），不引入任何 npm 包。
 * 写入：生成标准 xlsx（ZIP 容器 + OOXML），字符串用 inlineStr 单元格，
 *       因此生成的文件用 Excel / WPS / LibreOffice 均可直接打开。
 * 读取：解析 ZIP 中央目录，取首个工作表的行数据；兼容真实 Excel 生成的
 *       sharedStrings（t="s"）、inlineStr、数值与日期序列号单元格。
 *
 * API：
 *   writeFile(filePath, sheetName, rows)   rows: Array<Array<string|number>>
 *   readFile(filePath) -> Array<Array<string|number>>  （不含表头概念，纯数据）
 *   __buildZip(entries) -> Buffer          （仅供自测构造 sharedStrings 夹具）
 */
'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs');

/* ------------------------------------------------------------------ *
 * CRC32
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * ZIP 写入
 * ------------------------------------------------------------------ */

function dosDateTime(d) {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

/**
 * 构造 ZIP Buffer。entries: [{ name, data: Buffer }]
 */
function __buildZip(entries) {
  const now = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    let data = entry.data;
    let method = 0;
    try {
      const deflated = zlib.deflateRawSync(data);
      if (deflated.length < data.length) {
        data = deflated;
        method = 8;
      }
    } catch (e) {
      /* 降级为不压缩 */
    }
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  });

  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

/* ------------------------------------------------------------------ *
 * ZIP 读取
 * ------------------------------------------------------------------ */

function __parseZip(buf) {
  // 定位 EOCD：从尾部向前搜索签名
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（缺少 ZIP 结束标记）');

  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const files = new Map();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    let data = buf.slice(dataStart, dataStart + compSize);
    if (method === 8) data = zlib.inflateRawSync(data);

    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ------------------------------------------------------------------ *
 * XML 工具
 * ------------------------------------------------------------------ */

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function decodeXml(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------ *
 * 列号 <-> 字母
 * ------------------------------------------------------------------ */

function colLetter(index) {
  let s = '';
  let i = index + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function colIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/* ------------------------------------------------------------------ *
 * 工作表 XML
 * ------------------------------------------------------------------ */

function buildSheetXml(sheetName, rows) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
  ];
  rows.forEach((row, ri) => {
    parts.push('<row r="' + (ri + 1) + '">');
    row.forEach((cell, ci) => {
      if (cell == null || cell === '') return;
      const ref = colLetter(ci) + (ri + 1);
      if (typeof cell === 'number' && isFinite(cell)) {
        parts.push('<c r="' + ref + '"><v>' + cell + '</v></c>');
      } else {
        parts.push('<c r="' + ref + '" t="inlineStr"><is><t>' + escapeXml(cell) + '</t></is></c>');
      }
    });
    parts.push('</row>');
  });
  parts.push('</sheetData></worksheet>');
  return parts.join('');
}

function parseSharedStrings(xml) {
  const list = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    let text = '';
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(m[1]))) text += decodeXml(tm[1]);
    list.push(text);
  }
  return list;
}

function parseSheetXml(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(m[1]))) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const rMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const tMatch = /t="([^"]*)"/.exec(attrs);
      const col = rMatch ? colIndex(rMatch[1]) : row.length;
      let val = '';
      if (tMatch && tMatch[1] === 'inlineStr') {
        const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        val = tm ? decodeXml(tm[1]) : '';
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) {
          const raw = decodeXml(vm[1]);
          if (tMatch && tMatch[1] === 's') {
            const idx = parseInt(raw, 10);
            val = shared[idx] != null ? shared[idx] : raw;
          } else if (tMatch && tMatch[1] === 'b') {
            val = raw === '1' ? '是' : '否';
          } else if (tMatch && tMatch[1] === 'str') {
            val = raw;
          } else {
            const num = Number(raw);
            val = isNaN(num) ? raw : num;
          }
        }
      }
      while (row.length < col) row.push('');
      row[col] = val;
    }
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * 组装 / 解析 xlsx
 * ------------------------------------------------------------------ */

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>';

function buildWorkbookXml(sheetName) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="' + escapeXml(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>'
  );
}

/**
 * 生成 xlsx 文件。
 * @param {string} filePath
 * @param {string} sheetName 工作表名
 * @param {Array<Array<string|number>>} rows
 */
function writeFile(filePath, sheetName, rows) {
  const buf = __buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(buildWorkbookXml(sheetName), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(buildSheetXml(sheetName, rows), 'utf8') }
  ]);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

/**
 * 读取 xlsx 第一个工作表，返回二维数组（字符串 / 数字）。
 * @param {string} filePath
 * @returns {Array<Array<string|number>>}
 */
function readFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const files = __parseZip(buf);
  if (!files.has('xl/workbook.xml')) throw new Error('不是有效的 xlsx 文件（缺少 workbook.xml）');

  let shared = [];
  if (files.has('xl/sharedStrings.xml')) {
    shared = parseSharedStrings(files.get('xl/sharedStrings.xml').toString('utf8'));
  }

  // 优先 sheet1；若不存在，通过 workbook 的关系文件解析首个工作表
  let sheetXml = files.has('xl/worksheets/sheet1.xml')
    ? files.get('xl/worksheets/sheet1.xml').toString('utf8')
    : null;
  if (sheetXml == null) {
    const wbXml = files.get('xl/workbook.xml').toString('utf8');
    const sheetMatch = /<sheet\b[^>]*r:id="(rId\d+)"[^>]*>/.exec(wbXml);
    const relsXml = (files.get('xl/_rels/workbook.xml.rels') || Buffer.from('')).toString('utf8');
    const rid = sheetMatch ? sheetMatch[1] : null;
    if (rid) {
      const relMatch = new RegExp(
        '<Relationship\\b[^>]*Id="' + rid + '"[^>]*Target="([^"]+)"'
      ).exec(relsXml);
      if (relMatch) {
        let target = relMatch[1].replace(/^\/+/, '');
        if (!/^xl\//.test(target)) target = 'xl/' + target;
        if (files.has(target)) sheetXml = files.get(target).toString('utf8');
      }
    }
  }
  if (sheetXml == null) throw new Error('xlsx 中没有找到工作表');

  return parseSheetXml(sheetXml, shared);
}

module.exports = { writeFile, readFile, escapeXml, decodeXml, colLetter, colIndex, __buildZip };
