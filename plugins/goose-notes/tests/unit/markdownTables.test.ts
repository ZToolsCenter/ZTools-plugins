import { expect, test } from "playwright/test";
import { markdownToJsonContent } from "../../src/lib/export/markdown/parse/block";

test("markdown table parser keeps escaped pipes inside cells", () => {
  expect(
    markdownToJsonContent("| Name | Value |\n| --- | --- |\n| A \\| B | kept |"),
  ).toEqual([
    {
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [["Name"], ["Value"]] },
          { cells: [["A | B"], ["kept"]] },
        ],
      },
    },
  ]);
});

test("markdown table parser keeps escaped trailing pipes without row delimiters", () => {
  expect(markdownToJsonContent("Name | Value\n--- | ---\nA \\| | kept")).toEqual([
    {
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [["Name"], ["Value"]] },
          { cells: [["A |"], ["kept"]] },
        ],
      },
    },
  ]);
});

test("markdown table parser keeps escaped pipes at the end of the final cell", () => {
  expect(markdownToJsonContent("Name | Value\n--- | ---\nA | kept \\|")).toEqual([
    {
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [["Name"], ["Value"]] },
          { cells: [["A"], ["kept |"]] },
        ],
      },
    },
  ]);
});
