import { describe, expect, it } from "vitest";

import { queryAfterTypeToSearch } from "../src/type-to-search";

function keyboardEvent(
  overrides: Partial<Parameters<typeof queryAfterTypeToSearch>[1]> = {},
): Parameters<typeof queryAfterTypeToSearch>[1] {
  return {
    key: "a",
    isComposing: false,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("type-to-search keyboard intent", () => {
  it.each(["a", "A", "中", " "])("forwards printable key %s", (key) => {
    expect(queryAfterTypeToSearch("existing", keyboardEvent({ key }))).toBe(
      `existing${key}`,
    );
  });

  it.each(["Enter", "Escape", "ArrowLeft"])(
    "keeps command key %s in the existing keyboard handler",
    (key) => {
      expect(
        queryAfterTypeToSearch("existing", keyboardEvent({ key })),
      ).toBeUndefined();
    },
  );

  it("removes the last query character and re-enters an empty search", () => {
    expect(queryAfterTypeToSearch("existing", keyboardEvent({ key: "Backspace" })))
      .toBe("existin");
    expect(queryAfterTypeToSearch("", keyboardEvent({ key: "Backspace" })))
      .toBe("");
  });

  it("does not intercept composition, handled events, or modified shortcuts", () => {
    expect(
      queryAfterTypeToSearch("", keyboardEvent({ isComposing: true })),
    ).toBeUndefined();
    expect(
      queryAfterTypeToSearch("", keyboardEvent({ defaultPrevented: true })),
    ).toBeUndefined();
    expect(
      queryAfterTypeToSearch("", keyboardEvent({ metaKey: true })),
    ).toBeUndefined();
    expect(
      queryAfterTypeToSearch("", keyboardEvent({ ctrlKey: true })),
    ).toBeUndefined();
    expect(
      queryAfterTypeToSearch("", keyboardEvent({ altKey: true })),
    ).toBeUndefined();
  });
});
