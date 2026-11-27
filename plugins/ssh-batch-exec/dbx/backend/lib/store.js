"use strict";

// 作者：木子
// DBX Sidecar 本地存储：所有数据保存在 DBX 提供的数据目录中的单个 JSON 文件。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultDataDir() {
  return path.join(os.tmpdir(), "dbx-ssh-batch-exec");
}

class Store {
  constructor(dataDir) {
    this.dataDir = String(dataDir || process.env.DBX_PLUGIN_DATA_DIR || defaultDataDir());
    this.file = path.join(this.dataDir, "store.json");
    this.docs = new Map();
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    const raw = fs.readFileSync(this.file, "utf-8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.docs)) throw new Error("本地数据文件格式不正确");
    this.docs = new Map(parsed.docs.map((doc) => [String(doc._id), doc]));
  }

  persist() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const payload = JSON.stringify({ version: 1, docs: [...this.docs.values()] }, null, 2);
    fs.writeFileSync(tmp, payload, "utf-8");
    fs.renameSync(tmp, this.file);
  }

  list(prefix) {
    const p = prefix == null ? "" : String(prefix);
    const docs = [...this.docs.values()].filter((doc) => !p || String(doc._id).startsWith(p));
    docs.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    return docs.map((doc) => structuredCloneSafe(doc));
  }

  detail(id) {
    const doc = this.docs.get(String(id || ""));
    return doc ? structuredCloneSafe(doc) : null;
  }

  add(doc) {
    const next = normalizeDoc(doc);
    if (this.docs.has(next._id)) throw new Error("记录已存在: " + next._id);
    this.docs.set(next._id, next);
    this.persist();
    return structuredCloneSafe(next);
  }

  edit(doc) {
    const next = normalizeDoc(doc);
    if (!this.docs.has(next._id)) throw new Error("记录不存在: " + next._id);
    this.docs.set(next._id, next);
    this.persist();
    return structuredCloneSafe(next);
  }

  del(id) {
    const ok = this.docs.delete(String(id || ""));
    if (ok) this.persist();
    return ok;
  }

  getSetting(key, defaultValue) {
    const doc = this.docs.get(`setting:${String(key || "")}`);
    return doc && Object.prototype.hasOwnProperty.call(doc, "value") ? doc.value : defaultValue;
  }

  setSetting(key, value) {
    const id = `setting:${String(key || "")}`;
    if (!id || id === "setting:") throw new Error("设置 key 不能为空");
    this.docs.set(id, { _id: id, value });
    this.persist();
    return structuredCloneSafe(value);
  }
}

function normalizeDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("记录必须是对象");
  const id = String(doc._id || "");
  if (!id) throw new Error("记录缺少 _id");
  return JSON.parse(JSON.stringify(doc));
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { Store, defaultDataDir };
