import { expect, test } from "playwright/test";
import { matchCheckListTrigger } from "../../src/components/editor/inputrules/markdownInputRules";

test("半角 [] / [x] 可触发待办", () => {
  expect(matchCheckListTrigger("[]")).toEqual({
    checked: false,
    triggerText: "[]",
  });
  expect(matchCheckListTrigger("[ ]")).toEqual({
    checked: false,
    triggerText: "[ ]",
  });
  expect(matchCheckListTrigger("[x]")).toEqual({
    checked: true,
    triggerText: "[x]",
  });
  expect(matchCheckListTrigger("[X]")).toEqual({
    checked: true,
    triggerText: "[X]",
  });
});

test("中文 【】 / 【x】 可触发待办，对齐 1。 的中文输入习惯", () => {
  expect(matchCheckListTrigger("【】")).toEqual({
    checked: false,
    triggerText: "【】",
  });
  expect(matchCheckListTrigger("【 】")).toEqual({
    checked: false,
    triggerText: "【 】",
  });
  expect(matchCheckListTrigger("【x】")).toEqual({
    checked: true,
    triggerText: "【x】",
  });
  expect(matchCheckListTrigger("【X】")).toEqual({
    checked: true,
    triggerText: "【X】",
  });
});

test("允许可选前导空白，且不误匹配非整行前缀", () => {
  expect(matchCheckListTrigger(" []")).toEqual({
    checked: false,
    triggerText: " []",
  });
  expect(matchCheckListTrigger(" 【】")).toEqual({
    checked: false,
    triggerText: " 【】",
  });
  expect(matchCheckListTrigger("任务【】")).toBeNull();
  expect(matchCheckListTrigger("【】后续")).toBeNull();
  expect(matchCheckListTrigger("[")).toBeNull();
  expect(matchCheckListTrigger("【")).toBeNull();
  expect(matchCheckListTrigger("")).toBeNull();
});
