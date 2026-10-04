'use strict';

/**
 * token.js —— 分析包体积预算（B 层 · F22 的基础设施）
 *
 * ⚠️ 这是**估算**，不是精确 BPE 计数。做精确计数需要携带词表（数十万条），
 * 既违反"第三方源码须随包提交且不得压缩"的审核要求，也会让插件体积失控。
 * 因此这里用可解释的启发式并**在 manifest 里如实标注估算方式**，
 * 绝不假装是精确值——那是"静默误导"，与第一目的相悖。
 *
 * 估算口径（默认值来自公开 tokenizer 的常见经验区间）：
 *   tokens ≈ ceil(中日韩字符数 × cjkTokens) + ceil(其余字符数 / charsPerToken) + 行数 × lineTokens
 *   cjkTokens = 1.2（主流分词器中文实际 1.0~1.5，取偏上一侧以免超窗）
 *   charsPerToken = 4（英文/代码/JSON 结构符常见值）
 *   lineTokens = 0.5（换行与段落边界）
 * 预算方向一律**偏高不偏低**：宁可少塞内容，不可撑爆上下文窗口。
 */

/** CJK 与全角标点区段（覆盖中日韩与全角符号，够抓包日志场景）。 */
const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

const DEFAULTS = { cjkTokens: 1.2, charsPerToken: 4, lineTokens: 0.5 };

/**
 * 估算一段文本的 token 数。
 * @param {string} text
 * @param {object} [opts] 覆盖 DEFAULTS
 * @returns {number} 向上取整后的估算值
 */
function estimateTokens(text, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  if (!text) return 0;
  const s = String(text);
  let cjk = 0;
  let other = 0;
  let lines = 1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n') lines++;
    if (CJK_RE.test(ch)) cjk++;
    else other++;
  }
  const est = Math.ceil(cjk * o.cjkTokens) + Math.ceil(other / o.charsPerToken) + Math.ceil(lines * o.lineTokens);
  return est;
}

/**
 * 预算容器：按顺序接收内容块，超预算时告知调用方"该块放不下"。
 * 调用方据此执行降级并写 trimLog —— 降级决策显式存在于上层，而不是埋在工具里。
 */
function createBudget(limitTokens, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  let used = 0;
  const items = [];
  return {
    limit: limitTokens,
    get used() { return used; },
    get remaining() { return Math.max(0, limitTokens - used); },
    get overflow() { return Math.max(0, used - limitTokens); },
    get ratio() { return limitTokens ? used / limitTokens : 0; },
    estimate(text) { return estimateTokens(text, o); },
    /** 是否有空间再容纳 text；不消耗预算。 */
    fits(text) { return used + estimateTokens(text, o) <= limitTokens; },
    /** 收入一块内容并计预算；返回该块 token。 */
    add(label, text) {
      const t = estimateTokens(text, o);
      used += t;
      items.push({ label, tokens: t, chars: String(text || '').length });
      return t;
    },
    /** 按 token 上限把文本切成多段（供分卷 / 大正文截断复用）。 */
    items,
    options: o,
  };
}

/**
 * 把一串内容块按 token 预算分卷。
 * @param {Array<{label:string, text:string}>} blocks
 * @param {number} perVolumeTokens 单卷预算
 * @returns {Array<{index:number, blocks:Array, tokens:number}>}
 */
function splitIntoVolumes(blocks, perVolumeTokens) {
  const volumes = [];
  let cur = { index: 1, blocks: [], tokens: 0 };
  for (const b of blocks) {
    const t = estimateTokens(b.text);
    // 单块就超预算时不丢弃，而是独占一卷并在 manifest 里标 oversize
    if (cur.tokens + t > perVolumeTokens && cur.blocks.length > 0) {
      volumes.push(cur);
      cur = { index: volumes.length + 1, blocks: [], tokens: 0 };
    }
    cur.blocks.push(Object.assign({}, b, { tokens: t }));
    cur.tokens += t;
    if (t > perVolumeTokens) cur.oversize = true;
  }
  if (cur.blocks.length) volumes.push(cur);
  return volumes;
}

/** 字节数友好显示（manifest 与 UI 共用）。 */
function humanBytes(n) {
  if (!Number.isFinite(n)) return '0';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v < 10 ? 2 : 1)) + units[i];
}

module.exports = {
  DEFAULTS,
  estimateTokens,
  createBudget,
  splitIntoVolumes,
  humanBytes,
};
