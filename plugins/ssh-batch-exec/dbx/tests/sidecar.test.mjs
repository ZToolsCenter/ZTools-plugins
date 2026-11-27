// 作者：木子
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "backend", "server.js");

function createClient(dataDir) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, DBX_PLUGIN_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const notifications = [];
  let buffer = "";
  let seq = 0;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
      } else {
        notifications.push(message);
      }
    }
  });

  function request(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("请求超时: " + method));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async function close() {
    child.stdin.end();
    if (child.exitCode === null) {
      const [code] = await once(child, "exit");
      assert.equal(code, 0);
    }
  }

  return { child, request, notifications, close };
}

test("Sidecar JSON-RPC initialize and CRUD", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-sidecar-test-"));
  const client = createClient(dataDir);
  try {
    const init = await client.request("plugin/initialize", { protocolVersions: [1] });
    assert.equal(init.protocolVersion, 1);
    assert.deepEqual(init.plugin, {
      id: "io.github.muzi.ssh-batch-exec",
      version: "1.0.0",
    });
    assert.equal(init.capabilities.events, true);

    await client.request("add", {
      doc: { _id: "server:1", createdAt: 1, name: "host-a" },
    });
    const docs = await client.request("index", { prefix: "server:" });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].name, "host-a");

    await client.request("edit", {
      doc: { _id: "server:1", createdAt: 1, name: "host-b" },
    });
    assert.equal((await client.request("detail", { id: "server:1" })).name, "host-b");

    await client.request("set", { key: "logRetention", value: 7 });
    assert.equal(await client.request("get", { key: "logRetention" }), 7);

    const del = await client.request("del", { id: "server:1" });
    assert.equal(del.ok, true);
    assert.equal(await client.request("detail", { id: "server:1" }), null);

    assert.deepEqual(await client.request("ssh/cancelRun", { runId: "unknown" }), {
      cancelled: 0,
    });
  } finally {
    await client.close();
  }
});

test("Sidecar writes only JSON-RPC messages to stdout", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-sidecar-stdout-"));
  const client = createClient(dataDir);
  try {
    await client.request("ping");
    assert.equal(client.child.stdout.readable, true);
    assert.equal(client.notifications.length, 0);
  } finally {
    await client.close();
  }
});
