import { expect, test } from "playwright/test";
import {
  showDiagramInputSchema,
  showSvgInputSchema,
} from "../../src/lib/notebook-ai/tools/visual";
import { sanitizeSvgMarkup } from "../../src/lib/notebook-ai/svgSanitizer";
import {
  createMermaidArtifactBlocks,
  createSvgArtifactBlocks,
} from "../../src/pages/workspace/components/notebook-ai/insertArtifact";
import { shouldShowToolProgress } from "../../src/pages/workspace/components/notebook-ai/toolProgressVisibility";

test("visual artifact tool schemas accept valid diagram and svg inputs", () => {
  expect(
    showDiagramInputSchema.parse({
      title: "流程",
      language: "mermaid",
      source: "flowchart TD\nA-->B",
    }),
  ).toEqual({
    title: "流程",
    language: "mermaid",
    source: "flowchart TD\nA-->B",
  });

  expect(
    showSvgInputSchema.parse({
      title: "图标",
      svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    }),
  ).toEqual({
    title: "图标",
    svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
  });
});

test("visual artifact tool schemas reject empty source", () => {
  expect(() =>
    showDiagramInputSchema.parse({
      language: "mermaid",
      source: "   ",
    }),
  ).toThrow();

  expect(() =>
    showSvgInputSchema.parse({
      svg: "   ",
    }),
  ).toThrow();
});

test("sanitizeSvgMarkup removes scripts, event handlers, foreignObject, and external refs", () => {
  const result = sanitizeSvgMarkup(`
    <svg viewBox="0 0 10 10" onload="alert(1)">
      <script>alert(1)</script>
      <style>.x{background:url(https://example.com/a.svg)}</style>
      <foreignObject><div>bad</div></foreignObject>
      <image href="https://example.com/a.png" src="https://example.com/a.png" />
      <rect width="10" height="10" fill="url(https://example.com/pattern.svg#x)" />
      <circle cx="5" cy="5" r="4" onclick="alert(1)" fill="red" />
    </svg>
  `);

  expect(result).toContain("<svg");
  expect(result).toContain("<circle");
  expect(result).not.toMatch(/script|style|foreignObject|onload|onclick|href=|src=/i);
  expect(result).not.toContain("https://example.com");
});

test("sanitizeSvgMarkup keeps svg renderable when size metadata is sparse", () => {
  const sized = sanitizeSvgMarkup('<svg width="120" height="60"><rect width="120" height="60"/></svg>');
  expect(sized).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(sized).toContain('viewBox="0 0 120 60"');

  const sparse = sanitizeSvgMarkup("<svg><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>");
  expect(sparse).toContain('viewBox="0 0 640 360"');
  expect(sparse).toContain('width="640"');
  expect(sparse).toContain('height="360"');
});

test("visual artifact insertion blocks use editor-native block types", () => {
  expect(createMermaidArtifactBlocks("流程", "flowchart TD\nA-->B")).toEqual([
    {
      type: "heading",
      props: { level: 3 },
      content: "流程",
    },
    {
      type: "codeBlock",
      props: { language: "mermaid" },
      content: "flowchart TD\nA-->B",
    },
  ]);

  const svgBlocks = createSvgArtifactBlocks(
    "图标",
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
  );
  expect(svgBlocks[0]).toEqual({
    type: "heading",
    props: { level: 3 },
    content: "图标",
  });
  expect(svgBlocks[1].type).toBe("image");
  expect(svgBlocks[1].props?.caption).toBe("图标");
  expect(String(svgBlocks[1].props?.url)).toMatch(/^data:image\/svg\+xml/);
  expect(createSvgArtifactBlocks("空", "   ")).toEqual([]);
});

test("visual artifact completion hides tool progress unless streaming or errored", () => {
  expect(
    shouldShowToolProgress(
      [
        {
          type: "tool-showDiagram",
          state: "output-available",
          output: { language: "mermaid", source: "flowchart TD\nA-->B" },
        },
      ],
      false,
    ),
  ).toBe(false);

  expect(
    shouldShowToolProgress(
      [
        {
          type: "tool-showSvg",
          state: "output-error",
          errorText: "bad svg",
        },
      ],
      false,
    ),
  ).toBe(true);

  expect(
    shouldShowToolProgress(
      [
        {
          type: "tool-showChart",
          state: "input-streaming",
        },
      ],
      true,
    ),
  ).toBe(true);
});
