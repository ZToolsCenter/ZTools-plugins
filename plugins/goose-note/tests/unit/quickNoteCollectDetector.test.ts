import { expect, test } from "playwright/test";
import {
  detectQuickNoteDoubleShift,
  EMPTY_DOUBLE_SHIFT_STATE,
  getQuickNoteCollectVariant,
} from "../../src/pages/quick-note/quickNoteCollectDetector";

function keyEvent(
  key: string,
  overrides: Partial<Parameters<typeof detectQuickNoteDoubleShift>[1]> = {},
): Parameters<typeof detectQuickNoteDoubleShift>[1] {
  return {
    key,
    code: key === "Shift" ? "ShiftLeft" : `Key${key.toUpperCase()}`,
    repeat: false,
    isComposing: false,
    ...overrides,
  };
}

test("two Shift keydowns inside the interval trigger once and reset", () => {
  const first = detectQuickNoteDoubleShift(
    EMPTY_DOUBLE_SHIFT_STATE,
    keyEvent("Shift"),
    1_000,
  );
  expect(first.triggered).toBe(false);

  const second = detectQuickNoteDoubleShift(
    first.state,
    keyEvent("Shift", { code: "ShiftRight" }),
    1_380,
  );
  expect(second.triggered).toBe(true);
  expect(second.state).toEqual(EMPTY_DOUBLE_SHIFT_STATE);

  const third = detectQuickNoteDoubleShift(
    second.state,
    keyEvent("Shift"),
    1_400,
  );
  expect(third.triggered).toBe(false);
});

test("Shift presses outside the interval start a new pair", () => {
  const first = detectQuickNoteDoubleShift(
    EMPTY_DOUBLE_SHIFT_STATE,
    keyEvent("Shift"),
    100,
  );
  const late = detectQuickNoteDoubleShift(
    first.state,
    keyEvent("Shift"),
    501,
  );
  expect(late.triggered).toBe(false);
  expect(late.state.lastShiftAt).toBe(501);
});

test("non-Shift, repeated and IME events clear an armed Shift", () => {
  const armed = { lastShiftAt: 1_000 };
  for (const event of [
    keyEvent("a"),
    keyEvent("Shift", { repeat: true }),
    keyEvent("Shift", { isComposing: true }),
  ]) {
    const result = detectQuickNoteDoubleShift(armed, event, 1_100);
    expect(result.triggered).toBe(false);
    expect(result.state).toEqual(EMPTY_DOUBLE_SHIFT_STATE);
  }
});

test("only supported query variants enable the collect preview", () => {
  expect(getQuickNoteCollectVariant("?collectVariant=copper")).toBe("copper");
  expect(getQuickNoteCollectVariant("?collectVariant=chip&foo=1")).toBe("chip");
  expect(getQuickNoteCollectVariant("?collectVariant=shelf")).toBe("shelf");
  expect(getQuickNoteCollectVariant("")).toBeNull();
  expect(getQuickNoteCollectVariant("?collectVariant=unknown")).toBeNull();
});
