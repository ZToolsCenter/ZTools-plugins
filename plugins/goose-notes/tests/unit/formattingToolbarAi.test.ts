import { expect, test } from "playwright/test";
import { useFormattingToolbarAi } from "../../src/components/editor/state/formattingToolbarAi";

test.afterEach(() => {
  useFormattingToolbarAi.getState().reset();
});

test("formatting toolbar AI state keeps and clears the selection anchor", () => {
  useFormattingToolbarAi.getState().activate({ from: 12, to: 20 });

  expect(useFormattingToolbarAi.getState()).toMatchObject({
    active: true,
    selection: { from: 12, to: 20 },
  });

  useFormattingToolbarAi.getState().reset();

  expect(useFormattingToolbarAi.getState()).toMatchObject({
    active: false,
    selection: null,
  });
});
