const http = require('http');
const https = require('https');
const crypto = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { PassThrough } = require('stream');
const zlib = require('zlib');
const aes = require('aes-js');

const DEFAULT_TIMEOUT_MS = 15000;

const PROPFIND_BODY = Buffer.from(
  `<?xml version="1.0" encoding="utf-8" ?>\n` +
    `<D:propfind xmlns:D="DAV:">\n` +
    `  <D:prop>\n` +
    `    <D:displayname />\n` +
    `  </D:prop>\n` +
    `</D:propfind>\n`,
  'utf8'
);

const PROPFIND_LIST_BODY = Buffer.from(
  `<?xml version="1.0" encoding="utf-8" ?>\n` +
    `<D:propfind xmlns:D="DAV:">\n` +
    `  <D:prop>\n` +
    `    <D:displayname />\n` +
    `    <D:getcontentlength />\n` +
    `    <D:getlastmodified />\n` +
    `    <D:resourcetype />\n` +
    `  </D:prop>\n` +
    `</D:propfind>\n`,
  'utf8'
);

let zipEncryptedRegistered = false;
function ensureZipEncryptedFormatRegistered() {
  if (zipEncryptedRegistered) return;
  archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted'));
  zipEncryptedRegistered = true;
}

const ZIP_AES_COMPRESSION_METHOD = 99;
const ZIP_AES_EXTRA_FIELD_ID = 0x9901;
const ZIP_AES_HMAC_LENGTH = 10;
const ZIP_AES_PBKDF2_ITERATION_COUNT = 1000;
const ZIP_AES_COUNTER = Buffer.from('01000000000000000000000000000000', 'hex');

function createWinZipAesCounter() {
  const counter = new aes.Counter(new Uint8Array(ZIP_AES_COUNTER));
  // WinZip AES-CTR uses a little-endian counter increment.
  // 仅覆写当前 counter 实例，避免修改第三方库原型带来的全局副作用。
  counter.increment = function () {
    for (let i = 0; i < 16; i++) {
      if (this._counter[i] === 255) this._counter[i] = 0;
      else {
        this._counter[i]++;
        break;
      }
    }
  };
  return counter;
}

function parseLocalFileHeader(zipBuffer, offset) {
  if (!Buffer.isBuffer(zipBuffer)) throw new Error('ZIP 内容无效');
  if (!Number.isFinite(offset) || offset < 0) throw new Error('ZIP 偏移无效');
  if (offset + 30 > zipBuffer.length) throw new Error('ZIP 文件已损坏');

  const signature = zipBuffer.readUInt32LE(offset);
  if (signature !== 0x04034b50) throw new Error('ZIP 文件头签名不正确');

  const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
  const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);

  const fileNameStart = offset + 30;
  const extraFieldStart = fileNameStart + fileNameLength;
  const dataStart = extraFieldStart + extraFieldLength;

  if (dataStart > zipBuffer.length) throw new Error('ZIP 文件已损坏');

  return {
    fileNameLength,
    extraFieldLength,
    extraFieldStart,
    dataStart,
  };
}

function findExtraField(extraField, headerId) {
  if (!extraField || extraField.length < 4) return null;
  let i = 0;
  while (i + 4 <= extraField.length) {
    const id = extraField.readUInt16LE(i);
    const size = extraField.readUInt16LE(i + 2);
    const dataStart = i + 4;
    const next = dataStart + size;
    if (next > extraField.length) break;
    if (id === headerId) return extraField.subarray(dataStart, next);
    i = next;
  }
  return null;
}

function aesStrengthToLengths(strength) {
  switch (strength) {
    case 1:
      return { saltLength: 8, keyLength: 16 };
    case 2:
      return { saltLength: 12, keyLength: 24 };
    case 3:
      return { saltLength: 16, keyLength: 32 };
    default:
      throw new Error('不支持的 ZIP AES 强度');
  }
}

function decryptZipAesPayload(encryptedPayload, passwordBuffer, strength) {
  const { saltLength, keyLength } = aesStrengthToLengths(strength);
  const headerLength = saltLength + 2; // salt + passwordVerifier
  if (encryptedPayload.length < headerLength + ZIP_AES_HMAC_LENGTH) {
    throw new Error('ZIP 数据不完整');
  }

  const salt = encryptedPayload.subarray(0, saltLength);
  const passwordVerifier = encryptedPayload.subarray(saltLength, headerLength);
  const encryptedData = encryptedPayload.subarray(
    headerLength,
    encryptedPayload.length - ZIP_AES_HMAC_LENGTH
  );
  const hmac = encryptedPayload.subarray(encryptedPayload.length - ZIP_AES_HMAC_LENGTH);

  const compositeKeyLength = 2 * keyLength + 2;
  const compositeKey = crypto.pbkdf2Sync(
    passwordBuffer,
    salt,
    ZIP_AES_PBKDF2_ITERATION_COUNT,
    compositeKeyLength,
    'sha1'
  );
  const aesKey = compositeKey.subarray(0, keyLength);
  const hmacKey = compositeKey.subarray(keyLength, 2 * keyLength);
  const derivedVerifier = compositeKey.subarray(2 * keyLength);

  if (!derivedVerifier.equals(passwordVerifier)) throw new Error('BAD_PASSWORD');

  const calcHmac = crypto
    .createHmac('sha1', hmacKey)
    .update(encryptedData)
    .digest()
    .subarray(0, ZIP_AES_HMAC_LENGTH);
  if (!calcHmac.equals(hmac)) throw new Error('BAD_PASSWORD');

  const cipher = new aes.ModeOfOperation.ctr(
    new Uint8Array(aesKey),
    createWinZipAesCounter()
  );
  const decrypted = cipher.decrypt(new Uint8Array(encryptedData));
  return Buffer.from(decrypted);
}

function inflateByMethod(compressedData, method) {
  if (method === 0) return compressedData; // STORE
  if (method === 8) return zlib.inflateRawSync(compressedData); // DEFLATE
  throw new Error(`不支持的 ZIP 压缩方法：${method}`);
}

async function readFileFromAesEncryptedZip(zipBuffer, entry, password) {
  const localHeader = parseLocalFileHeader(zipBuffer, entry.offsetToLocalFileHeader);
  const extraField = zipBuffer.subarray(
    localHeader.extraFieldStart,
    localHeader.extraFieldStart + localHeader.extraFieldLength
  );
  const aesExtra = findExtraField(extraField, ZIP_AES_EXTRA_FIELD_ID);
  if (!aesExtra || aesExtra.length < 7) throw new Error('不支持的加密 ZIP 格式');

  const strength = aesExtra.readUInt8(4);
  const actualCompressionMethod = aesExtra.readUInt16LE(5);

  const start = localHeader.dataStart;
  const size = entry.compressedSize;
  if (!Number.isFinite(size) || size <= 0) throw new Error('ZIP 文件已损坏');
  if (start + size > zipBuffer.length) throw new Error('ZIP 文件已损坏');

  const encryptedPayload = zipBuffer.subarray(start, start + size);
  const passwordBuffer = Buffer.isBuffer(password) ? password : Buffer.from(String(password), 'utf8');
  const compressedData = decryptZipAesPayload(encryptedPayload, passwordBuffer, strength);
  return inflateByMethod(compressedData, actualCompressionMethod);
}

function normalizeDirUrl(dirUrl) {
  if (!dirUrl || typeof dirUrl !== 'string') {
    throw new Error('WebDAV 目录 URL 不能为空');
  }

  let url;
  try {
    url = new URL(dirUrl);
  } catch {
    throw new Error('WebDAV 目录 URL 不合法');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('WebDAV 目录 URL 必须以 http(s) 开头');
  }

  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }

  return url.toString();
}

function buildAuthHeaders(username, password) {
  if (!username && !password) return {};
  const token = Buffer.from(`${username || ''}:${password || ''}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${token}` };
}

function isSuccessStatus(status) {
  return status >= 200 && status < 300;
}

function requestOnce(urlString, options) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: options.headers,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(isHttps ? { rejectUnauthorized: !options.allowInsecure } : null),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', reject);

    if (options.body) req.write(options.body);
    req.end();
  });
}

async function request(urlString, options) {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = urlString;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await requestOnce(currentUrl, options);
    const location = res.headers?.location;
    if (
      location &&
      [301, 302, 303, 307, 308].includes(res.status) &&
      i < maxRedirects
    ) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }

  throw new Error('重定向次数过多');
}

function joinDirFileUrl(dirUrl, filename) {
  const base = normalizeDirUrl(dirUrl);
  if (!filename || typeof filename !== 'string') throw new Error('文件名不能为空');
  if (filename.includes('/')) throw new Error('文件名不允许包含 "/"');
  return `${base}${encodeURIComponent(filename)}`;
}

async function ensureDir(config) {
  const dirUrl = normalizeDirUrl(config.dirUrl);
  const authHeaders = buildAuthHeaders(config.username, config.password);

  const propfindRes = await request(dirUrl, {
    method: 'PROPFIND',
    headers: {
      ...authHeaders,
      Depth: '0',
      'Content-Type': 'text/xml; charset=utf-8',
    },
    body: PROPFIND_BODY,
    allowInsecure: config.allowInsecure,
  });

  if (propfindRes.status === 404) {
    const mkcolRes = await request(dirUrl, {
      method: 'MKCOL',
      headers: { ...authHeaders },
      allowInsecure: config.allowInsecure,
    });

    if (![201, 405].includes(mkcolRes.status)) {
      throw new Error(`创建备份目录失败（HTTP ${mkcolRes.status}）`);
    }

    const retryRes = await request(dirUrl, {
      method: 'PROPFIND',
      headers: {
        ...authHeaders,
        Depth: '0',
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body: PROPFIND_BODY,
      allowInsecure: config.allowInsecure,
    });

    if (![200, 207].includes(retryRes.status)) {
      throw new Error(`备份目录不可用（HTTP ${retryRes.status}）`);
    }
    return;
  }

  if (![200, 207].includes(propfindRes.status)) {
    if (propfindRes.status === 401 || propfindRes.status === 403) {
      throw new Error('WebDAV 鉴权失败（账号/密码或权限不正确）');
    }
    throw new Error(`备份目录不可用（HTTP ${propfindRes.status}）`);
  }
}

function decodeXmlText(text) {
  if (!text) return '';
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function tryParseHttpDateToMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function parseWebdavPropfindList(xmlText) {
  const xml = String(xmlText || '');
  if (!xml) return [];

  const responseBlocks = [];
  const responseRe = /<[^>]*:?response\b[^>]*>[\s\S]*?<\/[^>]*:?response>/gi;
  let m;
  while ((m = responseRe.exec(xml))) responseBlocks.push(m[0]);

  const getTagText = (block, tagName) => {
    const re = new RegExp(
      `<[^>]*:?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tagName}>`,
      'i'
    );
    const match = re.exec(block);
    return match ? decodeXmlText(match[1]).trim() : '';
  };

  const isCollection = (block) => {
    return /<[^>]*:?collection\b[^>]*\/?>/i.test(block);
  };

  const getHrefFilename = (href) => {
    if (!href) return '';
    try {
      const u = new URL(href, 'http://local.invalid');
      const parts = u.pathname.split('/').filter(Boolean);
      return parts.length ? safeDecodeURIComponent(parts[parts.length - 1]) : '';
    } catch {
      const parts = String(href).split('/').filter(Boolean);
      return parts.length ? safeDecodeURIComponent(parts[parts.length - 1]) : '';
    }
  };

  return responseBlocks
    .map((block) => {
      const href = getTagText(block, 'href');
      const displayname = getTagText(block, 'displayname');
      const getlastmodified = getTagText(block, 'getlastmodified');
      const getcontentlength = getTagText(block, 'getcontentlength');

      const hrefFilename = getHrefFilename(href);
      const filename = hrefFilename || displayname || '';
      const label = displayname || hrefFilename || '';

      const modifiedAt = tryParseHttpDateToMs(getlastmodified);
      const size = Number.isFinite(Number(getcontentlength)) ? Number(getcontentlength) : null;
      return {
        filename: filename || '',
        label,
        modifiedAt,
        size,
        isCollection: isCollection(block),
        href: href || '',
      };
    })
    .filter((item) => item && typeof item.filename === 'string');
}

async function listDir(config) {
  const authHeaders = buildAuthHeaders(config.username, config.password);
  const dirUrl = normalizeDirUrl(config.dirUrl);

  const res = await request(dirUrl, {
    method: 'PROPFIND',
    headers: {
      ...authHeaders,
      Depth: '1',
      'Content-Type': 'text/xml; charset=utf-8',
    },
    body: PROPFIND_LIST_BODY,
    allowInsecure: config.allowInsecure,
  });

  if (![200, 207].includes(res.status)) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('WebDAV 鉴权失败（无法列出备份目录）');
    }
    throw new Error(`列出备份目录失败（HTTP ${res.status}）`);
  }

  const xml = res.body.toString('utf8');
  const items = parseWebdavPropfindList(xml);
  const basePath = new URL(dirUrl).pathname;

  return items
    .filter((item) => item.filename)
    .filter((item) => !item.isCollection)
    .filter((item) => {
      if (!item.href) return true;
      try {
        const u = new URL(item.href, dirUrl);
        const hrefPath = u.pathname;
        if (hrefPath === basePath) return false;
        if (hrefPath === basePath.slice(0, -1)) return false;
      } catch {
        // ignore
      }
      return true;
    });
}

function isFastOtpBackupZip(filename) {
  if (!filename || typeof filename !== 'string') return false;
  return filename.startsWith('FastOtp_backup_') && filename.endsWith('.zip');
}

function parseBackupFilenameToMs(filename) {
  // FastOtp_backup_YYYYMMDD_HHMMSS_SSS.zip（本地时间）
  const m = /^FastOtp_backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})\.zip$/.exec(
    String(filename || '')
  );
  if (!m) return null;
  const yyyy = Number(m[1]);
  const MM = Number(m[2]);
  const dd = Number(m[3]);
  const HH = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6]);
  const SSS = Number(m[7]);
  const d = new Date(yyyy, MM - 1, dd, HH, mm, ss, SSS);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function createBackupFilename(createdAtMs) {
  // 文件名更适合展示“本地时间”，避免时区误解（文件名不额外附加时区信息）。
  return `FastOtp_backup_${formatLocalTimestampForFilename(createdAtMs)}.zip`;
}

function formatLocalTimestampForFilename(timestampMs) {
  if (!Number.isFinite(timestampMs)) throw new Error('时间戳无效：必须是毫秒时间戳（number）');
  const d = new Date(timestampMs);
  if (!Number.isFinite(d.getTime())) throw new Error('时间戳无效：无法转换为有效日期');

  const pad2 = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const HH = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const SSS = String(d.getMilliseconds()).padStart(3, '0');
  return `${yyyy}${MM}${dd}_${HH}${mm}${ss}_${SSS}`;
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('配置无效');
  const retentionDaysRaw = Number(config.retentionDays);
  const retentionDays = Number.isFinite(retentionDaysRaw) ? Math.max(0, Math.floor(retentionDaysRaw)) : 0;
  return {
    dirUrl: normalizeDirUrl(config.dirUrl),
    username: config.username || '',
    password: config.password || '',
    encryptPassword: config.encryptPassword || '',
    retentionDays,
    allowInsecure: !!config.allowInsecure,
  };
}

function generateOtpUri(item) {
  if (!item || !item.secret) return '';
  const type = item.type || 'totp';

  const issuer = item.issuer || '';
  const name = item.account || item.name || 'Account';
  const label = issuer ? `${issuer}:${name}` : name;

  const params = new URLSearchParams();
  params.set('secret', item.secret);
  if (issuer) params.set('issuer', issuer);
  if (item.digits && item.digits !== 6) params.set('digits', String(item.digits));
  if (item.period && item.period !== 30) params.set('period', String(item.period));
  if (item.algorithm && String(item.algorithm).toUpperCase() !== 'SHA1') {
    params.set('algorithm', String(item.algorithm).toUpperCase());
  }
  if (type === 'hotp' && item.counter !== undefined) params.set('counter', String(item.counter));

  return `otpauth://${type}/${encodeURIComponent(label)}?${params.toString()}`;
}

function buildReadme(createdAtMs) {
  const localTime = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toLocaleString('zh-CN') : String(createdAtMs);
  const utcIso = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : '';
  const lines = [
    'FastOtp WebDAV 备份文件（AES-256 加密 ZIP）',
    '',
    `导出时间（本地）: ${localTime}`,
    utcIso ? `导出时间（UTC）: ${utcIso}` : null,
    '',
    '文件说明：',
    '- backup.json：完整数据（含备注、删除时间等元信息）',
    '- otpauth_active.txt：活跃验证器的 otpauth:// 列表（便于迁移到其他 OTP 工具）',
    '- otpauth_deleted.txt：已删除验证器的 otpauth:// 列表（可选参考）',
    '',
    '恢复建议：',
    '- 需要 FastOtp 完整恢复：解压后使用 backup.json 内容恢复（或直接在 FastOtp 内“恢复”）',
    '- 迁移到其他 OTP：把 otpauth_active.txt 中的 URI 逐条导入/转换为二维码即可',
    '',
    '安全提示：',
    '- 该 ZIP 使用 WinZip AES-256 加密，安全性较好；但部分系统自带解压工具/Windows 资源管理器可能不支持。',
    '- 文件名与部分元信息未加密（ZIP 格式限制），请勿把备份文件暴露给不可信环境。',
    '- 请务必使用足够强的密码；忘记密码将无法恢复。',
    '',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

async function createEncryptedZipBuffer(files, password) {
  if (!password) throw new Error('未设置备份加密密码');
  ensureZipEncryptedFormatRegistered();

  const archive = archiver.create('zip-encrypted', {
    zlib: { level: 8 },
    encryptionMethod: 'aes256',
    password,
  });

  const out = new PassThrough();
  const chunks = [];

  out.on('data', (chunk) => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    out.on('end', resolve);
    out.on('error', reject);
  });

  archive.on('error', (err) => out.destroy(err));
  archive.pipe(out);

  for (const file of files) {
    if (!file?.name) continue;
    archive.append(file.content, { name: file.name });
  }

  await archive.finalize();
  await done;

  return Buffer.concat(chunks);
}

async function readFileFromEncryptedZip(zipBuffer, filePath, password) {
  if (!password) throw new Error('未设置备份加密密码');
  const dir = await unzipper.Open.buffer(zipBuffer);
  const entry = dir.files.find((f) => f.path === filePath);
  if (!entry) throw new Error(`备份压缩包中缺少文件：${filePath}`);
  try {
    if (entry.compressionMethod !== ZIP_AES_COMPRESSION_METHOD) {
      throw new Error('不支持的备份格式：仅支持 AES-256 加密 ZIP（请重新备份）');
    }
    return await readFileFromAesEncryptedZip(zipBuffer, entry, password);
  } catch (err) {
    if (err?.message === 'MISSING_PASSWORD' || err?.message === 'BAD_PASSWORD') {
      throw new Error('解压失败：请检查加密密码是否正确');
    }
    if (err instanceof Error && err.message) {
      throw new Error(`解压失败：${err.message}`);
    }
    throw new Error('解压失败：备份文件已损坏或格式不支持');
  }
}

function validateBackupObject(data) {
  if (!data || typeof data !== 'object') throw new Error('备份内容无效');
  if (!Array.isArray(data.otpItems) || !Array.isArray(data.deletedItems)) {
    throw new Error('备份内容缺少必要字段');
  }
  return data;
}

async function putFile(config, filename, buffer) {
  const authHeaders = buildAuthHeaders(config.username, config.password);
  const fileUrl = joinDirFileUrl(config.dirUrl, filename);

  const res = await request(fileUrl, {
    method: 'PUT',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length,
    },
    body: buffer,
    allowInsecure: config.allowInsecure,
  });

  if (!isSuccessStatus(res.status)) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('WebDAV 鉴权失败（无法上传备份文件）');
    }
    throw new Error(`上传备份文件失败（HTTP ${res.status}）`);
  }
}

async function getFile(config, filename) {
  const authHeaders = buildAuthHeaders(config.username, config.password);
  const fileUrl = joinDirFileUrl(config.dirUrl, filename);

  const res = await request(fileUrl, {
    method: 'GET',
    headers: { ...authHeaders },
    allowInsecure: config.allowInsecure,
  });

  if (!isSuccessStatus(res.status)) {
    if (res.status === 404) throw new Error('备份文件不存在');
    if (res.status === 401 || res.status === 403) {
      throw new Error('WebDAV 鉴权失败（无法下载备份文件）');
    }
    throw new Error(`下载备份文件失败（HTTP ${res.status}）`);
  }

  return res.body;
}

async function deleteFile(config, filename) {
  const authHeaders = buildAuthHeaders(config.username, config.password);
  const fileUrl = joinDirFileUrl(config.dirUrl, filename);

  const res = await request(fileUrl, {
    method: 'DELETE',
    headers: { ...authHeaders },
    allowInsecure: config.allowInsecure,
  });

  if (res.status === 404) return;
  if (!isSuccessStatus(res.status)) {
    throw new Error(`删除远端备份失败（HTTP ${res.status}）`);
  }
}

async function testConnection(config) {
  const cfg = normalizeConfig(config);
  await ensureDir(cfg);

  const testName = `FastOtp_test_${Date.now()}.txt`;
  const body = Buffer.from('ok', 'utf8');
  await putFile(cfg, testName, body);
  await getFile(cfg, testName);
  await deleteFile(cfg, testName);

  return { success: true, message: '连接正常（读写权限 OK）' };
}

async function listBackups(config) {
  const cfg = normalizeConfig(config);
  await ensureDir(cfg);
  const items = await listDir(cfg);
  const backups = items
    .filter((item) => isFastOtpBackupZip(item.filename))
    .map((item) => ({
      filename: item.filename,
      createdAt: Number(item.modifiedAt) || Number(parseBackupFilenameToMs(item.filename)) || 0,
      size: Number.isFinite(item.size) ? item.size : undefined,
      schemaVersion: 2,
      format: 'aes256',
    }))
    .filter((item) => item.createdAt > 0);

  backups.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  return backups;
}

async function createBackup(config, data) {
  const cfg = normalizeConfig(config);
  await ensureDir(cfg);

  const createdAt = Date.now();
  const backupObject = {
    schemaVersion: 2,
    exportedAt: createdAt,
    otpItems: data.otpItems || [],
    deletedItems: data.deletedItems || [],
  };

  const otpUris = (backupObject.otpItems || [])
    .map((item) => generateOtpUri(item))
    .filter(Boolean)
    .join('\n');
  const deletedOtpUris = (backupObject.deletedItems || [])
    .map((item) => generateOtpUri(item))
    .filter(Boolean)
    .join('\n');

  const zipBuffer = await createEncryptedZipBuffer(
    [
      { name: 'backup.json', content: Buffer.from(JSON.stringify(backupObject, null, 2), 'utf8') },
      { name: 'otpauth_active.txt', content: Buffer.from(otpUris, 'utf8') },
      { name: 'otpauth_deleted.txt', content: Buffer.from(deletedOtpUris, 'utf8') },
      { name: 'README.txt', content: Buffer.from(buildReadme(createdAt), 'utf8') },
    ],
    cfg.encryptPassword
  );

  const filename = createBackupFilename(createdAt);
  await putFile(cfg, filename, zipBuffer);

  if (cfg.retentionDays > 0) {
    const cutoff = Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000;
    const backups = await listBackups(cfg);
    const removed = backups.filter((item) => Number(item.createdAt) < cutoff);
    if (removed.length > 0) {
      await Promise.allSettled(removed.map((item) => deleteFile(cfg, item.filename)));
    }
  }

  return {
    success: true,
    message: '备份成功',
    filename,
    createdAt,
    size: zipBuffer.length,
  };
}

async function restoreBackup(config, filename) {
  const cfg = normalizeConfig(config);
  await ensureDir(cfg);
  const buffer = await getFile(cfg, filename);

  const backupJson = await readFileFromEncryptedZip(buffer, 'backup.json', cfg.encryptPassword);
  let data;
  try {
    data = JSON.parse(backupJson.toString('utf8'));
  } catch {
    throw new Error('解析失败：backup.json 不是有效的 JSON');
  }

  validateBackupObject(data);

  return {
    success: true,
    message: '恢复成功',
    data,
  };
}

module.exports = {
  testConnection,
  listBackups,
  createBackup,
  restoreBackup,
};
