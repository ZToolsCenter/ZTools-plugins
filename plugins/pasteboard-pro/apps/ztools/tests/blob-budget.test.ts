import { describe, expect, it } from "vitest";

import {
  blobBudgetBytes,
  blobBudgetInputConstraints,
  blobBudgetValue,
  preferredBlobBudgetUnit,
} from "../src/blob-budget";

describe("attachment budget units", () => {
  it("chooses a readable initial unit", () => {
    expect(preferredBlobBudgetUnit(512 * 1_024 * 1_024)).toBe("MiB");
    expect(preferredBlobBudgetUnit(1_024 * 1_024 * 1_024)).toBe("GiB");
  });

  it("converts values without changing the underlying byte budget", () => {
    const oneGiB = blobBudgetBytes(1, "GiB");
    expect(oneGiB).toBe(1_073_741_824);
    expect(blobBudgetValue(oneGiB, "MiB")).toBe(1_024);
    expect(blobBudgetBytes(512, "MiB")).toBe(536_870_912);
  });

  it("allows whole GiB values while retaining the 64 MiB minimum", () => {
    expect(blobBudgetInputConstraints("GiB")).toEqual({
      min: 0.0625,
      max: 100,
      step: 0.0625,
    });
    expect(blobBudgetInputConstraints("MiB")).toEqual({
      min: 64,
      max: 102_400,
      step: 1,
    });
  });

  it("rejects invalid numeric values before converting to bytes", () => {
    expect(() => blobBudgetBytes(Number.NaN, "GiB")).toThrow("finite");
    expect(() => blobBudgetBytes(-1, "MiB")).toThrow("non-negative");
  });
});
