'use strict';

/*
 * 跨 renderer 的临时状态旁路：固定文件覆盖，不经过宿主的版本化数据库。
 * 单独保留心跳文件，让 IPC 失联时的悬浮球自愈仍然有效。
 * 安装目录参与命名，正式版和 dev 版不会互相覆盖心跳、行情或冷却表。
 */
function createRuntimeStorage(options) {
  const opts = options || {};
  const memory = new Map(); // 保存序列化值，避免调用方原地修改绕过 setItem
  const localOnly = new Set();
  let fs, path, directory;
  if (!opts.isolated || opts.directory) {
    try {
      fs = require('node:fs');
      path = require('node:path');
      const os = require('node:os');
      const crypto = require('node:crypto');
      const namespace = crypto.createHash('sha256').update(path.resolve(__dirname)).digest('hex').slice(0, 20);
      directory = opts.directory || path.join(os.tmpdir(), 'ztools-stock-ball-runtime', namespace);
    } catch (e) { directory = null; }
  }
  function fileFor(key) {
    if (!/^sb\.[a-zA-Z]+$/.test(key)) throw new Error('Invalid runtime key');
    return path.join(directory, key + '.json');
  }
  return {
    getItem(key) {
      if (localOnly.has(key)) return memory.has(key) ? JSON.parse(memory.get(key)) : null;
      if (directory) {
        try {
          // 每次读当前文件，跨进程即刻可见；不靠 mtime，避免同毫秒同大小写入漏更新。
          const raw = fs.readFileSync(fileFor(key), 'utf8');
          const value = JSON.parse(raw);
          memory.set(key, raw);
          return value;
        } catch (e) {
          if (e.code === 'ENOENT' || e instanceof SyntaxError) memory.delete(key);
        }
      }
      return memory.has(key) ? JSON.parse(memory.get(key)) : null;
    },
    setItem(key, value) {
      const raw = JSON.stringify(value);
      if (directory) {
        const file = fileFor(key);
        const temporary = file + '.' + process.pid + '.tmp';
        try {
          // 从共享文件比较，而非仅比较本窗口内存：另一个窗口可能已改过同一个键。
          if (fs.readFileSync(file, 'utf8') === raw) { localOnly.delete(key); memory.set(key, raw); return; }
        } catch (e) { /* 首次写入 */ }
        try {
          fs.mkdirSync(directory, { recursive: true });
          fs.writeFileSync(temporary, raw, 'utf8');
          // 原子替换，读者只能看到完整的旧值或新值。
          fs.renameSync(temporary, file);
          localOnly.delete(key);
        } catch (e) {
          // 临时目录不可写时保留本窗口内存；下次 set 再尝试恢复共享。
          localOnly.add(key);
        }
        finally { try { fs.unlinkSync(temporary); } catch (e) { /* 已重命名 */ } }
      }
      memory.set(key, raw);
    }
  };
}

module.exports = { createRuntimeStorage };
