import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freezeProductCandidate, parseFreezeCandidateArgs } from "./freeze-product-candidate.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-markdown-freeze-"));
  const write = (relative, value = relative) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  write("src/editor.ts", "editor source");
  write("preload/service.cjs", "preload source");
  write("package.json", "{}\n");
  write("package-lock.json", "{}\n");
  write("package-extra.json", "{\"extra\":true}\n");
  write("plugin.json", "{}\n");
  const caseManifest = { schemaVersion: 1, caseSetId: "frozen-80", realCases: Array.from({ length: 80 }, (_, index) => ({ id: `C${index + 1}` })) };
  const caseBytes = Buffer.from(`${JSON.stringify(caseManifest)}\n`);
  write(".cache/acceptance/ai-scenarios/v1/case-manifest.json", caseBytes);
  write(".cache/acceptance/ai-scenarios/v1/source-manifest.json", `${JSON.stringify({
    schemaVersion: 1,
    caseSetId: caseManifest.caseSetId,
    caseManifestSha256: sha256(caseBytes)
  })}\n`);
  return root;
}

test("freezes product source under the named candidate and records stable file/case hashes", () => {
  const root = makeFixture();
  try {
    const result = freezeProductCandidate({ root, name: "B2" });
    const snapshot = path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B2");
    const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, "source-manifest.json"), "utf8"));
    assert.equal(result.sourceRoot, ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B2/source");
    assert.equal(result.sourceManifestPath, ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B2/source-manifest.json");
    assert.equal(manifest.caseSetId, "frozen-80");
    assert.equal(manifest.caseManifestSha256, sha256(fs.readFileSync(path.join(root, ".cache/acceptance/ai-scenarios/v1/case-manifest.json"))));
    assert.deepEqual(manifest.paths, ["package-extra.json", "package-lock.json", "package.json", "plugin.json", "preload/service.cjs", "src/editor.ts"]);
    const stability = manifest.capture.stability;
    assert.equal(stability.pathsBeforeSha256, stability.pathsAfterSha256);
    assert.equal(stability.filesBeforeSha256, stability.filesAfterSha256);
    assert.equal(stability.caseManifestBeforeSha256, manifest.caseManifestSha256);
    assert.equal(stability.caseManifestAfterSha256, manifest.caseManifestSha256);
    assert.equal(stability.stable, true);
    for (const relative of manifest.paths) {
      assert.equal(sha256(fs.readFileSync(path.join(snapshot, "source", relative))), manifest.files[relative].sha256);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unsafe names and command-line arguments", () => {
  assert.throws(() => parseFreezeCandidateArgs([]), /Usage/u);
  assert.throws(() => parseFreezeCandidateArgs(["--name=B2", "--name=B3"]), /Duplicate/u);
  assert.throws(() => parseFreezeCandidateArgs(["--name=../escape"]), /safe/u);
  assert.throws(() => parseFreezeCandidateArgs(["--name=B2", "--force"]), /Unknown/u);
  const root = makeFixture();
  try {
    assert.throws(() => freezeProductCandidate({ root, name: "../escape" }), /safe/u);
    assert.equal(fs.existsSync(path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/snapshots")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses source symlinks and output symlink components without writing outside the root", (t) => {
  const root = makeFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "live-markdown-outside-"));
  try {
    fs.symlinkSync(outside, path.join(root, "src", "linked"), "dir");
    assert.throws(() => freezeProductCandidate({ root, name: "B2" }), /symlink/u);
    fs.rmSync(path.join(root, "src", "linked"));
    fs.mkdirSync(path.join(root, ".cache/acceptance/ai-scenarios/v2-r4"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/snapshots"), "dir");
    assert.throws(() => freezeProductCandidate({ root, name: "B3" }), /symlink/u);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("refuses incomplete or mismatched frozen 80-case provenance before creating an output", () => {
  const root = makeFixture();
  try {
    const sourceManifestPath = path.join(root, ".cache/acceptance/ai-scenarios/v1/source-manifest.json");
    fs.writeFileSync(sourceManifestPath, JSON.stringify({ schemaVersion: 1, caseManifestSha256: "wrong" }));
    assert.throws(() => freezeProductCandidate({ root, name: "B2" }), /case manifest.*changed|bind/iu);
    assert.equal(fs.existsSync(path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B2")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses an existing named snapshot and preserves its bytes", () => {
  const root = makeFixture();
  const destination = path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B2");
  try {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "sentinel"), "keep");
    assert.throws(() => freezeProductCandidate({ root, name: "B2" }), /already exists|overwrite/u);
    assert.equal(fs.readFileSync(path.join(destination, "sentinel"), "utf8"), "keep");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
