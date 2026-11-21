import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { assertFreshOutputPath, defaultV2Config, parseV2Cli, pluginRoot, resolvePluginPath } from "./scenario-v2-paths.mjs";

const v1Root = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1");

test("v2 CLI accepts a case set, source root, config, mode, and A/B variant", () => {
  assert.equal(defaultV2Config, path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v2-r4/tool-source/config.json"));
  const options = parseV2Cli([
    "--variant=A", "--run=contract-001", "--mode=controlled", "--case-set=live-markdown-multiscenario-v1",
    "--config=.cache/acceptance/ai-scenarios/v1/case-manifest.json",
    "--source-root=.cache/acceptance/ai-scenarios/v1/source"
  ]);
  assert.equal(options.variant, "A");
  assert.equal(options.mode, "controlled");
  assert.equal(options.caseSetId, "live-markdown-multiscenario-v1");
  assert.equal(options.sourceRootOverride, path.join(v1Root, "source"));
});

test("v2 CLI rejects duplicate flags and unknown source modes", () => {
  assert.throws(() => parseV2Cli(["--variant=A", "--variant=B", "--run=dup"]), /Duplicate/u);
  assert.throws(() => parseV2Cli(["--variant=A", "--run=bad", "--unexpected=1"]), /Unknown/u);
  assert.throws(() => parseV2Cli(["--variant=A", "--run=bad", "--mode=repair"]), /mode must be real or controlled/u);
});

test("all user-supplied paths stay inside the plugin and reject symlinks", () => {
  assert.throws(() => resolvePluginPath("../../../../etc/passwd", "test path"), /escaped the plugin/u);
  assert.throws(() => parseV2Cli(["--variant=A", "--run=escape", "--config=../../../../etc/passwd"]), /escaped the plugin/u);
  assert.throws(() => parseV2Cli(["--variant=A", "--run=escape", "--config=.cache/acceptance/ai-scenarios/v1/source-manifest.json", "--source-root=../../../../etc"]), /escaped the plugin/u);
});

test("snapshot preparation refuses an existing immutable destination", () => {
  const before = fs.readFileSync(path.join(v1Root, "source-manifest.json"));
  assert.throws(() => assertFreshOutputPath(v1Root, "test destination"), /already exists/u);
  assert.deepEqual(fs.readFileSync(path.join(v1Root, "source-manifest.json")), before);
});
