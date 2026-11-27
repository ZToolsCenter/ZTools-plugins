'use strict';

// 大古截图与大古快传共用的约定：唯一文件名的格式、交接文件的存放位置、跳转用的 token 与标签。
// 两个插件的 preload 各自加载本插件目录内的同步副本（由 scripts/sync-shared.mjs 从 shared/ 复制）。

const path = require('node:path');

const SHARE_DIR_NAME = 'dagu-transfer';
// 不含斜杠，写进大古快传的正则指令时无需转义。
const TOKEN_PREFIX = 'dagu-transfer-share:';
// 大古截图跳转时按「插件标题 + 指令名」定位大古快传，改任一侧都要同步另一侧的 plugin.json。
const TRANSFER_TITLE = '大古快传';
const TRANSFER_SHARE_CMD = '接收分享';
// 已是唯一命名的文件：<名称>-YYYYMMDD-HHmmss-<6 位小写字母数字><.扩展名>
const UNIQUE_NAME_PATTERN = /^(.+)-\d{8}-\d{6}-[a-z0-9]{6}(\.[a-z0-9]{1,5})$/;
// 交接文件只接受这一种形态，token 因此无法把读取范围扩大到约定目录之外。
const SHARE_FILE_PATTERN = /^(?:截图|图片)-\d{8}-\d{6}-[a-z0-9]{6}\.png$/;
// 目录分隔符、Windows 文件名非法字符与控制字符统一替换掉。
const UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const STALE_MS = 24 * 60 * 60 * 1000;
// 确认文件：交接文件名后加 .ack。
const ACK_SUFFIX = '.ack';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const pad = (value) => String(value).padStart(2, '0');

function timestamp(now = new Date()) {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// 36^6 ≈ 21.7 亿种组合，把 [0, 1) 的随机数均匀映射成 6 位小写字母数字。
function randomSuffix(random = Math.random) {
  let value = Math.floor(random() * 2176782336);
  let text = '';
  for (let index = 0; index < 6; index += 1) {
    text = ALPHABET[value % 36] + text;
    value = Math.floor(value / 36);
  }
  return text;
}

function isUniqueFileName(fileName) {
  return UNIQUE_NAME_PATTERN.test(String(fileName || ''));
}

// 只保留文件名部分（丢弃目录），并替换各平台都不允许的字符。
function baseFileName(fileName) {
  const normalized = String(fileName || '').replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1).replace(UNSAFE_CHARS, '_').trim();
}

function splitFileName(fileName) {
  const base = baseFileName(fileName);
  const dot = base.lastIndexOf('.');
  const hasExtension = dot > 0 && base.length - dot <= 6;
  return {
    base: hasExtension ? base.slice(0, dot) : base,
    ext: hasExtension ? base.slice(dot).toLowerCase() : ''
  };
}

// 已经符合唯一命名的文件名原样保留；force 为 true 时换一个新的时间与随机后缀。
function uniqueFileName(fileName, { now = new Date(), random = Math.random, force = false } = {}) {
  const source = baseFileName(fileName);
  const match = UNIQUE_NAME_PATTERN.exec(source);
  if (match && !force) return source;
  const { base, ext } = match ? { base: match[1], ext: match[2] } : splitFileName(source);
  return `${base || '文件'}-${timestamp(now)}-${randomSuffix(random)}${ext}`;
}

function buildShareFileName(prefix = '截图', { now = new Date(), random = Math.random, ext = 'png' } = {}) {
  return `${prefix}-${timestamp(now)}-${randomSuffix(random)}.${ext}`;
}

function encodeShareToken(fileName) {
  return TOKEN_PREFIX + encodeURIComponent(fileName);
}

// 解析跳转 token；不是合法的交接文件名时返回空字符串。
function decodeShareToken(token) {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return '';
  try {
    const fileName = decodeURIComponent(token.slice(TOKEN_PREFIX.length));
    return SHARE_FILE_PATTERN.test(fileName) ? fileName : '';
  } catch {
    return '';
  }
}

function isShareFileName(fileName) {
  return SHARE_FILE_PATTERN.test(String(fileName || ''));
}

function redirectLabel() {
  return [TRANSFER_TITLE, TRANSFER_SHARE_CMD];
}

// 「复制为路径」得到的路径文本带着成对的双引号或单引号，这里去掉首尾空白与成对引号。
function unquotePath(text) {
  const value = String(text ?? '').trim();
  const first = value[0];
  if ((first === '"' || first === "'") && value.length > 1 && value.endsWith(first)) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function shareDir(tmpdir) {
  return path.join(tmpdir, SHARE_DIR_NAME);
}

// 只为合法的交接文件名拼路径，其它输入一律返回空字符串。
function shareFilePath(tmpdir, fileName) {
  return isShareFileName(fileName) ? path.join(shareDir(tmpdir), fileName) : '';
}

// 截图侧使用：把图片写进交接目录，并在每次写入后清理过期的交接文件。
// 宿主的 redirect 找不到目标插件时照样返回成功，所以「对方是否接手」要靠确认文件来判断：
// 快传读到交接文件后调用 ack 留下 <文件名>.ack，截图侧用 isAcked 轮询。
function createShareWriter({ fs, tmpdir, now = () => new Date(), random = Math.random, staleMs = STALE_MS } = {}) {
  const dir = shareDir(tmpdir);

  const filePathOf = (fileName) => (isShareFileName(fileName) ? path.join(dir, fileName) : '');
  const ackPathOf = (fileName) => {
    const filePath = filePathOf(fileName);
    return filePath ? `${filePath}${ACK_SUFFIX}` : '';
  };

  const remove = (target) => {
    if (!target) return false;
    try {
      fs.rmSync(target, { force: true });
      return true;
    } catch {
      return false;
    }
  };

  const pruneStale = () => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    const cutoff = now().getTime() - staleMs;
    for (const entry of entries) {
      if (!isShareFileName(entry.replace(/\.ack$/, ''))) continue;
      const target = path.join(dir, entry);
      try {
        if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { force: true });
      } catch {
        // 清理失败不影响分享主流程。
      }
    }
  };

  const write = (base64, { prefix = '截图', ext = 'png' } = {}) => {
    const fileName = buildShareFileName(prefix, { now: now(), random, ext });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), Buffer.from(String(base64 || ''), 'base64'));
    pruneStale();
    return { fileName, token: encodeShareToken(fileName), label: redirectLabel() };
  };

  return Object.freeze({
    dir,
    write,
    pruneStale,
    // 快传侧调用：确认已经拿到这个交接文件。
    ack: (fileName) => {
      const ackPath = ackPathOf(fileName);
      if (!ackPath) return false;
      try {
        fs.writeFileSync(ackPath, '');
        return true;
      } catch {
        return false;
      }
    },
    // 截图侧调用：对方是否已经确认接手。
    isAcked: (fileName) => {
      const ackPath = ackPathOf(fileName);
      if (!ackPath) return false;
      try {
        return fs.existsSync(ackPath);
      } catch {
        return false;
      }
    },
    // 连同确认文件一起删除。
    discard: (fileName) => {
      const removed = remove(filePathOf(fileName));
      remove(ackPathOf(fileName));
      return removed;
    },
    // 跳转前清掉上一次可能残留的确认文件，避免把旧确认当成本次的结果。
    clearAck: (fileName) => remove(ackPathOf(fileName))
  });
}

module.exports = {
  SHARE_DIR_NAME,
  TOKEN_PREFIX,
  TRANSFER_TITLE,
  TRANSFER_SHARE_CMD,
  timestamp,
  randomSuffix,
  baseFileName,
  splitFileName,
  isUniqueFileName,
  uniqueFileName,
  buildShareFileName,
  encodeShareToken,
  decodeShareToken,
  isShareFileName,
  redirectLabel,
  unquotePath,
  shareDir,
  shareFilePath,
  createShareWriter
};
