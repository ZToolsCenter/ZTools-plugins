import { expect, test } from "playwright/test";
import { indentCodeSelection } from "../../src/components/editor/blocks/code/codeBlockIndent";

test("indentCodeSelection inserts spaces at a collapsed cursor", () => {
  const result = indentCodeSelection("const x = 1;", 6, 6);

  expect(result).toEqual({
    text: "const   x = 1;",
    selectionStart: 8,
    selectionEnd: 8,
  });
});

test("indentCodeSelection indents every selected line", () => {
  const text = "one\ntwo\nthree";
  const result = indentCodeSelection(text, 0, "one\ntwo".length);

  expect(result).toEqual({
    text: "  one\n  two\nthree",
    selectionStart: 0,
    selectionEnd: "  one\n  two".length,
  });
});

test("indentCodeSelection outdents selected lines", () => {
  const text = "  one\n\ttwo\nthree";
  const result = indentCodeSelection(text, 0, "  one\n\ttwo".length, {
    outdent: true,
  });

  expect(result).toEqual({
    text: "one\ntwo\nthree",
    selectionStart: 0,
    selectionEnd: "one\ntwo".length,
  });
});

test("indentCodeSelection keeps the trailing unselected line unchanged", () => {
  const text = "  one\n  two\n  three\n";
  const result = indentCodeSelection(text, 0, "  one\n  two\n".length, {
    outdent: true,
  });

  expect(result).toEqual({
    text: "one\ntwo\n  three\n",
    selectionStart: 0,
    selectionEnd: "one\ntwo\n".length,
  });
});
