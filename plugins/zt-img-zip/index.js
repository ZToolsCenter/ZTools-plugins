"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const utils = require("@electron-toolkit/utils");
const electron = require("electron");
const log = require("electron-log");
const path = require("path");
const lmdb = require("lmdb");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const child_process = require("child_process");
const uuid = require("uuid");
const plist = require("simple-plist");
const url = require("url");
const http = require("http");
const uiohookNapi = require("uiohook-napi");
const fs$1 = require("fs/promises");
const pinyinPro = require("pinyin-pro");
const util = require("util");
const asar = require("@electron/asar");
const zlib = require("zlib");
const promises = require("stream/promises");
const tar = require("tar");
const AdmZip = require("adm-zip");
const yaml = require("yaml");
const worker_threads = require("worker_threads");
const https = require("https");
const chokidar = require("chokidar");
const webdav = require("webdav");
const OpenAI = require("openai");
const TurndownService = require("turndown");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const crypto__namespace = /* @__PURE__ */ _interopNamespaceDefault(crypto);
const asar__namespace = /* @__PURE__ */ _interopNamespaceDefault(asar);
const tar__namespace = /* @__PURE__ */ _interopNamespaceDefault(tar);
function generateNewRev(existingRev) {
  let sequence = 1;
  if (existingRev) {
    const parts = existingRev.split("-");
    if (parts.length >= 2) {
      const currentSeq = parseInt(parts[0], 10);
      if (!isNaN(currentSeq)) {
        sequence = currentSeq + 1;
      }
    }
  }
  const hash = crypto.randomBytes(16).toString("hex");
  return `${sequence}-${hash}`;
}
function createErrorResult(name, message, id) {
  const result = {
    id: id || "",
    error: true,
    name,
    message
  };
  return result;
}
function createSuccessResult(id, rev) {
  const result = {
    id,
    ok: true
  };
  if (rev) {
    result.rev = rev;
  }
  return result;
}
function isValidDocId(id) {
  return typeof id === "string" && id.length > 0;
}
function isDocSizeExceeded(doc, maxSize = 1024 * 1024) {
  const docStr = JSON.stringify(doc);
  const size = Buffer.byteLength(docStr, "utf8");
  return size > maxSize;
}
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error("[LMDB] JSON parse error:", e);
    return null;
  }
}
function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    console.error("[LMDB] JSON stringify error:", e);
    return "";
  }
}
class SyncApi {
  constructor(env, mainDb, metaDb, attachmentDb) {
    this.env = env;
    this.mainDb = mainDb;
    this.metaDb = metaDb;
    this.attachmentDb = attachmentDb;
  }
  /**
   * 创建或更新文档（同步）
   * @param doc 文档对象，必须包含 _id
   * @returns 操作结果
   */
  put(doc) {
    try {
      if (!isValidDocId(doc._id)) {
        return createErrorResult("exception", "_id is required and must be a string", doc._id);
      }
      if (isDocSizeExceeded(doc, 1024 * 1024)) {
        return createErrorResult("exception", "Document size exceeds 1M", doc._id);
      }
      let syncMeta = null;
      if (this.shouldSync(doc._id)) {
        syncMeta = {
          _lastModified: Date.now(),
          _cloudSynced: false
        };
      }
      const { _cloudSynced, _lastModified, ...docWithoutSyncFields } = doc;
      return this.env.transactionSync(() => {
        const id = doc._id;
        const existingMeta = this.metaDb.get(id);
        if (existingMeta) {
          let existingRev2;
          if (existingMeta.startsWith("{")) {
            const meta = safeJsonParse(existingMeta);
            existingRev2 = meta._rev;
          } else {
            existingRev2 = existingMeta;
          }
          if (!doc._rev || doc._rev !== existingRev2) {
            console.log("[LMDB] 版本验证失败", doc._rev, existingRev2);
            return createErrorResult("conflict", "Document update conflict", id);
          }
        }
        let existingRev;
        if (existingMeta) {
          if (existingMeta.startsWith("{")) {
            const meta = safeJsonParse(existingMeta);
            existingRev = meta._rev;
          } else {
            existingRev = existingMeta;
          }
        }
        const newRev = generateNewRev(existingRev);
        const docToSave = { ...docWithoutSyncFields, _rev: newRev };
        this.mainDb.putSync(id, safeJsonStringify(docToSave));
        if (syncMeta) {
          const metaToSave = {
            _rev: newRev,
            _lastModified: syncMeta._lastModified,
            _cloudSynced: syncMeta._cloudSynced
          };
          this.metaDb.putSync(id, safeJsonStringify(metaToSave));
          console.log("[LMDB] metaDb", metaToSave);
        } else {
          this.metaDb.putSync(id, newRev);
        }
        doc._rev = newRev;
        return createSuccessResult(id, newRev);
      });
    } catch (e) {
      console.error("[LMDB] put error:", e);
      return createErrorResult(e.name || "exception", e.message, doc._id);
    }
  }
  /**
   * 判断文档是否需要同步
   */
  shouldSync(docId) {
    const syncPrefixes = ["ZTOOLS/settings-general", "PLUGIN/"];
    return syncPrefixes.some((prefix) => docId.startsWith(prefix));
  }
  /**
   * 获取文档的同步元数据
   * @param id 文档 ID
   * @returns 同步元数据对象，不存在返回 null
   */
  getSyncMeta(id) {
    try {
      const metaStr = this.metaDb.get(id);
      if (!metaStr) {
        return null;
      }
      if (metaStr.startsWith("{")) {
        return safeJsonParse(metaStr);
      } else {
        return { _rev: metaStr };
      }
    } catch (e) {
      console.error("[LMDB] getSyncMeta error:", e);
      return null;
    }
  }
  /**
   * 更新文档的同步状态（不修改文档内容）
   * @param id 文档 ID
   * @param cloudSynced 是否已同步
   */
  updateSyncStatus(id, cloudSynced) {
    try {
      const metaStr = this.metaDb.get(id);
      if (!metaStr) {
        console.warn(`[LMDB] updateSyncStatus: 文档不存在 ${id}`);
        return;
      }
      let meta;
      if (metaStr.startsWith("{")) {
        meta = safeJsonParse(metaStr);
      } else {
        meta = { _rev: metaStr };
      }
      meta._cloudSynced = cloudSynced;
      this.metaDb.putSync(id, safeJsonStringify(meta));
    } catch (e) {
      console.error("[LMDB] updateSyncStatus error:", e);
    }
  }
  /**
   * 根据 ID 获取文档（同步）
   * @param id 文档 ID
   * @returns 文档对象，不存在返回 null
   */
  get(id) {
    try {
      const docStr = this.mainDb.get(id);
      if (!docStr) {
        return null;
      }
      const doc = safeJsonParse(docStr);
      return doc;
    } catch (e) {
      console.error("[LMDB] get error:", e);
      return null;
    }
  }
  /**
   * 删除文档（同步）
   * @param docOrId 文档对象或文档 ID
   * @returns 操作结果
   */
  remove(docOrId) {
    try {
      let id;
      let rev;
      if (typeof docOrId === "string") {
        id = docOrId;
        const existingDoc = this.get(id);
        if (!existingDoc) {
          return createErrorResult("not_found", "Document not found", id);
        }
        rev = existingDoc._rev;
      } else {
        id = docOrId._id;
        rev = docOrId._rev;
        if (!isValidDocId(id)) {
          return createErrorResult("exception", "_id is required", id);
        }
        const currentRevMeta = this.metaDb.get(id);
        if (currentRevMeta && rev) {
          let currentRev;
          if (currentRevMeta.startsWith("{")) {
            const meta = safeJsonParse(currentRevMeta);
            currentRev = meta._rev;
          } else {
            currentRev = currentRevMeta;
          }
          if (rev !== currentRev) {
            return createErrorResult("conflict", "Document update conflict", id);
          }
        }
      }
      return this.env.transactionSync(() => {
        console.log("[LMDB] remove doc:", id);
        this.mainDb.removeSync(id);
        this.metaDb.removeSync(id);
        return createSuccessResult(id);
      });
    } catch (e) {
      console.error("[LMDB] remove error:", e);
      const id = typeof docOrId === "string" ? docOrId : docOrId._id;
      return createErrorResult(e.name || "exception", e.message, id);
    }
  }
  /**
   * 批量创建或更新文档（同步）
   * @param docs 文档对象数组
   * @returns 操作结果数组
   */
  bulkDocs(docs) {
    try {
      if (!Array.isArray(docs)) {
        throw new Error("docs must be an array");
      }
      for (const doc of docs) {
        if (!isValidDocId(doc._id)) {
          throw new Error("All documents must have a valid _id");
        }
      }
      const ids = docs.map((d) => d._id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Duplicate _id found in docs array");
      }
      const results = [];
      this.env.transactionSync(() => {
        for (const doc of docs) {
          try {
            const result = this.putInTransaction(doc);
            results.push(result);
          } catch (e) {
            results.push(createErrorResult(e.name || "exception", e.message, doc._id));
          }
        }
      });
      return results;
    } catch (e) {
      console.error("[LMDB] bulkDocs error:", e);
      throw e;
    }
  }
  /**
   * 获取文档数组（同步）
   * @param key 可选的文档 ID 前缀（字符串）或文档 ID 数组
   * @returns 文档对象数组
   */
  allDocs(key) {
    try {
      const results = [];
      if (Array.isArray(key)) {
        for (const id of key) {
          const doc = this.get(id);
          if (doc) {
            results.push(doc);
          }
        }
      } else {
        const prefix = key || "";
        let endPrefix;
        if (prefix) {
          const lastChar = prefix[prefix.length - 1];
          const nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
          endPrefix = prefix.slice(0, -1) + nextChar;
        }
        const rangeOptions = { start: prefix };
        if (endPrefix) {
          rangeOptions.end = endPrefix;
        }
        for (const { key: currentKey, value: docStr } of Array.from(
          this.mainDb.getRange(rangeOptions)
        )) {
          if (!currentKey.startsWith(prefix)) {
            break;
          }
          const doc = safeJsonParse(docStr);
          if (doc) {
            results.push(doc);
          }
        }
      }
      return results;
    } catch (e) {
      console.error("[LMDB] allDocs error:", e);
      return [];
    }
  }
  /**
   * 存储附件（同步）
   * @param id 文档 ID
   * @param attachment 附件数据（Buffer 或 Uint8Array）
   * @param type MIME 类型
   * @returns 操作结果
   */
  postAttachment(id, attachment, type) {
    try {
      const buffer = Buffer.from(attachment);
      if (buffer.byteLength > 10 * 1024 * 1024) {
        return createErrorResult("exception", "Attachment exceeds 10M", id);
      }
      const existing = this.attachmentDb.get(`attachment:${id}`);
      if (existing) {
        return createErrorResult("conflict", "Attachment already exists", id);
      }
      const md5 = crypto__namespace.createHash("md5").update(buffer).digest("hex");
      const metadata = {
        type,
        length: buffer.byteLength,
        md5
      };
      return this.env.transactionSync(() => {
        this.attachmentDb.putSync(`attachment:${id}`, buffer);
        this.attachmentDb.putSync(`attachment-ext:${id}`, safeJsonStringify(metadata));
        return createSuccessResult(id);
      });
    } catch (e) {
      console.error("[LMDB] postAttachment error:", e);
      return createErrorResult(e.name || "exception", e.message, id);
    }
  }
  /**
   * 获取附件（同步）
   * @param id 附件文档 ID
   * @returns 附件数据（Uint8Array），不存在返回 null
   */
  getAttachment(id) {
    try {
      const buffer = this.attachmentDb.get(`attachment:${id}`);
      if (!buffer) {
        return null;
      }
      return new Uint8Array(buffer);
    } catch (e) {
      console.error("[LMDB] getAttachment error:", e);
      return null;
    }
  }
  /**
   * 获取附件元数据（同步）
   * @param id 附件文档 ID
   * @returns 附件元数据对象，不存在返回 null
   */
  getAttachmentType(id) {
    try {
      const metadataStr = this.attachmentDb.get(`attachment-ext:${id}`);
      if (!metadataStr) {
        return null;
      }
      const metadata = safeJsonParse(metadataStr);
      return metadata;
    } catch (e) {
      console.error("[LMDB] getAttachmentType error:", e);
      return null;
    }
  }
  /**
   * 在事务中执行 put 操作（用于 bulkDocs）
   * @param doc 文档对象
   * @returns 操作结果
   */
  putInTransaction(doc) {
    if (!isValidDocId(doc._id)) {
      return createErrorResult("exception", "_id is required", doc._id);
    }
    if (isDocSizeExceeded(doc, 1024 * 1024)) {
      return createErrorResult("exception", "Document size exceeds 1M", doc._id);
    }
    const id = doc._id;
    const existingRev = this.metaDb.get(id);
    if (existingRev) {
      if (!doc._rev || doc._rev !== existingRev) {
        return createErrorResult("conflict", "Document update conflict", id);
      }
    }
    const newRev = generateNewRev(existingRev);
    const docToSave = { ...doc, _rev: newRev };
    this.mainDb.putSync(id, safeJsonStringify(docToSave));
    this.metaDb.putSync(id, newRev);
    doc._rev = newRev;
    return createSuccessResult(id, newRev);
  }
}
class PromiseApi {
  constructor(syncApi) {
    this.syncApi = syncApi;
  }
  /**
   * 创建或更新文档（异步）
   * @param doc 文档对象，必须包含 _id
   * @returns Promise<操作结果>
   */
  async put(doc) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.put(doc);
          resolve(result);
        } catch (e) {
          console.error("[LMDB] put error:", e);
          reject(e);
        }
      });
    });
  }
  /**
   * 根据 ID 获取文档（异步）
   * @param id 文档 ID
   * @returns Promise<文档对象>，不存在返回 null
   */
  async get(id) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.get(id);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 删除文档（异步）
   * @param docOrId 文档对象或文档 ID
   * @returns Promise<操作结果>
   */
  async remove(docOrId) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.remove(docOrId);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 批量创建或更新文档（异步）
   * @param docs 文档对象数组
   * @returns Promise<操作结果数组>
   */
  async bulkDocs(docs) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const results = this.syncApi.bulkDocs(docs);
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 获取文档数组（异步）
   * @param key 可选的文档 ID 前缀（字符串）或文档 ID 数组
   * @returns Promise<文档对象数组>
   */
  async allDocs(key) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const results = this.syncApi.allDocs(key);
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 存储附件（异步）
   * @param id 文档 ID
   * @param attachment 附件数据（Buffer 或 Uint8Array）
   * @param type MIME 类型
   * @returns Promise<操作结果>
   */
  async postAttachment(id, attachment, type) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.postAttachment(id, attachment, type);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 获取附件（异步）
   * @param id 附件文档 ID
   * @returns Promise<附件数据（Uint8Array）>，不存在返回 null
   */
  async getAttachment(id) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.getAttachment(id);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 获取附件元数据（异步）
   * @param id 附件文档 ID
   * @returns Promise<附件元数据对象>，不存在返回 null
   */
  async getAttachmentType(id) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.getAttachmentType(id);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 获取文档的同步元数据（异步）
   * @param id 文档 ID
   * @returns Promise<同步元数据对象>，不存在返回 null
   */
  async getSyncMeta(id) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.getSyncMeta(id);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  /**
   * 更新文档的同步状态（异步）
   * @param id 文档 ID
   * @param cloudSynced 是否已同步
   */
  async updateSyncStatus(id, cloudSynced) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          this.syncApi.updateSyncStatus(id, cloudSynced);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}
class LmdbDatabase {
  env;
  mainDb;
  metaDb;
  attachmentDb;
  syncApi;
  promiseApi;
  /**
   * promises 对象，提供所有 Promise 形式的 API
   */
  promises;
  /**
   * 构造函数
   * @param config LMDB 配置对象
   */
  constructor(config) {
    if (!fs.existsSync(config.path)) {
      fs.mkdirSync(config.path, { recursive: true });
    }
    this.env = lmdb.open({
      path: config.path,
      mapSize: config.mapSize || 2 * 1024 * 1024 * 1024,
      // 默认 2GB
      maxDbs: config.maxDbs || 3,
      compression: false,
      // 禁用压缩以提高性能
      encoding: "binary"
      // 使用二进制编码
    });
    this.mainDb = this.env.openDB({
      name: "main",
      encoding: "string"
      // 主数据库使用字符串编码
    });
    this.metaDb = this.env.openDB({
      name: "meta",
      encoding: "string"
      // 元数据使用字符串编码
    });
    this.attachmentDb = this.env.openDB({
      name: "attachment",
      encoding: "binary"
      // 附件使用二进制编码
    });
    this.syncApi = new SyncApi(this.env, this.mainDb, this.metaDb, this.attachmentDb);
    this.promiseApi = new PromiseApi(this.syncApi);
    this.promises = {
      put: (doc) => this.promiseApi.put(doc),
      get: (id) => this.promiseApi.get(id),
      remove: (docOrId) => this.promiseApi.remove(docOrId),
      bulkDocs: (docs) => this.promiseApi.bulkDocs(docs),
      allDocs: (key) => this.promiseApi.allDocs(key),
      postAttachment: (id, attachment, type) => this.promiseApi.postAttachment(id, attachment, type),
      getAttachment: (id) => this.promiseApi.getAttachment(id),
      getAttachmentType: (id) => this.promiseApi.getAttachmentType(id),
      getSyncMeta: (id) => this.promiseApi.getSyncMeta(id),
      updateSyncStatus: (id, cloudSynced) => this.promiseApi.updateSyncStatus(id, cloudSynced)
    };
  }
  // ==================== 同步 API ====================
  /**
   * 创建或更新文档（同步）
   * @param doc 文档对象，必须包含 _id
   * @returns 操作结果
   */
  put(doc) {
    return this.syncApi.put(doc);
  }
  /**
   * 根据 ID 获取文档（同步）
   * @param id 文档 ID
   * @returns 文档对象，不存在返回 null
   */
  get(id) {
    return this.syncApi.get(id);
  }
  /**
   * 删除文档（同步）
   * @param docOrId 文档对象或文档 ID
   * @returns 操作结果
   */
  remove(docOrId) {
    return this.syncApi.remove(docOrId);
  }
  /**
   * 批量创建或更新文档（同步）
   * @param docs 文档对象数组
   * @returns 操作结果数组
   */
  bulkDocs(docs) {
    return this.syncApi.bulkDocs(docs);
  }
  /**
   * 获取文档数组（同步）
   * @param key 可选的文档 ID 前缀（字符串）或文档 ID 数组
   * @returns 文档对象数组
   */
  allDocs(key) {
    return this.syncApi.allDocs(key);
  }
  /**
   * 存储附件（同步）
   * @param id 文档 ID
   * @param attachment 附件数据（Buffer 或 Uint8Array）
   * @param type MIME 类型
   * @returns 操作结果
   */
  postAttachment(id, attachment, type) {
    return this.syncApi.postAttachment(id, attachment, type);
  }
  /**
   * 获取附件（同步）
   * @param id 附件文档 ID
   * @returns 附件数据（Uint8Array），不存在返回 null
   */
  getAttachment(id) {
    return this.syncApi.getAttachment(id);
  }
  /**
   * 获取附件元数据（同步）
   * @param id 附件文档 ID
   * @returns 附件元数据对象，不存在返回 null
   */
  getAttachmentType(id) {
    return this.syncApi.getAttachmentType(id);
  }
  // ==================== 实用方法 ====================
  /**
   * 获取附件数据库实例（用于高级查询）
   * @returns 附件数据库实例
   */
  getAttachmentDb() {
    return this.attachmentDb;
  }
  /**
   * 获取元数据数据库实例（用于高级查询）
   * @returns 元数据数据库实例
   */
  getMetaDb() {
    return this.metaDb;
  }
  /**
   * 关闭数据库
   */
  close() {
    try {
      this.env.close();
    } catch (e) {
      console.error("[LMDB] Error closing LMDB:", e);
    }
  }
  /**
   * 获取数据库统计信息
   */
  getStats() {
    try {
      return {
        main: this.mainDb.getStats?.() || {},
        meta: this.metaDb.getStats?.() || {},
        attachment: this.attachmentDb.getStats?.() || {}
      };
    } catch (e) {
      console.error("[LMDB] Error getting stats:", e);
      return {};
    }
  }
  /**
   * 同步数据到磁盘
   */
  sync() {
    try {
      this.env.sync();
    } catch (e) {
      console.error("[LMDB] Error syncing LMDB:", e);
    }
  }
}
const lmdbInstance = new LmdbDatabase({
  path: path.join(electron.app.getPath("userData"), "lmdb"),
  mapSize: 2 * 1024 * 1024 * 1024,
  // 2GB
  maxDbs: 3
  // main, meta, attachment
});
console.log("[LMDB] LMDB database created successfully");
function closeLmdb() {
  try {
    lmdbInstance.close();
    console.log("[LMDB] LMDB database closed successfully");
  } catch (e) {
    console.error("[LMDB] Error closing LMDB:", e);
  }
}
electron.app.on("will-quit", () => {
  closeLmdb();
});
const macZToolsNative = path.join(__dirname, "../../resources/lib/mac/ztools_native.node");
const winZToolsNative = path.join(__dirname, "../../resources/lib/win/ztools_native.node");
const platform = os.platform();
let addon = null;
if (platform === "darwin") {
  addon = require(macZToolsNative);
} else if (platform === "win32") {
  addon = require(winZToolsNative);
}
class ClipboardMonitor {
  _callback = null;
  _isMonitoring = false;
  _pollTimer = null;
  /**
   * 启动剪贴板监控
   * @param callback - 剪贴板变化时的回调函数（无参数）
   */
  start(callback) {
    if (this._isMonitoring) {
      throw new Error("Monitor is already running");
    }
    if (typeof callback !== "function") {
      throw new TypeError("Callback must be a function");
    }
    this._callback = callback;
    this._isMonitoring = true;
    if (platform === "linux") {
      let lastText = electron.clipboard.readText();
      this._pollTimer = setInterval(() => {
        const current = electron.clipboard.readText();
        if (current !== lastText) {
          lastText = current;
          if (this._callback) {
            this._callback();
          }
        }
      }, 500);
    } else {
      addon.startMonitor(() => {
        if (this._callback) {
          this._callback();
        }
      });
    }
  }
  /**
   * 停止剪贴板监控
   */
  stop() {
    if (!this._isMonitoring) {
      return;
    }
    if (platform === "linux") {
      if (this._pollTimer !== null) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    } else {
      addon.stopMonitor();
    }
    this._isMonitoring = false;
    this._callback = null;
  }
  /**
   * 是否正在监控
   */
  get isMonitoring() {
    return this._isMonitoring;
  }
  /**
   * 获取剪贴板中的文件列表
   * @returns {Array<{path: string, name: string, isDirectory: boolean}>} 文件列表
   * - path: 文件完整路径
   * - name: 文件名
   * - isDirectory: 是否是目录
   */
  static getClipboardFiles() {
    if (platform === "win32") {
      return addon.getClipboardFiles();
    } else if (platform === "darwin") {
      throw new Error("getClipboardFiles is not yet supported on macOS");
    }
    return [];
  }
  /**
   * 设置剪贴板中的文件列表
   * @param {Array<string|{path: string}>} files - 文件路径数组
   * - 支持直接传递字符串路径数组: ['C:\\file1.txt', 'C:\\file2.txt']
   * - 支持传递对象数组: [{path: 'C:\\file1.txt'}, {path: 'C:\\file2.txt'}]
   * @returns {boolean} 是否设置成功
   * @example
   * // 使用字符串数组
   * ClipboardMonitor.setClipboardFiles(['C:\\test.txt', 'C:\\folder']);
   *
   * // 使用对象数组（兼容 getClipboardFiles 的返回格式）
   * const files = ClipboardMonitor.getClipboardFiles();
   * ClipboardMonitor.setClipboardFiles(files);
   */
  static setClipboardFiles(files) {
    if (!Array.isArray(files)) {
      throw new TypeError("files must be an array");
    }
    if (files.length === 0) {
      throw new Error("files array cannot be empty");
    }
    if (platform === "win32" || platform === "darwin") {
      return addon.setClipboardFiles(files);
    }
    return false;
  }
}
class WindowMonitor {
  _callback = null;
  _isMonitoring = false;
  /**
   * 启动窗口监控
   * @param callback - 窗口切换时的回调函数
   * - macOS: { app, bundleId, title, x, y, width, height, appPath, pid }
   * - Windows: { app, pid, title, x, y, width, height, appPath }
   */
  start(callback) {
    if (this._isMonitoring) {
      throw new Error("Window monitor is already running");
    }
    if (typeof callback !== "function") {
      throw new TypeError("Callback must be a function");
    }
    this._callback = callback;
    this._isMonitoring = true;
    if (platform === "linux") {
      console.warn("[WindowMonitor] Linux 平台暂不支持原生窗口监控，功能已降级");
    } else {
      addon.startWindowMonitor((windowInfo) => {
        if (this._callback) {
          this._callback(windowInfo);
        }
      });
    }
  }
  /**
   * 停止窗口监控
   */
  stop() {
    if (!this._isMonitoring) {
      return;
    }
    if (platform !== "linux") {
      addon.stopWindowMonitor();
    }
    this._isMonitoring = false;
    this._callback = null;
  }
  /**
   * 是否正在监控
   */
  get isMonitoring() {
    return this._isMonitoring;
  }
}
let WindowManager$1 = class WindowManager {
  /**
   * 获取当前激活的窗口信息
   * @returns 窗口信息对象
   * - macOS: { app, bundleId, pid }
   * - Windows: { app, pid }
   */
  static getActiveWindow() {
    if (platform === "linux") {
      return null;
    }
    const result = addon.getActiveWindow();
    if (!result || result.error) {
      return null;
    }
    return result;
  }
  /**
   * 根据标识符激活指定应用的窗口
   * @param identifier - 应用标识符
   * - macOS: bundleId (string)
   * - Windows: processId (number)
   * @returns 是否激活成功
   */
  static activateWindow(identifier) {
    if (platform === "linux") {
      try {
        if (typeof identifier === "number") {
          const stdout = child_process.execSync("wmctrl -lp").toString();
          const lines = stdout.split("\n");
          for (const line of lines) {
            const parts = line.split(/\s+/).filter(Boolean);
            if (parts.length >= 3 && parts[2] === identifier.toString()) {
              const wid = parts[0];
              child_process.spawnSync("wmctrl", ["-ia", wid]);
              break;
            }
          }
        } else if (typeof identifier === "string" && identifier.startsWith("0x")) {
          child_process.spawnSync("wmctrl", ["-ia", identifier]);
        } else {
          child_process.spawnSync("wmctrl", ["-a", identifier]);
        }
        return true;
      } catch (e) {
        console.error("[Native] Linux activateWindow 失败:", e);
        return false;
      }
    }
    if (platform === "darwin") {
      if (typeof identifier !== "string") {
        throw new TypeError("On macOS, identifier must be a bundleId (string)");
      }
    } else if (platform === "win32") {
      if (typeof identifier !== "number") {
        throw new TypeError("On Windows, identifier must be a processId (number)");
      }
    }
    return addon.activateWindow(identifier);
  }
  /**
   * 获取当前平台
   * @returns 'darwin' | 'win32'
   */
  static getPlatform() {
    return platform;
  }
  /**
   * 模拟粘贴操作（Command+V on macOS, Ctrl+V on Windows）
   * @returns {boolean} 是否成功
   */
  static simulatePaste() {
    if (platform === "linux") {
      return false;
    }
    return addon.simulatePaste();
  }
  /**
   * 模拟键盘按键
   * @param {string} key - 要模拟的按键
   * @param {...string} modifiers - 修饰键（shift、ctrl、alt、meta）
   * @returns {boolean} 是否成功
   * @example
   * // 模拟按下字母 'a'
   * WindowManager.simulateKeyboardTap('a');
   *
   * // 模拟 Command+C (macOS) 或 Ctrl+C (Windows)
   * WindowManager.simulateKeyboardTap('c', 'meta');
   *
   * // 模拟 Shift+Tab
   * WindowManager.simulateKeyboardTap('tab', 'shift');
   *
   * // 模拟 Command+Shift+S (macOS)
   * WindowManager.simulateKeyboardTap('s', 'meta', 'shift');
   */
  static simulateKeyboardTap(key, ...modifiers) {
    if (platform === "linux") {
      return false;
    }
    if (typeof key !== "string" || !key) {
      throw new TypeError("key must be a non-empty string");
    }
    return addon.simulateKeyboardTap(key, ...modifiers);
  }
  /**
   * 模拟 Unicode 字符输入（逐字符输入，类似输入法）
   * @param {string} segment - 要输入的字符/字素簇
   * @returns {boolean} 是否成功
   */
  static unicodeType(segment) {
    if (platform === "linux") {
      return false;
    }
    return addon.unicodeType(segment);
  }
  /**
   * Windows: 通过 COM IShellWindows 查询指定窗口句柄对应的 Explorer 文件夹路径
   * @param hwnd - 窗口句柄（从 WindowInfo.hwnd 获取）
   * @returns 文件夹路径（file:/// URL 格式），失败返回 null
   */
  static getExplorerFolderPath(hwnd) {
    if (platform !== "win32") {
      throw new Error("getExplorerFolderPath is only available on Windows");
    }
    return addon.getExplorerFolderPath(hwnd);
  }
  /**
   * Windows: 读取指定浏览器窗口的当前 URL
   * @param browserName 浏览器标识（如 chrome/msedge/firefox）
   * @param hwnd 窗口句柄（从 WindowInfo.hwnd 获取）
   * @returns URL 字符串，失败返回 null
   */
  static readBrowserWindowUrl(browserName, hwnd) {
    if (platform !== "win32") {
      throw new Error("readBrowserWindowUrl is only available on Windows");
    }
    if (typeof browserName !== "string" || browserName.trim() === "") {
      throw new TypeError("browserName must be a non-empty string");
    }
    if (typeof hwnd !== "number" || !Number.isFinite(hwnd) || hwnd <= 0) {
      throw new TypeError("hwnd must be a positive number");
    }
    return new Promise((resolve) => {
      addon.readBrowserWindowUrl(browserName, hwnd, (url2) => {
        resolve(typeof url2 === "string" && url2.trim() !== "" ? url2 : null);
      });
    });
  }
  /**
   * 模拟鼠标移动到指定屏幕位置
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseMove(x, y) {
    if (platform === "linux") {
      return false;
    }
    if (typeof x !== "number" || typeof y !== "number") {
      throw new TypeError("x and y must be numbers");
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError("x and y must be finite numbers");
    }
    return addon.simulateMouseMove(x, y);
  }
  /**
   * 模拟鼠标左键单击
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseClick(x, y) {
    if (platform === "linux") {
      return false;
    }
    if (typeof x !== "number" || typeof y !== "number") {
      throw new TypeError("x and y must be numbers");
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError("x and y must be finite numbers");
    }
    return addon.simulateMouseClick(x, y);
  }
  /**
   * 模拟鼠标左键双击
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseDoubleClick(x, y) {
    if (platform === "linux") {
      return false;
    }
    if (typeof x !== "number" || typeof y !== "number") {
      throw new TypeError("x and y must be numbers");
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError("x and y must be finite numbers");
    }
    return addon.simulateMouseDoubleClick(x, y);
  }
  /**
   * 模拟鼠标右键单击
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseRightClick(x, y) {
    if (platform === "linux") {
      return false;
    }
    if (typeof x !== "number" || typeof y !== "number") {
      throw new TypeError("x and y must be numbers");
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError("x and y must be finite numbers");
    }
    return addon.simulateMouseRightClick(x, y);
  }
  /**
   * 获取当前选中的内容（支持文本、文件、图像）
   *
   * 实现方式：
   * - Windows: 优先使用 UI Automation API，回退到剪贴板方法（适用于 Cursor/VS Code 等编辑器）
   * - macOS: 使用模拟复制方法（Cmd+C）
   *
   * 在模拟复制时会自动暂停内部的 clipboardMonitor，防止误触发监听自身发起的事件
   *
   * @returns {Array<{type: string, data: any}>} 选中内容数组
   * - type: 'text' | 'file' | 'image'
   * - data: 根据类型不同：
   *   - text: 字符串
   *   - file: 文件路径字符串数组
   *   - image: base64 编码的 PNG 图像（带 format 和 encoding 字段）
   *
   * @example
   * const contents = WindowManager.getSelectedContent();
   * contents.forEach(item => {
   *   switch (item.type) {
   *     case 'text':
   *       console.log('Selected text:', item.data);
   *       break;
   *     case 'file':
   *       console.log('Selected files:', item.data);
   *       break;
   *     case 'image':
   *       console.log('Selected image (base64):', item.data.substring(0, 50) + '...');
   *       break;
   *   }
   * });
   */
  static getSelectedContent() {
    if (platform === "linux") {
      return [];
    }
    return addon.getSelectedContent();
  }
};
class MouseMonitor {
  static _callback = null;
  static _isMonitoring = false;
  /**
   * 启动鼠标监控
   * @param buttonType - 按钮类型：'middle' | 'right' | 'back' | 'forward'
   * @param longPressMs - 长按阈值（毫秒）
   *   - 0: 监听点击（mouseUp 时触发）
   *   - >0: 监听长按（按住达到该时长后触发）
   *   - 注意：'right' 只支持长按（longPressMs 必须 > 0）
   * @param callback - 鼠标事件回调函数
   * - 返回值: 无返回值或 { shouldBlock?: boolean }
   *   - shouldBlock: true 时 C++ 侧拦截原始鼠标事件，不传递给目标窗口
   */
  static start(buttonType, longPressMs, callback) {
    if (MouseMonitor._isMonitoring) {
      throw new Error("Mouse monitor is already running");
    }
    const validButtons = ["middle", "right", "back", "forward"];
    if (!validButtons.includes(buttonType)) {
      throw new TypeError(`buttonType must be one of: ${validButtons.join(", ")}`);
    }
    if (typeof longPressMs !== "number" || longPressMs < 0) {
      throw new TypeError("longPressMs must be a non-negative number");
    }
    if (buttonType === "right" && longPressMs === 0) {
      throw new TypeError("'right' button only supports long press (longPressMs must be > 0)");
    }
    if (typeof callback !== "function") {
      throw new TypeError("Callback must be a function");
    }
    MouseMonitor._callback = callback;
    MouseMonitor._isMonitoring = true;
    if (platform === "linux") {
      return;
    }
    addon.startMouseMonitor(buttonType, longPressMs, () => {
      if (MouseMonitor._callback) {
        return MouseMonitor._callback();
      }
    });
  }
  /**
   * 停止鼠标监控
   */
  static stop() {
    if (!MouseMonitor._isMonitoring) {
      return;
    }
    if (platform !== "linux") {
      addon.stopMouseMonitor();
    }
    MouseMonitor._isMonitoring = false;
    MouseMonitor._callback = null;
  }
  /**
   * 是否正在监控
   */
  static get isMonitoring() {
    return MouseMonitor._isMonitoring;
  }
}
class ScreenCapture {
  /**
   * 启动区域截图
   * @param {Function} callback - 截图完成时的回调函数
   * - 参数: { success: boolean, width?: number, height?: number, x?: number, y?: number }
   * - success: 是否成功截图
   * - width: 截图宽度（成功时）
   * - height: 截图高度（成功时）
   * - x: 截图左上角 x 坐标（成功时，macOS 暂不支持）
   * - y: 截图左上角 y 坐标（成功时，macOS 暂不支持）
   */
  static start(callback) {
    if (platform === "darwin") {
      throw new Error("ScreenCapture is not yet supported on macOS");
    }
    if (typeof callback !== "function") {
      throw new TypeError("Callback must be a function");
    }
    addon.startRegionCapture((result) => {
      callback(result);
    });
  }
}
class UwpManager {
  /**
   * 获取已安装的 UWP 应用列表
   * @returns {Array<{name: string, appId: string, icon: string, installLocation: string}>} 应用列表
   * - name: 应用显示名称
   * - appId: AppUserModelID（用于启动应用）
   * - icon: 应用图标路径
   * - installLocation: 应用安装目录
   */
  static getUwpApps() {
    if (platform !== "win32") {
      throw new Error("getUwpApps is only supported on Windows");
    }
    return addon.getUwpApps();
  }
  /**
   * 启动 UWP 应用
   * @param {string} appId - AppUserModelID（从 getUwpApps 获取）
   * @returns {boolean} 是否启动成功
   */
  static launchUwpApp(appId) {
    if (platform !== "win32") {
      throw new Error("launchUwpApp is only supported on Windows");
    }
    if (typeof appId !== "string" || !appId) {
      throw new TypeError("appId must be a non-empty string");
    }
    return addon.launchUwpApp(appId);
  }
}
class IconExtractor {
  /**
   * 异步获取文件/应用的图标（PNG 格式 Buffer）
   * @param {string} filePath - 文件路径（可以是 .exe、.lnk、.dll 或任何文件类型）
   * @returns {Promise<Buffer>} Promise，resolve 为 PNG 格式的图标数据
   * @example
   * // 获取 exe 的图标
   * const icon = await IconExtractor.getFileIcon('C:\\Windows\\notepad.exe');
   *
   * // 保存为文件
   * const fs = require('fs');
   * const icon = await IconExtractor.getFileIcon('C:\\Windows\\notepad.exe');
   * if (icon) fs.writeFileSync('icon.png', icon);
   */
  static getFileIcon(filePath) {
    if (platform !== "win32" && platform !== "darwin") {
      throw new Error("getFileIcon is only supported on Windows and macOS");
    }
    if (typeof filePath !== "string" || !filePath) {
      throw new TypeError("filePath must be a non-empty string");
    }
    return addon.getFileIcon(filePath);
  }
}
class MuiResolver {
  /**
   * 批量解析 MUI 资源字符串
   * @param refs - MUI 引用字符串数组，如 ['@%SystemRoot%\\system32\\shell32.dll,-22067']
   * @returns 解析结果 Map，key 为原始引用，value 为解析后的本地化字符串
   */
  static resolve(refs) {
    if (platform !== "win32") {
      throw new Error("MuiResolver is only supported on Windows");
    }
    if (!Array.isArray(refs)) {
      throw new TypeError("refs must be an array of strings");
    }
    const result = addon.resolveMuiStrings(refs);
    return new Map(Object.entries(result));
  }
}
class ColorPicker {
  static _callback = null;
  static _isActive = false;
  /**
   * 启动取色器
   * @param callback - 取色完成时的回调函数
   * - 成功: { success: true, hex: '#59636E' }
   * - 取消: { success: false, hex: null }
   */
  static start(callback) {
    if (ColorPicker._isActive) {
      throw new Error("Color picker is already active");
    }
    if (typeof callback !== "function") {
      throw new TypeError("Callback must be a function");
    }
    ColorPicker._callback = callback;
    ColorPicker._isActive = true;
    if (platform === "linux") {
      ColorPicker._isActive = false;
      if (ColorPicker._callback) {
        const cb = ColorPicker._callback;
        ColorPicker._callback = null;
        cb({ success: false, hex: null });
      }
      return;
    }
    addon.startColorPicker((result) => {
      addon.stopColorPicker();
      ColorPicker._isActive = false;
      if (ColorPicker._callback) {
        const cb = ColorPicker._callback;
        ColorPicker._callback = null;
        cb(result);
      }
    });
  }
  /**
   * 停止取色器（手动取消）
   */
  static stop() {
    if (!ColorPicker._isActive) {
      return;
    }
    if (platform !== "linux") {
      addon.stopColorPicker();
    }
    ColorPicker._isActive = false;
    ColorPicker._callback = null;
  }
  /**
   * 是否正在取色
   */
  static get isActive() {
    return ColorPicker._isActive;
  }
}
const MAC_FILE_PBOARD_TYPE = "NSFilenamesPboardType";
function normalizeFilePaths(files) {
  return files.map((file) => typeof file === "string" ? file : file.path).filter((filePath) => typeof filePath === "string" && filePath.length > 0);
}
function hasClipboardFiles() {
  if (os.platform() === "darwin") {
    return electron.clipboard.has(MAC_FILE_PBOARD_TYPE);
  }
  if (os.platform() === "win32") {
    return readClipboardFiles().length > 0;
  }
  return false;
}
function readClipboardFilePaths() {
  if (os.platform() === "darwin") {
    if (!electron.clipboard.has(MAC_FILE_PBOARD_TYPE)) {
      return [];
    }
    const result = electron.clipboard.read(MAC_FILE_PBOARD_TYPE);
    if (!result) {
      return [];
    }
    const filePaths = plist.parse(result);
    return Array.isArray(filePaths) ? filePaths : [];
  }
  if (os.platform() === "win32") {
    return ClipboardMonitor.getClipboardFiles().map((file) => file.path);
  }
  return [];
}
function readClipboardFiles() {
  if (os.platform() === "win32") {
    return ClipboardMonitor.getClipboardFiles();
  }
  if (os.platform() !== "darwin") {
    return [];
  }
  return readClipboardFilePaths().map((filePath) => {
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(filePath).isDirectory();
    } catch {
    }
    return {
      path: filePath,
      name: path.basename(filePath),
      isDirectory
    };
  });
}
function writeClipboardFiles(files) {
  const filePaths = normalizeFilePaths(files);
  if (filePaths.length === 0) {
    throw new Error("files array cannot be empty");
  }
  if (os.platform() === "win32") {
    return ClipboardMonitor.setClipboardFiles(filePaths);
  }
  if (os.platform() === "darwin") {
    const plistData = plist.stringify(filePaths);
    electron.clipboard.writeBuffer(MAC_FILE_PBOARD_TYPE, Buffer.from(plistData));
    return true;
  }
  return false;
}
const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
function extractAcronym(name) {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  if (words.length > 1) {
    return words.map((w) => w[0].toLowerCase()).join("");
  }
  const capitals = name.match(/[A-Z]/g);
  if (capitals && capitals.length > 1) {
    return capitals.map((c) => c.toLowerCase()).join("");
  }
  return "";
}
function decodeFileUrlToPath(fileUrl) {
  try {
    return url.fileURLToPath(fileUrl);
  } catch {
    const fallbackPath = fileUrl.replace(/^file:\/\/\//, "").replace(/\//g, "\\");
    try {
      return decodeURIComponent(fallbackPath);
    } catch {
      return fallbackPath;
    }
  }
}
function getExplorerFolderPathFromWindow(windowInfo, logPrefix) {
  if (windowInfo.className === "Progman" || windowInfo.className === "WorkerW") {
    return electron.app.getPath("desktop");
  }
  if (windowInfo.className !== "CabinetWClass" && windowInfo.className !== "ExploreWClass") {
    return null;
  }
  if (typeof windowInfo.hwnd !== "number") {
    console.error(`[${logPrefix}] Explorer 窗口缺少 hwnd，无法读取目录`);
    return null;
  }
  let folderUrl = null;
  try {
    folderUrl = WindowManager$1.getExplorerFolderPath(windowInfo.hwnd);
  } catch (error) {
    console.error(`[${logPrefix}] Explorer 目录读取异常 (hwnd=${windowInfo.hwnd}):`, error);
    return null;
  }
  if (!folderUrl) {
    console.error(`[${logPrefix}] Explorer 目录读取失败 (hwnd=${windowInfo.hwnd})`);
    return null;
  }
  return decodeFileUrlToPath(folderUrl);
}
const hideWindowHtml = path.join(__dirname, "../../resources/hideWindow.html");
const mainPreload = path.join(__dirname, "../../resources/preload.js");
const WINDOW_WIDTH = 800;
const WINDOW_INITIAL_HEIGHT = 58;
const WINDOW_DEFAULT_HEIGHT = 600;
class ProxyManager {
  currentConfig = { enabled: false, url: "" };
  /**
   * 设置代理配置
   * @param config 代理配置
   */
  setProxyConfig(config) {
    this.currentConfig = {
      enabled: config.enabled,
      url: config.url,
      proxyRules: this.parseProxyRules(config.url)
    };
  }
  /**
   * 获取当前代理配置
   */
  getProxyConfig() {
    return { ...this.currentConfig };
  }
  /**
   * 应用代理配置到指定 session
   * @param sess Electron session
   * @param name session 名称（用于日志）
   */
  async applyProxyToSession(sess, name) {
    if (!this.currentConfig.enabled || !this.currentConfig.proxyRules) {
      await sess.setProxy({
        mode: "system"
        // 使用系统代理
      });
      if (name) {
        console.log(`[Proxy] ${name} 已切换到系统代理`);
      }
      return;
    }
    const bypassRules = [
      "localhost",
      // 绕过 localhost
      "127.0.0.1",
      // 绕过 127.0.0.1
      "::1",
      // 绕过 IPv6 回环（不需要方括号）
      "<local>"
      // 绕过所有本地地址
    ].join(",");
    await sess.setProxy({
      proxyRules: this.currentConfig.proxyRules,
      proxyBypassRules: bypassRules
    });
    if (name) {
      console.log(`[Proxy] ${name} 已应用自定义代理: ${this.currentConfig.proxyRules}`);
      console.log(`[Proxy] 绕过规则: ${bypassRules}`);
    }
  }
  /**
   * 应用代理配置到默认 session 并清理缓存
   */
  async applyProxyToDefaultSession() {
    if (this.currentConfig.enabled && this.currentConfig.proxyRules) {
      console.log("[Proxy] 清理 HTTP 缓存...");
      await electron.session.defaultSession.clearCache();
      console.log("[Proxy] HTTP 缓存已清理");
    }
    await this.applyProxyToSession(electron.session.defaultSession, "主程序");
    if (this.currentConfig.enabled && this.currentConfig.proxyRules) {
      const externalProxy = await electron.session.defaultSession.resolveProxy("https://github.com");
      console.log("[Proxy] 外部地址代理解析:", externalProxy);
      const localhostProxy = await electron.session.defaultSession.resolveProxy("http://localhost:5174");
      console.log("[Proxy] localhost:5174 代理解析:", localhostProxy);
      const loopbackProxy = await electron.session.defaultSession.resolveProxy("http://127.0.0.1:5174");
      console.log("[Proxy] 127.0.0.1:5174 代理解析:", loopbackProxy);
    } else {
      const externalProxy = await electron.session.defaultSession.resolveProxy("https://github.com");
      console.log("[Proxy] 使用系统代理，外部地址代理解析:", externalProxy);
    }
  }
  /**
   * 解析代理 URL 并转换为 Electron 的 proxyRules 格式
   * @param url 代理 URL
   * @returns proxyRules 字符串
   */
  parseProxyRules(url2) {
    if (!url2) return "";
    try {
      const proxyUrl = new URL(url2);
      const protocol = proxyUrl.protocol.replace(":", "");
      const host = proxyUrl.hostname;
      const port = proxyUrl.port || (protocol === "https" ? "443" : "80");
      if (protocol === "socks5" || protocol === "socks4") {
        return `${protocol}://${host}:${port}`;
      } else if (protocol === "http" || protocol === "https") {
        return `${host}:${port}`;
      }
      return url2;
    } catch (error) {
      console.warn("[Proxy] 解析代理 URL 失败，使用原始格式:", error);
      return url2;
    }
  }
}
const proxyManager = new ProxyManager();
const GLOBAL_SCROLLBAR_CSS = `
  /* 全局滚动条样式 - 仅在插件未自定义时生效 */
  ::-webkit-scrollbar {
    width: 6px !important;
    height: 6px !important;
  }

  ::-webkit-scrollbar-track {
    background: transparent !important;
  }

  ::-webkit-scrollbar-thumb {
    border-radius: 3px !important;
    transition: background 0.2s ease !important;
  }

  /* 亮色模式滚动条 */
  @media (prefers-color-scheme: light) {
    ::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.08) !important;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 0, 0, 0.15) !important;
    }

    ::-webkit-scrollbar-thumb:active {
      background: rgba(0, 0, 0, 0.25) !important;
    }
  }

  /* 暗色模式滚动条 */
  @media (prefers-color-scheme: dark) {
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1) !important;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.2) !important;
    }

    ::-webkit-scrollbar-thumb:active {
      background: rgba(255, 255, 255, 0.35) !important;
    }
  }
`;
const winIpc = {
  windowMethods: [
    "destroy",
    "close",
    "focus",
    "blur",
    "isFocused",
    "isDestroyed",
    "show",
    "showInactive",
    "hide",
    "isVisible",
    "maximize",
    "unmaximize",
    "isMaximized",
    "minimize",
    "restore",
    "isMinimized",
    "setFullScreen",
    "isFullScreen",
    "setSimpleFullScreen",
    "isSimpleFullScreen",
    "isNormal",
    "setAspectRatio",
    "setBackgroundColor",
    "previewFile",
    "closeFilePreview",
    "setBounds",
    "getBounds",
    "getBackgroundColor",
    "setContentBounds",
    "getContentBounds",
    "getNormalBounds",
    "setEnabled",
    "isEnabled",
    "setSize",
    "getSize",
    "setContentSize",
    "getContentSize",
    "setMinimumSize",
    "getMinimumSize",
    "setMaximumSize",
    "getMaximumSize",
    "setResizable",
    "isResizable",
    "setMovable",
    "isMovable",
    "setMinimizable",
    "isMinimizable",
    "setMaximizable",
    "isMaximizable",
    "setFullScreenable",
    "isFullScreenable",
    "setClosable",
    "isClosable",
    "setAlwaysOnTop",
    "isAlwaysOnTop",
    "moveAbove",
    "moveTop",
    "center",
    "setPosition",
    "getPosition",
    "setTitle",
    "getTitle",
    "setSheetOffset",
    "flashFrame",
    "setSkipTaskbar",
    "setKiosk",
    "isKiosk",
    "isTabletMode",
    "getMediaSourceId",
    "getNativeWindowHandle",
    "setRepresentedFilename",
    "getRepresentedFilename",
    "setDocumentEdited",
    "isDocumentEdited",
    "focusOnWebView",
    "blurWebView",
    "setProgressBar",
    "setHasShadow",
    "hasShadow",
    "setOpacity",
    "getOpacity",
    "setShape",
    "showDefinitionForSelection",
    "setIcon",
    "setWindowButtonVisibility",
    "setVisibleOnAllWorkspaces",
    "isVisibleOnAllWorkspaces",
    "setIgnoreMouseEvents",
    "setContentProtection",
    "setFocusable",
    "setAutoHideCursor",
    "setVibrancy",
    "setTrafficLightPosition",
    "getTrafficLightPosition"
  ],
  windowInvokes: ["capturePage"],
  webContentsMethods: [
    "isDestroyed",
    "focus",
    "isFocused",
    "isLoading",
    "isLoadingMainFrame",
    "isWaitingForResponse",
    "isCrashed",
    "setUserAgent",
    "getUserAgent",
    "setIgnoreMenuShortcuts",
    "setAudioMuted",
    "isAudioMuted",
    "isCurrentlyAudible",
    "setZoomFactor",
    "getZoomFactor",
    "setZoomLevel",
    "getZoomLevel",
    "undo",
    "redo",
    "cut",
    "copy",
    "copyImageAt",
    "paste",
    "pasteAndMatchStyle",
    "delete",
    "selectAll",
    "unselect",
    "replace",
    "replaceMisspelling",
    "findInPage",
    "stopFindInPage",
    "isBeingCaptured",
    "incrementCapturerCount",
    "decrementCapturerCount",
    "getPrinters",
    "openDevTools",
    "closeDevTools",
    "isDevToolsOpened",
    "isDevToolsFocused",
    "toggleDevTools",
    "send",
    "sendToFrame",
    "enableDeviceEmulation",
    "disableDeviceEmulation",
    "sendInputEvent",
    "showDefinitionForSelection",
    "isOffscreen",
    "startPainting",
    "stopPainting",
    "isPainting",
    "setFrameRate",
    "getFrameRate",
    "invalidate",
    "getWebRTCIPHandlingPolicy",
    "setWebRTCIPHandlingPolicy",
    "getOSProcessId",
    "getProcessId",
    "getBackgroundThrottling",
    "setBackgroundThrottling"
  ],
  webContentsInvokes: [
    "insertCSS",
    "removeInsertedCSS",
    "executeJavaScript",
    "executeJavaScriptInIsolatedWorld",
    "setVisualZoomLevelLimits",
    "insertText",
    "capturePage",
    "print",
    // 特殊处理：callback→Promise 包装
    "printToPDF",
    "savePage",
    "takeHeapSnapshot"
  ]
};
class PluginWindowManager {
  /** win.id → 窗口信息 */
  windowInfoMap = /* @__PURE__ */ new Map();
  /**
   * 创建插件独立窗口
   * @returns win.id（数字）
   */
  createWindow(pluginPath, pluginName, sessionPartition, url2, options, senderWebContents) {
    let preloadPath = options.webPreferences?.preload;
    if (preloadPath && !path.isAbsolute(preloadPath)) {
      preloadPath = path.join(pluginPath, preloadPath);
    }
    const sess = electron.session.fromPartition(sessionPartition);
    sess.registerPreloadScript({
      type: "frame",
      filePath: mainPreload
    });
    proxyManager.applyProxyToSession(sess, `插件窗口 ${pluginName} (${sessionPartition})`).catch((error) => {
      console.error(
        `[pluginWindow:create] 插件窗口 ${pluginName} (${sessionPartition}) 应用代理配置失败:`,
        error
      );
    });
    const win = new electron.BrowserWindow({
      ...options,
      webPreferences: {
        ...options.webPreferences,
        preload: preloadPath,
        session: sess,
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        sandbox: false
      }
    });
    this.windowInfoMap.set(win.id, {
      window: win,
      parentWebContents: senderWebContents,
      pluginPath,
      pluginName,
      sessionPartition
    });
    if (url2.startsWith("http")) {
      win.loadURL(url2);
    } else if (url2.startsWith("file:///")) {
      win.loadURL(url2);
    } else {
      const loadUrl = `file:///${path.join(pluginPath, url2)}`;
      win.loadURL(loadUrl);
    }
    win.webContents.on("dom-ready", () => {
      if (senderWebContents.isDestroyed()) return;
      win.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS);
      win.webContents.insertCSS(
        'body { font-family: system-ui, "PingFang SC", "Helvetica Neue", "Microsoft Yahei", sans-serif; }'
      );
      senderWebContents.executeJavaScript(
        `if (window.ztools && window.ztools.__event__ && typeof window.ztools.__event__.createBrowserWindowCallback === 'function') {
          try { window.ztools.__event__.createBrowserWindowCallback() } catch(e) {}
          delete window.ztools.__event__.createBrowserWindowCallback
        }`
      );
      console.debug(`[pluginWindow:callback] dom-ready → trigger parent callback, winId=${win.id}`);
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      if (win.isDestroyed()) return;
      console.warn(
        `[pluginWindow:render-process-gone] winId=${win.id} plugin=${pluginName} reason=${details.reason} exitCode=${details.exitCode}`
      );
      win.destroy();
    });
    win.on("closed", () => {
      console.info(
        `[pluginWindow:destroy] winId=${win.id} unregistered from plugin=${pluginName} partition=${sessionPartition}`
      );
      this.windowInfoMap.delete(win.id);
    });
    console.info(
      `[pluginWindow:create] plugin=${pluginName} partition=${sessionPartition} winId=${win.id} url=${url2}`
    );
    return win;
  }
  /**
   * 根据 win.id 获取窗口所属的插件名称（用于所有权校验）
   */
  getPluginNameByWindowId(winId) {
    return this.windowInfoMap.get(winId)?.pluginName ?? null;
  }
  /**
   * 根据 win.id 获取窗口所属的插件路径，用于同名变体之间的权限校验。
   */
  getPluginPathByWindowId(winId) {
    return this.windowInfoMap.get(winId)?.pluginPath ?? null;
  }
  /**
   * 发送消息到父窗口
   */
  sendToParent(senderWebContents, channel, args) {
    const senderId = senderWebContents.id;
    for (const windowInfo of this.windowInfoMap.values()) {
      if (windowInfo.window.webContents === senderWebContents) {
        const parent = windowInfo.parentWebContents;
        if (parent && !parent.isDestroyed()) {
          parent.send("__ipc_sendto_relay__", { senderId, channel, args });
          return;
        }
        break;
      }
    }
    console.warn("[pluginWindow:method] 父窗口不存在或已销毁");
  }
  /**
   * 根据 webContentsId 获取插件路径
   */
  getPluginPathByWebContentsId(webContentsId) {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContentsId) {
        return windowInfo.pluginPath;
      }
    }
    return null;
  }
  /**
   * 根据 webContentsId 获取插件名称
   */
  getPluginNameByWebContentsId(webContentsId) {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContentsId) {
        return windowInfo.pluginName;
      }
    }
    return null;
  }
  /**
   * 关闭指定插件的所有窗口
   */
  closeByPlugin(pluginPath) {
    const windowIdsToClose = [];
    for (const [winId, windowInfo] of this.windowInfoMap.entries()) {
      if (windowInfo.pluginPath === pluginPath) {
        windowIdsToClose.push(winId);
      }
    }
    for (const winId of windowIdsToClose) {
      const windowInfo = this.windowInfoMap.get(winId);
      if (windowInfo && !windowInfo.window.isDestroyed()) {
        windowInfo.window.destroy();
      }
      this.windowInfoMap.delete(winId);
    }
    console.log(
      `[pluginWindow:destroy] 已关闭插件 ${pluginPath} 的 ${windowIdsToClose.length} 个窗口`
    );
  }
  /**
   * 检查指定插件是否有打开的窗口
   */
  hasWindowsByPlugin(pluginPath) {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (windowInfo.pluginPath === pluginPath && !windowInfo.window.isDestroyed()) {
        return true;
      }
    }
    return false;
  }
  /**
   * 检查 WebContents 是否属于 browser 窗口
   */
  isBrowserWindow(webContents) {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContents.id) {
        return true;
      }
    }
    return false;
  }
  /**
   * 关闭所有窗口
   */
  closeAll() {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close();
      }
    }
    this.windowInfoMap.clear();
  }
  /**
   * 广播消息到所有插件窗口
   */
  broadcastToAll(channel, ...args) {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.webContents.send(channel, ...args);
      }
    }
  }
}
const pluginWindowManager = new PluginWindowManager();
const DEV_PLUGIN_SUFFIX = "__dev";
function isDevelopmentPluginName(pluginName) {
  return pluginName.endsWith(DEV_PLUGIN_SUFFIX);
}
function toDevPluginName(originalName) {
  return originalName + DEV_PLUGIN_SUFFIX;
}
function getPluginDataPrefix(pluginName) {
  return `PLUGIN/${pluginName}/`;
}
function getPluginSessionPartition(pluginName) {
  return `persist:${pluginName}`;
}
function getDetachedWindowSizeKey(pluginName) {
  return pluginName;
}
class DatabaseAPI {
  pluginManager = null;
  init(pluginManager2) {
    this.pluginManager = pluginManager2;
    this.setupIPC();
  }
  /**
   * 将插件数据操作目标归一化为有效名称与前缀。
   */
  resolvePluginDataTarget(pluginName) {
    if (!pluginName) {
      return null;
    }
    if (pluginName === "ZTOOLS") {
      return { pluginName: "ZTOOLS", prefix: "ZTOOLS/", isHostData: true };
    }
    return { pluginName, prefix: getPluginDataPrefix(pluginName), isHostData: false };
  }
  /**
   * 获取插件专属前缀
   * 如果请求来自插件，返回对应 runtime namespace 的私有前缀
   * 否则返回 null（主程序使用）
   */
  getPluginPrefix(event) {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
    if (pluginInfo) {
      return getPluginDataPrefix(pluginInfo.name);
    }
    const pluginName = pluginWindowManager.getPluginNameByWebContentsId(event.sender.id);
    if (pluginName) {
      return getPluginDataPrefix(pluginName);
    }
    return null;
  }
  setupIPC() {
    electron.ipcMain.on("db:put", (event, doc) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        doc._id = prefix + doc._id;
      }
      const result = lmdbInstance.put(doc);
      if (prefix && result.id && result.id.startsWith(prefix)) {
        result.id = result.id.slice(prefix.length);
      }
      event.returnValue = result;
    });
    electron.ipcMain.on("db:get", (event, id) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      const doc = lmdbInstance.get(id);
      if (doc && prefix && doc._id.startsWith(prefix)) {
        doc._id = doc._id.slice(prefix.length);
      }
      event.returnValue = doc;
    });
    electron.ipcMain.on("db:remove", (event, docOrId) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        if (typeof docOrId === "string") {
          docOrId = prefix + docOrId;
        } else {
          docOrId._id = prefix + docOrId._id;
        }
      }
      const result = lmdbInstance.remove(docOrId);
      console.log("[Database] sync db:remove", docOrId, "result", result);
      if (prefix && result.id && result.id.startsWith(prefix)) {
        result.id = result.id.slice(prefix.length);
      }
      event.returnValue = result;
    });
    electron.ipcMain.on("db:bulk-docs", (event, docs) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        docs.forEach((doc) => {
          doc._id = prefix + doc._id;
        });
      }
      const results = lmdbInstance.bulkDocs(docs);
      if (prefix && Array.isArray(results)) {
        results.forEach((result) => {
          if (result.id && result.id.startsWith(prefix)) {
            result.id = result.id.slice(prefix.length);
          }
        });
      }
      event.returnValue = results;
    });
    electron.ipcMain.on("db:all-docs", (event, key) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        if (Array.isArray(key)) {
          key = key.map((k) => prefix + k);
        } else if (typeof key === "string") {
          key = prefix + key;
        } else {
          key = prefix;
        }
      }
      const docs = lmdbInstance.allDocs(key);
      if (prefix && Array.isArray(docs)) {
        docs.forEach((doc) => {
          if (doc._id.startsWith(prefix)) {
            doc._id = doc._id.slice(prefix.length);
          }
        });
      }
      event.returnValue = docs;
    });
    electron.ipcMain.on("db:post-attachment", (event, id, attachment, type) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      console.log("[Database] on db:post-attachment", id, attachment, type);
      const result = lmdbInstance.postAttachment(id, attachment, type);
      if (prefix && result.id && result.id.startsWith(prefix)) {
        result.id = result.id.slice(prefix.length);
      }
      event.returnValue = result;
    });
    electron.ipcMain.on("db:get-attachment", (event, id) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      const result = lmdbInstance.getAttachment(id);
      console.log("[Database] on db:get-attachment", id, "result", result);
      event.returnValue = result;
    });
    electron.ipcMain.on("db:get-attachment-type", (event, id) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      console.log("[Database] on db:get-attachment-type", id);
      event.returnValue = lmdbInstance.getAttachmentType(id);
    });
    electron.ipcMain.handle("db:put", async (event, doc) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        doc._id = prefix + doc._id;
      }
      const result = await lmdbInstance.promises.put(doc);
      if (prefix && result.id && result.id.startsWith(prefix)) {
        result.id = result.id.slice(prefix.length);
      }
      return result;
    });
    electron.ipcMain.handle("db:get", async (event, id) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      const doc = await lmdbInstance.promises.get(id);
      if (doc && prefix && doc._id.startsWith(prefix)) {
        doc._id = doc._id.slice(prefix.length);
      }
      return doc;
    });
    electron.ipcMain.handle("db:remove", async (event, docOrId) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        if (typeof docOrId === "string") {
          docOrId = prefix + docOrId;
        } else {
          docOrId._id = prefix + docOrId._id;
        }
      }
      const result = await lmdbInstance.promises.remove(docOrId);
      console.log("[Database] handle db:remove", docOrId, "result", result);
      if (prefix && result.id && result.id.startsWith(prefix)) {
        result.id = result.id.slice(prefix.length);
      }
      return result;
    });
    electron.ipcMain.handle("db:bulk-docs", async (event, docs) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        docs.forEach((doc) => {
          doc._id = prefix + doc._id;
        });
      }
      const results = await lmdbInstance.promises.bulkDocs(docs);
      if (prefix && Array.isArray(results)) {
        results.forEach((result) => {
          if (result.id && result.id.startsWith(prefix)) {
            result.id = result.id.slice(prefix.length);
          }
        });
      }
      return results;
    });
    electron.ipcMain.handle("db:all-docs", async (event, key) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        if (Array.isArray(key)) {
          key = key.map((k) => prefix + k);
        } else if (typeof key === "string") {
          key = prefix + key;
        } else {
          key = prefix;
        }
      }
      const docs = await lmdbInstance.promises.allDocs(key);
      if (prefix && Array.isArray(docs)) {
        docs.forEach((doc) => {
          if (doc._id.startsWith(prefix)) {
            doc._id = doc._id.slice(prefix.length);
          }
        });
      }
      return docs;
    });
    electron.ipcMain.handle("db:post-attachment", async (event, id, attachment, type) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      console.log("[Database] handle db:post-attachment", id, attachment, type);
      const result = await lmdbInstance.promises.postAttachment(id, attachment, type);
      if (prefix && result.id && result.id.startsWith(prefix)) {
        result.id = result.id.slice(prefix.length);
      }
      return result;
    });
    electron.ipcMain.handle("db:get-attachment", async (event, id) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      const result = await lmdbInstance.promises.getAttachment(id);
      console.log("[Database] handle db:get-attachment", id, "result", result);
      return result;
    });
    electron.ipcMain.handle("db:get-attachment-type", async (event, id) => {
      const prefix = this.getPluginPrefix(event);
      if (prefix) {
        id = prefix + id;
      }
      console.log("[Database] handle db:get-attachment-type", id);
      return await lmdbInstance.promises.getAttachmentType(id);
    });
    electron.ipcMain.on("db-storage:set-item", (event, key, value) => {
      const prefix = this.getPluginPrefix(event);
      const docId = prefix ? `${prefix}${key}` : key;
      try {
        const existing = lmdbInstance.get(docId);
        const doc = {
          _id: docId,
          value
        };
        if (existing) {
          doc._rev = existing._rev;
        }
        const result = lmdbInstance.put(doc);
        event.returnValue = result.ok ? void 0 : result;
      } catch (error) {
        console.error("[Database] dbStorage.setItem 失败:", error);
        event.returnValue = { error: error instanceof Error ? error.message : String(error) };
      }
    });
    electron.ipcMain.on("db-storage:get-item", (event, key) => {
      const prefix = this.getPluginPrefix(event);
      const docId = prefix ? `${prefix}${key}` : key;
      try {
        const doc = lmdbInstance.get(docId);
        event.returnValue = doc ? doc.value ?? doc.data : null;
      } catch (error) {
        console.error("[Database] dbStorage.getItem 失败:", error);
        event.returnValue = null;
      }
    });
    electron.ipcMain.on("db-storage:remove-item", (event, key) => {
      const prefix = this.getPluginPrefix(event);
      const docId = prefix ? `${prefix}${key}` : key;
      try {
        const result = lmdbInstance.remove(docId);
        event.returnValue = result.ok ? void 0 : result;
      } catch (error) {
        console.error("[Database] dbStorage.removeItem 失败:", error);
        event.returnValue = { error: error instanceof Error ? error.message : String(error) };
      }
    });
    electron.ipcMain.handle("ztools:db-put", (_event, key, data) => {
      return this.dbPut(key, data);
    });
    electron.ipcMain.handle("ztools:db-get", (_event, key) => {
      console.log("[Database] ztools:db-get", key);
      return this.dbGet(key);
    });
    electron.ipcMain.handle("get-plugin-data-stats", async () => {
      return await this._getPluginDataStats();
    });
    electron.ipcMain.handle("get-plugin-doc-keys", async (_event, pluginName) => {
      return await this._getPluginDocKeys(pluginName);
    });
    electron.ipcMain.handle("get-plugin-doc", async (_event, pluginName, key) => {
      return await this._getPluginDoc(pluginName, key);
    });
    electron.ipcMain.handle("clear-plugin-data", async (_event, pluginName) => {
      return await this._clearPluginData(pluginName);
    });
  }
  /**
   * 内部使用的数据库辅助方法
   * 用于主进程内部直接操作 ZTOOLS 命名空间的数据
   */
  dbPut(key, data) {
    try {
      const docId = `ZTOOLS/${key}`;
      const doc = {
        _id: docId,
        data
      };
      const existing = lmdbInstance.get(docId);
      if (existing) {
        doc._rev = existing._rev;
      }
      return lmdbInstance.put(doc);
    } catch (error) {
      console.error("[Database] dbPut 失败:", key, error);
      throw error;
    }
  }
  dbGet(key) {
    try {
      const docId = `ZTOOLS/${key}`;
      const doc = lmdbInstance.get(docId);
      if (!doc) {
        return null;
      }
      return doc.data;
    } catch (error) {
      console.error("[Database] dbGet 失败:", key, error);
      return null;
    }
  }
  /**
   * 计算字典序的下一个前缀（用于精确的范围查询）
   * 例如：prefix = "PLUGIN/test/" -> end = "PLUGIN/test0"
   */
  getNextPrefix(prefix) {
    const lastChar = prefix[prefix.length - 1];
    const nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
    return prefix.slice(0, -1) + nextChar;
  }
  /**
   * 获取所有插件的数据统计（供内部调用）
   */
  async _getPluginDataStats() {
    try {
      const allDocs = lmdbInstance.allDocs("PLUGIN/");
      const pluginStats = /* @__PURE__ */ new Map();
      for (const doc of allDocs) {
        const match = doc._id.match(/^PLUGIN\/([^/]+)\//);
        if (match) {
          const runtimeNamespace = match[1];
          const stats = pluginStats.get(runtimeNamespace) || { docCount: 0, attachmentCount: 0 };
          stats.docCount++;
          pluginStats.set(runtimeNamespace, stats);
        }
      }
      const attachmentDb = lmdbInstance.getAttachmentDb();
      const attachmentPrefix = "attachment-ext:PLUGIN/";
      for (const { key } of attachmentDb.getRange({
        start: attachmentPrefix,
        end: this.getNextPrefix(attachmentPrefix)
      })) {
        if (key.startsWith(attachmentPrefix)) {
          const match = key.match(/^attachment-ext:PLUGIN\/([^/]+)\//);
          if (match) {
            const runtimeNamespace = match[1];
            const stats = pluginStats.get(runtimeNamespace) || { docCount: 0, attachmentCount: 0 };
            stats.attachmentCount++;
            pluginStats.set(runtimeNamespace, stats);
          }
        }
      }
      const pluginsDoc = lmdbInstance.get("ZTOOLS/plugins");
      const plugins = pluginsDoc?.data || [];
      const pluginsByName = /* @__PURE__ */ new Map();
      for (const plugin of plugins) {
        if (!plugin?.name) continue;
        pluginsByName.set(plugin.name, plugin);
      }
      const data = Array.from(pluginStats.entries()).map(([pluginName, stats]) => {
        const plugin = pluginsByName.get(pluginName);
        return {
          pluginName,
          pluginTitle: plugin?.title || null,
          docCount: stats.docCount,
          attachmentCount: stats.attachmentCount,
          logo: plugin?.logo || null,
          isDevelopment: isDevelopmentPluginName(pluginName)
        };
      });
      const ztoolsDocs = lmdbInstance.allDocs("ZTOOLS/");
      const ztoolsDocCount = ztoolsDocs.length;
      let ztoolsAttachmentCount = 0;
      const ztoolsAttachmentPrefix = "attachment-ext:ZTOOLS/";
      for (const { key } of attachmentDb.getRange({
        start: ztoolsAttachmentPrefix,
        end: this.getNextPrefix(ztoolsAttachmentPrefix)
      })) {
        if (key.startsWith(ztoolsAttachmentPrefix)) {
          ztoolsAttachmentCount++;
        }
      }
      if (ztoolsDocCount > 0 || ztoolsAttachmentCount > 0) {
        data.unshift({
          pluginName: "ZTOOLS",
          pluginTitle: "主程序",
          docCount: ztoolsDocCount,
          attachmentCount: ztoolsAttachmentCount,
          logo: null,
          isDevelopment: false
        });
      }
      return { success: true, data };
    } catch (error) {
      console.error("[Database] 获取插件数据统计失败:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * 获取指定插件的所有文档 key（供内部调用）
   */
  async _getPluginDocKeys(pluginName) {
    try {
      const target = this.resolvePluginDataTarget(pluginName);
      if (!target) {
        return { success: false, error: "插件标识无效" };
      }
      const prefix = target.prefix;
      const keySet = /* @__PURE__ */ new Set();
      const keyTypeMap = /* @__PURE__ */ new Map();
      const allDocs = lmdbInstance.allDocs(prefix);
      for (const doc of allDocs) {
        const key = doc._id.substring(prefix.length);
        keySet.add(key);
        keyTypeMap.set(key, "document");
      }
      const attachmentDb = lmdbInstance.getAttachmentDb();
      const attachmentPrefix = `attachment-ext:${prefix}`;
      for (const { key } of attachmentDb.getRange({
        start: attachmentPrefix,
        end: this.getNextPrefix(attachmentPrefix)
      })) {
        if (key.startsWith(attachmentPrefix)) {
          const attachmentKey = key.substring(attachmentPrefix.length);
          keySet.add(attachmentKey);
          keyTypeMap.set(attachmentKey, "attachment");
        }
      }
      const keys = Array.from(keySet).map((key) => ({
        key,
        type: keyTypeMap.get(key) || "document"
      }));
      return { success: true, data: keys };
    } catch (error) {
      console.error("[Database] 获取插件文档 key 失败:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * 获取指定插件的文档或附件内容（供内部调用）
   */
  async _getPluginDoc(pluginName, key) {
    try {
      const target = this.resolvePluginDataTarget(pluginName);
      if (!target) {
        return { success: false, error: "插件标识无效" };
      }
      const docId = `${target.prefix}${key}`;
      const doc = lmdbInstance.get(docId);
      if (doc) {
        return { success: true, data: doc, type: "document" };
      }
      const attachmentDb = lmdbInstance.getAttachmentDb();
      const metadataStr = attachmentDb.get(`attachment-ext:${docId}`);
      if (metadataStr) {
        const metadata = JSON.parse(metadataStr);
        return {
          success: true,
          data: {
            _id: docId,
            ...metadata
          },
          type: "attachment"
        };
      }
      return { success: false, error: "文档不存在" };
    } catch (error) {
      console.error("[Database] 获取插件文档失败:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * 清空指定插件的所有数据（供内部调用）
   */
  async _clearPluginData(pluginName) {
    try {
      const target = this.resolvePluginDataTarget(pluginName);
      if (!target) {
        return { success: false, error: "插件标识无效" };
      }
      if (target.isHostData) {
        return { success: false, error: "主程序数据不支持通过该接口清空" };
      }
      const prefix = target.prefix;
      const allDocs = lmdbInstance.allDocs(prefix);
      let deletedCount = 0;
      for (const doc of allDocs) {
        const result = lmdbInstance.remove(doc._id);
        if (result.ok) {
          deletedCount++;
        }
      }
      const metaDb = lmdbInstance.getMetaDb();
      const metaKeysToDelete = [];
      for (const { key } of metaDb.getRange({
        start: prefix,
        end: this.getNextPrefix(prefix)
      })) {
        if (key.startsWith(prefix)) {
          metaKeysToDelete.push(key);
        }
      }
      for (const key of metaKeysToDelete) {
        metaDb.removeSync(key);
      }
      const attachmentDb = lmdbInstance.getAttachmentDb();
      const attachmentPrefix = `attachment:${prefix}`;
      const metadataPrefix = `attachment-ext:${prefix}`;
      const attachmentKeysToDelete = [];
      for (const { key } of attachmentDb.getRange({
        start: attachmentPrefix,
        end: this.getNextPrefix(attachmentPrefix)
      })) {
        if (key.startsWith(attachmentPrefix)) {
          attachmentKeysToDelete.push(key);
        }
      }
      const metadataKeysToDelete = [];
      for (const { key } of attachmentDb.getRange({
        start: metadataPrefix,
        end: this.getNextPrefix(metadataPrefix)
      })) {
        if (key.startsWith(metadataPrefix)) {
          metadataKeysToDelete.push(key);
        }
      }
      for (const key of attachmentKeysToDelete) {
        attachmentDb.removeSync(key);
        deletedCount++;
      }
      for (const key of metadataKeysToDelete) {
        attachmentDb.removeSync(key);
      }
      return { success: true, deletedCount };
    } catch (error) {
      console.error("[Database] 清空插件数据失败:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * 公共方法：获取所有插件的数据统计
   */
  async getPluginDataStats() {
    return await this._getPluginDataStats();
  }
  /**
   * 公共方法：获取指定插件的所有文档 key
   */
  async getPluginDocKeys(pluginName) {
    return await this._getPluginDocKeys(pluginName);
  }
  /**
   * 公共方法：获取指定插件的文档或附件内容
   */
  async getPluginDoc(pluginName, key) {
    return await this._getPluginDoc(pluginName, key);
  }
  /**
   * 公共方法：清空指定插件的所有数据
   */
  async clearPluginData(pluginName) {
    return await this._clearPluginData(pluginName);
  }
}
const databaseAPI = new DatabaseAPI();
function isWindows11() {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    const release = os.release();
    const parts = release.split(".");
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    const build = parseInt(parts[2], 10);
    return major === 10 && minor === 0 && build >= 22e3;
  } catch (error) {
    console.error("[WindowUtils] 检测 Windows 版本失败:", error);
    return false;
  }
}
function getDefaultWindowMaterial() {
  return isWindows11() ? "acrylic" : "none";
}
function applyWindowMaterial(win, material) {
  if (!win || win.isDestroyed()) return;
  const isWindows = process.platform === "win32";
  switch (material) {
    case "mica":
      try {
        if (isWindows) {
          win.setBackgroundColor("#00000000");
        }
        win.setBackgroundMaterial("mica");
      } catch (error) {
        console.error(`[WindowUtils] 窗口 ${win.id} 设置 Mica 失败:`, error);
        win.setBackgroundColor("#f4f4f4");
      }
      break;
    case "acrylic":
      try {
        if (isWindows) {
          win.setBackgroundColor("#00000000");
        }
        win.setBackgroundMaterial("acrylic");
      } catch (error) {
        console.error(`[WindowUtils] 窗口 ${win.id} 设置 Acrylic 失败:`, error);
        win.setBackgroundColor("#f4f4f4");
      }
      break;
    case "none":
    default:
      try {
        win.setBackgroundMaterial("none");
        win.setBackgroundColor("#f4f4f4");
      } catch (error) {
        console.error(`[WindowUtils] 窗口 ${win.id} 设置背景失败:`, error);
      }
      break;
  }
}
async function openDialog(parentWindow, options, errorMessage) {
  const result = await electron.dialog.showOpenDialog(parentWindow, options);
  if (!parentWindow.isDestroyed()) {
    parentWindow.show();
  }
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: errorMessage };
  }
  return { success: true, data: result };
}
function getDevToolsMode() {
  try {
    const data = databaseAPI.dbGet("settings-general");
    return data?.devToolsMode || "detach";
  } catch {
    return "detach";
  }
}
class DevToolsShortcutManager {
  currentTarget = null;
  shortcut = utils.platform.isMacOS ? "Option+Command+I" : "Ctrl+Shift+I";
  /**
   * 注册当前焦点的 DevTools 快捷键
   * @param target 需要打开开发者工具的 WebContents
   */
  register(target) {
    if (this.currentTarget?.id === target.id && electron.globalShortcut.isRegistered(this.shortcut)) {
      return;
    }
    this.unregister();
    this.currentTarget = target;
    const ret = electron.globalShortcut.register(this.shortcut, async () => {
      if (this.currentTarget && !this.currentTarget.isDestroyed()) {
        console.log(`[DevTools] 触发开发者工具快捷键，目标: ${this.currentTarget.id}`);
        if (this.currentTarget.isDevToolsOpened()) {
          this.currentTarget.closeDevTools();
        } else {
          const mode = getDevToolsMode();
          this.currentTarget.openDevTools({ mode });
        }
      }
    });
    if (!ret) {
      console.error(`[DevTools] 开发者工具快捷键注册失败: ${this.shortcut}`);
    }
  }
  /**
   * 注销快捷键
   */
  unregister() {
    if (electron.globalShortcut.isRegistered(this.shortcut)) {
      electron.globalShortcut.unregister(this.shortcut);
    }
    this.currentTarget = null;
  }
}
const devToolsShortcut = new DevToolsShortcutManager();
const __filename$1 = url.fileURLToPath(require("url").pathToFileURL(__filename).href);
const __dirname$1 = path.dirname(__filename$1);
const DETACHED_TITLEBAR_HEIGHT = 52;
const MIN_WINDOW_WIDTH = 400;
const MIN_WINDOW_HEIGHT = 300;
const MIN_VIEW_HEIGHT = MIN_WINDOW_HEIGHT - DETACHED_TITLEBAR_HEIGHT;
class DetachedWindowManager {
  detachedWindowMap = /* @__PURE__ */ new Map();
  resizeSaveTimers = /* @__PURE__ */ new Map();
  lastSavedSizeByPlugin = /* @__PURE__ */ new Map();
  /**
   * 应用窗口材质（Windows 11）
   */
  async applyWindowMaterial(win) {
    try {
      const settings = await lmdbInstance.promises.get("ZTOOLS/settings-general");
      const material = settings?.data?.windowMaterial || "none";
      console.log("[DetachedWindow] 分离窗口应用材质:", material);
      applyWindowMaterial(win, material);
    } catch (error) {
      console.error("[DetachedWindow] 读取窗口材质配置失败，使用默认值 (mica):", error);
      applyWindowMaterial(win, "none");
    }
  }
  /**
   * 将分离窗口尺寸持久化到数据库（按插件名归档）
   */
  persistWindowSize(pluginName, width, viewHeight) {
    try {
      const normalizedWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(width));
      const normalizedHeight = Math.max(MIN_VIEW_HEIGHT, Math.round(viewHeight));
      const sizeKey = getDetachedWindowSizeKey(pluginName);
      const lastSaved = this.lastSavedSizeByPlugin.get(sizeKey);
      if (lastSaved && lastSaved.width === normalizedWidth && lastSaved.height === normalizedHeight) {
        return;
      }
      const existing = databaseAPI.dbGet("detachedWindowSizes") || {};
      const next = {
        ...typeof existing === "object" && existing !== null ? existing : {},
        [sizeKey]: {
          width: normalizedWidth,
          height: normalizedHeight
        }
      };
      databaseAPI.dbPut("detachedWindowSizes", next);
      this.lastSavedSizeByPlugin.set(sizeKey, {
        width: normalizedWidth,
        height: normalizedHeight
      });
    } catch (error) {
      console.error("[DetachedWindow] 保存分离窗口尺寸失败:", error);
    }
  }
  /**
   * 防抖保存尺寸，避免频繁写入
   */
  schedulePersistWindowSize(windowId, pluginName, width, viewHeight) {
    const existingTimer = this.resizeSaveTimers.get(windowId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.persistWindowSize(pluginName, width, viewHeight);
      this.resizeSaveTimers.delete(windowId);
    }, 300);
    this.resizeSaveTimers.set(windowId, timer);
  }
  /**
   * 创建分离的插件窗口（带自定义标题栏）
   */
  createDetachedWindow(pluginPath, pluginName, pluginView, options) {
    try {
      const windowId = uuid.v4();
      const isMac = process.platform === "darwin";
      const isWindows = process.platform === "win32";
      const windowConfig = {
        width: options.width,
        height: options.height + DETACHED_TITLEBAR_HEIGHT,
        title: options.title,
        frame: false,
        // 两个平台都无边框
        titleBarStyle: isMac ? "hiddenInset" : void 0,
        // macOS 保留交通灯按钮
        ...isMac && {
          trafficLightPosition: { x: 15, y: 18 }
          // macOS 交通灯垂直居中
        },
        resizable: true,
        minWidth: WINDOW_WIDTH,
        minHeight: 52,
        hasShadow: true,
        // 启用窗口阴影（可调整为 false 来移除阴影）
        webPreferences: {
          preload: path.join(__dirname$1, "../preload/index.js"),
          backgroundThrottling: false,
          // 窗口最小化时是否继续动画和定时器
          contextIsolation: true,
          // 启用上下文隔离
          nodeIntegration: false,
          // 渲染进程禁止直接使用 Node
          spellcheck: false,
          // 禁用拼写检查
          webSecurity: false
        }
      };
      if (isMac) {
        windowConfig.transparent = true;
        windowConfig.vibrancy = "fullscreen-ui";
      } else if (isWindows) {
        windowConfig.backgroundColor = "#00000000";
        if (options.logo) {
          try {
            windowConfig.icon = options.logo.startsWith("file:") ? url.fileURLToPath(options.logo) : options.logo;
          } catch (error) {
            console.warn("[DetachedWindow] 设置窗口图标失败:", error);
          }
        }
      }
      const win = new electron.BrowserWindow(windowConfig);
      if (isWindows) {
        this.applyWindowMaterial(win);
        win.setAppDetails({
          appId: "ZTools." + pluginName
        });
      }
      const titlebarUrl = process.env.NODE_ENV === "development" ? "http://localhost:5174/detached-titlebar.html" : url.pathToFileURL(path.join(__dirname$1, "../../out/renderer/detached-titlebar.html")).href;
      win.loadURL(titlebarUrl);
      win.webContents.on("did-finish-load", () => {
        console.log("[DetachedWindow] 标题栏加载完成，发送插件信息", {
          pluginName,
          options
        });
        win.webContents.send("init-titlebar", {
          pluginName,
          pluginPath,
          pluginLogo: options.logo,
          platform: process.platform,
          title: options.title,
          // 窗口标题
          searchQuery: options.searchQuery || "",
          // 搜索框初始值
          searchPlaceholder: options.searchPlaceholder || "搜索...",
          // 搜索框占位符
          subInputVisible: options.subInputVisible !== void 0 ? options.subInputVisible : true
          // 子输入框可见性
        });
        win.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS);
        const bounds = win.getContentBounds();
        pluginView.setBounds({
          x: 0,
          y: DETACHED_TITLEBAR_HEIGHT,
          width: bounds.width,
          height: bounds.height - DETACHED_TITLEBAR_HEIGHT
        });
        win.contentView.addChildView(pluginView);
        if (options.autoFocusSubInput === true) {
          setTimeout(() => {
            win.webContents.focus();
            win.webContents.send("focus-sub-input");
          }, 100);
        } else {
          setTimeout(() => {
            if (!pluginView.webContents.isDestroyed()) {
              pluginView.webContents.focus();
            }
          }, 100);
        }
      });
      win.on("resize", () => {
        if (!win.isDestroyed()) {
          const newBounds = win.getContentBounds();
          pluginView.setBounds({
            x: 0,
            y: DETACHED_TITLEBAR_HEIGHT,
            width: newBounds.width,
            height: newBounds.height - DETACHED_TITLEBAR_HEIGHT
          });
          this.schedulePersistWindowSize(
            windowId,
            pluginName,
            newBounds.width,
            newBounds.height - DETACHED_TITLEBAR_HEIGHT
          );
        }
      });
      const windowInfo = {
        window: win,
        view: pluginView,
        pluginPath,
        pluginName,
        pluginLogo: options.logo,
        isAlwaysOnTop: false,
        lastFocusTarget: options.autoFocusSubInput ? "titlebar" : "plugin",
        savedFocusTarget: options.autoFocusSubInput ? "titlebar" : "plugin"
      };
      this.detachedWindowMap.set(windowId, windowInfo);
      win.on("closed", () => {
        this.detachedWindowMap.delete(windowId);
        const timer = this.resizeSaveTimers.get(windowId);
        if (timer) {
          clearTimeout(timer);
          this.resizeSaveTimers.delete(windowId);
        }
        pluginWindowManager.closeByPlugin(pluginPath);
        if (!pluginView.webContents.isDestroyed()) {
          pluginView.webContents.close();
        }
        console.log(`[DetachedWindow] 分离窗口已关闭: ${pluginName}`);
        this.updateDockVisibility();
      });
      this.setupTitlebarIPC(windowId);
      win.show();
      win.webContents.on("focus", () => {
        windowInfo.lastFocusTarget = "titlebar";
      });
      pluginView.webContents.on("focus", () => {
        windowInfo.lastFocusTarget = "plugin";
        if (!pluginView.webContents.isDestroyed()) {
          devToolsShortcut.register(pluginView.webContents);
        }
      });
      pluginView.webContents.on("blur", () => {
        devToolsShortcut.unregister();
      });
      registerExternalLinkInterceptor(pluginView.webContents);
      win.on("blur", () => {
        windowInfo.savedFocusTarget = windowInfo.lastFocusTarget;
      });
      win.on("focus", () => {
        if (windowInfo.savedFocusTarget === "plugin") {
          if (!pluginView.webContents.isDestroyed()) {
            pluginView.webContents.focus();
          }
        }
      });
      this.updateDockVisibility();
      console.log(`[DetachedWindow] 创建分离窗口成功: ${pluginName}`);
      return win;
    } catch (error) {
      console.error("[DetachedWindow] 创建分离窗口失败:", error);
      return null;
    }
  }
  /**
   * 设置标题栏 IPC 通信
   */
  setupTitlebarIPC(windowId) {
    const windowInfo = this.detachedWindowMap.get(windowId);
    if (!windowInfo) return;
    const { window: win, view: pluginView } = windowInfo;
    const handleTitlebarAction = (_event, action) => {
      if (_event.sender.id !== win.webContents.id) return;
      if (win.isDestroyed()) return;
      switch (action) {
        case "minimize":
          win.minimize();
          break;
        case "maximize":
          if (win.isMaximized()) {
            win.unmaximize();
          } else {
            win.maximize();
          }
          break;
        case "close":
          win.close();
          break;
        case "toggle-pin":
          windowInfo.isAlwaysOnTop = !windowInfo.isAlwaysOnTop;
          win.setAlwaysOnTop(windowInfo.isAlwaysOnTop);
          win.webContents.send("pin-state-changed", windowInfo.isAlwaysOnTop);
          break;
        case "open-devtools":
          if (!pluginView.webContents.isDestroyed()) {
            if (pluginView.webContents.isDevToolsOpened()) {
              pluginView.webContents.closeDevTools();
            } else {
              const mode = getDevToolsMode();
              if (!pluginView.webContents.isDestroyed()) {
                pluginView.webContents.openDevTools({ mode });
              }
            }
          }
          break;
      }
    };
    const handleSearchInput = (_event, value) => {
      if (_event.sender.id !== win.webContents.id) return;
      if (!pluginView.webContents.isDestroyed()) {
        pluginView.webContents.send("sub-input-change", { text: value });
      }
    };
    const handleTitlebarDblClick = (_event) => {
      if (_event.sender.id !== win.webContents.id) return;
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    };
    const handleSendArrowKey = (_event, keyEvent) => {
      if (_event.sender.id !== win.webContents.id) return;
      if (!pluginView.webContents.isDestroyed()) {
        pluginView.webContents.sendInputEvent(keyEvent);
      }
    };
    const handleShowPluginMenu = (_event, menuItems) => {
      if (_event.sender.id !== win.webContents.id) return;
      const menu = electron.Menu.buildFromTemplate(
        menuItems.map((item) => ({
          label: item.label,
          type: item.type,
          checked: item.checked,
          click: () => {
            win.webContents.send("detached-menu-result", { id: item.id });
          }
        }))
      );
      menu.popup({ window: win });
    };
    electron.ipcMain.on("titlebar-action", handleTitlebarAction);
    electron.ipcMain.on("search-input", handleSearchInput);
    if (process.platform === "darwin") {
      electron.ipcMain.on("titlebar-dblclick", handleTitlebarDblClick);
    }
    electron.ipcMain.on("send-arrow-key", handleSendArrowKey);
    electron.ipcMain.on("show-plugin-menu", handleShowPluginMenu);
    win.once("closed", () => {
      electron.ipcMain.off("titlebar-action", handleTitlebarAction);
      electron.ipcMain.off("search-input", handleSearchInput);
      electron.ipcMain.off("send-arrow-key", handleSendArrowKey);
      electron.ipcMain.off("show-plugin-menu", handleShowPluginMenu);
      if (process.platform === "darwin") {
        electron.ipcMain.off("titlebar-dblclick", handleTitlebarDblClick);
      }
    });
  }
  /**
   * 聚焦指定插件的分离窗口（单例模式使用）
   * 如果插件已有分离窗口，则聚焦该窗口并返回 true
   */
  focusByPlugin(pluginPath) {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (windowInfo.pluginPath === pluginPath && !windowInfo.window.isDestroyed()) {
        if (windowInfo.window.isMinimized()) windowInfo.window.restore();
        if (process.platform === "darwin") windowInfo.window.show();
        windowInfo.window.focus();
        return true;
      }
    }
    return false;
  }
  /**
   * 获取指定插件的分离窗口中的 WebContentsView（单例重入使用）
   */
  getViewByPlugin(pluginPath) {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (windowInfo.pluginPath === pluginPath && !windowInfo.window.isDestroyed()) {
        return windowInfo.view;
      }
    }
    return null;
  }
  /**
   * 关闭指定插件的所有分离窗口
   */
  closeByPlugin(pluginPath) {
    const windowIdsToClose = [];
    for (const [windowId, windowInfo] of this.detachedWindowMap.entries()) {
      if (windowInfo.pluginPath === pluginPath) {
        windowIdsToClose.push(windowId);
      }
    }
    for (const windowId of windowIdsToClose) {
      const windowInfo = this.detachedWindowMap.get(windowId);
      if (windowInfo && !windowInfo.window.isDestroyed()) {
        windowInfo.window.destroy();
      }
      this.detachedWindowMap.delete(windowId);
    }
    console.log(
      `[DetachedWindow] 已关闭插件 ${pluginPath} 的 ${windowIdsToClose.length} 个分离窗口`
    );
  }
  /**
   * 关闭所有分离窗口
   */
  closeAll() {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close();
      }
    }
    this.detachedWindowMap.clear();
    this.updateDockVisibility();
  }
  /**
   * 获取所有分离窗口
   */
  getAllWindows() {
    return Array.from(this.detachedWindowMap.values());
  }
  /**
   * 检查是否有分离窗口
   */
  hasDetachedWindows() {
    return this.detachedWindowMap.size > 0;
  }
  /**
   * 根据插件 webContents ID 查找对应的分离窗口
   */
  getWindowByPluginWebContents(webContentsId) {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (windowInfo.view.webContents.id === webContentsId) {
        return windowInfo.window;
      }
    }
    return null;
  }
  /**
   * 更新 macOS Dock 图标显示状态
   * 如果有分离窗口，显示 Dock 图标；否则隐藏
   */
  updateDockVisibility() {
    if (process.platform === "darwin") {
      if (this.hasDetachedWindows()) {
        electron.app.dock?.show();
      } else {
        electron.app.dock?.hide();
      }
    }
  }
  /**
   * 更新所有分离窗口的材质
   */
  updateAllWindowsMaterial(material) {
    for (const [windowId, info] of this.detachedWindowMap.entries()) {
      try {
        applyWindowMaterial(info.window, material);
        console.log(`[DetachedWindow] 分离窗口 ${windowId} 材质已更新为 ${material}`);
        info.window.webContents.send("update-window-material", material);
      } catch (error) {
        console.error(`[DetachedWindow] 更新分离窗口 ${windowId} 材质失败:`, error);
      }
    }
  }
  /**
   * 设置分离窗口中插件视图的高度
   */
  setExpendHeight(webContentsId, height) {
    for (const info of this.detachedWindowMap.values()) {
      if (info.view.webContents.id === webContentsId) {
        if (info.window.isDestroyed()) return;
        const bounds = info.window.getContentBounds();
        const newWindowHeight = height + DETACHED_TITLEBAR_HEIGHT;
        info.window.setContentSize(bounds.width, newWindowHeight);
        info.view.setBounds({
          x: 0,
          y: DETACHED_TITLEBAR_HEIGHT,
          width: bounds.width,
          height
        });
        console.log("[DetachedWindow] 设置分离窗口插件高度:", height);
        return;
      }
    }
  }
  /**
   * 检查 WebContents 是否属于分离窗口
   */
  isDetachedWindow(webContents) {
    for (const info of Array.from(this.detachedWindowMap.values())) {
      if (!info.window.isDestroyed() && info.window.webContents.id === webContents.id) {
        return true;
      }
      if (!info.view.webContents.isDestroyed() && info.view.webContents.id === webContents.id) {
        return true;
      }
    }
    return false;
  }
  /**
   * 广播消息到所有分离窗口
   */
  broadcastToAllWindows(channel, ...args) {
    for (const [windowId, info] of this.detachedWindowMap.entries()) {
      try {
        if (!info.window.isDestroyed()) {
          info.window.webContents.send(channel, ...args);
        }
        if (!info.view.webContents.isDestroyed()) {
          info.view.webContents.send(channel, ...args);
        }
      } catch (error) {
        console.error(`[DetachedWindow] 广播消息到分离窗口 ${windowId} 失败:`, error);
      }
    }
  }
}
const detachedWindowManager = new DetachedWindowManager();
const BUNDLED_INTERNAL_PLUGIN_NAMES = ["setting", "system"];
const INTERNAL_API_PLUGIN_NAMES = [
  ...BUNDLED_INTERNAL_PLUGIN_NAMES,
  "ztools-developer-plugin__dev",
  "ztools-developer-plugin"
];
const CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY = "customInternalApiPluginNames";
function normalizeCustomInternalApiPluginNames(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value.map((name) => typeof name === "string" ? name.trim() : "").filter((name) => name.length > 0)
    )
  );
}
function isBundledInternalPlugin(pluginName) {
  return BUNDLED_INTERNAL_PLUGIN_NAMES.includes(pluginName);
}
function canPluginUseInternalApi(pluginName, customPluginNames = []) {
  if (INTERNAL_API_PLUGIN_NAMES.includes(pluginName)) {
    return true;
  }
  return customPluginNames.includes(pluginName);
}
function getInternalPluginPath(pluginName) {
  const isDev = !electron.app.isPackaged;
  if (isDev) {
    return path.resolve(process.cwd(), "internal-plugins", pluginName);
  } else {
    return path.join(process.resourcesPath, "app.asar.unpacked", "internal-plugins", pluginName);
  }
}
const internalPlugins = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BUNDLED_INTERNAL_PLUGIN_NAMES,
  CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY,
  INTERNAL_API_PLUGIN_NAMES,
  canPluginUseInternalApi,
  getInternalPluginPath,
  isBundledInternalPlugin,
  normalizeCustomInternalApiPluginNames
}, Symbol.toStringTag, { value: "Module" }));
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
  ".wasm": "application/wasm"
};
let serverPort = 0;
let server = null;
async function startInternalPluginServer() {
  if (!electron.app.isPackaged) return 0;
  const basePath = path.join(process.resourcesPath, "app.asar.unpacked", "internal-plugins");
  if (!fs.existsSync(basePath)) {
    console.warn("[InternalPluginServer] 内置插件目录不存在:", basePath);
    return 0;
  }
  server = http.createServer((req, res) => {
    if (!req.url || req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.resolve(path.join(basePath, urlPath));
    if (!filePath.startsWith(basePath)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        serverPort = addr.port;
        console.log(`[InternalPluginServer] 已启动: http://127.0.0.1:${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error("无法获取 server 地址"));
      }
    });
    server.on("error", (err) => {
      console.error("[InternalPluginServer] 启动失败:", err);
      reject(err);
    });
  });
}
function getInternalPluginUrl(pluginName, mainFile) {
  if (serverPort === 0) return "";
  return `http://127.0.0.1:${serverPort}/${pluginName}/${mainFile}`;
}
function getInternalPluginServerPort() {
  return serverPort;
}
const iconMemoryCache = /* @__PURE__ */ new Map();
const MAX_ICON_CACHE = 128;
function setIconCache(key, buffer) {
  if (iconMemoryCache.has(key)) {
    iconMemoryCache.delete(key);
  } else if (iconMemoryCache.size >= MAX_ICON_CACHE) {
    const oldest = iconMemoryCache.keys().next().value;
    if (oldest !== void 0) {
      iconMemoryCache.delete(oldest);
    }
  }
  iconMemoryCache.set(key, buffer);
}
async function extractIcon(iconPath) {
  const iconBuffer = await IconExtractor.getFileIcon(iconPath);
  if (!iconBuffer) {
    throw new Error("Failed to extract icon");
  }
  return iconBuffer;
}
let extractionQueue = Promise.resolve();
function extractIconQueued(iconPath) {
  const task = extractionQueue.then(() => extractIcon(iconPath));
  extractionQueue = task.then(
    () => void 0,
    () => void 0
  );
  return task;
}
function createIconResponse(buffer) {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": buffer.length.toString(),
      "access-control-allow-origin": "*"
    }
  });
}
function registerIconScheme() {
  electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: "ztools-icon",
      privileges: {
        bypassCSP: true,
        secure: true,
        standard: false,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: false
      }
    }
  ]);
}
async function getFileIconAsBase64(filePath) {
  const cached = iconMemoryCache.get(filePath);
  if (cached) {
    setIconCache(filePath, cached);
    return `data:image/png;base64,${cached.toString("base64")}`;
  }
  const buffer = await extractIconQueued(filePath);
  setIconCache(filePath, buffer);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
function registerIconProtocolForSession(targetSession) {
  if (targetSession.protocol.isProtocolHandled("ztools-icon")) {
    return;
  }
  targetSession.protocol.handle("ztools-icon", async (request) => {
    try {
      const urlPath = request.url.replace("ztools-icon://", "");
      const iconPath = decodeURIComponent(urlPath);
      const cached = iconMemoryCache.get(iconPath);
      if (cached) {
        setIconCache(iconPath, cached);
        return createIconResponse(cached);
      }
      const buffer = await extractIconQueued(iconPath);
      setIconCache(iconPath, buffer);
      return createIconResponse(buffer);
    } catch (error) {
      console.error("[Main] 图标提取失败:", error);
      return new Response("Icon Error", { status: 404 });
    }
  });
}
class PluginAssemblyCoordinator {
  // 当前有效装配会话
  currentSession = null;
  // 按 webContents 维度串行化生命周期事件，避免交错
  lifecycleChains = /* @__PURE__ */ new Map();
  // 已触发 dom-ready 的视图集合
  domReadyViews = /* @__PURE__ */ new Set();
  /**
   * 统一装配链路日志
   */
  trace(stage, info) {
    console.log("[插件][装配][追踪]", {
      stage,
      ...info
    });
  }
  /**
   * 生成新的装配会话 ID
   */
  newAssemblyId() {
    return `asm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  /**
   * 开始新装配会话，并中断旧会话
   */
  beginAssembly(pluginPath, featureCode) {
    const old = this.currentSession;
    if (old) {
      old.status = "aborted";
      this.trace("abort-previous", {
        assemblyId: old.id,
        pluginPath: old.pluginPath,
        featureCode: old.featureCode,
        previousStatus: old.status
      });
    }
    const session = {
      id: this.newAssemblyId(),
      pluginPath,
      featureCode,
      status: "assembling",
      createdAt: Date.now()
    };
    this.currentSession = session;
    this.trace("begin", {
      assemblyId: session.id,
      pluginPath,
      featureCode,
      createdAt: session.createdAt
    });
    return session;
  }
  /**
   * 是否存在当前装配会话
   */
  hasCurrentSession() {
    return !!this.currentSession;
  }
  /**
   * 获取当前会话（可能为空）
   */
  getCurrentSession() {
    return this.currentSession;
  }
  /**
   * 判断回调是否仍属于当前活动会话
   */
  isActiveSession(session) {
    return !!this.currentSession && this.currentSession.id === session.id && this.currentSession.status !== "aborted";
  }
  /**
   * 更新当前会话状态
   */
  markSessionStatus(session, status) {
    if (!this.isActiveSession(session)) return;
    const previousStatus = this.currentSession.status;
    this.currentSession.status = status;
    this.trace("status-change", {
      assemblyId: session.id,
      pluginPath: session.pluginPath,
      featureCode: session.featureCode,
      from: previousStatus,
      to: status
    });
  }
  /**
   * 仅标记当前会话为 aborted（不清空引用）
   */
  abortCurrentSession(stage = "abort-current-session") {
    if (!this.currentSession) return;
    this.currentSession.status = "aborted";
    this.trace(stage, {
      assemblyId: this.currentSession.id,
      pluginPath: this.currentSession.pluginPath,
      featureCode: this.currentSession.featureCode
    });
  }
  /**
   * 清空当前会话引用
   */
  clearCurrentSession() {
    this.currentSession = null;
  }
  /**
   * 生成用于渲染回执比对的 token
   */
  getSessionToken(session) {
    return `${session.pluginPath}::${session.featureCode}::${session.id}`;
  }
  /**
   * 构建带装配元信息的 PluginEnter 参数
   */
  buildEnterPayload(action, session) {
    const payload = {
      ...action,
      __assemblyId: session?.id,
      __ts: Date.now()
    };
    this.trace("build-enter-payload", {
      assemblyId: session?.id,
      enterTs: payload.__ts
    });
    return payload;
  }
  /**
   * 向主渲染请求 ack，确认当前装配请求仍有效
   */
  async requestRendererAck(mainWindow, session) {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) {
      this.trace("ack-skip-main-window-unavailable", {
        assemblyId: session.id,
        pluginPath: session.pluginPath,
        featureCode: session.featureCode
      });
      return false;
    }
    const token = this.getSessionToken(session);
    const startAt = Date.now();
    this.trace("ack-request-start", {
      assemblyId: session.id,
      pluginPath: session.pluginPath,
      featureCode: session.featureCode,
      token
    });
    try {
      await mainWindow.webContents.executeJavaScript(
        `window.ztools?.setAssemblyTarget?.(${JSON.stringify(token)})`
      );
      const returned = await mainWindow.webContents.executeJavaScript(
        `window.ztools?.endAssemblyPlugin?.()`
      );
      const ok = returned === token;
      this.trace("ack-request-finish", {
        assemblyId: session.id,
        pluginPath: session.pluginPath,
        featureCode: session.featureCode,
        token,
        returned,
        ok,
        durationMs: Date.now() - startAt
      });
      if (!ok) {
        console.warn("[插件][装配] 回执 token 不匹配:", {
          assemblyId: session.id,
          expected: token,
          returned
        });
      }
      return ok;
    } catch (error) {
      console.error("[插件][装配] 请求回执失败:", error);
      return false;
    }
  }
  /**
   * 串行派发生命周期事件，防止 PluginOut/PluginEnter 交错
   */
  async dispatchLifecycleEvent(view, eventName, payload) {
    const webContents = view?.webContents;
    if (!webContents || webContents.isDestroyed()) {
      console.warn("[插件][生命周期] 跳过派发：视图不可用或已销毁", { eventName });
      return;
    }
    const id = webContents.id;
    const prev = this.lifecycleChains.get(id) ?? Promise.resolve();
    const hasQueued = this.lifecycleChains.has(id);
    console.log("[插件][生命周期] 事件入队", {
      webContentsId: id,
      eventName,
      hasQueued
    });
    const next = prev.catch(() => {
    }).then(() => {
      if (webContents.isDestroyed()) return;
      console.log("[插件][生命周期] 派发事件", { webContentsId: id, eventName });
      if (eventName === "PluginEnter") {
        webContents.send("on-plugin-enter", payload);
        return;
      }
      if (eventName === "PluginOut") {
        webContents.send("plugin-out", !!payload);
        return;
      }
      if (eventName === "PluginDetach") {
        webContents.send("plugin-detach");
        return;
      }
      webContents.send("plugin-ready", payload);
    });
    this.lifecycleChains.set(id, next);
    try {
      await next;
      console.log("[插件][生命周期] 事件完成", { webContentsId: id, eventName });
    } finally {
      if (this.lifecycleChains.get(id) === next) {
        this.lifecycleChains.delete(id);
        console.log("[插件][生命周期] 队列清空", { webContentsId: id, eventName });
      }
    }
  }
  /**
   * 标记视图已完成 dom-ready
   */
  markDomReady(webContentsId) {
    this.domReadyViews.add(webContentsId);
  }
  /**
   * 清理视图 dom-ready 标记
   */
  clearDomReady(webContentsId) {
    this.domReadyViews.delete(webContentsId);
  }
  /**
   * 等待视图进入 dom-ready（含已就绪命中与超时兜底）
   */
  async waitForDomReady(view, timeoutMs = 5e3) {
    const webContents = view.webContents;
    if (webContents.isDestroyed()) {
      console.warn("[插件][DomReady] 跳过等待：webContents 已销毁");
      return;
    }
    if (this.domReadyViews.has(webContents.id)) {
      console.log("[插件][DomReady] 命中已就绪缓存", {
        webContentsId: webContents.id
      });
      return;
    }
    console.log("[插件][DomReady] 开始等待", {
      webContentsId: webContents.id,
      timeoutMs
    });
    await new Promise((resolve) => {
      let done = false;
      const startedAt = Date.now();
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        console.log("[插件][DomReady] 等待结束", {
          webContentsId: webContents.id,
          durationMs: Date.now() - startedAt
        });
        resolve();
      };
      const timeout = setTimeout(() => {
        console.warn("[插件][DomReady] 触发超时兜底", {
          webContentsId: webContents.id,
          timeoutMs
        });
        finish();
      }, timeoutMs);
      webContents.once("dom-ready", () => {
        this.markDomReady(webContents.id);
        console.log("[插件][DomReady] 收到 dom-ready 事件", { webContentsId: webContents.id });
        finish();
      });
    });
  }
}
const trayIcon = path.join(__dirname, "../../resources/icons/trayTemplate@2x.png");
const windowsIcon = path.join(__dirname, "../../resources/icons/windows-icon.png");
class GlobalInputManager {
  // uIOhook 是进程级单例。用 consumer 引用计数管理 start/stop，避免一个模块 stop 掉其他模块的监听。
  consumers = /* @__PURE__ */ new Set();
  // listener 按 consumer 归属记录，release 时只 off 当前模块注册的事件。
  listenersByConsumer = /* @__PURE__ */ new Map();
  started = false;
  on(consumer, event, listener) {
    const eventListener = listener;
    uiohookNapi.uIOhook.on(event, eventListener);
    const listeners = this.listenersByConsumer.get(consumer) ?? [];
    listeners.push({ event, listener: eventListener });
    this.listenersByConsumer.set(consumer, listeners);
  }
  acquire(consumer) {
    this.consumers.add(consumer);
    if (this.started) return true;
    try {
      uiohookNapi.uIOhook.start();
      this.started = true;
      console.log("[GlobalInput] 全局输入监听已启动");
      return true;
    } catch (error) {
      this.consumers.delete(consumer);
      console.error("[GlobalInput] 启动全局输入监听失败:", error);
      return false;
    }
  }
  release(consumer) {
    const listeners = this.listenersByConsumer.get(consumer) ?? [];
    for (const { event, listener } of listeners) {
      uiohookNapi.uIOhook.off(event, listener);
    }
    this.listenersByConsumer.delete(consumer);
    this.consumers.delete(consumer);
    if (!this.started || this.consumers.size > 0) return;
    try {
      uiohookNapi.uIOhook.stop();
      console.log("[GlobalInput] 全局输入监听已停止");
    } catch (error) {
      console.error("[GlobalInput] 停止全局输入监听失败:", error);
    } finally {
      this.started = false;
    }
  }
}
const globalInputManager = new GlobalInputManager();
const INPUT_CONSUMER = "double-tap";
const MODIFIER_KEYCODES = {
  [uiohookNapi.UiohookKey.Meta]: "Command",
  [uiohookNapi.UiohookKey.MetaRight]: "Command",
  [uiohookNapi.UiohookKey.Ctrl]: "Ctrl",
  [uiohookNapi.UiohookKey.CtrlRight]: "Ctrl",
  [uiohookNapi.UiohookKey.Alt]: "Alt",
  [uiohookNapi.UiohookKey.AltRight]: "Alt",
  [uiohookNapi.UiohookKey.Shift]: "Shift",
  [uiohookNapi.UiohookKey.ShiftRight]: "Shift"
};
function normalizeModifier(modifier) {
  return modifier === "Option" ? "Alt" : modifier;
}
class DoubleTapManager {
  handlers = [];
  lastModifierUp = null;
  nonModifierPressed = false;
  started = false;
  listenersRegistered = false;
  pressedKeycodes = /* @__PURE__ */ new Set();
  allKeysReleasedWaiters = /* @__PURE__ */ new Set();
  keepAliveCount = 0;
  // 双击最大间隔（毫秒）
  DOUBLE_TAP_INTERVAL = 400;
  // 单次按键最大持续时间（超过则视为长按，非 tap）
  MAX_TAP_DURATION = 300;
  modifierDownTime = 0;
  /**
   * 注册双击修饰键回调
   * @param modifier 修饰键名称（如 "Command"、"Ctrl"）
   * @param callback 双击时触发的回调
   */
  register(modifier, callback) {
    this.handlers.push({ modifier: normalizeModifier(modifier), callback });
    this.ensureStarted();
  }
  /**
   * 注销指定修饰键的所有回调
   */
  unregister(modifier) {
    const normalized = normalizeModifier(modifier);
    this.handlers = this.handlers.filter((h) => h.modifier !== normalized);
    this.maybeStop();
  }
  /**
   * 注销所有回调并停止监听
   */
  unregisterAll() {
    this.handlers = [];
    this.maybeStop();
  }
  /**
   * 临时保持全局键盘监听开启。
   * 用于需要感知按键释放时机但并未注册双击回调的场景。
   */
  acquireKeyboardState() {
    this.keepAliveCount += 1;
    this.ensureStarted();
    return () => {
      this.keepAliveCount = Math.max(0, this.keepAliveCount - 1);
      this.maybeStop();
    };
  }
  /**
   * 等待当前所有按下的按键全部释放。
   * 若系统丢失了 keyup 事件，会在超时后继续，避免调用方永久挂起。
   */
  waitForAllKeysReleased(timeoutMs = 1e3) {
    if (this.pressedKeycodes.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let timer = setTimeout(() => {
        this.allKeysReleasedWaiters.delete(wrappedResolve);
        resolve();
      }, timeoutMs);
      const wrappedResolve = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve();
      };
      this.allKeysReleasedWaiters.add(wrappedResolve);
    });
  }
  ensureStarted() {
    if (this.started) return;
    this.started = true;
    if (!this.listenersRegistered) {
      this.listenersRegistered = true;
      globalInputManager.on(INPUT_CONSUMER, "keydown", (e) => this.handleKeyDown(e));
      globalInputManager.on(INPUT_CONSUMER, "keyup", (e) => this.handleKeyUp(e));
    }
    if (globalInputManager.acquire(INPUT_CONSUMER)) {
      console.log("[DoubleTapManager] 全局键盘监听已启动");
    } else {
      this.started = false;
    }
  }
  stop() {
    if (!this.started) return;
    globalInputManager.release(INPUT_CONSUMER);
    console.log("[DoubleTapManager] 全局键盘监听已停止");
    this.started = false;
    this.listenersRegistered = false;
    this.lastModifierUp = null;
    this.nonModifierPressed = false;
    this.modifierDownTime = 0;
    this.pressedKeycodes.clear();
    this.resolveAllKeysReleasedWaiters();
  }
  maybeStop() {
    if (this.handlers.length === 0 && this.keepAliveCount === 0) {
      this.stop();
    }
  }
  handleKeyDown(e) {
    if (!this.started) return;
    this.pressedKeycodes.add(e.keycode);
    const modifier = MODIFIER_KEYCODES[e.keycode];
    if (modifier) {
      if (this.modifierDownTime === 0) {
        this.modifierDownTime = Date.now();
      }
    } else {
      this.nonModifierPressed = true;
      this.lastModifierUp = null;
    }
  }
  handleKeyUp(e) {
    if (!this.started) return;
    this.pressedKeycodes.delete(e.keycode);
    if (this.pressedKeycodes.size === 0) {
      this.resolveAllKeysReleasedWaiters();
    }
    const modifier = MODIFIER_KEYCODES[e.keycode];
    if (!modifier) {
      this.nonModifierPressed = false;
      this.modifierDownTime = 0;
      return;
    }
    const now = Date.now();
    if (this.modifierDownTime > 0 && now - this.modifierDownTime > this.MAX_TAP_DURATION) {
      this.modifierDownTime = 0;
      this.lastModifierUp = null;
      return;
    }
    this.modifierDownTime = 0;
    if (this.nonModifierPressed) {
      this.nonModifierPressed = false;
      this.lastModifierUp = null;
      return;
    }
    if (this.lastModifierUp && this.lastModifierUp.modifier === modifier && now - this.lastModifierUp.time < this.DOUBLE_TAP_INTERVAL) {
      this.lastModifierUp = null;
      this.fireHandlers(modifier);
      return;
    }
    this.lastModifierUp = { modifier, time: now };
  }
  resolveAllKeysReleasedWaiters() {
    if (this.allKeysReleasedWaiters.size === 0) {
      return;
    }
    for (const resolve of this.allKeysReleasedWaiters) {
      resolve();
    }
    this.allKeysReleasedWaiters.clear();
  }
  fireHandlers(modifier) {
    for (const handler of this.handlers) {
      if (handler.modifier === modifier) {
        setTimeout(() => {
          if (!this.started) return;
          try {
            handler.callback();
          } catch (error) {
            console.error(`[DoubleTapManager] 回调执行失败 (${modifier}):`, error);
          }
        }, 0);
      }
    }
  }
}
const doubleTapManager = new DoubleTapManager();
async function launchApp$3(appPath, confirmDialog) {
  if (confirmDialog) {
    const result = await electron.dialog.showMessageBox({
      type: confirmDialog.type,
      buttons: confirmDialog.buttons,
      defaultId: confirmDialog.defaultId ?? 0,
      cancelId: confirmDialog.cancelId ?? 0,
      title: confirmDialog.title,
      message: confirmDialog.message,
      detail: confirmDialog.detail,
      noLink: true
    });
    if (result.response === confirmDialog.cancelId) {
      console.log("[Launcher] 用户取消了操作");
      return;
    }
  }
  return new Promise((resolve, reject) => {
    child_process.exec(`open "${appPath}"`, (error) => {
      if (error) {
        console.error("[Launcher] 启动应用失败:", error);
        reject(error);
      } else {
        console.log(`[Launcher] 成功启动应用: ${appPath}`);
        resolve();
      }
    });
  });
}
function execCommand(command, args = []) {
  let subprocess;
  if (args.length > 0) {
    subprocess = child_process.spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
  } else {
    subprocess = child_process.spawn("cmd.exe", ["/c", command], {
      detached: true,
      stdio: "ignore",
      shell: false
    });
  }
  subprocess.on("error", (err) => {
    console.error(`[Launcher] 执行命令失败 [${command}]:`, err);
  });
  subprocess.unref();
}
async function launchApp$2(appPath, confirmDialog) {
  if (confirmDialog) {
    const result = await electron.dialog.showMessageBox({
      type: confirmDialog.type,
      buttons: confirmDialog.buttons,
      defaultId: confirmDialog.defaultId ?? 0,
      cancelId: confirmDialog.cancelId ?? 0,
      title: confirmDialog.title,
      message: confirmDialog.message,
      detail: confirmDialog.detail,
      noLink: true
    });
    if (result.response === confirmDialog.cancelId) {
      console.log("[Launcher] 用户取消了操作");
      return;
    }
  }
  if (appPath.startsWith("uwp:")) {
    const appId = appPath.slice(4);
    try {
      UwpManager.launchUwpApp(appId);
      console.log(`[Launcher] 成功启动 UWP 应用: ${appId}`);
      return;
    } catch (error) {
      console.error("[Launcher] 启动 UWP 应用失败:", error);
      throw error;
    }
  }
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(appPath) && !appPath.includes("\\")) {
    try {
      await electron.shell.openExternal(appPath);
      console.log(`[Launcher] 成功打开协议链接: ${appPath}`);
      return;
    } catch (error) {
      console.error("[Launcher] 打开协议链接失败:", error);
      throw error;
    }
  }
  if (appPath.startsWith("PowerShell.exe ") || appPath.startsWith("powershell.exe ")) {
    try {
      const subprocess = child_process.spawn(appPath, [], {
        detached: true,
        stdio: "ignore",
        shell: true
      });
      subprocess.unref();
      console.log(`[Launcher] 成功执行 PowerShell 命令: ${appPath}`);
      return;
    } catch (error) {
      console.error("[Launcher] 执行 PowerShell 命令失败:", error);
      throw error;
    }
  }
  if (appPath.startsWith("rundll32 ") || appPath.startsWith("control.exe ") || appPath.startsWith("msdt.exe ")) {
    try {
      execCommand(appPath);
      console.log(`[Launcher] 成功执行系统命令: ${appPath}`);
      return;
    } catch (error) {
      console.error("[Launcher] 执行系统命令失败:", error);
      throw error;
    }
  }
  const ext = appPath.toLowerCase().split(".").pop();
  if (ext === "cpl") {
    try {
      execCommand("control.exe", [appPath]);
      console.log(`[Launcher] 成功打开控制面板项: ${appPath}`);
      return;
    } catch (error) {
      console.error("[Launcher] 打开控制面板项失败:", error);
      throw error;
    }
  }
  if (ext === "msc") {
    try {
      execCommand(`mmc.exe ${appPath}`);
      console.log(`[Launcher] 成功打开管理工具: ${appPath}`);
      return;
    } catch (error) {
      console.error("[Launcher] 打开管理工具失败:", error);
      throw error;
    }
  }
  if (ext === "exe" && !appPath.includes("\\")) {
    const error = await electron.shell.openPath(appPath);
    if (error) {
      throw new Error(`启动系统命令失败: ${error}`);
    }
    console.log(`[Launcher] 成功启动系统命令: ${appPath}`);
    return;
  }
  return new Promise((resolve, reject) => {
    electron.shell.openPath(appPath).then((error) => {
      if (error) {
        console.error("[Launcher] shell.openPath 失败:", error);
        if (appPath.toLowerCase().endsWith(".lnk")) {
          reject(new Error(`快捷方式启动失败: ${error}`));
          return;
        }
        if (appPath.toLowerCase().endsWith(".exe")) {
          console.log("[Launcher] 尝试使用 openExternal 启动...");
          electron.shell.openExternal(appPath).then(() => {
            console.log(`[Launcher] 成功启动应用（openExternal）: ${appPath}`);
            resolve();
          }).catch((extError) => {
            console.error("[Launcher] openExternal 启动也失败:", extError);
            reject(new Error(`启动失败: ${error}`));
          });
        } else {
          reject(new Error(`启动失败: ${error}`));
        }
      } else {
        console.log(`[Launcher] 成功启动应用: ${appPath}`);
        resolve();
      }
    }).catch((error) => {
      console.error("[Launcher] 启动应用失败:", error);
      reject(error);
    });
  });
}
function parseCommandString(cmd) {
  const parts = [];
  let current = "";
  let inQuote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return [parts[0], parts.slice(1)];
}
async function launchApp$1(appPath, confirmDialog) {
  if (confirmDialog) {
    const result = await electron.dialog.showMessageBox({
      type: confirmDialog.type,
      buttons: confirmDialog.buttons,
      defaultId: confirmDialog.defaultId ?? 0,
      cancelId: confirmDialog.cancelId ?? 0,
      title: confirmDialog.title,
      message: confirmDialog.message,
      detail: confirmDialog.detail,
      noLink: true
    });
    if (result.response === confirmDialog.cancelId) {
      console.log("[Launcher] 用户取消了操作");
      return;
    }
  }
  const [executable, args] = parseCommandString(appPath);
  try {
    const isAlreadyRunning = await new Promise((resolve) => {
      child_process.exec("wmctrl -lp", (err, stdout) => {
        if (err || !stdout) return resolve(false);
        const lines = stdout.split("\n");
        for (const line of lines) {
          const parts = line.split(/\s+/).filter(Boolean);
          if (parts.length >= 3) {
            const wid = parts[0];
            const pid = parts[2];
            try {
              const exePath = fs.readlinkSync(`/proc/${pid}/exe`);
              if (exePath === fs.realpathSync(executable)) {
                console.log(`[Launcher] 发现应用已运行 (PID: ${pid}), 尝试通过 WID ${wid} 激活窗口`);
                WindowManager$1.activateWindow(wid);
                return resolve(true);
              }
            } catch (e) {
            }
          }
        }
        resolve(false);
      });
    });
    if (isAlreadyRunning) {
      console.log("[Launcher] 应用已通过窗口激活方式打开");
      return;
    }
  } catch (error) {
    console.warn("[Launcher] 尝试激活窗口时发生错误:", error);
  }
  return new Promise((resolve, reject) => {
    try {
      const child = child_process.spawn(executable, args, {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      child.on("error", (err) => {
        console.error("[Launcher] 启动应用失败:", err);
        reject(err);
      });
      console.log(`[Launcher] 已尝试启动应用: ${appPath}`);
      resolve();
    } catch (error) {
      console.error("[Launcher] 启动应用异常:", error);
      reject(error);
    }
  });
}
async function launchApp(appPath, confirmDialog) {
  const platform2 = process.platform;
  if (platform2 === "darwin") {
    return launchApp$3(appPath, confirmDialog);
  } else if (platform2 === "win32") {
    return launchApp$2(appPath, confirmDialog);
  } else if (platform2 === "linux") {
    return launchApp$1(appPath, confirmDialog);
  } else {
    console.warn(`[Launcher] 不支持的平台: ${platform2}`);
    throw new Error(`Unsupported platform: ${platform2}`);
  }
}
function normalizeIconPath(iconPath, basePath) {
  if (iconPath.startsWith("data:")) {
    return iconPath;
  }
  if (iconPath.startsWith("http://") || iconPath.startsWith("https://")) {
    return iconPath;
  }
  if (iconPath.startsWith("file:///")) {
    return iconPath;
  }
  const absolutePath = path.join(basePath, iconPath);
  return url.pathToFileURL(absolutePath).href;
}
function httpRequest(url2, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      method = "GET",
      headers = {},
      body,
      validateStatus = (status) => status >= 200 && status < 300
    } = options;
    const defaultHeaders = {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      ...headers
      // 用户自定义的 headers 会覆盖默认值
    };
    const finalUrl = url2;
    const makeRequest = (requestUrl) => {
      const request = electron.net.request({
        method,
        url: requestUrl,
        redirect: "follow",
        // 自动跟随重定向（manual 模式在某些 Electron 版本会导致 Redirect was cancelled 错误）
        session: electron.session.defaultSession
        // 显式指定使用 defaultSession（确保代理配置生效）
      });
      Object.entries(defaultHeaders).forEach(([key, value]) => {
        request.setHeader(key, value);
      });
      request.on("response", (response) => {
        const chunks = [];
        const responseHeaders = {};
        Object.entries(response.headers).forEach(([key, value]) => {
          responseHeaders[key] = value;
        });
        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          let data;
          const contentType = response.headers["content-type"];
          const contentTypeStr = Array.isArray(contentType) ? contentType[0] : contentType;
          if (contentTypeStr?.includes("application/json")) {
            try {
              data = JSON.parse(buffer.toString("utf-8"));
            } catch {
              data = buffer.toString("utf-8");
            }
          } else {
            data = buffer.toString("utf-8");
          }
          const httpResponse = {
            data,
            status: response.statusCode || 0,
            statusMessage: response.statusMessage || "",
            headers: responseHeaders,
            request: {
              res: {
                responseUrl: finalUrl
              }
            }
          };
          if (validateStatus(httpResponse.status)) {
            resolve(httpResponse);
          } else {
            reject(
              new Error(
                `Request failed with status code ${httpResponse.status}: ${httpResponse.statusMessage}`
              )
            );
          }
        });
        response.on("error", (error) => {
          reject(error);
        });
      });
      request.on("error", (error) => {
        reject(error);
      });
      if (body) {
        if (body instanceof URLSearchParams) {
          request.write(body.toString());
        } else {
          request.write(body);
        }
      }
      request.end();
    };
    makeRequest(url2);
  });
}
function httpGet(url2, options = {}) {
  return httpRequest(url2, { ...options, method: "GET" });
}
class PluginFeatureAPI {
  pluginManager = null;
  notifyTimer = null;
  NOTIFY_DEBOUNCE_DELAY = 3e3;
  // 3秒防抖延迟
  init(pluginManager2) {
    this.pluginManager = pluginManager2;
    this.setupIPC();
  }
  /**
   * 根据插件名称和来源生成动态 feature 存储键。
   * 动态指令也必须按运行时命名空间隔离，避免开发版和安装版串写。
   */
  getDynamicFeaturesDocId(pluginName) {
    return `${getPluginDataPrefix(pluginName)}dynamic-features`;
  }
  /**
   * 从 IPC 事件中解析当前插件的运行时上下文。
   */
  getPluginRuntimeContext(event) {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
    if (!pluginInfo) {
      return null;
    }
    return {
      pluginName: pluginInfo.name
    };
  }
  setupIPC() {
    electron.ipcMain.on("get-features", (event, codes) => {
      try {
        const pluginRuntimeContext = this.getPluginRuntimeContext(event);
        if (!pluginRuntimeContext) {
          event.returnValue = [];
          return;
        }
        const features = this.loadDynamicFeatures(pluginRuntimeContext.pluginName);
        if (codes && Array.isArray(codes)) {
          const filtered = features.filter((f) => codes.includes(f.code));
          event.returnValue = filtered;
        } else {
          event.returnValue = features;
        }
      } catch (error) {
        console.error("[PluginFeature] get-features error:", error);
        event.returnValue = [];
      }
    });
    electron.ipcMain.on("set-feature", (event, feature) => {
      try {
        console.log("[PluginFeature] set-feature", feature);
        const pluginRuntimeContext = this.getPluginRuntimeContext(event);
        if (!pluginRuntimeContext) {
          event.returnValue = { success: false, error: "Plugin not found" };
          return;
        }
        if (!feature.code || !feature.cmds || !Array.isArray(feature.cmds)) {
          event.returnValue = { success: false, error: "Invalid feature structure" };
          return;
        }
        const features = this.loadDynamicFeatures(pluginRuntimeContext.pluginName);
        const existingIndex = features.findIndex((f) => f.code === feature.code);
        if (existingIndex >= 0) {
          features[existingIndex] = feature;
        } else {
          features.push(feature);
        }
        this.saveDynamicFeatures(pluginRuntimeContext.pluginName, features);
        this.notifyPluginsChanged();
        event.returnValue = { success: true };
      } catch (error) {
        console.error("[PluginFeature] set-feature error:", error);
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.on("remove-feature", (event, code) => {
      try {
        console.log("[PluginFeature] remove-feature", code);
        const pluginRuntimeContext = this.getPluginRuntimeContext(event);
        if (!pluginRuntimeContext) {
          event.returnValue = false;
          return;
        }
        const features = this.loadDynamicFeatures(pluginRuntimeContext.pluginName);
        const index = features.findIndex((f) => f.code === code);
        if (index >= 0) {
          features.splice(index, 1);
          this.saveDynamicFeatures(pluginRuntimeContext.pluginName, features);
          this.notifyPluginsChanged();
          event.returnValue = true;
        } else {
          event.returnValue = false;
        }
      } catch (error) {
        console.error("[PluginFeature] remove-feature error:", error);
        event.returnValue = false;
      }
    });
  }
  /**
   * 从数据库加载动态 features
   */
  loadDynamicFeatures(pluginName) {
    try {
      const key = this.getDynamicFeaturesDocId(pluginName);
      const doc = lmdbInstance.get(key);
      if (doc && doc.data) {
        const data = JSON.parse(doc.data);
        return data.features || [];
      }
      return [];
    } catch (error) {
      console.error("[PluginFeature] loadDynamicFeatures error:", error);
      return [];
    }
  }
  /**
   * 保存动态 features 到数据库
   */
  saveDynamicFeatures(pluginName, features) {
    const key = this.getDynamicFeaturesDocId(pluginName);
    const existing = lmdbInstance.get(key);
    console.log("[PluginFeature] 保存动态 Feature 到隔离命名空间:", {
      pluginName,
      key,
      featureCount: features.length
    });
    const doc = {
      _id: key,
      data: JSON.stringify({ features })
    };
    if (existing) {
      doc._rev = existing._rev;
    }
    lmdbInstance.put(doc);
  }
  /**
   * 通知渲染进程插件列表已变化（带防抖处理）
   * 如果3秒内没有新的通知请求，才会真正发送通知
   */
  notifyPluginsChanged() {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.notifyTimer = setTimeout(() => {
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send("plugins-changed");
      }
      this.notifyTimer = null;
    }, this.NOTIFY_DEBOUNCE_DELAY);
  }
  /**
   * 清理插件的动态 features
   */
  clearPluginFeatures(pluginName) {
    try {
      const key = this.getDynamicFeaturesDocId(pluginName);
      const doc = lmdbInstance.get(key);
      if (doc) {
        console.log("[PluginFeature] 清理动态 Feature 隔离数据:", {
          pluginName,
          key
        });
        lmdbInstance.remove(key);
      }
    } catch (error) {
      console.error("[PluginFeature] clearPluginFeatures error:", error);
    }
  }
}
const pluginFeatureAPI = new PluginFeatureAPI();
async function pLimit(tasks, concurrency) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const promise = task().then((result) => {
      results.push(result);
      executing.splice(executing.indexOf(promise), 1);
    });
    executing.push(promise);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}
function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))];
}
let _lprojNames = null;
let _loctableKeys = null;
function bcp47ToLprojNames(tag) {
  const candidates = [];
  const parts = tag.split("-");
  const lang = parts[0];
  let script;
  let region;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.length === 4 && p[0] === p[0].toUpperCase()) {
      script = p;
    } else if (p.length === 2 && p === p.toUpperCase()) {
      region = p;
    }
  }
  if (lang === "zh" && script) {
    candidates.push(`zh-${script}`);
    if (region) {
      candidates.push(`zh-${script}_${region}`);
      candidates.push(`zh_${region}`);
    } else if (script === "Hans") {
      candidates.push("zh_CN");
      candidates.push("zh_SG");
    } else if (script === "Hant") {
      candidates.push("zh_TW");
      candidates.push("zh_HK");
    }
  }
  const legacyNames = {
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    de: "German",
    es: "Spanish",
    it: "Italian",
    pt: "Portuguese",
    nl: "Dutch",
    sv: "Swedish",
    da: "Danish",
    fi: "Finnish",
    nb: "Norwegian",
    pl: "Polish",
    ru: "Russian",
    en: "English"
  };
  if (region) {
    candidates.push(`${lang}_${region}`);
  }
  candidates.push(lang);
  if (legacyNames[lang]) {
    candidates.push(legacyNames[lang]);
  }
  return candidates;
}
function bcp47ToLoctableKeys(tag) {
  const candidates = [];
  const parts = tag.split("-");
  const lang = parts[0];
  let script;
  let region;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.length === 4 && p[0] === p[0].toUpperCase()) {
      script = p;
    } else if (p.length === 2 && p === p.toUpperCase()) {
      region = p;
    }
  }
  if (lang === "zh" && script) {
    if (region) {
      candidates.push(`zh_${region}`);
    }
    if (script === "Hans") {
      candidates.push("zh_CN", "zh_SG");
    } else if (script === "Hant") {
      candidates.push("zh_TW", "zh_HK");
    }
  } else if (region) {
    candidates.push(`${lang}_${region}`);
  }
  candidates.push(lang);
  return [...new Set(candidates)];
}
function getLocaleLprojNames() {
  if (_lprojNames) return _lprojNames;
  const preferredLangs = electron.app.getPreferredSystemLanguages();
  const candidates = [];
  for (const lang of preferredLangs) {
    candidates.push(...bcp47ToLprojNames(lang));
  }
  _lprojNames = [...new Set(candidates)];
  return _lprojNames;
}
function getLocaleLoctableKeys() {
  if (_loctableKeys) return _loctableKeys;
  const preferredLangs = electron.app.getPreferredSystemLanguages();
  const candidates = [];
  for (const tag of preferredLangs) {
    candidates.push(...bcp47ToLoctableKeys(tag));
  }
  _loctableKeys = [...new Set(candidates)];
  return _loctableKeys;
}
function extractLocalizedAliases(data, name) {
  if (!data) return [];
  const aliases = Object.entries(data).filter(([key, value]) => key.startsWith("APP_NAME_SYNONYM_") && typeof value === "string").map(([, value]) => value.trim()).filter(Boolean);
  return [...new Set(aliases.filter((alias) => alias !== name))];
}
function parseStringsContent(content) {
  const result = {};
  const regex = /(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*))\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1] ?? match[2];
    result[key] = match[3];
  }
  return result;
}
async function readStringsFile(filePath) {
  try {
    const data = await new Promise((resolve, reject) => {
      plist.readFile(filePath, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    if (data) return data;
  } catch {
  }
  try {
    const buf = await fs$1.readFile(filePath);
    let content;
    if (buf[0] === 255 && buf[1] === 254) {
      content = buf.toString("utf16le");
    } else if (buf[0] === 254 && buf[1] === 255) {
      content = buf.swap16().toString("utf16le");
    } else {
      content = buf.toString("utf8");
    }
    return parseStringsContent(content);
  } catch {
    return null;
  }
}
async function getLocalizedMetadataFromLproj(appPath) {
  const lprojNames = getLocaleLprojNames();
  for (const lprojName of lprojNames) {
    const stringsPath = path.join(
      appPath,
      "Contents",
      "Resources",
      `${lprojName}.lproj`,
      "InfoPlist.strings"
    );
    try {
      if (!fs.existsSync(stringsPath)) continue;
      const data = await readStringsFile(stringsPath);
      const name = data?.CFBundleDisplayName || data?.CFBundleName;
      if (name) {
        return {
          name,
          aliases: extractLocalizedAliases(data, name)
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}
async function getLocalizedMetadataFromLoctable(appPath) {
  const loctablePath = path.join(appPath, "Contents", "Resources", "InfoPlist.loctable");
  if (!fs.existsSync(loctablePath)) return null;
  try {
    const data = await new Promise((resolve, reject) => {
      plist.readFile(loctablePath, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    const keys = getLocaleLoctableKeys();
    for (const key of keys) {
      const entry = data?.[key];
      const name = entry?.CFBundleDisplayName || entry?.CFBundleName;
      if (name) {
        return {
          name,
          aliases: extractLocalizedAliases(entry, name)
        };
      }
    }
  } catch {
  }
  return null;
}
async function getLocalizedMetadata(appPath) {
  return await getLocalizedMetadataFromLproj(appPath) ?? await getLocalizedMetadataFromLoctable(appPath);
}
async function getBundleNames(appPath) {
  const fileName = path.basename(appPath, ".app");
  try {
    const data = await new Promise((resolve, reject) => {
      const plistPath = path.join(appPath, "Contents", "Info.plist");
      plist.readFile(plistPath, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    return uniqueNonEmpty([data?.CFBundleDisplayName, data?.CFBundleName, fileName]);
  } catch {
    return uniqueNonEmpty([fileName]);
  }
}
async function getAppDisplayInfo(appPath) {
  const bundleNames = await getBundleNames(appPath);
  const localizedMetadata = await getLocalizedMetadata(appPath);
  if (localizedMetadata?.name) {
    return {
      name: localizedMetadata.name,
      aliases: uniqueNonEmpty([...bundleNames, ...localizedMetadata.aliases || []]).filter(
        (alias) => alias !== localizedMetadata.name
      )
    };
  }
  const [name, ...aliases] = bundleNames;
  return { name, aliases };
}
async function scanApplications$3() {
  try {
    console.time("[Scanner] 扫描应用");
    const searchPaths = [
      "/Applications",
      "/System/Applications",
      "/System/Applications/Utilities/",
      `${process.env.HOME}/Applications`
    ];
    const allAppPaths = [];
    for (const searchPath of searchPaths) {
      try {
        const entries = await fs$1.readdir(searchPath, { withFileTypes: true });
        const appDirs = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".app")).map((entry) => path.join(searchPath, entry.name));
        allAppPaths.push(...appDirs);
      } catch {
        continue;
      }
    }
    console.log(`[Scanner] 找到 ${allAppPaths.length} 个应用`);
    const tasks = allAppPaths.map((appPath) => async () => {
      try {
        const { name, aliases } = await getAppDisplayInfo(appPath);
        const acronymSource = [name, ...aliases || []].find(
          (value) => extractAcronym(value) !== ""
        );
        const iconUrl = `ztools-icon://${encodeURIComponent(appPath)}`;
        return {
          name,
          path: appPath,
          icon: iconUrl,
          aliases,
          acronym: acronymSource ? extractAcronym(acronymSource) : ""
        };
      } catch {
        const name = path.basename(appPath, ".app");
        return {
          name,
          path: appPath,
          icon: `ztools-icon://${encodeURIComponent(appPath)}`,
          acronym: extractAcronym(name)
        };
      }
    });
    const apps = await pLimit(tasks, 50);
    console.timeEnd("[Scanner] 扫描应用");
    console.log(`[Scanner] 成功加载 ${apps.length} 个应用`);
    return apps;
  } catch (error) {
    console.error("[Scanner] 扫描应用失败:", error);
    return [];
  }
}
function getWindowsScanPaths() {
  const programDataStartMenu = path.join(
    "C:",
    "ProgramData",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );
  const userStartMenu = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );
  const userDesktop = electron.app.getPath("desktop");
  const publicDesktop = path.join("C:", "Users", "Public", "Desktop");
  return [programDataStartMenu, userStartMenu, userDesktop, publicDesktop];
}
function getMacApplicationPaths() {
  return ["/Applications", "/System/Applications", `${process.env.HOME}/Applications`];
}
const SKIP_FOLDERS$1 = [
  "sdk",
  "doc",
  "docs",
  "samples",
  "sample",
  "examples",
  "example",
  "demos",
  "demo",
  "documentation"
];
const SKIP_NAME_PATTERN = /^uninstall|^卸载|卸载$|website|网站|帮助|help|readme|read me|文档|manual|license|documentation/i;
function shouldSkipShortcut(name) {
  return SKIP_NAME_PATTERN.test(name);
}
async function parseDesktopIni(dirPath) {
  const entries = /* @__PURE__ */ new Map();
  const iniPath = path.join(dirPath, "desktop.ini");
  try {
    const buf = await fs$1.readFile(iniPath);
    const content = buf.length >= 2 && buf[0] === 255 && buf[1] === 254 ? buf.toString("utf16le") : buf.toString("utf8");
    let inSection = false;
    for (const line of content.split(/\r?\n/)) {
      const t = line.trim();
      if (t === "[LocalizedFileNames]") {
        inSection = true;
        continue;
      }
      if (t.startsWith("[")) {
        inSection = false;
        continue;
      }
      if (inSection && t.includes("=")) {
        const eqIdx = t.indexOf("=");
        const fileName = t.slice(0, eqIdx);
        const value = t.slice(eqIdx + 1);
        if (fileName && value) {
          entries.set(fileName, value);
        }
      }
    }
  } catch {
  }
  return entries;
}
function resolveMuiStrings(muiRefs) {
  if (muiRefs.length === 0) return /* @__PURE__ */ new Map();
  return MuiResolver.resolve(muiRefs);
}
async function getLocalizedDisplayNames(dirPaths) {
  const nameMap = /* @__PURE__ */ new Map();
  if (process.platform !== "win32") return nameMap;
  try {
    const pendingMui = /* @__PURE__ */ new Map();
    async function scanDir(dirPath) {
      const iniEntries = await parseDesktopIni(dirPath);
      for (const [fileName, value] of iniEntries) {
        const fullPath = path.join(dirPath, fileName);
        if (value.startsWith("@")) {
          const arr = pendingMui.get(value) || [];
          arr.push(fullPath);
          pendingMui.set(value, arr);
        } else {
          nameMap.set(fullPath.toLowerCase(), value);
        }
      }
      try {
        const entries = await fs$1.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            await scanDir(path.join(dirPath, entry.name));
          }
        }
      } catch {
      }
    }
    for (const dirPath of dirPaths) {
      await scanDir(dirPath);
    }
    if (pendingMui.size > 0) {
      const muiRefs = Array.from(pendingMui.keys());
      const resolved = resolveMuiStrings(muiRefs);
      for (const [ref, localizedName] of resolved) {
        const filePaths = pendingMui.get(ref) || [];
        for (const fp of filePaths) {
          nameMap.set(fp.toLowerCase(), localizedName);
        }
      }
    }
    console.log(`[Scanner] 获取到 ${nameMap.size} 个本地化文件名映射`);
  } catch (error) {
    console.error("[Scanner] 获取本地化显示名称失败（将使用文件名）:", error);
  }
  return nameMap;
}
function getIconUrl(appPath) {
  return `ztools-icon://${encodeURIComponent(appPath)}`;
}
async function parseUrlFile(filePath) {
  try {
    const content = await fs$1.readFile(filePath, "utf-8");
    let url2 = "";
    let iconFile = "";
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("URL=")) {
        url2 = trimmed.slice(4);
      } else if (trimmed.startsWith("IconFile=")) {
        iconFile = trimmed.slice(9);
      }
    }
    if (!url2) return null;
    const lowerUrl = url2.toLowerCase();
    if (lowerUrl.startsWith("http://") || lowerUrl.startsWith("https://")) {
      return null;
    }
    return { url: url2, iconFile };
  } catch {
    return null;
  }
}
async function scanDirectory(dirPath, apps, displayNameMap) {
  try {
    const entries = await fs$1.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_FOLDERS$1.includes(entry.name.toLowerCase())) {
          continue;
        }
        await scanDirectory(fullPath, apps, displayNameMap);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".url") {
        const urlInfo = await parseUrlFile(fullPath);
        if (!urlInfo) continue;
        const appName2 = displayNameMap.get(fullPath.toLowerCase()) || path.basename(entry.name, ".url");
        if (SKIP_NAME_PATTERN.test(appName2)) continue;
        const iconPath = urlInfo.iconFile || fullPath;
        const icon2 = getIconUrl(iconPath);
        apps.push({
          name: appName2,
          path: urlInfo.url,
          // 使用协议链接作为启动路径
          icon: icon2,
          acronym: extractAcronym(appName2)
        });
        continue;
      }
      if (ext !== ".lnk") continue;
      const appName = displayNameMap.get(fullPath.toLowerCase()) || path.basename(entry.name, ".lnk");
      let shortcutDetails = null;
      try {
        shortcutDetails = electron.shell.readShortcutLink(fullPath);
      } catch {
      }
      const targetPath = shortcutDetails?.target?.trim() || "";
      if (targetPath.toLowerCase().endsWith(".url")) {
        const urlInfo = await parseUrlFile(targetPath);
        if (!urlInfo) continue;
        if (SKIP_NAME_PATTERN.test(appName)) continue;
        const iconPath = urlInfo.iconFile || fullPath;
        const icon2 = getIconUrl(iconPath);
        apps.push({
          name: appName,
          path: urlInfo.url,
          icon: icon2,
          acronym: extractAcronym(appName)
        });
        continue;
      }
      if (shouldSkipShortcut(appName)) {
        continue;
      }
      const icon = getIconUrl(fullPath);
      const app = {
        name: appName,
        path: fullPath,
        icon,
        acronym: extractAcronym(appName),
        _dedupeTarget: targetPath || void 0
      };
      apps.push(app);
    }
  } catch (error) {
    console.error(`[Scanner] 扫描目录失败 ${dirPath}:`, error);
  }
}
function deduplicateCommands(apps) {
  const uniqueApps = /* @__PURE__ */ new Map();
  apps.forEach((app) => {
    const dedupeTarget = app._dedupeTarget || app.path;
    const dedupeKey = `${app.name.toLowerCase()}|${dedupeTarget.toLowerCase()}`;
    if (!uniqueApps.has(dedupeKey)) {
      const { _dedupeTarget, ...cleanApp } = app;
      uniqueApps.set(dedupeKey, cleanApp);
    }
  });
  return Array.from(uniqueApps.values());
}
async function scanApplications$2() {
  try {
    const startTime = performance.now();
    const apps = [];
    const scanPaths = getWindowsScanPaths();
    const displayNameMap = await getLocalizedDisplayNames(scanPaths);
    for (const menuPath of scanPaths) {
      await scanDirectory(menuPath, apps, displayNameMap);
    }
    const deduplicatedApps = deduplicateCommands(apps);
    const endTime = performance.now();
    console.log(
      `[Scanner] 扫描完成: ${apps.length} 个应用 -> 去重后 ${deduplicatedApps.length} 个, 耗时 ${(endTime - startTime).toFixed(0)}ms`
    );
    return deduplicatedApps;
  } catch (error) {
    console.error("[Scanner] 扫描应用失败:", error);
    return [];
  }
}
function parseDesktopFile(content) {
  const result = {};
  let inDesktopEntry = false;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "[Desktop Entry]") {
      inDesktopEntry = true;
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]") && inDesktopEntry) {
      break;
    }
    if (!inDesktopEntry || !line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}
function getLocalizedName(entry) {
  const lang = process.env.LANG || process.env.LANGUAGE || "";
  const langCode = lang.split(".")[0];
  const parts = langCode.split("_");
  const langBase = parts[0];
  const candidates = [];
  if (langCode) {
    candidates.push(`Name[${langCode}]`);
  }
  if (parts.length > 1 && parts[1]) {
    candidates.push(`Name[${langBase}_${parts[1]}]`);
  }
  if (langBase) {
    candidates.push(`Name[${langBase}]`);
  }
  candidates.push("Name");
  for (const key of candidates) {
    const value = entry[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return entry["Name"]?.trim() || "";
}
function cleanExecCommand(exec) {
  return exec.replace(/%[a-zA-Z]/g, "").replace(/\s+/g, " ").trim();
}
function getIconSearchPaths() {
  const home = os.homedir();
  return [
    path.join(home, ".local/share/icons"),
    "/usr/share/icons",
    "/usr/share/pixmaps",
    path.join(home, ".icons"),
    "/usr/local/share/icons",
    "/usr/local/share/pixmaps"
  ];
}
const ICON_EXTENSIONS = [".png", ".svg", ".xpm"];
const ICON_PREFERRED_SIZES = ["256x256", "128x128", "64x64", "48x48", "32x32", "scalable"];
async function findIconPath(iconName) {
  if (iconName.startsWith("/")) {
    try {
      await fs$1.access(iconName);
      return iconName;
    } catch {
    }
  }
  const baseName = iconName.replace(/\.(png|svg|xpm)$/, "");
  const searchPaths = getIconSearchPaths();
  for (const searchPath of searchPaths) {
    try {
      const entries = await fs$1.readdir(searchPath, { withFileTypes: true });
      const themes = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      for (const theme of ["hicolor", ...themes]) {
        for (const size of ICON_PREFERRED_SIZES) {
          for (const category of ["apps", "applications"]) {
            for (const ext of ICON_EXTENSIONS) {
              const iconPath = path.join(searchPath, theme, size, category, baseName + ext);
              try {
                await fs$1.access(iconPath);
                return iconPath;
              } catch {
              }
            }
          }
        }
      }
    } catch {
    }
    for (const ext of ICON_EXTENSIONS) {
      const iconPath = path.join(searchPath, baseName + ext);
      try {
        await fs$1.access(iconPath);
        return iconPath;
      } catch {
      }
    }
  }
  return null;
}
function extractPinyinAcronym(name) {
  let result = "";
  for (const char of name) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      try {
        result += pinyinPro.pinyin(char, { pattern: "first", toneType: "none" });
      } catch {
      }
    } else if (/[a-zA-Z]/.test(char)) {
      result += char.toLowerCase();
    }
  }
  return result;
}
function hasChinese(str) {
  return /[\u4e00-\u9fa5]/.test(str);
}
function getLinuxDesktopPaths() {
  const home = os.homedir();
  const xdgDataDirs = process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share";
  const baseDirs = xdgDataDirs.split(":").filter(Boolean);
  const paths = [
    path.join(home, ".local/share/applications"),
    // 用户级
    ...baseDirs.map((dir) => path.join(dir, "applications"))
    // 系统级
  ];
  return [...new Set(paths)];
}
async function scanDesktopDir(dirPath) {
  try {
    const entries = await fs$1.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".desktop")).map((e) => path.join(dirPath, e.name));
  } catch {
    return [];
  }
}
async function parseDesktopFileToCommand(desktopPath) {
  try {
    const content = await fs$1.readFile(desktopPath, "utf-8");
    const entry = parseDesktopFile(content);
    if (entry.Type !== "Application" || entry.NoDisplay === "true" || entry.Hidden === "true" || !entry.Exec) {
      return null;
    }
    const name = getLocalizedName(entry);
    if (!name) return null;
    const exec = cleanExecCommand(entry.Exec);
    if (!exec) return null;
    let iconUrl;
    if (entry.Icon) {
      const iconPath = await findIconPath(entry.Icon);
      if (iconPath) {
        iconUrl = `file://${iconPath}`;
      }
    }
    const aliases = [];
    const rawEnglishName = entry["Name"]?.trim();
    if (rawEnglishName && rawEnglishName !== name) {
      aliases.push(rawEnglishName);
    }
    const acronym = extractAcronym(name) || (rawEnglishName ? extractAcronym(rawEnglishName) : "");
    if (hasChinese(name)) {
      const pinyinAcronym = extractPinyinAcronym(name);
      if (pinyinAcronym && pinyinAcronym !== acronym) {
        aliases.push(pinyinAcronym);
      }
    }
    return {
      name,
      path: exec,
      icon: iconUrl,
      aliases: aliases.length > 0 ? aliases : void 0,
      acronym: acronym || void 0
    };
  } catch {
    return null;
  }
}
async function scanApplications$1() {
  try {
    console.time("[LinuxScanner] 扫描应用");
    const searchPaths = getLinuxDesktopPaths();
    const allDesktopFiles = [];
    for (const dirPath of searchPaths) {
      const files = await scanDesktopDir(dirPath);
      allDesktopFiles.push(...files);
    }
    const uniqueFiles = [...new Set(allDesktopFiles)];
    console.log(`[LinuxScanner] 找到 ${uniqueFiles.length} 个 .desktop 文件`);
    const tasks = uniqueFiles.map((filePath) => () => parseDesktopFileToCommand(filePath));
    const results = await pLimit(tasks, 30);
    const apps = results.filter((cmd) => cmd !== null);
    console.timeEnd("[LinuxScanner] 扫描应用");
    console.log(`[LinuxScanner] 成功加载 ${apps.length} 个应用`);
    return apps;
  } catch (error) {
    console.error("[LinuxScanner] 扫描应用失败:", error);
    return [];
  }
}
async function scanApplications() {
  const platform2 = process.platform;
  if (platform2 === "darwin") {
    return scanApplications$3();
  } else if (platform2 === "win32") {
    return scanApplications$2();
  } else if (platform2 === "linux") {
    return scanApplications$1();
  } else {
    console.warn(`[Scanner] 不支持的平台: ${platform2}`);
    return [];
  }
}
const MS_SETTINGS_URIS = [
  // === 系统 ===
  {
    name: "屏幕",
    uri: "ms-settings:display",
    category: "系统"
  },
  {
    name: "高级显示设置",
    uri: "ms-settings:display-advanced",
    category: "系统"
  },
  {
    name: "显示卡",
    uri: "ms-settings:display-advancedgraphics",
    category: "系统"
  },
  {
    name: "夜间模式",
    uri: "ms-settings:nightlight",
    category: "系统"
  },
  {
    name: "声音",
    uri: "ms-settings:sound",
    category: "系统"
  },
  {
    name: "所有声音设备",
    uri: "ms-settings:sound-devices",
    category: "系统"
  },
  {
    name: "麦克风属性",
    uri: "ms-settings:sound-defaultinputproperties",
    category: "系统"
  },
  {
    name: "扬声器属性",
    uri: "ms-settings:sound-defaultoutputproperties",
    category: "系统"
  },
  {
    name: "音量合成器",
    uri: "ms-settings:apps-volume",
    category: "系统"
  },
  {
    name: "通知",
    uri: "ms-settings:notifications",
    category: "系统"
  },
  {
    name: "专注",
    uri: "ms-settings:quiethours",
    category: "系统"
  },
  {
    name: "电源和电池",
    uri: "ms-settings:powersleep",
    category: "系统"
  },
  {
    name: "电源",
    uri: "ms-settings:batterysaver",
    category: "系统"
  },
  {
    name: "节能建议",
    uri: "ms-settings:energyrecommendations",
    category: "系统"
  },
  {
    name: "存储",
    uri: "ms-settings:storagesense",
    category: "系统"
  },
  {
    name: "存储感知",
    uri: "ms-settings:storagepolicies",
    category: "系统"
  },
  {
    name: "清理建议",
    uri: "ms-settings:storagerecommendations",
    category: "系统"
  },
  {
    name: "磁盘和卷",
    uri: "ms-settings:disksandvolumes",
    category: "系统"
  },
  {
    name: "保存新内容的地方",
    uri: "ms-settings:savelocations",
    category: "系统"
  },
  {
    name: "多任务处理",
    uri: "ms-settings:multitasking",
    category: "系统"
  },
  {
    name: "投影到此电脑",
    uri: "ms-settings:project",
    category: "系统"
  },
  {
    name: "就近共享",
    uri: "ms-settings:crossdevice",
    category: "系统"
  },
  {
    name: "任务栏",
    uri: "ms-settings:taskbar",
    category: "个性化"
  },
  {
    name: "剪贴板",
    uri: "ms-settings:clipboard",
    category: "系统"
  },
  {
    name: "远程桌面",
    uri: "ms-settings:remotedesktop",
    category: "系统"
  },
  {
    name: "设备加密",
    uri: "ms-settings:deviceencryption",
    category: "系统"
  },
  {
    name: "关于",
    uri: "ms-settings:about",
    category: "系统"
  },
  // === 蓝牙和其他设备 ===
  {
    name: "蓝牙",
    uri: "ms-settings:bluetooth",
    category: "设备"
  },
  {
    name: "设备",
    uri: "ms-settings:connecteddevices",
    category: "设备"
  },
  {
    name: "投放",
    uri: "ms-settings-connectabledevices:devicediscovery",
    category: "设备"
  },
  {
    name: "打印机和扫描仪",
    uri: "ms-settings:printers",
    category: "设备"
  },
  {
    name: "鼠标",
    uri: "ms-settings:mousetouchpad",
    category: "设备"
  },
  {
    name: "USB",
    uri: "ms-settings:usb",
    category: "设备"
  },
  {
    name: "摄像头",
    uri: "ms-settings:camera",
    category: "设备"
  },
  // === 网络和 Internet ===
  {
    name: "网络和 Internet",
    uri: "ms-settings:network-status",
    category: "网络"
  },
  {
    name: "WLAN",
    uri: "ms-settings:network-wifi",
    category: "网络"
  },
  {
    name: "管理已知网络",
    uri: "ms-settings:network-wifisettings",
    category: "网络"
  },
  {
    name: "以太网",
    uri: "ms-settings:network-ethernet",
    category: "网络"
  },
  {
    name: "VPN",
    uri: "ms-settings:network-vpn",
    category: "网络"
  },
  {
    name: "代理",
    uri: "ms-settings:network-proxy",
    category: "网络"
  },
  {
    name: "飞行模式",
    uri: "ms-settings:network-airplanemode",
    category: "网络"
  },
  {
    name: "移动热点",
    uri: "ms-settings:network-mobilehotspot",
    category: "网络"
  },
  {
    name: "数据使用量",
    uri: "ms-settings:datausage",
    category: "网络"
  },
  // === 个性化 ===
  {
    name: "个性化",
    uri: "ms-settings:personalization",
    category: "个性化"
  },
  {
    name: "背景",
    uri: "ms-settings:personalization-background",
    category: "个性化"
  },
  {
    name: "颜色",
    uri: "ms-settings:personalization-colors",
    category: "个性化"
  },
  {
    name: "锁屏界面",
    uri: "ms-settings:lockscreen",
    category: "个性化"
  },
  {
    name: "主题",
    uri: "ms-settings:themes",
    category: "个性化"
  },
  {
    name: "字体",
    uri: "ms-settings:fonts",
    category: "个性化"
  },
  {
    name: "开始",
    uri: "ms-settings:personalization-start",
    category: "个性化"
  },
  // === 应用 ===
  {
    name: "已安装的应用",
    uri: "ms-settings:appsfeatures",
    category: "应用"
  },
  {
    name: "默认应用",
    uri: "ms-settings:defaultapps",
    category: "应用"
  },
  {
    name: "启动",
    uri: "ms-settings:startupapps",
    category: "应用"
  },
  {
    name: "可选功能",
    uri: "ms-settings:optionalfeatures",
    category: "应用"
  },
  // === 账户 ===
  {
    name: "你的信息",
    uri: "ms-settings:yourinfo",
    category: "账户"
  },
  {
    name: "电子邮件和账户",
    uri: "ms-settings:emailandaccounts",
    category: "账户"
  },
  {
    name: "登录选项",
    uri: "ms-settings:signinoptions",
    category: "账户"
  },
  {
    name: "其他用户",
    uri: "ms-settings:otherusers",
    category: "账户"
  },
  {
    name: "Windows 备份",
    uri: "ms-settings:sync",
    category: "账户"
  },
  // === 时间和语言 ===
  {
    name: "日期和时间",
    uri: "ms-settings:dateandtime",
    category: "时间"
  },
  {
    name: "语言和区域",
    uri: "ms-settings:regionlanguage",
    category: "语言"
  },
  {
    name: "区域格式",
    uri: "ms-settings:regionformatting",
    category: "语言"
  },
  {
    name: "键盘",
    uri: "ms-settings:keyboard",
    category: "语言"
  },
  {
    name: "高级键盘设置",
    uri: "ms-settings:keyboard-advanced",
    category: "语言"
  },
  {
    name: "输入",
    uri: "ms-settings:typing",
    category: "语言"
  },
  {
    name: "语音",
    uri: "ms-settings:speech",
    category: "语言"
  },
  // === 隐私和安全性 ===
  {
    name: "隐私和安全性",
    uri: "ms-settings:privacy",
    category: "隐私"
  },
  {
    name: "常规",
    uri: "ms-settings:privacy-general",
    category: "隐私"
  },
  {
    name: "位置",
    uri: "ms-settings:privacy-location",
    category: "隐私"
  },
  {
    name: "相机",
    uri: "ms-settings:privacy-webcam",
    category: "隐私"
  },
  {
    name: "麦克风",
    uri: "ms-settings:privacy-microphone",
    category: "隐私"
  },
  // === Windows 更新 ===
  {
    name: "Windows 更新",
    uri: "ms-settings:windowsupdate",
    category: "更新"
  },
  {
    name: "检查更新",
    uri: "ms-settings:windowsupdate-action",
    category: "更新"
  },
  {
    name: "更新历史记录",
    uri: "ms-settings:windowsupdate-history",
    category: "更新"
  },
  {
    name: "可选更新",
    uri: "ms-settings:windowsupdate-optionalupdates",
    category: "更新"
  },
  {
    name: "高级选项",
    uri: "ms-settings:windowsupdate-options",
    category: "更新"
  },
  {
    name: "重启选项",
    uri: "ms-settings:windowsupdate-restartoptions",
    category: "更新"
  },
  {
    name: "获取最新更新",
    uri: "ms-settings:windowsupdate-seekerondemand",
    category: "更新"
  },
  {
    name: "传递优化",
    uri: "ms-settings:delivery-optimization",
    category: "更新"
  },
  {
    name: "Windows 安全中心",
    uri: "ms-settings:windowsdefender",
    category: "安全"
  },
  {
    name: "疑难解答",
    uri: "ms-settings:troubleshoot",
    category: "系统"
  },
  {
    name: "恢复",
    uri: "ms-settings:recovery",
    category: "系统"
  },
  {
    name: "激活",
    uri: "ms-settings:activation",
    category: "系统"
  },
  {
    name: "查找我的设备",
    uri: "ms-settings:findmydevice",
    category: "安全"
  },
  {
    name: "开发者选项",
    uri: "ms-settings:developers",
    category: "系统"
  },
  // === 搜索 ===
  {
    name: "搜索 Windows",
    uri: "ms-settings:search",
    category: "搜索"
  },
  {
    name: "搜索权限",
    uri: "ms-settings:search-permissions",
    category: "搜索"
  }
];
const allSettings = [
  // === ms-settings URI（来自微软官方文档和 SS64）===
  ...MS_SETTINGS_URIS,
  // === 控制面板和系统工具（非 ms-settings）===
  // 控制面板（16项）
  {
    name: "编辑用户环境变量",
    uri: "rundll32 sysdm.cpl,EditEnvironmentVariables",
    category: "系统"
  },
  {
    name: "编辑系统环境变量",
    uri: "SystemPropertiesAdvanced.exe",
    category: "系统"
  },
  {
    name: "系统属性",
    uri: "SystemPropertiesAdvanced.exe",
    category: "系统"
  },
  {
    name: "计算机名",
    uri: "SystemPropertiesComputerName.exe",
    category: "系统"
  },
  {
    name: "系统保护",
    uri: "SystemPropertiesProtection.exe",
    category: "系统"
  },
  {
    name: "远程设置",
    uri: "SystemPropertiesRemote.exe",
    category: "系统"
  },
  {
    name: "程序和功能",
    uri: "appwiz.cpl",
    category: "应用"
  },
  {
    name: "鼠标属性",
    uri: "main.cpl",
    category: "设备"
  },
  {
    name: "网络连接",
    uri: "ncpa.cpl",
    category: "网络"
  },
  {
    name: "电源选项",
    uri: "powercfg.cpl",
    category: "系统"
  },
  {
    name: "防火墙",
    uri: "firewall.cpl",
    category: "安全"
  },
  {
    name: "用户账户",
    uri: "netplwiz.exe",
    category: "账户"
  },
  {
    name: "日期和时间",
    uri: "timedate.cpl",
    category: "时间"
  },
  // 管理工具（12项）
  {
    name: "设备管理器",
    uri: "devmgmt.msc",
    category: "管理"
  },
  {
    name: "磁盘管理",
    uri: "diskmgmt.msc",
    category: "管理"
  },
  {
    name: "计算机管理",
    uri: "compmgmt.msc",
    category: "管理"
  },
  {
    name: "服务",
    uri: "services.msc",
    category: "管理"
  },
  {
    name: "任务管理器",
    uri: "taskmgr.exe",
    category: "系统"
  },
  {
    name: "注册表编辑器",
    uri: "regedit.exe",
    category: "系统"
  },
  {
    name: "事件查看器",
    uri: "eventvwr.msc",
    category: "管理"
  },
  {
    name: "任务计划程序",
    uri: "taskschd.msc",
    category: "管理"
  },
  {
    name: "性能监视器",
    uri: "perfmon.msc",
    category: "管理"
  },
  {
    name: "资源监视器",
    uri: "resmon.exe",
    category: "系统"
  },
  {
    name: "组策略编辑器",
    uri: "gpedit.msc",
    category: "管理"
  },
  {
    name: "本地安全策略",
    uri: "secpol.msc",
    category: "安全"
  },
  // 常用系统工具（16项）
  {
    name: "回收站",
    uri: "shell:RecycleBinFolder",
    category: "系统"
  },
  {
    name: "清空回收站",
    uri: 'PowerShell.exe -NoProfile -Command "Clear-RecycleBin -Force"',
    category: "系统",
    confirmDialog: {
      type: "warning",
      buttons: ["取消", "清空回收站"],
      defaultId: 0,
      cancelId: 0,
      title: "清空回收站",
      message: "确定要清空回收站吗？",
      detail: "回收站的全部文件将永久删除!"
    }
  },
  {
    name: "命令提示符",
    uri: "cmd.exe",
    category: "系统"
  },
  {
    name: "PowerShell",
    uri: "powershell.exe",
    category: "系统"
  },
  {
    name: "Windows Terminal",
    uri: "wt.exe",
    category: "系统"
  },
  {
    name: "记事本",
    uri: "notepad.exe",
    category: "应用"
  },
  {
    name: "计算器",
    uri: "calc.exe",
    category: "应用"
  },
  {
    name: "画图",
    uri: "mspaint.exe",
    category: "应用"
  },
  {
    name: "截图工具",
    uri: "snippingtool.exe",
    category: "应用"
  },
  {
    name: "放大镜工具",
    uri: "magnify.exe",
    category: "辅助"
  },
  {
    name: "字符映射表",
    uri: "charmap.exe",
    category: "应用"
  },
  {
    name: "远程桌面连接",
    uri: "mstsc.exe",
    category: "系统"
  },
  {
    name: "系统配置",
    uri: "msconfig.exe",
    category: "系统"
  },
  {
    name: "磁盘清理",
    uri: "cleanmgr.exe",
    category: "系统"
  },
  {
    name: "磁盘碎片整理",
    uri: "dfrgui.exe",
    category: "系统"
  },
  {
    name: "系统信息工具",
    uri: "msinfo32.exe",
    category: "系统"
  },
  {
    name: "步骤记录器",
    uri: "psr.exe",
    category: "系统"
  },
  // 高级功能（10项）
  {
    name: "键盘属性",
    uri: "control.exe keyboard",
    category: "设备"
  },
  {
    name: "声音属性",
    uri: "mmsys.cpl",
    category: "系统"
  },
  {
    name: "添加打印机",
    uri: "printui.exe",
    category: "设备"
  },
  {
    name: "系统还原",
    uri: "rstrui.exe",
    category: "系统"
  },
  {
    name: "DirectX 诊断工具",
    uri: "dxdiag.exe",
    category: "系统"
  },
  {
    name: "程序兼容性助手",
    uri: "msdt.exe -id PCWDiagnostic",
    category: "系统"
  },
  {
    name: "内存诊断工具",
    uri: "MdSched.exe",
    category: "系统"
  },
  {
    name: "Windows 功能",
    uri: "optionalfeatures.exe",
    category: "系统"
  },
  {
    name: "打开运行",
    uri: "rundll32 shell32.dll,#61",
    category: "系统"
  },
  {
    name: "关于 Windows",
    uri: "winver.exe",
    category: "系统"
  }
];
const WINDOWS_SETTINGS = allSettings;
const screenWindow = (cb) => {
  ScreenCapture.start((result) => {
    if (result.success) {
      const image = electron.clipboard.readImage();
      const bounds = {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height
      };
      cb && cb(image.isEmpty() ? "" : image.toDataURL(), bounds);
    } else {
      cb && cb("");
    }
  });
};
const handleScreenShots = (cb) => {
  const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);
  child_process.exec(`screencapture -i -r "${tmpPath}"`, () => {
    if (fs.existsSync(tmpPath)) {
      try {
        const imageBuffer = fs.readFileSync(tmpPath);
        const base64Image = `data:image/png;base64,${imageBuffer.toString("base64")}`;
        cb(base64Image);
        fs.unlinkSync(tmpPath);
      } catch {
        cb("");
      }
    } else {
      cb("");
    }
  });
};
function commandExists(cmd) {
  try {
    child_process.execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function readTmpImage(tmpPath) {
  try {
    const imageBuffer = fs.readFileSync(tmpPath);
    const base64Image = `data:image/png;base64,${imageBuffer.toString("base64")}`;
    fs.unlinkSync(tmpPath);
    return base64Image;
  } catch {
    return "";
  }
}
const handleLinuxScreenShot = (cb) => {
  const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);
  const isWayland = !!process.env.WAYLAND_DISPLAY;
  const candidates = [];
  if (isWayland) {
    if (commandExists("grim") && commandExists("slurp")) {
      candidates.push(() => child_process.exec(`grim -g "$(slurp)" "${tmpPath}"`));
    }
    if (commandExists("gnome-screenshot")) {
      candidates.push(() => child_process.exec(`gnome-screenshot -a -f "${tmpPath}"`));
    }
  } else {
    if (commandExists("scrot")) {
      candidates.push(() => child_process.exec(`scrot -s "${tmpPath}"`));
    }
    if (commandExists("maim")) {
      candidates.push(() => child_process.exec(`maim -s "${tmpPath}"`));
    }
    if (commandExists("gnome-screenshot")) {
      candidates.push(() => child_process.exec(`gnome-screenshot -a -f "${tmpPath}"`));
    }
    if (commandExists("spectacle")) {
      candidates.push(() => child_process.exec(`spectacle -r -b -o "${tmpPath}"`));
    }
  }
  if (candidates.length === 0) {
    console.warn("[ScreenCapture] Linux 上未找到可用的截图工具（scrot/maim/gnome-screenshot/grim）");
    cb("");
    return;
  }
  const TIMEOUT_MS = 6e4;
  let done = false;
  let childProc = null;
  let timer = null;
  const finish = (image) => {
    if (done) return;
    done = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    cb(image);
  };
  try {
    childProc = candidates[0]();
    if (!childProc) {
      finish("");
      return;
    }
    childProc.on("close", () => {
      if (fs.existsSync(tmpPath)) {
        finish(readTmpImage(tmpPath));
      } else {
        finish("");
      }
    });
    childProc.on("error", () => {
      finish("");
    });
    timer = setTimeout(() => {
      console.warn("[ScreenCapture] 截图工具超时（60s），强制终止");
      if (childProc && !childProc.killed) {
        childProc.kill("SIGTERM");
      }
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
      }
      finish("");
    }, TIMEOUT_MS);
  } catch {
    finish("");
  }
};
const screenCapture = (mainWindow, restoreShowWindow = true) => {
  return new Promise((resolve) => {
    const wasVisible = mainWindow?.isVisible() || false;
    if (mainWindow && wasVisible) {
      mainWindow.hide();
    }
    const restoreWindow = () => {
      if (mainWindow && wasVisible && restoreShowWindow) {
        windowManager.showWindow();
      }
    };
    if (process.platform === "darwin") {
      handleScreenShots((image, bounds) => {
        restoreWindow();
        resolve({ image, bounds });
      });
    } else if (process.platform === "win32") {
      screenWindow((image, bounds) => {
        restoreWindow();
        resolve({ image, bounds });
      });
    } else {
      handleLinuxScreenShot((image) => {
        restoreWindow();
        resolve({ image, bounds: void 0 });
      });
    }
  });
};
function getSingleFilePathParam(param) {
  if (param?.type !== "files" || !Array.isArray(param.payload) || param.payload.length !== 1) {
    return void 0;
  }
  return typeof param.payload[0]?.path === "string" ? param.payload[0].path : void 0;
}
function getWindowsExplorerPath(windowInfo) {
  return getExplorerFolderPathFromWindow(windowInfo, "SystemCmd");
}
function escapePowerShellPath(folderPath) {
  const escaped = folderPath.replace(/'/g, "''");
  return `'${escaped}'`;
}
function escapeCmdPath(folderPath) {
  const escaped = folderPath.replace(/"/g, '^"');
  return `"${escaped}"`;
}
async function tryLaunchWindowsTerminal(folderPath) {
  const tryLaunch = (cmd, args) => {
    return new Promise((resolve) => {
      const child = child_process.spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", () => resolve(false));
      if (child.pid) {
        child.unref();
        resolve(true);
      }
    });
  };
  return await tryLaunch("wt.exe", ["-d", folderPath]) || await tryLaunch("powershell.exe", [
    "-NoExit",
    "-Command",
    `Set-Location -Path ${escapePowerShellPath(folderPath)}`
  ]) || await tryLaunch("cmd.exe", ["/K", `cd /d ${escapeCmdPath(folderPath)}`]);
}
async function executeSystemCommand(command, ctx, param) {
  const execAsync2 = util.promisify(child_process.exec);
  const platform2 = process.platform;
  let cmd = "";
  switch (command) {
    case "clear":
      return handleClear(ctx);
    case "clear-history":
      return handleClearHistory(ctx);
    case "reboot":
      if (platform2 === "darwin") {
        cmd = 'osascript -e "tell application \\"System Events\\" to restart"';
      } else if (platform2 === "win32") {
        cmd = "shutdown /r /t 0";
      } else if (platform2 === "linux") {
        cmd = "systemctl reboot";
      }
      break;
    case "shutdown":
      if (platform2 === "darwin") {
        cmd = 'osascript -e "tell application \\"System Events\\" to shut down"';
      } else if (platform2 === "win32") {
        cmd = "shutdown /s /t 0";
      } else if (platform2 === "linux") {
        cmd = "systemctl poweroff";
      }
      break;
    case "logoff":
      if (platform2 === "darwin") {
        cmd = 'osascript -e "tell application \\"System Events\\" to log out"';
      } else if (platform2 === "win32") {
        cmd = "shutdown /l";
      } else if (platform2 === "linux") {
        cmd = "gnome-session-quit --logout --no-prompt || xfce4-session-logout --logout || qdbus org.kde.ksmserver /KSMServer logout 0 0 0 || loginctl terminate-user $USER";
      }
      break;
    case "sleep":
      if (platform2 === "darwin") {
        cmd = 'osascript -e "tell application \\"System Events\\" to sleep"';
      } else if (platform2 === "win32") {
        ctx.mainWindow?.hide();
        cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"`;
      } else if (platform2 === "linux") {
        cmd = "systemctl suspend";
      }
      break;
    // 锁定屏幕：macOS 使用 AppleScript 模拟 Ctrl+Cmd+Q，Windows 调用 user32.dll LockWorkStation
    case "lock-screen":
      if (platform2 === "darwin") {
        cmd = 'osascript -e "tell application \\"System Events\\" to keystroke \\"q\\" using {control down, command down}"';
      } else if (platform2 === "win32") {
        cmd = "rundll32.exe user32.dll,LockWorkStation";
      } else if (platform2 === "linux") {
        cmd = "xdg-screensaver lock || gnome-screensaver-command -l";
      }
      break;
    case "search":
    case "bing-search":
      if (command === "search") {
        return handleWebSearch(ctx, param, "https://www.baidu.com/s?wd={q}", "百度搜索");
      }
      return handleWebSearch(ctx, param, "https://www.bing.com/search?q={q}", "必应搜索");
    case "open-url":
      return handleOpenUrl(ctx, param);
    case "open-folder":
      return handleOpenFolder(ctx, param);
    case "window-info":
      return handleWindowInfo(ctx);
    case "copy-path":
      return handleCopyPath(ctx, execAsync2, param);
    case "open-terminal":
      return handleOpenTerminal(ctx, execAsync2, param);
    case "color-picker":
      return handleColorPicker(ctx);
    case "screenshot":
      return handleScreenshot(ctx);
    case "add-to-wakeup-blacklist":
      return handleAddToWakeupBlacklist(ctx);
    default:
      if (command.startsWith("web-search-")) {
        return handleDynamicWebSearch(ctx, param, command);
      }
      return { success: false, error: `Unknown system command: ${command}` };
  }
  if (!cmd) {
    return { success: false, error: `Unsupported platform: ${platform2}` };
  }
  console.log("[SystemCmd] 执行系统命令:", cmd);
  try {
    const { stdout, stderr } = await execAsync2(cmd);
    if (stderr) console.error("[SystemCmd] 系统命令错误输出:", stderr);
    if (stdout) console.log("[SystemCmd] 系统命令输出:", stdout);
    ctx.mainWindow?.webContents.send("app-launched");
    ctx.mainWindow?.hide();
    return { success: true };
  } catch (error) {
    console.error("[SystemCmd] 执行系统命令失败:", error);
    return { success: false, error: String(error) };
  }
}
function handleClear(ctx) {
  console.log("[SystemCmd] 执行 Clear 指令：停止所有插件");
  if (ctx.pluginManager) {
    ctx.pluginManager.killAllPlugins();
  }
  ctx.mainWindow?.webContents.send("app-launched");
  return { success: true };
}
function handleClearHistory(ctx) {
  console.log("[SystemCmd] 执行清除使用记录");
  try {
    databaseAPI.dbPut("command-history", []);
    ctx.mainWindow?.webContents.send("history-changed");
    ctx.mainWindow?.webContents.send("app-launched");
    ctx.mainWindow?.hide();
    console.log("[SystemCmd] 使用记录已清除");
    return { success: true };
  } catch (error) {
    console.error("[SystemCmd] 清除使用记录失败:", error);
    return { success: false, error: String(error) };
  }
}
async function handleWebSearch(ctx, param, urlTemplate, label) {
  console.log(`[SystemCmd] 执行${label}:`, param);
  if (param?.payload) {
    const query = encodeURIComponent(param.payload);
    const url2 = urlTemplate.replace("{q}", query);
    await electron.shell.openExternal(url2);
    ctx.mainWindow?.webContents.send("app-launched");
    ctx.mainWindow?.hide();
    return { success: true };
  }
  return { success: false, error: "缺少搜索关键词" };
}
async function handleDynamicWebSearch(ctx, param, featureCode) {
  console.log("[SystemCmd] 执行网页快开搜索:", featureCode, param);
  const engine = await webSearchAPI.getEngineByFeatureCode(featureCode);
  if (!engine) {
    return { success: false, error: "未找到搜索引擎配置" };
  }
  if (engine.type === "webpage") {
    return handleOpenWebpage(ctx, engine.url, engine.name);
  }
  return handleWebSearch(ctx, param, engine.url, engine.name);
}
async function handleOpenWebpage(ctx, url2, label) {
  console.log(`[SystemCmd] 打开网页 ${label}:`, url2);
  if (!url2) {
    return { success: false, error: "缺少网页地址" };
  }
  await electron.shell.openExternal(url2);
  ctx.mainWindow?.webContents.send("app-launched");
  ctx.mainWindow?.hide();
  return { success: true };
}
async function handleScreenshot(ctx) {
  console.log("[SystemCmd] 执行截图");
  try {
    const result = await screenCapture(ctx.mainWindow || void 0, false);
    if (!result.image) {
      return { success: false, error: "未获取到截图内容" };
    }
    electron.clipboard.writeImage(electron.nativeImage.createFromDataURL(result.image));
    new electron.Notification({
      title: "ZTools",
      body: "截图已复制到剪贴板"
    }).show();
    return { success: true };
  } catch (error) {
    console.error("[SystemCmd] 截图失败:", error);
    return { success: false, error: String(error) };
  }
}
async function handleOpenUrl(ctx, param) {
  console.log("[SystemCmd] 打开网址:", param);
  if (param?.payload) {
    let url2 = param.payload.trim();
    if (!url2.match(/^https?:\/\//i)) {
      url2 = `https://${url2}`;
    }
    await electron.shell.openExternal(url2);
    ctx.mainWindow?.webContents.send("app-launched");
    ctx.mainWindow?.hide();
    return { success: true };
  }
  return { success: false, error: "缺少网址" };
}
function handleWindowInfo(ctx) {
  console.log("[SystemCmd] 执行窗口信息");
  const winInfo = windowManager.getPreviousActiveWindow();
  ctx.mainWindow?.hide();
  const items = [
    { label: "窗口标题", value: winInfo?.title || "未知" },
    { label: "坐标 X", value: winInfo?.x ?? "未知" },
    { label: "坐标 Y", value: winInfo?.y ?? "未知" },
    { label: "窗口宽度", value: winInfo?.width ?? "未知" },
    { label: "窗口高度", value: winInfo?.height ?? "未知" },
    { label: "进程 ID", value: winInfo?.pid ?? "未知" },
    { label: "应用", value: winInfo?.app || "未知" },
    { label: "应用位置", value: winInfo?.appPath || "未知" }
  ];
  if (process.platform === "darwin" && winInfo?.bundleId) {
    items.push({ label: "应用 ID", value: winInfo.bundleId });
  }
  const infoRows = items.map(
    (item) => `<div class="row"><span class="label">${item.label}</span><span class="value">${item.value}</span></div>`
  ).join("");
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
  }
  .container {
    padding: 32px 40px;
    min-width: 420px;
    -webkit-app-region: no-drag;
    user-select: text;
    cursor: text;
  }
  .title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 24px;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.5px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .row:last-child { border-bottom: none; }
  .label {
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    flex-shrink: 0;
    margin-right: 20px;
  }
  .value {
    color: rgba(255, 255, 255, 0.95);
    font-size: 13px;
    font-family: "SF Mono", "Menlo", monospace;
    text-align: right;
    word-break: break-all;
  }
  .hint {
    margin-top: 20px;
    text-align: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
  }
</style>
</head>
<body>
  <div class="container">
    <div class="title">窗口信息</div>
    ${infoRows}
    <div class="hint">点击窗口外部区域关闭</div>
  </div>
</body>
</html>`;
  const infoWindow = new electron.BrowserWindow({
    width: 500,
    height: 460,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  infoWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  infoWindow.webContents.on("did-finish-load", () => {
    infoWindow.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS);
  });
  infoWindow.on("blur", () => {
    if (!infoWindow.isDestroyed()) {
      infoWindow.close();
    }
  });
  return { success: true };
}
async function handleCopyPath(ctx, execAsync2, param) {
  const filePath = getSingleFilePathParam(param);
  console.log("[SystemCmd] 执行复制路径", filePath ? `(剪贴板文件: ${filePath})` : "(从窗口获取)");
  if (filePath) {
    electron.clipboard.writeText(filePath);
    console.log("[SystemCmd] 已复制路径:", filePath);
    ctx.mainWindow?.hide();
    return { success: true, path: filePath };
  }
  const windowInfo = param?.type === "window" && param?.payload || windowManager.getPreviousActiveWindow();
  if (!windowInfo) {
    return { success: false, error: "无法获取当前窗口信息" };
  }
  if (process.platform === "win32") {
    const folderPath = getWindowsExplorerPath(windowInfo);
    if (!folderPath) {
      return { success: false, error: '未读取到当前 "文件资源管理器" 窗口目录' };
    }
    electron.clipboard.writeText(folderPath);
    console.log("[SystemCmd] 已复制路径:", folderPath);
    ctx.mainWindow?.hide();
    return { success: true, path: folderPath };
  }
  if (process.platform === "darwin") {
    try {
      const script = `
      tell application "Finder"
        if (count of Finder windows) is 0 then
          return POSIX path of (desktop as alias)
        else
          return POSIX path of (target of front window as alias)
        end if
      end tell
    `;
      const { stdout } = await execAsync2(`osascript -e '${script}'`);
      const folderPath = stdout.trim();
      electron.clipboard.writeText(folderPath);
      console.log("[SystemCmd] 已复制路径:", folderPath);
      ctx.mainWindow?.hide();
      return { success: true, path: folderPath };
    } catch (error) {
      console.error("[SystemCmd] 获取 Finder 路径失败:", error);
      return { success: false, error: String(error) };
    }
  }
  return { success: false, error: `不支持的平台: ${process.platform}` };
}
async function openTerminalOnMac(folderPath, execAsync2) {
  const script = `
    tell application "Terminal"
      activate
      do script "cd " & quoted form of "${folderPath}"
    end tell
  `;
  await execAsync2(`osascript -e '${script}'`);
}
async function openTerminalOnLinux(folderPath) {
  const tryLaunch = (cmd, args) => {
    return new Promise((resolve) => {
      const child = child_process.spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", () => resolve(false));
      if (child.pid) {
        child.unref();
        resolve(true);
      }
    });
  };
  return await tryLaunch("exo-open", [
    "--launch",
    "TerminalEmulator",
    "--working-directory",
    folderPath
  ]) || await tryLaunch("gnome-terminal", [`--working-directory=${folderPath}`]) || await tryLaunch("xterm", ["-cd", folderPath]);
}
async function getMacFinderPath(execAsync2) {
  const script = `
    tell application "Finder"
      if (count of Finder windows) is 0 then
        return POSIX path of (desktop as alias)
      else
        return POSIX path of (target of front window as alias)
      end if
    end tell
  `;
  const { stdout } = await execAsync2(`osascript -e '${script}'`);
  return stdout.trim();
}
async function handleOpenTerminal(ctx, execAsync2, param) {
  const folderPath = getSingleFilePathParam(param);
  console.log(
    "[SystemCmd] 执行在终端打开",
    folderPath ? `(剪贴板文件夹: ${folderPath})` : "(从窗口获取)"
  );
  try {
    let targetPath = folderPath ?? null;
    if (!targetPath) {
      const windowInfo = param?.type === "window" && param?.payload || windowManager.getPreviousActiveWindow();
      if (!windowInfo) {
        return { success: false, error: "无法获取当前窗口信息" };
      }
      if (process.platform === "darwin") {
        targetPath = await getMacFinderPath(execAsync2);
      } else if (process.platform === "win32") {
        targetPath = getWindowsExplorerPath(windowInfo);
        if (!targetPath) {
          return { success: false, error: "无法获取资源管理器路径" };
        }
      } else if (process.platform === "linux") {
        targetPath = os.homedir();
      }
    }
    if (!targetPath) {
      return { success: false, error: "无法确定目标路径" };
    }
    if (process.platform === "darwin") {
      await openTerminalOnMac(targetPath, execAsync2);
    } else if (process.platform === "linux") {
      const launched = await openTerminalOnLinux(targetPath);
      if (!launched) {
        throw new Error("Could not find a supported terminal emulator");
      }
    } else if (process.platform === "win32") {
      const launched = await tryLaunchWindowsTerminal(targetPath);
      if (!launched) {
        return { success: false, error: "无法启动终端" };
      }
    } else {
      return { success: false, error: `不支持的平台: ${process.platform}` };
    }
    console.log("[SystemCmd] 已在终端打开:", targetPath);
    ctx.mainWindow?.webContents.send("app-launched");
    ctx.mainWindow?.hide();
    return { success: true };
  } catch (error) {
    console.error("[SystemCmd] 在终端打开失败:", error);
    return { success: false, error: String(error) };
  }
}
async function handleOpenFolder(ctx, param) {
  console.log("[SystemCmd] 前往文件夹:", param);
  if (!param?.payload) {
    return { success: false, error: "缺少路径" };
  }
  let targetPath = param.payload.trim();
  if (targetPath.startsWith("~")) {
    const os2 = await import("os");
    targetPath = os2.homedir() + targetPath.slice(1);
  }
  const fs2 = await import("fs");
  let stat = null;
  try {
    stat = fs2.statSync(targetPath);
  } catch {
  }
  if (stat && stat.isFile()) {
    electron.shell.showItemInFolder(targetPath);
    ctx.mainWindow?.webContents.send("app-launched");
    ctx.mainWindow?.hide();
    return { success: true };
  }
  const errorMessage = await electron.shell.openPath(targetPath);
  if (errorMessage) {
    console.error("[SystemCmd] 前往文件夹失败:", errorMessage);
    return { success: false, error: errorMessage };
  }
  ctx.mainWindow?.webContents.send("app-launched");
  ctx.mainWindow?.hide();
  return { success: true };
}
function handleColorPicker(ctx) {
  console.log("[SystemCmd] 执行屏幕取色");
  ctx.mainWindow?.hide();
  return new Promise((resolve) => {
    try {
      ColorPicker.start((result) => {
        if (result.success && result.hex) {
          electron.clipboard.writeText(result.hex);
          console.log("[SystemCmd] 已复制颜色值:", result.hex);
          if (electron.Notification.isSupported()) {
            new electron.Notification({ title: "ZTools", body: `已复制颜色值: ${result.hex}` }).show();
          }
          resolve({ success: true, hex: result.hex });
        } else {
          console.log("[SystemCmd] 取色已取消");
          resolve({ success: false, error: "取色已取消" });
        }
      });
    } catch (error) {
      console.error("[SystemCmd] 取色失败:", error);
      resolve({ success: false, error: String(error) });
    }
  });
}
function handleAddToWakeupBlacklist(ctx) {
  const winInfo = windowManager.getPreviousActiveWindow();
  if (!winInfo?.app) {
    return { success: false, error: "无法获取当前窗口信息" };
  }
  const settings = databaseAPI.dbGet("settings-general") || {};
  const blacklist = settings.wakeupBlacklist ?? [];
  const isDuplicate = process.platform === "darwin" && winInfo.bundleId ? blacklist.some((item) => item.bundleId === winInfo.bundleId) : blacklist.some((item) => item.app.toLowerCase() === winInfo.app.toLowerCase());
  if (isDuplicate) {
    ctx.mainWindow?.hide();
    if (electron.Notification.isSupported()) {
      new electron.Notification({ title: "ZTools", body: `${winInfo.app} 已在唤醒黑名单中` }).show();
    }
    return { success: false, error: "该应用已在唤醒黑名单中" };
  }
  const label = winInfo.app.replace(/\.(exe|app)$/i, "");
  blacklist.push({
    app: winInfo.app,
    bundleId: winInfo.bundleId,
    label
  });
  databaseAPI.dbPut("settings-general", { ...settings, wakeupBlacklist: blacklist });
  windowManager.updateWakeupBlacklist(blacklist);
  ctx.mainWindow?.hide();
  if (electron.Notification.isSupported()) {
    new electron.Notification({
      title: "ZTools",
      body: `已将 ${label} 添加到唤醒黑名单`
    }).show();
  }
  return { success: true };
}
function isDirectApp(item, type) {
  return item?.type === "direct" || item?.type === "app" && type === "app";
}
function findCommandIndex(list, appPath, type, featureCode, name) {
  return list.findIndex((item) => {
    if (item.type === "plugin" && type === "plugin") {
      if (item.featureCode !== featureCode) {
        return false;
      }
      if (name && item.pluginName) {
        return item.pluginName === name;
      }
      return item.path === appPath;
    }
    if (isDirectApp(item, type)) {
      if (name) {
        return item.path === appPath && item.name === name;
      }
      return item.path === appPath;
    }
    if (name) {
      return item.path === appPath && item.name === name;
    }
    return item.path === appPath;
  });
}
function filterOutCommand(list, appPath, featureCode, name) {
  return list.filter((item) => {
    if (item.type === "plugin" && featureCode !== void 0) {
      if (item.featureCode !== featureCode) {
        return true;
      }
      if (name && item.pluginName) {
        return item.pluginName !== name;
      }
      return item.path !== appPath;
    }
    if (isDirectApp(item, item?.type)) {
      if (name) {
        return !(item.path === appPath && item.name === name);
      }
      return item.path !== appPath;
    }
    if (name) {
      return !(item.path === appPath && item.name === name);
    }
    return item.path !== appPath;
  });
}
function hasCommand(list, appPath, featureCode, name) {
  return list.some((item) => {
    if (item.type === "plugin" && featureCode !== void 0) {
      if (item.featureCode !== featureCode) {
        return false;
      }
      if (name && item.pluginName) {
        return item.pluginName === name;
      }
      return item.path === appPath;
    }
    if (isDirectApp(item, item?.type)) {
      if (name) {
        return item.path === appPath && item.name === name;
      }
      return item.path === appPath;
    }
    if (name) {
      return item.path === appPath && item.name === name;
    }
    return item.path === appPath;
  });
}
class SystemSettingsAPI {
  init() {
  }
  async getSystemSettings() {
    if (process.platform === "win32") {
      return WINDOWS_SETTINGS;
    }
    return [];
  }
  isWindows() {
    return process.platform === "win32";
  }
}
const systemSettingsAPI = new SystemSettingsAPI();
class AppsAPI {
  static APP_CACHE_VERSION = 3;
  static APP_CACHE_VERSION_KEY = "cached-commands-version";
  mainWindow = null;
  pluginManager = null;
  launchParam = null;
  lastMatchState = null;
  isLocalAppSearchEnabled = true;
  cachedCommandsResult = null;
  /** 由外部注入，用于在多屏场景下正确显示窗口（跟随光标所在屏幕） */
  showWindowCallback;
  setShowWindowCallback(callback) {
    this.showWindowCallback = callback;
  }
  /**
   * 安全地向渲染进程发送消息
   */
  notifyRenderer(channel, ...args) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }
  init(mainWindow, pluginManager2) {
    this.mainWindow = mainWindow;
    this.pluginManager = pluginManager2;
    this.setupIPC();
    this.loadLastMatchState();
    this.loadLocalAppSearchSetting();
  }
  getLaunchParam() {
    return this.launchParam;
  }
  invalidateCommandsCache(notifyRenderer = false) {
    this.cachedCommandsResult = null;
    console.log("[Commands] 指令缓存已清空:", { notifyRenderer });
    if (notifyRenderer) {
      console.log("[Commands] 发送 apps-changed 通知，触发主窗口重载指令与 alias 搜索索引");
      this.notifyRenderer("apps-changed");
    }
  }
  /**
   * 根据名称查找直接启动指令（系统应用、系统设置等）
   */
  async findDirectCommandByName(name) {
    const { commands } = await this.getCommands();
    return commands.find((cmd) => cmd.type === "direct" && cmd.name === name) || null;
  }
  setupIPC() {
    electron.ipcMain.handle("get-apps", () => this.getApps());
    electron.ipcMain.handle("get-commands", () => this.getCommands());
    electron.ipcMain.handle("launch", (_event, options) => this.launch(options));
    electron.ipcMain.handle(
      "launch-as-admin",
      (_event, appPath, name) => this.launchAsAdmin(appPath, name)
    );
    electron.ipcMain.handle("refresh-apps-cache", () => this.refreshAppsCache());
    electron.ipcMain.handle(
      "remove-from-history",
      (_event, appPath, featureCode, name) => this.removeFromHistory(appPath, featureCode, name)
    );
    electron.ipcMain.handle("pin-app", (_event, app2) => this.pinApp(app2));
    electron.ipcMain.handle(
      "unpin-app",
      (_event, appPath, featureCode, name) => this.unpinApp(appPath, featureCode, name)
    );
    electron.ipcMain.handle(
      "update-pinned-order",
      (_event, newOrder) => this.updatePinnedOrder(newOrder)
    );
    electron.ipcMain.handle("get-last-match-state", () => this.getLastMatchState());
    electron.ipcMain.handle("restore-last-match", () => this.restoreLastMatch());
    electron.ipcMain.handle("get-usage-stats", () => this.getUsageStats());
  }
  /**
   * 设置本地应用搜索开启状态
   */
  setLocalAppSearch(enabled) {
    this.isLocalAppSearchEnabled = enabled;
    this.invalidateCommandsCache(true);
    console.log("[Commands] 本地应用搜索已" + (enabled ? "开启" : "关闭"));
  }
  /**
   * 加载本地应用搜索设置
   */
  loadLocalAppSearchSetting() {
    try {
      const data = databaseAPI.dbGet("settings-general");
      if (data && typeof data.localAppSearch === "boolean") {
        this.isLocalAppSearchEnabled = data.localAppSearch;
      }
      console.log("[Commands] 加载本地应用搜索设置:", this.isLocalAppSearchEnabled);
    } catch (error) {
      console.error("[Commands] 加载本地应用搜索设置失败:", error);
    }
  }
  /**
   * 获取使用统计
   */
  getUsageStats() {
    try {
      const stats = databaseAPI.dbGet("command-usage-stats");
      return stats || [];
    } catch (error) {
      console.error("[Commands] 获取使用统计失败:", error);
      return [];
    }
  }
  /**
   * 获取系统应用列表，并处理图标缓存
   * 优先从数据库缓存读取，没有缓存时才扫描
   */
  async getApps() {
    console.log("[Commands] 收到获取应用列表请求");
    if (!this.isLocalAppSearchEnabled) {
      console.log("[Commands] 本地应用搜索已关闭，返回空列表");
      return [];
    }
    if (!electron.app.isPackaged) {
      console.log("[Commands] 开发模式：跳过缓存，重新扫描应用...");
      return await this.scanAndCacheApps();
    }
    try {
      const cachedApps = databaseAPI.dbGet("cached-commands");
      const cacheVersion = databaseAPI.dbGet(AppsAPI.APP_CACHE_VERSION_KEY);
      if (cachedApps && Array.isArray(cachedApps) && cachedApps.length > 0) {
        const hasOldFormat = cachedApps.some(
          (app2) => app2.icon && !app2.icon.startsWith("ztools-icon://") && !app2.icon.startsWith("data:") && !app2.icon.startsWith("http") && // Windows 上的静态 png 资源除外（通常是手动转换的）
          !(process.platform === "win32" && app2.icon.startsWith("file:") && app2.icon.endsWith(".png"))
        );
        if (cacheVersion !== AppsAPI.APP_CACHE_VERSION) {
          console.log("[Commands] 检测到旧版应用缓存，将重新扫描以刷新本地化名称索引...");
        } else if (hasOldFormat) {
          console.log("[Commands] 检测到旧格式图标缓存，将重新扫描并更新为 ztools-icon 协议...");
        } else {
          console.log(`从缓存读取到 ${cachedApps.length} 个应用`);
          return cachedApps;
        }
      }
    } catch (error) {
      console.log("[Commands] 读取应用缓存失败，将进行扫描:", error);
    }
    console.log("[Commands] 缓存不存在，开始扫描应用...");
    return await this.scanAndCacheApps();
  }
  /**
   * 扫描应用并缓存到数据库
   */
  async scanAndCacheApps() {
    const apps = await scanApplications();
    console.log(`扫描到 ${apps.length} 个应用`);
    if (process.platform === "win32") {
      try {
        const uwpApps = UwpManager.getUwpApps();
        console.log(`获取到 ${uwpApps.length} 个 UWP 应用`);
        for (const uwpApp of uwpApps) {
          const uwpPath = `uwp:${uwpApp.appId}`;
          const dedupeKey = `${uwpApp.name.toLowerCase()}|${uwpPath.toLowerCase()}`;
          const isDuplicate = apps.some(
            (a) => `${a.name.toLowerCase()}|${a.path.toLowerCase()}` === dedupeKey
          );
          if (isDuplicate) continue;
          apps.push({
            name: uwpApp.name,
            path: uwpPath,
            icon: uwpApp.icon || ""
          });
        }
        console.log(`合并 UWP 后共 ${apps.length} 个应用`);
      } catch (error) {
        console.error("[Commands] 获取 UWP 应用失败:", error);
      }
    }
    try {
      databaseAPI.dbPut("cached-commands", apps);
      databaseAPI.dbPut(AppsAPI.APP_CACHE_VERSION_KEY, AppsAPI.APP_CACHE_VERSION);
      console.log("[Commands] 应用列表已缓存到数据库");
    } catch (error) {
      console.error("[Commands] 缓存应用列表失败:", error);
    }
    return apps;
  }
  /**
   * 刷新应用缓存（当检测到应用文件夹变化时调用）
   */
  async refreshAppsCache() {
    if (!this.isLocalAppSearchEnabled) {
      console.log("[Commands] 本地应用搜索已关闭，跳过刷新缓存");
      return;
    }
    console.log("[Commands] 开始刷新应用缓存...");
    try {
      await this.scanAndCacheApps();
      this.invalidateCommandsCache(true);
      console.log("[Commands] 应用缓存刷新成功");
    } catch (error) {
      console.error("[Commands] 刷新应用缓存失败:", error);
    }
  }
  /**
   * 纯启动编排：负责管理插件载入前的主窗口占位、自动分离、复用已分离窗口等逻辑
   */
  async preparePluginLaunch(options, pluginConfig) {
    if (!this.pluginManager) {
      return { success: false, error: "Plugin Manager 未初始化" };
    }
    const { path: appPath, featureCode, name } = options;
    const plugin = this.getPluginsFromDB().find((p) => p.path === appPath);
    const effectiveName = plugin?.name;
    let shouldAutoDetach = false;
    if (pluginConfig && effectiveName) {
      try {
        const autoDetachPlugins = databaseAPI.dbGet("autoDetachPlugin") || [];
        if (Array.isArray(autoDetachPlugins) && autoDetachPlugins.includes(effectiveName)) {
          shouldAutoDetach = true;
          console.log(`插件 ${effectiveName} 配置为自动分离，直接在独立窗口中创建`);
        }
      } catch (error) {
        console.error("[Commands] 检查自动分离配置失败:", error);
      }
    }
    const reusedDetached = await this.pluginManager.reuseDetachedSingletonIfExists(
      appPath,
      featureCode,
      "launch-precheck"
    );
    if (reusedDetached) {
      console.log("[Commands] 目标插件已在分离窗口运行，跳过主窗口占位态:", {
        path: appPath,
        featureCode
      });
      return { success: true };
    }
    if (shouldAutoDetach) {
      const result = await this.pluginManager.createPluginInDetachedWindow(appPath, featureCode);
      if (!result.success) {
        console.error("[Commands] 在独立窗口中创建插件失败:", result.error);
        this.notifyRenderer("show-plugin-placeholder");
        await this.pluginManager.createPluginView(appPath, featureCode, name);
      } else {
        this.mainWindow?.hide();
      }
    } else {
      this.notifyRenderer("show-plugin-placeholder");
      if (!this.mainWindow?.isVisible()) {
        if (this.showWindowCallback) {
          this.showWindowCallback();
        } else {
          this.mainWindow?.show();
        }
      }
      await this.pluginManager.createPluginView(appPath, featureCode, name);
    }
    return { success: true };
  }
  /**
   * 启动应用或插件（统一接口）
   */
  async launch(options) {
    const { path: appPath, type, param, name, cmdType, confirmDialog } = options;
    let { featureCode } = options;
    this.launchParam = param || {};
    try {
      if (type === "plugin") {
        if (pluginsAPI.isPluginDisabled(appPath)) {
          return { success: false, error: "插件已禁用" };
        }
        if (!featureCode) {
          const result = await this.getDefaultFeatureCode(appPath);
          if (!result.success) {
            return { success: false, error: result.error };
          }
          featureCode = result.featureCode;
        }
        this.launchParam.code = featureCode || "";
        console.log("[Commands] 启动插件:", {
          path: appPath,
          featureCode,
          name,
          launchParam: this.launchParam
        });
        this.updateUsageStats({ path: appPath, type, featureCode, name });
        if (cmdType === "window") {
          console.log("[Commands] window 类型命令，跳过历史记录");
        } else if (["img", "over", "files", "regex"].includes(cmdType || "")) {
          const inputState = param?.inputState || {};
          if (param?.inputState) {
            this.lastMatchState = {
              searchQuery: inputState.searchQuery || "",
              pastedImage: inputState.pastedImage || null,
              pastedFiles: inputState.pastedFiles || null,
              pastedText: inputState.pastedText || null,
              timestamp: Date.now()
            };
            console.log("[Commands] 保存上次匹配状态:", this.lastMatchState);
            this.saveLastMatchState();
            this.removeFromHistory("special:last-match");
            this.addToHistory({
              path: "special:last-match",
              type: "plugin",
              name: "上次匹配",
              cmdType: "text"
            });
          }
        } else {
          this.addToHistory({ path: appPath, type, featureCode, param, name, cmdType });
        }
        let pluginConfig = null;
        try {
          const pluginJsonPath = path.join(appPath, "plugin.json");
          pluginConfig = JSON.parse(await fs.promises.readFile(pluginJsonPath, "utf-8"));
        } catch (error) {
          console.error("[Commands] 读取 plugin.json 失败:", error);
        }
        if (pluginConfig?.name === "system") {
          console.log("[Commands] 检测到 system 插件，执行系统命令:", featureCode);
          return await executeSystemCommand(
            featureCode || "",
            {
              mainWindow: this.mainWindow,
              pluginManager: this.pluginManager
            },
            param
          );
        }
        return await this.preparePluginLaunch(
          {
            path: appPath,
            featureCode: featureCode || "",
            name
          },
          pluginConfig
        );
      } else if (type === "file") {
        console.log("[Commands] 在文件管理器中定位:", appPath);
        electron.shell.showItemInFolder(appPath);
        this.addToHistory({ path: appPath, type: "file", name, cmdType: "text" });
        this.pluginManager?.hidePluginView();
        this.notifyRenderer("app-launched");
        this.mainWindow?.hide();
      } else {
        const localShortcuts = databaseAPI.dbGet("local-shortcuts");
        const isLocalShortcut = localShortcuts?.some((s) => s.path === appPath);
        if (isLocalShortcut) {
          const result = await electron.shell.openPath(appPath);
          if (result) {
            console.error("[Commands] 打开本地启动项失败:", result);
            throw new Error(`打开失败: ${result}`);
          }
        } else {
          await launchApp(appPath, confirmDialog);
        }
        this.addToHistory({ path: appPath, type: type || "app", name, cmdType: "text" });
        this.pluginManager?.hidePluginView();
        this.notifyRenderer("app-launched");
        this.mainWindow?.hide();
      }
    } catch (error) {
      console.error("[Commands] 启动失败:", error);
      throw error;
    }
  }
  /**
   * 以管理员身份启动应用（仅 Windows）
   */
  launchAsAdmin(appPath, name) {
    if (process.platform !== "win32") {
      throw new Error("仅支持 Windows 平台");
    }
    try {
      const escapedPath = appPath.replace(/'/g, "''");
      let psCommand;
      if (appPath.toLowerCase().endsWith(".lnk")) {
        psCommand = [
          `$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut('${escapedPath}');`,
          `$sp = @{ FilePath = $lnk.TargetPath; Verb = 'RunAs' };`,
          `if ($lnk.Arguments) { $sp.ArgumentList = $lnk.Arguments };`,
          `Start-Process @sp`
        ].join(" ");
      } else {
        psCommand = `Start-Process -FilePath '${escapedPath}' -Verb RunAs`;
      }
      console.log(`[Commands] 以管理员身份启动: ${appPath}`);
      console.log(`[Commands] PowerShell 命令: ${psCommand}`);
      child_process.execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
        (error, _stdout, stderr) => {
          if (error) {
            console.error("[Commands] 管理员启动失败:", error.message);
          }
          if (stderr) {
            console.error("[Commands] 管理员启动 stderr:", stderr);
          }
        }
      );
      console.log(`[Commands] 以管理员身份启动: ${appPath}`);
      this.addToHistory({ path: appPath, type: "direct", name, cmdType: "text" });
      this.pluginManager?.hidePluginView();
      this.notifyRenderer("app-launched");
      this.mainWindow?.hide();
    } catch (error) {
      console.error("[Commands] 管理员启动失败:", error);
      throw error;
    }
  }
  /**
   * 添加到历史记录
   */
  async addToHistory(options) {
    try {
      const { path: appPath, type = "app", featureCode, name: cmdName, cmdType } = options;
      console.log("[Commands] 添加指令到历史记录:", cmdName, "类型:", cmdType || "text");
      const now = Date.now();
      let appInfo = null;
      if (appPath.startsWith("special:") || appPath.startsWith("builtin:")) {
        const cachedApps = databaseAPI.dbGet("cached-commands");
        const cachedBuiltin = cachedApps?.find((a) => a.path === appPath);
        appInfo = {
          name: cmdName || appPath,
          path: appPath,
          icon: cachedBuiltin?.icon,
          // 从缓存中获取图标
          type: "builtin",
          cmdType: cmdType || "text"
        };
      } else if (type === "plugin") {
        const dbPlugins = this.getPluginsFromDB();
        const plugin = dbPlugins.find((p) => p.path === appPath);
        if (plugin) {
          const pluginJsonPath = path.join(appPath, "plugin.json");
          try {
            const pluginConfig = JSON.parse(await fs.promises.readFile(pluginJsonPath, "utf-8"));
            let feature = pluginConfig.features?.find((f) => f.code === featureCode);
            if (!feature) {
              const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name);
              feature = dynamicFeatures.find((f) => f.code === featureCode);
            }
            let featureIcon = feature?.icon || plugin.logo || "";
            if (featureIcon) {
              featureIcon = normalizeIconPath(featureIcon, appPath);
            }
            appInfo = {
              name: cmdName || pluginConfig.name,
              // 优先使用传入的 cmd 名称
              path: appPath,
              icon: featureIcon,
              type: "plugin",
              featureCode,
              pluginName: plugin.name,
              // 有效名（开发版含 __dev 后缀）
              pluginExplain: feature?.explain || "",
              cmdType: cmdType || "text"
            };
          } catch (error) {
            console.error("[Commands] 读取插件配置失败:", error);
            return;
          }
        }
      } else {
        const cachedApps = databaseAPI.dbGet("cached-commands");
        const app2 = cachedApps?.find((a) => a.path === appPath);
        if (app2) {
          appInfo = {
            name: cmdName || app2.name,
            // 优先使用传入的 cmd 名称
            originalName: app2.name,
            path: app2.path,
            icon: app2.icon,
            pinyin: app2.pinyin,
            pinyinAbbr: app2.pinyinAbbr,
            type: "direct",
            subType: "app",
            cmdType: cmdType || "text"
          };
        } else {
          if (process.platform === "win32") {
            const setting = WINDOWS_SETTINGS.find((s) => s.uri === appPath);
            if (setting) {
              appInfo = {
                name: cmdName || setting.name,
                path: setting.uri,
                icon: setting.icon,
                type: "system-setting",
                category: setting.category
              };
            }
          }
        }
        if (!appInfo) {
          const localShortcuts = databaseAPI.dbGet("local-shortcuts");
          const shortcut = localShortcuts?.find((s) => s.path === appPath);
          if (shortcut) {
            appInfo = {
              name: cmdName || shortcut.alias || shortcut.name,
              path: shortcut.path,
              icon: shortcut.icon || "",
              type: "direct",
              subType: "local-shortcut",
              pinyin: shortcut.pinyin || "",
              pinyinAbbr: shortcut.pinyinAbbr || ""
            };
          }
        }
      }
      if (!appInfo) {
        console.warn("[Commands] 未找到应用信息，跳过添加历史记录:", appPath);
        return;
      }
      const history = databaseAPI.dbGet("command-history") || [];
      const historyMatchType = appInfo.type === "direct" && appInfo.subType === "app" ? "app" : appInfo.type;
      const existingIndex = findCommandIndex(
        history,
        appPath,
        historyMatchType,
        featureCode,
        appInfo.pluginName || appInfo.name
      );
      if (existingIndex >= 0) {
        history[existingIndex].lastUsed = now;
        history[existingIndex].useCount = (history[existingIndex].useCount || 0) + 1;
        history[existingIndex].path = appInfo.path;
        history[existingIndex].name = appInfo.name;
        history[existingIndex].icon = appInfo.icon;
        history[existingIndex].type = appInfo.type;
        history[existingIndex].subType = appInfo.subType;
        history[existingIndex].cmdType = appInfo.cmdType;
        history[existingIndex].pluginName = appInfo.pluginName;
        history[existingIndex].pluginExplain = appInfo.pluginExplain;
        history[existingIndex].originalName = appInfo.originalName;
      } else {
        history.push({
          ...appInfo,
          lastUsed: now,
          useCount: 1
        });
      }
      history.sort((a, b) => b.lastUsed - a.lastUsed);
      databaseAPI.dbPut("command-history", history);
      console.log("[Commands] 历史记录已更新:", appInfo.name);
      this.notifyRenderer("history-changed");
    } catch (error) {
      console.error("[Commands] 添加历史记录失败:", error);
    }
  }
  /**
   * 更新指令使用统计（独立于历史记录，用于匹配推荐排序）
   */
  updateUsageStats(options) {
    try {
      const { path: cmdPath, type = "app", featureCode, name: cmdName } = options;
      console.log("[Commands] 更新指令使用统计:", cmdName || cmdPath);
      const now = Date.now();
      const stats = databaseAPI.dbGet("command-usage-stats") || [];
      const existingIndex = findCommandIndex(stats, cmdPath, type, featureCode, cmdName || cmdPath);
      if (existingIndex >= 0) {
        stats[existingIndex].lastUsed = now;
        stats[existingIndex].useCount = (stats[existingIndex].useCount || 0) + 1;
        console.log(`更新统计: ${cmdName || cmdPath}, 使用${stats[existingIndex].useCount}次`);
      } else {
        stats.push({
          path: cmdPath,
          type,
          featureCode: featureCode || null,
          name: cmdName || cmdPath,
          lastUsed: now,
          useCount: 1
        });
        console.log(`新增统计: ${cmdName || cmdPath}, 使用1次`);
      }
      databaseAPI.dbPut("command-usage-stats", stats);
      console.log("[Commands] 使用统计已更新");
    } catch (error) {
      console.error("[Commands] 更新使用统计失败:", error);
    }
  }
  /**
   * 从数据库获取插件列表
   */
  getPluginsFromDB() {
    try {
      const plugins = databaseAPI.dbGet("plugins");
      return plugins || [];
    } catch (error) {
      console.error("[Commands] 从数据库获取插件列表失败:", error);
      return [];
    }
  }
  /**
   * 获取插件的默认 featureCode（第一个非匹配 feature）
   */
  async getDefaultFeatureCode(pluginPath) {
    try {
      const pluginJsonPath = path.join(pluginPath, "plugin.json");
      const pluginConfig = JSON.parse(await fs.promises.readFile(pluginJsonPath, "utf-8"));
      if (!pluginConfig.features || pluginConfig.features.length === 0) {
        return {
          success: false,
          error: "该插件没有配置任何功能"
        };
      }
      for (const feature of pluginConfig.features) {
        if (!feature.cmds || feature.cmds.length === 0) {
          return { success: true, featureCode: feature.code };
        }
        const hasNonMatchCmd = feature.cmds.some((cmd) => {
          if (typeof cmd === "string") return true;
          if (typeof cmd === "object" && !cmd.type) return true;
          return false;
        });
        if (hasNonMatchCmd) {
          return { success: true, featureCode: feature.code };
        }
      }
      return {
        success: false,
        error: "该插件所有功能都需要通过指令触发，无法直接打开"
      };
    } catch (error) {
      console.error("[Commands] 读取插件配置失败:", error);
      return {
        success: false,
        error: "读取插件配置失败"
      };
    }
  }
  /**
   * 从历史记录中删除
   */
  removeFromHistory(appPath, featureCode, name) {
    try {
      const originalHistory = databaseAPI.dbGet("command-history") || [];
      const history = filterOutCommand(originalHistory, appPath, featureCode, name);
      databaseAPI.dbPut("command-history", history);
      console.log("[Commands] 已从历史记录删除:", appPath, featureCode);
      this.notifyRenderer("history-changed");
    } catch (error) {
      console.error("[Commands] 从历史记录删除失败:", error);
    }
  }
  /**
   * 固定应用
   */
  pinApp(app2) {
    try {
      const pinnedApps = databaseAPI.dbGet("pinned-commands") || [];
      const isDirectApp2 = app2.type === "direct" && app2.subType === "app";
      const persistedName = isDirectApp2 ? app2.persistedName || app2.name : void 0;
      const matchName = app2.type === "plugin" ? app2.pluginName || app2.name : persistedName || app2.name;
      const exists = hasCommand(pinnedApps, app2.path, app2.featureCode, matchName);
      if (exists) {
        console.log("[Commands] 应用已固定:", app2.path);
        return;
      }
      pinnedApps.push({
        name: persistedName || app2.name,
        path: app2.path,
        icon: app2.icon,
        type: app2.type,
        subType: app2.subType,
        featureCode: app2.featureCode,
        pluginExplain: app2.pluginExplain,
        pinyin: app2.pinyin,
        pinyinAbbr: app2.pinyinAbbr,
        pluginName: app2.pluginName,
        cmdType: app2.cmdType,
        originalName: app2.originalName,
        persistedName: app2.persistedName
      });
      databaseAPI.dbPut("pinned-commands", pinnedApps);
      console.log("[Commands] 已固定应用:", app2.name);
      this.notifyRenderer("pinned-changed");
    } catch (error) {
      console.error("[Commands] 固定应用失败:", error);
    }
  }
  /**
   * 取消固定
   */
  unpinApp(appPath, featureCode, name) {
    try {
      const originalPinnedApps = databaseAPI.dbGet("pinned-commands") || [];
      const pinnedApps = filterOutCommand(originalPinnedApps, appPath, featureCode, name);
      databaseAPI.dbPut("pinned-commands", pinnedApps);
      console.log("[Commands] 已取消固定:", appPath, featureCode);
      this.notifyRenderer("pinned-changed");
    } catch (error) {
      console.error("[Commands] 取消固定失败:", error);
    }
  }
  /**
   * 更新固定列表顺序
   */
  updatePinnedOrder(newOrder) {
    try {
      const cleanData = newOrder.map((app2) => {
        const isDirectApp2 = app2.type === "direct" && app2.subType === "app";
        return {
          name: isDirectApp2 ? app2.persistedName || app2.name : app2.name,
          path: app2.path,
          icon: app2.icon,
          type: app2.type,
          subType: app2.subType,
          featureCode: app2.featureCode,
          pluginExplain: app2.pluginExplain,
          pinyin: app2.pinyin,
          pinyinAbbr: app2.pinyinAbbr,
          pluginName: app2.pluginName,
          cmdType: app2.cmdType,
          originalName: app2.originalName,
          persistedName: app2.persistedName
        };
      });
      databaseAPI.dbPut("pinned-commands", cleanData);
      console.log("[Commands] 固定列表顺序已更新");
      this.notifyRenderer("pinned-changed");
    } catch (error) {
      console.error("[Commands] 更新固定列表顺序失败:", error);
    }
  }
  /**
   * 从数据库加载上次匹配状态
   */
  loadLastMatchState() {
    try {
      const state = databaseAPI.dbGet("last-match-state");
      if (state) {
        this.lastMatchState = state;
        console.log("[Commands] 加载上次匹配状态:", state);
      }
    } catch (error) {
      console.log("[Commands] 加载上次匹配状态失败:", error);
    }
  }
  /**
   * 保存上次匹配状态到数据库
   */
  saveLastMatchState() {
    try {
      if (this.lastMatchState) {
        databaseAPI.dbPut("last-match-state", this.lastMatchState);
        console.log("[Commands] 保存上次匹配状态到数据库");
      }
    } catch (error) {
      console.error("[Commands] 保存上次匹配状态失败:", error);
    }
  }
  /**
   * 获取上次匹配状态
   */
  getLastMatchState() {
    return this.lastMatchState;
  }
  /**
   * 恢复上次匹配
   */
  restoreLastMatch() {
    return this.lastMatchState;
  }
  /**
   * 获取所有指令（供 AllCommands 页面和设置页 alias 目标选择使用）
   * 返回处理后的 commands、regexCommands 和 plugins
   * 结果会被缓存，直到应用列表、插件状态或 alias 映射发生变化时清除
   */
  async getCommands() {
    if (this.cachedCommandsResult) {
      console.log("[Commands] 命中指令缓存，直接返回 getCommands 结果");
      return this.cachedCommandsResult;
    }
    console.log("[Commands] 指令缓存未命中，开始重建 getCommands 结果");
    try {
      const rawApps = await this.getApps();
      const plugins = await pluginsAPI.getAllPlugins();
      const commands = [];
      const regexCommands = [];
      for (const app2 of rawApps) {
        commands.push({
          name: app2.name,
          path: app2.path,
          icon: app2.icon,
          type: "direct",
          subType: "app"
        });
      }
      const systemSettings = await systemSettingsAPI.getSystemSettings();
      for (const setting of systemSettings) {
        commands.push({
          name: setting.name,
          path: setting.uri,
          icon: void 0,
          // 图标由前端统一渲染
          type: "direct",
          subType: "system-setting"
        });
      }
      try {
        const localShortcuts = databaseAPI.dbGet("local-shortcuts");
        if (localShortcuts && Array.isArray(localShortcuts)) {
          for (const shortcut of localShortcuts) {
            commands.push({
              name: shortcut.alias || shortcut.name,
              path: shortcut.path,
              icon: shortcut.icon || "",
              type: "direct",
              subType: "local-shortcut"
            });
          }
        }
      } catch (error) {
        console.error("[Commands] 获取本地启动项失败:", error);
      }
      for (const plugin of plugins) {
        if (!plugin.features || !Array.isArray(plugin.features)) {
          continue;
        }
        for (const feature of plugin.features) {
          if (!feature.cmds || !Array.isArray(feature.cmds)) {
            continue;
          }
          for (const cmd of feature.cmds) {
            if (typeof cmd === "string") {
              commands.push({
                name: cmd,
                path: plugin.path,
                icon: feature.icon || plugin.logo,
                type: "plugin",
                featureCode: feature.code,
                pluginName: plugin.name,
                pluginTitle: plugin.title,
                pluginExplain: feature.explain,
                cmdType: "text"
              });
            } else if (typeof cmd === "object") {
              const matchCmd = {
                ...cmd,
                type: cmd.type,
                match: cmd.match ?? cmd.regex ?? ""
              };
              regexCommands.push({
                name: cmd.label || feature.explain || "",
                path: plugin.path,
                icon: feature.icon || plugin.logo,
                type: "plugin",
                featureCode: feature.code,
                pluginName: plugin.name,
                pluginTitle: plugin.title,
                pluginExplain: feature.explain,
                cmdType: cmd.type,
                matchCmd
              });
            }
          }
        }
      }
      const result = { commands, regexCommands, plugins };
      this.cachedCommandsResult = result;
      console.log("[Commands] 指令列表重建完成:", {
        commands: commands.length,
        regexCommands: regexCommands.length,
        plugins: plugins.length
      });
      return result;
    } catch (error) {
      console.error("[Commands] 获取指令列表失败:", error);
      return { commands: [], regexCommands: [], plugins: [] };
    }
  }
}
const appsAPI = new AppsAPI();
function matchesPinnedCommand(item, match) {
  if (match.featureCode !== void 0 && item?.featureCode !== match.featureCode) {
    return false;
  }
  if (match.path !== void 0 && item?.path !== match.path) {
    return false;
  }
  return match.featureCode !== void 0 || match.path !== void 0;
}
function filterSuperPanelPinnedCommands(items, match) {
  let changed = false;
  const nextItems = [];
  for (const item of items) {
    if (matchesPinnedCommand(item, match)) {
      changed = true;
      continue;
    }
    if (item?.isFolder && Array.isArray(item.items)) {
      const filtered = filterSuperPanelPinnedCommands(item.items, match);
      if (filtered.changed) changed = true;
      if (filtered.items.length === 0) {
        changed = true;
        continue;
      }
      if (filtered.items.length === 1) {
        changed = true;
        nextItems.push(filtered.items[0]);
        continue;
      }
      nextItems.push(filtered.changed ? { ...item, items: filtered.items } : item);
      continue;
    }
    nextItems.push(item);
  }
  return { items: nextItems, changed };
}
class WebSearchAPI {
  DB_KEY = "web-search-engines";
  // databaseAPI 会自动添加 ZTOOLS/ 前缀
  init() {
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle("web-search:get-all", async () => {
      try {
        const engines = this.getAllEngines();
        return { success: true, data: engines };
      } catch (error) {
        console.error("[WebSearch] 获取搜索引擎列表失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("web-search:add", async (_event, engine) => {
      try {
        return await this.addEngine(engine);
      } catch (error) {
        console.error("[WebSearch] 添加搜索引擎失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("web-search:update", async (_event, engine) => {
      try {
        return await this.updateEngine(engine);
      } catch (error) {
        console.error("[WebSearch] 更新搜索引擎失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("web-search:delete", async (_event, engineId) => {
      try {
        return await this.deleteEngine(engineId);
      } catch (error) {
        console.error("[WebSearch] 删除搜索引擎失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("web-search:fetch-favicon", async (_event, url2) => {
      try {
        const icon = await this.fetchFavicon(url2);
        return { success: true, data: icon };
      } catch (error) {
        console.error("[WebSearch] 获取 favicon 失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
  }
  /**
   * 获取所有搜索引擎
   */
  getAllEngines() {
    try {
      const data = databaseAPI.dbGet(this.DB_KEY);
      if (data && Array.isArray(data)) {
        return data.map((engine) => this.normalizeEngine(engine));
      }
      return [];
    } catch {
      return [];
    }
  }
  /**
   * 添加搜索引擎
   */
  async addEngine(engine) {
    const validated = this.validateAndNormalizeEngine(engine, false);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    const normalizedEngine = validated.engine;
    const engines = this.getAllEngines();
    if (!normalizedEngine.id) {
      normalizedEngine.id = crypto.randomUUID();
    }
    if (engines.some((e) => e.id === normalizedEngine.id)) {
      return { success: false, error: "该搜索引擎 ID 已存在" };
    }
    engines.push(normalizedEngine);
    databaseAPI.dbPut(this.DB_KEY, engines);
    this.notifyCommandsChanged();
    return { success: true };
  }
  /**
   * 更新搜索引擎
   */
  async updateEngine(engine) {
    const validated = this.validateAndNormalizeEngine(engine, true);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    const normalizedEngine = validated.engine;
    const engines = this.getAllEngines();
    const index = engines.findIndex((e) => e.id === normalizedEngine.id);
    if (index === -1) {
      return { success: false, error: "未找到该搜索引擎" };
    }
    engines[index] = normalizedEngine;
    databaseAPI.dbPut(this.DB_KEY, engines);
    this.notifyCommandsChanged();
    return { success: true };
  }
  /**
   * 删除搜索引擎
   */
  async deleteEngine(engineId) {
    const engines = this.getAllEngines();
    const index = engines.findIndex((e) => e.id === engineId);
    if (index === -1) {
      return { success: false, error: "未找到该搜索引擎" };
    }
    const featureCode = `web-search-${engines[index].id}`;
    engines.splice(index, 1);
    databaseAPI.dbPut(this.DB_KEY, engines);
    this.cleanupDeletedFeatureReferences(featureCode);
    this.notifyCommandsChanged();
    return { success: true };
  }
  cleanupDeletedFeatureReferences(featureCode) {
    const cleanupTargets = [
      { key: "command-history", channel: "history-changed" },
      { key: "pinned-commands", channel: "pinned-changed" },
      { key: "command-usage-stats" },
      { key: "super-panel-pinned", channel: "super-panel-pinned-changed" }
    ];
    for (const target of cleanupTargets) {
      try {
        const data = databaseAPI.dbGet(target.key);
        if (!Array.isArray(data)) continue;
        const result = target.key === "super-panel-pinned" ? filterSuperPanelPinnedCommands(data, { featureCode }) : this.filterDeletedFeatureFromList(data, featureCode);
        if (!result.changed) continue;
        databaseAPI.dbPut(target.key, result.items);
        if (target.channel) {
          windowManager.getMainWindow()?.webContents.send(target.channel);
        }
      } catch (error) {
        console.error(`[WebSearch] 清理已删除网页快开引用失败: ${target.key}`, error);
      }
    }
  }
  filterDeletedFeatureFromList(items, featureCode) {
    const nextItems = items.filter((item) => item?.featureCode !== featureCode);
    return {
      items: nextItems,
      changed: nextItems.length !== items.length
    };
  }
  /**
   * 获取搜索引擎对应的插件 features（用于合并到系统插件）
   */
  async getSearchEngineFeatures() {
    const engines = this.getAllEngines();
    return engines.filter((e) => e.enabled).flatMap((e) => {
      const baseFeature = {
        code: `web-search-${e.id}`,
        explain: e.name,
        icon: e.icon || ""
      };
      if (e.type === "webpage") {
        const keyword = e.keyword?.trim();
        if (!keyword) return [];
        return [
          {
            ...baseFeature,
            cmds: [keyword]
          }
        ];
      }
      return [
        {
          ...baseFeature,
          cmds: [
            {
              type: "over",
              label: e.name,
              minLength: 1
            }
          ]
        }
      ];
    });
  }
  /**
   * 根据 featureCode 获取搜索引擎配置
   */
  async getEngineByFeatureCode(featureCode) {
    const prefix = "web-search-";
    if (!featureCode.startsWith(prefix)) {
      return null;
    }
    const engineId = featureCode.substring(prefix.length);
    const engines = this.getAllEngines();
    return engines.find((e) => e.id === engineId) || null;
  }
  /**
   * 获取网站 favicon
   * 解析目标网站 HTML，提取 <link rel="icon"> 标签获取 favicon URL，
   * 然后下载图标并转为 base64
   */
  async fetchFavicon(url2) {
    try {
      const candidateUrl = this.ensureUrlProtocol(url2.replace("{q}", "test").trim());
      const urlObj = new URL(candidateUrl);
      const origin = urlObj.origin;
      try {
        const html = await this.httpGet(`${origin}/`);
        const faviconUrl = this.parseFaviconFromHtml(html, origin);
        if (faviconUrl) {
          const base64 = await this.downloadAsBase64(faviconUrl);
          if (base64) return base64;
        }
      } catch (error) {
        console.warn("[WebSearch] 获取页面 HTML 失败，回退到 /favicon.ico:", error);
      }
      const fallbackBase64 = await this.downloadAsBase64(`${origin}/favicon.ico`);
      if (fallbackBase64) return fallbackBase64;
      return "";
    } catch (error) {
      console.error("[WebSearch] fetchFavicon error:", error);
      return "";
    }
  }
  normalizeEngine(engine) {
    const type = engine?.type === "webpage" ? "webpage" : "search";
    return {
      id: typeof engine?.id === "string" ? engine.id : "",
      name: typeof engine?.name === "string" ? engine.name.trim() : "",
      url: typeof engine?.url === "string" ? engine.url.trim() : "",
      icon: typeof engine?.icon === "string" ? engine.icon : "",
      enabled: typeof engine?.enabled === "boolean" ? engine.enabled : true,
      type,
      keyword: typeof engine?.keyword === "string" ? engine.keyword.trim() : ""
    };
  }
  validateAndNormalizeEngine(engine, requireId) {
    const normalized = this.normalizeEngine(engine);
    if (requireId && !normalized.id) {
      return { success: false, error: "ID 不能为空" };
    }
    if (!normalized.name || !normalized.url) {
      return { success: false, error: "名称和 URL 不能为空" };
    }
    if (normalized.type === "webpage") {
      if (!normalized.keyword) {
        return { success: false, error: "匹配关键字不能为空" };
      }
      if (normalized.url.includes("{q}")) {
        return { success: false, error: "网页 URL 不能包含 {q} 占位符" };
      }
      const urlResult2 = this.normalizeHttpUrl(normalized.url);
      if (!urlResult2.success) {
        return { success: false, error: "网页 URL 必须是有效的 http/https 地址" };
      }
      normalized.url = urlResult2.url;
      return { success: true, engine: normalized };
    }
    if (!normalized.url.includes("{q}")) {
      return { success: false, error: "搜索引擎 URL 必须包含 {q} 占位符" };
    }
    normalized.url = this.ensureUrlProtocol(normalized.url);
    const urlResult = this.normalizeHttpUrl(normalized.url.replace("{q}", "test"));
    if (!urlResult.success) {
      return { success: false, error: "搜索引擎 URL 必须是有效的 http/https 地址" };
    }
    normalized.keyword = "";
    return { success: true, engine: normalized };
  }
  normalizeHttpUrl(rawUrl) {
    const candidate = this.ensureUrlProtocol(rawUrl.trim());
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { success: false };
      }
      return { success: true, url: parsed.toString() };
    } catch {
      return { success: false };
    }
  }
  ensureUrlProtocol(url2) {
    if (/^https?:\/\//i.test(url2)) {
      return url2;
    }
    return `https://${url2}`;
  }
  /**
   * 从 HTML 中解析 favicon URL
   */
  parseFaviconFromHtml(html, origin) {
    const linkRegex = /<link[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
    const altRegex = /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*>/gi;
    const match = linkRegex.exec(html) || altRegex.exec(html);
    if (match?.[1]) {
      const href = match[1];
      if (href.startsWith("//")) {
        return `https:${href}`;
      } else if (href.startsWith("/")) {
        return `${origin}${href}`;
      } else if (href.startsWith("http")) {
        return href;
      } else {
        return `${origin}/${href}`;
      }
    }
    return "";
  }
  /**
   * HTTP GET 请求，返回文本内容
   */
  httpGet(url2) {
    return new Promise((resolve, reject) => {
      const request = electron.net.request(url2);
      let data = "";
      let resolved = false;
      const fail = (error) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      };
      const done = (value) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          request.abort();
          reject(new Error("请求超时"));
        }
      }, 1e4);
      request.on("response", (response) => {
        response.on("error", fail);
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          clearTimeout(timeout);
          resolved = true;
          const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
          this.httpGet(location).then(resolve).catch(reject);
          return;
        }
        response.on("data", (chunk) => {
          data += chunk.toString();
          if (data.length > 100 * 1024) {
            request.abort();
            done(data);
          }
        });
        response.on("end", () => {
          done(data);
        });
      });
      request.on("error", fail);
      request.setHeader("Accept-Encoding", "identity");
      request.end();
    });
  }
  /**
   * 下载 URL 内容并转为 base64
   */
  downloadAsBase64(url2) {
    return new Promise((resolve) => {
      const request = electron.net.request(url2);
      const chunks = [];
      let resolved = false;
      const done = (value) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          request.abort();
          resolve("");
        }
      }, 1e4);
      request.on("response", (response) => {
        response.on("error", () => {
          done("");
        });
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          clearTimeout(timeout);
          resolved = true;
          const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
          this.downloadAsBase64(location).then(resolve);
          return;
        }
        if (response.statusCode !== 200) {
          done("");
          return;
        }
        const contentType = (Array.isArray(response.headers["content-type"]) ? response.headers["content-type"][0] : response.headers["content-type"]) || "image/x-icon";
        response.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (buffer.length > 0) {
            const mimeType = contentType.split(";")[0].trim();
            done(`data:${mimeType};base64,${buffer.toString("base64")}`);
          } else {
            done("");
          }
        });
      });
      request.on("error", () => {
        done("");
      });
      request.setHeader("Accept-Encoding", "identity");
      request.end();
    });
  }
  /**
   * 通知前端命令列表已变化
   */
  notifyCommandsChanged() {
    appsAPI.cachedCommandsResult = null;
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("plugins-changed");
    }
  }
}
const webSearchAPI = new WebSearchAPI();
const GZIP_MAGIC = Buffer.from([31, 139]);
const ZIP_MAGIC = Buffer.from([80, 75, 3, 4]);
function getTempPath(ext) {
  const name = `zpx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  return path.join(os.tmpdir(), name);
}
async function decompressToTemp(zpxPath, decompressorFactory) {
  const tempAsarPath = getTempPath(".asar");
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    await promises.pipeline(
      fs.createReadStream(zpxPath),
      decompressorFactory(),
      fs.createWriteStream(tempAsarPath)
    );
    return tempAsarPath;
  } catch (error) {
    try {
      await fs.promises.unlink(tempAsarPath);
    } catch {
    }
    throw error;
  } finally {
    process.noAsar = prevNoAsar;
  }
}
async function decompressZpxToTemp(zpxPath) {
  try {
    return await decompressToTemp(zpxPath, () => zlib.createGunzip());
  } catch {
    return await decompressToTemp(zpxPath, () => zlib.createBrotliDecompress());
  }
}
async function cleanupTemp(tempAsarPath) {
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    await fs.promises.unlink(tempAsarPath);
  } catch {
  } finally {
    process.noAsar = prevNoAsar;
  }
}
async function packZpx(sourceDir, outputPath) {
  const tempAsarPath = getTempPath(".asar");
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    console.log("[ZPX] 打包目录:", sourceDir, "→", outputPath);
    await asar__namespace.createPackage(sourceDir, tempAsarPath);
    await promises.pipeline(
      fs.createReadStream(tempAsarPath),
      zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5
        }
      }),
      fs.createWriteStream(outputPath)
    );
    console.log("[ZPX] 打包完成:", outputPath);
  } finally {
    try {
      await fs.promises.unlink(tempAsarPath);
    } catch {
    }
    process.noAsar = prevNoAsar;
  }
}
async function extractZpx(zpxPath, targetDir) {
  console.log("[ZPX] 解压:", zpxPath, "→", targetDir);
  const tempAsarPath = await decompressZpxToTemp(zpxPath);
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
    asar__namespace.extractAll(tempAsarPath, targetDir);
    console.log("[ZPX] 解压完成:", targetDir);
  } finally {
    process.noAsar = prevNoAsar;
    await cleanupTemp(tempAsarPath);
  }
}
async function readFileFromZpx(zpxPath, filePath) {
  const tempAsarPath = await decompressZpxToTemp(zpxPath);
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    return asar__namespace.extractFile(tempAsarPath, filePath);
  } finally {
    process.noAsar = prevNoAsar;
    await cleanupTemp(tempAsarPath);
  }
}
async function readTextFromZpx(zpxPath, filePath) {
  const buffer = await readFileFromZpx(zpxPath, filePath);
  return buffer.toString("utf-8");
}
async function isValidZpx(filePath) {
  let tempAsarPath = "";
  try {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(4);
      await fd.read(buf, 0, 4, 0);
      const isGzip = buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1];
      if (isGzip) {
        return true;
      }
      const isZip = buf[0] === ZIP_MAGIC[0] && buf[1] === ZIP_MAGIC[1] && buf[2] === ZIP_MAGIC[2] && buf[3] === ZIP_MAGIC[3];
      if (isZip) {
        return false;
      }
    } finally {
      await fd.close();
    }
    tempAsarPath = await decompressZpxToTemp(filePath);
    const prevNoAsar = process.noAsar;
    process.noAsar = true;
    try {
      asar__namespace.listPackage(tempAsarPath, { isPack: false });
      return true;
    } finally {
      process.noAsar = prevNoAsar;
    }
  } catch {
    return false;
  } finally {
    if (tempAsarPath) {
      await cleanupTemp(tempAsarPath);
    }
  }
}
const DEV_PROJECT_REGISTRY_DB_KEY = "dev-plugin-registry";
const DEV_PROJECT_REGISTRY_VERSION = 3;
const BUILT_IN_NAMES = /* @__PURE__ */ new Set(["setting", "system"]);
const VALID_BINDING_STATUSES = /* @__PURE__ */ new Set([
  "ready",
  "config_missing",
  "invalid_config",
  "unbound"
]);
function resolvePath(p) {
  return path.resolve(p);
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function normalizeTimestamp(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}
function normalizeStatus(value) {
  return typeof value === "string" && VALID_BINDING_STATUSES.has(value) ? value : "unbound";
}
function normalizeOptionalPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return resolvePath(value);
}
function getOrderedProjectNames(projects) {
  return Object.values(projects).sort((a, b) => {
    const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    const timeA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
    const timeB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
    return timeB - timeA;
  }).map((item) => item.name);
}
function createEmptyDevProjectRegistry() {
  return { version: DEV_PROJECT_REGISTRY_VERSION, projects: {} };
}
function parseRegistryEntry(name, raw, fallbackTimestamp) {
  if (!name || BUILT_IN_NAMES.has(name)) return null;
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.name !== "string" || raw.name !== name) return null;
  if (!raw.configSnapshot || typeof raw.configSnapshot !== "object" || Array.isArray(raw.configSnapshot)) {
    return null;
  }
  let projectPath = normalizeOptionalPath(raw.projectPath);
  let configPath = normalizeOptionalPath(raw.configPath);
  let status = normalizeStatus(raw.status);
  if (status !== "unbound") {
    if (!projectPath && configPath) projectPath = resolvePath(path.dirname(configPath));
    if (!configPath && projectPath) configPath = resolvePath(path.join(projectPath, "plugin.json"));
    if (!projectPath || !configPath) status = "unbound";
  }
  return {
    entry: {
      name,
      configSnapshot: { ...raw.configSnapshot },
      addedAt: normalizeTimestamp(raw.addedAt, fallbackTimestamp),
      updatedAt: normalizeTimestamp(raw.updatedAt, fallbackTimestamp),
      sortOrder: -1,
      projectPath,
      configPath,
      status,
      lastValidatedAt: normalizeTimestamp(raw.lastValidatedAt, fallbackTimestamp),
      ...typeof raw.lastError === "string" && raw.lastError ? { lastError: raw.lastError } : {}
    },
    rawSortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : null
  };
}
function readDevProjectRegistry(raw) {
  const emptyDoc = createEmptyDevProjectRegistry();
  if (!raw || typeof raw !== "object") return emptyDoc;
  const doc = raw;
  if (doc.version !== DEV_PROJECT_REGISTRY_VERSION) return emptyDoc;
  if (!doc.projects || typeof doc.projects !== "object" || Array.isArray(doc.projects))
    return emptyDoc;
  const projects = {};
  const pendingSortOrders = /* @__PURE__ */ new Map();
  const fallbackTimestamp = nowIso();
  for (const [name, rawEntry] of Object.entries(doc.projects)) {
    const parsed = parseRegistryEntry(name, rawEntry, fallbackTimestamp);
    if (!parsed) continue;
    projects[name] = parsed.entry;
    pendingSortOrders.set(name, parsed.rawSortOrder);
  }
  const fallbackOrder = new Map(
    Object.values(projects).sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()).map((item, index) => [item.name, index])
  );
  for (const [name, project] of Object.entries(projects)) {
    project.sortOrder = pendingSortOrders.get(name) ?? fallbackOrder.get(name) ?? Number.MAX_SAFE_INTEGER;
  }
  return { version: DEV_PROJECT_REGISTRY_VERSION, projects };
}
function upsertByConfig(options) {
  const clock = options.now ?? nowIso;
  const normalizedPath = resolvePath(options.pluginPath);
  const projectName = options.pluginConfig.name;
  if (!projectName) {
    return { success: false, reason: "Project config requires a name", registry: options.registry };
  }
  if (BUILT_IN_NAMES.has(projectName)) {
    return {
      success: false,
      reason: `Project name ${projectName} is not allowed`,
      registry: options.registry
    };
  }
  const existing = options.registry.projects[projectName];
  if (existing?.projectPath && resolvePath(existing.projectPath) !== normalizedPath) {
    return {
      success: false,
      reason: `Project name ${projectName} is already registered at ${existing.projectPath}`,
      registry: options.registry
    };
  }
  const ts = clock();
  return {
    success: true,
    registry: {
      version: DEV_PROJECT_REGISTRY_VERSION,
      projects: {
        ...options.registry.projects,
        [projectName]: {
          name: projectName,
          configSnapshot: { ...options.pluginConfig },
          addedAt: existing?.addedAt ?? ts,
          updatedAt: ts,
          sortOrder: existing?.sortOrder ?? Object.keys(options.registry.projects).length,
          projectPath: normalizedPath,
          configPath: path.join(normalizedPath, "plugin.json"),
          status: "ready",
          lastValidatedAt: ts
        }
      }
    }
  };
}
function rebindByConfig(options) {
  const clock = options.now ?? nowIso;
  const projectName = options.pluginConfig.name;
  if (!projectName) {
    return { success: false, reason: "Project config requires a name", registry: options.registry };
  }
  if (BUILT_IN_NAMES.has(projectName)) {
    return {
      success: false,
      reason: `Project name ${projectName} is not allowed`,
      registry: options.registry
    };
  }
  const existing = options.registry.projects[projectName];
  if (!existing) {
    return {
      success: false,
      reason: `Project ${projectName} does not exist`,
      registry: options.registry
    };
  }
  const ts = clock();
  const normalizedConfigPath = resolvePath(options.pluginJsonPath);
  return {
    success: true,
    registry: {
      version: DEV_PROJECT_REGISTRY_VERSION,
      projects: {
        ...options.registry.projects,
        [projectName]: {
          ...existing,
          configSnapshot: { ...options.pluginConfig },
          updatedAt: ts,
          projectPath: resolvePath(path.dirname(normalizedConfigPath)),
          configPath: normalizedConfigPath,
          status: "ready",
          lastValidatedAt: ts
        }
      }
    }
  };
}
function reorderProjects(registry, pluginNames) {
  const currentNames = getOrderedProjectNames(registry.projects);
  const currentNameSet = new Set(currentNames);
  for (const name of pluginNames) {
    if (!currentNameSet.has(name)) throw new Error(`Unknown dev project: ${name}`);
  }
  const merged = [...pluginNames, ...currentNames.filter((n) => !pluginNames.includes(n))];
  const nextProjects = {};
  for (const [index, name] of merged.entries()) {
    const current = registry.projects[name];
    if (current) nextProjects[name] = { ...current, sortOrder: index };
  }
  return { version: registry.version, projects: nextProjects };
}
function insertDevProjectAtTop(registry, projectName) {
  if (!registry.projects[projectName]) return registry;
  const orderedNames = getOrderedProjectNames(registry.projects).filter((n) => n !== projectName);
  const nextProjects = { ...registry.projects };
  const nextOrder = [projectName, ...orderedNames];
  for (const [index, name] of nextOrder.entries()) {
    const current = nextProjects[name];
    if (current) nextProjects[name] = { ...current, sortOrder: index };
  }
  return { version: registry.version, projects: nextProjects };
}
function canPackageDevProject(entry) {
  return entry?.status === "ready";
}
function validateRepairConfigSelection(registryItem, pluginConfig) {
  return !!pluginConfig.name && pluginConfig.name === registryItem.name;
}
function buildInstalledDevelopmentPlugin(pluginPath, pluginConfig) {
  const normalizedPath = resolvePath(pluginPath);
  const baseName = pluginConfig.name || path.basename(normalizedPath);
  const effectiveName = BUILT_IN_NAMES.has(baseName) ? baseName : toDevPluginName(baseName);
  return {
    name: effectiveName,
    title: pluginConfig.title,
    version: pluginConfig.version,
    description: pluginConfig.description || "",
    author: pluginConfig.author || "",
    homepage: pluginConfig.homepage || "",
    logo: pluginConfig.logo || "",
    main: pluginConfig.development?.main,
    preload: pluginConfig.preload,
    features: Array.isArray(pluginConfig.features) ? pluginConfig.features : [],
    path: normalizedPath,
    isDevelopment: true,
    installedAt: nowIso()
  };
}
function updateProjectMeta(options) {
  const clock = options.now ?? nowIso;
  const { projectName, meta } = options;
  const existing = options.registry.projects[projectName];
  if (!existing) {
    return {
      success: false,
      reason: `开发项目 "${projectName}" 不存在`,
      registry: options.registry
    };
  }
  const ts = clock();
  const updatedEntry = {
    ...existing,
    configSnapshot: {
      ...existing.configSnapshot,
      ...meta.title ? { title: meta.title } : {},
      ...meta.description !== void 0 ? { description: meta.description } : {},
      ...meta.author !== void 0 ? { author: meta.author } : {},
      ...Array.isArray(meta.platform) && meta.platform.length > 0 ? { platform: meta.platform } : {}
    },
    updatedAt: ts
  };
  return {
    success: true,
    registry: {
      version: options.registry.version,
      projects: {
        ...options.registry.projects,
        [projectName]: updatedEntry
      }
    }
  };
}
function formatError(error, fallback = "未知错误") {
  return error instanceof Error ? error.message : fallback;
}
async function readPluginConfigFromFile(configPath) {
  const content = await fs.promises.readFile(configPath, "utf-8");
  return JSON.parse(content);
}
class PluginDevProjectsAPI {
  constructor(deps) {
    this.deps = deps;
  }
  // ---- Registry persistence ----
  /** 从 LMDB 读取并反序列化开发项目注册表 */
  readRegistry() {
    return readDevProjectRegistry(databaseAPI.dbGet(DEV_PROJECT_REGISTRY_DB_KEY));
  }
  /** 将注册表序列化并写入 LMDB */
  writeRegistry(registry) {
    databaseAPI.dbPut(DEV_PROJECT_REGISTRY_DB_KEY, registry);
  }
  // ---- Config validation & refresh ----
  /**
   * 校验开发项目状态并刷新注册表。
   * 尝试读取 plugin.json，更新 status / configSnapshot / lastError 等字段。
   * 当 configPath 不可读时自动回退到 projectPath/plugin.json。
   * @param projectName - 要校验的项目名称
   * @param registry - 可选的注册表文档，省略时从数据库读取
   * @returns 校验结果，包含更新后的注册表和解析出的配置
   */
  async validateAndRefreshState(projectName, registry) {
    const currentRegistry = registry ?? this.readRegistry();
    const registryEntry = currentRegistry.projects[projectName];
    if (!registryEntry) {
      return {
        success: false,
        error: `开发项目 "${projectName}" 不存在`,
        registry: currentRegistry
      };
    }
    if (!registryEntry.projectPath || !registryEntry.configPath) {
      const now2 = (/* @__PURE__ */ new Date()).toISOString();
      const nextRegistry2 = {
        ...currentRegistry,
        projects: {
          ...currentRegistry.projects,
          [projectName]: {
            ...registryEntry,
            status: "unbound",
            lastValidatedAt: now2,
            lastError: "项目未绑定有效路径"
          }
        }
      };
      this.writeRegistry(nextRegistry2);
      return {
        success: false,
        error: "项目未绑定有效路径",
        registry: nextRegistry2,
        entry: nextRegistry2.projects[projectName]
      };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const fallbackConfigPath = path.join(registryEntry.projectPath, "plugin.json");
    const candidateConfigPaths = [
      registryEntry.configPath,
      ...fallbackConfigPath !== registryEntry.configPath ? [fallbackConfigPath] : []
    ];
    let usedConfigPath = registryEntry.configPath;
    let pluginConfig = null;
    let validationStatus = "config_missing";
    let lastError = "plugin.json 文件不存在";
    for (const candidatePath of candidateConfigPaths) {
      try {
        const loaded = await readPluginConfigFromFile(candidatePath);
        if (!loaded?.name) {
          validationStatus = "invalid_config";
          lastError = "plugin.json 缺少 name 字段";
          usedConfigPath = candidatePath;
          break;
        }
        if (loaded.name !== projectName) {
          validationStatus = "invalid_config";
          lastError = `plugin.json name 与项目不一致（期望: ${projectName}，实际: ${loaded.name}）`;
          usedConfigPath = candidatePath;
          break;
        }
        if (isBundledInternalPlugin(loaded.name)) {
          validationStatus = "invalid_config";
          lastError = "内置插件不能作为开发项目";
          usedConfigPath = candidatePath;
          break;
        }
        validationStatus = "ready";
        lastError = "";
        usedConfigPath = candidatePath;
        pluginConfig = loaded;
        break;
      } catch (error) {
        validationStatus = "config_missing";
        lastError = formatError(error, "plugin.json 不可读取");
        usedConfigPath = candidatePath;
      }
    }
    const nextEntry = {
      ...registryEntry,
      projectPath: usedConfigPath ? path.dirname(usedConfigPath) : registryEntry.projectPath,
      configPath: usedConfigPath,
      status: validationStatus,
      lastValidatedAt: now,
      ...lastError ? { lastError } : {},
      ...pluginConfig ? { configSnapshot: { ...pluginConfig }, updatedAt: now } : {}
    };
    if (!lastError && "lastError" in nextEntry) {
      delete nextEntry.lastError;
    }
    const nextRegistry = {
      ...currentRegistry,
      projects: { ...currentRegistry.projects, [projectName]: nextEntry }
    };
    this.writeRegistry(nextRegistry);
    return {
      success: validationStatus === "ready",
      ...validationStatus !== "ready" ? { error: lastError } : {},
      registry: nextRegistry,
      entry: nextEntry,
      ...pluginConfig ? { pluginConfig } : {}
    };
  }
  // ---- Usage data cleanup ----
  /**
   * 清理与指定插件名关联的历史、固定、自启动等持久化数据。
   * 包括：command-history、pinned-commands、autoStartPlugin、outKillPlugin、autoDetachPlugin。
   * @param effectiveName - 插件的实际名称（含 __dev 后缀）
   */
  removePluginUsageData(effectiveName) {
    const mainWindow = this.deps.mainWindow;
    const filterDbArray = (key, pred, event) => {
      const arr = databaseAPI.dbGet(key) || [];
      const filtered = arr.filter(pred);
      if (filtered.length !== arr.length) {
        databaseAPI.dbPut(key, filtered);
        if (event) mainWindow?.webContents.send(event);
      }
    };
    filterDbArray(
      "command-history",
      (item) => item?.pluginName !== effectiveName,
      "history-changed"
    );
    filterDbArray("pinned-commands", (item) => item?.pluginName !== effectiveName, "pinned-changed");
    filterDbArray("autoStartPlugin", (n) => n !== effectiveName);
    filterDbArray("outKillPlugin", (n) => n !== effectiveName);
    filterDbArray("autoDetachPlugin", (n) => n !== effectiveName);
  }
  // ---- Public API ----
  /**
   * 获取所有开发项目列表（按 sortOrder 排序）。
   * 合并注册表信息和实际安装/运行状态，返回渲染端可直接使用的视图数据。
   * @returns 开发项目视图对象数组，包含名称、状态、是否安装、是否运行等信息
   */
  async getDevProjects() {
    try {
      const registry = this.readRegistry();
      const installedPlugins = this.deps.readInstalledPlugins();
      const runningSet = new Set(this.deps.getRunningPlugins().map((p) => path.resolve(p)));
      const devInstalledByName = /* @__PURE__ */ new Map();
      for (const plugin of installedPlugins) {
        if (plugin?.isDevelopment && typeof plugin?.name === "string") {
          devInstalledByName.set(plugin.name, plugin);
        }
      }
      const orderedProjects = Object.entries(registry.projects).sort(
        ([, a], [, b]) => a.sortOrder - b.sortOrder
      );
      return orderedProjects.map(([name, project]) => {
        const projectPath = project.projectPath ? path.resolve(project.projectPath) : null;
        const installedDevPlugin = devInstalledByName.get(toDevPluginName(name)) || devInstalledByName.get(name);
        const installedPath = typeof installedDevPlugin?.path === "string" ? path.resolve(installedDevPlugin.path) : null;
        return {
          name,
          title: project.configSnapshot.title,
          version: project.configSnapshot.version,
          description: project.configSnapshot.description || "",
          author: project.configSnapshot.author || "",
          homepage: project.configSnapshot.homepage || "",
          logo: projectPath ? this.deps.resolvePluginLogo(projectPath, project.configSnapshot.logo) : project.configSnapshot.logo || "",
          preload: project.configSnapshot.preload,
          features: Array.isArray(project.configSnapshot.features) ? project.configSnapshot.features : [],
          platform: Array.isArray(project.configSnapshot.platform) ? project.configSnapshot.platform : [],
          developmentMain: project.configSnapshot.development?.main,
          path: projectPath,
          configPath: project.configPath || null,
          localStatus: project.status || "unbound",
          lastValidatedAt: project.lastValidatedAt || null,
          lastError: project.lastError || null,
          isDevModeInstalled: !!installedDevPlugin,
          isRunning: !!(projectPath && runningSet.has(projectPath) || installedPath && runningSet.has(installedPath)),
          addedAt: project.addedAt,
          sortOrder: project.sortOrder
        };
      });
    } catch (error) {
      console.error("[DevProjects] 获取列表失败:", error);
      return [];
    }
  }
  /**
   * 更新开发项目的排序顺序。
   * @param pluginNames - 期望的顺序（项目名称数组）
   * @returns {success: boolean, error?: string}
   */
  async updateDevProjectsOrder(pluginNames) {
    try {
      const registry = this.readRegistry();
      this.writeRegistry(reorderProjects(registry, pluginNames));
      this.deps.notifyPluginsChanged();
      return { success: true };
    } catch (error) {
      console.error("[DevProjects] 更新顺序失败:", error);
      return { success: false, error: formatError(error, "更新顺序失败") };
    }
  }
  /**
   * 导入开发插件（登记到注册表）。
   * 未提供路径时弹出文件选择对话框；新项目自动置顶。
   * @param pluginJsonPath - plugin.json 的路径（可选，省略时弹出文件选择器）
   * @returns {success: boolean, pluginName?: string, pluginPath?: string, error?: string}
   */
  async importDevPlugin(pluginJsonPath) {
    try {
      if (!pluginJsonPath) {
        const result = await openDialog(
          this.deps.mainWindow,
          {
            title: "选择插件配置文件",
            properties: ["openFile"],
            filters: [{ name: "插件配置", extensions: ["json"] }],
            message: "请选择 plugin.json 文件"
          },
          "未选择文件"
        );
        if (!result.success) {
          return result;
        }
        pluginJsonPath = result.data.filePaths[0];
      }
      if (path.basename(pluginJsonPath) !== "plugin.json") {
        return { success: false, error: "请选择 plugin.json 文件" };
      }
      const pluginPath = path.resolve(path.dirname(pluginJsonPath));
      let pluginConfig;
      try {
        pluginConfig = await readPluginConfigFromFile(pluginJsonPath);
      } catch {
        return { success: false, error: "plugin.json 格式错误" };
      }
      if (!pluginConfig.name) return { success: false, error: "plugin.json 缺少 name 字段" };
      if (isBundledInternalPlugin(pluginConfig.name)) {
        return { success: false, error: "内置插件不能作为开发项目导入" };
      }
      const existingPlugins = this.deps.readInstalledPlugins();
      const devName = toDevPluginName(pluginConfig.name);
      const validation = this.deps.validatePluginConfig(
        pluginConfig,
        existingPlugins.filter((p) => p?.name !== pluginConfig.name && p?.name !== devName)
      );
      if (!validation.valid) return { success: false, error: validation.error };
      const registry = this.readRegistry();
      const projectName = pluginConfig.name;
      const isNew = !registry.projects[projectName];
      const upserted = upsertByConfig({ registry, pluginPath, pluginConfig });
      if (!upserted.success) {
        return { success: false, error: upserted.reason || "开发项目登记失败" };
      }
      this.writeRegistry(
        isNew ? insertDevProjectAtTop(upserted.registry, projectName) : upserted.registry
      );
      console.log("[DevProjects] 项目已登记:", {
        pluginName: pluginConfig.name,
        projectPath: pluginPath,
        configPath: pluginJsonPath
      });
      this.deps.notifyPluginsChanged();
      this.deps.mainWindow?.webContents.send("super-panel-pinned-changed");
      return { success: true, pluginName: pluginConfig.name, pluginPath };
    } catch (error) {
      console.error("[DevProjects] 导入失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 通过 plugin.json 路径创建或更新开发项目。
   * 已存在的项目执行重绑（rebind），不存在的项目自动调用 importDevPlugin 新建。
   * @param pluginJsonPath - plugin.json 的绝对路径
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  async upsertDevProjectByConfigPath(pluginJsonPath) {
    try {
      if (!pluginJsonPath) return { success: false, error: "未提供 plugin.json 路径" };
      const configPath = path.resolve(pluginJsonPath);
      if (path.basename(configPath) !== "plugin.json") {
        return { success: false, error: "请选择 plugin.json 文件" };
      }
      let pluginConfig;
      try {
        pluginConfig = await readPluginConfigFromFile(configPath);
      } catch {
        return { success: false, error: "plugin.json 格式错误" };
      }
      if (!pluginConfig.name) return { success: false, error: "plugin.json 缺少 name 字段" };
      if (isBundledInternalPlugin(pluginConfig.name)) {
        return { success: false, error: "内置插件不能作为开发项目导入" };
      }
      const existingPlugins = this.deps.readInstalledPlugins();
      const devName = toDevPluginName(pluginConfig.name);
      const validation = this.deps.validatePluginConfig(
        pluginConfig,
        existingPlugins.filter((p) => p?.name !== pluginConfig.name && p?.name !== devName)
      );
      if (!validation.valid) return { success: false, error: validation.error };
      const registry = this.readRegistry();
      const projectName = pluginConfig.name;
      if (!registry.projects[projectName]) {
        return await this.importDevPlugin(configPath);
      }
      const rebound = rebindByConfig({
        registry,
        pluginJsonPath: configPath,
        pluginConfig
      });
      if (!rebound.success) {
        return { success: false, error: rebound.reason || "开发项目重绑失败" };
      }
      this.writeRegistry(rebound.registry);
      const validated = await this.validateAndRefreshState(projectName, rebound.registry);
      if (!validated.success) {
        return { success: false, error: validated.error || "开发项目校验失败" };
      }
      this.deps.notifyPluginsChanged();
      return { success: true, pluginName: projectName };
    } catch (error) {
      console.error("[DevProjects] upsert 失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 从注册表中移除开发项目，同时清理关联的使用数据（历史、固定等）。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  async removeDevProject(projectName) {
    try {
      const registry = this.readRegistry();
      if (!registry.projects[projectName]) return { success: false, error: "开发项目不存在" };
      const registryEntry = registry.projects[projectName];
      const devEffectiveName = toDevPluginName(projectName);
      const plugins = this.deps.readInstalledPlugins();
      const installedDevPlugin = plugins.find(
        (p) => p?.isDevelopment && p?.name === devEffectiveName
      );
      const killPath = installedDevPlugin?.path || registryEntry.projectPath;
      if (killPath) {
        this.deps.pluginManager?.killPlugin(killPath);
      }
      if (installedDevPlugin) {
        this.deps.writeInstalledPlugins(
          plugins.filter((p) => !(p?.isDevelopment && p?.name === devEffectiveName))
        );
      }
      const { [projectName]: _, ...remainingProjects } = registry.projects;
      this.writeRegistry({ ...registry, projects: remainingProjects });
      this.removePluginUsageData(devEffectiveName);
      this.deps.notifyPluginsChanged();
      console.log("[DevProjects] 项目已移除:", projectName);
      return { success: true, pluginName: projectName };
    } catch (error) {
      console.error("[DevProjects] 移除失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 将开发项目安装到已安装插件列表（开发模式）。
   * 会先校验项目状态，然后构建 PluginInstallRecord 并写入数据库。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  async installDevPlugin(projectName) {
    try {
      const registry = this.readRegistry();
      if (!registry.projects[projectName]) return { success: false, error: "开发项目不存在" };
      const validated = await this.validateAndRefreshState(projectName, registry);
      if (!validated.success || !validated.entry || !validated.pluginConfig) {
        return { success: false, error: validated.error || "开发项目校验失败" };
      }
      if (!validated.entry.projectPath) {
        return { success: false, error: "开发项目未绑定有效路径" };
      }
      const pluginConfig = validated.pluginConfig;
      const plugins = this.deps.readInstalledPlugins();
      const devEffectiveName = toDevPluginName(projectName);
      const validation = this.deps.validatePluginConfig(
        pluginConfig,
        plugins.filter((p) => p?.name !== projectName && p?.name !== devEffectiveName)
      );
      if (!validation.valid) return { success: false, error: validation.error };
      const projectPath = path.resolve(validated.entry.projectPath);
      const installedPlugin = buildInstalledDevelopmentPlugin(projectPath, pluginConfig);
      installedPlugin.logo = this.deps.resolvePluginLogo(projectPath, pluginConfig.logo);
      const existingIndex = plugins.findIndex(
        (p) => p?.isDevelopment && p?.name === installedPlugin.name
      );
      if (existingIndex >= 0) {
        plugins[existingIndex] = installedPlugin;
      } else {
        plugins.push(installedPlugin);
      }
      this.deps.writeInstalledPlugins(plugins);
      this.deps.notifyPluginsChanged();
      console.log("[DevProjects] 开发模式安装完成:", { projectName, projectPath });
      return { success: true, pluginName: projectName };
    } catch (error) {
      console.error("[DevProjects] 安装失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 卸载开发模式插件（从已安装列表中移除，不删除注册表记录）。
   * 会同时终止运行中的插件并清理使用数据。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  async uninstallDevPlugin(projectName) {
    try {
      const registry = this.readRegistry();
      const plugins = this.deps.readInstalledPlugins();
      if (!registry.projects[projectName]) return { success: true };
      const devEffectiveName = toDevPluginName(projectName);
      const pluginInfo = plugins.find((p) => p?.isDevelopment && p?.name === devEffectiveName);
      if (!pluginInfo?.isDevelopment) return { success: true };
      if (typeof pluginInfo.path === "string" && pluginInfo.path) {
        this.deps.pluginManager?.killPlugin(pluginInfo.path);
      }
      this.deps.writeInstalledPlugins(
        plugins.filter((p) => !(p?.isDevelopment && p?.name === devEffectiveName))
      );
      this.removePluginUsageData(toDevPluginName(projectName));
      this.deps.notifyPluginsChanged();
      return { success: true, pluginName: projectName };
    } catch (error) {
      console.error("[DevProjects] 卸载失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 校验开发项目的 plugin.json 状态并刷新注册表。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, binding?: DevProjectRecord, error?: string}
   */
  async validateDevProject(projectName) {
    try {
      const registry = this.readRegistry();
      if (!registry.projects[projectName]) return { success: false, error: "开发项目不存在" };
      const validated = await this.validateAndRefreshState(projectName, registry);
      if (!validated.success) {
        return { success: false, error: validated.error || "开发项目校验失败" };
      }
      return { success: true, pluginName: projectName, binding: validated.entry };
    } catch (error) {
      console.error("[DevProjects] 校验失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 重新选择开发项目的 plugin.json 配置文件。
   * 用于项目目录变更或配置文件丢失后的修复场景。
   * @param projectName - 注册表中的项目名称
   * @param providedConfigPath - 可选的配置文件路径，省略时弹出文件选择器
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  async selectDevProjectConfig(projectName, providedConfigPath) {
    try {
      const registry = this.readRegistry();
      const registryItem = registry.projects[projectName];
      if (!registryItem) return { success: false, error: "开发项目不存在" };
      let configPath = providedConfigPath ? path.resolve(providedConfigPath) : "";
      if (!configPath) {
        const result = await openDialog(
          this.deps.mainWindow,
          {
            title: "选择 plugin.json",
            properties: ["openFile"],
            filters: [{ name: "插件配置", extensions: ["json"] }],
            message: `为 ${projectName} 选择 plugin.json`
          },
          "未选择文件"
        );
        if (!result.success) {
          return result;
        }
        configPath = path.resolve(result.data.filePaths[0]);
      }
      if (path.basename(configPath) !== "plugin.json") {
        return { success: false, error: "请选择 plugin.json 文件" };
      }
      let selectedConfig;
      try {
        selectedConfig = await readPluginConfigFromFile(configPath);
      } catch {
        return { success: false, error: "plugin.json 格式错误" };
      }
      if (!validateRepairConfigSelection(registryItem, selectedConfig)) {
        return {
          success: false,
          error: `选择的 plugin.json 与项目 "${projectName}" identity 不匹配`
        };
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const nextRegistry = {
        ...registry,
        projects: {
          ...registry.projects,
          [projectName]: {
            ...registryItem,
            configSnapshot: { ...selectedConfig },
            configPath,
            projectPath: path.dirname(configPath),
            status: "ready",
            lastValidatedAt: now,
            updatedAt: now
          }
        }
      };
      this.writeRegistry(nextRegistry);
      const validated = await this.validateAndRefreshState(projectName, nextRegistry);
      if (!validated.success) {
        return { success: false, error: validated.error || "开发项目校验失败" };
      }
      this.deps.notifyPluginsChanged();
      return { success: true, pluginName: projectName };
    } catch (error) {
      console.error("[DevProjects] 重绑配置失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 更新开发项目的元数据，同时同步写入磁盘 plugin.json。
   */
  async updateDevProjectMeta(projectName, meta) {
    try {
      const registry = this.readRegistry();
      const result = updateProjectMeta({ registry, projectName, meta });
      if (!result.success) {
        return { success: false, error: result.reason || "更新失败" };
      }
      this.writeRegistry(result.registry);
      const entry = result.registry.projects[projectName];
      if (entry?.configPath) {
        try {
          const raw = await fs.promises.readFile(entry.configPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (meta.title !== void 0) parsed.title = meta.title;
          if (meta.description !== void 0) parsed.description = meta.description;
          if (meta.author !== void 0) parsed.author = meta.author;
          if (Array.isArray(meta.platform) && meta.platform.length > 0) {
            parsed.platform = meta.platform;
          }
          await fs.promises.writeFile(entry.configPath, JSON.stringify(parsed, null, 2), "utf-8");
        } catch (err) {
          console.warn("[DevProjects] 同步 plugin.json 失败:", err);
        }
      }
      this.deps.notifyPluginsChanged();
      return { success: true };
    } catch (error) {
      console.error("[DevProjects] 更新元数据失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 从模板创建开发项目。
   * 将模板目录复制到目标路径，替换 plugin.json 和 package.json 中的占位符，
   * 然后自动导入为开发项目。
   */
  async scaffoldDevProject(params) {
    try {
      const {
        template,
        projectPath: targetDir,
        name,
        title,
        description,
        platform: platform2,
        author
      } = params;
      const installedPlugins = this.deps.readInstalledPlugins();
      const devVersionPlugin = installedPlugins.find(
        (p) => p?.name === "ztools-developer-plugin__dev"
      );
      const prodVersionPlugin = installedPlugins.find((p) => p?.name === "ztools-developer-plugin");
      const devPlugin = devVersionPlugin || prodVersionPlugin;
      if (!devPlugin?.path) {
        return { success: false, error: "开发者工具插件未安装" };
      }
      const templateDir = path.join(devPlugin.path, template);
      try {
        await fs.promises.access(templateDir);
      } catch {
        return { success: false, error: `模板 "${template}" 不存在（路径: ${templateDir}）` };
      }
      const projectDir = path.join(targetDir, name);
      try {
        const stat = await fs.promises.stat(projectDir).catch(() => null);
        if (stat) {
          return { success: false, error: `目录 "${projectDir}" 已存在` };
        }
      } catch {
      }
      await fs.promises.cp(templateDir, projectDir, { recursive: true });
      const pluginJsonPath = path.join(projectDir, "public", "plugin.json");
      try {
        let pluginJson = await fs.promises.readFile(pluginJsonPath, "utf-8");
        pluginJson = pluginJson.replace(/\{\{PLUGIN_NAME\}\}/g, name).replace(/\{\{PLUGIN_TITLE\}\}/g, title).replace(/\{\{DESCRIPTION\}\}/g, description || "").replace(/\{\{AUTHOR\}\}/g, author || "");
        if (Array.isArray(platform2) && platform2.length > 0) {
          const parsed = JSON.parse(pluginJson);
          parsed.platform = platform2;
          pluginJson = JSON.stringify(parsed, null, 2);
        }
        await fs.promises.writeFile(pluginJsonPath, pluginJson, "utf-8");
      } catch (err) {
        console.warn("[DevProjects] 替换 plugin.json 占位符失败:", err);
      }
      const packageJsonPath = path.join(projectDir, "package.json");
      try {
        let packageJson = await fs.promises.readFile(packageJsonPath, "utf-8");
        packageJson = packageJson.replace(/\{\{PROJECT_NAME\}\}/g, name).replace(/\{\{DESCRIPTION\}\}/g, description || "");
        await fs.promises.writeFile(packageJsonPath, packageJson, "utf-8");
      } catch (err) {
        console.warn("[DevProjects] 替换 package.json 占位符失败:", err);
      }
      const result = await this.upsertDevProjectByConfigPath(pluginJsonPath);
      if (!result?.success) {
        return { success: false, error: result?.error || "导入创建的项目失败" };
      }
      console.log("[DevProjects] 项目已从模板创建:", { template, projectDir, name });
      return { success: true, pluginName: result.pluginName || name };
    } catch (error) {
      console.error("[DevProjects] 模板创建失败:", error);
      return { success: false, error: formatError(error) };
    }
  }
  /**
   * 将开发项目打包为 ZPX 文件。
   * 校验项目状态为 ready 后弹出保存对话框，将项目目录打包为 .zpx 文件。
   * @param projectName - 项目名称
   * @param packagePath - 可选，指定打包目录的绝对路径，省略时打包整个项目根目录
   * @param version - 可选，指定打包版本号，会临时覆盖 plugin.json 中的 version 字段
   * @returns {success: boolean, error?: string}
   */
  async packageDevProject(projectName, packagePath, version) {
    try {
      const registry = this.readRegistry();
      if (!registry.projects[projectName]) return { success: false, error: "开发项目不存在" };
      const validated = await this.validateAndRefreshState(projectName, registry);
      if (!validated.success || !validated.entry) {
        return { success: false, error: validated.error || "开发项目校验失败" };
      }
      if (!canPackageDevProject(validated.entry)) {
        return { success: false, error: "当前项目状态不可打包" };
      }
      if (!validated.entry.projectPath) {
        return { success: false, error: "开发项目未绑定有效路径" };
      }
      const mainFile = validated.pluginConfig?.main;
      if (mainFile) {
        const mainPath = path.resolve(validated.entry.projectPath, mainFile);
        try {
          await fs.promises.access(mainPath);
        } catch {
          return { success: false, error: `main 入口文件不存在: ${mainFile}` };
        }
      }
      const rootPath = validated.entry.projectPath;
      const targetPackagePath = packagePath ?? rootPath;
      try {
        await fs.promises.access(targetPackagePath);
      } catch {
        return { success: false, error: "插件目录不存在" };
      }
      const resolvedVersion = version || validated.pluginConfig?.version || registry.projects[projectName]?.configSnapshot?.version || "0.0.0";
      const pluginJsonPath = path.join(targetPackagePath, "plugin.json");
      let originalPluginJsonContent = "";
      if (version) {
        try {
          originalPluginJsonContent = await fs.promises.readFile(pluginJsonPath, "utf-8");
          const config = JSON.parse(originalPluginJsonContent);
          config.version = version;
          await fs.promises.writeFile(pluginJsonPath, JSON.stringify(config, null, 2), "utf-8");
        } catch {
          return { success: false, error: "修改 plugin.json 版本号失败" };
        }
      }
      const result = await electron.dialog.showSaveDialog(this.deps.mainWindow, {
        title: "保存插件包",
        defaultPath: `${projectName}-v${resolvedVersion}.zpx`,
        filters: [{ name: "插件包", extensions: ["zpx"] }]
      });
      if (result.canceled || !result.filePath) return { success: false, error: "已取消" };
      await packZpx(targetPackagePath, result.filePath);
      electron.shell.showItemInFolder(result.filePath);
      return { success: true };
    } catch (error) {
      console.error("[DevProjects] 打包失败:", error);
      return { success: false, error: formatError(error, "打包失败") };
    }
  }
}
class DownloadCancelledError extends Error {
  constructor() {
    super("下载已取消");
    this.name = "DownloadCancelledError";
  }
}
async function downloadFile(url2, filePath, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DownloadCancelledError());
      return;
    }
    let settled = false;
    let writeStream = null;
    const request = electron.net.request({
      url: url2,
      session: electron.session.defaultSession
      // 显式指定使用 defaultSession（确保代理配置生效）
    });
    const cleanup = () => {
      options.signal?.removeEventListener("abort", handleAbort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const fail = (err) => {
      finish(() => {
        try {
          request.abort();
        } catch {
        }
        writeStream?.destroy();
        reject(err);
      });
    };
    function handleAbort() {
      try {
        request.abort();
      } catch {
      }
      fail(new DownloadCancelledError());
    }
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    request.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    request.setHeader("Pragma", "no-cache");
    request.setHeader("Expires", "0");
    request.setHeader(
      "accept",
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
    );
    request.setHeader("accept-encoding", "gzip, deflate, br, zstd");
    request.setHeader("accept-language", "zh-CN,zh;q=0.9");
    request.setHeader("priority", "u=0, i");
    request.setHeader(
      "sec-ch-ua",
      '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"'
    );
    request.setHeader("sec-ch-ua-mobile", "?0");
    request.setHeader("sec-ch-ua-platform", '"macOS"');
    request.setHeader("sec-fetch-dest", "document");
    request.setHeader("sec-fetch-mode", "navigate");
    request.setHeader("sec-fetch-site", "none");
    request.setHeader("sec-fetch-user", "?1");
    request.setHeader("upgrade-insecure-requests", "1");
    request.setHeader(
      "user-agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0"
    );
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        fail(new Error(`下载失败: HTTP ${response.statusCode}`));
        return;
      }
      const contentLengthHeader = response.headers["content-length"];
      const contentLengthValue = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader;
      const totalBytes = contentLengthValue ? Number(contentLengthValue) : void 0;
      const hasTotalBytes = typeof totalBytes === "number" && Number.isFinite(totalBytes);
      let receivedBytes = 0;
      options.onProgress?.({
        receivedBytes,
        totalBytes: hasTotalBytes ? totalBytes : void 0,
        percent: hasTotalBytes && totalBytes > 0 ? 0 : null
      });
      writeStream = fs.createWriteStream(filePath);
      response.on("data", (chunk) => {
        if (settled) return;
        receivedBytes += Buffer.byteLength(chunk);
        writeStream?.write(chunk);
        options.onProgress?.({
          receivedBytes,
          totalBytes: hasTotalBytes ? totalBytes : void 0,
          percent: hasTotalBytes && totalBytes > 0 ? Math.min(100, receivedBytes / totalBytes * 100) : null
        });
      });
      response.on("end", () => {
        if (settled) return;
        writeStream?.end();
        options.onProgress?.({
          receivedBytes,
          totalBytes: hasTotalBytes ? totalBytes : void 0,
          percent: hasTotalBytes && totalBytes > 0 ? 100 : null
        });
      });
      response.on("error", (err) => {
        fail(err);
      });
      writeStream.on("finish", () => {
        finish(() => resolve());
      });
      writeStream.on("error", (err) => {
        fail(err);
      });
    });
    request.on("error", (err) => {
      if (options.signal?.aborted) {
        fail(new DownloadCancelledError());
        return;
      }
      fail(err);
    });
    request.end();
  });
}
const PLUGIN_DIR$2 = path.join(electron.app.getPath("userData"), "plugins");
const MARKET_DOWNLOAD_PROGRESS_CHANNEL = "plugin-market-download-progress";
class PluginInstallerAPI {
  constructor(deps) {
    this.deps = deps;
  }
  marketDownloadTasks = /* @__PURE__ */ new Map();
  /**
   * 选择插件文件（不安装，仅返回文件路径）。
   * 用于“导入本地插件”场景，先让用户选择文件再展示预览。
   * @returns {success: boolean, filePath?: string, error?: string}
   */
  async selectPluginFile() {
    try {
      const result = await openDialog(
        this.deps.mainWindow,
        {
          title: "选择插件文件",
          filters: [{ name: "插件文件", extensions: ["zpx", "zip"] }],
          properties: ["openFile"]
        },
        "未选择文件"
      );
      if (!result.success) {
        return result;
      }
      return { success: true, filePath: result.data.filePaths[0] };
    } catch (error) {
      console.error("[Plugins] 选择插件文件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 导入 ZPX 插件（直接安装不预览）。
   * 保留用于兼容性，新流程应使用 selectPluginFile + installPluginFromPath。
   * @returns {success: boolean, plugin?: object, error?: string}
   */
  async importPlugin() {
    try {
      const result = await openDialog(
        this.deps.mainWindow,
        {
          title: "选择插件文件",
          filters: [{ name: "插件文件", extensions: ["zpx", "zip"] }],
          properties: ["openFile"]
        },
        "未选择文件"
      );
      if (!result.success) {
        return result;
      }
      return await this.installPluginFromPath(result.data.filePaths[0]);
    } catch (error) {
      console.error("[Plugins] 导入插件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 从 ZPX 文件中读取插件信息（不安装）。
   * 用于安装前预览插件详情，logo 转换为 base64 data URL。
   * @param zpxPath - .zpx 文件的绝对路径
   * @returns {success: boolean, pluginInfo?: object, error?: string}
   */
  async readPluginInfoFromZpx(zpxPath) {
    try {
      let config;
      let isZpx;
      try {
        ;
        ({ config, isZpx } = await this.readPluginJson(zpxPath));
      } catch (e) {
        return { success: false, error: e.message };
      }
      let logoBase64 = "";
      if (config.logo) {
        try {
          const logoBuffer = isZpx ? await readFileFromZpx(zpxPath, config.logo) : new AdmZip(zpxPath).readFile(config.logo);
          if (logoBuffer) {
            const ext = path.extname(config.logo).toLowerCase().replace(".", "");
            const mimeType = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : `image/${ext}`;
            logoBase64 = `data:${mimeType};base64,${logoBuffer.toString("base64")}`;
          }
        } catch (error) {
          console.warn("[Plugins] 提取插件 logo 失败:", error);
        }
      }
      const existingPlugins = await this.deps.getPlugins();
      const isInstalled = existingPlugins.some((p) => p.name === config.name);
      return {
        success: true,
        pluginInfo: {
          name: config.name,
          title: config.title || config.name,
          version: config.version || "未知",
          description: config.description || "",
          author: config.author || "未知",
          logo: logoBase64,
          features: config.features || [],
          isInstalled
        }
      };
    } catch (error) {
      console.error("[Plugins] 读取插件信息失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "读取失败" };
    }
  }
  /**
   * 从指定文件路径安装插件（.zpx），支持覆盖已存在的插件。
   * 覆盖时会先终止运行中的插件、移除旧记录和目录，再执行全新安装。
   * @param zpxPath - .zpx 文件的绝对路径
   * @returns {success: boolean, plugin?: object, error?: string}
   */
  async installPluginFromPath(filePath) {
    try {
      let config;
      let isZpx;
      try {
        ;
        ({ config, isZpx } = await this.readPluginJson(filePath));
      } catch (e) {
        return { success: false, error: e.message };
      }
      const pluginName = config.name;
      const pluginPath = path.join(PLUGIN_DIR$2, pluginName);
      const existingPlugins = databaseAPI.dbGet("plugins") || [];
      const existingIndex = existingPlugins.findIndex((p) => p.name === pluginName);
      if (existingIndex !== -1) {
        console.log("[Plugins] 插件已存在，执行覆盖安装:", pluginName);
        try {
          this.deps.pluginManager?.killPluginByName(pluginName);
        } catch {
        }
        existingPlugins.splice(existingIndex, 1);
        databaseAPI.dbPut("plugins", existingPlugins);
        try {
          await fs.promises.rm(pluginPath, { recursive: true, force: true });
          console.log("[Plugins] 已删除旧插件目录:", pluginPath);
        } catch {
        }
      }
      return await this.installFromPackageFile(filePath, isZpx, config);
    } catch (error) {
      console.error("[Plugins] 覆盖安装插件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "安装失败" };
    }
  }
  /**
   * 从插件市场安装插件。
   * 流程：下载 .zpx 文件（最多重试 3 次）→ 自动检测 ZPX/ZIP 格式 → 安装 → 清理临时文件。
   * @param plugin - 市场插件对象，必须包含 name 和 downloadUrl 字段
   * @returns {success: boolean, plugin?: object, error?: string}
   */
  async installPluginFromMarket(plugin, webContents) {
    const pluginName = plugin?.name;
    if (!pluginName) {
      return { success: false, error: "无效的插件信息" };
    }
    if (this.marketDownloadTasks.has(pluginName)) {
      return { success: false, error: "该插件正在下载中" };
    }
    const safePluginName = String(pluginName).replace(/[\\/]/g, "_");
    const taskId = `${safePluginName}-${Date.now()}`;
    const controller = new AbortController();
    const task = {
      pluginName,
      taskId,
      controller,
      webContents
    };
    this.marketDownloadTasks.set(pluginName, task);
    const tempDir = path.join(electron.app.getPath("temp"), "ztools-plugin-download", taskId);
    const tempFilePath = path.join(tempDir, `${safePluginName}.zpx`);
    try {
      console.log("[Plugins] 开始从市场安装插件:", pluginName);
      const downloadUrl = plugin.downloadUrl;
      if (!downloadUrl) {
        return { success: false, error: "无效的下载链接" };
      }
      console.log("[Plugins] 插件下载链接:", downloadUrl);
      await fs.promises.mkdir(tempDir, { recursive: true });
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: "downloading",
        progress: 0
      });
      let retryCount = 0;
      const maxRetries = 3;
      while (retryCount < maxRetries) {
        try {
          await downloadFile(downloadUrl, tempFilePath, {
            signal: controller.signal,
            onProgress: (progress) => {
              this.emitMarketDownloadProgress(task, {
                pluginName,
                taskId,
                status: "downloading",
                progress: progress.percent,
                receivedBytes: progress.receivedBytes,
                totalBytes: progress.totalBytes
              });
            }
          });
          break;
        } catch (error) {
          if (error instanceof DownloadCancelledError || controller.signal.aborted) {
            throw error;
          }
          retryCount++;
          console.error(`下载失败，重试第 ${retryCount} 次:`, error);
          if (retryCount >= maxRetries) throw error;
          await fs.promises.rm(tempFilePath, { force: true });
          await sleep(500);
        }
      }
      console.log("[Plugins] 插件下载完成:", tempFilePath);
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: "installing",
        progress: 100
      });
      const { config: marketConfig, isZpx } = await this.readPluginJson(tempFilePath);
      console.log(`[Plugins] 市场插件格式: ${isZpx ? "ZPX" : "ZIP（兼容）"}`);
      const marketPluginName = marketConfig.name;
      const marketPluginPath = path.join(PLUGIN_DIR$2, marketPluginName);
      const existingPluginsForMarket = databaseAPI.dbGet("plugins") || [];
      const existingMarketIndex = existingPluginsForMarket.findIndex(
        (p) => p.name === marketPluginName
      );
      if (existingMarketIndex !== -1) {
        console.log("[Plugins] 插件已存在，执行覆盖升级（保留数据）:", marketPluginName);
        try {
          this.deps.pluginManager?.killPluginByName(marketPluginName);
        } catch {
        }
        existingPluginsForMarket.splice(existingMarketIndex, 1);
        databaseAPI.dbPut("plugins", existingPluginsForMarket);
        try {
          await fs.promises.rm(marketPluginPath, { recursive: true, force: true });
          console.log("[Plugins] 已删除旧插件目录:", marketPluginPath);
        } catch {
        }
      }
      const result = await this.installFromPackageFile(tempFilePath, isZpx, marketConfig);
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: result.success ? "success" : "error",
        progress: result.success ? 100 : null,
        error: result.success ? void 0 : result.error || "安装失败"
      });
      return result;
    } catch (error) {
      if (error instanceof DownloadCancelledError || controller.signal.aborted) {
        console.log("[Plugins] 市场插件下载已取消:", pluginName);
        this.emitMarketDownloadProgress(task, {
          pluginName,
          taskId,
          status: "cancelled",
          progress: null
        });
        return { success: false, cancelled: true, error: "已取消下载" };
      }
      console.error("[Plugins] 从市场安装插件失败:", error);
      const message = error instanceof Error ? error.message : "安装失败";
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: "error",
        progress: null,
        error: message
      });
      return { success: false, error: message };
    } finally {
      this.marketDownloadTasks.delete(pluginName);
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.error("[Plugins] 清理下载临时文件失败:", e);
      }
    }
  }
  cancelPluginMarketDownload(pluginNameOrTaskId) {
    const task = this.findMarketDownloadTask(pluginNameOrTaskId);
    if (!task) {
      return { success: false, error: "没有找到正在下载的插件" };
    }
    task.controller.abort();
    return { success: true };
  }
  /**
   * 从 npm 安装插件
   * @param packageName npm 包名（支持作用域包，如 @ztools/example）
   * @param useChinaMirror 是否使用国内镜像（默认 false）
   */
  async installPluginFromNpm(packageName, useChinaMirror = false) {
    try {
      console.log("[Plugins] 开始从 npm 安装插件:", packageName);
      const registryBase = useChinaMirror ? "https://registry.npmmirror.com" : "https://registry.npmjs.org";
      const registryUrl = `${registryBase}/${packageName}`;
      console.log("[Plugins] 获取包信息:", registryUrl, useChinaMirror ? "(国内镜像)" : "");
      let packageInfo;
      try {
        const response = await httpGet(registryUrl);
        packageInfo = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
      } catch (error) {
        console.error("[Plugins] 获取包信息失败:", error);
        return { success: false, error: "无法获取包信息，请检查包名是否正确" };
      }
      const latestVersion = packageInfo["dist-tags"]?.latest;
      if (!latestVersion) {
        return { success: false, error: "无法获取最新版本信息" };
      }
      const versionInfo = packageInfo.versions?.[latestVersion];
      if (!versionInfo) {
        return { success: false, error: "无法获取版本详情" };
      }
      const tarballUrl = versionInfo.dist?.tarball;
      if (!tarballUrl) {
        return { success: false, error: "无法获取下载链接" };
      }
      console.log("[Plugins] 最新版本:", latestVersion);
      console.log("[Plugins] Tarball URL:", tarballUrl);
      const tempDir = path.join(electron.app.getPath("temp"), "ztools-npm-download");
      await fs.promises.mkdir(tempDir, { recursive: true });
      const tarballPath = path.join(tempDir, `${Date.now()}.tgz`);
      console.log("[Plugins] 下载 tarball 到:", tarballPath);
      let retryCount = 0;
      const maxRetries = 3;
      while (retryCount < maxRetries) {
        try {
          await downloadFile(tarballUrl, tarballPath);
          break;
        } catch (error) {
          retryCount++;
          console.error(`下载失败，重试第 ${retryCount} 次:`, error);
          if (retryCount >= maxRetries) throw error;
          await sleep(500);
        }
      }
      const extractDir = path.join(tempDir, `extract-${Date.now()}`);
      await fs.promises.mkdir(extractDir, { recursive: true });
      console.log("[Plugins] 解压 tarball 到:", extractDir);
      await tar__namespace.extract({
        file: tarballPath,
        cwd: extractDir
      });
      const packageDir = path.join(extractDir, "package");
      const pluginJsonPath = path.join(packageDir, "plugin.json");
      try {
        await fs.promises.access(pluginJsonPath);
      } catch {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return { success: false, error: "这不是一个有效的 ZTools 插件包（缺少 plugin.json）" };
      }
      const pluginJsonContent = await fs.promises.readFile(pluginJsonPath, "utf-8");
      let pluginConfig;
      try {
        pluginConfig = JSON.parse(pluginJsonContent);
      } catch {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return { success: false, error: "plugin.json 格式错误" };
      }
      if (!pluginConfig.name) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return { success: false, error: "plugin.json 缺少 name 字段" };
      }
      const pluginName = pluginConfig.name;
      const targetPath = path.join(PLUGIN_DIR$2, pluginName);
      const existingPlugins = databaseAPI.dbGet("plugins") || [];
      const existingIndex = existingPlugins.findIndex((p) => p.name === pluginName);
      if (existingIndex !== -1) {
        console.log("[Plugins] 插件已存在，执行覆盖安装:", pluginName);
        try {
          this.deps.pluginManager?.killPluginByName(pluginName);
        } catch {
        }
        existingPlugins.splice(existingIndex, 1);
        databaseAPI.dbPut("plugins", existingPlugins);
        try {
          await fs.promises.rm(targetPath, { recursive: true, force: true });
          console.log("[Plugins] 已删除旧插件目录:", targetPath);
        } catch {
        }
      }
      await fs.promises.mkdir(PLUGIN_DIR$2, { recursive: true });
      await fs.promises.rename(packageDir, targetPath);
      console.log("[Plugins] 插件已安装到:", targetPath);
      const validation = this.deps.validatePluginConfig(pluginConfig, existingPlugins);
      if (!validation.valid) {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return { success: false, error: validation.error };
      }
      const pluginInfo = this.persistPlugin(pluginConfig, targetPath, { installedFrom: "npm" });
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.error("[Plugins] 清理临时文件失败:", e);
      }
      this.logInstalledFeatures(pluginConfig, `从 npm 安装插件成功
npm 包名: ${packageName}`);
      this.deps.notifyPluginsChanged();
      return { success: true, plugin: pluginInfo };
    } catch (error) {
      console.error("[Plugins] 从 npm 安装插件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "安装失败" };
    }
  }
  /**
   * 导出所有非开发、非内置插件到下载目录。
   * 导出后自动在 Finder/Explorer 中显示导出文件夹。
   * @returns {success: boolean, exportPath?: string, count?: number, error?: string}
   */
  async exportAllPlugins() {
    try {
      const plugins = databaseAPI.dbGet("plugins");
      if (!plugins || !Array.isArray(plugins)) {
        return { success: false, error: "插件列表不存在" };
      }
      const { isBundledInternalPlugin: isBundledInternalPlugin2 } = await Promise.resolve().then(() => internalPlugins);
      const exportablePlugins = plugins.filter(
        (p) => !p.isDevelopment && !isBundledInternalPlugin2(p.name)
      );
      if (exportablePlugins.length === 0) {
        return { success: false, error: "没有可导出的插件" };
      }
      const now = /* @__PURE__ */ new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const downloadsDir = electron.app.getPath("downloads");
      const exportDir = path.join(downloadsDir, `ztools-plugins-${timestamp}`);
      await fs.promises.mkdir(exportDir, { recursive: true });
      let successCount = 0;
      for (const plugin of exportablePlugins) {
        const pluginPath = plugin.path;
        const baseName = plugin.name || path.basename(pluginPath);
        const folderName = plugin.version ? `${baseName}-v${plugin.version}` : baseName;
        const destPath = path.join(exportDir, folderName);
        try {
          await fs.promises.cp(pluginPath, destPath, { recursive: true });
          successCount++;
        } catch (err) {
          console.error(`[Plugins] 导出插件失败: ${folderName}`, err);
        }
      }
      electron.shell.showItemInFolder(exportDir);
      console.log("[Plugins] 插件导出完成:", exportDir);
      return { success: true, exportPath: exportDir, count: successCount };
    } catch (error) {
      console.error("[Plugins] 导出所有插件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "导出失败" };
    }
  }
  // ━━━ Private ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  findMarketDownloadTask(pluginNameOrTaskId) {
    const directTask = this.marketDownloadTasks.get(pluginNameOrTaskId);
    if (directTask) return directTask;
    for (const task of this.marketDownloadTasks.values()) {
      if (task.taskId === pluginNameOrTaskId) return task;
    }
    return void 0;
  }
  emitMarketDownloadProgress(task, payload) {
    const target = task.webContents?.isDestroyed() ? void 0 : task.webContents;
    const fallback = this.deps.mainWindow?.webContents;
    const sender = target || (fallback && !fallback.isDestroyed() ? fallback : void 0);
    sender?.send(MARKET_DOWNLOAD_PROGRESS_CHANNEL, payload);
  }
  /**
   * 从插件包文件（ZPX 或 ZIP）中读取并解析 plugin.json，同时返回格式标识。
   * @throws 若 plugin.json 缺失、解析失败或缺少 name 字段则抛出带描述的 Error
   */
  async readPluginJson(filePath) {
    const isZpx = await isValidZpx(filePath);
    let content;
    try {
      if (isZpx) {
        content = await readTextFromZpx(filePath, "plugin.json");
      } else {
        const zip = new AdmZip(filePath);
        content = zip.readAsText("plugin.json");
        if (!content) throw new Error();
      }
    } catch {
      throw new Error("无效的插件文件：缺少 plugin.json");
    }
    let config;
    try {
      config = JSON.parse(content);
    } catch {
      throw new Error("无效的插件文件：plugin.json 格式错误");
    }
    if (!config.name) throw new Error("无效的插件文件：缺少 name 字段");
    return { config, isZpx };
  }
  /**
   * 将插件包文件（ZPX 或 ZIP）解压到指定目录。
   */
  async extractToDir(filePath, isZpx, targetDir) {
    if (isZpx) {
      await extractZpx(filePath, targetDir);
    } else {
      new AdmZip(filePath).extractAllTo(targetDir, true);
    }
  }
  /**
   * 根据插件配置构建 pluginInfo 对象，写入数据库并返回该对象。
   */
  persistPlugin(config, pluginPath, extra) {
    const pluginInfo = {
      name: config.name,
      title: config.title,
      version: config.version,
      description: config.description || "",
      author: config.author || "",
      homepage: config.homepage || "",
      logo: config.logo ? url.pathToFileURL(path.join(pluginPath, config.logo)).href : "",
      main: config.main,
      preload: config.preload,
      features: config.features,
      path: pluginPath,
      isDevelopment: false,
      installedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...extra
    };
    let plugins = databaseAPI.dbGet("plugins");
    if (!plugins) plugins = [];
    plugins.push(pluginInfo);
    databaseAPI.dbPut("plugins", plugins);
    return pluginInfo;
  }
  /**
   * 将插件包安装到插件目录（核心安装逻辑，不做覆盖预处理）。
   * @param filePath - 插件包路径（ZPX 或 ZIP）
   * @param isZpx - 是否为 ZPX 格式（由 readPluginJson 返回）
   * @param pluginConfig - 已解析的 plugin.json 配置
   * @param extra - 写入数据库时附加的额外字段（如 installedFrom）
   */
  async installFromPackageFile(filePath, isZpx, pluginConfig, extra) {
    await fs.promises.mkdir(PLUGIN_DIR$2, { recursive: true });
    try {
      const pluginPath = path.join(PLUGIN_DIR$2, pluginConfig.name);
      try {
        await fs.promises.access(pluginPath);
        return { success: false, error: "插件目录已存在" };
      } catch {
      }
      const existingPlugins = await this.deps.getPlugins();
      if (existingPlugins.some((p) => p.name === pluginConfig.name)) {
        return { success: false, error: "插件已存在" };
      }
      const validation = this.deps.validatePluginConfig(pluginConfig, existingPlugins);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      await this.extractToDir(filePath, isZpx, pluginPath);
      const pluginInfo = this.persistPlugin(pluginConfig, pluginPath, extra);
      this.logInstalledFeatures(pluginConfig);
      this.deps.notifyPluginsChanged();
      return { success: true, plugin: pluginInfo };
    } catch (error) {
      console.error("[Plugins] 安装插件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "安装失败" };
    }
  }
  /**
   * 输出新安装插件的功能指令列表到控制台。
   * @param pluginConfig - 插件配置对象（包含 name、version、features）
   * @param header - 可选的日志标题（默认“新增插件指令”）
   */
  logInstalledFeatures(pluginConfig, header) {
    console.log(`[Plugins] 
=== ${header || "新增插件指令"} ===`);
    console.log(`插件名称: ${pluginConfig.name}`);
    console.log(`插件版本: ${pluginConfig.version}`);
    console.log("[Plugins] 新增指令列表:");
    pluginConfig.features?.forEach((feature, index) => {
      console.log(`  [${index + 1}] ${feature.code} - ${feature.explain || "无说明"}`);
      const formattedCmds = feature.cmds.map((cmd) => {
        if (typeof cmd === "string") {
          return cmd;
        } else if (typeof cmd === "object" && cmd !== null) {
          const type = cmd.type || "unknown";
          const label = cmd.label || type;
          return `[${type}] ${label}`;
        }
        return String(cmd);
      }).join(", ");
      console.log(`      关键词: ${formattedCmds}`);
    });
    console.log("[Plugins] =========================\n");
  }
}
const PLUGIN_MARKET_STOREFRONT_CACHE_KEY = "plugin-market-storefront";
const PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY = "plugin-market-storefront-fingerprint";
class PluginMarketAPI {
  /**
   * 获取插件市场列表。
   * 缓存策略：
   * 1. 先通过 latest 文件检查版本号是否有更新
   * 2. 版本相同则直接返回本地缓存
   * 3. 网络失败时降级使用本地缓存
   * @returns 插件列表和可选的 storefront 视图数据
   */
  async fetchPluginMarket() {
    const getCachedResult = () => {
      const cachedData = databaseAPI.dbGet("plugin-market-data");
      if (!Array.isArray(cachedData)) {
        return null;
      }
      const storefrontFingerprint = databaseAPI.dbGet(
        PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY
      );
      const cachedStorefront = databaseAPI.dbGet(PLUGIN_MARKET_STOREFRONT_CACHE_KEY);
      const currentFingerprint = this.getPluginMarketFingerprint(cachedData);
      const storefront = storefrontFingerprint === currentFingerprint && cachedStorefront ? cachedStorefront : void 0;
      return {
        success: true,
        data: cachedData,
        ...storefront ? { storefront } : {}
      };
    };
    try {
      const settings = databaseAPI.dbGet("settings-general");
      const defaultBaseUrl = "https://ztools.zosen.link";
      let baseUrl = defaultBaseUrl;
      if (settings?.pluginMarketCustom && settings?.pluginMarketUrl) {
        baseUrl = settings.pluginMarketUrl.replace(/\/+$/, "");
      }
      const pluginsJsonUrl = `${baseUrl}/plugins.json`;
      const latestVersionUrl = `${baseUrl}/latest`;
      const layoutUrl = `${baseUrl}/layout.yaml`;
      const categoriesUrl = `${baseUrl}/categories.json`;
      console.log("[Plugins] 从插件市场获取列表...", baseUrl);
      const timestamp = Date.now();
      let latestVersion = "";
      try {
        const versionResponse = await httpGet(`${latestVersionUrl}?t=${timestamp}`);
        latestVersion = versionResponse.data.trim();
        console.log(`发现最新插件列表版本: ${latestVersion}`);
      } catch (error) {
        console.warn("[Plugins] 获取版本号失败，将强制更新:", error);
      }
      const cachedVersion = databaseAPI.dbGet("plugin-market-version");
      if (cachedVersion === latestVersion && latestVersion) {
        const cachedResult = getCachedResult();
        if (cachedResult) {
          console.log("[Plugins] 使用本地缓存的插件市场列表");
          return cachedResult;
        }
      }
      console.log("[Plugins] 下载新版本插件列表...");
      const response = await httpGet(`${pluginsJsonUrl}?t=${timestamp}`);
      const json = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
      const plugins = Array.isArray(json) ? json : [];
      const pluginMarketFingerprint = this.getPluginMarketFingerprint(plugins);
      let storefront;
      try {
        const [layoutResponse, categoriesResponse] = await Promise.all([
          httpGet(`${layoutUrl}?t=${timestamp}`),
          httpGet(`${categoriesUrl}?t=${timestamp}`)
        ]);
        const layoutRaw = typeof layoutResponse.data === "string" ? layoutResponse.data : String(layoutResponse.data || "");
        const categories = typeof categoriesResponse.data === "string" ? JSON.parse(categoriesResponse.data) : categoriesResponse.data || [];
        storefront = this.buildPluginMarketStorefront(plugins, layoutRaw, categories);
      } catch (error) {
        console.warn("[Plugins] 获取或解析 storefront 数据失败，降级为平铺列表:", error);
      }
      databaseAPI.dbPut("plugin-market-version", latestVersion);
      databaseAPI.dbPut("plugin-market-data", plugins);
      if (storefront) {
        databaseAPI.dbPut(PLUGIN_MARKET_STOREFRONT_CACHE_KEY, storefront);
        databaseAPI.dbPut(PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY, pluginMarketFingerprint);
      } else {
        databaseAPI.dbPut(PLUGIN_MARKET_STOREFRONT_CACHE_KEY, null);
        databaseAPI.dbPut(PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY, null);
      }
      return { success: true, data: plugins, ...storefront ? { storefront } : {} };
    } catch (error) {
      console.error("[Plugins] 获取插件市场列表失败:", error);
      try {
        const cachedResult = getCachedResult();
        if (cachedResult) {
          console.log("[Plugins] 获取失败，降级使用本地缓存");
          return cachedResult;
        }
      } catch {
      }
      return { success: false, error: error instanceof Error ? error.message : "获取失败" };
    }
  }
  /**
   * 生成插件列表的指纹字符串。
   * 用于判断缓存的 storefront 是否需要重新构建（插件名称/版本/平台变化时失效）。
   * @param plugins - 全量插件列表
   * @returns 排序后的指纹字符串
   */
  getPluginMarketFingerprint(plugins) {
    return plugins.map(
      (plugin) => `${plugin?.name || ""}:${plugin?.version || ""}:${JSON.stringify(plugin?.platform || [])}`
    ).sort().join("|");
  }
  /**
   * 构建插件市场首页的 storefront 视图数据。
   * 将远程的 layout.yaml + categories.json + plugins.json 合并构建为渲染端可直接使用的结构。
   * 处理逻辑：
   * - 按当前平台过滤插件
   * - 解析 banner / navigation / fixed / random 四种区域类型
   * - fixed/random 区域中的插件自动去重（同一插件不会出现在多个区域）
   * @param plugins - 全量插件列表
   * @param layoutRaw - layout.yaml 的原始 YAML 内容
   * @param categoriesValue - categories.json 解析后的数据
   * @returns 构建好的 storefront 视图数据
   */
  buildPluginMarketStorefront(plugins, layoutRaw, categoriesValue) {
    const layoutParsed = yaml.parse(layoutRaw);
    const layoutSections = Array.isArray(layoutParsed?.layout) ? layoutParsed.layout : [];
    const categoriesList = Array.isArray(categoriesValue) ? categoriesValue : [];
    const currentPlatform = process.platform;
    const filteredPlugins = plugins.filter((plugin) => {
      if (!plugin?.platform || !Array.isArray(plugin.platform)) return true;
      return plugin.platform.includes(currentPlatform);
    });
    const pluginMap = /* @__PURE__ */ new Map();
    for (const plugin of filteredPlugins) {
      if (plugin?.name) {
        pluginMap.set(plugin.name, plugin);
      }
    }
    const categories = {};
    for (const category of categoriesList) {
      if (!category?.key) {
        continue;
      }
      const categoryPlugins = Array.isArray(category.list) ? category.list.map((pluginName) => pluginMap.get(pluginName)).filter((plugin) => !!plugin) : [];
      categories[category.key] = {
        key: category.key,
        title: category.title || category.key,
        description: category.description,
        icon: category.icon,
        plugins: categoryPlugins
      };
    }
    const categoryLayouts = {};
    if (layoutParsed) {
      for (const [key, value] of Object.entries(layoutParsed)) {
        if (key === "layout") continue;
        if (Array.isArray(value)) {
          categoryLayouts[key] = value.filter(
            (section) => section && typeof section.type === "string"
          );
        }
      }
    }
    const usedPluginNames = /* @__PURE__ */ new Set();
    const sections = [];
    let sectionIndex = 0;
    const pushUniquePlugins = (pluginNames) => {
      const result = [];
      for (const pluginName of pluginNames) {
        const plugin = pluginMap.get(pluginName);
        if (!plugin || usedPluginNames.has(pluginName)) {
          continue;
        }
        usedPluginNames.add(pluginName);
        result.push(plugin);
      }
      return result;
    };
    for (const section of layoutSections) {
      const sectionKey = `${section.type || "section"}-${sectionIndex++}`;
      if (section.type === "banner") {
        const items = Array.isArray(section.children) ? section.children.filter(
          (item) => typeof item?.image === "string" && !!item.image
        ) : [];
        if (items.length > 0) {
          sections.push({
            type: "banner",
            key: sectionKey,
            items,
            height: section.height
          });
        }
        continue;
      }
      if (section.type === "navigation") {
        const categoryKeys = Array.isArray(section.categories) ? section.categories : [];
        const navCategories = [];
        for (const categoryKey of categoryKeys) {
          const category = categories[categoryKey];
          if (!category || category.plugins.length === 0) {
            continue;
          }
          navCategories.push({
            key: category.key,
            title: category.title,
            description: category.description,
            icon: category.icon,
            showDescription: section.showDescription !== false,
            pluginCount: category.plugins.length
          });
        }
        if (navCategories.length > 0) {
          sections.push({
            type: "navigation",
            key: sectionKey,
            title: section.title,
            categories: navCategories
          });
        }
        continue;
      }
      if (section.type === "fixed") {
        const pluginNames = Array.isArray(section.plugins) ? section.plugins : [];
        const fixedPlugins = pushUniquePlugins(pluginNames);
        if (fixedPlugins.length > 0) {
          sections.push({
            type: "fixed",
            key: sectionKey,
            title: section.title,
            plugins: fixedPlugins
          });
        }
        continue;
      }
      if (section.type === "random") {
        const count = typeof section.count === "number" && section.count > 0 ? section.count : 0;
        const availablePlugins = filteredPlugins.filter(
          (plugin) => plugin?.name && !usedPluginNames.has(plugin.name)
        );
        if (count > 0 && availablePlugins.length > 0) {
          const randomPlugins = shuffleArray(availablePlugins).slice(0, count);
          for (const plugin of randomPlugins) {
            usedPluginNames.add(plugin.name);
          }
          sections.push({
            type: "random",
            key: sectionKey,
            title: section.title,
            plugins: randomPlugins
          });
        }
      }
    }
    return { sections, categories, categoryLayouts };
  }
}
const DISABLED_MAIN_PUSH_PLUGINS_KEY = "disabledMainPushPlugin";
function normalizeConfigList(data) {
  if (!Array.isArray(data)) return [];
  return data.map((item) => typeof item === "string" ? item : item?.pluginName ?? "").filter((name) => Boolean(name));
}
function removePluginNameFromSettingList(data, pluginName) {
  return data.filter((name) => name !== pluginName);
}
const DISABLED_PLUGINS_KEY = "disabled-plugins";
const PLUGIN_NAME_SETTING_KEYS = [
  "outKillPlugin",
  "autoDetachPlugin",
  "autoStartPlugin",
  DISABLED_MAIN_PUSH_PLUGINS_KEY
];
class PluginsAPI {
  mainWindow = null;
  pluginManager = null;
  disabledPluginPathSet = null;
  devProjects;
  installer;
  market;
  init(mainWindow, pluginManager2) {
    this.mainWindow = mainWindow;
    this.pluginManager = pluginManager2;
    this.devProjects = new PluginDevProjectsAPI({
      get mainWindow() {
        return mainWindow;
      },
      get pluginManager() {
        return pluginManager2;
      },
      readInstalledPlugins: () => this.readInstalledPlugins(),
      writeInstalledPlugins: (plugins) => this.writeInstalledPlugins(plugins),
      notifyPluginsChanged: () => this.notifyPluginsChanged(),
      validatePluginConfig: (config, existing) => this.validatePluginConfig(config, existing),
      resolvePluginLogo: (p, logo) => this.resolvePluginLogo(p, logo),
      getRunningPlugins: () => this.getRunningPlugins()
    });
    this.market = new PluginMarketAPI();
    this.installer = new PluginInstallerAPI({
      get mainWindow() {
        return mainWindow;
      },
      get pluginManager() {
        return pluginManager2;
      },
      get devProjects() {
        return pluginsAPI.devProjects;
      },
      getPlugins: () => this.getPlugins(),
      readInstalledPlugins: () => this.readInstalledPlugins(),
      writeInstalledPlugins: (plugins) => this.writeInstalledPlugins(plugins),
      notifyPluginsChanged: () => this.notifyPluginsChanged(),
      validatePluginConfig: (config, existing) => this.validatePluginConfig(config, existing)
    });
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle("get-plugins", () => this.getPlugins());
    electron.ipcMain.handle("get-all-plugins", () => this.getAllPlugins());
    electron.ipcMain.handle("get-disabled-plugins", () => this.getDisabledPlugins());
    electron.ipcMain.handle(
      "set-plugin-disabled",
      (_event, pluginPath, disabled) => this.setPluginDisabled(pluginPath, disabled)
    );
    electron.ipcMain.handle("import-plugin", () => this.installer.importPlugin());
    electron.ipcMain.handle(
      "import-dev-plugin",
      (_event, pluginJsonPath) => this.devProjects.importDevPlugin(pluginJsonPath)
    );
    electron.ipcMain.handle(
      "upsert-dev-project-by-config-path",
      (_event, pluginJsonPath) => this.devProjects.upsertDevProjectByConfigPath(pluginJsonPath)
    );
    electron.ipcMain.handle("get-dev-projects", () => this.devProjects.getDevProjects());
    electron.ipcMain.handle(
      "update-dev-projects-order",
      (_event, pluginNames) => this.devProjects.updateDevProjectsOrder(pluginNames)
    );
    electron.ipcMain.handle(
      "remove-dev-project",
      (_event, pluginName) => this.devProjects.removeDevProject(pluginName)
    );
    electron.ipcMain.handle(
      "install-dev-plugin",
      (_event, pluginName) => this.devProjects.installDevPlugin(pluginName)
    );
    electron.ipcMain.handle(
      "uninstall-dev-plugin",
      (_event, pluginName) => this.devProjects.uninstallDevPlugin(pluginName)
    );
    electron.ipcMain.handle(
      "validate-dev-project",
      (_event, pluginName) => this.devProjects.validateDevProject(pluginName)
    );
    electron.ipcMain.handle(
      "select-dev-project-config",
      (_event, pluginName) => this.devProjects.selectDevProjectConfig(pluginName)
    );
    electron.ipcMain.handle(
      "package-dev-project",
      (_event, pluginName, packagePath, version) => this.devProjects.packageDevProject(pluginName, packagePath, version)
    );
    electron.ipcMain.handle(
      "delete-plugin",
      (_event, pluginPath, options) => this.deletePlugin(pluginPath, options)
    );
    electron.ipcMain.handle("get-running-plugins", () => this.getRunningPlugins());
    electron.ipcMain.handle("kill-plugin", (_event, pluginPath) => this.killPlugin(pluginPath));
    electron.ipcMain.handle(
      "kill-plugin-and-return",
      (_event, pluginPath) => this.killPluginAndReturn(pluginPath)
    );
    electron.ipcMain.handle("fetch-plugin-market", () => this.market.fetchPluginMarket());
    electron.ipcMain.handle(
      "install-plugin-from-market",
      (event, plugin) => this.installer.installPluginFromMarket(plugin, event.sender)
    );
    electron.ipcMain.handle(
      "cancel-plugin-market-download",
      (_event, pluginNameOrTaskId) => this.installer.cancelPluginMarketDownload(pluginNameOrTaskId)
    );
    electron.ipcMain.handle(
      "get-plugin-readme",
      (_event, pluginPathOrName, pluginName) => this.getPluginReadme(pluginPathOrName, pluginName)
    );
    electron.ipcMain.handle(
      "get-plugin-db-data",
      (_event, pluginName) => this.getPluginDbData(pluginName)
    );
    electron.ipcMain.handle(
      "read-plugin-info-from-zpx",
      (_event, zpxPath) => this.installer.readPluginInfoFromZpx(zpxPath)
    );
    electron.ipcMain.handle(
      "install-plugin-from-path",
      (_event, zpxPath) => this.installer.installPluginFromPath(zpxPath)
    );
    electron.ipcMain.handle(
      "query-main-push",
      async (_event, pluginPath, featureCode, queryData) => {
        try {
          if (this.isPluginDisabled(pluginPath)) {
            return [];
          }
          return await this.pluginManager?.queryMainPush(pluginPath, featureCode, queryData);
        } catch (error) {
          console.error("[Plugins] mainPush 查询失败:", error);
          return [];
        }
      }
    );
    electron.ipcMain.handle(
      "select-main-push",
      async (_event, pluginPath, featureCode, selectData) => {
        try {
          if (this.isPluginDisabled(pluginPath)) {
            return false;
          }
          return await this.pluginManager?.selectMainPush(pluginPath, featureCode, selectData);
        } catch (error) {
          console.error("[Plugins] mainPush 选择失败:", error);
          return false;
        }
      }
    );
    electron.ipcMain.handle(
      "call-headless-plugin",
      async (_event, pluginPath, featureCode, action) => {
        try {
          if (this.isPluginDisabled(pluginPath)) {
            return { success: false, error: "插件已禁用" };
          }
          const result = await this.pluginManager?.callHeadlessPluginMethod(
            pluginPath,
            featureCode,
            action
          );
          return { success: true, result };
        } catch (error) {
          console.error("[Plugins] 调用无界面插件失败:", error);
          return { success: false, error: error instanceof Error ? error.message : "未知错误" };
        }
      }
    );
    electron.ipcMain.handle("get-plugin-memory-info", async (_event, pluginPath) => {
      try {
        const memoryInfo = await this.pluginManager?.getPluginMemoryInfo(pluginPath);
        return { success: true, data: memoryInfo };
      } catch (error) {
        console.error("[Plugins] 获取插件内存信息失败:", error);
        return { success: false, error: error instanceof Error ? error.message : "获取失败" };
      }
    });
    electron.ipcMain.handle(
      "install-plugin-from-npm",
      (_event, options) => this.installer.installPluginFromNpm(options.packageName, options.useChinaMirror)
    );
    electron.ipcMain.handle("export-all-plugins", () => this.installer.exportAllPlugins());
  }
  // 获取插件列表（过滤掉内置插件，用于插件中心显示）
  async getPlugins() {
    const allPlugins = await this.getAllPlugins();
    return allPlugins.filter((plugin) => !isBundledInternalPlugin(plugin.name));
  }
  getDisabledPlugins() {
    if (this.disabledPluginPathSet) {
      return [...this.disabledPluginPathSet];
    }
    const data = databaseAPI.dbGet(DISABLED_PLUGINS_KEY);
    const disabledPlugins = Array.isArray(data) ? data.filter((item) => typeof item === "string") : [];
    this.disabledPluginPathSet = new Set(disabledPlugins);
    return disabledPlugins;
  }
  getDisabledPluginSet() {
    if (!this.disabledPluginPathSet) {
      this.getDisabledPlugins();
    }
    return this.disabledPluginPathSet;
  }
  isPluginDisabled(pluginPath) {
    return this.getDisabledPluginSet().has(pluginPath);
  }
  async setPluginDisabled(pluginPath, disabled) {
    try {
      const plugins = databaseAPI.dbGet("plugins");
      if (!Array.isArray(plugins)) {
        return { success: false, error: "插件列表不存在" };
      }
      const plugin = plugins.find((item) => item.path === pluginPath);
      if (!plugin) {
        return { success: false, error: "插件不存在" };
      }
      if (isBundledInternalPlugin(plugin.name)) {
        return { success: false, error: "内置插件不能禁用" };
      }
      const disabledPlugins = this.getDisabledPluginSet();
      const isCurrentlyDisabled = disabledPlugins.has(pluginPath);
      if (isCurrentlyDisabled === disabled) {
        return { success: true };
      }
      if (disabled) {
        disabledPlugins.add(pluginPath);
      } else {
        disabledPlugins.delete(pluginPath);
      }
      this.disabledPluginPathSet = disabledPlugins;
      databaseAPI.dbPut(DISABLED_PLUGINS_KEY, [...disabledPlugins]);
      if (disabled && this.pluginManager) {
        this.pluginManager.killPlugin(pluginPath);
      }
      this.mainWindow?.webContents.send("plugins-changed");
      this.mainWindow?.webContents.send("super-panel-pinned-changed");
      return { success: true };
    } catch (error) {
      console.error("[Plugins] 更新插件禁用状态失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 获取所有插件列表（包括 system 插件，用于生成搜索指令）
  async getAllPlugins() {
    try {
      const data = databaseAPI.dbGet("plugins");
      const plugins = data || [];
      const webSearchFeatures = await webSearchAPI.getSearchEngineFeatures();
      for (const plugin of plugins) {
        const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name);
        plugin.features = [...plugin.features || [], ...dynamicFeatures];
        if (plugin.name === "system" && webSearchFeatures.length > 0) {
          plugin.features = [...plugin.features, ...webSearchFeatures];
        }
        if (plugin.logo) {
          plugin.logo = normalizeIconPath(plugin.logo, plugin.path);
        }
        if (plugin.features && Array.isArray(plugin.features)) {
          for (const feature of plugin.features) {
            if (feature.icon) {
              feature.icon = normalizeIconPath(feature.icon, plugin.path);
            }
          }
        }
      }
      return plugins;
    } catch (error) {
      console.error("[Plugins] 获取插件列表失败:", error);
      return [];
    }
  }
  readInstalledPlugins() {
    const plugins = databaseAPI.dbGet("plugins");
    return Array.isArray(plugins) ? plugins : [];
  }
  writeInstalledPlugins(plugins) {
    databaseAPI.dbPut("plugins", plugins);
  }
  notifyPluginsChanged() {
    this.mainWindow?.webContents.send("plugins-changed");
  }
  /**
   * 验证插件配置
   * @param pluginConfig 插件配置对象
   * @param existingPlugins 已存在的插件列表
   * @returns 验证结果 { valid: boolean, error?: string }
   */
  validatePluginConfig(pluginConfig, existingPlugins) {
    if (pluginConfig.title) {
      const titleConflict = existingPlugins.find(
        (p) => p.title === pluginConfig.title && !isDevelopmentPluginName(p.name)
      );
      if (titleConflict) {
        return {
          valid: false,
          error: `插件标题 "${pluginConfig.title}" 已被插件 "${titleConflict.name}" 使用，请使用不同的标题`
        };
      }
    }
    const requiredFields = ["name", "version"];
    for (const field of requiredFields) {
      if (!pluginConfig[field]) {
        return { valid: false, error: `缺少必填字段: ${field}` };
      }
    }
    const hasFeatures = Array.isArray(pluginConfig.features) && pluginConfig.features.length > 0;
    const hasTools = pluginConfig.tools && typeof pluginConfig.tools === "object" && !Array.isArray(pluginConfig.tools) && Object.keys(pluginConfig.tools).length > 0;
    if (!hasFeatures && !hasTools) {
      return { valid: false, error: "features 和 tools 不能同时为空" };
    }
    if (hasFeatures) {
      for (const feature of pluginConfig.features) {
        if (!feature.code || !Array.isArray(feature.cmds)) {
          return { valid: false, error: "feature 缺少必填字段 (code, cmds)" };
        }
      }
    }
    if (hasTools) {
      for (const [toolName, tool] of Object.entries(pluginConfig.tools)) {
        if (!/^[a-z][a-z0-9_]*$/.test(toolName)) {
          return { valid: false, error: `tools.${toolName} 必须使用小写 snake_case 命名` };
        }
        if (!tool || typeof tool !== "object") {
          return { valid: false, error: `tools.${toolName} 配置无效` };
        }
        if (typeof tool.description !== "string" || !tool.description.trim()) {
          return { valid: false, error: `tools.${toolName}.description 必须是非空字符串` };
        }
        if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
          return { valid: false, error: `tools.${toolName}.inputSchema 必须是对象` };
        }
      }
    }
    if (!pluginConfig.main && hasTools) {
      if (!pluginConfig.preload) {
        return { valid: false, error: "声明 tools 的插件必须提供 preload" };
      }
      if (!pluginConfig.logo) {
        return { valid: false, error: "声明 tools 的插件必须提供 logo" };
      }
    }
    return { valid: true };
  }
  resolvePluginLogo(pluginPath, logo) {
    if (typeof logo !== "string" || !logo) return "";
    if (/^(https?:|file:)/.test(logo)) return logo;
    return url.pathToFileURL(path.join(pluginPath, logo)).href;
  }
  /**
   * 删除插件
   * @param pluginPath 插件路径
   * @param options 删除选项 当 options.deleteData 显式设置为 false 时，保留插件数据
   */
  async deletePlugin(pluginPath, options = {}) {
    try {
      const plugins = databaseAPI.dbGet("plugins");
      if (!plugins || !Array.isArray(plugins)) {
        return { success: false, error: "插件列表不存在" };
      }
      const pluginIndex = plugins.findIndex((p) => p.path === pluginPath);
      if (pluginIndex === -1) {
        return { success: false, error: "插件不存在" };
      }
      const pluginInfo = plugins[pluginIndex];
      if (isBundledInternalPlugin(pluginInfo.name)) {
        return {
          success: false,
          error: "内置插件不能卸载"
        };
      }
      this.pluginManager?.killPlugin(pluginPath);
      plugins.splice(pluginIndex, 1);
      databaseAPI.dbPut("plugins", plugins);
      this.devProjects.removePluginUsageData(pluginInfo.name);
      if (options.deleteData !== false) {
        await databaseAPI.clearPluginData(pluginInfo.name);
        this.removePluginNameConfigs(PLUGIN_NAME_SETTING_KEYS, pluginInfo.name);
      }
      const disabledPlugins = this.getDisabledPluginSet();
      if (disabledPlugins.delete(pluginPath)) {
        this.disabledPluginPathSet = disabledPlugins;
        databaseAPI.dbPut(DISABLED_PLUGINS_KEY, [...disabledPlugins]);
      }
      this.notifyPluginsChanged();
      if (!pluginInfo.isDevelopment) {
        try {
          await fs.promises.rm(pluginPath, { recursive: true, force: true });
          console.log("[Plugins] 已删除插件目录:", pluginPath);
        } catch (error) {
          console.error("[Plugins] 删除插件目录失败:", error);
        }
      } else {
        console.log("[Plugins] 开发中插件，保留目录:", pluginPath);
      }
      return { success: true };
    } catch (error) {
      console.error("[Plugins] 删除插件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  removePluginNameConfigs(keys, pluginName) {
    for (const key of keys) {
      const current = databaseAPI.dbGet(key);
      const normalized = normalizeConfigList(current);
      const next = removePluginNameFromSettingList(normalized, pluginName);
      if (next.length !== normalized.length) {
        databaseAPI.dbPut(key, next);
      }
    }
  }
  async setPluginMainPushDisabled(pluginName, disabled) {
    try {
      const disabledPluginNames = new Set(
        normalizeConfigList(databaseAPI.dbGet(DISABLED_MAIN_PUSH_PLUGINS_KEY))
      );
      const isCurrentlyDisabled = disabledPluginNames.has(pluginName);
      if (isCurrentlyDisabled === disabled) {
        return { success: true };
      }
      if (disabled) {
        disabledPluginNames.add(pluginName);
      } else {
        disabledPluginNames.delete(pluginName);
      }
      databaseAPI.dbPut(DISABLED_MAIN_PUSH_PLUGINS_KEY, [...disabledPluginNames]);
      this.notifyPluginsChanged();
      return { success: true };
    } catch (error) {
      console.error("[Plugins] 更新插件 mainPush 状态失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 获取运行中的插件
  getRunningPlugins() {
    if (this.pluginManager) {
      return this.pluginManager.getRunningPlugins();
    }
    return [];
  }
  // 终止插件
  killPlugin(pluginPath) {
    try {
      console.log("[Plugins] 终止插件:", pluginPath);
      if (this.pluginManager) {
        const result = this.pluginManager.killPlugin(pluginPath);
        if (result) {
          return { success: true };
        } else {
          return { success: false, error: "插件未运行" };
        }
      }
      return { success: false, error: "功能不可用" };
    } catch (error) {
      console.error("[Plugins] 终止插件失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 终止插件并返回搜索页面
  killPluginAndReturn(pluginPath) {
    try {
      console.log("[Plugins] 终止插件并返回搜索页面:", pluginPath);
      if (this.pluginManager) {
        const result = this.pluginManager.killPlugin(pluginPath);
        if (result) {
          windowManager.notifyBackToSearch();
          this.mainWindow?.webContents.focus();
          return { success: true };
        } else {
          return { success: false, error: "插件未运行" };
        }
      }
      return { success: false, error: "功能不可用" };
    } catch (error) {
      console.error("[Plugins] 终止插件并返回搜索页面失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 获取插件 README.md 内容
  async getPluginReadme(pluginPathOrName, pluginName) {
    try {
      if (pluginPathOrName.includes("/") || pluginPathOrName.includes("\\")) {
        return await this.getLocalPluginReadme(pluginPathOrName);
      }
      const name = pluginName || pluginPathOrName;
      return await this.getRemotePluginReadme(name);
    } catch (error) {
      console.error("[Plugins] 读取插件 README 失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "读取失败" };
    }
  }
  // 读取本地插件 README
  async getLocalPluginReadme(pluginPath) {
    try {
      const possibleReadmeFiles = ["README.md", "readme.md", "Readme.md", "README.MD"];
      for (const filename of possibleReadmeFiles) {
        const readmePath = path.join(pluginPath, filename);
        try {
          let content = await fs.promises.readFile(readmePath, "utf-8");
          const pluginPathUrl = url.pathToFileURL(pluginPath).href;
          content = content.replace(
            /!\[([^\]]*)\]\((?!http|file:)([^)]+)\)/g,
            (_match, alt, imgPath) => {
              const cleanPath = imgPath.replace(/^\.\//, "");
              return `![${alt}](${pluginPathUrl}/${cleanPath})`;
            }
          );
          content = content.replace(
            /<img([^>]*?)src=["'](?!http|file:)([^"']+)["']([^>]*?)>/gi,
            (_match, before, src, after) => {
              const cleanSrc = src.replace(/^\.\//, "");
              return `<img${before}src="${pluginPathUrl}/${cleanSrc}"${after}>`;
            }
          );
          content = content.replace(
            /\[([^\]]+)\]\((?!http|file:|#)([^)]+)\)/g,
            (_match, text, linkPath) => {
              const cleanPath = linkPath.replace(/^\.\//, "");
              return `[${text}](${pluginPathUrl}/${cleanPath})`;
            }
          );
          content = content.replace(
            /<a([^>]*?)href=["'](?!http|file:|#)([^"']+)["']([^>]*?)>/gi,
            (_match, before, href, after) => {
              const cleanHref = href.replace(/^\.\//, "");
              return `<a${before}href="${pluginPathUrl}/${cleanHref}"${after}>`;
            }
          );
          return { success: true, content };
        } catch {
          continue;
        }
      }
      return { success: false, error: "暂无详情" };
    } catch (error) {
      console.error("[Plugins] 读取本地插件 README 失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "读取失败" };
    }
  }
  // 从远程加载插件 README
  async getRemotePluginReadme(pluginName) {
    try {
      const baseUrl = `https://raw.githubusercontent.com/ZToolsCenter/ZTools-plugins/main/plugins/${pluginName}`;
      const readmeUrl = `${baseUrl}/README.md`;
      console.log("[Plugins] 从远程加载 README:", readmeUrl);
      const response = await httpGet(readmeUrl, {
        validateStatus: (status) => status >= 200 && status < 400
      });
      if (response.status >= 300) {
        return { success: false, error: "暂无详情" };
      }
      let content = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      content = content.replace(/!\[([^\]]*)\]\((?!http)([^)]+)\)/g, (_match, alt, imgPath) => {
        const cleanPath = imgPath.replace(/^\.\//, "");
        return `![${alt}](${baseUrl}/${cleanPath})`;
      });
      content = content.replace(
        /<img([^>]*?)src=["'](?!http)([^"']+)["']([^>]*?)>/gi,
        (_match, before, src, after) => {
          const cleanSrc = src.replace(/^\.\//, "");
          return `<img${before}src="${baseUrl}/${cleanSrc}"${after}>`;
        }
      );
      content = content.replace(/\[([^\]]+)\]\((?!http|#)([^)]+)\)/g, (_match, text, linkPath) => {
        const cleanPath = linkPath.replace(/^\.\//, "");
        return `[${text}](${baseUrl}/${cleanPath})`;
      });
      content = content.replace(
        /<a([^>]*?)href=["'](?!http|#)([^"']+)["']([^>]*?)>/gi,
        (_match, before, href, after) => {
          const cleanHref = href.replace(/^\.\//, "");
          return `<a${before}href="${baseUrl}/${cleanHref}"${after}>`;
        }
      );
      return { success: true, content };
    } catch (error) {
      console.error("[Plugins] 从远程加载插件 README 失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "加载失败" };
    }
  }
  // 获取插件存储的数据库数据
  getPluginDbData(pluginName) {
    try {
      if (pluginName === "ZTOOLS") {
        const allData2 = lmdbInstance.allDocs("ZTOOLS/");
        return {
          success: true,
          data: allData2.map((item) => ({
            id: item._id.substring("ZTOOLS/".length),
            data: item.data,
            rev: item._rev,
            updatedAt: item.updatedAt || item._updatedAt
          }))
        };
      }
      if (!pluginName) {
        return { success: false, error: "插件标识无效" };
      }
      const prefix = getPluginDataPrefix(pluginName);
      const allData = lmdbInstance.allDocs(prefix);
      if (!allData || allData.length === 0) {
        return { success: true, data: [] };
      }
      const formattedData = allData.map((item) => ({
        id: item._id.substring(prefix.length),
        data: item.data,
        rev: item._rev,
        updatedAt: item.updatedAt || item._updatedAt
      }));
      return { success: true, data: formattedData };
    } catch (error) {
      console.error("[Plugins] 获取插件数据失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "获取失败" };
    }
  }
}
const pluginsAPI = new PluginsAPI();
const TRANSLATION_DIR = "bergamot-translation";
const BERGAMOT_CDN = "https://unpkg.com/@browsermt/bergamot-translator@0.4.9/worker";
const FIREFOX_CDN = "https://firefox-settings-attachments.cdn.mozilla.net";
const RESOURCE_FILES = [
  // WASM 运行时
  {
    name: "translator-worker.js",
    url: `${BERGAMOT_CDN}/translator-worker.js`
  },
  {
    name: "bergamot-translator-worker.js",
    url: `${BERGAMOT_CDN}/bergamot-translator-worker.js`
  },
  {
    name: "bergamot-translator-worker.wasm",
    url: `${BERGAMOT_CDN}/bergamot-translator-worker.wasm`
  },
  // En→Zh 翻译模型（来自 Firefox Translations CDN）
  {
    name: "model.enzh.intgemm.alphas.bin",
    url: `${FIREFOX_CDN}/main-workspace/translations-models/a7ff7d5e-e67e-406c-a34b-a7edea35b10e.bin`
  },
  {
    name: "lex.50.50.enzh.s2t.bin",
    url: `${FIREFOX_CDN}/main-workspace/translations-models/da8fccc0-31df-4665-9703-96d36606e019.bin`
  },
  {
    name: "srcvocab.enzh.spm",
    url: `${FIREFOX_CDN}/main-workspace/translations-models/ea98c52c-58dc-45d5-af23-38f2b029d020.spm`
  },
  {
    name: "trgvocab.enzh.spm",
    url: `${FIREFOX_CDN}/main-workspace/translations-models/bddbda68-d4d2-4317-a0a1-119caa47525e.spm`
  }
];
const WINDOWS_FILE_READ_NEEDLE = "const buffer = await readFile(url.pathname);";
const WINDOWS_FILE_READ_PATCH = [
  "const {fileURLToPath} = require(/* webpackIgnore: true */ 'node:url');",
  "                const buffer = await readFile(fileURLToPath(url));"
].join("\n");
const WINDOWS_LOCATION_NEEDLE = "return new URL(`file://${__filename}`);";
const WINDOWS_LOCATION_PATCH = [
  "const {pathToFileURL} = require(/* webpackIgnore: true */ 'node:url');",
  "            return pathToFileURL(__filename);"
].join("\n");
class TranslationManager {
  worker = null;
  enabled = false;
  status = "idle";
  errorMessage = "";
  translationDir = "";
  messageId = 0;
  pendingMessages = /* @__PURE__ */ new Map();
  init() {
    this.translationDir = path.join(electron.app.getPath("home"), ".ztools", TRANSLATION_DIR);
    this.setupIPC();
    this.loadConfig();
  }
  loadConfig() {
    try {
      const data = databaseAPI.dbGet("settings-general");
      this.enabled = data?.superPanelTranslateEnabled ?? false;
      if (this.enabled) {
        this.initializeTranslator();
      }
    } catch (error) {
      console.error("[Translation] 加载翻译配置失败:", error);
    }
  }
  /**
   * 更新翻译功能开关
   */
  updateEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.initializeTranslator();
    } else {
      this.destroyWorker();
      this.status = "idle";
      this.errorMessage = "";
    }
  }
  getStatus() {
    return { status: this.status, error: this.errorMessage || void 0 };
  }
  /**
   * 判断文本是否主要为中文（CJK 字符占比 > 50%）
   */
  isMostlyChinese(text) {
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
    const cjkMatches = text.match(cjkRegex);
    if (!cjkMatches) return false;
    const nonWhitespace = text.replace(/\s/g, "").length;
    if (nonWhitespace === 0) return false;
    return cjkMatches.length / nonWhitespace > 0.5;
  }
  /**
   * 翻译文本（英文 → 中文）
   */
  async translate(text) {
    if (!this.enabled || this.status !== "ready" || !this.worker) return null;
    if (!text || text.trim().length === 0) return null;
    if (this.isMostlyChinese(text)) return null;
    const truncated = text.length > 1e3 ? text.slice(0, 1e3) + "..." : text;
    try {
      const result = await this.sendWorkerMessage("translate", [
        {
          models: [{ from: "en", to: "zh" }],
          texts: [{ text: truncated, html: false }]
        }
      ]);
      return result?.[0]?.target?.text || null;
    } catch (error) {
      console.error("[Translation] 翻译失败:", error);
      return null;
    }
  }
  /**
   * 初始化翻译引擎（下载资源 + 创建 Worker + 加载模型）
   */
  async initializeTranslator() {
    if (this.status === "downloading" || this.status === "initializing") return;
    try {
      if (!this.areResourcesReady()) {
        this.status = "downloading";
        console.log("[Translation] 开始下载翻译资源...");
        await this.downloadResources();
        console.log("[Translation] 翻译资源下载完成");
      }
      this.patchWorkerScriptIfNeeded();
      this.status = "initializing";
      await this.createWorker();
      await this.loadModel();
      this.status = "ready";
      this.errorMessage = "";
      console.log("[Translation] Bergamot 翻译引擎已就绪");
    } catch (error) {
      this.status = "error";
      this.errorMessage = error instanceof Error ? error.message : "初始化失败";
      console.error("[Translation] 初始化翻译引擎失败:", error);
    }
  }
  areResourcesReady() {
    return RESOURCE_FILES.every((f) => fs.existsSync(path.join(this.translationDir, f.name)));
  }
  async downloadResources() {
    if (!fs.existsSync(this.translationDir)) {
      fs.mkdirSync(this.translationDir, { recursive: true });
    }
    for (const file of RESOURCE_FILES) {
      const filePath = path.join(this.translationDir, file.name);
      if (fs.existsSync(filePath)) continue;
      console.log(`[Translation] 下载: ${file.name}`);
      try {
        await this.downloadResource(file.url, filePath);
      } catch (error) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        throw new Error(
          `下载 ${file.name} 失败: ${error instanceof Error ? error.message : "未知错误"}`
        );
      }
    }
  }
  /**
   * 使用 Node.js 原生 https 下载资源（避免 Electron net 模块附加额外请求头）
   */
  downloadResource(url2, filePath) {
    return new Promise((resolve, reject) => {
      const request = https.get(url2, { headers: { Accept: "*/*" } }, (response) => {
        if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
          this.downloadResource(response.headers.location, filePath).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
        fileStream.on("error", reject);
      });
      request.on("error", reject);
    });
  }
  async createWorker() {
    this.destroyWorker();
    const workerPath = path.join(this.translationDir, "translator-worker.js");
    this.worker = new worker_threads.Worker(workerPath);
    this.worker.on("message", (msg) => {
      const pending = this.pendingMessages.get(msg.id);
      if (pending) {
        this.pendingMessages.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || "Worker error"));
        } else {
          pending.resolve(msg.result);
        }
      }
    });
    this.worker.on("error", (err) => {
      console.error("[Translation] Worker 错误:", err);
      this.status = "error";
      this.errorMessage = err.message;
    });
    this.worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(`[Translation] Worker 异常退出 (code: ${code})`);
      }
      this.worker = null;
    });
    await this.sendWorkerMessage("initialize", [{ cacheSize: 0 }]);
  }
  /**
   * 上游 translator-worker.js 在 Windows 的 Node worker 环境中会错误处理 file:// URL，
   * 导致 wasm 路径被解析成 C:\C:\...。这里在启动前对下载后的脚本做一次就地修补。
   */
  patchWorkerScriptIfNeeded() {
    const workerPath = path.join(this.translationDir, "translator-worker.js");
    if (!fs.existsSync(workerPath)) return;
    const originalContent = fs.readFileSync(workerPath, "utf-8");
    const patchedContent = this.patchBergamotWorkerScript(originalContent);
    if (patchedContent !== originalContent) {
      fs.writeFileSync(workerPath, patchedContent, "utf-8");
      console.log("[Translation] 已修补 Bergamot worker 的本地文件 URL 兼容性");
    }
  }
  /**
   * 将上游脚本中依赖 URL.pathname 和手写 file:// 的实现，
   * 替换为 Node 官方的 fileURLToPath/pathToFileURL，确保 Windows 盘符路径正确。
   */
  patchBergamotWorkerScript(scriptContent) {
    let patchedContent = scriptContent;
    if (patchedContent.includes(WINDOWS_FILE_READ_NEEDLE)) {
      patchedContent = patchedContent.replace(WINDOWS_FILE_READ_NEEDLE, WINDOWS_FILE_READ_PATCH);
    }
    if (patchedContent.includes(WINDOWS_LOCATION_NEEDLE)) {
      patchedContent = patchedContent.replace(WINDOWS_LOCATION_NEEDLE, WINDOWS_LOCATION_PATCH);
    }
    return patchedContent;
  }
  async loadModel() {
    const modelBuffer = fs.readFileSync(
      path.join(this.translationDir, "model.enzh.intgemm.alphas.bin")
    );
    const lexBuffer = fs.readFileSync(path.join(this.translationDir, "lex.50.50.enzh.s2t.bin"));
    const srcVocabBuffer = fs.readFileSync(path.join(this.translationDir, "srcvocab.enzh.spm"));
    const trgVocabBuffer = fs.readFileSync(path.join(this.translationDir, "trgvocab.enzh.spm"));
    const toArrayBuffer = (buf) => {
      const ab = new ArrayBuffer(buf.byteLength);
      const view = new Uint8Array(ab);
      view.set(buf);
      return ab;
    };
    await this.sendWorkerMessage("loadTranslationModel", [
      { from: "en", to: "zh" },
      {
        model: toArrayBuffer(modelBuffer),
        shortlist: toArrayBuffer(lexBuffer),
        vocabs: [toArrayBuffer(srcVocabBuffer), toArrayBuffer(trgVocabBuffer)]
      }
    ]);
  }
  sendWorkerMessage(name, args) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker 未初始化"));
        return;
      }
      const id = ++this.messageId;
      const timeoutMs = name === "initialize" ? 3e4 : 1e4;
      const timeout = setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Worker 消息超时: ${name}`));
        }
      }, timeoutMs);
      this.pendingMessages.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        }
      });
      this.worker.postMessage({ id, name, args });
    });
  }
  destroyWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, pending] of this.pendingMessages) {
      pending.reject(new Error("Worker 已终止"));
    }
    this.pendingMessages.clear();
  }
  setupIPC() {
    electron.ipcMain.handle("translation:get-status", () => this.getStatus());
    electron.ipcMain.handle("translation:download-and-init", async () => {
      try {
        await this.initializeTranslator();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "初始化失败"
        };
      }
    });
  }
}
const translationManager = new TranslationManager();
const SUPER_PANEL_WIDTH = 250;
const SUPER_PANEL_HEIGHT = 400;
const CLIPBOARD_WAIT_MS = 180;
class SuperPanelManager {
  superPanelWindow = null;
  mainWindow = null;
  windowReady = false;
  pendingMessages = [];
  config = {
    enabled: false,
    mouseButton: "middle",
    longPressMs: 500,
    blockedApps: []
  };
  /**
   * 初始化超级面板管理器
   */
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupIPC();
    this.loadConfig();
  }
  /**
   * 从数据库加载配置并启动监听
   */
  loadConfig() {
    try {
      const data = databaseAPI.dbGet("settings-general");
      if (data) {
        this.config = {
          enabled: data.superPanelEnabled ?? false,
          mouseButton: data.superPanelMouseButton ?? "middle",
          longPressMs: data.superPanelLongPressMs ?? 500,
          blockedApps: data.superPanelBlockedApps ?? []
        };
        if (this.config.enabled) {
          this.startMonitor();
        }
        console.log("[SuperPanel] 超级面板配置已加载:", this.config);
      }
    } catch (error) {
      console.error("[SuperPanel] 加载超级面板配置失败:", error);
    }
  }
  /**
   * 设置变更时调用（从设置页面触发）
   */
  updateConfig(config) {
    this.config = {
      enabled: config.enabled,
      mouseButton: config.mouseButton,
      longPressMs: config.longPressMs,
      blockedApps: this.config.blockedApps
    };
    if (this.config.enabled) {
      this.startMonitor();
    } else {
      this.stopMonitor();
      this.hideWindow();
    }
    console.log("[SuperPanel] 超级面板配置已更新:", this.config);
  }
  /**
   * 单独更新屏蔽列表
   */
  updateBlockedApps(blockedApps) {
    this.config.blockedApps = blockedApps;
    console.log("[SuperPanel] 超级面板屏蔽列表已更新:", blockedApps.length, "项");
  }
  /**
   * 判断当前窗口是否被屏蔽
   */
  isWindowBlocked(windowInfo) {
    if (!this.config.blockedApps || this.config.blockedApps.length === 0) {
      return false;
    }
    const appName = windowInfo.app.toLowerCase();
    for (const blocked of this.config.blockedApps) {
      if (blocked.bundleId && windowInfo.bundleId) {
        if (blocked.bundleId.toLowerCase() === windowInfo.bundleId.toLowerCase()) {
          return true;
        }
      }
      if (blocked.app.toLowerCase() === appName) {
        return true;
      }
    }
    return false;
  }
  /**
   * 启动鼠标监听
   */
  startMonitor() {
    if (MouseMonitor.isMonitoring) {
      MouseMonitor.stop();
    }
    try {
      MouseMonitor.start(this.config.mouseButton, this.config.longPressMs, () => {
        return this.onMouseTrigger();
      });
      console.log(
        `[SuperPanel] 超级面板鼠标监听已启动: ${this.config.mouseButton}, ${this.config.longPressMs}ms`
      );
    } catch (error) {
      console.error("[SuperPanel] 启动超级面板鼠标监听失败:", error);
    }
  }
  /**
   * 停止鼠标监听
   */
  stopMonitor() {
    if (MouseMonitor.isMonitoring) {
      MouseMonitor.stop();
      console.log("[SuperPanel] 超级面板鼠标监听已停止");
    }
  }
  // 当前剪贴板内容（在模拟复制后读取）
  currentClipboardContent = null;
  // 触发时的完整窗口信息
  currentWindowInfo = null;
  /**
   * 将剪贴板管理器返回的数据转换为超级面板使用的结构
   */
  convertLastCopiedContent(content) {
    if (!content) {
      return null;
    }
    if (content.type === "text") {
      return typeof content.data === "string" && content.data.trim() !== "" ? { type: "text", text: content.data } : null;
    }
    if (content.type === "image") {
      return typeof content.data === "string" && content.data ? { type: "image", image: content.data } : null;
    }
    return Array.isArray(content.data) && content.data.length > 0 ? { type: "file", files: content.data } : null;
  }
  /**
   * 鼠标触发回调
   */
  onMouseTrigger() {
    try {
      const cursorPoint = electron.screen.getCursorScreenPoint();
      const cachedWindow = clipboardManager.getCurrentWindow();
      const activeWindow = WindowManager$1.getActiveWindow();
      const windowInfo = activeWindow ? { ...cachedWindow, ...activeWindow } : cachedWindow;
      this.currentWindowInfo = windowInfo ?? null;
      const windowToCheck = activeWindow || cachedWindow;
      if (windowToCheck && this.isWindowBlocked(windowToCheck)) {
        console.log("[SuperPanel] 当前窗口被屏蔽，跳过触发:", windowToCheck.app);
        return { shouldBlock: false };
      }
      this.onMouseTriggerAsync(cursorPoint);
      return { shouldBlock: true };
    } catch (error) {
      console.error("[SuperPanel] 超级面板触发失败:", error);
      return { shouldBlock: false };
    }
  }
  async onMouseTriggerAsync(cursorPoint) {
    try {
      const lastSequence = clipboardManager.getLastCopiedSequence();
      const modifier = process.platform === "darwin" ? "meta" : "ctrl";
      WindowManager$1.simulateKeyboardTap("c", modifier);
      const lastCopiedContent = await clipboardManager.getLastCopiedContent(
        CLIPBOARD_WAIT_MS,
        lastSequence
      );
      const newContent = this.convertLastCopiedContent(lastCopiedContent);
      const hasNewContent = !!newContent;
      this.currentClipboardContent = hasNewContent ? newContent : null;
      this.showWindow(cursorPoint.x, cursorPoint.y);
      if (hasNewContent && newContent) {
        this.requestSearch(newContent);
        if (newContent.type === "text" && newContent.text) {
          this.requestTranslation(newContent.text);
        }
      } else {
        this.loadPinnedCommands();
      }
    } catch (error) {
      console.error("[SuperPanel] 超级面板触发失败:", error);
    }
  }
  /**
   * 创建超级面板窗口
   */
  createWindow(x, y) {
    this.windowReady = false;
    this.pendingMessages = [];
    const { position } = this.adjustPosition(x, y);
    const windowConfig = {
      width: SUPER_PANEL_WIDTH,
      height: SUPER_PANEL_HEIGHT,
      x: position.x,
      y: position.y,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      hasShadow: true,
      type: "panel",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        webSecurity: false
      }
    };
    if (process.platform === "darwin") {
      windowConfig.transparent = true;
      windowConfig.vibrancy = "fullscreen-ui";
    } else if (process.platform === "win32") {
      windowConfig.backgroundColor = "#00000000";
    }
    const win = new electron.BrowserWindow(windowConfig);
    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (process.platform === "win32") {
      this.applyMaterialToWindow(win);
    }
    if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/super-panel.html`);
    } else {
      win.loadFile(path.join(__dirname, "../renderer/super-panel.html"));
    }
    win.once("ready-to-show", () => {
      win.show();
    });
    win.on("blur", () => {
      this.hideWindow();
    });
    win.on("closed", () => {
      this.superPanelWindow = null;
      this.windowReady = false;
      this.pendingMessages = [];
    });
    return win;
  }
  /**
   * 调整窗口位置，防止超出屏幕边界
   */
  adjustPosition(x, y) {
    const display = electron.screen.getDisplayNearestPoint({ x, y });
    const { workArea } = display;
    let adjustedX = x;
    let adjustedY = y;
    if (adjustedX + SUPER_PANEL_WIDTH > workArea.x + workArea.width) {
      adjustedX = workArea.x + workArea.width - SUPER_PANEL_WIDTH;
    }
    if (adjustedX < workArea.x) {
      adjustedX = workArea.x;
    }
    if (adjustedY + SUPER_PANEL_HEIGHT > workArea.y + workArea.height) {
      adjustedY = workArea.y + workArea.height - SUPER_PANEL_HEIGHT;
    }
    if (adjustedY < workArea.y) {
      adjustedY = workArea.y;
    }
    return { position: { x: adjustedX, y: adjustedY } };
  }
  /**
   * 显示超级面板窗口
   */
  showWindow(x, y) {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
      const { position } = this.adjustPosition(x, y);
      this.superPanelWindow.setPosition(position.x, position.y);
      this.superPanelWindow.show();
      this.superPanelWindow.focus();
    } else {
      this.superPanelWindow = this.createWindow(x, y);
    }
  }
  /**
   * 从数据库读取材质设置并应用到指定窗口
   */
  applyMaterialToWindow(win) {
    try {
      const settings = databaseAPI.dbGet("settings-general");
      const material = settings?.windowMaterial || getDefaultWindowMaterial();
      applyWindowMaterial(win, material);
      win.webContents.send("update-window-material", material);
    } catch (error) {
      console.error("[SuperPanel] 应用窗口材质失败:", error);
    }
  }
  /**
   * 更新超级面板窗口材质（由 windowManager 广播时调用）
   */
  updateWindowMaterial(material) {
    if (!this.superPanelWindow || this.superPanelWindow.isDestroyed()) return;
    applyWindowMaterial(this.superPanelWindow, material);
    this.superPanelWindow.webContents.send("update-window-material", material);
  }
  /**
   * 向超级面板窗口广播消息（公共方法，供外部模块调用）
   */
  broadcastToSuperPanel(channel, data) {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
      this.superPanelWindow.webContents.send(channel, data);
    }
  }
  /**
   * 隐藏超级面板窗口
   */
  hideWindow() {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
      this.superPanelWindow.hide();
    }
  }
  /**
   * 请求主窗口执行搜索（携带剪贴板内容类型和数据）
   */
  requestSearch(content) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    const searchText = content.type === "text" ? content.text || "" : "";
    this.mainWindow.webContents.send("super-panel-search", {
      text: searchText,
      clipboardContent: content
    });
  }
  /**
   * 请求翻译选中的文本
   */
  async requestTranslation(text) {
    try {
      const translation = await translationManager.translate(text);
      if (translation) {
        this.sendToSuperPanel("super-panel-translation", {
          text: translation,
          sourceText: text
        });
      }
    } catch (error) {
      console.error("[SuperPanel] 翻译请求失败:", error);
    }
  }
  filterPinnedCommandsForDisplay(commands) {
    const disabledPluginPaths = pluginsAPI.getDisabledPluginSet();
    const visibleCommands = [];
    for (const command of commands) {
      if (command?.isFolder && Array.isArray(command.items)) {
        const visibleItems = command.items.filter(
          (item) => !(item?.type === "plugin" && disabledPluginPaths.has(item.path))
        );
        if (visibleItems.length === 1) {
          visibleCommands.push(visibleItems[0]);
        } else if (visibleItems.length > 1) {
          visibleCommands.push({
            ...command,
            items: visibleItems
          });
        }
        continue;
      }
      if (command?.type === "plugin" && disabledPluginPaths.has(command.path)) {
        continue;
      }
      visibleCommands.push(command);
    }
    return visibleCommands;
  }
  /**
   * 加载固定列表
   */
  loadPinnedCommands() {
    try {
      let pinnedCommands = databaseAPI.dbGet("super-panel-pinned");
      if (!pinnedCommands || !Array.isArray(pinnedCommands)) {
        pinnedCommands = [];
      }
      const visiblePinnedCommands = this.filterPinnedCommandsForDisplay(pinnedCommands);
      this.sendToSuperPanel("super-panel-data", {
        type: "pinned",
        commands: visiblePinnedCommands,
        windowInfo: this.currentWindowInfo
      });
    } catch (error) {
      console.error("[SuperPanel] 加载超级面板固定列表失败:", error);
      this.sendToSuperPanel("super-panel-data", {
        type: "pinned",
        commands: [],
        windowInfo: this.currentWindowInfo
      });
    }
  }
  /**
   * 发送数据到超级面板窗口（窗口未就绪时缓存消息）
   */
  sendToSuperPanel(channel, data) {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed() && this.windowReady) {
      this.superPanelWindow.webContents.send(channel, data);
    } else {
      this.pendingMessages.push({ channel, data });
    }
  }
  /**
   * 设置 IPC 监听
   */
  setupIPC() {
    electron.ipcMain.on(
      "super-panel-search-result",
      (_event, data) => {
        this.sendToSuperPanel("super-panel-data", {
          type: "search",
          results: data.results,
          clipboardContent: data.clipboardContent,
          windowInfo: this.currentWindowInfo
        });
      }
    );
    electron.ipcMain.handle("super-panel:launch", async (_event, command) => {
      try {
        this.hideWindow();
        if (command.type === "direct") {
          await launchApp(command.path);
          return { success: true };
        }
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          return { success: false, error: "主窗口不可用" };
        }
        if (this.currentWindowInfo) {
          windowManager.setPreviousActiveWindow(this.currentWindowInfo);
        }
        this.mainWindow.show();
        this.mainWindow.webContents.send("super-panel-launch", {
          command,
          clipboardContent: this.currentClipboardContent,
          windowInfo: command.windowInfo || this.currentWindowInfo
        });
        return { success: true };
      } catch (error) {
        console.error("[SuperPanel] 超级面板启动指令失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.on("super-panel:ready", () => {
      this.windowReady = true;
      for (const msg of this.pendingMessages) {
        if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
          this.superPanelWindow.webContents.send(msg.channel, msg.data);
        }
      }
      this.pendingMessages = [];
    });
    electron.ipcMain.on("super-panel:show-pinned", () => {
      this.loadPinnedCommands();
    });
    electron.ipcMain.on("super-panel:show-main-window", () => {
      this.hideWindow();
      if (this.currentWindowInfo) {
        windowManager.setPreviousActiveWindow(this.currentWindowInfo);
      }
      windowManager.showWindow();
    });
    electron.ipcMain.handle("super-panel:update-pinned-order", (_event, commands) => {
      try {
        databaseAPI.dbPut("super-panel-pinned", commands);
        this.mainWindow?.webContents.send("super-panel-pinned-changed");
        return { success: true };
      } catch (error) {
        console.error("[SuperPanel] 更新超级面板固定列表顺序失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("super-panel:unpin-command", (_event, path2, featureCode) => {
      try {
        console.log("[SuperPanel] 收到取消固定请求:", { path: path2, featureCode });
        let pinnedCommands = databaseAPI.dbGet("super-panel-pinned");
        if (!Array.isArray(pinnedCommands)) {
          pinnedCommands = [];
        }
        pinnedCommands = filterSuperPanelPinnedCommands(pinnedCommands, {
          path: path2,
          featureCode
        }).items;
        console.log("[SuperPanel] 更新后的固定列表:", pinnedCommands.length, "项");
        databaseAPI.dbPut("super-panel-pinned", pinnedCommands);
        this.loadPinnedCommands();
        console.log("[SuperPanel] 已重新加载固定列表");
        this.mainWindow?.webContents.send("super-panel-pinned-changed");
        return { success: true };
      } catch (error) {
        console.error("[SuperPanel] 取消固定失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("super-panel:pin-command", (_event, command) => {
      try {
        let pinnedCommands = databaseAPI.dbGet("super-panel-pinned");
        if (!Array.isArray(pinnedCommands)) {
          pinnedCommands = [];
        }
        const exists = pinnedCommands.some((cmd) => {
          if (command.featureCode) {
            return cmd.path === command.path && cmd.featureCode === command.featureCode;
          }
          return cmd.path === command.path && cmd.name === command.name;
        });
        if (!exists) {
          pinnedCommands.push({
            name: command.name,
            path: command.path || "",
            icon: command.icon || "",
            type: command.type,
            featureCode: command.featureCode || "",
            pluginName: command.pluginName || "",
            pluginExplain: command.pluginExplain || "",
            cmdType: command.cmdType || "text"
          });
          databaseAPI.dbPut("super-panel-pinned", pinnedCommands);
          this.loadPinnedCommands();
          this.mainWindow?.webContents.send("super-panel-pinned-changed");
        }
        return { success: true };
      } catch (error) {
        console.error("[SuperPanel] 固定到超级面板失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("super-panel:get-pinned", () => {
      try {
        const pinnedCommands = databaseAPI.dbGet("super-panel-pinned");
        if (!Array.isArray(pinnedCommands)) return [];
        const flattened = [];
        for (const cmd of pinnedCommands) {
          if (cmd.isFolder && Array.isArray(cmd.items)) {
            flattened.push(...cmd.items);
          } else {
            flattened.push(cmd);
          }
        }
        return flattened;
      } catch {
        return [];
      }
    });
    electron.ipcMain.handle("super-panel:add-blocked-app", async () => {
      try {
        if (!this.currentWindowInfo?.app) {
          return { success: false, error: "无法获取当前窗口信息" };
        }
        const appName = this.currentWindowInfo.app;
        const alreadyBlocked = this.config.blockedApps.some(
          (b) => b.app.toLowerCase() === appName.toLowerCase()
        );
        if (alreadyBlocked) {
          this.hideWindow();
          return { success: true, app: appName.replace(/\.(exe|app)$/i, "") };
        }
        const label = appName.replace(/\.(exe|app)$/i, "");
        const blockedApp = {
          app: appName,
          bundleId: this.currentWindowInfo.bundleId,
          label
        };
        this.config.blockedApps.push(blockedApp);
        const data = databaseAPI.dbGet("settings-general") || {};
        data.superPanelBlockedApps = this.config.blockedApps;
        databaseAPI.dbPut("settings-general", data);
        this.hideWindow();
        console.log("[SuperPanel] 已将应用添加到屏蔽列表:", label);
        return { success: true, app: label };
      } catch (error) {
        console.error("[SuperPanel] 添加屏蔽应用失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle(
      "super-panel:search-window-commands",
      (_event, windowInfo) => {
        if (this.currentWindowInfo) {
          windowManager.setPreviousActiveWindow(this.currentWindowInfo);
        }
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          this.sendToSuperPanel("super-panel-window-commands-data", { results: [] });
          return;
        }
        this.mainWindow.webContents.send("super-panel-search-window-commands", windowInfo);
      }
    );
    electron.ipcMain.on("super-panel-window-commands-result", (_event, data) => {
      this.sendToSuperPanel("super-panel-window-commands-data", data);
    });
  }
}
const superPanelManager = new SuperPanelManager();
const WINDOW_BLUR_DRAG_INPUT_CONSUMER = "window-blur-drag";
const DEFAULT_MODAL_DIALOG_BLUR_HIDE_RELEASE_DELAY_MS = 500;
class WindowManager2 {
  mainWindow = null;
  tray = null;
  trayMenu = null;
  // 托盘菜单
  currentShortcut = "Option+Z";
  // 当前注册的快捷键
  isDoubleTapMode = false;
  // 当前呼出快捷键是否为双击修饰键模式
  static MODIFIER_NAMES = ["Command", "Ctrl", "Alt", "Option", "Shift"];
  isQuitting = false;
  // 是否正在退出应用
  previousActiveWindow = null;
  // 打开应用前激活的窗口
  // private _shouldRestoreFocus = true // TODO: 是否在隐藏窗口时恢复焦点（待实现）
  windowPositionsByDisplay = {};
  autoBackToSearchTimer = null;
  // 自动返回搜索定时器
  autoBackToSearchConfig = "never";
  // 自动返回搜索配置
  lastFocusTarget = null;
  // 窗口隐藏前的焦点状态
  isRestoringFocus = false;
  // 是否正在恢复焦点状态（防止 focus 事件监听器干扰）
  suppressBlurHide = false;
  // 临时抑制 blur 事件隐藏窗口（文件关联打开等场景）
  // 原生模态对话框关闭前后可能发出排队的 blur/mouseup 事件。
  modalDialogBlurHideSuppressed = false;
  modalDialogBlurHideReleaseTimer = null;
  modalDialogBlurHideSuppressionDepth = 0;
  lastBlurHideTime = 0;
  // blur 导致隐藏窗口的时间戳（用于解决托盘点击竞态）
  blurHideTimer = null;
  // Linux blur 延迟隐藏定时器
  // Double-tap 唤醒窗口时，Windows 可能紧跟一个短暂 blur；这两个 timer 用于跳过误关闭并补一次焦点。
  doubleTapFocusTimer = null;
  doubleTapSuppressBlurTimer = null;
  // 全局左键状态用于区分“点击外部关闭”和“从外部拖文件进窗口”。拖拽时 blur 先挂起，等 mouseup 再判断。
  leftMouseDown = false;
  // 全局左键是否按下，用于拖拽时延迟 blur 隐藏
  pendingBlurHideOnMouseUp = false;
  // blur 时左键按下，等待 mouseup 再决定是否隐藏
  pendingBlurHideTimer = null;
  // mouseup 兜底定时器
  mouseStateTrackingStarted = false;
  appShortcuts = /* @__PURE__ */ new Map();
  // 应用快捷键映射表 (快捷键 -> 目标指令)
  wakeupBlacklist = [];
  // 唤醒黑名单
  onThemeInfoChanged = null;
  // 主题信息变更回调钩子
  // 应用快捷键触发时携带的当前输入上下文
  appShortcutLaunchContext = {
    searchQuery: "",
    pastedImage: null,
    pastedFiles: null,
    pastedText: null
  };
  /**
   * 更新焦点目标（供外部调用,如 pluginManager）
   */
  updateFocusTarget(target) {
    this.lastFocusTarget = target;
    console.log("[Window] 焦点目标已更新:", target);
  }
  /**
   * 通知渲染进程返回搜索页面
   */
  notifyBackToSearch() {
    this.mainWindow?.webContents.send("back-to-search");
  }
  isLeftMouseButton(button) {
    return Number(button) === 1;
  }
  isPointInsideMainWindow(point) {
    if (!this.mainWindow) return false;
    const bounds = this.mainWindow.getBounds();
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
  }
  clearPendingBlurHideTimer() {
    if (this.pendingBlurHideTimer) {
      clearTimeout(this.pendingBlurHideTimer);
      this.pendingBlurHideTimer = null;
    }
  }
  isBlurHideSuppressed() {
    return this.suppressBlurHide || this.modalDialogBlurHideSuppressed;
  }
  beginModalDialogBlurHideSuppression() {
    if (this.modalDialogBlurHideReleaseTimer) {
      clearTimeout(this.modalDialogBlurHideReleaseTimer);
      this.modalDialogBlurHideReleaseTimer = null;
    }
    this.modalDialogBlurHideSuppressionDepth += 1;
    this.modalDialogBlurHideSuppressed = true;
  }
  endModalDialogBlurHideSuppression(releaseDelayMs) {
    this.modalDialogBlurHideSuppressionDepth = Math.max(
      0,
      this.modalDialogBlurHideSuppressionDepth - 1
    );
    if (this.modalDialogBlurHideSuppressionDepth > 0) return;
    if (this.modalDialogBlurHideReleaseTimer) {
      clearTimeout(this.modalDialogBlurHideReleaseTimer);
    }
    this.modalDialogBlurHideReleaseTimer = setTimeout(() => {
      this.modalDialogBlurHideSuppressed = false;
      this.modalDialogBlurHideReleaseTimer = null;
    }, releaseDelayMs);
  }
  isPromiseLike(value) {
    return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
  }
  deferBlurHideUntilMouseUp() {
    this.pendingBlurHideOnMouseUp = true;
    this.clearPendingBlurHideTimer();
    this.pendingBlurHideTimer = setTimeout(() => {
      this.pendingBlurHideTimer = null;
      if (!this.pendingBlurHideOnMouseUp) return;
      this.pendingBlurHideOnMouseUp = false;
      if (this.isBlurHideSuppressed()) return;
      if (this.mainWindow?.isFocused()) return;
      if (pluginManager.isPluginViewFocused()) return;
      this.lastBlurHideTime = Date.now();
      this.hideWindow(false);
    }, 15e3);
  }
  resolveDeferredBlurHideOnMouseUp() {
    this.pendingBlurHideOnMouseUp = false;
    this.clearPendingBlurHideTimer();
    this.resolveMouseUpVisibility();
  }
  resolveMouseUpVisibility() {
    if (!this.mainWindow?.isVisible()) return;
    if (this.isBlurHideSuppressed()) return;
    const cursorPoint = electron.screen.getCursorScreenPoint();
    if (this.isPointInsideMainWindow(cursorPoint)) {
      if (!this.mainWindow.isFocused() && !pluginManager.isPluginViewFocused()) {
        this.mainWindow.focus();
      }
      return;
    }
    this.lastBlurHideTime = Date.now();
    this.hideWindow(false);
  }
  startMouseStateTracking() {
    if (this.mouseStateTrackingStarted) return;
    this.mouseStateTrackingStarted = true;
    globalInputManager.on(WINDOW_BLUR_DRAG_INPUT_CONSUMER, "mousedown", (event) => {
      if (this.isLeftMouseButton(event.button)) {
        this.leftMouseDown = true;
      }
    });
    globalInputManager.on(WINDOW_BLUR_DRAG_INPUT_CONSUMER, "mouseup", (event) => {
      if (!this.isLeftMouseButton(event.button)) return;
      this.leftMouseDown = false;
      if (this.pendingBlurHideOnMouseUp) {
        this.resolveDeferredBlurHideOnMouseUp();
      }
    });
    globalInputManager.acquire(WINDOW_BLUR_DRAG_INPUT_CONSUMER);
  }
  /**
   * 获取鼠标所在显示器的工作区尺寸和位置
   */
  getDisplayAtCursor() {
    const cursorPoint = electron.screen.getCursorScreenPoint();
    const display = electron.screen.getDisplayNearestPoint(cursorPoint);
    return {
      ...display.workArea,
      id: display.id
    };
  }
  /**
   * 获取当前显示器 ID（基于窗口位置）
   */
  getCurrentDisplayId() {
    if (!this.mainWindow) return null;
    const [x, y] = this.mainWindow.getPosition();
    const display = electron.screen.getDisplayNearestPoint({ x, y });
    return display.id;
  }
  /**
   * 创建主窗口
   */
  createWindow() {
    const { width, height, x: displayX, y: displayY } = this.getDisplayAtCursor();
    const windowConfig = {
      type: "panel",
      title: "ZTools",
      width: WINDOW_WIDTH,
      height: WINDOW_INITIAL_HEIGHT,
      alwaysOnTop: true,
      // 基于最大窗口高度计算居中位置，确保窗口扩展时不会超出屏幕
      x: displayX + Math.floor((width - WINDOW_WIDTH) / 2),
      y: displayY + Math.floor((height - WINDOW_DEFAULT_HEIGHT) / 2),
      frame: false,
      // 无边框
      resizable: false,
      // 禁止用户手动调整窗口大小
      maximizable: false,
      // 禁用最大化
      skipTaskbar: true,
      show: false,
      hasShadow: true,
      // 启用窗口阴影（可调整为 false 来移除阴影）
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        backgroundThrottling: false,
        // 窗口最小化时是否继续动画和定时器
        contextIsolation: true,
        // 禁用上下文隔离, 渲染进程和preload共用window对象
        nodeIntegration: false,
        // 渲染进程禁止直接使用 Node
        spellcheck: false,
        // 禁用拼写检查
        webSecurity: false
      }
    };
    if (utils.platform.isMacOS) {
      windowConfig.transparent = true;
      windowConfig.vibrancy = "fullscreen-ui";
    } else if (utils.platform.isWindows) {
      windowConfig.backgroundColor = "#00000000";
    } else if (utils.platform.isLinux) {
      delete windowConfig.type;
    }
    this.mainWindow = new electron.BrowserWindow(windowConfig);
    this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (utils.platform.isMacOS) {
      this.mainWindow.setAlwaysOnTop(true, "modal-panel", 1);
    } else {
      this.mainWindow.setAlwaysOnTop(true);
    }
    if (utils.platform.isWindows) {
      this.applyWindowMaterialFromSettings();
    }
    this.mainWindow.webContents.setZoomFactor(1);
    this.mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    this.mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.control || input.meta) {
        if (input.key === "=" || input.key === "+" || input.key === "-" || input.key === "_" || input.key === "0") {
          event.preventDefault();
          return;
        }
      }
      if (input.type === "keyDown") {
        if ((input.key === "w" || input.key === "W") && (input.meta || input.control) && !input.shift && !input.alt) {
          const settings = databaseAPI.dbGet("settings-general") || {};
          const closeShortcutEnabled = settings?.builtinAppShortcutsEnabled?.closePlugin !== false;
          if (!closeShortcutEnabled) {
            return;
          }
        }
        if (pluginManager.getCurrentPluginPath() !== null) {
          return;
        }
        const shortcut = this.buildShortcutString(input);
        const target = this.appShortcuts.get(shortcut);
        if (target) {
          console.log(`应用快捷键触发: ${shortcut} -> ${target}`);
          event.preventDefault();
          this.handleAppShortcut(target);
        }
      }
    });
    if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      this.mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
      console.log("[Window] 生产模式下加载文件:", path.join(__dirname, "../renderer/index.html"));
      this.mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }
    this.mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      console.error("[Window] 页面加载失败:", errorCode, errorDescription);
    });
    this.mainWindow.webContents.on("did-finish-load", () => {
      console.log("[Window] 页面加载成功!");
    });
    this.mainWindow.webContents.on(
      "did-start-navigation",
      (_event, url2, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace) return;
        const currentUrl = this.mainWindow?.webContents.getURL();
        if (currentUrl && url2 === currentUrl && pluginManager.getCurrentPluginPath() !== null) {
          pluginManager.detachPluginViewOnRefresh();
        }
      }
    );
    this.mainWindow.webContents.on("focus", () => {
      if (!this.isRestoringFocus) {
        this.updateFocusTarget("mainWindow");
      }
    });
    this.mainWindow.on("blur", () => {
      if (this.isBlurHideSuppressed()) return;
      if (this.leftMouseDown) {
        this.deferBlurHideUntilMouseUp();
        return;
      }
      if (utils.platform.isLinux) {
        if (this.blurHideTimer) {
          clearTimeout(this.blurHideTimer);
          this.blurHideTimer = null;
        }
        this.blurHideTimer = setTimeout(() => {
          this.blurHideTimer = null;
          if (this.isBlurHideSuppressed()) return;
          if (this.mainWindow?.isFocused()) return;
          if (pluginManager.isPluginViewFocused()) return;
          this.lastBlurHideTime = Date.now();
          this.hideWindow(false);
        }, 150);
      } else {
        this.lastBlurHideTime = Date.now();
        this.hideWindow(false);
      }
    });
    this.startMouseStateTracking();
    this.mainWindow.on("show", () => {
      this.isRestoringFocus = true;
      const savedFocusTarget = this.lastFocusTarget;
      if (savedFocusTarget === "mainWindow" || savedFocusTarget === null) {
        this.mainWindow?.webContents.focus();
        this.mainWindow?.webContents.send("focus-search", this.previousActiveWindow || null);
      } else if (pluginManager.getCurrentPluginPath() !== null) {
        pluginManager.focusPluginView();
        setImmediate(() => pluginManager.forceRepaintCurrentView());
      }
      this.isRestoringFocus = false;
    });
    this.mainWindow.on("close", (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        if (pluginManager.getCurrentPluginPath() !== null) {
          pluginManager.handlePluginEsc();
          return;
        }
        if (pluginManager.shouldSuppressMainHide()) {
          console.log("[Window] 检测到短时间内插件 ESC，跳过 mainWindow.hide");
          return;
        }
        this.mainWindow?.hide();
      }
    });
    const initSettings = databaseAPI.dbGet("settings-general");
    if (initSettings?.wakeupBlacklist) {
      this.wakeupBlacklist = initSettings.wakeupBlacklist;
    }
    return this.mainWindow;
  }
  /**
   * 创建系统托盘
   */
  createTray() {
    let icon;
    if (utils.platform.isMacOS) {
      icon = electron.nativeImage.createFromPath(trayIcon);
      icon.setTemplateImage(true);
    } else {
      icon = electron.nativeImage.createFromPath(windowsIcon);
      icon.setTemplateImage(false);
    }
    this.tray = new electron.Tray(icon);
    this.tray.setToolTip("ZTools");
    this.createTrayMenu();
    if (utils.platform.isLinux && this.trayMenu) {
      this.tray.setContextMenu(this.trayMenu);
    } else {
      this.tray.on("click", () => {
        this.toggleWindow();
      });
      this.tray.on("right-click", () => {
        if (this.tray && this.trayMenu) {
          this.tray.popUpContextMenu(this.trayMenu);
        }
      });
    }
  }
  /**
   * 创建托盘菜单
   */
  createTrayMenu() {
    if (!this.tray) return;
    this.trayMenu = electron.Menu.buildFromTemplate([
      {
        label: "显示/隐藏",
        click: () => {
          this.toggleWindow();
        }
      },
      {
        type: "separator"
      },
      {
        label: "设置",
        click: () => {
          this.showSettings();
        }
      },
      {
        type: "separator"
      },
      {
        label: "重启",
        click: () => {
          this.isQuitting = true;
          electron.app.relaunch();
          electron.app.quit();
        }
      },
      {
        label: "退出",
        click: () => {
          this.isQuitting = true;
          electron.app.quit();
        }
      }
    ]);
  }
  /**
   * 获取主窗口实例
   */
  getMainWindow() {
    return this.mainWindow;
  }
  /**
   * 判断是否为双击修饰键快捷键（如 "Ctrl+Ctrl"）
   */
  isDoubleTapShortcut(shortcut) {
    const parts = shortcut.split("+");
    return parts.length === 2 && parts[0] === parts[1] && WindowManager2.MODIFIER_NAMES.includes(parts[0]);
  }
  /**
   * 注册全局快捷键（支持双击修饰键）
   */
  registerShortcut(shortcut) {
    const keyToRegister = shortcut || this.currentShortcut;
    const oldShortcut = this.currentShortcut;
    const oldIsDoubleTapMode = this.isDoubleTapMode;
    if (this.isDoubleTapMode) {
      const oldModifier = this.currentShortcut.split("+")[0];
      doubleTapManager.unregister(oldModifier);
    } else {
      electron.globalShortcut.unregister(this.currentShortcut);
    }
    if (this.isDoubleTapShortcut(keyToRegister)) {
      const modifier = keyToRegister.split("+")[0];
      doubleTapManager.register(modifier, () => {
        this.toggleWindowFromDoubleTap();
      });
      this.currentShortcut = keyToRegister;
      this.isDoubleTapMode = true;
      console.log(`双击修饰键呼出快捷键 ${keyToRegister} 注册成功`);
      return true;
    }
    const ret = electron.globalShortcut.register(keyToRegister, () => {
      this.toggleWindow();
    });
    if (!ret) {
      console.error(`快捷键注册失败: ${keyToRegister} 已被占用，回滚到旧快捷键: ${oldShortcut}`);
      if (oldIsDoubleTapMode) {
        const oldModifier = oldShortcut.split("+")[0];
        doubleTapManager.register(oldModifier, () => {
          this.toggleWindowFromDoubleTap();
        });
      } else {
        electron.globalShortcut.register(oldShortcut, () => {
          this.toggleWindow();
        });
      }
      return false;
    } else {
      this.currentShortcut = keyToRegister;
      this.isDoubleTapMode = false;
      console.log(`快捷键 ${keyToRegister} 注册成功`);
    }
    return ret;
  }
  setPreviousActiveWindow(windowInfo) {
    this.previousActiveWindow = windowInfo;
  }
  /**
   * 记录当前的焦点状态（在隐藏之前调用）
   * 注意：焦点状态现在通过事件监听实时跟踪,此方法仅用于确保状态正确
   */
  recordFocusState() {
    if (pluginManager.getCurrentPluginPath() === null) {
      this.updateFocusTarget("mainWindow");
    }
  }
  /**
   * 切换窗口显示/隐藏
   */
  toggleWindow() {
    if (!this.mainWindow) return;
    const isFocused = this.mainWindow.isFocused();
    const isVisible = this.mainWindow.isVisible();
    if (isFocused && isVisible) {
      this.recordFocusState();
      this.mainWindow.blur();
      this.mainWindow.hide();
      this.restorePreviousWindow();
    } else {
      const timeSinceBlurHide = Date.now() - this.lastBlurHideTime;
      if (timeSinceBlurHide < 300) {
        return;
      }
      this.showWindow();
    }
  }
  toggleWindowFromDoubleTap() {
    if (!this.mainWindow) return;
    const willShow = !(this.mainWindow.isFocused() && this.mainWindow.isVisible());
    if (willShow) {
      this.suppressBlurHide = true;
      if (this.doubleTapSuppressBlurTimer) clearTimeout(this.doubleTapSuppressBlurTimer);
      this.doubleTapSuppressBlurTimer = setTimeout(() => {
        this.suppressBlurHide = false;
        this.doubleTapSuppressBlurTimer = null;
      }, 350);
    }
    this.toggleWindow();
    if (willShow && utils.platform.isWindows) {
      if (this.doubleTapFocusTimer) clearTimeout(this.doubleTapFocusTimer);
      this.doubleTapFocusTimer = setTimeout(() => {
        this.refocusSearchAfterDoubleTap();
        this.doubleTapFocusTimer = null;
      }, 80);
    }
  }
  /**
   * 强制激活窗口（解决alert等弹窗后无法唤起的问题）
   */
  forceActivateWindow() {
    if (!this.mainWindow) return;
    this.mainWindow.show();
    if (utils.platform.isMacOS) {
      this.mainWindow.setAlwaysOnTop(true, "modal-panel", 1);
      return;
    }
    this.mainWindow.setAlwaysOnTop(true);
    this.mainWindow.focus();
  }
  refocusSearchAfterDoubleTap() {
    if (!utils.platform.isWindows) return;
    if (!this.mainWindow?.isVisible()) return;
    electron.app.focus({ steal: true });
    this.mainWindow.show();
    this.mainWindow.moveTop();
    WindowManager$1.activateWindow(process.pid);
    this.mainWindow.focus();
    this.mainWindow.webContents.focus();
    this.mainWindow.webContents.send("focus-search", this.previousActiveWindow || null);
  }
  /**
   * 保存窗口位置到指定显示器（仅内存）
   */
  saveWindowPosition(displayId, x, y) {
    this.windowPositionsByDisplay[displayId] = { x, y };
  }
  /**
   * 将窗口移动到鼠标所在显示器
   * 优先恢复该显示器记忆的位置，否则居中显示
   */
  moveWindowToCursor() {
    if (!this.mainWindow) return;
    const { width, height, x: displayX, y: displayY, id: displayId } = this.getDisplayAtCursor();
    const savedPosition = this.windowPositionsByDisplay[displayId];
    let x, y;
    if (savedPosition) {
      x = savedPosition.x;
      y = savedPosition.y;
    } else {
      x = displayX + Math.floor((width - WINDOW_WIDTH) / 2);
      y = displayY + Math.floor((height - WINDOW_DEFAULT_HEIGHT) / 2);
    }
    this.mainWindow.setPosition(x, y, false);
  }
  /**
   * 显示窗口
   */
  showWindow() {
    if (!this.mainWindow) return;
    this.isRestoringFocus = true;
    this.cancelAutoBackToSearchTimer();
    const currentWindow = clipboardManager.getCurrentWindow();
    if (currentWindow) {
      this.previousActiveWindow = currentWindow;
      if (this.isAppInWakeupBlacklist(currentWindow)) {
        this.isRestoringFocus = false;
        return;
      }
    }
    this.moveWindowToCursor();
    pluginManager.restoreCurrentPluginViewHeightOnWindowShow();
    this.forceActivateWindow();
  }
  /**
   * 隐藏窗口
   */
  hideWindow(_restoreFocus = true) {
    console.log("[Window] 隐藏窗口", _restoreFocus);
    this.recordFocusState();
    this.mainWindow?.hide();
    if (_restoreFocus) {
      this.restorePreviousWindow();
    }
    this.startAutoBackToSearchTimer();
  }
  withBlurHideSuppressed(callback, releaseDelayMs = DEFAULT_MODAL_DIALOG_BLUR_HIDE_RELEASE_DELAY_MS) {
    this.beginModalDialogBlurHideSuppression();
    try {
      const result = callback();
      if (this.isPromiseLike(result)) {
        return Promise.resolve(result).finally(() => {
          this.endModalDialogBlurHideSuppression(releaseDelayMs);
        });
      }
      this.endModalDialogBlurHideSuppression(releaseDelayMs);
      return result;
    } catch (error) {
      this.endModalDialogBlurHideSuppression(releaseDelayMs);
      throw error;
    }
  }
  withBlurHideSuppressedSync(callback, releaseDelayMs = DEFAULT_MODAL_DIALOG_BLUR_HIDE_RELEASE_DELAY_MS) {
    this.beginModalDialogBlurHideSuppression();
    try {
      const result = callback();
      if (this.isPromiseLike(result)) {
        throw new TypeError("withBlurHideSuppressedSync callback must not return a Promise");
      }
      this.endModalDialogBlurHideSuppression(releaseDelayMs);
      return result;
    } catch (error) {
      this.endModalDialogBlurHideSuppression(releaseDelayMs);
      throw error;
    }
  }
  /**
   * 启动自动返回搜索定时器
   */
  startAutoBackToSearchTimer() {
    if (this.autoBackToSearchTimer) {
      clearTimeout(this.autoBackToSearchTimer);
      this.autoBackToSearchTimer = null;
    }
    if (this.autoBackToSearchConfig === "never") {
      return;
    }
    const delay = this.getAutoBackToSearchDelay();
    if (delay === 0) {
      this.backToSearch();
      return;
    }
    this.autoBackToSearchTimer = setTimeout(() => {
      this.backToSearch();
      this.autoBackToSearchTimer = null;
    }, delay);
    console.log(`自动返回搜索定时器已启动，延时: ${delay}ms`);
  }
  /**
   * 取消自动返回搜索定时器
   */
  cancelAutoBackToSearchTimer() {
    if (this.autoBackToSearchTimer) {
      clearTimeout(this.autoBackToSearchTimer);
      this.autoBackToSearchTimer = null;
      console.log("[Window] 自动返回搜索定时器已取消");
    }
  }
  /**
   * 返回搜索界面
   */
  backToSearch() {
    if (!this.mainWindow) return;
    pluginManager.hidePluginView();
    this.notifyBackToSearch();
    console.log("[Window] 已触发自动返回搜索");
  }
  /**
   * 获取自动返回搜索的延时时间（毫秒）
   */
  getAutoBackToSearchDelay() {
    switch (this.autoBackToSearchConfig) {
      case "immediately":
        return 0;
      case "30s":
        return 30 * 1e3;
      case "1m":
        return 60 * 1e3;
      case "3m":
        return 3 * 60 * 1e3;
      case "5m":
        return 5 * 60 * 1e3;
      case "10m":
        return 10 * 60 * 1e3;
      case "never":
      default:
        return -1;
    }
  }
  /**
   * 更新自动返回搜索配置
   */
  async updateAutoBackToSearch(config) {
    this.autoBackToSearchConfig = config;
    console.log("[Window] 更新自动返回搜索配置:", config);
  }
  /**
   * 获取打开窗口前激活的窗口
   */
  getPreviousActiveWindow() {
    return this.previousActiveWindow;
  }
  /**
   * 更新唤醒黑名单（由设置或系统指令调用）
   */
  updateWakeupBlacklist(blacklist) {
    this.wakeupBlacklist = blacklist;
  }
  /**
   * 检查指定窗口是否在唤醒黑名单中
   */
  isAppInWakeupBlacklist(windowInfo) {
    if (this.wakeupBlacklist.length === 0) return false;
    if (process.platform === "darwin" && windowInfo.bundleId) {
      return this.wakeupBlacklist.some((item) => item.bundleId === windowInfo.bundleId);
    }
    return this.wakeupBlacklist.some(
      (item) => item.app.toLowerCase() === windowInfo.app.toLowerCase()
    );
  }
  /**
   * 恢复之前激活的窗口
   */
  async restorePreviousWindow() {
    if (!this.previousActiveWindow) {
      console.log("[Window] 没有记录的前一个激活窗口");
      return false;
    }
    const ignoredApps = ["uTools", "Alfred", "Raycast", "Wox", "Listary"];
    if (ignoredApps.includes(this.previousActiveWindow.app)) {
      console.log(`跳过恢复同类工具: ${this.previousActiveWindow.app}`);
      return false;
    }
    try {
      const success = clipboardManager.activateApp(this.previousActiveWindow);
      if (success) {
        console.log(`已恢复激活窗口: ${this.previousActiveWindow.app}`);
        return true;
      } else {
        console.log(`无法恢复窗口: ${this.previousActiveWindow.app}`);
        return false;
      }
    } catch (error) {
      console.log("[Window] 恢复激活窗口时出现异常:", error);
      return false;
    }
  }
  /**
   * 获取当前快捷键
   */
  getCurrentShortcut() {
    return this.currentShortcut;
  }
  /**
   * 注销所有快捷键
   */
  unregisterAllShortcuts() {
    electron.globalShortcut.unregisterAll();
    doubleTapManager.unregisterAll();
    globalInputManager.release(WINDOW_BLUR_DRAG_INPUT_CONSUMER);
    this.mouseStateTrackingStarted = false;
    this.isDoubleTapMode = false;
  }
  /**
   * 设置退出标志（允许窗口真正关闭）
   */
  setQuitting(value) {
    this.isQuitting = value;
  }
  /**
   * 获取退出标志
   */
  getQuitting() {
    return this.isQuitting;
  }
  /**
   * 设置托盘图标可见性
   */
  setTrayIconVisible(visible) {
    if (visible) {
      if (!this.tray) {
        this.createTray();
      }
    } else {
      if (this.tray) {
        this.tray.destroy();
        this.tray = null;
        this.trayMenu = null;
      }
    }
  }
  /**
   * 广播窗口材质到所有渲染进程（包括分离窗口和插件）
   */
  broadcastWindowMaterial(material) {
    this.mainWindow?.webContents.send("update-window-material", material);
    detachedWindowManager.updateAllWindowsMaterial(material);
    superPanelManager.updateWindowMaterial(material);
    this.notifyThemeInfoChanged();
  }
  /**
   * 广播主题色到所有渲染进程
   */
  broadcastPrimaryColor(primaryColor, customColor) {
    const data = { primaryColor, customColor };
    this.mainWindow?.webContents.send("update-primary-color", data);
    detachedWindowManager.broadcastToAllWindows("update-primary-color", data);
    this.notifyThemeInfoChanged();
  }
  /**
   * 广播亚克力透明度到所有渲染进程
   */
  broadcastAcrylicOpacity(lightOpacity, darkOpacity) {
    const data = { lightOpacity, darkOpacity };
    this.mainWindow?.webContents.send("update-acrylic-opacity", data);
    detachedWindowManager.broadcastToAllWindows("update-acrylic-opacity", data);
  }
  /**
   * 应用窗口材质
   */
  applyMaterial(material) {
    if (!this.mainWindow) return;
    applyWindowMaterial(this.mainWindow, material);
  }
  /**
   * 从设置中应用窗口材质（启动时调用）
   */
  applyWindowMaterialFromSettings() {
    try {
      const settings = databaseAPI.dbGet("settings-general");
      const savedMaterial = settings?.windowMaterial;
      const material = savedMaterial || getDefaultWindowMaterial();
      console.log("[Window] 从配置读取窗口材质:", material);
      if (!savedMaterial) {
        console.log("[Window] 数据库中没有窗口材质配置，保存默认值:", material);
        const updatedSettings = {
          ...settings || {},
          windowMaterial: material
        };
        databaseAPI.dbPut("settings-general", updatedSettings);
      }
      this.applyMaterial(material);
    } catch (error) {
      console.error("[Window] 读取窗口材质配置失败，使用默认值:", error);
      const defaultMaterial = getDefaultWindowMaterial();
      this.applyMaterial(defaultMaterial);
    }
  }
  /**
   * 设置窗口材质（用户在设置中更改时调用）
   */
  setWindowMaterial(material) {
    if (!this.mainWindow || !utils.platform.isWindows) {
      return { success: false };
    }
    this.applyMaterial(material);
    this.broadcastWindowMaterial(material);
    return { success: true };
  }
  /**
   * 获取当前窗口材质
   */
  getWindowMaterial() {
    try {
      const settings = databaseAPI.dbGet("settings-general");
      return settings?.windowMaterial || getDefaultWindowMaterial();
    } catch (error) {
      console.error("[Window] 获取窗口材质失败:", error);
      return getDefaultWindowMaterial();
    }
  }
  /**
   * 设置主题信息变更回调钩子
   */
  setOnThemeInfoChanged(callback) {
    this.onThemeInfoChanged = callback;
  }
  /**
   * 通知插件主题信息变更（供外部调用）
   */
  notifyThemeInfoChanged() {
    this.onThemeInfoChanged?.();
  }
  /**
   * 显示设置页面
   */
  async showSettings() {
    if (!this.mainWindow) return;
    if (pluginManager.getCurrentPluginPath() !== null) {
      console.log("[Window] 检测到插件正在显示，先隐藏插件");
      pluginManager.hidePluginView();
      this.notifyBackToSearch();
    }
    const currentWindow = clipboardManager.getCurrentWindow();
    if (currentWindow) {
      this.previousActiveWindow = currentWindow;
      console.log("[Window] 记录打开前的激活窗口:", currentWindow.app);
      this.mainWindow.webContents.send("window-info-changed", currentWindow);
    }
    try {
      const settingPlugin = this.findSettingPlugin();
      if (!settingPlugin) return;
      console.log("[Window] 找到设置插件:", settingPlugin.path);
      const result = await api.launchPlugin({
        path: settingPlugin.path,
        type: "plugin",
        featureCode: "main",
        name: "设置"
      });
      if (!result.success) {
        console.error("[Window] 启动设置插件失败:", result.error);
        return;
      }
      this.moveWindowToCursor();
      this.forceActivateWindow();
    } catch (error) {
      console.error("[Window] 打开设置插件失败:", error);
    }
  }
  /**
   * 从数据库查找 setting 插件
   */
  findSettingPlugin() {
    const plugins = api.dbGet("plugins");
    if (!plugins || !Array.isArray(plugins)) {
      console.error("[Window] 未找到插件列表");
      return null;
    }
    const settingPlugin = plugins.find((p) => p.name === "setting");
    if (!settingPlugin) {
      console.error("[Window] 未找到设置插件");
      return null;
    }
    return settingPlugin;
  }
  /**
   * 打开插件安装页面（用于 .zpx 文件关联双击打开）
   * 流程：激活应用 → 启动设置插件 → 导航到 PluginInstaller 页面 → 传入文件路径
   * @param zpxPath .zpx 文件路径
   */
  async openPluginInstaller(zpxPath) {
    if (!this.mainWindow) return;
    console.log("[Window] 打开插件安装页面:", zpxPath);
    this.suppressBlurHide = true;
    if (utils.platform.isMacOS) {
      await electron.app.dock?.show();
      electron.app.focus({ steal: true });
    }
    if (pluginManager.getCurrentPluginPath() !== null) {
      pluginManager.hidePluginView();
      this.notifyBackToSearch();
    }
    try {
      const settingPlugin = this.findSettingPlugin();
      if (!settingPlugin) {
        this.suppressBlurHide = false;
        return;
      }
      const result = await api.launchPlugin({
        path: settingPlugin.path,
        type: "plugin",
        featureCode: "function.install-plugin?router=PluginInstaller",
        name: "安装插件",
        cmdType: "files",
        param: {
          code: "function.install-plugin?router=PluginInstaller",
          payload: [{ path: zpxPath }]
        }
      });
      if (!result.success) {
        console.error("[Window] 启动插件安装页面失败:", result.error);
        this.suppressBlurHide = false;
        return;
      }
      this.moveWindowToCursor();
      this.mainWindow.show();
      if (utils.platform.isMacOS) {
        this.mainWindow.focus();
      } else {
        this.forceActivateWindow();
      }
      setTimeout(() => {
        this.suppressBlurHide = false;
      }, 500);
    } catch (error) {
      console.error("[Window] 打开插件安装页面失败:", error);
      this.suppressBlurHide = false;
    }
  }
  /**
   * 从 input 事件构建快捷键字符串
   */
  buildShortcutString(input) {
    const keys = [];
    if (input.meta) {
      keys.push(utils.platform.isMacOS ? "Command" : "Meta");
    }
    if (input.control) {
      keys.push(utils.platform.isMacOS ? "Ctrl" : "Ctrl");
    }
    if (input.alt) {
      keys.push(utils.platform.isMacOS ? "Option" : "Alt");
    }
    if (input.shift) {
      keys.push("Shift");
    }
    const mainKey = this.normalizeKey(input.key);
    if (mainKey && !WindowManager2.MODIFIER_NAMES.includes(mainKey)) {
      keys.push(mainKey);
    }
    return keys.join("+");
  }
  /**
   * 标准化按键名称
   */
  normalizeKey(key) {
    if (key.length === 1 && /[a-z]/.test(key)) {
      return key.toUpperCase();
    }
    if (key.length === 1 && /[0-9]/.test(key)) {
      return key;
    }
    const keyMap = {
      " ": "Space",
      Enter: "Enter",
      Escape: "Escape",
      Tab: "Tab",
      Backspace: "Backspace",
      Delete: "Delete",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown"
    };
    return keyMap[key] || key;
  }
  /**
   * 处理应用快捷键触发
   */
  async handleAppShortcut(target) {
    try {
      await api.handleGlobalShortcutTrigger(target, this.appShortcutLaunchContext);
    } catch (error) {
      console.error("[Window] 处理应用快捷键失败:", error);
    }
  }
  /**
   * 更新应用快捷键触发时要带给启动链路的输入上下文
   */
  updateAppShortcutLaunchContext(context) {
    this.appShortcutLaunchContext = {
      searchQuery: context.searchQuery ?? "",
      pastedImage: context.pastedImage ?? null,
      pastedFiles: context.pastedFiles ?? null,
      pastedText: context.pastedText ?? null
    };
  }
  /**
   * 检查 Cmd+Q 内置快捷键（killPlugin）是否被用户禁用
   * 用于 before-quit 事件：禁用时不隐藏窗口，让 Cmd+Q 可被用作呼出快捷键
   */
  isKillPluginShortcutEnabled() {
    try {
      const settings = databaseAPI.dbGet("settings-general") || {};
      return settings?.builtinAppShortcutsEnabled?.killPlugin !== false;
    } catch {
      return true;
    }
  }
  /**
   * 注册应用快捷键
   */
  registerAppShortcut(shortcut, target) {
    try {
      this.appShortcuts.set(shortcut, target);
      console.log(`成功注册应用快捷键: ${shortcut} -> ${target}`);
      return true;
    } catch (error) {
      console.error("[Window] 注册应用快捷键失败:", error);
      return false;
    }
  }
  /**
   * 注销应用快捷键
   */
  unregisterAppShortcut(shortcut) {
    this.appShortcuts.delete(shortcut);
    console.log(`成功注销应用快捷键: ${shortcut}`);
  }
  /**
   * 清空所有应用快捷键
   */
  unregisterAllAppShortcuts() {
    this.appShortcuts.clear();
    console.log("[Window] 已清空所有应用快捷键");
  }
}
const windowManager = new WindowManager2();
console.log("[Plugin] mainPreload", mainPreload);
const PLUGIN_OUT_GRACE_MS = 200;
function registerExternalLinkInterceptor(webContents) {
  const isHttpUrl = (url2) => url2.startsWith("http://") || url2.startsWith("https://");
  const isSameHttpOrigin = (currentUrl, targetUrl) => {
    if (!isHttpUrl(currentUrl) || !isHttpUrl(targetUrl)) return false;
    try {
      return new URL(currentUrl).origin === new URL(targetUrl).origin;
    } catch {
      return false;
    }
  };
  webContents.on("will-navigate", (event, url2) => {
    const currentUrl = webContents.getURL();
    if (isHttpUrl(url2) && !isSameHttpOrigin(currentUrl, url2)) {
      event.preventDefault();
      console.log("[Plugin] 拦截跨源页面跳转，使用默认浏览器打开:", {
        from: currentUrl,
        to: url2
      });
      electron.shell.openExternal(url2);
    }
  });
  webContents.setWindowOpenHandler(({ url: url2 }) => {
    if (isHttpUrl(url2)) {
      console.log("[Plugin] 拦截新窗口打开，使用默认浏览器打开:", url2);
      electron.shell.openExternal(url2);
    }
    return { action: "deny" };
  });
}
class PluginManager {
  // ==================== 插件配置/视图创建辅助方法 ====================
  /**
   * 从数据库查询插件信息
   */
  fetchPluginInfoFromDB(pluginPath) {
    try {
      const plugins = api.dbGet("plugins");
      if (plugins && Array.isArray(plugins)) {
        return plugins.find((p) => p.path === pluginPath) || null;
      }
    } catch (error) {
      console.error("[Plugin] 查询插件信息失败:", error);
    }
    return null;
  }
  /**
   * 读取 plugin.json 配置
   */
  readPluginConfig(pluginPath) {
    const pluginJsonPath = path.join(pluginPath, "plugin.json");
    return JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
  }
  /**
   * 判断指定 feature 是否设置了 mainHide
   * 同时检查 plugin.json 静态配置和数据库中的动态指令
   */
  isFeatureMainHide(pluginPath, featureCode) {
    try {
      const pluginConfig = this.readPluginConfig(pluginPath);
      const staticFeature = pluginConfig.features?.find((f) => f.code === featureCode);
      if (staticFeature?.mainHide === true) return true;
      const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath);
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name;
      if (effectiveName) {
        const doc = lmdbInstance.get(`${getPluginDataPrefix(effectiveName)}dynamic-features`);
        if (doc?.data) {
          const dynamicFeatures = JSON.parse(doc.data).features || [];
          const dynamicFeature = dynamicFeatures.find((f) => f.code === featureCode);
          if (dynamicFeature?.mainHide === true) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * 判断插件是否允许多开（pluginSetting.single 默认/true = 不可多开, false = 允许多开）
   */
  isPluginMultiOpenAllowed(pluginPath) {
    const cached = this.pluginViews.find((v) => v.path === pluginPath);
    if (cached) return cached.single === false;
    try {
      const pluginConfig = this.readPluginConfig(pluginPath);
      return pluginConfig.pluginSetting?.single === false;
    } catch {
      return false;
    }
  }
  /**
   * 构建插件 logo 的 file:// URL
   */
  buildPluginLogoUrl(pluginPath, logoRelPath) {
    return logoRelPath ? url.pathToFileURL(path.join(pluginPath, logoRelPath)).href : "";
  }
  /**
   * 解析插件入口 URL
   * @returns pluginUrl（字符串）以及是否无界面插件
   */
  resolvePluginUrl(pluginPath, pluginConfig, isDevelopment) {
    const isConfigHeadless = !pluginConfig.main;
    if (isConfigHeadless) {
      console.log("[Plugin] 检测到无界面插件(Config):", pluginConfig.name);
      return { pluginUrl: url.pathToFileURL(hideWindowHtml).href, isConfigHeadless };
    }
    if (isDevelopment && pluginConfig.development?.main) {
      console.log("[Plugin] 开发中插件，使用 development.main:", pluginConfig.development.main);
      return { pluginUrl: pluginConfig.development.main, isConfigHeadless };
    }
    if (pluginConfig.main.startsWith("http")) {
      console.log("[Plugin] 网络插件:", pluginConfig.main);
      return { pluginUrl: pluginConfig.main, isConfigHeadless };
    }
    if (isBundledInternalPlugin(pluginConfig.name) && getInternalPluginServerPort() > 0) {
      const httpUrl = getInternalPluginUrl(pluginConfig.name, pluginConfig.main);
      console.log("[Plugin] 内置插件使用 HTTP server:", httpUrl);
      return { pluginUrl: httpUrl, isConfigHeadless };
    }
    return {
      pluginUrl: url.pathToFileURL(path.join(pluginPath, pluginConfig.main)).href,
      isConfigHeadless
    };
  }
  /**
   * 创建并配置插件的 session（注册 preload、代理、图标协议）
   */
  async setupPluginSession(pluginName, pluginPath) {
    const partition = getPluginSessionPartition(pluginName);
    console.log("[Plugin] 设置插件 Session:", {
      pluginName,
      pluginPath,
      partition
    });
    const sess = electron.session.fromPartition(partition);
    sess.registerPreloadScript({ type: "frame", filePath: mainPreload });
    await proxyManager.applyProxyToSession(sess, `插件 ${pluginName}`);
    if (isBundledInternalPlugin(pluginName)) {
      registerIconProtocolForSession(sess);
    }
    return sess;
  }
  /**
   * 创建插件的 WebContentsView 实例
   */
  createPluginWebContentsView(sess, preloadPath) {
    const view = new electron.WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        sandbox: false,
        allowRunningInsecureContent: true,
        webviewTag: true,
        preload: preloadPath,
        session: sess,
        defaultFontSize: 14
      }
    });
    view.setBackgroundColor("#00000000");
    return view;
  }
  /**
   * 按插件后台运行策略设置 WebContents 节流
   * @param view 插件视图
   * @param pluginPath 插件路径（用于读取缓存中的 backgroundRunning 配置）
   * @param hidden true=视图处于后台/隐藏态；false=视图处于前台展示态
   */
  applyBackgroundThrottlingByPolicy(view, pluginPath, hidden) {
    if (view.webContents.isDestroyed()) return;
    if (!hidden) {
      view.webContents.backgroundThrottling = false;
      return;
    }
    const backgroundRunning = !!pluginPath && !!this.pluginViews.find((v) => v.path === pluginPath)?.backgroundRunning;
    view.webContents.backgroundThrottling = !backgroundRunning;
  }
  /**
   * 通知渲染进程：插件已打开
   */
  sendPluginOpenedEvent(pluginConfig, pluginPath, logoUrl, cmdName, subInputPlaceholder, subInputVisible) {
    this.mainWindow?.webContents.send("plugin-opened", {
      name: pluginConfig.name,
      title: pluginConfig.title || pluginConfig.name,
      logo: logoUrl,
      path: pluginPath,
      cmdName,
      subInputPlaceholder,
      subInputVisible
    });
  }
  /**
   * 通知渲染进程：插件页面已加载完成
   */
  sendPluginLoadedEvent(pluginName, pluginPath) {
    this.mainWindow?.webContents.send("plugin-loaded", {
      name: pluginName,
      path: pluginPath
    });
  }
  mainWindow = null;
  pluginView = null;
  currentPluginPath = null;
  pluginViews = [];
  assemblyCoordinator = new PluginAssemblyCoordinator();
  // 记录最近一次插件 ESC 触发的时间，用于短时间内抑制主窗口 hide
  lastPluginEscTime = null;
  // 插件默认高度（可配置）
  pluginDefaultHeight = WINDOW_DEFAULT_HEIGHT - WINDOW_INITIAL_HEIGHT;
  // 跟踪每个插件上次进入的状态（用于单例重入判断）
  pluginLastEnterState = /* @__PURE__ */ new Map();
  /**
   * 获取插件默认高度
   */
  getPluginDefaultHeight() {
    return this.pluginDefaultHeight;
  }
  /**
   * 设置插件默认高度
   */
  setPluginDefaultHeight(height) {
    this.pluginDefaultHeight = Math.max(200, height);
  }
  /**
   * 判断是否跳过重入（同文本指令 + 同 featureCode → true）
   */
  shouldSkipReEnter(pluginPath, featureCode) {
    const lastState = this.pluginLastEnterState.get(pluginPath);
    if (!lastState) return false;
    const currentCmdType = api.getLaunchParam()?.type || "text";
    return lastState.cmdType === "text" && currentCmdType === "text" && lastState.featureCode === featureCode;
  }
  /**
   * 记录插件进入状态（用于单例重入判断）
   */
  recordEnterState(pluginPath, featureCode) {
    const cmdType = api.getLaunchParam()?.type || "text";
    this.pluginLastEnterState.set(pluginPath, { featureCode, cmdType });
  }
  /**
   * 复用已存在的分离窗口单例插件。
   * 必须在主窗口切换/隐藏当前插件之前调用，避免“只是聚焦已有分离窗口”却误退主窗口当前插件。
   */
  async reuseDetachedSingletonIfExists(pluginPath, featureCode, source) {
    if (this.isPluginMultiOpenAllowed(pluginPath)) {
      return false;
    }
    const detachedView = detachedWindowManager.getViewByPlugin(pluginPath);
    if (!detachedView) {
      return false;
    }
    console.log("[Plugin] 复用已存在的分离窗口单例插件:", {
      pluginPath,
      featureCode,
      source
    });
    detachedWindowManager.focusByPlugin(pluginPath);
    if (!this.shouldSkipReEnter(pluginPath, featureCode)) {
      console.log("[Plugin] 分离窗口单例重入，触发 onPluginEnter:", {
        pluginPath,
        featureCode,
        source
      });
      const enterPayload = this.assemblyCoordinator.buildEnterPayload(
        api.getLaunchParam()
      );
      await this.assemblyCoordinator.dispatchLifecycleEvent(
        detachedView,
        "PluginEnter",
        enterPayload
      );
      this.recordEnterState(pluginPath, featureCode);
    } else {
      console.log("[Plugin] 分离窗口单例同文本指令重入，仅聚焦:", {
        pluginPath,
        featureCode,
        source
      });
    }
    return true;
  }
  init(mainWindow) {
    this.mainWindow = mainWindow;
  }
  // 创建或更新插件视图
  async createPluginView(pluginPath, featureCode, cmdName) {
    if (!this.mainWindow) return;
    if (this.currentPluginPath !== pluginPath && await this.reuseDetachedSingletonIfExists(pluginPath, featureCode, "main-window")) {
      return;
    }
    if (this.currentPluginPath != null && this.currentPluginPath !== pluginPath) {
      this.assemblyCoordinator.trace("hide-current-plugin-before-switch", {
        pluginPath,
        featureCode,
        currentPluginPath: this.currentPluginPath
      });
      this.hidePluginView();
    }
    const assembly = this.assemblyCoordinator.beginAssembly(pluginPath, featureCode);
    console.log("[Plugin] 准备加载插件:", { assemblyId: assembly.id, pluginPath, featureCode });
    this.assemblyCoordinator.trace("create-plugin-view-enter", {
      assemblyId: assembly.id,
      pluginPath,
      featureCode,
      currentPluginPath: this.currentPluginPath
    });
    const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath);
    if (this.currentPluginPath === pluginPath) {
      const cached2 = this.pluginViews.find((v) => v.path === pluginPath);
      if (cached2) {
        if (this.shouldSkipReEnter(pluginPath, featureCode)) {
          console.log("[Plugin] 同文本指令重入，跳过 onPluginEnter:", { pluginPath, featureCode });
          this.assemblyCoordinator.abortCurrentSession("singleton-skip-reenter");
          return;
        }
        this.assemblyCoordinator.trace("reuse-current-plugin-view", {
          assemblyId: assembly.id,
          pluginPath,
          featureCode
        });
        await this.processPluginMode(pluginPath, featureCode, cached2.view, assembly);
      }
      return;
    }
    const cached = this.pluginViews.find((v) => v.path === pluginPath);
    if (cached) {
      this.assemblyCoordinator.trace("restore-cached-plugin-view", {
        assemblyId: assembly.id,
        pluginPath,
        featureCode
      });
      await this.restoreCachedPluginView(
        cached,
        pluginPath,
        pluginInfoFromDB,
        featureCode,
        cmdName,
        assembly
      );
      return;
    }
    this.assemblyCoordinator.trace("create-new-plugin-view", {
      assemblyId: assembly.id,
      pluginPath,
      featureCode
    });
    await this.createNewPluginView(pluginPath, pluginInfoFromDB, featureCode, cmdName, assembly);
  }
  /**
   * 恢复缓存的插件视图
   */
  async restoreCachedPluginView(cached, pluginPath, pluginInfoFromDB, featureCode, cmdName, assembly) {
    if (!this.mainWindow) return;
    this.assemblyCoordinator.trace("restore-cached-start", {
      assemblyId: assembly?.id,
      pluginPath,
      featureCode
    });
    const view = cached.view;
    this.mainWindow.contentView.addChildView(view);
    this.applyBackgroundThrottlingByPolicy(view, pluginPath, false);
    const mode = await this.getPluginMode(view.webContents, featureCode);
    if (assembly && !this.assemblyCoordinator.isActiveSession(assembly)) {
      console.log("[Plugin] 装配会话在 getPluginMode 期间被中断，跳过后续恢复:", pluginPath);
      this.mainWindow.contentView.removeChildView(view);
      return;
    }
    this.pluginView = view;
    this.currentPluginPath = pluginPath;
    console.log("[Plugin] 插件视图获取焦点");
    view.webContents.focus();
    const isConfigHeadless = !pluginInfoFromDB?.main;
    if (isConfigHeadless) {
      this.setExpendHeight(0, false);
    } else if (mode === "list") {
      this.setExpendHeight(0, false);
    } else if (this.isFeatureMainHide(pluginPath, featureCode)) {
      this.setExpendHeight(0, false);
    } else {
      this.setExpendHeight(cached.height || this.pluginDefaultHeight, false);
    }
    try {
      const pluginConfig = this.readPluginConfig(pluginPath);
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo);
      this.sendPluginOpenedEvent(
        pluginConfig,
        pluginPath,
        logoUrl,
        cmdName || "",
        cached.subInputPlaceholder || "搜索",
        cached.subInputVisible !== void 0 ? cached.subInputVisible : false
      );
      this.sendPluginLoadedEvent(pluginConfig.name, pluginPath);
    } catch (error) {
      console.error("[Plugin] 读取插件配置失败:", error);
    }
    console.log("[Plugin] 复用缓存的 Plugin BrowserView");
    this.assemblyCoordinator.trace("restore-cached-finish", {
      assemblyId: assembly?.id,
      pluginPath,
      featureCode
    });
    await this.processPluginMode(pluginPath, featureCode, view, assembly, mode);
    this.forceRepaintView(view);
  }
  /**
   * 创建全新的插件视图（缓存未命中时调用）
   */
  async createNewPluginView(pluginPath, pluginInfoFromDB, featureCode, cmdName, assembly) {
    if (!this.mainWindow) return;
    try {
      this.assemblyCoordinator.trace("create-new-view-start", {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode
      });
      api.resizeWindow(WINDOW_INITIAL_HEIGHT + 1);
      const pluginConfig = this.readPluginConfig(pluginPath);
      const isDevelopment = !!pluginInfoFromDB?.isDevelopment;
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name;
      const { pluginUrl } = this.resolvePluginUrl(pluginPath, pluginConfig, isDevelopment);
      const preloadPath = pluginConfig.preload ? path.join(pluginPath, pluginConfig.preload) : void 0;
      const sess = await this.setupPluginSession(effectiveName, pluginPath);
      this.pluginView = this.createPluginWebContentsView(sess, preloadPath);
      this.registerMainWindowPluginEvents(this.pluginView, pluginPath);
      this.mainWindow.contentView.addChildView(this.pluginView);
      const windowWidth = WINDOW_WIDTH;
      this.pluginView.setBounds({ x: 0, y: WINDOW_INITIAL_HEIGHT, width: windowWidth, height: 1 });
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo);
      const pluginInfo = {
        path: pluginPath,
        name: effectiveName,
        view: this.pluginView,
        subInputPlaceholder: "搜索",
        subInputVisible: false,
        logo: logoUrl,
        isDevelopment,
        backgroundRunning: !!pluginConfig.pluginSetting?.backgroundRunning,
        single: pluginConfig.pluginSetting?.single
      };
      this.pluginViews.push(pluginInfo);
      this.currentPluginPath = pluginPath;
      this.sendPluginOpenedEvent(
        pluginConfig,
        pluginPath,
        logoUrl,
        cmdName || "",
        pluginInfo.subInputPlaceholder,
        pluginInfo.subInputVisible
      );
      const view = this.pluginView;
      view.webContents.loadURL(pluginUrl);
      view.webContents.once("dom-ready", async () => {
        this.assemblyCoordinator.markDomReady(view.webContents.id);
        if (assembly && !this.assemblyCoordinator.isActiveSession(assembly)) {
          this.assemblyCoordinator.trace("dom-ready-ignored-inactive-session", {
            assemblyId: assembly.id,
            pluginPath,
            featureCode
          });
          return;
        }
        if (assembly) {
          this.assemblyCoordinator.markSessionStatus(assembly, "domReady");
        }
        view.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS);
        await this.processPluginMode(pluginPath, featureCode, view, assembly);
        this.sendPluginLoadedEvent(effectiveName, pluginPath);
        this.forceRepaintView(view);
        this.assemblyCoordinator.trace("create-new-view-dom-ready-finish", {
          assemblyId: assembly?.id,
          pluginPath,
          featureCode
        });
      });
      console.log("[Plugin] Plugin WebContentsView 已创建并缓存");
      this.assemblyCoordinator.trace("create-new-view-finish", {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode,
        effectiveName
      });
    } catch (error) {
      console.error("[Plugin] 加载插件配置失败:", error);
      this.assemblyCoordinator.trace("create-new-view-error", {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  /**
   * 为主窗口中运行的插件视图注册事件监听
   * （devtools、焦点、快捷键、进程崩溃等）
   */
  registerMainWindowPluginEvents(view, pluginPath) {
    view.webContents.on("devtools-opened", () => {
      console.log("[Plugin] 插件开发者工具已打开");
    });
    view.webContents.on("focus", () => {
      windowManager.updateFocusTarget("plugin");
      if (this.pluginView && !this.pluginView.webContents.isDestroyed()) {
        devToolsShortcut.register(this.pluginView.webContents);
      }
    });
    view.webContents.on("blur", () => {
      devToolsShortcut.unregister();
    });
    view.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && (input.key === "d" || input.key === "D") && (input.meta || input.control)) {
        event.preventDefault();
        console.log("[Plugin] 插件视图检测到 Cmd+D 快捷键");
        this.detachCurrentPlugin();
      }
      if (input.type === "keyDown" && (input.key === "q" || input.key === "Q") && (input.meta || input.control)) {
        const settings = databaseAPI.dbGet("settings-general") || {};
        const isEnabled = settings?.builtinAppShortcutsEnabled?.killPlugin !== false;
        if (!isEnabled) {
          return;
        }
        event.preventDefault();
        console.log("[Plugin] 插件视图检测到 Cmd+Q 快捷键，终止插件");
        this.killCurrentPlugin();
      }
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      console.log("[Plugin] 插件进程已退出:", {
        pluginPath,
        reason: details.reason,
        exitCode: details.exitCode
      });
      const currentView = this.pluginView;
      if (currentView && !currentView.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(currentView, "PluginOut", true);
      }
      const index = this.pluginViews.findIndex((v) => v.path === pluginPath);
      if (index !== -1) {
        this.assemblyCoordinator.clearDomReady(this.pluginViews[index].view.webContents.id);
        this.pluginViews.splice(index, 1);
        this.pluginLastEnterState.delete(pluginPath);
        console.log("[Plugin] 已从缓存中移除崩溃的插件:", pluginPath);
      }
      if (this.currentPluginPath === pluginPath) {
        this.hidePluginView();
        windowManager.notifyBackToSearch();
        this.currentPluginPath = null;
        console.log("[Plugin] 插件崩溃，已返回搜索页面");
      }
      pluginWindowManager.closeByPlugin(pluginPath);
    });
    registerExternalLinkInterceptor(view.webContents);
  }
  // 发送消息到插件
  sendPluginMessage(eventName, data) {
    if (this.pluginView && this.pluginView.webContents) {
      this.pluginView.webContents.send(eventName, data);
    }
  }
  // 隐藏插件视图
  hidePluginView() {
    if (this.pluginView && this.mainWindow) {
      const currentPath = this.currentPluginPath;
      const pluginView = this.pluginView;
      console.log("[Plugin] 隐藏插件视图:", {
        currentPath,
        hasAssembly: this.assemblyCoordinator.hasCurrentSession()
      });
      if (!pluginView.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(pluginView, "PluginOut", false);
      }
      const cached = this.pluginViews.find((v) => v.path === currentPath);
      const pluginName = cached?.name;
      this.mainWindow.contentView.removeChildView(pluginView);
      this.applyBackgroundThrottlingByPolicy(pluginView, currentPath, true);
      console.log("[Plugin] Plugin WebContentsView 已隐藏，缓存保留");
      this.pluginView = null;
      this.currentPluginPath = null;
      this.assemblyCoordinator.abortCurrentSession("hide-view-abort-assembly");
      this.assemblyCoordinator.clearCurrentSession();
      this.mainWindow.webContents.send("plugin-closed");
      if (pluginName && currentPath) {
        if (pluginWindowManager.hasWindowsByPlugin(currentPath)) {
          console.log(`[Plugin] 插件 ${pluginName} 还有打开的子窗口，暂不终止进程`);
        } else {
          this.checkAndKillPlugin(pluginName, currentPath);
        }
      }
    }
  }
  // 检查并终止插件
  checkAndKillPlugin(pluginName, pluginPath) {
    try {
      const data = api.dbGet("outKillPlugin");
      if (Array.isArray(data) && data.includes(pluginName)) {
        console.log(`插件 ${pluginName} 配置为退出后立即结束，销毁 view`);
        this.killPlugin(pluginPath);
      }
    } catch (error) {
      console.log("[Plugin] 读取 outKillPlugin 配置失败:", error);
    }
  }
  /**
   * 主窗口渲染进程刷新时，仅将当前插件视图从 contentView 移除（不发送生命周期事件、不销毁）。
   * 避免渲染进程状态重置后与插件视图产生叠层问题。
   */
  detachPluginViewOnRefresh() {
    if (!this.pluginView || !this.mainWindow) return;
    const pluginView = this.pluginView;
    console.log("[Plugin] 检测到主渲染进程刷新，移除当前插件视图以防叠层:", this.currentPluginPath);
    this.mainWindow.contentView.removeChildView(pluginView);
    this.pluginView = null;
    this.currentPluginPath = null;
    this.assemblyCoordinator.abortCurrentSession("renderer-refresh-abort-assembly");
    this.assemblyCoordinator.clearCurrentSession();
  }
  // 获取当前加载的插件路径
  getCurrentPluginPath() {
    return this.currentPluginPath;
  }
  // 获取当前加载的插件视图
  getCurrentPluginView() {
    return this.pluginView;
  }
  /**
   * 在主窗口显示时按需恢复当前插件视图高度。
   * mainHide feature 在启动阶段会先把高度压成 0，后续若通过 showWindow 唤起主窗口，
   * 需要把插件视图恢复到缓存高度或默认高度。
   */
  restoreCurrentPluginViewHeightOnWindowShow() {
    if (!this.mainWindow || !this.pluginView || !this.currentPluginPath) {
      return;
    }
    const lastState = this.pluginLastEnterState.get(this.currentPluginPath);
    if (!lastState) return;
    if (!this.isFeatureMainHide(this.currentPluginPath, lastState.featureCode)) {
      return;
    }
    const bounds = this.pluginView.getBounds();
    if (bounds.height > 0) {
      return;
    }
    const cached = this.pluginViews.find((v) => v.path === this.currentPluginPath);
    const targetHeight = cached?.height && cached.height > 0 ? cached.height : this.pluginDefaultHeight;
    console.log("[Plugin] showWindow 时恢复 mainHide 插件高度:", targetHeight);
    this.setExpendHeight(targetHeight, true);
    this.forceRepaintView(this.pluginView);
  }
  focusPluginView() {
    if (this.pluginView && this.pluginView.webContents) {
      console.log("[Plugin] 插件视图获取焦点");
      this.pluginView.webContents.focus();
    }
  }
  /**
   * 检查插件 WebContentsView 是否当前北有焦点
   * 供 Linux blur 事件处理器判断是否是应用内部焦点转移
   */
  isPluginViewFocused() {
    if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
      return false;
    }
    return this.pluginView.webContents.isFocused();
  }
  /**
   * 后台预加载插件（不显示在主窗口中，仅创建 WebContentsView 并缓存）
   * 用于"跟随主程序同时启动运行"功能
   */
  async preloadPlugin(pluginPath) {
    if (!this.mainWindow) return;
    const existing = this.pluginViews.find((v) => v.path === pluginPath);
    if (existing) {
      console.log("[Plugin] 插件已在运行中，跳过预加载:", pluginPath);
      return;
    }
    try {
      console.log("[Plugin] 开始后台预加载插件:", { pluginPath });
      const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath);
      const pluginConfig = this.readPluginConfig(pluginPath);
      const isDevelopment = !!pluginInfoFromDB?.isDevelopment;
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name;
      const { pluginUrl } = this.resolvePluginUrl(pluginPath, pluginConfig, isDevelopment);
      const preloadPath = pluginConfig.preload ? path.join(pluginPath, pluginConfig.preload) : void 0;
      const sess = await this.setupPluginSession(effectiveName, pluginPath);
      const view = this.createPluginWebContentsView(sess, preloadPath);
      this.registerMainWindowPluginEvents(view, pluginPath);
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo);
      const pluginInfo = {
        path: pluginPath,
        name: effectiveName,
        view,
        subInputPlaceholder: "搜索",
        subInputVisible: false,
        logo: logoUrl,
        isDevelopment,
        backgroundRunning: !!pluginConfig.pluginSetting?.backgroundRunning,
        single: pluginConfig.pluginSetting?.single
      };
      this.pluginViews.push(pluginInfo);
      this.applyBackgroundThrottlingByPolicy(view, pluginPath, true);
      view.webContents.loadURL(pluginUrl);
      view.webContents.once("dom-ready", () => {
        this.assemblyCoordinator.markDomReady(view.webContents.id);
        view.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS);
        console.log("[Plugin] 后台预加载插件完成:", {
          pluginName: effectiveName,
          pluginPath,
          webContentsId: view.webContents.id
        });
      });
      console.log("[Plugin] 后台预加载插件:", {
        pluginName: effectiveName,
        pluginPath
      });
    } catch (error) {
      console.error("[Plugin] 后台预加载插件失败:", pluginPath, error);
    }
  }
  // 获取所有运行中的插件路径（包括分离窗口中的插件）
  getRunningPlugins() {
    const mainWindowPlugins = this.pluginViews.map((v) => v.path);
    const detachedPlugins = detachedWindowManager.getAllWindows().map((w) => w.pluginPath);
    return [.../* @__PURE__ */ new Set([...mainWindowPlugins, ...detachedPlugins])];
  }
  // 获取所有运行中的插件信息（包括分离窗口中的插件）
  getRunningPluginsInfo() {
    const mainWindowPlugins = this.pluginViews.map((v) => ({ path: v.path, name: v.name }));
    const detachedPlugins = detachedWindowManager.getAllWindows().map((w) => ({ path: w.pluginPath, name: w.pluginName }));
    const seen = /* @__PURE__ */ new Set();
    return [...mainWindowPlugins, ...detachedPlugins].filter((p) => {
      if (seen.has(p.path)) return false;
      seen.add(p.path);
      return true;
    });
  }
  // 获取所有插件视图
  getAllPluginViews() {
    return this.pluginViews;
  }
  // 通过 webContents 查找插件名称
  getPluginNameByWebContents(webContents) {
    const plugin = this.pluginViews.find((v) => v.view.webContents === webContents);
    return plugin ? plugin.name : null;
  }
  // 终止指定插件（包括分离窗口中的插件）
  killPlugin(pluginPath) {
    try {
      console.log("[Plugin] killPlugin 开始:", { pluginPath });
      const index = this.pluginViews.findIndex((v) => v.path === pluginPath);
      if (index !== -1) {
        const { view } = this.pluginViews[index];
        this.dispatchPluginOutBeforeClose(view, true);
        if (this.currentPluginPath === pluginPath && this.mainWindow) {
          this.mainWindow.contentView.removeChildView(view);
          this.pluginView = null;
          this.currentPluginPath = null;
          this.assemblyCoordinator.clearCurrentSession();
        }
        pluginWindowManager.closeByPlugin(pluginPath);
        this.pluginViews.splice(index, 1);
        this.pluginLastEnterState.delete(pluginPath);
        console.log("[Plugin] 插件已终止:", pluginPath);
        console.log("[Plugin] killPlugin 完成:", {
          pluginPath,
          remainingPlugins: this.pluginViews.length
        });
        return true;
      }
      const detachedWindows = detachedWindowManager.getAllWindows();
      const isDetached = detachedWindows.some((w) => w.pluginPath === pluginPath);
      if (isDetached) {
        const detachedView = detachedWindowManager.getViewByPlugin(pluginPath);
        if (detachedView && !detachedView.webContents.isDestroyed()) {
          void this.assemblyCoordinator.dispatchLifecycleEvent(detachedView, "PluginOut", true);
        }
        pluginWindowManager.closeByPlugin(pluginPath);
        setTimeout(() => {
          detachedWindowManager.closeByPlugin(pluginPath);
        }, PLUGIN_OUT_GRACE_MS);
        this.pluginLastEnterState.delete(pluginPath);
        console.log("[Plugin] 分离窗口插件已终止:", pluginPath);
        return true;
      }
      console.log("[Plugin] 插件未运行:", pluginPath);
      return false;
    } catch (error) {
      console.error("[Plugin] 终止插件失败:", error);
      return false;
    }
  }
  // 通过插件名称终止插件
  killPluginByName(pluginName) {
    const plugin = this.pluginViews.find((v) => v.name === pluginName);
    if (plugin) {
      return this.killPlugin(plugin.path);
    }
    const detachedWindow = detachedWindowManager.getAllWindows().find((w) => w.pluginName === pluginName);
    if (detachedWindow) {
      return this.killPlugin(detachedWindow.pluginPath);
    }
    console.log("[Plugin] 未找到插件:", pluginName);
    return false;
  }
  // 终止所有插件（包括分离窗口中的插件）
  killAllPlugins() {
    console.log("[Plugin] killAllPlugins 开始:", { total: this.pluginViews.length });
    for (const { view, path: path2 } of this.pluginViews) {
      try {
        this.dispatchPluginOutBeforeClose(view, true);
        pluginWindowManager.closeByPlugin(path2);
        console.log("[Plugin] 插件已终止:", path2);
      } catch (error) {
        console.error("[Plugin] 终止插件失败:", path2, error);
      }
    }
    if (this.mainWindow && this.pluginView) {
      this.mainWindow.contentView.removeChildView(this.pluginView);
    }
    this.pluginViews = [];
    this.pluginView = null;
    this.currentPluginPath = null;
    this.assemblyCoordinator.clearCurrentSession();
    this.pluginLastEnterState.clear();
    for (const detachedWindow of detachedWindowManager.getAllWindows()) {
      if (!detachedWindow.view.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(detachedWindow.view, "PluginOut", true);
      }
    }
    setTimeout(() => {
      detachedWindowManager.closeAll();
    }, PLUGIN_OUT_GRACE_MS);
    console.log("[Plugin] killAllPlugins 完成");
  }
  dispatchPluginOutBeforeClose(view, isKill) {
    const webContents = view.webContents;
    if (webContents.isDestroyed()) return;
    const webContentsId = webContents.id;
    void this.assemblyCoordinator.dispatchLifecycleEvent(view, "PluginOut", isKill);
    setTimeout(() => {
      if (!webContents.isDestroyed()) {
        webContents.close();
      }
      this.assemblyCoordinator.clearDomReady(webContentsId);
    }, PLUGIN_OUT_GRACE_MS);
  }
  /**
   * 终止当前插件并返回搜索页面
   * 用于 Cmd+Q / Ctrl+Q 快捷键
   */
  killCurrentPlugin() {
    if (!this.currentPluginPath) {
      console.log("[Plugin] 没有正在运行的插件");
      return;
    }
    const pluginPath = this.currentPluginPath;
    const success = this.killPlugin(pluginPath);
    if (success && this.mainWindow) {
      windowManager.notifyBackToSearch();
      this.mainWindow.webContents.focus();
      console.log("[Plugin] 已终止插件并返回搜索页面");
    }
  }
  // 发送输入事件到当前插件（统一接口）
  sendInputEvent(event) {
    try {
      if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
        console.log("[Plugin] 没有活动的插件视图");
        return false;
      }
      this.pluginView.webContents.sendInputEvent(event);
      console.log("[Plugin] 发送输入事件:", event);
      return true;
    } catch (error) {
      console.error("[Plugin] 发送输入事件失败:", error);
      return false;
    }
  }
  // 切换当前插件的开发者工具（打开/关闭）
  async openPluginDevTools() {
    try {
      if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
        console.log("[Plugin] 没有活动的插件视图");
        return false;
      }
      if (this.pluginView.webContents.isDevToolsOpened()) {
        this.pluginView.webContents.closeDevTools();
        console.log("[Plugin] 已关闭插件开发者工具");
      } else {
        const mode = getDevToolsMode();
        this.pluginView.webContents.openDevTools({ mode });
        console.log("[Plugin] 已打开插件开发者工具");
      }
      return true;
    } catch (error) {
      console.error("[Plugin] 切换开发者工具失败:", error);
      return false;
    }
  }
  /**
   * 强制重绘 WebContentsView（修复部分 Windows 系统白屏问题）
   * 通过 bounds 微调迫使 Chromium compositor 重新合成 surface。
   *
   * 关键：两次 setBounds 必须跨 event loop tick 执行。
   * 若在同一 tick 内同步调用，Chromium compositor 会合并两次操作，
   * 只取最终值在下次 vsync 渲染，+1px 中间状态从未触达 GPU 合成阶段，修复失效。
   * 用 setImmediate 将第二次调用推入下一 tick，使两次变化各自落在不同 vsync 周期，
   * 从而确保第一次 +1px 真正触发 compositor 重绘。
   */
  forceRepaintView(view) {
    if (view.webContents.isDestroyed()) return;
    const bounds = view.getBounds();
    if (bounds.height <= 0) return;
    view.setBounds({ ...bounds, height: bounds.height + 1 });
    setImmediate(() => {
      if (!view.webContents.isDestroyed()) {
        view.setBounds(bounds);
      }
    });
  }
  /**
   * 强制重绘当前插件视图（供外部调用，如窗口唤醒时）
   */
  forceRepaintCurrentView() {
    if (this.pluginView) {
      this.forceRepaintView(this.pluginView);
    }
  }
  // 设置插件视图高度
  setExpendHeight(height, updateCache = true) {
    if (!this.mainWindow || !this.pluginView) return;
    console.log("[Plugin] 设置插件高度:", height);
    const mainContentHeight = WINDOW_INITIAL_HEIGHT;
    const totalHeight = height + mainContentHeight;
    const width = WINDOW_WIDTH;
    api.resizeWindow(totalHeight);
    this.pluginView.setBounds({
      x: 0,
      y: mainContentHeight,
      width,
      height
    });
    if (updateCache) {
      const cached = this.pluginViews.find((v) => v.view === this.pluginView);
      if (cached) {
        cached.height = height;
      }
    }
  }
  // 设置子输入框 placeholder
  setSubInputPlaceholder(placeholder) {
    if (!this.pluginView) return;
    const cached = this.pluginViews.find((v) => v.view === this.pluginView);
    if (cached) {
      cached.subInputPlaceholder = placeholder;
    }
  }
  // 设置子输入框可见性
  setSubInputVisible(pluginPath, visible) {
    const cached = this.pluginViews.find((v) => v.path === pluginPath);
    if (cached) {
      cached.subInputVisible = visible;
      console.log(`更新插件 ${pluginPath} 的子输入框可见性:`, visible);
    }
  }
  // 设置子输入框值
  setSubInputValue(value) {
    if (!this.pluginView) return;
    const cached = this.pluginViews.find((v) => v.view === this.pluginView);
    if (cached) {
      cached.subInputValue = value;
    }
  }
  // 更新插件视图大小（跟随窗口大小变化）
  updatePluginViewBounds(width, height) {
    if (!this.pluginView) return;
    const mainContentHeight = WINDOW_INITIAL_HEIGHT;
    const viewHeight = height - mainContentHeight;
    if (viewHeight > 0) {
      this.pluginView.setBounds({
        x: 0,
        y: mainContentHeight,
        width,
        height: viewHeight
      });
      const cached = this.pluginViews.find((v) => v.view === this.pluginView);
      if (cached) {
        cached.height = viewHeight;
      }
    }
  }
  // 获取插件模式
  getPluginMode(webContents, featureCode) {
    if (webContents.isDestroyed()) return Promise.resolve(void 0);
    const callId = Math.random().toString(36).substring(2, 11);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(void 0), 1e3);
      webContents.ipc.once(`plugin-mode-result-${callId}`, (_event, mode) => {
        clearTimeout(timeout);
        resolve(mode);
      });
      webContents.send("get-plugin-mode", { featureCode, callId });
    });
  }
  // ==================== 无界面插件相关方法 ====================
  // 处理插件模式
  async processPluginMode(pluginPath, featureCode, view, assembly, resolvedMode) {
    const mode = resolvedMode ?? await this.getPluginMode(view.webContents, featureCode);
    console.log("[Plugin] 插件模式:", {
      assemblyId: assembly?.id,
      pluginPath,
      featureCode,
      mode
    });
    if (assembly && !this.assemblyCoordinator.isActiveSession(assembly)) {
      this.assemblyCoordinator.trace("process-mode-skip-inactive-session", {
        assemblyId: assembly.id,
        pluginPath,
        featureCode,
        mode
      });
      return;
    }
    if (this.pluginView !== view) {
      this.assemblyCoordinator.trace("process-mode-skip-inactive-view", {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode
      });
      return;
    }
    if (mode === "none") {
      this.setExpendHeight(0, false);
      this.callHeadlessPluginMethod(pluginPath, featureCode, api.getLaunchParam());
      this.recordEnterState(pluginPath, featureCode);
      this.assemblyCoordinator.trace("process-mode-headless", {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode
      });
      if (assembly) this.assemblyCoordinator.markSessionStatus(assembly, "displayed");
    } else if (mode === "list") {
      this.setExpendHeight(0, false);
      if (assembly) {
        this.assemblyCoordinator.markSessionStatus(assembly, "readyToDisplay");
        const ack = await this.assemblyCoordinator.requestRendererAck(this.mainWindow, assembly);
        if (!ack || !this.assemblyCoordinator.isActiveSession(assembly)) return;
      }
      view.webContents.send("activate-list-mode", {
        featureCode,
        action: api.getLaunchParam(),
        pluginPath
      });
      this.recordEnterState(pluginPath, featureCode);
      if (assembly) this.assemblyCoordinator.markSessionStatus(assembly, "displayed");
    } else {
      if (assembly) {
        this.assemblyCoordinator.markSessionStatus(assembly, "readyToDisplay");
        const ack = await this.assemblyCoordinator.requestRendererAck(this.mainWindow, assembly);
        this.assemblyCoordinator.trace("process-mode-ack-result", {
          assemblyId: assembly.id,
          pluginPath,
          featureCode,
          ack
        });
        if (!ack || !this.assemblyCoordinator.isActiveSession(assembly)) {
          this.assemblyCoordinator.trace("process-mode-skip-after-ack", {
            assemblyId: assembly.id,
            pluginPath,
            featureCode,
            ack
          });
          return;
        }
      }
      let targetHeight = 0;
      if (this.isFeatureMainHide(pluginPath, featureCode)) {
        this.setExpendHeight(0, false);
        console.log("[Plugin] mainHide feature, 设置高度为 0");
      } else {
        const cached = this.pluginViews.find((v) => v.path === pluginPath);
        targetHeight = cached?.height || this.pluginDefaultHeight;
        if (targetHeight <= 0) targetHeight = this.pluginDefaultHeight;
        this.setExpendHeight(targetHeight, true);
      }
      view.webContents.focus();
      const enterPayload = this.assemblyCoordinator.buildEnterPayload(
        api.getLaunchParam(),
        assembly
      );
      await this.assemblyCoordinator.dispatchLifecycleEvent(view, "PluginReady");
      await this.assemblyCoordinator.dispatchLifecycleEvent(view, "PluginEnter", enterPayload);
      this.recordEnterState(pluginPath, featureCode);
      this.assemblyCoordinator.trace("process-mode-enter-dispatched", {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode,
        targetHeight,
        enterAssemblyId: enterPayload.__assemblyId,
        enterTs: enterPayload.__ts
      });
      if (assembly) this.assemblyCoordinator.markSessionStatus(assembly, "displayed");
    }
  }
  /**
   * 调用无界面插件方法
   */
  callHeadlessPluginMethod(pluginPath, featureCode, action) {
    const plugin = this.pluginViews.find((p) => p.path === pluginPath);
    if (!plugin) {
      throw new Error("Plugin not found");
    }
    if (plugin.view.webContents.isDestroyed()) {
      throw new Error("Plugin view is destroyed");
    }
    console.log("[Plugin] 调用无界面插件方法:", { pluginPath, featureCode, action });
    const callId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Plugin method call timeout (30s)"));
      }, 3e4);
      plugin.view.webContents.ipc.once(`plugin-method-result-${callId}`, (_event, result) => {
        clearTimeout(timeout);
        if (result.success) {
          resolve(result.result);
        } else {
          reject(new Error(result.error));
        }
      });
      plugin.view.webContents.send("call-plugin-method", {
        featureCode,
        action,
        callId
      });
    });
  }
  // ==================== mainPush 相关方法 ====================
  /**
   * 查询插件的 mainPush 回调，获取动态搜索结果
   * 如果插件尚未加载，会先预加载
   */
  async queryMainPush(pluginPath, _featureCode, queryData) {
    console.log("[Plugin][MainPush] query start:", { pluginPath, queryData });
    let plugin = this.pluginViews.find((v) => v.path === pluginPath);
    if (!plugin) {
      console.log("[Plugin][MainPush] plugin not loaded, preload first:", { pluginPath });
      await this.preloadPlugin(pluginPath);
      plugin = this.pluginViews.find((v) => v.path === pluginPath);
      if (plugin && !plugin.view.webContents.isDestroyed()) {
        console.log("[Plugin][MainPush] waiting dom-ready after preload:", { pluginPath });
        await this.assemblyCoordinator.waitForDomReady(plugin.view, 5e3);
      }
    }
    if (!plugin || plugin.view.webContents.isDestroyed()) {
      console.warn("[Plugin][MainPush] query aborted: plugin unavailable", { pluginPath });
      return [];
    }
    const callId = `mp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 3e3);
      plugin.view.webContents.ipc.once(`main-push-result-${callId}`, (_event, result) => {
        clearTimeout(timeout);
        console.log("[Plugin][MainPush] result received:", {
          pluginPath,
          callId,
          success: !!result?.success,
          resultCount: Array.isArray(result?.results) ? result.results.length : 0
        });
        if (result.success && Array.isArray(result.results)) {
          const processed = result.results.map((item) => {
            if (item.icon && !item.icon.startsWith("http") && !item.icon.startsWith("file:") && !item.icon.startsWith("data:")) {
              return {
                ...item,
                _resolvedIcon: url.pathToFileURL(path.join(pluginPath, item.icon)).href
              };
            }
            return item;
          });
          resolve(processed);
        } else {
          resolve([]);
        }
      });
      plugin.view.webContents.send("main-push-query", { queryData, callId });
      console.log("[Plugin][MainPush] query dispatched:", { pluginPath, callId });
    });
  }
  /**
   * 通知插件用户选择了 mainPush 结果
   * @returns 是否需要进入插件界面
   */
  selectMainPush(pluginPath, _featureCode, selectData) {
    const plugin = this.pluginViews.find((v) => v.path === pluginPath);
    if (!plugin || plugin.view.webContents.isDestroyed()) {
      return Promise.resolve(false);
    }
    const callId = `mps_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 3e3);
      plugin.view.webContents.ipc.once(`main-push-select-result-${callId}`, (_event, result) => {
        clearTimeout(timeout);
        resolve(result.success && result.shouldEnterPlugin);
      });
      plugin.view.webContents.send("main-push-select", { selectData, callId });
    });
  }
  // 处理插件按 ESC 键
  handlePluginEsc() {
    this.lastPluginEscTime = Date.now();
    console.log("[Plugin] 插件按下 ESC 键 (Main Process)，返回搜索页面");
    this.hidePluginView();
    windowManager.notifyBackToSearch();
    this.mainWindow?.webContents.focus();
  }
  /**
   * 在插件 ESC 之后的极短时间内（默认 100ms）抑制主窗口 hide
   */
  shouldSuppressMainHide(withinMs = 100) {
    if (this.lastPluginEscTime == null) return false;
    const diff = Date.now() - this.lastPluginEscTime;
    if (diff <= withinMs) {
      return true;
    }
    return false;
  }
  // 检查插件是否处于开发模式
  isPluginDev(webContentsId) {
    const plugin = this.pluginViews.find((v) => v.view.webContents.id === webContentsId);
    if (plugin) {
      return !!plugin.isDevelopment;
    }
    const pluginPath = pluginWindowManager.getPluginPathByWebContentsId(webContentsId);
    if (pluginPath) {
      const pluginView = this.pluginViews.find((v) => v.path === pluginPath);
      return !!pluginView?.isDevelopment;
    }
    return false;
  }
  /**
   * 读取分离窗口的上次尺寸（按插件名记录）
   */
  getStoredDetachedSize(pluginName) {
    try {
      const sizes = api.dbGet("detachedWindowSizes");
      const sizeKey = getDetachedWindowSizeKey(pluginName);
      if (sizes && typeof sizes === "object" && !Array.isArray(sizes) && sizes[sizeKey]) {
        const rawSize = sizes[sizeKey];
        const width = Number(rawSize?.width);
        const height = Number(rawSize?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          return null;
        }
        const clampedWidth = Math.max(400, Math.round(width));
        const clampedHeight = Math.max(300 - DETACHED_TITLEBAR_HEIGHT, Math.round(height));
        return { width: clampedWidth, height: clampedHeight };
      }
    } catch (error) {
      console.error("[Plugin] 读取分离窗口尺寸失败:", error);
    }
    return null;
  }
  /**
   * 直接在独立窗口中创建插件（用于自动分离模式）
   * @param pluginPath 插件路径
   * @param featureCode 功能代码
   * @returns 创建结果
   */
  async createPluginInDetachedWindow(pluginPath, featureCode) {
    try {
      console.log("[Plugin] 直接在独立窗口中创建插件:", { pluginPath, featureCode });
      if (await this.reuseDetachedSingletonIfExists(pluginPath, featureCode, "detached-window")) {
        return { success: true };
      }
      const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath);
      const pluginConfig = this.readPluginConfig(pluginPath);
      const isDevelopment = !!pluginInfoFromDB?.isDevelopment;
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name;
      const { pluginUrl, isConfigHeadless } = this.resolvePluginUrl(
        pluginPath,
        pluginConfig,
        isDevelopment
      );
      if (isConfigHeadless) {
        return { success: false, error: "无界面插件不支持在独立窗口中打开" };
      }
      const preloadPath = pluginConfig.preload ? path.join(pluginPath, pluginConfig.preload) : void 0;
      const sess = await this.setupPluginSession(effectiveName, pluginPath);
      const pluginView = this.createPluginWebContentsView(sess, preloadPath);
      pluginView.webContents.on("render-process-gone", (_event, details) => {
        console.log("[Plugin] 独立窗口插件进程已退出:", {
          pluginPath,
          reason: details.reason,
          exitCode: details.exitCode
        });
      });
      const storedSize = this.getStoredDetachedSize(effectiveName);
      const windowWidth = storedSize?.width ?? 800;
      const viewHeight = storedSize?.height ?? this.pluginDefaultHeight;
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo);
      const detachedWindow = detachedWindowManager.createDetachedWindow(
        pluginPath,
        effectiveName,
        pluginView,
        {
          width: windowWidth,
          height: viewHeight,
          title: pluginConfig.title || pluginConfig.name,
          logo: logoUrl,
          searchQuery: "",
          searchPlaceholder: "搜索..."
        }
      );
      if (!detachedWindow) {
        if (!pluginView.webContents.isDestroyed()) {
          pluginView.webContents.close();
        }
        return { success: false, error: "创建独立窗口失败" };
      }
      pluginView.webContents.loadURL(pluginUrl);
      pluginView.webContents.on("did-finish-load", () => {
        pluginView.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS);
        const enterPayload = this.assemblyCoordinator.buildEnterPayload(
          api.getLaunchParam()
        );
        void this.assemblyCoordinator.dispatchLifecycleEvent(
          pluginView,
          "PluginEnter",
          enterPayload
        );
        this.recordEnterState(pluginPath, featureCode);
      });
      console.log("[Plugin] 插件已在独立窗口中创建:", {
        pluginName: effectiveName,
        pluginPath
      });
      return { success: true };
    } catch (error) {
      console.error("[Plugin] 在独立窗口中创建插件失败:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "未知错误"
      };
    }
  }
  /**
   * 分离当前插件到独立窗口
   * 将当前在主窗口中运行的插件分离到一个独立的窗口中
   */
  async detachCurrentPlugin() {
    if (!this.mainWindow || !this.pluginView || !this.currentPluginPath) {
      return { success: false, error: "没有正在运行的插件" };
    }
    try {
      const cached = this.pluginViews.find((v) => v.path === this.currentPluginPath);
      if (!cached) {
        return { success: false, error: "插件信息未找到" };
      }
      const pluginJsonPath = path.join(this.currentPluginPath, "plugin.json");
      const pluginConfig = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
      const storedSize = this.getStoredDetachedSize(cached.name);
      const defaultViewHeight = this.pluginDefaultHeight;
      const windowWidth = storedSize?.width ?? 800;
      const viewHeight = storedSize?.height ?? cached.height ?? defaultViewHeight;
      if (!cached.view.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(cached.view, "PluginDetach");
      }
      let shouldAutoFocusSubInput = false;
      try {
        const isMainWindowFocused = this.mainWindow.webContents.isFocused();
        const isInputFocused = await this.mainWindow.webContents.executeJavaScript(
          'document.activeElement?.classList.contains("search-input")'
        );
        shouldAutoFocusSubInput = isMainWindowFocused && isInputFocused;
        console.log("[Plugin] 主窗口聚焦状态:", {
          windowFocused: isMainWindowFocused,
          inputFocused: isInputFocused,
          shouldAutoFocus: shouldAutoFocusSubInput
        });
      } catch (error) {
        console.error("[Plugin] 检测输入框聚焦状态失败:", error);
      }
      const detachedWindow = detachedWindowManager.createDetachedWindow(
        this.currentPluginPath,
        cached.name,
        cached.view,
        {
          width: windowWidth,
          height: viewHeight,
          title: pluginConfig.title || pluginConfig.name,
          logo: cached.logo,
          searchQuery: cached.subInputValue || "",
          searchPlaceholder: cached.subInputPlaceholder || "搜索...",
          subInputVisible: cached.subInputVisible !== void 0 ? cached.subInputVisible : true,
          autoFocusSubInput: shouldAutoFocusSubInput
          // 只有主窗口输入框聚焦时才自动聚焦
        }
      );
      if (!detachedWindow) {
        return { success: false, error: "创建独立窗口失败" };
      }
      this.mainWindow.contentView.removeChildView(this.pluginView);
      const index = this.pluginViews.findIndex((v) => v.path === this.currentPluginPath);
      if (index !== -1) {
        this.pluginViews.splice(index, 1);
      }
      this.mainWindow.webContents.send("plugin-closed");
      windowManager.notifyBackToSearch();
      this.pluginView = null;
      this.currentPluginPath = null;
      console.log("[Plugin] 插件已分离到独立窗口:", {
        pluginName: cached.name
      });
      return { success: true };
    } catch (error) {
      console.error("[Plugin] 分离插件失败:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "未知错误"
      };
    }
  }
  getCustomInternalApiPluginNames() {
    const settings = databaseAPI.dbGet("settings-general") || {};
    return normalizeCustomInternalApiPluginNames(settings[CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY]);
  }
  /**
   * 根据 WebContents 获取插件信息
   * @param webContents WebContents 实例
   * @returns 插件信息，如果不是插件则返回 null
   */
  getPluginInfoByWebContents(webContents) {
    const customInternalApiPluginNames = this.getCustomInternalApiPluginNames();
    for (const pluginViewInfo of this.pluginViews) {
      if (pluginViewInfo.view.webContents === webContents) {
        return {
          name: pluginViewInfo.name,
          path: pluginViewInfo.path,
          canUseInternalApi: canPluginUseInternalApi(
            pluginViewInfo.name,
            customInternalApiPluginNames
          ),
          isBundledInternal: isBundledInternalPlugin(pluginViewInfo.name),
          logo: pluginViewInfo.logo
        };
      }
    }
    const detachedWindows = detachedWindowManager.getAllWindows();
    for (const windowInfo of detachedWindows) {
      if (windowInfo.view.webContents === webContents) {
        return {
          name: windowInfo.pluginName,
          path: windowInfo.pluginPath,
          canUseInternalApi: canPluginUseInternalApi(
            windowInfo.pluginName,
            customInternalApiPluginNames
          ),
          isBundledInternal: isBundledInternalPlugin(windowInfo.pluginName)
        };
      }
    }
    return null;
  }
  /**
   * 根据插件名称获取插件的 WebContents
   * @param name 插件名称
   * @returns WebContents 实例，如果未找到则返回 null
   */
  getPluginWebContentsByName(name) {
    const plugin = this.pluginViews.find((v) => v.name === name);
    return plugin ? plugin.view.webContents : null;
  }
  /**
   * 根据插件路径获取运行中的 WebContents。
   * 同时覆盖主窗口中的插件视图和分离窗口中的插件实例。
   */
  getPluginWebContentsByPath(pluginPath) {
    const plugin = this.pluginViews.find((v) => v.path === pluginPath);
    if (plugin) return plugin.view.webContents;
    const detachedWindow = detachedWindowManager.getAllWindows().find((windowInfo) => windowInfo.pluginPath === pluginPath);
    return detachedWindow?.view.webContents ?? null;
  }
  /**
   * 检查调用者是否为内置插件
   * @param event IPC 事件对象
   * @returns 是否为内置插件调用
   */
  isInternalPluginCaller(event) {
    const pluginInfo = this.getPluginInfoByWebContents(event.sender);
    return pluginInfo?.canUseInternalApi ?? false;
  }
  /**
   * 获取指定插件的内存使用情况
   * @param pluginPath 插件路径
   * @returns 内存信息（单位：MB）
   */
  async getPluginMemoryInfo(pluginPath) {
    const plugin = this.pluginViews.find((v) => v.path === pluginPath);
    if (!plugin) {
      console.warn("[Plugin] 未找到插件视图:", pluginPath);
      console.log(
        "[Plugin] 当前运行中的插件:",
        this.pluginViews.map((v) => v.path)
      );
      return null;
    }
    if (plugin.view.webContents.isDestroyed()) {
      console.warn("[Plugin] 插件 webContents 已销毁:", pluginPath);
      return null;
    }
    try {
      const processId = plugin.view.webContents.getOSProcessId();
      const { app } = await import("electron");
      const metrics = app.getAppMetrics();
      const processMetric = metrics.find((metric) => metric.pid === processId);
      if (!processMetric) {
        console.warn("[Plugin] 未找到进程指标，进程ID:", processId);
        console.log(
          "[Plugin] 所有进程ID:",
          metrics.map((m) => m.pid)
        );
        return null;
      }
      if (!processMetric.memory) {
        console.warn("[Plugin] 进程指标中没有内存信息:", processMetric);
        return null;
      }
      const workingSetSize = processMetric.memory.workingSetSize || 0;
      const privateBytes = processMetric.memory.privateBytes || 0;
      const result = {
        private: Math.round(privateBytes / 1024),
        shared: Math.round((workingSetSize - privateBytes) / 1024),
        total: Math.round(workingSetSize / 1024)
      };
      return result;
    } catch (error) {
      console.error("[Plugin] 获取插件内存信息失败:", error);
      return null;
    }
  }
}
const pluginManager = new PluginManager();
const DEFAULT_CONFIG = {
  maxItems: 1e3,
  maxImageSize: 10 * 1024 * 1024,
  // 10MB
  maxTotalImageSize: 500 * 1024 * 1024,
  // 500MB
  retentionDays: 180
  // 默认半年
};
const CLIPBOARD_READY_WAIT_MS = 180;
const CLIPBOARD_RETRY_INTERVAL_MS = 30;
class ClipboardManager {
  isRunning = false;
  config = DEFAULT_CONFIG;
  DB_BUCKET = "CLIPBOARD";
  IMAGE_DIR;
  currentWindow = null;
  clipboardMonitor;
  windowMonitor;
  // 记录最后一次复制的内容（统一管理）
  lastCopiedContent = null;
  lastCopiedSequence = 0;
  lastCopiedSequenceWaiters = /* @__PURE__ */ new Map();
  // 临时取消剪贴板监听的计时器（防止 paste API 写入剪贴板时自我触发）
  cancelWatchTimeout = null;
  constructor() {
    this.IMAGE_DIR = path.join(electron.app.getPath("userData"), "clipboard", "images");
    this.clipboardMonitor = new ClipboardMonitor();
    this.windowMonitor = new WindowMonitor();
    this.init();
  }
  async init() {
    await fs.promises.mkdir(this.IMAGE_DIR, { recursive: true });
    try {
      const settings = api.dbGet("settings-general");
      if (settings && typeof settings.clipboardRetentionDays === "number") {
        console.log("[Clipboard] 加载剪贴板配置，保存天数:", settings.clipboardRetentionDays);
        this.updateConfig({ retentionDays: settings.clipboardRetentionDays });
      }
    } catch (error) {
      console.error("[Clipboard] 加载剪贴板配置失败:", error);
    }
    this.clipboardMonitor.start(() => {
      if (this.cancelWatchTimeout) return;
      console.log("[Clipboard] 剪贴板变化事件触发");
      this.handleClipboardChange();
    });
    this.windowMonitor.start((windowInfo) => {
      this.handleWindowActivation(windowInfo);
    });
    this.isRunning = true;
    console.log("[Clipboard] 剪贴板监听已启动（原生事件模式）");
    console.log("[Clipboard] 窗口激活监听已启动");
  }
  // 处理窗口激活事件
  handleWindowActivation(data) {
    if (data.app === "explorer.exe" && data.className === "Shell_TrayWnd") {
      return;
    }
    this.currentWindow = {
      app: data.app,
      bundleId: data.bundleId,
      pid: data.pid,
      title: data.title,
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
      appPath: data.appPath,
      className: data.className,
      hwnd: data.hwnd
    };
  }
  // 获取当前激活的窗口
  getCurrentWindow() {
    return this.currentWindow;
  }
  // 激活指定应用
  activateApp(info) {
    try {
      const identifier = os.platform() === "win32" ? info.pid : info.bundleId;
      if (!identifier) {
        console.error("[Clipboard] 无法激活应用：缺少必要的标识符 (bundleId 或 pid)");
        return false;
      }
      const success = WindowManager$1.activateWindow(identifier);
      console.log(`激活应用 ${identifier}: ${success ? "成功" : "失败"}`);
      return success;
    } catch (error) {
      console.error("[Clipboard] 激活应用失败:", error);
      return false;
    }
  }
  /**
   * 暂停剪贴板监听 300ms，防止 paste API 写入剪贴板时自我触发
   */
  temporaryCancelWatch() {
    if (this.cancelWatchTimeout) {
      clearTimeout(this.cancelWatchTimeout);
    }
    this.cancelWatchTimeout = setTimeout(() => {
      this.cancelWatchTimeout = null;
    }, 300);
  }
  // 更新配置
  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }
  // 处理剪贴板变化（原生事件已去重，直接处理）
  async handleClipboardChange() {
    try {
      let item = null;
      let hasFiles = false;
      try {
        hasFiles = hasClipboardFiles();
      } catch (error) {
        console.error("[Clipboard] 检测文件剪贴板失败:", error);
        hasFiles = false;
      }
      if (hasFiles) {
        item = await this.handleFile();
      } else if (!electron.clipboard.readImage().isEmpty()) {
        item = await this.handleImage();
      } else {
        item = await this.handleText();
      }
      if (item) {
        await this.saveItem(item);
        pluginManager?.sendPluginMessage("clipboard-change", item);
      }
    } catch (error) {
      console.error("[Clipboard] 处理剪贴板失败:", error);
    }
  }
  // 处理文件
  async handleFile() {
    try {
      let files = [];
      if (os.platform() === "darwin" || os.platform() === "win32") {
        files = readClipboardFiles();
        console.log("[Clipboard] 读取到的文件列表:", files);
      }
      if (!Array.isArray(files) || files.length === 0) {
        console.error("[Clipboard] 文件列表为空");
        return null;
      }
      this.lastCopiedContent = {
        type: "file",
        data: files,
        // 存储完整的 FileItem 对象
        timestamp: Date.now(),
        sequence: ++this.lastCopiedSequence
      };
      this.resolveLastCopiedSequenceWaiters(this.lastCopiedContent);
      const hashContent = files.map((f) => f.path).join("|");
      const hash = crypto.createHash("md5").update(hashContent).digest("hex");
      let preview = "";
      if (files.length === 1) {
        const file = files[0];
        preview = `[${file.isDirectory ? "文件夹" : "文件"}] ${file.name}`;
      } else {
        const fileCount = files.filter((f) => !f.isDirectory).length;
        const dirCount = files.filter((f) => f.isDirectory).length;
        const parts = [];
        if (fileCount > 0) parts.push(`${fileCount}个文件`);
        if (dirCount > 0) parts.push(`${dirCount}个文件夹`);
        preview = `[${parts.join("、")}]`;
      }
      return {
        id: uuid.v4(),
        type: "file",
        timestamp: Date.now(),
        hash,
        files,
        preview
      };
    } catch (error) {
      console.error("[Clipboard] 处理文件失败:", error);
      return null;
    }
  }
  // 处理图片内容
  async handleImage() {
    try {
      const image = electron.clipboard.readImage();
      const buffer = image.toPNG();
      const base64 = `data:image/png;base64,${buffer.toString("base64")}`;
      this.lastCopiedContent = {
        type: "image",
        data: base64,
        timestamp: Date.now(),
        sequence: ++this.lastCopiedSequence
      };
      this.resolveLastCopiedSequenceWaiters(this.lastCopiedContent);
      if (buffer.length > this.config.maxImageSize) {
        console.log(
          "[Clipboard] 图片过大，跳过保存:",
          (buffer.length / 1024 / 1024).toFixed(2),
          "MB"
        );
        return {
          id: uuid.v4(),
          type: "image",
          timestamp: Date.now(),
          hash: crypto.createHash("md5").update(buffer).digest("hex"),
          preview: `[图片] 过大未保存 (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`
        };
      }
      await this.checkAndCleanImageStorage();
      const imageName = `${Date.now()}-${uuid.v4().slice(0, 8)}.png`;
      const imagePath = path.join(this.IMAGE_DIR, imageName);
      await fs.promises.writeFile(imagePath, buffer);
      const size = (buffer.length / 1024).toFixed(2);
      const { width, height } = image.getSize();
      const resolution = `${width} * ${height}`;
      return {
        id: uuid.v4(),
        type: "image",
        timestamp: Date.now(),
        hash: crypto.createHash("md5").update(buffer).digest("hex"),
        imagePath,
        resolution,
        preview: `[图片] ${size}KB`
      };
    } catch (error) {
      console.error("[Clipboard] 处理图片失败:", error);
      return null;
    }
  }
  // 处理纯文本
  async handleText() {
    const text = electron.clipboard.readText();
    if (!text) {
      return null;
    }
    this.lastCopiedContent = {
      type: "text",
      data: text,
      timestamp: Date.now(),
      sequence: ++this.lastCopiedSequence
    };
    this.resolveLastCopiedSequenceWaiters(this.lastCopiedContent);
    return {
      id: uuid.v4(),
      type: "text",
      timestamp: Date.now(),
      hash: crypto.createHash("md5").update(text).digest("hex"),
      content: text,
      preview: text.length > 100 ? text.slice(0, 100) + "..." : text
    };
  }
  resolveLastCopiedSequenceWaiters(content) {
    for (const [minSequence, waiters] of this.lastCopiedSequenceWaiters.entries()) {
      if (content.sequence <= minSequence) {
        continue;
      }
      for (const resolve of waiters) {
        resolve(content);
      }
      this.lastCopiedSequenceWaiters.delete(minSequence);
    }
  }
  // 保存记录
  async saveItem(item) {
    try {
      if (this.currentWindow) {
        item.appName = this.currentWindow.app;
        item.bundleId = this.currentWindow.bundleId;
      }
      const doc = {
        _id: `${this.DB_BUCKET}/${item.id}`,
        type: item.type,
        timestamp: item.timestamp,
        hash: item.hash,
        appName: item.appName,
        bundleId: item.bundleId,
        content: item.content,
        files: item.files,
        imagePath: item.imagePath,
        resolution: item.resolution,
        preview: item.preview
      };
      await lmdbInstance.promises.put(doc);
      console.log(
        "剪贴板记录已保存:",
        item.type,
        item.preview,
        item.appName ? `来自: ${item.appName}` : ""
      );
      await this.checkAndCleanOldItems();
    } catch (error) {
      console.error("[Clipboard] 保存剪贴板记录失败:", error);
    }
  }
  // 检查并清理旧记录（超过最大条数或超过保留天数）
  async checkAndCleanOldItems() {
    try {
      const allItems = await this.getAllItems();
      if (allItems.length === 0) return;
      const sortedItems = allItems.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = /* @__PURE__ */ new Set();
      const expirationTimestamp = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1e3;
      for (const item of sortedItems) {
        if (item.timestamp < expirationTimestamp) {
          toDelete.add(item);
        } else {
          break;
        }
      }
      const remainingCount = sortedItems.length - toDelete.size;
      if (remainingCount > this.config.maxItems) {
        let countToDelete = remainingCount - this.config.maxItems;
        for (const item of sortedItems) {
          if (!toDelete.has(item)) {
            toDelete.add(item);
            countToDelete--;
          }
          if (countToDelete <= 0) break;
        }
      }
      if (toDelete.size > 0) {
        for (const item of toDelete) {
          await this.deleteItem(item.id);
        }
        console.log(`[Clipboard] 清理了 ${toDelete.size} 条过期/超限的旧记录`);
      }
    } catch (error) {
      console.error("[Clipboard] 清理旧记录失败:", error);
    }
  }
  // 检查并清理图片存储（超过总大小限制）
  async checkAndCleanImageStorage() {
    try {
      const allItems = await this.getAllItems();
      const imageItems = allItems.filter((item) => item.type === "image" && item.imagePath);
      let totalSize = 0;
      for (const item of imageItems) {
        try {
          const stat = await fs.promises.stat(item.imagePath);
          totalSize += stat.size;
        } catch {
        }
      }
      if (totalSize > this.config.maxTotalImageSize) {
        const sortedImages = imageItems.sort((a, b) => a.timestamp - b.timestamp);
        for (const item of sortedImages) {
          if (totalSize <= this.config.maxTotalImageSize * 0.8) {
            break;
          }
          try {
            const stat = await fs.promises.stat(item.imagePath);
            await fs.promises.unlink(item.imagePath);
            totalSize -= stat.size;
            console.log("[Clipboard] 删除旧图片:", item.imagePath);
          } catch {
          }
        }
      }
    } catch (error) {
      console.error("[Clipboard] 清理图片存储失败:", error);
    }
  }
  // 获取所有记录
  async getAllItems() {
    try {
      const docs = await lmdbInstance.promises.allDocs(`${this.DB_BUCKET}/`);
      if (!docs || !Array.isArray(docs)) {
        return [];
      }
      return docs.map((doc) => {
        return {
          id: doc._id.replace(`${this.DB_BUCKET}/`, ""),
          ...doc
        };
      });
    } catch (error) {
      console.error("[Clipboard] 获取所有记录失败:", error);
      return [];
    }
  }
  // 分页查询
  async getHistory(page = 1, pageSize = 50, filter) {
    try {
      let allItems = await this.getAllItems();
      if (filter) {
        const keyword = filter.toLowerCase();
        allItems = allItems.filter((item) => {
          if (item.content?.toLowerCase().includes(keyword)) {
            return true;
          }
          if (item.files) {
            return item.files.some((file) => file.name.toLowerCase().includes(keyword));
          }
          if (item.preview?.toLowerCase().includes(keyword)) {
            return true;
          }
          return false;
        });
      }
      allItems.sort((a, b) => b.timestamp - a.timestamp);
      const total = allItems.length;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const items = allItems.slice(start, end);
      const itemsWithStatus = await Promise.all(
        items.map(async (item) => {
          if (item.type === "file" && item.files) {
            const filesWithStatus = await Promise.all(
              item.files.map(async (file) => {
                try {
                  await fs.promises.access(file.path);
                  return { ...file, exists: true };
                } catch {
                  return { ...file, exists: false };
                }
              })
            );
            return { ...item, files: filesWithStatus };
          }
          return item;
        })
      );
      return {
        items: itemsWithStatus,
        total,
        page,
        pageSize
      };
    } catch (error) {
      console.error("[Clipboard] 查询历史记录失败:", error);
      return { items: [], total: 0, page, pageSize };
    }
  }
  // 搜索
  async search(keyword) {
    const result = await this.getHistory(1, 1e3, keyword);
    return result.items;
  }
  // 删除单条记录
  async deleteItem(id) {
    try {
      const docId = `${this.DB_BUCKET}/${id}`;
      const doc = await lmdbInstance.promises.get(docId);
      if (doc) {
        if (doc.type === "image" && doc.imagePath) {
          try {
            await fs.promises.unlink(doc.imagePath);
            console.log("[Clipboard] 删除图片文件:", doc.imagePath);
          } catch {
          }
        }
        await lmdbInstance.promises.remove(docId);
        console.log("[Clipboard] 删除剪贴板记录:", id);
        return true;
      }
      return false;
    } catch (error) {
      console.error("[Clipboard] 删除记录失败:", error);
      return false;
    }
  }
  // 清空历史
  async clear(type) {
    try {
      let allItems = await this.getAllItems();
      if (type) {
        allItems = allItems.filter((item) => item.type === type);
      }
      let count = 0;
      for (const item of allItems) {
        const success = await this.deleteItem(item.id);
        if (success) count++;
      }
      console.log(`清空了 ${count} 条记录`);
      return count;
    } catch (error) {
      console.error("[Clipboard] 清空历史失败:", error);
      return 0;
    }
  }
  // 写回剪贴板
  async writeToClipboard(id) {
    try {
      const docId = `${this.DB_BUCKET}/${id}`;
      const doc = await lmdbInstance.promises.get(docId);
      if (!doc) {
        console.error("[Clipboard] 记录不存在:", id);
        return false;
      }
      const item = doc;
      let isSame = false;
      switch (item.type) {
        case "text": {
          const currentText = electron.clipboard.readText();
          isSame = currentText === item.content;
          break;
        }
        case "image": {
          const currentImage = electron.clipboard.readImage();
          if (!currentImage.isEmpty()) {
            const currentBuffer = currentImage.toPNG();
            const currentHash = crypto.createHash("md5").update(currentBuffer).digest("hex");
            isSame = currentHash === item.hash;
          }
          break;
        }
        case "file": {
          try {
            const currentFilePaths = readClipboardFilePaths();
            const itemFilePaths = item.files?.map((f) => f.path) || [];
            isSame = JSON.stringify(currentFilePaths) === JSON.stringify(itemFilePaths);
          } catch (error) {
            console.error("[Clipboard] 获取当前剪贴板文件列表失败:", error);
          }
          break;
        }
      }
      if (isSame) {
        console.log("[Clipboard] 剪贴板内容与要写回的内容一致，跳过操作:", item.type, item.preview);
        return true;
      }
      await lmdbInstance.promises.remove(docId);
      switch (item.type) {
        case "text":
          if (item.content) {
            electron.clipboard.writeText(item.content);
            return true;
          }
          break;
        case "image":
          if (item.imagePath) {
            try {
              const imageBuffer = await fs.promises.readFile(item.imagePath);
              const image = electron.nativeImage.createFromBuffer(imageBuffer);
              electron.clipboard.writeImage(image);
              return true;
            } catch (error) {
              console.error("[Clipboard] 读取图片失败:", error);
              return false;
            }
          }
          break;
        case "file":
          if (item.files && item.files.length > 0) {
            try {
              const filePaths = item.files.map((f) => f.path);
              writeClipboardFiles(filePaths);
              console.log("[Clipboard] 文件列表已写回剪贴板:", filePaths);
              return true;
            } catch (error) {
              console.error("[Clipboard] 写回文件列表失败:", error);
              return false;
            }
          }
          break;
      }
      return false;
    } catch (error) {
      console.error("[Clipboard] 写回剪贴板失败:", error);
      return false;
    }
  }
  // 直接写入内容到剪贴板
  writeContent(data) {
    try {
      if (data.type === "text") {
        electron.clipboard.writeText(data.content);
        return true;
      } else if (data.type === "image") {
        let image = electron.nativeImage.createFromDataURL(data.content);
        if (image.isEmpty()) {
          image = electron.nativeImage.createFromPath(data.content);
        }
        if (image.isEmpty()) {
          try {
            image = electron.nativeImage.createFromBuffer(Buffer.from(data.content, "base64"));
          } catch {
          }
        }
        if (!image.isEmpty()) {
          electron.clipboard.writeImage(image);
          return true;
        }
        console.error("[Clipboard] 无效的图片内容");
        return false;
      }
      return false;
    } catch (error) {
      console.error("[Clipboard] 写入内容失败:", error);
      return false;
    }
  }
  // 获取最后一次复制内容的序号
  getLastCopiedSequence() {
    return this.lastCopiedContent?.sequence ?? 0;
  }
  /**
   * 等待下一次晚于指定序号的复制内容。
   * 若复制动作没有真正写入剪贴板，会在超时后返回 null，避免快捷键链路永久挂起。
   */
  waitForNextCopiedContent(minSequence, timeoutMs = 1500) {
    const latestContent = this.lastCopiedContent;
    if (latestContent && latestContent.sequence > minSequence) {
      return Promise.resolve(latestContent);
    }
    return new Promise((resolve) => {
      const waiters = this.lastCopiedSequenceWaiters.get(minSequence) ?? /* @__PURE__ */ new Set();
      let timer = setTimeout(() => {
        waiters.delete(wrappedResolve);
        if (waiters.size === 0) {
          this.lastCopiedSequenceWaiters.delete(minSequence);
        }
        resolve(null);
      }, timeoutMs);
      const wrappedResolve = (content) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve(content);
      };
      waiters.add(wrappedResolve);
      this.lastCopiedSequenceWaiters.set(minSequence, waiters);
    });
  }
  // 获取最后一次复制的文本（在指定时间内）- 兼容旧 API
  async getLastCopiedText(timeLimit) {
    const content = await this.getLastCopiedContent(timeLimit);
    return content?.type === "text" ? content.data : null;
  }
  // 获取最后复制的图片（自动粘贴功能）- 兼容旧 API
  async getLastCopiedImage(timeLimit) {
    const content = await this.getLastCopiedContent(timeLimit);
    return content?.type === "image" ? content.data : null;
  }
  // 获取最后复制的内容（统一接口）
  async getLastCopiedContent(timeLimit, minSequence) {
    const cachedContent = this.getValidLastCopiedContent(timeLimit);
    if (cachedContent && (!minSequence || cachedContent.sequence > minSequence)) {
      return cachedContent;
    }
    const initialSequence = Math.max(this.lastCopiedContent?.sequence ?? 0, minSequence ?? 0);
    const waitMs = timeLimit && timeLimit > 0 ? Math.min(timeLimit, CLIPBOARD_READY_WAIT_MS) : CLIPBOARD_READY_WAIT_MS;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(CLIPBOARD_RETRY_INTERVAL_MS);
      const latestContent = this.getValidLastCopiedContent(timeLimit);
      if (latestContent && latestContent.sequence > initialSequence) {
        return latestContent;
      }
    }
    return null;
  }
  // 获取在有效时间范围内的最后复制内容
  getValidLastCopiedContent(timeLimit) {
    if (!this.isContentWithinTimeLimit(this.lastCopiedContent, timeLimit)) {
      return null;
    }
    return this.lastCopiedContent;
  }
  // 检查复制内容是否仍在允许的时间范围内
  isContentWithinTimeLimit(content, timeLimit) {
    if (!content) {
      return false;
    }
    if (!timeLimit || timeLimit <= 0) {
      return true;
    }
    return Date.now() - content.timestamp <= timeLimit;
  }
  // 获取状态
  async getStatus() {
    try {
      const allItems = await this.getAllItems();
      const imageItems = allItems.filter((item) => item.type === "image" && item.imagePath);
      let imageStorageSize = 0;
      for (const item of imageItems) {
        try {
          const stat = await fs.promises.stat(item.imagePath);
          imageStorageSize += stat.size;
        } catch {
        }
      }
      return {
        isRunning: this.isRunning,
        itemCount: allItems.length,
        imageCount: imageItems.length,
        imageStorageSize
      };
    } catch (error) {
      console.error("[Clipboard] 获取状态失败:", error);
      return {
        isRunning: this.isRunning,
        itemCount: 0,
        imageCount: 0,
        imageStorageSize: 0
      };
    }
  }
}
const clipboardManager = new ClipboardManager();
class ClipboardAPI {
  init() {
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle(
      "clipboard:get-history",
      async (_event, page, pageSize, filter) => {
        try {
          return await clipboardManager.getHistory(page, pageSize, filter);
        } catch (error) {
          console.error("[Clipboard] 获取剪贴板历史失败:", error);
          return { items: [], total: 0, page, pageSize };
        }
      }
    );
    electron.ipcMain.handle("clipboard:search", async (_event, keyword) => {
      try {
        return await clipboardManager.search(keyword);
      } catch (error) {
        console.error("[Clipboard] 搜索剪贴板失败:", error);
        return [];
      }
    });
    electron.ipcMain.handle("clipboard:delete", async (_event, id) => {
      try {
        const result = await clipboardManager.deleteItem(id);
        return { success: result };
      } catch (error) {
        console.error("[Clipboard] 删除剪贴板记录失败:", error);
        return { success: false };
      }
    });
    electron.ipcMain.handle("clipboard:clear", async (_event, type) => {
      try {
        const count = await clipboardManager.clear(type);
        return { success: true, count };
      } catch (error) {
        console.error("[Clipboard] 清空剪贴板历史失败:", error);
        return { success: false, count: 0 };
      }
    });
    electron.ipcMain.handle("clipboard:get-status", async () => {
      try {
        return await clipboardManager.getStatus();
      } catch (error) {
        console.error("[Clipboard] 获取剪贴板状态失败:", error);
        return {
          isRunning: false,
          itemCount: 0,
          imageCount: 0,
          imageStorageSize: 0
        };
      }
    });
    electron.ipcMain.handle("clipboard:write", async (_event, id, shouldPaste = true) => {
      windowManager.hideWindow();
      const previousActiveWindow = windowManager.getPreviousActiveWindow();
      if (previousActiveWindow) {
        clipboardManager.activateApp(previousActiveWindow);
      }
      try {
        const result = await clipboardManager.writeToClipboard(id);
        if (shouldPaste) {
          WindowManager$1.simulatePaste();
        }
        return { success: result };
      } catch (error) {
        console.error("[Clipboard] 写回剪贴板失败:", error);
        return { success: false };
      }
    });
    electron.ipcMain.handle(
      "clipboard:write-content",
      async (_event, data, shouldPaste = true) => {
        windowManager.hideWindow();
        const previousActiveWindow = windowManager.getPreviousActiveWindow();
        if (previousActiveWindow) {
          clipboardManager.activateApp(previousActiveWindow);
        }
        try {
          const result = clipboardManager.writeContent(data);
          if (result && shouldPaste) {
            WindowManager$1.simulatePaste();
          }
          return { success: result };
        } catch (error) {
          console.error("[Clipboard] 写入剪贴板内容失败:", error);
          return { success: false };
        }
      }
    );
    electron.ipcMain.handle("clipboard:update-config", (_event, config) => {
      try {
        clipboardManager.updateConfig(config);
        return { success: true };
      } catch (error) {
        console.error("[Clipboard] 更新剪贴板配置失败:", error);
        return { success: false };
      }
    });
  }
}
const clipboardAPI = new ClipboardAPI();
const UNINSTALL_KEY_PATHS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
];
function execAsync$1(command) {
  return new Promise((resolve, reject) => {
    child_process.exec(command, { encoding: "utf-8", windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
async function findUninstallKeyPath(productName) {
  for (const basePath of UNINSTALL_KEY_PATHS) {
    try {
      const output = await execAsync$1(
        `reg query "${basePath}" /s /v DisplayName /f "${productName}" /e`
      );
      const match = output.match(
        new RegExp(`^(${basePath.replace(/\\/g, "\\\\")}\\\\[^\\r\\n]+)`, "m")
      );
      if (match) return match[1];
    } catch {
    }
  }
  return null;
}
async function getRegistryValue(keyPath, valueName) {
  try {
    const output = await execAsync$1(`reg query "${keyPath}" /v "${valueName}"`);
    const match = output.match(new RegExp(`${valueName}\\s+REG_SZ\\s+(.+)`));
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}
async function setRegistryValue(keyPath, valueName, value) {
  try {
    await execAsync$1(`reg add "${keyPath}" /v "${valueName}" /t REG_SZ /d "${value}" /f`);
    return true;
  } catch {
    return false;
  }
}
async function syncWindowsUninstallVersion() {
  if (process.platform !== "win32") return;
  if (!electron.app.isPackaged) return;
  const currentVersion = electron.app.getVersion();
  const productName = electron.app.getName();
  try {
    const keyPath = await findUninstallKeyPath(productName);
    if (!keyPath) {
      console.log("[RegistrySync] No uninstall registry entry found (portable install?)");
      return;
    }
    const registryVersion = await getRegistryValue(keyPath, "DisplayVersion");
    if (registryVersion === currentVersion) return;
    const success = await setRegistryValue(keyPath, "DisplayVersion", currentVersion);
    if (success) {
      console.log(`[RegistrySync] Updated DisplayVersion: ${registryVersion} -> ${currentVersion}`);
    } else {
      console.warn("[RegistrySync] Failed to update DisplayVersion (insufficient permissions?)");
    }
  } catch (error) {
    console.error("[RegistrySync] Error syncing registry version:", error);
  }
}
class UpdaterAPI {
  latestYmlUrl = "https://github.com/ZToolsCenter/ZTools/releases/latest/download/latest.yml";
  mainWindow = null;
  checkTimer = null;
  downloadedUpdateInfo = null;
  downloadedUpdatePath = null;
  updateWindow = null;
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupIPC();
    this.startAutoCheck();
    syncWindowsUninstallVersion();
  }
  setupIPC() {
    electron.ipcMain.handle("updater:check-update", () => this.checkUpdate());
    electron.ipcMain.handle("updater:start-update", (_event, updateInfo) => this.startUpdate(updateInfo));
    electron.ipcMain.handle("updater:install-downloaded-update", () => this.installDownloadedUpdate());
    electron.ipcMain.handle("updater:get-download-status", () => this.getDownloadStatus());
    electron.ipcMain.on("updater:quit-and-install", () => this.installDownloadedUpdate());
    electron.ipcMain.on("updater:close-window", () => this.closeUpdateWindow());
    electron.ipcMain.on("updater:window-ready", () => {
      if (this.updateWindow && this.downloadedUpdateInfo) {
        this.updateWindow.webContents.send("update-info", {
          version: this.downloadedUpdateInfo.version,
          changelog: this.downloadedUpdateInfo.changelog
        });
      }
    });
  }
  /**
   * 启动自动检查（30分钟一次）
   */
  startAutoCheck() {
    try {
      const settings = databaseAPI.dbGet("settings-general");
      const autoCheck = settings?.autoCheckUpdate ?? true;
      if (!autoCheck) {
        console.log("[Updater] 自动检查更新已禁用");
        return;
      }
      this.autoCheckAndDownload();
      this.cleanup();
      this.checkTimer = setInterval(() => this.autoCheckAndDownload(), 30 * 60 * 1e3);
    } catch (error) {
      console.error("[Updater] 启动自动检查更新失败:", error);
      this.autoCheckAndDownload();
      this.checkTimer = setInterval(() => this.autoCheckAndDownload(), 30 * 60 * 1e3);
    }
  }
  /**
   * 停止自动检查
   */
  stopAutoCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      console.log("[Updater] 自动检查更新已停止");
    }
  }
  /**
   * 设置是否自动检查
   */
  setAutoCheck(enabled) {
    if (enabled) {
      this.startAutoCheck();
    } else {
      this.stopAutoCheck();
    }
  }
  /**
   * 自动检查并下载更新
   */
  async autoCheckAndDownload() {
    try {
      console.log("[Updater] 开始自动检查更新...");
      if (this.downloadedUpdateInfo) {
        console.log("[Updater] 已有下载的更新，跳过检查");
        return;
      }
      const result = await this.checkUpdate();
      if (result.hasUpdate && result.updateInfo) {
        console.log("[Updater] 发现新版本，开始自动下载...", result.updateInfo);
        this.mainWindow?.webContents.send("update-download-start", {
          version: result.updateInfo.version
        });
        const downloadResult = await this.downloadAndExtractUpdate(result.updateInfo);
        if (downloadResult.success) {
          this.downloadedUpdateInfo = result.updateInfo;
          this.downloadedUpdatePath = downloadResult.extractPath;
          this.mainWindow?.webContents.send("update-downloaded", {
            version: result.updateInfo.version,
            changelog: result.updateInfo.changelog
          });
          console.log("[Updater] 更新下载完成，等待用户安装");
          this.createUpdateWindow();
        } else {
          console.error("[Updater] 更新下载失败:", downloadResult.error);
          this.mainWindow?.webContents.send("update-download-failed", {
            error: downloadResult.error instanceof Error ? downloadResult.error.message : "下载失败"
          });
        }
      }
    } catch (error) {
      console.error("[Updater] 自动检查更新失败:", error);
    }
  }
  /**
   * 获取下载状态
   */
  getDownloadStatus() {
    if (this.downloadedUpdateInfo) {
      return {
        hasDownloaded: true,
        version: this.downloadedUpdateInfo.version,
        changelog: this.downloadedUpdateInfo.changelog
      };
    }
    return { hasDownloaded: false };
  }
  /**
   * 根据平台选择下载URL
   */
  selectDownloadUrl(updateInfo) {
    return updateInfo.downloadUrl;
  }
  /**
   * 构建更新包下载 URL
   * 格式: update-{platform}-{arch}-{version}.zip
   * 例如: update-darwin-arm64-1.2.8.zip
   */
  buildUpdateDownloadUrl(version) {
    const platform2 = process.platform;
    const arch = process.arch;
    const fileName = `update-${platform2}-${arch}-${version}.zip`;
    const baseUrl = "https://github.com/ZToolsCenter/ZTools/releases/latest/download";
    return `${baseUrl}/${fileName}`;
  }
  /**
   * 下载并解压更新包
   */
  async downloadAndExtractUpdate(updateInfo) {
    try {
      const downloadUrl = this.selectDownloadUrl(updateInfo);
      console.log("[Updater] 下载更新包:", downloadUrl);
      const tempDir = path.join(electron.app.getPath("userData"), "ztools-update-pkg");
      await fs.promises.mkdir(tempDir, { recursive: true });
      const tempZipPath = path.join(tempDir, `update-${Date.now()}.zip`);
      const extractPath = path.join(tempDir, `extracted-${Date.now()}`);
      await downloadFile(downloadUrl, tempZipPath);
      console.log("[Updater] 解压更新包...");
      await fs.promises.mkdir(extractPath, { recursive: true });
      const zip = new AdmZip(tempZipPath);
      await new Promise((resolve, reject) => {
        zip.extractAllToAsync(extractPath, true, false, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      const appAsarTmp = path.join(extractPath, "app.asar.tmp");
      const appAsar = path.join(extractPath, "app.asar");
      try {
        await fs.promises.access(appAsarTmp);
        await fs.promises.rename(appAsarTmp, appAsar);
        console.log("[Updater] 成功重命名: app.asar.tmp -> app.asar");
      } catch {
        console.log("[Updater] 未找到 app.asar.tmp，可能直接是 app.asar");
      }
      try {
        await fs.promises.unlink(tempZipPath);
      } catch (e) {
        console.error("[Updater] 删除 zip 文件失败:", e);
      }
      return { success: true, extractPath };
    } catch (error) {
      console.error("[Updater] 下载更新失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 获取更新路径配置
   */
  async getUpdatePaths(extractPath) {
    const isMac = process.platform === "darwin";
    const isWin = process.platform === "win32";
    const appPath = process.execPath;
    const asarSrc = path.join(extractPath, "app.asar");
    const unpackedSrc = path.join(extractPath, "app.asar.unpacked");
    let updaterPath = "";
    let asarDst = "";
    let unpackedDst = "";
    if (isMac) {
      const contentsDir = path.dirname(path.dirname(appPath));
      const resourcesDir = path.join(contentsDir, "Resources");
      if (!electron.app.isPackaged) {
        const safeArch = process.arch === "arm64" ? "arm64" : "amd64";
        updaterPath = path.join(electron.app.getAppPath(), `updater/mac-${safeArch}/ztools-updater`);
      } else {
        updaterPath = path.join(path.dirname(appPath), "ztools-updater");
      }
      asarDst = path.join(resourcesDir, "app.asar");
      unpackedDst = path.join(resourcesDir, "app.asar.unpacked");
    } else if (isWin) {
      const appDir = path.dirname(appPath);
      const agentPath = path.join(appDir, "ztools-agent.exe");
      const oldUpdaterPath = path.join(appDir, "ztools-updater.exe");
      try {
        await fs.promises.access(agentPath);
        updaterPath = agentPath;
      } catch {
        try {
          await fs.promises.access(oldUpdaterPath);
          await fs.promises.rename(oldUpdaterPath, agentPath);
          console.log("[Updater] 已将 ztools-updater.exe 重命名为 ztools-agent.exe");
          updaterPath = agentPath;
        } catch {
          updaterPath = agentPath;
        }
      }
      const resourcesDir = path.join(appDir, "resources");
      asarDst = path.join(resourcesDir, "app.asar");
      unpackedDst = path.join(resourcesDir, "app.asar.unpacked");
    }
    return { updaterPath, asarSrc, asarDst, unpackedSrc, unpackedDst, appPath };
  }
  /**
   * 启动 updater 并退出应用
   */
  async launchUpdater(paths) {
    try {
      await fs.promises.access(paths.updaterPath);
    } catch {
      throw new Error(`找不到升级程序: ${paths.updaterPath}`);
    }
    const args = ["--asar-src", paths.asarSrc, "--asar-dst", paths.asarDst, "--app", paths.appPath];
    if (paths.unpackedSrc) {
      args.push("--unpacked-src", paths.unpackedSrc);
      args.push("--unpacked-dst", paths.unpackedDst);
    }
    console.log("[Updater] 启动升级程序:", paths.updaterPath, args);
    const subprocess = child_process.spawn(paths.updaterPath, args, {
      detached: true,
      stdio: "ignore"
    });
    subprocess.unref();
    console.log("[Updater] 应用即将退出进行更新...");
    electron.app.exit(0);
  }
  /**
   * 安装已下载的更新
   */
  async installDownloadedUpdate() {
    try {
      if (!this.downloadedUpdatePath || !this.downloadedUpdateInfo) {
        throw new Error("没有可用的更新");
      }
      const paths = await this.getUpdatePaths(this.downloadedUpdatePath);
      await this.launchUpdater(paths);
      return { success: true };
    } catch (error) {
      console.error("[Updater] 安装更新失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 清理定时器
   */
  cleanup() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
  /**
   * 检查更新
   */
  async checkUpdate() {
    try {
      console.log("[Updater] 开始检查更新...");
      const tempDir = path.join(electron.app.getPath("userData"), "ztools-update-check");
      await fs.promises.mkdir(tempDir, { recursive: true });
      const tempFilePath = path.join(tempDir, `latest-${Date.now()}.yml`);
      try {
        console.log("[Updater] 下载 latest.yml:", this.latestYmlUrl);
        await downloadFile(this.latestYmlUrl, tempFilePath);
        const content = await fs.promises.readFile(tempFilePath, "utf-8");
        const updateInfo = yaml.parse(content);
        if (!updateInfo.version) {
          throw new Error("latest.yml 格式错误：缺少 version 字段");
        }
        const latestVersion = updateInfo.version;
        const currentVersion = electron.app.getVersion();
        console.log(`当前版本: ${currentVersion}, 最新版本: ${latestVersion}`);
        if (this.compareVersions(latestVersion, currentVersion) <= 0) {
          console.log("[Updater] 当前已是最新版本");
          return { hasUpdate: false, latestVersion, currentVersion };
        }
        console.log(`发现新版本: ${latestVersion}`);
        const downloadUrl = this.buildUpdateDownloadUrl(latestVersion);
        return {
          hasUpdate: true,
          currentVersion,
          latestVersion,
          updateInfo: {
            version: latestVersion,
            changelog: updateInfo.changelog || "",
            downloadUrl
          }
        };
      } finally {
        try {
          await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch (e) {
          console.error("[Updater] 清理临时文件失败:", e);
        }
      }
    } catch (error) {
      console.error("[Updater] 检查更新失败:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "检查更新失败"
      };
    }
  }
  /**
   * 开始更新（手动升级）
   */
  async startUpdate(updateInfo) {
    try {
      console.log("[Updater] 开始更新流程...", updateInfo);
      const downloadResult = await this.downloadAndExtractUpdate(updateInfo);
      if (!downloadResult.success) {
        return downloadResult;
      }
      const paths = await this.getUpdatePaths(downloadResult.extractPath);
      await this.launchUpdater(paths);
      return { success: true };
    } catch (error) {
      console.error("[Updater] 更新流程失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 应用窗口材质到 Update 窗口
   */
  applyMaterialToUpdateWindow(win) {
    try {
      const settings = databaseAPI.dbGet("settings-general");
      const material = settings?.windowMaterial || getDefaultWindowMaterial();
      applyWindowMaterial(win, material);
    } catch (error) {
      console.error("[Updater] 应用窗口材质失败:", error);
    }
  }
  /**
   * 创建更新窗口
   */
  createUpdateWindow() {
    if (this.updateWindow && !this.updateWindow.isDestroyed()) {
      this.updateWindow.show();
      this.updateWindow.focus();
      return;
    }
    const width = 500;
    const height = 450;
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + (workArea.height - height) / 2);
    const windowConfig = {
      width,
      height,
      x,
      y,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: true,
      hasShadow: true,
      type: "panel",
      // 尝试使用 panel 类型，类似 SuperPanel
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    };
    if (process.platform === "darwin") {
      windowConfig.transparent = true;
      windowConfig.vibrancy = "fullscreen-ui";
    } else if (process.platform === "win32") {
      windowConfig.backgroundColor = "#00000000";
    }
    this.updateWindow = new electron.BrowserWindow(windowConfig);
    if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      this.updateWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/updater.html`);
    } else {
      this.updateWindow.loadFile(path.join(__dirname, "../renderer/updater.html"));
    }
    if (process.platform === "win32") {
      this.applyMaterialToUpdateWindow(this.updateWindow);
    }
    this.updateWindow.once("ready-to-show", () => {
      this.updateWindow?.show();
    });
    this.updateWindow.on("closed", () => {
      this.updateWindow = null;
    });
  }
  /**
   * 关闭更新窗口
   */
  closeUpdateWindow() {
    if (this.updateWindow && !this.updateWindow.isDestroyed()) {
      this.updateWindow.close();
    }
  }
  compareVersions(v1, v2) {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }
}
const updaterAPI = new UpdaterAPI();
class AiModelsAPI {
  DB_KEY = "ai-models";
  // databaseAPI 会自动添加 ZTOOLS/ 前缀
  /**
   * 初始化 API
   */
  init() {
    this.setupIPC();
  }
  /**
   * 设置 IPC 处理器
   */
  setupIPC() {
    electron.ipcMain.handle("ai-models:get-all", async () => {
      try {
        const models = this.getAllModels();
        return { success: true, data: models };
      } catch (error) {
        console.error("[AIModels] 获取 AI 模型列表失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("ai-models:add", (_event, model) => {
      try {
        const result = this.addModel(model);
        return result;
      } catch (error) {
        console.error("[AIModels] 添加 AI 模型失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("ai-models:update", (_event, model) => {
      try {
        const result = this.updateModel(model);
        return result;
      } catch (error) {
        console.error("[AIModels] 更新 AI 模型失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("ai-models:delete", (_event, modelId) => {
      try {
        const result = this.deleteModel(modelId);
        return result;
      } catch (error) {
        console.error("[AIModels] 删除 AI 模型失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
  }
  /**
   * 获取所有 AI 模型
   */
  getAllModels() {
    try {
      const data = databaseAPI.dbGet(this.DB_KEY);
      if (data && Array.isArray(data)) {
        return data;
      }
      return [];
    } catch {
      return [];
    }
  }
  /**
   * 添加 AI 模型
   */
  addModel(model) {
    if (!model.id || !model.label || !model.apiUrl || !model.apiKey) {
      return { success: false, error: "模型ID、名称、API地址和密钥不能为空" };
    }
    const models = this.getAllModels();
    if (models.some((m) => m.id === model.id)) {
      return { success: false, error: "该模型ID已存在" };
    }
    models.push(model);
    databaseAPI.dbPut(this.DB_KEY, models);
    return { success: true };
  }
  /**
   * 更新 AI 模型
   */
  updateModel(model) {
    if (!model.id || !model.label || !model.apiUrl || !model.apiKey) {
      return { success: false, error: "模型ID、名称、API地址和密钥不能为空" };
    }
    const models = this.getAllModels();
    const index = models.findIndex((m) => m.id === model.id);
    if (index === -1) {
      return { success: false, error: "未找到该模型" };
    }
    models[index] = model;
    databaseAPI.dbPut(this.DB_KEY, models);
    return { success: true };
  }
  /**
   * 删除 AI 模型
   */
  deleteModel(modelId) {
    const models = this.getAllModels();
    const index = models.findIndex((m) => m.id === modelId);
    if (index === -1) {
      return { success: false, error: "未找到该模型" };
    }
    models.splice(index, 1);
    databaseAPI.dbPut(this.DB_KEY, models);
    return { success: true };
  }
}
const aiModelsAPI = new AiModelsAPI();
const LOCAL_SHORTCUTS_KEY = "local-shortcuts";
class LocalShortcutsAPI {
  mainWindow = null;
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle("local-shortcuts:get-all", () => this.getAllShortcuts());
    electron.ipcMain.handle(
      "local-shortcuts:add",
      (_event, type) => this.addShortcut(type)
    );
    electron.ipcMain.handle(
      "local-shortcuts:add-by-path",
      (_event, filePath) => this.addShortcutByPath(filePath)
    );
    electron.ipcMain.handle("local-shortcuts:delete", (_event, id) => this.deleteShortcut(id));
    electron.ipcMain.handle(
      "local-shortcuts:open",
      (_event, shortcutPath) => this.openShortcut(shortcutPath)
    );
    electron.ipcMain.handle(
      "local-shortcuts:update-alias",
      (_event, id, alias) => this.updateAlias(id, alias)
    );
  }
  /**
   * 获取所有本地启动项
   */
  getAllShortcuts() {
    try {
      const shortcuts = databaseAPI.dbGet(LOCAL_SHORTCUTS_KEY);
      return shortcuts || [];
    } catch (error) {
      console.error("[LocalShortcut] 获取本地启动项失败:", error);
      return [];
    }
  }
  /**
   * 添加本地启动项（通过文件选择对话框）
   */
  async addShortcut(type) {
    try {
      if (!this.mainWindow) {
        return { success: false, error: "主窗口未初始化" };
      }
      let properties;
      if (type === "folder") {
        properties = ["openDirectory"];
      } else {
        properties = ["openFile"];
      }
      const result = await openDialog(
        this.mainWindow,
        {
          title: type === "folder" ? "选择文件夹" : "选择文件或应用",
          properties
        },
        "用户取消选择"
      );
      if (!result.success) {
        return result;
      }
      const selectedPath = result.data.filePaths[0];
      const stats = await fs.promises.stat(selectedPath);
      const baseNameWithExt = path.basename(selectedPath);
      const fileName = path.parse(baseNameWithExt).name;
      let itemType;
      if (stats.isDirectory()) {
        if (process.platform === "darwin" && selectedPath.endsWith(".app")) {
          itemType = "app";
        } else {
          itemType = "folder";
        }
      } else {
        if (process.platform === "win32" && (selectedPath.endsWith(".exe") || selectedPath.endsWith(".lnk"))) {
          itemType = "app";
        } else {
          itemType = "file";
        }
      }
      let icon;
      if (itemType === "app") {
        if (process.platform === "darwin") {
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`;
        } else {
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`;
        }
      } else if (itemType === "folder" && process.platform === "win32") {
        icon = `ztools-icon://${encodeURIComponent(selectedPath)}`;
      } else {
        try {
          const iconData = await electron.app.getFileIcon(selectedPath, { size: "normal" });
          icon = iconData.toDataURL();
        } catch (error) {
          console.warn("[LocalShortcut] 获取文件图标失败:", error);
        }
      }
      const pinyinFull = pinyinPro.pinyin(fileName, { toneType: "none", type: "array" }).join("");
      const pinyinAbbr = pinyinPro.pinyin(fileName, { pattern: "first", toneType: "none" }).split(" ").join("");
      const shortcut = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: fileName,
        path: selectedPath,
        type: itemType,
        icon,
        keywords: [fileName],
        pinyin: pinyinFull,
        pinyinAbbr,
        addedAt: Date.now()
      };
      const shortcuts = this.getAllShortcuts();
      const exists = shortcuts.some((s) => s.path === selectedPath);
      if (exists) {
        return { success: false, error: "该项目已存在" };
      }
      shortcuts.push(shortcut);
      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, shortcuts);
      console.log("[LocalShortcut] 添加本地启动项成功:", shortcut.name);
      this.mainWindow?.webContents.send("local-shortcuts-changed");
      return { success: true };
    } catch (error) {
      console.error("[LocalShortcut] 添加本地启动项失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 添加本地启动项（通过文件路径）
   */
  async addShortcutByPath(selectedPath) {
    try {
      const stats = await fs.promises.stat(selectedPath);
      const baseNameWithExt = path.basename(selectedPath);
      const fileName = path.parse(baseNameWithExt).name;
      let itemType;
      if (stats.isDirectory()) {
        if (process.platform === "darwin" && selectedPath.endsWith(".app")) {
          itemType = "app";
        } else {
          itemType = "folder";
        }
      } else {
        if (process.platform === "win32" && (selectedPath.endsWith(".exe") || selectedPath.endsWith(".lnk"))) {
          itemType = "app";
        } else {
          itemType = "file";
        }
      }
      let icon;
      if (itemType === "app") {
        if (process.platform === "darwin") {
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`;
        } else {
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`;
        }
      } else if (itemType === "folder" && process.platform === "win32") {
        icon = `ztools-icon://${encodeURIComponent(selectedPath)}`;
      } else {
        try {
          const iconData = await electron.app.getFileIcon(selectedPath, { size: "normal" });
          icon = iconData.toDataURL();
        } catch (error) {
          console.warn("[LocalShortcut] 获取文件图标失败:", error);
        }
      }
      const pinyinFull = pinyinPro.pinyin(fileName, { toneType: "none", type: "array" }).join("");
      const pinyinAbbr = pinyinPro.pinyin(fileName, { pattern: "first", toneType: "none" }).split(" ").join("");
      const shortcut = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: fileName,
        path: selectedPath,
        type: itemType,
        icon,
        keywords: [fileName],
        pinyin: pinyinFull,
        pinyinAbbr,
        addedAt: Date.now()
      };
      const shortcuts = this.getAllShortcuts();
      const exists = shortcuts.some((s) => s.path === selectedPath);
      if (exists) {
        return { success: false, error: "该项目已存在" };
      }
      shortcuts.push(shortcut);
      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, shortcuts);
      console.log("[LocalShortcut] 添加本地启动项成功:", shortcut.name);
      this.mainWindow?.webContents.send("local-shortcuts-changed");
      return { success: true };
    } catch (error) {
      console.error("[LocalShortcut] 添加本地启动项失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 删除本地启动项
   */
  async deleteShortcut(id) {
    try {
      const shortcuts = this.getAllShortcuts();
      const filtered = shortcuts.filter((s) => s.id !== id);
      if (filtered.length === shortcuts.length) {
        return { success: false, error: "未找到该项目" };
      }
      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, filtered);
      console.log("[LocalShortcut] 删除本地启动项成功:", id);
      this.mainWindow?.webContents.send("local-shortcuts-changed");
      return { success: true };
    } catch (error) {
      console.error("[LocalShortcut] 删除本地启动项失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 更新本地启动项别名
   */
  async updateAlias(id, alias) {
    try {
      const shortcuts = this.getAllShortcuts();
      const shortcut = shortcuts.find((s) => s.id === id);
      if (!shortcut) {
        return { success: false, error: "未找到该项目" };
      }
      const trimmedAlias = alias.trim();
      shortcut.alias = trimmedAlias || void 0;
      const displayName = shortcut.alias || shortcut.name;
      shortcut.pinyin = pinyinPro.pinyin(displayName, { toneType: "none", type: "array" }).join("");
      shortcut.pinyinAbbr = pinyinPro.pinyin(displayName, { pattern: "first", toneType: "none" }).split(" ").join("");
      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, shortcuts);
      console.log(
        "[LocalShortcut] 更新本地启动项别名成功:",
        shortcut.name,
        "->",
        shortcut.alias || "(无别名)"
      );
      this.mainWindow?.webContents.send("local-shortcuts-changed");
      return { success: true };
    } catch (error) {
      console.error("[LocalShortcut] 更新本地启动项别名失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 打开本地启动项
   */
  async openShortcut(shortcutPath) {
    try {
      const result = await electron.shell.openPath(shortcutPath);
      if (result) {
        console.error("[LocalShortcut] 打开失败:", result);
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      console.error("[LocalShortcut] 打开本地启动项失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
}
const localShortcutsAPI = new LocalShortcutsAPI();
class SettingsAPI {
  mainWindow = null;
  pluginManager = null;
  init(mainWindow, pluginManager2) {
    this.mainWindow = mainWindow;
    this.pluginManager = pluginManager2;
    this.setupIPC();
    this.loadAndApplySettings();
  }
  // 临时快捷键录制相关
  recordingShortcuts = [];
  // 全局快捷键配置映射（存储每个快捷键的 autoCopy 等配置）
  globalShortcutConfigs = /* @__PURE__ */ new Map();
  globalShortcutKeyboardStateReleasers = /* @__PURE__ */ new Map();
  setupIPC() {
    electron.ipcMain.handle("set-theme", (_event, theme) => this.setTheme(theme));
    electron.ipcMain.handle(
      "set-launch-at-login",
      (_event, enable) => this.setLaunchAtLogin(enable)
    );
    electron.ipcMain.handle("get-launch-at-login", () => this.getLaunchAtLogin());
    electron.ipcMain.handle("update-shortcut", (_event, shortcut) => this.updateShortcut(shortcut));
    electron.ipcMain.handle("get-current-shortcut", () => this.getCurrentShortcut());
    electron.ipcMain.handle(
      "register-global-shortcut",
      (_event, shortcut, target, autoCopy) => this.registerGlobalShortcut(shortcut, target, autoCopy ?? false)
    );
    electron.ipcMain.handle(
      "unregister-global-shortcut",
      (_event, shortcut) => this.unregisterGlobalShortcut(shortcut)
    );
    electron.ipcMain.handle(
      "update-global-shortcut-config",
      (_event, shortcut, config) => this.updateGlobalShortcutConfig(shortcut, config)
    );
    electron.ipcMain.handle(
      "register-app-shortcut",
      (_event, shortcut, target) => this.registerAppShortcut(shortcut, target)
    );
    electron.ipcMain.handle(
      "unregister-app-shortcut",
      (_event, shortcut) => this.unregisterAppShortcut(shortcut)
    );
    electron.ipcMain.handle("start-hotkey-recording", () => this.startHotkeyRecording());
  }
  // 加载并应用设置
  async loadAndApplySettings() {
    try {
      const data = databaseAPI.dbGet("settings-general");
      console.log("[Settings] 加载到的设置:", data);
      windowManager.setTrayIconVisible(data?.showTrayIcon ?? true);
      console.log("[Settings] 启动时应用托盘图标显示设置:", data?.showTrayIcon ?? true);
      if (data) {
        if (data.opacity !== void 0 && this.mainWindow) {
          const clampedOpacity = Math.max(0.3, Math.min(1, data.opacity));
          this.mainWindow.setOpacity(clampedOpacity);
          console.log("[Settings] 启动时应用透明度设置:", data.opacity);
        }
        if (data.hotkey) {
          const success = updateShortcut(data.hotkey);
          console.log("[Settings] 启动时应用快捷键设置:", data.hotkey, success ? "成功" : "失败");
        }
        if (data.theme) {
          this.setTheme(data.theme);
          console.log("[Settings] 启动时应用主题设置:", data.theme);
        }
        if (data.autoBackToSearch) {
          await windowManager.updateAutoBackToSearch(data.autoBackToSearch);
          console.log("[Settings] 启动时应用自动返回搜索设置:", data.autoBackToSearch);
        }
        if (data.proxyEnabled !== void 0 && data.proxyUrl !== void 0) {
          proxyManager.setProxyConfig({
            enabled: data.proxyEnabled,
            url: data.proxyUrl
          });
          await proxyManager.applyProxyToDefaultSession();
          console.log("[Settings] 启动时应用代理配置:", {
            enabled: data.proxyEnabled,
            url: data.proxyUrl
          });
        }
        if (data.windowDefaultHeight !== void 0) {
          this.pluginManager?.setPluginDefaultHeight(data.windowDefaultHeight);
          console.log("[Settings] 启动时应用插件默认高度设置:", data.windowDefaultHeight);
        }
      }
      await this.loadAndRegisterGlobalShortcuts();
      await this.loadAndRegisterAppShortcuts();
    } catch (error) {
      console.error("[Settings] 加载设置失败:", error);
    }
  }
  // 加载并注册全局快捷键
  async loadAndRegisterGlobalShortcuts() {
    try {
      const shortcuts = databaseAPI.dbGet("global-shortcuts");
      if (shortcuts && Array.isArray(shortcuts)) {
        for (const shortcut of shortcuts) {
          if (shortcut.enabled && shortcut.shortcut && shortcut.target) {
            try {
              await this.registerGlobalShortcut(
                shortcut.shortcut,
                shortcut.target,
                shortcut.autoCopy ?? false
              );
            } catch (error) {
              console.error(`注册全局快捷键失败: ${shortcut.shortcut}`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error("[Settings] 加载全局快捷键失败:", error);
    }
  }
  // 加载并注册应用快捷键
  async loadAndRegisterAppShortcuts() {
    try {
      const shortcuts = databaseAPI.dbGet("app-shortcuts");
      if (shortcuts && Array.isArray(shortcuts)) {
        for (const shortcut of shortcuts) {
          if (shortcut.enabled && shortcut.shortcut && shortcut.target) {
            try {
              this.registerAppShortcut(shortcut.shortcut, shortcut.target);
            } catch (error) {
              console.error(`注册应用快捷键失败: ${shortcut.shortcut}`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error("[Settings] 加载应用快捷键失败:", error);
    }
  }
  // 设置主题
  setTheme(theme) {
    electron.nativeTheme.themeSource = theme;
    console.log("[Settings] 设置主题:", theme);
  }
  // 设置开机启动
  setLaunchAtLogin(enable) {
    electron.app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: true
    });
    console.log("[Settings] 设置开机启动:", enable);
  }
  // 获取开机启动状态
  getLaunchAtLogin() {
    const settings = electron.app.getLoginItemSettings();
    return settings.openAtLogin;
  }
  // 更新快捷键
  updateShortcut(shortcut) {
    try {
      const success = updateShortcut(shortcut);
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: "快捷键已被占用" };
      }
    } catch (error) {
      console.error("[Settings] 更新快捷键失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 获取当前快捷键
  getCurrentShortcut() {
    return getCurrentShortcut();
  }
  static MODIFIER_NAMES = ["Command", "Ctrl", "Alt", "Option", "Shift"];
  // 判断是否为双击修饰键快捷键（如 "Command+Command"）
  isDoubleTapShortcut(shortcut) {
    const parts = shortcut.split("+");
    return parts.length === 2 && parts[0] === parts[1] && SettingsAPI.MODIFIER_NAMES.includes(parts[0]);
  }
  // 从双击快捷键字符串中提取修饰键名称
  getDoubleTapModifier(shortcut) {
    return shortcut.split("+")[0];
  }
  /**
   * 注册全局快捷键。
   * 触发时会按需采集当前外部应用中的选中文本，再把上下文交给上层统一处理。
   */
  async registerGlobalShortcut(shortcut, target, autoCopy = false) {
    console.log(`[Settings] 注册全局快捷键: ${shortcut} -> ${target}, autoCopy: ${autoCopy}`);
    try {
      this.globalShortcutConfigs.set(shortcut, { autoCopy });
      console.log("[Settings] 快捷键配置已存储到 Map");
      this.ensureGlobalShortcutKeyboardState(shortcut);
      const preparation = await api.prepareGlobalShortcut(target);
      if (this.isDoubleTapShortcut(shortcut)) {
        const modifier = this.getDoubleTapModifier(shortcut);
        doubleTapManager.unregister(modifier);
        doubleTapManager.register(modifier, () => {
          console.log(`双击修饰键触发: ${shortcut} -> ${target}`);
          void this.triggerGlobalShortcut(shortcut, preparation);
        });
        console.log(`成功注册双击修饰键快捷键: ${shortcut} -> ${target}`);
        return { success: true };
      }
      electron.globalShortcut.unregister(shortcut);
      const success = electron.globalShortcut.register(shortcut, () => {
        console.log(`全局快捷键触发: ${shortcut} -> ${target}`);
        void this.triggerGlobalShortcut(shortcut, preparation);
      });
      if (!success) {
        this.releaseGlobalShortcutKeyboardState(shortcut);
        this.globalShortcutConfigs.delete(shortcut);
        return { success: false, error: "快捷键注册失败，可能已被其他应用占用" };
      }
      console.log(`成功注册全局快捷键: ${shortcut} -> ${target}`);
      return { success: true };
    } catch (error) {
      this.releaseGlobalShortcutKeyboardState(shortcut);
      this.globalShortcutConfigs.delete(shortcut);
      console.error("[Settings] 注册全局快捷键失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 注销全局快捷键
  unregisterGlobalShortcut(shortcut) {
    try {
      this.releaseGlobalShortcutKeyboardState(shortcut);
      this.globalShortcutConfigs.delete(shortcut);
      if (this.isDoubleTapShortcut(shortcut)) {
        const modifier = this.getDoubleTapModifier(shortcut);
        doubleTapManager.unregister(modifier);
        console.log(`成功注销双击修饰键快捷键: ${shortcut}`);
        return { success: true };
      }
      electron.globalShortcut.unregister(shortcut);
      console.log(`成功注销全局快捷键: ${shortcut}`);
      return { success: true };
    } catch (error) {
      console.error("[Settings] 注销全局快捷键失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 更新全局快捷键的配置（如 autoCopy）
   * 仅更新配置，不重新注册快捷键
   */
  updateGlobalShortcutConfig(shortcut, config) {
    try {
      console.log(`[Settings] 更新全局快捷键配置: ${shortcut}, autoCopy: ${config.autoCopy}`);
      this.globalShortcutConfigs.set(shortcut, config);
      console.log("[Settings] 配置更新成功");
      return { success: true };
    } catch (error) {
      console.error("[Settings] 更新全局快捷键配置失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 为已注册的全局快捷键持有键盘状态监听。
   * 这样触发时可以直接读取完整的按键释放状态，不必临时启动监听。
   */
  ensureGlobalShortcutKeyboardState(shortcut) {
    this.releaseGlobalShortcutKeyboardState(shortcut);
    this.globalShortcutKeyboardStateReleasers.set(shortcut, doubleTapManager.acquireKeyboardState());
  }
  /**
   * 释放某个全局快捷键持有的键盘状态监听引用。
   */
  releaseGlobalShortcutKeyboardState(shortcut) {
    const release = this.globalShortcutKeyboardStateReleasers.get(shortcut);
    if (!release) {
      return;
    }
    release();
    this.globalShortcutKeyboardStateReleasers.delete(shortcut);
  }
  /**
   * 处理全局快捷键的统一触发入口。
   * 仅在目标命令需要文本上下文时才会执行复制取词，避免无关快捷键产生副作用。
   */
  async triggerGlobalShortcut(shortcut, preparation) {
    if (!this.shouldTriggerGlobalShortcut(preparation.target)) {
      return;
    }
    const config = this.globalShortcutConfigs.get(shortcut);
    const autoCopy = config?.autoCopy ?? false;
    console.log(`[Settings] 快捷键触发: ${shortcut}`);
    console.log(`[Settings] 指令类型需要文本: ${preparation.shouldCaptureSelectedText}`);
    console.log(`[Settings] 用户启用自动复制: ${autoCopy}`);
    const shouldCapture = preparation.shouldCaptureSelectedText && autoCopy;
    console.log(`[Settings] 最终是否执行取词: ${shouldCapture}`);
    const context = shouldCapture ? await this.captureSelectedTextContext() : void 0;
    await this.handleGlobalShortcut(preparation.target, context);
  }
  /**
   * 判断某个快捷键目标是否允许在阻断期内再次触发。
   * 由于新的 native getSelectedContent() 方法不再需要等待，防抖逻辑已移除。
   */
  shouldTriggerGlobalShortcut(_target) {
    return true;
  }
  /**
   * 获取当前选中内容并转换成快捷键启动上下文。
   * 使用 native getSelectedContent() 方法，自动处理按键释放和剪贴板暂停。
   */
  async captureSelectedTextContext() {
    console.log("[Settings] 开始捕获选中内容...");
    try {
      const contents = WindowManager$1.getSelectedContent();
      if (!Array.isArray(contents)) {
        console.log("[Settings] 未捕获到任何内容 (contents 不是数组)");
        return {
          searchQuery: "",
          pastedImage: null,
          pastedFiles: null,
          pastedText: null
        };
      }
      console.log("[Settings] 捕获到内容数量:", contents.length);
      const fileContent = contents.find((item) => item.type === "file");
      if (fileContent && fileContent.type === "file") {
        console.log("[Settings] 捕获到文件，数量:", fileContent.data.length);
        const files = fileContent.data.map((filePath) => {
          let isDirectory = false;
          try {
            isDirectory = fs.statSync(filePath).isDirectory();
          } catch (e) {
            console.warn(`[Settings] 无法读取文件状态: ${filePath}`, e);
          }
          return {
            path: filePath,
            name: filePath.split(/[/\\]/).pop() || "",
            isDirectory,
            isFile: !isDirectory
          };
        });
        return {
          searchQuery: "",
          pastedImage: null,
          pastedFiles: files,
          pastedText: null
        };
      }
      const imageContent = contents.find((item) => item.type === "image");
      if (imageContent && imageContent.type === "image") {
        console.log("[Settings] 捕获到图片");
        return {
          searchQuery: "",
          pastedImage: imageContent.data,
          pastedFiles: null,
          pastedText: null
        };
      }
      const textContent = contents.find((item) => item.type === "text");
      if (textContent && textContent.type === "text") {
        const text = textContent.data;
        console.log("[Settings] 捕获到文本，长度:", text.length);
        if (text.trim()) {
          console.log("[Settings] 文本捕获成功");
          return {
            searchQuery: text,
            pastedImage: null,
            pastedFiles: null,
            pastedText: text
          };
        } else {
          console.log("[Settings] 文本为空");
        }
      }
      console.log("[Settings] 未捕获到任何内容");
    } catch (error) {
      console.error("[Settings] 获取选中内容失败:", error);
    }
    return {
      searchQuery: "",
      pastedImage: null,
      pastedFiles: null,
      pastedText: null
    };
  }
  /**
   * 处理全局快捷键触发。
   * 兼容普通全局快捷键和双击修饰键快捷键，统一向上层传递目标与上下文。
   */
  async handleGlobalShortcut(target, context) {
    if (this.onGlobalShortcutTriggered) {
      await this.onGlobalShortcutTriggered(target, context);
    }
  }
  // 外部回调（由 APIManager 设置）
  onGlobalShortcutTriggered;
  /**
   * 设置全局快捷键触发后的统一回调。
   * 上层可根据目标命令和上下文完成最终启动。
   */
  setGlobalShortcutHandler(handler) {
    this.onGlobalShortcutTriggered = handler;
  }
  // 开始快捷键录制（注册临时快捷键监听）
  startHotkeyRecording() {
    try {
      if (this.recordingShortcuts.length > 0) {
        this.cleanupRecordingShortcuts();
      }
      const commonShortcuts = ["Alt+Space", "Option+Space"];
      for (const shortcut of commonShortcuts) {
        try {
          const success = electron.globalShortcut.register(shortcut, () => {
            console.log(`临时快捷键触发: ${shortcut}`);
            if (this.pluginManager) {
              const settingWebContents = this.pluginManager.getPluginWebContentsByName("setting");
              if (settingWebContents) {
                settingWebContents.send("hotkey-recorded", shortcut);
              } else {
                console.warn("[Settings] 设置插件未找到，无法发送快捷键录制事件");
              }
            }
            this.cleanupRecordingShortcuts();
          });
          if (success) {
            this.recordingShortcuts.push(shortcut);
            console.log(`成功注册临时快捷键: ${shortcut}`);
          } else {
            console.warn(`临时快捷键注册失败（可能已被占用）: ${shortcut}`);
          }
        } catch (error) {
          console.error(`注册临时快捷键失败: ${shortcut}`, error);
        }
      }
      console.log(`开始快捷键录制，已注册 ${this.recordingShortcuts.length} 个临时快捷键`);
      return { success: true };
    } catch (error) {
      console.error("[Settings] 开始快捷键录制失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 清理临时快捷键（内部方法）
  cleanupRecordingShortcuts() {
    for (const shortcut of this.recordingShortcuts) {
      try {
        electron.globalShortcut.unregister(shortcut);
        console.log(`成功注销临时快捷键: ${shortcut}`);
      } catch (error) {
        console.error(`注销临时快捷键失败: ${shortcut}`, error);
      }
    }
    const count = this.recordingShortcuts.length;
    this.recordingShortcuts = [];
    console.log(`已清理 ${count} 个临时快捷键`);
  }
  // 设置代理配置
  async setProxyConfig(config) {
    try {
      proxyManager.setProxyConfig(config);
      console.log("[Settings] 代理配置已更新:", config);
      await proxyManager.applyProxyToDefaultSession();
      return { success: true };
    } catch (error) {
      console.error("[Settings] 设置代理配置失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 设置窗口默认高度
  setWindowDefaultHeight(height) {
    try {
      this.pluginManager?.setPluginDefaultHeight(height);
      console.log("[Settings] 插件默认高度已更新:", height);
      return { success: true };
    } catch (error) {
      console.error("[Settings] 设置插件默认高度失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 注册应用快捷键
  registerAppShortcut(shortcut, target) {
    try {
      const success = windowManager.registerAppShortcut(shortcut, target);
      if (!success) {
        return { success: false, error: "应用快捷键注册失败" };
      }
      return { success: true };
    } catch (error) {
      console.error("[Settings] 注册应用快捷键失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  // 注销应用快捷键
  unregisterAppShortcut(shortcut) {
    try {
      windowManager.unregisterAppShortcut(shortcut);
      console.log(`成功注销应用快捷键: ${shortcut}`);
      return { success: true };
    } catch (error) {
      console.error("[Settings] 注销应用快捷键失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
}
const settingsAPI = new SettingsAPI();
function encodeDocPath(docId) {
  return docId.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}
function decodeDocPath(path2) {
  return path2.split("/").map((seg) => decodeURIComponent(seg)).join("/");
}
class WebDAVSyncClient {
  client = null;
  /** 缓存已确认存在的目录路径，避免重复 PROPFIND 请求 */
  dirExistsCache = /* @__PURE__ */ new Set();
  /**
   * 初始化 WebDAV 客户端
   */
  async init(config) {
    this.client = webdav.createClient(config.serverUrl, {
      username: config.username,
      password: config.password
    });
    this.dirExistsCache.clear();
    await this.testConnection();
    await this.ensureRemoteDirectory();
  }
  /**
   * 测试 WebDAV 连接
   */
  async testConnection() {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    try {
      await this.client.getDirectoryContents("/");
      return true;
    } catch (error) {
      throw new Error("WebDAV 连接失败: " + error.message);
    }
  }
  /**
   * 确保远程目录存在
   */
  async ensureRemoteDirectory() {
    if (!this.client) return;
    const dirs = ["/ztools-sync", "/ztools-sync/attachments", "/ztools-sync/plugins"];
    for (const dir of dirs) {
      if (!this.dirExistsCache.has(dir)) {
        const exists = await this.client.exists(dir);
        if (!exists) {
          await this.client.createDirectory(dir);
        }
        this.dirExistsCache.add(dir);
      }
    }
  }
  /**
   * 确保路径的父目录存在（递归创建，带缓存）
   */
  async ensureParentDir(filePath) {
    if (!this.client) return;
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (!dir || dir === "/ztools-sync" || this.dirExistsCache.has(dir)) return;
    await this.ensureParentDir(dir);
    try {
      await this.client.createDirectory(dir);
    } catch (error) {
      const exists = await this.client.exists(dir).catch(() => false);
      if (!exists) {
        throw error;
      }
    }
    this.dirExistsCache.add(dir);
  }
  /**
   * 上传文档到云端
   */
  async uploadDoc(doc) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const safeDocId = encodeDocPath(doc._id);
    const remotePath = `/ztools-sync/${safeDocId}.json`;
    const content = JSON.stringify(doc, null, 2);
    try {
      await this.ensureParentDir(remotePath);
      await this.client.putFileContents(remotePath, content, {
        overwrite: true
      });
    } catch (error) {
      console.error(`[WebDAV] 上传文档失败: ${doc._id}`, error.message);
      throw error;
    }
  }
  /**
   * 从云端下载文档
   */
  async downloadDoc(docId) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const safeDocId = encodeDocPath(docId);
    const remotePath = `/ztools-sync/${safeDocId}.json`;
    const exists = await this.client.exists(remotePath);
    if (!exists) return null;
    const content = await this.client.getFileContents(remotePath, {
      format: "text"
    });
    return JSON.parse(content);
  }
  /**
   * 获取云端文档列表（包含元数据，递归遍历子目录）
   */
  async listRemoteDocsWithMeta() {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const results = [];
    const basePath = "/ztools-sync";
    const excludeDirs = /* @__PURE__ */ new Set([`${basePath}/attachments`, `${basePath}/plugins`]);
    const walk = async (dirPath) => {
      const response = await this.client.getDirectoryContents(dirPath, {
        details: true
      });
      const contents = Array.isArray(response) ? response : response.data;
      if (!Array.isArray(contents)) return;
      for (const item of contents) {
        if (item.type === "directory") {
          const filename = item.filename.replace(/\/+$/, "");
          if (!excludeDirs.has(filename)) {
            await walk(filename);
          }
        } else if (item.type === "file" && item.filename.endsWith(".json")) {
          const relativePath = item.filename.substring(basePath.length + 1);
          const encodedDocId = relativePath.replace(/\.json$/, "");
          const docId = decodeDocPath(encodedDocId);
          results.push({
            docId,
            lastModified: new Date(item.lastmod).getTime()
          });
        }
      }
    };
    await walk(basePath);
    return results;
  }
  /**
   * 删除云端文档
   */
  async deleteDoc(docId) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const safeDocId = encodeDocPath(docId);
    const remotePath = `/ztools-sync/${safeDocId}.json`;
    await this.client.deleteFile(remotePath);
  }
  /**
   * 上传附件到云端
   */
  async uploadAttachment(docId, data, metadata) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const safeDocId = encodeDocPath(docId);
    const dataPath = `/ztools-sync/attachments/${safeDocId}.bin`;
    await this.ensureParentDir(dataPath);
    await this.client.putFileContents(dataPath, data, {
      overwrite: true
    });
    if (metadata) {
      const metaPath = `/ztools-sync/attachments/${safeDocId}.meta.json`;
      await this.client.putFileContents(metaPath, JSON.stringify(metadata, null, 2), {
        overwrite: true
      });
    }
  }
  /**
   * 从云端下载附件
   */
  async downloadAttachment(docId) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const safeDocId = encodeDocPath(docId);
    const dataPath = `/ztools-sync/attachments/${safeDocId}.bin`;
    const metaPath = `/ztools-sync/attachments/${safeDocId}.meta.json`;
    const dataExists = await this.client.exists(dataPath);
    if (!dataExists) return null;
    const data = await this.client.getFileContents(dataPath, {
      format: "binary"
    });
    let metadata = void 0;
    try {
      const metaExists = await this.client.exists(metaPath);
      if (metaExists) {
        const metaContent = await this.client.getFileContents(metaPath, {
          format: "text"
        });
        metadata = JSON.parse(metaContent);
      }
    } catch (error) {
      console.warn(`[WebDAV] 下载附件元数据失败: ${docId}`, error);
    }
    return { data, metadata };
  }
  /**
   * 删除云端附件
   */
  async deleteAttachment(docId) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const safeDocId = encodeDocPath(docId);
    const remotePath = `/ztools-sync/attachments/${safeDocId}.bin`;
    const exists = await this.client.exists(remotePath);
    if (exists) {
      await this.client.deleteFile(remotePath);
    }
  }
  /**
   * 获取云端附件列表（递归遍历子目录）
   */
  async listRemoteAttachments() {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const results = [];
    const basePath = "/ztools-sync/attachments";
    const walk = async (dirPath) => {
      const response = await this.client.getDirectoryContents(dirPath, {
        details: true
      });
      const contents = Array.isArray(response) ? response : response.data;
      if (!Array.isArray(contents)) return;
      for (const item of contents) {
        if (item.type === "directory") {
          const filename = item.filename.replace(/\/+$/, "");
          await walk(filename);
        } else if (item.type === "file" && item.filename.endsWith(".bin")) {
          const relativePath = item.filename.substring(basePath.length + 1);
          const encodedId = relativePath.replace(/\.bin$/, "");
          results.push(decodeDocPath(encodedId));
        }
      }
    };
    await walk(basePath);
    return results;
  }
  // ==================== 插件同步相关方法 ====================
  /**
   * 上传插件 zip 到云端
   */
  async uploadPluginZip(pluginName, zipBuffer) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const encoded = encodeURIComponent(pluginName);
    const remotePath = `/ztools-sync/plugins/${encoded}.zip`;
    try {
      await this.client.putFileContents(remotePath, zipBuffer, {
        overwrite: true
      });
    } catch (error) {
      console.error(`[WebDAV] 上传插件 zip 失败: ${pluginName}`, error.message);
      throw error;
    }
  }
  /**
   * 从云端下载插件 zip
   */
  async downloadPluginZip(pluginName) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const encoded = encodeURIComponent(pluginName);
    const remotePath = `/ztools-sync/plugins/${encoded}.zip`;
    const exists = await this.client.exists(remotePath);
    if (!exists) return null;
    const data = await this.client.getFileContents(remotePath, {
      format: "binary"
    });
    return Buffer.from(data);
  }
  /**
   * 删除云端插件 zip
   */
  async deletePluginZip(pluginName) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const encoded = encodeURIComponent(pluginName);
    const remotePath = `/ztools-sync/plugins/${encoded}.zip`;
    const exists = await this.client.exists(remotePath);
    if (exists) {
      await this.client.deleteFile(remotePath);
    }
  }
  /**
   * 上传插件清单到云端
   */
  async uploadPluginManifest(manifest) {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const remotePath = "/ztools-sync/plugins/manifest.json";
    const content = JSON.stringify(manifest, null, 2);
    await this.client.putFileContents(remotePath, content, {
      overwrite: true
    });
  }
  /**
   * 从云端下载插件清单
   */
  async downloadPluginManifest() {
    if (!this.client) {
      throw new Error("WebDAV 客户端未初始化");
    }
    const remotePath = "/ztools-sync/plugins/manifest.json";
    const exists = await this.client.exists(remotePath);
    if (!exists) return {};
    try {
      const content = await this.client.getFileContents(remotePath, {
        format: "text"
      });
      return JSON.parse(content);
    } catch (error) {
      console.warn("[WebDAV] 解析插件清单失败:", error);
      return {};
    }
  }
}
const STAGING_DIR = path.join(electron.app.getPath("userData"), "plugin-sync");
const HASH_RECORDS_FILE = path.join(STAGING_DIR, "hash-records.json");
function getAllFiles(dir, baseDir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return results.sort();
}
function computePluginHash(pluginDir) {
  const hash = crypto.createHash("sha256");
  const files = getAllFiles(pluginDir, pluginDir);
  for (const relativePath of files) {
    hash.update(relativePath);
    const content = fs.readFileSync(path.join(pluginDir, relativePath));
    hash.update(content);
  }
  return hash.digest("hex");
}
function loadHashRecords() {
  try {
    if (fs.existsSync(HASH_RECORDS_FILE)) {
      const content = fs.readFileSync(HASH_RECORDS_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("[PluginHasher] 加载哈希记录失败:", error);
  }
  return {};
}
function saveHashRecords(records) {
  try {
    ensureStagingDir();
    fs.writeFileSync(HASH_RECORDS_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (error) {
    console.error("[PluginHasher] 保存哈希记录失败:", error);
  }
}
function ensureStagingDir() {
  if (!fs.existsSync(STAGING_DIR)) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
  }
}
function getZipStagingDir() {
  ensureStagingDir();
  return STAGING_DIR;
}
function getZipPath(pluginName) {
  return path.join(getZipStagingDir(), `${pluginName}.zip`);
}
const PLUGIN_DIR$1 = path.join(electron.app.getPath("userData"), "plugins");
class PluginSyncWatcher {
  watcher = null;
  dirtyPlugins = /* @__PURE__ */ new Set();
  paused = false;
  /**
   * 启动监听
   */
  start() {
    if (this.watcher) {
      return;
    }
    if (!fs.existsSync(PLUGIN_DIR$1)) {
      fs.mkdirSync(PLUGIN_DIR$1, { recursive: true });
    }
    console.log("[PluginSyncWatcher] 开始监听插件目录:", PLUGIN_DIR$1);
    this.markAllDirty();
    this.watcher = chokidar.watch(PLUGIN_DIR$1, {
      depth: 5,
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: process.platform === "win32",
      interval: process.platform === "win32" ? 5e3 : void 0,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });
    const handleChange = (changedPath) => {
      if (this.paused) return;
      const relativePath = path.relative(PLUGIN_DIR$1, changedPath);
      const pluginName = relativePath.split(path.sep)[0];
      if (!pluginName || pluginName === ".") return;
      this.dirtyPlugins.add(pluginName);
      console.log(`[PluginSyncWatcher] 标记脏插件: ${pluginName}`);
    };
    this.watcher.on("add", handleChange);
    this.watcher.on("change", handleChange);
    this.watcher.on("unlink", handleChange);
    this.watcher.on("addDir", handleChange);
    this.watcher.on("unlinkDir", handleChange);
    this.watcher.on("error", (error) => {
      console.error("[PluginSyncWatcher] 监听错误:", error);
    });
    this.watcher.on("ready", () => {
      console.log("[PluginSyncWatcher] 监听器已就绪");
    });
  }
  /**
   * 停止监听并清理
   */
  stop() {
    if (this.watcher) {
      console.log("[PluginSyncWatcher] 停止监听");
      this.watcher.close();
      this.watcher = null;
    }
    this.dirtyPlugins.clear();
  }
  /**
   * 获取当前脏插件集合
   */
  getDirtyPlugins() {
    return new Set(this.dirtyPlugins);
  }
  /**
   * 清除单个插件的脏标记
   */
  clearDirty(pluginName) {
    this.dirtyPlugins.delete(pluginName);
  }
  /**
   * 将所有现有插件标记为脏
   */
  markAllDirty() {
    if (!fs.existsSync(PLUGIN_DIR$1)) return;
    try {
      const entries = fs.readdirSync(PLUGIN_DIR$1, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          this.dirtyPlugins.add(entry.name);
        }
      }
      console.log(`[PluginSyncWatcher] 初始标脏 ${this.dirtyPlugins.size} 个插件`);
    } catch (error) {
      console.error("[PluginSyncWatcher] 标记所有插件为脏失败:", error);
    }
  }
  /**
   * 暂停监听（同步引擎安装/卸载插件时使用）
   */
  pause() {
    this.paused = true;
  }
  /**
   * 恢复监听
   */
  resume() {
    this.paused = false;
  }
}
const pluginSyncWatcher = new PluginSyncWatcher();
const PLUGIN_DIR = path.join(electron.app.getPath("userData"), "plugins");
class SyncEngine {
  webdavClient;
  db;
  syncTimer = null;
  mainWindow = null;
  constructor(db) {
    this.db = db;
    this.webdavClient = new WebDAVSyncClient();
  }
  /**
   * 设置主窗口引用（用于发送 plugins-changed 事件）
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }
  /**
   * 初始化同步引擎
   */
  async init() {
    const config = await this.loadSyncConfig();
    if (!config || !config.enabled) {
      console.log("[Sync] 同步未启用");
      return;
    }
    if (config.password && electron.safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(config.password, "base64");
        config.password = electron.safeStorage.decryptString(buffer);
      } catch (error) {
        console.error("[Sync] 解密密码失败:", error);
        throw new Error("解密密码失败");
      }
    }
    await this.webdavClient.init(config);
    this.startAutoSync(config.syncInterval);
    if (config.syncPlugins) {
      pluginSyncWatcher.start();
    }
    console.log("[Sync] 同步引擎初始化完成");
  }
  /**
   * 加载同步配置
   */
  async loadSyncConfig() {
    try {
      const doc = await this.db.promises.get("SYNC/config");
      return doc?.data || null;
    } catch (error) {
      console.error("[Sync] 加载配置失败:", error);
      return null;
    }
  }
  /**
   * 保存同步配置
   */
  async saveSyncConfig(config) {
    const existingDoc = await this.db.promises.get("SYNC/config");
    await this.db.promises.put({
      _id: "SYNC/config",
      _rev: existingDoc?._rev,
      // 保留现有的 _rev
      data: config
    });
  }
  /**
   * 启动自动同步
   */
  startAutoSync(intervalSeconds) {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    this.syncTimer = setInterval(() => {
      this.performSync().catch((error) => {
        console.error("[Sync] 自动同步失败:", error);
      });
    }, intervalSeconds * 1e3);
    console.log(`[Sync] 自动同步已启动，间隔 ${intervalSeconds} 秒`);
  }
  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log("[Sync] 自动同步已停止");
    }
  }
  /**
   * 执行完整同步流程
   */
  async performSync() {
    console.log("[Sync] 开始同步...");
    try {
      const uploadResult = await this.uploadLocalChanges();
      const uploadAttachmentResult = await this.uploadLocalAttachments();
      const downloadResult = await this.downloadRemoteChanges(uploadResult.processedDocIds);
      const downloadAttachmentResult = await this.downloadRemoteAttachments();
      await this.updateLastSyncTime();
      const result = {
        uploaded: uploadResult.count + uploadAttachmentResult.count,
        downloaded: downloadResult.count + downloadAttachmentResult.count,
        conflicts: 0,
        errors: uploadResult.errors + uploadAttachmentResult.errors + downloadResult.errors + downloadAttachmentResult.errors
      };
      const config = await this.loadSyncConfig();
      if (config?.syncPlugins) {
        const pluginResult = await this.syncPlugins(config);
        result.pluginsUploaded = pluginResult.pluginsUploaded;
        result.pluginsDownloaded = pluginResult.pluginsDownloaded;
        result.pluginsDeleted = pluginResult.pluginsDeleted;
        result.errors += pluginResult.errors;
      }
      console.log("[Sync] 同步完成:", result);
      return result;
    } catch (error) {
      console.error("[Sync] 同步失败:", error);
      throw error;
    }
  }
  /**
   * 强制从云端下载所有数据到本地（覆盖本地数据）
   */
  async forceDownloadFromCloud() {
    console.log("[Sync] 开始强制从云端同步到本地...");
    try {
      const remoteFiles = await this.webdavClient.listRemoteDocsWithMeta();
      if (remoteFiles.length === 0) {
        console.log("[Sync] 云端没有数据");
        return { uploaded: 0, downloaded: 0, conflicts: 0, errors: 0 };
      }
      console.log(`[Sync] 云端共有 ${remoteFiles.length} 个文档需要下载`);
      let downloaded = 0;
      let errors = 0;
      for (const file of remoteFiles) {
        try {
          const remoteDoc = await this.webdavClient.downloadDoc(file.docId);
          if (!remoteDoc) {
            console.warn(`[Sync] 无法下载文档: ${file.docId}`);
            errors++;
            continue;
          }
          remoteDoc._cloudSynced = true;
          await this.updateDocSyncStatus(file.docId, remoteDoc, true);
          downloaded++;
          console.log(`[Sync] 强制下载成功: ${file.docId}`);
        } catch (error) {
          console.error(`[Sync] 强制下载失败: ${file.docId}`, error);
          errors++;
        }
      }
      let pluginsDownloaded = 0;
      const config = await this.loadSyncConfig();
      if (config?.syncPlugins) {
        try {
          pluginSyncWatcher.pause();
          const remoteManifest = await this.webdavClient.downloadPluginManifest();
          const hashRecords = loadHashRecords();
          for (const [pluginName, entry] of Object.entries(remoteManifest)) {
            try {
              console.log(`[Sync] 强制下载插件: ${pluginName}`);
              const zipBuffer = await this.webdavClient.downloadPluginZip(pluginName);
              if (!zipBuffer) {
                console.warn(`[Sync] 远端插件 zip 不存在: ${pluginName}`);
                continue;
              }
              await this.installPluginFromSyncZip(pluginName, zipBuffer);
              hashRecords[pluginName] = {
                hash: entry.hash,
                version: entry.version,
                lastSyncTime: Date.now()
              };
              pluginsDownloaded++;
            } catch (err) {
              console.error(`[Sync] 强制下载插件失败: ${pluginName}`, err);
              errors++;
            }
          }
          saveHashRecords(hashRecords);
        } finally {
          pluginSyncWatcher.resume();
        }
      }
      await this.updateLastSyncTime();
      const result = {
        uploaded: 0,
        downloaded,
        conflicts: 0,
        errors,
        pluginsDownloaded
      };
      console.log("[Sync] 强制同步完成:", result);
      return result;
    } catch (error) {
      console.error("[Sync] 强制同步失败:", error);
      throw error;
    }
  }
  /**
   * 上传本地变更到云端
   */
  async uploadLocalChanges() {
    const pendingDocs = await this.getUnsyncedDocs();
    if (pendingDocs.length === 0) {
      console.log("[Sync] 没有待上传的文档");
      return { count: 0, errors: 0, processedDocIds: /* @__PURE__ */ new Set() };
    }
    console.log(`[Sync] 待上传文档数量: ${pendingDocs.length}`);
    let uploaded = 0;
    let errors = 0;
    const processedDocIds = /* @__PURE__ */ new Set();
    for (const doc of pendingDocs) {
      try {
        if (processedDocIds.has(doc._id)) {
          continue;
        }
        const remoteDoc = await this.webdavClient.downloadDoc(doc._id);
        if (remoteDoc && this.hasConflict(doc, remoteDoc)) {
          const winner = doc._lastModified > remoteDoc._lastModified ? doc : remoteDoc;
          if (winner === doc) {
            await this.webdavClient.uploadDoc({
              ...doc,
              _lastModified: Date.now()
            });
            const updatedDoc = await this.db.promises.get(doc._id);
            if (updatedDoc) {
              updatedDoc._cloudSynced = true;
              await this.updateDocSyncStatus(doc._id, updatedDoc);
            }
            uploaded++;
            console.log(`[Sync] 冲突已解决: ${doc._id}, 胜出: 本地，已上传`);
          } else {
            remoteDoc._cloudSynced = true;
            await this.updateDocSyncStatus(doc._id, remoteDoc);
            console.log(`[Sync] 冲突已解决: ${doc._id}, 胜出: 云端，已下载`);
          }
          processedDocIds.add(doc._id);
        } else {
          await this.webdavClient.uploadDoc({
            ...doc,
            _lastModified: Date.now()
          });
          const updatedDoc = await this.db.promises.get(doc._id);
          if (updatedDoc) {
            updatedDoc._cloudSynced = true;
            await this.updateDocSyncStatus(doc._id, updatedDoc);
          }
          uploaded++;
          processedDocIds.add(doc._id);
          console.log(`[Sync] 上传成功: ${doc._id}`);
        }
      } catch (error) {
        console.error(`[Sync] 上传失败: ${doc._id}`);
        console.error(`[Sync] 错误详情:`, error.message || error);
        if (error.response) {
          console.error(`[Sync] HTTP 状态:`, error.response.status);
          console.error(`[Sync] HTTP 响应:`, error.response.statusText);
        }
        errors++;
      }
    }
    return { count: uploaded, errors, processedDocIds };
  }
  /**
   * 上传本地附件变更
   */
  async uploadLocalAttachments() {
    console.log("[Sync] 开始扫描本地附件...");
    const attachmentDb = this.db.getAttachmentDb();
    const unsyncedAttachments = [];
    for (const { key } of attachmentDb.getRange({})) {
      if (key.startsWith("attachment:") && !key.startsWith("attachment-ext:")) {
        const attachmentId = key.replace("attachment:", "");
        const extKey = `attachment-ext:${attachmentId}`;
        const extData = attachmentDb.get(extKey);
        if (extData) {
          try {
            const metadata = JSON.parse(extData);
            if (metadata._cloudSynced === true) {
              continue;
            }
          } catch {
          }
        }
        unsyncedAttachments.push(attachmentId);
      }
    }
    if (unsyncedAttachments.length === 0) {
      console.log("[Sync] 没有待上传的附件");
      return { count: 0, errors: 0 };
    }
    console.log(`[Sync] 待上传附件数量: ${unsyncedAttachments.length}`);
    let uploaded = 0;
    let errors = 0;
    for (const attachmentId of unsyncedAttachments) {
      try {
        const attachment = await this.db.promises.getAttachment(attachmentId);
        if (!attachment) {
          console.warn(`[Sync] 附件不存在: ${attachmentId}`);
          continue;
        }
        console.log(`[Sync] 上传附件: ${attachmentId}, 大小: ${attachment.length} 字节`);
        const extKey = `attachment-ext:${attachmentId}`;
        const extData = attachmentDb.get(extKey);
        let metadata = void 0;
        if (extData) {
          try {
            metadata = JSON.parse(extData);
            const { _cloudSynced, _lastModified, ...originalMetadata } = metadata;
            metadata = originalMetadata;
          } catch {
          }
        }
        await this.webdavClient.uploadAttachment(attachmentId, Buffer.from(attachment), metadata);
        const env = this.db.env;
        env.transactionSync(() => {
          const extKey2 = `attachment-ext:${attachmentId}`;
          const existingData = attachmentDb.get(extKey2);
          let metadata2 = {};
          if (existingData) {
            try {
              metadata2 = JSON.parse(existingData);
            } catch {
            }
          }
          metadata2._cloudSynced = true;
          metadata2._lastModified = Date.now();
          attachmentDb.putSync(extKey2, JSON.stringify(metadata2));
        });
        uploaded++;
        console.log(`[Sync] 附件上传成功: ${attachmentId}`);
      } catch (error) {
        console.error(`[Sync] 附件上传失败: ${attachmentId}`, error);
        errors++;
      }
    }
    return { count: uploaded, errors };
  }
  /**
   * 从云端下载变更
   * @param processedDocIds 已在上传阶段处理过的文档 ID 集合
   */
  async downloadRemoteChanges(processedDocIds = /* @__PURE__ */ new Set()) {
    const remoteFiles = await this.webdavClient.listRemoteDocsWithMeta();
    const lastSyncTime = await this.getLastSyncTime();
    console.log("[Sync] lastSyncTime", lastSyncTime);
    const remoteDocIds = remoteFiles.filter((file) => file.lastModified > lastSyncTime && !processedDocIds.has(file.docId)).map((file) => file.docId);
    if (remoteDocIds.length === 0) {
      console.log("[Sync] 云端没有新变更");
      return { count: 0, errors: 0 };
    }
    console.log(`[Sync] 云端有 ${remoteDocIds.length} 个文档需要下载`);
    let downloaded = 0;
    let errors = 0;
    for (const docId of remoteDocIds) {
      try {
        const remoteDoc = await this.webdavClient.downloadDoc(docId);
        if (!remoteDoc) continue;
        const localDoc = await this.db.promises.get(docId);
        if (!localDoc) {
          remoteDoc._cloudSynced = true;
          await this.updateDocSyncStatus(docId, remoteDoc, true);
          downloaded++;
          console.log(`[Sync] 下载新文档: ${docId}`);
          continue;
        }
        if (remoteDoc._lastModified > (localDoc._lastModified || 0)) {
          const meta = await this.db.promises.getSyncMeta(docId);
          if (meta && meta._cloudSynced === false) {
            const winner = (meta._lastModified || 0) > remoteDoc._lastModified ? localDoc : remoteDoc;
            winner._cloudSynced = true;
            await this.updateDocSyncStatus(docId, winner);
            console.log(
              `[Sync] 下载阶段冲突已解决: ${docId}, 胜出: ${winner === localDoc ? "本地" : "云端"}`
            );
          } else {
            remoteDoc._cloudSynced = true;
            await this.updateDocSyncStatus(docId, remoteDoc);
            console.log(`[Sync] 下载更新: ${docId}`);
          }
          downloaded++;
        }
      } catch (error) {
        console.error(`[Sync] 下载失败: ${docId}`, error);
        errors++;
      }
    }
    return { count: downloaded, errors };
  }
  /**
   * 获取所有未同步的文档
   */
  async getUnsyncedDocs() {
    const syncPrefixes = ["ZTOOLS/settings-general", "PLUGIN/"];
    const unsyncedDocs = [];
    const seenIds = /* @__PURE__ */ new Set();
    for (const prefix of syncPrefixes) {
      const docs = await this.db.promises.allDocs(prefix);
      for (const doc of docs) {
        if (seenIds.has(doc._id)) {
          continue;
        }
        const meta = await this.db.promises.getSyncMeta(doc._id);
        if (!meta || meta._cloudSynced !== true) {
          doc._lastModified = meta?._lastModified || Date.now();
          doc._cloudSynced = meta?._cloudSynced || false;
          unsyncedDocs.push(doc);
          seenIds.add(doc._id);
        }
      }
    }
    return unsyncedDocs;
  }
  /**
   * 下载云端附件变更
   */
  async downloadRemoteAttachments() {
    console.log("[Sync] 开始扫描云端附件...");
    try {
      const remoteAttachments = await this.webdavClient.listRemoteAttachments();
      if (remoteAttachments.length === 0) {
        console.log("[Sync] 云端没有附件");
        return { count: 0, errors: 0 };
      }
      console.log(`[Sync] 云端共有 ${remoteAttachments.length} 个附件`);
      let downloaded = 0;
      let errors = 0;
      for (const attachmentId of remoteAttachments) {
        try {
          const localAttachment = await this.db.promises.getAttachment(attachmentId);
          if (localAttachment) {
            console.log(`[Sync] 本地已有附件，跳过: ${attachmentId}`);
            continue;
          }
          const result = await this.webdavClient.downloadAttachment(attachmentId);
          if (!result) {
            console.warn(`[Sync] 无法下载附件: ${attachmentId}`);
            continue;
          }
          const { data: attachment, metadata: cloudMetadata } = result;
          console.log(`[Sync] 下载附件: ${attachmentId}, 大小: ${attachment.length} 字节`);
          const mimeType = cloudMetadata?.type || "application/octet-stream";
          const saveResult = await this.db.promises.postAttachment(
            attachmentId,
            attachment,
            mimeType
          );
          if (saveResult.ok) {
            const attachmentDb = this.db.getAttachmentDb();
            const env = this.db.env;
            env.transactionSync(() => {
              const extKey = `attachment-ext:${attachmentId}`;
              const existingData = attachmentDb.get(extKey);
              let metadata = {};
              if (existingData) {
                try {
                  metadata = JSON.parse(existingData);
                } catch {
                }
              }
              if (cloudMetadata) {
                metadata = { ...metadata, ...cloudMetadata };
              }
              metadata._cloudSynced = true;
              metadata._lastModified = Date.now();
              attachmentDb.putSync(extKey, JSON.stringify(metadata));
            });
            downloaded++;
            console.log(`[Sync] 附件下载成功: ${attachmentId}`);
          } else {
            console.error(`[Sync] 附件保存失败: ${attachmentId}, 错误: ${saveResult.error}`);
            errors++;
          }
        } catch (error) {
          console.error(`[Sync] 附件下载失败: ${attachmentId}`, error);
          errors++;
        }
      }
      return { count: downloaded, errors };
    } catch (error) {
      console.error("[Sync] 扫描云端附件失败:", error);
      return { count: 0, errors: 1 };
    }
  }
  /**
   * 检测冲突
   */
  hasConflict(localDoc, remoteDoc) {
    return localDoc._cloudSynced === false && remoteDoc._lastModified > (localDoc._lastModified || 0);
  }
  /**
   * 获取最后同步时间
   */
  async getLastSyncTime() {
    const config = await this.loadSyncConfig();
    return config?.lastSyncTime || 0;
  }
  /**
   * 更新最后同步时间
   */
  async updateLastSyncTime() {
    const config = await this.loadSyncConfig();
    if (config) {
      config.lastSyncTime = Date.now();
      await this.saveSyncConfig(config);
    }
  }
  /**
   * 直接更新文档的同步状态（使用 metaDb）
   * 注意：不修改文档内容，只更新元数据
   * @param docId 文档 ID
   * @param doc 文档对象（如果需要创建文档）
   * @param createIfNotExists 如果文档不存在，是否创建
   */
  async updateDocSyncStatus(docId, doc, createIfNotExists = false) {
    const mainDb = this.db.mainDb;
    const metaDb = this.db.metaDb;
    const env = this.db.env;
    env.transactionSync(() => {
      const existingDoc = mainDb.get(docId);
      if (!existingDoc && !createIfNotExists) {
        console.warn(`[Sync] updateDocSyncStatus: 文档不存在 ${docId}`);
        return;
      }
      if (doc) {
        const { _cloudSynced, _lastModified, ...docWithoutSyncFields } = doc;
        mainDb.putSync(docId, JSON.stringify(docWithoutSyncFields));
      }
      const existingMetaStr = metaDb.get(docId);
      let meta;
      if (existingMetaStr) {
        if (existingMetaStr.startsWith("{")) {
          meta = JSON.parse(existingMetaStr);
        } else {
          meta = { _rev: existingMetaStr };
        }
        if (doc._rev) {
          meta._rev = doc._rev;
        }
        if (doc._lastModified) {
          meta._lastModified = doc._lastModified;
        }
      } else {
        meta = {
          _rev: doc._rev || "1-" + Math.random().toString(36).substring(2, 15),
          _lastModified: doc._lastModified || Date.now()
        };
      }
      meta._cloudSynced = true;
      metaDb.putSync(docId, JSON.stringify(meta));
    });
  }
  // ==================== 插件文件同步 ====================
  /**
   * 同步插件文件
   */
  async syncPlugins(config) {
    console.log("[Sync] 开始插件文件同步...");
    let pluginsUploaded = 0;
    let pluginsDownloaded = 0;
    let pluginsDeleted = 0;
    let errors = 0;
    try {
      pluginSyncWatcher.pause();
      const dirtyPlugins = pluginSyncWatcher.getDirtyPlugins();
      const hashRecords = loadHashRecords();
      for (const pluginName of dirtyPlugins) {
        try {
          const pluginDir = path.join(PLUGIN_DIR, pluginName);
          if (!fs.existsSync(pluginDir)) {
            delete hashRecords[pluginName];
            const zipPath2 = getZipPath(pluginName);
            if (fs.existsSync(zipPath2)) {
              fs.unlinkSync(zipPath2);
            }
            pluginSyncWatcher.clearDirty(pluginName);
            continue;
          }
          const newHash = computePluginHash(pluginDir);
          const pluginJsonPath = path.join(pluginDir, "plugin.json");
          let version = "0.0.0";
          if (fs.existsSync(pluginJsonPath)) {
            try {
              const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
              version = pluginJson.version || "0.0.0";
            } catch {
            }
          }
          const existingRecord = hashRecords[pluginName];
          const zipPath = getZipPath(pluginName);
          if (existingRecord?.hash === newHash && fs.existsSync(zipPath)) {
            pluginSyncWatcher.clearDirty(pluginName);
            continue;
          }
          console.log(`[Sync] 压缩插件: ${pluginName}`);
          const zip = new AdmZip();
          zip.addLocalFolder(pluginDir);
          zip.writeZip(zipPath);
          hashRecords[pluginName] = {
            hash: newHash,
            version,
            lastSyncTime: Date.now()
          };
          pluginSyncWatcher.clearDirty(pluginName);
        } catch (error) {
          console.error(`[Sync] 处理脏插件失败: ${pluginName}`, error);
          errors++;
        }
      }
      const remoteManifest = await this.webdavClient.downloadPluginManifest();
      const deviceId = config.deviceId;
      for (const [pluginName, record] of Object.entries(hashRecords)) {
        try {
          const remoteEntry = remoteManifest[pluginName];
          if (!remoteEntry || remoteEntry.hash !== record.hash) {
            const zipPath = getZipPath(pluginName);
            if (!fs.existsSync(zipPath)) {
              console.warn(`[Sync] 插件 zip 不存在，跳过上传: ${pluginName}`);
              continue;
            }
            console.log(`[Sync] 上传插件: ${pluginName}`);
            const zipBuffer = fs.readFileSync(zipPath);
            await this.webdavClient.uploadPluginZip(pluginName, zipBuffer);
            remoteManifest[pluginName] = {
              hash: record.hash,
              version: record.version,
              lastModified: Date.now(),
              deviceId
            };
            pluginsUploaded++;
          }
        } catch (error) {
          console.error(`[Sync] 上传插件失败: ${pluginName}`, error);
          errors++;
        }
      }
      for (const [pluginName, entry] of Object.entries(remoteManifest)) {
        if (entry.deviceId === deviceId && !hashRecords[pluginName]) {
          try {
            console.log(`[Sync] 删除远端插件: ${pluginName}`);
            await this.webdavClient.deletePluginZip(pluginName);
            delete remoteManifest[pluginName];
            pluginsDeleted++;
          } catch (error) {
            console.error(`[Sync] 删除远端插件失败: ${pluginName}`, error);
            errors++;
          }
        }
      }
      for (const [pluginName, entry] of Object.entries(remoteManifest)) {
        try {
          const localRecord = hashRecords[pluginName];
          if (entry.deviceId === deviceId) continue;
          if (!localRecord || localRecord.hash !== entry.hash) {
            console.log(`[Sync] 下载插件: ${pluginName}`);
            const zipBuffer = await this.webdavClient.downloadPluginZip(pluginName);
            if (!zipBuffer) {
              console.warn(`[Sync] 远端插件 zip 不存在: ${pluginName}`);
              continue;
            }
            await this.installPluginFromSyncZip(pluginName, zipBuffer);
            hashRecords[pluginName] = {
              hash: entry.hash,
              version: entry.version,
              lastSyncTime: Date.now()
            };
            pluginsDownloaded++;
          }
        } catch (error) {
          console.error(`[Sync] 下载插件失败: ${pluginName}`, error);
          errors++;
        }
      }
      for (const pluginName of Object.keys(hashRecords)) {
        if (!remoteManifest[pluginName]) {
          const pluginDir = path.join(PLUGIN_DIR, pluginName);
          if (fs.existsSync(pluginDir)) {
            try {
              console.log(`[Sync] 本地卸载插件（远端已删除）: ${pluginName}`);
              await this.uninstallSyncedPlugin(pluginName);
              delete hashRecords[pluginName];
              pluginsDeleted++;
            } catch (error) {
              console.error(`[Sync] 本地卸载插件失败: ${pluginName}`, error);
              errors++;
            }
          }
        }
      }
      await this.webdavClient.uploadPluginManifest(remoteManifest);
      saveHashRecords(hashRecords);
    } catch (error) {
      console.error("[Sync] 插件同步失败:", error);
      errors++;
    } finally {
      pluginSyncWatcher.resume();
    }
    console.log(
      `[Sync] 插件同步完成: 上传 ${pluginsUploaded}, 下载 ${pluginsDownloaded}, 删除 ${pluginsDeleted}, 错误 ${errors}`
    );
    return { pluginsUploaded, pluginsDownloaded, pluginsDeleted, errors };
  }
  /**
   * 从同步下载的 zip 安装插件
   */
  async installPluginFromSyncZip(pluginName, zipBuffer) {
    const targetDir = path.join(PLUGIN_DIR, pluginName);
    if (!fs.existsSync(PLUGIN_DIR)) {
      fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    }
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(targetDir, true);
    const pluginJsonPath = path.join(targetDir, "plugin.json");
    if (!fs.existsSync(pluginJsonPath)) {
      console.warn(`[Sync] 安装的插件缺少 plugin.json: ${pluginName}`);
      return;
    }
    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
    const pluginsDoc = await this.db.promises.get("ZTOOLS/plugins");
    const plugins = pluginsDoc?.data ? JSON.parse(JSON.stringify(pluginsDoc.data)) : [];
    const existingIndex = plugins.findIndex((p) => p.name === pluginName);
    const pluginEntry = {
      name: pluginJson.name || pluginName,
      title: pluginJson.title || pluginJson.name || pluginName,
      path: targetDir,
      version: pluginJson.version || "0.0.0",
      description: pluginJson.description || "",
      logo: pluginJson.logo || "",
      features: pluginJson.features || [],
      isDevelopment: false
    };
    if (existingIndex >= 0) {
      plugins[existingIndex] = pluginEntry;
    } else {
      plugins.push(pluginEntry);
    }
    await this.db.promises.put({
      _id: "ZTOOLS/plugins",
      _rev: pluginsDoc?._rev,
      data: plugins
    });
    this.notifyPluginsChanged();
  }
  /**
   * 卸载通过同步安装的插件
   */
  async uninstallSyncedPlugin(pluginName) {
    const pluginDir = path.join(PLUGIN_DIR, pluginName);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    const pluginsDoc = await this.db.promises.get("ZTOOLS/plugins");
    if (pluginsDoc?.data) {
      const plugins = pluginsDoc.data.filter((p) => p.name !== pluginName);
      await this.db.promises.put({
        _id: "ZTOOLS/plugins",
        _rev: pluginsDoc._rev,
        data: plugins
      });
    }
    const zipPath = getZipPath(pluginName);
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    this.notifyPluginsChanged();
  }
  /**
   * 通知渲染进程插件列表已变更
   */
  notifyPluginsChanged() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("plugins-changed");
    }
  }
}
class PluginDeviceAPI {
  deviceId = null;
  init() {
    this.setupIPC();
  }
  /**
   * 公开方法：获取设备 ID（供其他模块使用）
   */
  getDeviceIdPublic() {
    return this.getDeviceId();
  }
  setupIPC() {
    electron.ipcMain.on("get-native-id", (event) => {
      try {
        const id = this.getDeviceId();
        event.returnValue = id;
      } catch (error) {
        console.error("[PluginDevice] get-native-id error:", error);
        event.returnValue = null;
      }
    });
    electron.ipcMain.on("get-app-version", (event) => {
      try {
        const version = electron.app.getVersion();
        event.returnValue = version;
      } catch (error) {
        console.error("[PluginDevice] get-app-version error:", error);
        event.returnValue = null;
      }
    });
  }
  /**
   * 获取设备 ID
   * 返回 32 位的唯一标识符字符串
   * 基于硬件 UUID 生成，确保卸载重装后 ID 一致
   */
  getDeviceId() {
    if (this.deviceId) {
      return this.deviceId;
    }
    try {
      const hardwareUUID = this.getHardwareUUID();
      this.deviceId = crypto.createHash("md5").update(hardwareUUID).digest("hex");
      return this.deviceId;
    } catch (error) {
      console.error("[PluginDevice] 获取设备 ID 失败:", error);
      const fallbackString = `${process.env.USER || "unknown"}-${os.hostname()}`;
      this.deviceId = crypto.createHash("md5").update(fallbackString).digest("hex");
      return this.deviceId;
    }
  }
  /**
   * 获取硬件 UUID
   * 跨平台支持：macOS、Windows、Linux
   */
  getHardwareUUID() {
    const platform2 = process.platform;
    try {
      if (platform2 === "darwin") {
        const output = child_process.execSync(
          `ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID | awk '{print $3}' | tr -d '"'`,
          { encoding: "utf8" }
        );
        return output.trim();
      } else if (platform2 === "win32") {
        const output = child_process.execSync(
          'powershell -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
          { encoding: "utf8" }
        );
        const uuid2 = output.trim();
        if (uuid2) {
          return uuid2;
        }
        throw new Error("未找到 UUID");
      } else if (platform2 === "linux") {
        try {
          const output = child_process.execSync("cat /etc/machine-id", { encoding: "utf8" });
          return output.trim();
        } catch {
          const output = child_process.execSync("cat /var/lib/dbus/machine-id", { encoding: "utf8" });
          return output.trim();
        }
      }
      throw new Error(`不支持的平台: ${platform2}`);
    } catch (error) {
      console.error("[PluginDevice] 获取硬件 UUID 失败:", error);
      throw error;
    }
  }
}
const pluginDeviceAPI = new PluginDeviceAPI();
class SyncAPI {
  syncEngine = null;
  init(mainWindow) {
    this.syncEngine = new SyncEngine(lmdbInstance);
    if (mainWindow) {
      this.syncEngine.setMainWindow(mainWindow);
    }
    this.setupIPC();
    this.syncEngine.init().catch((error) => {
      console.error("[Sync API] 初始化失败:", error);
    });
  }
  setupIPC() {
    electron.ipcMain.handle("sync:test-connection", async (_event, config) => {
      try {
        const client = new WebDAVSyncClient();
        await client.init(config);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    electron.ipcMain.handle("sync:save-config", async (_event, config) => {
      try {
        if (!config.deviceId) {
          config.deviceId = pluginDeviceAPI.getDeviceIdPublic();
        }
        if (config.password && electron.safeStorage.isEncryptionAvailable()) {
          const encrypted = electron.safeStorage.encryptString(config.password);
          config.password = encrypted.toString("base64");
        }
        await this.syncEngine.saveSyncConfig(config);
        if (config.enabled) {
          await this.syncEngine.init();
        } else {
          this.syncEngine.stopAutoSync();
        }
        if (config.enabled && config.syncPlugins) {
          pluginSyncWatcher.start();
        } else {
          pluginSyncWatcher.stop();
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    electron.ipcMain.handle("sync:get-config", async () => {
      try {
        const doc = await lmdbInstance.promises.get("SYNC/config");
        if (!doc?.data) {
          return { success: true, config: null };
        }
        const config = doc.data;
        if (config.password && electron.safeStorage.isEncryptionAvailable()) {
          try {
            const buffer = Buffer.from(config.password, "base64");
            config.password = electron.safeStorage.decryptString(buffer);
          } catch (error) {
            console.error("[Sync API] 解密密码失败:", error);
          }
        }
        return { success: true, config };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    electron.ipcMain.handle("sync:perform-sync", async () => {
      try {
        const result = await this.syncEngine.performSync();
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    electron.ipcMain.handle("sync:force-download-from-cloud", async () => {
      try {
        const result = await this.syncEngine.forceDownloadFromCloud();
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    electron.ipcMain.handle("sync:stop-auto-sync", async () => {
      try {
        this.syncEngine.stopAutoSync();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    electron.ipcMain.handle("sync:get-unsynced-count", async () => {
      try {
        const syncPrefixes = ["ZTOOLS/settings-general", "PLUGIN/"];
        let count = 0;
        for (const prefix of syncPrefixes) {
          const docs = await lmdbInstance.promises.allDocs(prefix);
          for (const doc of docs) {
            const meta = await lmdbInstance.promises.getSyncMeta(doc._id);
            if (!meta || meta._cloudSynced !== true) {
              count++;
            }
          }
        }
        return { success: true, count };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }
}
const syncAPI = new SyncAPI();
const execAsync = util.promisify(child_process.exec);
class AppleScriptHelper {
  /**
   * 执行 AppleScript 脚本
   * @param script AppleScript 脚本内容
   * @returns 脚本执行结果
   */
  async execute(script) {
    try {
      const escapedScript = script.replace(/'/g, "'\\''");
      const { stdout } = await execAsync(`osascript -e '${escapedScript}'`);
      return stdout.trim();
    } catch (error) {
      console.error("[AppleScript] 执行 AppleScript 失败:", error);
      throw error;
    }
  }
  /**
   * 获取访达（Finder）当前打开的路径
   * @returns 访达当前路径，如果访达未激活或没有打开窗口则返回 null
   */
  async getFinderPath() {
    try {
      const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
        end tell

        if frontApp is "Finder" then
          tell application "Finder"
            if (count of windows) > 0 then
              return POSIX path of (target of front window as alias)
            else
              return ""
            end if
          end tell
        else
          return ""
        end if
      `;
      const result = await this.execute(script);
      return result || null;
    } catch (error) {
      console.error("[AppleScript] 获取访达路径失败:", error);
      return null;
    }
  }
  /**
   * 获取当前激活的应用程序信息
   * @returns 当前激活应用的信息对象
   */
  async getFrontmostApp() {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp

          -- 获取 Bundle Identifier
          set appBundleId to bundle identifier of frontApp

          -- 获取应用路径
          tell application "Finder"
            set appPath to POSIX path of (application file id appBundleId as alias)
          end tell

          return appName & "|" & appBundleId & "|" & appPath
        end tell
      `;
      const result = await this.execute(script);
      if (result) {
        const [name, bundleId, path2] = result.split("|");
        return { name, bundleId, path: path2 };
      }
      return null;
    } catch (error) {
      console.error("[AppleScript] 获取当前激活应用失败:", error);
      return null;
    }
  }
  /**
   * 获取当前激活应用的名称（简化版）
   * @returns 应用名称
   */
  async getFrontmostAppName() {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          return name of frontApp
        end tell
      `;
      const result = await this.execute(script);
      return result || null;
    } catch (error) {
      console.error("[AppleScript] 获取当前激活应用名称失败:", error);
      return null;
    }
  }
  /**
   * 激活指定的应用程序（通过应用名称）
   * @param appName 应用程序名称（例如：Safari, Chrome, Finder）
   * @returns 是否成功激活
   */
  async activateAppByName(appName) {
    try {
      const script = `
        tell application "${appName}"
          activate
        end tell
      `;
      await this.execute(script);
      return true;
    } catch (error) {
      console.error(`[AppleScript] 激活应用 ${appName} 失败:`, error);
      return false;
    }
  }
  /**
   * 激活指定的应用程序（通过 Bundle ID）
   * @param bundleId Bundle Identifier（例如：com.apple.Safari）
   * @returns 是否成功激活
   */
  async activateAppByBundleId(bundleId) {
    try {
      const script = `
        tell application id "${bundleId}"
          activate
        end tell
      `;
      await this.execute(script);
      return true;
    } catch (error) {
      console.error(`[AppleScript] 激活应用 ${bundleId} 失败:`, error);
      return false;
    }
  }
  /**
   * 激活指定的应用程序（通过应用路径）
   * @param appPath 应用程序路径（例如：/Applications/Safari.app）
   * @returns 是否成功激活
   */
  async activateAppByPath(appPath) {
    try {
      const script = `
        tell application "${appPath}"
          activate
        end tell
      `;
      await this.execute(script);
      return true;
    } catch (error) {
      console.error(`[AppleScript] 激活应用 ${appPath} 失败:`, error);
      return false;
    }
  }
  /**
   * 在终端中打开指定路径
   * @param path 要打开的路径
   * @returns 是否成功打开
   */
  async openInTerminal(path2) {
    try {
      const escapedPath = path2.replace(/'/g, "'\\''");
      const script = `
        tell application "Terminal"
          activate
          do script "cd '${escapedPath}'"
        end tell
      `;
      await this.execute(script);
      return true;
    } catch (error) {
      console.error("[AppleScript] 在终端打开路径失败:", error);
      return false;
    }
  }
  /**
   * 显示系统通知
   * @param title 通知标题
   * @param message 通知内容
   * @param subtitle 通知副标题（可选）
   * @returns 是否成功显示
   */
  async showNotification(title, message, subtitle) {
    try {
      const subtitlePart = subtitle ? `subtitle "${subtitle}"` : "";
      const script = `
        display notification "${message}" with title "${title}" ${subtitlePart}
      `;
      await this.execute(script);
      return true;
    } catch (error) {
      console.error("[AppleScript] 显示通知失败:", error);
      return false;
    }
  }
  /**
   * 获取所有运行中的应用程序列表
   * @returns 运行中的应用程序名称数组
   */
  async getRunningApps() {
    try {
      const script = `
        tell application "System Events"
          set appList to name of every application process
          return appList as text
        end tell
      `;
      const result = await this.execute(script);
      if (result) {
        return result.split(", ").filter((name) => name.trim());
      }
      return [];
    } catch (error) {
      console.error("[AppleScript] 获取运行中应用列表失败:", error);
      return [];
    }
  }
  /**
   * 检查指定应用是否正在运行
   * @param appName 应用程序名称
   * @returns 是否正在运行
   */
  async isAppRunning(appName) {
    try {
      const script = `
        tell application "System Events"
          set isRunning to (name of processes) contains "${appName}"
          return isRunning
        end tell
      `;
      const result = await this.execute(script);
      return result === "true";
    } catch (error) {
      console.error(`[AppleScript] 检查应用 ${appName} 运行状态失败:`, error);
      return false;
    }
  }
  /**
   * 退出指定应用程序
   * @param appName 应用程序名称
   * @returns 是否成功退出
   */
  async quitApp(appName) {
    try {
      const script = `
        tell application "${appName}"
          quit
        end tell
      `;
      await this.execute(script);
      return true;
    } catch (error) {
      console.error(`[AppleScript] 退出应用 ${appName} 失败:`, error);
      return false;
    }
  }
  /**
   * 隐藏指定应用程序
   * @param appName 应用程序名称
   * @returns 是否成功隐藏
   */
  async hideApp(appName) {
    try {
      const script = `
        tell application "System Events"
          set visible of process "${appName}" to false
        end tell
      `;
      await this.execute(script);
      return true;
    } catch (error) {
      console.error(`[AppleScript] 隐藏应用 ${appName} 失败:`, error);
      return false;
    }
  }
  /**
   * 执行粘贴操作（模拟 Command+V）
   * @returns 是否成功执行粘贴
   */
  async paste() {
    try {
      const script = `
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `;
      await this.execute(script);
      console.log("[AppleScript] 已执行粘贴操作 (Command+V)");
      return true;
    } catch (error) {
      console.error("[AppleScript] 执行粘贴操作失败:", error);
      return false;
    }
  }
}
const appleScriptHelper = new AppleScriptHelper();
const AVATAR_DIR = path.join(electron.app.getPath("userData"), "avatar");
class SystemAPI {
  mainWindow = null;
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle("open-external", (_event, url2) => this.openExternal(url2));
    electron.ipcMain.handle("copy-to-clipboard", (_event, text) => this.copyToClipboard(text));
    electron.ipcMain.handle("open-terminal", (_event, path2) => this.openTerminal(path2));
    electron.ipcMain.handle("get-finder-path", () => this.getFinderPath());
    electron.ipcMain.handle(
      "get-last-copied-content",
      (_event, timeLimit) => this.getLastCopiedContent(timeLimit)
    );
    electron.ipcMain.handle("get-frontmost-app", () => this.getFrontmostApp());
    electron.ipcMain.handle(
      "activate-app",
      (_event, identifier, type) => this.activateApp(identifier, type)
    );
    electron.ipcMain.handle("reveal-in-finder", (_event, filePath) => this.revealInFinder(filePath));
    electron.ipcMain.handle("check-file-paths", (_event, paths) => this.checkFilePaths(paths));
    electron.ipcMain.handle(
      "show-context-menu",
      (event, menuItems) => this.showContextMenu(event, menuItems)
    );
    electron.ipcMain.handle("select-avatar", () => this.selectAvatar());
    electron.ipcMain.handle("get-app-version", () => electron.app.getVersion());
    electron.ipcMain.handle("get-app-name", () => electron.app.getName());
    electron.ipcMain.handle("get-system-versions", () => process.versions);
    electron.ipcMain.on("get-platform", (event) => {
      event.returnValue = process.platform;
    });
    electron.ipcMain.handle("is-windows11", () => isWindows11());
  }
  async openExternal(url2) {
    try {
      await electron.shell.openExternal(url2);
    } catch (error) {
      console.error("[System] 打开外部链接失败:", error);
      throw error;
    }
  }
  async copyToClipboard(text) {
    try {
      electron.clipboard.writeText(text);
    } catch (error) {
      console.error("[System] 复制到剪贴板失败:", error);
      throw error;
    }
  }
  async openTerminal(path2) {
    try {
      await appleScriptHelper.openInTerminal(path2);
    } catch (error) {
      console.error("[System] 在终端打开失败:", error);
      throw error;
    }
  }
  async getFinderPath() {
    try {
      return await appleScriptHelper.getFinderPath();
    } catch (error) {
      console.error("[System] 获取访达路径失败:", error);
      return null;
    }
  }
  async getLastCopiedContent(timeLimit) {
    try {
      return await clipboardManager.getLastCopiedContent(timeLimit);
    } catch (error) {
      console.error("[System] 获取最后复制内容失败:", error);
      return null;
    }
  }
  async getFrontmostApp() {
    try {
      return await appleScriptHelper.getFrontmostApp();
    } catch (error) {
      console.error("[System] 获取当前激活应用失败:", error);
      return null;
    }
  }
  async activateApp(identifier, type = "name") {
    try {
      let result = false;
      switch (type) {
        case "bundleId":
          result = await appleScriptHelper.activateAppByBundleId(identifier);
          break;
        case "path":
          result = await appleScriptHelper.activateAppByPath(identifier);
          break;
        case "name":
        default:
          result = await appleScriptHelper.activateAppByName(identifier);
          break;
      }
      if (result) {
        return { success: true };
      } else {
        return { success: false, error: "激活应用失败" };
      }
    } catch (error) {
      console.error("[System] 激活应用失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  /**
   * 在文件管理器中显示文件位置（跨平台）
   * macOS: 在 Finder 中显示并选中文件
   * Windows: 在资源管理器中显示并选中文件
   * Linux: 在文件管理器中显示并选中文件
   *
   * Electron 的 shell.showItemInFolder() 是跨平台的 API，
   * 会自动根据操作系统选择相应的文件管理器
   */
  async revealInFinder(filePath) {
    try {
      if (!filePath) {
        throw new Error("文件路径不能为空");
      }
      electron.shell.showItemInFolder(filePath);
    } catch (error) {
      const platformName = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";
      console.error(`[System] 在${platformName}文件管理器中显示文件失败:`, error);
      throw error;
    }
  }
  async showContextMenu(event, menuItems) {
    if (!this.mainWindow) return;
    const senderWebContents = event.sender;
    const buildTemplate = (items, senderWebContents2) => {
      return items.map((item) => {
        const menuItem = {
          label: item.label
        };
        if (item.submenu) {
          menuItem.submenu = buildTemplate(item.submenu, senderWebContents2);
        } else {
          menuItem.click = () => {
            senderWebContents2.send("context-menu-command", item.id);
          };
        }
        if (item.type === "checkbox") {
          menuItem.type = "checkbox";
          menuItem.checked = item.checked || false;
        }
        return menuItem;
      });
    };
    const template = buildTemplate(menuItems, senderWebContents);
    const menu = electron.Menu.buildFromTemplate(template);
    menu.popup({ window: this.mainWindow });
  }
  async selectAvatar() {
    try {
      const result = await openDialog(
        this.mainWindow,
        {
          title: "选择头像图片",
          filters: [{ name: "图片文件", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
          properties: ["openFile"]
        },
        "未选择文件"
      );
      if (!result.success) {
        return result;
      }
      const originalPath = result.data.filePaths[0];
      const ext = path.extname(originalPath);
      const fileName = `avatar${ext}`;
      await fs.promises.mkdir(AVATAR_DIR, { recursive: true });
      const avatarPath = path.join(AVATAR_DIR, fileName);
      await fs.promises.copyFile(originalPath, avatarPath);
      return { success: true, path: url.pathToFileURL(avatarPath).href };
    } catch (error) {
      console.error("[System] 选择头像失败:", error);
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    }
  }
  async checkFilePaths(paths) {
    try {
      const results = await Promise.all(
        paths.map(async (filePath) => {
          try {
            const stats = await fs.promises.stat(filePath);
            const result = {
              path: filePath,
              isDirectory: stats.isDirectory(),
              exists: true
            };
            return result;
          } catch (error) {
            console.log("[System] 主进程：文件不存在或无权访问:", filePath, error);
            return {
              path: filePath,
              isDirectory: false,
              exists: false
            };
          }
        })
      );
      return results;
    } catch (error) {
      console.error("[System] 主进程：检查文件路径失败:", error);
      return [];
    }
  }
}
const systemAPI = new SystemAPI();
class WindowAPI {
  mainWindow = null;
  lockedSize = null;
  currentAssemblyTarget = null;
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupIPC();
    this.setupWindowEvents();
  }
  setupIPC() {
    electron.ipcMain.on("hide-window", () => this.hideWindow());
    electron.ipcMain.on("resize-window", (_event, height) => this.resizeWindow(height));
    electron.ipcMain.on("update-launch-context", (_event, context) => this.updateLaunchContext(context));
    electron.ipcMain.handle("get-window-position", () => this.getWindowPosition());
    electron.ipcMain.handle("get-window-material", () => this.getWindowMaterial());
    electron.ipcMain.on(
      "set-window-position",
      (_event, x, y) => this.setWindowPosition(x, y)
    );
    electron.ipcMain.on("set-window-size-lock", (_event, lock) => {
      if (!this.mainWindow) return;
      if (lock) {
        const [, height] = this.mainWindow.getSize();
        this.lockedSize = { width: WINDOW_WIDTH, height };
      } else {
        if (this.lockedSize) {
          const [currentX, currentY] = this.mainWindow.getPosition();
          const [, height] = this.mainWindow.getSize();
          if (WINDOW_WIDTH !== this.lockedSize.width || height !== this.lockedSize.height) {
            this.mainWindow.setBounds({
              x: currentX,
              y: currentY,
              width: this.lockedSize.width,
              height: this.lockedSize.height
            });
          }
          this.lockedSize = null;
        }
      }
    });
    electron.ipcMain.on("set-window-opacity", (_event, opacity) => this.setWindowOpacity(opacity));
    electron.ipcMain.handle(
      "set-tray-icon-visible",
      (_event, visible) => this.setTrayIconVisible(visible)
    );
    electron.ipcMain.handle("set-assembly-target", (_event, token) => {
      this.currentAssemblyTarget = token;
      return true;
    });
    electron.ipcMain.handle("end-assembly-plugin", () => {
      return this.currentAssemblyTarget;
    });
    electron.ipcMain.on("open-settings", () => this.openSettings());
  }
  setupWindowEvents() {
    let moveTimeout = null;
    this.mainWindow?.on("move", () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      moveTimeout = setTimeout(() => {
        if (this.mainWindow) {
          const [x, y] = this.mainWindow.getPosition();
          const displayId = windowManager.getCurrentDisplayId();
          if (displayId !== null) {
            windowManager.saveWindowPosition(displayId, x, y);
          }
        }
      }, 500);
    });
  }
  hideWindow(isRestorePreWindow = true) {
    windowManager.hideWindow(isRestorePreWindow);
  }
  resizeWindow(height) {
    if (this.mainWindow) {
      const width = WINDOW_WIDTH;
      const display = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint());
      const maxHeight = display.workAreaSize.height;
      const newHeight = Math.max(WINDOW_INITIAL_HEIGHT, Math.min(height, maxHeight));
      this.mainWindow.setBounds({
        width,
        height: newHeight
      });
      if (this.lockedSize) {
        this.lockedSize = { width, height: newHeight };
        console.log("[WindowAPI] 更新锁定尺寸:", this.lockedSize);
      }
    }
  }
  getWindowPosition() {
    if (this.mainWindow) {
      const [x, y] = this.mainWindow.getPosition();
      return { x, y };
    }
    return { x: 0, y: 0 };
  }
  setWindowPosition(x, y) {
    if (this.mainWindow && this.lockedSize) {
      this.mainWindow.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: this.lockedSize.width,
        height: this.lockedSize.height
      });
    } else if (this.mainWindow) {
      this.mainWindow.setPosition(x, y);
    }
  }
  setWindowOpacity(opacity) {
    if (this.mainWindow) {
      const clampedOpacity = Math.max(0.3, Math.min(1, opacity));
      this.mainWindow.setOpacity(clampedOpacity);
      console.log("[WindowAPI] 设置窗口不透明度:", clampedOpacity);
    }
  }
  setTrayIconVisible(visible) {
    windowManager.setTrayIconVisible(visible);
    console.log("[WindowAPI] 设置托盘图标可见性:", visible);
  }
  setWindowMaterial(material) {
    const result = windowManager.setWindowMaterial(material);
    console.log("[WindowAPI] 设置窗口材质:", material, "结果:", result);
    return result;
  }
  async getWindowMaterial() {
    const material = await windowManager.getWindowMaterial();
    return material;
  }
  openSettings() {
    windowManager.showSettings();
    console.log("[WindowAPI] 打开设置插件");
  }
  /**
   * 更新主窗口当前输入上下文，供应用快捷键启动时复用
   */
  updateLaunchContext(context) {
    windowManager.updateAppShortcutLaunchContext(context || {});
  }
  async updateAutoBackToSearch(autoBackToSearch) {
    await windowManager.updateAutoBackToSearch(autoBackToSearch);
    console.log("[WindowAPI] 更新自动返回搜索配置:", autoBackToSearch);
  }
}
const windowAPI = new WindowAPI();
const MAX_TOOL_ROUNDS = 25;
class PluginAiAPI {
  pluginManager = null;
  mainWindow = null;
  abortControllers = /* @__PURE__ */ new Map();
  init(mainWindow, pluginManager2) {
    this.mainWindow = mainWindow;
    this.pluginManager = pluginManager2;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle("plugin:ai-call", async (event, requestId, option) => {
      try {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) {
          return { success: false, error: "无法获取插件信息" };
        }
        return await this.callAI(option, requestId, event.sender);
      } catch (error) {
        console.error("[AI] AI 调用失败:", error);
        this.notifyAiStatus("idle", event.sender);
        return { success: false, error: error instanceof Error ? error.message : "未知错误" };
      }
    });
    electron.ipcMain.handle("plugin:ai-call-stream", async (event, requestId, option) => {
      try {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) {
          return { success: false, error: "无法获取插件信息" };
        }
        await this.callAIStream(option, requestId, event.sender, (chunk) => {
          event.sender.send(`plugin:ai-stream-${requestId}`, chunk);
        });
        return { success: true };
      } catch (error) {
        console.error("[AI] AI 流式调用失败:", error);
        this.notifyAiStatus("idle", event.sender);
        return { success: false, error: error instanceof Error ? error.message : "未知错误" };
      }
    });
    electron.ipcMain.handle("plugin:ai-abort", async (_event, requestId) => {
      try {
        this.abortAICall(requestId);
        return { success: true };
      } catch (error) {
        console.error("[AI] 中止 AI 调用失败:", error);
        return { success: false, error: error instanceof Error ? error.message : "未知错误" };
      }
    });
    electron.ipcMain.handle("plugin:ai-all-models", async () => {
      try {
        const models = await this.getAllAiModels();
        return { success: true, data: models };
      } catch (error) {
        console.error("[AI] 获取 AI 模型列表失败:", error);
        return { success: false, error: error instanceof Error ? error.message : "未知错误" };
      }
    });
    electron.ipcMain.handle("plugin:ai-call-function", async (event, functionName, args) => {
      try {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) {
          return { success: false, error: "无法获取插件信息" };
        }
        const result = await event.sender.executeJavaScript(`
          (async () => {
            if (typeof window.${functionName} === 'function') {
              const args = ${args};
              return await window.${functionName}(args);
            } else {
              throw new Error('函数 ${functionName} 不存在');
            }
          })()
        `);
        return { success: true, data: result };
      } catch (error) {
        console.error("[AI] 调用插件函数失败:", error);
        return { success: false, error: error instanceof Error ? error.message : "未知错误" };
      }
    });
  }
  notifyAiStatus(status, webContents) {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(webContents);
    if (!pluginInfo) return;
    const detachedWindows = detachedWindowManager.getAllWindows();
    for (const windowInfo of detachedWindows) {
      if (windowInfo.view.webContents === webContents) {
        if (windowInfo.window && !windowInfo.window.isDestroyed()) {
          windowInfo.window.webContents.send("ai-status-changed", status);
        }
        return;
      }
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("ai-status-changed", status);
    }
  }
  async getAllAiModels() {
    try {
      const doc = await lmdbInstance.promises.get("ZTOOLS/ai-models");
      if (doc?.data && Array.isArray(doc.data)) {
        return doc.data.map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description || "",
          icon: m.icon || "",
          cost: m.cost || 0
        }));
      }
      return [];
    } catch {
      return [];
    }
  }
  async getModelConfig(modelId) {
    try {
      const doc = await lmdbInstance.promises.get("ZTOOLS/ai-models");
      if (doc?.data && Array.isArray(doc.data)) {
        const models = doc.data;
        return modelId ? models.find((m) => m.id === modelId) || null : models[0] || null;
      }
      return null;
    } catch {
      return null;
    }
  }
  createClient(modelConfig) {
    return new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.apiUrl
    });
  }
  /**
   * 将 Message[] 转为 OpenAI SDK 格式
   * 关键：保留 assistant 消息的 reasoning_content，解决 DeepSeek thinking mode 报错
   */
  convertMessages(messages) {
    return messages.map((msg) => {
      if (msg.role === "assistant") {
        const assistantMsg = {
          role: "assistant",
          content: msg.content || ""
        };
        if (msg.reasoning_content) {
          assistantMsg.reasoning_content = msg.reasoning_content;
        }
        if (msg.tool_calls?.length) {
          assistantMsg.tool_calls = msg.tool_calls;
        }
        return assistantMsg;
      }
      if (msg.role === "tool") {
        return {
          role: "tool",
          content: (typeof msg.content === "string" ? msg.content : "") || "",
          tool_call_id: msg.tool_call_id || ""
        };
      }
      if (msg.role === "user" && Array.isArray(msg.content)) {
        return {
          role: "user",
          content: msg.content
        };
      }
      return {
        role: msg.role,
        content: (typeof msg.content === "string" ? msg.content : "") || ""
      };
    });
  }
  convertTools(tools) {
    return tools.filter((t) => t.function).map((t) => ({
      type: "function",
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }
    }));
  }
  async executeToolCall(toolCall, webContents) {
    try {
      const fnName = toolCall.function.name;
      const argsStr = toolCall.function.arguments;
      const result = await webContents.executeJavaScript(`
        (async () => {
          if (typeof window.${fnName} === 'function') {
            const args = ${argsStr};
            return await window.${fnName}(args);
          } else {
            throw new Error('函数 ${fnName} 不存在');
          }
        })()
      `);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        error: `工具执行失败: ${error instanceof Error ? error.message : "未知错误"}`
      });
    }
  }
  /**
   * 非流式调用 AI，自动处理工具调用循环
   */
  async callAI(option, requestId, webContents) {
    const modelConfig = await this.getModelConfig(option.model);
    if (!modelConfig) {
      return { success: false, error: "未找到 AI 模型配置，请先在设置中添加模型" };
    }
    const abortController = new AbortController();
    this.abortControllers.set(requestId, abortController);
    try {
      this.notifyAiStatus("sending", webContents);
      const client = this.createClient(modelConfig);
      const openaiTools = option.tools?.length ? this.convertTools(option.tools) : void 0;
      const messages = [...option.messages];
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.notifyAiStatus(round === 0 ? "sending" : "receiving", webContents);
        const response = await client.chat.completions.create(
          {
            model: modelConfig.id,
            messages: this.convertMessages(messages),
            ...openaiTools?.length ? { tools: openaiTools } : {}
          },
          { signal: abortController.signal }
        );
        const choice = response.choices[0];
        if (!choice) {
          this.notifyAiStatus("idle", webContents);
          return { success: true, data: { role: "assistant", content: "" } };
        }
        const assistantMsg = choice.message;
        const reasoningContent = assistantMsg.reasoning_content;
        if (!assistantMsg.tool_calls?.length) {
          this.notifyAiStatus("idle", webContents);
          return {
            success: true,
            data: {
              role: "assistant",
              content: assistantMsg.content || "",
              reasoning_content: reasoningContent
            }
          };
        }
        const fnToolCalls = assistantMsg.tool_calls.filter(
          (tc) => tc.type === "function"
        ).map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }));
        messages.push({
          role: "assistant",
          content: assistantMsg.content || "",
          reasoning_content: reasoningContent,
          tool_calls: fnToolCalls
        });
        for (const tc of fnToolCalls) {
          const result = await this.executeToolCall(tc, webContents);
          messages.push({ role: "tool", content: result, tool_call_id: tc.id });
        }
      }
      this.notifyAiStatus("idle", webContents);
      return { success: false, error: "工具调用轮次超过限制" };
    } catch (error) {
      this.notifyAiStatus("idle", webContents);
      if (error instanceof Error && error.name === "AbortError") {
        return { success: false, error: "AI 调用已中止" };
      }
      return { success: false, error: error instanceof Error ? error.message : "未知错误" };
    } finally {
      this.abortControllers.delete(requestId);
    }
  }
  /**
   * 流式调用 AI，自动处理工具调用循环
   * 流式过程中实时推送 content 和 reasoning_content 片段
   */
  async callAIStream(option, requestId, webContents, onChunk) {
    const modelConfig = await this.getModelConfig(option.model);
    if (!modelConfig) {
      throw new Error("未找到 AI 模型配置，请先在设置中添加模型");
    }
    const abortController = new AbortController();
    this.abortControllers.set(requestId, abortController);
    try {
      this.notifyAiStatus("sending", webContents);
      const client = this.createClient(modelConfig);
      const openaiTools = option.tools?.length ? this.convertTools(option.tools) : void 0;
      const messages = [...option.messages];
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.notifyAiStatus(round === 0 ? "sending" : "receiving", webContents);
        const stream = await client.chat.completions.create(
          {
            model: modelConfig.id,
            messages: this.convertMessages(messages),
            stream: true,
            ...openaiTools?.length ? { tools: openaiTools } : {}
          },
          { signal: abortController.signal }
        );
        let fullContent = "";
        let fullReasoning = "";
        const toolCalls = /* @__PURE__ */ new Map();
        this.notifyAiStatus("receiving", webContents);
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;
          const deltaAny = delta;
          const reasoningDelta = deltaAny.reasoning_content;
          const contentDelta = delta.content || "";
          if (contentDelta || reasoningDelta) {
            fullContent += contentDelta;
            fullReasoning += reasoningDelta || "";
            onChunk({
              role: "assistant",
              content: contentDelta,
              reasoning_content: reasoningDelta
            });
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.get(tc.index);
              if (existing) {
                existing.arguments += tc.function?.arguments || "";
              } else {
                toolCalls.set(tc.index, {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || ""
                });
              }
            }
          }
        }
        if (toolCalls.size === 0) {
          this.notifyAiStatus("idle", webContents);
          return;
        }
        const tcArray = Array.from(toolCalls.values()).map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments }
        }));
        messages.push({
          role: "assistant",
          content: fullContent,
          reasoning_content: fullReasoning || void 0,
          tool_calls: tcArray
        });
        for (const tc of tcArray) {
          const result = await this.executeToolCall(tc, webContents);
          messages.push({ role: "tool", content: result, tool_call_id: tc.id });
        }
      }
      this.notifyAiStatus("idle", webContents);
      throw new Error("工具调用轮次超过限制");
    } catch (error) {
      this.notifyAiStatus("idle", webContents);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("AI 调用已中止");
      }
      throw error;
    } finally {
      this.abortControllers.delete(requestId);
    }
  }
  abortAICall(requestId) {
    const abortController = this.abortControllers.get(requestId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(requestId);
    }
  }
}
const pluginAiAPI = new PluginAiAPI();
class PluginClipboardAPI {
  init() {
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.on("copy-text", (event, text) => {
      try {
        electron.clipboard.writeText(text);
        event.returnValue = true;
      } catch (error) {
        console.error("[PluginClipboard] 复制文本失败:", error);
        event.returnValue = false;
      }
    });
    electron.ipcMain.on("copy-image", (event, image) => {
      console.log("[PluginClipboard] 复制图片", image);
      try {
        let nativeImg;
        if (typeof image === "string") {
          if (image.startsWith("data:image/")) {
            nativeImg = electron.nativeImage.createFromDataURL(image);
          } else {
            nativeImg = electron.nativeImage.createFromPath(image);
          }
        } else if (Buffer.isBuffer(image)) {
          nativeImg = electron.nativeImage.createFromBuffer(image);
        } else if (image instanceof Uint8Array) {
          const buffer = Buffer.from(image);
          nativeImg = electron.nativeImage.createFromBuffer(buffer);
        } else {
          throw new Error("不支持的图片类型");
        }
        if (nativeImg.isEmpty()) {
          throw new Error("图片为空或无效");
        }
        electron.clipboard.writeImage(nativeImg);
        event.returnValue = true;
      } catch (error) {
        console.error("[PluginClipboard] 复制图片失败:", error);
        event.returnValue = false;
      }
    });
    electron.ipcMain.on("copy-file", (event, filePath) => {
      try {
        const files = Array.isArray(filePath) ? filePath : [filePath];
        if (os.platform() === "win32" || os.platform() === "darwin") {
          writeClipboardFiles(files);
        }
        event.returnValue = true;
      } catch (error) {
        console.error("[PluginClipboard] 复制文件失败:", error);
        event.returnValue = false;
      }
    });
    electron.ipcMain.on("get-copyed-files", (event) => {
      try {
        const files = readClipboardFiles().map((file) => ({
          path: file.path,
          isDirectory: file.isDirectory,
          isFile: !file.isDirectory,
          name: file.name
        }));
        event.returnValue = files;
      } catch (error) {
        console.error("[PluginClipboard] 获取剪贴板文件失败:", error);
        event.returnValue = [];
      }
    });
  }
}
const pluginClipboardAPI = new PluginClipboardAPI();
class PluginDialogAPI {
  mainWindow = null;
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.on("get-path", (event, name) => {
      try {
        let result = "";
        switch (name) {
          case "home":
            result = electron.app.getPath("home");
            break;
          case "appData":
            result = electron.app.getPath("appData");
            break;
          case "userData":
            result = electron.app.getPath("userData");
            break;
          case "temp":
            result = electron.app.getPath("temp");
            break;
          case "exe":
            result = electron.app.getPath("exe");
            break;
          case "desktop":
            result = electron.app.getPath("desktop");
            break;
          case "documents":
            result = electron.app.getPath("documents");
            break;
          case "downloads":
            result = electron.app.getPath("downloads");
            break;
          case "music":
            result = electron.app.getPath("music");
            break;
          case "pictures":
            result = electron.app.getPath("pictures");
            break;
          case "videos":
            result = electron.app.getPath("videos");
            break;
          case "logs":
            result = electron.app.getPath("logs");
            break;
          default:
            result = "";
        }
        event.returnValue = result;
      } catch (error) {
        console.error("[PluginDialog] 获取系统路径失败:", name, error);
        event.returnValue = "";
      }
    });
    electron.ipcMain.on("show-save-dialog", (event, options) => {
      try {
        const targetWindow = detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow;
        if (!targetWindow) {
          event.returnValue = void 0;
          return;
        }
        const result = windowManager.withBlurHideSuppressedSync(
          () => electron.dialog.showSaveDialogSync(targetWindow, options)
        );
        event.returnValue = result;
      } catch (error) {
        console.error("[PluginDialog] 显示文件保存对话框失败:", error);
        event.returnValue = void 0;
      }
    });
    electron.ipcMain.on("show-open-dialog", (event, options) => {
      try {
        const targetWindow = detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow;
        if (!targetWindow) {
          event.returnValue = [];
          return;
        }
        const result = windowManager.withBlurHideSuppressedSync(
          () => electron.dialog.showOpenDialogSync(targetWindow, options)
        );
        event.returnValue = result || [];
      } catch (error) {
        console.error("[PluginDialog] 显示文件打开对话框失败:", error);
        event.returnValue = [];
      }
    });
  }
}
const pluginDialogAPI = new PluginDialogAPI();
class PluginHttpAPI {
  // 存储每个插件变体的请求头配置
  // key: runtimeNamespace, value: headers map
  pluginHeaders = /* @__PURE__ */ new Map();
  // 存储每个插件变体的拦截器监听器
  // key: runtimeNamespace, value: listener function
  interceptors = /* @__PURE__ */ new Map();
  pluginManager = null;
  init(pluginManager2) {
    this.pluginManager = pluginManager2 ?? null;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.on("http-set-headers", (event, headers) => {
      try {
        const runtimeNamespace = this.getPluginRuntimeNamespaceFromWebContents(event.sender);
        if (!runtimeNamespace) {
          event.returnValue = { success: false, error: "无法识别插件" };
          return;
        }
        this.pluginHeaders.set(runtimeNamespace, headers);
        const sess = event.sender.session;
        this.removeRequestInterceptor(runtimeNamespace, sess);
        const listener = this.setupRequestInterceptor(sess, headers);
        if (listener) {
          this.interceptors.set(runtimeNamespace, listener);
        }
        event.returnValue = { success: true };
      } catch (error) {
        console.error("[PluginHttp] 设置请求头失败:", error);
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.on("http-get-headers", (event) => {
      try {
        const runtimeNamespace = this.getPluginRuntimeNamespaceFromWebContents(event.sender);
        if (!runtimeNamespace) {
          event.returnValue = null;
          return;
        }
        const headers = this.pluginHeaders.get(runtimeNamespace) || {};
        event.returnValue = headers;
      } catch (error) {
        console.error("[PluginHttp] 获取请求头失败:", error);
        event.returnValue = null;
      }
    });
    electron.ipcMain.on("http-clear-headers", (event) => {
      try {
        const runtimeNamespace = this.getPluginRuntimeNamespaceFromWebContents(event.sender);
        if (!runtimeNamespace) {
          event.returnValue = { success: false, error: "无法识别插件" };
          return;
        }
        this.pluginHeaders.delete(runtimeNamespace);
        const sess = event.sender.session;
        this.removeRequestInterceptor(runtimeNamespace, sess);
        event.returnValue = { success: true };
      } catch (error) {
        console.error("[PluginHttp] 清除请求头失败:", error);
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
  }
  /**
   * 从 WebContents 获取插件运行时命名空间。
   * 开发版与安装版必须使用不同 namespace，避免请求头配置串用。
   */
  getPluginRuntimeNamespaceFromWebContents(webContents) {
    if (this.pluginManager) {
      const pluginInfo = this.pluginManager.getPluginInfoByWebContents(webContents);
      if (pluginInfo) {
        return pluginInfo.name;
      }
    }
    const pluginName = pluginWindowManager.getPluginNameByWebContentsId(webContents.id);
    if (pluginName) {
      return pluginName;
    }
    return null;
  }
  /**
   * 设置请求拦截器
   * @returns 返回监听器函数
   */
  setupRequestInterceptor(sess, headers) {
    try {
      const listener = (details, callback) => {
        const requestHeaders = {
          ...details.requestHeaders,
          ...headers
        };
        callback({
          requestHeaders
        });
      };
      sess.webRequest.onBeforeSendHeaders(
        {
          urls: ["http://*/*", "https://*/*"]
        },
        listener
      );
      return listener;
    } catch (error) {
      console.error("[PluginHttp] 设置请求拦截器失败:", error);
      return null;
    }
  }
  /**
   * 移除请求拦截器
   */
  removeRequestInterceptor(runtimeNamespace, sess) {
    const listener = this.interceptors.get(runtimeNamespace);
    if (listener) {
      try {
        sess.webRequest.onBeforeSendHeaders(
          {
            urls: ["http://*/*", "https://*/*"]
          },
          null
        );
        this.interceptors.delete(runtimeNamespace);
      } catch (error) {
        console.warn("[PluginHttp] 移除请求拦截器失败:", error);
      }
    }
  }
  /**
   * 清理插件数据（当插件卸载时调用）
   */
  cleanupPlugin(runtimeNamespace, sess) {
    this.pluginHeaders.delete(runtimeNamespace);
    if (sess) {
      this.removeRequestInterceptor(runtimeNamespace, sess);
    }
  }
}
const pluginHttpAPI = new PluginHttpAPI();
class PluginInputAPI {
  pluginManager = null;
  /** 窗口管理器，用于隐藏主窗口和获取主窗口引用 */
  windowManager = null;
  /** 剪贴板管理器，用于在 paste 操作前暂停剪贴板监听 */
  clipboardManager = null;
  foundInPageListeners = /* @__PURE__ */ new WeakSet();
  init(pluginManager2, windowManager2, clipboardManager2) {
    this.pluginManager = pluginManager2;
    this.windowManager = windowManager2;
    this.clipboardManager = clipboardManager2;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle(
      "send-input-event",
      (_event, inputEvent) => this.sendInputEvent(inputEvent)
    );
    electron.ipcMain.on("simulate-keyboard-tap", (event, key, modifiers) => {
      event.returnValue = this.simulateKeyboardTap(key, modifiers);
    });
    electron.ipcMain.on("simulate-mouse-move", (event, x, y) => {
      event.returnValue = this.simulateMouseMove(x, y);
    });
    electron.ipcMain.on("simulate-mouse-click", (event, x, y) => {
      event.returnValue = this.simulateMouseClick(x, y);
    });
    electron.ipcMain.on("simulate-mouse-double-click", (event, x, y) => {
      event.returnValue = this.simulateMouseDoubleClick(x, y);
    });
    electron.ipcMain.on("simulate-mouse-right-click", (event, x, y) => {
      event.returnValue = this.simulateMouseRightClick(x, y);
    });
    electron.ipcMain.on("is-dev", (event) => {
      event.returnValue = this.pluginManager?.isPluginDev(event.sender.id) ?? false;
    });
    electron.ipcMain.on("get-web-contents-id", (event) => {
      event.returnValue = event.sender.id;
    });
    electron.ipcMain.handle("find-in-page", (event, text, options) => {
      try {
        const webContents = event.sender;
        if (webContents.isDestroyed()) {
          return { success: false, error: "页面已销毁" };
        }
        this.ensureFoundInPageListener(webContents);
        const requestId = webContents.findInPage(text, options);
        return { success: true, requestId };
      } catch (error) {
        console.error("[PluginInput] 页面内查找失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle(
      "stop-find-in-page",
      (event, action) => {
        try {
          const webContents = event.sender;
          if (webContents.isDestroyed()) {
            return { success: false, error: "页面已销毁" };
          }
          webContents.stopFindInPage(action);
          return { success: true };
        } catch (error) {
          console.error("[PluginInput] 停止页面内查找失败:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "未知错误"
          };
        }
      }
    );
    electron.ipcMain.on("hide-main-window-paste-text", (event, text) => {
      if (this.isDetachedWindowCall(event)) {
        event.returnValue = false;
        return;
      }
      if (typeof text !== "string") {
        event.returnValue = false;
        return;
      }
      this.windowManager.hideWindow(true);
      this.clipboardManager.temporaryCancelWatch();
      electron.clipboard.writeText(String(text));
      setTimeout(() => {
        WindowManager$1.simulatePaste();
      }, 50);
      event.returnValue = true;
    });
    electron.ipcMain.on("hide-main-window-paste-image", (event, img) => {
      if (this.isDetachedWindowCall(event)) {
        event.returnValue = false;
        return;
      }
      if (!img) {
        event.returnValue = false;
        return;
      }
      let nativeImg;
      if (typeof img === "string") {
        if (/^data:image\/([a-z]+);base64,/.test(img)) {
          nativeImg = electron.nativeImage.createFromDataURL(img);
        } else if (path.basename(img) !== img && fs.existsSync(img)) {
          nativeImg = electron.nativeImage.createFromPath(img);
        }
      } else if (typeof img === "object" && img instanceof Uint8Array) {
        nativeImg = electron.nativeImage.createFromBuffer(Buffer.from(img));
      }
      if (!nativeImg || nativeImg.isEmpty()) {
        event.returnValue = false;
        return;
      }
      this.windowManager.hideWindow(true);
      this.clipboardManager.temporaryCancelWatch();
      electron.clipboard.writeImage(nativeImg);
      setTimeout(() => {
        WindowManager$1.simulatePaste();
      }, 50);
      event.returnValue = true;
    });
    electron.ipcMain.on("hide-main-window-paste-file", (event, filePaths) => {
      if (this.isDetachedWindowCall(event)) {
        event.returnValue = false;
        return;
      }
      if (!filePaths) {
        event.returnValue = false;
        return;
      }
      let files = Array.isArray(filePaths) ? filePaths : [filePaths];
      files = files.filter((f) => fs.existsSync(f));
      if (files.length === 0) {
        event.returnValue = false;
        return;
      }
      this.windowManager.hideWindow(true);
      this.clipboardManager.temporaryCancelWatch();
      ClipboardMonitor.setClipboardFiles(files);
      setTimeout(() => {
        WindowManager$1.simulatePaste();
      }, 50);
      event.returnValue = true;
    });
    electron.ipcMain.on("hide-main-window-type-string", (event, text) => {
      if (this.isDetachedWindowCall(event)) {
        event.returnValue = false;
        return;
      }
      if (typeof text !== "string") {
        event.returnValue = false;
        return;
      }
      this.windowManager.hideWindow(true);
      if (text) {
        const segments = [...new Intl.Segmenter().segment(text)];
        for (const seg of segments) {
          if (seg.segment === "\n") {
            WindowManager$1.simulateKeyboardTap("enter", "shift");
          } else {
            WindowManager$1.unicodeType(seg.segment);
          }
        }
      }
      event.returnValue = true;
    });
  }
  /**
   * 检查调用者是否为分离窗口且聚焦（安全检查：分离窗口不应执行粘贴/输入操作）
   */
  isDetachedWindowCall(event) {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (win && win !== this.windowManager?.getMainWindow() && win.isFocused()) {
      return true;
    }
    return false;
  }
  sendInputEvent(inputEvent) {
    try {
      if (this.pluginManager) {
        const result = this.pluginManager.sendInputEvent(inputEvent);
        if (result) {
          return { success: true };
        } else {
          return { success: false, error: "没有活动的插件" };
        }
      }
      return { success: false, error: "功能不可用" };
    } catch (error) {
      console.error("[PluginInput] 发送输入事件失败:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "未知错误"
      };
    }
  }
  /**
   * 确保 webContents 上注册了 found-in-page 事件监听，避免重复注册
   */
  ensureFoundInPageListener(webContents) {
    if (this.foundInPageListeners.has(webContents)) return;
    this.foundInPageListeners.add(webContents);
    webContents.on("found-in-page", (_event, result) => {
      if (!webContents.isDestroyed()) {
        webContents.send("found-in-page-result", result);
      }
    });
  }
  simulateKeyboardTap(key, modifiers = []) {
    try {
      return WindowManager$1.simulateKeyboardTap(key, ...modifiers);
    } catch (error) {
      console.error("[PluginInput] 模拟键盘按键失败:", error);
      return false;
    }
  }
  simulateMouseMove(x, y) {
    try {
      return WindowManager$1.simulateMouseMove(x, y);
    } catch (error) {
      console.error("[PluginInput] 模拟鼠标移动失败:", error);
      return false;
    }
  }
  simulateMouseClick(x, y) {
    try {
      return WindowManager$1.simulateMouseClick(x, y);
    } catch (error) {
      console.error("[PluginInput] 模拟鼠标单击失败:", error);
      return false;
    }
  }
  simulateMouseDoubleClick(x, y) {
    try {
      return WindowManager$1.simulateMouseDoubleClick(x, y);
    } catch (error) {
      console.error("[PluginInput] 模拟鼠标双击失败:", error);
      return false;
    }
  }
  simulateMouseRightClick(x, y) {
    try {
      return WindowManager$1.simulateMouseRightClick(x, y);
    } catch (error) {
      console.error("[PluginInput] 模拟鼠标右击失败:", error);
      return false;
    }
  }
}
const pluginInputAPI = new PluginInputAPI();
class LogCollector {
  /** 日志收集全局开关（与前端 WebContents 生命周期解耦） */
  enabled = false;
  buffer = [];
  maxBufferSize = 2e3;
  idCounter = 0;
  /** 当前接收推送的 WebContents 集合（仅用于 IPC 推送，不影响收集开关） */
  subscribers = /* @__PURE__ */ new Set();
  flushTimer = null;
  pendingEntries = [];
  flushIntervalMs = 100;
  /**
   * 安装 electron-log hook，应用启动时调用一次
   * hook 不影响原有 transport 管道，仅在启用时收集日志
   */
  install() {
    log.hooks.push((message, _transport, transportName) => {
      if (transportName !== "file") return message;
      if (this.enabled) {
        this.collectEntry(message);
      }
      return message;
    });
  }
  /**
   * 查询日志收集是否已启用
   */
  isEnabled() {
    return this.enabled;
  }
  /**
   * 启用日志收集（全局开关），并将指定 webContents 加入推送订阅
   */
  enable(webContents) {
    this.enabled = true;
    this.addSubscriber(webContents);
  }
  /**
   * 禁用日志收集（全局开关），并移除指定 webContents 的订阅
   */
  disable(webContents) {
    this.enabled = false;
    this.subscribers.delete(webContents);
    this.buffer = [];
    this.pendingEntries = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
  /**
   * 注册 webContents 为推送订阅者（不影响收集开关）
   * 用于前端重新进入页面时恢复推送
   */
  addSubscriber(webContents) {
    this.subscribers.add(webContents);
    webContents.once("destroyed", () => {
      this.subscribers.delete(webContents);
    });
  }
  /**
   * 获取缓冲区历史日志
   */
  getBufferedLogs() {
    return [...this.buffer];
  }
  /**
   * 收集一条日志
   */
  collectEntry(message) {
    const level = this.mapLevel(message.level);
    if (!level) return;
    const { source, cleanMessage } = this.extractSource(message.data);
    const fullMessage = this.serializeArgs(message.data, cleanMessage);
    const entry = {
      id: ++this.idCounter,
      timestamp: message.date ? message.date.getTime() : Date.now(),
      level,
      source,
      message: fullMessage
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
    this.pendingEntries.push(entry);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }
  /**
   * 批量推送给所有订阅者
   */
  flush() {
    this.flushTimer = null;
    if (this.pendingEntries.length === 0) return;
    const maxPerFlush = 200;
    const batch = this.pendingEntries.splice(0, maxPerFlush);
    if (this.pendingEntries.length > 0) {
      this.flushTimer = setTimeout(() => this.flush(), 16);
    }
    for (const wc of this.subscribers) {
      if (!wc.isDestroyed()) {
        wc.send("log-entries", batch);
      } else {
        this.subscribers.delete(wc);
      }
    }
  }
  /**
   * 映射 electron-log 级别到前端级别
   */
  mapLevel(level) {
    switch (level) {
      case "error":
        return "error";
      case "warn":
        return "warn";
      case "info":
        return "info";
      case "verbose":
        return "verbose";
      case "debug":
        return "debug";
      default:
        return null;
    }
  }
  /**
   * 从日志数据中提取 source 前缀
   * 匹配 [Sync]、[WebDAV]、[Updater] 等已有前缀
   */
  extractSource(data) {
    const firstArg = data[0];
    if (typeof firstArg === "string") {
      const match = firstArg.match(/^\[([^\]]+)\]\s*(.*)/);
      if (match) {
        return { source: match[1], cleanMessage: match[2] };
      }
    }
    return { source: "Main", cleanMessage: "" };
  }
  /**
   * 序列化日志参数为字符串
   */
  serializeArgs(data, cleanMessage) {
    if (cleanMessage) {
      const rest = data.slice(1);
      if (rest.length === 0) return cleanMessage;
      return cleanMessage + " " + rest.map((arg) => this.stringify(arg)).join(" ");
    }
    return data.map((arg) => this.stringify(arg)).join(" ");
  }
  /**
   * 安全序列化单个参数
   */
  stringify(arg) {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      const str = JSON.stringify(arg);
      return str && str.length > 500 ? str.substring(0, 500) + "..." : str ?? String(arg);
    } catch {
      return String(arg);
    }
  }
}
const logCollector = new LogCollector();
const floatingBallHtml = path.join(__dirname, "../../resources/floatingBall.html");
const BALL_SIZE = 48;
class FloatingBallManager {
  ballWindow = null;
  enabled = false;
  letter = "Z";
  // 悬浮球显示的文字，默认 Z
  doubleClickCommand = "";
  // 悬浮球双击目标指令
  // 拖拽状态：记录拖拽开始时鼠标相对窗口左上角的偏移
  dragOffsetX = 0;
  dragOffsetY = 0;
  /**
   * 初始化悬浮球管理器
   * 从数据库加载配置，决定是否创建悬浮球
   */
  async init() {
    this.setupIPC();
    this.loadConfig();
  }
  /**
   * 从数据库加载悬浮球配置
   */
  async loadConfig() {
    try {
      const data = databaseAPI.dbGet("settings-general");
      this.enabled = data?.floatingBallEnabled ?? false;
      this.letter = data?.floatingBallLetter || "Z";
      this.doubleClickCommand = data?.floatingBallDoubleClickCommand || "";
      if (this.enabled) {
        this.createBallWindow();
        const savedPos = data?.floatingBallPosition;
        if (savedPos && this.ballWindow) {
          this.ballWindow.setPosition(savedPos.x, savedPos.y, false);
        }
      }
      console.log("[FloatingBall] 悬浮球配置已加载, enabled:", this.enabled);
    } catch (error) {
      console.error("[FloatingBall] 加载悬浮球配置失败:", error);
    }
  }
  /**
   * 设置 IPC 处理器
   */
  setupIPC() {
    electron.ipcMain.on("floating-ball-click", () => {
      this.handleBallClick();
    });
    electron.ipcMain.on("floating-ball-double-click", () => {
      this.handleBallDoubleClick();
    });
    electron.ipcMain.on(
      "floating-ball-drag-start",
      (_event, data) => {
        if (!this.ballWindow || this.ballWindow.isDestroyed()) return;
        const [winX, winY] = this.ballWindow.getPosition();
        this.dragOffsetX = data.mouseScreenX - winX;
        this.dragOffsetY = data.mouseScreenY - winY;
      }
    );
    electron.ipcMain.on("floating-ball-dragging", (_event, data) => {
      if (!this.ballWindow || this.ballWindow.isDestroyed()) return;
      const newX = data.screenX - this.dragOffsetX;
      const newY = data.screenY - this.dragOffsetY;
      this.ballWindow.setPosition(newX, newY, false);
    });
    electron.ipcMain.on("floating-ball-drag-end", () => {
      this.savePosition();
    });
    electron.ipcMain.on("floating-ball-contextmenu", () => {
      this.showContextMenu();
    });
    electron.ipcMain.on(
      "floating-ball-file-drop",
      (_event, files) => {
        this.handleFileDrop(files);
      }
    );
    electron.ipcMain.handle("floating-ball:set-enabled", (_event, enabled) => {
      return this.setEnabled(enabled);
    });
    electron.ipcMain.handle("floating-ball:get-enabled", () => {
      return this.enabled;
    });
    electron.ipcMain.handle("floating-ball:set-letter", (_event, letter) => {
      return this.setLetter(letter);
    });
    electron.ipcMain.handle("floating-ball:get-letter", () => {
      return this.letter;
    });
    electron.ipcMain.handle("floating-ball:set-double-click-command", (_event, command) => {
      return this.setDoubleClickCommand(command);
    });
    electron.ipcMain.handle("floating-ball:get-double-click-command", () => {
      return this.doubleClickCommand;
    });
  }
  /**
   * 创建悬浮球窗口
   */
  createBallWindow() {
    if (this.ballWindow && !this.ballWindow.isDestroyed()) {
      this.ballWindow.show();
      return;
    }
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    const {
      width: screenWidth,
      height: screenHeight,
      x: workAreaX,
      y: workAreaY
    } = primaryDisplay.workArea;
    const x = workAreaX + screenWidth - BALL_SIZE - 30;
    const y = workAreaY + Math.floor(screenHeight / 2) - Math.floor(BALL_SIZE / 2);
    this.ballWindow = new electron.BrowserWindow({
      width: BALL_SIZE,
      height: BALL_SIZE,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      type: "panel",
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true
      }
    });
    this.ballWindow.setAlwaysOnTop(true, "floating");
    this.ballWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.ballWindow.loadFile(floatingBallHtml);
    this.ballWindow.webContents.on("did-finish-load", () => {
      if (this.ballWindow && !this.ballWindow.isDestroyed()) {
        this.ballWindow.webContents.send("floating-ball-set-letter", this.letter);
      }
    });
    this.ballWindow.on("close", (event) => {
      if (this.enabled) {
        event.preventDefault();
      }
    });
    console.log("[FloatingBall] 悬浮球窗口已创建");
  }
  /**
   * 处理悬浮球点击
   */
  handleBallClick() {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      windowManager.hideWindow(false);
    } else {
      windowManager.showWindow();
    }
  }
  /**
   * 处理悬浮球双击
   */
  handleBallDoubleClick() {
    if (!this.doubleClickCommand) {
      this.handleBallClick();
      return;
    }
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow) return;
    windowManager.showWindow();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("floating-ball-double-click-command", this.doubleClickCommand);
        console.log("[FloatingBall] 悬浮球双击，触发指令:", this.doubleClickCommand);
      }
    }, 100);
  }
  /**
   * 处理文件拖放到悬浮球
   * 显示主窗口并将文件数据发送给渲染进程（等同于复制文件后打开搜索框粘贴）
   */
  handleFileDrop(files) {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow) return;
    windowManager.showWindow();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("floating-ball-files", files);
        console.log("[FloatingBall] 悬浮球文件拖放:", files.length, "个文件");
      }
    }, 500);
  }
  /**
   * 保存悬浮球位置到数据库
   */
  savePosition() {
    if (!this.ballWindow || this.ballWindow.isDestroyed()) return;
    const [x, y] = this.ballWindow.getPosition();
    try {
      const data = databaseAPI.dbGet("settings-general") || {};
      data.floatingBallPosition = { x, y };
      databaseAPI.dbPut("settings-general", data);
      console.log("[FloatingBall] 悬浮球位置已保存:", { x, y });
    } catch (error) {
      console.error("[FloatingBall] 保存悬浮球位置失败:", error);
    }
  }
  /**
   * 显示右键菜单
   */
  showContextMenu() {
    if (!this.ballWindow) return;
    const menu = electron.Menu.buildFromTemplate([
      {
        label: "显示/隐藏 ZTools",
        click: () => {
          this.handleBallClick();
        }
      },
      { type: "separator" },
      {
        label: "隐藏悬浮球",
        click: () => {
          this.setEnabled(false);
        }
      }
    ]);
    menu.popup({ window: this.ballWindow });
  }
  /**
   * 设置悬浮球启用/禁用
   */
  async setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.createBallWindow();
    } else {
      this.destroyBallWindow();
    }
    try {
      const data = databaseAPI.dbGet("settings-general") || {};
      data.floatingBallEnabled = enabled;
      databaseAPI.dbPut("settings-general", data);
      console.log("[FloatingBall] 悬浮球已", enabled ? "启用" : "禁用");
    } catch (error) {
      console.error("[FloatingBall] 保存悬浮球设置失败:", error);
    }
    return { success: true };
  }
  /**
   * 设置悬浮球显示文字
   */
  setLetter(letter) {
    this.letter = letter || "Z";
    if (this.ballWindow && !this.ballWindow.isDestroyed()) {
      this.ballWindow.webContents.send("floating-ball-set-letter", this.letter);
    }
    try {
      const data = databaseAPI.dbGet("settings-general") || {};
      data.floatingBallLetter = this.letter;
      databaseAPI.dbPut("settings-general", data);
      console.log("悬浮球文字已更新:", this.letter);
    } catch (error) {
      console.error("保存悬浮球文字失败:", error);
    }
    return { success: true };
  }
  /**
   * 设置悬浮球双击目标指令
   */
  setDoubleClickCommand(command) {
    this.doubleClickCommand = command || "";
    try {
      const data = databaseAPI.dbGet("settings-general") || {};
      data.floatingBallDoubleClickCommand = this.doubleClickCommand;
      databaseAPI.dbPut("settings-general", data);
      console.log("悬浮球双击目标指令已更新:", this.doubleClickCommand);
    } catch (error) {
      console.error("保存悬浮球双击目标指令失败:", error);
    }
    return { success: true };
  }
  /**
   * 销毁悬浮球窗口
   */
  destroyBallWindow() {
    if (this.ballWindow && !this.ballWindow.isDestroyed()) {
      this.enabled = false;
      this.ballWindow.removeAllListeners("close");
      this.ballWindow.destroy();
      this.ballWindow = null;
      console.log("[FloatingBall] 悬浮球窗口已销毁");
    }
  }
  /**
   * 获取悬浮球是否启用
   */
  isEnabled() {
    return this.enabled;
  }
  /**
   * 应用退出时清理
   */
  cleanup() {
    this.destroyBallWindow();
  }
}
const floatingBallManager = new FloatingBallManager();
const DB_KEY$1 = "settings-http-server";
const DEFAULT_PORT$1 = 36578;
class HttpServer {
  server = null;
  config = {
    enabled: false,
    port: DEFAULT_PORT$1,
    apiKey: ""
  };
  async init() {
    await this.loadConfig();
    if (this.config.enabled) {
      this.start();
    }
  }
  async loadConfig() {
    try {
      const saved = databaseAPI.dbGet(DB_KEY$1);
      if (saved) {
        this.config = {
          enabled: saved.enabled ?? false,
          port: saved.port ?? DEFAULT_PORT$1,
          apiKey: saved.apiKey || this.generateApiKey()
        };
      }
    } catch (error) {
      console.error("[HttpServer] 加载配置失败:", error);
    }
    return this.config;
  }
  async saveConfig(config) {
    this.config = { ...this.config, ...config };
    databaseAPI.dbPut(DB_KEY$1, {
      enabled: this.config.enabled,
      port: this.config.port,
      apiKey: this.config.apiKey
    });
    return this.config;
  }
  getConfig() {
    if (!this.config.apiKey) {
      this.config.apiKey = this.generateApiKey();
      this.saveConfig({ apiKey: this.config.apiKey });
    }
    return { ...this.config };
  }
  generateApiKey() {
    return crypto.randomBytes(16).toString("hex");
  }
  start() {
    if (this.server) {
      this.stop();
    }
    try {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", (error) => {
        console.error("[HttpServer] 服务器错误:", error);
        if (error.code === "EADDRINUSE") {
          console.error(`[HttpServer] 端口 ${this.config.port} 已被占用`);
        }
        this.server = null;
      });
      this.server.listen(this.config.port, "127.0.0.1", () => {
        console.log(`[HttpServer] 服务已启动: http://127.0.0.1:${this.config.port}`);
      });
      return true;
    } catch (error) {
      console.error("[HttpServer] 启动失败:", error);
      this.server = null;
      return false;
    }
  }
  stop() {
    if (this.server) {
      this.server.close(() => {
        console.log("[HttpServer] 服务已停止");
      });
      this.server = null;
    }
  }
  isRunning() {
    return this.server !== null && this.server.listening;
  }
  sendJson(res, statusCode, body) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end(JSON.stringify(body));
  }
  async handleRequest(req, res) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      });
      res.end();
      return;
    }
    const url2 = req.url || "/";
    if (req.method === "GET" && url2 === "/") {
      this.sendJson(res, 200, { code: 0, message: "Hello ZTools" });
      return;
    }
    if (req.method !== "POST") {
      this.sendJson(res, 405, { code: 405, message: "仅支持 POST 请求" });
      return;
    }
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || token !== this.config.apiKey) {
      this.sendJson(res, 401, { code: 401, message: "API 密钥无效" });
      return;
    }
    try {
      const body = await this.readBody(req);
      const result = await this.routeRequest(url2, body);
      this.sendJson(res, 200, result);
    } catch (error) {
      console.error("[HttpServer] 请求处理失败:", error);
      this.sendJson(res, 500, {
        code: 500,
        message: error instanceof Error ? error.message : "内部服务器错误"
      });
    }
  }
  readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const MAX_BODY_SIZE = 1024 * 1024;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          reject(new Error("请求体过大"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("无效的 JSON 格式"));
        }
      });
      req.on("error", reject);
    });
  }
  async routeRequest(url2, body) {
    switch (url2) {
      case "/api/window/show":
        return this.handleShowWindow(body);
      case "/api/window/hide":
        return this.handleHideWindow();
      case "/api/window/toggle":
        return this.handleToggleWindow();
      default:
        return { code: 404, message: `未知接口: ${url2}` };
    }
  }
  handleShowWindow(body) {
    try {
      windowManager.showWindow();
      const text = typeof body.text === "string" ? body.text : void 0;
      if (text !== void 0) {
        const mainWindow = windowManager.getMainWindow();
        setTimeout(() => {
          mainWindow?.webContents.send("set-search-text", text);
        }, 100);
      }
      return { code: 0, message: "操作成功" };
    } catch (error) {
      return {
        code: 500,
        message: error instanceof Error ? error.message : "显示窗口失败"
      };
    }
  }
  handleHideWindow() {
    try {
      windowManager.hideWindow(false);
      return { code: 0, message: "操作成功" };
    } catch (error) {
      return {
        code: 500,
        message: error instanceof Error ? error.message : "隐藏窗口失败"
      };
    }
  }
  handleToggleWindow() {
    try {
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow?.isVisible()) {
        windowManager.hideWindow(false);
      } else {
        windowManager.showWindow();
      }
      return { code: 0, message: "操作成功" };
    } catch (error) {
      return {
        code: 500,
        message: error instanceof Error ? error.message : "切换窗口失败"
      };
    }
  }
}
const httpServer = new HttpServer();
const TOOL_REGISTER_TIMEOUT_MS = 5e3;
const MCP_DISABLED_PLUGINS_DB_KEY = "settings-mcp-disabled-plugins";
class PluginToolsAPI {
  pluginManager = null;
  // webContents.id => 已通过 ztools.registerTool 注册的工具集合
  registeredTools = /* @__PURE__ */ new Map();
  // webContents.id:toolName => 等待工具注册完成的回调列表
  waiters = /* @__PURE__ */ new Map();
  /**
   * 初始化工具 API，并注册插件工具相关 IPC。
   */
  init(pluginManager2) {
    this.pluginManager = pluginManager2;
    this.setupIPC();
  }
  /**
   * 接收 preload 中的工具注册请求，并同步记录到主进程状态。
   */
  setupIPC() {
    electron.ipcMain.on("plugin:tool-register", (event, toolName) => {
      try {
        this.registerTool(event.sender, toolName);
        event.returnValue = { success: true };
      } catch (error) {
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : "工具注册失败"
        };
      }
    });
  }
  /**
   * 从插件目录读取并筛选合法的 tools 声明。
   */
  getDeclaredToolsByPath(pluginPath) {
    try {
      const pluginJsonPath = path.join(pluginPath, "plugin.json");
      const pluginConfig = JSON.parse(
        fs.readFileSync(pluginJsonPath, "utf-8")
      );
      if (!pluginConfig.tools || typeof pluginConfig.tools !== "object") {
        return {};
      }
      return Object.entries(pluginConfig.tools).reduce(
        (acc, [toolName, tool]) => {
          if (!tool || typeof tool !== "object" || typeof tool.description !== "string" || !tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
            return acc;
          }
          acc[toolName] = tool;
          return acc;
        },
        {}
      );
    } catch {
      return {};
    }
  }
  /**
   * 根据 WebContents 反查所属插件并读取其 tools 声明。
   */
  getDeclaredToolsByWebContents(webContents) {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(webContents);
    if (!pluginInfo) return null;
    return this.getDeclaredToolsByPath(pluginInfo.path);
  }
  /**
   * 汇总所有已安装插件的工具，并生成适合 MCP 暴露的唯一工具名。
   */
  getAllDeclaredToolEntries(options) {
    const plugins = databaseAPI.dbGet("plugins");
    if (!Array.isArray(plugins)) {
      return [];
    }
    const includeDisabled = options?.includeDisabled ?? true;
    const disabledPluginPaths = this.getDisabledPluginPaths();
    const usedMcpNames = /* @__PURE__ */ new Map();
    const entries = [];
    for (const plugin of [...plugins].sort(
      (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""))
    )) {
      if (!plugin?.path || !plugin?.name) continue;
      const enabled = !disabledPluginPaths.has(plugin.path);
      if (!includeDisabled && !enabled) continue;
      const tools = this.getDeclaredToolsByPath(plugin.path);
      for (const [toolName, tool] of Object.entries(tools)) {
        const baseMcpName = this.buildMcpToolName(plugin.name, toolName);
        const collisionCount = usedMcpNames.get(baseMcpName) || 0;
        usedMcpNames.set(baseMcpName, collisionCount + 1);
        entries.push({
          pluginName: plugin.name,
          pluginPath: plugin.path,
          pluginLogo: typeof plugin.logo === "string" ? plugin.logo : void 0,
          toolName,
          mcpName: collisionCount === 0 ? baseMcpName : `${baseMcpName}_${collisionCount + 1}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          enabled
        });
      }
    }
    return entries;
  }
  /**
   * 确保目标插件和目标工具已就绪。
   * 插件未运行时会先后台预加载，然后等待 preload 完成 registerTool。
   */
  async ensurePluginToolReady(pluginPath, toolName) {
    let webContents = this.pluginManager?.getPluginWebContentsByPath(pluginPath) ?? null;
    if (!webContents) {
      await this.pluginManager?.preloadPlugin(pluginPath);
      webContents = this.pluginManager?.getPluginWebContentsByPath(pluginPath) ?? null;
    }
    if (!webContents) return null;
    if (this.isToolRegistered(webContents, toolName)) {
      return webContents;
    }
    await this.waitForToolRegistration(webContents, toolName);
    return this.isToolRegistered(webContents, toolName) ? webContents : null;
  }
  /**
   * 检查某个工具是否已在指定 WebContents 中注册。
   */
  isToolRegistered(webContents, toolName) {
    return this.registeredTools.get(webContents.id)?.has(toolName) ?? false;
  }
  /**
   * 在插件上下文中执行已注册的工具处理器。
   */
  async executeRegisteredTool(webContents, toolName, input) {
    const declaredTools = this.getDeclaredToolsByWebContents(webContents);
    if (!declaredTools?.[toolName]) {
      throw new Error(`工具 "${toolName}" 未在 plugin.json 中声明`);
    }
    if (!this.isToolRegistered(webContents, toolName)) {
      throw new Error(`工具 "${toolName}" 尚未通过 ztools.registerTool 注册`);
    }
    return await webContents.executeJavaScript(`
      (async () => {
        if (!window.ztools || typeof window.ztools.__invokeRegisteredTool !== 'function') {
          throw new Error('插件运行时缺少工具调用入口')
        }
        return await window.ztools.__invokeRegisteredTool(
          ${JSON.stringify(toolName)},
          ${JSON.stringify(input ?? {})}
        )
      })()
    `);
  }
  /**
   * 记录插件工具注册结果，并唤醒等待该工具可用的调用方。
   */
  registerTool(webContents, rawToolName) {
    const toolName = typeof rawToolName === "string" ? rawToolName.trim() : "";
    if (!toolName) {
      throw new Error("工具名称不能为空");
    }
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(webContents);
    if (!pluginInfo) {
      throw new Error("无法获取插件信息");
    }
    const declaredTools = this.getDeclaredToolsByPath(pluginInfo.path);
    if (!declaredTools[toolName]) {
      throw new Error(`工具 "${toolName}" 未在 plugin.json 中声明`);
    }
    let tools = this.registeredTools.get(webContents.id);
    if (!tools) {
      tools = /* @__PURE__ */ new Set();
      this.registeredTools.set(webContents.id, tools);
      webContents.once("destroyed", () => {
        this.registeredTools.delete(webContents.id);
      });
    }
    tools.add(toolName);
    this.resolveWaiters(webContents.id, toolName);
  }
  /**
   * 等待 preload 中的 registerTool 完成，避免刚预加载时立即调用失败。
   */
  async waitForToolRegistration(webContents, toolName) {
    if (this.isToolRegistered(webContents, toolName)) return;
    const waiterKey = this.getWaiterKey(webContents.id, toolName);
    await new Promise((resolve, reject) => {
      let wrappedResolve = null;
      const timeout = setTimeout(() => {
        if (wrappedResolve) {
          this.removeWaiter(waiterKey, wrappedResolve);
        }
        reject(new Error(`等待工具 "${toolName}" 注册超时`));
      }, TOOL_REGISTER_TIMEOUT_MS);
      wrappedResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
      const waiters = this.waiters.get(waiterKey) || [];
      waiters.push(wrappedResolve);
      this.waiters.set(waiterKey, waiters);
    }).catch(() => void 0);
  }
  /**
   * 解析并执行等待某个工具注册完成的所有回调。
   */
  resolveWaiters(webContentsId, toolName) {
    const waiterKey = this.getWaiterKey(webContentsId, toolName);
    const waiters = this.waiters.get(waiterKey);
    if (!waiters?.length) return;
    this.waiters.delete(waiterKey);
    for (const resolve of waiters) {
      resolve();
    }
  }
  /**
   * 在超时或结束后移除单个 waiter，避免残留无效回调。
   */
  removeWaiter(waiterKey, target) {
    const waiters = this.waiters.get(waiterKey);
    if (!waiters?.length) return;
    const nextWaiters = waiters.filter((waiter) => waiter !== target);
    if (nextWaiters.length > 0) {
      this.waiters.set(waiterKey, nextWaiters);
    } else {
      this.waiters.delete(waiterKey);
    }
  }
  /**
   * 为单个 WebContents + toolName 生成稳定的 waiter 键。
   */
  getWaiterKey(webContentsId, toolName) {
    return `${webContentsId}:${toolName}`;
  }
  /**
   * 读取被用户禁用 MCP 工具暴露的插件路径集合。
   */
  getDisabledPluginPaths() {
    const data = databaseAPI.dbGet(MCP_DISABLED_PLUGINS_DB_KEY);
    return new Set(Array.isArray(data) ? data.filter((item) => typeof item === "string") : []);
  }
  /**
   * 生成 MCP 对外暴露的工具名，格式为 plugin_tool。
   */
  buildMcpToolName(pluginName, toolName) {
    const safePluginName = pluginName.toLowerCase().split("__").map((part) => part.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")).join("__").replace(/^_+|_+$/g, "") || "plugin";
    return `${safePluginName}_${toolName}`;
  }
}
const pluginToolsAPI = new PluginToolsAPI();
class McpProtocolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}
const DB_KEY = "settings-mcp-server";
const DEFAULT_PORT = 36579;
const MCP_PROTOCOL_VERSION = "2025-06-18";
class McpServer {
  server = null;
  config = {
    enabled: false,
    port: DEFAULT_PORT,
    apiKey: ""
  };
  /**
   * 初始化服务配置，并在启用状态下自动启动。
   */
  async init() {
    await this.loadConfig();
    if (this.config.enabled) {
      this.start();
    }
  }
  /**
   * 从数据库加载 MCP 服务配置。
   */
  async loadConfig() {
    try {
      const saved = databaseAPI.dbGet(DB_KEY);
      if (saved) {
        this.config = {
          enabled: saved.enabled ?? false,
          port: saved.port ?? DEFAULT_PORT,
          apiKey: saved.apiKey || this.generateApiKey()
        };
      }
    } catch (error) {
      console.error("[McpServer] 加载配置失败:", error);
    }
    return this.config;
  }
  /**
   * 保存 MCP 服务配置到数据库。
   */
  async saveConfig(config) {
    this.config = { ...this.config, ...config };
    databaseAPI.dbPut(DB_KEY, {
      enabled: this.config.enabled,
      port: this.config.port,
      apiKey: this.config.apiKey
    });
    return this.config;
  }
  /**
   * 获取当前配置；若缺少 API Key，会即时生成并落库。
   */
  getConfig() {
    if (!this.config.apiKey) {
      this.config.apiKey = this.generateApiKey();
      this.saveConfig({ apiKey: this.config.apiKey });
    }
    return { ...this.config };
  }
  /**
   * 生成用于本地 MCP 访问鉴权的随机 API Key。
   */
  generateApiKey() {
    return crypto.randomBytes(16).toString("hex");
  }
  /**
   * 启动 MCP HTTP 服务。
   */
  start() {
    if (this.server) {
      this.stop();
    }
    try {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", (error) => {
        console.error("[McpServer] 服务器错误:", error);
        if (error.code === "EADDRINUSE") {
          console.error(`[McpServer] 端口 ${this.config.port} 已被占用`);
        }
        this.server = null;
      });
      this.server.listen(this.config.port, "0.0.0.0", () => {
        console.log(`[McpServer] 服务已启动: http://0.0.0.0:${this.config.port}/mcp`);
      });
      return true;
    } catch (error) {
      console.error("[McpServer] 启动失败:", error);
      this.server = null;
      return false;
    }
  }
  /**
   * 停止 MCP HTTP 服务。
   */
  stop() {
    if (this.server) {
      this.server.close(() => {
        console.log("[McpServer] 服务已停止");
      });
      this.server = null;
    }
  }
  /**
   * 返回服务当前是否处于监听状态。
   */
  isRunning() {
    return this.server !== null && this.server.listening;
  }
  /**
   * 发送 JSON 响应，并附带 MCP 所需的基础 CORS 头。
   */
  sendRawJson(res, statusCode, body) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end(JSON.stringify(body));
  }
  /**
   * 返回空响应，主要用于 OPTIONS 和 JSON-RPC notification。
   */
  sendNoContent(res) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end();
  }
  /**
   * 处理所有进入 MCP 服务的 HTTP 请求。
   */
  async handleRequest(req, res) {
    if (req.method === "OPTIONS") {
      this.sendNoContent(res);
      return;
    }
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = requestUrl.pathname;
    if (req.method === "GET" && pathname === "/mcp") {
      this.sendRawJson(res, 200, {
        name: "ZTools MCP",
        protocolVersion: MCP_PROTOCOL_VERSION,
        message: "Use POST /mcp with JSON-RPC 2.0"
      });
      return;
    }
    if (req.method !== "POST" || pathname !== "/mcp") {
      this.sendMcpError(res, null, -32601, "Method not found");
      return;
    }
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const queryToken = requestUrl.searchParams.get("key");
    const token = bearerToken || queryToken;
    if (!token || token !== this.config.apiKey) {
      this.sendMcpError(res, null, -32001, "API 密钥无效");
      return;
    }
    try {
      const body = await this.readBody(req);
      await this.handleMcpRequest(res, body);
    } catch (error) {
      console.error("[McpServer] 请求处理失败:", error);
      this.sendMcpError(
        res,
        null,
        -32603,
        error instanceof Error ? error.message : "Internal error"
      );
    }
  }
  /**
   * 读取并解析请求体，仅接受 JSON 对象。
   */
  readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const maxBodySize = 1024 * 1024;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBodySize) {
          reject(new Error("请求体过大"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("无效的 JSON 格式"));
        }
      });
      req.on("error", reject);
    });
  }
  /**
   * 校验 JSON-RPC 基础结构，并将请求转发到 MCP 路由层。
   */
  async handleMcpRequest(res, body) {
    const request = body;
    const id = request.id ?? null;
    try {
      if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || !request.method) {
        this.sendMcpError(res, id, -32600, "Invalid Request");
        return;
      }
      const result = await this.routeMcpRequest(request);
      if (request.id === void 0) {
        this.sendNoContent(res);
        return;
      }
      this.sendMcpResult(res, id, result);
    } catch (error) {
      if (error instanceof McpProtocolError) {
        this.sendMcpError(res, id, error.code, error.message, error.data);
        return;
      }
      this.sendMcpError(res, id, -32603, error instanceof Error ? error.message : "Internal error");
    }
  }
  /**
   * 路由 MCP 方法。
   * 当前仅实现 initialize、ping、tools/list、tools/call 等基础能力。
   */
  async routeMcpRequest(request) {
    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "ztools-mcp",
            version: electron.app.getVersion()
          }
        };
      case "notifications/initialized":
        return {};
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: pluginToolsAPI.getAllDeclaredToolEntries({ includeDisabled: false }).map((tool) => ({
            name: tool.mcpName,
            title: `${tool.pluginName} / ${tool.toolName}`,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        };
      case "tools/call":
        return await this.handleToolCall(request.params);
      default:
        throw new McpProtocolError(-32601, `Method not found: ${request.method}`);
    }
  }
  /**
   * 执行 tools/call：
   * 先解析工具名，再按需唤起插件，最后调用 preload 中注册的 handler。
   */
  async handleToolCall(params) {
    const toolName = typeof params?.name === "string" ? params.name : "";
    if (!toolName) {
      throw new McpProtocolError(-32602, "tools/call 缺少 name 参数");
    }
    const toolEntry = pluginToolsAPI.getAllDeclaredToolEntries({ includeDisabled: false }).find((tool) => tool.mcpName === toolName);
    if (!toolEntry) {
      throw new McpProtocolError(-32602, `未找到工具: ${toolName}`);
    }
    const webContents = await pluginToolsAPI.ensurePluginToolReady(
      toolEntry.pluginPath,
      toolEntry.toolName
    );
    if (!webContents) {
      throw new McpProtocolError(-32e3, `插件 "${toolEntry.pluginName}" 未能就绪`);
    }
    const result = await pluginToolsAPI.executeRegisteredTool(
      webContents,
      toolEntry.toolName,
      params?.arguments ?? {}
    );
    if (result && typeof result === "object" && Array.isArray(result.content)) {
      return { content: result.content };
    }
    return {
      // 同时返回文本结果和结构化结果，方便标准 MCP 客户端和调试工具消费。
      content: [
        {
          type: "text",
          text: this.stringifyToolResult(result)
        }
      ],
      ...result !== void 0 ? { structuredContent: result } : {}
    };
  }
  /**
   * 将任意工具返回值转成 MCP 文本内容，便于通用客户端展示。
   */
  stringifyToolResult(result) {
    if (typeof result === "string") return result;
    if (result === void 0) return "";
    return JSON.stringify(result);
  }
  /**
   * 发送 JSON-RPC 成功结果。
   */
  sendMcpResult(res, id, result) {
    const response = {
      jsonrpc: "2.0",
      id,
      result
    };
    this.sendRawJson(res, 200, response);
  }
  /**
   * 发送 JSON-RPC 错误结果。
   */
  sendMcpError(res, id, code, message, data) {
    const response = {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        ...data !== void 0 ? { data } : {}
      }
    };
    this.sendRawJson(res, 200, response);
  }
}
const mcpServer = new McpServer();
const analysisCache = /* @__PURE__ */ new Map();
async function analyzeImage(imagePath) {
  try {
    let imageBuffer;
    if (imagePath.startsWith("ztools-icon://")) {
      return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
    } else if (imagePath.startsWith("data:image/")) {
      const base64Data = imagePath.split(",")[1];
      imageBuffer = Buffer.from(base64Data, "base64");
    } else if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
      return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
    } else {
      let filePath = imagePath;
      if (filePath.startsWith("file:")) {
        try {
          filePath = url.fileURLToPath(filePath);
        } catch (error) {
          console.error("[ImageAnalysis] 无效的 file:// URL:", filePath, error);
          return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
        }
      }
      const appPath = electron.app.getAppPath();
      if (filePath.startsWith("/src/")) {
        const relativePath = filePath.substring(1);
        filePath = path.join(appPath, "src", "renderer", relativePath);
      } else if (filePath.startsWith("./assets/") || filePath.startsWith("assets/")) {
        const assetPath = filePath.replace(/^\.\//, "");
        if (utils.is.dev) {
          const distPath = path.join(appPath, "out", "renderer", assetPath);
          try {
            await fs$1.access(distPath);
            filePath = distPath;
          } catch {
            filePath = path.join(appPath, "src", "renderer", assetPath);
          }
        } else {
          filePath = path.join(appPath, "out", "renderer", assetPath);
        }
      } else if (!path.isAbsolute(filePath)) {
        filePath = path.join(appPath, filePath);
      }
      imageBuffer = await fs$1.readFile(filePath);
    }
    const bufferHash = crypto.createHash("md5").update(imageBuffer).digest("hex");
    if (analysisCache.has(bufferHash)) {
      return analysisCache.get(bufferHash);
    }
    const image = electron.nativeImage.createFromBuffer(imageBuffer);
    if (image.isEmpty()) {
      const result2 = { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
      analysisCache.set(bufferHash, result2);
      return result2;
    }
    const size = image.getSize();
    const data = image.toBitmap();
    const totalPixels = size.width * size.height;
    const targetSamples = 1600;
    const step = Math.max(1, Math.floor(totalPixels / targetSamples));
    const colorMap = /* @__PURE__ */ new Map();
    let opaquePixels = 0;
    let totalSampled = 0;
    let mainColor = "";
    let maxCount = 0;
    for (let i = 0; i < data.length; i += 4 * step) {
      if (i + 3 >= data.length) break;
      const a = data[i + 3];
      totalSampled++;
      if (a > 20) {
        opaquePixels++;
        const b2 = data[i];
        const g2 = data[i + 1];
        const r2 = data[i + 2];
        const key = `${r2},${g2},${b2}`;
        const count = (colorMap.get(key) || 0) + 1;
        colorMap.set(key, count);
        if (count > maxCount) {
          maxCount = count;
          mainColor = key;
        }
      }
    }
    if (opaquePixels === 0) {
      const result2 = { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
      analysisCache.set(bufferHash, result2);
      return result2;
    }
    const [mainR, mainG, mainB] = mainColor.split(",").map(Number);
    const colorThreshold = 30;
    let similarPixels = 0;
    for (let i = 0; i < data.length; i += 4 * step) {
      if (i + 3 >= data.length) break;
      const a = data[i + 3];
      if (a > 20) {
        const b2 = data[i];
        const g2 = data[i + 1];
        const r2 = data[i + 2];
        const distance = Math.sqrt(
          Math.pow(r2 - mainR, 2) + Math.pow(g2 - mainG, 2) + Math.pow(b2 - mainB, 2)
        );
        if (distance < colorThreshold) {
          similarPixels++;
        }
      }
    }
    const transparencyRatio = (totalSampled - opaquePixels) / totalSampled;
    const similarityRatio = similarPixels / opaquePixels;
    const isPureColorIcon = similarityRatio > 0.85 && transparencyRatio > 0.1 && opaquePixels > 20;
    const [r, g, b] = mainColor.split(",").map(Number);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const isDark = luminance < 0.5;
    const hexColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    if (!isPureColorIcon) {
      const result2 = { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
      analysisCache.set(bufferHash, result2);
      return result2;
    }
    const result = {
      isSimpleIcon: true,
      mainColor: hexColor,
      isDark,
      needsAdaptation: true
    };
    analysisCache.set(bufferHash, result);
    return result;
  } catch (error) {
    console.error("[ImageAnalysis] 图片分析失败:", error);
    return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
  }
}
function setupImageAnalysisAPI() {
  electron.ipcMain.handle("analyze-image", async (_event, imagePath) => {
    try {
      return await analyzeImage(imagePath);
    } catch (error) {
      console.error("[ImageAnalysis] 图片分析失败:", error);
      return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false };
    }
  });
}
const COMMAND_ALIASES_KEY = "command-aliases";
function normalizeCommandAliases(store) {
  const normalized = {};
  for (const [commandId, aliases] of Object.entries(store || {})) {
    const nextAliases = Array.from(
      new Map(
        (aliases || []).map((aliasEntry) => {
          if (typeof aliasEntry === "string") {
            return { alias: aliasEntry.trim(), icon: void 0 };
          }
          return {
            alias: (aliasEntry?.alias || "").trim(),
            icon: aliasEntry?.icon || void 0
          };
        }).filter((aliasEntry) => Boolean(aliasEntry.alias)).map((aliasEntry) => [aliasEntry.alias, aliasEntry])
      ).values()
    );
    if (nextAliases.length > 0) {
      normalized[commandId] = nextAliases;
    }
  }
  return normalized;
}
class PermissionDeniedError extends Error {
  constructor(apiName) {
    super(`API "${apiName}" 仅限内置插件调用`);
    this.name = "PermissionDeniedError";
  }
}
function requireInternalPlugin(pluginManager2, event) {
  if (!pluginManager2) return true;
  const pluginInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
  if (!pluginInfo) {
    return true;
  }
  return pluginInfo.canUseInternalApi;
}
class InternalPluginAPI {
  /** 当前用于鉴权和插件查询的插件管理器。 */
  pluginManager = null;
  /** 当前主窗口实例，供部分内部能力复用。 */
  mainWindow = null;
  /**
   * 初始化内置插件专用 API，并注册对应的 IPC 通道。
   */
  init(mainWindow, pluginManager2) {
    this.mainWindow = mainWindow;
    this.pluginManager = pluginManager2;
    this.setupIPC();
  }
  /**
   * 注册仅允许内置插件访问的 IPC 能力。
   */
  setupIPC() {
    electron.ipcMain.handle("internal:db-put", (event, key, value) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:db-put");
      }
      return databaseAPI.dbPut(key, value);
    });
    electron.ipcMain.handle("internal:db-get", (event, key) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:db-get");
      }
      return databaseAPI.dbGet(key);
    });
    electron.ipcMain.handle("internal:launch", async (event, options) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:launch");
      }
      console.log("[Internal] 启动应用", options);
      return await appsAPI.launch(options);
    });
    electron.ipcMain.handle("internal:quit-app", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:quit-app");
      }
      windowManager.setQuitting(true);
      electron.app.quit();
      return { success: true };
    });
    electron.ipcMain.handle("internal:get-commands", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-commands");
      }
      console.log("[Internal] 收到获取指令列表请求（设置页 alias 目标）");
      const result = await appsAPI.getCommands();
      console.log("[Internal] 返回指令列表摘要:", {
        commands: result.commands?.length || 0,
        regexCommands: result.regexCommands?.length || 0,
        plugins: result.plugins?.length || 0
      });
      return result;
    });
    electron.ipcMain.handle("internal:update-command-aliases", async (event, aliases) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-command-aliases");
      }
      const inputCommandCount = Object.keys(aliases || {}).length;
      const inputAliasCount = Object.values(aliases || {}).reduce(
        (count, entries) => count + (Array.isArray(entries) ? entries.length : 0),
        0
      );
      console.log("[Internal] 收到更新指令别名请求:", {
        commandCount: inputCommandCount,
        aliasCount: inputAliasCount
      });
      const normalizedAliases = normalizeCommandAliases(aliases);
      const normalizedCommandCount = Object.keys(normalizedAliases).length;
      const normalizedAliasEntries = Object.values(normalizedAliases).flat();
      console.log("[Internal] 指令别名归一化完成:", {
        commandCount: normalizedCommandCount,
        aliasCount: normalizedAliasEntries.length,
        aliasWithIconCount: normalizedAliasEntries.filter((entry) => Boolean(entry.icon)).length
      });
      try {
        const saveResult = databaseAPI.dbPut(COMMAND_ALIASES_KEY, normalizedAliases);
        if (!saveResult?.ok) {
          console.error("[Internal] 指令别名写入数据库失败:", saveResult);
          throw new Error(saveResult?.message || "指令别名写入数据库失败");
        }
        console.log("[Internal] 指令别名已写入数据库:", {
          key: COMMAND_ALIASES_KEY,
          commandCount: normalizedCommandCount,
          aliasCount: normalizedAliasEntries.length
        });
        this.mainWindow?.webContents.send("command-aliases-changed");
        console.log("[Internal] 已通知主窗口按当前缓存刷新 alias 搜索索引");
        return { success: true };
      } catch (error) {
        console.error("[Internal] 更新指令别名失败:", error);
        throw error;
      }
    });
    electron.ipcMain.handle("internal:get-plugins", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-plugins");
      }
      return await pluginsAPI.getPlugins();
    });
    electron.ipcMain.handle("internal:get-disabled-plugins", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-disabled-plugins");
      }
      return pluginsAPI.getDisabledPlugins();
    });
    electron.ipcMain.handle(
      "internal:set-plugin-disabled",
      async (event, pluginPath, disabled) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:set-plugin-disabled");
        }
        return await pluginsAPI.setPluginDisabled(pluginPath, disabled);
      }
    );
    electron.ipcMain.handle("internal:get-all-plugins", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-all-plugins");
      }
      return await pluginsAPI.getAllPlugins();
    });
    electron.ipcMain.handle(
      "internal:set-plugin-main-push-disabled",
      async (event, pluginName, disabled) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:set-plugin-main-push-disabled");
        }
        return await pluginsAPI.setPluginMainPushDisabled(pluginName, disabled);
      }
    );
    electron.ipcMain.handle("internal:select-plugin-file", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:select-plugin-file");
      }
      return await pluginsAPI.installer.selectPluginFile();
    });
    electron.ipcMain.handle("internal:import-plugin", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:import-plugin");
      }
      return await pluginsAPI.installer.importPlugin();
    });
    electron.ipcMain.handle("internal:read-plugin-info-from-zpx", async (event, zpxPath) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:read-plugin-info-from-zpx");
      }
      return await pluginsAPI.installer.readPluginInfoFromZpx(zpxPath);
    });
    electron.ipcMain.handle("internal:install-plugin-from-path", async (event, zpxPath) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:install-plugin-from-path");
      }
      return await pluginsAPI.installer.installPluginFromPath(zpxPath);
    });
    electron.ipcMain.handle("internal:import-dev-plugin", async (event, pluginJsonPath) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:import-dev-plugin");
      }
      return await pluginsAPI.devProjects.importDevPlugin(pluginJsonPath);
    });
    electron.ipcMain.handle(
      "internal:scaffold-dev-project",
      async (event, params) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:scaffold-dev-project");
        }
        return await pluginsAPI.devProjects.scaffoldDevProject(params);
      }
    );
    electron.ipcMain.handle(
      "internal:update-dev-project-meta",
      async (event, projectName, meta) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-dev-project-meta");
        }
        return await pluginsAPI.devProjects.updateDevProjectMeta(projectName, meta);
      }
    );
    electron.ipcMain.handle(
      "internal:upsert-dev-project-by-config-path",
      async (event, pluginJsonPath) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:upsert-dev-project-by-config-path");
        }
        return await pluginsAPI.devProjects.upsertDevProjectByConfigPath(pluginJsonPath);
      }
    );
    electron.ipcMain.handle("internal:get-dev-projects", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-dev-projects");
      }
      return await pluginsAPI.devProjects.getDevProjects();
    });
    electron.ipcMain.handle("internal:update-dev-projects-order", async (event, pluginNames) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-dev-projects-order");
      }
      return await pluginsAPI.devProjects.updateDevProjectsOrder(pluginNames);
    });
    electron.ipcMain.handle("internal:remove-dev-project", async (event, pluginName) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:remove-dev-project");
      }
      return await pluginsAPI.devProjects.removeDevProject(pluginName);
    });
    electron.ipcMain.handle("internal:install-dev-plugin", async (event, pluginName) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:install-dev-plugin");
      }
      return await pluginsAPI.devProjects.installDevPlugin(pluginName);
    });
    electron.ipcMain.handle("internal:uninstall-dev-plugin", async (event, pluginName) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:uninstall-dev-plugin");
      }
      return await pluginsAPI.devProjects.uninstallDevPlugin(pluginName);
    });
    electron.ipcMain.handle("internal:validate-dev-project", async (event, pluginName) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:validate-dev-project");
      }
      return await pluginsAPI.devProjects.validateDevProject(pluginName);
    });
    electron.ipcMain.handle(
      "internal:select-dev-project-config",
      async (event, pluginName, configPath) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:select-dev-project-config");
        }
        return await pluginsAPI.devProjects.selectDevProjectConfig(pluginName, configPath);
      }
    );
    electron.ipcMain.handle(
      "internal:package-dev-project",
      async (event, pluginName, packagePath, version) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:package-dev-project");
        }
        return await pluginsAPI.devProjects.packageDevProject(pluginName, packagePath, version);
      }
    );
    electron.ipcMain.handle(
      "internal:delete-plugin",
      async (event, pluginPath, options) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:delete-plugin");
        }
        return await pluginsAPI.deletePlugin(pluginPath, options);
      }
    );
    electron.ipcMain.handle("internal:get-running-plugins", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-running-plugins");
      }
      return pluginsAPI.getRunningPlugins();
    });
    electron.ipcMain.handle("internal:kill-plugin", async (event, pluginPath) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:kill-plugin");
      }
      return pluginsAPI.killPlugin(pluginPath);
    });
    electron.ipcMain.handle("internal:fetch-plugin-market", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:fetch-plugin-market");
      }
      return await pluginsAPI.market.fetchPluginMarket();
    });
    electron.ipcMain.handle("internal:install-plugin-from-market", async (event, plugin) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:install-plugin-from-market");
      }
      return await pluginsAPI.installer.installPluginFromMarket(plugin, event.sender);
    });
    electron.ipcMain.handle(
      "internal:cancel-plugin-market-download",
      async (event, pluginNameOrTaskId) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:cancel-plugin-market-download");
        }
        return pluginsAPI.installer.cancelPluginMarketDownload(pluginNameOrTaskId);
      }
    );
    electron.ipcMain.handle(
      "internal:install-plugin-from-npm",
      async (event, options) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:install-plugin-from-npm");
        }
        return await pluginsAPI.installer.installPluginFromNpm(
          options.packageName,
          options.useChinaMirror
        );
      }
    );
    electron.ipcMain.handle(
      "internal:get-plugin-readme",
      async (event, pluginPathOrName, pluginName) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:get-plugin-readme");
        }
        return await pluginsAPI.getPluginReadme(pluginPathOrName, pluginName);
      }
    );
    electron.ipcMain.handle("internal:get-plugin-doc-keys", async (event, pluginName) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-plugin-doc-keys");
      }
      return await databaseAPI.getPluginDocKeys(pluginName);
    });
    electron.ipcMain.handle("internal:get-plugin-doc", async (event, pluginName, docKey) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-plugin-doc");
      }
      return await databaseAPI.getPluginDoc(pluginName, docKey);
    });
    electron.ipcMain.handle("internal:get-plugin-data-stats", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-plugin-data-stats");
      }
      return await databaseAPI.getPluginDataStats();
    });
    electron.ipcMain.handle("internal:clear-plugin-data", async (event, pluginName) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:clear-plugin-data");
      }
      return await databaseAPI.clearPluginData(pluginName);
    });
    electron.ipcMain.handle("internal:export-all-plugins", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:export-all-plugins");
      }
      return await pluginsAPI.installer.exportAllPlugins();
    });
    electron.ipcMain.handle("internal:get-plugin-memory-info", async (event, pluginPath) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-plugin-memory-info");
      }
      try {
        const memoryInfo = await this.pluginManager?.getPluginMemoryInfo(pluginPath);
        return { success: true, data: memoryInfo };
      } catch (error) {
        console.error("[Internal API] 获取内存信息失败:", error);
        return { success: false, error: error instanceof Error ? error.message : "获取失败" };
      }
    });
    electron.ipcMain.handle("internal:ai-models-get-all", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:ai-models-get-all");
      }
      try {
        const models = aiModelsAPI.getAllModels();
        return { success: true, data: models };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("internal:ai-models-add", async (event, model) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:ai-models-add");
      }
      return await aiModelsAPI.addModel(model);
    });
    electron.ipcMain.handle("internal:ai-models-update", async (event, model) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:ai-models-update");
      }
      return await aiModelsAPI.updateModel(model);
    });
    electron.ipcMain.handle("internal:ai-models-delete", async (event, modelId) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:ai-models-delete");
      }
      return await aiModelsAPI.deleteModel(modelId);
    });
    electron.ipcMain.handle(
      "internal:register-global-shortcut",
      async (event, shortcut, target) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:register-global-shortcut");
        }
        return settingsAPI.registerGlobalShortcut(shortcut, target);
      }
    );
    electron.ipcMain.handle("internal:unregister-global-shortcut", async (event, shortcut) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:unregister-global-shortcut");
      }
      return settingsAPI.unregisterGlobalShortcut(shortcut);
    });
    electron.ipcMain.handle("internal:start-hotkey-recording", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:start-hotkey-recording");
      }
      return await settingsAPI.startHotkeyRecording();
    });
    electron.ipcMain.handle("internal:update-shortcut", async (event, shortcut) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-shortcut");
      }
      return await settingsAPI.updateShortcut(shortcut);
    });
    electron.ipcMain.handle(
      "internal:register-app-shortcut",
      async (event, shortcut, target) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:register-app-shortcut");
        }
        return settingsAPI.registerAppShortcut(shortcut, target);
      }
    );
    electron.ipcMain.handle("internal:unregister-app-shortcut", async (event, shortcut) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:unregister-app-shortcut");
      }
      return settingsAPI.unregisterAppShortcut(shortcut);
    });
    electron.ipcMain.handle("internal:set-window-opacity", async (event, opacity) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:set-window-opacity");
      }
      return await windowAPI.setWindowOpacity(opacity);
    });
    electron.ipcMain.handle("internal:set-window-default-height", async (event, height) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:set-window-default-height");
      }
      return await settingsAPI.setWindowDefaultHeight(height);
    });
    electron.ipcMain.handle("internal:select-avatar", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:select-avatar");
      }
      return await systemAPI.selectAvatar();
    });
    electron.ipcMain.handle("internal:set-theme", async (event, theme) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:set-theme");
      }
      return await settingsAPI.setTheme(theme);
    });
    electron.ipcMain.handle("internal:set-tray-icon-visible", async (event, visible) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:set-tray-icon-visible");
      }
      return await windowAPI.setTrayIconVisible(visible);
    });
    electron.ipcMain.handle(
      "internal:set-window-material",
      async (event, material) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:set-window-material");
        }
        return await windowAPI.setWindowMaterial(material);
      }
    );
    electron.ipcMain.handle("internal:get-window-material", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-window-material");
      }
      return await windowAPI.getWindowMaterial();
    });
    electron.ipcMain.handle("internal:set-launch-at-login", async (event, enabled) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:set-launch-at-login");
      }
      return await settingsAPI.setLaunchAtLogin(enabled);
    });
    electron.ipcMain.handle("internal:get-launch-at-login", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-launch-at-login");
      }
      return await settingsAPI.getLaunchAtLogin();
    });
    electron.ipcMain.handle(
      "internal:set-proxy-config",
      async (event, config) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:set-proxy-config");
        }
        return await settingsAPI.setProxyConfig(config);
      }
    );
    electron.ipcMain.handle("internal:update-placeholder", async (event, placeholder) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-placeholder");
      }
      this.mainWindow?.webContents.send("update-placeholder", placeholder);
      return { success: true };
    });
    electron.ipcMain.handle("internal:update-avatar", async (event, avatar) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-avatar");
      }
      this.mainWindow?.webContents.send("update-avatar", avatar);
      superPanelManager.broadcastToSuperPanel("update-avatar", avatar);
      return { success: true };
    });
    electron.ipcMain.handle("internal:update-auto-paste", async (event, autoPaste) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-auto-paste");
      }
      this.mainWindow?.webContents.send("update-auto-paste", autoPaste);
      return { success: true };
    });
    electron.ipcMain.handle("internal:update-auto-clear", async (event, autoClear) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-auto-clear");
      }
      this.mainWindow?.webContents.send("update-auto-clear", autoClear);
      return { success: true };
    });
    electron.ipcMain.handle(
      "internal:update-auto-back-to-search",
      async (event, autoBackToSearch) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-auto-back-to-search");
        }
        await windowAPI.updateAutoBackToSearch(autoBackToSearch);
        return { success: true };
      }
    );
    electron.ipcMain.handle(
      "internal:update-show-recent-in-search",
      async (event, showRecentInSearch) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-show-recent-in-search");
        }
        this.mainWindow?.webContents.send("update-show-recent-in-search", showRecentInSearch);
        return { success: true };
      }
    );
    electron.ipcMain.handle(
      "internal:update-match-recommendation",
      async (event, showMatchRecommendation) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-match-recommendation");
        }
        this.mainWindow?.webContents.send("update-match-recommendation", showMatchRecommendation);
        return { success: true };
      }
    );
    electron.ipcMain.handle("internal:update-recent-rows", async (event, rows) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-recent-rows");
      }
      this.mainWindow?.webContents.send("update-recent-rows", rows);
      return { success: true };
    });
    electron.ipcMain.handle("internal:update-pinned-rows", async (event, rows) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-pinned-rows");
      }
      this.mainWindow?.webContents.send("update-pinned-rows", rows);
      return { success: true };
    });
    electron.ipcMain.handle("internal:update-search-mode", async (event, mode) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-search-mode");
      }
      this.mainWindow?.webContents.send("update-search-mode", mode);
      return { success: true };
    });
    electron.ipcMain.handle("internal:update-tab-target", async (event, target) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-tab-target");
      }
      this.mainWindow?.webContents.send("update-tab-target", target);
      return { success: true };
    });
    electron.ipcMain.handle(
      "internal:update-tab-key-function",
      async (event, mode) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-tab-key-function");
        }
        this.mainWindow?.webContents.send("update-tab-key-function", mode);
        return { success: true };
      }
    );
    electron.ipcMain.handle("internal:update-space-open-command", async (event, enabled) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-space-open-command");
      }
      this.mainWindow?.webContents.send("update-space-open-command", enabled);
      return { success: true };
    });
    electron.ipcMain.handle(
      "internal:update-floating-ball-double-click-command",
      async (event, command) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-floating-ball-double-click-command");
        }
        this.mainWindow?.webContents.send("update-floating-ball-double-click-command", command);
        floatingBallManager.setDoubleClickCommand(command);
        return { success: true };
      }
    );
    electron.ipcMain.handle("internal:update-local-app-search", async (event, enabled) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-local-app-search");
      }
      appsAPI.setLocalAppSearch(enabled);
      return { success: true };
    });
    electron.ipcMain.handle(
      "internal:update-primary-color",
      async (event, primaryColor, customColor) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-primary-color");
        }
        const data = { primaryColor, customColor };
        this.mainWindow?.webContents.send("update-primary-color", data);
        detachedWindowManager.broadcastToAllWindows("update-primary-color", data);
        windowManager.notifyThemeInfoChanged();
        return { success: true };
      }
    );
    electron.ipcMain.handle(
      "internal:update-acrylic-opacity",
      async (event, lightOpacity, darkOpacity) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-acrylic-opacity");
        }
        this.mainWindow?.webContents.send("update-acrylic-opacity", { lightOpacity, darkOpacity });
        detachedWindowManager.broadcastToAllWindows("update-acrylic-opacity", {
          lightOpacity,
          darkOpacity
        });
        return { success: true };
      }
    );
    electron.ipcMain.on("internal:get-platform", (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        event.returnValue = null;
        return;
      }
      event.returnValue = process.platform;
    });
    electron.ipcMain.handle("internal:updater-check-update", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:updater-check-update");
      }
      return await updaterAPI.checkUpdate();
    });
    electron.ipcMain.handle("internal:updater-start-update", async (event, updateInfo) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:updater-start-update");
      }
      return await updaterAPI.startUpdate(updateInfo);
    });
    electron.ipcMain.handle("internal:updater-set-auto-check", async (event, enabled) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:updater-set-auto-check");
      }
      updaterAPI.setAutoCheck(enabled);
      return { success: true };
    });
    electron.ipcMain.handle("internal:reveal-in-finder", async (event, path2) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:reveal-in-finder");
      }
      return await systemAPI.revealInFinder(path2);
    });
    electron.ipcMain.handle("internal:notify-disabled-commands-changed", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:notify-disabled-commands-changed");
      }
      this.mainWindow?.webContents.send("disabled-commands-changed");
      return { success: true };
    });
    electron.ipcMain.handle("internal:pin-app", async (event, app2) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:pin-app");
      }
      return appsAPI.pinApp(app2);
    });
    electron.ipcMain.handle(
      "internal:unpin-app",
      async (event, appPath, featureCode, name) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:unpin-app");
        }
        return appsAPI.unpinApp(appPath, featureCode, name);
      }
    );
    electron.ipcMain.handle(
      "internal:update-super-panel-config",
      async (event, config) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-super-panel-config");
        }
        superPanelManager.updateConfig(config);
        return { success: true };
      }
    );
    electron.ipcMain.handle(
      "internal:update-super-panel-blocked-apps",
      async (event, blockedApps) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-super-panel-blocked-apps");
        }
        superPanelManager.updateBlockedApps(blockedApps);
        return { success: true };
      }
    );
    electron.ipcMain.handle(
      "internal:update-wakeup-blacklist",
      async (event, blacklist) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:update-wakeup-blacklist");
        }
        windowManager.updateWakeupBlacklist(blacklist);
        return { success: true };
      }
    );
    electron.ipcMain.handle("internal:get-current-window-info", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-current-window-info");
      }
      return clipboardManager.getCurrentWindow();
    });
    electron.ipcMain.handle("internal:update-super-panel-translate", async (event, enabled) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:update-super-panel-translate");
      }
      translationManager.updateEnabled(enabled);
      return { success: true };
    });
    electron.ipcMain.handle("internal:get-translation-status", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:get-translation-status");
      }
      return translationManager.getStatus();
    });
    electron.ipcMain.handle("internal:analyze-image", async (event, imagePath) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:analyze-image");
      }
      return await analyzeImage(imagePath);
    });
    electron.ipcMain.handle("internal:web-search-get-all", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:web-search-get-all");
      }
      try {
        const engines = webSearchAPI.getAllEngines();
        return { success: true, data: engines };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("internal:web-search-add", async (event, engine) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:web-search-add");
      }
      return await webSearchAPI.addEngine(engine);
    });
    electron.ipcMain.handle("internal:web-search-update", async (event, engine) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:web-search-update");
      }
      return await webSearchAPI.updateEngine(engine);
    });
    electron.ipcMain.handle("internal:web-search-delete", async (event, engineId) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:web-search-delete");
      }
      return await webSearchAPI.deleteEngine(engineId);
    });
    electron.ipcMain.handle("internal:web-search-fetch-favicon", async (event, url2) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:web-search-fetch-favicon");
      }
      try {
        const icon = await webSearchAPI.fetchFavicon(url2);
        return { success: true, data: icon };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("internal:log-enable", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:log-enable");
      }
      logCollector.enable(event.sender);
      return { success: true };
    });
    electron.ipcMain.handle("internal:log-disable", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:log-disable");
      }
      logCollector.disable(event.sender);
      return { success: true };
    });
    electron.ipcMain.handle("internal:log-get-buffer", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:log-get-buffer");
      }
      return logCollector.getBufferedLogs();
    });
    electron.ipcMain.handle("internal:log-is-enabled", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:log-is-enabled");
      }
      return logCollector.isEnabled();
    });
    electron.ipcMain.handle("internal:log-subscribe", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:log-subscribe");
      }
      logCollector.addSubscriber(event.sender);
      return { success: true };
    });
    electron.ipcMain.handle("internal:http-server-get-config", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:http-server-get-config");
      }
      try {
        const config = httpServer.getConfig();
        return { success: true, config };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "获取配置失败"
        };
      }
    });
    electron.ipcMain.handle(
      "internal:http-server-save-config",
      async (event, config) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:http-server-save-config");
        }
        try {
          const wasRunning = httpServer.isRunning();
          const savedConfig = await httpServer.saveConfig(config);
          if (savedConfig.enabled && !wasRunning) {
            httpServer.start();
          } else if (!savedConfig.enabled && wasRunning) {
            httpServer.stop();
          } else if (savedConfig.enabled && wasRunning) {
            httpServer.stop();
            httpServer.start();
          }
          return { success: true, config: savedConfig };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "保存配置失败"
          };
        }
      }
    );
    electron.ipcMain.handle("internal:http-server-regenerate-key", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:http-server-regenerate-key");
      }
      try {
        const newKey = httpServer.generateApiKey();
        await httpServer.saveConfig({ apiKey: newKey });
        return { success: true, apiKey: newKey };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "重新生成密钥失败"
        };
      }
    });
    electron.ipcMain.handle("internal:http-server-status", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:http-server-status");
      }
      return { success: true, running: httpServer.isRunning() };
    });
    electron.ipcMain.handle("internal:mcp-server-get-config", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:mcp-server-get-config");
      }
      try {
        const config = mcpServer.getConfig();
        return { success: true, config };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "获取配置失败"
        };
      }
    });
    electron.ipcMain.handle(
      "internal:mcp-server-save-config",
      async (event, config) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError("internal:mcp-server-save-config");
        }
        try {
          const wasRunning = mcpServer.isRunning();
          const savedConfig = await mcpServer.saveConfig(config);
          if (savedConfig.enabled && !wasRunning) {
            mcpServer.start();
          } else if (!savedConfig.enabled && wasRunning) {
            mcpServer.stop();
          } else if (savedConfig.enabled && wasRunning) {
            mcpServer.stop();
            mcpServer.start();
          }
          return { success: true, config: savedConfig };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "保存配置失败"
          };
        }
      }
    );
    electron.ipcMain.handle("internal:mcp-server-regenerate-key", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:mcp-server-regenerate-key");
      }
      try {
        const newKey = mcpServer.generateApiKey();
        await mcpServer.saveConfig({ apiKey: newKey });
        return { success: true, apiKey: newKey };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "重新生成密钥失败"
        };
      }
    });
    electron.ipcMain.handle("internal:mcp-server-status", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:mcp-server-status");
      }
      return { success: true, running: mcpServer.isRunning() };
    });
    electron.ipcMain.handle("internal:mcp-server-tools", async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError("internal:mcp-server-tools");
      }
      return {
        success: true,
        // 返回所有已安装插件声明的工具，供设置页展示与调试。
        data: pluginToolsAPI.getAllDeclaredToolEntries()
      };
    });
  }
}
const internalPluginAPI = new InternalPluginAPI();
class PluginLifecycleAPI {
  pluginManager = null;
  launchParam = null;
  mainWindow = null;
  init(mainWindow, pluginManager2) {
    this.pluginManager = pluginManager2;
    this.mainWindow = mainWindow;
    this.setupIPC();
  }
  setLaunchParam(param) {
    this.launchParam = param;
  }
  setupIPC() {
    electron.ipcMain.handle("onPluginEnter", () => {
      console.log("[PluginLifecycle] 收到插件进入事件:", this.launchParam);
      return this.launchParam;
    });
    electron.ipcMain.handle("out-plugin", (event, isKill = false) => {
      console.log("[PluginLifecycle] out-plugin", isKill);
      const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
      console.log("[PluginLifecycle] pluginInfo", pluginInfo);
      if (!pluginInfo) {
        return false;
      }
      this.pluginManager?.hidePluginView();
      windowManager.notifyBackToSearch();
      this.mainWindow?.webContents.focus();
      if (isKill) {
        return this.pluginManager?.killPlugin(pluginInfo.path);
      } else {
        event.sender.send("plugin-out", false);
        return true;
      }
    });
  }
}
const pluginLifecycleAPI = new PluginLifecycleAPI();
const pluginApiServices = {};
function registerPluginApiServices(services) {
  for (const key of Object.keys(services)) {
    if (pluginApiServices[key]) {
      console.warn(`[plugin.api:register] API "${key}" is being overwritten`);
    }
  }
  Object.assign(pluginApiServices, services);
}
function initPluginApiDispatcher() {
  electron.ipcMain.on("plugin.api", (event, apiName, args) => {
    const handler = pluginApiServices[apiName];
    if (!handler) {
      console.warn(`[plugin.api:dispatch] API "${apiName}" not found`);
      event.returnValue = new Error(`API "${apiName}" not found`);
      return;
    }
    try {
      handler(event, args);
    } catch (e) {
      if (event.returnValue === void 0 || event.returnValue === null) {
        event.returnValue = e instanceof Error ? e : new Error(String(e));
      }
      console.error(`[plugin.api:sync] handler "${apiName}" threw:`, e);
    }
  });
  electron.ipcMain.handle("plugin.api", async (event, apiName, args) => {
    const handler = pluginApiServices[apiName];
    if (!handler) {
      console.warn(`[plugin.api:dispatch] API "${apiName}" not found`);
      throw new Error(`API "${apiName}" not found`);
    }
    try {
      return await handler(event, args);
    } catch (e) {
      console.error(`[plugin.api:async] handler "${apiName}" threw:`, e);
      throw e;
    }
  });
}
class PluginRedirectAPI {
  mainWindow = null;
  pluginManager = null;
  init(mainWindow, pluginManager2) {
    this.mainWindow = mainWindow;
    this.pluginManager = pluginManager2;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.on("ztools-redirect", (event, { label, payload }) => {
      event.returnValue = this.handleRedirect(label, payload);
    });
    electron.ipcMain.on("ztools-redirect-hotkey-setting", (event, cmdLabel) => {
      event.returnValue = this.redirectToSettingPage("Shortcuts", "快捷键", cmdLabel);
    });
    electron.ipcMain.on("ztools-redirect-ai-models-setting", (event) => {
      event.returnValue = this.redirectToSettingPage("AiModels", "AI 模型");
    });
  }
  redirectToSettingPage(router, name, payload) {
    try {
      this.toSearchPage();
      this.mainWindow?.webContents.send("ipc-launch", {
        path: this.getSettingPluginPath(),
        type: "plugin",
        featureCode: `ui.router?router=${router}`,
        name,
        cmdType: "text",
        param: payload ? { payload, type: "text" } : void 0
      });
      return true;
    } catch (error) {
      console.error(`[Redirect] 跳转${name}设置失败:`, error);
      return false;
    }
  }
  /**
   * 检查 cmd 是否匹配当前的 payload
   * @param cmd 指令定义（string 或 object）
   * @param payload 传递的参数
   * @returns { matched: boolean, type?: string } 是否匹配及类型
   */
  isCmdMatchPayload(cmd, payload) {
    const isPayloadEmpty = !payload || typeof payload === "string" && payload.trim() === "" || typeof payload === "object" && Object.keys(payload).length === 0;
    if (isPayloadEmpty) {
      return { matched: typeof cmd === "string", cmd };
    } else {
      if (typeof cmd === "string") {
        return { matched: false };
      }
      const cmdType = cmd.type;
      const matched = cmdType === "regex" || cmdType === "over";
      return { matched, type: cmdType, cmd };
    }
  }
  handleRedirect(label, payload) {
    console.log("[Redirect] 收到插件跳转请求:", { label, payload });
    try {
      this.processRedirect(label, payload);
      return true;
    } catch (error) {
      console.error("[Redirect] 处理插件跳转失败:", error);
      return false;
    }
  }
  processRedirect(label, payload) {
    console.log("[Redirect] processRedirect", label, payload);
    if (payload !== void 0 && payload !== null && typeof payload !== "string") {
      console.log("[Redirect] 暂不支持非字符串类型的 payload:", typeof payload, payload);
      return;
    }
    try {
      const plugins = databaseAPI.dbGet("plugins");
      if (!plugins || !Array.isArray(plugins)) {
        this.showNotification("未找到插件列表");
        return;
      }
      for (const plugin of plugins) {
        const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name);
        plugin.features = [...plugin.features || [], ...dynamicFeatures];
      }
      let targetPlugin = null;
      let targetFeature = null;
      let targetCmdName = "";
      let targetCmdType;
      if (Array.isArray(label)) {
        const [pluginTitle, cmdName] = label;
        targetPlugin = plugins.find((p) => p.title === pluginTitle);
        if (targetPlugin) {
          for (const feature of targetPlugin.features || []) {
            if (feature.cmds && Array.isArray(feature.cmds)) {
              for (const cmd of feature.cmds) {
                const cmdLabel = typeof cmd === "string" ? cmd : cmd.label;
                if (cmdLabel === cmdName) {
                  const matchResult = this.isCmdMatchPayload(cmd, payload);
                  if (matchResult.matched) {
                    targetFeature = feature;
                    targetCmdName = cmdLabel;
                    targetCmdType = matchResult.type;
                    break;
                  }
                }
              }
              if (targetFeature) break;
            }
          }
        }
        if (!targetPlugin || !targetFeature) {
          console.log("[Redirect] 未找到插件或指令:", pluginTitle, cmdName);
          this.showNotification(`未找到插件或指令: ${pluginTitle} - ${cmdName}`);
          return;
        }
        this.launchPlugin(targetPlugin, targetFeature, targetCmdName, {
          payload,
          type: targetCmdType
        });
      } else {
        const matches = [];
        const cmdName = label;
        for (const plugin of plugins) {
          for (const feature of plugin.features || []) {
            if (feature.cmds && Array.isArray(feature.cmds)) {
              for (const cmd of feature.cmds) {
                const cmdLabel = typeof cmd === "string" ? cmd : cmd.label;
                if (cmdLabel === cmdName) {
                  const matchResult = this.isCmdMatchPayload(cmd, payload);
                  if (matchResult.matched) {
                    matches.push({
                      plugin,
                      feature,
                      cmdName: cmdLabel,
                      type: matchResult.type
                    });
                  }
                }
              }
            }
          }
        }
        if (matches.length === 0) {
          this.showNotification(`未找到指令: ${cmdName}`);
          return;
        }
        console.log("[Redirect] 找到多个匹配:", matches);
        if (matches.length === 1) {
          const { plugin, feature, cmdName: matchCmdName, type } = matches[0];
          this.launchPlugin(plugin, feature, matchCmdName, {
            payload,
            type
          });
        } else {
          this.redirectSearch(cmdName, payload);
        }
      }
    } catch (error) {
      console.error("[Redirect] 处理跳转逻辑失败:", error);
      const errorMsg = error instanceof Error ? error.message : "未知错误";
      this.showNotification(`跳转失败: ${errorMsg}`);
    }
  }
  launchPlugin(plugin, feature, cmdName, param) {
    const launchOptions = {
      path: plugin.path,
      type: "plugin",
      featureCode: feature.code,
      name: cmdName,
      cmdType: param.type,
      param
    };
    console.log("[Redirect] 跳转可以直接打开插件:", launchOptions);
    this.toSearchPage();
    this.mainWindow?.webContents.send("ipc-launch", launchOptions);
  }
  toSearchPage() {
    if (this.pluginManager?.getCurrentPluginPath() !== null) {
      console.log("[Redirect] 检测到插件正在显示，先隐藏插件并返回搜索页");
      this.pluginManager?.hidePluginView();
      windowManager.notifyBackToSearch();
    }
  }
  redirectSearch(cmdName, payload) {
    console.log("[Redirect] 跳转到搜索页:", { cmdName, payload });
    this.toSearchPage();
    this.mainWindow?.webContents.send("redirect-search", {
      cmdName,
      payload
    });
  }
  showNotification(body) {
    if (electron.Notification.isSupported()) {
      new electron.Notification({
        title: "ZTools",
        body
      }).show();
    }
  }
  getSettingPluginPath() {
    const plugins = databaseAPI.dbGet("plugins");
    if (!plugins || !Array.isArray(plugins)) {
      throw new Error("未找到插件列表");
    }
    const settingPlugin = plugins.find((p) => p.name === "setting");
    if (!settingPlugin) {
      throw new Error("未找到设置插件");
    }
    return settingPlugin.path;
  }
}
const pluginRedirectAPI = new PluginRedirectAPI();
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
class PluginScreenAPI {
  mainWindow = null;
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle("screen-capture", () => screenCapture(this.mainWindow || void 0));
    electron.ipcMain.on("get-primary-display", (event) => {
      const display = electron.screen.getPrimaryDisplay();
      event.returnValue = display;
    });
    electron.ipcMain.on("get-all-displays", (event) => {
      const displays = electron.screen.getAllDisplays();
      event.returnValue = displays;
    });
    electron.ipcMain.on("get-cursor-screen-point", (event) => {
      const point = electron.screen.getCursorScreenPoint();
      event.returnValue = point;
    });
    electron.ipcMain.on("get-display-nearest-point", (event, point) => {
      const display = electron.screen.getDisplayNearestPoint(point);
      event.returnValue = display;
    });
    electron.ipcMain.on("dip-to-screen-point", (event, point) => {
      const p = electron.screen.dipToScreenPoint(point);
      event.returnValue = p;
    });
    electron.ipcMain.on(
      "dip-to-screen-rect",
      (event, rect) => {
        if (process.platform === "darwin") {
          event.returnValue = rect;
          return;
        }
        const window = electron.BrowserWindow.fromWebContents(event.sender);
        if (!window) {
          console.error("[PluginScreen] 无法获取调用者的窗口");
          event.returnValue = rect;
          return;
        }
        const result = electron.screen.dipToScreenRect(window, rect);
        event.returnValue = result;
      }
    );
    electron.ipcMain.on("screen-to-dip-point", (event, point) => {
      const p = electron.screen.screenToDipPoint(point);
      event.returnValue = p;
    });
    electron.ipcMain.handle("desktop-capture-sources", async (_event, options) => {
      try {
        const sources = await electron.desktopCapturer.getSources(options);
        return sources;
      } catch (error) {
        console.error("[PluginScreen] 获取桌面捕获源失败:", error);
        throw error;
      }
    });
    electron.ipcMain.on("get-os-type", (event) => {
      event.returnValue = os.type();
    });
    electron.ipcMain.handle("screen-color-pick", async () => {
      return new Promise(
        (resolve) => {
          try {
            ColorPicker.start((result) => {
              if (result.success && result.hex) {
                resolve({ success: true, hex: result.hex, rgb: hexToRgb(result.hex) });
              } else {
                resolve({ success: false, hex: null, rgb: null });
              }
            });
          } catch (error) {
            console.error("[PluginScreen] 屏幕取色失败:", error);
            resolve({ success: false, hex: null, rgb: null });
          }
        }
      );
    });
  }
}
const pluginScreenAPI = new PluginScreenAPI();
const MAC_BROWSER_APP_MAP = {
  "com.apple.Safari": "Safari",
  "com.google.Chrome": "Google Chrome",
  "com.microsoft.edgemac": "Microsoft Edge",
  "com.operasoftware.Opera": "Opera",
  "com.vivaldi.Vivaldi": "Vivaldi",
  "com.brave.Browser": "Brave Browser"
};
const WINDOWS_BROWSER_PROCESS_MAP = {
  "chrome.exe": "chrome",
  "firefox.exe": "firefox",
  "MicrosoftEdge.exe": "microsoftedge",
  "iexplore.exe": "iexplore",
  "opera.exe": "opera",
  "brave.exe": "brave",
  "msedge.exe": "msedge"
};
class PluginShellAPI {
  /** 剪贴板管理器，用于获取当前活动窗口信息 */
  clipboardManager = null;
  init(clipboardManager2) {
    this.clipboardManager = clipboardManager2;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.on("shell-open-external", async (event, url2) => {
      try {
        await electron.shell.openExternal(url2);
        event.returnValue = { success: true };
      } catch (error) {
        console.error("[PluginShell] 打开 URL 失败:", error);
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.on("shell-show-item-in-folder", (event, fullPath) => {
      try {
        electron.shell.showItemInFolder(fullPath);
      } catch (error) {
        console.error("[PluginShell] 在文件管理器中显示文件失败:", error);
      }
      event.returnValue = void 0;
    });
    electron.ipcMain.on("shell-open-path", async (event, fullPath) => {
      try {
        const errorMessage = await electron.shell.openPath(fullPath);
        event.returnValue = {
          success: !errorMessage,
          error: errorMessage || void 0
        };
      } catch (error) {
        console.error("[PluginShell] 使用系统默认方式打开文件失败:", error);
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.on("get-file-icon", (event, filePath) => {
      getFileIconAsBase64(filePath).then((icon) => {
        event.returnValue = icon;
      }).catch((error) => {
        console.error("[PluginShell] 获取文件图标失败:", filePath, error);
        event.returnValue = null;
      });
    });
    electron.ipcMain.on("shell-beep", (event) => {
      try {
        electron.shell.beep();
        event.returnValue = { success: true };
      } catch (error) {
        console.error("[PluginShell] 播放系统提示音失败:", error);
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("shell-trash-item", async (_event, fullPath) => {
      try {
        await electron.shell.trashItem(fullPath);
        return { success: true };
      } catch (error) {
        console.error("[PluginShell] 移动文件到回收站失败:", fullPath, error);
        throw new Error(error instanceof Error ? error.message : "移动文件到回收站失败");
      }
    });
    electron.ipcMain.handle("plugin:read-current-folder-path", async () => {
      return this.readCurrentFolderPath();
    });
    electron.ipcMain.handle("plugin:read-current-browser-url", async () => {
      return this.readCurrentBrowserUrl();
    });
  }
  /**
   * 读取当前文件管理器窗口的文件夹路径
   * - macOS: 检查 Finder 并通过 osascript 获取路径
   * - Windows: 检查 Explorer 并通过 COM 或桌面路径获取
   * - Linux: 不支持
   * @returns 文件夹路径字符串
   * @throws 当前窗口不是文件管理器、无法读取路径、或平台不支持时抛出 Error
   */
  async readCurrentFolderPath() {
    const currentPlatform = os.platform();
    if (currentPlatform === "darwin") {
      return this.readCurrentFolderPathMac();
    } else if (currentPlatform === "win32") {
      return this.readCurrentFolderPathWindows();
    } else {
      throw new Error("该平台不支持");
    }
  }
  /**
   * 读取当前浏览器窗口的 URL
   * - macOS: AppleScript 读取当前前台标签页 URL
   * - Windows: 原生层读取当前浏览器地址栏 URL
   * - Linux: 不支持
   */
  async readCurrentBrowserUrl() {
    const currentPlatform = os.platform();
    if (currentPlatform === "darwin") {
      return this.readCurrentBrowserUrlMac();
    } else if (currentPlatform === "win32") {
      return this.readCurrentBrowserUrlWindows();
    } else {
      throw new Error("该平台不支持");
    }
  }
  /**
   * macOS: 通过 AppleScript 查询 Finder 前台窗口路径
   * 先尝试获取前台窗口路径，失败则回退到桌面路径
   */
  async readCurrentFolderPathMac() {
    const windowInfo = this.clipboardManager?.getCurrentWindow();
    if (!windowInfo) {
      console.warn("[PluginShell] readCurrentFolderPath: 未识别到当前活动窗口");
      throw new Error("未识别到当前活动窗口");
    }
    if (windowInfo.bundleId !== "com.apple.finder") {
      console.log(
        `[PluginShell] readCurrentFolderPath: 当前窗口非 Finder (bundleId=${windowInfo.bundleId})`
      );
      throw new Error('当前活动窗口非 "访达" 窗口');
    }
    try {
      const frontWindowPath = await this.execAppleScript(
        'tell application "Finder" to get the POSIX path of (target of front window as alias)'
      );
      const result = frontWindowPath.trim().replace(/\/$/, "");
      console.log(`[PluginShell] readCurrentFolderPath: Finder 窗口路径=${result}`);
      return result;
    } catch {
      console.log("[PluginShell] readCurrentFolderPath: Finder 前台窗口查询失败，回退到桌面路径");
    }
    try {
      const desktopPath = await this.execAppleScript(
        'tell application "Finder" to get the POSIX path of (path to desktop)'
      );
      const result = desktopPath.trim().replace(/\/$/, "");
      console.log(`[PluginShell] readCurrentFolderPath: 桌面路径=${result}`);
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const cleanMsg = errMsg.replace(/^\d+:\d+:\s*execution error:\s*/i, "").trim();
      console.error("[PluginShell] readCurrentFolderPath: AppleScript 执行失败:", cleanMsg);
      throw new Error(cleanMsg);
    }
  }
  /**
   * macOS: 通过 AppleScript 获取当前浏览器前台标签页 URL
   * 参考 uTools 行为：
   * - Safari 读取 front document
   * - 其他受支持浏览器读取 front window 的 active tab
   */
  async readCurrentBrowserUrlMac() {
    const windowInfo = this.clipboardManager?.getCurrentWindow();
    if (!windowInfo) {
      console.warn("[PluginShell] readCurrentBrowserUrl: 未识别到当前活动窗口");
      throw new Error("未识别到当前活动窗口");
    }
    const bundleId = windowInfo.bundleId;
    if (!bundleId || !(bundleId in MAC_BROWSER_APP_MAP)) {
      console.log(
        `[PluginShell] readCurrentBrowserUrl: 当前窗口非受支持浏览器 (bundleId=${bundleId})`
      );
      throw new Error("当前活动窗口非可识别浏览器");
    }
    const appName = MAC_BROWSER_APP_MAP[bundleId];
    const script = bundleId === "com.apple.Safari" ? 'tell application "Safari" to return URL of front document' : `tell application "${appName}" to return URL of active tab of front window`;
    try {
      const result = (await this.execAppleScript(script)).trim();
      if (!result) {
        console.error("[PluginShell] readCurrentBrowserUrl: AppleScript 返回空 URL");
        throw new Error("未读取到 URL");
      }
      console.log(
        `[PluginShell] readCurrentBrowserUrl: macOS 浏览器 URL 读取成功 (bundleId=${bundleId})`
      );
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const cleanMsg = errMsg.replace(/^\d+:\d+:\s*execution error:\s*/i, "").replace(/\(-?\d+\)\s*$/i, "").trim();
      console.error("[PluginShell] readCurrentBrowserUrl: AppleScript 执行失败:", cleanMsg);
      throw new Error(cleanMsg || "未读取到 URL");
    }
  }
  /**
   * Windows: 检查当前窗口是否为文件资源管理器，并获取路径
   * - CabinetWClass/ExploreWClass: 标准 Explorer 窗口，通过 COM 查询路径
   * - Progman/WorkerW: 桌面窗口，返回桌面路径
   */
  readCurrentFolderPathWindows() {
    const windowInfo = this.clipboardManager?.getCurrentWindow();
    if (!windowInfo) {
      console.warn("[PluginShell] readCurrentFolderPath: 未识别到当前活动窗口");
      throw new Error("未识别到当前活动窗口");
    }
    const EXPLORER_APPS = [
      "explorer.exe",
      "SearchApp.exe",
      "SearchHost.exe",
      "FESearchHost.exe",
      "prevhost.exe"
    ];
    if (!EXPLORER_APPS.includes(windowInfo.app)) {
      console.log(
        `[PluginShell] readCurrentFolderPath: 当前窗口非 Explorer (app=${windowInfo.app})`
      );
      throw new Error('当前活动窗口非 "文件资源管理器" 窗口');
    }
    const folderPath = getExplorerFolderPathFromWindow(windowInfo, "PluginShell");
    if (folderPath) {
      console.log(`[PluginShell] readCurrentFolderPath: Explorer 窗口路径=${folderPath}`);
      return folderPath;
    }
    console.warn(
      `[PluginShell] readCurrentFolderPath: 未识别的窗口类 "${windowInfo.className}" (app=${windowInfo.app})`
    );
    throw new Error(`当前活动窗口类 "${windowInfo.className}" 未识别`);
  }
  /**
   * Windows: 读取当前浏览器窗口 URL
   * 参考 uTools 行为：
   * - 按进程名识别浏览器
   * - 原生层按 hwnd 读取 URL
   * - Chrome 首次失败时 50ms 后重试一次
   */
  async readCurrentBrowserUrlWindows() {
    const windowInfo = this.clipboardManager?.getCurrentWindow();
    if (!windowInfo) {
      console.warn("[PluginShell] readCurrentBrowserUrl: 未识别到当前活动窗口");
      throw new Error("未识别到当前活动窗口");
    }
    const browserName = WINDOWS_BROWSER_PROCESS_MAP[windowInfo.app];
    if (!browserName) {
      console.log(
        `[PluginShell] readCurrentBrowserUrl: 当前窗口非受支持浏览器 (app=${windowInfo.app})`
      );
      throw new Error("当前活动窗口非可识别浏览器");
    }
    if (windowInfo.hwnd == null) {
      console.error("[PluginShell] readCurrentBrowserUrl: 浏览器窗口缺少 hwnd");
      throw new Error("未读取到 URL");
    }
    const tryReadUrl = async () => {
      const result = await WindowManager$1.readBrowserWindowUrl(browserName, windowInfo.hwnd);
      return typeof result === "string" && result.trim() !== "" ? result.trim() : null;
    };
    let url2 = await tryReadUrl();
    if (!url2 && browserName === "chrome") {
      console.log("[PluginShell] readCurrentBrowserUrl: Chrome 首次读取失败，50ms 后重试");
      await new Promise((resolve) => setTimeout(resolve, 50));
      url2 = await tryReadUrl();
    }
    if (!url2) {
      console.error(
        `[PluginShell] readCurrentBrowserUrl: 原生读取失败 (browser=${browserName}, hwnd=${windowInfo.hwnd})`
      );
      throw new Error("未读取到 URL");
    }
    console.log(
      `[PluginShell] readCurrentBrowserUrl: Windows 浏览器 URL 读取成功 (browser=${browserName}, hwnd=${windowInfo.hwnd})`
    );
    return url2;
  }
  /**
   * 执行 AppleScript 命令并返回标准输出
   * 使用 execFile 而非 exec，避免 shell 解释，防止潜在的命令注入风险
   * @param script - AppleScript 脚本内容
   * @returns 命令输出字符串
   */
  execAppleScript(script) {
    return new Promise((resolve, reject) => {
      child_process.execFile("osascript", ["-e", script], (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
const pluginShellAPI = new PluginShellAPI();
class ToastManager {
  containerWindow = null;
  toasts = [];
  toastIdCounter = 0;
  DEFAULT_DURATION = 3e3;
  destroyTimer = null;
  DESTROY_DELAY = 1e3;
  // 延迟销毁时间(毫秒)
  /**
   * 创建或获取容器窗口
   */
  getContainerWindow() {
    if (this.containerWindow && !this.containerWindow.isDestroyed()) {
      return this.containerWindow;
    }
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds;
    this.containerWindow = new electron.BrowserWindow({
      width: screenWidth,
      height: screenHeight,
      x: 0,
      y: 0,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    this.containerWindow.setIgnoreMouseEvents(true);
    if (process.platform === "darwin") {
      this.containerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.containerWindow.setAlwaysOnTop(true, "screen-saver");
      this.containerWindow.setHasShadow(false);
    }
    const html = this.generateContainerHTML();
    this.containerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    this.containerWindow.once("ready-to-show", () => {
      if (this.containerWindow && !this.containerWindow.isDestroyed()) {
        this.containerWindow.showInactive();
      }
    });
    return this.containerWindow;
  }
  /**
   * 更新容器窗口中的 toast 列表
   */
  updateToasts() {
    const window = this.getContainerWindow();
    if (window.isDestroyed()) return;
    const sendUpdate = () => {
      if (!window.isDestroyed()) {
        window.webContents.send("update-toasts", this.toasts);
      }
    };
    if (window.webContents.isLoading()) {
      window.webContents.once("did-finish-load", () => {
        sendUpdate();
      });
    } else {
      sendUpdate();
    }
  }
  /**
   * 显示 toast
   */
  showToast(options) {
    const { message, type = "info", duration = this.DEFAULT_DURATION, position = "top" } = options;
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
    const toastId = `toast-${++this.toastIdCounter}-${Date.now()}`;
    const toastItem = {
      id: toastId,
      message,
      type,
      position
    };
    this.toasts.push(toastItem);
    this.updateToasts();
    setTimeout(() => {
      this.removeToast(toastId);
    }, duration);
  }
  /**
   * 移除指定的 toast
   */
  removeToast(toastId) {
    const index = this.toasts.findIndex((t) => t.id === toastId);
    if (index > -1) {
      this.toasts.splice(index, 1);
      this.updateToasts();
      if (this.toasts.length === 0) {
        this.destroyTimer = setTimeout(() => {
          if (this.containerWindow && !this.containerWindow.isDestroyed()) {
            this.containerWindow.hide();
            this.containerWindow.destroy();
            this.containerWindow = null;
          }
          this.destroyTimer = null;
        }, this.DESTROY_DELAY);
      }
    }
  }
  /**
   * 生成容器窗口 HTML
   */
  generateContainerHTML() {
    const isDark = electron.nativeTheme.shouldUseDarkColors;
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            -webkit-app-region: no-drag;
            overflow: hidden;
            width: 100vw;
            height: 100vh;
          }
          .toast-container {
            position: fixed;
            left: 50%;
            transform: translateX(-50%);
            width: 360px;
            display: flex;
            flex-direction: column;
            pointer-events: none;
          }
          .toast-container.top {
            top: 60px;
          }
          .toast-container.bottom {
            bottom: 20px;
          }
          .toast-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px 20px;
            margin-bottom: 10px;
            background: ${isDark ? "#2d2d2d" : "#ffffff"};
            border-radius: 12px;
            color: ${isDark ? "#ffffff" : "#1f1f1f"};
            font-size: 14px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, ${isDark ? "0.7" : "0.12"}),
                        0 1px 6px rgba(0, 0, 0, ${isDark ? "0.5" : "0.08"}),
                        ${isDark ? "inset 0 1px 0 rgba(255, 255, 255, 0.1)" : "inset 0 1px 0 rgba(255, 255, 255, 0.8)"};
            backdrop-filter: blur(10px);
            border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.05)"};
            animation: toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            will-change: transform, opacity, margin-bottom;
          }
          .toast-item:last-child {
            margin-bottom: 0;
          }
          @keyframes toast-in {
            from {
              opacity: 0;
              transform: translateY(-20px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes toast-out {
            0% {
              opacity: 1;
              transform: scale(1);
              max-height: 300px;
            }
            40% {
              opacity: 0;
              transform: scale(0.9);
              max-height: 300px;
            }
            100% {
              opacity: 0;
              transform: scale(0.9);
              max-height: 0;
              margin-bottom: 0;
              padding-top: 0;
              padding-bottom: 0;
            }
          }
          .toast-item.removing {
            animation: toast-out 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
            overflow: hidden;
          }
          .toast-item.info {
            gap: 0;
          }
          .toast-icon {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .toast-message {
            flex: 1;
            word-break: break-word;
            line-height: 1.5;
            max-height: 268px;
            overflow-y: auto;
          }
          .toast-message::-webkit-scrollbar {
            width: 6px;
          }
          .toast-message::-webkit-scrollbar-track {
            background: transparent;
          }
          .toast-message::-webkit-scrollbar-thumb {
            background: ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)"};
            border-radius: 3px;
            transition: background 0.2s ease;
          }
          .toast-message::-webkit-scrollbar-thumb:hover {
            background: ${isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.15)"};
          }
        </style>
      </head>
      <body>
        <div id="top-container" class="toast-container top"></div>
        <div id="bottom-container" class="toast-container bottom"></div>
        
        <script>
          const { ipcRenderer } = require('electron');
          
          // 生成图标 HTML
          function getIconHTML(type) {
            if (type === 'success') {
              return \`
                <div class="toast-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="10" fill="#10b981"/>
                    <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              \`;
            } else if (type === 'warning') {
              return \`
                <div class="toast-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="10" fill="#f59e0b"/>
                    <path d="M10 6V11" stroke="white" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="10" cy="14" r="1" fill="white"/>
                  </svg>
                </div>
              \`;
            } else if (type === 'error') {
              return \`
                <div class="toast-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="10" fill="#ef4444"/>
                    <path d="M7 7L13 13M13 7L7 13" stroke="white" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </div>
              \`;
            }
            return '';
          }
          
          // 转义 HTML
          function escapeHTML(text) {
            return text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
          }
          
          // 更新 toast 列表（增量更新）
          ipcRenderer.on('update-toasts', (event, toasts) => {
            const topContainer = document.getElementById('top-container');
            const bottomContainer = document.getElementById('bottom-container');
            
            // 获取当前所有 toast ID
            const currentIds = new Set(
              Array.from(document.querySelectorAll('.toast-item')).map(el => el.id)
            );
            const newIds = new Set(toasts.map(t => t.id));
            
            // 1. 移除不存在的 toast（添加移除动画）
            currentIds.forEach(id => {
              if (!newIds.has(id)) {
                const el = document.getElementById(id);
                if (el) {
                  el.classList.add('removing');
                  setTimeout(() => el.remove(), 400); // 等待动画完成
                }
              }
            });
            
            // 2. 添加新的 toast
            toasts.forEach(toast => {
              if (!currentIds.has(toast.id)) {
                const toastEl = document.createElement('div');
                toastEl.className = \`toast-item \${toast.type}\`;
                toastEl.id = toast.id;
                
                const iconHTML = toast.type !== 'info' ? getIconHTML(toast.type) : '';
                toastEl.innerHTML = \`
                  \${iconHTML}
                  <div class="toast-message">\${escapeHTML(toast.message)}</div>
                \`;
                
                if (toast.position === 'top') {
                  topContainer.appendChild(toastEl);
                } else {
                  bottomContainer.appendChild(toastEl);
                }
              }
            });
            
            // 3. 确保顺序正确（不改变已存在的元素）
            const topToasts = toasts.filter(t => t.position === 'top');
            const bottomToasts = toasts.filter(t => t.position === 'bottom');
            
            topToasts.forEach((toast, index) => {
              const el = document.getElementById(toast.id);
              if (el && el.parentElement === topContainer) {
                const currentIndex = Array.from(topContainer.children).indexOf(el);
                if (currentIndex !== index) {
                  topContainer.insertBefore(el, topContainer.children[index] || null);
                }
              }
            });
            
            bottomToasts.forEach((toast, index) => {
              const el = document.getElementById(toast.id);
              if (el && el.parentElement === bottomContainer) {
                const currentIndex = Array.from(bottomContainer.children).indexOf(el);
                if (currentIndex !== index) {
                  bottomContainer.insertBefore(el, bottomContainer.children[index] || null);
                }
              }
            });
          });
        <\/script>
      </body>
      </html>
    `;
  }
  /**
   * 关闭所有 toast
   */
  closeAll() {
    this.toasts = [];
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
    if (this.containerWindow && !this.containerWindow.isDestroyed()) {
      this.containerWindow.hide();
      this.containerWindow.destroy();
      this.containerWindow = null;
    }
  }
}
const toastManager = new ToastManager();
class PluginToastAPI {
  pluginManager = null;
  init(pluginManager2) {
    this.pluginManager = pluginManager2;
    this.setupIPC();
  }
  setupIPC() {
    electron.ipcMain.handle("plugin:show-toast", async (event, options) => {
      try {
        if (!this.pluginManager) {
          throw new Error("PluginManager not initialized");
        }
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender);
        if (pluginInfo) {
          console.log(`[Toast] 插件 ${pluginInfo.name} 显示 toast:`, options.message);
        }
        toastManager.showToast(options);
        return { success: true };
      } catch (error) {
        console.error("[Toast] 显示 toast 失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
  }
  /**
   * 关闭所有 toast(供主进程使用)
   */
  closeAll() {
    toastManager.closeAll();
  }
}
const pluginToastAPI = new PluginToastAPI();
class PluginUIAPI {
  mainWindow = null;
  pluginManager = null;
  init(mainWindow, pluginManager2) {
    this.mainWindow = mainWindow;
    this.pluginManager = pluginManager2;
    this.setupIPC();
    this.setupThemeChangeListeners();
  }
  setupIPC() {
    registerPluginApiServices({
      getThemeInfo: (event) => {
        event.returnValue = this.buildThemeInfo();
      }
    });
    electron.ipcMain.handle("show-notification", (event, body) => this.showNotification(event, body));
    electron.ipcMain.handle(
      "set-expend-height",
      (event, height) => this.setExpendHeight(event, height)
    );
    electron.ipcMain.handle(
      "set-sub-input",
      (event, placeholder, isFocus) => this.setSubInput(placeholder, isFocus, event)
    );
    electron.ipcMain.handle("remove-sub-input", (event) => this.removeSubInput(event));
    electron.ipcMain.on(
      "notify-sub-input-change",
      (event, text) => this.notifySubInputChange(text, event)
    );
    electron.ipcMain.handle(
      "set-sub-input-value",
      (event, text) => this.setSubInputValue(text, event)
    );
    electron.ipcMain.on("sub-input-focus", (event) => {
      event.returnValue = this.subInputFocus(event);
    });
    electron.ipcMain.on("sub-input-blur", (event) => {
      event.returnValue = this.subInputBlur(event);
    });
    electron.ipcMain.on("sub-input-select", (event) => {
      event.returnValue = this.subInputSelect(event);
    });
    electron.ipcMain.on("hide-plugin", () => this.hidePlugin());
    electron.ipcMain.on("plugin-esc-pressed", () => {
      if (this.pluginManager && typeof this.pluginManager.handlePluginEsc === "function") {
        this.pluginManager.handlePluginEsc();
      }
    });
    electron.ipcMain.on("is-dark-colors", (event) => {
      event.returnValue = electron.nativeTheme.shouldUseDarkColors;
    });
  }
  showNotification(event, body) {
    if (electron.Notification.isSupported()) {
      const options = {
        title: "ZTools",
        body
      };
      const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
      if (pluginInfo) {
        options.title = pluginInfo.name;
        if (pluginInfo.logo) {
          options.icon = url.fileURLToPath(pluginInfo.logo);
        }
      }
      new electron.Notification(options).show();
    }
  }
  setExpendHeight(event, height) {
    const detachedWindow = detachedWindowManager.getWindowByPluginWebContents(event.sender.id);
    if (detachedWindow) {
      detachedWindowManager.setExpendHeight(event.sender.id, height);
    } else if (this.pluginManager) {
      this.pluginManager.setExpendHeight(height);
    }
  }
  setSubInput(placeholder, isFocus, event) {
    try {
      const targetWindow = event ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow : this.mainWindow;
      if (!targetWindow) {
        console.warn("[PluginUI] 无法找到目标窗口");
        return false;
      }
      targetWindow.webContents.send("update-sub-input-visible", true);
      targetWindow.webContents.send("update-sub-input-placeholder", {
        placeholder: placeholder || "搜索"
      });
      if (targetWindow === this.mainWindow) {
        this.pluginManager?.setSubInputPlaceholder(placeholder || "搜索");
        if (event) {
          const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
          if (pluginInfo) {
            this.pluginManager?.setSubInputVisible(pluginInfo.path, true);
          }
        }
      }
      console.log("[PluginUI] 设置子输入框 placeholder:", { placeholder, isFocus });
      if (isFocus) {
        this.subInputFocus(event);
      }
      return true;
    } catch (error) {
      console.error("[PluginUI] 设置子输入框失败:", error);
      return false;
    }
  }
  removeSubInput(event) {
    try {
      const targetWindow = event ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow : this.mainWindow;
      if (!targetWindow) {
        console.warn("[PluginUI] 无法找到目标窗口");
        return false;
      }
      targetWindow.webContents.send("update-sub-input-visible", false);
      console.log("[PluginUI] 隐藏子输入框");
      if (targetWindow === this.mainWindow && event) {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender);
        if (pluginInfo) {
          this.pluginManager?.setSubInputVisible(pluginInfo.path, false);
        }
      }
      return true;
    } catch (error) {
      console.error("[PluginUI] 隐藏子输入框失败:", error);
      return false;
    }
  }
  notifySubInputChange(text, event) {
    if (this.pluginManager) {
      this.pluginManager.setSubInputValue(text);
    }
    if (event) {
      const detachedWindow = detachedWindowManager.getWindowByPluginWebContents(event.sender.id);
      if (detachedWindow) {
        event.sender.send("sub-input-change", { text });
      } else {
        if (this.pluginManager) {
          this.pluginManager.sendPluginMessage("sub-input-change", { text });
        }
      }
    } else if (this.pluginManager) {
      this.pluginManager.sendPluginMessage("sub-input-change", { text });
    }
  }
  setSubInputValue(text, event) {
    try {
      const targetWindow = event ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow : this.mainWindow;
      if (!targetWindow) {
        console.warn("[PluginUI] 无法找到目标窗口");
        return false;
      }
      targetWindow.webContents.send("set-sub-input-value", text);
      console.log("[PluginUI] 设置子输入框值:", text);
      this.notifySubInputChange(text, event);
      this.subInputFocus(event);
      return true;
    } catch (error) {
      console.error("[PluginUI] 设置子输入框值失败:", error);
      return false;
    }
  }
  subInputFocus(event) {
    try {
      const targetWindow = event ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow : this.mainWindow;
      if (!targetWindow) {
        console.warn("[PluginUI] 无法找到目标窗口");
        return false;
      }
      targetWindow.webContents.focus();
      console.log("[PluginUI] 目标窗口获取焦点");
      targetWindow.webContents.send("focus-sub-input");
      console.log("[PluginUI] 请求聚焦子输入框");
      return true;
    } catch (error) {
      console.error("[PluginUI] 聚焦子输入框失败:", error);
      return false;
    }
  }
  subInputBlur(event) {
    try {
      if (event) {
        event.sender.focus();
        console.log("[PluginUI] 插件应用获取焦点（分离窗口）");
        return true;
      } else {
        const currentPluginView = this.pluginManager?.getCurrentPluginView();
        if (currentPluginView) {
          currentPluginView.webContents.focus();
          console.log("[PluginUI] 插件应用获取焦点（主窗口）");
          return true;
        } else {
          console.warn("[PluginUI] 没有活动的插件,无法获取焦点");
          return false;
        }
      }
    } catch (error) {
      console.error("[PluginUI] 插件获取焦点失败:", error);
      return false;
    }
  }
  subInputSelect(event) {
    try {
      const targetWindow = event ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow : this.mainWindow;
      if (!targetWindow) {
        console.warn("[PluginUI] 无法找到目标窗口");
        return false;
      }
      targetWindow.webContents.focus();
      targetWindow.webContents.send("select-sub-input");
      return true;
    } catch (error) {
      console.error("[PluginUI] 选中子输入框失败:", error);
      return false;
    }
  }
  hidePlugin() {
    if (this.pluginManager) {
      this.pluginManager.hidePluginView();
    }
  }
  /**
   * 构建当前主题信息
   */
  buildThemeInfo() {
    const settings = databaseAPI.dbGet("settings-general");
    return {
      isDark: electron.nativeTheme.shouldUseDarkColors,
      primaryColor: settings?.primaryColor || "blue",
      customColor: settings?.customColor,
      windowMaterial: windowManager.getWindowMaterial()
    };
  }
  /**
   * 向所有插件视图广播消息
   */
  broadcastToAllPluginViews(channel, data) {
    const views = this.pluginManager?.getAllPluginViews() || [];
    for (const { view } of views) {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.send(channel, data);
        }
      } catch {
      }
    }
    detachedWindowManager.broadcastToAllWindows(channel, data);
    pluginWindowManager.broadcastToAll(channel, data);
  }
  /**
   * 广播主题信息到所有插件视图
   */
  broadcastThemeInfoToAllPlugins() {
    const themeInfo = this.buildThemeInfo();
    this.broadcastToAllPluginViews("update-theme-info", themeInfo);
  }
  /**
   * 监听主题变更（系统深浅色切换）
   */
  setupThemeChangeListeners() {
    electron.nativeTheme.on("updated", () => {
      this.broadcastThemeInfoToAllPlugins();
    });
  }
}
const pluginUIAPI = new PluginUIAPI();
class PluginWindowAPI {
  pluginManager = null;
  mainWindow = null;
  init(mainWindow, pluginManager2) {
    this.pluginManager = pluginManager2;
    this.mainWindow = mainWindow;
    this.setupIPC();
    this.registerPluginApiHandlers();
  }
  /**
   * 通过 plugin.api 统一通道注册 createBrowserWindow 相关 handler
   */
  registerPluginApiHandlers() {
    const pluginManager2 = this.pluginManager;
    registerPluginApiServices({
      // ── 同步 API：创建窗口 ──
      createBrowserWindow: (event, { url: url2, options }) => {
        const pluginInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) {
          event.returnValue = new Error("plugin not found");
          return;
        }
        if (url2.startsWith("http")) {
          event.returnValue = new Error("The URL must be a local address starting with file://");
          return;
        }
        const win = pluginWindowManager.createWindow(
          pluginInfo.path,
          pluginInfo.name,
          getPluginSessionPartition(pluginInfo.name),
          url2,
          options,
          event.sender
        );
        event.returnValue = {
          id: win.id,
          methods: winIpc.windowMethods,
          invokes: winIpc.windowInvokes,
          webContents: {
            id: win.webContents.id,
            methods: winIpc.webContentsMethods,
            invokes: winIpc.webContentsInvokes
          }
        };
      },
      // ── 同步 API：BrowserWindow/WebContents 同步方法分发 ──
      pluginBrowserWindowMethod: (event, {
        id,
        target,
        method,
        args
      }) => {
        const win = electron.BrowserWindow.fromId(id);
        if (!win) {
          if (method === "isDestroyed") {
            event.returnValue = true;
            return;
          }
          console.warn(`[pluginWindow:method] winId=${id} not found, method=${method}`);
          event.returnValue = new Error("window not exist");
          return;
        }
        const callerInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
        const callerPath = callerInfo?.path ?? pluginWindowManager.getPluginPathByWebContentsId(event.sender.id);
        const ownerPath = pluginWindowManager.getPluginPathByWindowId(id);
        if (!callerPath || callerPath !== ownerPath) {
          console.warn(`[pluginWindow:auth] pluginPath=${callerPath} denied access to winId=${id}`);
          event.returnValue = new Error("window id error");
          return;
        }
        if (target === "webContents") {
          if (!winIpc.webContentsMethods.includes(method)) {
            event.returnValue = new Error(`webContents function "${method}" not found`);
            return;
          }
          try {
            event.returnValue = win.webContents[method](...args);
          } catch (e) {
            event.returnValue = e;
          }
        } else {
          if (!winIpc.windowMethods.includes(method)) {
            event.returnValue = new Error(`BrowserWindow function "${method}" not found`);
            return;
          }
          try {
            event.returnValue = win[method](...args);
          } catch (e) {
            event.returnValue = e;
          }
        }
      },
      // ── 异步 API：BrowserWindow/WebContents 异步方法分发 ──
      pluginBrowserWindowInvoke: async (event, {
        id,
        target,
        method,
        args
      }) => {
        const win = electron.BrowserWindow.fromId(id);
        if (!win) throw new Error("window not exist");
        const callerInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
        const callerPath = callerInfo?.path ?? pluginWindowManager.getPluginPathByWebContentsId(event.sender.id);
        const ownerPath = pluginWindowManager.getPluginPathByWindowId(id);
        if (!callerPath || callerPath !== ownerPath) {
          console.warn(`[pluginWindow:auth] pluginPath=${callerPath} denied access to winId=${id}`);
          throw new Error("window id error");
        }
        if (target === "webContents") {
          if (method === "print") {
            return new Promise((resolve, reject) => {
              win.webContents.print(args[0] || null, (success, failureReason) => {
                if (success) return resolve(void 0);
                reject(new Error("errorType " + failureReason));
              });
            });
          }
          if (!winIpc.webContentsInvokes.includes(method)) {
            throw new Error(`webContents function "${method}" not found`);
          }
          return await win.webContents[method](...args);
        } else {
          if (!winIpc.windowInvokes.includes(method)) {
            throw new Error(`BrowserWindow function "${method}" not found`);
          }
          return await win[method](...args);
        }
      }
    });
  }
  setupIPC() {
    electron.ipcMain.on("send-to-parent", (event, channel, ...args) => {
      pluginWindowManager.sendToParent(event.sender, channel, args);
    });
    electron.ipcMain.handle("show-main-window", () => {
      windowManager.showWindow();
    });
    electron.ipcMain.handle("hide-main-window", (_event, isRestorePreWindow = true) => {
      windowManager.hideWindow(isRestorePreWindow);
    });
    electron.ipcMain.on("ipc-send-to", (event, webContentsId, channel, ...args) => {
      const senderId = event.sender.id;
      try {
        const targetWebContents = electron.webContents.fromId(webContentsId);
        if (targetWebContents && !targetWebContents.isDestroyed()) {
          targetWebContents.send("__ipc_sendto_relay__", { senderId, channel, args });
        } else {
          console.warn(`[pluginWindow:method] 目标 webContents 不存在或已销毁: ${webContentsId}`);
        }
      } catch (error) {
        console.error("[pluginWindow:method] 转发消息失败:", error);
      }
    });
    electron.ipcMain.on("get-window-type", (event) => {
      try {
        const windowType = this.getWindowType(event.sender);
        event.returnValue = windowType;
      } catch (error) {
        console.error("[pluginWindow:method] get-window-type error:", error);
        event.returnValue = "main";
      }
    });
  }
  /**
   * 获取窗口类型
   * @param webContents 调用者的 WebContents
   * @returns 'main' | 'detach' | 'browser'
   */
  getWindowType(webContents2) {
    if (this.mainWindow && webContents2.id === this.mainWindow.webContents.id) {
      return "main";
    }
    if (detachedWindowManager.isDetachedWindow(webContents2)) {
      return "detach";
    }
    if (pluginWindowManager.isBrowserWindow(webContents2)) {
      return "browser";
    }
    return "main";
  }
}
const pluginWindowAPI = new PluginWindowAPI();
class ZBrowserManager {
  /** 每个插件变体的空闲窗口 ID 列表（runtimeNamespace → windowId[]） */
  idleWindowIds = /* @__PURE__ */ new Map();
  /** 每个插件变体的 zbrowser Session 缓存（runtimeNamespace → Session） */
  sessionPool = /* @__PURE__ */ new Map();
  /**
   * 获取或创建插件的 zbrowser 专用 Session
   *
   * 使用 `<pluginName.zbrowser>` 作为分区名，
   * 与插件自身的 `persist:pluginName` 隔离。
   *
   * @param runtimeNamespace 插件运行时命名空间
   * @param pluginName 插件真实名称，仅用于日志
   * @returns Electron Session 实例
   */
  getOrCreateSession(runtimeNamespace, pluginName) {
    let sess = this.sessionPool.get(runtimeNamespace);
    if (!sess) {
      const partition = `${runtimeNamespace}.zbrowser`;
      sess = electron.session.fromPartition(partition);
      this.sessionPool.set(runtimeNamespace, sess);
      console.log("[zbrowser] 为插件创建 Session:", {
        pluginName: pluginName || runtimeNamespace,
        runtimeNamespace,
        partition
      });
    }
    return sess;
  }
  /**
   * 获取插件的空闲窗口 ID 列表
   *
   * 会自动清理已销毁的窗口。
   *
   * @param runtimeNamespace 插件运行时命名空间
   * @returns 空闲窗口 ID 数组
   */
  getIdleWindowIds(runtimeNamespace) {
    const ids = this.idleWindowIds.get(runtimeNamespace);
    if (!ids) return [];
    const validIds = ids.filter((id) => {
      const win = electron.BrowserWindow.fromId(id);
      return win && !win.isDestroyed();
    });
    this.idleWindowIds.set(runtimeNamespace, validIds);
    return validIds;
  }
  /**
   * 获取插件的空闲窗口详细信息
   *
   * 供 getIdleUBrowsers API 返回给插件使用。
   *
   * @param runtimeNamespace 插件运行时命名空间
   * @returns 空闲窗口信息数组（id、标题、URL）
   */
  getIdleWindows(runtimeNamespace) {
    const ids = this.getIdleWindowIds(runtimeNamespace);
    return ids.map((id) => {
      const win = electron.BrowserWindow.fromId(id);
      if (!win || win.isDestroyed()) return null;
      return {
        id: win.id,
        title: win.getTitle(),
        url: win.webContents.getURL()
      };
    }).filter((info) => info !== null);
  }
  /**
   * 将窗口添加到插件的空闲池
   *
   * @param runtimeNamespace 插件运行时命名空间
   * @param windowId BrowserWindow ID
   */
  addIdleWindow(runtimeNamespace, windowId) {
    const ids = this.idleWindowIds.get(runtimeNamespace) || [];
    if (!ids.includes(windowId)) {
      ids.push(windowId);
      this.idleWindowIds.set(runtimeNamespace, ids);
      console.log(
        `[zbrowser] 空闲窗口入池: runtimeNamespace="${runtimeNamespace}", windowId=${windowId}`
      );
    }
  }
  /**
   * 从插件的空闲池中移除窗口
   *
   * @param runtimeNamespace 插件运行时命名空间
   * @param windowId BrowserWindow ID
   */
  removeIdleWindow(runtimeNamespace, windowId) {
    const ids = this.idleWindowIds.get(runtimeNamespace);
    if (!ids) return;
    const filtered = ids.filter((id) => id !== windowId);
    this.idleWindowIds.set(runtimeNamespace, filtered);
    if (filtered.length < ids.length) {
      console.log(
        `[zbrowser] 空闲窗口出池: runtimeNamespace="${runtimeNamespace}", windowId=${windowId}`
      );
    }
  }
  /**
   * 清除插件的 zbrowser 缓存
   *
   * @param runtimeNamespace 插件运行时命名空间
   */
  async clearCache(runtimeNamespace) {
    const sess = this.sessionPool.get(runtimeNamespace);
    if (!sess) return;
    await sess.clearCache();
    console.log(`[zbrowser] 已清除插件 "${runtimeNamespace}" 的缓存`);
  }
  /**
   * 设置插件 zbrowser Session 的代理
   *
   * @param runtimeNamespace 插件运行时命名空间
   * @param config Electron 代理配置对象
   */
  async setProxy(runtimeNamespace, config) {
    const sess = this.getOrCreateSession(runtimeNamespace);
    await sess.setProxy(config);
    console.log(`[zbrowser] 已设置插件 "${runtimeNamespace}" 的代理`);
  }
}
const zbrowserManager = new ZBrowserManager();
const ZBROWSER_DEVICES = {
  "iPhone 11": {
    size: { width: 414, height: 896 },
    useragent: "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"
  },
  "iPhone X": {
    size: { width: 375, height: 812 },
    useragent: "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"
  },
  iPad: {
    size: { width: 768, height: 1024 },
    useragent: "Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1"
  },
  "iPhone 6/7/8 Plus": {
    size: { width: 414, height: 736 },
    useragent: "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"
  },
  "iPhone 6/7/8": {
    size: { width: 375, height: 667 },
    useragent: "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"
  },
  "iPhone 5/SE": {
    size: { width: 320, height: 568 },
    useragent: "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1"
  },
  "HUAWEI Mate10": {
    size: { width: 360, height: 640 },
    useragent: "Mozilla/5.0 (Linux; U; Android 8.1.0; ALP-AL00 Build/HUAWEIALP-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36"
  },
  "HUAWEI Mate20": {
    size: { width: 360, height: 748 },
    useragent: "Mozilla/5.0 (Linux; U; Android 9; HMA-AL00 Build/HUAWEIHMA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36"
  },
  "HUAWEI Mate30": {
    size: { width: 360, height: 780 },
    useragent: "Mozilla/5.0 (Linux; U; Android 10; TAS-AL00 Build/HUAWEITAS-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36"
  },
  "HUAWEI Mate30 Pro": {
    size: { width: 392, height: 800 },
    useragent: "Mozilla/5.0 (Linux; U; Android 10; LIO-AL00 Build/HUAWEILIO-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36"
  }
};
const KEY_CODE_MAP = {
  Backspace: "Backspace",
  Tab: "Tab",
  Enter: "Enter",
  MediaPlayPause: "MediaPlayPause",
  Escape: "Escape",
  Space: "Space",
  PageUp: "PageUp",
  PageDown: "PageDown",
  End: "End",
  Home: "Home",
  ArrowLeft: "Left",
  ArrowUp: "Up",
  ArrowRight: "Right",
  ArrowDown: "Down",
  PrintScreen: "PrintScreen",
  Insert: "Insert",
  Delete: "Delete",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  KeyA: "A",
  KeyB: "B",
  KeyC: "C",
  KeyD: "D",
  KeyE: "E",
  KeyF: "F",
  KeyG: "G",
  KeyH: "H",
  KeyI: "I",
  KeyJ: "J",
  KeyK: "K",
  KeyL: "L",
  KeyM: "M",
  KeyN: "N",
  KeyO: "O",
  KeyP: "P",
  KeyQ: "Q",
  KeyR: "R",
  KeyS: "S",
  KeyT: "T",
  KeyU: "U",
  KeyV: "V",
  KeyW: "W",
  KeyX: "X",
  KeyY: "Y",
  KeyZ: "Z",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  Semicolon: ";",
  Equal: "=",
  Comma: ",",
  Minus: "-",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  BracketLeft: "[",
  Backslash: "\\",
  BracketRight: "]",
  Quote: "'"
};
let keyCodeValues = null;
const EXECUTION_TIMEOUT = 5 * 60 * 1e3;
const DEFAULT_GOTO_TIMEOUT = 6e4;
const ALLOWED_METHODS = /* @__PURE__ */ new Set([
  "goto",
  "javascript",
  "css",
  "press",
  "paste",
  "input",
  "file",
  "screenshot",
  "capture",
  "pdf",
  "download",
  "device",
  "cookies",
  "setCookies",
  "removeCookies",
  "clearCookies",
  "viewport",
  "useragent",
  "hide",
  "show",
  "devTools",
  "mouseEvent",
  "drop",
  "markdown"
]);
class ZBrowserExecutor {
  /** BrowserWindow 实例 */
  _browserWindow = null;
  /** runner 子进程 */
  _childProcess = null;
  /** 页面是否已经触发 dom-ready */
  _pageIsDomReadyed = false;
  /** 当前是否处于显示模式 */
  _isShow = false;
  /** goto 第一次调用时是否已自动 show */
  _isFirstGoto = false;
  // ─────────────────── 操作方法 ───────────────────
  /**
   * 设置 UserAgent
   */
  async useragent(ua) {
    this._browserWindow.webContents.userAgent = ua;
  }
  /**
   * 设置视口大小
   *
   * 使用 setContentSize 而非 setSize，与 uTools 行为一致。
   */
  async viewport(width, height) {
    this._browserWindow.setContentSize(width, height);
  }
  /**
   * 页面导航
   *
   * @param args [url, headersOrTimeout?, timeout?]
   *   - url: 目标 URL（必须是 http/https/file 协议）
   *   - 第二个参数可以是 headers 对象或超时毫秒数
   *   - 第三个参数为超时毫秒数（当第二个参数是 headers 时）
   *   - 默认超时：60 秒（与 uTools 一致）
   */
  async goto(...args) {
    const url2 = args[0];
    if (!url2 || typeof url2 !== "string" || !/^https?:\/\//.test(url2)) {
      throw new Error("url error");
    }
    if (this._isShow && !this._isFirstGoto) {
      this._isFirstGoto = true;
      this._browserWindow.setTitle(url2);
      this._browserWindow.show();
    }
    let loadOptions;
    let timeout = DEFAULT_GOTO_TIMEOUT;
    if (args[1]) {
      if (typeof args[1] === "object") {
        const headers = args[1];
        loadOptions = { extraHeaders: "" };
        for (const [key, value] of Object.entries(headers)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey === "referer") {
            loadOptions.httpReferrer = value;
          } else if (lowerKey === "useragent") {
            loadOptions.userAgent = value;
          } else {
            loadOptions.extraHeaders += `${key}: ${value}
`;
          }
        }
      } else if (typeof args[1] === "number" && args[1] > 0) {
        timeout = args[1];
      }
    }
    if (args[2] && typeof args[2] === "number" && args[2] > 0) {
      timeout = args[2];
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("page load timeout"));
      }, timeout);
      this._browserWindow.webContents.once("dom-ready", () => {
        clearTimeout(timer);
        this._pageIsDomReadyed = true;
        resolve();
      });
      this._browserWindow.loadURL(url2, loadOptions).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  /** 隐藏窗口 */
  async hide() {
    this._isShow = false;
    this._browserWindow.hide();
  }
  /** 显示窗口 */
  async show() {
    this._isShow = true;
    this._browserWindow.show();
  }
  /**
   * 打开开发者工具
   *
   * @param mode 打开模式，默认 detach
   */
  async devTools(mode = "detach") {
    if (!this._isShow) {
      throw new Error("ubrowser is hided");
    }
    this._browserWindow.webContents.openDevTools({
      mode,
      activate: false
    });
  }
  /**
   * 执行 JavaScript 代码
   *
   * runner 会将 evaluate 回调序列化为 IIFE 字符串，
   * 返回 { data, error, message } 格式。
   */
  async javascript(code) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    const result = await this._browserWindow.webContents.executeJavaScript(code, true);
    if (result.error) {
      throw new Error(result.message);
    }
    return result.data;
  }
  /**
   * 注入 CSS 样式
   */
  async css(code) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    await this._browserWindow.webContents.insertCSS(code);
  }
  /**
   * 模拟键盘按键
   *
   * @param key 键名（DOM 键名或 Electron 键名）
   * @param modifiers 修饰键列表（shift / ctrl / alt / meta）
   */
  async press(key, ...modifiers) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    if (!keyCodeValues) {
      keyCodeValues = Object.values(KEY_CODE_MAP);
    }
    const keyStr = String(key).toLowerCase();
    let keyCode = keyCodeValues.find((k) => k.toLowerCase() === keyStr);
    if (!keyCode) {
      throw new Error("keyCode error");
    }
    if (keyCode === "Enter") {
      keyCode = String.fromCharCode(13);
    } else if (keyCode === "Space") {
      keyCode = String.fromCharCode(32);
    }
    if (modifiers.length > 0) {
      modifiers = Array.from(new Set(modifiers)).map((m) => String(m).toLowerCase());
      const invalid = modifiers.find((m) => !["shift", "ctrl", "alt", "meta"].includes(m));
      if (invalid) {
        throw new Error("modifier key error");
      }
    }
    const wc = this._browserWindow.webContents;
    wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    wc.sendInputEvent({
      type: "char",
      keyCode: /^[A-Z]$/.test(keyCode) ? key : keyCode,
      modifiers
    });
    wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  }
  /**
   * 粘贴文本或图片到页面
   *
   * 与 uTools 一致：使用 document.execCommand('paste')，而非模拟 Ctrl+V。
   *
   * @param text 要粘贴的文本（或 base64 data URI 图片）。省略则粘贴当前剪贴板内容。
   */
  async paste(text) {
    if (text) {
      if (/^data:image\/[a-z]+?;base64,/.test(text)) {
        electron.clipboard.writeImage(electron.nativeImage.createFromDataURL(text));
      } else {
        electron.clipboard.writeText(text);
      }
    }
    await this._browserWindow.webContents.executeJavaScript("document.execCommand('paste')");
  }
  /**
   * 输入文本（模拟输入法输入，不触发键盘按键事件）
   *
   * 使用 webContents.insertText() 模拟 IME 输入行为。
   * 支持两种调用方式：
   * 1. input(text) - 在当前焦点元素中输入文本
   * 2. input(selector, text) - 先聚焦元素，再输入文本（支持 CSS/XPath 选择器和 >> iframe 嵌套）
   *
   * @param selectorOrText 选择器字符串或要输入的文本
   * @param text 要输入的文本（当第一个参数为选择器时）
   */
  async input(selectorOrText, text) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    let inputText;
    if (typeof text === "string") {
      const selector = selectorOrText;
      const jsCode = `(() => {
        const selector = ${JSON.stringify(selector)}
        const el = document.querySelector(selector)
        if (!el) throw new Error('input: unable to find element by selector "' + selector + '"')
        el.focus()
      })()`;
      await this._browserWindow.webContents.executeJavaScript(jsCode);
      inputText = text;
    } else {
      inputText = selectorOrText;
    }
    await this._browserWindow.webContents.insertText(inputText);
  }
  /**
   * 物理鼠标事件（通过 sendInputEvent 实现）
   *
   * 支持两种定位方式：
   * 1. 坐标模式: mouseEvent(eventType, x, y, button?)
   * 2. 选择器模式: mouseEvent(eventType, selector, button?) - 先查询元素中心坐标
   *
   * @param eventType 事件类型（click / dblclick / mousedown / mouseup / mouseMove）
   * @param args 坐标或选择器参数
   */
  async mouseEvent(eventType, ...args) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    let x;
    let y;
    let button = "left";
    if (typeof args[0] === "number" && typeof args[1] === "number") {
      x = args[0];
      y = args[1];
      if (typeof args[2] === "string") button = args[2];
    } else if (typeof args[0] === "string") {
      const selector = args[0];
      const jsCode = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      })()`;
      const pos = await this._browserWindow.webContents.executeJavaScript(jsCode);
      if (!pos) {
        throw new Error(`mouseEvent: unable to find element by selector "${selector}"`);
      }
      x = pos.x;
      y = pos.y;
      if (typeof args[1] === "string") button = args[1];
    } else {
      throw new Error("mouseEvent: parameter error");
    }
    const wc = this._browserWindow.webContents;
    switch (eventType) {
      case "click":
        wc.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1 });
        wc.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: 1 });
        break;
      case "dblclick":
        wc.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1 });
        wc.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: 1 });
        wc.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 2 });
        wc.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: 2 });
        break;
      case "mousedown":
        wc.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1 });
        break;
      case "mouseup":
        wc.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: 1 });
        break;
      case "mouseMove":
        wc.sendInputEvent({ type: "mouseMove", x, y });
        break;
      default:
        throw new Error(`mouseEvent: unsupported event type "${eventType}"`);
    }
  }
  /**
   * 拖放文件到页面中的指定位置
   *
   * 使用 CDP Input.dispatchDragEvent 模拟文件拖放。
   * 支持两种定位方式：
   * 1. drop(selector, files) - 拖放到元素中心
   * 2. drop(x, y, files) - 拖放到坐标位置
   *
   * @param selectorOrX CSS 选择器或 X 坐标
   * @param filesOrY 文件路径数组或 Y 坐标
   * @param files 文件路径数组（坐标模式时）
   */
  async drop(selectorOrX, filesOrY, files) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    let x;
    let y;
    let filePaths;
    if (typeof selectorOrX === "number" && typeof filesOrY === "number") {
      x = selectorOrX;
      y = filesOrY;
      filePaths = files;
    } else if (typeof selectorOrX === "string") {
      const jsCode = `(() => {
        const el = document.querySelector(${JSON.stringify(selectorOrX)})
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      })()`;
      const pos = await this._browserWindow.webContents.executeJavaScript(jsCode);
      if (!pos) {
        throw new Error(`drop: unable to find element by selector "${selectorOrX}"`);
      }
      x = pos.x;
      y = pos.y;
      filePaths = filesOrY;
    } else {
      throw new Error("drop: parameter error");
    }
    for (const f of filePaths) {
      if (!fs.existsSync(f)) {
        throw new Error(`drop: file "${f}" does not exist`);
      }
    }
    const debugger_ = this._browserWindow.webContents.debugger;
    debugger_.attach("1.1");
    try {
      const dragData = {
        items: filePaths.map(() => ({
          mimeType: "application/octet-stream",
          data: ""
        })),
        files: filePaths,
        dragOperationsMask: 1
        // Copy
      };
      await debugger_.sendCommand("Input.dispatchDragEvent", {
        type: "dragEnter",
        x,
        y,
        data: dragData
      });
      await debugger_.sendCommand("Input.dispatchDragEvent", {
        type: "dragOver",
        x,
        y,
        data: dragData
      });
      await debugger_.sendCommand("Input.dispatchDragEvent", {
        type: "drop",
        x,
        y,
        data: dragData
      });
    } finally {
      debugger_.detach();
    }
  }
  /**
   * 将网页内容转换为 Markdown
   *
   * 使用 turndown 库将 HTML 转换为 Markdown。
   * 先在页面上下文中获取 HTML 内容，再在 Node.js 端用 turndown 转换。
   *
   * @param selector 要转换的元素选择器（可选，不传则转换整个页面 body）
   * @returns Markdown 文本
   */
  async markdown(selector) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    const jsCode = selector ? `(() => {
          const el = document.querySelector(${JSON.stringify(selector)})
          return el ? el.innerHTML : null
        })()` : `document.body.innerHTML`;
    const html = await this._browserWindow.webContents.executeJavaScript(jsCode);
    if (html === null) {
      throw new Error(`markdown: unable to find element by selector "${selector}"`);
    }
    const turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced"
    });
    return turndownService.turndown(html);
  }
  /**
   * 设置文件输入框的文件列表
   *
   * 使用 Chrome DevTools Protocol（CDP）的 DOM.setFileInputFiles 命令。
   *
   * @param selector CSS 选择器
   * @param files 文件路径数组
   */
  async file(selector, files) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    const allowedDir = path.join(electron.app.getPath("temp"), "ztools-zbrowser");
    for (const filePath of files) {
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(allowedDir + path.sep) && !resolved.startsWith(allowedDir)) {
        throw new Error(`file: access restricted to temp directory`);
      }
    }
    const debugger_ = this._browserWindow.webContents.debugger;
    debugger_.attach("1.1");
    try {
      const doc = await debugger_.sendCommand("DOM.getDocument");
      const result = await debugger_.sendCommand("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector
      });
      await debugger_.sendCommand("DOM.setFileInputFiles", {
        nodeId: result.nodeId,
        files
      });
    } finally {
      debugger_.detach();
    }
  }
  /**
   * 截取窗口或元素的截图
   *
   * @param rect 截图区域（Electron.Rectangle）或 null（整个窗口）
   * @param savePath 保存路径（目录或完整文件路径）
   * @returns 保存的文件路径
   */
  async capture(rect, savePath) {
    let dir;
    let fileName;
    if (savePath) {
      const resolvedPath = path.resolve(savePath);
      const tempBase = electron.app.getPath("temp");
      const downloadBase = electron.app.getPath("downloads");
      if (!resolvedPath.startsWith(tempBase) && !resolvedPath.startsWith(downloadBase)) {
        throw new Error("save path must be within temp or downloads directory");
      }
      if (/\.png$/i.test(savePath)) {
        dir = path.dirname(resolvedPath);
        fileName = path.basename(resolvedPath);
      } else {
        dir = resolvedPath;
      }
      if (!fs.existsSync(dir)) {
        throw new Error("save directory not exist");
      }
    } else {
      dir = path.join(electron.app.getPath("temp"), "ztools-zbrowser");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    const image = await this._browserWindow.webContents.capturePage(rect ?? void 0);
    if (image.isEmpty()) {
      throw new Error("capture image destroyed");
    }
    const filePath = path.join(dir, fileName || `${Date.now()}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    return filePath;
  }
  /**
   * 按选择器或区域截图
   *
   * 选择器模式：先滚动到元素、再获取坐标（Math.round 取整）、再截图。
   * 与 uTools 行为一致。
   *
   * @param selectorOrRect CSS 选择器字符串、Rectangle 对象、或 undefined（整个窗口）
   * @param savePath 保存路径
   * @returns 文件路径
   */
  async screenshot(selectorOrRect, savePath) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    if (typeof selectorOrRect === "string") {
      const jsCode = `(()=>{
        const selector = ${JSON.stringify(selectorOrRect)}
        const element = document.querySelector(selector)
        if (!element) return
        let rect = element.getBoundingClientRect()
        window.scrollTo(rect.left, rect.top)
        rect = element.getBoundingClientRect()
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      })()`;
      const rect = await this._browserWindow.webContents.executeJavaScript(jsCode);
      if (rect) {
        return await this.capture(rect, savePath);
      }
      throw new Error(`unable to find element by selector "${selectorOrRect}"`);
    } else if (typeof selectorOrRect === "object") {
      return await this.capture(selectorOrRect, savePath);
    } else if (selectorOrRect === void 0) {
      return await this.capture(null, savePath);
    }
    throw new Error("parameter error");
  }
  /**
   * 将页面导出为 PDF
   *
   * @param args [options?, savePath?]
   * @returns PDF 文件路径
   */
  async pdf(...args) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    let pdfOptions = {};
    let savePath = null;
    if (args.length === 1) {
      if (typeof args[0] === "object") {
        pdfOptions = args[0] || {};
      } else if (typeof args[0] === "string") {
        savePath = args[0];
      }
    } else if (args.length > 1) {
      if (typeof args[0] === "object") {
        pdfOptions = args[0] || {};
      }
      if (typeof args[1] === "string") {
        savePath = args[1];
      }
    }
    let dir;
    let fileName;
    if (savePath) {
      const resolvedPath = path.resolve(savePath);
      const tempBase = electron.app.getPath("temp");
      const downloadBase = electron.app.getPath("downloads");
      if (!resolvedPath.startsWith(tempBase) && !resolvedPath.startsWith(downloadBase)) {
        throw new Error("save path must be within temp or downloads directory");
      }
      if (/\.pdf$/i.test(savePath)) {
        dir = path.dirname(resolvedPath);
        fileName = path.basename(resolvedPath);
      } else {
        dir = resolvedPath;
      }
      if (!fs.existsSync(dir)) {
        throw new Error("save directory not exist");
      }
    } else {
      dir = path.join(electron.app.getPath("temp"), "ztools-zbrowser");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    const data = await this._browserWindow.webContents.printToPDF(pdfOptions);
    const filePath = path.join(dir, fileName || `${Date.now()}.pdf`);
    fs.writeFileSync(filePath, data);
    return filePath;
  }
  /**
   * 下载文件
   *
   * 支持两种调用方式：
   * 1. download(url, savePath?) - 直接下载 URL
   * 2. download(jsCode, savePath, true) - 先在页面中执行代码获取 URL，再下载
   *
   * @param urlOrCode 下载地址或序列化的 JS 代码
   * @param savePath 保存路径（可选）
   * @param isFunc 是否为函数模式（第三个参数为 true 时）
   * @returns 下载后的文件路径
   */
  async download(urlOrCode, savePath, isFunc) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    let url2;
    if (isFunc) {
      const result = await this._browserWindow.webContents.executeJavaScript(urlOrCode, true);
      if (result.error) {
        throw new Error(result.message);
      }
      url2 = result.data;
      if (!url2 || typeof url2 !== "string") {
        throw new Error("download: function did not return a valid URL");
      }
    } else {
      url2 = urlOrCode;
    }
    if (!url2 || typeof url2 !== "string" || !/^https?:\/\//.test(url2)) {
      throw new Error("download: url must be http or https");
    }
    return await new Promise((resolve, reject) => {
      const sess = this._browserWindow.webContents.session;
      sess.once("will-download", (_event, item) => {
        let finalPath = savePath;
        if (finalPath) {
          try {
            if (fs.existsSync(finalPath)) {
              if (!fs.lstatSync(finalPath).isDirectory()) {
                throw new Error(`"${finalPath}" existed`);
              }
              finalPath = path.join(finalPath, path.basename(item.getFilename()));
              if (fs.existsSync(finalPath)) {
                throw new Error(`"${finalPath}" existed`);
              }
            } else {
              const dir = path.dirname(finalPath);
              if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) {
                throw new Error(`save directory "${dir}" no exist`);
              }
              if (!path.extname(finalPath)) {
                finalPath += path.extname(item.getFilename());
              }
            }
          } catch (err) {
            _event.preventDefault();
            reject(err);
            return;
          }
        } else {
          const tempDir = path.join(
            electron.app.getPath("temp"),
            "ztools-zbrowser",
            `download_${Date.now()}`
          );
          try {
            fs.mkdirSync(tempDir, { recursive: true });
          } catch (err) {
            _event.preventDefault();
            reject(err);
            return;
          }
          finalPath = path.join(tempDir, path.basename(item.getFilename()));
        }
        item.setSavePath(finalPath);
        item.once("done", (_e, state) => {
          if (state === "completed") {
            resolve(finalPath);
          } else {
            reject(new Error("download failed"));
          }
        });
      });
      this._browserWindow.webContents.downloadURL(url2);
    });
  }
  /**
   * 设备模拟
   *
   * @param typeOrConfig 设备名称（字符串）或自定义配置对象
   */
  async device(typeOrConfig) {
    let config;
    if (typeof typeOrConfig === "string") {
      if (!(typeOrConfig in ZBROWSER_DEVICES)) {
        throw new Error("type not found");
      }
      config = ZBROWSER_DEVICES[typeOrConfig];
    } else if (typeof typeOrConfig === "object") {
      if (typeof typeOrConfig.size !== "object" || typeof typeOrConfig.size.width !== "number" || typeof typeOrConfig.size.height !== "number") {
        throw new Error('property "size" wrong');
      }
      if (typeof typeOrConfig.useragent !== "string") {
        throw new Error('property "useragent" wrong');
      }
      config = typeOrConfig;
    } else {
      throw new Error("parameter error");
    }
    const win = this._browserWindow;
    win.setContentSize(config.size.width, config.size.height);
    win.resizable = false;
    win.maximizable = false;
    win.fullScreenable = false;
    win.webContents.userAgent = config.useragent;
    const wc = win.webContents;
    if (!wc._zbrowserDeviceEmulationEnabled) {
      wc._zbrowserDeviceEmulationEnabled = true;
      wc.on("dom-ready", () => {
        const contentSize = win.getContentSize();
        win.webContents.enableDeviceEmulation({
          screenPosition: "mobile",
          screenSize: { width: contentSize[0], height: contentSize[1] },
          viewPosition: { x: 0, y: 0 },
          viewSize: { width: contentSize[0], height: contentSize[1] },
          deviceScaleFactor: 0,
          scale: 1
        });
      });
    }
  }
  // ─────────────────── Cookie 操作 ───────────────────
  /**
   * 获取 Cookie
   *
   * 与 uTools 签名一致：cookies(name?) → 不传参返回全部，传 name 返回单个。
   */
  async cookies(name) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    const filter = {
      url: this._browserWindow.webContents.getURL()
    };
    if (typeof name === "string" && name) {
      filter.name = name;
    }
    const cookies = await this._browserWindow.webContents.session.cookies.get(filter);
    if (typeof name === "string" && name) {
      return cookies.length > 0 ? cookies[0] : null;
    }
    return cookies;
  }
  /**
   * 设置 Cookie
   *
   * 支持两种签名：setCookies(name, value) 或 setCookies([{name, value, ...}])
   */
  async setCookies(...args) {
    const sess = this._browserWindow.webContents.session;
    const currentUrl = this._pageIsDomReadyed ? this._browserWindow.webContents.getURL() : void 0;
    if (args.length === 2 && typeof args[0] === "string") {
      const details = {
        url: currentUrl || "http://localhost",
        name: args[0],
        value: args[1]
      };
      await sess.cookies.set(details);
    } else if (Array.isArray(args[0])) {
      for (const cookie of args[0]) {
        await sess.cookies.set({ ...cookie, url: cookie.url || currentUrl || "http://localhost" });
      }
    }
  }
  /**
   * 删除指定名称的 Cookie
   *
   * 使用当前页面 URL。
   */
  async removeCookies(name) {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed');
    }
    const url2 = this._browserWindow.webContents.getURL();
    await this._browserWindow.webContents.session.cookies.remove(url2, name);
  }
  /**
   * 清除 Cookie
   *
   * 页面已加载时使用当前 URL（忽略参数），否则 url 参数必传。
   */
  async clearCookies(url2) {
    const sess = this._browserWindow.webContents.session;
    const targetUrl = this._pageIsDomReadyed ? this._browserWindow.webContents.getURL() : url2;
    if (!targetUrl) {
      throw new Error("url is required when page is not loaded");
    }
    const cookies = await sess.cookies.get({ url: targetUrl });
    for (const cookie of cookies) {
      await sess.cookies.remove(targetUrl, cookie.name);
    }
  }
  // ─────────────────── 运行入口 ───────────────────
  /**
   * 执行 zbrowser 操作队列
   *
   * @param params.pluginName  插件名称（用于 Session 隔离和窗口池）
   * @param params.pluginLogo  插件图标路径（窗口图标）
   * @param params.ubrowserId  复用的窗口 ID（可选）
   * @param params.options     窗口配置对象
   * @param params.queue       操作队列
   * @param params.idleWindowIds 当前插件的空闲窗口 ID 列表
   * @returns 运行结果
   */
  async run(params) {
    const { pluginName, runtimeNamespace, pluginLogo, ubrowserId, options, queue, idleWindowIds } = params;
    console.log(
      `[zbrowser] 开始执行: pluginName="${pluginName}", runtimeNamespace="${runtimeNamespace}", 队列长度=${queue.length}, 模式=${ubrowserId ? "复用窗口#" + ubrowserId : "新建窗口"}`
    );
    try {
      if (ubrowserId !== void 0) {
        if (!idleWindowIds.includes(ubrowserId)) {
          throw new Error("no ubrowser with id");
        }
        const win = electron.BrowserWindow.fromId(ubrowserId);
        if (!win || win.isDestroyed()) {
          throw new Error("no ubrowser with id");
        }
        this._browserWindow = win;
        zbrowserManager.removeIdleWindow(runtimeNamespace, ubrowserId);
        console.log(`[zbrowser] 复用空闲窗口: windowId=${ubrowserId}`);
      } else {
        this._browserWindow = this.createBrowserWindow(
          runtimeNamespace,
          pluginName,
          pluginLogo,
          options
        );
        console.log(`[zbrowser] 新建窗口: windowId=${this._browserWindow.id}`);
      }
      if (options.show !== false) {
        this._isShow = true;
      }
      const result = await this.forkAndExecute(queue);
      this.handleWindowAfterRun(runtimeNamespace);
      if (this._browserWindow && !this._browserWindow.isDestroyed()) {
        const win = this._browserWindow;
        const bounds = win.getBounds();
        result.windowId = win.id;
        result.windowInfo = {
          id: win.id,
          url: win.webContents.getURL(),
          title: win.getTitle(),
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y
        };
      }
      return result;
    } catch (error) {
      this.destroyWindow();
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[zbrowser] 执行失败: ${message}`);
      return { data: [], error: true, message };
    }
  }
  // ─────────────────── 私有方法 ───────────────────
  /**
   * 创建 BrowserWindow
   *
   * 使用插件专属 zbrowser Session，严格过滤允许的窗口选项。
   */
  createBrowserWindow(runtimeNamespace, pluginName, pluginLogo, options) {
    const sess = zbrowserManager.getOrCreateSession(runtimeNamespace, pluginName);
    const winOptions = {
      show: false,
      // 首次 goto 时再自动 show
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        session: sess
      }
    };
    const allowedKeys = [
      "width",
      "height",
      "x",
      "y",
      "center",
      "minWidth",
      "minHeight",
      "maxWidth",
      "maxHeight",
      "resizable",
      "movable",
      "minimizable",
      "maximizable",
      "alwaysOnTop",
      "fullscreen",
      "fullscreenable",
      "enableLargerThanScreen",
      "opacity",
      "frame",
      "closable",
      "focusable",
      "skipTaskbar",
      "backgroundColor",
      "hasShadow",
      "transparent",
      "titleBarStyle",
      "thickFrame"
    ];
    for (const key of allowedKeys) {
      if (options[key] !== void 0) {
        winOptions[key] = options[key];
      }
    }
    if (pluginLogo && fs.existsSync(pluginLogo)) {
      winOptions.icon = pluginLogo;
    }
    const win = new electron.BrowserWindow(winOptions);
    win.webContents.on("focus", () => {
      if (win && !win.webContents.isDestroyed()) {
        devToolsShortcut.register(win.webContents);
      }
    });
    win.webContents.on("blur", () => {
      devToolsShortcut.unregister();
    });
    return win;
  }
  /**
   * fork runner 子进程并执行操作队列
   *
   * runner 子进程通过 IPC 消息与主进程通信：
   * - runner → main: { method, methodEndKey, args } 请求执行操作
   * - main → runner: { action, payload } 返回执行结果
   * - runner → main: { method: 'runEnd', args: [result] } 队列执行完毕
   */
  forkAndExecute(queue) {
    return new Promise((resolve, reject) => {
      const actualRunnerPath = electron.app.isPackaged ? path.join(process.resourcesPath, "zbrowser", "runner.js") : path.join(__dirname, "../../resources/zbrowser/runner.js");
      this._childProcess = child_process.fork(actualRunnerPath, [], {
        stdio: ["pipe", "pipe", "pipe", "ipc"]
      });
      let settled = false;
      const globalTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.error(`[zbrowser] 执行超时（${EXECUTION_TIMEOUT}ms），强制终止`);
        this.killChildProcess();
        reject(new Error("zbrowser execution timeout"));
      }, EXECUTION_TIMEOUT);
      this._childProcess.stdout?.on("data", (data) => {
        console.log(`[zbrowser:runner:stdout] ${data.toString().trim()}`);
      });
      this._childProcess.stderr?.on("data", (data) => {
        console.error(`[zbrowser:runner:stderr] ${data.toString().trim()}`);
      });
      this._childProcess.on("message", async (msg) => {
        const { method, methodEndKey, args } = msg;
        if (method === "runEnd") {
          if (settled) return;
          settled = true;
          clearTimeout(globalTimer);
          const result = args[0] || { data: [] };
          this.killChildProcess();
          resolve(result);
          return;
        }
        if (!ALLOWED_METHODS.has(method)) {
          console.error(`[zbrowser] 拒绝执行不允许的方法: "${method}"`);
          this.sendToRunner(methodEndKey, { error: true, message: `unknown method: ${method}` });
          return;
        }
        try {
          const handler = this[method];
          const data = await handler.apply(this, args);
          this.sendToRunner(methodEndKey, { data });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[zbrowser] 方法 "${method}" 执行失败: ${message}`);
          this.sendToRunner(methodEndKey, { error: true, message });
        }
      });
      this._childProcess.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        if (code !== 0 && code !== null) {
          console.error(`[zbrowser] runner 子进程异常退出, code=${code}`);
          reject(new Error(`runner process exited with code ${code}`));
        } else {
          console.error(`[zbrowser] runner 子进程退出但未返回结果`);
          reject(new Error("runner process exited without sending results"));
        }
      });
      this._childProcess.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        console.error(`[zbrowser] runner 子进程错误:`, err.message);
        reject(err);
      });
      const startMsg = {
        action: "run",
        payload: queue
      };
      this._childProcess.send(startMsg);
    });
  }
  /**
   * 发送响应消息给 runner 子进程
   */
  sendToRunner(methodEndKey, payload) {
    if (this._childProcess && this._childProcess.connected) {
      const msg = {
        action: methodEndKey,
        payload
      };
      this._childProcess.send(msg);
    }
  }
  /**
   * 运行结束后处理窗口：可见窗口加入空闲池，不可见窗口销毁
   */
  handleWindowAfterRun(runtimeNamespace) {
    if (!this._browserWindow || this._browserWindow.isDestroyed()) return;
    if (this._browserWindow.isVisible()) {
      zbrowserManager.addIdleWindow(runtimeNamespace, this._browserWindow.id);
      console.log(`[zbrowser] 窗口保留为空闲: windowId=${this._browserWindow.id}`);
      const windowId = this._browserWindow.id;
      this._browserWindow.once("closed", () => {
        zbrowserManager.removeIdleWindow(runtimeNamespace, windowId);
        devToolsShortcut.unregister();
      });
    } else {
      this.destroyWindow();
      console.log(`[zbrowser] 不可见窗口已销毁`);
    }
  }
  /** 销毁 BrowserWindow */
  destroyWindow() {
    if (this._browserWindow && !this._browserWindow.isDestroyed()) {
      this._browserWindow.destroy();
    }
    this._browserWindow = null;
  }
  /** 终止 runner 子进程 */
  killChildProcess() {
    if (this._childProcess) {
      this._childProcess.removeAllListeners();
      if (this._childProcess.connected) {
        this._childProcess.disconnect();
      }
      this._childProcess.kill("SIGTERM");
      this._childProcess = null;
    }
  }
}
class ZBrowserAPI {
  pluginManager = null;
  init(_mainWindow, pluginManager2) {
    this.pluginManager = pluginManager2;
    this.registerHandlers();
  }
  registerHandlers() {
    const pluginManager2 = this.pluginManager;
    registerPluginApiServices({
      /**
       * 异步 API：执行 zbrowser 操作队列
       *
       * 创建 ZBrowserExecutor 实例，fork runner 子进程，
       * 在独立 BrowserWindow 中执行操作并返回结果。
       */
      runZBrowser: async (event, { ubrowserId, options, queue }) => {
        const pluginInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) throw new Error("plugin not found");
        const executor = new ZBrowserExecutor();
        console.log("[zbrowser] 插件名:", {
          pluginName: pluginInfo.name,
          pluginPath: pluginInfo.path
        });
        return await executor.run({
          pluginName: pluginInfo.name,
          runtimeNamespace: pluginInfo.name,
          pluginLogo: pluginInfo.logo || "",
          ubrowserId,
          options: options || {},
          queue,
          idleWindowIds: zbrowserManager.getIdleWindowIds(pluginInfo.name)
        });
      },
      /**
       * 同步 API：获取空闲窗口列表
       *
       * 返回 ZBrowserIdleWindowInfo[] 给插件（id、title、url）。
       */
      getIdleZBrowsers: (event) => {
        const pluginInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) {
          event.returnValue = [];
          return;
        }
        event.returnValue = zbrowserManager.getIdleWindows(pluginInfo.name);
      },
      /**
       * 异步 API：设置代理
       *
       * ⚠️ 破坏性变更：uTools 为同步 sendSync 返回 boolean，
       * ZTools 改为 ipcInvoke 异步（因为 session.setProxy 是 Promise）。
       * 插件需改为 `await utools.setUBrowserProxy(config)`。
       */
      setZBrowserProxy: async (event, config) => {
        const pluginInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) return false;
        await zbrowserManager.setProxy(pluginInfo.name, config);
        return true;
      },
      /**
       * 异步 API：清除缓存
       *
       * ⚠️ 破坏性变更：同上，uTools 为同步，ZTools 改为异步。
       */
      clearZBrowserCache: async (event) => {
        const pluginInfo = pluginManager2.getPluginInfoByWebContents(event.sender);
        if (!pluginInfo) return false;
        await zbrowserManager.clearCache(pluginInfo.name);
        return true;
      },
      /**
       * 异步 API：ubrowserLogin 兼容桩
       *
       * uTools 实现：弹出 OAuth 登录窗口，返回用户登录凭证。
       * ZTools 暂不支持此功能，返回 null 并记录警告日志。
       */
      ubrowserLogin: async () => {
        console.warn("[zbrowser] ubrowserLogin is not supported in ZTools");
        return null;
      }
    });
    console.log("[zbrowser] API 注册完成");
  }
}
const zbrowserAPI = new ZBrowserAPI();
const ffmpegDownloadHtml = path.join(__dirname, "../../resources/ffmpeg.html");
class FFmpegManager {
  downloadWindow = null;
  downloadingPromise = null;
  ACCELERATION_STATIONS = [
    "https://gh-proxy.org/",
    "https://hk.gh-proxy.org/",
    "https://cdn.gh-proxy.org/",
    "https://edgeone.gh-proxy.org/"
  ];
  DOWNLOAD_URLS = {
    "win32-x64": "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.0-latest-win64-gpl-8.0.zip",
    "win32-arm64": "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.0-latest-winarm64-gpl-8.0.zip",
    "darwin-arm64": "https://github.com/eko5624/mpv-mac/releases/download/2026-03-09/ffmpeg-arm64-248b481c33.zip",
    "darwin-x64": "https://github.com/eko5624/mpv-mac/releases/download/2026-03-09/ffmpeg-x86_64-248b481c33.zip"
  };
  /**
   * FFmpeg 存储路径: {userData}/extends/ffmpeg{.exe}
   */
  resolveFFmpegPath() {
    const ext = process.platform === "win32" ? ".exe" : "";
    return path.join(electron.app.getPath("userData"), "extends", `ffmpeg${ext}`);
  }
  getDownloadUrl() {
    const key = `${process.platform}-${process.arch}`;
    const url2 = this.DOWNLOAD_URLS[key];
    if (!url2) throw new Error(`不支持的平台: ${key}`);
    return url2;
  }
  /**
   * ZIP 内查找 ffmpeg 二进制文件
   * Windows: 路径含版本号，需动态查找 bin/ffmpeg.exe
   * macOS: 固定路径 ffmpeg/ffmpeg
   */
  findFFmpegEntry(zip) {
    if (process.platform === "darwin") {
      return zip.getEntry("ffmpeg/ffmpeg");
    }
    for (const entry of zip.getEntries()) {
      if (entry.entryName.includes("/bin/ffmpeg.exe")) {
        return entry;
      }
    }
    return null;
  }
  /**
   * 确保 FFmpeg 可用，不存在则触发下载
   */
  async ensureFFmpeg() {
    const ffmpegPath = this.resolveFFmpegPath();
    if (await fs.promises.access(ffmpegPath).then(() => true).catch(() => false)) {
      return ffmpegPath;
    }
    if (this.downloadingPromise) {
      return this.downloadingPromise;
    }
    this.downloadingPromise = this.downloadAndInstall();
    return this.downloadingPromise;
  }
  /**
   * 并发测试所有加速站 + 直连，返回响应最快的代理前缀（空字符串表示直连）
   */
  async selectFastestStation(githubUrl) {
    const testStation = (prefix) => {
      return new Promise((resolve, reject) => {
        const url2 = prefix ? `${prefix}${githubUrl}` : githubUrl;
        const start = Date.now();
        const request = electron.net.request({ url: url2, method: "HEAD", session: electron.session.defaultSession });
        const timer = setTimeout(() => {
          request.abort();
          reject(new Error("timeout"));
        }, 8e3);
        request.on("response", (response) => {
          clearTimeout(timer);
          request.abort();
          if (response.statusCode && response.statusCode < 400) {
            resolve({ prefix, latency: Date.now() - start });
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        });
        request.on("error", () => {
          clearTimeout(timer);
          reject(new Error("connection failed"));
        });
        request.end();
      });
    };
    const prefixes = [
      ...this.ACCELERATION_STATIONS,
      ""
      // 直连 GitHub
    ];
    const results = await Promise.allSettled(prefixes.map((p) => testStation(p)));
    const fastest = results.filter(
      (r) => r.status === "fulfilled"
    ).map((r) => r.value).sort((a, b) => a.latency - b.latency);
    if (fastest.length === 0) {
      throw new Error("所有下载节点均不可用");
    }
    return fastest[0].prefix;
  }
  async downloadAndInstall() {
    try {
      this.showDownloadWindow();
      await this.waitForUserConfirmation();
      this.updateProgressText("正在选择最快的下载节点...");
      const githubUrl = this.getDownloadUrl();
      const prefix = await this.selectFastestStation(githubUrl);
      const downloadUrl = prefix ? `${prefix}${githubUrl}` : githubUrl;
      const tempZip = path.join(electron.app.getPath("temp"), `ffmpeg-${Date.now()}.zip`);
      try {
        await this.streamDownload(downloadUrl, tempZip);
      } catch (err) {
        this.showError(`下载失败: ${err instanceof Error ? err.message : "未知错误"}`);
        await Promise.race([
          new Promise((r) => setTimeout(r, 3e3)),
          new Promise((r) => {
            if (!this.downloadWindow || this.downloadWindow.isDestroyed()) return r();
            this.downloadWindow.once("closed", () => r());
          })
        ]);
        throw err;
      }
      const ffmpegPath = this.resolveFFmpegPath();
      await fs.promises.mkdir(path.dirname(ffmpegPath), { recursive: true });
      const zip = new AdmZip(tempZip);
      const entry = this.findFFmpegEntry(zip);
      if (!entry) throw new Error("ZIP 中未找到 ffmpeg 二进制文件");
      const buffer = zip.readFile(entry);
      if (!buffer) throw new Error("无法读取 ZIP 中的 ffmpeg 文件");
      await fs.promises.writeFile(ffmpegPath, buffer);
      if (process.platform !== "win32") {
        await fs.promises.chmod(ffmpegPath, 493);
      }
      await this.verifyFFmpegBinary(ffmpegPath);
      await fs.promises.unlink(tempZip).catch(() => {
      });
      this.closeDownloadWindow();
      return ffmpegPath;
    } catch (error) {
      this.closeDownloadWindow();
      throw error;
    } finally {
      this.downloadingPromise = null;
    }
  }
  /**
   * 等待用户在下载窗口中点击确认按钮
   * 因为下载窗口启用了 sandbox + contextIsolation 且没有注入 preload，
   * 无法使用 ipcRenderer 通信，所以用 location.href 触发 will-navigate 事件作为替代。
   */
  waitForUserConfirmation() {
    return new Promise((resolve, reject) => {
      if (!this.downloadWindow) {
        return reject(new Error("下载窗口未创建"));
      }
      let confirmed = false;
      this.downloadWindow.webContents.on("will-navigate", (event) => {
        event.preventDefault();
        confirmed = true;
        resolve();
      });
      this.downloadWindow.once("closed", () => {
        this.downloadWindow = null;
        if (!confirmed) reject(new Error("用户取消下载"));
      });
    });
  }
  /**
   * 流式下载文件，直接写磁盘避免大文件内存爆炸
   */
  async streamDownload(url2, destPath) {
    return new Promise((resolve, reject) => {
      const request = electron.net.request({ url: url2, session: electron.session.defaultSession });
      let totalBytes = 0;
      let downloadedBytes = 0;
      const writeStream = fs.createWriteStream(destPath);
      let rejected = false;
      const fail = (err) => {
        if (rejected) return;
        rejected = true;
        writeStream.destroy();
        reject(err);
      };
      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          return fail(new Error(`HTTP ${response.statusCode}`));
        }
        const cl = response.headers["content-length"];
        totalBytes = cl ? parseInt(String(cl), 10) : 0;
        response.on("data", (chunk) => {
          writeStream.write(chunk);
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            this.updateProgress(Math.round(downloadedBytes / totalBytes * 100));
          } else {
            this.updateProgressText(`下载中 ${(downloadedBytes / 1048576).toFixed(1)} MB`);
          }
        });
        response.on("end", () => writeStream.end(() => resolve()));
        response.on("error", (err) => fail(err));
      });
      request.on("error", (err) => fail(err));
      request.end();
    });
  }
  /**
   * 验证下载的 ffmpeg 二进制文件完整性
   */
  async verifyFFmpegBinary(ffmpegPath) {
    const stat = await fs.promises.stat(ffmpegPath);
    if (stat.size < 1024 * 1024) {
      await fs.promises.unlink(ffmpegPath).catch(() => {
      });
      throw new Error("ffmpeg 文件过小，可能已损坏");
    }
    const { execFile } = await import("child_process");
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ["-version"], { timeout: 1e4 }, (error, stdout) => {
        if (error || !stdout.includes("ffmpeg")) {
          fs.promises.unlink(ffmpegPath).catch(() => {
          });
          reject(new Error("ffmpeg 验证失败，文件可能已损坏"));
        } else {
          resolve();
        }
      });
    });
  }
  // ── 下载窗口管理 ──
  showDownloadWindow() {
    if (this.downloadWindow && !this.downloadWindow.isDestroyed()) {
      return;
    }
    this.downloadWindow = new electron.BrowserWindow({
      width: 500,
      height: 300,
      center: true,
      resizable: false,
      frame: false,
      alwaysOnTop: true,
      type: process.platform === "darwin" ? "panel" : "toolbar",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    this.downloadWindow.loadFile(ffmpegDownloadHtml);
    this.downloadWindow.once("ready-to-show", () => {
      this.downloadWindow?.show();
    });
  }
  updateProgress(percent) {
    this.downloadWindow?.webContents.executeJavaScript(`if (window.downloadProgressing) window.downloadProgressing(${percent})`).catch(() => {
    });
  }
  updateProgressText(text) {
    this.downloadWindow?.webContents.executeJavaScript(
      `if (window.downloadProgressText) window.downloadProgressText(${JSON.stringify(text)})`
    ).catch(() => {
    });
  }
  showError(message) {
    this.downloadWindow?.webContents.executeJavaScript(
      `if (window.downloadFailed) window.downloadFailed(${JSON.stringify(message)})`
    ).catch(() => {
    });
  }
  closeDownloadWindow() {
    if (this.downloadWindow && !this.downloadWindow.isDestroyed()) {
      this.downloadWindow.close();
    }
    this.downloadWindow = null;
  }
}
const ffmpegManager = new FFmpegManager();
class PluginFFmpegAPI {
  init() {
    registerPluginApiServices({
      getFFmpegPath: async () => {
        return await ffmpegManager.ensureFFmpeg();
      }
    });
  }
}
const pluginFFmpegAPI = new PluginFFmpegAPI();
function migrateLegacyMacAppIcon(item) {
  if (process.platform !== "darwin") return false;
  if (!item || typeof item.path !== "string" || typeof item.icon !== "string") return false;
  if (!item.path.endsWith(".app") || !item.icon.startsWith("ztools-icon://")) return false;
  const encodedPath = item.icon.replace("ztools-icon://", "");
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return false;
  }
  if (!decodedPath.endsWith(".icns")) return false;
  const nextIcon = `ztools-icon://${encodeURIComponent(item.path)}`;
  if (item.icon === nextIcon) return false;
  item.icon = nextIcon;
  return true;
}
function migrateLegacyMacAppIcons(items) {
  if (process.platform !== "darwin" || !Array.isArray(items)) return false;
  let changed = false;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (migrateLegacyMacAppIcon(item)) {
      changed = true;
    }
    if (Array.isArray(item.items) && migrateLegacyMacAppIcons(item.items)) {
      changed = true;
    }
  }
  return changed;
}
function runStartupDataMigrations() {
  migrateDevPluginNames();
  migrateVariantRefLists();
  migrateWebSearchEngineTypes();
  if (process.platform !== "darwin") return;
  const migrationKeys = [
    "command-history",
    "pinned-commands",
    "cached-commands",
    "local-shortcuts",
    "super-panel-pinned"
  ];
  for (const key of migrationKeys) {
    try {
      const data = databaseAPI.dbGet(key);
      if (!Array.isArray(data)) continue;
      if (migrateLegacyMacAppIcons(data)) {
        databaseAPI.dbPut(key, data);
        console.log(`[StartupMigration] 已迁移旧版 macOS 图标数据: ${key}`);
      }
    } catch (error) {
      console.error(`[StartupMigration] 迁移失败: ${key}`, error);
    }
  }
}
function migrateWebSearchEngineTypes() {
  try {
    const data = databaseAPI.dbGet("web-search-engines") || [];
    if (!Array.isArray(data)) return;
    let changed = false;
    const migrated = data.map((item) => {
      if (!item || typeof item !== "object") {
        changed = true;
        return item;
      }
      const next = { ...item };
      if (next.type !== "search" && next.type !== "webpage") {
        next.type = "search";
        changed = true;
      }
      if (typeof next.enabled !== "boolean") {
        next.enabled = true;
        changed = true;
      }
      if (typeof next.keyword !== "string") {
        next.keyword = "";
        changed = true;
      }
      return next;
    });
    if (changed) {
      databaseAPI.dbPut("web-search-engines", migrated);
      console.log("[StartupMigration] 已迁移网页快开配置类型");
    }
  } catch (error) {
    console.error("[StartupMigration] 迁移网页快开配置类型失败:", error);
  }
}
function migrateDevPluginNames() {
  const targetKeys = ["command-history", "pinned-commands", "super-panel-pinned"];
  for (const key of targetKeys) {
    try {
      const data = databaseAPI.dbGet(key) || [];
      if (!Array.isArray(data)) continue;
      let changed = false;
      for (const item of data) {
        if (item?.type !== "plugin") continue;
        if (item.pluginSource === "development" && typeof item.pluginName === "string") {
          if (!isBundledInternalPlugin(item.pluginName) && !isDevelopmentPluginName(item.pluginName)) {
            item.pluginName = toDevPluginName(item.pluginName);
          }
          changed = true;
        }
        if ("pluginSource" in item) {
          delete item.pluginSource;
          changed = true;
        }
      }
      if (changed) {
        databaseAPI.dbPut(key, data);
        console.log(`[StartupMigration] 已迁移开发版插件名称: ${key}`);
      }
    } catch (error) {
      console.error(`[StartupMigration] 开发版插件名称迁移失败: ${key}`, error);
    }
  }
}
function migrateVariantRefLists() {
  const configKeys = ["autoStartPlugin", "outKillPlugin", "autoDetachPlugin"];
  for (const key of configKeys) {
    try {
      const data = databaseAPI.dbGet(key) || [];
      if (!Array.isArray(data)) continue;
      let changed = false;
      const migrated = data.map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.pluginName === "string") {
          changed = true;
          const isDev = item.source === "development" || item.pluginSource === "development";
          if (isDev && !isBundledInternalPlugin(item.pluginName)) {
            return toDevPluginName(item.pluginName);
          }
          return item.pluginName;
        }
        return null;
      }).filter(Boolean);
      if (changed || migrated.length !== data.length) {
        databaseAPI.dbPut(key, migrated);
        console.log(`[StartupMigration] 已迁移插件配置列表: ${key}`);
      }
    } catch (error) {
      console.error(`[StartupMigration] 迁移插件配置列表失败: ${key}`, error);
    }
  }
}
class APIManager {
  pluginManager = null;
  /**
   * 初始化所有API模块
   */
  init(mainWindow, pluginManager2) {
    this.pluginManager = pluginManager2;
    databaseAPI.init(pluginManager2);
    runStartupDataMigrations();
    clipboardAPI.init();
    setupImageAnalysisAPI();
    aiModelsAPI.init();
    appsAPI.init(mainWindow, pluginManager2);
    appsAPI.setShowWindowCallback(() => windowManager.showWindow());
    pluginsAPI.init(mainWindow, pluginManager2);
    windowAPI.init(mainWindow);
    settingsAPI.init(mainWindow, pluginManager2);
    systemAPI.init(mainWindow);
    systemSettingsAPI.init();
    syncAPI.init(mainWindow);
    localShortcutsAPI.init(mainWindow);
    webSearchAPI.init();
    initPluginApiDispatcher();
    pluginToolsAPI.init(pluginManager2);
    pluginAiAPI.init(mainWindow, pluginManager2);
    pluginLifecycleAPI.init(mainWindow, pluginManager2);
    pluginUIAPI.init(mainWindow, pluginManager2);
    windowManager.setOnThemeInfoChanged(() => {
      pluginUIAPI.broadcastThemeInfoToAllPlugins();
    });
    pluginClipboardAPI.init();
    pluginDeviceAPI.init();
    pluginDialogAPI.init(mainWindow);
    pluginWindowAPI.init(mainWindow, pluginManager2);
    pluginScreenAPI.init(mainWindow);
    pluginInputAPI.init(pluginManager2, windowManager, clipboardManager);
    pluginShellAPI.init(clipboardManager);
    pluginRedirectAPI.init(mainWindow, pluginManager2);
    pluginFeatureAPI.init(pluginManager2);
    pluginHttpAPI.init(pluginManager2);
    pluginToastAPI.init(pluginManager2);
    pluginFFmpegAPI.init();
    zbrowserAPI.init(mainWindow, pluginManager2);
    internalPluginAPI.init(mainWindow, pluginManager2);
    updaterAPI.init(mainWindow);
    httpServer.init().catch((error) => {
      console.error("[API] HTTP 服务初始化失败:", error);
    });
    mcpServer.init().catch((error) => {
      console.error("[API] MCP 服务初始化失败:", error);
    });
    superPanelManager.init(mainWindow);
    translationManager.init();
    this.setupSpecialHandlers();
    settingsAPI.setGlobalShortcutHandler(
      (target, context) => this.handleGlobalShortcut(target, context)
    );
  }
  /**
   * 设置特殊的IPC处理器
   * 这些处理器需要协调多个模块，所以放在这里统一管理
   */
  setupSpecialHandlers() {
    electron.ipcMain.handle("get-system-settings", () => systemSettingsAPI.getSystemSettings());
    electron.ipcMain.handle("is-windows", () => systemSettingsAPI.isWindows());
    electron.ipcMain.handle("open-plugin-devtools", async () => {
      try {
        if (this.pluginManager) {
          const result = await this.pluginManager.openPluginDevTools();
          if (result) {
            return { success: true };
          } else {
            return { success: false, error: "没有活动的插件" };
          }
        }
        return { success: false, error: "功能不可用" };
      } catch (error) {
        console.error("[API] 打开开发者工具失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
    electron.ipcMain.handle("detach-plugin", async () => {
      try {
        if (this.pluginManager) {
          const result = await this.pluginManager.detachCurrentPlugin();
          return result;
        }
        return { success: false, error: "功能不可用" };
      } catch (error) {
        console.error("[API] 分离插件失败:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "未知错误"
        };
      }
    });
  }
  /**
   * 设置启动参数（用于插件进入时传递参数）
   */
  setLaunchParam(param) {
    pluginLifecycleAPI.setLaunchParam(param);
  }
  /**
   * 获取启动参数
   */
  getLaunchParam() {
    return appsAPI.getLaunchParam();
  }
  /**
   * 数据库辅助方法（供其他模块使用）
   */
  dbPut(key, data) {
    return databaseAPI.dbPut(key, data);
  }
  dbGet(key) {
    return databaseAPI.dbGet(key);
  }
  /**
   * 启动插件（供其他模块使用）
   */
  async launchPlugin(options) {
    return await appsAPI.launch(options);
  }
  /**
   * 调整窗口高度（供 pluginManager 使用）
   */
  resizeWindow(height) {
    windowAPI.resizeWindow(height);
  }
  /**
   * 预解析全局快捷键目标，判断启动前是否需要采集选中文本。
   * 仅文本类插件命令会触发复制取词，避免无关快捷键产生副作用。
   */
  async prepareGlobalShortcut(target) {
    try {
      const parts = target.split("/");
      const plugins = databaseAPI.dbGet("plugins");
      const disabledPlugins = pluginsAPI.getDisabledPluginSet();
      const pluginList = Array.isArray(plugins) ? plugins.filter((plugin) => !disabledPlugins.has(plugin.path)) : [];
      if (parts.length === 2) {
        const [pluginDescription, cmdName] = parts;
        const plugin = pluginList.find(
          (p) => p.name === pluginDescription || p.title === pluginDescription
        );
        if (!plugin) {
          return { target, shouldCaptureSelectedText: false };
        }
        const result = await this.findCommandInPlugin(plugin, cmdName);
        return {
          target,
          shouldCaptureSelectedText: this.shouldCaptureSelectedTextForCmdType(result?.cmdType)
        };
      }
      if (parts.length !== 1) {
        return { target, shouldCaptureSelectedText: false };
      }
      const pluginMatches = [];
      for (const plugin of pluginList) {
        const result = await this.findCommandInPlugin(plugin, target);
        if (result) {
          pluginMatches.push({ cmdType: result.cmdType });
        }
      }
      return {
        target,
        shouldCaptureSelectedText: pluginMatches.length === 1 && this.shouldCaptureSelectedTextForCmdType(pluginMatches[0].cmdType)
      };
    } catch {
      return { target, shouldCaptureSelectedText: false };
    }
  }
  shouldCaptureSelectedTextForCmdType(cmdType) {
    return cmdType === "text" || cmdType === "over" || cmdType === "regex";
  }
  /**
   * 在指定插件中查找匹配的命令
   */
  async findCommandInPlugin(plugin, cmdName) {
    const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name);
    const webSearchFeatures = plugin.name === "system" ? await webSearchAPI.getSearchEngineFeatures() : [];
    const allFeatures = [...plugin.features || [], ...dynamicFeatures, ...webSearchFeatures];
    for (const feature of allFeatures) {
      if (feature.cmds && Array.isArray(feature.cmds)) {
        for (const cmd of feature.cmds) {
          if (typeof cmd === "string") {
            if (cmd === cmdName) {
              return { feature, cmdLabel: cmd, cmdType: "text" };
            }
          } else if (typeof cmd === "object" && cmd.label) {
            if (cmd.label === cmdName) {
              return { feature, cmdLabel: cmd.label, cmdType: cmd.type || "text" };
            }
          }
        }
      }
    }
    return null;
  }
  /**
   * 启动匹配到的插件命令
   */
  async launchMatchedPlugin(plugin, feature, cmdLabel, cmdType, context) {
    const launchOptions = {
      path: plugin.path,
      type: "plugin",
      featureCode: feature.code,
      name: cmdLabel,
      cmdType,
      param: {
        ...this.buildShortcutLaunchParam(cmdType, context),
        code: feature.code
      }
    };
    console.log(`[API] 启动插件:`, launchOptions);
    await appsAPI.launch(launchOptions);
  }
  /**
   * 启动系统应用或系统设置（direct 类型指令）
   */
  async launchDirectCommand(command, context) {
    console.log("[API] 通过全局快捷键启动系统应用:", command.name, command.path);
    await appsAPI.launch({
      path: command.path,
      type: "direct",
      name: command.name,
      cmdType: command.cmdType || "text",
      param: this.buildShortcutLaunchParam(command.cmdType || "text", context)
    });
  }
  /**
   * 处理全局快捷键触发（供 windowManager 调用）
   */
  async handleGlobalShortcutTrigger(target, context) {
    return this.handleGlobalShortcut(target, context);
  }
  /**
   * 处理全局快捷键触发
   * 支持两种格式：
   *   - "插件名称/指令名称"（精确匹配指定插件）
   *   - "指令名称"（在所有插件和系统应用中搜索，若多个匹配则提示）
   */
  async handleGlobalShortcut(target, context) {
    try {
      const plugins = databaseAPI.dbGet("plugins");
      const disabledPlugins = pluginsAPI.getDisabledPluginSet();
      const pluginList = Array.isArray(plugins) ? plugins.filter((plugin) => !disabledPlugins.has(plugin.path)) : [];
      const parts = target.split("/");
      if (parts.length === 2) {
        const [pluginDescription, cmdName] = parts;
        const plugin = pluginList.find(
          (p) => p.name === pluginDescription || p.title === pluginDescription
        );
        if (!plugin) {
          const msg = `[API] 未找到插件: ${pluginDescription}`;
          console.error(msg);
          if (electron.Notification.isSupported()) {
            new electron.Notification({ title: "ZTools", body: msg }).show();
          }
          return;
        }
        const result = await this.findCommandInPlugin(plugin, cmdName);
        if (!result) {
          const msg = `[API] 未找到命令: ${pluginDescription}/${cmdName}`;
          console.error(msg);
          if (electron.Notification.isSupported()) {
            new electron.Notification({ title: "ZTools", body: msg }).show();
          }
          return;
        }
        await this.launchMatchedPlugin(
          plugin,
          result.feature,
          result.cmdLabel,
          result.cmdType,
          context
        );
      } else {
        const cmdName = target;
        const pluginMatches = [];
        for (const plugin of pluginList) {
          const result = await this.findCommandInPlugin(plugin, cmdName);
          if (result) {
            pluginMatches.push({
              plugin,
              feature: result.feature,
              cmdLabel: result.cmdLabel,
              cmdType: result.cmdType
            });
          }
        }
        const directCommand = await appsAPI.findDirectCommandByName(cmdName);
        const totalMatches = pluginMatches.length + (directCommand ? 1 : 0);
        if (totalMatches === 0) {
          const msg = `[API] 未找到命令: ${cmdName}`;
          console.error(msg);
          if (electron.Notification.isSupported()) {
            new electron.Notification({ title: "ZTools", body: msg }).show();
          }
          return;
        }
        if (totalMatches > 1) {
          const matchNames = pluginMatches.map((m) => m.plugin.title || m.plugin.name);
          if (directCommand) {
            matchNames.push(`系统应用「${directCommand.name}」`);
          }
          const msg = `[API] 多个指令匹配「${cmdName}」: ${matchNames.join("、")}，请使用「插件名称/${cmdName}」格式精确指定`;
          console.warn(msg);
          if (electron.Notification.isSupported()) {
            new electron.Notification({ title: "ZTools", body: msg }).show();
          }
          return;
        }
        if (pluginMatches.length === 1) {
          const { plugin, feature, cmdLabel, cmdType } = pluginMatches[0];
          await this.launchMatchedPlugin(plugin, feature, cmdLabel, cmdType, context);
        } else if (directCommand) {
          await this.launchDirectCommand(directCommand, context);
        }
      }
    } catch (error) {
      console.error("[API] 处理全局快捷键失败:", error);
    }
  }
  /**
   * 归一化来自渲染进程的快捷键启动上下文，保证 payload 构造逻辑可直接复用
   */
  normalizeShortcutContext(context) {
    return {
      searchQuery: context?.searchQuery || "",
      pastedImage: context?.pastedImage || null,
      pastedFiles: context?.pastedFiles ? context.pastedFiles.map((file) => ({
        path: file.path,
        name: file.name,
        isDirectory: file.isDirectory,
        isFile: file.isFile ?? !file.isDirectory
      })) : null,
      pastedText: context?.pastedText || null
    };
  }
  /**
   * 按命令类型构造快捷键启动参数，使应用快捷键与搜索结果启动的入参模型一致
   */
  buildShortcutLaunchParam(cmdType, context) {
    const normalizedContext = this.normalizeShortcutContext(context);
    const normalizedCmdType = cmdType || "text";
    let payload = normalizedContext.searchQuery;
    if (normalizedCmdType === "img" && normalizedContext.pastedImage) {
      payload = normalizedContext.pastedImage;
    } else if ((normalizedCmdType === "over" || normalizedCmdType === "regex") && normalizedContext.pastedText) {
      payload = normalizedContext.pastedText;
    } else if (normalizedCmdType === "files" && normalizedContext.pastedFiles) {
      payload = normalizedContext.pastedFiles;
    }
    return {
      payload,
      type: normalizedCmdType,
      inputState: normalizedContext
    };
  }
}
const api = new APIManager();
const SKIP_FOLDERS = [
  "sdk",
  "doc",
  "docs",
  "samples",
  "sample",
  "examples",
  "example",
  "demos",
  "demo",
  "documentation"
];
class AppWatcher {
  watcher = null;
  mainWindow = null;
  debounceTimer = null;
  DEBOUNCE_DELAY = 1e3;
  // 1秒防抖
  // 初始化监听器
  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.startWatching();
  }
  // 获取监听路径
  getWatchPaths() {
    if (process.platform === "win32") {
      return getWindowsScanPaths();
    }
    if (process.platform === "darwin") {
      return getMacApplicationPaths();
    }
    return [];
  }
  // 判断是否应该忽略
  shouldIgnore(filePath, watchPaths) {
    const basename = path.basename(filePath);
    if (watchPaths.includes(filePath)) {
      return false;
    }
    if (process.platform === "win32") {
      const pathParts = filePath.split(path.sep);
      for (const part of pathParts) {
        if (SKIP_FOLDERS.includes(part.toLowerCase())) {
          return true;
        }
      }
      try {
        const stats = fs.statSync(filePath);
        return !stats.isDirectory() && !filePath.endsWith(".lnk");
      } catch {
        return false;
      }
    }
    if (process.platform === "darwin") {
      return !basename.endsWith(".app");
    }
    return true;
  }
  // 启动监听
  startWatching() {
    const watchPaths = this.getWatchPaths();
    console.log("[AppWatcher] 开始监听应用目录变化:", watchPaths);
    const isWindows = process.platform === "win32";
    this.watcher = chokidar.watch(watchPaths, {
      // Windows 需要递归监听子目录，macOS 只需要一级
      depth: isWindows ? 5 : 1,
      // 根据平台设置忽略规则
      ignored: (filePath) => {
        return this.shouldIgnore(filePath, watchPaths);
      },
      // 持久化监听
      persistent: true,
      // 忽略初始添加事件(避免启动时触发大量事件)
      ignoreInitial: true,
      // Windows 使用轮询避免 fs.watch 占用文件夹句柄导致无法重命名/删除
      usePolling: isWindows,
      interval: isWindows ? 5e3 : void 0,
      binaryInterval: isWindows ? 5e3 : void 0,
      // 监听文件夹事件
      followSymlinks: false,
      // 避免在 macOS 上出现问题
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });
    if (process.platform === "win32") {
      this.watcher.on("add", (filePath) => {
        if (filePath.endsWith(".lnk")) {
          console.log("[AppWatcher] 检测到新快捷方式:", filePath);
          this.notifyChange("add", filePath);
        }
      });
    }
    if (process.platform === "darwin") {
      this.watcher.on("addDir", (filePath) => {
        if (filePath.endsWith(".app")) {
          console.log("[AppWatcher] 检测到新应用:", filePath);
          this.notifyChange("add", filePath);
        }
      });
    }
    if (process.platform === "win32") {
      this.watcher.on("unlink", (filePath) => {
        if (filePath.endsWith(".lnk")) {
          console.log("[AppWatcher] 检测到快捷方式删除:", filePath);
          this.notifyChange("remove", filePath);
        }
      });
    }
    if (process.platform === "darwin") {
      this.watcher.on("unlinkDir", (filePath) => {
        if (filePath.endsWith(".app")) {
          console.log("[AppWatcher] 检测到应用删除:", filePath);
          this.notifyChange("remove", filePath);
        }
      });
    }
    this.watcher.on("error", (error) => {
      console.error("[AppWatcher] 应用目录监听错误:", error);
    });
    this.watcher.on("ready", () => {
      console.log("[AppWatcher] 应用目录监听器已就绪");
    });
  }
  // 通知渲染进程应用列表变化(使用防抖避免频繁刷新)
  notifyChange(type, filePath) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      console.log(`[AppWatcher] 检测到应用变化: ${type} ${filePath}`);
      await appsAPI.refreshAppsCache();
      this.debounceTimer = null;
    }, this.DEBOUNCE_DELAY);
  }
  // 停止监听
  stop() {
    if (this.watcher) {
      console.log("[AppWatcher] 停止监听应用目录");
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
  // 重启监听
  restart() {
    this.stop();
    if (this.mainWindow) {
      this.startWatching();
    }
  }
}
const appWatcher = new AppWatcher();
function loadInternalPlugins() {
  console.log("[InternalPlugin] 开始加载内置插件...");
  const isDev = !electron.app.isPackaged;
  const existingPlugins = api.dbGet("plugins") || [];
  const filteredPlugins = existingPlugins.filter(
    (p) => !BUNDLED_INTERNAL_PLUGIN_NAMES.includes(p.name)
  );
  for (const pluginName of BUNDLED_INTERNAL_PLUGIN_NAMES) {
    try {
      const pluginPath = getInternalPluginPath(pluginName);
      const effectivePluginPath = isDev ? path.join(pluginPath, "public") : pluginPath;
      const pluginJsonPath = path.join(effectivePluginPath, "plugin.json");
      if (!fs.existsSync(pluginJsonPath)) {
        console.error(
          `[InternalPlugin] 内置插件 ${pluginName} 的 plugin.json 不存在:`,
          pluginJsonPath
        );
        continue;
      }
      const pluginConfig = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
      const logoPath = pluginConfig.logo ? path.join(effectivePluginPath, pluginConfig.logo) : "";
      const serverPort2 = getInternalPluginServerPort();
      const mainPath = pluginConfig.main ? serverPort2 > 0 ? getInternalPluginUrl(pluginName, pluginConfig.main) : path.join(effectivePluginPath, pluginConfig.main) : void 0;
      const pluginInfo = {
        name: pluginConfig.name,
        title: pluginConfig.title,
        version: pluginConfig.version,
        description: pluginConfig.description || "",
        logo: logoPath ? url.pathToFileURL(logoPath).href : "",
        path: effectivePluginPath,
        // 保存有效路径（开发模式下是 public 目录）
        features: pluginConfig.features || [],
        isDevelopment: isDev,
        main: mainPath
      };
      console.log("[InternalPlugin] 加载插件", pluginInfo);
      filteredPlugins.push(pluginInfo);
      console.log(`[InternalPlugin] 已加载内置插件: ${pluginName}`);
    } catch (error) {
      console.error(`[InternalPlugin] 加载内置插件 ${pluginName} 失败:`, error);
    }
  }
  api.dbPut("plugins", filteredPlugins);
  console.log("[InternalPlugin] 内置插件加载完成");
}
if (process.platform === "win32") {
  electron.app.setAppUserModelId("link.eiot.ztools");
}
const gotTheLock = electron.app.requestSingleInstanceLock();
let pendingZpxFile = null;
if (!gotTheLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (_event, argv) => {
    windowManager.showWindow();
    const zpxPath = argv.find((arg) => arg.endsWith(".zpx"));
    if (zpxPath) {
      console.log("[Main] 第二实例传入 ZPX 文件:", zpxPath);
      windowManager.openPluginInstaller(zpxPath);
    }
  });
}
electron.app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (!filePath.endsWith(".zpx")) return;
  console.log("[Main] 收到 open-file 事件:", filePath);
  if (electron.app.isReady()) {
    windowManager.openPluginInstaller(filePath);
  } else {
    pendingZpxFile = filePath;
  }
});
registerIconScheme();
try {
  const settingsDoc = lmdbInstance.get("ZTOOLS/settings-general");
  if (settingsDoc?.data?.disableGpuAcceleration === true) {
    electron.app.disableHardwareAcceleration();
    console.log("[Main] 已禁用 GPU 硬件加速（用户设置）");
  }
} catch {
}
log.transports.file.level = "debug";
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.resolvePathFn = () => {
  return path.join(electron.app.getPath("userData"), "logs/main.log");
};
log.transports.console.level = "debug";
Object.assign(console, log.functions);
logCollector.install();
if (process.env.NODE_ENV !== "production") {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
function updateShortcut(shortcut) {
  return windowManager.registerShortcut(shortcut);
}
function getCurrentShortcut() {
  return windowManager.getCurrentShortcut();
}
electron.app.whenReady().then(async () => {
  registerIconProtocolForSession(electron.session.defaultSession);
  await startInternalPluginServer();
  loadInternalPlugins();
  if (utils.platform.isMacOS) {
    if (!detachedWindowManager.hasDetachedWindows()) {
      electron.app.dock?.hide();
    }
  }
  const mainWindow = windowManager.createWindow();
  if (mainWindow) {
    api.init(mainWindow, pluginManager);
    pluginManager.init(mainWindow);
    appWatcher.init(mainWindow);
  }
  windowManager.registerShortcut();
  floatingBallManager.init();
  if (mainWindow) {
    try {
      const autoStartPlugins = api.dbGet("autoStartPlugin");
      const disabledPlugins = pluginsAPI.getDisabledPluginSet();
      if (autoStartPlugins && Array.isArray(autoStartPlugins) && autoStartPlugins.length > 0) {
        console.log("[Main] 开始处理自动启动插件:", { count: autoStartPlugins.length });
        const plugins = api.dbGet("plugins");
        if (plugins && Array.isArray(plugins)) {
          for (const pluginRef of autoStartPlugins) {
            const effectiveName = typeof pluginRef === "string" ? pluginRef : pluginRef?.pluginName ?? "";
            const plugin = plugins.find((p) => p?.name === effectiveName);
            if (plugin?.path && !disabledPlugins.has(plugin.path)) {
              console.log("[Main] 自动启动插件:", { pluginName: plugin.name });
              pluginManager.preloadPlugin(plugin.path).catch((error) => {
                console.error("[Main] 自动启动插件失败:", plugin.name, error);
              });
            } else {
              console.warn("[Main] 自动启动插件已跳过，未找到对应变体:", pluginRef);
            }
          }
        }
      }
    } catch (error) {
      console.error("[Main] 读取自动启动插件配置失败:", error);
    }
  }
  const zpxFromArgs = pendingZpxFile || process.argv.find((arg) => arg.endsWith(".zpx") && !arg.startsWith("-"));
  if (zpxFromArgs) {
    pendingZpxFile = null;
    setTimeout(() => {
      console.log("[Main] 处理启动时的 ZPX 文件:", zpxFromArgs);
      windowManager.openPluginInstaller(zpxFromArgs);
    }, 1500);
  }
});
electron.app.on("window-all-closed", () => {
  if (!utils.platform.isMacOS) {
    electron.app.quit();
  }
});
electron.app.on("will-quit", () => {
  windowManager.unregisterAllShortcuts();
  appWatcher.stop();
  floatingBallManager.cleanup();
  httpServer.stop();
  mcpServer.stop();
});
electron.app.on("before-quit", (event) => {
  if (!windowManager.getQuitting()) {
    event.preventDefault();
    console.log("[Main] 阻止了 Command+Q 退出，请使用托盘菜单退出");
    const hasActivePlugin = pluginManager.getCurrentPluginPath() !== null;
    if (windowManager.isKillPluginShortcutEnabled() && !hasActivePlugin) {
      windowManager.hideWindow(false);
    }
  } else {
    console.log("[Main] 开始同步销毁所有窗口...");
    floatingBallManager.cleanup();
    const allContents = electron.webContents.getAllWebContents();
    console.log("[Main] 找到", allContents.length, "个 webContents");
    for (const contents of allContents) {
      if (!contents.isDestroyed()) {
        contents.destroy();
      }
    }
    console.log("[Main] 所有窗口同步销毁完成");
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    windowManager.createWindow();
  }
});
if (process.env.NODE_ENV !== "production") {
  process.on("SIGINT", () => {
    console.log("[Main] 收到 SIGINT 信号，退出应用");
    electron.app.quit();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("[Main] 收到 SIGTERM 信号，退出应用");
    electron.app.quit();
    process.exit(0);
  });
}
exports.getCurrentShortcut = getCurrentShortcut;
exports.updateShortcut = updateShortcut;
