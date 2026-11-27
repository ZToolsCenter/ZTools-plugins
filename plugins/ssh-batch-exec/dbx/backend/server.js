"use strict";

// 作者：木子
// DBX Sidecar：stdio JSONL JSON-RPC 2.0 入口。stdout 只写协议消息，日志一律写 stderr。

const { Store } = require("./lib/store");
const { createSshRuntime } = require("./lib/ssh");

const PLUGIN_ID = "io.github.muzi.ssh-batch-exec";
const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = 1;

const log = (...args) => process.stderr.write("[dbx-ssh-batch-exec] " + args.join(" ") + "\n");

const store = new Store(process.env.DBX_PLUGIN_DATA_DIR);
const ssh = createSshRuntime((event) => sendNotification("ssh.event", event));

function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function sendResult(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  writeMessage({ jsonrpc: "2.0", id, error });
}

function sendNotification(method, params) {
  writeMessage({ jsonrpc: "2.0", method, params });
}

function invalidParams(message) {
  const error = new Error(message);
  error.code = -32602;
  return error;
}

function paramObject(params) {
  if (params == null) return {};
  if (typeof params !== "object" || Array.isArray(params)) throw invalidParams("params 必须是对象");
  return params;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value) throw invalidParams(name + " 必须是非空字符串");
  return value;
}

async function dispatch(method, params) {
  const p = paramObject(params);

  switch (method) {
    case "ping":
      return { ok: true };

    case "index":
      return store.list(p.prefix);

    case "detail":
      return store.detail(requireString(p.id, "id"));

    case "add":
      return store.add(p.doc);

    case "edit":
      return store.edit(p.doc);

    case "del":
      return { ok: store.del(requireString(p.id, "id")) };

    case "get":
      return store.getSetting(requireString(p.key, "key"), p.defaultValue);

    case "set":
      return store.setSetting(requireString(p.key, "key"), p.value);

    case "ssh/testConnection":
      return ssh.testConnection(p.server);

    case "ssh/exec":
      return ssh.execOnServer(p.server, p.command, {
        timeout: p.timeout,
        runId: p.runId,
        execId: p.execId,
        events: p.events !== false,
      });

    case "ssh/cancelRun":
      return { cancelled: ssh.cancelRun(p.runId) };

    default:
      throw Object.assign(new Error("未知方法: " + method), { code: -32601 });
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    sendError(null, -32600, "请求必须是 JSON 对象");
    return;
  }

  const id = Object.prototype.hasOwnProperty.call(message, "id") ? message.id : null;

  if (message.method === "plugin/initialize") {
    const params = paramObject(message.params);
    const versions = Array.isArray(params.protocolVersions) ? params.protocolVersions : [];
    if (versions.length && !versions.includes(PROTOCOL_VERSION)) {
      sendError(id, -32602, "不支持的协议版本: " + versions.join(","), {
        supported: [PROTOCOL_VERSION],
      });
      return;
    }
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { events: true, storage: true },
      plugin: { id: PLUGIN_ID, version: PLUGIN_VERSION },
    });
    return;
  }

  if (!message.method) {
    sendError(id, -32600, "缺少 method");
    return;
  }

  try {
    const result = await dispatch(message.method, message.params);
    // JSON-RPC 通知不需要响应。
    if (id !== null) sendResult(id, result);
  } catch (err) {
    const code = typeof err.code === "number" ? err.code : -32000;
    sendError(id, code, err.message || String(err));
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line)).catch((err) => {
        log("request failed:", err && err.stack ? err.stack : String(err));
      });
    } catch (err) {
      sendError(null, -32700, "JSON 解析失败: " + (err.message || String(err)));
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

log("sidecar ready, dataDir=" + store.dataDir);
