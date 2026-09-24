import assert from "node:assert/strict";
import test from "node:test";
import {
  createReasoningEffortOptions,
  resolveSupportedReasoningEffort,
} from "../../src/services/reasoning-options.js";

const reasoning = {
  efforts: [
    { id: "low", label: "低" },
    { id: "high", label: "高" },
    { id: "xhigh", label: "极高" },
  ],
  defaultEffort: "high",
};

test("自定义推理能力只生成明确配置的档位", () => {
  assert.deepEqual(createReasoningEffortOptions(reasoning, {}), [
    { value: "low", label: "低" },
    { value: "high", label: "高" },
    { value: "xhigh", label: "极高" },
  ]);
});

test("空值和失效值回退到自定义默认档位而不是供应商默认", () => {
  const modelOption = { reasoning };

  assert.equal(resolveSupportedReasoningEffort("", modelOption), "high");
  assert.equal(resolveSupportedReasoningEffort("medium", modelOption), "high");
  assert.equal(resolveSupportedReasoningEffort("xhigh", modelOption), "xhigh");
});

test("没有配置默认档位时回退到首个自定义档位", () => {
  assert.equal(
    resolveSupportedReasoningEffort("", {
      reasoning: { efforts: [{ id: "minimal", label: "最小" }] },
    }),
    "minimal",
  );
});
