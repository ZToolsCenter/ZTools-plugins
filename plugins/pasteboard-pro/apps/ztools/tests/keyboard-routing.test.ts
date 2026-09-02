import { describe, expect, it } from "vitest";

import { shelfKeyboardRoute } from "../src/keyboard-routing";

describe("shelf keyboard event routing", () => {
  it.each(["Enter", " "])("routes card %s through the list state machine", (key) => {
    expect(
      shelfKeyboardRoute(key, { nativeControl: false, listCard: true }),
    ).toBe("list-card");
  });

  it("lets controls inside a card keep native Enter/Space activation", () => {
    expect(
      shelfKeyboardRoute("Enter", { nativeControl: true, listCard: true }),
    ).toBe("native-control");
    expect(
      shelfKeyboardRoute(" ", { nativeControl: true, listCard: true }),
    ).toBe("native-control");
  });

  it("does not intercept printable keys outside a card", () => {
    expect(
      shelfKeyboardRoute("a", { nativeControl: false, listCard: true }),
    ).toBeUndefined();
    expect(
      shelfKeyboardRoute(" ", { nativeControl: false, listCard: false }),
    ).toBeUndefined();
  });
});
