import winkNlp from "wink-nlp";
import type { ItemToken } from "wink-nlp";
import model from "wink-eng-lite-web-model";
import { analyzeSimplePresentAgreement } from "./englishAgreementEngine";
import type { EnglishAgreementAnalysis, EnglishAgreementInput, EnglishAgreementTokenizer } from "./englishAgreementTypes";

const nlp = winkNlp(model);

const tokenizer: EnglishAgreementTokenizer = {
  tokenize(text) {
    const trailingSpaces = text.match(/\p{Zs}+$/u)?.[0] ?? "";
    const tokenizedText = trailingSpaces ? text.slice(0, -trailingSpaces.length) : text;
    const doc = nlp.readDoc(tokenizedText);
    const tokens: ReturnType<EnglishAgreementTokenizer["tokenize"]>["tokens"] = [];
    let rebuilt = "";
    doc.tokens().each((token: ItemToken) => {
      const precedingSpaces = String(token.out(nlp.its.precedingSpaces));
      const value = String(token.out(nlp.its.value));
      const start = rebuilt.length + precedingSpaces.length;
      rebuilt += precedingSpaces + value;
      tokens.push({
        value,
        lower: value.toLowerCase(),
        lemma: String(token.out(nlp.its.lemma as unknown as import("wink-nlp").ItsFunction<string>)).toLowerCase(),
        pos: String(token.out(nlp.its.pos)),
        start,
        end: start + value.length,
        precedingSpaces
      });
    });
    return { tokens, rebuilt: rebuilt + trailingSpaces };
  }
};

/** Synchronous engine used only inside its Worker or the SSR/Node dynamic fallback. */
export function analyzeEnglishAgreementWithWink(input: EnglishAgreementInput): EnglishAgreementAnalysis {
  return analyzeSimplePresentAgreement(input, tokenizer);
}
