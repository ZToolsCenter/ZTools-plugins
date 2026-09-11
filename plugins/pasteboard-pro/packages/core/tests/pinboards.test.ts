import { describe, expect, it } from "vitest";

import {
  compareStableOrder,
  hasOrderKeyCollision,
  orderKeyBetween,
  type StableOrderEntry,
} from "../src/index";

const BASE62_PATTERN = /^[0-9A-Za-z]+$/;

function expectBetween(
  key: string,
  before?: string,
  after?: string,
): void {
  expect(key).toMatch(BASE62_PATTERN);
  if (before !== undefined) {
    expect(key > before).toBe(true);
  }
  if (after !== undefined) {
    expect(key < after).toBe(true);
  }
}

describe("orderKeyBetween", () => {
  it("uses the deterministic initial key and the exact simple midpoint", () => {
    expect(orderKeyBetween()).toBe("a0");
    expect(orderKeyBetween("a0", "a2")).toBe("a1");
  });

  it("documents concurrent same-bound inserts as an order-key collision", () => {
    const first = orderKeyBetween("a0", "a2");
    const second = orderKeyBetween("a0", "a2");

    expect(first).toBe("a1");
    expect(second).toBe("a1");
    expect(
      hasOrderKeyCollision([
        { orderKey: first, id: "client-a" },
        { orderKey: second, id: "client-b" },
      ]),
    ).toBe(true);
  });

  it("creates a valid key between adjacent order keys", () => {
    const key = orderKeyBetween("a0", "a1");

    expectBetween(key, "a0", "a1");
  });

  it("supports open lower and upper bounds", () => {
    expectBetween(orderKeyBetween(undefined, "a0"), undefined, "a0");
    expectBetween(orderKeyBetween("a0", undefined), "a0", undefined);
  });

  it("supports repeated unique inserts in the same gap", () => {
    const first = orderKeyBetween("a0", "a1");
    const second = orderKeyBetween("a0", first);
    const third = orderKeyBetween("a0", second);

    expect(new Set([first, second, third]).size).toBe(3);
    expectBetween(first, "a0", "a1");
    expectBetween(second, "a0", first);
    expectBetween(third, "a0", second);
  });

  it("rejects invalid ranges and characters", () => {
    expect(() => orderKeyBetween("a1", "a1")).toThrow(RangeError);
    expect(() => orderKeyBetween("a2", "a1")).toThrow(RangeError);
    expect(() => orderKeyBetween("a-", "b0")).toThrow(TypeError);
    expect(() => orderKeyBetween("a0", "b_")).toThrow(TypeError);
  });

  it("requires rebalancing for an unrepresentable prefix gap", () => {
    expect(() => orderKeyBetween("a", "a0")).toThrow(RangeError);
  });

  it("rejects overlong inputs and generated keys that exceed the limit", () => {
    expect(() => orderKeyBetween("a".repeat(129), undefined)).toThrow(
      RangeError,
    );
    expect(() => orderKeyBetween("z".repeat(128), undefined)).toThrow(
      RangeError,
    );
  });

  it("finds a short midpoint for a maximal lower key below a higher digit", () => {
    const before = "a".repeat(128);
    const key = orderKeyBetween(before, "b");

    expectBetween(key, before, "b");
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("falls back to a short upper prefix when the lower candidate is too long", () => {
    const before = "a" + "z".repeat(127);
    const key = orderKeyBetween(before, "b0");

    expect(key).toBe("b");
    expectBetween(key, before, "b0");
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

describe("stable pinboard ordering", () => {
  it("compares orderKey first and uses id as a deterministic tie-breaker", () => {
    const left: StableOrderEntry = { orderKey: "a1", id: "client-a" };
    const right: StableOrderEntry = { orderKey: "a1", id: "client-b" };

    expect(compareStableOrder(left, right)).toBe(-1);
    expect(compareStableOrder(right, left)).toBe(1);
    expect(compareStableOrder(left, left)).toBe(0);
    expect(
      compareStableOrder(
        { orderKey: "a0", id: "client-z" },
        { orderKey: "a1", id: "client-a" },
      ),
    ).toBe(-1);
  });

  it("detects repeated order keys without mutating entries", () => {
    const collisions: readonly StableOrderEntry[] = [
      { orderKey: "a1", id: "same-id" },
      { orderKey: "a1", id: "same-id" },
    ];
    const distinct: readonly StableOrderEntry[] = [
      { orderKey: "a0", id: "client-a" },
      { orderKey: "a1", id: "client-a" },
    ];
    const originalCollisions = structuredClone(collisions);
    const originalDistinct = structuredClone(distinct);

    expect(hasOrderKeyCollision(collisions)).toBe(true);
    expect(hasOrderKeyCollision(distinct)).toBe(false);
    expect(collisions).toEqual(originalCollisions);
    expect(distinct).toEqual(originalDistinct);
  });
});
