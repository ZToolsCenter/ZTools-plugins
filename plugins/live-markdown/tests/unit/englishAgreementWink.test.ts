import { expect, it } from "vitest";
import { analyzeEnglishAgreementWithWink } from "../../src/core/ai/englishAgreementWink";

it("suggests a single present-tense agreement change with exact UTF-16 offsets", () => {
  const text = "The bird fly north.";
  const result = analyzeEnglishAgreementWithWink({ text });

  expect(result.disposition).toBe("suggestions");
  expect(result.edits).toEqual([{ from: 9, to: 12, source: "fly", replacement: "flies", subject: "bird", lemma: "fly" }]);
  expect(result.outputText).toBe("The bird flies north.");
});

it("preserves trailing Unicode space and reports no supported edit without claiming full correctness", () => {
  const text = "The bird flies north.\u00a0\u2002";
  const result = analyzeEnglishAgreementWithWink({ text });

  expect(result.disposition).toBe("no-supported-edit");
  expect(result.outputText).toBe(text);
  expect(result.reason).toMatch(/other grammar has not been checked/u);
});

it("projects edits around one exact opaque placeholder without changing the placeholder", () => {
  const text = "The child carry ProtectedCodeAtom each morning.";
  const result = analyzeEnglishAgreementWithWink({ text, readonlyPlaceholders: ["ProtectedCodeAtom"] });

  expect(result.disposition).toBe("suggestions");
  expect(result.edits).toEqual([{ from: 10, to: 15, source: "carry", replacement: "carries", subject: "child", lemma: "carry" }]);
  expect(result.outputText).toBe("The child carries ProtectedCodeAtom each morning.");
});

it("abstains on ambiguous quantity and unsupported markup without changing source", () => {
  for (const text of [
    "The flock gather near dusk.",
    "The script `prints` output.",
    "The note says, 'the bird fly north'.",
    "The link https://example.invalid requires review."
  ]) {
    const result = analyzeEnglishAgreementWithWink({ text });
    expect(result.disposition, text).toBe("abstained");
    expect(result.edits, text).toEqual([]);
    expect(result.outputText, text).toBe(text);
  }
});

it("abstains when opaque placeholders are absent, duplicated, or overlapping", () => {
  const text = "The child carry ProtectedCodeAtom each morning.";
  for (const readonlyPlaceholders of [["MissingAtom"], ["ProtectedCodeAtom", "ProtectedCodeAtom"], ["ProtectedCode", "ProtectedCodeAtom"]]) {
    const result = analyzeEnglishAgreementWithWink({ text, readonlyPlaceholders });
    expect(result.disposition).toBe("abstained");
    expect(result.outputText).toBe(text);
    expect(result.edits).toEqual([]);
  }
});

it("keeps the bounded analyzer away from longer prose windows", () => {
  const text = `The bird fly. ${"The light stays bright. ".repeat(12)}`;
  const result = analyzeEnglishAgreementWithWink({ text });

  expect(result.disposition).toBe("abstained");
  expect(result.outputText).toBe(text);
});

it.each([
  "The CEO put the plan into effect yesterday.",
  "The CEO put the plan into effect.",
  "The analyst read the report yesterday.",
  "The operator set the password last night.",
  "The clerk set up the server last night.",
  "The operator cut the power yesterday.",
  "The operator cut off the power yesterday.",
  "The operator hit the switch yesterday.",
  "The operator let the server run overnight.",
  "The operator shut down the server last night.",
  "The server reset the password yesterday.",
  "The scout outbid the rival yesterday.",
  "The editor misread the instruction yesterday.",
  "The miner undercut the price last year.",
  "The manager recommends that he resign immediately.",
  "God save the King.",
  "Heaven help us.",
  "The Lord bless you.",
  "Long live the King."
])("abstains instead of converting tense-ambiguous or optative predicates: %s", (text) => {
  const result = analyzeEnglishAgreementWithWink({ text });

  expect(result.outputText, `${text}: ${result.reason}`).toBe(text);
  expect(result.edits, `${text}: ${result.reason}`).toEqual([]);
  expect(result.disposition, `${text}: ${result.reason}`).toBe("abstained");
});

it("still repairs a clear present-tense agreement error and preserves a correct present form", () => {
  const incorrect = analyzeEnglishAgreementWithWink({ text: "The bird fly north." });
  const correct = analyzeEnglishAgreementWithWink({ text: "The CEO puts the plan into effect every quarter." });
  const correctBlessingStatement = analyzeEnglishAgreementWithWink({ text: "The Lord blesses you." });

  expect(incorrect.outputText).toBe("The bird flies north.");
  expect(correct.disposition).toBe("no-supported-edit");
  expect(correct.outputText).toBe("The CEO puts the plan into effect every quarter.");
  expect(correctBlessingStatement.disposition).toBe("no-supported-edit");
  expect(correctBlessingStatement.outputText).toBe("The Lord blesses you.");
});

it("recognizes before and after clauses only when the intervening subject phrase is fully supported", () => {
  const before = analyzeEnglishAgreementWithWink({
    text: "The release notes needs a careful review before it can ship."
  });
  const after = analyzeEnglishAgreementWithWink({
    text: "The release notes needs review after the engineer completes testing."
  });
  const prepositionalPhrase = analyzeEnglishAgreementWithWink({
    text: "The release notes need review before dinner."
  });
  const unparseableClause = analyzeEnglishAgreementWithWink({
    text: "The release notes needs attention before a very large launch can complete."
  });

  expect(before.outputText).toBe("The release notes need a careful review before it can ship.");
  expect(after.outputText).toBe("The release notes need review after the engineer completes testing.");
  expect(prepositionalPhrase.disposition).toBe("no-supported-edit");
  expect(unparseableClause.disposition).toBe("abstained");
  expect(unparseableClause.outputText).toBe("The release notes needs attention before a very large launch can complete.");
});

it("restores only finite verb lemma changes when a strict reference is provided", () => {
  const needsToRequires = analyzeEnglishAgreementWithWink({
    text: "The release notes requires a careful review before it can ship.",
    referenceText: "The release notes needs a careful review before it can ship."
  });
  const haveToHolds = analyzeEnglishAgreementWithWink({
    text: "The release notes holds a title before it can ship.",
    referenceText: "The release notes have a title before it can ship."
  });
  const sameLemmaInflectionAndSynonym = analyzeEnglishAgreementWithWink({
    text: "The teams has approval, and each operator requires access.",
    referenceText: "The teams have approval, and each operator needs access."
  });
  const articleChanged = analyzeEnglishAgreementWithWink({
    text: "Cedar requires the update.",
    referenceText: "Cedar needs an update."
  });
  const substantiveWordChanged = analyzeEnglishAgreementWithWink({
    text: "Cedar requires a contract.",
    referenceText: "Cedar needs an update."
  });
  const unsupportedComplexText = analyzeEnglishAgreementWithWink({
    text: "Cedar requires an update, while the owners review it.",
    referenceText: "Cedar needs an update, while the owners review it."
  });
  const protectedPlaceholder = analyzeEnglishAgreementWithWink({
    text: "Cedar requires ProtectedCodeAtom.",
    referenceText: "Cedar needs ProtectedCodeAtom.",
    readonlyPlaceholders: ["ProtectedCodeAtom"]
  });

  expect(needsToRequires.outputText).toBe("The release notes need a careful review before it can ship.");
  expect(needsToRequires.edits).toEqual([
    { from: 18, to: 26, source: "requires", replacement: "need", subject: "notes", lemma: "need" }
  ]);
  expect(haveToHolds.outputText).toBe("The release notes have a title before it can ship.");
  expect(haveToHolds.edits).toEqual([
    { from: 18, to: 23, source: "holds", replacement: "have", subject: "notes", lemma: "have" }
  ]);
  expect(sameLemmaInflectionAndSynonym.outputText).toBe("The teams have approval, and each operator needs access.");
  expect(articleChanged.outputText).toBe("Cedar requires the update.");
  expect(substantiveWordChanged.outputText).toBe("Cedar requires a contract.");
  expect(unsupportedComplexText.outputText).toBe("Cedar requires an update, while the owners review it.");
  expect(protectedPlaceholder.outputText).toBe("Cedar needs ProtectedCodeAtom.");
  expect(protectedPlaceholder.outputText.match(/ProtectedCodeAtom/gu)).toHaveLength(1);
  expect(protectedPlaceholder.edits).toEqual([
    { from: 6, to: 14, source: "requires", replacement: "needs", subject: "Cedar", lemma: "need" }
  ]);
});
