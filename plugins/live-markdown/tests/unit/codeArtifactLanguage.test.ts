import { expect, it } from "vitest";
import { validateTaskCandidate } from "../../src/core/ai/aiOutputContract";
import { validateArtifactCandidate } from "../../src/core/ai/artifactValidation";

it("accepts a legal unlabelled fence when no language was requested", () => {
  const raw = "```\nhello\n```";
  expect(validateTaskCandidate({ source: "原文", raw, instruction: "新增代码块", mode: "fragment", format: "code" }).text).toBe(raw);
  expect(() => validateArtifactCandidate({ kind: "code", issues: [], sourceDependent: false, displaySource: false }, raw)).not.toThrow();
});

it("still checks explicitly requested language in the canonical artifact contract", () => {
  expect(() => validateArtifactCandidate({ kind: "code", issues: [], sourceDependent: false, displaySource: false,
    language: { value: "python", evidence: [{ from: 0, to: 6, raw: "Python" }] }
  }, "```\nhello\n```")).toThrow(/语言/u);
});
