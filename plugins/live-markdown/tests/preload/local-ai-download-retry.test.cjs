"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");
const test = require("node:test");
const { downloadResource, isRetryableDownloadError } = require("../../preload/local-ai/download-retry.cjs");

function failure(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function fixtureResource(bytes) {
  return {
    id: "retry-fixture", version: "r1", url: "https://example.com/model.bin", allowedHosts: ["example.com"],
    size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function response(statusCode, headers, chunks) {
  const stream = Readable.from(chunks);
  stream.statusCode = statusCode;
  stream.headers = headers;
  return stream;
}

test("retries transient network failures at most three times with short backoff", async () => {
  let attempts = 0;
  const delays = [];
  const result = await downloadResource({ id: "resource" }, "/unused/model.bin", {
    download: async () => {
      attempts += 1;
      if (attempts < 3) throw failure(attempts === 1 ? "ECONNRESET" : "ETIMEDOUT");
      return { path: "/unused/model.bin" };
    },
    delay: async (milliseconds) => { delays.push(milliseconds); }
  });
  assert.deepEqual(result, { path: "/unused/model.bin" });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 750]);
});

test("stops after three network failures and never retries integrity or filesystem errors", async () => {
  let attempts = 0;
  await assert.rejects(downloadResource({}, "/unused", {
    download: async () => { attempts += 1; throw failure("ENOTFOUND"); },
    delay: async () => {}
  }), { code: "ENOTFOUND" });
  assert.equal(attempts, 3);

  for (const error of [
    new Error("Downloaded resource failed SHA-256 verification"),
    failure("EACCES"), failure("EPERM"), failure("ENOSPC")
  ]) {
    attempts = 0;
    await assert.rejects(downloadResource({}, "/unused", {
      download: async () => { attempts += 1; throw error; },
      delay: async () => {}
    }));
    assert.equal(attempts, 1);
  }
});

test("cancellation during retry backoff stops immediately", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(downloadResource({}, "/unused", {
    signal: controller.signal,
    download: async () => { attempts += 1; throw failure("ECONNRESET"); },
    delay: async () => { controller.abort(); }
  }), { name: "AbortError", code: "ABORT_ERR" });
  assert.equal(attempts, 1);
});

test("retries a response abort through the existing downloader and resumes its partial file", async (t) => {
  const root = path.join(__dirname, ".tmp", `local-ai-download-retry-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from("verified model bytes for resume");
  const cut = 9;
  const target = path.join(root, "model.bin");
  const calls = [];
  const result = await downloadResource(fixtureResource(bytes), target, {
    cacheDirectory: root,
    delay: async () => {},
    openResponse: async (_url, headers) => {
      calls.push(headers);
      if (calls.length === 1) {
        const stream = new PassThrough();
        stream.statusCode = 200;
        stream.headers = { "content-length": String(bytes.length), etag: '"stable"' };
        setTimeout(() => {
          stream.write(bytes.subarray(0, cut));
          setTimeout(() => stream.destroy(failure("ECONNRESET", "response aborted")), 25);
        }, 0);
        return { response: stream };
      }
      assert.equal(headers.Range, `bytes=${cut}-`);
      return { response: response(206, {
        "content-range": `bytes ${cut}-${bytes.length - 1}/${bytes.length}`,
        "content-length": String(bytes.length - cut), etag: '"stable"'
      }, [bytes.subarray(cut)]) };
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.sha256, fixtureResource(bytes).sha256);
  assert.deepEqual(fs.readFileSync(target), bytes);
});

test("classifies only supported transient failures as retryable", () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"]) {
    assert.equal(isRetryableDownloadError(failure(code)), true);
  }
  assert.equal(isRetryableDownloadError(new Error("response aborted")), true);
  assert.equal(isRetryableDownloadError(failure("ENOSPC")), false);
});
