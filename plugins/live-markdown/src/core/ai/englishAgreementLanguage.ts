import type { EnglishAgreementSubject, EnglishAgreementToken } from "./englishAgreementTypes";

const SUBJECT_POS = new Set(["NOUN", "PRON", "PROPN"]);
const PHRASE_POS = new Set(["ADJ", "CCONJ", "DET", "NOUN", "NUM", "PRON", "PROPN"]);
const PLURAL_ONLY_NOUNS = new Set([
  "cattle", "clergy", "clothes", "goods", "livestock", "people", "police", "poultry",
  "scissors", "trousers", "pants"
]);
const INVARIANT_COUNT_NOUNS = new Set(["aircraft", "deer", "fish", "offspring", "series", "sheep", "species"]);
const COLLECTIVE_NOUNS = new Set([
  "audience", "committee", "company", "crew", "family", "flock", "government", "group",
  "herd", "jury", "public", "staff", "team"
]);
const MODALS = new Set(["can", "could", "may", "might", "must", "shall", "should", "will", "would"]);
const ZERO_PAST_HOMOGRAPHS = new Set([
  "beat", "bet", "bid", "broadcast", "burst", "bust", "cast", "cost", "cut", "fit", "forecast",
  "hit", "hurt", "let", "put", "quit", "read", "rid", "set", "shed", "shut", "slit", "split",
  "spread", "thrust", "wed", "wet", "knit", "pet", "spit", "sweat"
]);
const OPTATIVE_INVERSION_MARKERS = new Set(["long"]);

function phraseQuantifier(phrase: EnglishAgreementToken[]): "singular" | "plural" | null {
  const words = phrase.map((token) => token.lower);
  if (words.some((word) => ["each", "every", "a", "an", "one", "this", "that", "either", "neither"].includes(word))) {
    return "singular";
  }
  if (words.some((word) => ["many", "several", "few", "both", "these", "those"].includes(word))) return "plural";
  const numbers: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
  };
  for (const token of phrase) {
    if (token.pos !== "NUM") continue;
    const value = /^\d+$/u.test(token.lower) ? Number(token.lower) : numbers[token.lower];
    if (value === 1) return "singular";
    if (value > 1) return "plural";
  }
  return null;
}

function numberOfHead(head: EnglishAgreementToken, quantifier: "singular" | "plural" | null): "singular" | "plural" | null {
  const { lower: word, lemma } = head;
  if (PLURAL_ONLY_NOUNS.has(word) || PLURAL_ONLY_NOUNS.has(lemma)) return quantifier === "singular" ? null : "plural";
  if (COLLECTIVE_NOUNS.has(word) || COLLECTIVE_NOUNS.has(lemma)) return word !== lemma ? "plural" : null;
  if (INVARIANT_COUNT_NOUNS.has(word) || INVARIANT_COUNT_NOUNS.has(lemma)) {
    return word !== lemma ? "plural" : quantifier;
  }
  if (head.pos === "PROPN") return "singular";
  if (head.pos === "PRON") {
    const pronouns: Record<string, "singular" | "plural"> = {
      i: "singular", you: "plural", we: "plural", they: "plural", he: "singular", she: "singular", it: "singular"
    };
    return pronouns[word] ?? null;
  }
  if (head.pos !== "NOUN") return null;
  return word !== lemma ? "plural" : "singular";
}

function personOfHead(head: EnglishAgreementToken): 1 | 2 | 3 {
  if (head.pos === "PRON") {
    if (head.lower === "i" || head.lower === "we") return 1;
    if (head.lower === "you") return 2;
  }
  return 3;
}

function isPluralCoordinate(
  phrase: EnglishAgreementToken[],
  heads: EnglishAgreementToken[],
  joinIndex: number,
  quantifier: "singular" | "plural" | null
): boolean | null {
  const left = phrase.slice(0, joinIndex);
  const right = phrase.slice(joinIndex + 1);
  const leftHeads = heads.filter((head) => left.includes(head));
  const rightHeads = heads.filter((head) => right.includes(head));
  if (!leftHeads.length || !rightHeads.length) return null;
  if (quantifier === "plural") return true;
  if ([left, right].every((side) => side.some((token) => token.pos === "DET"))) return true;
  const numbers = [...leftHeads, ...rightHeads].map((head) => numberOfHead(head, quantifier));
  if (numbers.includes("plural")) return true;
  if (leftHeads.every((head) => head.pos === "PROPN") && rightHeads.every((head) => head.pos === "PROPN")) return true;
  return null;
}

/** Resolve only a simple, unambiguous subject phrase; null means abstain. */
export function resolveSimpleSubject(phrase: EnglishAgreementToken[]): EnglishAgreementSubject | null {
  if (!phrase.length || phrase.some((token) => !PHRASE_POS.has(token.pos) || token.opaque)) return null;
  const heads = phrase.filter((token) => SUBJECT_POS.has(token.pos));
  if (!heads.length) return null;
  const quantifier = phraseQuantifier(phrase);
  const joins = phrase.map((token, index) => ({ token, index })).filter(({ token }) => token.pos === "CCONJ");
  if (joins.some(({ token }) => token.lower !== "and") || joins.length > 1) return null;

  let number: "singular" | "plural" | null;
  if (joins.length) {
    const plural = isPluralCoordinate(phrase, heads, joins[0].index, quantifier);
    if (plural === null) return null;
    number = plural ? "plural" : "singular";
  } else {
    number = numberOfHead(heads.at(-1)!, quantifier);
    if (!number) return null;
  }
  const head = heads.at(-1)!;
  return { number, person: personOfHead(head), head };
}

export function isPresentModal(word: string): boolean {
  return MODALS.has(word.toLowerCase());
}

export function thirdSingular(lemma: string): string {
  const word = lemma.toLowerCase();
  if (word === "be") return "is";
  if (word === "have") return "has";
  if (word === "do") return "does";
  if (/[^aeiou]y$/u.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh|o)$/u.test(word)) return `${word}es`;
  return `${word}s`;
}

export function expectedPresentForm(lemma: string, subject: Pick<EnglishAgreementSubject, "number" | "person">): string {
  const word = lemma.toLowerCase();
  if (word === "be") {
    if (subject.person === 1 && subject.number === "singular") return "am";
    return subject.number === "singular" ? "is" : "are";
  }
  if (word === "have" || word === "do") {
    return subject.number === "singular" && subject.person === 3 ? thirdSingular(word) : word;
  }
  return subject.number === "singular" && subject.person === 3 ? thirdSingular(word) : word;
}

export function isSupportedPresentSurface(lemma: string, surface: string): boolean {
  const word = lemma.toLowerCase();
  const form = surface.toLowerCase();
  if (word === "be") return ["am", "is", "are"].includes(form);
  if (word === "have") return ["have", "has"].includes(form);
  if (word === "do") return ["do", "does"].includes(form);
  return form === word || form === thirdSingular(word);
}

/** A base token in this lexicon may also be a simple-past form. */
export function isPastBaseHomograph(lemma: string): boolean {
  const word = lemma.toLowerCase();
  for (const root of ZERO_PAST_HOMOGRAPHS) {
    if (word.endsWith(root)) return true;
  }
  return false;
}

/** Proper-name heads can head optative/subjunctive clauses, with or without a determiner. */
export function isProperNameSubjectPhrase(phrase: EnglishAgreementToken[]): boolean {
  return phrase.at(-1)?.pos === "PROPN";
}

/** Detect the common adverb + verb + subject inversion without treating the adverb as subject. */
export function isOptativeVerbSubjectInversion(tokens: EnglishAgreementToken[], verbIndex: number): boolean {
  if (verbIndex !== 1 || !OPTATIVE_INVERSION_MARKERS.has(tokens[0]?.lower ?? "")) return false;
  const postverbalPhrase = tokens.slice(verbIndex + 1).filter((token) => token.pos !== "PUNCT");
  return resolveSimpleSubject(postverbalPhrase) !== null;
}
