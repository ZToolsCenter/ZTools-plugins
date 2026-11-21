import { describe, expect, it } from "vitest";
import { RequestGeneration } from "../../src/core/ai/requestGeneration";

describe("RequestGeneration", () => {
  it("rejects callbacks from cancelled and superseded requests", () => {
    const gate = new RequestGeneration();
    const oldRequest = gate.start();
    gate.cancel();
    const currentRequest = gate.start();
    expect(gate.isCurrent(oldRequest)).toBe(false);
    expect(gate.isCurrent(currentRequest)).toBe(true);
  });
});
