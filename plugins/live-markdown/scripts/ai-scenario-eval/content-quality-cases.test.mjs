import { test } from "node:test";
import assert from "node:assert/strict";
import { contentExecutorCases } from "./content-executor-cases.mjs";
import { contentQualityCases, originalQualityIds, qualityVariants } from "./content-quality-cases.mjs";

test("B32 reuses every original manual-review instruction, source, scope and expectation without edits", () => {
  assert.equal(originalQualityIds.length, 16);
  assert.deepEqual(contentQualityCases.slice(0, 16), contentExecutorCases.filter(({ id }) => originalQualityIds.includes(id)));
  assert.equal(contentQualityCases.length, 32);
  assert.equal(new Set(contentQualityCases.map(({ id }) => id)).size, 32);
});

test("new quality variants include positive generation and safe no-result/no-change controls", () => {
  assert.equal(qualityVariants.filter(({ expected }) => expected.effect === "clarify").length, 1);
  assert.equal(qualityVariants.filter(({ expected }) => expected.effect === "no_op").length, 1);
  assert.equal(qualityVariants.find(({ id }) => id === "B32-JSON-NESTED").expected.artifact.value.enabled, false);
  assert.equal(qualityVariants.find(({ id }) => id === "B32-POL-CORRECT").expected.semanticReview, true);
  for (const item of qualityVariants) {
    assert.equal(typeof item.source, "string");
    assert.ok(item.instruction.trim());
    if (item.expected.patch) assert.equal(item.source.slice(item.expected.patch.from, item.expected.patch.to), item.expected.patch.expectedText);
  }
});
