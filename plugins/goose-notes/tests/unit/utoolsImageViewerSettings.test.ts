import { expect, test } from "playwright/test";
import {
  createUToolsSlice,
  UTOOLS_INITIAL_STATE,
  type UToolsSlice,
} from "../../src/stores/settings/slices/utoolsSlice";

test("图片默认交给系统查看器，并可切换为内置预览", () => {
  expect(UTOOLS_INITIAL_STATE.utools.useInternalImageViewer).toBe(false);

  let state = createUToolsSlice((update) => {
    const patch = typeof update === "function" ? update(state) : update;
    state = { ...state, ...patch } as UToolsSlice;
  });

  state.setUseInternalImageViewer(true);
  expect(state.utools.useInternalImageViewer).toBe(true);
});
