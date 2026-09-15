import { expect, test } from "playwright/test";
import { shouldSeedCurrentPageReference } from "../../src/pages/workspace/components/notebook-ai/defaultComposerReference";

const textDraft = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "用户尚未发送的内容" }],
    },
  ],
};

test("空会话且无草稿时注入当前笔记", () => {
  expect(shouldSeedCurrentPageReference(0, null)).toBe(true);
});

test("已有消息的会话不修改输入区", () => {
  expect(shouldSeedCurrentPageReference(1, null)).toBe(false);
});

test("空会话已有用户草稿时不覆盖", () => {
  expect(shouldSeedCurrentPageReference(0, textDraft)).toBe(false);
});
