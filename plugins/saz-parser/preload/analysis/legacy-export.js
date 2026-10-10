'use strict';

/**
 * legacy-export.js —— 与原 解析SAZ.py 同构的目录树导出（C 层 · F7 / F16 兼容层）
 *
 * 定位（D7 v0.3 起下调）：**兼容层，不是设计基线**。
 * 保留它的唯一理由是"旧工作流不断档"——用户已习惯 `NNN_METHOD_host_path/请求.txt` 这套形态。
 *
 * 与原算法的**有意不一致**（都在 _导出清单.md 里逐条列出，不做静默差异）：
 * | 差异 | 原算法 | 本实现 | 依据 |
 * |---|---|---|---|
 * | 会话目录名 | `{seq}_{METHOD} {Host}{target}`，CONNECT 双拼 | `{seq}_{METHOD}_{target}__sid{sid}`，不双拼且 sid 防覆盖 | B1/B7 |
 * | 扩展名 | `image/` → `.`、`image/x.fb.keyframes` → 超长怪名 | 一律过 safeExt 校验，不合格落 `.bin` | B2 |
 * | 输出目录已存在 | `shutil.rmtree` 无条件强删重建 | 冲突策略 `skip/overwrite/unique`，默认 overwrite，**绝不整目录删除** | B3 |
 * | 解压失败 | 只 print 警告，把压缩字节原样写进 `.txt` | 单独落 `未解码.bin` + `未解码.md` 说明，`.txt` 里不出现乱码 | B5 |
 * | chunked 分块 | 全文件零 `chunked` 关键字，框架字节混在正文里 | 先 transfer-decoding 再 content-decoding | B11 |
 * | 响应头 | 解压后正则删掉 `Content-Encoding` 行（但 `Content-Length` 已失效） | 默认保留原始头行（可选项 stripContentEncoding 复刻旧行为） | B6 |
 * | `_m.xml` | 完全丢弃 | 可选 `withMeta` 落 `会话元数据.xml`（默认关，保持同构） | B8 |
 * | 美化 | 依赖 jsbeautifier 等第三方库，缺失时静默不美化 | 显式 level，未覆盖类型标 `applied:false` + 原因 | D4 |
 */

const fs = require('node:fs');
const path = require('node:path');

const msg = require('../core/message');
const dec = require('../core/decode');
const types = require('../core/types');
const safeName = require('../core/safe-name');
const beautify = require('./beautify');
const token = require('./token');
const query = require('./query');

const DEFAULTS = {
  /** 目录名/文件名词表语言 */
  lang: 'zh',
  /** 已存在同名会话目录时的策略：overwrite（覆盖同名文件）| skip | unique（加后缀） */
  onConflict: 'overwrite',
  /** 是否整目录预清空 —— 默认 false，且刻意不提供 true（B3 教训） */
  purge: false,
  /** 美化级别：none | json | all */
  beautifyLevel: 'none',
  beautifyIndent: 2,
  /** 复刻原算法：解压后从响应头删掉 Content-Encoding 行 */
  stripContentEncoding: false,
  /** 额外落 _m.xml 副本（破坏同构，默认关） */
  withMeta: false,
  /** 额外落 WebSocket 帧（B10 修正；开启会破坏同构，默认开，因为丢数据比多文件更严重） */
  withWebsocket: true,
  /** 单会话正文上限（字节），超出落盘仍写全量，只是不加载进内存 */
  maxBodyBytes: 0,
  /**
   * 选取集合（与 F24 / 分析包同口径）：`{sids:[...]}` 或 `{filter:{...}}`。
   * 只接纯数据，不接函数——函数跳不过 contextBridge。
   * UI 的「只导出当前筛选视图」与 F9「导出该会话」都走这里。
   */
  selection: null,
};

/**
 * 决定正文是否"单独成文"以及用什么扩展名。
 * 🔴 与 isTextualType 的字节嗅探不同，这里**声明优先**：
 *    Content-Type 只要声明了且不在文本名单里，就当二进制单独落盘（与原算法 is_text_content 同口径）。
 *    实测依据：seq=122 的 `application/force-download` 响应体是 vCard 纯文本，
 *    我们按字节嗅探会把它塑进 响应.txt，而原算法单独落 响应体.bin——
 *    兼容层的职责就是不复现这种差异，而不是自认为更聪明。
 *    只在 Content-Type 缺声明时才嗅字节。
 */
function bodyExt(contentType, urlPath, fallbackExt) {
  if (types.isExtractable(contentType)) {
    const e = types.extForContentType(contentType) || types.extFromUrl(urlPath);
    return { separate: true, ext: e || fallbackExt || '.txt', extractable: true };
  }
  const ct = String(contentType || '').trim();
  if (!ct) {
    return { separate: null, ext: '', extractable: false };  // 无声明 → 交给字节嗅探
  }
  const textual = types.isTextualType(ct);
  if (textual === true) return { separate: false, ext: '', extractable: false };
  const e = types.extForContentType(ct) || types.extFromUrl(urlPath);
  return { separate: true, ext: e || '.bin', extractable: false };
}

/**
 * 写一个会话目录。
 * @param {string} dir 输出根
 * @param {object} session 索引会话项
 * @param {object} detail archive.detail 结果
 * @param {object} ctx 合并后的选项与状态
 */
function writeSessionDir(dir, session, detail, ctx) {
  const name = safeName.sessionDirName({ seq: session.seq, method: session.method, url: session.url, host: session.host, sid: session.sid });
  const usedName = safeName.shrinkDirName(dir, name, '响应.txt', ctx.pathLimit);
  let target = path.join(dir, usedName);
  if (fs.existsSync(target)) {
    if (ctx.onConflict === 'skip') { ctx.skipped.push({ sid: session.sid, dir: usedName, reason: '目录已存在且 onConflict=skip' }); return null; }
    if (ctx.onConflict === 'unique') target = path.join(dir, usedName + '_2');
  }
  fs.mkdirSync(target, { recursive: true });
  const files = [];
  const R = safeName.roleFileName;

  /* ---- 请求侧 ---- */
  if (detail.request) {
    const req = detail.request;
    const headerText = String(req.headerText || '');
    const body = req.bodyBuf;
    const plan = bodyExt(req.contentType || session.reqContentType, session.path, '.txt');
    let fileName = R('request', ctx.lang) + '.txt';
    if (!body || body.length === 0) {
      files.push(writeText(target, fileName, headerText));
    } else if (plan.separate === false) {
      // 文本类但不单独成文：头 + 空行 + 体（原算法同款）
      files.push(writeText(target, fileName, headerText + '\r\n\r\n' + body.toString('utf8')));
    } else if (plan.separate === true) {
      files.push(writeText(target, fileName, headerText));
      const bodyName = R('requestBody', ctx.lang) + plan.ext;
      if (plan.extractable && ctx.beautifyLevel !== 'none') {
        const b = beautify.beautify(body.toString('utf8'), req.contentType, { level: ctx.beautifyLevel, indent: ctx.beautifyIndent });
        files.push(writeText(target, bodyName, b.text));
        if (!b.applied) ctx.notes.push({ sid: session.sid, file: bodyName, algorithm: b.algorithm, reason: b.reason });
      } else {
        files.push(writeBytes(target, bodyName, body));
      }
    } else {
      // 类型未声明：按嗅探决定
      if (dec.looksTextual(body, 4096)) files.push(writeText(target, fileName, headerText + '\r\n\r\n' + body.toString('utf8')));
      else {
        files.push(writeText(target, fileName, headerText));
        files.push(writeBytes(target, R('requestBody', ctx.lang) + (types.extFromUrl(session.path) || '.bin'), body));
      }
    }
  }

  /* ---- 响应侧 ---- */
  if (detail.response) {
    const resp = detail.response;
    const d = detail.decode && detail.decode.response;
    let headerText = String(resp.headerText || '');
    if (ctx.stripContentEncoding && d && d.chain && d.chain.length && !(d && d.failed)) {
      headerText = headerText.replace(/^Content-Encoding:.*(\r\n|\n)?/im, '');
    }
    const body = resp.bodyBuf;
    const ct = resp.contentType || session.respContentType;
    const plan = bodyExt(ct, session.path, '.txt');

    if (d && d.failed) {
      // B5 修正：压缩字节绝不混入 .txt
      files.push(writeText(target, R('response', ctx.lang) + '.txt', headerText));
      const rawCompressed = resp.rawBodyBuf || Buffer.alloc(0);
      files.push(writeBytes(target, R('decodeFailed', ctx.lang) + '.bin', rawCompressed));
      files.push(writeText(target, R('decodeFailed', ctx.lang) + '.md',
        '# 本会话响应未能解压\n\n' +
        '算法：' + d.algorithm + '\n原因：' + d.reason + '\n' +
        '归档内压缩字节 ' + token.humanBytes(rawCompressed.length) + '，已原样存入 ' + R('decodeFailed', ctx.lang) + '.bin\n\n' +
        '原算法在此处会把压缩字节直接写进 .txt（缺陷 B5），用户拿到乱码文件却无从知晓。\n' +
        '本实现保留原始压缩字节并显式标注，需要时可自行解压。'));
      ctx.decodeFailed.push({ sid: session.sid, algorithm: d.algorithm, reason: d.reason, bytes: rawCompressed.length });
      session.respDecodeFailed = true;
      session.respDecodeFailedReason = d.reason;
      return { dir: usedName, files, websocket: null };
    }

    // 带 chunked 头但框架解不开：正文会含长度行（与原算法同款形态），必须留痕不能静默
    if (d && d.dechunk && d.dechunk.applied === false) {
      ctx.dechunkFailed.push({ sid: session.sid, reason: d.dechunk.error || d.dechunk.reason || '未知', bytes: body ? body.length : 0 });
    }

    if (!body || body.length === 0) {
      files.push(writeText(target, R('response', ctx.lang) + '.txt', headerText));
    } else if (plan.separate === false) {
      files.push(writeText(target, R('response', ctx.lang) + '.txt', headerText + '\r\n\r\n' + body.toString('utf8')));
    } else if (plan.separate === true) {
      files.push(writeText(target, R('response', ctx.lang) + '.txt', headerText));
      const bodyName = R('responseBody', ctx.lang) + plan.ext;
      if (plan.extractable && ctx.beautifyLevel !== 'none') {
        const b = beautify.beautify(body.toString('utf8'), ct, { level: ctx.beautifyLevel, indent: ctx.beautifyIndent });
        files.push(writeText(target, bodyName, b.text));
        if (!b.applied) ctx.notes.push({ sid: session.sid, file: bodyName, algorithm: b.algorithm, reason: b.reason });
      } else {
        files.push(writeBytes(target, bodyName, body));
      }
    } else {
      if (dec.looksTextual(body, 4096)) files.push(writeText(target, R('response', ctx.lang) + '.txt', headerText + '\r\n\r\n' + body.toString('utf8')));
      else {
        files.push(writeText(target, R('response', ctx.lang) + '.txt', headerText));
        files.push(writeBytes(target, R('responseBody', ctx.lang) + (types.extFromUrl(session.path) || '.bin'), body));
      }
    }
  }

  /* ---- 可选扩展（默认开启的两项都会破坏严格同构，因此清单里必须写明）---- */
  if (ctx.withMeta && detail.meta && !detail.meta.parseFailed) {
    files.push(writeText(target, '会话元数据.xml', String(detail.meta.rawText || JSON.stringify(detail.meta, null, 2))));
  }
  let wsInfo = null;
  if (ctx.withWebsocket && detail.websocket && detail.websocket.records && detail.websocket.records.length) {
    const w = detail.websocket;
    const lines = [];
    lines.push('# WebSocket 帧（Fiddler raw/' + session.sid + '_w.txt）');
    lines.push('原算法不产出这部分（缺陷 B10）。以下为按 RFC 6455 去掩码后的帧。');
    lines.push('帧数=' + w.stats.frames + ' 操作码=' + JSON.stringify(w.stats.opcodes));
    w.records.forEach((r, i) => {
      const t = w.textAt(i);
      lines.push('--- #' + i + ' ' + r.dir + ' ' + r.frame.opcodeName + ' 声明=' + r.declaredFrameLen + 'B 帧头=' + r.frame.headerBytes +
        ' 掩码=' + (r.frame.masked ? '是' : '否') + ' @' + (r.doneRead || '') +
        (r.frame.frameNote ? ' 注=' + r.frame.frameNote : ''));
      if (t !== null && t !== undefined) lines.push(t);
      else {
        const p = w.payloadAt(i);
        lines.push('(二进制 ' + (p ? p.length : 0) + 'B) ' + (p ? p.subarray(0, 200).toString('hex') : ''));
      }
    });
    files.push(writeText(target, 'WebSocket帧.md', lines.join('\n')));
    wsInfo = { frames: w.stats.frames, bytes: w.stats.bytes };
  }
  return { dir: usedName, files, websocket: wsInfo };
}

/** 文本写入（UTF-8，统一 LF 结尾由内容自定）。 */
function writeText(dir, name, text) {
  const full = path.join(dir, safeName.sanitizeName(name, { maxLen: 120, fallback: 'unnamed' }));
  fs.writeFileSync(full, text === undefined || text === null ? '' : text, 'utf8');
  return { path: path.basename(full), bytes: Buffer.byteLength(String(text || ''), 'utf8'), kind: 'text' };
}

/** 二进制写入（原样字节，不改一个 bit）。 */
function writeBytes(dir, name, buf) {
  const full = path.join(dir, safeName.sanitizeName(name, { maxLen: 120, fallback: 'unnamed' }));
  fs.writeFileSync(full, buf);
  return { path: path.basename(full), bytes: buf.length, kind: 'raw' };
}

/**
 * 执行同构导出。
 * @param {object} archive openArchive 结果
 * @param {string} outDir 输出根目录（不存在则创建；**不会删除已有内容**）
 * @param {object} [options] 覆盖 DEFAULTS
 * @param {(p:object)=>void} [onProgress]
 */
function exportLegacy(archive, outDir, options, onProgress) {
  const o = Object.assign({}, DEFAULTS, options || {});
  if (o.purge) throw new Error('purge 已被禁用：原算法的 shutil.rmtree 属破坏性操作（缺陷 B3），请改用空目录或 onConflict');
  const ctx = {
    lang: o.lang,
    onConflict: o.onConflict,
    beautifyLevel: o.beautifyLevel,
    beautifyIndent: o.beautifyIndent,
    stripContentEncoding: o.stripContentEncoding,
    withMeta: o.withMeta,
    withWebsocket: o.withWebsocket,
    pathLimit: o.pathLimit || 240,
    decodeFailed: [],
    dechunkFailed: [],
    skipped: [],
    notes: [],
    dirs: [],
  };
  fs.mkdirSync(outDir, { recursive: true });

  let targets = archive.sessions.filter((s) => s.hasRequest || s.hasResponse);
  const totalTargets = targets.length;
  let selectionNote = null;
  if (o.selection && (Array.isArray(o.selection.sids) || o.selection.filter)) {
    if (Array.isArray(o.selection.sids)) {
      const set = new Set(o.selection.sids.map(Number));
      targets = targets.filter((s) => set.has(s.sid));
    } else {
      targets = query.querySessions(targets, o.selection.filter, {}).items;
    }
    selectionNote = '按 selection 选取 ' + targets.length + '/' + totalTargets + ' 个会话目录';
  }
  const t0 = Date.now();
  let writtenFiles = 0, bytes = 0;
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    let detail;
    try {
      detail = archive.detail(s, { withFields: false, maxBodyBytes: o.maxBodyBytes, keepRawBody: true });
    } catch (e) {
      ctx.skipped.push({ sid: s.sid, reason: '读取失败 ' + e.message });
      continue;
    }
    if (detail.response && detail.response.rawBodyBuf === undefined) detail.response.rawBodyBuf = detail.response.bodyBuf;
    const r = writeSessionDir(outDir, s, detail, ctx);
    if (r) {
      writtenFiles += r.files.length;
      for (const f of r.files) bytes += f.bytes;
      ctx.dirs.push({ sid: s.sid, dir: r.dir, files: r.files.length, ws: r.websocket });
    }
    if (onProgress && (i % 25 === 0 || i === targets.length - 1)) onProgress({ done: i + 1, total: targets.length, phase: 'legacy', sid: s.sid });
  }

  const manifest = {
    mode: 'legacy-tree',
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    source: { name: archive.name, path: archive.path, sizeBytes: archive.fileSize },
    output: outDir,
    options: o,
    selectionNote,
    counts: {
      sessions: targets.length,
      sessionsInArchive: totalTargets,
      dirs: ctx.dirs.length,
      files: writtenFiles,
      bytes,
      decodeFailed: ctx.decodeFailed.length,
      dechunkFailed: ctx.dechunkFailed.length,
      skipped: ctx.skipped.length,
      beautifyNotes: ctx.notes.length,
    },
    intentionalDifferences: [
      '目录名不双拼且带 __sid 后缀（修 B1/B7），与原算法产物名不同',
      '扩展名一律过 safeExp 校验，不合格落 .bin（修 B2）',
      '不删除已存在目录（修 B3），冲突按 onConflict 处理',
      '解压失败落 未解码.bin + 未解码.md，.txt 内不写压缩字节（修 B5）',
      // 原算法全文件零 chunked 关键字：它把分块框架字节当正文写出（形如「471 + CRLF + JSON」）。
      // 本实现按 RFC 9112 做 transfer-decoding，因此这类会话的 .txt 与原算法产物字节不同（修 B11）。
      'Transfer-Encoding: chunked 已解框（剥长度行与块尾 CRLF，trailer 不混入正文），原算法把框架字节当正文写出（修 B11）',
      '响应头默认保留 Content-Encoding 原始行（修 B6），可选项复刻旧行为',
      o.withWebsocket ? '额外产出 WebSocket帧.md（原算法完全丢弃，修 B10）' : '未产出 WebSocket 帧',
      o.withMeta ? '额外产出 会话元数据.xml（原算法丢弃，修 B8）' : '未产出会话元数据（保持同构）',
    ],
    decodeFailed: ctx.decodeFailed,
    dechunkFailed: ctx.dechunkFailed,
    skipped: ctx.skipped,
    beautifyNotes: ctx.notes,
  };
  fs.writeFileSync(path.join(outDir, '_导出清单.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, '_导出清单.md'), renderLegacyReadme(manifest), 'utf8');
  return manifest;
}

/** 兼容层导出的可读说明。 */
function renderLegacyReadme(m) {
  const L = [];
  L.push('# 同构目录树导出清单');
  L.push('源归档：' + m.source.path + '（' + token.humanBytes(m.source.sizeBytes) + '）');
  L.push('输出目录：' + m.output + '   会话目录 ' + m.counts.dirs + ' 个   文件 ' + m.counts.files + ' 个   体积 ' + token.humanBytes(m.counts.bytes));
  L.push('美化级别：' + m.options.beautifyLevel + '   冲突策略：' + m.options.onConflict);
  L.push('');
  L.push('## 与原 解析SAZ.py 的**有意不一致**（不是 bug，是修缺陷）');
  for (const d of m.intentionalDifferences) L.push('- ' + d);
  L.push('');
  if (m.counts.decodeFailed) {
    L.push('## 未能解压的响应 ' + m.counts.decodeFailed.length + ' 条（已落 未解码.bin，未写进 .txt）');
    for (const f of m.decodeFailed.slice(0, 200)) L.push('  sid=' + f.sid + '  ' + f.algorithm + '  ' + f.reason + '  ' + token.humanBytes(f.bytes));
    L.push('');
  }
  if (m.counts.dechunkFailed) {
    L.push('## 带 chunked 头但分块框架解不开的响应 ' + m.counts.dechunkFailed + ' 条');
    L.push('  → 这些会话的 响应体 仍含十六进制长度行（为不弄坏数据而整块退还），不等同于“已解框”。');
    for (const f of m.dechunkFailed.slice(0, 200)) L.push('  sid=' + f.sid + '  ' + f.reason + '  ' + token.humanBytes(f.bytes));
    L.push('');
  }
  if (m.counts.skipped) {
    L.push('## 跳过的会话 ' + m.counts.skipped.length + ' 条');
    for (const s of m.skipped.slice(0, 200)) L.push('  sid=' + (s.sid || '?') + '  ' + s.reason);
    L.push('');
  }
  if (m.counts.beautifyNotes) {
    L.push('## 未美化的文件（' + m.counts.beautifyNotes.length + ' 条，逐条给原因）');
    const agg = new Map();
    for (const n of m.beautifyNotes) {
      const k = n.algorithm + ' → ' + n.reason;
      agg.set(k, (agg.get(k) || 0) + 1);
    }
    for (const [k, v] of agg) L.push('  ×' + v + '  ' + k);
  }
  return L.join('\n');
}

module.exports = {
  DEFAULTS,
  exportLegacy,
  writeSessionDir,
  bodyExt,
  renderLegacyReadme,
};
