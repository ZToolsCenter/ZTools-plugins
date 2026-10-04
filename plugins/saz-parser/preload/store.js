'use strict';

/**
 * store.js —— 已打开归档的句柄缓存（B/C 层共用的状态层）
 *
 * 为什么需要：openArchive 会**持有文件句柄**并常驻索引内存
 * （实测 324MB 样本索引后 RSS 从 73MB 升到 ~190MB）。
 * UI 里切文件、MCP 连续调用 saz_parse → saz_body 都依赖同一个句柄，
 * 但绝不能无上限地攒着 —— 三个大样本就能把内存吃穿。
 * 因此这里是**有界 LRU**，淘汰时 close() 并告知调用方。
 */

const path = require('node:path');
const indexer = require('./core/indexer');

const DEFAULT_MAX = 2;

function createArchiveStore(opts) {
  const max = (opts && opts.max) || DEFAULT_MAX;
  /** Map 保序即为 LRU：最近用到的放到末尾 */
  const entries = new Map();
  const listeners = [];

  const touch = (key) => {
    const arc = entries.get(key);
    if (!arc) return null;
    entries.delete(key);
    entries.set(key, arc);
    return arc;
  };

  const evictIfNeeded = () => {
    const evicted = [];
    while (entries.size > max) {
      const key = entries.keys().next().value;
      const arc = entries.get(key);
      entries.delete(key);
      try { arc.close(); } catch (e) { /* 已关闭 */ }
      evicted.push(key);
    }
    if (evicted.length) for (const fn of listeners) fn({ type: 'evict', keys: evicted, remaining: [...entries.keys()] });
    return evicted;
  };

  return {
    get max() { return max; },
    get keys() { return [...entries.keys()]; },
    /** 当前活动归档（最近使用的那个） */
    get current() {
      const keys = [...entries.keys()];
      return keys.length ? entries.get(keys[keys.length - 1]) : null;
    },
    /**
     * 打开（或复用）一个归档。
     * @param {string} sazPath 绝对路径
     * @param {object} [options] 透传 indexer.openArchive
     * @param {boolean} [options.reindex] 强制重新索引
     */
    open(sazPath, options) {
      const key = path.resolve(String(sazPath || ''));
      if (!key) throw new Error('必须提供 .saz 的绝对路径');
      if (!options || !options.reindex) {
        const hit = touch(key);
        if (hit) { hit.lastUsedAt = Date.now(); return hit; }
      } else {
        const old = entries.get(key);
        if (old) { try { old.close(); } catch (e) { void e; } entries.delete(key); }
      }
      const arc = indexer.openArchive(key, options || {}, options && options.onProgress);
      arc.lastUsedAt = Date.now();
      entries.set(key, arc);
      evictIfNeeded();
      for (const fn of listeners) fn({ type: 'open', key, keys: [...entries.keys()], summary: arc.summary });
      return arc;
    },
    /** 按路径取已打开的归档；不触发打开。 */
    peek(sazPath) {
      const key = path.resolve(String(sazPath || ''));
      return entries.get(key) || null;
    },
    /** 按 sid 在**所有已打开归档**里找会话（MCP 工具只传 sid 时的定位方式）。 */
    find(sid) {
      const n = Number(sid);
      const keys = [...entries.keys()].reverse();
      for (const k of keys) {
        const s = entries.get(k).resolveSession(n);
        if (s) return { archive: entries.get(k), key: k, session: s };
      }
      return null;
    },
    close(sazPath) {
      const key = sazPath ? path.resolve(String(sazPath)) : null;
      const targets = key ? [key] : [...entries.keys()];
      const closed = [];
      for (const k of targets) {
        const arc = entries.get(k);
        if (!arc) continue;
        try { arc.close(); } catch (e) { void e; }
        entries.delete(k);
        closed.push(k);
      }
      if (closed.length) for (const fn of listeners) fn({ type: 'close', keys: closed, remaining: [...entries.keys()] });
      return closed;
    },
    on(fn) { if (typeof fn === 'function') listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    /** 内存占用快照，供 UI 状态栏与诊断使用。 */
    stat() {
      return {
        opened: [...entries.keys()],
        limit: max,
        rssBytes: process.memoryUsage().rss,
        sessions: [...entries.values()].reduce((a, arc) => a + arc.summary.sessionCount, 0),
      };
    },
  };
}

module.exports = { createArchiveStore, DEFAULT_MAX };
