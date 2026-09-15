import { expect, test } from "playwright/test";
import {
  completePageTitleFocus,
  isPageTitleAutoFocusProtected,
  isPageTitleFocusRequested,
  requestPageTitleFocus,
} from "../../src/lib/page-title-focus";

test("标题聚焦完成后短暂保护焦点不被侧栏定位抢走", async () => {
  const pageId = "new-page";

  requestPageTitleFocus(pageId);
  expect(isPageTitleFocusRequested(pageId)).toBe(true);
  expect(isPageTitleAutoFocusProtected(pageId)).toBe(true);

  completePageTitleFocus(pageId);
  expect(isPageTitleFocusRequested(pageId)).toBe(false);
  expect(isPageTitleAutoFocusProtected(pageId)).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 550));
  expect(isPageTitleAutoFocusProtected(pageId)).toBe(false);
});
