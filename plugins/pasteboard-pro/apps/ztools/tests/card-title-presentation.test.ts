import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "vue/compiler-sfc";

describe("card title single-line presentation contract", () => {
  it("enforces single-line ellipsis styles and hover tooltips on ModernCardPreview strong titles", async () => {
    const filePath = new URL("../src/components/ModernCardPreview.vue", import.meta.url);
    const source = await readFile(filePath, "utf8");
    const { descriptor } = parse(source);

    // Style checks
    const styleContent = descriptor.styles.map((s) => s.content).join("\n");
    expect(styleContent).toContain("text-overflow:ellipsis");
    expect(styleContent).toContain("white-space:nowrap");
    expect(styleContent).not.toContain("-webkit-line-clamp:2");

    // Template checks: title & alt attribute binding on strong title
    const templateContent = descriptor.template?.content ?? "";
    expect(templateContent).toMatch(
      /<strong\s+v-if="title"[^>]*:title="title"[^>]*:alt="title"/,
    );
    expect(templateContent).toMatch(
      /<strong[^>]*:title="files\[0\] \?\? title \?\? 'PDF 文档'"[^>]*:alt="files\[0\] \?\? title \?\? 'PDF 文档'"/,
    );
  });

  it("binds full title and alt tooltips to ModernCardMeta header title", async () => {
    const filePath = new URL("../src/components/ModernCardMeta.vue", import.meta.url);
    const source = await readFile(filePath, "utf8");
    const { descriptor } = parse(source);

    const templateContent = descriptor.template?.content ?? "";
    expect(templateContent).toMatch(
      /<span[^>]*:title="headerTitle"[^>]*:alt="headerTitle"[^>]*>\s*\{\{\s*headerTitle\s*\}\}\s*<\/span>/,
    );
  });

  it("binds full title and alt tooltips to PasteCard classic footer title", async () => {
    const filePath = new URL("../src/components/PasteCard.vue", import.meta.url);
    const source = await readFile(filePath, "utf8");
    const { descriptor } = parse(source);

    const templateContent = descriptor.template?.content ?? "";
    expect(templateContent).toMatch(
      /<strong[^>]*:title="item\.title \?\? item\.sourceApp\?\.name \?\? 'Untitled'"[^>]*:alt="item\.title \?\? item\.sourceApp\?\.name \?\? 'Untitled'/,
    );
  });
});
