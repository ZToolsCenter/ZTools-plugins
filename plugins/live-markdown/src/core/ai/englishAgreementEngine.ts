import {
  expectedPresentForm,
  isOptativeVerbSubjectInversion,
  isPastBaseHomograph,
  isPresentModal,
  isProperNameSubjectPhrase,
  isSupportedPresentSurface,
  resolveSimpleSubject
} from "./englishAgreementLanguage";
import type {
  EnglishAgreementAnalysis,
  EnglishAgreementEdit,
  EnglishAgreementInput,
  EnglishAgreementToken,
  EnglishAgreementTokenizer
} from "./englishAgreementTypes";

export const ENGLISH_AGREEMENT_MAX_CODE_POINTS = 256;
const SUBJECT_LIKE_POS = new Set(["ADJ", "CCONJ", "DET", "NOUN", "NUM", "PRON", "PROPN"]);
const OBJECT_PRONOUNS = new Set(["her", "him", "it", "me", "them", "us", "whom", "you"]);
const HARMFUL_MARKUP = /[\r\n\t'"“”‘’`$*_\[\]{}()\\<>#]/u;
const RELATIVE_WORDS = new Set(["who", "which", "that", "whom", "whose"]);
const analysisFiniteMetadata = new WeakMap<EnglishAgreementAnalysis, { indexes: Set<number>; subjects: Map<number, string> }>();

interface OpaqueRange { start: number; end: number; value: string }

interface OpaqueProxy {
  proxy: string;
  ranges: OpaqueRange[];
}

interface Candidate {
  token: EnglishAgreementToken;
  index: number;
  recovered?: boolean;
}

interface VerbEvidence {
  contextPos: string;
  contextLemma: string;
  context: string;
}

function makeResult(
  disposition: EnglishAgreementAnalysis["disposition"],
  reason: string,
  text: string,
  edits: EnglishAgreementEdit[] = []
): EnglishAgreementAnalysis {
  const sorted = [...edits].sort((left, right) => left.from - right.from);
  let outputText = text;
  for (const edit of [...sorted].reverse()) {
    outputText = `${outputText.slice(0, edit.from)}${edit.replacement}${outputText.slice(edit.to)}`;
  }
  return { scope: "simple-present-subject-verb-agreement", disposition, reason, outputText, edits: sorted };
}

function abstain(text: string, reason: string): EnglishAgreementAnalysis {
  return makeResult("abstained", reason, text);
}

/** Cheap guards used before tokenization, including by the Worker service. */
export function preflightEnglishAgreementInput(input: EnglishAgreementInput): EnglishAgreementAnalysis | null {
  if (!input || typeof input.text !== "string") return abstain("", "Text must be a string.");
  const { text } = input;
  if ([...text].length > ENGLISH_AGREEMENT_MAX_CODE_POINTS) {
    return abstain(text, `Input exceeds the ${ENGLISH_AGREEMENT_MAX_CODE_POINTS} code-point limit.`);
  }
  if (input.referenceText !== undefined) {
    if (typeof input.referenceText !== "string") return abstain(text, "Reference text must be a string.");
    if ([...input.referenceText].length > ENGLISH_AGREEMENT_MAX_CODE_POINTS) {
      return abstain(text, `Reference text exceeds the ${ENGLISH_AGREEMENT_MAX_CODE_POINTS} code-point limit.`);
    }
  }
  if (!text.trim()) return abstain(text, "The trusted text is empty.");
  if (!Array.isArray(input.readonlyPlaceholders ?? [])) return abstain(text, "readonlyPlaceholders must be an array.");
  const opaque = prepareOpaqueProxy(text, input.readonlyPlaceholders);
  if ("error" in opaque) return abstain(text, opaque.error);
  const unsafeReason = unsupportedInput(text, opaque.ranges);
  if (unsafeReason) return abstain(text, unsafeReason);
  if (input.referenceText !== undefined) {
    const referenceOpaque = prepareOpaqueProxy(input.referenceText, input.readonlyPlaceholders);
    if ("error" in referenceOpaque) return abstain(text, `Reference text: ${referenceOpaque.error}`);
    const referenceUnsafeReason = unsupportedInput(input.referenceText, referenceOpaque.ranges);
    if (referenceUnsafeReason) return abstain(text, `Reference text: ${referenceUnsafeReason}`);
  }
  return null;
}

function prepareOpaqueProxy(text: string, readonlyPlaceholders: string[] | undefined): OpaqueProxy | { error: string } {
  if (!Array.isArray(readonlyPlaceholders ?? [])) return { error: "readonlyPlaceholders must be an array." };
  const values = [...(readonlyPlaceholders ?? [])];
  if (values.some((value) => typeof value !== "string" || value.length < 2)) {
    return { error: "Each opaque placeholder must be a string of at least two UTF-16 code units." };
  }
  if (new Set(values).size !== values.length) return { error: "Opaque placeholders must be unique." };

  const ranges: OpaqueRange[] = [];
  for (const value of values) {
    const start = text.indexOf(value);
    if (start < 0 || text.indexOf(value, start + value.length) >= 0) {
      return { error: `Opaque placeholder must occur exactly once: ${value}` };
    }
    ranges.push({ start, end: start + value.length, value });
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) return { error: "Opaque placeholder ranges overlap." };
  }

  let proxy = "";
  let cursor = 0;
  for (const range of ranges) {
    proxy += text.slice(cursor, range.start);
    proxy += `it${" ".repeat(range.value.length - 2)}`;
    cursor = range.end;
  }
  proxy += text.slice(cursor);
  if (proxy.length !== text.length) return { error: "Opaque proxy changed UTF-16 source offsets." };
  return { proxy, ranges };
}

function isOpaqueToken(token: EnglishAgreementToken, ranges: OpaqueRange[]): boolean {
  return ranges.some((range) => token.start < range.end && token.end > range.start);
}

function maskOpaque(text: string, ranges: OpaqueRange[]): string {
  let masked = "";
  let cursor = 0;
  for (const range of ranges) {
    masked += `${text.slice(cursor, range.start)}${" ".repeat(range.end - range.start)}`;
    cursor = range.end;
  }
  return masked + text.slice(cursor);
}

function unsupportedInput(text: string, ranges: OpaqueRange[]): string | null {
  const visible = maskOpaque(text, ranges).replace(/\p{Zs}+$/u, "");
  if (!visible.trim()) return "The trusted text is empty.";
  if (HARMFUL_MARKUP.test(visible) || /https?:\/\/|\bwww\./iu.test(visible)) {
    return "Quotes, Markdown syntax, code, math, and URLs are outside this analyzer.";
  }
  if (/[^\x20-\x7E\n\r\t]/u.test(visible)) return "Only plain ASCII English outside opaque atoms is supported.";
  if (!/^[A-Za-z0-9\s.,;:!?%-]+$/u.test(visible)) return "The text contains syntax outside the supported grammar.";
  return null;
}

function isSubjectLike(token: EnglishAgreementToken | undefined): boolean {
  return Boolean(token && SUBJECT_LIKE_POS.has(token.pos));
}

function preserveCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase() && source.slice(1) === source.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function nearestWord(tokens: EnglishAgreementToken[], beforeIndex: number): { token: EnglishAgreementToken; index: number } | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (tokens[index].pos !== "PUNCT") return { token: tokens[index], index };
  }
  return null;
}

function findBoundary(tokens: EnglishAgreementToken[], previousIndex: number, currentIndex: number): { index: number; kind: "new-clause" | "shared-subject" } | null {
  for (let index = currentIndex - 1; index > previousIndex; index -= 1) {
    const token = tokens[index];
    if (token.lower === "while") return { index, kind: "new-clause" };
    if ((token.lower === "before" || token.lower === "after") && ["ADP", "SCONJ"].includes(token.pos)) {
      const subjectPhrase = tokens.slice(index + 1, currentIndex);
      if (subjectPhrase.length && resolveSimpleSubject(subjectPhrase)) return { index, kind: "new-clause" };
    }
    if (token.lower === "and" || token.lower === "but") {
      const between = tokens.slice(index + 1, currentIndex);
      return between.some(isSubjectLike) ? { index, kind: "new-clause" } : { index, kind: "shared-subject" };
    }
  }
  return null;
}

function independentlyConfirmedVerb(token: EnglishAgreementToken, tokenizer: EnglishAgreementTokenizer): VerbEvidence | null {
  if (!isSupportedPresentSurface(token.lemma, token.value)) return null;
  const isBase = token.lower === token.lemma;
  const prefix = isBase ? "They " : "A person ";
  const context = `${prefix}${token.value} it.`;
  const analysis = tokenizer.tokenize(context);
  if (analysis.rebuilt !== context) return null;
  const candidate = analysis.tokens.find((item) => item.start === prefix.length);
  if (!candidate || candidate.lemma !== token.lemma || !["AUX", "VERB"].includes(candidate.pos)) return null;
  if (candidate.pos === "AUX" && !["be", "do", "have"].includes(candidate.lemma)) return null;
  return { contextPos: candidate.pos, contextLemma: candidate.lemma, context };
}

function modalGoverned(candidateIndex: number, candidates: Candidate[], tokens: EnglishAgreementToken[]): boolean {
  const before = candidates.filter(({ index }) => index < candidateIndex);
  const last = before.at(-1);
  const previous = before.at(-2);
  if (!last) return false;
  if (isPresentModal(last.token.lower)) return true;
  const nearest = nearestWord(tokens, candidateIndex)?.token.lower;
  if (last.token.lemma === "do" && (nearest === "not" || isSupportedPresentSurface(tokens[candidateIndex]?.lemma, tokens[candidateIndex]?.value))) {
    return true;
  }
  if (!previous) return false;
  const between = tokens.slice(previous.index + 1, last.index);
  if (between.some((token) => ["but", "while"].includes(token.lower))) return false;
  if (isPresentModal(previous.token.lower)) return true;
  return previous.token.lemma === "do"
    && (nearestWord(tokens, last.index)?.token.lower === "not" || isSupportedPresentSurface(last.token.lemma, last.token.value));
}

function recoverConjoinedNounPredicates(
  tokens: EnglishAgreementToken[],
  candidates: Candidate[],
  opaqueRanges: OpaqueRange[],
  tokenizer: EnglishAgreementTokenizer
): { candidates: Candidate[]; error?: string } {
  const recovered: Candidate[] = [];
  for (let index = 1; index < tokens.length - 1; index += 1) {
    const observed = tokens[index];
    const conjunction = tokens[index - 1];
    if (observed.opaque || observed.pos !== "NOUN" || !["and", "but"].includes(conjunction.lower)) continue;
    const previous = candidates.filter(({ index: candidateIndex }) => candidateIndex < index - 1).at(-1);
    if (!previous) continue;
    const object = tokens[index + 1];
    const hasDirectObject = Boolean(object && (isOpaqueToken(object, opaqueRanges)
      || (object.pos === "PRON" && OBJECT_PRONOUNS.has(object.lower))));
    if (!hasDirectObject) continue;
    if (modalGoverned(previous.index, candidates, tokens) || isPresentModal(previous.token.lower)) {
      return { candidates, error: "Modal-governed coordinated verbs are outside this recovery." };
    }
    const evidence = independentlyConfirmedVerb(observed, tokenizer);
    if (!evidence) return { candidates, error: "A coordinated noun-tagged predicate lacked independent verb evidence." };
    recovered.push({
      token: { ...observed, pos: "VERB", recoveredFrom: observed.pos },
      index,
      recovered: true
    });
  }
  const existing = new Set(candidates.map(({ index }) => index));
  return { candidates: [...candidates, ...recovered.filter(({ index }) => !existing.has(index))].sort((a, b) => a.index - b.index) };
}

function tokenRangeIsExact(text: string, token: EnglishAgreementToken, opaqueRanges: OpaqueRange[]): boolean {
  if (isOpaqueToken(token, opaqueRanges)) return true;
  return text.slice(token.start, token.end) === token.value;
}

function referenceVerbEdits(
  text: string,
  referenceText: string,
  readonlyPlaceholders: string[] | undefined,
  currentTokens: EnglishAgreementToken[],
  currentFiniteIndexes: Set<number>,
  tokenizer: EnglishAgreementTokenizer
): EnglishAgreementEdit[] {
  const referenceAnalysis = analyzeSimplePresentAgreement({ text: referenceText, readonlyPlaceholders }, tokenizer);
  const referenceFinite = analysisFiniteMetadata.get(referenceAnalysis);
  if (referenceAnalysis.disposition === "abstained" || !referenceFinite) return [];

  const referenceOpaque = prepareOpaqueProxy(referenceText, readonlyPlaceholders);
  if ("error" in referenceOpaque || unsupportedInput(referenceText, referenceOpaque.ranges)) return [];
  const original = tokenizer.tokenize(referenceText);
  const projected = tokenizer.tokenize(referenceOpaque.proxy);
  if (original.rebuilt !== referenceText || projected.rebuilt !== referenceOpaque.proxy
    || projected.tokens.length !== currentTokens.length) return [];

  const edits: EnglishAgreementEdit[] = [];
  for (let index = 0; index < currentTokens.length; index += 1) {
    const current = currentTokens[index];
    const reference = projected.tokens[index];
    if (!tokenRangeIsExact(referenceText, reference, referenceOpaque.ranges)) return [];
    reference.opaque = isOpaqueToken(reference, referenceOpaque.ranges);
    if ((current.precedingSpaces ?? "") !== (reference.precedingSpaces ?? "")) return [];
    if (current.opaque || reference.opaque) {
      if (current.opaque !== reference.opaque || current.value !== reference.value) return [];
      continue;
    }
    if (current.value === reference.value) continue;
    if (!currentFiniteIndexes.has(index) || !referenceFinite.indexes.has(index)) return [];
    if (!["VERB", "AUX"].includes(current.pos) || !["VERB", "AUX"].includes(reference.pos)) return [];
    if (!isSupportedPresentSurface(current.lemma, current.value)
      || !isSupportedPresentSurface(reference.lemma, reference.value)) return [];
    if (current.lemma === reference.lemma) continue;

    const referenceCorrection = referenceAnalysis.edits.find((edit) => edit.from === reference.start && edit.to === reference.end);
    const replacement = referenceCorrection?.replacement ?? reference.value;
    if (!isSupportedPresentSurface(reference.lemma, replacement)) return [];
    edits.push({
      from: current.start,
      to: current.end,
      source: text.slice(current.start, current.end),
      replacement,
      subject: referenceFinite.subjects.get(index) ?? "reference subject",
      lemma: reference.lemma
    });
  }
  return edits;
}

/**
 * Applies only the simple-present subject–verb rule to a single bounded plain-text window.
 * A `no-supported-edit` result is advisory and never implies whole-text correctness.
 */
export function analyzeSimplePresentAgreement(
  input: EnglishAgreementInput,
  tokenizer: EnglishAgreementTokenizer
): EnglishAgreementAnalysis {
  const preflight = preflightEnglishAgreementInput(input);
  if (preflight) return preflight;
  const { text, readonlyPlaceholders } = input;
  const opaque = prepareOpaqueProxy(text, readonlyPlaceholders);
  if ("error" in opaque) return abstain(text, opaque.error);
  const unsafeReason = unsupportedInput(text, opaque.ranges);
  if (unsafeReason) return abstain(text, unsafeReason);

  const originalAnalysis = tokenizer.tokenize(text);
  const analysis = tokenizer.tokenize(opaque.proxy);
  if (originalAnalysis.rebuilt !== text || analysis.rebuilt !== opaque.proxy) {
    return abstain(text, "Token reconstruction did not preserve the complete source.");
  }
  for (const token of analysis.tokens) {
    if (!tokenRangeIsExact(text, token, opaque.ranges)) return abstain(text, "A token surface did not map to its exact source range.");
    token.opaque = isOpaqueToken(token, opaque.ranges);
  }
  const tokens = analysis.tokens;
  const fail = (reason: string) => abstain(text, reason);
  if (tokens.some((token) => !token.opaque && RELATIVE_WORDS.has(token.lower))) return fail("Relative clauses are outside this analyzer.");
  if (tokens.some((token) => !token.opaque && token.pos === "PUNCT" && /[;:]/u.test(token.value))) {
    return fail("Semicolon and colon clause structures are outside this analyzer.");
  }

  const candidates = tokens.map((token, index) => ({ token, index }))
    .filter(({ token }) => !token.opaque && ["AUX", "VERB"].includes(token.pos));
  if (!candidates.length) return fail("No confidently tagged verb or auxiliary was found.");
  if (tokens.some((token, index) => !token.opaque && ["but", "while"].includes(token.lower)
    && !candidates.some(({ index: candidateIndex }) => candidateIndex < index))) {
    return fail("An earlier clause has no confidently tagged predicate.");
  }
  const recovery = recoverConjoinedNounPredicates(tokens, candidates, opaque.ranges, tokenizer);
  if (recovery.error) return fail(recovery.error);
  const allCandidates = recovery.candidates;
  if (allCandidates.some(({ token, index }) => token.lower === token.lemma && isOptativeVerbSubjectInversion(tokens, index))) {
    return fail("Optative verb–subject inversions are outside this analyzer.");
  }

  const edits: EnglishAgreementEdit[] = [];
  const supportedFiniteIndexes = new Set<number>();
  const supportedFiniteSubjects = new Map<number, string>();
  let priorFinite: Candidate | null = null;
  let priorSubject: ReturnType<typeof resolveSimpleSubject> = null;
  let sawSupportedFinite = false;

  for (const { token, index } of allCandidates) {
    const before = nearestWord(tokens, index)?.token;
    if (token.pos === "VERB" && before?.lower === "to") continue;

    let subject: ReturnType<typeof resolveSimpleSubject>;
    let subjectPhrase: EnglishAgreementToken[] | null = null;
    if (!priorFinite) {
      if (tokens.slice(0, index).some((item) => ["but", "while"].includes(item.lower) && !item.opaque)) {
        return fail("A preceding clause could not be analyzed.");
      }
      subjectPhrase = tokens.slice(0, index);
      subject = resolveSimpleSubject(subjectPhrase);
    } else {
      const boundary = findBoundary(tokens, priorFinite.index, index);
      if (boundary?.kind === "new-clause") {
        subjectPhrase = tokens.slice(boundary.index + 1, index);
        subject = resolveSimpleSubject(subjectPhrase);
      } else if (boundary?.kind === "shared-subject") {
        subject = priorSubject;
        if (isPresentModal(priorFinite.token.lower)) {
          if (token.lower !== token.lemma) return fail("A coordinated modal complement is not in base form.");
          continue;
        }
      } else {
        const between = tokens.slice(priorFinite.index + 1, index);
        const priorLemma = priorFinite.token.lemma;
        if (isPresentModal(priorFinite.token.lower)) {
          if (token.lower === token.lemma) continue;
          return fail("A modal complement is not in base form.");
        }
        if (priorLemma === "do" && (before?.lower === "not" || isSupportedPresentSurface(token.lemma, token.value))) continue;
        if (priorLemma === "be" || priorLemma === "have") return fail("Progressive, perfect, and passive phrases are outside this analyzer.");
        if (between.some((item) => item.lower === "not") && priorLemma === "do") continue;
        return fail("Adjacent predicates lack a supported clause boundary.");
      }
    }
    if (!subject?.head || isOpaqueToken(subject.head, opaque.ranges)) return fail("The subject number is ambiguous or overlaps a protected atom.");
    if (token.lower === token.lemma && token.pos === "VERB" && subject.number === "singular" && subject.person === 3
      && subjectPhrase && isProperNameSubjectPhrase(subjectPhrase)) {
      return fail("A proper-name subject may use the subjunctive or optative base form.");
    }

    if (isPresentModal(token.lower) && token.pos === "AUX") {
      sawSupportedFinite = true;
      supportedFiniteIndexes.add(index);
      supportedFiniteSubjects.set(index, subject.head.value);
      priorFinite = { token, index };
      priorSubject = subject;
      continue;
    }
    if (!["be", "have", "do"].includes(token.lemma) && token.pos === "AUX") return fail("An unrecognized auxiliary is outside this analyzer.");
    if (!isSupportedPresentSurface(token.lemma, token.value)) return fail("The predicate is outside supported simple-present forms.");
    if (token.lower === token.lemma && subject.number === "singular" && subject.person === 3
      && isPastBaseHomograph(token.lemma)) {
      return fail("The base verb is also an irregular simple-past surface, so tense is ambiguous.");
    }

    const nextWord = tokens.slice(index + 1).find((item) => item.pos !== "PUNCT");
    if (token.lemma === "be" && nextWord?.pos === "VERB") return fail("Progressive and passive be-phrases are outside this analyzer.");
    if (token.lemma === "have" && nextWord?.pos === "VERB" && nextWord.lower !== nextWord.lemma) {
      return fail("Perfect have-phrases are outside this analyzer.");
    }

    const expected = expectedPresentForm(token.lemma, subject);
    if (token.lower !== expected) {
      edits.push({
        from: token.start,
        to: token.end,
        source: text.slice(token.start, token.end),
        replacement: preserveCase(token.value, expected),
        subject: subject.head.value,
        lemma: token.lemma
      });
    }
    sawSupportedFinite = true;
    supportedFiniteIndexes.add(index);
    supportedFiniteSubjects.set(index, subject.head.value);
    priorFinite = { token, index };
    priorSubject = subject;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const marker = tokens[index];
    if (marker.opaque || !["but", "while", "and"].includes(marker.lower)) continue;
    const before = allCandidates.some(({ index: candidateIndex }) => candidateIndex < index);
    const after = allCandidates.some(({ index: candidateIndex }) => candidateIndex > index);
    if (marker.lower === "and" && !before) continue;
    const nextCandidate = allCandidates.find(({ index: candidateIndex }) => candidateIndex > index)?.index ?? tokens.length;
    const startsNewClause = marker.lower !== "and"
      || tokens.slice(index + 1, nextCandidate).some((item) => isSubjectLike(item) && !item.opaque);
    if (startsNewClause && (!before || !after)) return fail("A coordinated clause is missing a confidently tagged predicate.");
  }

  if (!sawSupportedFinite) return fail("No supported finite simple-present predicate was found.");
  if (edits.some((edit, index) => index > 0 && edit.from < edits[index - 1].to)) return fail("Candidate source ranges overlap.");
  for (const edit of edits) {
    if (text.slice(edit.from, edit.to) !== edit.source) return fail("An edit range did not match its exact source token.");
    if (opaque.ranges.some((range) => edit.from < range.end && edit.to > range.start)) return fail("An edit overlaps a protected atom.");
  }

  const referenceEdits = input.referenceText === undefined ? [] : referenceVerbEdits(
    text,
    input.referenceText,
    readonlyPlaceholders,
    tokens,
    supportedFiniteIndexes,
    tokenizer
  );
  const referenceRanges = new Set(referenceEdits.map(({ from, to }) => `${from}:${to}`));
  const finalEdits = [
    ...edits.filter(({ from, to }) => !referenceRanges.has(`${from}:${to}`)),
    ...referenceEdits
  ];
  const result = finalEdits.length
    ? makeResult("suggestions", "Simple-present subject–verb agreement suggestions; review with the model and existing guards.", text, finalEdits)
    : makeResult("no-supported-edit", "No supported agreement edit was found; other grammar has not been checked and whole-text correctness is not established.", text);
  analysisFiniteMetadata.set(result, { indexes: supportedFiniteIndexes, subjects: supportedFiniteSubjects });
  return result;
}
