"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable, Writable } = require("node:stream");
const test = require("node:test");
const { downloadResource } = require("../../preload/local-ai/downloader.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-download-${process.pid}`);

function resource(bytes) {
  return {
    id: "small-resource", version: "rev1", url: "https://example.com/model.bin", allowedHosts: ["example.com"],
    size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function response(statusCode, headers, chunks) {
  const stream = Readable.from(chunks);
  stream.statusCode = statusCode;
  stream.headers = headers;
  return stream;
}

test("download resumes only a complete matching range and verifies the final hash", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from("verified-model-bytes");
  const cut = 8;
  const target = path.join(root, "model.bin");
  const partial = `${target}.part`;
  fs.writeFileSync(partial, bytes.subarray(0, cut));
  fs.writeFileSync(`${partial}.json`, JSON.stringify({ version: "rev1", size: bytes.length, etag: '"stable"' }), { mode: 0o600 });
  let requestedHeaders;
  const downloaded = await downloadResource(resource(bytes), target, {
    cacheDirectory: root,
    openResponse: async (_url, headers) => {
      requestedHeaders = headers;
      return { response: response(206, {
        "content-range": `bytes ${cut}-${bytes.length - 1}/${bytes.length}`,
        "content-length": String(bytes.length - cut), etag: '"stable"'
      }, [bytes.subarray(cut)]) };
    }
  });
  assert.equal(requestedHeaders.Range, `bytes=${cut}-`);
  assert.equal(requestedHeaders["If-Range"], '"stable"');
  assert.deepEqual(fs.readFileSync(target), bytes);
  assert.equal(downloaded.sha256, resource(bytes).sha256);
  assert.equal(fs.existsSync(`${partial}.json`), false);
});

test("invalid range or changed ETag discards resume bytes and restarts cleanly", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from("complete-body");
  const target = path.join(root, "model.bin");
  fs.writeFileSync(`${target}.part`, "stale");
  fs.writeFileSync(`${target}.part.json`, JSON.stringify({ version: "rev1", size: bytes.length, etag: '"old"' }), { mode: 0o600 });
  const requests = [];
  await downloadResource(resource(bytes), target, {
    cacheDirectory: root,
    openResponse: async (_url, headers) => {
      requests.push(headers);
      if (headers.Range) return { response: response(206, {
        "content-range": `bytes 3-${bytes.length - 1}/${bytes.length}`,
        "content-length": String(bytes.length - 3), etag: '"changed"'
      }, [bytes.subarray(3)]) };
      return { response: response(200, { "content-length": String(bytes.length), etag: '"new"' }, [bytes]) };
    }
  });
  assert.equal(requests.length, 2);
  assert.ok(requests[0].Range);
  assert.equal(requests[1].Range, undefined);
  assert.deepEqual(fs.readFileSync(target), bytes);
});

test("write stream failures are captured and rejected without an uncaught stream error", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from("write failure");
  await assert.rejects(downloadResource(resource(bytes), path.join(root, "model.bin"), {
    cacheDirectory: root,
    openResponse: async () => ({ response: response(200, { "content-length": String(bytes.length) }, [bytes]) }),
    createWriteStream: () => new Writable({ write(_chunk, _encoding, callback) {
      setImmediate(() => callback(new Error("disk write failed")));
    } })
  }), /disk write failed/);
});
