'use strict';

/**
 * beautify.js —— 导出可选美化（D4：由用户在导出时勾选，引擎双路径）
 *
 * ⚠️ 三条硬约束，决定了这里"能美化什么"的边界：
 * 1. **零第三方依赖**：ZTools 要求 preload 的第三方源码随包提交且不得压缩，
 *    而 jsbeautifier/cssbeautifier/htmlbeautifier 三个库体积大、审核面宽；
 *    因此只实现**语义安全**的极简重排，不追求与原 Python 的美化结果逐字符一致。
 * 2. **美化只发生在兼容层导出**：分析包（第一目的产出物）永远写原文，
 *    因为"给 AI 读"不需要好看，而重排会改变 token 结构与行列引用。
 * 3. **不做没把握的事**：JavaScript 重排缩进需要完整词法分析才安全
 *    （模板串、正则字面量、ASI 都可能被朴素重排破坏），
 *    因此 JS 一律保持原文并在结果里标 `applied:false` + 原因，绝不"看起来美化了其实改坏了"。
 */

const stream = require('../core/stream.js');

/** 字符串/注释感知的扫描器基础：返回每个字符是否处于"不可改写"区域。 */
function protectedMask(src, quotePairs, blockStart, lineComment) {
  const n = src.length;
  const mask = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || (ch === '`' && quotePairs.includes('`'))) {
      const q = ch;
      mask[i] = 1;
      i++;
      while (i < n) {
        mask[i] = 1;
        if (src[i] === '\\') { i++; if (i < n) mask[i] = 1; }
        else if (src[i] === q) { i++; break; }
        else i++;
      }
      continue;
    }
    if (blockStart && src.startsWith(blockStart, i)) {
      const endTok = blockStart === '/*' ? '*/' : '-->';
      const stop = src.indexOf(endTok, i + blockStart.length);
      const to = stop < 0 ? n : stop + endTok.length;
      for (; i < to; i++) mask[i] = 1;
      continue;
    }
    if (lineComment && src.startsWith(lineComment, i)) {
      const stop = src.indexOf('\n', i);
      const to = stop < 0 ? n : stop;
      for (; i < to; i++) mask[i] = 1;
      continue;
    }
    i++;
  }
  return mask;
}

/** JSON 美化：解析后按 indent 重新序列化；失败返回原文并标失败。 */
function beautifyJson(text, indent) {
  const pad = indent === undefined ? 2 : Number(indent);
  try {
    const obj = JSON.parse(text);
    return { text: JSON.stringify(obj, null, pad), applied: true, algorithm: 'json.parse+stringify' };
  } catch (e) {
    return { text, applied: false, algorithm: 'json', reason: e.message };
  }
}

/**
 * JSON 优先，整块解不开时退到“顶层多值逐份重排”（修 F28 在美化层面的表现）。
 * 只会重排“能单独 JSON.parse 的完整值”，值与值之间的残留字节一律原样保留，
 * 因此不会把一份坏正文“美化”成看不出原来的样子。
 */
function beautifyJsonOrValues(text, indent, o) {
  const first = beautifyJson(text, indent);
  if (first.applied) return first;
  const mv = stream.splitJsonValues(text, { maxValues: (o && o.maxStreamValues) || 2000 });
  if (!mv.ok) return first;
  const pad = indent === undefined ? 2 : Number(indent);
  const out = [];
  let pos = 0;
  let reformatted = 0;
  for (const v of mv.values) {
    out.push(text.slice(pos, v.start));           // 值与值之间只可能是空白，原样带走
    const raw = text.slice(v.start, v.end);
    const j = stream.tryJson(raw);
    if (j.ok) { out.push(JSON.stringify(j.value, null, pad)); reformatted++; }
    else out.push(raw);                            // 解不开的值不动它
    pos = v.end;
  }
  out.push(text.slice(pos));                       // 尾部残留（splitJsonValues 已保证为空）
  if (reformatted === 0) return first;
  return {
    text: out.join(''),
    applied: true,
    algorithm: 'json.multi-value',
    note: '正文是 ' + mv.values.length + ' 份顶层 JSON 拼接（整块不是合法 JSON），已逐份重排 ' + reformatted + ' 份',
  };
}

/**
 * SSE 事件流美化：只改“排版”，不改协议语义。
 *
 * 为什么默认**不**展开 `data:` 里的 JSON：按规范，一个事件的 `data` 是多个 `data:` 行用
 * `\n` 拼接的结果，把一份 JSON 拆成多行写回 `data:` 会改变重放时的字符串（多出换行），
 * 属“看起来更好看、实则改了数据”。需要时显式传 `expandSseData:true`，此时按规范
 * 拆成多个 `data:` 行并在 note 里标风险。
 */
function beautifyEventStream(text, o) {
  const opt = o || {};
  const r = stream.parseEventStream(text, { maxEvents: opt.maxStreamEvents || 20000 });
  if (!r.stats || r.stats.events === 0) {
    return { text, applied: false, algorithm: 'event-stream', reason: '未解出任何事件，保持原文' };
  }
  if (r.stats.overflow > 0) {
    return { text, applied: false, algorithm: 'event-stream', reason: '事件数超上限 ' + r.stats.events + '，不重排' };
  }
  const blocks = [];
  for (const ev of r.events) {
    const lines = [];
    // 注释/心跳行不属于任何字段，但它是真实抓包内容：保留为 `:` 空注释，不静默丢弃
    for (let k = 0; k < (ev.commentLines || 0); k++) lines.push(':');
    if (ev.id !== null) lines.push('id: ' + ev.id);
    if (ev.event !== null) lines.push('event: ' + ev.event);
    if (ev.retry !== null) lines.push('retry: ' + ev.retry);
    if (ev.data !== null) {
      const dataStr = typeof ev.data === 'string' ? ev.data : String(ev.data);
      if (opt.expandSseData) {
        const j = stream.tryJson(dataStr);
        if (j.ok) {
          const pretty = JSON.stringify(j.value, null, opt.indent === undefined ? 2 : Number(opt.indent));
          for (const one of pretty.split('\n')) lines.push('data: ' + one);
        } else lines.push('data: ' + dataStr);
      } else {
        for (const one of dataStr.split('\n')) lines.push('data: ' + one);
      }
    }
    for (const other of (ev.other || [])) lines.push(other);
    blocks.push(lines.join('\n'));
  }
  return {
    text: blocks.join('\n\n') + '\n',
    applied: true,
    algorithm: 'event-stream.normalize',
    note: '已把 ' + r.stats.events + ' 个事件统一为单空行分隔（LF）'
      + (opt.expandSseData ? '，并展开 data 内 JSON（会改变重放时的拼接结果）' : '；data 内容逐字节未改')
      + (r.stats.comments ? '；' + r.stats.comments + ' 行注释/心跳已转成 `:` 保留（纯注释块不成事件，已丢弃）' : ''),
  };
}

/**
 * CSS 美化：按大括号深度重排缩进，字符串与注释区不改写。
 * 只在 `{`、`;`、`}` 处断行，不改动任何选择器或声明内容。
 */
function beautifyCss(text, indent) {
  const pad = ' '.repeat(indent === undefined ? 2 : Number(indent));
  const mask = protectedMask(text, ['"', "'"], '/*', null);
  const out = [];
  let depth = 0;
  let line = '';
  const push = (s) => {
    const t = s.trim();
    if (!t) return;
    out.push(pad.repeat(Math.max(0, depth)) + t);
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!mask[i] && ch === '\n') { continue; }
    line += ch;
    if (mask[i]) continue;
    if (ch === '{') { push(line.slice(0, -1)); line = ''; depth++; }
    else if (ch === '}') { push(line.slice(0, -1)); line = ''; depth = Math.max(0, depth - 1); out.push(pad.repeat(depth) + '}'); }
    else if (ch === ';') { push(line); line = ''; }
  }
  if (line.trim()) push(line);
  return { text: out.join('\n'), applied: true, algorithm: 'css.brace-depth' };
}

/**
 * XML / HTML 保守美化：只按标签深度缩进。
 * `<script>` `<style>` `<pre>` `<textarea>` 内部与 CDATA、注释**原样保留**，
 * 因为那里空白有意义（Python 用的 minidom / htmlbeautifier 同样不能保证安全，
 * 但本实现的取舍是"宁可少排，不可排坏"）。
 */
function beautifyMarkup(text) {
  const RAW = /^(script|style|pre|textarea)$/i;
  const lines = [];
  let depth = 0;
  let i = 0;
  const n = text.length;
  const emit = (s, d) => {
    const t = s.replace(/\r\n/g, '\n');
    if (!t.trim()) return;
    lines.push('  '.repeat(Math.max(0, d)) + t.trim());
  };
  let buf = '';
  while (i < n) {
    if (text.startsWith('<!', i) && !text.startsWith('<!DOCTYPE', i, 9)) {
      if (text.startsWith('<!--', i)) {
        const stop = text.indexOf('-->', i);
        const to = stop < 0 ? n : stop + 3;
        emit(text.slice(i, to), depth);
        i = to;
        continue;
      }
      if (text.startsWith('<![CDATA[', i)) {
        const stop = text.indexOf(']]>', i);
        const to = stop < 0 ? n : stop + 3;
        emit(text.slice(i, to), depth);
        i = to;
        continue;
      }
    }
    if (text[i] === '<') {
      const close = text.indexOf('>', i);
      if (close < 0) { buf += text.slice(i); break; }
      const tag = text.slice(i, close + 1);
      const nameM = /^<\/?\s*([A-Za-z0-9:_-]+)/.exec(tag);
      const name = nameM ? nameM[1] : '';
      const isClose = tag[1] === '/';
      const selfClose = /\/>$/.test(tag) || name === 'br' || name === 'hr' || name === 'meta' || name === 'link' || name === 'img' || name === 'input';
      if (isClose) { buf && emit(buf, depth); buf = ''; depth = Math.max(0, depth - 1); emit(tag, depth); }
      else {
        buf && emit(buf, depth); buf = '';
        emit(tag, depth);
        if (!selfClose) depth++;
        if (RAW.test(name)) {
          // 整块原样搬到闭合标签为止
          const endTag = '</' + name;
          const stop = text.toLowerCase().indexOf(endTag, close + 1);
          const to = stop < 0 ? n : text.indexOf('>', stop) + 1;
          const inner = text.slice(close + 1, Math.max(close + 1, stop < 0 ? n : stop));
          if (inner.trim()) lines.push('  '.repeat(depth) + inner.trim().replace(/\r\n/g, '\n'));
          if (stop >= 0) { const endClose = text.indexOf('>', stop); emit(text.slice(stop, endClose + 1), Math.max(0, depth - 1)); depth = Math.max(0, depth - 1); i = endClose + 1; continue; }
          i = to;
          continue;
        }
      }
      i = close + 1;
      continue;
    }
    buf += text[i];
    i++;
  }
  buf && emit(buf, depth);
  return { text: lines.join('\n'), applied: true, algorithm: 'markup.tag-depth' };
}

/** 按 Content-Type 选择美化器；未覆盖类型返回原文并说明原因。 */
function beautify(text, contentType, opts) {
  const o = opts || {};
  const level = o.level || 'json';
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (level === 'none' || !text) return { text, applied: false, algorithm: 'none', reason: level === 'none' ? '用户未勾选美化' : '空内容' };
  if (base === 'application/json' || base === 'text/json' || base.endsWith('+json')) return beautifyJsonOrValues(text, o.indent, o);
  if (stream.isEventStream(base)) {
    // 事件流归为“结构化正文”：level 为 json 时也处理（它本质是逐事件的 JSON 容器）
    return beautifyEventStream(text, o);
  }
  if (level === 'all') {
    if (base === 'text/css') return beautifyCss(text, o.indent);
    if (base === 'application/xml' || base === 'text/xml' || base.endsWith('+xml')) return beautifyMarkup(text);
    if (base === 'text/html') return beautifyMarkup(text);
    if (/(javascript|ecmascript)/.test(base) || base === 'application/x-javascript') {
      // 有意不做：朴素 JS 重排可能破坏模板串/正则字面量语义，属"改坏比不改更糟"
      return { text, applied: false, algorithm: 'js', reason: 'JS 重排需完整词法分析，为避免改坏语义保持原文' };
    }
  }
  // 按内容兜底（与引擎侧同一套判据）：实测存在把多值 JSON 错标成 text/html 的真实会话
  // （某真实样本 sid1642：290.8KB / 9 份顶层值被错标成 text/html，取证见设计文档 1.14），以前这里按头判就直接 passthrough。
  // 真 HTML/JS/CSS 不会进来：worthSniffing 只放行首非空白字符为 { 或 [，且 splitJsonValues 要求值间纯空白且无残留。
  if (stream.worthSniffing(text)) {
    const byContent = beautifyJsonOrValues(text, o.indent, o);
    if (byContent.applied) {
      byContent.detectedBy = 'content';
      return byContent;
    }
  }
  return { text, applied: false, algorithm: 'passthrough', reason: '类型 ' + (base || '未声明') + ' 不在美化范围，且正文不是顶层多值 JSON' };
}

module.exports = {
  beautify,
  beautifyJson,
  beautifyJsonOrValues,
  beautifyEventStream,
  beautifyCss,
  beautifyMarkup,
};
