'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const directory = () => path.join(os.tmpdir(), 'ztools-data-editor-sessions');
const filename = token => {
  if (typeof token !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(token)) throw new Error('编辑窗口会话无效');
  return path.join(directory(), `${token}.json`);
};
function create(context) {
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const data = JSON.stringify({ createdAt: Date.now(), context });
  if (Buffer.byteLength(data) > 16 * 1024 * 1024) throw new Error('编辑内容过大，无法传入独立窗口');
  fs.writeFileSync(filename(token), data, { flag: 'wx', mode: 0o600 });
  return token;
}
function take(token) {
  const file = filename(token);
  if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('编辑窗口会话过大');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.unlinkSync(file);
  if (!data.createdAt || Date.now() - data.createdAt > 10 * 60 * 1000) throw new Error('编辑窗口会话已过期，请从原窗口重新打开');
  return data.context;
}
function discard(token) { try { fs.unlinkSync(filename(token)); } catch {} }
module.exports = { create, take, discard };
