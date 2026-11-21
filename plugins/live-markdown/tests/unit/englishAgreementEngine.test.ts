import { expect, it, vi } from "vitest";
import { analyzeSimplePresentAgreement } from "../../src/core/ai/englishAgreementEngine";
import type { EnglishAgreementInput, EnglishAgreementTokenizer } from "../../src/core/ai/englishAgreementTypes";

const TAGS: Record<string, { pos: string; lemma: string }> = {
  a: { pos: "DET", lemma: "a" }, the: { pos: "DET", lemma: "the" }, it: { pos: "PRON", lemma: "it" },
  lantern: { pos: "NOUN", lemma: "lantern" }, child: { pos: "NOUN", lemma: "child" },
  children: { pos: "NOUN", lemma: "child" }, shines: { pos: "VERB", lemma: "shine" },
  shine: { pos: "VERB", lemma: "shine" }, at: { pos: "ADP", lemma: "at" },
  night: { pos: "NOUN", lemma: "night" }, carry: { pos: "VERB", lemma: "carry" },
  carries: { pos: "VERB", lemma: "carry" }, every: { pos: "DET", lemma: "every" },
  morning: { pos: "NOUN", lemma: "morning" }
};

function fakeTokenizer(): EnglishAgreementTokenizer {
  return {
    tokenize(text) {
      const trailingZs = text.match(/\p{Zs}+$/u)?.[0] ?? "";
      const tokenText = trailingZs ? text.slice(0, -trailingZs.length) : text;
      const tokens = [];
      let rebuilt = "";
      for (const match of tokenText.matchAll(/[A-Za-z]+|[0-9]+|[^\w\s]/gu)) {
        const value = match[0];
        const precedingSpaces = tokenText.slice(rebuilt.length, match.index);
        const start = rebuilt.length + precedingSpaces.length;
        const lower = value.toLowerCase();
        const tag = TAGS[lower] ?? { pos: /[.!?]/u.test(value) ? "PUNCT" : "X", lemma: lower };
        rebuilt += precedingSpaces + value;
        tokens.push({ value, lower, lemma: tag.lemma, pos: tag.pos, start, end: start + value.length, precedingSpaces });
      }
      return { tokens, rebuilt: rebuilt + trailingZs };
    }
  };
}

it("suggests only the supported simple-present edit and retains trailing Zs offsets", () => {
  const text = "A lantern shine at night.\u00a0\u2002";
  const result = analyzeSimplePresentAgreement({ text }, fakeTokenizer());

  expect(result.disposition).toBe("suggestions");
  expect(result.edits).toEqual([{ from: 10, to: 15, source: "shine", replacement: "shines", subject: "lantern", lemma: "shine" }]);
  expect(result.outputText).toBe("A lantern shines at night.\u00a0\u2002");
  expect(result.scope).toBe("simple-present-subject-verb-agreement");
});

it("labels an empty candidate as no-supported-edit, not whole-text correctness", () => {
  const result = analyzeSimplePresentAgreement({ text: "A lantern shines at night." }, fakeTokenizer());

  expect(result.disposition).toBe("no-supported-edit");
  expect(result.edits).toEqual([]);
  expect(result.reason).toContain("other grammar has not been checked");
});

it("abstains before tokenization when input exceeds the bounded window", () => {
  const tokenizer = fakeTokenizer();
  const tokenize = vi.spyOn(tokenizer, "tokenize");
  const text = `${"A ".repeat(130)}lantern shines.`;

  const result = analyzeSimplePresentAgreement({ text }, tokenizer);

  expect(result.disposition, `${text}: ${result.reason}`).toBe("abstained");
  expect(result.outputText).toBe(text);
  expect(tokenize).not.toHaveBeenCalled();
});

it("maps one read-only placeholder without changing it", () => {
  const text = "The child carry ProtectedCodeAtom every morning.";
  const result = analyzeSimplePresentAgreement({ text, readonlyPlaceholders: ["ProtectedCodeAtom"] }, fakeTokenizer());

  expect(result.disposition).toBe("suggestions");
  expect(result.outputText).toBe("The child carries ProtectedCodeAtom every morning.");
  expect(result.edits).toEqual([{ from: 10, to: 15, source: "carry", replacement: "carries", subject: "child", lemma: "carry" }]);
});

it.each([
  { text: "The child carry ProtectedCodeAtom every morning.", readonlyPlaceholders: ["MissingAtom"] },
  { text: "The child carry ProtectedCodeAtom every morning.", readonlyPlaceholders: ["ProtectedCodeAtom", "ProtectedCodeAtom"] },
  { text: "The `child` carry output.", readonlyPlaceholders: [] }
])("abstains on malformed or opaque-boundary input without proposing source changes", ({ text, readonlyPlaceholders }: EnglishAgreementInput) => {
  const result = analyzeSimplePresentAgreement({ text, readonlyPlaceholders }, fakeTokenizer());

  expect(result.disposition, `${text}: ${result.reason}`).toBe("abstained");
  expect(result.edits).toEqual([]);
  expect(result.outputText).toBe(text);
});
