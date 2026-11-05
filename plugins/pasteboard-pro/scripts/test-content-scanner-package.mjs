import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { makeRtfDestinationPackageCasesV2 } from "./lib/rtf-destination-package-cases.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const workerPath = path.join(root, "dist/ztools/content-scan-worker.cjs");
const policyRevision = "package-v016-policy";
const policy = {
  revision: policyRevision,
  blockLikelySecrets: true,
  contentRules: [{ type: "literal", value: "private-text" }],
};
const workerTimeoutMs = 10_000;
const shutdownGraceMs = 2_000;

function makeTextTask() {
  const representationKey = "package-plaintext";
  return {
    schemaVersion: 1,
    requestId: "package-text-secret",
    policy,
    codec: { representationKey, contentKind: "text", encoding: "utf-8", termination: "none" },
    request: {
      policyRevision,
      representationKey,
      itemIndex: 0,
      contentKind: "text",
      requiredScopes: ["text"],
      bytes: new TextEncoder().encode("Bearer abcdefghijklmnopqrstuvwxyz012345"),
    },
  };
}

function makeHtmlTask(requestId, representationKey, html) {
  return {
    schemaVersion: 1,
    requestId,
    policy,
    codec: {
      representationKey,
      contentKind: "rich-text",
      richTextFormat: "html",
      encoding: "utf-8",
      termination: "none",
    },
    request: {
      policyRevision,
      representationKey,
      itemIndex: 0,
      contentKind: "rich-text",
      requiredScopes: ["text", "links"],
      bytes: new TextEncoder().encode(html),
    },
  };
}

function makeRtfTask(requestId, representationKey, rtf) {
  return {
    schemaVersion: 1,
    requestId,
    policy,
    codec: { representationKey, contentKind: "rich-text", richTextFormat: "rtf" },
    request: {
      policyRevision,
      representationKey,
      itemIndex: 0,
      contentKind: "rich-text",
      requiredScopes: ["text", "links"],
      bytes: new TextEncoder().encode(rtf),
    },
  };
}

function makeCfHtmlBytes(fragment, sourceUrl = "https://example.invalid/") {
  const encoder = new TextEncoder();
  const htmlPrefix = "<html><body><!--StartFragment-->";
  const htmlSuffix = "<!--EndFragment--></body></html>";
  const contextHtml = htmlPrefix + fragment + htmlSuffix;
  const headerTemplate = [
    "Version:1.0",
    "StartHTML:0000000000",
    "EndHTML:0000000000",
    "StartFragment:0000000000",
    "EndFragment:0000000000",
    "SourceURL:" + sourceUrl,
    "",
    "",
  ].join("\r\n");
  const startHtml = encoder.encode(headerTemplate).byteLength;
  const startFragment = startHtml + encoder.encode(htmlPrefix).byteLength;
  const endFragment = startFragment + encoder.encode(fragment).byteLength;
  const endHtml = startHtml + encoder.encode(contextHtml).byteLength;
  const offset = (value) => String(value).padStart(10, "0");
  const header = headerTemplate
    .replace("StartHTML:0000000000", "StartHTML:" + offset(startHtml))
    .replace("EndHTML:0000000000", "EndHTML:" + offset(endHtml))
    .replace("StartFragment:0000000000", "StartFragment:" + offset(startFragment))
    .replace("EndFragment:0000000000", "EndFragment:" + offset(endFragment));
  return encoder.encode(header + contextHtml);
}

function makeCfHtmlTask(requestId, representationKey, bytes) {
  return {
    schemaVersion: 1,
    requestId,
    policy,
    codec: {
      representationKey,
      contentKind: "rich-text",
      richTextFormat: "html",
      htmlContainer: "cf-html",
      encoding: "utf-8",
      termination: "none",
    },
    request: {
      policyRevision,
      representationKey,
      itemIndex: 0,
      contentKind: "rich-text",
      requiredScopes: ["text", "links"],
      bytes,
    },
  };
}

function makeMalformedCfHtmlBytes() {
  const bytes = makeCfHtmlBytes("<p>public</p>");
  const text = new TextDecoder().decode(bytes);
  const field = /^StartFragment:(\d+)$/m.exec(text);
  if (field === null) throw new Error("package-smoke-cf-html-offset-missing");
  const malformed = String(Number(field[1]) + 1).padStart(10, "0");
  return new TextEncoder().encode(text.replace(field[0], "StartFragment:" + malformed));
}

function expectedResponse(task, checks) {
  return {
    schemaVersion: 1,
    requestId: task.requestId,
    policyRevision: task.policy.revision,
    representationKey: task.codec.representationKey,
    checks,
  };
}

function runPackagedWorker(testCase) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: testCase.task,
      stdout: true,
      stderr: true,
    });
    const stdout = worker.stdout;
    const stderr = worker.stderr;
    if (stdout === null || stderr === null) {
      void worker.terminate();
      reject(new Error("packaged-worker-output-stream-unavailable"));
      return;
    }

    let response;
    let messageCount = 0;
    let exitCode;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutEnded = false;
    let stderrEnded = false;
    let stdoutClosed = false;
    let stderrClosed = false;
    let failure;
    let settled = false;
    let timeout;
    let shutdownTimer;

    function maybeSettle() {
      if (
        settled || exitCode === undefined ||
        !stdoutEnded || !stdoutClosed || !stderrEnded || !stderrClosed
      ) return;

      settled = true;
      clearTimeout(timeout);
      clearTimeout(shutdownTimer);
      if (failure !== undefined) {
        reject(new Error(failure));
        return;
      }
      if (exitCode !== 0) {
        reject(new Error(`packaged-worker-exit:${testCase.name}`));
        return;
      }
      if (messageCount !== 1) {
        reject(new Error(`packaged-worker-message-count:${testCase.name}`));
        return;
      }
      if (stdoutBytes + stderrBytes !== 0) {
        reject(new Error(`packaged-worker-output-not-empty:${testCase.name}`));
        return;
      }

      let responseMatches = true;
      try {
        assert.deepEqual(response, expectedResponse(testCase.task, testCase.checks));
      } catch {
        responseMatches = false;
      }
      if (!responseMatches) {
        reject(new Error(`packaged-worker-response-contract:${testCase.name}`));
        return;
      }

      resolve({
        name: testCase.name,
        checks: response.checks,
        threadExitConfirmed: true,
        stdout: { bytes: stdoutBytes, ended: stdoutEnded, closed: stdoutClosed },
        stderr: { bytes: stderrBytes, ended: stderrEnded, closed: stderrClosed },
      });
    }

    function stopAfterFailure(reason) {
      failure ??= reason;
      void worker.terminate().catch(() => {});
      shutdownTimer ??= setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error("packaged-worker-shutdown-incomplete"));
      }, shutdownGraceMs);
    }

    stdout.on("data", (chunk) => { stdoutBytes += chunk.byteLength; });
    stderr.on("data", (chunk) => { stderrBytes += chunk.byteLength; });
    stdout.once("end", () => { stdoutEnded = true; maybeSettle(); });
    stderr.once("end", () => { stderrEnded = true; maybeSettle(); });
    stdout.once("close", () => { stdoutClosed = true; maybeSettle(); });
    stderr.once("close", () => { stderrClosed = true; maybeSettle(); });
    stdout.once("error", () => stopAfterFailure("packaged-worker-stdout-error"));
    stderr.once("error", () => stopAfterFailure("packaged-worker-stderr-error"));

    worker.on("message", (value) => {
      messageCount += 1;
      if (messageCount === 1) response = value;
    });
    worker.once("error", () => { failure ??= `packaged-worker-error:${testCase.name}`; });
    worker.once("exit", (code) => {
      exitCode = code;
      maybeSettle();
    });
    timeout = setTimeout(() => stopAfterFailure(`packaged-worker-timeout:${testCase.name}`), workerTimeoutMs);
  });
}

const imageRequests = { count: 0 };
const imageServer = createServer((_request, response) => {
  imageRequests.count += 1;
  response.end("private-text-from-image-response");
});
imageServer.listen(0, "127.0.0.1");
await once(imageServer, "listening");

let completedCases = [];
try {
  const address = imageServer.address();
  if (address === null || typeof address === "string") throw new Error("package-smoke-image-server-address");
  const imageUrl = `http://127.0.0.1:${address.port}`;
  const cases = [
    ...makeRtfDestinationPackageCasesV2(makeRtfTask),
    {
      name: "plaintext-secret-blocked",
      task: makeTextTask(),
      checks: [{ scope: "text", status: "blocked" }],
    },
    {
      name: "html-split-token-blocked",
      task: makeHtmlTask("package-html-split", "package-html-split", "<p>pri<b>vate</b>-text</p>"),
      checks: [{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }],
    },
    {
      name: "ordinary-html-passed",
      task: makeHtmlTask("package-html-ordinary", "package-html-ordinary", "<p>Hello <b>world</b></p>"),
      checks: [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }],
    },
    {
      name: "external-image-text-incomplete",
      task: makeHtmlTask("package-html-image", "package-html-image", `<img src="${imageUrl}/image"><p>public</p>`),
      checks: [{ scope: "text", status: "not-scanned" }, { scope: "links", status: "passed" }],
    },
    {
      name: "css-image-text-incomplete",
      task: makeHtmlTask("package-html-css-image", "package-html-css-image", `<p style="background-image:url(${imageUrl}/css-image)">public</p>`),
      checks: [{ scope: "text", status: "not-scanned" }, { scope: "links", status: "passed" }],
    },
    {
      name: "rtf-formatted-text-passed",
      task: makeRtfTask(
        "package-rtf-formatted",
        "package-rtf-formatted",
        "{\\rtf1\\ansi Hello \\b world\\b0}",
      ),
      checks: [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }],
    },
    {
      name: "rtf-unicode-split-secret-blocked",
      task: makeRtfTask(
        "package-rtf-unicode-split",
        "package-rtf-unicode-split",
        "{\\rtf1\\ansi\\uc1\\u112?ri{\\b vate}-text}",
      ),
      checks: [{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }],
    },
    {
      name: "rtf-picture-content-not-scanned",
      task: makeRtfTask(
        "package-rtf-picture",
        "package-rtf-picture",
        "{\\rtf1\\ansi Word {\\pict\\pngblip 89504e470d0a} after}",
      ),
      checks: [{ scope: "text", status: "not-scanned" }, { scope: "links", status: "not-scanned" }],
    },
    {
      name: "cf-html-valid-offsets-passed",
      task: makeCfHtmlTask(
        "package-cf-html-valid",
        "package-cf-html-valid",
        makeCfHtmlBytes("<p>public clipboard content</p>"),
      ),
      checks: [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }],
    },
    {
      name: "cf-html-source-url-literal-blocked",
      task: makeCfHtmlTask(
        "package-cf-html-source-url",
        "package-cf-html-source-url",
        makeCfHtmlBytes("<p>public clipboard content</p>", "https://example.invalid/private-text"),
      ),
      checks: [{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }],
    },
    {
      name: "cf-html-malformed-offset-not-scanned",
      task: makeCfHtmlTask(
        "package-cf-html-malformed-offset",
        "package-cf-html-malformed-offset",
        makeMalformedCfHtmlBytes(),
      ),
      checks: [{ scope: "text", status: "not-scanned" }, { scope: "links", status: "not-scanned" }],
    },
  ];

  for (const testCase of cases) {
    completedCases.push(await runPackagedWorker(testCase));
    assert.equal(imageRequests.count, 0, "packaged-worker-requested-external-resource");
  }
} finally {
  await new Promise((resolve, reject) => {
    imageServer.close((error) => error ? reject(error) : resolve());
  });
}

assert.equal(imageRequests.count, 0, "packaged-worker-requested-external-resource");
const scriptPath = fileURLToPath(import.meta.url);
const result = {
  destinationFixturesSha256: createHash("sha256").update(await readFile(new URL("./lib/rtf-destination-package-cases.mjs", import.meta.url))).digest("hex"),
  testScriptSha256: createHash("sha256").update(await readFile(scriptPath)).digest("hex"),
  workerSha256: createHash("sha256").update(await readFile(workerPath)).digest("hex"),
  execution: "PASS",
  runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
  scope: "packaged-text-html-rtf-and-cf-html-worker-matrix",
  cases: completedCases,
  externalResourceRequests: imageRequests.count,
  threadExitConfirmed: completedCases.every((testCase) => testCase.threadExitConfirmed),
  stdoutStderrEndedAndClosed: completedCases.every((testCase) =>
    testCase.stdout.ended && testCase.stdout.closed && testCase.stderr.ended && testCase.stderr.closed),
  outputBytes: completedCases.reduce((total, testCase) => total + testCase.stdout.bytes + testCase.stderr.bytes, 0),
};

const outputPath = process.argv[2] ?? path.join(
  root,
  "artifacts/pasteboardpro/clipboard-format-g0",
  process.versions.electron ? "electron-package-smoke.json" : "node-package-smoke.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
