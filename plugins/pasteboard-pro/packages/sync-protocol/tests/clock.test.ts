import { describe, expect, it } from "vitest";

import type { HybridClock } from "../../core/src/index";
import { compareClock, pickNewer } from "../src/index";

function clock(
  wallMs: number,
  counter: number,
  deviceId: string,
): HybridClock {
  return { wallMs, counter, deviceId };
}

describe("compareClock", () => {
  it("orders clocks by wall time before other components", () => {
    expect(compareClock(clock(10, 99, "z"), clock(11, 0, "a"))).toBe(-1);
    expect(compareClock(clock(11, 0, "a"), clock(10, 99, "z"))).toBe(1);
  });

  it("orders equal wall times by counter", () => {
    expect(compareClock(clock(10, 1, "z"), clock(10, 2, "a"))).toBe(-1);
    expect(compareClock(clock(10, 2, "a"), clock(10, 1, "z"))).toBe(1);
  });

  it("orders equal numeric components by device id code units", () => {
    expect(compareClock(clock(10, 1, "a"), clock(10, 1, "b"))).toBe(-1);
    expect(compareClock(clock(10, 1, "b"), clock(10, 1, "a"))).toBe(1);
  });

  it("returns zero only for identical clocks", () => {
    expect(compareClock(clock(10, 1, "device-a"), clock(10, 1, "device-a"))).toBe(
      0,
    );
  });

  it("compares extreme and negative wall times without arithmetic overflow", () => {
    expect(
      compareClock(
        clock(Number.MAX_SAFE_INTEGER, 0, "max"),
        clock(-1, 0, "negative"),
      ),
    ).toBe(1);
    expect(
      compareClock(
        clock(Number.MIN_SAFE_INTEGER, 0, "min"),
        clock(Number.MAX_SAFE_INTEGER, 0, "max"),
      ),
    ).toBe(-1);
  });

  it("does not mutate either input", () => {
    const left = Object.freeze(clock(10, 1, "a"));
    const right = Object.freeze(clock(10, 2, "b"));

    expect(compareClock(left, right)).toBe(-1);
    expect(left).toEqual(clock(10, 1, "a"));
    expect(right).toEqual(clock(10, 2, "b"));
  });
});

describe("pickNewer", () => {
  it("picks the value with the newer clock", () => {
    expect(pickNewer("left", clock(10, 0, "a"), "right", clock(11, 0, "a"))).toBe(
      "right",
    );
    expect(
      pickNewer("left", clock(11, 0, "a"), "right", clock(10, 0, "a")),
    ).toBe("left");
  });

  it("accepts the same primitive value when clocks are equal", () => {
    const equal = clock(10, 0, "a");

    expect(pickNewer("same", equal, "same", { ...equal })).toBe("same");
  });

  it("rejects different values when clocks are equal in both orders", () => {
    const equal = clock(10, 0, "a");

    expect(() => pickNewer("left", equal, "right", { ...equal })).toThrow(
      RangeError,
    );
    expect(() => pickNewer("right", equal, "left", { ...equal })).toThrow(
      RangeError,
    );
  });
});
