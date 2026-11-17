/** A single source-mapped token produced by the bounded tokenizer. */
export interface EnglishAgreementToken {
  value: string;
  lower: string;
  lemma: string;
  pos: string;
  start: number;
  end: number;
  precedingSpaces?: string;
  opaque?: boolean;
  recoveredFrom?: string;
}

export interface EnglishAgreementInput {
  text: string;
  readonlyPlaceholders?: string[];
  /** Optional trusted source sentence for strict proofreading; never instruction text. */
  referenceText?: string;
}

export interface EnglishAgreementTokenizerResult {
  tokens: EnglishAgreementToken[];
  rebuilt: string;
}

export interface EnglishAgreementTokenizer {
  tokenize(text: string): EnglishAgreementTokenizerResult;
}

export interface EnglishAgreementEdit {
  from: number;
  to: number;
  source: string;
  replacement: string;
  subject: string;
  lemma: string;
}

export type EnglishAgreementDisposition = "suggestions" | "no-supported-edit" | "abstained";

export interface EnglishAgreementAnalysis {
  scope: "simple-present-subject-verb-agreement";
  disposition: EnglishAgreementDisposition;
  reason: string;
  outputText: string;
  edits: EnglishAgreementEdit[];
}

export interface EnglishAgreementSubject {
  number: "singular" | "plural";
  person: 1 | 2 | 3;
  head: EnglishAgreementToken;
}

/**
 * Returns suggestions for one tightly bounded grammar feature only.
 * `no-supported-edit` means this rule found nothing to change; it does not
 * certify the sentence, paragraph, or document as correct and must not bypass
 * model generation or downstream fact/AST/diff checks.
 */
export type EnglishAgreementAnalyzer = (input: EnglishAgreementInput) => EnglishAgreementAnalysis;
