import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../styles/app.css"), "utf8");

describe("窄屏开发工具栏", () => {
  test("380px 以下使用两行 grid，不影响正式 uTools 单行工具栏", () => {
    const narrow = css.match(/@media \(max-width: 380px\) \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(narrow).toContain(".pk-toolbar--dev");
    expect(narrow).toContain("display: grid !important");
    expect(narrow).toContain("grid-template-rows: 26px 30px");
    expect(narrow).toContain("padding: 6px 10px !important");
    expect(narrow).not.toMatch(/(^|\n)\s*\.pk-toolbar\s*\{/);
  });

  test("Tab 独占首行，关闭与搜索在第二行", () => {
    expect(css).toContain(".pk-toolbar--dev .pk-cat-tabs {\n    grid-column: 1 / -1;\n    grid-row: 1;");
    expect(css).toContain(".pk-toolbar--dev .pk-close-hint {\n    grid-column: 1;\n    grid-row: 2;");
    expect(css).toContain(".pk-toolbar--dev .pk-toolbar-search {\n    grid-column: 2;\n    grid-row: 2;");
  });
});
