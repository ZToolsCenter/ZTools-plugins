import { expect, test } from "playwright/test";
import {
  formatAiMenuError,
  isMissingTargetBlockError,
} from "../../src/components/editor/ai/formatAiMenuError";

test("识别 xl-ai 半替换失败：block not found", () => {
  expect(
    isMissingTargetBlockError(
      new Error("Tool execution failed: block not found"),
    ),
  ).toBe(true);
  expect(isMissingTargetBlockError("html diff invalid block count")).toBe(
    false,
  );
});

test("block not found 映射成可操作中文，不暴露 Tool execution failed", () => {
  const text = formatAiMenuError(
    new Error("Tool execution failed: block not found"),
  );
  expect(text).toContain("目标块已变化");
  expect(text).toContain("已恢复原文");
  expect(text.toLowerCase()).not.toContain("tool execution failed");
  expect(text.toLowerCase()).not.toContain("block not found");
});

test("其它错误仍走原映射", () => {
  expect(formatAiMenuError(new Error("Failed to fetch"))).toContain("网络");
  expect(formatAiMenuError(new Error("invalid api key"))).toContain("密钥");
});
