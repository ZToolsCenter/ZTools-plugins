import { describe, expect, it } from "vitest";
import { normalizeArtifactSectionBody } from "../../src/core/ai/artifactSectionBody";

const instruction = "Write a short release proposal.";

describe("normalizeArtifactSectionBody", () => {
  it("removes one exact leading ATX title and only its boundary line breaks", () => {
    const source = "\r\n  ## Goal ##\r\n\r\nKeep this paragraph.\r\n\r\n- retain this list";

    expect(normalizeArtifactSectionBody(source, "Goal", instruction)).toEqual({
      ok: true,
      body: "Keep this paragraph.\r\n\r\n- retain this list",
      removedTitle: true
    });
  });

  it("removes an exact leading Setext title", () => {
    expect(normalizeArtifactSectionBody("\nGoal\n----\n\nBody", "Goal", instruction)).toEqual({
      ok: true,
      body: "Body",
      removedTitle: true
    });
    expect(normalizeArtifactSectionBody("\r\nGoal\r\n====\r\n\r\nBody\r\n", "Goal", instruction)).toEqual({
      ok: true,
      body: "Body\r\n",
      removedTitle: true
    });
  });

  it("compares the heading's parsed plain text rather than its inline emphasis syntax", () => {
    expect(normalizeArtifactSectionBody("## **Goal**\n\nBody", "Goal", instruction)).toEqual({
      ok: true,
      body: "Body",
      removedTitle: true
    });
  });

  it("preserves a heading-free body byte-for-byte", () => {
    const body = "  Keep this prose.\r\n\r\n| A | B |\r\n| - | - |\r\n| x | y |  ";
    expect(normalizeArtifactSectionBody(body, "Goal", instruction)).toEqual({
      ok: true,
      body,
      removedTitle: false
    });
  });

  it.each(["goal", "Goals", "Ｇｏａｌ", "Risk", "Other"]) (
    "rejects a leading heading whose literal name does not exactly match: %s",
    name => {
      expect(normalizeArtifactSectionBody(`## ${name}\nBody`, "Goal", instruction)).toEqual({
        ok: false,
        reason: "unexpected-heading"
      });
    }
  );

  it("does not remove a later heading after a matching title", () => {
    expect(normalizeArtifactSectionBody("## Goal\nBody\n\n## Extra", "Goal", instruction)).toEqual({
      ok: false,
      reason: "unexpected-heading"
    });
    expect(normalizeArtifactSectionBody("## Goal\nBody\n\n## Goal\nRepeated", "Goal", instruction)).toEqual({
      ok: false,
      reason: "unexpected-heading"
    });
  });

  it("does not remove a matching title when prose precedes it", () => {
    expect(normalizeArtifactSectionBody("Intro\n\n## Goal\nBody", "Goal", instruction)).toEqual({
      ok: false,
      reason: "unexpected-heading"
    });
  });

  it("does not treat headings nested in blockquotes or lists as the leading section title", () => {
    for (const body of ["> ## Goal\nQuoted text", "- ## Goal\nList text"]) {
      expect(normalizeArtifactSectionBody(body, "Goal", instruction)).toEqual({
        ok: false,
        reason: "unexpected-heading"
      });
    }
  });

  it("does not treat fenced heading examples as Markdown section headings", () => {
    const body = "```md\n## Goal\n```\nKeep the example.";
    expect(normalizeArtifactSectionBody(body, "Goal", instruction)).toEqual({
      ok: true,
      body,
      removedTitle: false
    });
  });

  it.each([
    "<h2>Goal</h2>\n\nBody.",
    "<h2>Other</h2>\n\nBody.",
    "<H3>Later</H3>\n\nBody.",
    "<H4 />\nBody.",
    "<div><h2>Goal</h2></div>\n\nBody.",
    "Intro.\n\n<h2>Later</h2>\n\nBody.",
    "A sentence <h2>Goal</h2> continues here."
  ])("rejects real HTML heading tags rather than rendering another section: %s", body => {
    expect(normalizeArtifactSectionBody(body, "Goal", instruction)).toEqual({
      ok: false,
      reason: "unexpected-heading"
    });
  });

  it.each([
    "```html\n<h2>Goal</h2>\n```\nKeep this example.",
    "    <h2>Goal</h2>\nKeep this indented example.",
    "`<h2>Goal</h2>` is inline code.",
    "<!-- <h2>Goal</h2> -->\nKeep this comment.",
    "<div title=\"<h2>\">Text</div>\nKeep this div.",
    "<div>Ordinary HTML stays intact.</div>"
  ])("preserves non-heading HTML and code examples: %s", body => {
    expect(normalizeArtifactSectionBody(body, "Goal", instruction)).toEqual({
      ok: true,
      body,
      removedTitle: false
    });
  });

  it("rejects a matching title with no body", () => {
    expect(normalizeArtifactSectionBody("## Goal\n\n", "Goal", instruction)).toEqual({
      ok: false,
      reason: "heading-only"
    });
  });

  it("checks exact instruction echoes after removing a matching title", () => {
    expect(normalizeArtifactSectionBody(`## Goal\n${instruction}`, "Goal", instruction)).toEqual({
      ok: false,
      reason: "instruction-echo"
    });
  });

  it("keeps placeholder rejection after removing a matching title", () => {
    expect(normalizeArtifactSectionBody("## Goal\nTODO", "Goal", instruction)).toEqual({
      ok: false,
      reason: "placeholder"
    });
  });

  it("retains type, emptiness, and original byte-limit checks before normalization", () => {
    expect(normalizeArtifactSectionBody(null, "Goal", instruction)).toEqual({ ok: false, reason: "invalid-type" });
    expect(normalizeArtifactSectionBody(" \r\n ", "Goal", instruction)).toEqual({ ok: false, reason: "empty" });
    expect(normalizeArtifactSectionBody(`## Goal\n${"x".repeat(32_768)}`, "Goal", instruction))
      .toEqual({ ok: false, reason: "too-large" });
  });
});
