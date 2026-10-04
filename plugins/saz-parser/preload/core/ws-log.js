'use strict';

/**
 * ws-log.js —— raw/<sid>_w.txt WebSocket 帧日志解析（A 层 · F26）
 *
 * 为什么必须有这个模块（本机实测发现，原 Python 算法完全不知道它存在）：
 * 324MB 样本里有 34 个 `_w.txt`，明文合计 1,007KB、共 1984 帧，全部附着在
 * `HTTP/1.1 101 Switching Protocols` 的会话上（两类长连接：一个 protobuf 类子协议、
 * 以及一家社交平台的实时网关；具体子协议名与域名属于能定位业务的指纹，只记在开发本机取证原稿里）。
 * 原算法的 RAW_FILE_RE 只认 _c/_s/_m，这些条目连"被丢弃"的告警都没有——
 * 而这批帧恰恰是长连接业务数据的唯一载体。按第一目的（喂给 AI 分析），这是必须补回的 B10。
 *
 * 实测字节级格式（hexdump 确认，全部 CRLF）：
 *   CRLF
 *   Request-Length: N CRLF        ← 或 Response-Length: N（方向）
 *   ID: k CRLF
 *   BitFlags: b CRLF
 *   DoneRead:  <ISO 7 位小数 +08:00> CRLF
 *   BeginSend: <ISO ...> CRLF
 *   DoneSend:  <ISO ...> CRLF
 *   CRLF
 *   <N 字节原始 WebSocket 帧>
 * 记录之间由一个 CRLF 分隔；N 是**含帧头的整帧长度**（实测 8 字节帧 = 81 82 10 2b 06 06 78 42）。
 *
 * 保真原则：帧本体一律按偏移量引用原始 Buffer，不复制不改写；
 * 解帧（掩码/长度）失败时保留整帧并标 `frameConsistent:false`，绝不猜。
 */

const meta = require('./session-meta.js');

const CR = 0x0d;
const LF = 0x0a;

/** WebSocket 操作码语义。 */
const OPCODES = {
  0: 'continuation',
  1: 'text',
  2: 'binary',
  8: 'close',
  9: 'ping',
  10: 'pong',
  11: 'reserved1',
  12: 'reserved2',
  13: 'reserved3',
  15: 'reserved4',
};

/** 记录头部里表示方向的键名 → 归一方向。 */
const DIR_KEYS = {
  'request-length': 'request',
  'response-length': 'response',
};

/** 从 pos 起读到下一个 LF 的一行（去掉行尾 CR）；无内容返回 null。 */
function readLine(buf, pos) {
  const idx = buf.indexOf(LF, pos);
  if (idx < 0) {
    return pos >= buf.length ? null : { text: buf.toString('latin1', pos, buf.length).replace(/\r$/, ''), next: buf.length };
  }
  const end = idx > pos && buf[idx - 1] === CR ? idx - 1 : idx;
  return { text: buf.toString('latin1', pos, idx).replace(/\r$/, ''), next: idx + 1, hadCR: end === idx - 1 };
}

/**
 * 解一个 WebSocket 帧。
 * @param {Buffer} buf 帧日志整块明文
 * @param {number} start 帧起始偏移
 * @param {number} len 声明的帧长度（含帧头）
 * @returns {object} 解帧结果（不抛异常）
 */
function decodeFrame(buf, start, len) {
  const out = {
    opcode: null, opcodeName: 'unknown', fin: false, rsv: 0,
    masked: false, maskKey: null, declaredPayloadLen: null,
    headerBytes: 0, payloadStart: 0, payloadLen: 0,
    frameConsistent: false, frameNote: '',
  };
  if (len < 2 || start + 2 > buf.length) {
    out.frameNote = '帧过短';
    return out;
  }
  const b0 = buf[start];
  const b1 = buf[start + 1];
  out.fin = (b0 & 0x80) !== 0;
  out.rsv = (b0 >> 4) & 0x7;
  out.opcode = b0 & 0x0f;
  out.opcodeName = OPCODES[out.opcode] || ('unknown' + out.opcode);
  out.masked = (b1 & 0x80) !== 0;
  let len7 = b1 & 0x7f;
  let p = start + 2;
  if (len7 === 126) {
    if (p + 2 > start + len) { out.frameNote = '扩展长度字段缺失'; return out; }
    len7 = (buf[p] << 8) | buf[p + 1];
    p += 2;
  } else if (len7 === 127) {
    if (p + 8 > start + len) { out.frameNote = '64 位长度字段缺失'; return out; }
    // JS 位运算限 32 位，这里按乘法组装；抓包帧长不可能到 2^32
    let hi = 0;
    for (let i = 0; i < 8; i++) hi = hi * 256 + buf[p + i];
    len7 = hi;
    p += 8;
  }
  out.declaredPayloadLen = len7;
  if (out.masked) {
    if (p + 4 > start + len) { out.frameNote = '掩码键缺失'; return out; }
    out.maskKey = buf.subarray(p, p + 4);
    p += 4;
  }
  out.headerBytes = p - start;
  out.payloadStart = p;
  out.payloadLen = Math.max(0, Math.min(len7, start + len - p));
  if (out.headerBytes + out.payloadLen === len) out.frameConsistent = true;
  else out.frameNote = out.frameNote || ('帧长不自洽: 头' + out.headerBytes + '+体' + out.payloadLen + ' != ' + len);
  if (out.rsv !== 0) out.frameNote = (out.frameNote ? out.frameNote + '; ' : '') + 'RSV 非 0（可能有扩展）';
  return out;
}

/** 取出帧去掩码后的应用数据；掩码帧按 RFC 6455 逐字节异或还原。 */
function framePayload(buf, record) {
  const f = record.frame;
  const end = Math.min(f.payloadStart + f.payloadLen, buf.length);
  const raw = buf.subarray(f.payloadStart, end);
  if (!f.masked || !f.maskKey) return raw;
  const out = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ f.maskKey[i & 3];
  return out;
}

/** 文本帧转字符串；非文本返回 null（不硬转，避免乱码污染分析包）。 */
function frameText(buf, record) {
  if (record.frame.opcode !== 1 && record.frame.opcode !== 0) return null;
  const payload = framePayload(buf, record);
  if (payload.length === 0) return '';
  // 明显不是合法 UTF-8 时不返回文本，交上层按二进制呈现
  const s = payload.toString('utf8');
  if (s.includes('\uFFFD')) return null;
  return s;
}

/**
 * 解析一份 `_w.txt`。
 * @param {Buffer} buf 条目明文
 * @param {object} [opts]
 * @param {number} [opts.maxFrames] 超过则停止并标 truncated（默认不限）
 * @param {number} [opts.textPreviewChars] 文本帧预览长度（默认 240）
 * @returns {{records:Array, stats:object, truncated:boolean, parseErrors:Array}}
 */
function parseWsLog(buf, opts) {
  const o = opts || {};
  const maxFrames = o.maxFrames || Infinity;
  const records = [];
  const parseErrors = [];
  if (!buf || buf.length === 0) {
    return { records, parseErrors, truncated: false, stats: emptyStats() };
  }

  let pos = 0;
  const total = buf.length;
  while (pos < total && records.length < maxFrames) {
    // 记录起始处会有一个空的 CRLF 分隔；对残留空白一律跳过
    while (pos < total && (buf[pos] === CR || buf[pos] === LF)) pos++;
    if (pos >= total) break;

    const fields = {};
    let sawBlank = false;
    let guard = 0;
    while (pos < total && guard++ < 32) {
      const ln = readLine(buf, pos);
      if (!ln) break;
      pos = ln.next;
      if (ln.text === '') { sawBlank = true; break; }
      const ci = ln.text.indexOf(':');
      if (ci <= 0) continue;
      fields[ln.text.slice(0, ci).trim().toLowerCase()] = ln.text.slice(ci + 1).trim();
    }
    if (!sawBlank) {
      parseErrors.push({ offset: pos, reason: '记录头部没有以空行结束' });
      break;
    }

    const dirKey = Object.keys(fields).find((k) => DIR_KEYS[k]);
    const declared = dirKey ? Number(fields[dirKey]) : NaN;
    if (!dirKey || !Number.isFinite(declared) || declared < 0) {
      parseErrors.push({ offset: pos, reason: '缺少 Request-Length/Response-Length，字段=' + Object.keys(fields).join(',') });
      break;
    }
    if (pos + declared > total) {
      parseErrors.push({ offset: pos, reason: '声明帧长 ' + declared + ' 超出剩余 ' + (total - pos) });
      // 仍登记一条不完整帧，保留已可读到的字节，绝不静默丢弃
      records.push(makeRecord(buf, pos, total - pos, fields, dirKey, declared, total - pos, null));
      pos = total;
      break;
    }
    const rec = makeRecord(buf, pos, declared, fields, dirKey, declared, declared, o);
    records.push(rec);
    pos += declared;

    // 帧后应紧跟一个 CRLF 分隔；若不是，说明长度或格式与实测模型不符，必须留痕
    if (pos < total && !(buf[pos] === CR && (pos + 1 >= total || buf[pos + 1] === LF))) {
      rec.boundaryOk = false;
      parseErrors.push({ offset: pos, reason: '帧边界后不是 CRLF，实际字节=0x' + buf[pos].toString(16) });
    } else {
      rec.boundaryOk = true;
    }
  }

  return {
    records,
    parseErrors,
    truncated: records.length >= maxFrames && pos < total,
    stats: summarize(records, parseErrors.length),
  };
}

/** 组装一条帧记录（含解帧结果与可选文本预览）。 */
function makeRecord(buf, payloadStart, len, fields, dirKey, declaredLen, actualLen, o) {
  const opts = o || {};
  const previewChars = opts.textPreviewChars === undefined ? 240 : opts.textPreviewChars;
  const dir = DIR_KEYS[dirKey];
  const frame = decodeFrame(buf, payloadStart, len);
  const rec = {
    dir,
    id: fields.id !== undefined ? Number(fields.id) : null,
    bitFlags: fields.bitflags !== undefined ? Number(fields.bitflags) : null,
    doneRead: fields.doneread || null,
    beginSend: fields.beginsend || null,
    doneSend: fields.donesend || null,
    doneReadAt: meta.parseTimestamp(fields.doneread || ''),
    declaredFrameLen: Number.isFinite(declaredLen) ? declaredLen : null,
    rawOffset: payloadStart,
    rawLength: len,
    truncatedPayload: actualLen !== declaredLen,
    boundaryOk: true,
    frame,
  };
  if (frame.opcode === 1 || frame.opcode === 0) {
    const t = frameText(buf, rec);
    if (t !== null) {
      rec.textLength = t.length;
      rec.textPreview = (previewChars > 0 && t.length > previewChars) ? t.slice(0, previewChars) : t;
      rec.textPreviewTruncated = t.length > rec.textPreview.length;
    } else {
      rec.textPreview = null;
      rec.note = '声明为文本帧但 UTF-8 解码失败';
    }
  }
  return rec;
}

/** 空统计形状（无帧时也返回同构对象，便于上层直接消费）。 */
function emptyStats() {
  return {
    frames: 0, request: 0, response: 0, bytes: 0,
    opcodes: {}, textFrames: 0, binaryFrames: 0, controlFrames: 0,
    masked: 0, inconsistent: 0, boundaryBad: 0, parseErrors: 0,
    maxFrameBytes: 0, firstAt: null, lastAt: null,
  };
}

/** 汇总帧统计（分析包 L0/L1 直接引用这些数字，不重复遍历）。 */
function summarize(records, parseErrorCount) {
  const st = emptyStats();
  st.frames = records.length;
  st.parseErrors = parseErrorCount || 0;
  let max = 0;
  for (const r of records) {
    st[r.dir]++;
    st.bytes += r.rawLength;
    if (r.rawLength > max) max = r.rawLength;
    const op = r.frame.opcodeName;
    st.opcodes[op] = (st.opcodes[op] || 0) + 1;
    if (r.frame.opcode === 1) st.textFrames++;
    else if (r.frame.opcode === 2) st.binaryFrames++;
    else if (r.frame.opcode >= 8) st.controlFrames++;
    if (r.frame.masked) st.masked++;
    if (!r.frame.frameConsistent) st.inconsistent++;
    if (r.boundaryOk === false) st.boundaryBad++;
    if (r.doneReadAt !== null) {
      if (st.firstAt === null || r.doneReadAt < st.firstAt) st.firstAt = r.doneReadAt;
      if (st.lastAt === null || r.doneReadAt > st.lastAt) st.lastAt = r.doneReadAt;
    }
  }
  st.maxFrameBytes = max;
  return st;
}

/**
 * 索引期使用的极轻摘要：只统计方向与帧数，不做解帧、不留文本。
 * 用于决定会话是否按"业务数据通道"归类，避免为 34/3756 的条目拖慢整包索引。
 */
function quickScan(buf) {
  if (!buf) return { frames: 0, request: 0, response: 0, bytes: 0 };
  const text = buf.toString('latin1');
  const mr = text.match(/^Request-Length: \d+/gm) || [];
  const ms = text.match(/^Response-Length: \d+/gm) || [];
  let bytes = 0;
  for (const x of mr.concat(ms)) bytes += Number(/(\d+)$/.exec(x)[1]);
  return { frames: mr.length + ms.length, request: mr.length, response: ms.length, bytes };
}

module.exports = {
  OPCODES,
  parseWsLog,
  decodeFrame,
  framePayload,
  frameText,
  quickScan,
  summarize,
};
