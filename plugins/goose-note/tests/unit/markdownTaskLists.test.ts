import { expect, test } from "playwright/test";
import { markdownToJsonContent } from "../../src/lib/export/markdown/parse/block";

test("markdown task list parser keeps empty unchecked items", () => {
  expect(markdownToJsonContent("- [ ]")).toEqual([
    {
      type: "checkListItem",
      props: { checked: false },
      content: [],
    },
  ]);
});

test("markdown task list parser keeps empty checked items", () => {
  expect(markdownToJsonContent("- [x]")).toEqual([
    {
      type: "checkListItem",
      props: { checked: true },
      content: [],
    },
  ]);
});

test("markdown task list parser keeps empty nested items", () => {
  expect(markdownToJsonContent("- [ ] parent\n  - [ ]")).toEqual([
    {
      type: "checkListItem",
      props: { checked: false },
      content: ["parent"],
      children: [
        {
          type: "checkListItem",
          props: { checked: false },
          content: [],
        },
      ],
    },
  ]);
});
