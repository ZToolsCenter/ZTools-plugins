import { expect, test } from "playwright/test";

import { focusIconSelectorOnOpen } from "../../src/pages/workspace/components/shared/iconSelectorFocus";

test("prevents the popover from auto-focusing a tooltip action", () => {
  let prevented = false;
  let focusOptions: FocusOptions | undefined;

  focusIconSelectorOnOpen(
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    {
      focus: (options) => {
        focusOptions = options;
      },
    },
  );

  expect(prevented).toBe(true);
  expect(focusOptions).toEqual({ preventScroll: true });
});

test("still suppresses implicit autofocus while the focus target is unavailable", () => {
  let prevented = false;

  focusIconSelectorOnOpen(
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    null,
  );

  expect(prevented).toBe(true);
});
