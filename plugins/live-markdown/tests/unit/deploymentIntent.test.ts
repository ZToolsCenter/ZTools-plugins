import { describe, expect, it } from "vitest";
import { shouldAutoEnableDeployment } from "../../src/core/ai/deploymentIntent";
import type { LocalAiStatus } from "../../src/types/localAi";

const ready: LocalAiStatus = { phase: "ready", deploymentId: "d1", modelId: "model-local", message: "ready", completedBytes: 100, totalBytes: 100 };

describe("managed deployment intent", () => {
  it("auto-enables only the still-selected one-click deployment", () => {
    const intent = { epoch: 2, source: "managed" as const, modelId: "model-local" };
    expect(shouldAutoEnableDeployment(intent, 2, "local", "managed", ready)).toBe(true);
    expect(shouldAutoEnableDeployment(intent, 3, "local", "managed", ready)).toBe(false);
    expect(shouldAutoEnableDeployment(intent, 2, "ztools", "managed", ready)).toBe(false);
    expect(shouldAutoEnableDeployment(intent, 2, "local", "ollama", ready)).toBe(false);
    expect(shouldAutoEnableDeployment({ ...intent, modelId: "other-model" }, 2, "local", "managed", ready)).toBe(false);
  });
});
