import { describe, expect, it } from "vitest";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { prepareReadableProse } from "../../src/core/ai/readableProseView";
import { buildReadableProsePrompts } from "../../src/core/ai/readableProseTask";

const instruction = "校对正文中的语法错误，保留原有事实与 Markdown 结构。";

function prepare(source: string) {
  return prepareReadableProse(source, buildThinProseSlots(source, instruction));
}

function applySlots(source: string, slots: ReturnType<typeof buildThinProseSlots>, edits: Map<string, string>): string {
  return [...slots].reverse().reduce((result, slot) => {
    return result.slice(0, slot.range.from) + edits.get(slot.id)! + result.slice(slot.range.to);
  }, source);
}

describe("readable prose view", () => {
  it("projects a readable grammar edit while preserving Markdown, protected facts, emoji, and CRLF", () => {
    const source = "\r\n🙂 The **release note** needs 3 hours of review, see [guide](https://private.invalid/path \"private title\"), keep `run()` and formula $x^2$ ![diagram](private-image.png).\r\n";
    const slots = buildThinProseSlots(source, instruction);
    const view = prepareReadableProse(source, slots);

    expect(view).not.toBeNull();
    expect(view!.text).toContain("release note needs 3 hours of review");
    expect(view!.text).not.toContain("**");
    expect(view!.text).not.toContain("private.invalid");
    expect(view!.text).not.toContain("private title");
    expect(view!.text).not.toContain("private-image.png");
    expect(view!.text).not.toContain("run()");
    expect(view!.text).not.toContain("x^2");
    expect(view!.text).toContain("3");
    expect(view!.text).toContain("guide,");

    const edited = view!.text.replace("needs", "need");
    const projected = view!.decode(edited);
    expect(applySlots(source, slots, projected)).toBe(source.replace("needs", "need"));
    expect([...projected.keys()]).toEqual(slots.map(({ id }) => id));
    expect([...source.matchAll(/\r\n/gu)]).toHaveLength([...applySlots(source, slots, projected).matchAll(/\r\n/gu)].length);
    expect(view!.readonlyPlaceholders.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects changes to readonly numbers, emoji, placeholders, and linked-label punctuation", () => {
    const source = "🙂 Read 3 checks from the [guide](https://private.invalid/path). Then run `tool()` and check $x^2$.";
    const view = prepare(source);
    expect(view).not.toBeNull();

    expect(() => view!.decode(view!.text.replace("3", "4"))).toThrow(/只读/u);
    expect(() => view!.decode(view!.text.replace("🙂", "🙃"))).toThrow(/只读/u);
    expect(() => view!.decode(view!.text.replace("guide.", "guide.."))).toThrow(/只读/u);
    const placeholder = view!.readonlyPlaceholders[0];
    expect(() => view!.decode(view!.text.replace(placeholder, "ChangedAtom"))).toThrow(/占位/u);
    expect(() => view!.decode(view!.text.replace(placeholder, ""))).toThrow(/占位/u);
  });

  it("keeps the period after a link label visible and protects atoms at both line edges", () => {
    const linked = prepare("Read [guide](https://private.invalid/path). It needs review.");
    expect(linked).not.toBeNull();
    expect(linked!.text).toContain("guide.");
    expect(linked!.text).not.toContain("private.invalid");
    expect(() => linked!.decode(linked!.text.replace("guide.", "guide.."))).toThrow(/只读/u);

    const edged = prepare("`start()` The sentence needs care. $x^2$");
    expect(edged).not.toBeNull();
    expect(edged!.text.startsWith(edged!.readonlyPlaceholders[0])).toBe(true);
    expect(edged!.text.endsWith(edged!.readonlyPlaceholders.at(-1)!)).toBe(true);
  });

  it("rejects a diff that crosses adjacent owned slots separated only by removed emphasis marks", () => {
    const source = "**alpha**_beta_";
    const view = prepare(source);
    expect(view).not.toBeNull();
    expect(view!.text).toBe("alphabeta");
    expect(() => view!.decode("omegazeta")).toThrow(/多个正文槽/u);
  });

  it("rejects line breaks and opts out before inference for multiline or oversized views", () => {
    expect(prepare("First sentence needs care.\nSecond sentence needs care.")).toBeNull();
    expect(prepare(`A ${"word ".repeat(120)}sentence needs care.`)).toBeNull();

    const view = prepare("A sentence needs care.");
    expect(view).not.toBeNull();
    expect(() => view!.decode("A sentence\nneeds care.")).toThrow(/一行/u);
  });

  it("builds a plain-text task prompt without slot IDs, JSON receipts, or source delimiters", () => {
    const source = "The **release note** needs review.";
    const view = prepare(source);
    expect(view).not.toBeNull();
    const prompts = buildReadableProsePrompts({
      instruction,
      systemPrompt: "Be precise.",
      skill: { id: "proofread", category: "writing", systemPrompt: "Correct grammar.", userPromptTemplate: "Review this: {{content}}" }
    }, view!);

    expect(prompts.prompt).toContain(instruction);
    expect(prompts.prompt).toContain(view!.text);
    expect(prompts.prompt).toContain("Review this:");
    expect(prompts.prompt).not.toContain("text-1");
    expect(prompts.prompt).not.toContain("{\"edits\"");
    expect(prompts.prompt).not.toContain("```");
    expect(prompts.systemPrompt).toContain("Be precise.");
    expect(prompts.systemPrompt).toContain("Correct grammar.");
    expect(prompts.systemPrompt).toContain("一行");
  });

  it("returns all slots unchanged when the model correctly leaves the readable line alone", () => {
    const source = "This sentence is already correct.";
    const slots = buildThinProseSlots(source, instruction);
    const view = prepareReadableProse(source, slots);
    expect(view).not.toBeNull();
    expect([...view!.decode(view!.text)]).toEqual(slots.map(({ id, sourceText }) => [id, sourceText]));
  });
});
