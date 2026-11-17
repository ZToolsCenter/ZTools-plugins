import type { InstructionContract } from "./intentContract";
import type { IntentCandidates } from "./intentTypes";
import { extractIntentLiterals } from "./intentPrompts";
import { getIntentHeadings } from "./intentTargets";
import { generatedCodeTaskEvidence } from "./generatedCodeTask";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";

const MAX_HEADING_CANDIDATES = 32;

function searchableText(value: string): string {
  return value.replace(/[*_~`"“”‘’]/gu, "").trim().toLocaleLowerCase();
}

function hasHeadingSemantics(instruction: string): boolean {
  return /标题|章节|小节|\b(?:heading|section)\b|(?:在|于|到)\s*[^，,。！？；;\n]{1,48}(?:后|之后|前|之前|末尾|结尾|开头|结束|下|上)|[^，,。！？；;\n]{1,16}(?:部分|章节|小节|一节)(?:内容|文字)?(?:后|之后|前|之前|末尾|结尾|开头|结束)?|\b(?:after|before|under|within)\b/iu.test(instruction);
}

function shouldScanHeadings(instruction: string, contract?: InstructionContract): boolean {
  if (!contract || contract.heading.state !== "unknown") return true;
  // A heading inside a newly requested code artifact is content, not a reference
  // to the current document outline. Explicit/ambiguous anchors were handled above.
  if (generatedCodeTaskEvidence(instruction, maskQuotedInstruction(instruction, scanInstructionQuotes(instruction))).length) return false;
  if (hasHeadingSemantics(instruction)) return true;

  if (contract.target.state === "explicit") {
    return contract.target.value === "heading_end" || contract.target.value === "section_end";
  }

  if (contract.operation.state === "explicit") {
    return contract.operation.value !== "replace_exact" && contract.operation.value !== "rewrite";
  }
  return true;
}

/** Supply only relevant bind targets; a global edit does not need the document outline. */
export function buildAiIntentCandidates(instruction: string, source: string, contract?: InstructionContract): IntentCandidates {
  const headings = shouldScanHeadings(instruction, contract) ? getIntentHeadings(source) : [];
  const referencesHeadingKind = /标题|章节|小节|\b(?:heading|section)\b/iu.test(instruction);
  const query = searchableText(instruction);
  let relevant = referencesHeadingKind ? headings : headings.filter((heading) => {
    const title = searchableText(heading.text);
    if (!title || !query.includes(title)) return false;
    // Single Latin letters commonly occur inside payload words, such as A in "add".
    if (/^[a-z0-9]$/iu.test(title)) {
      return new RegExp(`(?:^|[^a-z0-9])${title}(?:$|[^a-z0-9])`, "iu").test(query);
    }
    return true;
  });
  if (contract?.heading.state === "explicit") {
    const heading = contract.heading.value;
    if (heading.ordinalScope === "global" && heading.ordinal !== undefined) {
      relevant = headings.slice(heading.ordinal - 1, heading.ordinal);
    } else {
      relevant = headings.filter(({ text }) => searchableText(text) === searchableText(heading.text));
    }
  }
  return {
    headings: relevant.slice(0, MAX_HEADING_CANDIDATES),
    literals: extractIntentLiterals(instruction),
    incomplete: relevant.length > MAX_HEADING_CANDIDATES
  };
}
