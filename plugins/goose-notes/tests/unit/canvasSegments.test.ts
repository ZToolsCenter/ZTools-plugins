import { expect, test } from "playwright/test";
import { parseCanvasAwareSegments } from "../../src/lib/notebook-ai/canvasSegments";

const SVG = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

test("complete xml fence with svg becomes a canvas segment and hides source", () => {
  const segments = parseCanvasAwareSegments(
    `先看这张图：\n\n\`\`\`xml\n${SVG}\n\`\`\`\n\n以上是能力介绍。`,
  );
  expect(segments).toEqual([
    { type: "markdown", content: "先看这张图：" },
    { type: "svg", content: SVG },
    { type: "markdown", content: "以上是能力介绍。" },
  ]);
});

test("streaming incomplete xml/svg fence is hidden as pending canvas", () => {
  const xml = parseCanvasAwareSegments("```xml\n<svg viewBox=\"0 0 10 10\">", true);
  expect(xml).toEqual([{ type: "pending" }]);

  const svg = parseCanvasAwareSegments("介绍一下\n\n```svg\n<svg", true);
  expect(svg).toEqual([
    { type: "markdown", content: "介绍一下" },
    { type: "pending" },
  ]);
});

test("plain code fences stay as markdown", () => {
  const segments = parseCanvasAwareSegments("```ts\nconst a = 1;\n```");
  expect(segments).toEqual([
    { type: "markdown", content: "```ts\nconst a = 1;\n```" },
  ]);
});

test("bare svg is extracted without showing source", () => {
  const segments = parseCanvasAwareSegments(`说明\n${SVG}\n结尾`);
  expect(segments).toEqual([
    { type: "markdown", content: "说明" },
    { type: "svg", content: SVG },
    { type: "markdown", content: "结尾" },
  ]);
});

test("streaming unclosed bare svg is hidden", () => {
  const segments = parseCanvasAwareSegments("能力：\n<svg xmlns=\"http://www.w3.org/2000/svg\"", true);
  expect(segments).toEqual([
    { type: "markdown", content: "能力：" },
    { type: "pending" },
  ]);
});
