export type BlobBudgetUnit = "MiB" | "GiB";

const MIB_BYTES = 1_024 * 1_024;
const GIB_BYTES = 1_024 * MIB_BYTES;
const UNIT_BYTES: Readonly<Record<BlobBudgetUnit, number>> = {
  MiB: MIB_BYTES,
  GiB: GIB_BYTES,
};

export const blobBudgetUnits = ["MiB", "GiB"] as const;

export function preferredBlobBudgetUnit(bytes: number): BlobBudgetUnit {
  return bytes >= GIB_BYTES ? "GiB" : "MiB";
}

export function blobBudgetValue(bytes: number, unit: BlobBudgetUnit): number {
  return bytes / UNIT_BYTES[unit];
}

export function blobBudgetBytes(value: number, unit: BlobBudgetUnit): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Blob budget value must be finite and non-negative");
  }
  return Math.round(value * UNIT_BYTES[unit]);
}

export function blobBudgetInputConstraints(unit: BlobBudgetUnit): Readonly<{
  min: number;
  max: number;
  step: number;
}> {
  return unit === "MiB"
    ? { min: 64, max: 102_400, step: 1 }
    : { min: 0.0625, max: 100, step: 0.0625 };
}
