'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { open } = require('./load-lmdb');

const PRIVATE_FIELDS = new Set(['_id', '_rev', '_attachments', '_deleted', '_lastModified', '_cloudSynced', '_conflicts', '_revisions', '_sync']);
const MAX_SIZE = 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fingerprint = doc => hash(JSON.stringify(doc));
const parse = raw => raw === undefined ? null : JSON.parse(raw);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function payload(doc) {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !PRIVATE_FIELDS.has(key)));
}

function validPlugin(name) {
  if (typeof name !== 'string' || !name || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..') {
    throw new Error('插件标识无效');
  }
  return name;
}

function docId(plugin, key) {
  validPlugin(plugin);
  if (typeof key !== 'string' || !key || /[\x00-\x1f]/.test(key)) throw new Error('数据键无效');
  return `PLUGIN/${plugin}/${key}`;
}

function openEnvironment(directory, readOnly) {
  if (!fs.existsSync(path.join(directory, 'data.mdb'))) throw new Error(`数据库不存在：${directory}`);
  const env = open({ path: directory, maxDbs: 6, compression: false, encoding: 'binary', readOnly });
  try {
    const db = name => env.openDB({ name, encoding: 'string', create: false });
    const main = db('main');
    const meta = db('meta');
    return { env, main, meta, directory, readOnly, db };
  } catch (error) { env.close(); throw error; }
}

class PluginStore {
  constructor({ root, backupRoot } = {}) {
    this.root = path.resolve(root || process.env.ZTOOLS_DATA_ROOT || path.join(os.homedir(), '.ztools'));
    this.backupRoot = path.resolve(backupRoot || path.join(this.root, 'data-editor-backups'));
    this.device = null;
    this.account = null;
    this.accountName = null;
    this.opened = false;
  }

  connect() {
    this.close();
    const versionFile = path.join(this.root, 'version.json');
    if (!fs.existsSync(versionFile) || !String(parse(fs.readFileSync(versionFile, 'utf8'))?.version).startsWith('3.')) {
      throw new Error('请选择 ZTools 3.x 数据根目录（包含 version.json、lmdb 和 plugins）。旧版数据库暂不支持。');
    }
    try {
      this.device = openEnvironment(path.join(this.root, 'lmdb', 'device'), true);
      const accountName = this.activeAccount();
      this.account = openEnvironment(path.join(this.root, 'lmdb', 'accounts', accountName), true);
      this.accountName = accountName;
      this.opened = true;
      return this.info();
    } catch (error) { this.close(); throw error; }
  }

  activeAccount() {
    this.device.env.resetReadTxn();
    const uid = parse(this.device.main.get('SYNC/current-account'))?.data?.uid;
    if (uid !== undefined && uid !== null && typeof uid !== 'string') throw new Error('账号数据格式不受支持');
    return typeof uid === 'string' && uid.trim() ? hash(uid.trim()).slice(0, 16) : 'default';
  }

  ensureAccount() {
    if (!this.opened) this.connect();
    if (this.activeAccount() !== this.accountName) {
      throw new Error('ZTools 登录账号已切换，请重新连接后读取数据');
    }
    if (this.account.readOnly) this.account.env.resetReadTxn();
  }

  info() {
    return { root: this.root, account: this.accountName, accountLabel: this.accountName === 'default' ? '未登录 · 默认数据' : '当前登录账号', backupRoot: this.backupRoot };
  }

  installed() {
    this.ensureAccount();
    const installed = parse(this.device.main.get('ZTOOLS/plugins'))?.data;
    if (installed !== null && installed !== undefined && !Array.isArray(installed)) throw new Error('已安装插件列表格式不受支持');
    return (installed || []).filter(item => item && typeof item.name === 'string' && !/[\\/\x00-\x1f]/.test(item.name));
  }

  plugins() {
    const installed = this.installed();
    const counts = new Map();
    for (const { key } of this.account.main.getRange({ start: 'PLUGIN/', end: 'PLUGIN0' })) {
      const match = typeof key === 'string' && key.match(/^PLUGIN\/([^/]+)\//);
      if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
    }
    const result = new Map(installed.map(p => [p.name, { name: p.name, title: p.title || p.name, count: counts.get(p.name) || 0, installed: true }]));
    for (const [name, count] of counts) {
      if (!result.has(name)) result.set(name, { name, title: name, count, installed: false });
    }
    return [...result.values()].sort((a, b) => Number(b.installed) - Number(a.installed) || a.title.localeCompare(b.title, 'zh-CN'));
  }

  assertTarget(plugin) {
    validPlugin(plugin);
    if (!this.plugins().some(item => item.name === plugin)) throw new Error('插件不存在或已卸载且没有数据');
  }

  records(plugin) {
    this.assertTarget(plugin);
    const prefix = `PLUGIN/${plugin}/`;
    const result = [];
    for (const { key, value } of this.account.main.getRange({ start: prefix, end: prefix.slice(0, -1) + '0' })) {
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      let doc;
      try { doc = parse(value); } catch { result.push({ key: key.slice(prefix.length), kind: 'invalid', preview: '无法解析的数据（只读）', bytes: Buffer.byteLength(value) }); continue; }
      const body = payload(doc);
      const kind = Object.keys(body).length === 1 && Object.hasOwn(body, 'value') ? 'value' : 'document';
      const text = JSON.stringify(kind === 'value' ? body.value : body);
      result.push({ key: key.slice(prefix.length), kind, preview: text.slice(0, 160), searchText: text, bytes: Buffer.byteLength(value) });
    }
    return result;
  }

  read(plugin, key) {
    this.assertTarget(plugin);
    const doc = parse(this.account.main.get(docId(plugin, key)));
    if (!plainObject(doc)) throw new Error('数据不存在或不是可编辑的 JSON 文档');
    const body = payload(doc);
    const kind = Object.keys(body).length === 1 && Object.hasOwn(body, 'value') ? 'value' : 'document';
    return { plugin, key, kind, document: doc, content: kind === 'value' ? body.value : body, token: fingerprint(doc), rev: doc._rev || '', hasAttachment: !!doc._attachments };
  }

  makeDocument(current, content, kind) {
    if (kind === 'document') {
      if (!plainObject(content)) throw new Error('文档字段必须是 JSON 对象');
      for (const field of Object.keys(content)) {
        if (PRIVATE_FIELDS.has(field)) throw new Error(`${field} 是系统字段，不能在编辑区修改`);
      }
    } else if (kind !== 'value') throw new Error('编辑模式无效');
    const reserved = Object.fromEntries(Object.entries(current).filter(([key]) => PRIVATE_FIELDS.has(key)));
    const next = { ...reserved, ...(kind === 'value' ? { value: content } : content) };
    delete next._lastModified;
    delete next._cloudSynced;
    delete next._deleted;
    const sequence = Number.parseInt(current._rev?.split('-')[0], 10);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('文档版本号格式不受支持，不能写入');
    next._rev = `${sequence + 1}-${crypto.randomBytes(16).toString('hex')}`;
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_SIZE) throw new Error('文档超过 ZTools 的 1 MB 大小限制');
    return next;
  }

  backup(plugin, key, document) {
    const folder = path.join(this.backupRoot, hash(plugin));
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const snapshot = { format: 'ztools-data-editor-backup-v1', id, root: this.root, account: this.accountName, plugin, key, savedAt: new Date().toISOString(), document };
    const file = path.join(folder, `${id}.json`);
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(snapshot, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { id, file };
  }

  save({ plugin, key, content, kind, token }) {
    this.assertTarget(plugin);
    const id = docId(plugin, key);
    const current = parse(this.account.main.get(id));
    if (!current || typeof token !== 'string' || fingerprint(current) !== token) throw new Error('数据已被其他插件修改，请重新读取后再保存');
    const next = this.makeDocument(current, content, kind);
    // Read operations use read-only handles. Only an explicit save opens a writer.
    this.account.env.close();
    this.account = null;
    try {
      this.account = openEnvironment(path.join(this.root, 'lmdb', 'accounts', this.accountName), false);
      const revision = this.account.db('revision');
      const changelog = this.account.db('changelog');
      let backup;
      this.account.env.transactionSync(() => {
        this.ensureAccount();
        const actual = parse(this.account.main.get(id));
        if (!actual || fingerprint(actual) !== token) throw new Error('数据已被其他插件修改，请重新读取后再保存');
        const rawMeta = this.account.meta.get(id);
        if (typeof rawMeta !== 'string' || !rawMeta.startsWith('{')) throw new Error('同步元数据格式不受支持，不能写入');
        const meta = parse(rawMeta);
        if (meta._deleted || meta._hasConflicts || meta._conflictCount > 0) throw new Error('此数据存在同步冲突，请先在 ZTools 中解决冲突');
        if ((meta._winningRev || meta._rev) !== actual._rev) throw new Error('同步版本与文档不一致，请刷新 ZTools 后重试');
        const prefix = `rev:${id}:`;
        const revisions = [...revision.getRange({ start: prefix, end: prefix + '\uffff' })].filter(row => row.key.startsWith(prefix)).map(row => parse(row.value));
        const parents = new Set(revisions.map(record => record.parentRev).filter(Boolean));
        const leaves = revisions.filter(record => record.isLeaf !== false && !parents.has(record.rev));
        if (leaves.length !== 1 || leaves[0].rev !== actual._rev || leaves[0].deleted) throw new Error('文档历史存在冲突或格式不受支持，不能写入');
        const rawSeq = this.account.meta.get('_changelog_seq');
        const oldSeq = rawSeq === undefined ? 0 : Number(rawSeq);
        if (!Number.isSafeInteger(oldSeq) || oldSeq < 0) throw new Error('同步序号无效，不能写入');
        backup = this.backup(plugin, key, actual);
        const timestamp = Date.now();
        const seq = oldSeq + 1;
        revision.putSync(`rev:${id}:${actual._rev}`, JSON.stringify({ ...leaves[0], isLeaf: false }));
        revision.putSync(`rev:${id}:${next._rev}`, JSON.stringify({ docId: id, rev: next._rev, parentRev: actual._rev, deleted: false, timestamp, doc: next, isLeaf: true }));
        this.account.main.putSync(id, JSON.stringify(next));
        this.account.meta.putSync(id, JSON.stringify({ _rev: next._rev, _winningRev: next._rev, _lastModified: timestamp, _deleted: false, _hasConflicts: false, _conflictCount: 0 }));
        this.account.meta.putSync('_changelog_seq', String(seq));
        changelog.putSync(String(seq).padStart(10, '0'), JSON.stringify({ seq, docId: id, rev: next._rev, parentRev: actual._rev, deleted: false, timestamp, winnerRev: next._rev, isWinner: true }));
      });
      return { ...this.read(plugin, key), backup };
    } finally {
      this.account?.env.close();
      this.account = null;
      try { this.account = openEnvironment(path.join(this.root, 'lmdb', 'accounts', this.accountName), true); }
      catch { this.close(); }
    }
  }

  history(plugin, key) {
    this.assertTarget(plugin);
    const folder = path.join(this.backupRoot, hash(plugin));
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter(name => /^\d+-[a-f0-9]{16}\.json$/.test(name)).flatMap(name => {
      try {
        const data = parse(fs.readFileSync(path.join(folder, name), 'utf8'));
        return data.format === 'ztools-data-editor-backup-v1' && data.plugin === plugin && data.key === key && data.root === this.root && data.account === this.accountName ? [{ id: data.id, savedAt: data.savedAt, rev: data.document._rev }] : [];
      } catch { return []; }
    }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  backupContent(plugin, key, backupId) {
    if (!this.history(plugin, key).some(item => item.id === backupId)) throw new Error('备份不存在或不属于当前账号的数据');
    const snapshot = parse(fs.readFileSync(path.join(this.backupRoot, hash(plugin), `${backupId}.json`), 'utf8'));
    const body = payload(snapshot.document);
    const kind = Object.keys(body).length === 1 && Object.hasOwn(body, 'value') ? 'value' : 'document';
    return { kind, content: kind === 'value' ? body.value : body, rev: snapshot.document._rev };
  }

  exportPlugin(plugin) {
    const records = this.records(plugin);
    return { format: 'ztools-plugin-documents-v1', plugin, account: this.accountName, exportedAt: new Date().toISOString(), documents: records.map(row => this.read(plugin, row.key).document) };
  }

  close() {
    this.account?.env.close();
    this.device?.env.close();
    this.account = this.device = null;
    this.accountName = null;
    this.opened = false;
  }
}

module.exports = { PluginStore, payload, fingerprint, docId, openEnvironment };
