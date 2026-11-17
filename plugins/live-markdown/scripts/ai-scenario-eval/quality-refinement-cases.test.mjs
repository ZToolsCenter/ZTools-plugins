import { test } from "node:test";
import assert from "node:assert/strict";
import { contentQualityCases } from "./content-quality-cases.mjs";
import { refinementCases, refinementVariants } from "./quality-refinement-cases.mjs";

test("B33 preserves all 32 B32 baseline cases including every failed expectation", () => {
  assert.deepEqual(refinementCases.slice(0, 32), contentQualityCases);
  assert.equal(refinementCases.length, 44);
  assert.equal(new Set(refinementCases.map(({ id }) => id)).size, 44);
});

test("B33 variants cover code, English/Chinese drafts and fact-preserving prose with a correct-sentence control", () => {
  assert.equal(refinementVariants.filter(item => item.id.startsWith("B33-POL")).length, 6);
  assert.equal(refinementVariants.filter(item => item.id.startsWith("B33-CODE")).length, 4);
  assert.equal(refinementVariants.filter(item => item.id.startsWith("B33-OPEN")).length, 2);
  assert.equal(refinementVariants.filter(item => item.expected.effect === "no_op").length, 1);
  for (const item of refinementVariants) {
    assert.ok(item.expected.semanticReview);
    assert.ok(item.expected.facts.length);
    const patch = item.expected.patch;
    if (patch) assert.equal(item.source.slice(patch.from, patch.to), patch.expectedText);
  }
});
