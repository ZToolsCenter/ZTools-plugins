import { expect, test } from "playwright/test";
import { jsonContentToMarkdown } from "../../src/lib/export/markdown/serialize";
import { markdownToJsonContent } from "../../src/lib/export/markdown/parse/block";
import { parseInlineMarkdown } from "../../src/lib/export/markdown/parse/inline";
import {
  encodeBlockPropsMarkers,
  encodeLocalBlockPropsWrappers,
  restoreBlockPropsMarkers,
  unwrapLocalBlockPropsWrappers,
} from "../../src/lib/export/markdown/blockPropsMarker";
import { parseNativeMarkdown } from "../../src/native-editor/markdown";

const marker = (props: Record<string, unknown>, legacy = false) =>
  `<!-- goose-note:${legacy ? "native-" : ""}block-props=${encodeURIComponent(JSON.stringify(legacy ? props : { v: 1, ...props }))} -->`;

function roundTrip(block: any) {
  const encoded = encodeBlockPropsMarkers([block] as any);
  const markdown = jsonContentToMarkdown(encoded as any);
  const parsed = markdownToJsonContent(markdown);
  return { markdown, restored: restoreBlockPropsMarkers(parsed as any)[0] as any };
}

test("center/right block props round-trip for all supported markdown block kinds", () => {
  const blocks = [
    { type: "heading", props: { level: 2, textAlignment: "center" }, content: ["标题"] },
    { type: "paragraph", props: { textAlignment: "right" }, content: ["正文"] },
    { type: "bulletListItem", props: { textAlignment: "center" }, content: ["项目"] },
    { type: "numberedListItem", props: { textAlignment: "right" }, content: ["编号"] },
    { type: "checkListItem", props: { checked: true, textAlignment: "center" }, content: ["任务"] },
    { type: "quote", props: { textAlignment: "right" }, content: ["引用"] },
    { type: "callout", props: { icon: "💡", textAlignment: "center" }, content: ["提示"] },
  ];
  for (const block of blocks) {
    const { markdown, restored } = roundTrip(block);
    expect(markdown).toContain("goose-note:block-props=");
    expect(restored.props?.textAlignment).toBe(block.props.textAlignment);
    expect(restored.content).toEqual(block.content);
  }
});

test("left/default and unsupported values are not emitted", () => {
  const encoded = encodeBlockPropsMarkers([
    { type: "paragraph", props: { textAlignment: "left", textColor: "default", backgroundColor: "javascript:bad" }, content: ["x"] },
  ] as any);
  expect(jsonContentToMarkdown(encoded as any)).not.toContain("block-props");
});

test("reads generic and legacy native markers, while malformed markers never throw", () => {
  const valid = marker({ textAlignment: "center", textColor: "red" });
  const legacy = marker({ textAlignment: "right", backgroundColor: "yellow" }, true);
  expect(restoreBlockPropsMarkers([
    { type: "paragraph", content: [valid, "正文"] },
    { type: "paragraph", content: [legacy, "旧正文"] },
  ] as any).map((b: any) => b.props)).toEqual([
    { textAlignment: "center", textColor: "red" },
    { textAlignment: "right", backgroundColor: "yellow" },
  ]);

  const malformed = restoreBlockPropsMarkers([
    { type: "paragraph", content: ["<!-- goose-note:block-props=%ZZ -->正文"] },
    { type: "paragraph", content: ["<!-- goose-note:block-props=%7B%22v%22%3A1%2C%22textAlignment%22%3A%22diagonal%22%7D -->正文"] },
    { type: "paragraph", content: ["<!-- goose-note:block-props=%7B%22v%22%3A1%7D -->正文"] },
    { type: "paragraph", content: ["<!-- goose-note:block-props=not-json -->正文"] },
  ] as any) as any[];
  expect(malformed.map((block) => block.content[0])).toEqual([
    "<!-- goose-note:block-props=%ZZ -->正文",
    "<!-- goose-note:block-props=%7B%22v%22%3A1%2C%22textAlignment%22%3A%22diagonal%22%7D -->正文",
    "<!-- goose-note:block-props=%7B%22v%22%3A1%7D -->正文",
    "<!-- goose-note:block-props=not-json -->正文",
  ]);
});

test("legacy native marker remains editable without a no-change repair", async () => {
  const markdown = marker({ textAlignment: "center" }, true) + "旧段落";
  const parsed = await parseNativeMarkdown(markdown);
  expect(parsed.status).toBe("editable");
  expect(parsed.blocks?.[0]?.props?.textAlignment).toBe("center");
});

test("marker coexists with color, bold and links and survives visible-text edits", () => {
  const block = {
    type: "paragraph",
    props: { textAlignment: "center" },
    content: [
      { type: "text", text: "彩色", styles: { textColor: "red", bold: true } },
      { type: "link", href: "https://example.com", content: [{ type: "text", text: "链接", styles: { bold: true } }] },
    ],
  };
  const { markdown } = roundTrip(block);
  expect(markdown).toContain("<span style=\"color:red\">");
  expect(markdown).toContain("**链接**");
  const edited = markdown.replace("彩色", "改后");
  const restored = restoreBlockPropsMarkers(markdownToJsonContent(edited) as any)[0] as any;
  expect(restored.props.textAlignment).toBe("center");
  expect(restored.content[0].text).toBe("改后");
  const deleted = restoreBlockPropsMarkers(markdownToJsonContent(markdown.replace(/<!--[\s\S]*?-->/, "")) as any)[0] as any;
  expect(deleted.props?.textAlignment).not.toBe("center");
});

test("second serialization converges without duplicate markers", () => {
  const first = roundTrip({ type: "heading", props: { level: 1, textAlignment: "center" }, content: ["一次"] });
  const second = roundTrip(first.restored);
  expect(second.markdown).toBe(first.markdown);
  expect(second.markdown.match(/goose-note:block-props=/g)).toHaveLength(1);
});

test("local-folder wrapper keeps heading/list/quote semantics and restores before inline parsing", async () => {
  const blocks = [
    {
      type: "heading",
      props: { level: 1, textAlignment: "center", textColor: "red" },
      content: [
        { type: "text", text: "彩色", styles: { bold: true } },
        { type: "link", href: "https://example.com", content: [{ type: "text", text: "链接", styles: {} }] },
      ],
    },
    { type: "bulletListItem", props: { textAlignment: "right" }, content: ["项目"] },
    { type: "quote", props: { backgroundColor: "yellow" }, content: ["引用"] },
    { type: "callout", props: { icon: "💡", textAlignment: "center" }, content: ["提示"] },
  ];
  const markdown = jsonContentToMarkdown(encodeLocalBlockPropsWrappers(blocks as any) as any);
  expect(markdown).toContain('# <span data-goose-note-block-props="v1" style="display:block; text-align:center; color:#e03e3e">');
  expect(markdown).toContain('- <span data-goose-note-block-props="v1" style="display:block; text-align:right">项目</span>');
  expect(markdown).toContain('> <span data-goose-note-block-props="v1" style="display:block; background-color:#fbf3db">引用</span>');
  expect(markdown).toContain('> [!INFO] 💡 <span data-goose-note-block-props="v1" style="display:block; text-align:center">提示</span>');
  expect(markdown).not.toContain("goose-note:block-props=");

  const restored = restoreBlockPropsMarkers(
    markdownToJsonContent(unwrapLocalBlockPropsWrappers(markdown)) as any,
  ) as any[];
  expect(restored[0].props).toMatchObject({ textAlignment: "center", textColor: "red" });
  expect(restored[0].content[0]).toMatchObject({ text: "彩色", styles: { bold: true } });
  expect(restored[0].content[1]).toMatchObject({ type: "link", href: "https://example.com" });
  expect(restored.find((block) => block.type === "bulletListItem")?.props?.textAlignment).toBe("right");
  expect(restored.find((block) => block.type === "quote")?.props?.backgroundColor).toBe("yellow");
  expect(restored.find((block) => block.type === "callout")?.props?.textAlignment).toBe("center");
  const native = await parseNativeMarkdown(markdown);
  expect(native.status).toBe("editable");
  expect(native.blocks?.[0]?.props?.textAlignment).toBe("center");
});

test("local disk output uses the complete canonical heading wrapper", () => {
  const markdown = jsonContentToMarkdown(encodeLocalBlockPropsWrappers([
    { type: "heading", props: { level: 1, textAlignment: "center" }, content: ["标题"] },
  ] as any) as any);
  expect(markdown).toBe('# <span data-goose-note-block-props="v1" style="display:block; text-align:center">标题</span>');
  expect(markdown).not.toContain("<!-- goose-note:block-props");
});

test("local wrappers cover numbered and task items and preserve underline in mixed inline content", () => {
  const blocks = [
    { type: "numberedListItem", props: { textAlignment: "right" }, content: ["编号"] },
    { type: "checkListItem", props: { checked: true, textAlignment: "center" }, content: ["任务"] },
    {
      type: "paragraph", props: { textAlignment: "center" },
      content: [
        { type: "text", text: "粗体下划线", styles: { bold: true, underline: true, textColor: "red" } },
        { type: "link", href: "https://example.com", content: [{ type: "text", text: "链接", styles: { underline: true } }] },
      ],
    },
  ];
  const markdown = jsonContentToMarkdown(encodeLocalBlockPropsWrappers(blocks as any) as any);
  expect(markdown).toContain('1. <span data-goose-note-block-props="v1" style="display:block; text-align:right">编号</span>');
  expect(markdown).toContain('- [x] <span data-goose-note-block-props="v1" style="display:block; text-align:center">任务</span>');
  expect(markdown).toContain("<u><span style=\"color:red\">**");
  expect(markdown).toContain("<u>链接</u>");
  const unwrapped = unwrapLocalBlockPropsWrappers(markdown);
  expect(unwrapped).toContain("goose-note:block-props=");
  const inline = parseInlineMarkdown('<u><span style="color:red">**粗体下划线**</span></u>[<u>链接</u>](https://example.com)');
  expect(inline[0].styles).toMatchObject({ bold: true, underline: true, textColor: "red" });
  expect(inline[1].content[0].styles.underline).toBe(true);
});

test("legacy comments are migrated to canonical local wrappers", () => {
  const legacyMd = `${marker({ textAlignment: "right", textColor: "red" }, true)}旧正文`;
  const restored = restoreBlockPropsMarkers(markdownToJsonContent(legacyMd) as any) as any[];
  const localMd = jsonContentToMarkdown(encodeLocalBlockPropsWrappers(restored as any) as any);
  expect(localMd).toBe('<span data-goose-note-block-props="v1" style="display:block; text-align:right; color:#e03e3e">旧正文</span>');
  expect(localMd).not.toContain("native-block-props");
});

test("left/default blocks stay unwrapped and non-canonical or dangerous wrappers are ignored", () => {
  const plain = jsonContentToMarkdown(encodeLocalBlockPropsWrappers([
    { type: "paragraph", props: { textAlignment: "left", textColor: "default" }, content: ["左"] },
  ] as any) as any);
  expect(plain).toBe("左");
  for (const value of [
    '<span data-goose-note-block-props="v1" style="text-align:center; display:block">危险顺序</span>',
    '<span data-goose-note-block-props="v1" style="display:block; text-align:center; background-image:url(x)">危险属性</span>',
    '<span data-goose-note-block-props="v1" style="display:block;color:red">非 canonical</span>',
  ]) {
    expect(unwrapLocalBlockPropsWrappers(value)).toBe(value);
  }
});

test("local wrapper only consumes the strict canonical data marker", () => {
  const ordinary = '<span style="display:block; text-align:center">用户 span</span>';
  expect(unwrapLocalBlockPropsWrappers(ordinary)).toBe(ordinary);
});

test("local wrapper handles multiline paragraph, heading, quote and toggle before inline parsing", async () => {
  const blocks = [
    { type: "heading", props: { level: 2, textAlignment: "center" }, content: ["标题一\n标题二"] },
    { type: "paragraph", props: { textAlignment: "right" }, content: ["段落一\n段落二"] },
    { type: "quote", props: { textAlignment: "center" }, content: ["引用一\n引用二"] },
    { type: "toggleListItem", props: { textAlignment: "right" }, content: ["折叠标题"] },
  ];
  const markdown = jsonContentToMarkdown(encodeLocalBlockPropsWrappers(blocks as any) as any);
  expect(markdown).toContain('#');
  expect(markdown).toContain('> <span data-goose-note-block-props="v1" style="display:block; text-align:center">引用一</span>\n> <span data-goose-note-block-props="v1" style="display:block; text-align:center">引用二</span>');
  expect(markdown).toContain('<summary><span data-goose-note-block-props="v1" style="display:block; text-align:right">折叠标题</span></summary>');

  const restored = restoreBlockPropsMarkers(
    markdownToJsonContent(unwrapLocalBlockPropsWrappers(markdown)) as any,
  ) as any[];
  expect(restored.find((block) => block.type === "heading")?.props?.textAlignment).toBe("center");
  expect(restored.find((block) => block.type === "paragraph" && JSON.stringify(block.content).includes("段落一"))?.props?.textAlignment).toBe("right");
  expect(restored.find((block) => block.type === "quote")?.props?.textAlignment).toBe("center");
  expect(JSON.stringify(restored.find((block) => block.type === "quote")?.content)).not.toContain("goose-note:block-props");
  expect(restored.find((block) => block.type === "toggleListItem")?.props?.textAlignment).toBe("right");

});

test("multiline quote consumes only its first wrapper marker and stays native-editable", async () => {
  const markdown = jsonContentToMarkdown(encodeLocalBlockPropsWrappers([
    { type: "quote", props: { textAlignment: "center" }, content: ["第一行\n第二行"] },
  ] as any) as any);
  const restored = restoreBlockPropsMarkers(
    markdownToJsonContent(unwrapLocalBlockPropsWrappers(markdown)) as any,
  ) as any[];
  expect(restored[0].props?.textAlignment).toBe("center");
  expect(JSON.stringify(restored[0].content)).not.toContain("goose-note:block-props");
  expect((await parseNativeMarkdown(markdown)).status).toBe("editable");
});

test("local wrapper scanner leaves fenced and incomplete text untouched and keeps adjacent wrappers separate", () => {
  const open = '<span data-goose-note-block-props="v1" style="display:block; text-align:center">';
  const fenced = `\`\`\`md\n${open}代码</span>\n\`\`\``;
  expect(unwrapLocalBlockPropsWrappers(fenced)).toBe(fenced);

  const incomplete = `${open}未闭合\n\n下一块`;
  expect(unwrapLocalBlockPropsWrappers(incomplete)).toBe(incomplete);

  const adjacent = `${open}甲</span>\n\n${open}乙</span>`;
  const unwrapped = unwrapLocalBlockPropsWrappers(adjacent);
  expect(unwrapped.match(/goose-note:block-props/g)).toHaveLength(2);
  expect(unwrapped).toContain("甲");
  expect(unwrapped).toContain("乙");
});

test("fence-aware scanner does not close on info-string fence text", () => {
  const wrapper = '<span data-goose-note-block-props="v1" style="display:block; text-align:center">代码</span>';
  const fenced = `\`\`\`md\n${wrapper}\n\`\`\`typescript\n${wrapper}\n\`\`\``;
  expect(unwrapLocalBlockPropsWrappers(fenced)).toBe(fenced);
});

test("multiline callout wraps each quote line, restores once, and stays native-editable", async () => {
  const markdown = jsonContentToMarkdown(encodeLocalBlockPropsWrappers([
    { type: "callout", props: { icon: "💡", textAlignment: "right" }, content: ["提示一\n提示二"] },
  ] as any) as any);
  expect(markdown).toContain('> [!INFO] 💡 <span data-goose-note-block-props="v1" style="display:block; text-align:right">提示一</span>\n> <span data-goose-note-block-props="v1" style="display:block; text-align:right">提示二</span>');
  const restored = restoreBlockPropsMarkers(
    markdownToJsonContent(unwrapLocalBlockPropsWrappers(markdown)) as any,
  ) as any[];
  expect(restored).toHaveLength(1);
  expect(restored[0].type).toBe("callout");
  expect(restored[0].props).toMatchObject({ icon: "💡", textAlignment: "right" });
  expect(JSON.stringify(restored[0].content)).not.toContain("goose-note:block-props");
  expect((await parseNativeMarkdown(markdown)).status).toBe("editable");
});
