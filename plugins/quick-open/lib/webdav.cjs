/**
 * CommonJS：WebDAV 地址拼接与鉴权（与 lib/quick-open/webdav.js 保持一致）
 */

const WEBDAV_BACKUP_FILENAME = 'quick-open-backup.json';

function buildAuthHeader(username, password) {
  const raw = `${username || ''}:${password || ''}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

function normalizeDirPath(remotePath) {
  let dir = String(remotePath || '').trim();
  if (!dir.startsWith('/')) dir = `/${dir}`;
  return dir.replace(/\/+$/g, '');
}

function buildWebdavDirUrl(baseUrl, remotePath) {
  const base = String(baseUrl || '').trim().replace(/\/+$/g, '');
  return `${base}${normalizeDirPath(remotePath)}/`;
}

function buildWebdavFileUrl(baseUrl, remotePath, filename) {
  const name = String(filename || '').trim().replace(/^\/+/, '');
  return `${buildWebdavDirUrl(baseUrl, remotePath)}${name}`;
}

module.exports = {
  WEBDAV_BACKUP_FILENAME,
  buildAuthHeader,
  buildWebdavDirUrl,
  buildWebdavFileUrl,
};
