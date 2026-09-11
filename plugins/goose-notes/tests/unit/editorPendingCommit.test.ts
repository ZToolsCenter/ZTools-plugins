import { expect, test } from "playwright/test";
import { commitPendingEditorChange } from "../../src/components/editor/core/editorPendingCommit";

test("卸载提交 pending 内容且重复调用不会重复写入", () => {
  const committed: string[] = [];
  let pending = true;
  const run = () => {
    const result = commitPendingEditorChange({
      targetPageId: "page-a",
      currentPageId: "page-a",
      pending,
      content: "latest",
      signature: "sig-latest",
      syncedSignature: "sig-old",
      commit: (value) => committed.push(value),
    });
    if (result === "committed") pending = false;
    return result;
  };

  expect(run()).toBe("committed");
  expect(run()).toBe("not-pending");
  expect(committed).toEqual(["latest"]);
});

test("旧页面卸载不能把内容提交到新页面", () => {
  const committed: string[] = [];
  expect(
    commitPendingEditorChange({
      targetPageId: "page-a",
      currentPageId: "page-b",
      pending: true,
      content: "stale",
      signature: "stale",
      syncedSignature: "old",
      commit: (value) => committed.push(value),
    }),
  ).toBe("stale-page");
  expect(committed).toEqual([]);
});
