import { expect, it } from "vitest";
import {
  expectedPresentForm,
  isOptativeVerbSubjectInversion,
  isPastBaseHomograph,
  isProperNameSubjectPhrase,
  resolveSimpleSubject,
  thirdSingular
} from "../../src/core/ai/englishAgreementLanguage";
import type { EnglishAgreementToken } from "../../src/core/ai/englishAgreementTypes";

function token(value: string, pos: string, lemma = value.toLowerCase()): EnglishAgreementToken {
  return { value, lower: value.toLowerCase(), lemma, pos, start: 0, end: value.length };
}

it("inflects only regular third-person simple-present forms", () => {
  expect(thirdSingular("shine")).toBe("shines");
  expect(thirdSingular("carry")).toBe("carries");
  expect(expectedPresentForm("be", { number: "singular", person: 1 })).toBe("am");
  expect(expectedPresentForm("have", { number: "singular", person: 3 })).toBe("has");
  expect(expectedPresentForm("do", { number: "plural", person: 3 })).toBe("do");
});

it("resolves explicit simple quantifiers and abstains on collective-noun ambiguity", () => {
  const each = resolveSimpleSubject([token("Each", "DET"), token("lantern", "NOUN")]);
  const several = resolveSimpleSubject([token("Several", "DET"), token("lanterns", "NOUN", "lantern")]);
  const collective = resolveSimpleSubject([token("The", "DET"), token("team", "NOUN")]);

  expect(each?.number).toBe("singular");
  expect(several?.number).toBe("plural");
  expect(collective).toBeNull();
});

it("resolves an explicit coordinated subject only when both noun phrases are grounded", () => {
  const coordinated = resolveSimpleSubject([
    token("Both", "DET"), token("curator", "NOUN"), token("and", "CCONJ"),
    token("the", "DET"), token("archivist", "NOUN")
  ]);
  const ambiguous = resolveSimpleSubject([
    token("owner", "NOUN"), token("and", "CCONJ"), token("manager", "NOUN")
  ]);

  expect(coordinated?.number).toBe("plural");
  expect(ambiguous).toBeNull();
});

it("recognizes zero-past homographs through common compounds and leaves regular verbs supported", () => {
  for (const lemma of [
    "put", "read", "set", "reset", "outbid", "undercut", "misread", "miscast", "shut", "thread",
    "proofread", "overfit", "retrofit", "telecast", "simulcast", "browbeat", "counterbid", "broadcast",
    "knit", "pet", "spit", "sweat"
  ]) {
    expect(isPastBaseHomograph(lemma), lemma).toBe(true);
  }
  for (const lemma of ["need", "require", "fly", "work"]) {
    expect(isPastBaseHomograph(lemma), lemma).toBe(false);
  }
});

it("marks proper-name subjects with or without determiners and optative inversion as mood-ambiguous", () => {
  const god = [token("God", "PROPN")];
  const articleSubject = [token("The", "DET"), token("CEO", "PROPN")];
  const inversion = [token("Long", "PROPN"), token("live", "VERB"), token("the", "DET"), token("King", "PROPN")];

  expect(isProperNameSubjectPhrase(god)).toBe(true);
  expect(isProperNameSubjectPhrase(articleSubject)).toBe(true);
  expect(isOptativeVerbSubjectInversion(inversion, 1)).toBe(true);
});
